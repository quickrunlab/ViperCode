# Antigravity

Google Antigravity support in Viper Code is SDK-backed. The provider appears in
Settings, reports live CLI/SDK status, starts sessions through a local Python
bridge, streams text and reasoning deltas, surfaces tool lifecycle events,
routes Antigravity permission and user-input prompts through Viper Code, and
stores SDK conversation IDs as resume cursors.

Antigravity is SDK-first: the `agy` CLI handles install, first-run product
sign-in, and version checks, while the `google-antigravity` Python SDK drives
sessions through a small Viper Code-owned bridge process.

## Install The CLI

The CLI binary is `agy`.

- macOS / Linux:

  ```bash
  curl -fsSL https://antigravity.google/cli/install.sh | bash
  ```

  Installs to `~/.local/bin/agy`.

- Windows (PowerShell):

  ```powershell
  irm https://antigravity.google/cli/install.ps1 | iex
  ```

  Installs to `C:\Users\<Username>\AppData\Local\agy\bin`.

- Windows (CMD):

  ```bat
  curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd
  ```

Download page: <https://antigravity.google/download>.

## Install The SDK

The SDK package is `google-antigravity`:

```bash
pip install google-antigravity
```

Use the same Python interpreter you point Viper Code at (see `Python path`
below). If the configured `python` cannot import `google.antigravity`, Viper
Code probes common Python 3.12 locations before reporting the SDK missing. The
published wheels include a platform-specific runtime binary, so a plain
`pip install` is required — cloning the GitHub repo is not enough.

## Authenticate

Sign in once with the CLI:

```bash
agy
```

On a local machine this uses the OS keyring for silent sign-in. Over SSH, the
CLI prints a URL and code to complete sign-in in a browser.

For Viper Code sessions, OAuth/ADC is the primary SDK auth path. Configure a
Google Cloud project and location, then authenticate Application Default
Credentials:

```bash
gcloud auth application-default login
```

The SDK's OAuth/ADC path uses `LocalAgentConfig(vertex=True, project=...,
location=...)`. Antigravity CLI OAuth token profiles are stored for the CLI, but
the current Python SDK does not expose a supported way to reuse those token
profiles directly. API-key auth remains available as an explicit fallback by
setting Auth mode to `api-key` and providing `GEMINI_API_KEY`.

## Configure The Provider In Viper Code

The default Antigravity provider uses OAuth/ADC mode. It works once the CLI,
SDK, GCP project/location, and ADC login are available:

```text
Display name: Antigravity
CLI path: agy
Python path: python
Auth mode: google-oauth
GCP project: <your-project>
GCP location: us-central1
```

Other settings:

- **Auth mode** — `google-oauth` by default. This uses SDK Vertex/ADC auth.
  Use `api-key` only when you explicitly want `GEMINI_API_KEY` fallback.
- **GCP project** — required for OAuth/ADC mode unless `GOOGLE_CLOUD_PROJECT`
  or `GCLOUD_PROJECT` is set in the provider environment.
- **GCP location** — Vertex/Gemini Enterprise location for OAuth/ADC mode.
- **Bridge path** — leave empty to use the bundled bridge.
- **Antigravity home path** — leave empty for the normal home; set it to isolate
  an instance's CLI/SDK state.
- **Launch arguments** — extra bridge/CLI args. Do not put environment variable
  assignments here; use the Environment variables section.
- **Tool permission** — default policy: `request-review`, `proceed-in-sandbox`,
  `always-proceed`, or `strict`. Viper Code approvals remain authoritative.
- **Terminal sandbox** — run shell commands in the Antigravity sandbox where
  supported (on by default).
- **Allow non-workspace access** — off by default; only enable if you need
  access outside the workspace.

The provider card shows whether the CLI and SDK are detected, the SDK version,
and setup guidance when something is missing.

## Multiple Instances

Add more Antigravity providers with separate display names, env vars, and an
optional `Antigravity home path` to isolate accounts or configurations. Instances
that share the same home share conversation continuation; instances with
different homes are treated as separate environments.

## Permissions And Safety

Viper Code is the user-visible approval authority. Defaults are conservative:

- workspace access only (no non-workspace access),
- terminal sandbox enabled where supported,
- writes, shell, and network actions go through Viper Code approvals unless you
  pick a more autonomous tool-permission mode.

Non-workspace access and `always-proceed` are never enabled silently.

## Troubleshooting

- **"Antigravity is not installed."** Neither `agy` nor the SDK was found.
  Install the CLI and run `pip install google-antigravity`.
- **"the `google-antigravity` SDK is missing."** The CLI is present but the SDK
  is not importable from the configured `Python path`. Run
  `pip install google-antigravity` with that interpreter, or point `Python path`
  at the interpreter where it is installed.
- **Wrong Python detected.** Set `Python path` to an absolute path (for example
  `/usr/bin/python3` or a virtualenv's `python`).
- **OAuth/ADC setup issues.** Set GCP project/location and run
  `gcloud auth application-default login`. CLI sign-in alone is useful for
  `agy`, but the Python SDK uses ADC for OAuth-backed model calls.
- **API key fallback issues.** Set Auth mode to `api-key` and provide
  `GEMINI_API_KEY` in the provider or server environment.

## Known Limitations

- SDK auth status is not yet machine-readable, so the card shows
  authentication as unknown even after setup.
- Antigravity CLI OAuth token profiles are not currently reusable by the Python
  SDK; Viper Code uses the SDK's supported OAuth/ADC path instead.
- SDK checkpoint rollback is not exposed in this SDK build, so Viper Code can
  read thread snapshots and resume by conversation ID but cannot roll back an
  Antigravity conversation in-place.
- Updates are manual: re-run the CLI install script and
  `pip install --upgrade google-antigravity`.
