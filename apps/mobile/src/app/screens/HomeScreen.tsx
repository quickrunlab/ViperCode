import { useAuth } from "@clerk/clerk-expo";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { RootStackParamList } from "../navigation/AppNavigator.tsx";
import { theme } from "../../theme/index.ts";
import { loadKnownEnvironments } from "../../storage/environmentStore.ts";
import type {
  MobileKnownEnvironmentRecord,
  MobileConnectionState,
} from "../../runtime/clientRuntimeImports.ts";
import { useRelayEnvironments } from "../../runtime/useRelayEnvironments.ts";
import { useConnectionStore, useConnectionService } from "../../connections/ConnectionProvider.tsx";
import { hasRelayConfig } from "../../runtime/mobileRuntime.ts";
import { resolveMobilePublicConfig } from "../../runtime/resolveConfig.ts";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

function statusColor(state: MobileConnectionState): string {
  switch (state) {
    case "connected":
      return theme.colors.success;
    case "connecting":
    case "reconnecting":
      return theme.colors.warning;
    case "error":
    case "requires-auth":
      return theme.colors.error;
    default:
      return theme.colors.textMuted;
  }
}

export function HomeScreen({ navigation }: Props) {
  const { isSignedIn } = useAuth();
  const store = useConnectionStore();
  const service = useConnectionService();
  const relay = useRelayEnvironments();
  const [pairedEnvs, setPairedEnvs] = useState<ReadonlyArray<MobileKnownEnvironmentRecord>>([]);

  const entries = useMemo(() => store.getAll(), [store]);

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setPairedEnvs((prev) => prev);
    });
    void loadKnownEnvironments().then(setPairedEnvs);
    return () => unsubscribe();
  }, [store]);

  const hasRelay = hasRelayConfig && isSignedIn;
  const hasPaired = pairedEnvs.length > 0;
  const hasRelayEnvs = relay.data !== null && relay.data.length > 0;
  const isEmpty = !hasPaired && (!hasRelay || !hasRelayEnvs);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.title}>Viper Code</Text>
          {isSignedIn ? (
            <>
              <Text style={styles.subtitle}>No environments yet.</Text>
              <Text style={styles.hint}>
                {hasRelayConfig
                  ? "Enable Viper Connect on your PC under Settings > Connections, or pair manually below."
                  : "Relay is not configured. Pair manually using a QR code or pairing URL."}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.subtitle}>Sign in to see your environments.</Text>
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={[
            ...pairedEnvs,
            ...(relay.data ?? []).map((re) => ({
              version: 1 as const,
              environmentId: re.environmentId as MobileKnownEnvironmentRecord["environmentId"],
              label: re.label,
              httpBaseUrl: re.endpoint.httpBaseUrl,
              wsBaseUrl: re.endpoint.wsBaseUrl,
              createdAt: re.linkedAt,
              lastConnectedAt: null,
              relayManaged: { relayUrl: resolveMobilePublicConfig().relayUrl ?? "" },
            })),
          ]}
          keyExtractor={(item) => item.environmentId}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const entry = entries.find((e) => e.environmentId === item.environmentId);
            const state = entry?.state ?? "idle";
            return (
              <Pressable
                style={styles.envRow}
                onPress={() => {
                  if (state === "connected") {
                    void service.disconnectEnvironment(item.environmentId);
                  } else if (state === "idle" || state === "error" || state === "requires-auth") {
                    void service.connectEnvironment(item.environmentId);
                  }
                }}
              >
                <View style={styles.envInfo}>
                  <Text style={styles.envLabel}>{item.label}</Text>
                  <Text style={styles.envUrl}>{item.httpBaseUrl}</Text>
                  {entry?.error ? <Text style={styles.envError}>{entry.error}</Text> : null}
                </View>
                <View style={[styles.envStatus, { backgroundColor: statusColor(state) }]} />
              </Pressable>
            );
          }}
        />
      )}

      {isSignedIn ? null : (
        <Text style={styles.signInHint}>Sign in to see relay-connected environments.</Text>
      )}

      <Pressable style={styles.pairButton} onPress={() => navigation.navigate("Pair")}>
        <Text style={styles.pairButtonText}>Pair Environment</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: "center",
    marginBottom: theme.spacing.md,
  },
  hint: {
    fontSize: 13,
    color: theme.colors.textMuted,
    textAlign: "center",
  },
  signInHint: {
    fontSize: 12,
    color: theme.colors.textMuted,
    textAlign: "center",
    paddingBottom: theme.spacing.sm,
  },
  listContent: {
    padding: theme.spacing.md,
  },
  envRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  envInfo: {
    flex: 1,
  },
  envLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.text,
  },
  envUrl: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  envError: {
    fontSize: 11,
    color: theme.colors.error,
    marginTop: 2,
  },
  envStatus: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: theme.spacing.sm,
  },
  pairButton: {
    backgroundColor: theme.colors.primary,
    margin: theme.spacing.md,
    borderRadius: 8,
    padding: theme.spacing.md,
    alignItems: "center",
  },
  pairButtonText: {
    color: theme.colors.background,
    fontSize: 15,
    fontWeight: "600",
  },
});
