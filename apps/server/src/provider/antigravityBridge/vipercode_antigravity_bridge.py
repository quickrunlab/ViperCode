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
import json
import mimetypes
import os
import sys
import traceback
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, Optional, Sequence

PROTOCOL_VERSION = 1

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


@dataclass
class BridgeSession:
    session_id: str
    cwd: str
    agent: Any
    loop: asyncio.AbstractEventLoop
    conversation_id: Optional[str] = None
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
        if isinstance(model, str) and model.strip():
            config_kwargs["model"] = model.strip()
        auth_mode = str(request.get("authMode") or "google-oauth").strip() or "google-oauth"
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
            if not project or not location:
                raise BridgeRequestError(
                    "Google OAuth/ADC auth requires a GCP project and location. "
                    "Set Antigravity provider gcpProject/gcpLocation or GOOGLE_CLOUD_PROJECT "
                    "and GOOGLE_CLOUD_LOCATION, then run `gcloud auth application-default login`.",
                    "oauth_setup_required",
                )
            config_kwargs["vertex"] = True
            config_kwargs["project"] = project
            config_kwargs["location"] = location
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
            raise BridgeRequestError(f"Unsupported Antigravity auth mode: {auth_mode}", "invalid_auth_mode")
        conversation_id = request.get("conversationId")
        if isinstance(conversation_id, str) and conversation_id.strip():
            config_kwargs["conversation_id"] = conversation_id.strip()
        save_dir = request.get("saveDir")
        if isinstance(save_dir, str) and save_dir.strip():
            config_kwargs["save_dir"] = save_dir.strip()
        app_data_dir = request.get("appDataDir")
        if isinstance(app_data_dir, str) and app_data_dir.strip():
            config_kwargs["app_data_dir"] = app_data_dir.strip()

        agent = Agent(LocalAgentConfig(**config_kwargs))
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
        self.require_session(request)
        raise BridgeRequestError(
            "The Antigravity SDK does not expose checkpoint rollback in this build.",
            "rollback_not_supported",
        )

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
            await bridge.handle(request)
    finally:
        await bridge.stop_all()
        _log("stdin closed, exiting")
    return 0


def main() -> int:
    return asyncio.run(async_main())


if __name__ == "__main__":
    raise SystemExit(main())
