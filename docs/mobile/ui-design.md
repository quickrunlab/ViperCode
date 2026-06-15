# Viper Code Mobile — UI Design Spec

The mobile app must visually match the Viper Code **web/desktop** app (`apps/web`). The web design
tokens are the source of truth (`apps/web/src/index.css`). This file translates them for the React
Native app. When in doubt, open the web app and mirror it.

The app is **dark-first** (match the web dark theme). Light theme is out of scope for now.

## Color palette (dark) — replace `apps/mobile/src/theme/index.ts`

Values are hex approximations of the web's dark `oklch`/`neutral` tokens. Keep them centralized in
the theme; never hardcode colors in components.

| Token               | Hex       | Use                                                        |
| ------------------- | --------- | ---------------------------------------------------------- |
| `background`        | `#0A0A0B` | App background (near-black neutral, NOT GitHub blue-black) |
| `surface`           | `#141417` | Cards, rows, sheets (subtle lift over background)          |
| `surfaceElevated`   | `#1C1C20` | Pressed/hover, nested cards, input fields                  |
| `border`            | `#26262B` | Hairline borders (= white @ ~6%)                           |
| `primary`           | `#4F6BFF` | Primary actions, accents (web `oklch(0.588 0.217 264)`)    |
| `primaryForeground` | `#FFFFFF` | Text/icons on primary                                      |
| `text`              | `#F5F5F5` | Primary text (neutral-100)                                 |
| `textSecondary`     | `#A1A1AA` | Secondary text, labels                                     |
| `textMuted`         | `#6B6B73` | Hints, timestamps, disabled                                |
| `success`           | `#10B981` | Connected / ready                                          |
| `warning`           | `#F59E0B` | Connecting / paused                                        |
| `error`             | `#EF4444` | Errors / destructive                                       |
| `info`              | `#3B82F6` | Info accents                                               |

Status dots/badges use success/warning/error/textMuted per connection or thread state.

## Typography

- **Sans (UI):** `DM Sans`. Bundle it via `@expo-google-fonts/dm-sans` + `expo-font`, load before
  rendering (splash held until fonts ready). Fall back to system sans while loading.
- **Mono (code, diffs, IDs, pairing codes):** platform monospace — `SF Mono` / `Consolas` /
  `monospace`.
- Scale (size / weight):
  - Screen title: 20 / 700
  - Section header (uppercase, letter-spaced, `textMuted`): 12 / 600
  - Body: 15 / 400
  - Body strong / row title: 15 / 600
  - Secondary / meta: 13 / 400
  - Button label: 15 / 600
  - Code/mono: 13 / 400

## Shape, spacing, elevation

- Radius: cards/sheets `12`, buttons `10`, inputs `10`, pills/status `999`.
- Spacing scale (keep existing): xs 4, sm 8, md 16, lg 24, xl 32.
- No heavy drop shadows. Separate surfaces with the `border` color and the surface/background
  contrast, matching the web's flat, bordered look.
- Cards: `surface` bg + 1px `border`, radius 12, padding md.
- Lists: full-width rows on `surface`, 1px `border` divider, generous vertical padding (md).

## Components

- **Buttons**
  - Primary: `primary` bg, `primaryForeground` text, radius 10, height ~48, centered 15/600 label.
  - Secondary: `surface`/transparent bg, 1px `border`, `text` label.
  - Pressed state: drop to `surfaceElevated` / 0.9 opacity. Disabled: 0.5 opacity.
- **OAuth sign-in buttons** (fix current bug — no icon, missing provider name)
  - Each button MUST show the provider **icon + full label**: e.g. a Google "G" mark + "Continue
    with Google", a GitHub mark + "Continue with GitHub". Icon left-aligned, label centered/next to
    it, single line (`numberOfLines={1}`), never truncated.
  - Use simple inline SVG/vector icons (e.g. `react-native-svg`) or a bundled icon set. Google
    button can be light/white per Google brand; GitHub button uses `surface` + border.
- **Inputs:** `surfaceElevated` bg, 1px `border`, radius 10, `text` color, `textMuted` placeholder.
- **Headers / nav:** background `surface`, title 20/700 `text`, back chevron + actions in `primary`.
- **Status pills/dots:** small rounded; color by state (success/warning/error/muted).
- **Cards (threads/projects/environments):** title (15/600), meta line (13/400 `textSecondary`),
  trailing status dot. Whole row pressable with pressed feedback.
- **Empty states:** centered icon (muted), title (16/600), one line of guidance (13/400
  `textSecondary`). Keep the existing Tailscale/pairing guidance copy.
- **Error banners/toasts:** `error` text on `surface`, dismissible, never spam (one at a time).

## Screen-by-screen intent (match web hierarchy)

- **Sign in:** centered "Viper Code" wordmark, subtitle, two OAuth buttons with icons. Match the dark
  palette and DM Sans.
- **Home / environments:** list of environment cards with label, host, status dot; prominent "Pair
  Environment" primary button; Tailscale-requirement notice in the empty state.
- **Pair:** segmented tabs (Scan / Paste URL / Manual) styled as a pill segmented control; camera
  view framed; clear single error with a "Try again" action.
- **Projects/threads:** grouped lists, status indicators matching web thread statuses.
- **Thread detail:** message bubbles (user vs assistant differentiated by alignment + surface),
  mono for code blocks, composer pinned at bottom with `surfaceElevated` input.

## Do / Don't

- DO centralize all colors/spacing/typography in `theme/index.ts` and consume from there.
- DO match the web's flat, bordered, neutral-dark + indigo aesthetic and DM Sans.
- DON'T reintroduce the GitHub-blue palette (`#0D1117`/`#58A6FF`).
- DON'T add gradients, glows, or heavy shadows — the web app is flat and restrained.
