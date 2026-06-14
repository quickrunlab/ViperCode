import React, { useCallback, useMemo } from "react";
import { RootProvider } from "./providers/RootProvider.tsx";
import { AppNavigator } from "./navigation/AppNavigator.tsx";
import { MobileConnectionProvider } from "../connections/ConnectionProvider.tsx";
import { createDeepLinkConfig } from "../notifications/deepLinkHandler.ts";
import { useNotificationSetup } from "../notifications/useNotificationSetup.ts";
import type { NotificationPayload } from "../notifications/notificationTypes.ts";

export function App() {
  const deepLinkConfig = useMemo(() => createDeepLinkConfig(), []);

  const handleNotificationTap = useCallback((_payload: NotificationPayload) => {
    // Handled by deep link config: navigation routes to ThreadDetail
    // based on parsed URL from notification data
  }, []);

  useNotificationSetup({ onNotificationTapped: handleNotificationTap });

  return (
    <RootProvider>
      <MobileConnectionProvider>
        <AppNavigator linking={deepLinkConfig} />
      </MobileConnectionProvider>
    </RootProvider>
  );
}
