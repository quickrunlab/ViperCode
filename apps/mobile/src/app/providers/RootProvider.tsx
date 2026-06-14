import { ClerkProvider } from "@clerk/clerk-expo";
import React, { type ErrorInfo, type ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../../theme/index.ts";
import { resolveMobilePublicConfig } from "../../runtime/resolveConfig.ts";
import { AuthGate } from "../../auth/AuthGate.tsx";
import { ManagedRelayAuthProvider } from "../../auth/ManagedRelayAuthProvider.tsx";

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("App error boundary:", error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorMessage}>{this.state.error.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const config = resolveMobilePublicConfig();

export function RootProvider({ children }: Props) {
  return (
    <ErrorBoundary>
      <ClerkProvider publishableKey={config.clerkPublishableKey ?? ""}>
        <ManagedRelayAuthProvider>
          <AuthGate>
            <GestureHandlerRootView style={styles.root}>
              <SafeAreaProvider>{children}</SafeAreaProvider>
            </GestureHandlerRootView>
          </AuthGate>
        </ManagedRelayAuthProvider>
      </ClerkProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.error,
    marginBottom: theme.spacing.sm,
  },
  errorMessage: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
});
