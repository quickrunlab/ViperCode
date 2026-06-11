/**
 * GitHubCopilotDriver — `ProviderDriver` for the GitHub Copilot chat backend.
 *
 * Assembles one `ProviderInstance` from `GithubCopilotSettings`: a token
 * manager (OAuth device flow + session-token refresh), a chat adapter over
 * `/chat/completions`, text generation, and a health snapshot that reports
 * sign-in status and the dynamic `/models` catalog.
 *
 * @module provider/Drivers/githubCopilot/GitHubCopilotDriver
 */
import { GithubCopilotSettings, type ServerProvider } from "@vipercode/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";

import { ServerConfig } from "../../config.ts";
import { ProviderDriverError } from "../../Errors.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../../providerMaintenance.ts";
import { makeManagedServerProvider } from "../../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../../ProviderDriver.ts";
import { fetchCopilotModels } from "./githubCopilotApi.ts";
import { makeGitHubCopilotAdapter } from "./githubCopilotAdapter.ts";
import { makeGitHubCopilotAuth } from "./githubCopilotAuth.ts";
import {
  checkCopilotProviderStatus,
  GITHUB_COPILOT_DRIVER_KIND,
  makePendingCopilotSnapshot,
} from "./githubCopilotProvider.ts";
import { makeGitHubCopilotTextGeneration } from "./githubCopilotTextGeneration.ts";

const decodeSettings = Schema.decodeSync(GithubCopilotSettings);
const DEFAULT_MODEL = "gpt-4o";
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export type GitHubCopilotDriverEnv =
  | HttpClient.HttpClient
  | FileSystem.FileSystem
  | Path.Path
  | ServerConfig;

export const GitHubCopilotDriver: ProviderDriver<GithubCopilotSettings, GitHubCopilotDriverEnv> = {
  driverKind: GITHUB_COPILOT_DRIVER_KIND,
  metadata: {
    displayName: "GitHub Copilot",
    supportsMultipleInstances: true,
  },
  configSchema: GithubCopilotSettings,
  defaultConfig: (): GithubCopilotSettings => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, enabled, config }) =>
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const path = yield* Path.Path;
      const serverConfig = yield* ServerConfig;

      const storagePath = path.join(serverConfig.stateDir, "copilot", `${instanceId}.json`);
      const auth = yield* makeGitHubCopilotAuth({ storagePath });
      const adapter = yield* makeGitHubCopilotAdapter({ instanceId, auth, defaultModel: DEFAULT_MODEL });
      const textGeneration = yield* makeGitHubCopilotTextGeneration({ auth, model: DEFAULT_MODEL });

      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: GITHUB_COPILOT_DRIVER_KIND,
        packageName: null,
      });

      const snapshot = yield* makeManagedServerProvider<GithubCopilotSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(config),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (): Effect.Effect<ServerProvider> =>
          Effect.succeed(makePendingCopilotSnapshot({ instanceId, enabled })),
        checkProvider: checkCopilotProviderStatus({
          instanceId,
          enabled,
          customModels: config.customModels,
          auth,
          fetchModels: (token) =>
            fetchCopilotModels(token).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
        }),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: GITHUB_COPILOT_DRIVER_KIND,
              instanceId,
              detail: `Failed to build GitHub Copilot snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: GITHUB_COPILOT_DRIVER_KIND,
        continuationIdentity: defaultProviderContinuationIdentity({
          driverKind: GITHUB_COPILOT_DRIVER_KIND,
          instanceId,
        }),
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
