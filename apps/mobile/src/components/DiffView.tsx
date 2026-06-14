import React, { useCallback, useRef } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme/index.ts";
import type { DiffFileEntry } from "../thread/threadTypes.ts";

interface Props {
  readonly turnId: string;
  readonly files: ReadonlyArray<DiffFileEntry>;
  readonly onClose: () => void;
}

const MAX_PREVIEW_LINES = 300;

function renderDiffLines(diff: string): string[] {
  const lines = diff.split("\n");
  if (lines.length > MAX_PREVIEW_LINES) {
    return [
      ...lines.slice(0, MAX_PREVIEW_LINES),
      `... ${lines.length - MAX_PREVIEW_LINES} more lines truncated ...`,
    ];
  }
  return lines;
}

function diffLineColor(line: string): string | undefined {
  if (line.startsWith("+") && !line.startsWith("+++")) return theme.colors.success;
  if (line.startsWith("-") && !line.startsWith("---")) return theme.colors.error;
  if (line.startsWith("@@")) return theme.colors.primary;
  return undefined;
}

function diffLineBg(line: string): string | undefined {
  if (line.startsWith("+") && !line.startsWith("+++")) return "rgba(63,185,80,0.08)";
  if (line.startsWith("-") && !line.startsWith("---")) return "rgba(248,81,73,0.08)";
  return undefined;
}

export function DiffView({ files, onClose }: Props) {
  const scrollRef = useRef<ScrollView>(null);

  const handleShare = useCallback(async (file: DiffFileEntry) => {
    try {
      await Share.share({ message: file.diff, title: file.path });
    } catch {
      // share cancelled
    }
  }, []);

  const handleCopyPath = useCallback(async (file: DiffFileEntry) => {
    try {
      await Share.share({ message: file.path });
    } catch {
      // copy cancelled
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Diff Preview</Text>
        <Pressable onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>

      <ScrollView ref={scrollRef} style={styles.scrollArea}>
        {files.map((file) => (
          <View key={file.path} style={styles.fileSection}>
            <View style={styles.fileHeader}>
              <Text style={styles.filePath} numberOfLines={2}>
                {file.path}
              </Text>
              <View style={styles.fileActions}>
                <Pressable onPress={() => handleCopyPath(file)} style={styles.actionButton}>
                  <Text style={styles.actionText}>Copy Path</Text>
                </Pressable>
                <Pressable onPress={() => handleShare(file)} style={styles.actionButton}>
                  <Text style={styles.actionText}>Share</Text>
                </Pressable>
              </View>
              {file.truncated && <Text style={styles.truncatedBadge}>Truncated</Text>}
            </View>

            <ScrollView horizontal bounces={false} style={styles.diffScroll}>
              <View>
                {renderDiffLines(file.diff).map((line, idx) => (
                  <View
                    key={`d${file.path.length}_${idx}`}
                    style={[
                      styles.diffLine,
                      diffLineBg(line) ? { backgroundColor: diffLineBg(line) } : undefined,
                    ]}
                  >
                    <Text
                      style={[
                        styles.diffText,
                        diffLineColor(line) ? { color: diffLineColor(line) } : undefined,
                      ]}
                    >
                      {line || " "}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.text,
  },
  closeButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 6,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  closeText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  scrollArea: {
    flex: 1,
  },
  fileSection: {
    marginBottom: theme.spacing.md,
  },
  fileHeader: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  filePath: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.text,
    fontFamily: "monospace",
    marginBottom: theme.spacing.xs,
  },
  fileActions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  actionButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionText: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  truncatedBadge: {
    fontSize: 10,
    color: theme.colors.warning,
    fontWeight: "600",
    marginTop: theme.spacing.xs,
  },
  diffScroll: {
    backgroundColor: theme.colors.surface,
  },
  diffLine: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 1,
  },
  diffText: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: "monospace",
    lineHeight: 18,
  },
});
