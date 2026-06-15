import React, { useCallback } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme/index.ts";

export interface ModelOption {
  readonly instanceId: string;
  readonly label: string;
  readonly model: string;
}

interface Props {
  readonly visible: boolean;
  readonly options: ReadonlyArray<ModelOption>;
  readonly selected: ModelOption | null;
  readonly onSelect: (option: ModelOption) => void;
  readonly onClose: () => void;
}

export function ModelPickerSheet({ visible, options, selected, onSelect, onClose }: Props) {
  const handleSelect = useCallback(
    (option: ModelOption) => {
      onSelect(option);
      onClose();
    },
    [onSelect, onClose],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Select Model</Text>
          <ScrollView
            style={styles.scrollArea}
            bounces={false}
            contentContainerStyle={styles.optionsContainer}
          >
            {options.map((option) => {
              const isSelected =
                selected?.instanceId === option.instanceId && selected?.model === option.model;
              return (
                <Pressable
                  key={`${option.instanceId}:${option.model}`}
                  style={[styles.option, isSelected && styles.optionSelected]}
                  onPress={() => handleSelect(option)}
                >
                  <View style={styles.optionInfo}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    <Text style={styles.optionModel}>{option.model}</Text>
                  </View>
                  {isSelected && (
                    <View style={styles.checkmark}>
                      <Text style={styles.checkmarkText}>✓</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "60%",
    paddingBottom: theme.spacing.xl,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    fontFamily: theme.font.sans,
  },
  scrollArea: {
    maxHeight: "100%",
  },
  optionsContainer: {
    paddingHorizontal: theme.spacing.lg,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  optionSelected: {
    backgroundColor: theme.colors.surfaceElevated,
    marginHorizontal: -theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
  },
  optionInfo: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.text,
    fontFamily: theme.font.sans,
  },
  optionModel: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 2,
    fontFamily: theme.font.sans,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmarkText: {
    fontSize: 14,
    color: theme.colors.primaryForeground,
    fontWeight: "700",
    fontFamily: theme.font.sans,
  },
});
