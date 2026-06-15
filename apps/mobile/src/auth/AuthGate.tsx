import { useAuth, useSSO } from "@clerk/clerk-expo";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Svg, { Path } from "react-native-svg";
import { theme } from "../theme/index.ts";

export function maybeCompleteAuthSession(): void {
  WebBrowser.maybeCompleteAuthSession();
}

const OAUTH_REDIRECT_URL = Linking.createURL("auth/callback");

if (Platform.OS !== "web") {
  console.log("[ViperCode] OAuth redirect URL:", OAUTH_REDIRECT_URL);
}

function warmUpBrowser(): void {
  void WebBrowser.warmUpAsync();
}

function coolDownBrowser(): void {
  void WebBrowser.coolDownAsync();
}

function GoogleIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <Path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <Path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <Path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </Svg>
  );
}

function GitHubIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"
        fill={theme.colors.text}
      />
    </Svg>
  );
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
    return () => {
      coolDownBrowser();
    };
  }, []);

  const signIn = useCallback(
    async (strategy: string) => {
      setError(null);
      try {
        await WebBrowser.warmUpAsync();
        const result = await startSSOFlow({
          strategy: strategy as any,
          redirectUrl: OAUTH_REDIRECT_URL,
        });
        if (result.authSessionResult?.type === "success") {
          await result.setActive?.({ session: result.createdSessionId! });
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Sign-in failed.");
      } finally {
        void WebBrowser.coolDownAsync();
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

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}

      <Pressable style={styles.googleButton} onPress={() => void signIn("oauth_google")}>
        <GoogleIcon />
        <Text style={styles.googleButtonText} numberOfLines={1}>
          Continue with Google
        </Text>
      </Pressable>

      <Pressable style={styles.githubButton} onPress={() => void signIn("oauth_github")}>
        <GitHubIcon />
        <Text style={styles.githubButtonText} numberOfLines={1}>
          Continue with GitHub
        </Text>
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
    fontFamily: theme.font.sans,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: "center",
    marginBottom: theme.spacing.xl,
    fontFamily: theme.font.sans,
  },
  loadingText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.sm,
    fontFamily: theme.font.sans,
  },
  errorBanner: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.error,
    borderRadius: theme.radius.card,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    width: "100%",
    maxWidth: 320,
  },
  error: {
    fontSize: 13,
    color: theme.colors.error,
    textAlign: "center",
    fontFamily: theme.font.sans,
  },
  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: theme.radius.button,
    padding: theme.spacing.md,
    minWidth: 240,
    height: 48,
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  googleButtonText: {
    color: "#1A1A1A",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: theme.font.sans,
  },
  githubButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.button,
    padding: theme.spacing.md,
    minWidth: 240,
    height: 48,
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  githubButtonText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: theme.font.sans,
  },
});
