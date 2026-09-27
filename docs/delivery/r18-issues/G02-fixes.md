# G02 fixes: ai-qa + runbook round 6

Issue #505, wave r18g-p. Scope: `services/ai-qa/tests`, `docs/runbooks/automation-operations.md`,
`infra/RUNBOOK.md` and this ledger. No runtime code changed.

## Findings

### backend-design-27

Status: fixed (ai-qa side; the src_C side is G01's)

- `services/ai-qa/tests/fixtures/automation_report.json` (new): one automation draft report in the exact
  wire form `handler._report` produces (sorted keys, compact separators), with `<placeholder>` strings
  for the per-run string values and typed sample values for the numbers. It is the artefact G01's
  `AutomationRound5Tests` reads instead of its inline `AiQaAutomationReportJson` const, so both suites
  assert one file.
- `services/ai-qa/tests/test_profiles.py:29` (`AUTOMATION_REPORT_FIXTURE`), `:81` (`json_shape`: the keys
  and JSON value types of a document, recursively, values dropped).
- Test: `TestEffortInReport::test_draft_report_matches_the_shared_automation_report_fixture`
  (`test_profiles.py:545`). It runs the production automation reviewer (`openai-mantle` /
  `openai.gpt-5.5`, `AI_EFFORT=high`) on a draft message through `lambda_handler`, takes the report core
  received, and asserts `json_shape(report) == json_shape(fixture)` (every key, nested ones included,
  and every value type), the fixture's key set against `AUTOMATION_REPORT_KEYS | {"target"}`, the
  constant values (`v`, `target`, `profile`), `effectiveEffort == "high"`, and that the file is written
  in the serialized form. A rename, removal or type change on the producer side now fails this test
  until the fixture changes, and a fixture change fails the src_C test until core follows. It failed
  on the base tree (no fixture file).

### cloud-security-resilience-2

Status: fixed

- `docs/runbooks/automation-operations.md:125-137` (rollout step 5, Check): the gated reviewer now reads
  provider / model / prompt version / effective effort (`high`, or `provider-default` for the Converse
  fallback), states that `reviewer.effectiveEffort` must equal what production ai-qa sends for
  `AI_EFFORT`, and adds the O1 check: with ai-qa deployed at or after R18F (F02), a dry-run decision
  made after the gate was recorded shows `reviewerMatchesGate: true` and `authorMatchesGate: true`.
- `:160-170` (rollout step 10): the MCP tool surface (and the P3 version bump) is an author change;
  new paragraph "Changed reviewer → new gate": a change of provider, model, prompt version or
  effective effort needs a new gate, and because `AI_EFFORT` is shared with human QA, changing it
  routes every live draft to a person with `REVIEWER_NOT_GATED` until a gate at the new effort exists.
- `:229-230` and `:239-245` (promotion checklist): "the exact reviewer triple above" became "the exact reviewer above:
  provider, model, prompt version and effective effort"; new lines "Reviewer effort = the gated
  effort" and "ai-qa deployed with O1, matches shown" (the suggested checklist line).
- Tests (`services/ai-qa/tests/test_runbook.py`; all five failed on the base runbook):
  `test_step_5_check_names_the_reviewer_effort_and_the_match_flags`,
  `test_step_10_says_an_ai_effort_change_needs_a_new_gate`,
  `test_promotion_checklist_binds_the_gate_to_the_reviewer_effort`. ai-qa owns `effectiveEffort`
  (contract O1), so its suite pins that the operator page names it.

### automation-35

Status: fixed (the runbook parts (2), (3) and the automation-32 runbook half; parts (1) and (4) were
fixed in round F)

- Part (2): `docs/runbooks/automation-operations.md:195-223`, new section "Upgrading to R18E–R18G":
  core first (`DRY_RUN=1` first), then ai-qa with O1 before any live switch (`DRY_RUN=1` first); on the
  Mac `(cd tools/mcp-server && npm ci && npm run build)`, the same for tools/author-runner, then
  `status` (else `author_config_error`); re-produce any new-facts stratum captured before the upgrade
  (R18E N4 tool surface, R18G P3 version bump) and record a new gate; then confirm
  `reviewerMatchesGate` / `authorMatchesGate` = true on a dry-run decision made after the gate, with
  what a `false` means; queue only URLs (P3). `infra/RUNBOOK.md:206-207` points to it.
- Part (3): `:331-333` (`runner_unavailable`): the hold clears when the author configuration or the
  Claude CLI changes, "or when you delete `<log dir>/runner-state.json` after fixing the cause" (as in
  tools/author-runner/README.md:228).
- automation-32 runbook half: step 5's Check and the promotion checklist (see
  cloud-security-resilience-2).
- Tests (`services/ai-qa/tests/test_runbook.py`, failed on the base runbook):
  `test_upgrade_checklist_covers_rounds_e_to_g` (includes the core-before-ai-qa order),
  `test_exception_emails_cover_p1_p2_and_the_runner_state_hold` (no "clears only when"; the
  `runner-state.json` deletion is named).

## Contract

- P1 (stalled runner): runbook side only. "Exception emails" has a second `runner_stalled` entry
  ("runner in error; R18G P1", `:275-280`): heartbeat fresh, state `error` with a non-`RUNNER_UNAVAILABLE`
  `last_error`, due items waiting, no run started for 2 h; one email per runner and UTC day naming
  `last_error`; what to do on the Mac. The email itself is core-vpc (G01).
- P2 (partial item): runbook side only. New `queue_item_failed` entry "partial item; R18G P2"
  (`:290-296`): the item finished `done`, is not put back, one email per item, re-add the URL to author
  the rest. The `runner_unavailable` entry no longer implies the item is always put back: it says a run
  that already submitted drafts finishes the item `done` (`:327-329`). The email is core-vpc (G01).
- P3 (no local sources): runbook only: step 10 and the upgrade checklist say the `MCP_SERVER_VERSION`
  bump changes `authorConfigId` (new stratum + gate), and that queue items must be URLs
  (`SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION`). The MCP server change is the tools wave's.
- P4: not touched (console).
- O1 stays as F02 shipped it; this issue only pins its report shape in a shared fixture and moves its
  operating steps into the runbook. K1-K7, L1-L6, M1-M6, N1-N6, O1-O2 are unchanged.
