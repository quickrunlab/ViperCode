// @effect-diagnostics nodeBuiltinImport:off
/**
 * AntigravityProvider — status snapshot for the Antigravity provider.
 *
 * Probes two independent surfaces and reports their combined state:
 *   - the `agy` CLI (`<binaryPath> --version`), used for install/auth/version,
 *   - the `google-antigravity` Python SDK (importability via `<pythonPath> -c`).
 *
 * The streaming runtime is SDK-backed; the CLI remains useful for install and
 * setup probes. The SDK requires a Python interpreter that can import
 * `google.antigravity`, so status probing walks likely Python candidates
 * instead of trusting a bare `python` shim that may point at ViperCode's own
 * hermes environment.
 *
 * @module provider/Layers/AntigravityProvider
 */
import {
  type AntigravitySettings,
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderAuth,
  type ServerProviderModel,
} from "@vipercode/contracts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@vipercode/shared/model";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");
const ANTIGRAVITY_PRESENTATION = {
  displayName: "Antigravity",
  badgeLabel: "SDK",
  showInteractionModeToggle: false,
} as const;

const DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

// Models served by the Antigravity backend (the same backend the `agy` CLI
// drives). The SDK exposes no list-models API and `agy models` is an
// interactive TUI, so we ship the known set as defaults; users can still add
// others via custom models. Reasoning tiers are encoded in the model id the way
// the backend accepts them (e.g. `gemini-3.1-pro-high`), mirroring the CLI's
// "Gemini 3.1 Pro (High)" picker entries.
const BUILT_IN_ANTIGRAVITY_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    shortName: "3.5 Flash",
    isCustom: false,
    capabilities: DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3.1-pro-low",
    name: "Gemini 3.1 Pro (Low)",
    shortName: "3.1 Pro Low",
    isCustom: false,
    capabilities: DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3.1-pro-high",
    name: "Gemini 3.1 Pro (High)",
    shortName: "3.1 Pro High",
    isCustom: false,
    capabilities: DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
  },
  {
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Thinking)",
    shortName: "Sonnet 4.6",
    isCustom: false,
    capabilities: DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
  },
  {
    slug: "claude-opus-4-6-thinking",
    name: "Claude Opus 4.6 (Thinking)",
    shortName: "Opus 4.6",
    isCustom: false,
    capabilities: DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
  },
  {
    slug: "gpt-oss-120b",
    name: "GPT-OSS 120B",
    shortName: "GPT-OSS 120B",
    isCustom: false,
    capabilities: DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3.1-flash-image-preview",
    name: "Gemini 3.1 Flash Image Preview",
    shortName: "3.1 Flash Image",
    isCustom: false,
    capabilities: DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
  },
];

const DISABLED_MESSAGE = "Antigravity is disabled in Viper Code settings.";

// Python snippet printed as JSON: reports SDK importability + version without
// importing the (heavy, optional) package itself.
const SDK_PROBE_SCRIPT = [
  "import importlib.util as u, json",
  "spec = u.find_spec('google.antigravity')",
  "v = None",
  "if spec is not None:",
  "    try:",
  "        import importlib.metadata as m",
  "        v = m.version('google-antigravity')",
  "    except Exception:",
  "        v = None",
  "print(json.dumps({'sdkAvailable': spec is not None, 'sdkVersion': v}))",
].join("\n");

interface SdkProbeResult {
  readonly available: boolean;
  readonly version: string | null;
}

export interface AntigravityPythonProbeResult extends SdkProbeResult {
  readonly pythonPath: string;
}

// Shape printed by SDK_PROBE_SCRIPT. Decoded via a schema-backed JSON codec
// (compiled once) so we never reach for `JSON.parse`.
const SdkProbePayload = Schema.Struct({
  sdkAvailable: Schema.optional(Schema.Unknown),
  sdkVersion: Schema.optional(Schema.Unknown),
});
const decodeSdkProbePayload = Schema.decodeUnknownOption(Schema.fromJsonString(SdkProbePayload));

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function firstEnv(
  environment: NodeJS.ProcessEnv,
  ...names: ReadonlyArray<string>
): string | undefined {
  for (const name of names) {
    const value = environment[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function firstSettingOrEnv(
  setting: string,
  environment: NodeJS.ProcessEnv,
  ...names: ReadonlyArray<string>
): string | undefined {
  const trimmed = setting.trim();
  return trimmed.length > 0 ? trimmed : firstEnv(environment, ...names);
}

function antigravityOAuthProfileCandidates(
  settings: AntigravitySettings,
  environment: NodeJS.ProcessEnv,
): ReadonlyArray<string> {
  const explicit = firstEnv(
    environment,
    "ANTIGRAVITY_CLI_OAUTH_PROFILE",
    "ANTIGRAVITY_CLI_OAUTH_TOKEN_FILE",
    "GEMINI_OAUTH_CREDS",
  );
  const roots = [
    settings.homePath.trim(),
    firstEnv(environment, "ANTIGRAVITY_HOME", "GEMINI_CONFIG_DIR"),
    environment.USERPROFILE ? join(environment.USERPROFILE, ".gemini") : undefined,
    environment.HOME ? join(environment.HOME, ".gemini") : undefined,
  ].filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );

  const candidates = [
    ...(explicit ? [explicit] : []),
    ...roots.flatMap((root) => [
      join(root, "oauth_creds.json"),
      join(root, "google_credentials"),
      join(root, "auth.json"),
      join(root, "antigravity-cli", "oauth_creds.json"),
      join(root, "antigravity-cli", "antigravity-oauth-token"),
      join(root, "antigravity-cli", "google_credentials"),
      join(root, "antigravity-cli", "auth.json"),
      join(root, "antigravity-cli", "config.json"),
    ]),
  ];
  return [...new Set(candidates)];
}

function hasAntigravityOauthBearerToken(environment: NodeJS.ProcessEnv): boolean {
  return (
    firstEnv(
      environment,
      "AGY_OAUTH_TOKEN",
      "ANTIGRAVITY_OAUTH_TOKEN",
      "ANTIGRAVITY_ACCESS_TOKEN",
      "GOOGLE_OAUTH_ACCESS_TOKEN",
    ) !== undefined
  );
}

function hasAntigravityCliOAuthProfile(
  settings: AntigravitySettings,
  environment: NodeJS.ProcessEnv,
): boolean {
  return antigravityOAuthProfileCandidates(settings, environment).some((candidate) =>
    existsSync(candidate),
  );
}

function resolveAntigravityAuthStatus(
  settings: AntigravitySettings,
  environment: NodeJS.ProcessEnv,
): {
  readonly auth: ServerProviderAuth;
  readonly setupWarning?: string | undefined;
  readonly label: string;
} {
  const authMode = settings.authMode.trim() || "google-oauth";
  const hasOauthBearerToken = hasAntigravityOauthBearerToken(environment);
  const hasCliOAuthProfile = hasAntigravityCliOAuthProfile(settings, environment);
  const hasOAuthCredential = hasOauthBearerToken || hasCliOAuthProfile;
  if (authMode === "api-key" || authMode === "gemini-api-key") {
    const hasApiKey = firstEnv(environment, "GEMINI_API_KEY", "GOOGLE_API_KEY") !== undefined;
    return {
      auth: {
        status: hasApiKey ? "authenticated" : "unauthenticated",
        type: "api-key",
        label: hasApiKey ? "Gemini API key configured" : "Gemini API key missing",
      },
      label: "api-key",
      setupWarning: hasApiKey
        ? undefined
        : "API-key auth is selected, but GEMINI_API_KEY is not set.",
    };
  }

  if (["agy-oauth", "cli-oauth", "antigravity-cli-oauth"].includes(authMode)) {
    const label = hasOauthBearerToken
      ? "Antigravity OAuth bearer token"
      : hasCliOAuthProfile
        ? "Antigravity CLI OAuth profile"
        : "Antigravity OAuth credentials missing";
    return {
      auth: {
        status: hasOAuthCredential ? "unknown" : "unauthenticated",
        type: "google-oauth",
        label,
      },
      label: hasOAuthCredential ? label : "Antigravity OAuth setup incomplete",
      setupWarning: hasOAuthCredential
        ? undefined
        : "CLI OAuth auth is selected, but no explicit OAuth bearer token or readable Antigravity OAuth profile was found. If `agy` only stored auth in the OS keyring, set AGY_OAUTH_TOKEN or ANTIGRAVITY_CLI_OAUTH_PROFILE.",
    };
  }

  if (["google-oauth", "vertex-adc", "adc", "oauth", "auto"].includes(authMode)) {
    const project = firstSettingOrEnv(
      settings.gcpProject,
      environment,
      "GOOGLE_CLOUD_PROJECT",
      "GCLOUD_PROJECT",
      "CLOUDSDK_CORE_PROJECT",
    );
    const location = firstSettingOrEnv(
      settings.gcpLocation,
      environment,
      "GOOGLE_CLOUD_LOCATION",
      "GOOGLE_VERTEX_LOCATION",
      "GOOGLE_CLOUD_REGION",
    );
    const label =
      project && location
        ? `OAuth/ADC (${project}, ${location})`
        : hasOauthBearerToken
          ? "Antigravity OAuth bearer token"
          : hasCliOAuthProfile
            ? "Antigravity CLI OAuth profile"
            : "OAuth setup incomplete";
    return {
      auth: {
        status: (project && location) || hasOAuthCredential ? "unknown" : "unauthenticated",
        type: "google-oauth",
        label,
      },
      label,
      setupWarning:
        (project && location) || hasOAuthCredential
          ? undefined
          : "OAuth auth is selected. Set GCP project/location and run `gcloud auth application-default login`, set AGY_OAUTH_TOKEN, or provide a readable `agy` OAuth profile. SDK sessions cannot automatically reuse OS-keyring-only CLI auth in this SDK build.",
    };
  }

  return {
    auth: {
      status: "unauthenticated",
      type: authMode,
      label: "Unsupported Antigravity auth mode",
    },
    label: authMode,
    setupWarning: `Unsupported Antigravity auth mode: ${authMode}`,
  };
}

export function parseAntigravityCliModels(output: string): ReadonlyArray<string> {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^[\s>*\-•●]+/u, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
    if (
      !line ||
      /^usage\b/i.test(line) ||
      /^flags?:?$/i.test(line) ||
      /^agy\s+version\b/i.test(line)
    ) {
      continue;
    }
    if (/^(available\s+)?models?:?$/i.test(line)) {
      continue;
    }
    if (line.includes("\t")) {
      const [first] = line.split(/\t+/);
      if (first) {
        const trimmed = first.trim();
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          names.push(trimmed);
        }
      }
      continue;
    }
    if (!seen.has(line)) {
      seen.add(line);
      names.push(line);
    }
  }
  return names;
}

function cliModelsFor(modelNames: ReadonlyArray<string>): ReadonlyArray<ServerProviderModel> {
  return modelNames.map((name) => ({
    slug: name,
    name,
    isCustom: false,
    capabilities: DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
  }));
}

const modelsFor = (settings: AntigravitySettings, discoveredModels: ReadonlyArray<string> = []) =>
  providerModelsFromSettings(
    discoveredModels.length > 0 ? cliModelsFor(discoveredModels) : BUILT_IN_ANTIGRAVITY_MODELS,
    PROVIDER,
    settings.customModels,
    DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
  );

const runAntigravityCliCommand = Effect.fn("runAntigravityCliCommand")(function* (
  settings: AntigravitySettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) {
  const command = ChildProcess.make(settings.binaryPath, [...args], {
    env: environment as Record<string, string | undefined>,
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(settings.binaryPath, command);
});

export function antigravityPythonCandidates(
  settings: AntigravitySettings,
  environment: NodeJS.ProcessEnv,
): ReadonlyArray<string> {
  const candidates = [
    settings.pythonPath,
    process.platform === "win32" && environment.LOCALAPPDATA
      ? `${environment.LOCALAPPDATA}\\Programs\\Python\\Python312\\python.exe`
      : undefined,
    process.platform === "win32" && environment.USERPROFILE
      ? `${environment.USERPROFILE}\\AppData\\Local\\Programs\\Python\\Python312\\python.exe`
      : undefined,
    "python3.12",
    "python3",
    "python",
  ].filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );

  return [...new Set(candidates.map((candidate) => candidate.trim()))];
}

export const probeAntigravitySdkPath = Effect.fn("probeAntigravitySdkPath")(function* (
  pythonPath: string,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<SdkProbeResult, never, ChildProcessSpawner.ChildProcessSpawner> {
  // Never run through a shell: the `-c` payload is a multi-line script with
  // spaces, and the platform child-process layer concatenates args for the
  // shell WITHOUT escaping. On Windows cmd.exe that mangles the newlines into a
  // SyntaxError, so the SDK probe always failed and reported the SDK missing
  // even when it was installed. With shell:false the script is passed verbatim
  // as a single argument. `python` / `python.exe` resolve fine without a shell;
  // only `.cmd`/`.bat` shims would need one, which is not how Python ships.
  const command = ChildProcess.make(pythonPath, ["-c", SDK_PROBE_SCRIPT], {
    env: environment as Record<string, string | undefined>,
    shell: false,
  });
  const probe = yield* spawnAndCollect(pythonPath, command).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(probe) || Option.isNone(probe.success)) {
    return { available: false, version: null };
  }
  const output = probe.success.value;
  if (output.code !== 0) {
    return { available: false, version: null };
  }
  const parsed = decodeSdkProbePayload(output.stdout.trim());
  if (Option.isNone(parsed)) {
    return { available: false, version: null };
  }
  return {
    available: parsed.value.sdkAvailable === true,
    version: typeof parsed.value.sdkVersion === "string" ? parsed.value.sdkVersion : null,
  };
});

export const resolveAntigravityPythonProbe = Effect.fn("resolveAntigravityPythonProbe")(function* (
  settings: AntigravitySettings,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<AntigravityPythonProbeResult, never, ChildProcessSpawner.ChildProcessSpawner> {
  let fallback: AntigravityPythonProbeResult | undefined;
  for (const pythonPath of antigravityPythonCandidates(settings, environment)) {
    const probe = yield* probeAntigravitySdkPath(pythonPath, environment);
    const result = { ...probe, pythonPath };
    fallback ??= result;
    if (probe.available) {
      return result;
    }
  }
  return fallback ?? { pythonPath: settings.pythonPath, available: false, version: null };
});

export const makePendingAntigravityProvider = (
  settings: AntigravitySettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = yield* nowIso;
    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: modelsFor(settings),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? "Antigravity provider status has not been checked in this session yet."
          : DISABLED_MESSAGE,
      },
    });
  });

export const checkAntigravityProviderStatus = Effect.fn("checkAntigravityProviderStatus")(
  function* (
    settings: AntigravitySettings,
    environment: NodeJS.ProcessEnv = process.env,
  ): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
    const checkedAt = yield* nowIso;
    const models = modelsFor(settings);
    const auth = resolveAntigravityAuthStatus(settings, environment);

    if (!settings.enabled) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: auth.auth,
          message: DISABLED_MESSAGE,
        },
      });
    }

    // CLI probe: `agy --version`.
    const cliProbe = yield* runAntigravityCliCommand(settings, ["--version"], environment).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );
    const cliMissing = Result.isFailure(cliProbe) && isCommandMissingCause(cliProbe.failure);
    const cliVersion =
      Result.isSuccess(cliProbe) && Option.isSome(cliProbe.success)
        ? parseGenericCliVersion(
            `${cliProbe.success.value.stdout}\n${cliProbe.success.value.stderr}`,
          )
        : null;
    const cliFailedDetail =
      Result.isFailure(cliProbe) && !cliMissing
        ? cliProbe.failure instanceof Error
          ? cliProbe.failure.message
          : String(cliProbe.failure)
        : Result.isSuccess(cliProbe) && Option.isSome(cliProbe.success)
          ? cliProbe.success.value.code !== 0
            ? detailFromResult(cliProbe.success.value)
            : undefined
          : Result.isSuccess(cliProbe) && Option.isNone(cliProbe.success)
            ? "Timed out while running command."
            : undefined;
    const cliInstalled = !cliMissing;

    const discoveredModelNames =
      cliInstalled && !cliFailedDetail
        ? yield* runAntigravityCliCommand(settings, ["models"], environment).pipe(
            Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
            Effect.result,
            Effect.map((result) =>
              Result.isSuccess(result) &&
              Option.isSome(result.success) &&
              result.success.value.code === 0
                ? parseAntigravityCliModels(
                    `${result.success.value.stdout}\n${result.success.value.stderr}`,
                  )
                : [],
            ),
          )
        : [];
    const dynamicModels = modelsFor(settings, discoveredModelNames);

    // SDK probe: importability of `google-antigravity` from the first candidate
    // Python interpreter that actually has the package installed.
    const sdk = yield* resolveAntigravityPythonProbe(settings, environment);

    // Combine: neither surface present is an error; CLI-only is a warning (SDK
    // is required for streaming); SDK present is ready even when CLI auth still
    // needs environment-backed model credentials.
    if (!cliInstalled && !sdk.available) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: dynamicModels,
        probe: {
          installed: false,
          version: null,
          status: "error",
          auth: auth.auth,
          message:
            "Antigravity is not installed. Install the `agy` CLI (https://antigravity.google/download) and run `pip install google-antigravity`.",
        },
      });
    }

    const version = sdk.version ?? cliVersion;

    if (!sdk.available) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: dynamicModels,
        probe: {
          installed: true,
          version,
          status: "warning",
          auth: auth.auth,
          message: cliFailedDetail
            ? `Antigravity CLI detected but the \`google-antigravity\` SDK is missing (run \`pip install google-antigravity\`). CLI note: ${cliFailedDetail}`
            : "Antigravity CLI detected, but the `google-antigravity` SDK is missing. Run `pip install google-antigravity` to enable sessions.",
        },
      });
    }

    const readyMessage = cliInstalled
      ? `Antigravity CLI and SDK detected. Using Python: ${sdk.pythonPath}. Auth: ${auth.label}`
      : `Antigravity SDK detected. Using Python: ${sdk.pythonPath}. Install the \`agy\` CLI for setup helpers. Auth: ${auth.label}`;

    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: true,
      checkedAt,
      models: dynamicModels,
      probe: {
        installed: true,
        version,
        status: auth.setupWarning ? "warning" : "ready",
        auth: auth.auth,
        message: auth.setupWarning ? `${readyMessage}. ${auth.setupWarning}` : readyMessage,
      },
    });
  },
);
