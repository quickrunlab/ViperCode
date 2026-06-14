import type { OrchestrationThreadActivity } from "@vipercode/contracts";
import type { Thread, TurnDiffSummary } from "../types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface SessionStatus {
  modelName: string | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCachedInputTokens: number | null;
  totalReasoningOutputTokens: number | null;
  totalTokens: number | null;
  contextWindowUsedTokens: number | null;
  contextWindowMaxTokens: number | null;
  contextWindowUsedPercentage: number | null;
  turnCount: number;
  linesAdded: number;
  linesRemoved: number;
  totalDurationApiMs: number | null;
  wallClockStartedAt: string | null;
}

export function deriveSessionStatus(thread: Thread | null | undefined): SessionStatus {
  const activities: ReadonlyArray<OrchestrationThreadActivity> = thread?.activities ?? [];
  const turnDiffSummaries: ReadonlyArray<TurnDiffSummary> = thread?.turnDiffSummaries ?? [];
  const modelName = thread?.modelSelection?.model ?? null;

  let totalInputTokens: number | null = null;
  let totalOutputTokens: number | null = null;
  let totalCachedInputTokens: number | null = null;
  let totalReasoningOutputTokens: number | null = null;
  let totalTokens: number | null = null;
  let contextWindowUsedTokens: number | null = null;
  let contextWindowMaxTokens: number | null = null;
  let contextWindowUsedPercentage: number | null = null;
  let totalDurationApiMs: number | null = null;

  for (const activity of activities) {
    if (activity.kind !== "context-window.updated") continue;
    const payload = asRecord(activity.payload);
    if (!payload) continue;

    const inputTokens = asFiniteNumber(payload.inputTokens);
    const outputTokens = asFiniteNumber(payload.outputTokens);
    const cachedInputTokens = asFiniteNumber(payload.cachedInputTokens);
    const reasoningOutputTokens = asFiniteNumber(payload.reasoningOutputTokens);
    const usedTokens = asFiniteNumber(payload.usedTokens);
    const maxTokens = asFiniteNumber(payload.maxTokens);
    const durationMs = asFiniteNumber(payload.durationMs);

    if (inputTokens !== null) totalInputTokens = (totalInputTokens ?? 0) + inputTokens;
    if (outputTokens !== null) totalOutputTokens = (totalOutputTokens ?? 0) + outputTokens;
    if (cachedInputTokens !== null)
      totalCachedInputTokens = (totalCachedInputTokens ?? 0) + cachedInputTokens;
    if (reasoningOutputTokens !== null)
      totalReasoningOutputTokens = (totalReasoningOutputTokens ?? 0) + reasoningOutputTokens;
    if (durationMs !== null) totalDurationApiMs = (totalDurationApiMs ?? 0) + durationMs;

    if (usedTokens !== null && usedTokens >= 0) {
      contextWindowUsedTokens = usedTokens;
      contextWindowMaxTokens = maxTokens;
      contextWindowUsedPercentage =
        maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    }
  }

  const lastCw = findLastContextWindowActivity(activities);
  if (lastCw) {
    const p = asRecord(lastCw.payload);
    const totalProcessed = asFiniteNumber(p?.totalProcessedTokens);
    if (totalProcessed !== null) {
      totalTokens = totalProcessed;
    }
  }
  if (totalTokens === null) {
    totalTokens = (totalInputTokens ?? 0) + (totalOutputTokens ?? 0);
  }

  let linesAdded = 0;
  let linesRemoved = 0;
  for (const summary of turnDiffSummaries) {
    for (const file of summary.files) {
      linesAdded += file.additions ?? 0;
      linesRemoved += file.deletions ?? 0;
    }
  }

  const turnCount = turnDiffSummaries.length;

  return {
    modelName,
    totalInputTokens,
    totalOutputTokens,
    totalCachedInputTokens,
    totalReasoningOutputTokens,
    totalTokens,
    contextWindowUsedTokens,
    contextWindowMaxTokens,
    contextWindowUsedPercentage,
    turnCount,
    linesAdded,
    linesRemoved,
    totalDurationApiMs,
    wallClockStartedAt: thread?.createdAt ?? null,
  };
}

function findLastContextWindowActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity | null {
  for (let i = activities.length - 1; i >= 0; i--) {
    const a = activities[i];
    if (a && a.kind === "context-window.updated") return a;
  }
  return null;
}
