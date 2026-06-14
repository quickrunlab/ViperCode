import type { ExpoConfig } from "expo/config";

const clerkPublishableKey =
  process.env.EXPO_PUBLIC_VIPERCODE_CLERK_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  "";

const relayUrl =
  process.env.EXPO_PUBLIC_VIPERCODE_RELAY_URL ?? process.env.EXPO_PUBLIC_RELAY_URL ?? "";

const clerkJwtTemplate =
  process.env.EXPO_PUBLIC_VIPERCODE_CLERK_JWT_TEMPLATE ??
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ??
  "viper-relay";

if (!clerkPublishableKey) {
  console.warn(
    "VIPERCODE: EXPO_PUBLIC_VIPERCODE_CLERK_PUBLISHABLE_KEY is not set. Clerk auth will fail.",
  );
}
if (!relayUrl) {
  console.warn(
    "VIPERCODE: EXPO_PUBLIC_VIPERCODE_RELAY_URL is not set. Relay will not be available.",
  );
}

export default (): ExpoConfig => ({
  name: "Viper Code",
  slug: "viper-code",
  version: "0.3.11",
  orientation: "portrait",
  scheme: "vipercode",
  userInterfaceStyle: "automatic",
  platforms: ["android"],
  android: {
    package: "com.vipercode.mobile",
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0D1117",
    },
    edgeToEdgeEnabled: true,
  },
  extra: {
    clerkPublishableKey,
    clerkJwtTemplate,
    relayUrl,
  },
  plugins: [
    "expo-secure-store",
    [
      "expo-camera",
      {
        cameraPermission: "Allow Viper Code to access your camera to scan pairing QR codes.",
      },
    ],
  ],
});
