#!/usr/bin/env python3
"""ViperCode Antigravity bridge.

This process is owned by the ViperCode server and talks NDJSON on stdio.
It keeps transport/probing dependency-light, then imports ``google.antigravity``
only when a session actually starts. Runtime methods are asynchronous because
the SDK streams semantic chunks and asks permission/user-input questions while
the Node side may send replies, interrupts, or stop requests.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import inspect
import json
import mimetypes
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, Optional, Sequence

PROTOCOL_VERSION = 1

GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"

SUPPORTED_IMAGE_MIME_TYPES = {
    "image/bmp",
    "image/webp",
    "image/png",
    "image/jpeg",
}

SUPPORTED_DOCUMENT_MIME_TYPES = {
    "text/plain",
    "text/css",
    "text/html",
    "text/xml",
    "application/json",
    "text/csv",
    "text/rtf",
    "text/javascript",
    "application/pdf",
}


def _log(message: str) -> None:
    print(f"[antigravity-bridge] {message}", file=sys.stderr, flush=True)


def _to_plain(value: Any) -> Any:
    """Convert SDK/Pydantic/enum values into JSON-serializable data."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return {"bytes": len(value)}
    if isinstance(value, dict):
        return {str(k): _to_plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_plain(v) for v in value]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            return _to_plain(model_dump(mode="json"))
        except TypeError:
            return _to_plain(model_dump())
    if hasattr(value, "value"):
        try:
            return _to_plain(value.value)
        except Exception:
            pass
    return repr(value)


def _emit(event: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(_to_plain(event), separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _respond(
    request_id: str,
    *,
    ok: bool,
    result: Any = None,
    error: Optional[Dict[str, Any]] = None,
) -> None:
    event: Dict[str, Any] = {"type": "response", "id": request_id, "ok": ok}
    if ok:
        if result is not None:
            event["result"] = result
    elif error is not None:
        event["error"] = error
    _emit(event)


class BridgeRequestError(Exception):
    def __init__(self, message: str, code: str = "bridge_error") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _error_info(exc: BaseException) -> Dict[str, str]:
    if isinstance(exc, BridgeRequestError):
        return {"message": exc.message, "code": exc.code}
    message = str(exc) or exc.__class__.__name__
    class_name = exc.__class__.__name__.lower()
    # Class-name checks first: more stable than English message wording.
    if "defaultcredentials" in class_name or "refresherror" in class_name:
        return {"message": message, "code": "oauth_required"}
    lowered = message.lower()
    if "default credentials" in lowered or "could not automatically determine credentials" in lowered:
        return {"message": message, "code": "oauth_required"}
    if "gcp project" in lowered or "project and location" in lowered:
        return {"message": message, "code": "oauth_setup_required"}
    if "gemini api key" in lowered or "api key is required" in lowered:
        return {"message": message, "code": "auth_required"}
    if "permission" in lowered or "credential" in lowered or "auth" in lowered:
        return {"message": message, "code": "auth_failed"}
    return {"message": message, "code": "sdk_error"}


def _sdk_status() -> Dict[str, Any]:
    import importlib.util

    spec = importlib.util.find_spec("google.antigravity")
    available = spec is not None
    version: Optional[str] = None
    if available:
        try:
            from importlib.metadata import PackageNotFoundError, version as pkg_version

            try:
                version = pkg_version("google-antigravity")
            except PackageNotFoundError:
                version = None
        except Exception:
            version = None
    return {
        "sdkAvailable": available,
        "sdkVersion": version,
        "python": sys.version.split()[0],
    }


def _tool_name(value: Any) -> str:
    raw = getattr(value, "value", value)
    return str(raw)


def _tool_kind(name: str) -> str:
    normalized = name.lower()
    if "run_command" in normalized or "command" in normalized or "shell" in normalized:
        return "command_execution"
    if any(token in normalized for token in ("edit_file", "create_file", "patch", "write")):
        return "file_change"
    if any(token in normalized for token in ("view_file", "find_file", "list_directory", "search_directory")):
        return "file_read"
    if "mcp" in normalized:
        return "mcp_tool_call"
    if "subagent" in normalized or "agent" in normalized:
        return "collab_agent_tool_call"
    if "search_web" in normalized or "web" in normalized:
        return "web_search"
    if "image" in normalized:
        return "image_view"
    return "dynamic_tool_call"


def _permission_detail(tool_call: Any) -> str:
    plain = _to_plain(tool_call)
    if isinstance(plain, dict):
        args = plain.get("args")
        if isinstance(args, dict) and args:
            return json.dumps(args, ensure_ascii=False, separators=(",", ":"))
    return ""


def _decision_allows(decision: str) -> bool:
    return decision in {"accept", "acceptForSession", "allow", "approved", "yes", "true"}


def _decision_remembered(decision: str) -> bool:
    return decision in {"acceptForSession", "always", "allowForSession"}


def _normalize_mime(path: str, mime_type: Any) -> str:
    if isinstance(mime_type, str) and mime_type.strip():
        return mime_type.strip().lower()
    guessed, _ = mimetypes.guess_type(path)
    return (guessed or "").lower()


def _attachment_to_content(att: Any) -> Any:
    if not isinstance(att, dict):
        raise BridgeRequestError("Attachment payload must be an object.", "invalid_attachment")
    path = att.get("path")
    if not isinstance(path, str) or not path:
        raise BridgeRequestError("Attachment payload is missing an absolute path.", "invalid_attachment")
    if not os.path.isfile(path):
        raise BridgeRequestError(f"Attachment file does not exist: {path}", "attachment_not_found")
    mime_type = _normalize_mime(path, att.get("mimeType"))
    description = att.get("name") if isinstance(att.get("name"), str) else None
    with open(path, "rb") as file:
        data = file.read()

    from google.antigravity import types

    if mime_type in SUPPORTED_IMAGE_MIME_TYPES:
        return types.Image(data=data, mime_type=mime_type, description=description)
    if mime_type in SUPPORTED_DOCUMENT_MIME_TYPES:
        return types.Document(data=data, mime_type=mime_type, description=description)
    raise BridgeRequestError(
        f"Unsupported Antigravity attachment MIME type: {mime_type or 'unknown'}",
        "unsupported_attachment",
    )


def _turn_prompt(text: str, attachments: Sequence[Any]) -> Any:
    parts: list[Any] = []
    if text.strip():
        parts.append(text)
    for attachment in attachments:
        parts.append(_attachment_to_content(attachment))
    if not parts:
        raise BridgeRequestError("A turn requires text input or at least one attachment.", "empty_turn")
    return parts[0] if len(parts) == 1 else parts


def _extract_conversation_id(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict):
        candidate = value.get("conversationId") or value.get("conversation_id")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _env_first(*names: str) -> Optional[str]:
    for name in names:
        value = os.environ.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _request_first(request: Dict[str, Any], key: str, *env_names: str) -> Optional[str]:
    value = request.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return _env_first(*env_names)


def _oauth_profile_candidates(request: Dict[str, Any]) -> list[Path]:
    candidates: list[Path] = []
    explicit = _request_first(
        request,
        "oauthProfilePath",
        "ANTIGRAVITY_CLI_OAUTH_PROFILE",
        "ANTIGRAVITY_CLI_OAUTH_TOKEN_FILE",
        "GEMINI_OAUTH_CREDS",
    )
    if explicit:
        candidates.append(Path(explicit).expanduser())

    roots: list[Path] = []
    for raw in (
        request.get("appDataDir"),
        os.environ.get("ANTIGRAVITY_HOME"),
        os.environ.get("GEMINI_CONFIG_DIR"),
    ):
        if isinstance(raw, str) and raw.strip():
            roots.append(Path(raw.strip()).expanduser())
    roots.append(Path.home() / ".gemini")

    seen_roots: set[str] = set()
    for root in roots:
        key = str(root)
        if key in seen_roots:
            continue
        seen_roots.add(key)
        candidates.extend(
            [
                root / "antigravity-cli" / "antigravity-oauth-token",
                root / "antigravity-cli" / "oauth_creds.json",
                root / "antigravity-cli" / "google_credentials",
                root / "antigravity-cli" / "auth.json",
                root / "antigravity-cli" / "config.json",
                root / "oauth_creds.json",
                root / "google_credentials",
                root / "auth.json",
            ]
        )

    seen_paths: set[str] = set()
    deduped: list[Path] = []
    for path in candidates:
        key = str(path)
        if key not in seen_paths:
            seen_paths.add(key)
            deduped.append(path)
    return deduped


def _profile_expired(data: Dict[str, Any]) -> bool:
    raw = data.get("expiry_date") or data.get("expires_at") or data.get("expiry")
    if raw is None:
        return False
    try:
        if isinstance(raw, str) and not raw.strip().replace(".", "", 1).isdigit():
            parsed = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
            expiry = parsed.timestamp()
        else:
            expiry = float(raw)
            if expiry > 10_000_000_000:
                expiry = expiry / 1000
    except (TypeError, ValueError):
        return False
    return expiry <= time.time() + 60


def _direct_oauth_access_token() -> Optional[tuple[str, str]]:
    for name in (
        "AGY_OAUTH_TOKEN",
        "ANTIGRAVITY_OAUTH_TOKEN",
        "ANTIGRAVITY_ACCESS_TOKEN",
        "GOOGLE_OAUTH_ACCESS_TOKEN",
    ):
        value = os.environ.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip(), f"environment:{name}"
    for name in ("AGY_OAUTH_REFRESH_TOKEN", "ANTIGRAVITY_REFRESH_TOKEN"):
        value = os.environ.get(name)
        if isinstance(value, str) and value.strip():
            client_id, client_secret = _oauth_refresh_client({})
            if client_id and client_secret:
                refreshed = _refresh_oauth_token(value.strip(), client_id, client_secret)
                token = refreshed.get("access_token") if refreshed else None
                if isinstance(token, str) and token.strip():
                    return token.strip(), f"environment:{name}"
    return None


def _walk_dicts(value: Any) -> Iterable[Dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_dicts(child)


def _extract_access_token(data: Dict[str, Any]) -> Optional[tuple[str, Dict[str, Any]]]:
    for candidate in _walk_dicts(data):
        token = (
            candidate.get("access_token")
            or candidate.get("accessToken")
            or candidate.get("oauth_access_token")
            or candidate.get("token")
        )
        if isinstance(token, str) and token.strip():
            return token.strip(), candidate
    return None


def _parse_oauth_profile(raw: str) -> Optional[Dict[str, Any]]:
    raw = raw.strip()
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {"access_token": raw}
    return data if isinstance(data, dict) else None


def _windows_credential_targets(request: Dict[str, Any]) -> list[str]:
    targets: list[str] = []
    explicit = _request_first(
        request,
        "keyringTarget",
        "ANTIGRAVITY_KEYRING_TARGET",
        "AGY_KEYRING_TARGET",
    )
    if explicit:
        targets.append(explicit)
    targets.extend(["gemini:antigravity", "LegacyGeneric:target=gemini:antigravity"])
    seen: set[str] = set()
    deduped: list[str] = []
    for target in targets:
        if target not in seen:
            seen.add(target)
            deduped.append(target)
    return deduped


def _read_windows_credential_text(target: str) -> Optional[str]:
    if os.name != "nt":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        class CREDENTIALW(ctypes.Structure):
            _fields_ = [
                ("Flags", wintypes.DWORD),
                ("Type", wintypes.DWORD),
                ("TargetName", wintypes.LPWSTR),
                ("Comment", wintypes.LPWSTR),
                ("LastWritten", wintypes.FILETIME),
                ("CredentialBlobSize", wintypes.DWORD),
                ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)),
                ("Persist", wintypes.DWORD),
                ("AttributeCount", wintypes.DWORD),
                ("Attributes", ctypes.c_void_p),
                ("TargetAlias", wintypes.LPWSTR),
                ("UserName", wintypes.LPWSTR),
            ]

        credential_ptr_type = ctypes.POINTER(CREDENTIALW)
        advapi32 = ctypes.WinDLL("Advapi32", use_last_error=True)
        advapi32.CredReadW.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            ctypes.POINTER(credential_ptr_type),
        ]
        advapi32.CredReadW.restype = wintypes.BOOL
        advapi32.CredFree.argtypes = [ctypes.c_void_p]
        advapi32.CredFree.restype = None

        credential = credential_ptr_type()
        if not advapi32.CredReadW(target, 1, 0, ctypes.byref(credential)):
            return None
        try:
            contents = credential.contents
            blob = ctypes.string_at(contents.CredentialBlob, contents.CredentialBlobSize)
        finally:
            advapi32.CredFree(credential)
        for encoding in ("utf-8", "utf-16-le"):
            try:
                text = blob.decode(encoding).strip("\x00").strip()
            except UnicodeDecodeError:
                continue
            if text:
                return text
    except Exception as exc:
        _log(f"Could not read Antigravity Windows credential target {target}: {exc}")
    return None


def _subprocess_no_window_kwargs() -> Dict[str, Any]:
    if os.name != "nt":
        return {}
    kwargs: Dict[str, Any] = {}
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    if creationflags:
        kwargs["creationflags"] = creationflags
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = 0
    kwargs["startupinfo"] = startupinfo
    return kwargs


def _read_windows_keyring_oauth_profile(
    request: Dict[str, Any],
) -> Optional[tuple[Dict[str, Any], str]]:
    for target in _windows_credential_targets(request):
        raw = _read_windows_credential_text(target)
        if raw is None:
            continue
        data = _parse_oauth_profile(raw)
        if data is not None and _extract_access_token(data) is not None:
            return data, f"windows-credential:{target}"
    return None


def _refresh_windows_keyring_with_agy(request: Dict[str, Any]) -> None:
    cli_path = _request_first(request, "cliPath", "ANTIGRAVITY_CLI_PATH", "AGY_PATH") or "agy"
    try:
        subprocess.run(
            [cli_path, "--print-timeout", "45s", "-p", "hello"],
            cwd=str(Path(request.get("cwd") or Path.cwd())),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=60,
            check=False,
            **_subprocess_no_window_kwargs(),
        )
    except Exception as exc:
        _log(f"Could not refresh Antigravity keyring via agy: {exc}")


def _oauth_refresh_client(data: Dict[str, Any], path: Optional[Path] = None) -> tuple[str, str]:
    client_id = (
        data.get("client_id")
        or data.get("clientId")
        or os.environ.get("ANTIGRAVITY_OAUTH_CLIENT_ID")
    )
    client_secret = (
        data.get("client_secret")
        or data.get("clientSecret")
        or os.environ.get("ANTIGRAVITY_OAUTH_CLIENT_SECRET")
    )
    if isinstance(client_id, str) and isinstance(client_secret, str) and client_id and client_secret:
        return client_id, client_secret
    return "", ""


def _refresh_oauth_token(
    refresh_token: str, client_id: str, client_secret: str
) -> Optional[Dict[str, Any]]:
    try:
        import urllib.parse
        import urllib.request

        body = urllib.parse.urlencode(
            {
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            }
        ).encode("utf-8")
        req = urllib.request.Request(GOOGLE_OAUTH_TOKEN_URL, data=body, method="POST")
        with urllib.request.urlopen(req, timeout=15) as response:
            if response.status != 200:
                return None
            data = json.loads(response.read().decode("utf-8"))
            return data if isinstance(data, dict) else None
    except Exception as exc:
        _log(f"Could not refresh Antigravity OAuth token: {exc}")
        return None


def _refresh_cli_oauth_profile(
    data: Dict[str, Any], token_payload: Dict[str, Any], path: Path
) -> Optional[str]:
    refresh_token = token_payload.get("refresh_token") or token_payload.get("refreshToken")
    if not isinstance(refresh_token, str) or not refresh_token.strip():
        return None
    client_id, client_secret = _oauth_refresh_client(data, path)
    if not client_id or not client_secret:
        return None

    refreshed = _refresh_oauth_token(refresh_token.strip(), client_id, client_secret)
    if refreshed is None:
        return None

    access_token = refreshed.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        return None

    expires_in = refreshed.get("expires_in")
    try:
        expires_at = time.time() + float(expires_in)
    except (TypeError, ValueError):
        expires_at = time.time() + 3600

    token_payload["access_token"] = access_token.strip()
    token_payload["expiry"] = (
        datetime.fromtimestamp(expires_at, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )
    token_payload["expiry_date"] = int(expires_at * 1000)
    data["access_token"] = data.get("access_token", access_token.strip())
    if path.name == "antigravity-oauth-token":
        data["token"] = token_payload

    try:
        temp_path = path.with_name(f"{path.name}.tmp")
        temp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        temp_path.replace(path)
    except OSError as exc:
        _log(f"Could not save refreshed Antigravity CLI OAuth profile {path}: {exc}")

    return access_token.strip()


def _load_cli_oauth_access_token(
    request: Dict[str, Any], *, require_usable_profile: bool = True
) -> Optional[tuple[str, str]]:
    direct = _direct_oauth_access_token()
    if direct is not None:
        return direct

    expired_profile_found = False
    keyring_profile = _read_windows_keyring_oauth_profile(request)
    if keyring_profile is not None:
        data, source = keyring_profile
        extracted = _extract_access_token(data)
        if extracted is not None:
            token, token_payload = extracted
            if _profile_expired(token_payload):
                expired_profile_found = True
                _refresh_windows_keyring_with_agy(request)
                refreshed_profile = _read_windows_keyring_oauth_profile(request)
                if refreshed_profile is not None:
                    refreshed_data, refreshed_source = refreshed_profile
                    refreshed = _extract_access_token(refreshed_data)
                    if refreshed is not None:
                        refreshed_token, refreshed_payload = refreshed
                        if not _profile_expired(refreshed_payload):
                            return refreshed_token, refreshed_source
            else:
                return token, source

    for path in _oauth_profile_candidates(request):
        try:
            if not path.is_file():
                continue
            raw = path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if not raw:
            continue
        data = _parse_oauth_profile(raw)
        if data is None:
            continue
        extracted = _extract_access_token(data)
        if extracted is None:
            continue
        token, token_payload = extracted
        if _profile_expired(token_payload):
            expired_profile_found = True
            refreshed = _refresh_cli_oauth_profile(data, token_payload, path)
            if refreshed is not None:
                return refreshed, str(path)
            continue
        return token, str(path)

    if not require_usable_profile:
        return None

    if expired_profile_found:
        raise BridgeRequestError(
            "Antigravity CLI OAuth profile was found but its access token is expired. "
            "Run `agy -p hello` to refresh sign-in, provide AGY_OAUTH_TOKEN or "
            "ANTIGRAVITY_ACCESS_TOKEN, or configure OAuth/ADC project auth. If you "
            "only see ~/.gemini/oauth_creds.json, that is a Gemini CLI profile; the "
            "Antigravity CLI token is expected at "
            "~/.gemini/antigravity-cli/antigravity-oauth-token.",
            "cli_oauth_profile_expired",
        )
    raise BridgeRequestError(
        "Antigravity OAuth credentials were not found in an explicit bearer-token "
        "environment variable or a readable CLI token profile. The `agy` CLI may be "
        "signed in through the OS keyring, but this SDK build cannot reuse keyring-only "
        "profiles directly. Set AGY_OAUTH_TOKEN, set ANTIGRAVITY_CLI_OAUTH_PROFILE, "
        "or configure OAuth/ADC project auth.",
        "cli_oauth_profile_not_found",
    )


def _models_for_endpoint(
    types: Any,
    model_name: Optional[str],
    endpoint: Any,
    image_model: Optional[str] = None,
) -> list[Any]:
    text_name = model_name or _env_first("ANTIGRAVITY_DEFAULT_MODEL") or "gemini-3.5-flash"
    models = [types.ModelTarget(name=text_name, types=[types.ModelType.TEXT], endpoint=endpoint)]
    image_name = image_model or _env_first("ANTIGRAVITY_IMAGE_MODEL") or "gemini-3.1-flash-image-preview"
    models.append(types.ModelTarget(name=image_name, types=[types.ModelType.IMAGE], endpoint=endpoint))
    return models


def _antigravity_app_data_dir(request_or_session: Any) -> Path:
    if isinstance(request_or_session, BridgeSession):
        return Path.home() / ".gemini" / "antigravity-cli"
    if isinstance(request_or_session, dict):
        explicit = _request_first(request_or_session, "appDataDir", "ANTIGRAVITY_HOME")
        if explicit:
            return Path(explicit).expanduser()
    return Path.home() / ".gemini" / "antigravity-cli"


def _conversation_id_from_cli_cache(app_data_dir: Path, cwd: str) -> Optional[str]:
    path = app_data_dir / "cache" / "last_conversations.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    normalized_cwd = str(Path(cwd))
    for key in (normalized_cwd, cwd):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    normalized_lower = normalized_cwd.lower()
    for key, value in data.items():
        if isinstance(key, str) and key.lower() == normalized_lower and isinstance(value, str):
            return value.strip() or None
    return None


def _cli_transcript_path(app_data_dir: Path, conversation_id: str) -> Path:
    return (
        app_data_dir
        / "brain"
        / conversation_id
        / ".system_generated"
        / "logs"
        / "transcript.jsonl"
    )


def _read_cli_model_entries(
    app_data_dir: Path, conversation_id: str, after_step: int
) -> tuple[str, int]:
    path = _cli_transcript_path(app_data_dir, conversation_id)
    text_parts: list[str] = []
    max_step = after_step
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return "", max_step
    for line in lines:
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(entry, dict):
            continue
        step_index = entry.get("step_index")
        if isinstance(step_index, int):
            if step_index <= after_step:
                continue
        source = str(entry.get("source") or "").upper()
        entry_type = str(entry.get("type") or "").upper()
        content = entry.get("content")
        if source == "MODEL" and isinstance(content, str) and content.strip():
            if "RESPONSE" in entry_type or entry_type in {"TEXT", "MESSAGE"}:
                text_parts.append(content)
                if isinstance(step_index, int):
                    max_step = max(max_step, step_index)
    return "\n".join(text_parts).strip(), max_step


def _cli_path_from_request(request: Dict[str, Any]) -> str:
    return _request_first(request, "cliPath", "ANTIGRAVITY_CLI_PATH", "AGY_PATH") or "agy"


def _accepted_kwargs(target: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """Drop kwargs the target does not accept, unless it takes ``**kwargs``.

    Pydantic models expose a field-based ``__signature__`` (no VAR_KEYWORD), so
    this filters config options the installed SDK build does not support instead
    of raising ``TypeError`` and failing every session.
    """
    try:
        signature = inspect.signature(target)
    except (TypeError, ValueError):
        return dict(kwargs)
    parameters = list(signature.parameters.values())
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in parameters):
        return dict(kwargs)
    accepted = {
        p.name
        for p in parameters
        if p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    }
    dropped = sorted(key for key in kwargs if key not in accepted)
    if dropped:
        _log(f"LocalAgentConfig ignoring unsupported kwargs: {', '.join(dropped)}")
    return {key: value for key, value in kwargs.items() if key in accepted}


@dataclass
class BridgeSession:
    session_id: str
    cwd: str
    agent: Any
    loop: asyncio.AbstractEventLoop
    conversation_id: Optional[str] = None
    cli_runtime: bool = False
    cli_path: str = "agy"
    cli_model: Optional[str] = None
    cli_app_data_dir: Optional[str] = None
    cli_skip_permissions: bool = False
    cli_last_step_index: int = -1
    cli_turn_count: int = 0
    current_turn_id: Optional[str] = None
    current_response: Any = None
    current_task: Optional[asyncio.Task[None]] = None
    stopped: bool = False
    request_counter: int = 0
    pending_permissions: Dict[str, asyncio.Future[str]] = field(default_factory=dict)
    pending_questions: Dict[str, tuple[asyncio.Future[Any], Any]] = field(default_factory=dict)
    remembered_permission_tools: set[str] = field(default_factory=set)
    turns: list[Dict[str, Any]] = field(default_factory=list)

    def next_request_id(self, prefix: str) -> str:
        self.request_counter += 1
        return f"{prefix}-{self.session_id}-{self.request_counter}"


def _signature_accepts(method: Any, args: tuple[Any, ...], kwargs: Dict[str, Any]) -> bool:
    try:
        signature = inspect.signature(method)
    except (TypeError, ValueError):
        return True
    try:
        signature.bind(*args, **kwargs)
        return True
    except TypeError:
        return False


async def _await_if_needed(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def _try_public_sdk_rollback(
    session: BridgeSession,
    *,
    kept_count: int,
    num_turns: int,
) -> Optional[str]:
    """Use an official SDK rollback method when one is present.

    Current SDK builds expose only in-memory history helpers, but this keeps the
    bridge upgrade-ready without reaching into private transports or key files.
    """

    targets: list[tuple[str, Any]] = [("Agent", session.agent)]
    conversation = getattr(session.agent, "conversation", None)
    if conversation is not None:
        targets.append(("Conversation", conversation))

    rollback_attempts = [
        ((), {"num_turns": num_turns}),
        ((), {"turns": num_turns}),
        ((num_turns,), {}),
    ]
    rollback_to_turn_attempts = [
        ((), {"turn_count": kept_count}),
        ((), {"target_turn_count": kept_count}),
        ((kept_count,), {}),
    ]
    candidates = [
        (
            ("rollback_thread", "rollback_turns", "rollback", "rewind_turns", "rewind"),
            rollback_attempts,
        ),
        (
            (
                "rollback_to_turn",
                "rewind_to_turn",
                "restore_to_turn",
                "truncate_to_turn",
                "restore_history_to_turn",
            ),
            rollback_to_turn_attempts,
        ),
    ]

    for target_label, target in targets:
        for method_names, attempts in candidates:
            for method_name in method_names:
                method = getattr(target, method_name, None)
                if not callable(method):
                    continue
                for args, kwargs in attempts:
                    if not _signature_accepts(method, args, kwargs):
                        continue
                    try:
                        await _await_if_needed(method(*args, **kwargs))
                        return f"{target_label}.{method_name}"
                    except TypeError:
                        continue
                    except Exception as exc:
                        raise BridgeRequestError(
                            f"Antigravity SDK rollback method {target_label}.{method_name} failed: {exc}",
                            "sdk_rollback_failed",
                        ) from exc
    return None


class Bridge:
    def __init__(self) -> None:
        self.sessions: Dict[str, BridgeSession] = {}
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    async def handle(self, request: Dict[str, Any]) -> None:
        request_type = request.get("type")
        request_id = request.get("id")
        if not isinstance(request_id, str):
            _log(f"dropping request without string id: {request!r}")
            return

        try:
            if request_type == "initialize":
                _respond(request_id, ok=True, result={"protocolVersion": PROTOCOL_VERSION})
            elif request_type == "probe":
                _respond(request_id, ok=True, result=_sdk_status())
            elif request_type == "start_session":
                _respond(request_id, ok=True, result=await self.start_session(request))
            elif request_type == "send_turn":
                _respond(request_id, ok=True, result=await self.send_turn(request))
            elif request_type == "interrupt_turn":
                _respond(request_id, ok=True, result=await self.interrupt_turn(request))
            elif request_type == "respond_to_request":
                _respond(request_id, ok=True, result=await self.respond_to_request(request))
            elif request_type == "respond_to_user_input":
                _respond(request_id, ok=True, result=await self.respond_to_user_input(request))
            elif request_type == "read_thread":
                _respond(request_id, ok=True, result=await self.read_thread(request))
            elif request_type == "rollback_thread":
                _respond(request_id, ok=True, result=await self.rollback_thread(request))
            elif request_type == "stop_session":
                _respond(request_id, ok=True, result=await self.stop_session(request))
            else:
                raise BridgeRequestError(f"Unknown request type: {request_type!r}", "unknown_request")
        except Exception as exc:
            if not isinstance(exc, BridgeRequestError):
                _log(traceback.format_exc().rstrip())
            _respond(request_id, ok=False, error=_error_info(exc))

    def require_session(self, request: Dict[str, Any]) -> BridgeSession:
        session_id = request.get("sessionId")
        if not isinstance(session_id, str) or not session_id:
            raise BridgeRequestError("Missing sessionId.", "invalid_request")
        session = self.sessions.get(session_id)
        if session is None or session.stopped:
            raise BridgeRequestError(f"Unknown Antigravity session: {session_id}", "session_not_found")
        return session

    def _start_cli_session(
        self,
        request: Dict[str, Any],
        *,
        session_id: str,
        cwd: str,
        loop: asyncio.AbstractEventLoop,
        model_name: Optional[str],
    ) -> Dict[str, Any]:
        app_data_dir = _antigravity_app_data_dir(request)
        conversation_id = request.get("conversationId")
        if not isinstance(conversation_id, str) or not conversation_id.strip():
            conversation_id = _conversation_id_from_cli_cache(app_data_dir, cwd)
        else:
            conversation_id = conversation_id.strip()
        last_step = -1
        if conversation_id:
            _text, last_step = _read_cli_model_entries(app_data_dir, conversation_id, -1)
        session = BridgeSession(
            session_id=session_id,
            cwd=cwd,
            agent=None,
            loop=loop,
            conversation_id=conversation_id,
            cli_runtime=True,
            cli_path=_cli_path_from_request(request),
            cli_model=model_name,
            cli_app_data_dir=str(app_data_dir),
            cli_skip_permissions=True,
            cli_last_step_index=last_step,
        )
        self.sessions[session_id] = session
        _emit(
            {
                "type": "session_started",
                "sessionId": session_id,
                "conversationId": conversation_id,
            }
        )
        return {"sessionId": session_id, "conversationId": conversation_id}

    async def start_session(self, request: Dict[str, Any]) -> Dict[str, Any]:
        from google.antigravity import Agent, CapabilitiesConfig, LocalAgentConfig, hooks, policy, types

        session_id = request.get("sessionId")
        cwd = request.get("cwd")
        if not isinstance(session_id, str) or not session_id:
            raise BridgeRequestError("start_session requires sessionId.", "invalid_request")
        if not isinstance(cwd, str) or not cwd:
            raise BridgeRequestError("start_session requires cwd.", "invalid_request")

        existing = self.sessions.get(session_id)
        if existing is not None:
            await self._stop_session(existing, emit_exit=True)

        loop = self.loop or asyncio.get_running_loop()

        async def ask_user(tool_call: Any) -> bool:
            name = _tool_name(getattr(tool_call, "name", "tool"))
            if name in session.remembered_permission_tools or "*" in session.remembered_permission_tools:
                return True
            request_id = session.next_request_id("perm")
            future: asyncio.Future[str] = loop.create_future()
            session.pending_permissions[request_id] = future
            _emit(
                {
                    "type": "permission_requested",
                    "sessionId": session.session_id,
                    "turnId": session.current_turn_id,
                    "requestId": request_id,
                    "title": name,
                    "detail": _permission_detail(tool_call),
                    "options": [
                        {"id": "accept", "label": "Allow once"},
                        {"id": "acceptForSession", "label": "Allow for session"},
                        {"id": "decline", "label": "Deny"},
                    ],
                    "toolCall": _to_plain(tool_call),
                }
            )
            decision = await future
            if _decision_remembered(decision):
                session.remembered_permission_tools.add(name)
            return _decision_allows(decision)

        @hooks.post_tool_call
        async def post_tool_call(result: Any) -> None:
            tool_id = getattr(result, "id", None) or f"tool-{id(result)}"
            name = _tool_name(getattr(result, "name", "tool"))
            _emit(
                {
                    "type": "tool_call_completed",
                    "sessionId": session.session_id,
                    "turnId": session.current_turn_id or "",
                    "toolCallId": str(tool_id),
                    "output": _to_plain(result),
                    "isError": bool(getattr(result, "error", None) or getattr(result, "exception", None)),
                }
            )

        @hooks.on_interaction
        async def on_interaction(spec: Any) -> Any:
            request_id = session.next_request_id("input")
            future: asyncio.Future[Any] = loop.create_future()
            session.pending_questions[request_id] = (future, spec)
            questions = self._normalize_questions(spec)
            _emit(
                {
                    "type": "user_input_requested",
                    "sessionId": session.session_id,
                    "turnId": session.current_turn_id,
                    "requestId": request_id,
                    "prompt": questions[0]["question"] if questions else None,
                    "fields": questions,
                }
            )
            answers = await future
            if isinstance(answers, dict) and answers.get("__cancelled__") is True:
                return types.QuestionHookResult(responses=[], cancelled=True)
            return types.QuestionHookResult(
                responses=self._question_responses(types, spec, answers),
                cancelled=False,
            )

        tool_permission = str(request.get("toolPermission") or "request-review")
        if tool_permission == "always-proceed":
            policies = [policy.allow_all()]
        elif tool_permission == "strict":
            policies = [policy.ask_user("*", handler=ask_user)]
        else:
            policies = policy.safe_defaults(ask_user)

        workspaces = [] if request.get("allowNonWorkspaceAccess") is True else [cwd]
        config_kwargs: Dict[str, Any] = {
            "capabilities": CapabilitiesConfig(),
            "hooks": [post_tool_call, on_interaction],
            "policies": policies,
            "workspaces": workspaces,
        }
        model = request.get("model")
        model_name = model.strip() if isinstance(model, str) and model.strip() else None
        if model_name:
            config_kwargs["model"] = model_name
        image_model = _request_first(request, "imageModel", "ANTIGRAVITY_IMAGE_MODEL")
        auth_mode = str(request.get("authMode") or "google-oauth").strip() or "google-oauth"
        wants_cli_runtime = False
        if auth_mode in {"google-oauth", "vertex-adc", "adc", "oauth"}:
            project = _request_first(
                request,
                "gcpProject",
                "GOOGLE_CLOUD_PROJECT",
                "GCLOUD_PROJECT",
                "CLOUDSDK_CORE_PROJECT",
            )
            location = _request_first(
                request,
                "gcpLocation",
                "GOOGLE_CLOUD_LOCATION",
                "GOOGLE_VERTEX_LOCATION",
                "GOOGLE_CLOUD_REGION",
            )
            if project and location:
                config_kwargs["vertex"] = True
                config_kwargs["project"] = project
                config_kwargs["location"] = location
            else:
                wants_cli_runtime = True
        elif auth_mode in {"agy-oauth", "cli-oauth", "antigravity-cli-oauth"}:
            wants_cli_runtime = True
        elif auth_mode in {"api-key", "gemini-api-key"}:
            pass
        elif auth_mode == "auto":
            project = _request_first(
                request,
                "gcpProject",
                "GOOGLE_CLOUD_PROJECT",
                "GCLOUD_PROJECT",
                "CLOUDSDK_CORE_PROJECT",
            )
            location = _request_first(
                request,
                "gcpLocation",
                "GOOGLE_CLOUD_LOCATION",
                "GOOGLE_VERTEX_LOCATION",
                "GOOGLE_CLOUD_REGION",
            )
            if project and location:
                config_kwargs["vertex"] = True
                config_kwargs["project"] = project
                config_kwargs["location"] = location
            else:
                wants_cli_runtime = True
        else:
            if auth_mode not in {"api-key", "gemini-api-key"}:
                raise BridgeRequestError(
                    f"Unsupported Antigravity auth mode: {auth_mode}", "invalid_auth_mode"
                )
        if wants_cli_runtime:
            return self._start_cli_session(
                request, session_id=session_id, cwd=cwd, loop=loop, model_name=model_name
            )
        conversation_id = request.get("conversationId")
        if isinstance(conversation_id, str) and conversation_id.strip():
            config_kwargs["conversation_id"] = conversation_id.strip()
        save_dir = request.get("saveDir")
        if isinstance(save_dir, str) and save_dir.strip():
            config_kwargs["save_dir"] = save_dir.strip()
        app_data_dir = request.get("appDataDir")
        if isinstance(app_data_dir, str) and app_data_dir.strip():
            config_kwargs["app_data_dir"] = app_data_dir.strip()

        agent = Agent(LocalAgentConfig(**_accepted_kwargs(LocalAgentConfig, config_kwargs)))
        session = BridgeSession(
            session_id=session_id,
            cwd=cwd,
            agent=agent,
            loop=loop,
        )
        try:
            await agent.__aenter__()
        except Exception:
            await agent.__aexit__(None, None, None)
            raise

        session.conversation_id = getattr(agent, "conversation_id", None)
        self.sessions[session_id] = session
        _emit(
            {
                "type": "session_started",
                "sessionId": session_id,
                "conversationId": session.conversation_id,
            }
        )
        return {
            "sessionId": session_id,
            "conversationId": session.conversation_id,
        }

    async def send_turn(self, request: Dict[str, Any]) -> Dict[str, Any]:
        session = self.require_session(request)
        if session.current_task is not None and not session.current_task.done():
            raise BridgeRequestError("A turn is already running for this session.", "turn_in_progress")
        turn_id = request.get("turnId")
        if not isinstance(turn_id, str) or not turn_id:
            raise BridgeRequestError("send_turn requires turnId.", "invalid_request")
        text = request.get("text")
        if not isinstance(text, str):
            text = ""
        attachments = request.get("attachments")
        if attachments is None:
            attachments = []
        if not isinstance(attachments, list):
            raise BridgeRequestError("send_turn attachments must be an array.", "invalid_attachment")

        prompt = _turn_prompt(text, attachments)
        session.current_turn_id = turn_id
        session.current_response = None
        _emit({"type": "turn_started", "sessionId": session.session_id, "turnId": turn_id})
        session.current_task = asyncio.create_task(self._run_turn(session, turn_id, prompt))
        return {
            "sessionId": session.session_id,
            "turnId": turn_id,
            "conversationId": session.conversation_id,
        }

    async def _run_turn(self, session: BridgeSession, turn_id: str, prompt: Any) -> None:
        stop_reason = "completed"
        usage = None
        turn_items: list[Any] = []
        try:
            if session.cli_runtime:
                await self._run_cli_turn(session, turn_id, str(prompt))
                return
            response = await session.agent.chat(prompt)
            session.current_response = response
            async for chunk in response.chunks:
                chunk_type = chunk.__class__.__name__
                if chunk_type == "Text":
                    _emit(
                        {
                            "type": "text_delta",
                            "sessionId": session.session_id,
                            "turnId": turn_id,
                            "text": getattr(chunk, "text", ""),
                        }
                    )
                elif chunk_type == "Thought":
                    _emit(
                        {
                            "type": "reasoning_delta",
                            "sessionId": session.session_id,
                            "turnId": turn_id,
                            "text": getattr(chunk, "text", ""),
                        }
                    )
                elif chunk_type == "ToolCall":
                    tool_id = getattr(chunk, "id", None) or f"tool-{id(chunk)}"
                    name = _tool_name(getattr(chunk, "name", "tool"))
                    payload = _to_plain(chunk)
                    turn_items.append(payload)
                    _emit(
                        {
                            "type": "tool_call_started",
                            "sessionId": session.session_id,
                            "turnId": turn_id,
                            "toolCallId": str(tool_id),
                            "name": name,
                            "kind": _tool_kind(name),
                            "input": getattr(chunk, "args", None),
                        }
                    )
                elif chunk_type == "ToolResult":
                    tool_id = getattr(chunk, "id", None) or f"tool-{id(chunk)}"
                    turn_items.append(_to_plain(chunk))
                    _emit(
                        {
                            "type": "tool_call_completed",
                            "sessionId": session.session_id,
                            "turnId": turn_id,
                            "toolCallId": str(tool_id),
                            "output": _to_plain(chunk),
                            "isError": bool(
                                getattr(chunk, "error", None) or getattr(chunk, "exception", None)
                            ),
                        }
                    )

            usage = _to_plain(getattr(response, "usage_metadata", None))
            if usage:
                _emit({"type": "usage_updated", "sessionId": session.session_id, "usage": usage})

            conversation_id = getattr(session.agent, "conversation_id", None)
            if isinstance(conversation_id, str) and conversation_id and conversation_id != session.conversation_id:
                session.conversation_id = conversation_id
                _emit(
                    {
                        "type": "conversation_id_changed",
                        "sessionId": session.session_id,
                        "conversationId": conversation_id,
                    }
                )
        except asyncio.CancelledError:
            stop_reason = "cancelled"
            try:
                response = session.current_response
                if response is not None:
                    await response.cancel()
            except Exception as exc:
                _log(f"cancel failed: {exc}")
        except Exception as exc:
            stop_reason = "failed"
            _log(traceback.format_exc().rstrip())
            info = _error_info(exc)
            _emit(
                {
                    "type": "runtime_error",
                    "sessionId": session.session_id,
                    "message": info["message"],
                    "code": info.get("code"),
                }
            )
        finally:
            session.turns.append({"id": turn_id, "items": turn_items, "usage": usage})
            session.current_response = None
            if session.current_task is asyncio.current_task():
                session.current_task = None
            if session.current_turn_id == turn_id:
                session.current_turn_id = None
            _emit(
                {
                    "type": "turn_completed",
                    "sessionId": session.session_id,
                    "turnId": turn_id,
                    "stopReason": stop_reason,
                }
            )

    async def _run_cli_turn(self, session: BridgeSession, turn_id: str, prompt: str) -> None:
        app_data_dir = Path(session.cli_app_data_dir) if session.cli_app_data_dir else Path.home() / ".gemini" / "antigravity-cli"
        args = [session.cli_path]
        if session.cli_skip_permissions:
            args.append("--dangerously-skip-permissions")
        args.extend(["--print-timeout", "5m"])
        if session.cli_model:
            args.extend(["--model", session.cli_model])
        if session.conversation_id:
            args.extend(["--conversation", session.conversation_id])
        elif session.cli_turn_count > 0:
            args.append("--continue")
        args.extend(["-p", prompt])

        env = dict(os.environ)
        if session.cli_app_data_dir:
            env["ANTIGRAVITY_HOME"] = session.cli_app_data_dir

        process: Optional[subprocess.Popen[str]] = None
        try:
            process = await asyncio.to_thread(
                subprocess.Popen,
                args,
                cwd=session.cwd,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                **_subprocess_no_window_kwargs(),
            )
            try:
                stdout, stderr = await asyncio.to_thread(process.communicate, timeout=370)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = await asyncio.to_thread(process.communicate, timeout=10)
                message = (stderr or stdout or "agy CLI turn timed out.").strip()
                raise BridgeRequestError(message[:1000], "agy_cli_failed")
        except asyncio.CancelledError:
            if process is not None and process.poll() is None:
                process.kill()
                await asyncio.to_thread(process.wait, timeout=10)
            raise

        session.cli_turn_count += 1
        if process.returncode != 0:
            message = (stderr or stdout or "agy CLI turn failed.").strip()
            raise BridgeRequestError(message[:1000], "agy_cli_failed")

        conversation_id = _conversation_id_from_cli_cache(app_data_dir, session.cwd)
        if conversation_id and conversation_id != session.conversation_id:
            session.conversation_id = conversation_id
            session.cli_last_step_index = -1
            _emit(
                {
                    "type": "conversation_id_changed",
                    "sessionId": session.session_id,
                    "conversationId": conversation_id,
                }
            )

        transcript_text = ""
        if session.conversation_id:
            transcript_text, max_step = _read_cli_model_entries(
                app_data_dir, session.conversation_id, session.cli_last_step_index
            )
            session.cli_last_step_index = max(session.cli_last_step_index, max_step)

        text = (transcript_text or stdout or "").strip()

        if text:
            _emit(
                {
                    "type": "text_delta",
                    "sessionId": session.session_id,
                    "turnId": turn_id,
                    "text": text,
                }
            )
        else:
            raise BridgeRequestError(
                "agy CLI completed without stdout or readable transcript output. "
                "Run `agy --print-timeout 45s -p hello` once in a terminal to refresh "
                "Antigravity sign-in, then try again.",
                "agy_cli_empty_output",
            )

    async def interrupt_turn(self, request: Dict[str, Any]) -> Dict[str, Any]:
        session = self.require_session(request)
        task = session.current_task
        if task is not None and not task.done():
            response = session.current_response
            if response is not None:
                try:
                    await response.cancel()
                except Exception as exc:
                    _log(f"response.cancel failed: {exc}")
            task.cancel()
        return {"interrupted": True}

    async def respond_to_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        session = self.require_session(request)
        request_id = request.get("requestId")
        decision = request.get("decision")
        if not isinstance(request_id, str) or not request_id:
            raise BridgeRequestError("respond_to_request requires requestId.", "invalid_request")
        if not isinstance(decision, str) or not decision:
            raise BridgeRequestError("respond_to_request requires decision.", "invalid_request")
        future = session.pending_permissions.pop(request_id, None)
        if future is None:
            raise BridgeRequestError(f"Unknown permission request: {request_id}", "request_not_found")
        if not future.done():
            future.set_result(decision)
        _emit(
            {
                "type": "permission_resolved",
                "sessionId": session.session_id,
                "requestId": request_id,
                "decision": decision,
            }
        )
        return {"requestId": request_id, "decision": decision}

    async def respond_to_user_input(self, request: Dict[str, Any]) -> Dict[str, Any]:
        session = self.require_session(request)
        request_id = request.get("requestId")
        if not isinstance(request_id, str) or not request_id:
            raise BridgeRequestError("respond_to_user_input requires requestId.", "invalid_request")
        pending = session.pending_questions.pop(request_id, None)
        if pending is None:
            raise BridgeRequestError(f"Unknown user-input request: {request_id}", "request_not_found")
        future, _spec = pending
        answers = request.get("answers")
        if not future.done():
            future.set_result(answers)
        _emit(
            {
                "type": "user_input_resolved",
                "sessionId": session.session_id,
                "requestId": request_id,
                "answers": answers if isinstance(answers, dict) else {},
            }
        )
        return {"requestId": request_id}

    async def read_thread(self, request: Dict[str, Any]) -> Dict[str, Any]:
        session = self.require_session(request)
        history: Any = []
        try:
            conversation = getattr(session.agent, "conversation", None)
            if conversation is not None:
                history = getattr(conversation, "history", [])
                turn_count = getattr(conversation, "turn_count", len(session.turns))
            else:
                turn_count = len(session.turns)
        except Exception:
            turn_count = len(session.turns)
        return {
            "threadId": session.session_id,
            "conversationId": session.conversation_id,
            "turnCount": turn_count,
            "turns": session.turns,
            "history": _to_plain(history),
        }

    async def rollback_thread(self, request: Dict[str, Any]) -> Dict[str, Any]:
        session = self.require_session(request)
        if session.current_task is not None and not session.current_task.done():
            raise BridgeRequestError("Cannot roll back while a turn is running.", "turn_in_progress")
        num_turns = request.get("numTurns")
        if not isinstance(num_turns, int) or num_turns < 1:
            raise BridgeRequestError("rollback_thread requires a positive numTurns.", "invalid_request")
        kept_count = max(0, len(session.turns) - num_turns)
        sdk_rollback_method = await _try_public_sdk_rollback(
            session,
            kept_count=kept_count,
            num_turns=num_turns,
        )
        session.turns = session.turns[:kept_count]
        sdk_history_rolled_back = sdk_rollback_method is not None
        rollback_mode = "sdk" if sdk_rollback_method is not None else "local-history"
        if sdk_rollback_method is None:
            conversation = getattr(session.agent, "conversation", None)
            if conversation is not None and kept_count == 0:
                # Full reset: clear_history() is a documented public API in this
                # SDK build. Done independently of any private fields so a future
                # internal rename never breaks the most common rollback case.
                clear_history = getattr(conversation, "clear_history", None)
                if callable(clear_history):
                    try:
                        clear_history()
                        sdk_history_rolled_back = True
                        rollback_mode = "sdk-clear"
                    except Exception as exc:
                        _log(f"clear_history failed, keeping local-only: {exc}")
            elif conversation is not None and kept_count > 0:
                # No public partial-truncate exists in this SDK build, so mirror
                # the SDK's own _enforce_max_history bookkeeping. Every private
                # field is hasattr/try guarded: if any is renamed upstream the
                # rollback degrades to local-only (turn snapshot already trimmed)
                # instead of raising or silently corrupting state.
                try:
                    steps = getattr(conversation, "_steps", None)
                    turn_indices = getattr(conversation, "_turn_start_indices", None)
                    compaction_indices = getattr(conversation, "_compaction_indices", None)
                    if (
                        isinstance(steps, list)
                        and isinstance(turn_indices, list)
                        and kept_count < len(turn_indices)
                    ):
                        boundary = turn_indices[kept_count]
                        del steps[boundary:]
                        del turn_indices[kept_count:]
                        if isinstance(compaction_indices, list):
                            compaction_indices[:] = [idx for idx in compaction_indices if idx < boundary]
                        sdk_history_rolled_back = True
                        rollback_mode = "sdk-internal"
                except Exception as exc:
                    _log(f"sdk partial-history rollback failed, keeping local-only: {exc}")
        return {
            "threadId": session.session_id,
            "conversationId": session.conversation_id,
            "turnCount": len(session.turns),
            "rolledBackTurns": num_turns,
            "rollbackMode": rollback_mode,
            "sdkHistoryRolledBack": sdk_history_rolled_back,
            **({"sdkRollbackMethod": sdk_rollback_method} if sdk_rollback_method else {}),
            "turns": session.turns,
        }

    async def stop_session(self, request: Dict[str, Any]) -> Dict[str, Any]:
        session = self.require_session(request)
        await self._stop_session(session, emit_exit=True)
        self.sessions.pop(session.session_id, None)
        return {"stopped": True}

    async def stop_all(self) -> None:
        for session in list(self.sessions.values()):
            try:
                await self._stop_session(session, emit_exit=True)
            except Exception as exc:
                _log(f"stop session failed: {exc}")
        self.sessions.clear()

    async def _stop_session(self, session: BridgeSession, *, emit_exit: bool) -> None:
        if session.stopped:
            return
        session.stopped = True
        task = session.current_task
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                _log(f"turn task failed during stop: {exc}")
        for pending in list(session.pending_permissions.values()):
            if not pending.done():
                pending.set_result("cancel")
        for pending, _spec in list(session.pending_questions.values()):
            if not pending.done():
                pending.set_result({"__cancelled__": True})
        session.pending_permissions.clear()
        session.pending_questions.clear()
        if session.agent is None:
            if emit_exit:
                _emit({"type": "session_exited", "sessionId": session.session_id, "code": 0})
            return
        try:
            await session.agent.__aexit__(None, None, None)
        finally:
            if emit_exit:
                _emit({"type": "session_exited", "sessionId": session.session_id, "code": 0})

    def _normalize_questions(self, spec: Any) -> list[Dict[str, Any]]:
        questions = getattr(spec, "questions", [])
        normalized: list[Dict[str, Any]] = []
        for index, question in enumerate(questions):
            text = getattr(question, "question", f"Question {index + 1}")
            options = []
            for option in getattr(question, "options", []) or []:
                label = str(getattr(option, "text", getattr(option, "id", "Option")))
                options.append(
                    {
                        "id": str(getattr(option, "id", label)),
                        "label": label,
                        "description": label,
                    }
                )
            normalized.append(
                {
                    "id": f"q{index + 1}",
                    "header": f"Question {index + 1}",
                    "question": str(text),
                    "options": options,
                    "multiSelect": bool(getattr(question, "is_multi_select", False)),
                }
            )
        return normalized

    def _question_responses(self, types: Any, spec: Any, answers: Any) -> list[Any]:
        if not isinstance(answers, dict):
            answers = {}
        responses: list[Any] = []
        questions = list(getattr(spec, "questions", []) or [])
        for index, question in enumerate(questions):
            keys = [
                f"q{index + 1}",
                str(getattr(question, "question", "")),
                str(index),
            ]
            raw = None
            for key in keys:
                if key and key in answers:
                    raw = answers[key]
                    break
            if isinstance(raw, dict):
                selected = raw.get("selectedOptionIds") or raw.get("selected_option_ids")
                freeform = raw.get("freeform") or raw.get("freeform_response") or ""
                skipped = raw.get("skipped") is True
            elif isinstance(raw, list):
                selected = raw
                freeform = ""
                skipped = False
            elif isinstance(raw, str):
                selected = None
                freeform = raw
                skipped = False
            else:
                selected = None
                freeform = ""
                skipped = raw is None
            selected_ids = (
                [str(value) for value in selected if isinstance(value, (str, int, float))]
                if isinstance(selected, list)
                else None
            )
            responses.append(
                types.QuestionResponse(
                    selected_option_ids=selected_ids,
                    freeform_response=str(freeform),
                    skipped=bool(skipped),
                )
            )
        return responses


async def _read_stdin_lines() -> Iterable[str]:
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if line == "":
            break
        yield line


async def async_main() -> int:
    bridge = Bridge()
    bridge.loop = asyncio.get_running_loop()
    _log("started")
    # Dispatch each request as a task so a slow handler (e.g. start_session
    # blocking on network auth) does not stall replies, interrupts, or stops for
    # other in-flight requests sharing this bridge. Responses are correlated by
    # id, so interleaving on stdout is fine.
    pending: set[asyncio.Task[None]] = set()
    try:
        async for raw_line in _read_stdin_lines():
            line = raw_line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as exc:
                _log(f"ignoring malformed JSON line: {exc}")
                continue
            if not isinstance(request, dict):
                _log(f"ignoring non-object request: {request!r}")
                continue
            task = asyncio.create_task(bridge.handle(request))
            pending.add(task)
            task.add_done_callback(pending.discard)
    finally:
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        await bridge.stop_all()
        _log("stdin closed, exiting")
    return 0


def main() -> int:
    return asyncio.run(async_main())


if __name__ == "__main__":
    raise SystemExit(main())
