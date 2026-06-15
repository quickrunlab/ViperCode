import React, { useCallback, useMemo } from "react";
import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { RootProvider } from "./providers/RootProvider.tsx";
import { AppNavigator } from "./navigation/AppNavigator.tsx";
import { MobileConnectionProvider } from "../connections/ConnectionProvider.tsx";
import { createDeepLinkConfig } from "../notifications/deepLinkHandler.ts";
import { useNotificationSetup } from "../notifications/useNotificationSetup.ts";
import type { NotificationPayload } from "../notifications/notificationTypes.ts";

void SplashScreen.preventAutoHideAsync();

export function App() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  const deepLinkConfig = useMemo(() => createDeepLinkConfig(), []);

  const handleNotificationTap = useCallback((_payload: NotificationPayload) => {
    // Handled by deep link config: navigation routes to ThreadDetail
    // based on parsed URL from notification data
  }, []);

  useNotificationSetup({ onNotificationTapped: handleNotificationTap });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <RootProvider>
      <MobileConnectionProvider>
        <AppNavigator linking={deepLinkConfig} />
      </MobileConnectionProvider>
    </RootProvider>
  );
}
