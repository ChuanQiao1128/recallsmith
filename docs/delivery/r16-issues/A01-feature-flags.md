# A01 — feature-flags: S3 feature-flag pipeline (remoteConfig.features + featureFlags.ts snapshot + applyRemoteFeatures + useForceUpdateGate hook-in)

## Context

Today the remote config is fetched once in `useForceUpdateGate` (`mobile/src/config/forceUpdateGate.ts:42`) and then dropped: nothing else in the app can read a flag from it. Release plan row S3 (`docs/release-1.6.0-plan-2026-09-19.md:229`) and MCQ plan §3.9 (`docs/mcq-card-type-plan-2026-09-18.md:138-146`) want a module-level flag snapshot so a later OTA can kill-switch MCQ, hide the paywall, or pick ceremony variants without a binary — effective on the **next cold start**, never mid-session. Read first: `mobile/src/config/remoteConfig.ts:27-29` (the `RemoteConfig` type you extend), `:66-76` (last-good cache is `JSON.parse`d unvalidated, so the merge must be defensive), `:122-129` (network first, last-good second); `mobile/src/config/forceUpdateGate.ts:40-57` (the async IIFE you hook into: `:42` awaits `loadRemoteConfig`, `:43` and `:49` are the early returns); `mobile/tests/unit/forceUpdateGate.test.tsx:16-32` (this suite mocks `../../src/config/remoteConfig` **entirely**, so `featureFlags.ts` may only `import type` from `./remoteConfig`, never a runtime value); `mobile/App.tsx:144` (the single mount of the hook — do not touch it).

## Constraints

- No new dependencies. `useSyncExternalStore` comes from `react` (19.1.0, already installed; `react-test-renderer` 19.1.0 is already a devDependency and is what `forceUpdateGate.test.tsx` renders with).
- Scope — only these four paths may change; nothing else under `mobile/`:
  - `mobile/src/config/remoteConfig.ts` (additive type only — no behaviour change; `remoteConfig.test.ts` must stay green untouched)
  - `mobile/src/config/featureFlags.ts` (new)
  - `mobile/src/config/forceUpdateGate.ts` (one import + one call)
  - `mobile/tests/unit/featureFlags.test.ts` (new; `.ts`, not `.tsx` — use `React.createElement` if you render)
- Frozen (gacha-v7.md §2.1) — must show zero lines in `git diff --numstat`: `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`.
- Do not change any existing test file or test literal. `forceUpdateGate.test.tsx` (4 cases) and `remoteConfig.test.ts` (8 cases) must pass exactly as they are on disk.
- No consumer wiring: the only file under `mobile/src` or `mobile/App.tsx` that imports `featureFlags` is `forceUpdateGate.ts`. No screen, store, planner, or paywall reads the flags in this issue.
- No `@ts-ignore`, `@ts-expect-error`, `eslint-disable` anywhere in the four files.
- Defaults are fixed by spec: `mcq.enabled=true`, `mcq.recallFirst=true`, `mcq.maxPerRun=2`, `mcq.answerTelemetry=false`, `paywall.hidden=false`.

## Changes required

1. **`mobile/src/config/remoteConfig.ts`** — after `IosRemoteConfig` (`:19-25`) add exported, fully optional types and extend `RemoteConfig` (`:27-29`) additively:
   ```ts
   export type McqRemoteFeatures = {
     enabled?: boolean;
     recallFirst?: boolean;
     maxPerRun?: number;
     answerTelemetry?: boolean;
   };
   export type PaywallRemoteFeatures = { hidden?: boolean };
   export type RemoteFeatures = { mcq?: McqRemoteFeatures; paywall?: PaywallRemoteFeatures };
   export type RemoteConfig = { ios?: IosRemoteConfig; features?: RemoteFeatures };
   ```
   Nothing else in this file changes (no parsing, no validation here — the cache path at `:66-76` and the fetch path at `:99-110` keep returning whatever JSON parsed; validation lives in step 2).

2. **`mobile/src/config/featureFlags.ts`** (new) — a module-level snapshot store:
   - `import { useSyncExternalStore } from 'react';` and `import type { RemoteConfig } from './remoteConfig';` (type-only; see Context on why).
   - `export type FeatureFlags = { mcq: { enabled: boolean; recallFirst: boolean; maxPerRun: number; answerTelemetry: boolean }; paywall: { hidden: boolean } };` — every field required (the snapshot is always fully resolved).
   - `export const DEFAULT_FEATURE_FLAGS: FeatureFlags` with the spec defaults, frozen (`Object.freeze` on the object and both nested objects).
   - `export function getFeatureFlags(): FeatureFlags` — synchronous, returns the current snapshot object (same reference until the next change; `useSyncExternalStore` relies on this).
   - `export function applyRemoteFeatures(config: RemoteConfig | null | undefined): FeatureFlags` — merges `config?.features` over the defaults, field by field, and replaces the snapshot. Rules: `null`/`undefined` config, missing `features`, or a non-object `features`/`mcq`/`paywall` → defaults for the affected fields. A boolean field is taken only when `typeof === 'boolean'`; `maxPerRun` only when `Number.isInteger(n) && n >= 0`; anything else (strings, `null`, `1.5`, `-1`, `NaN`) falls back to that field's default. If the merged result is field-for-field equal to the current snapshot, keep the existing object reference and **do not notify listeners**; otherwise install the new (frozen) object and notify every subscriber once. Returns the snapshot now in force.
   - `export function subscribeFeatureFlags(listener: () => void): () => void` — `Set`-backed; the returned function unsubscribes.
   - `export function useFeatureFlags(): FeatureFlags` — `useSyncExternalStore(subscribeFeatureFlags, getFeatureFlags, getFeatureFlags)`.
   - A doc comment on `applyRemoteFeatures` (or the module header) that states the latency honestly and contains the literal phrase `next cold start`: the store is written once per launch from `useForceUpdateGate` after `loadRemoteConfig` (network first, then last-good cache), so a value published to S3 reaches a device on its next cold start; a flag never flips mid-session because nothing re-fetches, and consumers are expected to read the flag once at the moment they need it (the MCQ plan's `renderAsMcq` rule) rather than re-render on it.

3. **`mobile/src/config/forceUpdateGate.ts`** — add `import { applyRemoteFeatures } from './featureFlags';` next to `:3`, and insert exactly one statement `applyRemoteFeatures(config);` immediately after `const config = await loadRemoteConfig(url);` (`:42`) and **before** `if (cancelled || !config) return;` (`:43`). The call runs for a `null` config too (that resets the snapshot to defaults, which is the honest answer for a device that has never read a config) and regardless of `cancelled` (the store is module-level, not component state; the freshest config wins). A one-line comment above the call saying flags are applied before the gate's early returns so a non-gating config still feeds the store. Nothing else in this file changes: the `null`-first render, the raise-only gate, the cleanup, and the `[url]` dependency all stay as they are.

4. **`mobile/tests/unit/featureFlags.test.ts`** (new) — vitest, `describe`/`it`, reset with `applyRemoteFeatures(null)` in `beforeEach`. Required cases (add more if you like, never fewer):
   1. `getFeatureFlags()` before any apply equals `DEFAULT_FEATURE_FLAGS` (`toEqual` with the literal `{ mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false }, paywall: { hidden: false } }`).
   2. A full override (`mcq.enabled=false, recallFirst=false, maxPerRun=5, answerTelemetry=true, paywall.hidden=true`) is reflected by `getFeatureFlags()` and returned from `applyRemoteFeatures`.
   3. Partial config (`{ features: { paywall: { hidden: true } } }`) keeps every `mcq` default; `{ features: { mcq: { maxPerRun: 0 } } }` yields `maxPerRun === 0` with the other three mcq defaults.
   4. Garbage is rejected per field: `enabled: 'no'`, `recallFirst: 1`, `maxPerRun: '3'`, `maxPerRun: 1.5`, `maxPerRun: -1`, `answerTelemetry: null`, `features: 'x'`, `mcq: []` → each affected field is the default.
   5. `applyRemoteFeatures(null)` after an override restores the defaults; `applyRemoteFeatures(undefined)` and `applyRemoteFeatures({})` behave the same.
   6. Subscription: a listener registered with `subscribeFeatureFlags` fires exactly once for a changing apply, zero times for an apply that yields an equal snapshot (same config applied twice → 1 call total), and zero times after unsubscribe; `getFeatureFlags()` returns the identical reference (`toBe`) across the no-change apply.
   7. `useFeatureFlags()` — render a probe with `react-test-renderer` inside `act` (same `IS_REACT_ACT_ENVIRONMENT` setup as `forceUpdateGate.test.tsx:53`); it reads the defaults on first render and re-renders with the new snapshot after `applyRemoteFeatures` is called inside `act`.
   8. Hook-in through `useForceUpdateGate`: `vi.mock('../../src/config/remoteConfig', …)` exactly as `forceUpdateGate.test.tsx:16-32` does (a `configLoader` you can swap per test), import the hook from `../../src/config/forceUpdateGate`, render a probe, `await` the same double-`Promise.resolve()` flush, and assert (a) a config with **only** `features` and no `ios` (so the gate stays null and `:49` returns early) still lands in `getFeatureFlags()`; (b) after an override, a `null` loader result resets the snapshot to defaults (proves the call sits before `:43`).

## Acceptance

- `cd mobile && npx vitest run tests/unit/featureFlags.test.ts tests/unit/forceUpdateGate.test.tsx tests/unit/remoteConfig.test.ts --reporter=dot` — exits 0 (3 files; `forceUpdateGate.test.tsx` and `remoteConfig.test.ts` unmodified).
- `cd mobile && npm run test:typecheck` — exits 0.
- `bash docs/delivery/r16-issues/A01.verify.sh` — exits 0 (runs the two commands above plus: export/literal greps on `featureFlags.ts`, the statement-order check in `forceUpdateGate.ts` (`applyRemoteFeatures(config)` after the `await loadRemoteConfig` line and before `if (cancelled || !config) return;`), `features?:` in `remoteConfig.ts`, the `next cold start` comment, the "only forceUpdateGate.ts imports featureFlags" guard, the no-suppression guard, and `git diff --numstat` against `delivery/r16-a-home` showing zero lines for the three frozen files and no changed/untracked path under `mobile/src`, `mobile/tests`, or `mobile/App.tsx` outside the four scope paths).

## DO NOT

- Do not wire any consumer (screens, stores, session planner, paywall, ceremony) — that is later issues' work; this issue ends at the store plus the hook-in.
- Do not add persistence, a second fetch, polling, an app-state listener, or any "refresh flags mid-session" path; the documented latency is next cold start.
- Do not validate or reshape `features` inside `remoteConfig.ts`, and do not touch `REMOTE_CONFIG_CACHE_KEY`, `fetchRemoteConfig`, `loadRemoteConfig`, `resolveIosUpdate`, or `getCurrentAppVersion`.
- Do not change `mobile/App.tsx`, `forceUpdateGate.test.tsx`, `remoteConfig.test.ts`, or any file under `mobile/src/content`, `mobile/src/sync`, `mobile/src/review`.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy command, no disabling/skipping/deleting/gutting tests, no `@ts-ignore` / `@ts-expect-error` / `eslint-disable`, no loosening of tsconfig or vitest config.
