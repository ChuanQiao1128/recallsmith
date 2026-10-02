# G03 — No debug menu in production (R25 §3)

## What changed
- `mobile/src/telemetry/sentryPolicy.ts` — new `isProductionChannel(channel)`: the one "production update channel" rule (trimmed, case-insensitive `=== 'production'`). `decideSentry` now calls it. Sentry behaviour is unchanged.
- `mobile/src/config/debugMenu.ts` (new) — `isDebugMenuAvailable({ isDev?, channel? })` = `isDev || !isProductionChannel(channel)`. By default it reads `__DEV__` and the expo-updates channel through the existing guarded `getExpoUpdatesModule()`.
- `mobile/src/navigation/debugMenuRoute.ts` (new) — `debugMenuRoute(() => <Stack.Screen …/>)` returns the screen element only when the menu is available, and `null` otherwise.
- `mobile/App.tsx` — the `DebugMenu` stack route is registered through `debugMenuRoute(...)`, so a production-channel release build has no DebugMenu route.
- `mobile/src/screens/SettingsScreen.tsx` — the version label gets its 7-tap press handler only when `isDebugMenuAvailable()`. On the production channel it gets no handler, so taps do nothing. The `__DEV__`-only Debug section is unchanged.

## Shipped behaviour
| Build | 7 taps on version label | DebugMenu route |
|---|---|---|
| `__DEV__` (any channel) | opens Debug menu | registered |
| release, channel `development` / `preview` / anything other than `production` | opens Debug menu | registered |
| release, channel `production` (App Store) | does nothing | not registered |

A missing or unreadable channel counts as "not production", which is the same as the Sentry gate (Sentry stays off and the menu is available). Every eas.json store profile sets `channel: "production"`.

## Tests
- `mobile/tests/unit/debugMenuAvailability.test.tsx` covers:
  - The production channel turns the menu off.
  - Preview, development and `__DEV__` turn it on.
  - The default inputs come from `__DEV__` and expo-updates.
  - The channel rule matches `decideSentry` for each sample channel.
  - `debugMenuRoute` returns null on production and an element on preview or in `__DEV__`.
  - `App.tsx` registers `DebugMenu` only through `debugMenuRoute`.
- `mobile/tests/integration/settings.screen.test.tsx` covers:
  - On the preview channel outside `__DEV__`, 7 taps open the menu (this is the existing test, now pinned to the preview channel).
  - On the production channel, 14 taps never navigate.
  - In `__DEV__` on the production channel, 7 taps open the menu.
- Gates: `cd mobile && npx tsc --noEmit && npx vitest run` passes (293 files, 2292 tests).

## Owner steps
- None to ship. The change is JS-only and OTA-safe on runtime 2.0.0. Publish it with the R25 OTA to the `production` channel after App Review approval.
- To use the Debug menu on a device, install a build on a non-production channel (development or staging profile).

## Deferred
- `DebugMenuScreen` has no gate of its own. It cannot be reached once its route is absent.
