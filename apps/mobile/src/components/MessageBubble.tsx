import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme/index.ts";
import type { ThreadMessage } from "../thread/threadTypes.ts";

interface Props {
  readonly message: ThreadMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.text, isUser ? styles.userText : styles.assistantText]}>
          {message.text}
        </Text>
        {message.streaming && <Text style={styles.streamingBadge}>streaming</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  userContainer: {
    alignItems: "flex-end",
  },
  assistantContainer: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: theme.radius.card,
    padding: theme.spacing.md,
  },
  userBubble: {
    backgroundColor: theme.colors.primary,
  },
  assistantBubble: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: theme.font.sans,
  },
  userText: {
    color: theme.colors.primaryForeground,
  },
  assistantText: {
    color: theme.colors.text,
  },
  streamingBadge: {
    fontSize: 10,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
    fontFamily: theme.font.sans,
  },
});
