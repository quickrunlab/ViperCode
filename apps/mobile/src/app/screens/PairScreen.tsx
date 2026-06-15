import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { RootStackParamList } from "../navigation/AppNavigator.tsx";
import { theme } from "../../theme/index.ts";
import {
  parsePairingUrl,
  parsePairingHostAndCode,
  type PairingParseOutcome,
} from "../../pairing/parsePairingInput.ts";
import { exchangePairingCredential } from "../../pairing/exchangePairingCredential.ts";
import { saveKnownEnvironment, saveEnvironmentCredential } from "../../storage/environmentStore.ts";
import type { MobileKnownEnvironmentRecord } from "../../runtime/clientRuntimeImports.ts";
import { mobileRuntime } from "../../runtime/mobileRuntime.ts";
import { useConnectionService } from "../../connections/ConnectionProvider.tsx";

type Props = NativeStackScreenProps<RootStackParamList, "Pair">;

type PairMode = "scan" | "paste" | "manual";
type PairStatus = "idle" | "exchanging" | "success" | "error";

function friendlyError(raw: string): string {
  if (/transport|network|fetch|ECONNREFUSED|ENOTFOUND|timeout/i.test(raw)) {
    const hostMatch = raw.match(/https?:\/\/[^/\s]+/);
    const host = hostMatch ? hostMatch[0] : "the server";
    return `Couldn't reach ${host}. Make sure your phone and computer are on the same Tailscale network (or Wi-Fi).`;
  }
  return raw;
}

export function PairScreen({ navigation }: Props) {
  const [mode, setMode] = useState<PairMode>("scan");
  const [permission, requestPermission] = useCameraPermissions();
  const [pasteUrl, setPasteUrl] = useState("");
  const [manualHost, setManualHost] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [status, setStatus] = useState<PairStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [successLabel, setSuccessLabel] = useState("");
  const scanLockRef = useRef(false);
  const service = useConnectionService();

  const handleExchange = useCallback(async (outcome: PairingParseOutcome) => {
    if (!outcome.ok) {
      setStatus("error");
      setErrorMessage(outcome.message);
      scanLockRef.current = false;
      return;
    }

    setStatus("exchanging");
    setErrorMessage("");

    try {
      const result = await mobileRuntime.runPromise(exchangePairingCredential(outcome.target));

      const now = new Date().toISOString();
      const record: MobileKnownEnvironmentRecord = {
        version: 1,
        environmentId: result.environmentId as MobileKnownEnvironmentRecord["environmentId"],
        label: result.environmentLabel,
        httpBaseUrl: outcome.target.httpBaseUrl,
        wsBaseUrl: outcome.target.wsBaseUrl,
        createdAt: now,
        lastConnectedAt: null,
      };

      await saveKnownEnvironment(record);
      await saveEnvironmentCredential(result.environmentId, result.bearerToken);

      void service.connectEnvironment(result.environmentId);

      setStatus("success");
      setSuccessLabel(result.environmentLabel);
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : "Pairing exchange failed.";
      setStatus("error");
      setErrorMessage(friendlyError(raw));
      scanLockRef.current = false;
    }
  }, []);

  const handleQrScanned = useCallback(
    (data: string) => {
      if (scanLockRef.current) return;
      if (status === "exchanging" || status === "success") return;
      scanLockRef.current = true;
      void handleExchange(parsePairingUrl(data));
    },
    [handleExchange, status],
  );

  const handleRetry = useCallback(() => {
    setStatus("idle");
    setErrorMessage("");
    scanLockRef.current = false;
  }, []);

  const handleModeChange = useCallback((newMode: PairMode) => {
    setMode(newMode);
    scanLockRef.current = false;
  }, []);

  const handlePasteSubmit = useCallback(() => {
    void handleExchange(parsePairingUrl(pasteUrl));
  }, [handleExchange, pasteUrl]);

  const handleManualSubmit = useCallback(() => {
    void handleExchange(parsePairingHostAndCode(manualHost, manualCode));
  }, [handleExchange, manualHost, manualCode]);

  if (status === "success") {
    return (
      <View style={styles.container}>
        <View style={styles.successContainer}>
          <Text style={styles.successTitle}>Environment Paired</Text>
          <Text style={styles.successLabel}>{successLabel}</Text>
          <Pressable style={styles.primaryButton} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.segmentedControl}>
        {(["scan", "paste", "manual"] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.segmentTab, mode === tab && styles.segmentTabActive]}
            onPress={() => handleModeChange(tab)}
          >
            <Text style={[styles.segmentTabText, mode === tab && styles.segmentTabTextActive]}>
              {tab === "scan" ? "Scan" : tab === "paste" ? "Paste URL" : "Manual"}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === "scan" && (
        <View style={styles.scanContainer}>
          {!permission?.granted ? (
            <View style={styles.permissionContainer}>
              <Text style={styles.permissionText}>
                Camera access is needed to scan pairing QR codes.
              </Text>
              <Pressable style={styles.primaryButton} onPress={requestPermission}>
                <Text style={styles.primaryButtonText}>Grant Camera Access</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.cameraFrame}>
              <CameraView
                style={styles.camera}
                facing="back"
                onBarcodeScanned={(result) => handleQrScanned(result.data)}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              />
            </View>
          )}
          <Text style={styles.scanHint}>Point your camera at a Viper Code pairing QR code.</Text>
        </View>
      )}

      {mode === "paste" && (
        <View style={styles.formContainer}>
          <Text style={styles.formLabel}>Pairing URL</Text>
          <TextInput
            style={styles.input}
            value={pasteUrl}
            onChangeText={setPasteUrl}
            placeholder="https://..."
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Pressable style={styles.primaryButton} onPress={handlePasteSubmit}>
            <Text style={styles.primaryButtonText}>Connect</Text>
          </Pressable>
        </View>
      )}

      {mode === "manual" && (
        <View style={styles.formContainer}>
          <Text style={styles.formLabel}>Backend URL</Text>
          <TextInput
            style={styles.input}
            value={manualHost}
            onChangeText={setManualHost}
            placeholder="https://desktop.tailnet.ts.net:44342"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.formLabel}>Pairing Code</Text>
          <TextInput
            style={styles.input}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="Enter pairing code"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={styles.primaryButton} onPress={handleManualSubmit}>
            <Text style={styles.primaryButtonText}>Connect</Text>
          </Pressable>
        </View>
      )}

      {status === "exchanging" && (
        <View style={styles.statusContainer}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.statusText}>Exchanging credential...</Text>
        </View>
      )}

      {status === "error" && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface,
    margin: theme.spacing.md,
    borderRadius: theme.radius.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  segmentTab: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    alignItems: "center",
    borderRadius: theme.radius.pill,
  },
  segmentTabActive: {
    backgroundColor: theme.colors.primary,
  },
  segmentTabText: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.textSecondary,
    fontFamily: theme.font.sans,
  },
  segmentTabTextActive: {
    color: theme.colors.primaryForeground,
    fontWeight: "600",
  },
  scanContainer: {
    flex: 1,
  },
  cameraFrame: {
    flex: 1,
    margin: theme.spacing.md,
    borderRadius: theme.radius.card,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  camera: {
    flex: 1,
  },
  scanHint: {
    textAlign: "center",
    color: theme.colors.textSecondary,
    fontSize: 13,
    padding: theme.spacing.md,
    fontFamily: theme.font.sans,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing.lg,
  },
  permissionText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginBottom: theme.spacing.md,
    fontFamily: theme.font.sans,
  },
  formContainer: {
    padding: theme.spacing.lg,
  },
  formLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
    marginTop: theme.spacing.md,
    fontFamily: theme.font.sans,
  },
  input: {
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    padding: theme.spacing.md,
    color: theme.colors.text,
    fontSize: 15,
    fontFamily: theme.font.sans,
  },
  primaryButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.button,
    padding: theme.spacing.md,
    alignItems: "center",
    marginTop: theme.spacing.lg,
    height: 48,
    justifyContent: "center",
  },
  primaryButtonText: {
    color: theme.colors.primaryForeground,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: theme.font.sans,
  },
  statusContainer: {
    padding: theme.spacing.lg,
    alignItems: "center",
  },
  statusText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    marginTop: theme.spacing.sm,
    fontFamily: theme.font.sans,
  },
  errorBanner: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.error,
    borderRadius: theme.radius.card,
    margin: theme.spacing.md,
    padding: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 14,
    textAlign: "center",
    fontFamily: theme.font.sans,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.button,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    alignItems: "center",
    marginTop: theme.spacing.md,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  retryButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: theme.font.sans,
  },
  successContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing.lg,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.success,
    textAlign: "center",
    fontFamily: theme.font.sans,
  },
  successLabel: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    fontFamily: theme.font.sans,
  },
});
