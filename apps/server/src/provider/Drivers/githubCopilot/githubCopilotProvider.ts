/**
 * githubCopilotProvider — builds the `ServerProvider` snapshot for a Copilot
 * instance: maps the dynamic `/models` catalog into the UI model list and
 * reports auth/health status from the token manager.
 *
 * @module provider/Drivers/githubCopilot/githubCopilotProvider
 */
import {
  type ModelCapabilities,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@vipercode/contracts";
import { createModelCapabilities } from "@vipercode/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { CopilotModel, GitHubCopilotApiError } from "./githubCopilotApi.ts";
import type { CopilotSession, GitHubCopilotAuthShape } from "./githubCopilotAuth.ts";
import { withTemporaryModelAvailability } from "../../temporaryModelAvailability.ts";

export const GITHUB_COPILOT_DRIVER_KIND = ProviderDriverKind.make("githubCopilot");

const pendingCheckedAt = "1970-01-01T00:00:00.000Z";
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const DEFAULT_COPILOT_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const BUILT_IN_COPILOT_MODELS: ReadonlyArray<ServerProviderModel> = [
  { slug: "gpt-5.5", name: "GPT-5.5", subProvider: "OpenAI" },
  { slug: "gpt-5.4", name: "GPT-5.4", subProvider: "OpenAI" },
  { slug: "gpt-5.4-mini", name: "GPT-5.4 mini", subProvider: "OpenAI" },
  { slug: "gpt-5.4-nano", name: "GPT-5.4 nano", subProvider: "OpenAI" },
  { slug: "gpt-5.3-codex", name: "GPT-5.3-Codex", subProvider: "OpenAI" },
  { slug: "gpt-5-mini", name: "GPT-5 mini", subProvider: "OpenAI" },
  { slug: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", subProvider: "Anthropic" },
  { slug: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", subProvider: "Anthropic" },
  { slug: "claude-opus-4.8", name: "Claude Opus 4.8", subProvider: "Anthropic" },
  { slug: "claude-opus-4.7", name: "Claude Opus 4.7", subProvider: "Anthropic" },
  { slug: "claude-opus-4.6", name: "Claude Opus 4.6", subProvider: "Anthropic" },
  { slug: "claude-opus-4.5", name: "Claude Opus 4.5", subProvider: "Anthropic" },
  { slug: "claude-haiku-4.5", name: "Claude Haiku 4.5", subProvider: "Anthropic" },
  { slug: "claude-fable-5", name: "Claude Fable 5", subProvider: "Anthropic" },
  { slug: "gemini-3.5-flash", name: "Gemini 3.5 Flash", subProvider: "Google" },
  { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro", subProvider: "Google" },
  { slug: "gemini-3-flash", name: "Gemini 3 Flash", subProvider: "Google" },
  { slug: "gemini-2.5-pro", name: "Gemini 2.5 Pro", subProvider: "Google" },
  { slug: "mai-code-1-flash", name: "MAI-Code-1-Flash", subProvider: "Microsoft" },
  { slug: "raptor-mini", name: "Raptor mini", subProvider: "Fine-tuned GPT-5 mini" },
]
  .map((model) => ({
    ...model,
    isCustom: false,
    capabilities: DEFAULT_COPILOT_MODEL_CAPABILITIES,
  }))
  .map(withTemporaryModelAvailability);

function isSelectableCopilotModel(model: CopilotModel): boolean {
  const limits = model.capabilities?.limits;
  const supports = model.capabilities?.supports;
  return (
    model.model_picker_enabled !== false &&
    model.policy?.state !== "disabled" &&
    limits?.max_output_tokens !== undefined &&
    limits.max_prompt_tokens !== undefined &&
    supports?.tool_calls !== undefined
  );
}

function mapCopilotModelCapabilities(model: CopilotModel): ModelCapabilities {
  const efforts = model.capabilities?.supports?.reasoning_effort ?? [];
  const defaultEffort = efforts[0];
  return createModelCapabilities({
    optionDescriptors:
      defaultEffort !== undefined
        ? [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              type: "select" as const,
              options: efforts.map((effort, index) => ({
                id: effort,
                label: effort.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase()),
                ...(index === 0 ? { isDefault: true } : {}),
              })),
              currentValue: defaultEffort,
            },
          ]
        : [],
  });
}

export function mapCopilotModels(
  models: ReadonlyArray<CopilotModel>,
  customModels: ReadonlyArray<string>,
  options?: {
    readonly includeBuiltIns?: boolean;
  },
): ReadonlyArray<ServerProviderModel> {
  const fromCatalog = models.filter(isSelectableCopilotModel).map((model): ServerProviderModel => {
    const subProvider = model.vendor ?? model.capabilities?.family;
    return withTemporaryModelAvailability({
      slug: model.id,
      name: model.name && model.name.trim().length > 0 ? model.name : model.id,
      isCustom: false,
      capabilities: mapCopilotModelCapabilities(model),
      ...(subProvider ? { subProvider } : {}),
    });
  });
  const catalogSlugs = new Set(fromCatalog.map((model) => model.slug));
  const fromBuiltIns =
    options?.includeBuiltIns === true
      ? BUILT_IN_COPILOT_MODELS.filter((model) => !catalogSlugs.has(model.slug))
      : [];
  const builtInSlugs = new Set(fromBuiltIns.map((model) => model.slug));
  const fromCustom = customModels
    .filter((slug) => slug.trim().length > 0 && !catalogSlugs.has(slug) && !builtInSlugs.has(slug))
    .map(
      (slug): ServerProviderModel => ({
        slug,
        name: slug,
        isCustom: true,
        capabilities: null,
      }),
    );
  return [...fromCatalog, ...fromBuiltIns, ...fromCustom];
}

const baseSnapshot = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
  readonly checkedAt: string;
}): Pick<
  ServerProvider,
  | "instanceId"
  | "driver"
  | "enabled"
  | "installed"
  | "version"
  | "checkedAt"
  | "slashCommands"
  | "skills"
> => ({
  instanceId: input.instanceId,
  driver: GITHUB_COPILOT_DRIVER_KIND,
  enabled: input.enabled,
  installed: true,
  version: null,
  checkedAt: input.checkedAt,
  slashCommands: [],
  skills: [],
});

/** Snapshot used before the first auth check completes. */
export function makePendingCopilotSnapshot(input: {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
}): ServerProvider {
  return {
    ...baseSnapshot({ ...input, checkedAt: pendingCheckedAt }),
    status: "warning",
    auth: { status: "unknown" },
    message: "Checking GitHub Copilot sign-in…",
    models: mapCopilotModels([], [], { includeBuiltIns: true }),
  };
}

/** Live health check: reflects sign-in state and the fetched model catalog. */
export function checkCopilotProviderStatus(input: {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
  readonly customModels: ReadonlyArray<string>;
  readonly auth: GitHubCopilotAuthShape;
  readonly fetchModels: (
    session: CopilotSession,
  ) => Effect.Effect<ReadonlyArray<CopilotModel>, GitHubCopilotApiError>;
}): Effect.Effect<ServerProvider> {
  return Effect.gen(function* () {
    const checkedAt = yield* nowIso;
    if (!input.enabled) {
      return {
        ...baseSnapshot({ ...input, checkedAt }),
        status: "disabled",
        auth: { status: "unknown" },
        models: [],
      } satisfies ServerProvider;
    }

    const flow = yield* input.auth.ensureDeviceFlow.pipe(
      Effect.orElseSucceed(
        () => ({ _tag: "unavailable", reason: "GitHub Copilot sign-in is unavailable." }) as const,
      ),
    );
    if (flow._tag === "pending") {
      return {
        ...baseSnapshot({ ...input, checkedAt }),
        status: "warning",
        auth: { status: "unauthenticated" },
        message: `Open ${flow.verificationUri} and enter code ${flow.userCode} to finish signing in.`,
        deviceAuth: { userCode: flow.userCode, verificationUri: flow.verificationUri },
        models: mapCopilotModels([], input.customModels, { includeBuiltIns: true }),
      } satisfies ServerProvider;
    }
    if (flow._tag === "unavailable") {
      return {
        ...baseSnapshot({ ...input, checkedAt }),
        status: "warning",
        auth: { status: "unauthenticated" },
        message: flow.reason,
        models: mapCopilotModels([], input.customModels, { includeBuiltIns: true }),
      } satisfies ServerProvider;
    }

    const modelResult = yield* input.auth.getSessionToken.pipe(
      Effect.flatMap((session) => input.fetchModels(session)),
      Effect.result,
    );

    if (Result.isFailure(modelResult)) {
      return {
        ...baseSnapshot({ ...input, checkedAt }),
        status: "warning",
        auth: { status: "authenticated", type: "GitHub Copilot" },
        message:
          "Signed in, but the live model catalog could not be refreshed " +
          `(${modelResult.failure.message}). Showing default GitHub Copilot models.`,
        models: mapCopilotModels([], input.customModels, { includeBuiltIns: true }),
      } satisfies ServerProvider;
    }

    const mappedModels = mapCopilotModels(modelResult.success, input.customModels);
    const models =
      mappedModels.length > 0
        ? mappedModels
        : mapCopilotModels([], input.customModels, { includeBuiltIns: true });

    return {
      ...baseSnapshot({ ...input, checkedAt }),
      status: "ready",
      auth: { status: "authenticated", type: "GitHub Copilot" },
      models,
    } satisfies ServerProvider;
  });
}
