# F03 — r25x review fixes: no debug menu in production (fixes ledger)

All three findings describe the same defect: `isDebugMenuAvailable()` returned
`isDev || !isProductionChannel(channel)`, and `isProductionChannel(undefined | null | '')` is
`false`, so a release build with an unreadable expo-updates module or no channel had the
Debug menu route registered and the 7-tap door wired. Confirmed on the base: the new tests
below fail there (2 unit, 1 integration).

Fix (one root cause, one change): outside `__DEV__` the menu is available only when the
channel is a non-blank string that is not "production". `isProductionChannel` (Sentry's rule)
is unchanged, so Sentry behaviour is unchanged; both gates now fail closed on an unknown channel.

### q-correctness-1
Status: fixed
- Files: `mobile/src/config/debugMenu.ts`, `mobile/tests/unit/debugMenuAvailability.test.tsx`, `mobile/tests/integration/settings.screen.test.tsx`
- Test: `debugMenuAvailability.test.tsx` — "is false outside __DEV__ when expo-updates is unreadable or reports no channel" (module `null`, `{}`, channel `undefined` / `null` / `''` → menu off, `debugMenuRoute` returns null); `settings.screen.test.tsx` — "7 taps on the version label do nothing when the update channel is missing".

### q-security-1
Status: fixed
- Files: `mobile/src/config/debugMenu.ts`, `mobile/tests/unit/debugMenuAvailability.test.tsx`
- Test: `debugMenuAvailability.test.tsx` — "is false outside __DEV__ when the channel is missing, blank or not a string" (`undefined`, `null`, `''`, `'   '`, `0`, `{}` with `isDev: false` → false; with `isDev: true` → true). Chosen variant: fail closed outside `__DEV__` (a missing channel counts as production for this gate only); no new env signal.

### q-tests-1
Status: fixed
- Files: `mobile/tests/unit/debugMenuAvailability.test.tsx`, `mobile/tests/integration/settings.screen.test.tsx`, `docs/delivery/r25-issues/G03-notes.md`
- Test: the two unit tests above pin `module = null` and `channel = null` with `__DEV__ = false`. The old "shares the channel rule with the Sentry gate" test asserted the fail-open result for `''` / `undefined` / `null`; it now covers named channels only, and the missing-channel cases are asserted separately. `G03-notes.md` no longer calls the missing-channel outcome "the same as the Sentry gate"; it records the correction and the release-build row in the behaviour table.

## Gates
- `cd mobile && npx tsc --noEmit && npx vitest run` — pass.
