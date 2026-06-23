# Mobile UI Redesign Design

**Date:** 2026-06-15  
**Scope:** Redesign the existing Viper Code Mobile screens (Home, Environment Threads, Thread Detail, Pair, Settings, New Thread) to match the desktop app's visual language. No new desktop Settings pages are ported.

## Design Read

Mobile app UI redesign for a coding-agent tool, with a dark, professional, desktop-parity language, leaning toward a React Native implementation that mirrors the desktop Electron app's dark chrome and sidebar-driven navigation.

**Dials:** `DESIGN_VARIANCE: 5` | `MOTION_INTENSITY: 4` | `VISUAL_DENSITY: 3`

## Approach

**Chosen approach:** Desktop-informed, mobile-native (Option B).

Adopt the desktop color palette, typography, real logo, and surface styling, but adapt layouts for mobile ergonomics: stack-based navigation with a top header that carries the wordmark, full-width row lists, bottom sheets for secondary actions, and thumb-friendly touch targets. This keeps the app unmistakably part of the same product while remaining usable on a phone.

## Visual System

### Color Palette

| Token               | Value     | Usage                                                 |
| ------------------- | --------- | ----------------------------------------------------- |
| `background`        | `#0A0A0B` | App canvas                                            |
| `surface`           | `#141417` | Cards, header, composer, list rows                    |
| `surfaceElevated`   | `#1C1C20` | Inputs, elevated sheets, segmented control background |
| `border`            | `#26262B` | 1px hairline borders                                  |
| `primary`           | `#3870F9` | Primary buttons, active states, user message fill     |
| `primaryForeground` | `#FFFFFF` | Text on primary                                       |
| `text`              | `#F5F5F5` | Primary text                                          |
| `textSecondary`     | `#A1A1AA` | Secondary text                                        |
| `textMuted`         | `#6B6B73` | Muted labels, placeholders                            |
| `success`           | `#10B981` | Connected / running status                            |
| `warning`           | `#F59E0B` | Connecting / interrupted status                       |
| `error`             | `#EF4444` | Errors, destructive borders                           |

All surfaces are separated by 1px borders (`border`) rather than shadows. No drop shadows on cards.

### Typography

Use the already-loaded **DM Sans** family.

| Style            | Size | Weight        | Usage                        |
| ---------------- | ---- | ------------- | ---------------------------- |
| Screen title     | 20px | 700           | Header title on sub-screens  |
| Row title        | 15px | 600           | Environment / thread titles  |
| Body / secondary | 14px | 400           | Message text, hints          |
| Section label    | 12px | 500 uppercase | Project/setting group labels |
| Caption / mono   | 12px | 400           | URLs, IDs (use monospace)    |

### Logo

Use the exact asset provided by the user:

```text
C:\Users\viper\Documents\Viper Projects\ViperCode assests\ViperCodeLogoOnlyTextPNGWhiteText.png
```

Display it in:

- Home screen header (left side, ~22dp height).
- Empty state (centered, ~40dp height, 90% opacity).
- Splash/icon references where the text logo is currently used.

Replace the existing `ViperCodeMark`/`ViperCodeHeaderTitle` hand-rolled SVG/text combination with an `<Image>` component pointing to the asset above.

## Navigation Chrome

- **Top app bar:** fixed height (~56dp), `surface` background, bottom border, left-aligned logo.
- **Header actions:** right-aligned.
  - Home: bold `+` (pair new environment) and hamburger menu (settings).
  - Sub-screens: back arrow + screen title.
- **Settings navigation:** tapping the hamburger menu pushes the existing `Settings` screen onto the native stack.
- **Back behavior:** native stack back button returns to Home; system back gesture behaves the same.
- **Icon weight:** 3dp stroke for header icons to match the bold wordmark.
- **Status bar:** `style="light"` to keep the dark chrome consistent.
- **Safe areas:** top app bar adds top safe-area inset; composer adds bottom safe-area inset.

## Screen-by-Screen Design

### Home Screen

- Remove the floating card style for environment rows.
- Use full-width rows with 1px bottom borders on `surface` (row separators).
- Each row is at least 56dp tall.
- Row content:
  - Left: environment label (15px semibold) + URL or status hint (12px mono/muted).
  - Right: status text + 8dp status dot.
- Loading state: centered spinner + "Loading environments..." on `background`.
- Error state: inline error banner with retry action.
- Empty state: centered logo + "No environments yet" + one-line hint + primary "Pair Environment" button.

### Environment Threads Screen

- Header: back arrow + environment label + "+ New" action.
- Threads grouped by project title.
- Section header: small uppercase muted label above each group.
- Thread rows: full-width `surface` rows with 1px bottom borders (row separators).
  - Left: thread title + status meta (e.g. "Running · Needs Approval").
  - Right: 8dp status dot.
- Loading state: centered spinner + "Loading threads...".
- Empty state: centered "No Threads" + "Start a new thread from the actions menu."
- Error state: inline error banner with retry action.

### Thread Detail Screen

- Header: back arrow + thread title.
- Provider/agent status banner at the top:
  - Left: indicator dot + status label.
  - Right: Stop / Retry text actions.
- Message list:
  - Assistant messages: `surface` card with 1px border, 12px padding, 12px radius.
  - User messages: solid `primary` fill, white text, same radius/padding, aligned right.
  - Streaming indicator: small "streaming" label above assistant text.
- Composer:
  - Container: `surface`, top border, respects bottom safe area and keyboard.
  - Use `KeyboardAvoidingView` (iOS padding / Android adjustResize) so the composer stays above the keyboard.
  - Input: pill-shaped `surfaceElevated` field with 1px border, multiline, max height 120dp.
  - Send button: circular `primary` button with white arrow icon, 32dp diameter.
  - Disabled send button: 30% opacity.
- Loading state: centered "Loading thread...".
- Empty state: centered "No messages yet" + "Send a message to start the conversation."

### Pair Screen

- Segmented control (Scan / Paste / Manual):
  - Container: `surfaceElevated` with 1px border, pill-shaped.
  - Active tab: `primary` fill with white text.
  - Inactive tab: transparent with `textSecondary` text.
- Camera frame: `surface` background, 1px border, 12px radius.
- Inputs: `surfaceElevated`, 1px border, 12px radius, 15px text.
- Primary buttons: `primary` fill, 12px radius, 48dp min height.
- Error banner: `surface` with 1px `error` border.

### Settings Screen

- Section label: "Account" in uppercase muted text.
- Account card: `surface` with 1px border, 12px radius.
  - Email (15px).
  - User ID (12px mono muted).
- Sign Out row: `surface` with 1px `error` border, red text, 12px radius.

### New Thread Screen

- Header: back arrow + "New Thread" title.
- Form stacked vertically on `background` with 16dp horizontal padding:
  - **Project selector:** `surface` row with 1px border, 12dp radius, selected project label + chevron.
  - **Provider selector:** `surface` row with 1px border, 12dp radius, selected provider label + chevron.
  - **Initial message input:** multiline `surfaceElevated` field with 1px border, 12dp radius, placeholder "What should we work on?".
- Primary action: full-width "Start Thread" button, `primary` fill, 12dp radius, 48dp min height, disabled until a project, provider, and message are provided.
- Loading state: button shows spinner + "Starting...".
- Error state: inline error text below the failing field or a banner at the bottom.

## Components to Update

1. **`apps/mobile/src/theme/index.ts`** — update `primary` to `#3870F9`.
2. **`apps/mobile/src/components/ViperCodeLogo.tsx`** — replace SVG/text logo with the provided PNG image component.
3. **`apps/mobile/src/app/navigation/AppNavigator.tsx`** — update header colors to `surface`/`text`, remove default title text on Home.
4. **`apps/mobile/src/app/screens/HomeScreen.tsx`** — reskin environment rows, empty state, header actions.
5. **`apps/mobile/src/app/screens/EnvironmentThreadsScreen.tsx`** — reskin section headers and thread rows.
6. **`apps/mobile/src/app/screens/ThreadDetailScreen.tsx`** — reskin message list padding and status banner.
7. **`apps/mobile/src/components/MessageBubble.tsx`** — new assistant/user bubble styles.
8. **`apps/mobile/src/components/Composer.tsx`** — pill input + circular send button.
9. **`apps/mobile/src/app/screens/PairScreen.tsx`** — segmented control, inputs, buttons.
10. **`apps/mobile/src/app/screens/SettingsScreen.tsx`** — account card and sign-out row.

## Motion & Interaction

- Press feedback: scale to 0.98 or opacity to 0.8 on tappable rows/buttons within 100ms.
- List mounts: no animation required; keep it snappy.
- Composer send button: subtle scale to 0.95 on press.
- Screen transitions: use the native stack defaults (no custom transitions).
- Reduced motion: when the system setting is enabled, disable all press-scale feedback and keep state changes instant (opacity-only or no transition).

## Assets

- Source logo: `C:\Users\viper\Documents\Viper Projects\ViperCode assests\ViperCodeLogoOnlyTextPNGWhiteText.png`
- **Required:** copy the source logo into `apps/mobile/assets/viper-logo-white.png` during implementation. React Native's Metro bundler cannot resolve assets outside the project root, so the mobile app must bundle its own copy. The implementation should reference `require("../../assets/viper-logo-white.png")` (or equivalent) rather than the source path.

## Acceptance Criteria

- [ ] `vp check` and `vp run typecheck` pass.
- [ ] The provided logo is used instead of the SVG/text logo.
- [ ] Primary blue is `#3870F9` across all screens.
- [ ] All screens use the surface/border color system (no floating card shadows).
- [ ] Header icons are visibly bold (3dp stroke or equivalent).
- [ ] Touch targets are ≥44dp.
