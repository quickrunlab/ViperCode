# Viper Code

Viper Code is a minimal GUI for coding agents. It runs Codex, Claude, GitHub Copilot, and OpenCode from one desktop/web UI, with worktrees, diffs, approvals, source-control actions, and Android access through Viper Connect.

This is still early WIP. Expect bugs.

## Installation

Grab the latest build from [Releases](https://github.com/quickrunlab/ViperCode/releases):

- Windows: `Viper-Code-x.y.z-x64.exe`
- Android: `viper-code-mobile.apk`

Windows builds are unsigned for now, so SmartScreen may show "Windows protected your PC" on first install. Click **More info** -> **Run anyway**.

## Providers

Install and authenticate at least one provider before use:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- GitHub Copilot: make the `copilot` CLI available, then sign in from **Settings -> Providers**
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

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

## Releases

Pushing a `v*` tag runs the release workflow. It publishes the Windows installer, updater files, and Android APK to GitHub Releases.

The desktop app uses `electron-updater`, so public releases in this repo are also the update feed.

## Docs

- [Documentation index](./docs/README.md)
- [Architecture](./docs/architecture/overview.md)
- [Providers](./docs/providers/codex.md)
- [Viper Connect](./docs/cloud/viper-connect-clerk.md)
- [Mobile app](./docs/mobile/app.md)
- [Source control](./docs/integrations/source-control-providers.md)

## Fork history

Viper Code started as a fork of the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code). This fork keeps the small agent-GUI idea, but now has Viper branding, GitHub Copilot, Viper Connect, Android support, provider instances, and a Windows-first release path.
