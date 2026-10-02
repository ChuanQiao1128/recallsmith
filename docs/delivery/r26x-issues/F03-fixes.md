# F03 — r26x review fixes: infra retire (issue #722)

Base: `delivery/r26x-p`. Test file for every finding: `infra/scripts/tests/test_r26_snowflake_retired.py`
(`python3 -m unittest discover -s infra/scripts/tests -v`, CI `python` job). The tests were committed first; on the
base they gave 3 failures and 2 errors (the RUNBOOK and verify-script tests below).

### p-security-1
Status: partially fixed
- Checked: one part of the problem statement is out of date. On this branch S01 is already merged (commit `66644472`,
  via the r26-s merge in the base): `src_C/Vpc/Analytics/` has no `OutboxPublisher.cs` or
  `ContentIntelligenceSnapshotImport.cs`, and `AnalyticsOutboxRetiredTests.cs` checks that the two routes are gone.
  The deploy-order risk is still real, though. The P03 IAM change is safe only once the core-vpc R26 build is the prod
  alias target, and the plan looks the same whatever build is live.
- Fix (following the supervisor's x-deploy-1 decision): `infra/RUNBOOK.md` gains §9 "R26" and the subsection
  "Rollback of core-vpc (R26)". Both state (a) the core-vpc R26 build goes first and the P03 apply second, because
  the old build writes `analytics/raw/`; (b) once 045 has run, roll forward only, because a pre-R26 version inserts
  into the dropped `analytics_event_outbox`; and (c) migrate stops before a destructive migration unless
  `confirmDestructive=<version>` is passed. §9 step 1 gives a read-only pre-apply check: read the prod alias version,
  take the commit from that version's `deploy.sh` description, and run `git merge-base --is-ancestor 66644472`.
  §3 Apply points at §9. The H00 rollback section points at the new subsection. The README change-log line names
  the gate.
- Partial because: the check is a documented supervisor step, not a machine gate. `P03.verify.sh` and
  `check-plan.py` run offline against the code and a plan, so they cannot see the live alias. Making them call AWS
  would break the offline verify contract.
- Note on (c): `confirmDestructive` is added by the parallel fix issue F01 (wave r26x-s, supervisor item x-deploy-2).
  It is not yet in `src_C/Vpc/Db/Migrate.cs` on this branch, so the RUNBOOK text is accurate only once F01 is merged
  into the release.
- Tests: `DeployOrderDocumentedTest` (`test_r26_section`, `test_core_vpc_rollback_section`,
  `test_plan_step_points_at_the_gate`). On the base the first two errored and the third failed.

### p-tests-1
Status: fixed
- Confirmed: `AllowListTest.EXPECTED` was a copy of the JSON, and `allow.get("outputs", []) == []` passed whenever
  the key was missing. Nothing ran `infra/scripts/check-plan.py` with `P03.plan-allow.json`.
- Fix: new `AllowListAgainstPlanTest`. It builds a minimal plan JSON with the 4 deletes, the 2 updates (with their
  changed keys), a no-op entry and a no-op output, and runs the real `check-plan.py --plan - --allow
  P03.plan-allow.json`. The expected plan must exit 0 with `PLAN OK 6`. Each of these must exit 1 with the matching
  violation: an extra `name` key on core_vpc, an extra `dashboard_name` key on the dashboard, an extra delete, a
  tags-only update (so `tags_only_updates` must stay false), a missing delete (stale entry), a replace instead of
  the core_vpc update, and an output change. The `outputs` check now asserts that the allow file has no `outputs`
  key at all.
- On the base, the allow file was already correct, so the new plan-gate tests pass there too. They close the
  coverage gap; they did not find a wrong entry. One limit remains: the attachment address quoting
  (`snowflake["read"]`) follows Terraform's JSON address format, but only a real plan can prove it.
- Files: `infra/scripts/tests/test_r26_snowflake_retired.py`.

### p-tests-2
Status: fixed
- Confirmed: `docs/delivery/r26-issues/P03.verify.sh` was not in the repo. It existed only at
  `~/.rimv-delivery/r26-p/briefs/P03.verify.sh`.
- Fix: committed that script unchanged as `docs/delivery/r26-issues/P03.verify.sh` (in scope: `P03\..*`).
  `P03-notes.md` now gives its repo path and says it sources the delivery skill's `verify-lib.sh` and needs `BASE`
  exported. That means it runs on the supervisor host, not in CI; its targeted checks are the commands listed next
  to it. The notes' owner steps now point at RUNBOOK §9, and the notes no longer overclaim the allow-list test.
- Tests: `NotesNameOnlyRepoFilesTest` (`test_verify_script_is_committed`, and `test_named_paths_exist`, which
  checks that every `infra/…`, `docs/…` and `P03.*` path the notes name exists). Both failed on the base.

## Files changed

- `infra/scripts/tests/test_r26_snowflake_retired.py`
- `infra/RUNBOOK.md`
- `infra/README.md`
- `docs/delivery/r26-issues/P03-notes.md`
- `docs/delivery/r26-issues/P03.verify.sh` (new)
- `docs/delivery/r26x-issues/F03-fixes.md` (this ledger)
