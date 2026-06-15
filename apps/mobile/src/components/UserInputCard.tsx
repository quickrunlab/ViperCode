import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { theme } from "../theme/index.ts";
import type { PendingUserInput } from "../thread/threadTypes.ts";

interface Props {
  readonly userInput: PendingUserInput;
  readonly onSubmit: (requestId: string, answers: Record<string, unknown>) => void;
}

export function UserInputCard({ userInput, onSubmit }: Props) {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = useCallback(() => {
    if (!text.trim() || submitted) return;
    setSubmitted(true);
    onSubmit(userInput.requestId as string, { response: text.trim() });
  }, [text, submitted, userInput.requestId, onSubmit]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindText}>Input</Text>
        </View>
        <Text style={styles.label}>User Input Needed</Text>
      </View>
      <Text style={styles.prompt}>{userInput.prompt}</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Enter your response..."
        placeholderTextColor={theme.colors.textMuted}
        multiline
        editable={!submitted}
        autoCapitalize="sentences"
      />
      <View style={styles.actions}>
        <Pressable
          style={[styles.submitButton, (!text.trim() || submitted) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!text.trim() || submitted}
        >
          <Text style={styles.submitText}>Submit</Text>
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
  prompt: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
    lineHeight: 18,
    fontFamily: theme.font.sans,
  },
  input: {
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    padding: theme.spacing.md,
    color: theme.colors.text,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: theme.spacing.md,
    fontFamily: theme.font.sans,
  },
  actions: {
    flexDirection: "row",
  },
  submitButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.button,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    alignItems: "center",
  },
  submitButtonDisabled: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    opacity: 0.5,
  },
  submitText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primaryForeground,
    fontFamily: theme.font.sans,
  },
});
