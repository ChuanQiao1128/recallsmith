# Integrated verification, 27 October 2026

All local checks below exited 0. The assembled code snapshot is `df2875c3befcc4341e878ad1b067ca1f77df0048`. [Machine-readable commands, times, hashes and source bindings](verification.json) identify the exact tested revisions. This evidence update changes only verification documents after the code checks.

| Check | Actual result |
|---|---|
| Backend full suite (.NET SDK 10.0.401) | **3,083 passed**, 0 failed/skipped |
| Frontend full suite | **1,684 passed**, 0 failed/skipped |
| Mobile full suite | **2,914 passed**, 3 artifact-dependent cases skipped in this mode |
| Linked publish → actual mobile importer | **1 backend + 3 mobile passed** using one fresh producer artifact |
| Built-console Chromium suite | **17 passed**, including unsaved edit → refresh 503 → manual save |
| Frontend build / TypeScript app and test projects | Passed |
| Mobile TypeScript | Passed |
| Frontend lint | 0 errors, 1 pre-existing `DeckListPage` hook dependency warning |
| Native QA entry guard self-check | Passed on the integrated sources |
| Native iOS Simulator guest journey | Main path 51.618 s; additional restart 4.165 s; durable state comparison passed |

The three default-mobile skips are the explicit same-run artifact suite. The linked runner independently executes all three against the successful backend producer's exact captured objects; a prior artifact cannot satisfy it. These cases are not silently counted as passed in the default suite.

The backend ran at `809e8c1ce60369587edcc8243585dc88aa877d07`; mobile, linked journey and guard checks ran at `46ce495b1bab47fac2b24b5cc657d72381f37214`; frontend/browser checks ran at the assembled code snapshot. Actual Git diffs confirm their relevant source and configuration paths are unchanged at the assembled snapshot. Native shipping-source paths are unchanged from `430b8c2c`, and its QA harness paths are unchanged from `6710f065`. No old PASS is adopted solely because a branch name matches.

## Reproduce

With repository dependencies installed, Docker available and .NET SDK 10 selected:

```sh
(cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests)
(cd frontend && npm test && npm run build && npm run lint && npm exec -- playwright test)
(cd mobile && npm run test:typecheck && npm exec -- vitest run)
DOTNET_BIN=/path/to/dotnet-10 bash scripts/test-publish-journey.sh
node mobile/tests/native/offline-entry.test.cjs
```

The [native report](native-journey.md#re-run-locally) has the dedicated Simulator build/run steps and artifact identity. Browser tests require the matching Playwright Chromium installation. Original command metadata and raw logs remain in the local `career-readiness-20261026/evidence/I1` workflow directory; no secret configuration or user payload log is included here.

## Evidence boundaries

- Browser API and identity-provider routes are stubs. The [linked publish journey](publish-journey.md) uses real isolated PostgreSQL and production business logic, with documented storage/network adapters and an injected manifest rebuild policy that bypasses the default freshness/debounce choice.
- Native evidence uses current-source JS in an isolated iOS 18.5 Simulator QA shell with the disclosed RevenueCat/native network adaptations. It establishes the local guest/offline path and selected durable state after restart. Production authentication, paid entitlements, physical-device VoiceOver, full reveal-animation quality and FPS remain unverified in this round. The durations above measure QA flows.
- [Operations observations](operations.md) span multiple releases. The [SLO review](slo-review-20261027.md) records retained thresholds and open configuration/version, business success and actual-cost measurements.
- No merge, production deployment or production migration was performed by this workflow. Independent final integration review and the release PR are separate delivery steps.
