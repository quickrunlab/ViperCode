import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme/index.ts";
import type { CheckpointFile } from "../thread/threadTypes.ts";
import { type FileTreeNode, buildFileTree } from "../lib/turnDiffTree.ts";

interface Props {
  readonly turnId: string;
  readonly files: ReadonlyArray<CheckpointFile>;
  readonly onOpenDiff: (turnId: string, filePath?: string) => void;
}

function StatBadge({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <View style={styles.statRow}>
      <Text style={styles.statAdditions}>+{additions}</Text>
      <Text style={styles.statSeparator}>/</Text>
      <Text style={styles.statDeletions}>-{deletions}</Text>
    </View>
  );
}

export function ChangedFilesSection({ turnId, files, onOpenDiff }: Props) {
  const treeNodes = React.useMemo(() => buildFileTree(files), [files]);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(true);

  const totalStat = React.useMemo(() => {
    return files.reduce(
      (acc, f) => ({
        additions: acc.additions + (f.hasStat ? f.additions : 0),
        deletions: acc.deletions + (f.hasStat ? f.deletions : 0),
      }),
      { additions: 0, deletions: 0 },
    );
  }, [files]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => ({ ...prev, [path]: !(prev[path] ?? true) }));
  }, []);

  const toggleAll = useCallback(() => {
    setAllExpanded((prev) => {
      if (!prev) setExpandedDirs({});
      return !prev;
    });
  }, []);

  const isExpanded = useCallback(
    (path: string) => expandedDirs[path] ?? allExpanded,
    [expandedDirs, allExpanded],
  );

  const renderNode = useCallback(
    (node: FileTreeNode, depth: number): React.ReactNode => {
      const leftPad = 8 + depth * 14;
      if (node.kind === "directory") {
        const expanded = isExpanded(node.path);
        return (
          <View key={`dir:${node.path}`}>
            <Pressable
              style={[styles.nodeRow, { paddingLeft: leftPad }]}
              onPress={() => toggleDir(node.path)}
            >
              <Text style={styles.chevron}>{expanded ? "▼" : "▶"}</Text>
              <Text style={styles.folderIcon}>{expanded ? "📂" : "📁"}</Text>
              <Text style={styles.dirName} numberOfLines={1}>
                {node.name}
              </Text>
              <StatBadge additions={node.stat.additions} deletions={node.stat.deletions} />
            </Pressable>
            {expanded && <View>{node.children.map((child) => renderNode(child, depth + 1))}</View>}
          </View>
        );
      }

      return (
        <Pressable
          key={`file:${node.path}`}
          style={[styles.nodeRow, { paddingLeft: leftPad + 16 }]}
          onPress={() => onOpenDiff(turnId, node.path)}
        >
          <Text style={styles.fileName} numberOfLines={1}>
            {node.name}
          </Text>
          <StatBadge additions={node.stat.additions} deletions={node.stat.deletions} />
        </Pressable>
      );
    },
    [isExpanded, toggleDir, turnId, onOpenDiff],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Changed files ({files.length})</Text>
        <View style={styles.headerStats}>
          {totalStat.additions > 0 || totalStat.deletions > 0 ? (
            <StatBadge additions={totalStat.additions} deletions={totalStat.deletions} />
          ) : null}
          <Pressable onPress={toggleAll} style={styles.toggleButton}>
            <Text style={styles.toggleText}>{allExpanded ? "Collapse" : "Expand"}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.tree}>{treeNodes.map((node) => renderNode(node, 0))}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    marginHorizontal: theme.spacing.md,
    marginVertical: theme.spacing.xs,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  headerText: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  headerStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  toggleButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  toggleText: {
    fontSize: 10,
    color: theme.colors.textMuted,
    fontWeight: "600",
  },
  tree: {
    paddingVertical: theme.spacing.xs,
  },
  nodeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingRight: theme.spacing.md,
    gap: 4,
  },
  chevron: {
    fontSize: 8,
    color: theme.colors.textMuted,
    width: 12,
    textAlign: "center",
  },
  folderIcon: {
    fontSize: 12,
    width: 16,
    textAlign: "center",
  },
  dirName: {
    flex: 1,
    fontSize: 12,
    fontWeight: "500",
    color: theme.colors.textSecondary,
  },
  fileName: {
    flex: 1,
    fontSize: 12,
    color: theme.colors.text,
    fontFamily: "monospace",
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  statAdditions: {
    fontSize: 10,
    color: theme.colors.success,
    fontFamily: "monospace",
  },
  statSeparator: {
    fontSize: 10,
    color: theme.colors.textMuted,
    marginHorizontal: 1,
  },
  statDeletions: {
    fontSize: 10,
    color: theme.colors.error,
    fontFamily: "monospace",
  },
});
