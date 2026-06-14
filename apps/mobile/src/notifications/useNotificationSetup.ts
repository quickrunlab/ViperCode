import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { NotificationState, NotificationPayload } from "./notificationTypes.ts";

interface NotificationSetupOptions {
  readonly onNotificationTapped?: (payload: NotificationPayload) => void;
}

function generateDeviceId(): string {
  const chars = "abcdef0123456789";
  let id = "";
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

let cachedDeviceId: string | null = null;

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  cachedDeviceId = generateDeviceId();
  return cachedDeviceId;
}

export function useNotificationSetup(_options: NotificationSetupOptions = {}): NotificationState {
  const [state, _setState] = useState<NotificationState>({
    permissionGranted: false,
    pushToken: null,
    deviceId: getDeviceId(),
    isRegistered: false,
  });

  const optionsRef = useRef(_options);
  optionsRef.current = _options;

  useEffect(() => {
    if (Platform.OS !== "android") return;

    void requestPermissions();
  }, []);

  const requestPermissions = useCallback(async () => {
    // expo-notifications API:
    // import * as Notifications from "expo-notifications";
    // const { status } = await Notifications.requestPermissionsAsync();
    // if (status !== "granted") return;
    // const token = (await Notifications.getExpoPushTokenAsync()).data;
    // setState(prev => ({ ...prev, permissionGranted: true, pushToken: token }));
    //
    // Notifications.addNotificationResponseReceivedListener(response => {
    //   const data = response.notification.request.content.data as NotificationPayload;
    //   optionsRef.current.onNotificationTapped?.(data);
    // });
    //
    // TODO: register device with relay via registerAndroidDevice endpoint
  }, []);

  return state;
}
