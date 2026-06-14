import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { RootStackParamList } from "../navigation/AppNavigator.tsx";
import { theme } from "../../theme/index.ts";
import { loadKnownEnvironments } from "../../storage/environmentStore.ts";
import type { MobileKnownEnvironmentRecord } from "../../runtime/clientRuntimeImports.ts";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  const [environments, setEnvironments] = useState<ReadonlyArray<MobileKnownEnvironmentRecord>>([]);

  const refresh = useCallback(async () => {
    const list = await loadKnownEnvironments();
    setEnvironments(list);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <View style={styles.container}>
      {/* oxlint-disable-next-line react/style-prop-object -- expo-status-bar uses string style */}
      <StatusBar style="light" />

      {environments.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.title}>Viper Code</Text>
          <Text style={styles.subtitle}>No environments paired yet.</Text>
          <Text style={styles.hint}>Pair with your PC using a QR code or paste a pairing URL.</Text>
        </View>
      ) : (
        <FlatList
          data={environments}
          keyExtractor={(item) => item.environmentId}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.envRow}>
              <View style={styles.envInfo}>
                <Text style={styles.envLabel}>{item.label}</Text>
                <Text style={styles.envUrl}>{item.httpBaseUrl}</Text>
              </View>
              <View style={styles.envStatus} />
            </View>
          )}
        />
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
  envStatus: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.textMuted,
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
