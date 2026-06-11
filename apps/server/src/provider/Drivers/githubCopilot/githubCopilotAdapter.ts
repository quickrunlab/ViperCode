/**
 * githubCopilotAdapter — chat adapter for the GitHub Copilot provider.
 *
 * Copilot's `/chat/completions` is a plain OpenAI-style endpoint with no
 * autonomous agent loop, so this adapter implements a single-shot chat turn:
 * each `sendTurn` appends the user message, calls the completion endpoint,
 * and streams the assistant reply back as runtime events
 * (`turn.started` → `item.started` → `content.delta` → `item.completed` →
 * `turn.completed`). Approval / tool / user-input requests don't occur for a
 * raw chat model, so those methods are inert.
 *
 * @module provider/Drivers/githubCopilot/githubCopilotAdapter
 */
import {
  EventId,
  ProviderInstanceId,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
} from "@vipercode/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";

import type { ProviderAdapterError } from "../../Errors.ts";
import type {
  ProviderAdapterShape,
  ProviderThreadSnapshot,
} from "../../Services/ProviderAdapter.ts";
import { createChatCompletion } from "./githubCopilotApi.ts";
import type { GitHubCopilotAuthShape } from "./githubCopilotAuth.ts";
import { GITHUB_COPILOT_DRIVER_KIND } from "./githubCopilotProvider.ts";

interface CopilotChatMessage {
  readonly role: string;
  readonly content: string;
}

interface CopilotSessionEntry {
  session: ProviderSession;
  history: Array<CopilotChatMessage>;
  model: string;
}

const SYSTEM_PROMPT =
  "You are GitHub Copilot, an AI coding assistant running inside Viper Code. " +
  "Answer concisely and use Markdown for code.";

export const makeGitHubCopilotAdapter = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly auth: GitHubCopilotAuthShape;
  readonly defaultModel: string;
}): Effect.Effect<
  ProviderAdapterShape<ProviderAdapterError>,
  never,
  HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const scope = yield* Effect.scope;
    const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const sessions = yield* Ref.make<Map<string, CopilotSessionEntry>>(new Map());
    const counter = yield* Ref.make(0);

    const nextId = Ref.modify(counter, (n) => [n + 1, n + 1] as const);
    // IsoDateTime is a plain string in the contracts; an ISO string is assignable.
    const nowIso = () => new Date().toISOString();

    const baseFields = (threadId: ThreadId, turnId: TurnId, n: number) => ({
      eventId: EventId.make(`ghcp-${Date.now()}-${n}`),
      provider: GITHUB_COPILOT_DRIVER_KIND,
      providerInstanceId: input.instanceId,
      threadId,
      createdAt: nowIso(),
      turnId,
    });

    const publish = (event: ProviderRuntimeEvent) =>
      PubSub.publish(events, event).pipe(Effect.asVoid);

    const runCompletion = (threadId: ThreadId, turnId: TurnId, entry: CopilotSessionEntry) =>
      Effect.gen(function* () {
        const itemSeq = yield* nextId;
        const itemId = RuntimeItemId.make(`ghcp-item-${Date.now()}-${itemSeq}`);

        yield* publish({
          ...baseFields(threadId, turnId, yield* nextId),
          type: "turn.started",
          payload: { model: entry.model },
        });
        yield* publish({
          ...baseFields(threadId, turnId, yield* nextId),
          itemId,
          type: "item.started",
          payload: { itemType: "assistant_message", status: "inProgress" },
        });

        const text = yield* input.auth.getSessionToken.pipe(
          Effect.flatMap((token) =>
            createChatCompletion(token, {
              model: entry.model,
              messages: [{ role: "system", content: SYSTEM_PROMPT }, ...entry.history],
            }),
          ),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.map(
            (response) =>
              response.choices.find((choice) => choice.message?.content)?.message?.content ?? "",
          ),
          Effect.catchAll(() => Effect.succeed<string | null>(null)),
        );

        if (text === null) {
          yield* publish({
            ...baseFields(threadId, turnId, yield* nextId),
            itemId,
            type: "item.completed",
            payload: { itemType: "assistant_message", status: "failed" },
          });
          yield* publish({
            ...baseFields(threadId, turnId, yield* nextId),
            type: "turn.completed",
            payload: {
              state: "failed",
              errorMessage: "GitHub Copilot request failed. Check your sign-in and try again.",
            },
          });
          return;
        }

        if (text.length > 0) {
          entry.history.push({ role: "assistant", content: text });
          yield* publish({
            ...baseFields(threadId, turnId, yield* nextId),
            itemId,
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: text },
          });
        }
        yield* publish({
          ...baseFields(threadId, turnId, yield* nextId),
          itemId,
          type: "item.completed",
          payload: { itemType: "assistant_message", status: "completed" },
        });
        yield* publish({
          ...baseFields(threadId, turnId, yield* nextId),
          type: "turn.completed",
          payload: { state: "completed" },
        });
      });

    const startSession = (
      startInput: ProviderSessionStartInput,
    ): Effect.Effect<ProviderSession> =>
      Effect.gen(function* () {
        const model = startInput.modelSelection?.model ?? input.defaultModel;
        const session: ProviderSession = {
          provider: GITHUB_COPILOT_DRIVER_KIND,
          providerInstanceId: input.instanceId,
          status: "ready",
          runtimeMode: startInput.runtimeMode,
          threadId: startInput.threadId,
          model,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        yield* Ref.update(sessions, (map) => {
          const next = new Map(map);
          next.set(startInput.threadId, { session, history: [], model });
          return next;
        });
        return session;
      });

    const sendTurn = (
      turnInput: ProviderSendTurnInput,
    ): Effect.Effect<ProviderTurnStartResult> =>
      Effect.gen(function* () {
        const map = yield* Ref.get(sessions);
        const entry = map.get(turnInput.threadId);
        const seq = yield* nextId;
        const turnId = TurnId.make(`ghcp-turn-${Date.now()}-${seq}`);
        if (entry === undefined) {
          return { threadId: turnInput.threadId, turnId };
        }
        if (turnInput.modelSelection?.model) {
          entry.model = turnInput.modelSelection.model;
        }
        if (turnInput.input && turnInput.input.trim().length > 0) {
          entry.history.push({ role: "user", content: turnInput.input });
        }
        yield* runCompletion(turnInput.threadId, turnId, entry).pipe(Effect.forkIn(scope));
        return { threadId: turnInput.threadId, turnId };
      });

    const listSessions = (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
      Ref.get(sessions).pipe(Effect.map((map) => Array.from(map.values(), (entry) => entry.session)));

    const hasSession = (threadId: ThreadId): Effect.Effect<boolean> =>
      Ref.get(sessions).pipe(Effect.map((map) => map.has(threadId)));

    const stopSession = (threadId: ThreadId): Effect.Effect<void> =>
      Ref.update(sessions, (map) => {
        const next = new Map(map);
        next.delete(threadId);
        return next;
      });

    const emptyThread = (threadId: ThreadId): ProviderThreadSnapshot => ({ threadId, turns: [] });

    return {
      provider: GITHUB_COPILOT_DRIVER_KIND,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn: () => Effect.void,
      respondToRequest: () => Effect.void,
      respondToUserInput: () => Effect.void,
      stopSession,
      listSessions,
      hasSession,
      readThread: (threadId) => Effect.succeed(emptyThread(threadId)),
      rollbackThread: (threadId) => Effect.succeed(emptyThread(threadId)),
      stopAll: () => Ref.set(sessions, new Map()),
      streamEvents: Stream.fromPubSub(events),
    } satisfies ProviderAdapterShape<ProviderAdapterError>;
  });
