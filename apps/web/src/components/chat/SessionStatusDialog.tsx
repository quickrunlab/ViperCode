import type { Thread } from "../../types";
import { memo, useMemo } from "react";
import { deriveSessionStatus, type SessionStatus } from "../../lib/sessionStatus";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "../ui/dialog";

function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return "--";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toFixed(1)}s`;
}

function formatWallClockDuration(startedAtIso: string | null): string {
  if (!startedAtIso) return "--";
  const started = Date.parse(startedAtIso);
  if (!Number.isFinite(started)) return "--";
  const elapsedMs = Date.now() - started;
  if (elapsedMs < 0) return "--";
  const totalSeconds = elapsedMs / 1000;
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatPercentage(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}%`;
}

function formatTokenCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "0";
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 10000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1000000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
}

function costEstimate(status: SessionStatus): string {
  // Rough estimate: $3/M input tokens, $15/M output tokens (Claude Sonnet pricing)
  const inputCost = (status.totalInputTokens ?? 0) * (3 / 1_000_000);
  const outputCost = (status.totalOutputTokens ?? 0) * (15 / 1_000_000);
  const total = inputCost + outputCost;
  if (total === 0) return "--";
  if (total < 0.01) return "< $0.01";
  return `~ $${total.toFixed(2)}`;
}

interface SessionStatusDialogProps {
  open: boolean;
  thread: Thread | null | undefined;
  onClose: () => void;
}

export const SessionStatusDialog = memo(function SessionStatusDialog({
  open,
  thread,
  onClose,
}: SessionStatusDialogProps) {
  const status = useMemo(() => deriveSessionStatus(thread ?? null), [thread]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup showCloseButton>
        <DialogHeader>
          <DialogTitle>Session Status</DialogTitle>
          <DialogDescription>
            {status.modelName ? `Model: ${status.modelName}` : "No active model"}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel scrollFade>
          <div className="space-y-4">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/55 mb-2">
                Usage
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <StatRow label="Total tokens" value={formatTokenCount(status.totalTokens)} />
                <StatRow label="Input tokens" value={formatTokenCount(status.totalInputTokens)} />
                <StatRow label="Output tokens" value={formatTokenCount(status.totalOutputTokens)} />
                <StatRow
                  label="Cache read tokens"
                  value={formatTokenCount(status.totalCachedInputTokens)}
                />
                {status.totalReasoningOutputTokens !== null &&
                  status.totalReasoningOutputTokens > 0 && (
                    <StatRow
                      label="Reasoning tokens"
                      value={formatTokenCount(status.totalReasoningOutputTokens)}
                    />
                  )}
                <StatRow
                  label="Context window"
                  value={
                    status.contextWindowUsedTokens !== null &&
                    status.contextWindowMaxTokens !== null
                      ? `${formatContextWindowTokens(status.contextWindowUsedTokens)} / ${formatContextWindowTokens(status.contextWindowMaxTokens)}`
                      : "--"
                  }
                />
                <StatRow
                  label="Context used"
                  value={formatPercentage(status.contextWindowUsedPercentage)}
                />
              </div>
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/55 mb-2">
                Duration
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <StatRow
                  label="Total duration (API)"
                  value={formatDurationMs(status.totalDurationApiMs)}
                />
                <StatRow
                  label="Total duration (wall)"
                  value={formatWallClockDuration(status.wallClockStartedAt)}
                />
              </div>
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/55 mb-2">
                Changes
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <StatRow label="Turns" value={`${status.turnCount}`} />
                <StatRow
                  label="Lines added"
                  value={status.linesAdded > 0 ? `+${status.linesAdded}` : `${status.linesAdded}`}
                />
                <StatRow
                  label="Lines removed"
                  value={
                    status.linesRemoved > 0 ? `-${status.linesRemoved}` : `${status.linesRemoved}`
                  }
                />
                <StatRow label="Est. cost" value={costEstimate(status)} />
              </div>
            </section>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
});

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums font-medium truncate" title={value}>
        {value}
      </span>
    </>
  );
}
