import { useAuth, useUser } from "@clerk/clerk-expo";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RootStackParamList } from "../navigation/AppNavigator.tsx";
import { theme } from "../../theme/index.ts";
import { useConnectionService } from "../../connections/ConnectionProvider.tsx";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

export function SettingsScreen(_props: Props) {
  const { signOut } = useAuth();
  const { user } = useUser();
  const service = useConnectionService();

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        {user ? (
          <View style={styles.accountRow}>
            <Text style={styles.accountLabel}>
              {user.emailAddresses?.[0]?.emailAddress ?? "Signed in"}
            </Text>
            <Text style={styles.accountId}>ID: {user.id}</Text>
          </View>
        ) : null}
      </View>

      <Pressable
        style={styles.signOutButton}
        onPress={async () => {
          service.dispose();
          await signOut();
        }}
      >
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
  },
  section: {
    marginBottom: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.textMuted,
    textTransform: "uppercase",
    marginBottom: theme.spacing.sm,
  },
  accountRow: {
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  accountLabel: {
    fontSize: 15,
    color: theme.colors.text,
  },
  accountId: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  signOutButton: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.error,
    borderRadius: 8,
    padding: theme.spacing.md,
    alignItems: "center",
  },
  signOutText: {
    color: theme.colors.error,
    fontSize: 15,
    fontWeight: "600",
  },
});
