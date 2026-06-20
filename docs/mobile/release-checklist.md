# Release Checklist

## Pre-Release Verification

- [ ] `vp check` passes with 0 errors
- [ ] `vp run typecheck` passes across all packages
- [ ] `vp run lint:mobile` passes (native static check; install SwiftLint/ktlint/detekt for full coverage)
- [ ] All mobile tests pass: `cd apps/mobile && vp test`
- [ ] Auth smoke test: sign in, see environments, connect
- [ ] Pairing smoke test: paste pairing URL, QR scan, exchange credential
- [ ] Chat smoke test: send message, see response, approve action
- [ ] Reconnect smoke test: background app, foreground, verify reconnect
- [ ] Deep link smoke test: tap notification link, navigate to thread
- [ ] Prompt injection / sanitization review on all user-exposed inputs

## Auth Configuration

- [ ] Clerk `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` set in EAS secrets or `.env`
- [ ] Clerk `EXPO_PUBLIC_CLERK_JWT_TEMPLATE` matches relay configuration
- [ ] Relay URL (`EXPO_PUBLIC_RELAY_URL`) points to production relay
- [ ] CORS and redirect origins configured in Clerk dashboard for `vipercode://`

## Relay Configuration

- [ ] Relay production deployment healthy
- [ ] Mobile device registration endpoint available
- [ ] Managed environment endpoints routable from relay
- [ ] DPoP signing keys compatible between mobile and relay

## APK Signing

- [ ] Android keystore generated and stored securely
- [ ] Signing key alias, password, and keystore configured in `eas.json` or `credentials.json`
- [ ] Production build signed with upload key (not debug key)
- [ ] APK signature verified: `jarsigner -verify -verbose -certs <apk>`

## API and Data

- [ ] No secrets (tokens, passwords, keys) logged in release builds
- [ ] `expo-secure-store` used for all credential storage (not AsyncStorage)
- [ ] Pairing tokens removed from storage after exchange
- [ ] HTTP requests go through DPoP where applicable
- [ ] WebSocket connections use secure `wss://` endpoints

## Performance

- [ ] FlatList uses `windowSize`, `removeClippedSubviews`, `maxToRenderPerBatch`
- [ ] Long threads (1000+ messages) scroll without jank
- [ ] App resumes within 3s after foregrounding
- [ ] Memory stable when viewing long threads (no unbounded growth)
- [ ] No aggressive polling in background state

## Distribution

- [ ] APK available from a known download URL or EAS build link
- [ ] User docs (`docs/mobile/app.md`) up to date
- [ ] Build docs (`docs/mobile/android-build.md`) up to date
- [ ] Minimum Android SDK version documented
- [ ] Known issues documented

## Post-Release

- [ ] Monitor crash reports for first 24 hours
- [ ] Verify push notification delivery
- [ ] Verify deep links open correct screens
- [ ] Verify relay connection metrics normal
- [ ] Collect feedback on UX gaps (pairing flow, empty states, error messages)
