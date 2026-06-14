import { useAuth, useSSO } from "@clerk/clerk-expo";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { theme } from "../theme/index.ts";

export function maybeCompleteAuthSession(): void {
  WebBrowser.maybeCompleteAuthSession();
}

function warmUpBrowser(): void {
  void WebBrowser.warmUpAsync();
  void WebBrowser.coolDownAsync();
}

function LoadingScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.colors.primary} size="large" />
      <Text style={styles.loadingText}>Loading...</Text>
    </View>
  );
}

function SignInScreen() {
  const { isLoaded } = useAuth();
  const { startSSOFlow } = useSSO();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    warmUpBrowser();
  }, []);

  const signIn = useCallback(
    async (strategy: string) => {
      setError(null);
      try {
        const result = await startSSOFlow({ strategy: strategy as any });
        if (result.authSessionResult?.type === "success") {
          await result.setActive?.({ session: result.createdSessionId! });
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Sign-in failed.");
      }
    },
    [startSSOFlow],
  );

  if (!isLoaded) {
    return <LoadingScreen />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Viper Code</Text>
      <Text style={styles.subtitle}>Sign in to connect to your environments.</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.button} onPress={() => void signIn("oauth_google")}>
        <Text style={styles.buttonText}>Continue with Google</Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.secondaryButton]}
        onPress={() => void signIn("oauth_github")}
      >
        <Text style={[styles.buttonText, styles.secondaryButtonText]}>Continue with GitHub</Text>
      </Pressable>
    </View>
  );
}

export function AuthGate({ children }: { readonly children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <LoadingScreen />;
  }

  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return children;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: "center",
    marginBottom: theme.spacing.xl,
  },
  loadingText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
  },
  error: {
    fontSize: 13,
    color: theme.colors.error,
    textAlign: "center",
    marginBottom: theme.spacing.md,
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    padding: theme.spacing.md,
    alignItems: "center",
    minWidth: 240,
    marginBottom: theme.spacing.sm,
  },
  buttonText: {
    color: theme.colors.background,
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryButtonText: {
    color: theme.colors.text,
  },
});
