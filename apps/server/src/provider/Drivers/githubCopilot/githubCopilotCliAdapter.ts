/**
 * githubCopilotCliAdapter — binds the generic ACP provider adapter to the
 * GitHub Copilot CLI (`copilot --acp`).
 *
 * The Copilot CLI is a full coding agent: it reads files, edits, runs shell
 * commands, and prompts for permission over ACP. This binding spawns one CLI
 * process per session in the workspace `cwd`, selecting the model with
 * `--model`, and forwards ViperCode's stored GitHub OAuth token so the user
 * signs in once. See {@link module:provider/acp/AcpProviderAdapter}.
 *
 * @module provider/Drivers/githubCopilot/githubCopilotCliAdapter
 */
import type { ProviderInstanceId } from "@vipercode/contracts";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { ProviderAdapterError } from "../../Errors.ts";
import type { ProviderAdapterShape } from "../../Services/ProviderAdapter.ts";
import { makeAcpProviderAdapter } from "../../acp/AcpProviderAdapter.ts";
import type { AcpSpawnInput } from "../../acp/AcpSessionRuntime.ts";
import type { GitHubCopilotAuthShape } from "./githubCopilotAuth.ts";
import { DEFAULT_COPILOT_CLI_MODELS } from "./githubCopilotCliModels.ts";
import { GITHUB_COPILOT_DRIVER_KIND } from "./githubCopilotProvider.ts";

// Reported to the agent during ACP `initialize`; purely informational.
const CLIENT_INFO = { name: "ViperCode", version: "0.1.0" } as const;

/**
 * Resolve the auth environment for a spawned CLI. Prefers ViperCode's stored
 * `ghu_` OAuth token (forwarded as `COPILOT_GITHUB_TOKEN`, the credential the
 * CLI exchanges for a session token itself) for a single sign-in. If the host
 * environment already exposes a Copilot/GitHub token we inject nothing, leaving
 * the CLI's own credential resolution (env token, then `copilot login`)
 * untouched — the fallback path when ViperCode is signed out.
 */
const resolveAuthEnv = (
  auth: GitHubCopilotAuthShape,
): Effect.Effect<NodeJS.ProcessEnv | undefined> =>
  Effect.gen(function* () {
    const envAlreadyHasToken = Boolean(
      process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    );
    if (envAlreadyHasToken) {
      return undefined;
    }
    const oauthToken = yield* auth.getOAuthToken;
    return oauthToken ? { COPILOT_GITHUB_TOKEN: oauthToken } : undefined;
  });

export const makeGitHubCopilotCliAdapter = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly auth: GitHubCopilotAuthShape;
  /** Resolved `copilot` binary (settings override or PATH default). */
  readonly cliPath: string;
  /** Model used when a turn carries no explicit selection. */
  readonly defaultModel: string;
  /**
   * The CLI's accepted `--model` ids (memoized probe). Used to validate the
   * requested model before spawning: an id the CLI does not recognize makes
   * `copilot --acp --model <id>` exit immediately, so unknown ids are dropped
   * (the CLI then uses its own default) rather than crashing the turn.
   */
  readonly getCliModels: Effect.Effect<ReadonlyArray<string>>;
}): Effect.Effect<
  ProviderAdapterShape<ProviderAdapterError>,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  makeAcpProviderAdapter({
    provider: GITHUB_COPILOT_DRIVER_KIND,
    instanceId: input.instanceId,
    clientInfo: CLIENT_INFO,
    defaultModel: input.defaultModel,
    buildSpawn: ({ cwd, model }) =>
      Effect.gen(function* () {
        const args = ["--acp", "--add-dir", cwd];
        const cliModels = yield* input.getCliModels;
        const acceptedModels = cliModels.length > 0 ? cliModels : DEFAULT_COPILOT_CLI_MODELS;
        if (model && acceptedModels.includes(model)) {
          args.push("--model", model);
        }
        const env = yield* resolveAuthEnv(input.auth);
        return {
          command: input.cliPath,
          args,
          cwd,
          ...(env ? { env } : {}),
        } satisfies AcpSpawnInput;
      }),
  });
