# Antigravity

Google Antigravity support in Viper Code is SDK-backed. The provider appears in
Settings, reports live CLI/SDK status, starts sessions through a local Python
bridge, streams text and reasoning deltas, surfaces tool lifecycle events,
routes Antigravity permission and user-input prompts through Viper Code, and
stores SDK conversation IDs as resume cursors.

Antigravity uses the Python SDK for API-key and Vertex/ADC-backed sessions. For
personal `agy` OAuth without GCP project/location, Viper Code uses the
authenticated `agy -p` CLI path and reads model output from the CLI transcript
store, because the current SDK validates Gemini API-key endpoints before it can
reuse `agy` consumer OAuth.

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
location=...)`.

Viper Code also supports best-effort Antigravity CLI OAuth profile reuse. If
Auth mode is `google-oauth` and project/location are not configured, or Auth
mode is explicitly set to `agy-oauth`, the bridge looks for a readable CLI OAuth
profile or an explicit bearer token. The normal Antigravity CLI token profile is
`~/.gemini/antigravity-cli/antigravity-oauth-token`; the older
`~/.gemini/oauth_creds.json` file belongs to Gemini CLI and is only checked as a
legacy fallback. On Windows, Viper Code can also reuse the same Credential
Manager entry that `agy` uses: `gemini:antigravity`. Bearer-token env vars are
`AGY_OAUTH_TOKEN`, `ANTIGRAVITY_OAUTH_TOKEN`, `ANTIGRAVITY_ACCESS_TOKEN`, or
`GOOGLE_OAUTH_ACCESS_TOKEN`. Refresh-token env vars are
`AGY_OAUTH_REFRESH_TOKEN` and `ANTIGRAVITY_REFRESH_TOKEN`; refreshing from those
requires `ANTIGRAVITY_OAUTH_CLIENT_ID` and `ANTIGRAVITY_OAUTH_CLIENT_SECRET`.
Readable profiles are discovered from
`ANTIGRAVITY_CLI_OAUTH_PROFILE`, `ANTIGRAVITY_CLI_OAUTH_TOKEN_FILE`,
`GEMINI_OAUTH_CREDS`,
`<Antigravity home path>/antigravity-cli/antigravity-oauth-token`,
`<Antigravity home path>/antigravity-cli/oauth_creds.json`,
`<Antigravity home path>/antigravity-cli/google_credentials`,
`<Antigravity home path>/antigravity-cli/auth.json`,
`<Antigravity home path>/antigravity-cli/config.json`,
`<Antigravity home path>/oauth_creds.json`,
`<Antigravity home path>/google_credentials`,
`<Antigravity home path>/auth.json`, or the same paths under `~/.gemini`. Only
the access token is used and it is never logged. Expired Antigravity token
profiles are refreshed when a refresh token is available. For default
`google-oauth` without project/location, Viper Code uses `agy -p` and the CLI
transcript store instead of the SDK Gemini API-key path. Viper Code does not
fall back to `GEMINI_API_KEY` unless Auth mode is explicitly set to `api-key`.

API-key auth remains available as an explicit fallback by setting Auth mode to
`api-key` and providing `GEMINI_API_KEY`.

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

- **Auth mode** — `google-oauth` by default. This uses SDK Vertex/ADC auth when
  project/location are set, otherwise it can reuse an explicit OAuth bearer
  token or readable `agy` OAuth profile. Use `agy-oauth` to force token/profile
  reuse, or `api-key` only when you explicitly want `GEMINI_API_KEY` fallback.
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
and setup guidance when something is missing. When `agy models` returns model
names, Viper Code uses that live list as selectable models; otherwise it falls
back to the SDK defaults plus custom models.

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
- **OAuth setup issues.** Set GCP project/location and run
  `gcloud auth application-default login`, set `AGY_OAUTH_TOKEN`, or run
  `agy -p hello` to create or refresh the readable Antigravity CLI token
  profile/keyring entry. On Windows, Viper Code reads the `agy` keyring target
  `gemini:antigravity` directly.
- **No-project `google-oauth` appears slower than SDK mode.** This path shells
  out to `agy -p` and reads the CLI transcript after the command completes, so
  it is authenticated like the CLI but does not stream token-by-token.
- **API key fallback issues.** Set Auth mode to `api-key` and provide
  `GEMINI_API_KEY` in the provider or server environment.

## Known Limitations

- SDK auth status is not yet machine-readable, so the card shows
  authentication as unknown even after setup.
- The current SDK build still does not expose first-class `agy` keyring/profile
  reuse. Viper Code supports explicit OAuth bearer-token env vars and readable
  CLI token profiles, but it does not scrape OS keyrings.
- SDK checkpoint rollback is not exposed in this SDK build. Viper Code performs
  local-history rollback by trimming its provider turn snapshot and SDK
  conversation history where the SDK keeps it in memory. The bridge now probes
  for public SDK rollback/rewind methods first, so a future SDK release can take
  over without using private transports, but this is not a remote Antigravity
  checkpoint restore in the current SDK.
- The current SDK build does not expose a first-class model-list API. Viper Code
  uses `agy models` when the CLI returns output, then falls back to SDK defaults
  and custom models.
- Updates are manual: re-run the CLI install script and
  `pip install --upgrade google-antigravity`.
