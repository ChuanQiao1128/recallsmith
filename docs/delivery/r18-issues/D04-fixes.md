# D04 — Automation infra + runbook round 3: fixes per finding

Issue #473, wave r18d-p. Branch `delivery/r18dp/D04-473`, cut from `delivery/r18d-p` (D03 #472 merged, which
added the watcher's `SourceWatchRuns` metric). Only `infra/`, `docs/runbooks/` and this ledger changed; src_C,
evals, tools, services and the console belong to other waves and are untouched. No existing test or assertion
changed.

Gates run on this branch:

- `bash /Users/qc/.rimv-delivery/r18d-p/briefs/D04.verify.sh` → `D04 VERIFY OK`: `terraform fmt -check
  -recursive infra`, `terraform validate` (infra/envs/prod), and the read-only real-backend plan
  (`Plan: 1 to add, 0 to change, 0 to destroy.`) checked by `infra/scripts/check-plan.py` against
  `docs/delivery/r18-issues/D04.plan-allow.json` (`PLAN OK 1`, `SUMMARY imports=0 no-op=268 create=1`).
- The allow file is the infra test: on the base tree the listed create is not in the plan, so check-plan
  reports a stale entry and the verify fails; with the fix it passes. No `terraform apply`, no AWS write, no
  model call.

## Contract (R18D M-items touched)

- **M6 Source-watch heartbeat, infra side.** `aws_cloudwatch_metric_alarm.source_watch_missing`
  (`infra/modules/observability/alarms_r18a.tf:102-126`): `developercards-${env}-source-watch-missing`,
  namespace `var.metrics_namespace` (prod `DeveloperCards`, the watcher's `METRICS_NAMESPACE`), metric
  `SourceWatchRuns`, dimensions `{ Service = "source-watcher" }`, exactly as
  `services/source-watcher/src/source_watcher/emf.py` (`SERVICE`, `RUNS`, `run()`) emits them. `Sum < 1` per
  3600 s for 3 of 3 periods (3 hours; the schedule is `rate(1 hour)`), `treat_missing_data = "breaching"`,
  alarm and OK actions on the alerts topic, `actions_enabled = false` with `ignore_changes = [actions_enabled]`,
  the same lifecycle as `automation_tick_missing`. The supervisor enables its actions with the schedules
  (`infra/RUNBOOK.md` §7, "After enabling the tick and the source watch").
- **M1, M2, M3, M4, M5: runbook side only.** `docs/runbooks/automation-operations.md` documents the operator
  procedure for each against the contract names (M1 `authorConfigId` / `AUTHOR_NOT_GATED`; M2 `live.*` and
  `live_override_high`; M3 `shadow.blindDecided` / `blindAccepted` / `agreementRate`; M4 failing-report
  recording, `EVAL_GATE_FAILED` / `EVAL_GATE_INVALID` / `EVAL_GATE_STALE` / `EVAL_GATE_REVOKED`; M5
  `runner_unavailable`). The code is the other waves'.

## Findings

### cloud-security-resilience-14

Status: fixed (infra side of M6; the watcher emits `SourceWatchRuns` since D03)

What changed:

- `infra/modules/observability/alarms_r18a.tf:102-126`: new alarm `source_watch_missing` (see Contract M6).
  A schedule left DISABLED after emergency-stop step 1, a broken scheduler role or alias invoke, or a
  throttled function now raises an alarm after three silent hours; the watcher emits the heartbeat before any
  other work, including when there is nothing to watch (D03, `handler.py:354`).
- `infra/RUNBOOK.md` §7: the enable/disable-alarm-actions recipe covers both heartbeat alarms (`:180-187`),
  a `source-watch-missing` alarm line with first checks (`:212-218`), emergency-stop step 1 and the undo
  paragraph name it. The `source-watcher-errors` line also gains the `observe_start` hint D03 handed to this
  wave (cloud-security-resilience-8 part 6; `:207-211`).
- `docs/runbooks/automation-operations.md` rollout step 1 enables and checks both heartbeat alarms.
- `infra/README.md` §6: dated line `2026-09-28 D04`.
- `docs/delivery/r18-issues/D04.plan-allow.json`: exactly the one create.

Tests: `D04.verify.sh` step 3 (fmt, validate, real read-only plan against the allow file, `PLAN OK 1`).

### automation-23

Status: fixed

What changed (`docs/runbooks/automation-operations.md`):

- **(1) New-facts stratum vs. the QA order.** Rollout step 3 (`:58-60`) runs the new-facts window while
  `AI_QA_ENABLED="0"` is still in force, pointing to evals/README.md "New-facts stratum (owner, production in
  dry_run)". Step 5 (`:92-126`) lists the three gate inputs; 5.1 is the stratum, with the QA-off-around-the-
  window procedure for any later re-run (both env files, both deploys, back on afterwards) and the warning
  that real dry-run drafts route `QA_UNAVAILABLE` meanwhile. The promotion checklist's dry-run length
  excludes those days (`:168-169`) and states the stratum threshold (`:158-159`).
- **M4 gate recording flow** (step 5.3, `:110-122`): record failing reports too (confirm, "Recorded as gate
  #N (failed): live mode now runs as a dry run"), and what `EVAL_GATE_FAILED`, `EVAL_GATE_INVALID`,
  `EVAL_GATE_STALE` and `EVAL_GATE_REVOKED` mean and what to do.
- **(2) Rollback line (C02 automation-12 deferral).** Rollback step 6 (`:269-274`): live auto-accepted,
  unpublished cards ship with the next human publish (A00 §20.1); list them from the Decisions tab or the
  `publish_blocked` email's "auto-accepted before rollback:" uids and delete any you do not trust. Step 4 no
  longer says only "no data change" (`:266-267`).
- **(3) Author change needs a new gate** (M1): rollout step 10 (`:143-150`) and the promotion checklist item
  "Author = the gated author" (`:160-163`), naming `AUTHOR_NOT_GATED`.
- **M3 blind shadow criterion** (`:170-178`): the go-live criterion uses `shadow.blindDecided` ≥ 100 and
  `shadow.agreementRate` = blindAccepted / blindDecided ≥ 0.95, the server's rate (StatusRoutes.cs:182), and
  the console's wording.
- **M2 live override-rate watch**: rollout step 7 (`:132-137`), step 8's clean-week check, the Overview
  description and the `live_override_high` exception line (`:217-220`); M5 `runner_unavailable` line
  (`:221-224`).
- `infra/RUNBOOK.md` §7 links to `docs/runbooks/automation-operations.md` are unchanged and still resolve.

Tests: documentation only; checked by reading the runbook against evals/README.md:564-626,
`src_C/Vpc/Automation/EvalGate.cs:136-160`, `StatusRoutes.cs:160-185` and `AutoPublisher.cs:333`, and by the
D04 verify guards (scope, banned terms, suppressions).
