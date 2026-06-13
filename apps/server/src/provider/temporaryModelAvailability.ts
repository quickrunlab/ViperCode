import type { ServerProviderModel } from "@vipercode/contracts";

const TEMPORARILY_UNAVAILABLE_MODEL_REASON =
  "Anthropic temporarily disabled Fable 5 access on June 12, 2026.";
const TEMPORARILY_UNAVAILABLE_MODEL_SLUGS = new Set(["claude-fable-5"]);

export function withTemporaryModelAvailability(model: ServerProviderModel): ServerProviderModel {
  return TEMPORARILY_UNAVAILABLE_MODEL_SLUGS.has(model.slug)
    ? {
        ...model,
        availability: "unavailable",
        unavailableReason: TEMPORARILY_UNAVAILABLE_MODEL_REASON,
      }
    : model;
}
