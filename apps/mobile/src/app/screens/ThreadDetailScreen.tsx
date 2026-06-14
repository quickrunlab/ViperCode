import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ProviderApprovalDecision, ThreadId } from "@vipercode/contracts";
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

type Props = NativeStackScreenProps<RootStackParamList, "ThreadDetail">;

function generateMessageId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function ThreadDetailScreen({ navigation, route }: Props) {
  const { threadId, title } = route.params;
  const tid = threadId as ThreadId;
  const detail = useThreadDetail(tid);
  const flatListRef = useRef<FlatList<ThreadMessage>>(null);
  const [sending, setSending] = useState(false);
  const [sendGuard, setSendGuard] = useState<string | null>(null);
  const [viewingDiffTurn, setViewingDiffTurn] = useState<string | null>(null);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
  }, []);

  useEffect(() => {
    navigation.setOptions({ title: title || "Thread" });
    setThreadDetail(tid, { ...EMPTY_THREAD_DETAIL, threadId: tid, isPending: true });
    scrollToEnd();
  }, [tid, title, navigation, scrollToEnd]);

  const handleSend = useCallback(
    (text: string) => {
      if (sending || sendGuard === text) return;

      setSending(true);
      setSendGuard(text);

      const now = new Date().toISOString();
      const messageId = generateMessageId();
      const userMessage: ThreadMessage = {
        id: messageId,
        role: "user",
        text,
        streaming: false,
        turnId: null,
        createdAt: now,
      };

      const current = { ...detail };
      if (current.messages.length === 0 && current.threadId === ("" as ThreadId)) {
        current.threadId = tid;
      }
      current.messages = [...current.messages, userMessage];
      setThreadDetail(tid, { ...current, isPending: false });

      setTimeout(() => {
        setSending(false);
        setSendGuard(null);
        scrollToEnd();
      }, 300);
    },
    [detail, tid, scrollToEnd, sending, sendGuard],
  );

  const handleApprovalRespond = useCallback(
    (_requestId: string, _decision: ProviderApprovalDecision) => {
      // TODO: dispatch ThreadApprovalRespondCommand via client RPC
      const current = { ...detail };
      setThreadDetail(tid, {
        ...current,
        hasPendingApprovals: false,
        pendingApprovals: [],
      });
    },
    [detail, tid],
  );

  const handleUserInputSubmit = useCallback(
    (_requestId: string, _answers: Record<string, unknown>) => {
      // TODO: dispatch ThreadUserInputRespondCommand via client RPC
      const current = { ...detail };
      setThreadDetail(tid, {
        ...current,
        hasPendingUserInput: false,
        pendingUserInputs: [],
      });
    },
    [detail, tid],
  );

  const handleStop = useCallback(() => {
    // TODO: dispatch ThreadTurnInterruptCommand via client RPC
  }, []);

  const handleRetry = useCallback(() => {
    // TODO: trigger reconnect for this environment
  }, []);

  const handleOpenDiff = useCallback((turnId: string, _filePath?: string) => {
    setViewingDiffTurn(turnId);
  }, []);

  const handleCloseDiff = useCallback(() => {
    setViewingDiffTurn(null);
  }, []);

  const messages = detail.messages.length > 0 ? detail.messages : [];

  const hasControls =
    detail.pendingApprovals.length > 0 ||
    detail.pendingUserInputs.length > 0 ||
    detail.plans.length > 0 ||
    detail.checkpoints.length > 0;

  const providerStatuses: ReadonlyArray<ProviderStatus> = [
    {
      instanceId: "codex",
      label: "Codex (OpenAI)",
      driverLabel: "codex",
      availability: "ready",
      message: null,
    },
    {
      instanceId: "claude_agent",
      label: "Claude Agent",
      driverLabel: "claude",
      availability: "unavailable",
      message: "API key required",
    },
  ];

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
    diff: `--- a/${f.path}\n+++ b/${f.path}\n@@ -0,0 +1,${f.additions} @@\n${"+placeholder line".repeat(Math.min(f.additions, 5)).split("placeholder").join("+\n")}`,
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
  },
  loadingHint: {
    fontSize: 13,
    color: theme.colors.textMuted,
    textAlign: "center",
  },
});
