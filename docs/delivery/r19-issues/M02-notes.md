# M02 — mobile Sentry: implementation notes

Issue #535, release 1.9.0 (wave R19M, M). Contract: M00 §0–§3.9, §8, §10, §11.

## Dependency

- `npx expo install @sentry/react-native` from `mobile/` added `"@sentry/react-native": "~7.2.0"` to `dependencies`
  between `@react-navigation/native-stack` and `@shopify/react-native-skia` (npm's alphabetical order).
- Installed version (`mobile/node_modules/@sentry/react-native/package.json`): **7.2.0**; the lockfile resolves
  `node_modules/@sentry/react-native` to `7.2.0`. npm also synced the lock's two root `version` fields to `1.6.1`
  (allowed by M00 §2.1). No other direct dependency, no `devDependencies` change, no `expo.install` block.

## `app.json`

`expo install` appended the bare string `"@sentry/react-native"` to `expo.plugins` (after
`"./plugins/withPodsDeploymentTarget"`). I replaced that element with exactly
`["@sentry/react-native/expo", { "url": "https://sentry.io/" }]` — no `organization` / `project`
(they come from `SENTRY_ORG` / `SENTRY_PROJECT` at build time, M00 §5.1). Nothing else in `app.json` changed.

## Where each M00 §3.4 step lives

| Step | Location |
|---|---|
| DSN read (the only one) | `mobile/src/telemetry/observability.ts:36` |
| 1. static gates → interim handlers, `{active:false, reason}` | `observability.ts:115-121` (`decideSentry` in `sentryPolicy.ts`) |
| 2. cached-config race (300 ms, rejection ⇒ `null`, timer cleared) → `kill-switch` | `observability.ts:123-132`, helper `readCachedConfig` `:69-83` |
| 3–4. `Sentry.init` literals in try/catch → `init-failed` + interim | `observability.ts:134-166` (`beforeSend` cap at `:151-156`) |
| 5. active + `subscribeFeatureFlags` → `Sentry.close()` once | `observability.ts:168-180`, `closeForKillSwitch` `:85-94` |
| 6. `captureException` | `observability.ts:197-207` |
| 7. `sendTestEvent` | `observability.ts:210-220` |
| 8. `wrapRootComponent` / `registerNavigationContainer` | `observability.ts:223-238` |
| §3.5 routing before apiBase/token/rate limit | `mobile/src/telemetry/clientErrorReporter.ts:114-123` |
| §3.6 App wiring | `mobile/App.tsx:111` (`captureException,`), `:113` (`startObservability`), `:192` (`registerNavigationContainer`), `:263` (`wrapRootComponent`) |

## Pending window (accepted)

`startObservability` runs at module scope in `App.tsx`, but when the static gates pass it awaits the cached-config
read (≤ 300 ms) before deciding. Errors thrown between module load and that decision reach neither sink: Sentry is not
initialised yet and the interim ErrorUtils/Hermes handlers are not installed yet (the injected `captureException`
returns `false`, so a boundary report in that window still takes the unchanged POST path, which needs a token that
does not exist this early). This is the window M00 §11 #2/#3 accepts. With no DSN (every build until the owner signs
up) the gates fail synchronously inside the first microtask and the interim handlers are installed as before.

## Debug ID evidence (change 11)

`EXPO_OFFLINE=1 npx expo export --platform ios --source-maps --output-dir <tmp>` from `mobile/`, with
`EXPO_PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` unset, succeeded and produced
`_expo/static/js/ios/index-<hash>.hbc` + `index-<hash>.hbc.map`. The source map carries the key `"debugId"`
(a UUID). The output was deleted, not committed.

## Contract clarifications (tree facts)

- M00 §2.1 calls `@sentry/react-native` the "first key" of `dependencies`; alphabetically it is not
  (`@aws-amplify…`, `@babel…`, `@react-native-async-storage…`, `@react-navigation…` sort before it). The intent is
  npm's alphabetical order, which `expo install` produced.
- M00 §2.2 #2 allows only added `sentry: DEFAULT_FEATURE_FLAGS.sentry,` lines, but `featureFlags.test.ts:154,186` are
  single-line `toEqual({ …, cardSource: DEFAULT_FEATURE_FLAGS.cardSource })` literals. Following K02 `cbc47d3` / K03
  `0a06e97`, each was extended in place by replacing the final ` });` with `, sentry: DEFAULT_FEATURE_FLAGS.sentry });`.

## Implementation choices worth knowing

- `observability.ts` loads `remoteConfig.ts` lazily (guarded `require` inside the default `loadCachedConfig`), so
  screens that import it (DebugMenu) do not pull AsyncStorage / expo-constants into their graph; the pinned
  `debug-menu-perf.screen.test.tsx` stays unchanged and green.
- `registerNavigationContainer` called while the status is still `pending` remembers the ref and registers it once
  init succeeds (the navigator's `onReady` can fire inside the pending window). When inactive it stays a no-op.
- `buildOtaTags`: `ota.update_id` is the id; `embedded` when the id is `null` or blank; `unknown` when there is no
  updates module or the field is absent.
