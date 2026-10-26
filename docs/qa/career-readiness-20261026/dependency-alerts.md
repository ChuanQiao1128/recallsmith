# Dependency maintenance and remaining alerts

The candidate fixes the three dependency-audit failures exposed by [CI run 40316969455](https://github.com/ChuanQiao1128/recallsmith/actions/runs/40316969455): a new mobile undici advisory, MCP dependencies and pypdf in two Python locks. Updates preserve the audit gates, existing allowlist/expiry and all 37 locked mobile direct dependency versions. Default-runtime local audit gates pass; some accepted and optional risks remain.

## Snapshot and interpretation

[GitHub source records](dependency-alerts-source.json), observed `2026-10-26T11:47:09.362806+00:00`, contain **147 open alert records** on default-branch main `298b15421441787536ea729ee23f06aff2391eba`: 7 critical, 62 high, 61 medium and 17 low. This is an alert-record count across dependency graphs, including development and optional dependencies. It is not a count of deployed vulnerable services or proven exploits. No alert was dismissed by this workflow. Branch audit results and the default-branch alert snapshot describe different inputs.

| Manifest | Open records | Critical records |
|---|---:|---:|
| `evals/uv.lock` | 48 | 6 |
| `frontend/package-lock.json` | 42 | 0 |
| `mobile/package-lock.json` | 29 | 1 |
| `tools/author-runner/package-lock.json` | 9 | 0 |
| `tools/ingest/uv.lock` | 3 | 0 |
| `tools/mcp-server/package-lock.json` | 16 | 0 |

The snapshot's GitHub `runtime` label does not distinguish the evals embeddings extra from its default installation. Complete deployed reachability/exploitability for all 147 records remains UNKNOWN.

## Seven critical records

| Component and locked version | Recorded scope | Current evidence and next step |
|---|---|---|
| Pillow 12.3.0, five advisories | `evals/uv.lock`, optional `embeddings` path through fastembed | Outside the default evals export and absent from the five Python service locks. Advisory records list 13.0.0 as the first patched version. Validate and update the optional environment if it is used; default pip-audit success does not cover it. |
| certifi 2026.7.22, one advisory | Same optional embeddings path | Advisory range is `>=2019.03.09,<2026.10.19`. The optional environment needs its own update and validation. No provider/TLS exploitation or production installation was demonstrated. |
| Nested fast-xml-parser 4.4.1, one advisory | `mobile/package-lock.json` under `@aws-sdk/core` | Existing allowlist expires **2027-02-01**. The fixed top-level copy is 4.5.7. The policy defers the nested fix because updating Amplify changes bundled sign-in code and needs device sign-in testing. Both candidate iOS/Android source-map gates verify all nine allowlisted packages remain outside the exported app bundles. Build/tooling risk and the expiry still need ownership. |

The [mobile policy](../../../mobile/npm-audit-allowlist.json) records the exception rationale and expiry. Its bundle-exclusion assertion is checked by `infra/scripts/check-bundle-packages.py`; absence from a bundle does not make a tool dependency harmless. Existing policy was neither expanded nor extended here.

## Targeted candidate repairs

- Mobile: undici **6.29.0 → 6.29.1**, with no other mobile package entry or native/direct dependency version changed. The original audit gate now passes. It still reports **1 critical and 7 high accepted** records, plus moderate/low records; this is not a zero-vulnerability statement.
- MCP server: body-parser **2.3.0 → 2.4.0**, its required qs **6.16.0 → 6.16.1**, and zod **4.6.5 → 4.6.7**. The high/critical production audit gate passes; two moderate records remain. Build and 93 tests pass.
- Ingest and evals: pypdf **6.21.1 → 6.21.2** in both locks, resolving the three reported default-runtime CVEs. Both frozen/default pip audits and lock checks pass; ingest 39 and evals 345 tests pass. Optional embeddings were not installed or exercised.

The [verification record](verification.md) binds the actual commands and source versions. The subsequent GitHub run against the pushed commit is reported in the PR checks. No force upgrade, new audit exemption, native SDK migration, production change or model/API call was used.

## Follow-up priority

Keep the dependency gates healthy, validate updates to the optional embeddings environment, and retire or renew the documented mobile exception before expiry with the required sign-in evidence. Triage the remaining development/tooling records by actual use. The scoped repairs above do not establish complete supply-chain assurance or close all GitHub records.
