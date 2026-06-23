/**
 * Antigravity bridge process supervisor.
 *
 * Spawns and supervises the ViperCode-owned Python bridge that drives the
 * `google-antigravity` SDK, speaking the NDJSON protocol defined in
 * {@link module:provider/antigravityBridgeProtocol}.
 *
 * Responsibilities:
 *   - spawn the bridge under a caller-owned scope (process killed on release),
 *   - stream requests to the bridge's stdin via a queue-backed sink so the
 *     interactive request/response protocol can write over time,
 *   - decode stdout into framed {@link BridgeEvent}s (bad lines logged and
 *     skipped, never fatal),
 *   - correlate `response` events back to the originating request,
 *   - expose the full event stream for the adapter to normalize (Layer 5).
 *
 * Effect resource semantics: everything is anchored to the scope captured at
 * construction. Closing that scope shuts down the input queue (EOF on the
 * bridge's stdin → graceful exit) and kills the child as a fallback.
 *
 * @module provider/antigravityBridgeProcess
 */
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  type BridgeEvent,
  type BridgeRequest,
  encodeBridgeRequestLine,
  parseBridgeEventLine,
} from "./antigravityBridgeProtocol.ts";

/** Default time a correlated request waits for its `response` event. */
export const ANTIGRAVITY_BRIDGE_REQUEST_TIMEOUT = Duration.seconds(30);

const textEncoder = new TextEncoder();

/**
 * Distributive `Omit<…, "id">` over the request union: the supervisor assigns
 * correlation ids, so callers describe a request without one.
 */
export type BridgeRequestInput = BridgeRequest extends infer T
  ? T extends { readonly id: string }
    ? Omit<T, "id">
    : never
  : never;

export class AntigravityBridgeError extends Data.TaggedError("AntigravityBridgeError")<{
  readonly message: string;
  readonly code?: string | undefined;
  readonly cause?: unknown;
}> {}

export interface AntigravityBridgeProcessOptions {
  readonly pythonPath: string;
  readonly bridgePath: string;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly extraArgs?: ReadonlyArray<string> | undefined;
  /** Hook for a bad/undecodable stdout line. Defaults to a debug log. */
  readonly onProtocolError?: (input: { readonly line: string; readonly reason: string }) => void;
}

export interface AntigravityBridgeProcessShape {
  /** Fire-and-forget a request without waiting for its acknowledgement. */
  readonly send: (input: BridgeRequestInput) => Effect.Effect<void, AntigravityBridgeError>;
  /**
   * Send a request and await its correlated `response` event. Fails on a
   * bridge-reported error, on timeout, or if the bridge exits first.
   */
  readonly request: (
    input: BridgeRequestInput,
    timeout?: Duration.Input,
  ) => Effect.Effect<unknown, AntigravityBridgeError>;
  /** Full decoded event stream (responses included) for adapter consumption. */
  readonly events: Stream.Stream<BridgeEvent>;
  /** Resolves with the child exit code once the bridge process exits. */
  readonly exitCode: Effect.Effect<number>;
}

interface PendingRequest {
  readonly deferred: Deferred.Deferred<unknown, AntigravityBridgeError>;
}

let requestCounter = 0;
const nextRequestId = (): string => {
  requestCounter += 1;
  return `req-${requestCounter.toString(36)}`;
};

/**
 * Spawn the bridge and return its supervisor handle. The returned effect must
 * be run in a scope that the caller controls; the process and all background
 * fibers are released when that scope closes.
 */
export const makeAntigravityBridgeProcess = (
  options: AntigravityBridgeProcessOptions,
): Effect.Effect<
  AntigravityBridgeProcessShape,
  AntigravityBridgeError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const scope = yield* Scope.Scope;

    const inputQueue = yield* Effect.acquireRelease(Queue.unbounded<Uint8Array>(), (queue) =>
      Queue.shutdown(queue),
    );
    const eventQueue = yield* Effect.acquireRelease(Queue.unbounded<BridgeEvent>(), (queue) =>
      Queue.shutdown(queue),
    );
    const pendingRef = yield* Ref.make(new Map<string, PendingRequest>());

    // On Windows bare command names and `.cmd` shims require a shell, and Node
    // concatenates argv for the shell without escaping — quote whitespace.
    const useShell = process.platform === "win32";
    const quoteForShell = (value: string): string =>
      useShell && /\s/.test(value) && !/^".*"$/.test(value) ? `"${value}"` : value;

    const args = [options.bridgePath, ...(options.extraArgs ?? [])];
    const child = yield* spawner
      .spawn(
        ChildProcess.make(quoteForShell(options.pythonPath), args.map(quoteForShell), {
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
          shell: useShell,
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.mapError(
          (cause) =>
            new AntigravityBridgeError({
              message: `Failed to spawn Antigravity bridge (${options.pythonPath} ${options.bridgePath}): ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
              code: "spawn_failed",
              cause,
            }),
        ),
      );

    // Drain the input queue into the child's stdin sink. When the scope closes
    // and `inputQueue` shuts down, the stream ends and stdin is closed (EOF),
    // letting the bridge shut down gracefully on its own.
    yield* Stream.fromQueue(inputQueue).pipe(
      Stream.run(child.stdin),
      Effect.ignore,
      Effect.forkIn(scope),
    );

    const reportProtocolError = (line: string, reason: string): void => {
      if (options.onProtocolError) {
        options.onProtocolError({ line, reason });
      }
    };

    const resolvePending = (id: string, settle: (pending: PendingRequest) => Effect.Effect<void>) =>
      Ref.modify(pendingRef, (map) => {
        const pending = map.get(id);
        if (!pending) {
          return [undefined, map] as const;
        }
        const next = new Map(map);
        next.delete(id);
        return [pending, next] as const;
      }).pipe(Effect.flatMap((pending) => (pending ? settle(pending) : Effect.void)));

    const handleEvent = (event: BridgeEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (event.type === "response") {
          yield* resolvePending(event.id, (pending) =>
            event.ok
              ? Deferred.succeed(pending.deferred, event.result ?? null)
              : Deferred.fail(
                  pending.deferred,
                  new AntigravityBridgeError({
                    message: event.error?.message ?? "Bridge request failed.",
                    ...(event.error?.code ? { code: event.error.code } : {}),
                  }),
                ),
          );
        }
        yield* Queue.offer(eventQueue, event);
      });

    // Decode stdout into framed events. `splitLines` handles partial-line
    // buffering and CRLF; a single malformed line is logged and skipped.
    yield* child.stdout.pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.runForEach((line) => {
        const parsed = parseBridgeEventLine(line);
        if (!parsed.ok) {
          if (line.trim().length > 0) {
            reportProtocolError(line, parsed.reason);
          }
          return Effect.void;
        }
        return handleEvent(parsed.event);
      }),
      Effect.ignore,
      Effect.forkIn(scope),
    );

    const exitCode = child.exitCode.pipe(
      Effect.map(Number),
      Effect.orElseSucceed(() => -1),
    );

    // When the bridge exits, fail every still-pending request so callers never
    // hang on a dead process.
    yield* exitCode.pipe(
      Effect.flatMap((code) =>
        Ref.getAndSet(pendingRef, new Map<string, PendingRequest>()).pipe(
          Effect.flatMap((map) =>
            Effect.forEach(
              [...map.values()],
              (pending) =>
                Deferred.fail(
                  pending.deferred,
                  new AntigravityBridgeError({
                    message: `Antigravity bridge exited (code ${code}) before responding.`,
                    code: "bridge_exited",
                  }),
                ),
              { discard: true },
            ),
          ),
        ),
      ),
      Effect.forkIn(scope),
    );

    const writeLine = (request: BridgeRequest): Effect.Effect<void> =>
      Queue.offer(inputQueue, textEncoder.encode(encodeBridgeRequestLine(request))).pipe(
        Effect.asVoid,
      );

    const send: AntigravityBridgeProcessShape["send"] = (input) =>
      writeLine({ ...(input as object), id: nextRequestId() } as BridgeRequest);

    const request: AntigravityBridgeProcessShape["request"] = (input, timeout) =>
      Effect.gen(function* () {
        const id = nextRequestId();
        const deferred = yield* Deferred.make<unknown, AntigravityBridgeError>();
        yield* Ref.update(pendingRef, (map) => {
          const next = new Map(map);
          next.set(id, { deferred });
          return next;
        });
        yield* writeLine({ ...(input as object), id } as BridgeRequest);
        return yield* Deferred.await(deferred).pipe(
          Effect.timeoutOrElse({
            duration: timeout ?? ANTIGRAVITY_BRIDGE_REQUEST_TIMEOUT,
            orElse: () =>
              Effect.fail(
                new AntigravityBridgeError({
                  message: `Antigravity bridge request '${(input as { type: string }).type}' timed out.`,
                  code: "request_timeout",
                }),
              ),
          }),
          Effect.onError(() => resolvePending(id, () => Effect.void)),
        );
      });

    return {
      send,
      request,
      events: Stream.fromQueue(eventQueue),
      exitCode,
    } satisfies AntigravityBridgeProcessShape;
  });
