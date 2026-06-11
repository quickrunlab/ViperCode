import { describe, expect, it } from "vite-plus/test";

import type { CopilotModel } from "./githubCopilotApi.ts";
import {
  buildCopilotHeaders,
  resolveCopilotApiBaseUrl,
  resolveGitHubBaseUrl,
} from "./githubCopilotApi.ts";
import { mapCopilotModels } from "./githubCopilotProvider.ts";

function selectableModel(patch: Partial<CopilotModel> & Pick<CopilotModel, "id">): CopilotModel {
  return {
    id: patch.id,
    name: patch.name ?? patch.id,
    model_picker_enabled: patch.model_picker_enabled ?? true,
    capabilities: patch.capabilities ?? {
      family: "openai",
      limits: {
        max_output_tokens: 16_384,
        max_prompt_tokens: 128_000,
      },
      supports: {
        reasoning_effort: ["low", "medium", "high"],
        tool_calls: true,
      },
    },
    ...(patch.vendor ? { vendor: patch.vendor } : {}),
    ...(patch.policy ? { policy: patch.policy } : {}),
    ...(patch.supported_endpoints ? { supported_endpoints: patch.supported_endpoints } : {}),
  };
}

describe("GitHub Copilot provider model mapping", () => {
  it("keeps selectable Copilot models and filters disabled or utility-only entries", () => {
    const mapped = mapCopilotModels(
      [
        selectableModel({ id: "gpt-5", name: "GPT-5", vendor: "OpenAI" }),
        selectableModel({
          id: "disabled-model",
          policy: { state: "disabled" },
        }),
        selectableModel({
          id: "utility-model",
          model_picker_enabled: false,
        }),
        selectableModel({
          id: "missing-limits",
          capabilities: {
            family: "openai",
            supports: { tool_calls: true },
          },
        }),
        selectableModel({
          id: "missing-tool-calls",
          capabilities: {
            family: "openai",
            limits: { max_output_tokens: 4096, max_prompt_tokens: 32_000 },
            supports: {},
          },
        }),
      ],
      ["gpt-5", "custom/copilot"],
    );

    expect(mapped.map((model) => model.slug)).toEqual(["gpt-5", "custom/copilot"]);
    expect(mapped[0]).toMatchObject({
      slug: "gpt-5",
      name: "GPT-5",
      isCustom: false,
      subProvider: "OpenAI",
    });
    expect(mapped[0]?.capabilities?.optionDescriptors).toEqual([
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "low", label: "Low", isDefault: true },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
        ],
        currentValue: "low",
      },
    ]);
    expect(mapped[1]).toEqual({
      slug: "custom/copilot",
      name: "custom/copilot",
      isCustom: true,
      capabilities: null,
    });
  });

  it("can show packaged Copilot defaults when the live catalog is unavailable", () => {
    const mapped = mapCopilotModels([], ["gpt-5.5", "custom/copilot"], {
      includeBuiltIns: true,
    });

    expect(mapped.slice(0, 4).map((model) => model.slug)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
    ]);
    expect(mapped.find((model) => model.slug === "claude-sonnet-4.6")).toMatchObject({
      name: "Claude Sonnet 4.6",
      subProvider: "Anthropic",
      isCustom: false,
    });
    expect(mapped.filter((model) => model.slug === "gpt-5.5")).toHaveLength(1);
    expect(mapped.at(-1)).toEqual({
      slug: "custom/copilot",
      name: "custom/copilot",
      isCustom: true,
      capabilities: null,
    });
  });
});

describe("GitHub Copilot API helpers", () => {
  it("resolves public and enterprise API bases", () => {
    expect(resolveGitHubBaseUrl(undefined)).toBe("https://github.com");
    expect(resolveGitHubBaseUrl("github.example.com/path")).toBe("https://github.example.com");
    expect(resolveCopilotApiBaseUrl(undefined)).toBe("https://api.githubcopilot.com");
    expect(resolveCopilotApiBaseUrl("https://github.example.com")).toBe(
      "https://copilot-api.github.example.com",
    );
  });

  it("builds current Copilot request headers", () => {
    expect(
      buildCopilotHeaders({
        initiator: "user",
        intent: "conversation-edits",
        vision: true,
      }),
    ).toMatchObject({
      Accept: "application/json",
      "User-Agent": "ViperCode",
      "X-GitHub-Api-Version": "2026-06-01",
      "Openai-Intent": "conversation-edits",
      "x-initiator": "user",
      "Copilot-Vision-Request": "true",
    });
  });
});
