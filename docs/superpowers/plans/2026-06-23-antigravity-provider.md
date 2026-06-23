# Antigravity Provider Implementation Plan

Date: 2026-06-23
Status: Implemented with SDK-auth and rollback limitations
Scope: Add Google Antigravity as a first-party ViperCode provider, comparable to Codex, Claude, GitHub Copilot, and OpenCode.

## Implementation Update

The first-party driver, settings, provider status, Python bridge supervisor, real
SDK bridge, and Node adapter are now implemented. The live bridge supports
session start, turn send, text/reasoning deltas, tool lifecycle events,
ViperCode-mediated approvals, ViperCode-mediated user-input prompts, usage
events, image/document attachment conversion, conversation-ID resume cursors,
interrupt, stop, read-thread snapshots, bridge crash cleanup, and Python
interpreter fallback to an SDK-capable Python 3.12 install.

Local SDK probing answered the main open questions:

- `Agent(LocalAgentConfig())` constructs, but `Agent.__aenter__` currently
  requires SDK model credentials. On this machine, CLI sign-in alone does not
  satisfy the Python SDK. ViperCode now uses OAuth/ADC first via
  `LocalAgentConfig(vertex=True, project=..., location=...)`; `GEMINI_API_KEY`
  is only an explicit fallback.
- `conversation_id` is not reliable before the first exchange; ViperCode stores
  it when the SDK reports it after a turn.
- Streaming exposes `Text`, `Thought`, and `ToolCall` chunks; tool result
  details are available through SDK hooks.
- Cancellation goes through `ChatResponse.cancel()` / conversation cancel and
  is exposed as turn cancellation in ViperCode.
- The installed SDK build does not expose checkpoint rollback, so
  `rollbackThread` returns a typed unsupported error.

## Goal

Implement Google Antigravity in ViperCode as a provider that can start sessions, send turns, stream events, handle approvals, resume or continue threads where possible, expose status, auth, and model information in Settings, and participate in the existing provider-instance system.

The preferred runtime path is SDK-first, using the Google Antigravity Python SDK through a small local bridge process. The CLI remains important for install and auth detection, user-facing setup, one-shot fallback, and possibly a future direct CLI provider if Google exposes a stable machine-readable protocol.

## Research Summary

Primary sources:

- [Google Antigravity download](https://antigravity.google/download#antigravity-cli)
- [Antigravity CLI overview](https://antigravity.google/docs/cli-overview)
- [Antigravity CLI getting started](https://antigravity.google/docs/cli-getting-started)
- [Antigravity CLI installation and auth](https://antigravity.google/docs/cli-install)
- [Antigravity CLI usage](https://antigravity.google/docs/cli-using)
- [Antigravity CLI conversations](https://antigravity.google/docs/cli-conversations)
- [Antigravity CLI reference](https://antigravity.google/docs/cli-reference)
- [Antigravity SDK overview](https://antigravity.google/docs/sdk-overview)
- [google-antigravity/antigravity-sdk-python](https://github.com/google-antigravity/antigravity-sdk-python)
- [Google Antigravity SDK launch blog](https://antigravity.google/blog/introducing-google-antigravity-sdk)

Findings:

- The CLI binary is `agy`. The official installer puts it at `~/.local/bin/agy` on macOS/Linux and under `C:\Users\<Username>\AppData\Local\agy\bin` on Windows.
- The fast install commands are:
  - macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`
  - Windows PowerShell: `irm https://antigravity.google/cli/install.ps1 | iex`
  - Windows CMD: `curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd`
- CLI auth uses the OS keyring for local silent sign-in and a URL/code loop when running over SSH.
- CLI settings live under `~/.gemini/antigravity-cli/settings.json`; key settings include `toolPermission`, `artifactReviewPolicy`, `allowNonWorkspaceAccess`, `enableTerminalSandbox`, `verbosity`, `editor`, and telemetry controls.
- CLI conversations are scoped to the current working directory. `agy --continue` resumes the latest workspace session, and `agy --conversation <uuid>` resumes a specific conversation.
- CLI supports one-shot non-interactive prompts with `-p`, but the docs found so far do not establish a full JSON-RPC or ACP-style streaming protocol for embedding inside ViperCode.
- The CLI status line can call a custom script with JSON metadata containing `conversation_id`, model, version, email, token usage, agent state, sandbox state, subagents, artifacts, and pending confirmations. This may help probing or diagnostics, but it is not enough for a full provider adapter by itself.
- The Python SDK package is `google-antigravity`. It includes a compiled platform-specific runtime binary in the PyPI wheels, so cloning the GitHub repo alone is not sufficient.
- The SDK exposes `Agent`, `LocalAgentConfig`, `Conversation`, `ChatResponse`, streaming, custom tools, MCP servers, skills, safety policies, lifecycle hooks, multimodal input, structured output, human-in-the-loop prompts, usage metadata, and session persistence via conversation IDs.
- The SDK defaults to read-only mode in the GitHub README unless capabilities are explicitly enabled. The docs also describe declarative policies and hooks for approve, deny, and transform behavior.
- The SDK is Python today, with TypeScript and Go on the public roadmap. That means a Node/TypeScript app like ViperCode should not wait for a TypeScript SDK before integrating.

## Local Architecture Summary

Relevant ViperCode implementation points:

- `packages/contracts/src/providerInstance.ts`
  - `ProviderDriverKind` and `ProviderInstanceId` are open branded slugs, so adding `antigravity` does not require closing a union.
  - Unknown drivers already round-trip and degrade gracefully.
- `packages/contracts/src/settings.ts`
  - Built-in legacy provider settings still enumerate `codex`, `claudeAgent`, `githubCopilot`, and `opencode`.
  - New provider-specific settings currently need schema and patch entries here.
- `apps/server/src/provider/ProviderDriver.ts`
  - Provider drivers are plain values with metadata, config schema, default config, and `create`.
  - Each instance returns `snapshot`, `adapter`, and `textGeneration` closures.
- `apps/server/src/provider/builtInDrivers.ts`
  - Add first-party drivers to `BUILT_IN_DRIVERS`.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
  - Reference for SDK-backed streaming, tool/result normalization, durable session IDs, user input, and usage mapping.
- `apps/server/src/provider/Drivers/githubCopilot/GitHubCopilotDriver.ts`
  - Reference for auth state, device-flow UI shape, dynamic model probing, and CLI-backed agent process integration.
- `apps/server/src/provider/acp/AcpProviderAdapter.ts`
  - Reference if Antigravity later exposes ACP or a similar JSON-RPC agent protocol.
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
  - Reference for SDK/server-backed event subscription, approval mapping, questions, attachments, rollback, and scoped teardown.
- `apps/web/src/components/settings/providerDriverMeta.ts`
  - Add Antigravity display metadata and settings schema.
- `apps/web/src/components/Icons.tsx`
  - Antigravity icon already exists for the "Open in" editor picker and can be reused for the provider card.
- `packages/contracts/src/editor.ts`
  - Antigravity is already present as an external editor with command `agy`; this is separate from provider runtime support.

## Product Decision

Build Antigravity as a first-party provider driver named `antigravity`.

Use the SDK as the primary runtime because it exposes streaming, hooks, policies, tools, human input, sessions, and structured state in a way ViperCode can normalize into existing runtime events. Use `agy` CLI as:

- installation, auth, and status probe,
- user setup documentation and update command target,
- optional terminal fallback with `-p`,
- a potential future direct adapter if Google ships JSON event output, ACP, or another stable machine-readable protocol.

Do not embed the TUI as the normal chat provider. A TUI would be hard to reconcile with ViperCode's existing event model, approval UI, reconnect behavior, and session persistence.

## Target User Experience

Settings:

- Provider list shows "Antigravity" with the existing Antigravity icon.
- The default Antigravity instance is enabled like Codex, Claude, and OpenCode.
- Provider status reports:
  - CLI detected or not detected,
  - SDK bridge ready or missing,
  - authenticated email if obtainable without unsafe scraping,
  - version information for `agy` and the bridge package,
  - setup instructions when auth is missing.
- Users can add multiple Antigravity instances with separate display names, env vars, and optional config overrides.

Thread composer:

- Antigravity appears as a selectable provider instance.
- Model picker uses probed models when available and falls back to a safe default list.
- Model options include reasoning/thinking level if the SDK exposes stable controls.

Session:

- User sends a prompt.
- ViperCode starts or resumes an Antigravity conversation in the selected workspace.
- Text and reasoning stream into the normal chat transcript.
- Tool calls, file edits, shell commands, web actions, subagents, approvals, and user questions normalize into the existing event surface.
- Interrupt, stop, reconnect, and thread restore behave predictably.

Docs:

- README provider setup lists Antigravity alongside Codex, Claude, Copilot, and OpenCode.
- `docs/providers/antigravity.md` explains CLI install, SDK bridge setup, auth, multiple instances, safety, and troubleshooting.

## Proposed Architecture

### Layer 1: Contracts

Add `AntigravitySettings` to `packages/contracts/src/settings.ts`.

Initial fields:

- `enabled: boolean`
- `binaryPath: string`
  - default: `agy`
  - setting title: "CLI path"
  - description: path to the Antigravity CLI used for install, auth, and version probes.
- `pythonPath: string`
  - default: `python`
  - setting title: "Python path"
  - description: Python executable used to launch the SDK bridge.
- `bridgePath: string`
  - default: empty
  - description: optional override path for the ViperCode Antigravity bridge module/script.
- `homePath: string`
  - default: empty
  - description: optional home/config root for Antigravity/Gemini CLI state when an isolated instance is needed.
- `launchArgs: string`
  - default: empty
  - description: extra bridge or CLI launch args after careful parsing.
- `toolPermission: string`
  - values initially mirrored from Antigravity docs: `request-review`, `proceed-in-sandbox`, `always-proceed`, `strict`.
  - Keep as string if the upstream enum may change; validate known values in UI only.
- `enableTerminalSandbox: boolean`
  - default: true for ViperCode-managed sessions where supported.
- `allowNonWorkspaceAccess: boolean`
  - default: false.
- `customModels: string[]`
  - hidden like the other providers.

Add `AntigravitySettingsPatch`, wire it into `ServerSettings.providers`, `ServerSettingsPatch.providers`, and exports.

Keep provider-instance envelopes opaque, consistent with the current migration path.

### Layer 2: SDK Bridge

Create a small Python bridge owned by ViperCode, likely under:

- `apps/server/src/provider/antigravityBridge/`
- or `apps/server/resources/antigravity-bridge/` if runtime packaging prefers a copied resource.

The bridge should speak a simple framed JSON protocol over stdio:

- request: `initialize`
- request: `start_session`
- request: `send_turn`
- request: `interrupt_turn`
- request: `respond_to_request`
- request: `respond_to_user_input`
- request: `read_thread`
- request: `rollback_thread`
- request: `stop_session`
- event: `session_started`
- event: `turn_started`
- event: `text_delta`
- event: `reasoning_delta`
- event: `tool_call_started`
- event: `tool_call_delta`
- event: `tool_call_completed`
- event: `permission_requested`
- event: `permission_resolved`
- event: `user_input_requested`
- event: `usage_updated`
- event: `conversation_id_changed`
- event: `turn_completed`
- event: `runtime_error`
- event: `session_exited`

Use newline-delimited JSON or length-prefixed JSON. Prefer length-prefixed if SDK payloads can contain arbitrary newlines; otherwise NDJSON is easier to debug and matches local logging patterns.

Bridge responsibilities:

- import `google.antigravity` and fail with a precise missing-package error,
- construct `LocalAgentConfig` or lower-level `Conversation` config,
- pass workspace/cwd,
- load optional conversation ID for resume,
- stream `ChatResponse` text chunks,
- stream advanced thoughts/tool calls where the SDK exposes them,
- attach lifecycle hooks for tool calls, tool results, errors, user interaction, and usage,
- map safety policies to ViperCode approval callbacks,
- persist or return Antigravity conversation IDs,
- shut down all agent resources cleanly on stdin EOF or stop request.

Node responsibilities:

- spawn and supervise the bridge process,
- validate bridge protocol messages with Effect Schema,
- translate bridge events to `ProviderRuntimeEvent`,
- enforce per-session scope teardown,
- persist resume cursors in the existing thread/session bindings.

### Layer 3: Provider Driver

Add:

- `apps/server/src/provider/Drivers/AntigravityDriver.ts`
- `apps/server/src/provider/Layers/AntigravityAdapter.ts`
- `apps/server/src/provider/Layers/AntigravityProvider.ts`
- optional `apps/server/src/provider/antigravityBridgeProtocol.ts`
- optional `apps/server/src/provider/antigravityBridgeProcess.ts`
- optional tests next to each module.

`AntigravityDriver`:

- `driverKind = ProviderDriverKind.make("antigravity")`
- metadata display name: `Antigravity`
- supports multiple instances: true
- config schema: `AntigravitySettings`
- default config: decode empty config
- create:
  - merge per-instance environment variables,
  - compute continuation group key from effective home/config path,
  - build adapter,
  - build optional text generation implementation,
  - build provider snapshot with status checks,
  - return `ProviderInstance`.

Continuation identity:

- If `homePath` is empty and no isolated Antigravity state is configured, default to `antigravity:default`.
- If `homePath` is set, use `antigravity:home:<resolved path>`.
- This mirrors the Claude home model more than the Codex shadow-home model unless research proves Antigravity separates auth and conversation state differently.

### Layer 4: Provider Status

`AntigravityProvider.ts` should probe:

- CLI presence:
  - run `<binaryPath> --version` if supported.
  - if version command is unsupported, run a harmless help/status command and parse defensively.
- CLI install path:
  - check configured `binaryPath`,
  - on Windows optionally check `%LOCALAPPDATA%\agy\bin\agy.exe` for message clarity,
  - on macOS/Linux optionally check `~/.local/bin/agy`.
- SDK package:
  - run `<pythonPath> -c "import google.antigravity; print('ok')"` or use bridge `probe`.
  - report missing package with `pip install google-antigravity`.
- Auth:
  - prefer a documented CLI/SDK auth status command if one exists.
  - otherwise run a bridge probe that creates a read-only local agent and returns a typed auth failure if credentials are missing.
  - do not scrape interactive TUI output unless it is the only available option and tests cover it.
- Models:
  - prefer SDK-provided model list if exposed.
  - else use defaults from docs/SDK examples and allow custom models.
- Update:
  - if `agy` has a native upgrade command, add a native maintenance resolver.
  - else provide manual update instructions using the official install scripts.
  - for SDK, report `pip install --upgrade google-antigravity` as a manual package update path.

Snapshot behavior:

- `installed=false` if neither usable CLI nor SDK bridge is available.
- `auth.status="unauthenticated"` if runtime reports missing sign-in.
- `status="warning"` if CLI is installed but SDK bridge is unavailable, because one-shot fallback may still work.
- Include exact setup command in `message` when useful, keeping secrets out.

### Layer 5: Adapter Event Mapping

Normalize bridge/SDK events into the canonical provider runtime event model.

Text:

- SDK response chunks become `content.delta` with `assistant_text`.
- SDK thinking chunks become `content.delta` with `reasoning_text` if available.

Tools:

- file read becomes `file_read` or a dynamic tool call event depending on existing contracts.
- file edit/write becomes `file_change`.
- shell becomes `command_execution`.
- MCP becomes `mcp_tool_call`.
- subagent becomes `collab_agent_tool_call`.
- unknown becomes `dynamic_tool_call` with raw payload preserved.

Approvals:

- SDK policy/hook asks become `request.opened`.
- ViperCode approval decision becomes bridge response.
- Bridge policy continuation becomes `request.resolved`.

Human input:

- SDK structured question becomes ViperCode `user_input_request`.
- Answers become bridge response.

Usage:

- SDK usage metadata becomes token/context-window snapshot, matching the Claude/OpenCode projection conventions.

Lifecycle:

- bridge session start becomes `session.started` and `thread.started`.
- turn start becomes `turn.started`.
- turn completion becomes `turn.completed`.
- bridge fatal error becomes `runtime.error` and `session.exited`.

Raw payloads:

- Preserve raw bridge events in `raw` for debug logs, but redact email, tokens, local auth paths, and secrets.

### Layer 6: Session Persistence And Resume

Investigate SDK `conversation_id` behavior during proof-of-concept.

Desired model:

- On `startSession`, read ViperCode resume cursor for the selected thread.
- If cursor contains Antigravity conversation ID, pass it to SDK config.
- If no cursor, create a new SDK conversation.
- When SDK reports a conversation ID, persist it through existing runtime/session binding metadata.

CLI compatibility:

- CLI scopes history to cwd and supports `--continue` and `--conversation <uuid>`.
- If SDK conversation IDs match CLI conversation IDs, document cross-surface continuation.
- If they do not match, keep CLI and SDK sessions separate and avoid promising cross-surface resume.

Rollback:

- If SDK exposes checkpoint/rewind APIs, implement `rollbackThread`.
- Else return the available thread snapshot and surface rollback as unsupported for Antigravity in a clear typed way.
- Do not shell out to `/rewind` in the TUI for provider rollback.

### Layer 7: Attachments And Multimodal Input

Map ViperCode attachments to SDK multimodal input:

- image files become SDK image/file content type,
- PDFs become SDK document content type if supported,
- audio/video pass through only if SDK accepts them,
- unsupported MIME types become provider validation errors with specific messages.

Keep all attachment paths resolved through the existing attachment store, not arbitrary user-provided paths.

### Layer 8: Safety And Permissions

ViperCode must remain the user-visible approval authority.

Default policy:

- read-only or request-review by default,
- workspace access only,
- terminal sandbox enabled when upstream supports it,
- shell execution and writes require ViperCode approvals unless the user selected a more autonomous mode.

Policy mapping:

- ViperCode runtime mode `default` maps to Antigravity `request-review`.
- ViperCode trusted/autonomous mode, if any, maps to `proceed-in-sandbox` before considering `always-proceed`.
- ViperCode plan mode forces planning or review-heavy behavior if SDK exposes it.

Never silently enable:

- non-workspace access,
- always-proceed,
- unsandboxed shell execution,
- telemetry changes unrelated to provider execution.

### Layer 9: UI Work

Add client metadata:

- import `AntigravityIcon`,
- add `AntigravitySettings`,
- add a provider definition with label `Antigravity`.

Settings card:

- render generic fields from schema annotations.
- show badge `Preview` for the first implementation.
- show copyable install commands:
  - Windows PowerShell,
  - macOS/Linux,
  - SDK bridge package install.
- show auth guidance:
  - launch `agy` in a terminal to complete first-run setup,
  - use remote SSH URL/code flow when applicable.

Provider/model picker:

- include Antigravity instances in the grouped provider list.
- show custom models.
- avoid assuming OpenAI/Gemini model naming in shared helpers.

Icons:

- reuse existing `AntigravityIcon` from `apps/web/src/components/Icons.tsx`.

### Layer 10: Documentation

Add `docs/providers/antigravity.md`:

- install CLI,
- install SDK package,
- authenticate,
- configure ViperCode provider,
- multiple instances,
- sandbox/permissions,
- troubleshooting,
- known limitations.

Update:

- `README.md` provider setup list.
- `docs/README.md` provider links if needed.
- `docs/architecture/providers.md` if it is still stale; it currently says Codex is the only implemented provider, which no longer matches the repo.

### Layer 11: Proof Of Concept Tasks

1. Create a scratch Python script outside production paths that:
   - imports `google.antigravity`,
   - starts `Agent(LocalAgentConfig())`,
   - sends a harmless read-only prompt,
   - streams text chunks,
   - prints conversation/session ID if available.
2. Run the script with no auth and record the exact failure shape.
3. Run after `agy` auth and record the success shape.
4. Confirm whether SDK can:
   - stream thoughts,
   - observe tool calls,
   - intercept approvals,
   - ask user questions,
   - resume by conversation ID,
   - cancel active work,
   - list models.
5. Convert the scratch script into bridge tests/fixtures.

### Layer 12: Implementation Tasks

#### Phase A: Contracts

- Add `AntigravitySettings`.
- Add patch schema.
- Add default provider settings entry.
- Add tests that decode default settings and patch settings.
- Verify unknown provider instances still round-trip.

#### Phase B: Bridge Protocol

- Define Effect schemas for bridge requests/events.
- Add redaction helpers.
- Add bridge process supervisor.
- Add fixture-based parser tests.
- Add timeout and EOF behavior tests.

#### Phase C: Python Bridge

- Add bridge module/script.
- Add minimal dependency/version probe.
- Add start/stop session.
- Add send turn.
- Add streaming text.
- Add structured errors for missing package/auth/runtime failures.
- Add graceful shutdown on stdin close.

#### Phase D: Antigravity Adapter

- Implement `makeAntigravityAdapter`.
- Maintain session map keyed by ViperCode `ThreadId`.
- Start one bridge-owned conversation per session.
- Emit lifecycle and text events.
- Implement interrupt/stop.
- Implement approvals and user input.
- Implement readThread/rollback with best available SDK support.
- Add tests with fake bridge runtime.

#### Phase E: Antigravity Provider Snapshot

- Implement `checkAntigravityProviderStatus`.
- Implement pending snapshot.
- Probe CLI, SDK, auth, version, models.
- Add maintenance/update advisory.
- Add tests for installed/authenticated/unauthenticated/missing SDK states.

#### Phase F: Driver Registration

- Add `AntigravityDriver`.
- Register in `BUILT_IN_DRIVERS`.
- Update `BuiltInDriversEnv`.
- Add provider registry tests for default and custom instances.

#### Phase G: Web UI

- Add Antigravity client definition.
- Reuse icon.
- Add settings rendering tests.
- Add browser test for provider card and install/auth state.
- Add model picker tests.

#### Phase H: Docs

- Add provider doc.
- Update README.
- Update architecture provider doc.

#### Phase I: Hardening

- Add NDJSON native bridge event logs if useful.
- Add bridge crash recovery behavior.
- Add backpressure protection for high-frequency stream chunks.
- Add per-turn timeout/cancel tests.
- Add Windows path tests for CLI install detection.
- Add Linux/macOS path tests.

## Suggested File List

Contracts:

- `packages/contracts/src/settings.ts`
- `packages/contracts/src/settings.test.ts` if present, or nearest settings test file.

Server:

- `apps/server/src/provider/Drivers/AntigravityDriver.ts`
- `apps/server/src/provider/Layers/AntigravityAdapter.ts`
- `apps/server/src/provider/Layers/AntigravityProvider.ts`
- `apps/server/src/provider/antigravityBridgeProtocol.ts`
- `apps/server/src/provider/antigravityBridgeProcess.ts`
- `apps/server/src/provider/builtInDrivers.ts`
- `apps/server/src/provider/ProviderInstanceRegistry.test.ts` or nearest registry tests.
- `apps/server/src/provider/Layers/AntigravityAdapter.test.ts`
- `apps/server/src/provider/Layers/AntigravityProvider.test.ts`

Bridge:

- `apps/server/resources/antigravity-bridge/vipercode_antigravity_bridge.py`
- `apps/server/resources/antigravity-bridge/README.md`
- bridge fixture JSON files under an existing test fixture directory.

Web:

- `apps/web/src/components/settings/providerDriverMeta.ts`
- `apps/web/src/components/settings/ProviderSettingsForm.test.ts`
- `apps/web/src/components/settings/SettingsPanels.browser.tsx`
- `apps/web/src/providerModels.ts`
- model picker tests if Antigravity needs special model handling.

Docs:

- `docs/providers/antigravity.md`
- `README.md`
- `docs/architecture/providers.md`

## Risk Register

1. SDK API instability
   - Mitigation: isolate all SDK usage in the Python bridge; keep Node protocol stable.
2. Python dependency management inside packaged desktop app
   - Mitigation: start with user-managed Python and `pip install google-antigravity`; later evaluate bundled venv or uv-managed tool install.
3. Auth status may not be machine-readable
   - Mitigation: rely on bridge probe and documented CLI auth flows; avoid brittle TUI scraping.
4. CLI and SDK conversation IDs may differ
   - Mitigation: treat cross-surface continuation as optional until proven.
5. Tool/approval events may not expose enough detail
   - Mitigation: use SDK hooks; if insufficient, launch as Preview with explicit limitations.
6. Windows packaging and path issues
   - Mitigation: add dedicated tests for `%LOCALAPPDATA%\agy\bin`, `python.exe`, spaces in paths, and PowerShell install guidance.
7. Long-running bridge leaks
   - Mitigation: session-scoped Effect finalizers, stdin EOF handling, child-process kill fallback, and adapter-level `stopAll`.
8. Duplicate provider-instance state
   - Mitigation: follow existing driver SPI; no singleton Context tags for per-instance state.
9. Safety mismatch between Antigravity and ViperCode approvals
   - Mitigation: ViperCode approval is authoritative; default to strict/request-review and workspace-only.
10. Model naming drift
    - Mitigation: dynamic model probe first, custom models second, conservative default last.

## Acceptance Criteria

Functional:

- Antigravity appears in Settings and provider picker.
- Missing CLI/SDK/auth states are visible and actionable.
- A user can start an Antigravity thread from ViperCode.
- Assistant text streams into the transcript.
- Tool calls and approvals render in the existing event UI.
- User can approve/decline a requested tool action.
- User can interrupt and stop a running turn.
- Sessions clean up bridge processes on stop and server shutdown.
- A resumed ViperCode thread restores Antigravity conversation state when SDK support is available.

Reliability:

- Bridge crash produces a recoverable provider error event, not a server crash.
- Slow or noisy streams do not block the WebSocket event loop.
- Reconnect/restart behavior remains deterministic.
- Provider status refresh is cached and rate-limited like other providers.

Security:

- No tokens, auth URLs, authorization codes, email addresses, or sensitive env vars are written to unredacted logs.
- Default config does not grant non-workspace access.
- Default config does not auto-approve writes/shell/network.

Maintainability:

- Antigravity-specific code is isolated behind a provider driver and bridge protocol.
- Shared logic is extracted only where it reduces duplication with existing provider patterns.
- Tests use fake bridge/runtime fixtures where possible.

## Verification Plan

Run after implementation:

- `vp check`
- `vp run typecheck`
- Provider-focused tests:
  - contracts settings decode/patch tests,
  - bridge protocol schema tests,
  - fake bridge adapter lifecycle tests,
  - provider status tests,
  - provider registry tests,
  - web settings rendering tests.
- If any native mobile code changes are made later, also run `vp run lint:mobile`.

Manual verification:

- Windows:
  - no CLI installed,
  - CLI installed but no SDK,
  - SDK installed but unauthenticated,
  - authenticated and successful prompt,
  - interrupt active turn,
  - stop session and confirm bridge process exits.
- macOS/Linux:
  - install path detection,
  - Python path override,
  - workspace with spaces in path,
  - remote/SSH auth guidance.

## Open Questions

- Does the SDK expose a stable list-models API, or should ViperCode rely on defaults plus custom models? Current implementation uses SDK-observed defaults plus custom models.
- Can SDK cancellation interrupt an already-running local tool call, or only stop future model/tool work? The adapter calls SDK cancellation; exact in-tool granularity still needs a live authenticated turn.
- Are tool-call hooks detailed enough to classify file edits, shell, MCP, web, and subagents without fragile name matching? Current implementation uses SDK names plus hook payloads; live SDK traces should refine classification.
- Can the SDK use the same keyring/session as `agy`, or does it require separate ADC/Google auth in some configurations? Local testing and upstream issue research indicate CLI OAuth token profiles are not exposed to the Python SDK; ViperCode uses the SDK-supported OAuth/ADC path.
- Is there an official `agy --version`, `agy auth status`, or JSON status command not surfaced in the current docs?
- Should ViperCode eventually offer a pure CLI terminal mode using `agy -p` for lightweight one-shot prompts, separate from the full SDK provider?

## Recommended First PR

Keep the first PR small but architecturally real:

1. Add contract schema and UI metadata for Antigravity.
2. Add provider docs and README setup entry.
3. Add provider status probe for CLI plus SDK presence.
4. Register a disabled/preview driver that reports status but returns a clear "runtime not implemented yet" adapter error.
5. Add tests for settings, UI rendering, and status snapshots.

Then ship the SDK bridge and full adapter in the second PR. This de-risks packaging, auth, and status separately from streaming runtime behavior while keeping the public provider shape stable.
