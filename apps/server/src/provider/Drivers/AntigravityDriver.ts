/**
 * AntigravityDriver — `ProviderDriver` for Google Antigravity.
 *
 * Mirrors the other first-party drivers: a plain value whose `create()`
 * bundles `snapshot` / `adapter` / `textGeneration` closures over the
 * per-instance `AntigravitySettings`.
 *
 * The snapshot probe detects the CLI plus the SDK-capable Python interpreter.
 * Chat sessions run through the SDK bridge-backed adapter; text-generation
 * helper methods remain explicitly unsupported until Antigravity has a cheap
 * one-shot path that fits ViperCode's commit/PR/title generation API.
 *
 * Continuation identity is keyed by the effective Antigravity home so multiple
 * instances pointed at the same `homePath` share conversation continuation,
 * mirroring the Claude home model rather than the Codex shadow-home model.
 *
 * @module provider/Drivers/AntigravityDriver
 */
import {
  AntigravitySettings,
  ProviderDriverKind,
  type ServerProvider,
  TextGenerationError,
} from "@vipercode/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeAntigravityAdapter } from "../Layers/AntigravityAdapter.ts";
import {
  checkAntigravityProviderStatus,
  makePendingAntigravityProvider,
} from "../Layers/AntigravityProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import type { TextGenerationShape } from "../../textGeneration/TextGeneration.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

const DRIVER_KIND = ProviderDriverKind.make("antigravity");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

// Antigravity is installed via the `agy` install script (CLI) and pip (SDK);
// neither is an npm/native auto-update target, so maintenance is manual-only.
const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

const PREVIEW_TEXT_GENERATION_DETAIL =
  "Antigravity text generation is not implemented yet (Preview).";

const previewTextGeneration: TextGenerationShape = {
  generateCommitMessage: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateCommitMessage",
        detail: PREVIEW_TEXT_GENERATION_DETAIL,
      }),
    ),
  generatePrContent: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generatePrContent",
        detail: PREVIEW_TEXT_GENERATION_DETAIL,
      }),
    ),
  generateBranchName: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateBranchName",
        detail: PREVIEW_TEXT_GENERATION_DETAIL,
      }),
    ),
  generateThreadTitle: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateThreadTitle",
        detail: PREVIEW_TEXT_GENERATION_DETAIL,
      }),
    ),
};

export type AntigravityDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Scope.Scope
  | ServerConfig;

function antigravityContinuationKey(settings: AntigravitySettings): string {
  const home = settings.homePath.trim();
  return home.length > 0 ? `antigravity:home:${home}` : "antigravity:default";
}

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const AntigravityDriver: ProviderDriver<AntigravitySettings, AntigravityDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Antigravity",
    supportsMultipleInstances: true,
  },
  configSchema: AntigravitySettings,
  defaultConfig: (): AntigravitySettings => decodeAntigravitySettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const effectiveConfig = { ...config, enabled } satisfies AntigravitySettings;
      const continuationGroupKey = antigravityContinuationKey(effectiveConfig);
      const fallbackContinuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey,
      });

      const adapter = yield* makeAntigravityAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
      });

      const checkProvider = checkAntigravityProviderStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

      const snapshot = yield* makeManagedServerProvider<AntigravitySettings>({
        maintenanceCapabilities: MAINTENANCE_CAPABILITIES,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) =>
          makePendingAntigravityProvider(settings).pipe(Effect.map(stampIdentity)),
        checkProvider,
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Antigravity snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity: {
          ...fallbackContinuationIdentity,
          continuationKey: continuationGroupKey,
        },
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration: previewTextGeneration,
      } satisfies ProviderInstance;
    }),
};
