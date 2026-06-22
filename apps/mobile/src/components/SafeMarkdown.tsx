import type { ComponentProps } from "react";
import { Linking, Text as RNText } from "react-native";
import MarkdownDisplay, { type ASTNode, type RenderRules } from "react-native-markdown-display";
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

  // Custom `text` leaf rule. The library applies `styles.text` last (overriding
  // inline marks), and named fonts on Android don't synthesize weight from
  // fontWeight — so we pick the actual font file by ancestor: DMSans bold for
  // **bold** and headings, DMSans regular otherwise. fontSize stays from
  // inheritedStyles (heading sizes) with a 15px body default.
  const rules: RenderRules = {
    text: (node: ASTNode, _children, parent, _styles, inheritedStyles = {}) => {
      const inBold = parent.some((p) => p.type === "strong" || p.type.startsWith("heading"));
      const inEm = parent.some((p) => p.type === "em");
      const inLink = parent.some((p) => p.type === "link");
      return (
        <RNText
          key={node.key}
          style={[
            { fontSize: 15, lineHeight: 22 },
            inheritedStyles,
            {
              fontFamily: inBold ? "DMSans_700Bold" : "DMSans_400Regular",
              color: inBold ? strong : inLink ? link : body,
              ...(inEm ? { fontStyle: "italic" as const } : null),
            },
          ]}
        >
          {node.content}
        </RNText>
      );
    },
  };

  return (
    <MarkdownDisplay
      rules={rules}
      onLinkPress={(url) => {
        void Linking.openURL(url);
        return false;
      }}
      style={{
        body: { color: body },
        heading1: { color: strong, fontSize: 22, lineHeight: 28, marginVertical: 4 },
        heading2: { color: strong, fontSize: 20, lineHeight: 26, marginVertical: 4 },
        heading3: { color: strong, fontSize: 17, lineHeight: 23, marginVertical: 3 },
        heading4: { color: strong, fontSize: 15, lineHeight: 21, marginVertical: 3 },
        heading5: { color: strong, fontSize: 14, lineHeight: 20, marginVertical: 2 },
        heading6: { color: strong, fontSize: 13, lineHeight: 19, marginVertical: 2 },
        link: { color: link, textDecorationLine: "none" },
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
