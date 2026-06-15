import React, { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { theme } from "../theme/index.ts";

interface Props {
  readonly onSend: (text: string) => void;
  readonly disabled?: boolean;
}

export function Composer({ onSend, disabled }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<TextInput>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    inputRef.current?.clear();
  }, [text, onSend, disabled]);

  return (
    <View style={styles.container}>
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Type a message..."
        placeholderTextColor={theme.colors.textMuted}
        multiline
        editable={!disabled}
        autoCapitalize="sentences"
        autoCorrect
      />
      <Pressable
        style={[styles.sendButton, (!text.trim() || disabled) && styles.sendButtonDisabled]}
        onPress={handleSend}
        disabled={!text.trim() || disabled}
      >
        <Text style={[styles.sendText, (!text.trim() || disabled) && styles.sendTextDisabled]}>
          Send
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    color: theme.colors.text,
    fontSize: 15,
    maxHeight: 120,
    marginRight: theme.spacing.sm,
    fontFamily: theme.font.sans,
  },
  sendButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    justifyContent: "center",
    minHeight: 40,
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    opacity: 0.5,
  },
  sendText: {
    color: theme.colors.primaryForeground,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: theme.font.sans,
  },
  sendTextDisabled: {
    color: theme.colors.textMuted,
  },
});
