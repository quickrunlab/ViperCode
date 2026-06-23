> **I'm using the writing-plans skill to create the implementation plan.**

# Mobile UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the existing Viper Code Mobile screens to match the desktop app's dark IDE visual language, using the provided logo and desktop primary blue.

**Architecture:** Update the shared theme tokens first, then replace the logo component and navigation chrome, then reskin each screen. Keep all changes within `apps/mobile`; do not add new desktop settings pages. The design system is color-token-driven, so most changes are style-only and do not alter business logic.

**Tech Stack:** React Native (Expo), TypeScript, `@react-navigation/native-stack`, DM Sans via `@expo-google-fonts/dm-sans`.

---

## Chunk 1: Foundation — Theme, Logo, Navigation Chrome

### Task 1.1: Copy the provided logo into the mobile app assets

**Files:**

- Copy: `C:\Users\viper\Documents\Viper Projects\ViperCode assests\ViperCodeLogoOnlyTextPNGWhiteText.png` → `apps/mobile/assets/viper-logo-white.png`

**Steps:**

- [ ] **Step 1: Copy the asset**
  ```powershell
  Copy-Item -Path "C:\Users\viper\Documents\Viper Projects\ViperCode assests\ViperCodeLogoOnlyTextPNGWhiteText.png" -Destination "apps/mobile/assets/viper-logo-white.png" -Force
  ```
- [ ] **Step 2: Verify the file exists**
  ```powershell
  Test-Path "apps/mobile/assets/viper-logo-white.png"
  ```
  Expected: `True`

---

### Task 1.2: Update theme tokens

**Files:**

- Modify: `apps/mobile/src/theme/index.ts`

**Steps:**

- [ ] **Step 1: Change the primary color to the desktop blue**
      Replace `primary: "#4F6BFF"` with `primary: "#3870F9"`.
- [ ] **Step 2: Verify the file**
      Run: `Select-String -Path "apps/mobile/src/theme/index.ts" -Pattern '#3870F9'`
      Expected: a match on the `primary` line.

---

### Task 1.3: Replace the logo component with the real logo image

**Files:**

- Modify: `apps/mobile/src/components/ViperCodeLogo.tsx`

**Steps:**

- [ ] **Step 1: Rewrite the component to render the bundled PNG**
      Keep the same named exports (`ViperCodeMark`, `ViperCodeHeaderTitle`) so existing callers do not change.

  ```tsx
  import React from "react";
  import type { ImageStyle, ViewStyle } from "react-native";
  import { Image, StyleSheet, View } from "react-native";

  const logoSource = require("../../assets/viper-logo-white.png");

  // The provided logo is 1738x289 (~6:1 aspect ratio).
  const LOGO_ASPECT = 1738 / 289;

  interface ViperCodeMarkProps {
    size?: number;
    color?: string;
    style?: ImageStyle;
  }

  export function ViperCodeMark({ size = 28, style }: ViperCodeMarkProps) {
    return (
      <Image
        source={logoSource}
        style={[{ width: size * LOGO_ASPECT, height: size }, style]}
        resizeMode="contain"
      />
    );
  }

  export function ViperCodeHeaderTitle() {
    return (
      <View style={styles.headerTitle}>
        <ViperCodeMark size={22} />
      </View>
    );
  }

  const styles = StyleSheet.create({
    headerTitle: {
      flexDirection: "row",
      alignItems: "center",
    },
  });
  ```

- [ ] **Step 2: Run typecheck**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Expected: no errors in `ViperCodeLogo.tsx`.

---

### Task 1.4: Update the navigator chrome

**Files:**

- Modify: `apps/mobile/src/app/navigation/AppNavigator.tsx`

**Steps:**

- [ ] **Step 1: Update screen options to use the dark surface chrome**
      Replace the `screenOptions` object with:
  ```tsx
  screenOptions={{
    headerStyle: {
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      shadowColor: "transparent",
      elevation: 0,
    },
    headerTintColor: theme.colors.text,
    headerTitleStyle: {
      fontFamily: theme.font.sans,
      fontWeight: "700",
      fontSize: 20,
      color: theme.colors.text,
    },
    headerBackTitleVisible: false,
    contentStyle: { backgroundColor: theme.colors.background },
  }}
  ```
- [ ] **Step 2: Remove the default title on Home so the logo component is the only title**
      Change `Home` screen options to:
  ```tsx
  <Stack.Screen name="Home" component={HomeScreen} options={{ title: undefined }} />
  ```
- [ ] **Step 3: Run typecheck**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Expected: no errors.

---

## Chunk 2: Home Screen

### Task 2.1: Reskin the Home screen

**Files:**

- Modify: `apps/mobile/src/app/screens/HomeScreen.tsx`

**Steps:**

- [ ] **Step 1: Update imports and constants**
      Ensure `theme` is imported and the existing `statusColor` helper is kept.
- [ ] **Step 2: Update header actions to use bold vector icons**
      Use inline SVG icons from `react-native-svg` (`Svg`, `Line`, `Polyline`, `Path`). Stroke width is 3dp; plus icon uses `theme.colors.primary`, hamburger menu uses `theme.colors.textSecondary`.
      Replace the header right `+` text with a `Pressable` wrapping the plus icon. On press, it navigates to `Pair` (existing behavior).
      Add a second `Pressable` wrapping the hamburger-menu icon. On press, call `navigation.navigate("Settings")`.
      Wrap each icon in a `Pressable` with `hitSlop` so the total touch target is at least 44dp.
- [ ] **Step 3: Replace environment card rows with full-width bordered rows**
      Update `envRow` style to:
  ```tsx
  envRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    minHeight: 56,
  },
  ```
- [ ] **Step 4: Update environment info and status display**
  - `envLabel`: 15px, semibold, `text`.
  - `envUrl`: 12px, `textMuted`, monospace.
  - Status dot: 8dp × 8dp.
  - Add status text next to the dot (e.g. "Connected") using `textMuted` 12px.
- [ ] **Step 5: Update loading state styling**
      When environments are loading, show a centered `ActivityIndicator` (color `theme.colors.primary`) with "Loading environments..." in `textSecondary` 14px.
- [ ] **Step 6: Update empty state to use the real logo**
      Replace the `ViperCodeMark` in the empty state with the same image component, size 40dp, opacity 0.9.
- [ ] **Step 7: Update the primary pair button style**
      Use `theme.colors.primary`, 12dp radius, 48dp height.
- [ ] **Step 8: Add an inline error banner style**
      If an environment connection error is shown, render it as a `surface` card with a 1px `error` border, 12dp radius, 14px red text, and a retry text button.
- [ ] **Step 9: Run typecheck and lint:mobile**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Run: `vp run lint:mobile`
      Expected: both pass.

---

## Chunk 3: Environment Threads Screen

### Task 3.1: Reskin the Environment Threads screen

**Files:**

- Modify: `apps/mobile/src/app/screens/EnvironmentThreadsScreen.tsx`

**Steps:**

- [ ] **Step 1: Update header right action style and screen title**
      The screen title is already set from `route.params.label`; verify the navigator options render it as the header title with the updated chrome from Task 1.4.
      Keep the `+ New` text label but style it with `theme.colors.primary`, 15px, font-weight 600. Wrap it in a `Pressable` with a minimum 44dp touch target (e.g. a 48dp × 36dp pressable area or `hitSlop` that yields ≥44dp vertically and horizontally).
- [ ] **Step 2: Update section header style**
      Replace the full-width bordered section header with a simple uppercase label:
  ```tsx
  sectionHeader: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: "500",
    color: theme.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: theme.font.sans,
  },
  ```
- [ ] **Step 3: Update thread row style**
      Change `threadRow` to full-width bordered rows:
  ```tsx
  threadRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    minHeight: 48,
  },
  ```
- [ ] **Step 4: Update thread meta and status dot**
  - `threadTitle`: 15px, weight 600, `text`.
  - `threadMeta`: 12px, `textMuted`.
  - Status dot: 8dp × 8dp.
- [ ] **Step 5: Update empty/loading/error state styling**
      Loading state: centered `ActivityIndicator` (color `theme.colors.primary`) with "Loading threads..." in `textSecondary` 14px.
      Empty state: keep centered text but use `text` for title and `textSecondary` for hint.
      Error state: inline `surface` banner with 1px `error` border, 12dp radius, 14px red text, and a retry text button.
- [ ] **Step 6: Run typecheck and lint:mobile**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Run: `vp run lint:mobile`
      Expected: both pass.

---

## Chunk 4: Thread Detail, Message Bubble, and Composer

### Task 4.1: Reskin message bubbles

**Files:**

- Modify: `apps/mobile/src/components/MessageBubble.tsx`

**Steps:**

- [ ] **Step 1: Update assistant bubble style**
  ```tsx
  assistantBubble: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 12,
    maxWidth: "85%",
  },
  ```
- [ ] **Step 2: Update user bubble style**
  ```tsx
  userBubble: {
    backgroundColor: theme.colors.primary,
    borderRadius: 12,
    padding: 12,
    maxWidth: "85%",
  },
  ```
- [ ] **Step 3: Update text and streaming badge**
  - Assistant text: `theme.colors.text`, 14px, lineHeight 20.
  - User text: `theme.colors.primaryForeground`, 14px, lineHeight 20.
  - Streaming badge: 10px, `textMuted`.
- [ ] **Step 4: Run typecheck**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Expected: no errors.

---

### Task 4.2: Reskin the Composer

**Files:**

- Modify: `apps/mobile/src/components/Composer.tsx`

**Steps:**

- [ ] **Step 1: Update container style**
  ```tsx
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    paddingBottom: 10,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  ```
- [ ] **Step 2: Update input to a pill shape**
  ```tsx
  input: {
    flex: 1,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: theme.colors.text,
    fontSize: 15,
    maxHeight: 120,
    marginRight: 8,
    fontFamily: theme.font.sans,
  },
  ```
- [ ] **Step 3: Replace the text send button with a circular icon button**
      The visible button is 32dp × 32dp (matching the spec). Wrap it in a larger pressable area or use `hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}` so the total touch target is at least 44dp.
  ```tsx
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.3,
  },
  ```
  Use an inline SVG arrow-up icon from `react-native-svg` inside the button (white, 2.5px stroke).
- [ ] **Step 4: Keep the composer above the keyboard**
      The parent `ThreadDetailScreen` already wraps the screen in `KeyboardAvoidingView`; verify the composer container is inside that wrapper and that `keyboardVerticalOffset` accounts for the header (~56dp). On Android, ensure the activity uses `adjustResize` (the existing Expo/Android setup should already handle this).
- [ ] **Step 5: Run typecheck**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Expected: no errors.

---

### Task 4.3: Reskin Thread Detail status banner and padding

**Files:**

- Modify: `apps/mobile/src/app/screens/ThreadDetailScreen.tsx`

**Steps:**

- [ ] **Step 1: Verify the header title**
      The screen title is already set from `route.params.title`; confirm the navigator renders it with the updated chrome from Task 1.4 (back arrow + title).
- [ ] **Step 2: Update message list padding**
      Change `messageList` to:
  ```tsx
  messageList: {
    paddingVertical: 8,
  },
  ```
- [ ] **Step 3: Add a status banner style with actions**
      Style the header area (`renderHeader`) with a `surface` card, 1px border, 12dp radius, and compact padding. Place it above the message list.
      The banner must include the Stop and Retry text actions on the right side (as described in the spec), wired to the existing `handleStop` and `handleRetry` callbacks.
- [ ] **Step 4: Update loading/empty text colors**
      Use `theme.colors.text` for titles and `theme.colors.textSecondary` for hints.
- [ ] **Step 5: Run typecheck and lint:mobile**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Run: `vp run lint:mobile`
      Expected: both pass.

---

## Chunk 5: Pair, Settings, and New Thread

### Task 5.1: Reskin the Pair screen

**Files:**

- Modify: `apps/mobile/src/app/screens/PairScreen.tsx`

**Steps:**

- [ ] **Step 1: Update segmented control style**
      Container:
  ```tsx
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: theme.colors.surfaceElevated,
    margin: theme.spacing.md,
    borderRadius: 999,
    padding: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  ```
  Active tab:
  ```tsx
  segmentTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "transparent",
  },
  segmentTabActive: {
    backgroundColor: theme.colors.primary,
  },
  segmentTabTextActive: {
    color: theme.colors.primaryForeground,
    fontWeight: "600",
  },
  ```
  Inactive tab:
  ```tsx
  segmentTabText: {
    color: theme.colors.textSecondary,
    fontWeight: "500",
  },
  ```
- [ ] **Step 2: Update inputs**
      Use `surfaceElevated`, 1px `border`, 12dp radius, 15px text.
- [ ] **Step 3: Update primary button style**
      Use `theme.colors.primary`, 12dp radius, 48dp height.
- [ ] **Step 4: Update camera frame**
      Use `surface` background, 1px `border`, 12dp radius.
- [ ] **Step 5: Update error banner**
      Use `surface` background, 1px `error` border, 12dp radius.
- [ ] **Step 6: Run typecheck and lint:mobile**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Run: `vp run lint:mobile`
      Expected: both pass.

---

### Task 5.2: Reskin the Settings screen

**Files:**

- Modify: `apps/mobile/src/app/screens/SettingsScreen.tsx`

**Steps:**

- [ ] **Step 1: Update container and section label**
      Container:
  ```tsx
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
  },
  ```
  Section title:
  ```tsx
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
    fontFamily: theme.font.sans,
  },
  ```
- [ ] **Step 2: Update account card style and text**
  ```tsx
  accountRow: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.lg,
  },
  accountLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.text,
    fontFamily: theme.font.sans,
  },
  accountId: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 2,
    fontFamily: theme.font.mono,
  },
  ```
- [ ] **Step 3: Update sign-out button and text**
  ```tsx
  signOutButton: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.error,
    borderRadius: 12,
    padding: theme.spacing.md,
    alignItems: "center",
    height: 48,
    justifyContent: "center",
  },
  signOutText: {
    color: theme.colors.error,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: theme.font.sans,
  },
  ```
- [ ] **Step 4: Run typecheck and lint:mobile**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Run: `vp run lint:mobile`
      Expected: both pass.

---

### Task 5.3: Reskin the New Thread screen

**Files:**

- Modify: `apps/mobile/src/app/screens/NewThreadScreen.tsx`

**Steps:**

- [ ] **Step 1: Read the current file and set the header title**
      Run: `Get-Content apps/mobile/src/app/screens/NewThreadScreen.tsx`
      If the screen does not already set the title, add a `useLayoutEffect` that calls `navigation.setOptions({ title: "New Thread" })`.
      Verify with: `Select-String -Path apps/mobile/src/app/screens/NewThreadScreen.tsx -Pattern '"New Thread"'`
      Expected: a match.
- [ ] **Step 2: Apply the surface/border design system**
  - Container background: `theme.colors.background`.
  - Project/Provider selector rows:
    ```tsx
    selectorRow: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 48,
    },
    selectorLabel: {
      fontSize: 15,
      fontWeight: "600",
      color: theme.colors.text,
      fontFamily: theme.font.sans,
    },
    selectorValue: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      fontFamily: theme.font.sans,
    },
    ```
  - Initial message input:
    ```tsx
    messageInput: {
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      padding: theme.spacing.md,
      color: theme.colors.text,
      fontSize: 15,
      minHeight: 120,
      maxHeight: 200,
      fontFamily: theme.font.sans,
      textAlignVertical: "top",
    },
    ```
  - Primary button: `theme.colors.primary`, 12dp radius, 48dp height.
  - Loading state: when submission is in progress, show an `ActivityIndicator` inside the button and change the label to "Starting..."; disable the button.
  - Error state: show a `surface` banner with 1px `error` border, 12dp radius, 14px red text, and a dismiss or retry action below the form.
  - Do not add manual press feedback here; it will be applied via the shared `usePressFeedback` hook in Task 6.3.
- [ ] **Step 3: Run typecheck and lint:mobile**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Run: `vp run lint:mobile`
      Expected: both pass.

---

## Chunk 6: Motion, Interaction, and Status Bar

### Task 6.1: Ensure StatusBar is light

**Files:**

- Modify: `apps/mobile/src/app/screens/HomeScreen.tsx` (and other screens if they set `StatusBar`)

**Steps:**

- [ ] **Step 1: Verify every top-level screen uses a light status bar**
      Confirm `<StatusBar style="light" />` is rendered in each of:
  - `HomeScreen`
  - `EnvironmentThreadsScreen`
  - `ThreadDetailScreen`
  - `PairScreen`
  - `SettingsScreen`
  - `NewThreadScreen`
    Add it to any screen that is missing it.

---

### Task 6.2: Create shared press-feedback hook

**Files:**

- Create: `apps/mobile/src/hooks/usePressFeedback.ts`
  - If the `apps/mobile/src/hooks` directory does not exist, create it first.

**Steps:**

- [ ] **Step 1: Implement the hook**

  ```ts
  import { useEffect, useState } from "react";
  import { AccessibilityInfo } from "react-native";

  export function usePressFeedback() {
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
      void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
      const subscription = AccessibilityInfo.addEventListener(
        "reduceMotionChanged",
        setReducedMotion,
      );
      return () => subscription.remove();
    }, []);

    return {
      reducedMotion,
      pressedStyle: (pressed: boolean) =>
        reducedMotion
          ? { opacity: pressed ? 0.7 : 1 }
          : { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
      buttonPressedStyle: (pressed: boolean) =>
        reducedMotion
          ? { opacity: pressed ? 0.7 : 1 }
          : { transform: [{ scale: pressed ? 0.98 : 1 }] },
      sendPressedStyle: (pressed: boolean) =>
        reducedMotion
          ? { opacity: pressed ? 0.7 : 1 }
          : { transform: [{ scale: pressed ? 0.95 : 1 }] },
    };
  }
  ```

- [ ] **Step 2: Run typecheck**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Expected: no errors.

---

### Task 6.3: Apply press feedback using the shared hook

**Files:**

- Modify: all screen/style files that define tappable rows or buttons

**Steps:**

- [ ] **Step 1: Apply press feedback to tappable rows**
      Use `usePressFeedback().pressedStyle` in `Pressable` components for:
  - `HomeScreen` environment rows
  - `EnvironmentThreadsScreen` thread rows
  - `NewThreadScreen` project/provider selector rows
  - `SettingsScreen` sign-out row
- [ ] **Step 2: Apply press feedback to primary buttons**
      Use `usePressFeedback().buttonPressedStyle` for:
  - `HomeScreen` "Pair Environment" button
  - `PairScreen` primary buttons
  - `NewThreadScreen` submit button
- [ ] **Step 3: Apply press feedback to header actions and the composer send button**
      Use `usePressFeedback().buttonPressedStyle` for:
  - `HomeScreen` plus and hamburger-menu header icons
  - `EnvironmentThreadsScreen` "+ New" header action
    Use `usePressFeedback().sendPressedStyle` for the `Composer` send button.
- [ ] **Step 4: Run typecheck and lint:mobile**
      Run: `vp run typecheck --filter @vipercode/mobile`
      Run: `vp run lint:mobile`
      Expected: both pass.

---

## Chunk 7: Final Verification

### Task 7.1: Run full checks

- [ ] **Step 1: Typecheck**
      Run: `vp run typecheck`
      Expected: passes.
- [ ] **Step 2: Check command**
      Run: `vp check`
      Expected: passes.
- [ ] **Step 3: Mobile lint (if applicable)**
      Run: `vp run lint:mobile`
      Expected: passes.
- [ ] **Step 4: Visual sanity check**
  - Confirm the logo in `apps/mobile/assets/viper-logo-white.png` is the provided file.
  - Confirm `theme.colors.primary` is `#3870F9`.
  - Confirm no floating card shadows remain (borders only).

---

## Chunk Review Handoff

After each chunk, run the relevant typecheck/lint commands and commit. Do not proceed to the next chunk until the current chunk passes review.
