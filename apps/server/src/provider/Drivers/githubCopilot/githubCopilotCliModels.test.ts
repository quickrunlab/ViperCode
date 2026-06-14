import { describe, expect, it } from "vite-plus/test";

import { mapCopilotCliModels, parseCopilotCliModelEnum } from "./githubCopilotCliModels.ts";

describe("parseCopilotCliModelEnum", () => {
  it("extracts the accepted --model ids from the CLI's invalid-argument error", () => {
    const stderr =
      "error: option '--model <model>' argument 'gemini-3.1-pro' is invalid. " +
      "Allowed choices are claude-sonnet-4.6, gemini-3-pro-preview, gpt-5-mini, gpt-4.1.";
    expect(parseCopilotCliModelEnum(stderr)).toEqual([
      "claude-sonnet-4.6",
      "gemini-3-pro-preview",
      "gpt-5-mini",
      "gpt-4.1",
    ]);
  });

  it("returns an empty list when the output has no choices clause", () => {
    expect(parseCopilotCliModelEnum("")).toEqual([]);
    expect(parseCopilotCliModelEnum("some unrelated error")).toEqual([]);
  });
});

describe("mapCopilotCliModels", () => {
  it("maps CLI ids to picker models with friendly names and sub-providers", () => {
    const models = mapCopilotCliModels(["gemini-3-pro-preview", "gpt-5-mini"], []);
    expect(models).toEqual([
      {
        slug: "gemini-3-pro-preview",
        name: "Gemini 3 Pro (Preview)",
        isCustom: false,
        capabilities: null,
        subProvider: "Google",
      },
      {
        slug: "gpt-5-mini",
        name: "GPT-5 mini",
        isCustom: false,
        capabilities: null,
        subProvider: "OpenAI",
      },
    ]);
  });

  it("derives a label for unknown ids and appends de-duplicated custom models", () => {
    const models = mapCopilotCliModels(
      ["gpt-6-turbo", "gpt-5-mini"],
      ["gpt-5-mini", "custom/local", "  "],
    );
    expect(models.map((model) => model.slug)).toEqual([
      "gpt-6-turbo",
      "gpt-5-mini",
      "custom/local",
    ]);
    expect(models[0]).toMatchObject({ slug: "gpt-6-turbo", name: "Gpt 6 Turbo", isCustom: false });
    expect(models.at(-1)).toEqual({
      slug: "custom/local",
      name: "custom/local",
      isCustom: true,
      capabilities: null,
    });
  });
});
