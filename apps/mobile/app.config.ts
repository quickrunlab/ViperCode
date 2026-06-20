import type { ExpoConfig } from "expo/config";

import { loadRepoEnv } from "../../scripts/lib/public-config.ts";

type AppVariant = "development" | "preview" | "production";

const repoEnv = loadRepoEnv();
Object.assign(process.env, repoEnv);

const APP_VARIANT = resolveAppVariant(repoEnv.APP_VARIANT);

const VARIANT_CONFIG: Record<
  AppVariant,
  {
    readonly appName: string;
    readonly scheme: string;
    readonly iosIcon: string;
    readonly iosBundleIdentifier: string;
    readonly androidPackage: string;
  }
> = {
  development: {
    appName: "Viper Code Dev",
    scheme: "vipercode-dev",
    iosIcon: "./assets/icon-composer-dev.icon",
    iosBundleIdentifier: "com.vipercode.mobile.dev",
    androidPackage: "com.vipercode.mobile.dev",
  },
  preview: {
    appName: "Viper Code Preview",
    scheme: "vipercode-preview",
    iosIcon: "./assets/icon-composer-prod.icon",
    iosBundleIdentifier: "com.vipercode.mobile.preview",
    androidPackage: "com.vipercode.mobile.preview",
  },
  production: {
    appName: "Viper Code",
    scheme: "vipercode",
    iosIcon: "./assets/icon-composer-prod.icon",
    iosBundleIdentifier: "com.vipercode.mobile",
    androidPackage: "com.vipercode.mobile",
  },
};

function resolveAppVariant(value: string | undefined): AppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    default:
      return "production";
  }
}

const variant = VARIANT_CONFIG[APP_VARIANT];

const config: ExpoConfig = {
  name: variant.appName,
  slug: "viper-code",
  platforms: ["ios", "android"],
  scheme: variant.scheme,
  version: "0.1.0",
  runtimeVersion: {
    policy: process.env.MOBILE_VERSION_POLICY ?? "appVersion",
  },
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  updates: process.env.EXPO_UPDATES_URL
    ? {
        enabled: true,
        url: process.env.EXPO_UPDATES_URL,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      }
    : {
        enabled: false,
      },
  ios: {
    icon: variant.iosIcon,
    supportsTablet: true,
    bundleIdentifier: variant.iosBundleIdentifier,
    infoPlist: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
      NSLocalNetworkUsageDescription:
        "Allow Viper Code to connect to Viper Code servers on your local network or tailnet.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    icon: "./assets/icon.png",
    package: variant.androidPackage,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-secure-store",
    ["@clerk/expo", { theme: "./clerk-theme.json" }],
    "expo-web-browser",
    [
      "expo-camera",
      {
        cameraPermission:
          "Allow Viper Code to access your camera so you can scan pairing QR codes.",
        barcodeScannerEnabled: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        imageWidth: 220,
        dark: {
          image: "./assets/splash-icon.png",
          backgroundColor: "#0a0a0a",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "18.0",
          // AppCheckCore 11.3+ includes Swift and needs module maps for these Objective-C dependencies.
          extraPods: [
            { name: "GoogleUtilities", modular_headers: true },
            { name: "RecaptchaInterop", modular_headers: true },
          ],
        },
      },
    ],
    [
      "expo-widgets",
      {
        bundleIdentifier: `${variant.iosBundleIdentifier}.widgets`,
        groupIdentifier: `group.${variant.iosBundleIdentifier}`,
        enablePushNotifications: true,
        widgets: [
          {
            name: "AgentActivity",
            displayName: "Agent Activity",
            description: "Shows the current state of active Viper Code agents.",
            supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"],
          },
        ],
      },
    ],
    "./plugins/withAndroidCleartextTraffic.cjs",
  ],
  extra: {
    appVariant: APP_VARIANT,
    relay: {
      url:
        repoEnv.VIPERCODE_RELAY_URL ??
        repoEnv.EXPO_PUBLIC_VIPERCODE_RELAY_URL ??
        repoEnv.EXPO_PUBLIC_RELAY_URL ??
        null,
    },
    clerk: {
      publishableKey:
        repoEnv.VIPERCODE_CLERK_PUBLISHABLE_KEY ??
        repoEnv.EXPO_PUBLIC_VIPERCODE_CLERK_PUBLISHABLE_KEY ??
        repoEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ??
        null,
      jwtTemplate:
        repoEnv.VIPERCODE_CLERK_JWT_TEMPLATE ??
        repoEnv.EXPO_PUBLIC_VIPERCODE_CLERK_JWT_TEMPLATE ??
        repoEnv.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ??
        "viper-relay",
    },
    observability: {
      tracesUrl: repoEnv.EXPO_PUBLIC_OTLP_TRACES_URL ?? "https://api.axiom.co/v1/traces",
      tracesDataset: repoEnv.EXPO_PUBLIC_OTLP_TRACES_DATASET ?? null,
      tracesToken: repoEnv.EXPO_PUBLIC_OTLP_TRACES_TOKEN ?? null,
    },
    eas: {
      projectId: process.env.EXPO_PROJECT_ID ?? undefined,
    },
  },
  owner: process.env.EXPO_OWNER ?? undefined,
};

export default config;
