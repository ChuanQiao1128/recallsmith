# G03 — No debug menu in production (R25 §3)

## What changed
- `mobile/src/telemetry/sentryPolicy.ts` — new `isProductionChannel(channel)`: the one "production update channel" rule (trimmed, case-insensitive `=== 'production'`). `decideSentry` now calls it. Sentry behaviour is unchanged.
- `mobile/src/config/debugMenu.ts` (new) — `isDebugMenuAvailable({ isDev?, channel? })` = `isDev || (channel is a non-blank string && !isProductionChannel(channel))` (the non-blank-string check was added in r25x F03; see below). By default it reads `__DEV__` and the expo-updates channel through the existing guarded `getExpoUpdatesModule()`.
- `mobile/src/navigation/debugMenuRoute.ts` (new) — `debugMenuRoute(() => <Stack.Screen …/>)` returns the screen element only when the menu is available, and `null` otherwise.
- `mobile/App.tsx` — the `DebugMenu` stack route is registered through `debugMenuRoute(...)`, so a production-channel release build has no DebugMenu route.
- `mobile/src/screens/SettingsScreen.tsx` — the version label gets its 7-tap press handler only when `isDebugMenuAvailable()`. On the production channel it gets no handler, so taps do nothing. The `__DEV__`-only Debug section is unchanged.

## Shipped behaviour
| Build | 7 taps on version label | DebugMenu route |
|---|---|---|
| `__DEV__` (any channel) | opens Debug menu | registered |
| release, channel `development` / `preview` / any other non-blank name except `production` | opens Debug menu | registered |
| release, channel missing, blank, not a string, or expo-updates unreadable | does nothing | not registered |
| release, channel `production` (App Store) | does nothing | not registered |

Correction (r25x F03): the original G03 gate treated a missing or unreadable channel as "not production" and so opened the Debug menu in release builds. That was the unsafe direction, and it was not "the same as the Sentry gate": for Sentry an unknown channel is the safe outcome (Sentry off), for the Debug menu it was the unsafe one (menu on). The gate now fails closed: outside `__DEV__` an unknown channel keeps the menu off and the route unregistered, just as it keeps Sentry off. `isProductionChannel` is unchanged. Every eas.json store profile sets `channel: "production"`.

## Tests
- `mobile/tests/unit/debugMenuAvailability.test.tsx` covers:
  - The production channel turns the menu off.
  - Preview, development and `__DEV__` turn it on.
  - The default inputs come from `__DEV__` and expo-updates.
  - The channel rule matches `decideSentry` for each named sample channel.
  - Outside `__DEV__`, a missing / null / blank / non-string channel, or an unreadable expo-updates module, keeps the menu off and `debugMenuRoute` null (r25x F03).
  - `debugMenuRoute` returns null on production and an element on preview or in `__DEV__`.
  - `App.tsx` registers `DebugMenu` only through `debugMenuRoute`.
- `mobile/tests/integration/settings.screen.test.tsx` covers:
  - On the preview channel outside `__DEV__`, 7 taps open the menu (this is the existing test, now pinned to the preview channel).
  - On the production channel, 14 taps never navigate.
  - In `__DEV__` on the production channel, 7 taps open the menu.
  - With no channel (undefined, null, '') outside `__DEV__`, 14 taps never navigate (r25x F03).
- Gates: `cd mobile && npx tsc --noEmit && npx vitest run` passes (293 files, 2292 tests).

## Owner steps
- None to ship. The change is JS-only and OTA-safe on runtime 2.0.0. Publish it with the R25 OTA to the `production` channel after App Review approval.
- To use the Debug menu on a device, install a build on a non-production channel (development or staging profile).

## Deferred
- `DebugMenuScreen` has no gate of its own. It cannot be reached once its route is absent.
