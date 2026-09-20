# Release scripts (iOS binary → App Store review, unattended)

Written 2026-09-20 for the 1.6.0 train (`docs/release-1.6-ship-runbook-2026-09-20.md`). Every script
has a dry-run mode and prints the evidence the runbook asks for (build id, submission id, ASC states).

| script | does | auth it uses |
|---|---|---|
| `ios-build.sh [profile]` | `eas build --platform ios --non-interactive --json --wait`; prints build id + artifact URL | EAS login (`eas whoami`) + EAS-managed signing |
| `ios-submit.sh [profile]` | `eas submit --platform ios --latest --non-interactive --wait`; uploads the newest finished build to App Store Connect | the App Store Connect API key stored on EAS (`[Expo] EAS Submit`) |
| `asc-release.cjs` | with the local Apple session (`~/.app-store/auth`, refreshed by `eas credentials`): wait for processing, ensure the App Store version, set What's New, attach the build, set release-after-approval, and with `--submit` create + submit the review submission | `@expo/apple-utils` from the global `eas-cli` install |
| `whats-new-1.6.0.txt` | the en-US What's New text `asc-release.cjs` pushes | — |

Nothing here reads or prints a secret: EAS holds the signing assets and the ASC API key; the Apple session
cookie is read by `@expo/apple-utils` itself. If `asc-release.cjs` exits 3 the Apple session expired —
run `eas credentials --platform ios` once (password from Keychain + 2FA) and re-run.

Typical run (from `mobile/`):

```bash
scripts/release/ios-build.sh production
scripts/release/ios-submit.sh production
node scripts/release/asc-release.cjs --version 1.6.0 --build 16 --wait-build --whats-new scripts/release/whats-new-1.6.0.txt --apply --submit
```

Add `DRY_RUN=1` (shell scripts) or omit `--apply` (node script) to see the plan without touching anything.
