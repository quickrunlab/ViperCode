# Viper Mobile: Internal Preview & Revocation

Covers two operational tasks for Viper Connect mobile: installing an internal
preview build, and revoking access at the device, client, environment, and
account levels.

## Internal Preview Installation (Android)

Viper Mobile ships open (no waitlist). Internal testers install a preview APK.

### Get a preview APK

- **CI artifact** — the [`Mobile Preview`](../../.github/workflows/mobile-preview.yml)
  workflow builds `viper-code-mobile-preview.apk` on mobile-affecting pull
  requests and on manual dispatch. Download it from the workflow run's
  **Artifacts** section (retained 14 days).
- **Tagged release** — the [`Release`](../../.github/workflows/release.yml)
  workflow publishes a signed `viper-code-mobile.apk` to the GitHub Release for
  each `v*` tag.
- **Local build** — see [`android-build.md`](android-build.md).

Preview builds only expose Viper Connect when the repo's public config secrets
(`EXPO_PUBLIC_VIPERCODE_CLERK_PUBLISHABLE_KEY`,
`EXPO_PUBLIC_VIPERCODE_CLERK_JWT_TEMPLATE`, `EXPO_PUBLIC_VIPERCODE_RELAY_URL`)
are set; otherwise Connect stays hidden.

### Install on a device

```sh
# USB debugging enabled, device authorized
adb install -r viper-code-mobile-preview.apk
```

Or transfer the APK to the device and open it (allow "install from this
source" when prompted). Debug/preview APKs are signed with a debug key and
cannot be installed over a release-keyed build of the same package id — uninstall
first if the signatures differ.

### First-run smoke check

Run the [release checklist](release-checklist.md) smoke items: sign in, see
environments, connect, pair, send a message, approve an action, background and
foreground to confirm reconnect.

## Revocation

Access is layered. Revoke at the narrowest level that solves the problem.

### 1. Sign out a device

In the app: **Settings → Account → Sign out**. This clears the local Clerk
session and the SecureStore-held relay/DPoP credentials for that device. The
managed relay token store entry is dropped, so the device can no longer mint
environment credentials until it signs in again.

### 2. Revoke an authorized client

Each paired client holds a delegated authorization on an environment. Revoke a
single client without signing the account out everywhere:

- From another signed-in client: **Settings → Account → Devices/Clients →
  Revoke** (backed by the environment `clients/revoke` endpoint), or revoke all
  others via `clients/revoke-others`.
- The environment immediately rejects that client's bearer/DPoP tokens.

See [`docs/cloud/environment-auth.md`](../cloud/environment-auth.md) for the
client authorization model.

### 3. Unlink a Viper Connect environment

Removes the relay's managed link to an environment, revoking relay-minted
credentials and managed-endpoint provisioning for it:

- CLI: `viper connect unlink`
- App: **Settings → Environments →** select the environment **→ Unlink**

After unlink, the environment no longer appears in any signed-in client's
environment list and the relay stops provisioning managed endpoints for it.

### 4. Ban a user (account-level removal)

For full account removal, ban or delete the user in the **Clerk dashboard**.
This invalidates every session and token across web, desktop, mobile, and CLI.
`CLERK_SECRET_KEY` stays relay-side only; account administration happens in
Clerk, not in client builds. See
[`docs/cloud/viper-connect-clerk.md`](../cloud/viper-connect-clerk.md).
