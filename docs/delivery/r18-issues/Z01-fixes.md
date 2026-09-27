# Z01 — Server round 3: per-finding fixes ledger

Release 1.8.0 fix wave, round 3 (r18z-s), issue #385. Scope: `src_C/**` and `docs/delivery/r18-issues/**`.
Line numbers are for the tip of `delivery/r18zs/Z01-385`. No migration was added (none was needed), and no
existing route, table or env key was renamed. Every contract change is listed in
`docs/delivery/r18-issues/R18-contract-changes.md`, which also folds in the X and Y waves' change tables.

Gates run: `cd src_C && dotnet test RecallSmith.Lambda.sln` (the whole integration suite against a
Testcontainers Postgres) and `bash src_C/scripts/merge-env.test.sh`. Each test named below fails on the base
tree and passes after the fix, unless the text says otherwise.

---

### backend-design-19

Status: fixed

- A `done` item is now final for the run. The keep predicate is `var keep = previous == "done";`
  (`src_C/Vpc/Internal/AiQaResults.cs:167`). A later report never changes the item's status and never touches
  its findings. That covers a retried chunk's second model sample (a new request id) and an exact replay.
  The replace path (delete, then insert) is gone. Findings are inserted only when an item first becomes
  `done` (`:209`), so a blocker the first sample caught cannot be erased, ids are never renumbered (so resolve
  by id keeps working), and the `card.flagged` webhook that was already sent still points at findings that
  exist.
- This is a little stronger than the audit's suggested predicate
  (`… || IsNewAttempt(state, item)`). That predicate still sends an exact replay down the replace path.
  After a kept second attempt, `request_id` holds the second attempt's id, so the Lambda's POST retry of that
  second report would have replaced the first sample's findings with the second's. The new test covers this
  sequence. Keeping an exact replay loses nothing, because it carries the same findings.
- Billing is unchanged. The kept path still adds a new attempt's usage and stores its request id, and an
  exact replay adds nothing. A new attempt on a done item logs `done_findings_kept` (info) with the number of
  findings it reported (`:173`).
- The run's per-item "resolved findings" count is no longer needed, so its subquery was removed from the item
  read.
- Design choice: the first sample wins. We do not union the samples, because two samples phrase the same
  defect differently and a union would show duplicates, and a blocker added later would never send a webhook.
  If a second sample finds a blocker the first one missed, it is lost, exactly as if only one attempt had run.
- Test: `AiQaResultsTests.Results_ReReport_NewSample_KeepsFirstFindings` replaces
  `Results_ReReport_ReplacesFindings`, whose assertion pinned the defect. The new test sends a done report with
  a blocker, then a second done report with a different request id and only a minor, then the POST retry of
  that second report. It asserts that the first blocker survives with the same ids and content, that
  `blocker_count` is 1, that both costs are billed (0.03), and that the original finding id still resolves.
  The neighbouring tests (`Results_DoneItem_IsNeverDowngraded`, `Results_ReReport_KeepsResolvedFindings`,
  `Results_RetriedChunk_*`, `Results_KeptItem_ExactReplay_IsBilledOnce`,
  `Results_BlockerFinding_EnqueuesCardFlaggedOnce`) pass unchanged.

### backend-design-20

Status: fixed

- Hash-echo mismatches get their own `mismatched` counter (`src_C/Vpc/Internal/AiQaResults.cs:156`), apart
  from unknown card ids (`ignored`). `AiQaHashMismatch` (`:51`) is emitted once per report, zero included, so
  the metric has data points to alarm on (`:333`). `mismatched` is added to the outcome log line, the ledger
  details and a summary warn line `reason = "hash_echo_mismatch"`. The `unknown_card` summary now counts
  unknown cards only.
- `AI_QA_STALE` refusals emit gauge `AiQaStale` (`src_C/Shared/RecallSmith.Lambda.Db/PublishSnapshot.cs:28`):
  on the 409 in core-vpc (`src_C/Vpc/Authoring/Publish.cs:325`) and when the Worker fails the job
  (`src_C/Worker/Services/PublishJobProcessor.cs:78`). We chose a separate gauge over `QaGateRefusals` because
  a stale build is a race, not a gate verdict.
- Tests: `AiQaResultsTests.Results_HashMismatch_IsNotApplied`, extended through `EmfCapture`. A forged report
  emits `AiQaHashMismatch` = 1 and a clean one emits 0. A mixed report (one mismatch, one unknown card, one real
  card) records `mismatched = 1` and `ignored = 1` in the ledger. New
  `AiQaPublishSnapshotTests.GatedPublish_StaleBuild_EmitsAiQaStaleGauge` covers the Worker path. The 409 path
  needs a card edit between two reads inside one request, which a test cannot force, so it is covered by code
  reading only.

### backend-design-21

Status: fixed

- The admin delivery list returns `enqueuedAt`, an additive field
  (`src_C/Vpc/Integrations/WebhookDeliveries.cs:85`, `:111`). With it the console can tell a stranded `queued`
  row (null) from one in flight. The `HandleSweep` doc now names the `enqueued_at is null` condition
  (`:176-178`).
- Tests: new `WebhookAdminRoutesTests.ListDeliveries_ReturnsEnqueuedAt` checks a null value on a stranded row
  and a timestamp on an enqueued one. `ListDeliveries_FiltersAndPaginates` pins the item's key list, so its
  expected list gains `enqueuedAt`. The finding makes the old shape incomplete.
- Console side (showing the field, gating Redeliver on it) is the console wave's change.

### backend-design-22

Status: fixed

- New `docs/delivery/r18-issues/R18-contract-changes.md` is the in-repo contract changelog. It covers every
  contract change from X01-X08, Y01-Y08 and Z01: routes, error codes (`AI_QA_STALE`,
  `AGENT_CLIENT_FORBIDDEN`, `ALL_ITEMS_FAILED`, the extended `AI_QA_REQUIRED`), §7.7 semantics (ledger dedupe
  key, usage, hash echo, prompt version, done-item findings), §7.10, §6 (status table, `enqueued_at`, sweep
  predicate, deterministic eventId, `schemaVersion`), §9 ledger, drafts grounding, migrations 032-033, env keys
  and SSM leaves, and metrics. Each change carries a file:line and the ledger that has the reasoning. Every
  fully qualified path it cites exists (checked with the `docsPaths.test.ts` citation pattern).
- `R18-00-contracts.md` itself is in the control directory, outside this issue's paths, so it is not edited.
  The new file says it wins over that file where the two disagree.
- Handoff (console, outside `src_C`): add `AI_QA_STALE` to the gate-code list in `frontend/src/lib/qaGate.ts:9`.
- Test: none. This is documentation. The paths were verified mechanically.

### backend-design-23

Status: fixed

- New `[Theory]` `WebhookDeliveryReportTests.Report_TransitionTable_MatchesReference`, with `[MemberData]`
  `TransitionCases`. It enumerates all 144 combinations: 6 row statuses (`queued`, `enqueue_failed`,
  `retrying`, `delivered`, `failed`, `dead`) × 4 outcomes × reported attempt `<`, `=`, `>` the stored one ×
  live or inactive subscription. Each case seeds the row directly (status, attempts 2, code 418, error, and
  `delivered_at` for delivered rows), calls `HandleReport`, and compares the response status, the `stop` flag
  and the persisted `status`, `attempts`, `last_status_code`, `last_error` and `delivered_at` (set, and whether
  it changed) against `Reference`. `Reference` is a small pure C# function that states the transition table
  independently of the SQL.
- The `enqueue_failed` row is exercised, including the case where SQS accepted a send whose wait timed out.
  As the verifier said, no case disagreed with the code, so no production change was needed. This finding was
  a coverage gap.

### automation-18

Status: fixed

- The headline no longer depends on `granularity`. The totals query groups by (automation, source) over
  `[from, to)` with no period column, and clamps `max(0, Σ net)` once per group
  (`src_C/Vpc/Ledger/LedgerRoutes.cs:108`). This restores the X01 range-level rule: review time spent on a
  rejected draft offsets savings anywhere in the range, and is not floored away per week or day.
- The series now returns unclamped net minutes per (period, automation) (`:153`). A period whose review cost
  exceeds its savings shows a negative bar. Each point carries `minutesSaved` (same value, kept for existing
  readers) and the additive `netMinutes` (`:225`). Per automation and source, the series adds up to the
  unclamped net. It equals the headline whenever that net is not negative.
- Tests: `AutomationLedgerTests.Ledger_Headline_IsIndependentOfGranularity_SeriesIsNet` replaces
  `Ledger_SeriesAddsUpToTotals_AcrossPeriods`, whose assertions pinned the headline differing between week
  (12 min) and month (0). For live draft rows and live plus backfill import rows, the new test asserts:
  - the headline is identical for day, week and month;
  - the draft automation is clamped to 0 once;
  - Σ series(net) = Σ (units × baseline − actual) per automation;
  - the weekly bars are `[baseline, −(baseline + 8)]`.

  `Ledger_WeeklySeries_StartsMonday` pins the series key list, so its expected list gains `netMinutes`.
- Handoff (console): `frontend/src/lib/ledgerView.ts:164` should say "clamped once per automation and source
  over the selected range; bars show net minutes per period and may be negative", and the chart should allow
  negative bars.

### automation-19

Status: fixed

- `RedeliverAsync` inserts the copy and settles the source in one transaction
  (`src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs:426-437`). The source is set to `status = 'failed'`,
  `last_error = 'superseded by redelivery <newId>'`, but only when it never reached the dispatcher
  (`SupersedablePredicate`, `:479`). That means attempts = 0, no `enqueued_at`, and either `enqueue_failed` or
  a `queued` row untouched for the sweep interval. A fresher `queued` row may still be mid-send and keeps its
  state. A row the dispatcher has seen keeps its history. The sweep therefore no longer finds the source, and
  the event reaches the receiver once, under the new id. The log line carries `sourceSuperseded`.
- Test: new `WebhookSweepTests.Redeliver_StrandedRow_ThenSweep_SendsTheEventOnce`. It redelivers an
  `enqueue_failed` row and a stranded `queued` row, then sweeps. It asserts that each source is `failed` with
  the superseded error, that exactly one live row exists per event and subscription, and that each event went
  out exactly once, under its new delivery id. Controls: a `failed` row with attempts and a fresh `queued` row
  are left alone. The neighbouring sweep, redeliver and admin tests pass unchanged.

### cloud-security-resilience-11

Status: partially fixed (the core half is done; the IAM grants for the Python roles are in `infra/`, outside
this issue's paths)

- `VerifyInternalSignature` also accepts `<secret in effect>_PREVIOUS` when it is non-empty
  (`src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:498`, `:531-542`). That is `INTERNAL_SHARED_SECRET_PREVIOUS`
  on both HMAC routes and every shared-secret route. On a route with its own secret it is that secret's
  `_PREVIOUS`, never the shared one. When a previous secret is set, both fixed-time comparisons always run.
- `merge-env.sh` maps `internal-shared-secret-previous` → `INTERNAL_SHARED_SECRET_PREVIOUS` (plus the route
  secrets' `-previous` leaves; `src_C/scripts/merge-env.sh:12`). deploy.sh therefore injects it only while
  the leaf exists. Because `merge_env` keeps every live key, deploy.sh also removes an optional key whose leaf
  is gone (`SSM_OPTIONAL_ENV` `:17`, `drop_absent_optional` `:66`, `src_C/deploy.sh:65`). Without that, an
  ended rotation would keep accepting the old secret forever.
- Tests: `InternalCallerSecretTests.SharedSecretRotation_BothHmacRoutesAcceptCurrentAndPrevious`,
  `InternalCallerSecretTests.RouteSecret_PreviousIsItsOwn_NotTheSharedOne`, and merge-env.test.sh cases (k)
  and (m).
- Handoff (infra): grant `ssm:GetParameter` on `/developercards/prod/internal-shared-secret-previous` to the
  ai-qa and webhook-dispatcher roles (with a plan-allow entry). Until that lands, the Python fallback read is
  AccessDenied. Rotation still works with the steps below, because core accepts both values.

Rotation runbook (internal shared secret, no flag day):

1. `put-parameter` the current value as `/developercards/prod/internal-shared-secret-previous`.
2. Deploy core-vpc (`src_C/deploy.sh`, injecting). Core now accepts the current value and `_PREVIOUS`.
3. `put-parameter --overwrite` a new random value on `/developercards/prod/internal-shared-secret`.
4. Deploy core-vpc again. It now accepts the new value, and the old one as `_PREVIOUS`.
5. The Python Lambdas pick up the new value within their 300 s secret TTL. Each warm container keeps signing
   with the old value until then, and core accepts it. Wait at least that long, or redeploy both Lambdas.
6. Delete `/developercards/prod/internal-shared-secret-previous`, then deploy core-vpc. deploy.sh removes
   `INTERNAL_SHARED_SECRET_PREVIOUS`, and the old value stops working.

### cloud-security-resilience-2

Status: partially fixed (core-vpc and the deploy overlay are ready; the SSM leaves, the IAM scoping and the
Python env files are in `infra/` and `services/`, outside this issue's paths)

- `merge-env.sh` maps `ai-qa-results-secret` → `INTERNAL_SECRET_AI_QA_RESULTS` and `webhook-report-secret` →
  `INTERNAL_SECRET_WEBHOOK_REPORT` (`src_C/scripts/merge-env.sh:12`), each with its `-previous` leaf. A
  per-route secret whose leaf is deleted leaves core's environment on the next deploy, so a rollback works.
- The route secret's `_PREVIOUS` companion (see cloud-security-resilience-11) makes the cut-over free of a
  flag day.
- Tests: `InternalCallerSecretTests.RouteSecret_PreviousIsItsOwn_NotTheSharedOne` and merge-env.test.sh (k).
- Handoff (infra): add `webhook-report-secret` and `ai-qa-results-secret` to `secret_parameter_names`, and
  scope each role's `SsmRead` to its own leaf (plus its `-previous`), dropping `internal-shared-secret`.
  Handoff (services): point each `env/prod.env.json` `INTERNAL_SECRET_SSM_NAME` at its own leaf.

Cut-over runbook (per-route secrets):

1. Create `/developercards/prod/ai-qa-results-secret` with a new random value, and
   `/developercards/prod/ai-qa-results-secret-previous` with the current shared secret's value. Do the same
   for `webhook-report-secret` and its `-previous`.
2. Deploy core-vpc. Each route now accepts only its own new secret, or the shared value through its
   `_PREVIOUS`. The other route's secret is refused.
3. Apply the infra change (per-leaf IAM), then deploy each Python Lambda with its env pointing at its own leaf.
4. Delete both `-previous` leaves and deploy core-vpc. The shared secret no longer signs on those two routes.

### cloud-security-resilience-15

Status: fixed

- `ssm_to_env` applies the map first. It then skips an unmapped leaf that is in the explicit list or that
  matches `SSM_NOT_ENV_PATTERN` = `^(.+-previous|webhook-signing-secret-sub-[0-9]+(-previous)?)$`
  (`src_C/scripts/merge-env.sh:27`). Any other unmapped leaf is still a hard error. The runbooks' leaves no
  longer need a row first: `webhook-signing-secret-sub-<id>`, its `-previous`, and any Python-only
  `-previous`. `internal-shared-secret-previous` is mapped, not skipped (cloud-security-resilience-11).
- The original six-row `SSM_TO_ENV` literal is kept verbatim, and the new rows are spliced on as
  `SSM_TO_ENV_INTERNAL` (plain bash, no jq at source time), because older verify scripts grep for the literal.
- Tests (`src_C/scripts/merge-env.test.sh`):
  - (k) every leaf a README tells the owner to create maps or is skipped as intended;
  - (l) near misses (`webhook-signing-secret-sub-abc`, `…-sub-12-extra`, `previous`, `stray-previous-name`,
    `x-webhook-signing-secret-sub-1`) are still hard errors;
  - (m) covers `drop_absent_optional`.

  Case (k) fails on the base tree with `unmapped SSM parameter: internal-shared-secret-previous`.

---

### Cross-wave contract: draft grounding (ai-agent-24)

Status: fixed (core side)

- `DraftCard.Parse` accepts `card.source.grounding = {chunkId, sourceId, matched: true, quoteChars}`
  (`src_C/Vpc/Review/DraftCard.cs:113`, validator `NormalizeGrounding` `:204`). The ids must be non-blank
  strings (≤ 200), `matched` must be the literal true, and `quoteChars` must be an integer in 0..100000.
  Other keys, such as the MCP server's `kind`, `url` and chunk offsets, are dropped rather than rejected, so
  review metadata can never fail a draft.
- `ToJson()` writes it back into `source` for `ai_drafts.card`, and `GET /drafts/:id` returns it. `SourceJson`
  never holds it, so accept writes a published card's source without it, and deck builds (which read `cards`)
  never see it. Accept compares and records the card without grounding (`src_C/Vpc/Review/Drafts.cs:513-515`),
  so a console that does not echo the field does not turn an accept into `edited_accepted`.
- Tests: `DraftsTests.Grounding_IsKeptOnTheDraft_ReturnedOnGet_AndStrippedOnAccept` and
  `DraftsTests.Grounding_BadShape_RejectsTheCard` (6 cases).
