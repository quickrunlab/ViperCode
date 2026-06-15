import type { ProviderApprovalDecision } from "@vipercode/contracts";
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme/index.ts";
import type { PendingApproval } from "../thread/threadTypes.ts";

interface Props {
  readonly approval: PendingApproval;
  readonly onRespond: (requestId: string, decision: ProviderApprovalDecision) => void;
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "command":
      return "Command";
    case "file-read":
      return "File Read";
    case "file-change":
      return "File Change";
    default:
      return kind;
  }
}

export function ApprovalCard({ approval, onRespond }: Props) {
  const [responding, setResponding] = useState(false);

  const handleRespond = useCallback(
    (decision: ProviderApprovalDecision) => {
      setResponding(true);
      onRespond(approval.requestId as string, decision);
    },
    [approval.requestId, onRespond],
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindText}>{kindLabel(approval.kind)}</Text>
        </View>
        <Text style={styles.label}>Approval Required</Text>
      </View>
      <Text style={styles.summary}>{approval.summary}</Text>
      <View style={styles.actions}>
        <Pressable
          style={[styles.actionButton, styles.acceptButton]}
          onPress={() => handleRespond("accept")}
          disabled={responding}
        >
          <Text style={styles.acceptText}>Accept</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, styles.acceptSessionButton]}
          onPress={() => handleRespond("acceptForSession")}
          disabled={responding}
        >
          <Text style={styles.acceptSessionText}>Accept All</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, styles.declineButton]}
          onPress={() => handleRespond("decline")}
          disabled={responding}
        >
          <Text style={styles.declineText}>Decline</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.warning,
    borderRadius: theme.radius.card,
    padding: theme.spacing.md,
    marginHorizontal: theme.spacing.md,
    marginVertical: theme.spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.sm,
  },
  kindBadge: {
    backgroundColor: theme.colors.warning,
    borderRadius: theme.spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: theme.spacing.sm,
  },
  kindText: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.background,
    textTransform: "uppercase",
    fontFamily: theme.font.sans,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.text,
    fontFamily: theme.font.sans,
  },
  summary: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
    lineHeight: 18,
    fontFamily: theme.font.sans,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  actionButton: {
    flex: 1,
    borderRadius: theme.radius.button,
    paddingVertical: theme.spacing.sm,
    alignItems: "center",
  },
  acceptButton: {
    backgroundColor: theme.colors.success,
  },
  acceptSessionButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.success,
  },
  declineButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  acceptText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primaryForeground,
    fontFamily: theme.font.sans,
  },
  acceptSessionText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.success,
    fontFamily: theme.font.sans,
  },
  declineText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.error,
    fontFamily: theme.font.sans,
  },
});
