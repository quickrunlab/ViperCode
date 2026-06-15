import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme/index.ts";

export interface ProviderStatus {
  readonly instanceId: string;
  readonly label: string;
  readonly driverLabel: string;
  readonly availability: "ready" | "unavailable" | "needs-setup";
  readonly message: string | null;
}

interface Props {
  readonly providers: ReadonlyArray<ProviderStatus>;
}

function statusColor(availability: ProviderStatus["availability"]): string {
  switch (availability) {
    case "ready":
      return theme.colors.success;
    case "needs-setup":
      return theme.colors.warning;
    case "unavailable":
    default:
      return theme.colors.error;
  }
}

export function ProviderStatusBanner({ providers }: Props) {
  if (providers.length === 0) return null;

  const unavailable = providers.filter((p) => p.availability !== "ready");

  return (
    <View style={styles.container}>
      {providers.map((provider) => (
        <View
          key={provider.instanceId}
          style={[styles.row, provider.availability !== "ready" && styles.rowWarning]}
        >
          <View style={styles.info}>
            <Text style={styles.label}>{provider.label}</Text>
            <Text style={styles.driver}>{provider.driverLabel}</Text>
            {provider.message ? <Text style={styles.message}>{provider.message}</Text> : null}
          </View>
          <View
            style={[styles.statusDot, { backgroundColor: statusColor(provider.availability) }]}
          />
        </View>
      ))}
      {unavailable.length > 0 && (
        <Text style={styles.setupHint}>
          {unavailable.length === 1
            ? `${unavailable[0]!.label} requires setup on your PC.`
            : "Some providers need setup on your PC."}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.background,
  },
  rowWarning: {
    backgroundColor: theme.colors.surface,
  },
  info: {
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.text,
    fontFamily: theme.font.sans,
  },
  driver: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 1,
    fontFamily: theme.font.sans,
  },
  message: {
    fontSize: 11,
    color: theme.colors.warning,
    marginTop: 2,
    fontFamily: theme.font.sans,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: theme.spacing.sm,
  },
  setupHint: {
    fontSize: 11,
    color: theme.colors.textMuted,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    fontStyle: "italic",
    fontFamily: theme.font.sans,
  },
});
