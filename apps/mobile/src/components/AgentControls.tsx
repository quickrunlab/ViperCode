import React, { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme/index.ts";

interface Props {
  readonly status: string;
  readonly onStop: () => void;
  readonly onRetry: () => void;
}

function isRunning(status: string): boolean {
  return status === "running" || status === "starting";
}

function canRetry(status: string): boolean {
  return status === "error" || status === "stopped" || status === "interrupted";
}

export function AgentControls({ status, onStop, onRetry }: Props) {
  const [confirming, setConfirming] = useState(false);

  const handleStop = useCallback(() => {
    if (confirming) {
      onStop();
      setConfirming(false);
    } else {
      Alert.alert(
        "Stop Agent",
        "Are you sure you want to stop the running agent? This will interrupt the current turn.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Stop", style: "destructive", onPress: onStop },
        ],
      );
    }
  }, [confirming, onStop]);

  const handleRetry = useCallback(() => {
    onRetry();
  }, [onRetry]);

  return (
    <View style={styles.container}>
      {isRunning(status) && (
        <Pressable style={styles.stopButton} onPress={handleStop}>
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      )}
      {canRetry(status) && (
        <Pressable style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  stopButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.error,
    borderRadius: theme.radius.button,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  stopText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.error,
    fontFamily: theme.font.sans,
  },
  retryButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.button,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  retryText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primaryForeground,
    fontFamily: theme.font.sans,
  },
});
