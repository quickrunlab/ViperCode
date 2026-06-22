import { type ComponentProps } from "react";
import { Platform, Text } from "react-native";
import { Markdown as NitroMarkdown } from "react-native-nitro-markdown";

import { useThemeColor } from "../lib/useThemeColor";

type MarkdownComponentProps = ComponentProps<typeof NitroMarkdown>;

/**
 * The Nitro `MarkdownParser` HybridObject is not registered on Android (Nitro
 * autolinking gap under pnpm), so rendering the native `<Markdown>` crashes the
 * screen. Until the native registration is fixed, fall back to plain text on
 * Android — raw markdown is still readable — while iOS keeps the rich renderer.
 */
export function Markdown(props: MarkdownComponentProps) {
  const foreground = useThemeColor("--color-foreground");

  if (Platform.OS !== "ios") {
    const text = typeof props.children === "string" ? props.children : "";
    return (
      <Text
        style={{
          color: foreground,
          fontSize: 15,
          lineHeight: 22,
          fontFamily: "DMSans_400Regular",
        }}
      >
        {text}
      </Text>
    );
  }

  return <NitroMarkdown {...props} />;
}
