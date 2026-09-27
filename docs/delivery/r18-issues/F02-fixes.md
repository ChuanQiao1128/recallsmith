# F02 fixes: ai-qa round 5, effectiveEffort in automation-profile reports (O1)

Issue #497, wave r18f-p. Scope: `services/ai-qa` and this ledger. The three findings are one gap:
the ai-qa half of contract N2 was missing. They share one fix.

## Findings

### cloud-security-resilience-1

Status: fixed

- `services/ai-qa/src/ai_qa/handler.py:459`: `_process` computes
  `report_effort = effective_effort(cfg_used)` (None only when there are no valid reviewer settings) and
  `finish()` passes it to `_report(..., effort=report_effort)` (:465-477).
- `services/ai-qa/src/ai_qa/handler.py:335-367`: `_report` takes a keyword-only `effort` and sets the
  top-level `body["effectiveEffort"]` only inside the `profile == AUTOMATION_PROFILE` branch, so a
  default-profile (human) report keeps its seven keys and stays byte-identical.
- `services/ai-qa/README.md` ("Effort key (contract O1)"): the key, its values, the deploy-before-live
  step, and the dry-run check (`reviewerMatchesGate: true` after a gate is recorded).
- `test_handler.py:467` (`test_results_body_matches_contract`) is a default-profile report, so its key set
  stays correct and is unchanged. It is now the byte-identity pin for the human report.
- Tests (all in `services/ai-qa/tests/test_profiles.py`, all failed on the base handler):
  - `TestEffortInReport::test_draft_report_carries_the_reviewers_effective_effort[env0-provider-default]`
    (Converse) and `[env1-xhigh]` (openai-mantle, `AI_EFFORT=max`): the contract test. The body's
    `effectiveEffort` equals `providers.effective_effort(settings)` for the settings the review used.
  - `TestEffortInReport::test_anthropic_automation_reviewer_reports_the_configured_effort`
  - `TestEffortInReport::test_default_profile_report_is_byte_identical_without_effort`
  - `TestEffortInReport::test_disabled_lambda_still_names_the_automation_effort`
  - Updated key-set assertions: `REPORT_KEYS | {"target", "profile"}` became
    `AUTOMATION_REPORT_KEYS | {"target"}` (with `AUTOMATION_REPORT_KEYS = REPORT_KEYS | {"profile", "effectiveEffort"}`)
    in `TestHandler::test_draft_report_carries_target_and_profile_and_the_automation_reviewer`,
    `TestHandler::test_automation_profile_never_runs_the_second_opinion`, and
    `TestHandler::test_recheck_message_with_automation_profile_reports_profile_only`. These assertions
    pinned the omission that the finding identifies as wrong, so they were changed and not weakened: they
    now also assert the value. `TestHandler::test_automation_profile_missing_price_reports_config_for_every_card`
    gained an assertion that a CONFIG report carries no effort.

### automation-32

Status: fixed

Same fix as cloud-security-resilience-1: `handler.py:459` and `:365-367`. Source re-check chunks (`profile`
only, no `target`) carry the key too:
`TestHandler::test_recheck_message_with_automation_profile_reports_profile_only` and
`TestEffortInReport::test_anthropic_automation_reviewer_reports_the_configured_effort`. The runbook
lines (`docs/runbooks/automation-operations.md` step 5 and the promotion checklist) and the optional
Overview count are outside this issue's allowed paths (`services/.*`, `docs/delivery/r18-issues/.*`).
The deploy-before-live step and the `reviewerMatchesGate: true` check are recorded in the ai-qa README
instead. The core-side contract test belongs to the src_C wave (see Contract).

### ai-agent-26

Status: fixed

Same fix: `handler.py:459`, `:465-477`, `:365-367`. The body carries
`providers.effective_effort(cfg_used)` only when `profile == "automation"`. The case it names, `AI_EFFORT=max`
on openai-mantle giving `xhigh`, is
`TestEffortInReport::test_draft_report_carries_the_reviewers_effective_effort[env1-xhigh]`. The rule that a
default-profile body has no key is covered by
`TestEffortInReport::test_default_profile_report_is_byte_identical_without_effort` and
`test_handler.py::test_results_body_matches_contract`.

## Contract

- **O1** (ai-qa side, completes N2): every report with `profile == "automation"` (draft QA and source
  re-checks) has a top-level `"effectiveEffort": providers.effective_effort(cfg_used)`. This is the value
  the review actually sent, from the same function evals records as `reviewer.effectiveEffort`. It is
  also present on DISABLED-skip and fail-fast reports once the automation settings are valid. It is absent
  only when those settings are invalid (all items are `CONFIG`, nothing can be accepted, and core fails
  closed). Default-profile reports are unchanged and byte-identical. The shape of an automation draft
  report, for the src_C contract test, is:
  `{"v":1,"runId":…,"chunk":…,"provider":"openai-mantle","model":"openai.gpt-5.5","promptVersion":"qa-v4-auto","items":[…],"target":"draft","profile":"automation","effectiveEffort":"xhigh"}`
  (the keys are serialized sorted, as in `test_profiles.py::TestEffortInReport`). The src_C cross-service
  test itself lives in `src_C`, which this issue must not touch. It belongs to the src_C-owning wave.
- **O2**: not touched (frontend/src_C).
