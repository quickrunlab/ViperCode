import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { EnvironmentId, ThreadId } from "@vipercode/contracts";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import type { RootStackParamList } from "../navigation/AppNavigator.tsx";
import { theme } from "../../theme/index.ts";
import { useShellSnapshot } from "../../shell/useShellSnapshot.ts";
import type { ProviderStatus } from "../../components/ProviderStatusBanner.tsx";
import { getEnvironmentClient } from "../../connections/environmentClient.ts";

type Props = NativeStackScreenProps<RootStackParamList, "EnvironmentThreads">;

function threadStatusColor(status: string): string {
  switch (status) {
    case "running":
    case "starting":
    case "ready":
      return theme.colors.success;
    case "interrupted":
      return theme.colors.warning;
    case "error":
    case "stopped":
      return theme.colors.error;
    default:
      return theme.colors.textMuted;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "ready":
      return "Ready";
    case "interrupted":
      return "Paused";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
    default:
      return status;
  }
}

export function EnvironmentThreadsScreen({ navigation, route }: Props) {
  const { environmentId } = route.params;
  const shell = useShellSnapshot(environmentId as EnvironmentId);

  useEffect(() => {
    // Shell state is populated by the connection layer via setShellState.
  }, [environmentId]);

  const providers: ReadonlyArray<ProviderStatus> = useMemo(() => [], []);

  const [_providersForNav, setProvidersForNav] = useState<ReadonlyArray<ProviderStatus>>([]);

  useEffect(() => {
    const eid = environmentId as EnvironmentId;
    const client = getEnvironmentClient(eid);
    if (!client) return;
    const unsub = client.server.subscribeConfig((event) => {
      if (event.type !== "snapshot") return;
      const provs = event.config.providers;
      if (!provs) return;
      const entries = Object.entries(provs);
      setProvidersForNav(
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
  }, [environmentId]);

  const headerRight = useCallback(
    () => (
      <Pressable
        onPress={() =>
          navigation.navigate("NewThread", {
            environmentId,
            label: route.params.label,
            projects: shell.projects.map((p) => ({
              id: p.id,
              title: p.title,
              workspaceRoot: p.workspaceRoot,
            })),
            providers: _providersForNav,
          })
        }
        hitSlop={8}
      >
        <Text style={styles.headerButton}>+ New</Text>
      </Pressable>
    ),
    [navigation, environmentId, route.params.label, shell.projects, providers],
  );

  useLayoutEffect(() => {
    navigation.setOptions({ headerRight });
  }, [navigation, headerRight]);

  const sections = useMemo(() => {
    if (shell.threads.length === 0) {
      return [];
    }
    const projectMap = new Map<string, string>();
    for (const project of shell.projects) {
      projectMap.set(project.id, project.title);
    }
    const grouped = new Map<string, typeof shell.threads>();
    for (const thread of shell.threads) {
      const projectTitle = projectMap.get(thread.projectId) ?? "Unknown Project";
      const existing = grouped.get(projectTitle);
      if (existing) {
        grouped.set(projectTitle, [...existing, thread]);
      } else {
        grouped.set(projectTitle, [thread]);
      }
    }
    return Array.from(grouped.entries()).map(([title, data]) => ({ title, data }));
  }, [shell]);

  if (shell.isPending && shell.threads.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>Loading...</Text>
        <Text style={styles.emptyHint}>Fetching projects and threads.</Text>
      </View>
    );
  }

  if (!shell.isPending && shell.threads.length === 0 && shell.error === null) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No Threads</Text>
        <Text style={styles.emptyHint}>
          No threads in this environment. Start a new thread from the web app.
        </Text>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderSectionHeader={({ section: { title } }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>{title}</Text>
        </View>
      )}
      renderItem={({ item }) => (
        <Pressable
          style={styles.threadRow}
          onPress={() =>
            navigation.navigate("ThreadDetail", {
              environmentId,
              threadId: item.id as ThreadId,
              title: item.title,
            })
          }
        >
          <View style={styles.threadInfo}>
            <Text style={styles.threadTitle}>{item.title}</Text>
            <Text style={styles.threadMeta}>
              {statusLabel(item.status)}
              {item.hasPendingApprovals ? " · Needs Approval" : ""}
              {item.hasPendingUserInput ? " · Needs Input" : ""}
            </Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: threadStatusColor(item.status) }]} />
        </Pressable>
      )}
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: theme.spacing.lg,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing.lg,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    fontFamily: theme.font.sans,
  },
  emptyHint: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: "center",
    fontFamily: theme.font.sans,
  },
  sectionHeader: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: theme.font.sans,
  },
  threadRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  threadInfo: {
    flex: 1,
  },
  threadTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.text,
    fontFamily: theme.font.sans,
  },
  threadMeta: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontFamily: theme.font.sans,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: theme.spacing.sm,
  },
  headerButton: {
    color: theme.colors.primary,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: theme.font.sans,
  },
});
