// @effect-diagnostics nodeBuiltinImport:off
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EventId,
  type AntigravitySettings,
  type CanonicalRequestType,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  RuntimeRequestId,
  type RuntimeTurnState,
  ThreadId,
  type ToolLifecycleItemType,
  TurnId,
  type UserInputQuestion,
  type RuntimeMode,
} from "@vipercode/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  AntigravityBridgeError,
  makeAntigravityBridgeProcess,
  type AntigravityBridgeProcessShape,
} from "../antigravityBridgeProcess.ts";
import { type BridgeEvent, redactBridgePayload } from "../antigravityBridgeProtocol.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type {
  ProviderAdapterShape,
  ProviderThreadTurnSnapshot,
} from "../Services/ProviderAdapter.ts";
import { resolveAntigravityPythonProbe } from "./AntigravityProvider.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");

interface AntigravityTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface AntigravitySessionContext {
  session: ProviderSession;
  readonly sessionId: string;
  readonly turns: Array<AntigravityTurnSnapshot>;
  readonly pendingPermissions: Set<string>;
  /** requestId → original request type, so `request.resolved` keeps its type. */
  readonly pendingPermissionTypes: Map<string, CanonicalRequestType>;
  readonly pendingUserInputs: Set<string>;
  activeTurnId: TurnId | undefined;
  closed: boolean;
}

interface AntigravityBridgeContext {
  readonly bridge: AntigravityBridgeProcessShape;
  readonly bridgeScope: Scope.Closeable;
  readonly pythonPath: string;
}

export interface AntigravityAdapterOptions {
  readonly instanceId: ProviderInstanceId;
  readonly environment: NodeJS.ProcessEnv;
}

type EventBaseInput = {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly raw?: unknown;
};

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function unpackedAsarPath(path: string): string | undefined {
  return path.includes(".asar") ? path.replace(/\.asar(?=$|[\\/])/, ".asar.unpacked") : undefined;
}

export function antigravityBridgePathCandidatesFromModuleUrl(
  moduleUrl: string,
): ReadonlyArray<string> {
  // Resolve across both layouts, picking the first that exists on disk:
  //   - packaged build: the server is bundled to apps/server/dist/<chunk>.mjs
  //     and the build copies the bridge to dist/antigravityBridge/ (sibling).
  //     Electron packages that directory under app.asar, so also try the
  //     matching app.asar.unpacked path where Python can execute real files.
  //   - dev/source: this module is apps/server/src/provider/Layers/, so the
  //     bridge is one directory up under provider/antigravityBridge/.
  const candidates = [
    new URL("./antigravityBridge/vipercode_antigravity_bridge.py", moduleUrl),
    new URL("../antigravityBridge/vipercode_antigravity_bridge.py", moduleUrl),
  ].map((url) => fileURLToPath(url));
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const unpacked = unpackedAsarPath(candidate);
    for (const path of unpacked ? [unpacked, candidate] : [candidate]) {
      if (!seen.has(path)) {
        seen.add(path);
        expanded.push(path);
      }
    }
  }
  return expanded;
}

function defaultBridgePath(): string {
  const candidates = antigravityBridgePathCandidatesFromModuleUrl(import.meta.url);
  return (
    candidates.find((candidate) => existsSync(candidate)) ?? candidates[candidates.length - 1]!
  );
}

function bridgePathFor(settings: AntigravitySettings): string {
  const override = settings.bridgePath.trim();
  return override.length > 0 ? override : defaultBridgePath();
}

function bridgeEnvironmentFor(
  settings: AntigravitySettings,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...environment };
  const homePath = settings.homePath.trim();
  if (homePath.length > 0) {
    env.ANTIGRAVITY_HOME = homePath;
  }
  return env;
}

export function antigravityBridgeModelForSelection(
  modelSelection:
    | {
        readonly model?: string;
        readonly options?: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }>;
      }
    | null
    | undefined,
): string | undefined {
  const rawModel = modelSelection?.model?.trim();
  if (!rawModel) {
    return undefined;
  }
  if (rawModel === "gemini-3.1-pro") {
    const thinkingLevel = modelSelection?.options?.find(
      (option) => option.id === "thinkingLevel" && typeof option.value === "string",
    )?.value;
    return thinkingLevel === "high" ? "gemini-3.1-pro-high" : "gemini-3.1-pro-low";
  }
  return rawModel;
}

function toolPermissionForRuntimeMode(runtimeMode: RuntimeMode): string {
  switch (runtimeMode) {
    case "full-access":
      return "always-proceed";
    case "auto-accept-edits":
      return "request-review";
    case "approval-required":
    default:
      return "strict";
  }
}

function conversationIdFromResumeCursor(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const conversationId = record.conversationId ?? record.conversation_id;
    if (typeof conversationId === "string" && conversationId.trim().length > 0) {
      return conversationId.trim();
    }
  }
  return undefined;
}

function conversationIdFromBridgeResult(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const conversationId = record.conversationId ?? record.conversation_id;
    if (typeof conversationId === "string" && conversationId.trim().length > 0) {
      return conversationId.trim();
    }
  }
  return undefined;
}

function resumeCursor(conversationId: string | undefined, turnCount?: number): unknown | undefined {
  if (!conversationId) {
    return undefined;
  }
  return {
    conversationId,
    ...(typeof turnCount === "number" ? { turnCount } : {}),
  };
}

function toToolLifecycleItemType(toolName: string, kind?: string): ToolLifecycleItemType {
  const normalized = `${kind ?? ""} ${toolName}`.toLowerCase();
  if (
    normalized.includes("command") ||
    normalized.includes("shell") ||
    normalized.includes("run")
  ) {
    return "command_execution";
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("create") ||
    normalized.includes("write") ||
    normalized.includes("patch")
  ) {
    return "file_change";
  }
  if (normalized.includes("mcp")) {
    return "mcp_tool_call";
  }
  if (normalized.includes("subagent") || normalized.includes("agent")) {
    return "collab_agent_tool_call";
  }
  if (normalized.includes("web")) {
    return "web_search";
  }
  if (normalized.includes("image")) {
    return "image_view";
  }
  return "dynamic_tool_call";
}

function requestTypeForTool(toolName: string, kind?: string): CanonicalRequestType {
  const normalized = `${kind ?? ""} ${toolName}`.toLowerCase();
  if (
    normalized.includes("view") ||
    normalized.includes("read") ||
    normalized.includes("find") ||
    normalized.includes("list") ||
    normalized.includes("search_directory")
  ) {
    return "file_read_approval";
  }
  const itemType = toToolLifecycleItemType(toolName, kind);
  switch (itemType) {
    case "command_execution":
      return "command_execution_approval";
    case "file_change":
      return "file_change_approval";
    case "dynamic_tool_call":
    case "mcp_tool_call":
    case "collab_agent_tool_call":
    case "web_search":
    case "image_view":
      return "dynamic_tool_call";
    default:
      return "unknown";
  }
}

function turnStateFromStopReason(stopReason: string | undefined): RuntimeTurnState {
  switch (stopReason) {
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "interrupted":
      return "interrupted";
    case "completed":
    default:
      return "completed";
  }
}

function usageNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function tokenUsageFromBridgeUsage(value: unknown) {
  if (!value || typeof value !== "object") {
    return { usedTokens: 0 };
  }
  const record = value as Record<string, unknown>;
  const inputTokens = usageNumber(record, "prompt_token_count");
  const cachedInputTokens = usageNumber(record, "cached_content_token_count");
  const outputTokens = usageNumber(record, "candidates_token_count");
  const reasoningOutputTokens = usageNumber(record, "thoughts_token_count");
  const total =
    usageNumber(record, "total_token_count") ??
    [inputTokens, outputTokens, reasoningOutputTokens].reduce<number>(
      (sum, count) => sum + (count ?? 0),
      0,
    );
  return {
    usedTokens: total,
    totalProcessedTokens: total,
    ...(inputTokens !== undefined ? { inputTokens, lastInputTokens: inputTokens } : {}),
    ...(cachedInputTokens !== undefined
      ? { cachedInputTokens, lastCachedInputTokens: cachedInputTokens }
      : {}),
    ...(outputTokens !== undefined ? { outputTokens, lastOutputTokens: outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined
      ? { reasoningOutputTokens, lastReasoningOutputTokens: reasoningOutputTokens }
      : {}),
    lastUsedTokens: total,
  };
}

function normalizeUserInputQuestions(
  fields: ReadonlyArray<unknown> | undefined,
  prompt: string | undefined,
): ReadonlyArray<UserInputQuestion> {
  if (!fields || fields.length === 0) {
    return [
      {
        id: "q1",
        header: "Question",
        question: prompt && prompt.trim().length > 0 ? prompt : "Input requested",
        options: [],
      },
    ];
  }

  return fields.map((field, index) => {
    const record = field && typeof field === "object" ? (field as Record<string, unknown>) : {};
    const question =
      typeof record.question === "string" && record.question.trim().length > 0
        ? record.question
        : `Question ${index + 1}`;
    const header =
      typeof record.header === "string" && record.header.trim().length > 0
        ? record.header
        : `Question ${index + 1}`;
    const id =
      typeof record.id === "string" && record.id.trim().length > 0 ? record.id : `q${index + 1}`;
    const options = Array.isArray(record.options)
      ? record.options.map((option) => {
          const optionRecord =
            option && typeof option === "object" ? (option as Record<string, unknown>) : {};
          const label =
            typeof optionRecord.label === "string" && optionRecord.label.trim().length > 0
              ? optionRecord.label
              : typeof optionRecord.id === "string" && optionRecord.id.trim().length > 0
                ? optionRecord.id
                : "Option";
          const description =
            typeof optionRecord.description === "string" &&
            optionRecord.description.trim().length > 0
              ? optionRecord.description
              : label;
          return { label, description };
        })
      : [];
    return {
      id,
      header,
      question,
      options,
      ...(record.multiSelect === true ? { multiSelect: true } : {}),
    };
  });
}

function bridgeErrorDetail(error: AntigravityBridgeError): string {
  return error.code ? `${error.message} (${error.code})` : error.message;
}

// The bridge reports auth failures under several codes (`auth_required`,
// `oauth_required`, `oauth_setup_required`, `auth_failed`,
// `cli_oauth_profile_not_found`, `cli_oauth_profile_expired`). All should
// surface as a permission error so the UI prompts the user to fix auth rather
// than treating it as an opaque provider failure.
function isAntigravityAuthErrorCode(code: string | undefined): boolean {
  if (!code) {
    return false;
  }
  return code.includes("auth") || code.includes("oauth") || code.includes("credential");
}

function toRequestError(
  method: string,
  error: AntigravityBridgeError,
): ProviderAdapterRequestError {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: bridgeErrorDetail(error),
    cause: error,
  });
}

function ensureSessionContext(
  sessions: ReadonlyMap<ThreadId, AntigravitySessionContext>,
  threadId: ThreadId,
): AntigravitySessionContext {
  const context = sessions.get(threadId);
  if (!context) {
    throw new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
    });
  }
  if (context.closed) {
    throw new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
    });
  }
  return context;
}

function appendTurnItem(
  context: AntigravitySessionContext,
  turnId: TurnId | undefined,
  item: unknown,
): void {
  if (!turnId) {
    return;
  }
  let snapshot = context.turns.find((turn) => turn.id === turnId);
  if (!snapshot) {
    snapshot = { id: turnId, items: [] };
    context.turns.push(snapshot);
  }
  snapshot.items.push(item);
}

export const makeAntigravityAdapter = (
  settings: AntigravitySettings,
  options: AntigravityAdapterOptions,
): Effect.Effect<
  ProviderAdapterShape<ProviderAdapterError>,
  never,
  Scope.Scope | ServerConfig | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, AntigravitySessionContext>();
    const bridgeRef = yield* Ref.make<AntigravityBridgeContext | undefined>(undefined);
    const boundInstanceId = options.instanceId;

    // Per-instance id counter so two adapter instances never share state.
    let localIdCounter = 0;
    const nextLocalId = (prefix: string): string => {
      localIdCounter += 1;
      return `${prefix}-${localIdCounter.toString(36)}`;
    };

    const buildEventBase = (input: EventBaseInput) =>
      Effect.all({
        createdAt: nowIso,
        eventId: Effect.sync(() => EventId.make(nextLocalId("antigravity-event"))),
      }).pipe(
        Effect.map(({ createdAt, eventId }) => ({
          eventId,
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          createdAt,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
          ...(input.requestId ? { requestId: RuntimeRequestId.make(input.requestId) } : {}),
          ...(input.raw !== undefined
            ? {
                raw: {
                  source: "antigravity.bridge.event" as const,
                  payload: redactBridgePayload(input.raw),
                },
              }
            : {}),
        })),
      );

    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);

    const updateProviderSession = Effect.fn("updateAntigravityProviderSession")(function* (
      context: AntigravitySessionContext,
      patch: Partial<ProviderSession>,
      options?: {
        readonly clearActiveTurnId?: boolean;
        readonly clearLastError?: boolean;
      },
    ) {
      const updatedAt = yield* nowIso;
      const nextSession = {
        ...context.session,
        ...patch,
        updatedAt,
      } as ProviderSession & Record<string, unknown>;
      const mutableSession = nextSession as Record<string, unknown>;
      if (options?.clearActiveTurnId) {
        delete mutableSession.activeTurnId;
      }
      if (options?.clearLastError) {
        delete mutableSession.lastError;
      }
      context.session = nextSession;
      return nextSession;
    });

    const emitBridgeExit = Effect.fn("emitAntigravityBridgeExit")(function* (code: number) {
      const contexts = [...sessions.values()];
      sessions.clear();
      yield* Ref.set(bridgeRef, undefined);
      yield* Effect.forEach(
        contexts,
        (context) =>
          Effect.gen(function* () {
            if (context.closed) {
              return;
            }
            context.closed = true;
            yield* updateProviderSession(
              context,
              {
                status: "closed",
                lastError: `Antigravity bridge exited (${code}).`,
              },
              { clearActiveTurnId: true },
            );
            yield* emit({
              ...(yield* buildEventBase({
                threadId: context.session.threadId,
                turnId: context.activeTurnId,
              })),
              type: "runtime.error",
              payload: {
                message: `Antigravity bridge exited (${code}).`,
                class: "transport_error",
              },
            });
            yield* emit({
              ...(yield* buildEventBase({
                threadId: context.session.threadId,
                turnId: context.activeTurnId,
              })),
              type: "session.exited",
              payload: {
                reason: `Antigravity bridge exited (${code}).`,
                recoverable: true,
                exitKind: "error",
              },
            });
          }),
        { discard: true },
      );
    });

    const handleBridgeEvent = Effect.fn("handleAntigravityBridgeEvent")(function* (
      event: BridgeEvent,
    ) {
      if (event.type === "response") {
        return;
      }

      const eventSessionId = "sessionId" in event ? event.sessionId : undefined;
      if (!eventSessionId) {
        return;
      }
      const threadId = ThreadId.make(eventSessionId);
      const context = sessions.get(threadId);
      if (!context) {
        return;
      }
      const eventTurnId =
        "turnId" in event && typeof event.turnId === "string" && event.turnId.length > 0
          ? TurnId.make(event.turnId)
          : context.activeTurnId;

      switch (event.type) {
        case "session_started":
          break;

        case "turn_started": {
          const turnId = TurnId.make(event.turnId);
          context.activeTurnId = turnId;
          yield* updateProviderSession(
            context,
            {
              status: "running",
              activeTurnId: turnId,
            },
            { clearLastError: true },
          );
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, raw: event })),
            type: "turn.started",
            payload: context.session.model ? { model: context.session.model } : {},
          });
          break;
        }

        case "text_delta":
          yield* emit({
            ...(yield* buildEventBase({
              threadId,
              turnId: eventTurnId,
              itemId: `assistant-${event.turnId}`,
              raw: event,
            })),
            type: "content.delta",
            payload: {
              streamKind: "assistant_text",
              delta: event.text,
            },
          });
          break;

        case "reasoning_delta":
          yield* emit({
            ...(yield* buildEventBase({
              threadId,
              turnId: eventTurnId,
              itemId: `reasoning-${event.turnId}`,
              raw: event,
            })),
            type: "content.delta",
            payload: {
              streamKind: "reasoning_text",
              delta: event.text,
            },
          });
          break;

        case "tool_call_started": {
          const itemType = toToolLifecycleItemType(event.name, event.kind);
          appendTurnItem(context, eventTurnId, event.input ?? { name: event.name });
          yield* emit({
            ...(yield* buildEventBase({
              threadId,
              turnId: eventTurnId,
              itemId: event.toolCallId,
              raw: event,
            })),
            type: "item.started",
            payload: {
              itemType,
              status: "inProgress",
              title: event.name,
              data: {
                name: event.name,
                kind: event.kind,
                input: event.input,
              },
            },
          });
          break;
        }

        case "tool_call_delta":
          yield* emit({
            ...(yield* buildEventBase({
              threadId,
              turnId: eventTurnId,
              itemId: event.toolCallId,
              raw: event,
            })),
            type: "item.updated",
            payload: {
              itemType: "dynamic_tool_call",
              status: "inProgress",
              data: event.delta,
            },
          });
          break;

        case "tool_call_completed":
          appendTurnItem(context, eventTurnId, event.output);
          yield* emit({
            ...(yield* buildEventBase({
              threadId,
              turnId: eventTurnId,
              itemId: event.toolCallId,
              raw: event,
            })),
            type: "item.completed",
            payload: {
              itemType: "dynamic_tool_call",
              status: event.isError ? "failed" : "completed",
              data: event.output,
            },
          });
          break;

        case "permission_requested": {
          context.pendingPermissions.add(event.requestId);
          const title = event.title ?? "Tool request";
          const requestType = requestTypeForTool(title);
          context.pendingPermissionTypes.set(event.requestId, requestType);
          yield* updateProviderSession(context, { status: "running" });
          yield* emit({
            ...(yield* buildEventBase({
              threadId,
              turnId: eventTurnId,
              requestId: event.requestId,
              raw: event,
            })),
            type: "request.opened",
            payload: {
              requestType,
              detail: event.detail ?? title,
              args: event.toolCall ?? event.options,
            },
          });
          break;
        }

        case "permission_resolved": {
          context.pendingPermissions.delete(event.requestId);
          const requestType = context.pendingPermissionTypes.get(event.requestId) ?? "unknown";
          context.pendingPermissionTypes.delete(event.requestId);
          yield* emit({
            ...(yield* buildEventBase({
              threadId,
              requestId: event.requestId,
              raw: event,
            })),
            type: "request.resolved",
            payload: {
              requestType,
              decision: event.decision,
            },
          });
          break;
        }

        case "user_input_requested":
          context.pendingUserInputs.add(event.requestId);
          yield* updateProviderSession(context, { status: "running" });
          yield* emit({
            ...(yield* buildEventBase({
              threadId,
              turnId: eventTurnId,
              requestId: event.requestId,
              raw: event,
            })),
            type: "user-input.requested",
            payload: {
              questions: normalizeUserInputQuestions(event.fields, event.prompt),
            },
          });
          break;

        case "user_input_resolved":
          context.pendingUserInputs.delete(event.requestId);
          yield* emit({
            ...(yield* buildEventBase({
              threadId,
              requestId: event.requestId,
              raw: event,
            })),
            type: "user-input.resolved",
            payload: {
              answers:
                event.answers && typeof event.answers === "object"
                  ? (event.answers as Record<string, unknown>)
                  : {},
            },
          });
          break;

        case "usage_updated":
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId: eventTurnId, raw: event })),
            type: "thread.token-usage.updated",
            payload: {
              usage: tokenUsageFromBridgeUsage(event.usage),
            },
          });
          break;

        case "conversation_id_changed":
          // Route through updateProviderSession so the durable id (often learned
          // mid-first-turn, after sendTurn already returned) lands on the live
          // session the runtime persists, with a consistent updatedAt.
          yield* updateProviderSession(context, {
            resumeCursor: resumeCursor(event.conversationId, context.turns.length),
          });
          break;

        case "turn_completed": {
          const turnId = TurnId.make(event.turnId);
          const state = turnStateFromStopReason(event.stopReason);
          context.activeTurnId = undefined;
          yield* updateProviderSession(
            context,
            {
              status: state === "failed" ? "error" : "ready",
            },
            { clearActiveTurnId: true },
          );
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId, raw: event })),
            type: "turn.completed",
            payload: {
              state,
              stopReason: event.stopReason ?? null,
            },
          });
          break;
        }

        case "runtime_error":
          yield* updateProviderSession(
            context,
            {
              status: "error",
              lastError: event.message,
            },
            { clearActiveTurnId: true },
          );
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId: eventTurnId, raw: event })),
            type: "runtime.error",
            payload: {
              message: event.message,
              class: isAntigravityAuthErrorCode(event.code) ? "permission_error" : "provider_error",
              ...(event.code ? { detail: { code: event.code } } : {}),
            },
          });
          break;

        case "session_exited":
          context.closed = true;
          sessions.delete(threadId);
          yield* updateProviderSession(
            context,
            {
              status: "closed",
            },
            { clearActiveTurnId: true },
          );
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId: eventTurnId, raw: event })),
            type: "session.exited",
            payload: {
              reason: "Antigravity session exited.",
              recoverable: false,
              exitKind: "graceful",
            },
          });
          break;
      }
    });

    const stopBridge = Effect.fn("stopAntigravityBridge")(function* () {
      const bridge = yield* Ref.getAndSet(bridgeRef, undefined);
      if (!bridge) {
        return;
      }
      yield* Scope.close(bridge.bridgeScope, Exit.void).pipe(Effect.ignoreCause);
    });

    const getBridge = Effect.fn("getAntigravityBridge")(function* (threadId?: ThreadId) {
      const existing = yield* Ref.get(bridgeRef);
      if (existing) {
        return existing;
      }

      const bridgeScope = yield* Scope.make();
      const started = yield* Effect.exit(
        Effect.gen(function* () {
          const sdk = yield* resolveAntigravityPythonProbe(settings, options.environment);
          const bridge = yield* makeAntigravityBridgeProcess({
            pythonPath: sdk.pythonPath,
            bridgePath: bridgePathFor(settings),
            cwd: serverConfig.cwd,
            env: bridgeEnvironmentFor(settings, options.environment),
          });
          yield* bridge.request({ type: "initialize", protocolVersion: 1 });
          const context: AntigravityBridgeContext = {
            bridge,
            bridgeScope,
            pythonPath: sdk.pythonPath,
          };
          yield* bridge.events.pipe(
            Stream.runForEach((event) => handleBridgeEvent(event).pipe(Effect.ignore)),
            Effect.forkIn(bridgeScope),
          );
          yield* bridge.exitCode.pipe(
            Effect.flatMap((code) => emitBridgeExit(code)),
            Effect.forkIn(bridgeScope),
          );
          return context;
        }).pipe(
          Effect.provideService(Scope.Scope, bridgeScope),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, processSpawner),
        ),
      );

      if (Exit.isFailure(started)) {
        yield* Scope.close(bridgeScope, Exit.void).pipe(Effect.ignoreCause);
        return yield* new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: threadId ?? ThreadId.make("antigravity"),
          detail: "Failed to start Antigravity bridge.",
          cause: started.cause,
        });
      }

      const raceWinner = yield* Ref.get(bridgeRef);
      if (raceWinner) {
        yield* Scope.close(started.value.bridgeScope, Exit.void).pipe(Effect.ignoreCause);
        return raceWinner;
      }
      yield* Ref.set(bridgeRef, started.value);
      return started.value;
    });

    const requestBridge = <T>(
      method: string,
      threadId: ThreadId,
      build: (bridge: AntigravityBridgeProcessShape) => Effect.Effect<T, AntigravityBridgeError>,
    ): Effect.Effect<T, ProviderAdapterError> =>
      getBridge(threadId).pipe(
        Effect.flatMap((context) =>
          build(context.bridge).pipe(Effect.mapError((e) => toRequestError(method, e))),
        ),
      );

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = Effect.fn(
      "startAntigravitySession",
    )(function* (input) {
      const existing = sessions.get(input.threadId);
      if (existing) {
        yield* stopSession(input.threadId).pipe(Effect.ignore);
      }

      const directory = input.cwd ?? serverConfig.cwd;
      const model = input.modelSelection?.model;
      const bridgeModel = antigravityBridgeModelForSelection(input.modelSelection);
      const incomingConversationId = conversationIdFromResumeCursor(input.resumeCursor);
      const saveDir = join(serverConfig.stateDir, "antigravity", String(boundInstanceId));
      // Ensure the SDK's persistence directory exists before it tries to write.
      yield* Effect.sync(() => mkdirSync(saveDir, { recursive: true })).pipe(Effect.ignore);
      const appDataDir = settings.homePath.trim();
      const result = yield* requestBridge("start_session", input.threadId, (bridge) =>
        bridge.request({
          type: "start_session",
          sessionId: input.threadId,
          cwd: directory,
          ...(bridgeModel ? { model: bridgeModel } : {}),
          ...(incomingConversationId ? { conversationId: incomingConversationId } : {}),
          saveDir,
          ...(appDataDir.length > 0 ? { appDataDir } : {}),
          cliPath: settings.binaryPath,
          authMode: settings.authMode,
          ...(settings.gcpProject.trim().length > 0
            ? { gcpProject: settings.gcpProject.trim() }
            : {}),
          ...(settings.gcpLocation.trim().length > 0
            ? { gcpLocation: settings.gcpLocation.trim() }
            : {}),
          toolPermission: toolPermissionForRuntimeMode(input.runtimeMode),
          enableTerminalSandbox: settings.enableTerminalSandbox,
          allowNonWorkspaceAccess:
            settings.allowNonWorkspaceAccess || input.runtimeMode === "full-access",
        }),
      );

      const createdAt = yield* nowIso;
      const conversationId = conversationIdFromBridgeResult(result) ?? incomingConversationId;
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd: directory,
        ...(model ? { model } : {}),
        threadId: input.threadId,
        ...(conversationId ? { resumeCursor: resumeCursor(conversationId, 0) } : {}),
        createdAt,
        updatedAt: createdAt,
      };
      const context: AntigravitySessionContext = {
        session,
        sessionId: input.threadId,
        turns: [],
        pendingPermissions: new Set(),
        pendingPermissionTypes: new Map(),
        pendingUserInputs: new Set(),
        activeTurnId: undefined,
        closed: false,
      };
      sessions.set(input.threadId, context);

      yield* emit({
        ...(yield* buildEventBase({ threadId: input.threadId })),
        type: "session.started",
        payload: {
          message: "Antigravity session started",
          ...(conversationId ? { resume: resumeCursor(conversationId, 0) } : {}),
        },
      });
      yield* emit({
        ...(yield* buildEventBase({ threadId: input.threadId })),
        type: "thread.started",
        payload: conversationId ? { providerThreadId: conversationId } : {},
      });

      return session;
    });

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = Effect.fn(
      "sendAntigravityTurn",
    )(function* (input) {
      const context = ensureSessionContext(sessions, input.threadId);
      if (context.activeTurnId !== undefined) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Antigravity does not support concurrent turns in one session.",
        });
      }

      const text = input.input?.trim() ?? "";
      const attachments = input.attachments ?? [];
      if (text.length === 0 && attachments.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Antigravity turns require text input or at least one attachment.",
        });
      }

      const resolvedAttachments = yield* Effect.forEach(
        attachments,
        (attachment) =>
          Effect.gen(function* () {
            const path = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment,
            });
            if (!path || !existsSync(path)) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "sendTurn",
                issue: `Attachment '${attachment.name}' is no longer available.`,
              });
            }
            return {
              type: attachment.type,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              path,
            };
          }),
        { concurrency: "unbounded" },
      );

      const turnId = TurnId.make(nextLocalId("antigravity-turn"));
      context.activeTurnId = turnId;
      yield* updateProviderSession(
        context,
        {
          status: "running",
          activeTurnId: turnId,
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        },
        { clearLastError: true },
      );

      yield* requestBridge("send_turn", input.threadId, (bridge) =>
        bridge.request({
          type: "send_turn",
          sessionId: context.sessionId,
          turnId,
          text,
          attachments: resolvedAttachments,
        }),
      ).pipe(
        Effect.tapError((error) =>
          Effect.gen(function* () {
            context.activeTurnId = undefined;
            yield* updateProviderSession(
              context,
              {
                status: "ready",
                lastError: error.message,
              },
              { clearActiveTurnId: true },
            );
            yield* emit({
              ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
              type: "turn.aborted",
              payload: { reason: error.message },
            });
          }),
        ),
      );

      return {
        threadId: input.threadId,
        turnId,
        ...(context.session.resumeCursor ? { resumeCursor: context.session.resumeCursor } : {}),
      };
    });

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = Effect.fn(
      "interruptAntigravityTurn",
    )(function* (threadId, turnId) {
      const context = ensureSessionContext(sessions, threadId);
      yield* requestBridge("interrupt_turn", threadId, (bridge) =>
        bridge.request({
          type: "interrupt_turn",
          sessionId: context.sessionId,
          ...(turnId ? { turnId } : {}),
        }),
      );
      // The bridge cancels the in-flight turn and emits `turn_completed`
      // (stopReason "cancelled"), which becomes the single terminal `turn.completed`.
      // Emitting `turn.aborted` here too would double-terminate the turn.
    });

    const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] =
      Effect.fn("respondToAntigravityRequest")(function* (threadId, requestId, decision) {
        const context = ensureSessionContext(sessions, threadId);
        if (!context.pendingPermissions.has(requestId)) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respond_to_request",
            detail: `Unknown pending permission request: ${requestId}`,
          });
        }
        yield* requestBridge("respond_to_request", threadId, (bridge) =>
          bridge.request({
            type: "respond_to_request",
            sessionId: context.sessionId,
            requestId,
            decision,
          }),
        );
      });

    const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] =
      Effect.fn("respondToAntigravityUserInput")(function* (threadId, requestId, answers) {
        const context = ensureSessionContext(sessions, threadId);
        if (!context.pendingUserInputs.has(requestId)) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respond_to_user_input",
            detail: `Unknown pending user-input request: ${requestId}`,
          });
        }
        yield* requestBridge("respond_to_user_input", threadId, (bridge) =>
          bridge.request({
            type: "respond_to_user_input",
            sessionId: context.sessionId,
            requestId,
            answers,
          }),
        );
      });

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = Effect.fn(
      "stopAntigravitySession",
    )(function* (threadId) {
      const context = ensureSessionContext(sessions, threadId);
      context.closed = true;
      yield* requestBridge("stop_session", threadId, (bridge) =>
        bridge.request({
          type: "stop_session",
          sessionId: context.sessionId,
        }),
      ).pipe(Effect.ignore);
      sessions.delete(threadId);
      yield* updateProviderSession(
        context,
        {
          status: "closed",
        },
        { clearActiveTurnId: true },
      );
    });

    const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
      Effect.sync(() => [...sessions.values()].map((context) => context.session));

    const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
      Effect.sync(() => sessions.has(threadId));

    const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = Effect.fn(
      "readAntigravityThread",
    )(function* (threadId) {
      const context = ensureSessionContext(sessions, threadId);
      const result = yield* requestBridge("read_thread", threadId, (bridge) =>
        bridge.request({
          type: "read_thread",
          sessionId: context.sessionId,
        }),
      );
      if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        const conversationId = conversationIdFromBridgeResult(record);
        if (conversationId) {
          context.session = {
            ...context.session,
            resumeCursor: resumeCursor(
              conversationId,
              typeof record.turnCount === "number" ? record.turnCount : context.turns.length,
            ),
          };
        }
      }
      return {
        threadId,
        turns: context.turns satisfies ReadonlyArray<ProviderThreadTurnSnapshot>,
      };
    });

    const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = Effect.fn(
      "rollbackAntigravityThread",
    )(function* (threadId, numTurns) {
      const context = ensureSessionContext(sessions, threadId);
      const result = yield* requestBridge("rollback_thread", threadId, (bridge) =>
        bridge.request({
          type: "rollback_thread",
          sessionId: context.sessionId,
          numTurns,
        }),
      );
      if (numTurns >= context.turns.length) {
        context.turns.splice(0, context.turns.length);
      } else {
        context.turns.splice(context.turns.length - numTurns, numTurns);
      }
      if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        const conversationId = conversationIdFromBridgeResult(record);
        const turnCount =
          typeof record.turnCount === "number" ? record.turnCount : context.turns.length;
        if (conversationId) {
          context.session = {
            ...context.session,
            resumeCursor: resumeCursor(conversationId, turnCount),
          };
        }
      }
      return yield* readThread(threadId);
    });

    const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
      Effect.gen(function* () {
        const contexts = [...sessions.values()];
        const bridge = yield* Ref.get(bridgeRef);
        if (bridge) {
          yield* Effect.forEach(
            contexts,
            (context) =>
              bridge.bridge
                .request({
                  type: "stop_session",
                  sessionId: context.sessionId,
                })
                .pipe(Effect.ignore),
            { concurrency: "unbounded", discard: true },
          );
        }
        for (const context of contexts) {
          context.closed = true;
        }
        sessions.clear();
        yield* stopBridge();
      });

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(Effect.ignoreCause, Effect.ensuring(Queue.shutdown(runtimeEvents))),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      get streamEvents() {
        return Stream.fromQueue(runtimeEvents);
      },
    } satisfies ProviderAdapterShape<ProviderAdapterError>;
  });
