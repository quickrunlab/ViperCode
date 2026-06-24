/**
 * Antigravity bridge protocol — framed JSON contract between the Node server
 * and the ViperCode-owned Python bridge that drives the `google-antigravity`
 * SDK.
 *
 * Wire format is newline-delimited JSON (NDJSON): every message is a single
 * `JSON.stringify`-encoded object terminated by `\n`. JSON string encoding
 * escapes embedded newlines, so NDJSON is safe even when SDK payloads contain
 * raw newlines, while staying trivially debuggable in logs.
 *
 * Two message directions:
 *   - Requests (Node → bridge) always carry a correlation `id` and a `type`.
 *   - Events (bridge → Node) carry a `type`; request acknowledgements use the
 *     `response` event and echo the originating request `id`.
 *
 * Payload fields whose exact SDK shape is still unverified (tool-call input,
 * usage metadata, structured user-input answers) are intentionally typed as
 * `Schema.Unknown` so the bridge can forward them losslessly; the adapter
 * (Layer 5) normalizes them into canonical runtime events once the SDK shape
 * is pinned down.
 *
 * @module provider/antigravityBridgeProtocol
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Protocol version negotiated in `initialize`. Bump on breaking changes. */
export const ANTIGRAVITY_BRIDGE_PROTOCOL_VERSION = 1;

// ── Requests (Node → bridge) ─────────────────────────────────────────

const RequestBase = {
  /** Correlation id echoed back in the matching `response` event. */
  id: Schema.String,
};

export const InitializeRequest = Schema.Struct({
  ...RequestBase,
  type: Schema.Literal("initialize"),
  protocolVersion: Schema.optionalKey(Schema.Number),
});

export const ProbeRequest = Schema.Struct({
  ...RequestBase,
  type: Schema.Literal("probe"),
});

export const StartSessionRequest = Schema.Struct({
  ...RequestBase,
  type: Schema.Literal("start_session"),
  sessionId: Schema.String,
  cwd: Schema.String,
  model: Schema.optionalKey(Schema.String),
  conversationId: Schema.optionalKey(Schema.String),
  saveDir: Schema.optionalKey(Schema.String),
  appDataDir: Schema.optionalKey(Schema.String),
  cliPath: Schema.optionalKey(Schema.String),
  authMode: Schema.optionalKey(Schema.String),
  gcpProject: Schema.optionalKey(Schema.String),
  gcpLocation: Schema.optionalKey(Schema.String),
  toolPermission: Schema.optionalKey(Schema.String),
  enableTerminalSandbox: Schema.optionalKey(Schema.Boolean),
  allowNonWorkspaceAccess: Schema.optionalKey(Schema.Boolean),
});

export const SendTurnRequest = Schema.Struct({
  ...RequestBase,
  type: Schema.Literal("send_turn"),
  sessionId: Schema.String,
  turnId: Schema.String,
  text: Schema.String,
  attachments: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

export const InterruptTurnRequest = Schema.Struct({
  ...RequestBase,
  type: Schema.Literal("interrupt_turn"),
  sessionId: Schema.String,
  turnId: Schema.optionalKey(Schema.String),
});

export const RespondToRequestRequest = Schema.Struct({
  ...RequestBase,
  type: Schema.Literal("respond_to_request"),
  sessionId: Schema.String,
  requestId: Schema.String,
  decision: Schema.String,
});

export const RespondToUserInputRequest = Schema.Struct({
  ...RequestBase,
  type: Schema.Literal("respond_to_user_input"),
  sessionId: Schema.String,
  requestId: Schema.String,
  answers: Schema.Unknown,
});

export const ReadThreadRequest = Schema.Struct({
  ...RequestBase,
  type: Schema.Literal("read_thread"),
  sessionId: Schema.String,
});

export const RollbackThreadRequest = Schema.Struct({
  ...RequestBase,
  type: Schema.Literal("rollback_thread"),
  sessionId: Schema.String,
  numTurns: Schema.Number,
});

export const StopSessionRequest = Schema.Struct({
  ...RequestBase,
  type: Schema.Literal("stop_session"),
  sessionId: Schema.String,
});

export const BridgeRequest = Schema.Union([
  InitializeRequest,
  ProbeRequest,
  StartSessionRequest,
  SendTurnRequest,
  InterruptTurnRequest,
  RespondToRequestRequest,
  RespondToUserInputRequest,
  ReadThreadRequest,
  RollbackThreadRequest,
  StopSessionRequest,
]);
export type BridgeRequest = typeof BridgeRequest.Type;

// ── Events (bridge → Node) ───────────────────────────────────────────

export const BridgeErrorInfo = Schema.Struct({
  message: Schema.String,
  code: Schema.optionalKey(Schema.String),
});
export type BridgeErrorInfo = typeof BridgeErrorInfo.Type;

/** Acknowledgement for a request, correlated by the originating `id`. */
export const ResponseEvent = Schema.Struct({
  type: Schema.Literal("response"),
  id: Schema.String,
  ok: Schema.Boolean,
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(BridgeErrorInfo),
});

export const SessionStartedEvent = Schema.Struct({
  type: Schema.Literal("session_started"),
  sessionId: Schema.String,
  conversationId: Schema.optionalKey(Schema.String),
});

export const TurnStartedEvent = Schema.Struct({
  type: Schema.Literal("turn_started"),
  sessionId: Schema.String,
  turnId: Schema.String,
});

export const TextDeltaEvent = Schema.Struct({
  type: Schema.Literal("text_delta"),
  sessionId: Schema.String,
  turnId: Schema.String,
  text: Schema.String,
});

export const ReasoningDeltaEvent = Schema.Struct({
  type: Schema.Literal("reasoning_delta"),
  sessionId: Schema.String,
  turnId: Schema.String,
  text: Schema.String,
});

export const ToolCallStartedEvent = Schema.Struct({
  type: Schema.Literal("tool_call_started"),
  sessionId: Schema.String,
  turnId: Schema.String,
  toolCallId: Schema.String,
  name: Schema.String,
  kind: Schema.optionalKey(Schema.String),
  input: Schema.optionalKey(Schema.Unknown),
});

export const ToolCallDeltaEvent = Schema.Struct({
  type: Schema.Literal("tool_call_delta"),
  sessionId: Schema.String,
  turnId: Schema.String,
  toolCallId: Schema.String,
  delta: Schema.optionalKey(Schema.Unknown),
});

export const ToolCallCompletedEvent = Schema.Struct({
  type: Schema.Literal("tool_call_completed"),
  sessionId: Schema.String,
  turnId: Schema.String,
  toolCallId: Schema.String,
  output: Schema.optionalKey(Schema.Unknown),
  isError: Schema.optionalKey(Schema.Boolean),
});

export const PermissionRequestedEvent = Schema.Struct({
  type: Schema.Literal("permission_requested"),
  sessionId: Schema.String,
  turnId: Schema.optionalKey(Schema.String),
  requestId: Schema.String,
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  options: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  toolCall: Schema.optionalKey(Schema.Unknown),
});

export const PermissionResolvedEvent = Schema.Struct({
  type: Schema.Literal("permission_resolved"),
  sessionId: Schema.String,
  requestId: Schema.String,
  decision: Schema.String,
});

export const UserInputRequestedEvent = Schema.Struct({
  type: Schema.Literal("user_input_requested"),
  sessionId: Schema.String,
  turnId: Schema.optionalKey(Schema.String),
  requestId: Schema.String,
  prompt: Schema.optionalKey(Schema.String),
  fields: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

export const UserInputResolvedEvent = Schema.Struct({
  type: Schema.Literal("user_input_resolved"),
  sessionId: Schema.String,
  requestId: Schema.String,
  answers: Schema.optionalKey(Schema.Unknown),
});

export const UsageUpdatedEvent = Schema.Struct({
  type: Schema.Literal("usage_updated"),
  sessionId: Schema.String,
  usage: Schema.Unknown,
});

export const ConversationIdChangedEvent = Schema.Struct({
  type: Schema.Literal("conversation_id_changed"),
  sessionId: Schema.String,
  conversationId: Schema.String,
});

export const TurnCompletedEvent = Schema.Struct({
  type: Schema.Literal("turn_completed"),
  sessionId: Schema.String,
  turnId: Schema.String,
  stopReason: Schema.optionalKey(Schema.String),
});

export const RuntimeErrorEvent = Schema.Struct({
  type: Schema.Literal("runtime_error"),
  sessionId: Schema.optionalKey(Schema.String),
  message: Schema.String,
  code: Schema.optionalKey(Schema.String),
});

export const SessionExitedEvent = Schema.Struct({
  type: Schema.Literal("session_exited"),
  sessionId: Schema.String,
  code: Schema.optionalKey(Schema.Number),
});

export const BridgeEvent = Schema.Union([
  ResponseEvent,
  SessionStartedEvent,
  TurnStartedEvent,
  TextDeltaEvent,
  ReasoningDeltaEvent,
  ToolCallStartedEvent,
  ToolCallDeltaEvent,
  ToolCallCompletedEvent,
  PermissionRequestedEvent,
  PermissionResolvedEvent,
  UserInputRequestedEvent,
  UserInputResolvedEvent,
  UsageUpdatedEvent,
  ConversationIdChangedEvent,
  TurnCompletedEvent,
  RuntimeErrorEvent,
  SessionExitedEvent,
]);
export type BridgeEvent = typeof BridgeEvent.Type;

// ── Framing ──────────────────────────────────────────────────────────

export type BridgeEventParseResult =
  | { readonly ok: true; readonly event: BridgeEvent }
  | { readonly ok: false; readonly reason: string };

// Schema-backed JSON codecs (compiled once at module scope). `fromJsonString`
// folds JSON parse/stringify into the schema so we never touch `JSON.*`.
const encodeBridgeRequestJson = Schema.encodeSync(Schema.fromJsonString(BridgeRequest));
const decodeBridgeEventJson = Schema.decodeUnknownOption(Schema.fromJsonString(BridgeEvent));

/** Encode a request as a single NDJSON line (including the trailing `\n`). */
export function encodeBridgeRequestLine(request: BridgeRequest): string {
  return `${encodeBridgeRequestJson(request)}\n`;
}

/**
 * Parse one NDJSON line into a {@link BridgeEvent}. Returns a discriminated
 * result rather than throwing: blank lines, malformed JSON, and schema-invalid
 * payloads all surface as `{ ok: false }` so the supervisor can log-and-skip a
 * single bad line without tearing down the stream. Bridge `stdout` may
 * interleave non-protocol noise; resilient parsing keeps one stray `print()`
 * from killing a session.
 */
export function parseBridgeEventLine(line: string): BridgeEventParseResult {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty line" };
  }
  const decoded = decodeBridgeEventJson(trimmed);
  return Option.isSome(decoded)
    ? { ok: true, event: decoded.value }
    : { ok: false, reason: "malformed or schema-invalid bridge event line" };
}

// ── Redaction ────────────────────────────────────────────────────────

const REDACTED = "[redacted]";

// Credential-bearing terms matched against the normalized key. Deliberately
// excludes `sessionId` (an opaque correlation handle, not a secret) and usage
// token *counts* like `inputTokens`/`outputTokens` — those end in the plural
// "tokens" and are preserved for debugging.
const SENSITIVE_KEY_FRAGMENT =
  /(secret|password|passwd|credential|apikey|accesskey|privatekey|clientsecret|authorization|authcode|authurl|cookie|refresh)/;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_\s-]/g, "");
  if (normalized === "email") {
    return true;
  }
  // Singular `token` suffix (token, accessToken, authToken) is a credential;
  // plural `tokens` (usage counts) is not.
  if (normalized.endsWith("token")) {
    return true;
  }
  return SENSITIVE_KEY_FRAGMENT.test(normalized);
}

/**
 * Deep-redact sensitive values before a bridge payload reaches debug logs.
 * Matches on key name (email, tokens, auth URLs/codes, secrets, …) and
 * replaces the value with `[redacted]`. Used for the `raw` payload preserved
 * on runtime events so no auth material leaks into unredacted logs.
 */
export function redactBridgePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactBridgePayload);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactBridgePayload(nested);
    }
    return out;
  }
  return value;
}
