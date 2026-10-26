# Integrated verification, 27 October 2026

Integration checks are in progress. This file will be reconciled with the final frozen sources before the release PR is presented.

| Check | Actual result | Tested source |
|---|---|---|
| Backend full suite, .NET SDK 10.0.401 | 3,083 passed, 0 failed/skipped | `809e8c1ce60369587edcc8243585dc88aa877d07` |
| Frontend full suite / build / lint | Pending integrated run | Pending |
| Mobile full suite / typecheck | Pending integrated run | Pending |
| Built-console browser tests | Pending integrated run | Pending |
| Linked publish/importer journey | Pending integrated run | Pending |
| Native guest journey | Frozen independent review pending | Pending |

The backend command exited 0. The original command, configuration hashes and raw log are retained under the local workflow evidence directory. Later document or mobile QA additions do not automatically inherit a source PASS; final verification must explicitly check whether the relevant source/configuration changed.

## Evidence boundaries

- Browser API and identity-provider routes are stubs. The linked publish journey uses real isolated PostgreSQL and production business logic with the adapters described in [publish-journey.md](publish-journey.md).
- Native evidence uses an isolated iOS Simulator QA artifact. Production authentication, paid entitlements, physical-device VoiceOver and FPS remain unverified in this round.
- [Operations observations](operations.md) span multiple releases. The [SLO review](slo-review-20261027.md) records retained thresholds and open configuration/version, business success and cost measurements.
- No production deployment, migration or merge is part of this verification.
