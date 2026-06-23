# Viper Code

Viper Code is a minimal GUI for coding agents. It runs Codex, Claude, GitHub Copilot, and OpenCode from one desktop/web UI, with worktrees, diffs, approvals, source-control actions, and Android access through Viper Connect.

This is still early WIP. Expect bugs.

## Installation

Grab builds from [GitHub Releases](https://github.com/quickrunlab/ViperCode/releases).

### Windows Desktop

Download and run the latest `Viper-Code-x.y.z-x64.exe` installer.

Windows builds are unsigned for now, so SmartScreen may show "Windows protected your PC" on first install. Click **More info** -> **Run anyway**.

### Android Mobile App

The Android app is distributed as an APK release asset named `viper-code-mobile.apk`.

1. Download `viper-code-mobile.apk` from the newest release that includes it.
2. Copy it to your Android device, or download it directly on the device.
3. Open the APK and allow "Install unknown apps" for your browser or file manager if Android asks.
4. Open Viper Code, sign in with the same Viper Connect account used on desktop, then select your linked environment.

The mobile app connects to an existing desktop/server environment; it does not run agents locally. To link an environment, open the desktop app and go to **Settings -> Connections -> Viper Connect**. If your environment is not listed on mobile, create a pairing link or QR code from **Settings -> Connections -> Authorized clients**.

If Android refuses to install over an older APK, uninstall the old mobile app first and install the new APK again. This can happen when switching between preview/debug and release-signed builds.

## Providers

Install and authenticate at least one provider before use:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- GitHub Copilot: install [GitHub Copilot CLI](https://github.com/github/copilot-cli) and run `copilot login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
- Antigravity: install the [Antigravity CLI](https://antigravity.google/download), run `agy` to sign in, and `pip install google-antigravity`. See [docs/providers/antigravity.md](./docs/providers/antigravity.md). Sessions are SDK-backed through Viper Code's Python bridge; OAuth/ADC (`gcloud auth application-default login` plus GCP project/location) is the primary auth path, with `GEMINI_API_KEY` as an explicit fallback.

Viper Code uses your existing CLI setup. Provider settings also support multiple named instances, custom homes, custom env vars, sensitive secret storage, model favorites, and provider-specific model controls.

## What works now

- Run Codex, Claude, GitHub Copilot, and OpenCode sessions from one interface.
- Use local projects or git worktrees.
- Review per-turn diffs, changed files, plans, approvals, and user-input requests.
- Clone, publish, and open GitHub PRs or GitLab MRs from inside the app.
- Connect from Android through Viper Connect, pairing links, or QR codes.
- Receive mobile notifications for task completion, approvals, and input requests.
- Expose desktop/server environments through the Viper Connect relay when configured.
- Self-update desktop builds from GitHub Releases.

## Run from source

Requirements:

- Node.js 24+
- pnpm 10 (`npm install -g pnpm@10.24.0`)
- Vite+ (`npm install -g vite-plus@0.1.24`, provides `vp`)

```bash
vp i
pnpm dev
pnpm dev:desktop
```

Useful checks:

```bash
vp check
vp run typecheck
vp test
```

## Docs

- [Documentation index](./docs/README.md)
- [Architecture](./docs/architecture/overview.md)
- [Providers](./docs/providers/codex.md)
- [Viper Connect](./docs/cloud/viper-connect-clerk.md)
- [Mobile app](./docs/mobile/app.md)
- [Source control](./docs/integrations/source-control-providers.md)

## Fork history

ViperCode started from an MIT-licensed upstream fork. This project keeps the small agent-GUI idea, but now has Viper branding, GitHub Copilot, Viper Connect, Android support, provider instances, and a Windows-first release path.
