import type {
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
  EnvironmentId,
  ThreadId,
} from "@vipercode/contracts";
import {
  WsTransport,
  createWsRpcClient,
  type WsRpcClient,
  type KnownEnvironment,
  getKnownEnvironmentWsBaseUrl,
  resolveRemoteWebSocketConnectionUrl,
} from "@vipercode/client-runtime";
import { setShellState, getShellState } from "../shell/useShellSnapshot.ts";
import { shellStateFromSnapshot } from "../shell/shellTypes.ts";
import { setThreadDetail, getThreadDetail } from "../thread/useThreadDetail.ts";
import type { CheckpointFile } from "../thread/threadTypes.ts";
import { mobileRuntime } from "../runtime/mobileRuntime.ts";

interface EnvironmentClientEntry {
  readonly client: WsRpcClient;
  readonly environmentId: EnvironmentId;
  shellUnsub: (() => void) | null;
}

const clients = new Map<EnvironmentId, EnvironmentClientEntry>();

export function getEnvironmentClient(environmentId: EnvironmentId): WsRpcClient | null {
  return clients.get(environmentId)?.client ?? null;
}

export function isEnvironmentConnected(environmentId: EnvironmentId): boolean {
  return clients.has(environmentId);
}

export async function disconnectEnvironmentClient(environmentId: EnvironmentId): Promise<void> {
  const entry = clients.get(environmentId);
  if (!entry) return;

  entry.shellUnsub?.();
  entry.shellUnsub = null;

  try {
    await entry.client.dispose();
  } catch {
    // best-effort dispose
  }

  clients.delete(environmentId);
}

async function resolveWsUrl(
  wsBaseUrl: string,
  httpBaseUrl: string,
  bearerToken: string,
): Promise<string> {
  return mobileRuntime.runPromise(
    resolveRemoteWebSocketConnectionUrl({
      wsBaseUrl,
      httpBaseUrl,
      bearerToken,
    }),
  );
}

export async function connectEnvironmentClient(
  environmentId: EnvironmentId,
  knownEnv: KnownEnvironment,
  bearerToken: string,
): Promise<WsRpcClient> {
  await disconnectEnvironmentClient(environmentId);

  const wsBaseUrl = getKnownEnvironmentWsBaseUrl(knownEnv);
  if (!wsBaseUrl) throw new Error("No WebSocket URL for environment");

  const httpBaseUrl = knownEnv.target.httpBaseUrl;

  const transport = new WsTransport(() => resolveWsUrl(wsBaseUrl, httpBaseUrl, bearerToken));

  const client = createWsRpcClient(transport);

  const entry: EnvironmentClientEntry = {
    client,
    environmentId,
    shellUnsub: null,
  };

  clients.set(environmentId, entry);

  entry.shellUnsub = client.orchestration.subscribeShell((item: OrchestrationShellStreamItem) => {
    if (item.kind === "snapshot") {
      const state = shellStateFromSnapshot(
        environmentId,
        item.snapshot.projects,
        item.snapshot.threads,
      );
      setShellState(environmentId, state);
    } else {
      const current = getShellState(environmentId);
      if (!current || current.projects.length === 0) return;

      if (item.kind === "project-upserted") {
        const idx = current.projects.findIndex((p) => p.id === item.project.id);
        const updatedProjects =
          idx >= 0
            ? current.projects.map((p, i) =>
                i === idx
                  ? {
                      environmentId,
                      id: item.project.id,
                      title: item.project.title,
                      workspaceRoot: item.project.workspaceRoot,
                    }
                  : p,
              )
            : [
                ...current.projects,
                {
                  environmentId,
                  id: item.project.id,
                  title: item.project.title,
                  workspaceRoot: item.project.workspaceRoot,
                },
              ];
        setShellState(environmentId, {
          ...current,
          projects: updatedProjects,
        });
      } else if (item.kind === "project-removed") {
        setShellState(environmentId, {
          ...current,
          projects: current.projects.filter((p) => p.id !== item.projectId),
        });
      } else if (item.kind === "thread-upserted") {
        const threadShell = item.thread;
        const idx = current.threads.findIndex((t) => t.id === threadShell.id);
        const updatedThreads =
          idx >= 0
            ? current.threads.map((t, i) =>
                i === idx
                  ? {
                      environmentId,
                      id: threadShell.id,
                      projectId: threadShell.projectId,
                      title: threadShell.title,
                      status:
                        threadShell.session?.status ?? (threadShell.latestTurn ? "ready" : "idle"),
                      hasPendingApprovals: threadShell.hasPendingApprovals,
                      hasPendingUserInput: threadShell.hasPendingUserInput,
                      hasActionableProposedPlan: threadShell.hasActionableProposedPlan,
                      updatedAt: threadShell.updatedAt,
                    }
                  : t,
              )
            : [
                ...current.threads,
                {
                  environmentId,
                  id: threadShell.id,
                  projectId: threadShell.projectId,
                  title: threadShell.title,
                  status:
                    threadShell.session?.status ?? (threadShell.latestTurn ? "ready" : "idle"),
                  hasPendingApprovals: threadShell.hasPendingApprovals,
                  hasPendingUserInput: threadShell.hasPendingUserInput,
                  hasActionableProposedPlan: threadShell.hasActionableProposedPlan,
                  updatedAt: threadShell.updatedAt,
                },
              ];
        setShellState(environmentId, {
          ...current,
          threads: updatedThreads,
        });
      } else if (item.kind === "thread-removed") {
        setShellState(environmentId, {
          ...current,
          threads: current.threads.filter((t) => t.id !== item.threadId),
        });
      }
    }
  });

  return client;
}

export function subscribeThreadDetail(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): () => void {
  const client = getEnvironmentClient(environmentId);
  if (!client) return () => {};

  return client.orchestration.subscribeThread(
    { threadId },
    (item: OrchestrationThreadStreamItem) => {
      if (item.kind === "snapshot") {
        const t = item.snapshot.thread;
        const existing = getThreadDetail(threadId);
        setThreadDetail(threadId, {
          ...existing,
          threadId,
          messages: t.messages.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text,
            streaming: m.streaming,
            turnId: m.turnId,
            createdAt: m.createdAt,
          })),
          plans: t.proposedPlans.map((p) => ({
            id: p.id,
            planMarkdown: p.planMarkdown,
            implementedAt: p.implementedAt,
            turnId: p.turnId,
            implementationThreadId: p.implementationThreadId,
          })),
          activities: t.activities.map((a) => ({
            id: a.id,
            summary: a.summary,
            turnId: a.turnId,
            createdAt: a.createdAt,
          })),
          checkpoints: t.checkpoints.map((c) => ({
            turnId: c.turnId,
            checkpointTurnCount: c.checkpointTurnCount,
            files: c.files.map(
              (f): CheckpointFile => ({
                path: f.path,
                kind: f.kind,
                additions: f.additions,
                deletions: f.deletions,
                hasStat: true,
              }),
            ),
            assistantMessageId: c.assistantMessageId,
            completedAt: c.completedAt,
          })),
          status: t.session?.status ?? "idle",
          hasPendingApprovals:
            t.session?.status === "interrupted"
              ? t.messages.some((m) => m.role === "assistant")
              : false,
          hasPendingUserInput: false,
          isPending: false,
          error: null,
        });
      }
    },
  );
}

export async function reconnectEnvironmentClient(environmentId: EnvironmentId): Promise<void> {
  const entry = clients.get(environmentId);
  if (!entry?.client) return;
  await entry.client.reconnect();
}
