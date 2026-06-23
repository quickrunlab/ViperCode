import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";
import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsPatch } from "./settings.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);

describe("ServerSettings.providerInstances (slice-2 invariant)", () => {
  it("defaults to an empty record so legacy configs without the key still decode", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
  });

  it("decodes a fully empty config (legacy on-disk shape) without complaint", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providerInstances).toEqual({});
    // Legacy `providers` struct is still hydrated with its per-driver defaults
    // so existing call sites keep working through the migration.
    expect(decoded.providers.codex.enabled).toBe(true);
  });

  it("decodes a multi-instance map mixing first-party and fork drivers", () => {
    const decoded = decodeServerSettings({
      providerInstances: {
        codex_personal: {
          driver: "codex",
          displayName: "Codex (personal)",
          config: { homePath: "~/.codex_personal" },
        },
        codex_work: {
          driver: "codex",
          config: { homePath: "~/.codex_work" },
        },
        ollama_local: {
          driver: "ollama",
          displayName: "Ollama (local)",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const personalId = ProviderInstanceId.make("codex_personal");
    const workId = ProviderInstanceId.make("codex_work");
    const ollamaId = ProviderInstanceId.make("ollama_local");

    expect(decoded.providerInstances[personalId]?.driver).toBe("codex");
    expect(decoded.providerInstances[workId]?.config).toEqual({ homePath: "~/.codex_work" });
    // Critical: a config naming a driver this build does not know about
    // (`ollama` is not in `ProviderDriverKind`) must round-trip without loss.
    // The runtime handles "driver not installed" — the schema must not.
    expect(decoded.providerInstances[ollamaId]?.driver).toBe("ollama");
    expect(decoded.providerInstances[ollamaId]?.config).toEqual({
      endpoint: "http://localhost:11434",
    });
  });

  it("rejects instance keys that violate the slug pattern", () => {
    expect(() =>
      decodeServerSettings({
        providerInstances: { "1bad": { driver: "codex" } },
      }),
    ).toThrow();
  });
});

describe("ServerSettings.providers.antigravity", () => {
  it("hydrates Antigravity defaults for legacy configs without the key", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providers.antigravity.enabled).toBe(true);
    expect(decoded.providers.antigravity.binaryPath).toBe("agy");
    expect(decoded.providers.antigravity.pythonPath).toBe("python");
    expect(decoded.providers.antigravity.authMode).toBe("google-oauth");
    expect(decoded.providers.antigravity.gcpProject).toBe("");
    expect(decoded.providers.antigravity.gcpLocation).toBe("us-central1");
    expect(decoded.providers.antigravity.toolPermission).toBe("request-review");
    expect(decoded.providers.antigravity.enableTerminalSandbox).toBe(true);
    expect(decoded.providers.antigravity.allowNonWorkspaceAccess).toBe(false);
    expect(decoded.providers.antigravity.customModels).toEqual([]);
  });

  it("coerces empty CLI/python paths back to their defaults", () => {
    const decoded = decodeServerSettings({
      providers: { antigravity: { binaryPath: "", pythonPath: "" } },
    });
    expect(decoded.providers.antigravity.binaryPath).toBe("agy");
    expect(decoded.providers.antigravity.pythonPath).toBe("python");
  });

  it("accepts and trims Antigravity patch fields", () => {
    const patch = decodeServerSettingsPatch({
      providers: {
        antigravity: {
          binaryPath: "  /opt/agy/bin/agy  ",
          pythonPath: "  /usr/bin/python3  ",
          authMode: "  google-oauth  ",
          gcpProject: "  viper-project  ",
          gcpLocation: "  global  ",
          toolPermission: "  proceed-in-sandbox  ",
          allowNonWorkspaceAccess: true,
          enableTerminalSandbox: false,
        },
      },
    });
    expect(patch.providers?.antigravity?.binaryPath).toBe("/opt/agy/bin/agy");
    expect(patch.providers?.antigravity?.pythonPath).toBe("/usr/bin/python3");
    expect(patch.providers?.antigravity?.authMode).toBe("google-oauth");
    expect(patch.providers?.antigravity?.gcpProject).toBe("viper-project");
    expect(patch.providers?.antigravity?.gcpLocation).toBe("global");
    expect(patch.providers?.antigravity?.toolPermission).toBe("proceed-in-sandbox");
    expect(patch.providers?.antigravity?.allowNonWorkspaceAccess).toBe(true);
    expect(patch.providers?.antigravity?.enableTerminalSandbox).toBe(false);
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults start-from-origin off for legacy configs", () => {
    expect(decodeServerSettings({}).newWorktreesStartFromOrigin).toBe(false);
  });

  it("accepts start-from-origin updates", () => {
    expect(
      decodeServerSettingsPatch({ newWorktreesStartFromOrigin: true }).newWorktreesStartFromOrigin,
    ).toBe(true);
  });
});

describe("ServerSettingsPatch.providerInstances", () => {
  it("treats providerInstances as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.providerInstances).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      providerInstances: {
        codex_personal: { driver: "codex", config: { homePath: "~/.codex" } },
      },
    });
    expect(replacement.providerInstances).toBeDefined();
    expect(replacement.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
  });

  it("preserves a fork-defined driver entry through patch decoding", () => {
    const patch = decodeServerSettingsPatch({
      providerInstances: {
        ollama_local: {
          driver: "ollama",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const ollamaId = ProviderInstanceId.make("ollama_local");
    expect(patch.providerInstances?.[ollamaId]?.driver).toBe("ollama");
  });
});

describe("ServerSettingsPatch string normalization", () => {
  it("trims string settings while decoding patches", () => {
    const patch = decodeServerSettingsPatch({
      addProjectBaseDirectory: "  ~/Development  ",
      textGenerationModelSelection: { model: "  gpt-5.4-mini  " },
      observability: {
        otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
      },
      providers: {
        codex: {
          binaryPath: "  /opt/homebrew/bin/codex  ",
          homePath: "  ~/.codex  ",
        },
      },
      providerInstances: {
        codex_personal: {
          driver: "  codex  ",
          displayName: "  Codex Personal  ",
          config: { homePath: "  ~/.codex-personal  " },
        },
      },
    });

    expect(patch.addProjectBaseDirectory).toBe("~/Development");
    expect(patch.textGenerationModelSelection?.model).toBe("gpt-5.4-mini");
    expect(patch.observability?.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
    expect(patch.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(patch.providers?.codex?.homePath).toBe("~/.codex");
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.displayName).toBe(
      "Codex Personal",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.config).toEqual({
      homePath: "  ~/.codex-personal  ",
    });
  });

  it("trims encoded server settings values before validation", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      addProjectBaseDirectory: "  ~/Development  ",
      providers: {
        ...defaultSettings.providers,
        codex: {
          ...defaultSettings.providers.codex,
          binaryPath: "  /opt/homebrew/bin/codex  ",
        },
      },
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
  });
});
