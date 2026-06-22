// Android drop-in replacement for `expo-symbols`' `SymbolView`.
//
// `expo-symbols` renders Apple SF Symbols, which only exist on iOS — on Android
// every `<SymbolView />` renders nothing, leaving blank buttons app-wide. Metro
// aliases `expo-symbols` to this module on Android only (see metro.config.js), so
// iOS keeps native SF Symbols and Android renders the equivalent Lucide glyph
// from the bundled Lucide font (assets/fonts/lucide.ttf, loaded in app/_layout).
//
// Lucide is the same icon set the desktop/web app uses (lucide-react), so this
// gives Android desktop-parity icons. The SF-Symbol → Lucide map below covers
// every symbol name used in the app; unknown names fall back to a neutral glyph.

import type { ComponentProps } from "react";
import { Text, type TextStyle } from "react-native";

/** Lucide font family name — must match the key registered via useFonts(). */
export const LUCIDE_FONT_FAMILY = "Lucide";

// SF Symbol name → Lucide glyph codepoint (from lucide-static font/codepoints.json).
const SF_TO_LUCIDE_CODEPOINT: Record<string, number> = {
  // arrows / navigation
  "arrow.up": 57418,
  "arrow.up.right": 57421,
  "arrow.down.circle": 57464,
  "arrow.right.circle": 57466,
  "arrow.clockwise": 57673,
  "arrow.turn.left.up": 57508,
  "arrow.branch": 57570,
  "arrow.triangle.branch": 57570,
  "chevron.down": 57453,
  "chevron.right": 57455,
  // git / source control
  git: 57570,
  branches: 57570,
  commit: 57571,
  // status / feedback
  checkmark: 57452,
  "checkmark.circle": 57894,
  xmark: 57778,
  "exclamationmark.triangle": 57747,
  "info.circle": 57593,
  "bell.badge": 58411,
  "bolt.circle": 57780,
  // content / editing
  "square.and.pencil": 57714,
  "doc.on.doc": 57502,
  "doc.text": 57548,
  "textformat.size": 57752,
  "text.bubble": 57623,
  trash: 57742,
  plus: 57661,
  ellipsis: 57526,
  "ellipsis.circle": 58182,
  eye: 57530,
  link: 57602,
  // files / folders
  folder: 57559,
  "folder.fill": 57559,
  "folder.badge.plus": 57561,
  archive: 57409,
  archivebox: 57409,
  "archivebox.fill": 57409,
  // system / hardware
  gearshape: 57684,
  settings: 57684,
  "slider.horizontal.3": 58010,
  desktopcomputer: 57629,
  "server.rack": 57683,
  environments: 57683,
  terminal: 57729,
  keyboard: 57988,
  camera: 57444,
  "wifi.slash": 57775,
  safari: 57499,
  "qrcode.viewfinder": 58870,
  "person.crop.circle": 58465,
  play: 57660,
  "stop.fill": 57703,
  "square.split.2x1": 57496,
  "point.3.connected.trianglepath.dotted": 58405,
  "point.topleft.down.curvedto.point.bottomright.up": 58251,
  connections: 57602,
  review: 57530,
  draft: 57714,
  new: 57661,
};

/** Neutral fallback glyph (Lucide "circle") for any unmapped symbol name. */
const FALLBACK_CODEPOINT = 57462;

function glyphForSymbol(name: string | undefined): string {
  const codepoint =
    (name !== undefined ? SF_TO_LUCIDE_CODEPOINT[name] : undefined) ?? FALLBACK_CODEPOINT;
  return String.fromCodePoint(codepoint);
}

// Accept the same prop shape callers pass to expo-symbols' SymbolView. Only the
// props meaningful for a font glyph (name, size, tintColor, style) are used.
type SymbolViewProps = {
  readonly name?: string;
  readonly size?: number;
  readonly tintColor?: string | null;
  readonly style?: TextStyle | TextStyle[] | null;
  readonly type?: string;
  readonly weight?: string;
  readonly resizeMode?: string;
  readonly accessibilityLabel?: string;
  // Tolerate any other expo-symbols props without typing them all.
  readonly [key: string]: unknown;
};

export function SymbolView(props: SymbolViewProps) {
  const size = props.size ?? 17;
  const color = props.tintColor ?? undefined;

  return (
    <Text
      accessibilityLabel={props.accessibilityLabel}
      allowFontScaling={false}
      style={[
        props.style as TextStyle,
        {
          fontFamily: LUCIDE_FONT_FAMILY,
          fontSize: size,
          lineHeight: size,
          color,
          width: size,
          height: size,
          textAlign: "center",
          // Strip Android's default font padding so the glyph sits centered in
          // the size×size box the way an SF Symbol would.
          includeFontPadding: false,
          textAlignVertical: "center",
        },
      ]}
    >
      {glyphForSymbol(props.name)}
    </Text>
  );
}

export type { SymbolViewProps };
export type SymbolViewComponentProps = ComponentProps<typeof SymbolView>;
