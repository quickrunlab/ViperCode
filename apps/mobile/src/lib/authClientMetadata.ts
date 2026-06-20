import type { AuthClientPresentationMetadata } from "@vipercode/contracts";
import { Platform } from "react-native";

export function authClientMetadata(): AuthClientPresentationMetadata {
  return {
    label: "Viper Code Mobile",
    deviceType: "mobile",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
  };
}
