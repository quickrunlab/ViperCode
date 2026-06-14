import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useCallback, useState } from "react";
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

export function PairScreen({ navigation }: Props) {
  const [mode, setMode] = useState<PairMode>("scan");
  const [permission, requestPermission] = useCameraPermissions();
  const [pasteUrl, setPasteUrl] = useState("");
  const [manualHost, setManualHost] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [status, setStatus] = useState<PairStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [successLabel, setSuccessLabel] = useState("");
  const service = useConnectionService();

  const handleExchange = useCallback(async (outcome: PairingParseOutcome) => {
    if (!outcome.ok) {
      setStatus("error");
      setErrorMessage(outcome.message);
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
      setStatus("error");
      setErrorMessage(cause instanceof Error ? cause.message : "Pairing exchange failed.");
    }
  }, []);

  const handleQrScanned = useCallback(
    (data: string) => {
      if (status === "exchanging" || status === "success") return;
      void handleExchange(parsePairingUrl(data));
    },
    [handleExchange, status],
  );

  const handlePasteSubmit = useCallback(() => {
    void handleExchange(parsePairingUrl(pasteUrl));
  }, [handleExchange, pasteUrl]);

  const handleManualSubmit = useCallback(() => {
    void handleExchange(parsePairingHostAndCode(manualHost, manualCode));
  }, [handleExchange, manualHost, manualCode]);

  if (status === "success") {
    return (
      <View style={styles.container}>
        <Text style={styles.successTitle}>Environment Paired</Text>
        <Text style={styles.successLabel}>{successLabel}</Text>
        <Pressable style={styles.button} onPress={() => navigation.goBack()}>
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.modeBar}>
        <Pressable
          style={[styles.modeTab, mode === "scan" && styles.modeTabActive]}
          onPress={() => setMode("scan")}
        >
          <Text style={[styles.modeTabText, mode === "scan" && styles.modeTabTextActive]}>
            Scan
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeTab, mode === "paste" && styles.modeTabActive]}
          onPress={() => setMode("paste")}
        >
          <Text style={[styles.modeTabText, mode === "paste" && styles.modeTabTextActive]}>
            Paste URL
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeTab, mode === "manual" && styles.modeTabActive]}
          onPress={() => setMode("manual")}
        >
          <Text style={[styles.modeTabText, mode === "manual" && styles.modeTabTextActive]}>
            Manual
          </Text>
        </Pressable>
      </View>

      {mode === "scan" && (
        <View style={styles.scanContainer}>
          {!permission?.granted ? (
            <View style={styles.permissionContainer}>
              <Text style={styles.permissionText}>
                Camera access is needed to scan pairing QR codes.
              </Text>
              <Pressable style={styles.button} onPress={requestPermission}>
                <Text style={styles.buttonText}>Grant Camera Access</Text>
              </Pressable>
            </View>
          ) : (
            <CameraView
              style={styles.camera}
              facing="back"
              onBarcodeScanned={(result) => handleQrScanned(result.data)}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            />
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
          <Pressable style={styles.button} onPress={handlePasteSubmit}>
            <Text style={styles.buttonText}>Connect</Text>
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
          <Pressable style={styles.button} onPress={handleManualSubmit}>
            <Text style={styles.buttonText}>Connect</Text>
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
        <View style={styles.statusContainer}>
          <Text style={styles.errorText}>{errorMessage}</Text>
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
  modeBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modeTab: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  modeTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  modeTabText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  modeTabTextActive: {
    color: theme.colors.primary,
    fontWeight: "600",
  },
  scanContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  scanHint: {
    textAlign: "center",
    color: theme.colors.textSecondary,
    fontSize: 13,
    padding: theme.spacing.md,
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
  },
  formContainer: {
    padding: theme.spacing.lg,
  },
  formLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    marginBottom: theme.spacing.xs,
    marginTop: theme.spacing.md,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: theme.spacing.md,
    color: theme.colors.text,
    fontSize: 15,
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    padding: theme.spacing.md,
    alignItems: "center",
    marginTop: theme.spacing.lg,
  },
  buttonText: {
    color: theme.colors.background,
    fontSize: 15,
    fontWeight: "600",
  },
  statusContainer: {
    padding: theme.spacing.lg,
    alignItems: "center",
  },
  statusText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    marginTop: theme.spacing.sm,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 14,
    textAlign: "center",
  },
  successTitle: {
    fontSize: 22,
    fontWeight: "600",
    color: theme.colors.success,
    textAlign: "center",
    marginTop: theme.spacing.xl,
  },
  successLabel: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
});
