/**
 * githubCopilotAuth — stateful token manager for the GitHub Copilot driver.
 *
 * Owns the two long-lived credentials:
 *   - the `ghu_` GitHub OAuth token (persisted to disk so login survives
 *     restarts), obtained once via the device flow;
 *   - the short-lived Copilot *session* token (kept in memory, refreshed
 *     from the OAuth token before it expires).
 *
 * Built by {@link makeGitHubCopilotAuth} as a per-instance value so two
 * configured Copilot instances never share credentials. Requires
 * `HttpClient`, `FileSystem`, and `Path`.
 *
 * @module provider/Drivers/githubCopilot/githubCopilotAuth
 */
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { HttpClient } from "effect/unstable/http";

import {
  exchangeCopilotToken,
  pollDeviceAccessToken,
  requestDeviceCode,
  type DeviceCodeResponse,
} from "./githubCopilotApi.ts";

const StoredOAuth = Schema.Struct({ oauthToken: Schema.String });
const decodeStoredOAuth = Schema.decodeUnknownEffect(StoredOAuth);

/** Refresh the session token this many seconds before it actually expires. */
const SESSION_TOKEN_REFRESH_SKEW_SECONDS = 60;
/** Hard cap on device-flow polling, independent of the server-reported expiry. */
const DEVICE_FLOW_MAX_POLLS = 180;

export interface GitHubCopilotAuthShape {
  /** Whether a persisted `ghu_` OAuth token exists (i.e. the user is logged in). */
  readonly isAuthenticated: Effect.Effect<boolean>;
  /** Begin the device flow; the returned code/uri are surfaced in the UI. */
  readonly startDeviceAuthorization: Effect.Effect<DeviceCodeResponse, unknown>;
  /**
   * Poll until the user authorizes in their browser, then persist the
   * resulting `ghu_` token. Resolves with the token, or fails if the device
   * code expires or GitHub returns an error.
   */
  readonly awaitDeviceAuthorization: (
    device: Pick<DeviceCodeResponse, "device_code" | "interval">,
  ) => Effect.Effect<string, unknown>;
  /**
   * Return a valid Copilot session token, exchanging/refreshing from the
   * stored OAuth token as needed. Fails if the user is not authenticated.
   */
  readonly getSessionToken: Effect.Effect<string, unknown>;
  /** Forget both tokens (sign out). */
  readonly signOut: Effect.Effect<void>;
}

interface CachedSessionToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export const makeGitHubCopilotAuth = (options: {
  /** Absolute path to the JSON file holding the persisted `ghu_` token. */
  readonly storagePath: string;
}): Effect.Effect<
  GitHubCopilotAuthShape,
  never,
  HttpClient.HttpClient | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const httpClient = yield* HttpClient.HttpClient;
    const sessionRef = yield* Ref.make<CachedSessionToken | null>(null);

    // The shape's effects are R=never; provide HttpClient once here so each
    // stateless API call captures it instead of leaking it into the contract.
    const withHttp = <A, E>(eff: Effect.Effect<A, E, HttpClient.HttpClient>): Effect.Effect<A, E> =>
      eff.pipe(Effect.provideService(HttpClient.HttpClient, httpClient));

    const readStoredOAuthToken = Effect.gen(function* () {
      const exists = yield* fs.exists(options.storagePath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return null;
      const raw = yield* fs.readFileString(options.storagePath).pipe(
        Effect.orElseSucceed(() => ""),
      );
      if (raw.trim().length === 0) return null;
      const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown).pipe(
        Effect.flatMap((value) => decodeStoredOAuth(value)),
        Effect.option,
      );
      return parsed._tag === "Some" ? parsed.value.oauthToken : null;
    });

    const writeStoredOAuthToken = (oauthToken: string) =>
      Effect.gen(function* () {
        yield* fs
          .makeDirectory(path.dirname(options.storagePath), { recursive: true })
          .pipe(Effect.orElseSucceed(() => undefined));
        yield* fs.writeFileString(options.storagePath, JSON.stringify({ oauthToken }, null, 2));
      });

    const isAuthenticated = readStoredOAuthToken.pipe(Effect.map((token) => token !== null));

    const startDeviceAuthorization = withHttp(requestDeviceCode);

    const awaitDeviceAuthorization = (
      device: Pick<DeviceCodeResponse, "device_code" | "interval">,
    ): Effect.Effect<string, unknown> => {
      const poll = (attempt: number, intervalSeconds: number): Effect.Effect<string, unknown> => {
        if (attempt >= DEVICE_FLOW_MAX_POLLS) {
          return Effect.fail(new Error("GitHub Copilot device authorization timed out."));
        }
        return Effect.sleep(Duration.seconds(intervalSeconds)).pipe(
          Effect.flatMap(() => withHttp(pollDeviceAccessToken(device.device_code))),
          Effect.flatMap((result) => {
            switch (result._tag) {
              case "authorized":
                return writeStoredOAuthToken(result.accessToken).pipe(
                  Effect.as(result.accessToken),
                );
              case "pending":
                return poll(attempt + 1, intervalSeconds);
              case "slow_down":
                return poll(attempt + 1, result.interval);
              case "error":
                return Effect.fail(
                  new Error(
                    `GitHub Copilot authorization failed: ${result.error}${
                      result.description ? ` (${result.description})` : ""
                    }`,
                  ),
                );
            }
          }),
        );
      };
      return poll(0, Math.max(device.interval, 1));
    };

    const refreshSessionToken = Effect.gen(function* () {
      const oauthToken = yield* readStoredOAuthToken;
      if (oauthToken === null) {
        return yield* Effect.fail(
          new Error("Not signed in to GitHub Copilot. Run the device authorization flow first."),
        );
      }
      const exchanged = yield* withHttp(exchangeCopilotToken(oauthToken));
      const expiresAtMs =
        (exchanged.expires_at ?? Math.floor(Date.now() / 1000) + 25 * 60) * 1000;
      const cached: CachedSessionToken = { token: exchanged.token, expiresAtMs };
      yield* Ref.set(sessionRef, cached);
      return cached.token;
    });

    const getSessionToken = Effect.gen(function* () {
      const cached = yield* Ref.get(sessionRef);
      const skewMs = SESSION_TOKEN_REFRESH_SKEW_SECONDS * 1000;
      if (cached !== null && cached.expiresAtMs - skewMs > Date.now()) {
        return cached.token;
      }
      return yield* refreshSessionToken;
    });

    const signOut = Effect.gen(function* () {
      yield* Ref.set(sessionRef, null);
      yield* fs.remove(options.storagePath).pipe(Effect.orElseSucceed(() => undefined));
    });

    return {
      isAuthenticated,
      startDeviceAuthorization,
      awaitDeviceAuthorization,
      getSessionToken,
      signOut,
    } satisfies GitHubCopilotAuthShape;
  });
