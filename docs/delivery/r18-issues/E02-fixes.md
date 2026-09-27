# E02 — Automation runbook round 4: fixes ledger

Issue #486, fix round 4 (R18E), wave P. Docs only: no Terraform change, no code change. The test for each
finding is `bash /Users/qc/.rimv-delivery/r18e-p/briefs/E02.verify.sh` (scope, suppression and ledger checks)
plus the cross-check of every changed runbook line against the code on this branch, cited below.

### cloud-security-resilience-1

Status: fixed

The runbook now tells the operator of a system whose schedules are already enabled how and when to enable the
`developercards-prod-source-watch-missing` alarm actions, and that Terraform never does it.

- `docs/runbooks/automation-operations.md:153-178`: new section "Upgrading a running system (R18D, 2026-09-28)",
  a checkbox list. It covers the following, in order:
  - Deploy source-watcher with the D03 code (`DRY_RUN=1` first).
  - Confirm one `SourceWatchRuns` datapoint after the next hourly run (`aws cloudwatch get-metric-statistics
    --namespace DeveloperCards --metric-name SourceWatchRuns --dimensions Name=Service,Value=source-watcher ...`),
    or confirm the alarm reads `OK`, not `INSUFFICIENT_DATA` or `ALARM`.
  - Run `aws cloudwatch enable-alarm-actions --alarm-names developercards-prod-source-watch-missing`.
  - Check `ActionsEnabled` of this alarm and of the tick alarm.

  The section says why the order matters: the pre-round-D watcher emits no heartbeat, and with
  `treat_missing_data = breaching` over 3 × 1 h the alarm would page. It also says Terraform ignores
  `actions_enabled`.
- `docs/runbooks/automation-operations.md:40-46`: rollout step 1 enables each heartbeat alarm's actions only once
  that alarm is `OK` after its first heartbeat. It says that no apply turns them on, and it points a running
  system to the new section.
- `infra/RUNBOOK.md:180-182`: the §7 enabling line adds "once each heartbeat alarm reads `OK`" and "so no apply ever
  enables them".
- `infra/RUNBOOK.md:190-205`: the same dated upgrade step with checkboxes, placed directly after the tick/source-watch
  alarm step.
- `infra/RUNBOOK.md` `source-watch-missing` alarm line: points to the upgrade step.

The metric and alarm names, namespace, dimension and lifecycle were checked against
`infra/modules/observability/alarms_r18a.tf:107-126` and `services/source-watcher/src/source_watcher/emf.py:9,15`.

Test: `E02.verify.sh` (E02 VERIFY OK). No `.tf` file changed, so the plan is unchanged.

### automation-30

Status: fixed

Each runbook line the finding lists now matches the code on this branch.

- Batch summary (finding item 1), at `docs/runbooks/automation-operations.md:268-281`:
  - In dry_run it lists no draft. "NEEDS YOU" is one count line with a review-queue link
    (`src_C/Vpc/Automation/EmailTemplates.cs:328-334`).
  - In live it has one line per draft routed to a person and one "DONE" line per auto-accepted card
    (`EmailTemplates.cs:346-352`).
  - It shows no shadow rate.
  - Per-state counts appear only once none of the run's drafts is pending (N6, below).
- Blind rate (finding item 2), at `docs/runbooks/automation-operations.md:203`: "The weekly digest shows the same
  blind rate; the batch summary shows no rate". This matches `WeeklyDigest` (`EmailTemplates.cs`, "Dry-run agreement"
  line) and `BatchSummary`, which has no rate.
- `queue_item_failed` (finding item 3), at `docs/runbooks/automation-operations.md:220-230`: it is split into two
  entries.
  - The existing entry is "failed 3 times".
  - The new entry is "(agent blocked; subject 'agent blocked on queue item N', `lastError` starting with
    `AGENT_BLOCKED`)". It says the item failed on its first attempt, is not retried, and the fix is to read the
    reason and fix the source or re-add the item. See `EmailTemplates.cs:210-216` and `RunnerRoutes.cs:334,358-377`.
  - `runner_run_failed` now names the one-hour-per-attempt backoff (`RunnerRoutes.cs:23,30,364`) and the
    agent-block exception.
- N3 backoff, at `docs/runbooks/automation-operations.md:250-262`:
  - `runner_unavailable` describes the per-item backoff and the terminal `RUNNER_UNAVAILABLE_REPEATED` at the third
    consecutive failure.
  - It describes the runner's local hold for non-transient causes and when that hold clears.
- N5/N6 blinding:
  - The Decisions, Runs and Overview entries (`docs/runbooks/automation-operations.md:289-304`) describe dry_run
    blinding of pending drafts, the per-run state split, and the cross-tab `verdictShown: true` after a reveal.
  - The digest entry states the N6 rule.
- M2 override rule: re-checked against `src_C/Vpc/Automation/StatusRoutes.cs:69,72,318`, which fires when the
  override rate is above 0.05 with at least 20 auto-accepts. Rollout step 7 and the `live_override_high` line
  already match this, so they are unchanged. The digest entry now names it as R18D M2.

Test: `E02.verify.sh` (E02 VERIFY OK). The lines were matched by hand against the cited code.

## Contract

This issue is docs only. It documents the N-items other waves implement, using the contract's names and shapes:

- **N3**:
  - The item is due again after min(15 min × 2^(n−1), 24 h). At n ≥ 3 it stops with `RUNNER_UNAVAILABLE_REPEATED`
    and one deduped exception email.
  - For a wrong provider, a failing MCP server or a missing claude, the runner writes the usage-limit hold
    (`runner-state.json`), which clears only when the author configuration or the CLI changes.
  - The runbook does not name a new email subkind: the contract allows either the existing `runner_unavailable`
    or a new one.
- **N5**:
  - In dry_run, pending drafts hide their state, reason, QA counts and decide links on the Decisions list, the run
    sections and the Overview drill-downs.
  - Per-run splits show only once no draft of the run is pending.
  - A reveal is recorded per browser, so a later decision is sent with `verdictShown: true`.
- **N6**: in dry_run, the batch summary and the digest show a run's per-state counts only once none of its drafts is
  pending a human decision. Until then they show only the total.
- N1, N2 and N4 are not touched by this issue.
