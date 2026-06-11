/**
 * githubCopilotProvider — builds the `ServerProvider` snapshot for a Copilot
 * instance: maps the dynamic `/models` catalog into the UI model list and
 * reports auth/health status from the token manager.
 *
 * @module provider/Drivers/githubCopilot/githubCopilotProvider
 */
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@vipercode/contracts";
import * as Effect from "effect/Effect";

import type { CopilotModel } from "./githubCopilotApi.ts";
import type { GitHubCopilotAuthShape } from "./githubCopilotAuth.ts";

export const GITHUB_COPILOT_DRIVER_KIND = ProviderDriverKind.make("githubCopilot");

// IsoDateTime is a plain string in the contracts; an ISO string is assignable.
const nowIso = () => new Date().toISOString();

export function mapCopilotModels(
  models: ReadonlyArray<CopilotModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  const fromCatalog = models.map(
    (model): ServerProviderModel => ({
      slug: model.id,
      name: model.name && model.name.trim().length > 0 ? model.name : model.id,
      isCustom: false,
      capabilities: null,
      ...(model.vendor ? { subProvider: model.vendor } : {}),
    }),
  );
  const catalogSlugs = new Set(fromCatalog.map((model) => model.slug));
  const fromCustom = customModels
    .filter((slug) => slug.trim().length > 0 && !catalogSlugs.has(slug))
    .map(
      (slug): ServerProviderModel => ({
        slug,
        name: slug,
        isCustom: true,
        capabilities: null,
      }),
    );
  return [...fromCatalog, ...fromCustom];
}

const baseSnapshot = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
}): Pick<
  ServerProvider,
  "instanceId" | "driver" | "enabled" | "installed" | "version" | "checkedAt" | "slashCommands" | "skills"
> => ({
  instanceId: input.instanceId,
  driver: GITHUB_COPILOT_DRIVER_KIND,
  enabled: input.enabled,
  installed: true,
  version: null,
  checkedAt: nowIso(),
  slashCommands: [],
  skills: [],
});

/** Snapshot used before the first auth check completes. */
export function makePendingCopilotSnapshot(input: {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
}): ServerProvider {
  return {
    ...baseSnapshot(input),
    status: "warning",
    auth: { status: "unknown" },
    message: "Checking GitHub Copilot sign-in…",
    models: [],
  };
}

/** Live health check: reflects sign-in state and the fetched model catalog. */
export function checkCopilotProviderStatus(input: {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
  readonly customModels: ReadonlyArray<string>;
  readonly auth: GitHubCopilotAuthShape;
  readonly fetchModels: (token: string) => Effect.Effect<ReadonlyArray<CopilotModel>, unknown>;
}): Effect.Effect<ServerProvider> {
  return Effect.gen(function* () {
    const authed = yield* input.auth.isAuthenticated.pipe(Effect.orElseSucceed(() => false));
    if (!authed) {
      return {
        ...baseSnapshot(input),
        status: "warning",
        auth: { status: "unauthenticated" },
        message: "Sign in to GitHub Copilot to use this provider.",
        models: [],
      } satisfies ServerProvider;
    }

    const models = yield* input.auth.getSessionToken.pipe(
      Effect.flatMap((token) => input.fetchModels(token)),
      Effect.orElseSucceed(() => [] as ReadonlyArray<CopilotModel>),
    );

    return {
      ...baseSnapshot(input),
      status: "ready",
      auth: { status: "authenticated", type: "GitHub Copilot" },
      models: mapCopilotModels(models, input.customModels),
    } satisfies ServerProvider;
  });
}
