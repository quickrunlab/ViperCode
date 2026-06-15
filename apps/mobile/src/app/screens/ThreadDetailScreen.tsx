import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { EnvironmentId, ProviderApprovalDecision, ThreadId } from "@vipercode/contracts";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RootStackParamList } from "../navigation/AppNavigator.tsx";
import { theme } from "../../theme/index.ts";
import { useThreadDetail, setThreadDetail } from "../../thread/useThreadDetail.ts";
import type { ThreadMessage } from "../../thread/threadTypes.ts";
import { EMPTY_THREAD_DETAIL } from "../../thread/threadTypes.ts";
import { MessageBubble } from "../../components/MessageBubble.tsx";
import { Composer } from "../../components/Composer.tsx";
import { ApprovalCard } from "../../components/ApprovalCard.tsx";
import { UserInputCard } from "../../components/UserInputCard.tsx";
import { PlanCard } from "../../components/PlanCard.tsx";
import { AgentControls } from "../../components/AgentControls.tsx";
import type { ProviderStatus } from "../../components/ProviderStatusBanner.tsx";
import { ProviderStatusBanner } from "../../components/ProviderStatusBanner.tsx";
import { ChangedFilesSection } from "../../components/ChangedFilesSection.tsx";
import { DiffView } from "../../components/DiffView.tsx";
import type { DiffFileEntry } from "../../thread/threadTypes.ts";
import {
  getEnvironmentClient,
  subscribeThreadDetail,
} from "../../connections/environmentClient.ts";
import { useConnectionService } from "../../connections/ConnectionProvider.tsx";

type Props = NativeStackScreenProps<RootStackParamList, "ThreadDetail">;

function newId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function ThreadDetailScreen({ navigation, route }: Props) {
  const { environmentId, threadId, title } = route.params;
  const tid = threadId as ThreadId;
  const eid = environmentId as EnvironmentId;
  const detail = useThreadDetail(tid);
  const flatListRef = useRef<FlatList<ThreadMessage>>(null);
  const [sending, setSending] = useState(false);
  const [sendGuard, setSendGuard] = useState<string | null>(null);
  const [viewingDiffTurn, setViewingDiffTurn] = useState<string | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<ReadonlyArray<ProviderStatus>>([]);
  const service = useConnectionService();

  const scrollToEnd = useCallback(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
  }, []);

  useEffect(() => {
    navigation.setOptions({ title: title || "Thread" });
    setThreadDetail(tid, { ...EMPTY_THREAD_DETAIL, threadId: tid, isPending: true });

    const unsub = subscribeThreadDetail(eid, tid);

    return () => {
      unsub();
    };
  }, [eid, tid, title, navigation]);

  useEffect(() => {
    const client = getEnvironmentClient(eid);
    if (!client) return;
    const unsub = client.server.subscribeConfig((event) => {
      if (event.type !== "snapshot") return;
      const providers = event.config.providers;
      if (!providers) return;
      const entries = Object.entries(providers);
      setProviderStatuses(
        entries.map(([instanceId, p]) => ({
          instanceId,
          label: p.displayName ?? p.driver,
          driverLabel: p.driver,
          availability:
            p.status === "ready"
              ? ("ready" as const)
              : p.status === "disabled" || !p.enabled
                ? ("needs-setup" as const)
                : ("unavailable" as const),
          message: p.auth?.status === "unauthenticated" ? "Auth required" : null,
        })),
      );
    });
    return () => unsub();
  }, [eid]);

  const dispatchCommand = useCallback(
    async (command: Record<string, unknown>) => {
      const client = getEnvironmentClient(eid);
      if (!client) return;
      await client.orchestration.dispatchCommand(command as never);
    },
    [eid],
  );

  const handleSend = useCallback(
    (text: string) => {
      if (sending || sendGuard === text) return;

      setSending(true);
      setSendGuard(text);

      const messageId = newId();
      const commandId = newId();

      void dispatchCommand({
        type: "thread.turn.start",
        commandId,
        threadId: tid,
        message: {
          messageId,
          role: "user",
          text,
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      }).finally(() => {
        setTimeout(() => {
          setSending(false);
          setSendGuard(null);
          scrollToEnd();
        }, 300);
      });
    },
    [tid, dispatchCommand, scrollToEnd, sending, sendGuard],
  );

  const handleApprovalRespond = useCallback(
    (requestId: string, decision: ProviderApprovalDecision) => {
      void dispatchCommand({
        type: "thread.approval.respond",
        commandId: newId(),
        threadId: tid,
        requestId,
        decision,
        createdAt: new Date().toISOString(),
      });
    },
    [tid, dispatchCommand],
  );

  const handleUserInputSubmit = useCallback(
    (requestId: string, answers: Record<string, unknown>) => {
      void dispatchCommand({
        type: "thread.user-input.respond",
        commandId: newId(),
        threadId: tid,
        requestId,
        answers,
        createdAt: new Date().toISOString(),
      });
    },
    [tid, dispatchCommand],
  );

  const handleStop = useCallback(() => {
    void dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newId(),
      threadId: tid,
      createdAt: new Date().toISOString(),
    });
  }, [tid, dispatchCommand]);

  const handleRetry = useCallback(() => {
    void service.reconnectEnvironment(eid);
  }, [eid, service]);

  const handleOpenDiff = useCallback(
    async (turnId: string, _filePath?: string) => {
      const client = getEnvironmentClient(eid);
      if (!client) return;
      setViewingDiffTurn(turnId);
      try {
        const result = await client.orchestration.getFullThreadDiff({
          threadId: tid,
          toTurnCount: 1,
        });
        const current = { ...detail };
        setThreadDetail(tid, {
          ...current,
          activeTurnDiff: {
            turnId,
            isPending: false,
            files: [
              {
                path: result.threadId as unknown as string,
                diff: result.diff,
                truncated: false,
              },
            ],
            error: null,
          },
        });
      } catch {
        // diff fetch failed, show empty diff
      }
    },
    [eid, tid, detail],
  );

  const handleCloseDiff = useCallback(() => {
    setViewingDiffTurn(null);
  }, []);

  const messages = detail.messages.length > 0 ? detail.messages : [];

  const hasControls =
    detail.pendingApprovals.length > 0 ||
    detail.pendingUserInputs.length > 0 ||
    detail.plans.length > 0 ||
    detail.checkpoints.length > 0;

  const renderHeader = useCallback(() => {
    if (detail.isPending && !hasControls) return null;

    return (
      <View>
        <ProviderStatusBanner providers={providerStatuses} />
        <AgentControls status={detail.status} onStop={handleStop} onRetry={handleRetry} />
        {detail.pendingApprovals.map((approval) => (
          <ApprovalCard
            key={approval.requestId as string}
            approval={approval}
            onRespond={handleApprovalRespond}
          />
        ))}
        {detail.pendingUserInputs.map((input) => (
          <UserInputCard
            key={input.requestId as string}
            userInput={input}
            onSubmit={handleUserInputSubmit}
          />
        ))}
        {detail.plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
        {detail.checkpoints.map((cp) => (
          <ChangedFilesSection
            key={`checkpoint:${cp.turnId}`}
            turnId={cp.turnId}
            files={cp.files}
            onOpenDiff={handleOpenDiff}
          />
        ))}
      </View>
    );
  }, [
    detail,
    hasControls,
    providerStatuses,
    handleApprovalRespond,
    handleUserInputSubmit,
    handleStop,
    handleRetry,
    handleOpenDiff,
  ]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {detail.isPending && messages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading thread...</Text>
        </View>
      ) : messages.length === 0 && !hasControls ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>No messages yet.</Text>
          <Text style={styles.loadingHint}>Send a message to start the conversation.</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={scrollToEnd}
          onLayout={scrollToEnd}
          windowSize={5}
          maxToRenderPerBatch={10}
          initialNumToRender={15}
          removeClippedSubviews
          getItemLayout={(_data, index) => ({
            length: 60,
            offset: 60 * index,
            index,
          })}
        />
      )}
      <Composer onSend={handleSend} disabled={sending} />
      {viewingDiffTurn !== null && (
        <Modal
          visible
          animationType="slide"
          onRequestClose={handleCloseDiff}
          presentationStyle="fullScreen"
        >
          <DiffView
            turnId={viewingDiffTurn}
            files={resolveDiffFiles(viewingDiffTurn, detail)}
            onClose={handleCloseDiff}
          />
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

function resolveDiffFiles(
  turnId: string,
  detail: ReturnType<typeof useThreadDetail>,
): ReadonlyArray<DiffFileEntry> {
  if (detail.activeTurnDiff?.turnId === turnId) {
    return detail.activeTurnDiff.files;
  }
  const cp = detail.checkpoints.find((c) => c.turnId === turnId);
  if (!cp) return [];

  return cp.files.map((f) => ({
    path: f.path,
    diff: `--- a/${f.path}\n+++ b/${f.path}\n@@ -0,0 +1,${f.additions} @@\n${"+".repeat(Math.min(f.additions, 5))}\n--- unchanged ---`,
    truncated: true,
  }));
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  messageList: {
    paddingVertical: theme.spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing.lg,
  },
  loadingText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
    fontFamily: theme.font.sans,
  },
  loadingHint: {
    fontSize: 13,
    color: theme.colors.textMuted,
    textAlign: "center",
    fontFamily: theme.font.sans,
  },
});
