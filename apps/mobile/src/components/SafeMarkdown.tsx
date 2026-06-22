import type { ComponentProps } from "react";
import { Linking } from "react-native";
import MarkdownDisplay from "react-native-markdown-display";
// Type-only import: erased at build, so `react-native-nitro-markdown` is NEVER
// evaluated on Android. Its module init creates Nitro HybridObjects
// (MarkdownParser/MarkdownSession) that aren't registered on Android and throw
// uncaught, which blanks the whole screen. iOS uses SafeMarkdown.ios.tsx.
import type { Markdown as NitroMarkdown } from "react-native-nitro-markdown";

import { useThemeColor } from "../lib/useThemeColor";

type MarkdownComponentProps = ComponentProps<typeof NitroMarkdown>;

// Android/web render markdown with the pure-JS `react-native-markdown-display`
// (renders into RN Views/Text — safe to nest inside the thread's virtualized
// list, no native module). iOS keeps the native Nitro renderer.
export function Markdown(props: MarkdownComponentProps) {
  const body = String(useThemeColor("--color-md-body"));
  const strong = String(useThemeColor("--color-md-strong"));
  const link = String(useThemeColor("--color-md-link"));
  const blockquoteBorder = String(useThemeColor("--color-md-blockquote-border"));
  const blockquoteBackground = String(useThemeColor("--color-md-blockquote-bg"));
  const codeBackground = String(useThemeColor("--color-md-code-bg"));
  const codeText = String(useThemeColor("--color-md-code-text"));
  const horizontalRule = String(useThemeColor("--color-md-hr"));

  const text = typeof props.children === "string" ? props.children : "";

  return (
    <MarkdownDisplay
      onLinkPress={(url) => {
        void Linking.openURL(url);
        return false;
      }}
      style={{
        body: {
          color: body,
          fontSize: 15,
          lineHeight: 22,
          fontFamily: "DMSans_400Regular",
        },
        heading1: { color: strong, fontFamily: "DMSans_700Bold", fontSize: 22, lineHeight: 28 },
        heading2: { color: strong, fontFamily: "DMSans_700Bold", fontSize: 20, lineHeight: 26 },
        heading3: { color: strong, fontFamily: "DMSans_700Bold", fontSize: 17, lineHeight: 23 },
        heading4: { color: strong, fontFamily: "DMSans_700Bold", fontSize: 15, lineHeight: 21 },
        heading5: { color: strong, fontFamily: "DMSans_700Bold", fontSize: 14, lineHeight: 20 },
        heading6: { color: strong, fontFamily: "DMSans_700Bold", fontSize: 13, lineHeight: 19 },
        strong: { color: strong, fontFamily: "DMSans_700Bold" },
        em: { fontStyle: "italic" },
        link: { color: link, fontFamily: "DMSans_500Medium", textDecorationLine: "none" },
        blockquote: {
          backgroundColor: blockquoteBackground,
          borderLeftColor: blockquoteBorder,
          borderLeftWidth: 3,
          paddingLeft: 12,
          marginVertical: 4,
        },
        code_inline: {
          backgroundColor: codeBackground,
          color: codeText,
          fontFamily: "ui-monospace",
          borderRadius: 4,
        },
        code_block: {
          backgroundColor: codeBackground,
          color: codeText,
          fontFamily: "ui-monospace",
          borderRadius: 12,
          padding: 12,
        },
        fence: {
          backgroundColor: codeBackground,
          color: codeText,
          fontFamily: "ui-monospace",
          borderRadius: 12,
          padding: 12,
        },
        bullet_list_icon: { color: body },
        ordered_list_icon: { color: body },
        hr: { backgroundColor: horizontalRule, height: 1 },
      }}
    >
      {text}
    </MarkdownDisplay>
  );
}
