/**
 * githubCopilotCliModels — discover the models the GitHub Copilot CLI actually
 * accepts and present them as the provider's model catalog.
 *
 * The Copilot CLI's `--model` flag (and ACP `session/set_model`) only accept a
 * fixed set of ids — e.g. `gemini-3-pro-preview`, `gpt-5.3-codex` — which is a
 * *different vocabulary* from the HTTP `/models` catalog (`gemini-3.1-pro-preview`,
 * `gpt-5.5`, …). Now that Copilot chat runs entirely through the CLI, the model
 * picker must offer the CLI's ids; otherwise selecting an HTTP-only id spawns
 * `copilot --acp --model <unknown>`, which exits immediately with
 * `error: option '--model <model>' argument '…' is invalid` and surfaces as
 * "Provider turn start failed".
 *
 * The accepted set is recovered cheaply: spawning the CLI with a deliberately
 * invalid model makes it print `Allowed choices are …` on stderr and exit. No
 * auth or full ACP handshake is required.
 *
 * @module provider/Drivers/githubCopilot/githubCopilotCliModels
 */
import type { ServerProviderModel } from "@vipercode/contracts";
import * as Effect from "effect/Effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

/** Sentinel model id used to trigger the CLI's "Allowed choices are …" error. */
const PROBE_MODEL_SENTINEL = "__vipercode_model_probe__";

/**
 * Known CLI model ids → display metadata. Ids absent here still render (with a
 * name derived from the id), so a newer CLI that adds models keeps working.
 */
const COPILOT_CLI_MODEL_DISPLAY: Readonly<
  Record<string, { readonly name: string; readonly subProvider: string }>
> = {
  "claude-opus-4.6": { name: "Claude Opus 4.6", subProvider: "Anthropic" },
  "claude-opus-4.6-fast": { name: "Claude Opus 4.6 (Fast)", subProvider: "Anthropic" },
  "claude-opus-4.5": { name: "Claude Opus 4.5", subProvider: "Anthropic" },
  "claude-sonnet-4.6": { name: "Claude Sonnet 4.6", subProvider: "Anthropic" },
  "claude-sonnet-4.5": { name: "Claude Sonnet 4.5", subProvider: "Anthropic" },
  "claude-sonnet-4": { name: "Claude Sonnet 4", subProvider: "Anthropic" },
  "claude-haiku-4.5": { name: "Claude Haiku 4.5", subProvider: "Anthropic" },
  "gemini-3-pro-preview": { name: "Gemini 3 Pro (Preview)", subProvider: "Google" },
  "gpt-5.3-codex": { name: "GPT-5.3-Codex", subProvider: "OpenAI" },
  "gpt-5.2-codex": { name: "GPT-5.2-Codex", subProvider: "OpenAI" },
  "gpt-5.2": { name: "GPT-5.2", subProvider: "OpenAI" },
  "gpt-5.1-codex-max": { name: "GPT-5.1-Codex-Max", subProvider: "OpenAI" },
  "gpt-5.1-codex": { name: "GPT-5.1-Codex", subProvider: "OpenAI" },
  "gpt-5.1-codex-mini": { name: "GPT-5.1-Codex-Mini", subProvider: "OpenAI" },
  "gpt-5.1": { name: "GPT-5.1", subProvider: "OpenAI" },
  "gpt-5-mini": { name: "GPT-5 mini", subProvider: "OpenAI" },
  "gpt-4.1": { name: "GPT-4.1", subProvider: "OpenAI" },
};

/**
 * Fallback model ids used when the live probe is unavailable (CLI not installed
 * yet, transient spawn failure). Mirrors the GitHub Copilot CLI 0.0.421 enum.
 */
export const DEFAULT_COPILOT_CLI_MODELS: ReadonlyArray<string> = [
  "claude-sonnet-4.6",
  "claude-sonnet-4.5",
  "claude-haiku-4.5",
  "claude-opus-4.6",
  "claude-opus-4.6-fast",
  "claude-opus-4.5",
  "claude-sonnet-4",
  "gemini-3-pro-preview",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex",
  "gpt-5.1",
  "gpt-5.1-codex-mini",
  "gpt-5-mini",
  "gpt-4.1",
];

/**
 * Parse the CLI's accepted `--model` ids from its invalid-argument error, e.g.
 * `… is invalid. Allowed choices are claude-sonnet-4.6, …, gpt-4.1.`
 */
export function parseCopilotCliModelEnum(output: string): ReadonlyArray<string> {
  // Capture the rest of the line (model ids contain dots, so the clause cannot
  // stop at the first period), then drop the trailing sentence period.
  const match = output.match(/Allowed choices are\s+([^\n]+)/i);
  const choices = match?.[1]?.trim().replace(/\.\s*$/, "");
  if (!choices) {
    return [];
  }
  return choices
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function displayForCliModel(id: string): { readonly name: string; readonly subProvider?: string } {
  const known = COPILOT_CLI_MODEL_DISPLAY[id];
  if (known) {
    return known;
  }
  // Derive a readable label from an unknown id (e.g. `gpt-6-turbo` → `Gpt 6 Turbo`).
  const name = id.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  return { name };
}

/**
 * Build the provider model list from the CLI's accepted ids plus any
 * user-defined custom models. Every catalog slug here is a valid `--model`
 * argument, so selecting one can never crash the spawn.
 */
export function mapCopilotCliModels(
  cliModelIds: ReadonlyArray<string>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  const catalog = cliModelIds.map((id): ServerProviderModel => {
    const display = displayForCliModel(id);
    return {
      slug: id,
      name: display.name,
      isCustom: false,
      capabilities: null,
      ...(display.subProvider ? { subProvider: display.subProvider } : {}),
    };
  });
  const catalogSlugs = new Set(catalog.map((model) => model.slug));
  const custom = customModels
    .filter((slug) => slug.trim().length > 0 && !catalogSlugs.has(slug))
    .map(
      (slug): ServerProviderModel => ({
        slug,
        name: slug,
        isCustom: true,
        capabilities: null,
      }),
    );
  return [...catalog, ...custom];
}

/**
 * Probe the Copilot CLI for the model ids its `--model` flag accepts. Returns an
 * empty array (never fails) when the CLI cannot be spawned; callers fall back to
 * {@link DEFAULT_COPILOT_CLI_MODELS}.
 */
export const probeCopilotCliModelEnum = (
  cliPath: string,
): Effect.Effect<ReadonlyArray<string>, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    // On Windows the spawner runs through a shell; whitespace-bearing tokens must
    // be quoted or they split (see AcpSessionRuntime). The probe has no
    // whitespace args, but the cliPath may (e.g. a custom install path).
    const useShell = process.platform === "win32";
    const quoteForShell = (value: string): string =>
      useShell && /\s/.test(value) && !/^".*"$/.test(value) ? `"${value}"` : value;
    const output = yield* spawner
      .string(
        ChildProcess.make(quoteForShell(cliPath), ["--acp", "--model", PROBE_MODEL_SENTINEL], {
          shell: useShell,
        }),
        { includeStderr: true },
      )
      .pipe(Effect.orElseSucceed(() => ""));
    return parseCopilotCliModelEnum(output);
  });
