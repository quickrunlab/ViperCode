import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { AntigravitySettings } from "@vipercode/contracts";
import {
  checkAntigravityProviderStatus,
  parseAntigravityCliModels,
} from "./AntigravityProvider.ts";

const encoder = new TextEncoder();
const decodeSettings = Schema.decodeSync(AntigravitySettings);

// Tagged stand-in for an ENOENT spawn failure (a global `Error` in the Effect
// failure channel is disallowed). `isCommandMissingCause` keys off `.message`.
class FakeSpawnError extends Data.TaggedError("FakeSpawnError")<{
  readonly message: string;
}> {}

interface CommandOutcome {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
  readonly spawnError?: string;
}

function mockHandle(result: CommandOutcome) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout ?? "")),
    stderr: Stream.make(encoder.encode(result.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function spawnerLayer(handler: (command: string, args: ReadonlyArray<string>) => CommandOutcome) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cp = command as unknown as { command: string; args: ReadonlyArray<string> };
      const outcome = handler(cp.command, cp.args);
      if (outcome.spawnError) {
        // Simulate a missing executable (cross-platform): spawn fails with an
        // ENOENT-shaped error, which the probe classifies as "not installed".
        return Effect.fail(
          new FakeSpawnError({ message: outcome.spawnError }),
        ) as unknown as ReturnType<Parameters<typeof ChildProcessSpawner.make>[0]>;
      }
      return Effect.succeed(mockHandle(outcome));
    }),
  );
}

const probe = (
  settings: Partial<Record<string, unknown>>,
  handler: (command: string, args: ReadonlyArray<string>) => CommandOutcome,
  environment: NodeJS.ProcessEnv = {},
) =>
  checkAntigravityProviderStatus(decodeSettings(settings), environment).pipe(
    Effect.provide(spawnerLayer(handler)),
  );

describe("checkAntigravityProviderStatus", () => {
  it("parses agy models output as selectable display-name slugs", () => {
    expect(
      parseAntigravityCliModels(`
Available models:
  * Gemini 3.5 Flash (Medium)
  * Gemini 3.5 Flash (High)
  * Claude Sonnet 4.6 (Thinking)
  * Gemini 3.5 Flash (High)
`),
    ).toEqual([
      "Gemini 3.5 Flash (Medium)",
      "Gemini 3.5 Flash (High)",
      "Claude Sonnet 4.6 (Thinking)",
    ]);
  });

  it.effect("reports disabled without probing", () =>
    Effect.gen(function* () {
      const snapshot = yield* probe({ enabled: false }, () => ({ stdout: "" }));
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );

  it.effect("exposes Gemini Pro as one model with a Thinking selector", () =>
    Effect.gen(function* () {
      const snapshot = yield* probe({ enabled: false }, () => ({ stdout: "" }));
      const pro = snapshot.models.find((model) => model.slug === "gemini-3.1-pro");
      expect(pro).toBeDefined();
      expect(snapshot.models.map((model) => model.slug)).not.toContain("gemini-3.1-pro-low");
      expect(snapshot.models.map((model) => model.slug)).not.toContain("gemini-3.1-pro-high");
      expect(pro?.capabilities?.optionDescriptors).toEqual([
        {
          id: "thinkingLevel",
          label: "Thinking",
          type: "select",
          currentValue: "low",
          options: [
            { id: "low", label: "Low", isDefault: true },
            { id: "high", label: "High" },
          ],
        },
      ]);
    }),
  );

  it.effect("warns when OAuth/ADC is selected but project setup is incomplete", () =>
    Effect.gen(function* () {
      const snapshot = yield* probe({}, (command, args) =>
        command === "python"
          ? { stdout: '{"sdkAvailable": true, "sdkVersion": "0.3.0"}' }
          : args[0] === "models"
            ? { stdout: "" }
            : { stdout: "agy version 1.2.3" },
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.version).toBe("0.3.0");
      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.auth.type).toBe("google-oauth");
      expect(snapshot.message).toContain("Using Python: python");
      expect(snapshot.message).toContain("OAuth auth is selected");
    }),
  );

  it.effect("accepts an explicit Antigravity OAuth bearer token without project config", () =>
    Effect.gen(function* () {
      const snapshot = yield* probe(
        {},
        (command, args) =>
          command === "python"
            ? { stdout: '{"sdkAvailable": true, "sdkVersion": "0.3.0"}' }
            : args[0] === "models"
              ? { stdout: "" }
              : { stdout: "agy version 1.2.3" },
        { AGY_OAUTH_TOKEN: "test-oauth-token" },
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("ready");
      expect(snapshot.auth.status).toBe("unknown");
      expect(snapshot.auth.type).toBe("google-oauth");
      expect(snapshot.message).toContain("Antigravity OAuth bearer token");
    }),
  );

  it.effect("explains agy auth refresh when forced CLI OAuth has no readable token", () =>
    Effect.gen(function* () {
      const snapshot = yield* probe({ authMode: "agy-oauth" }, (command, args) =>
        command === "python"
          ? { stdout: '{"sdkAvailable": true, "sdkVersion": "0.3.0"}' }
          : args[0] === "models"
            ? { stdout: "" }
            : { stdout: "agy version 1.2.3" },
      );
      expect(snapshot.status).toBe("warning");
      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.message).toContain("agy");
      expect(snapshot.message).toContain("keyring");
    }),
  );

  it.effect("reports ready when both CLI and SDK are present with OAuth/ADC project config", () =>
    Effect.gen(function* () {
      const snapshot = yield* probe({ gcpProject: "viper-project" }, (command, args) =>
        command === "python"
          ? { stdout: '{"sdkAvailable": true, "sdkVersion": "0.3.0"}' }
          : args[0] === "models"
            ? { stdout: "" }
            : { stdout: "agy version 1.2.3" },
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toBe("0.3.0");
      expect(snapshot.auth.status).toBe("unknown");
      expect(snapshot.auth.type).toBe("google-oauth");
      expect(snapshot.message).toContain("OAuth/ADC (viper-project, us-central1)");
    }),
  );

  it.effect("allows API-key auth as an explicit fallback mode", () =>
    Effect.gen(function* () {
      const snapshot = yield* probe(
        { authMode: "api-key" },
        (command) =>
          command === "python"
            ? { stdout: '{"sdkAvailable": true, "sdkVersion": "0.3.0"}' }
            : { stdout: "agy version 1.2.3" },
        { GEMINI_API_KEY: "test-key" },
      );
      expect(snapshot.status).toBe("ready");
      expect(snapshot.auth.status).toBe("authenticated");
      expect(snapshot.auth.type).toBe("api-key");
    }),
  );

  it.effect("uses agy models output when the CLI exposes a model list", () =>
    Effect.gen(function* () {
      const snapshot = yield* probe({ gcpProject: "viper-project" }, (command, args) =>
        command === "python"
          ? { stdout: '{"sdkAvailable": true, "sdkVersion": "0.3.0"}' }
          : args[0] === "models"
            ? {
                stdout: [
                  "Gemini 3.5 Flash (Medium)",
                  "Gemini 3.1 Pro (High)",
                  "Claude Sonnet 4.6 (Thinking)",
                ].join("\n"),
              }
            : { stdout: "agy version 1.2.3" },
      );
      expect(snapshot.models.map((model) => model.slug)).toEqual([
        "gemini-3.5-flash",
        "gemini-3.1-pro",
        "claude-sonnet-4-6",
      ]);
    }),
  );

  it.effect("prefers a Python 3.12 interpreter that has the SDK over the default python", () =>
    Effect.gen(function* () {
      const sdkPython =
        process.platform === "win32"
          ? "C:\\Users\\viper\\AppData\\Local\\Programs\\Python\\Python312\\python.exe"
          : "python3.12";
      const snapshot = yield* probe(
        { gcpProject: "viper-project" },
        (command) =>
          command === "python"
            ? { stdout: '{"sdkAvailable": false, "sdkVersion": null}' }
            : command === sdkPython
              ? { stdout: '{"sdkAvailable": true, "sdkVersion": "0.4.0"}' }
              : command === "agy"
                ? { stdout: "agy version 1.2.3" }
                : { stdout: '{"sdkAvailable": false, "sdkVersion": null}' },
        process.platform === "win32"
          ? {
              LOCALAPPDATA: "C:\\Users\\viper\\AppData\\Local",
            }
          : {},
      );
      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toBe("0.4.0");
      expect(snapshot.message).toContain(sdkPython);
    }),
  );

  it.effect("warns to pip install the SDK when only the CLI is present", () =>
    Effect.gen(function* () {
      const snapshot = yield* probe({}, (command) =>
        command === "python"
          ? { stdout: '{"sdkAvailable": false, "sdkVersion": null}' }
          : { stdout: "agy version 1.2.3" },
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.message).toContain("pip install google-antigravity");
    }),
  );

  it.effect("errors when neither the CLI nor the SDK is installed", () =>
    Effect.gen(function* () {
      const snapshot = yield* probe({}, (command) =>
        command === "python"
          ? { stdout: '{"sdkAvailable": false}' }
          : { spawnError: "spawn agy ENOENT" },
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("not installed");
    }),
  );
});
