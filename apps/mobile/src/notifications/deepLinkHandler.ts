import type { LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "../app/navigation/AppNavigator.tsx";

const DEEP_LINK_PREFIX = "vipercode://";

export function resolveDeepLink(url: string | null): {
  screen: keyof RootStackParamList;
  params: Record<string, string>;
} | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "vipercode:" && parsed.hostname !== "vipercode") {
      return null;
    }

    const pathParts = parsed.pathname.replace(/^\//, "").split("/");

    if (pathParts[0] === "thread" && pathParts[1]) {
      return {
        screen: "ThreadDetail",
        params: {
          threadId: pathParts[1],
          title: parsed.searchParams.get("title") ?? "Thread",
        },
      };
    }

    if (pathParts[0] === "environment" && pathParts[1]) {
      return {
        screen: "EnvironmentThreads",
        params: {
          environmentId: pathParts[1],
          label: parsed.searchParams.get("label") ?? "Environment",
        },
      };
    }

    return { screen: "Home", params: {} };
  } catch {
    return null;
  }
}

export function buildDeepLink(
  screen: keyof RootStackParamList,
  params: Record<string, string>,
): string {
  const base = DEEP_LINK_PREFIX;

  switch (screen) {
    case "ThreadDetail": {
      const title = params.title ?? "Thread";
      return `${base}thread/${params.threadId}?title=${encodeURIComponent(title)}`;
    }
    case "EnvironmentThreads": {
      const label = params.label ?? "Environment";
      return `${base}environment/${params.environmentId}?label=${encodeURIComponent(label)}`;
    }
    default:
      return base;
  }
}

export function createDeepLinkConfig(): LinkingOptions<RootStackParamList> {
  return {
    prefixes: [DEEP_LINK_PREFIX, "https://vipercode.app"],
    config: {
      screens: {
        Home: "",
        ThreadDetail: "thread/:threadId",
        EnvironmentThreads: "environment/:environmentId",
        Settings: "settings",
        Pair: "pair",
      },
    },
  };
}
