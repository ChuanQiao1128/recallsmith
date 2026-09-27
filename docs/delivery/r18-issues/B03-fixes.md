# B03 — Automation Python fixes: fixes per finding

Issue #442, wave r18b-p. Branch `delivery/r18bp/B03-442`, cut from `delivery/r18b-p`. Every path is relative to
the repo root. Only `services/ai-qa` and `services/notifier` changed; src_C, infra, evals, tools and the console
belong to other waves and are untouched.

Gates run on this branch:

- `services/ai-qa`: `uv lock --check` OK; `uv run --python 3.12 pytest -q` 207 passed.
- `services/notifier`: `uv lock --check` OK; `uv run --python 3.12 pytest -q` 42 passed.
- `evals` (depends on `services/ai-qa` by path): `uv lock --check` OK; `pytest -q` 162 passed.
- `DRY_RUN=1 services/deploy-python-lambda.sh ai-qa` and `... notifier`: both build and print the DRY plan.

No dependency, SSM parameter, env key, route or table was added or renamed.

## Contract (R18B K-items touched)

- **K1 (automation prompt version).** `services/ai-qa/src/ai_qa/prompts.py:93-103`: `PROMPT_VERSION` stays
  `"qa-v4"` and `SYSTEM_PROMPT` is byte-identical (the existing `tests/test_prompts.py` pins still pass).
  New `PROMPT_VERSION_AUTOMATION = "qa-v4-auto"` and `SYSTEM_PROMPT_AUTOMATION = SYSTEM_PROMPT +
  AUTOMATION_ADDENDUM`. The addendum says the card may be accepted and published with no human reading it,
  and that a factual claim (answer, options, code or usage) that `source.quote` does not support and that
  cannot be confirmed as well-established fact is `source_unsupported` (major), never downgraded to minor.
  `services/ai-qa/src/ai_qa/profiles.py:29-44` maps each profile to its version and prompt
  (`prompt_version_for`, `system_prompt_for`). The handler checks `msg.promptVersion` against the version of
  `msg.profile` (`handler.py:396-411`, `prompt_version_mismatch` now carries `profile`), reviews with that
  profile's prompt (`handler.py:521-527`), echoes that version in the report (`handler.py:355`) and keys the
  reported-cards cache by it (`handler.py:79-81`). `review.request_kwargs` / `review_card` /
  `review_card_counted` take an optional `system_prompt` (default `SYSTEM_PROMPT`), so evals can run the
  automation reviewer with `profiles.system_prompt_for("automation")`.
- **K4 (automation self-failure metric), notifier side.** `services/notifier/src/notifier/handler.py:340-344`
  reads `failedSteps` (strings only; `[]` when absent). `tick_ok` carries it, the job returns it, and a
  non-empty list is logged as `tick_steps_failed` at warn level (`handler.py:393-395`).
- **K5 (tick heartbeat).** `services/notifier/src/notifier/emf.py:15-16,76-77` adds `AutomationTicks`
  (value 1, `Service` dimension, the existing namespace). `handler.py:347-349` emits it first on every
  `{"job": "tick"}` invocation, before the secret check and whatever core answers. The weekly digest job does
  not emit it, so it cannot mask a stopped tick schedule.
- **K6 (email re-send policy), notifier side.** `handler.py:49-52`: the report is tried 3 times, with pauses
  drawn from `(0.5, 1.5)` s and `(2.0, 4.0)` s through the `jitter = random.uniform` seam (`handler.py:192`).
  `NotifierReportFailures` (existing metric) and `report_failed` only when every attempt failed.

## Findings

### ai-agent-5

Status: fixed (the ai-qa side, K1). The dataset/gate side is B06's and the server side is B02's.

- `services/ai-qa/src/ai_qa/prompts.py:93-103`: `qa-v4-auto` prompt as described under K1. It explicitly
  overrides the qa-v4 Currency rule ("raise other (minor)" when a claim cannot be confirmed) for the automation
  profile only, and also applies to a card with `source: null` (nothing supports the claim), which the base
  prompt would otherwise exclude from `source_unsupported`. A claim that `source.quote` supports stays
  supported even when it is newer than the model's training data, so post-cutoff cards with a good quote are
  not all routed to a human.
- `services/ai-qa/src/ai_qa/profiles.py:29-44`, `services/ai-qa/src/ai_qa/handler.py:79-81,355,396-411,521-527`,
  `services/ai-qa/src/ai_qa/review.py:100-111,256-277,365-383`: profile-aware version check, echo and prompt.
- `services/ai-qa/README.md`: "Prompt version `qa-v4-auto`" paragraph and the `prompts.py` row.
- Tests: `tests/test_prompts.py::test_automation_prompt_is_the_default_prompt_plus_an_addendum`,
  `tests/test_profiles.py::TestAutomationPromptAndIsolation::test_prompt_version_and_system_prompt_per_profile`,
  `::test_automation_message_reviews_with_qa_v4_auto_and_echoes_it`,
  `::test_default_message_still_reviews_with_qa_v4`, `::test_version_check_is_against_the_profile_version`,
  `tests/test_review.py::test_review_card_sends_the_given_system_prompt`. The existing prompt pins
  (`test_system_prompt_*`) and `test_results_body_matches_contract` are unchanged and pass.

### ai-agent-9

Status: partially fixed

I found no documented Bedrock Converse field for passing reasoning effort to GPT-5.5. The OpenAI parameter
page (https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-openai.html) covers only
`gpt-oss-20b` / `gpt-oss-120b`, and it only says that other Chat Completions fields go in
`additionalModelRequestFields`, without naming an effort field for Converse. The GPT-5.5 model card
(https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html, read 2026-09-28) lists
Converse as not supported on its endpoint and documents only Responses / Chat Completions on
`bedrock-mantle`. As the brief directs, no request field was guessed. Instead the effort is recorded and never
dropped silently:

- `services/ai-qa/src/ai_qa/converse_client.py:41-48`: `PROVIDER_DEFAULT_EFFORT = "provider-default"`, with the
  documentation cited in a comment; the request comment at `:151-152` is updated.
- `services/ai-qa/src/ai_qa/providers.py:46-52`: `effective_effort(settings)` returns `AI_EFFORT` for
  `bedrock`/`anthropic` (sent as `output_config.effort`) and `provider-default` for `bedrock-converse`.
- `services/ai-qa/src/ai_qa/handler.py:490-503`: a message reviewed without the configured effort logs
  `effort_not_sent` (info) with `provider`, `model`, `configuredEffort` and `effectiveEffort`. Every
  `card_result` log line carries `effort`, and the usage EMF line carries it as the plain property `Effort`
  (`services/ai-qa/src/ai_qa/emf.py:47-70,83-104`). It is not a dimension, so existing metric series and
  alarms are unchanged.
- Remaining (not in this issue's paths): recording the effective effort in the eval run header and gate report
  and including it in the reviewer-match check belong to evals (B06). ai-qa exports
  `providers.effective_effort` for that. The results report body is not changed: a human run's report must
  keep exactly its seven keys (README, "Report keys").
- Tests: `tests/test_providers.py::test_effective_effort_per_provider`,
  `tests/test_profiles.py::TestAutomationPromptAndIsolation::test_effective_effort_is_recorded_never_dropped_silently`.

### cloud-security-resilience-7

Status: fixed

- `services/ai-qa/src/ai_qa/settings.py:215-236`: `_automation()` never raises. An invalid
  `AI_QA_AUTOMATION_PROVIDER`, `AI_QA_AUTOMATION_MODEL` or automation price is recorded in the new
  `Settings.automation_config_error` field (`settings.py:109`). The provider is kept when it is valid, so the
  report still names it. The price is included because it has the same root cause: before this change it
  also took down human QA at load time.
- `services/ai-qa/src/ai_qa/profiles.py:52-54`: `settings_for(cfg, "automation")` raises `ConfigError` from
  that reason, so only automation-profile messages answer `CONFIG` (logged `profile_config_invalid`, not
  `config_invalid`). `settings_for(cfg, "default")` returns the loaded settings unchanged, and human card QA
  keeps running.
- Existing assertion updated because the finding makes the old behaviour wrong:
  `tests/test_profiles.py::TestSettingsFor::test_invalid_automation_settings_are_config_errors` expected
  `load_settings` to raise. It now asserts that loading succeeds, that `settings_for(cfg, "default") is cfg`,
  and that `settings_for(cfg, "automation")` raises with the same key names. All five invalid-input cases are
  kept.
- New tests (both paths):
  `tests/test_profiles.py::TestAutomationPromptAndIsolation::test_invalid_automation_setting_keeps_default_card_qa_running`
  (bad provider / bad model + default message → reviewed, `done`, default reviewer) and
  `::test_invalid_automation_setting_fails_automation_messages_with_config` (same env + automation message →
  every card `error`/`CONFIG`, no model call, acked, `promptVersion` `qa-v4-auto`).
- README "Automation profile (R18A)" updated (the env table row and the paragraph after it).

### cloud-security-resilience-2

Status: partially fixed (the notifier side of K6; core's re-send rule is B02's, the runbook is outside this
issue's paths)

- `services/notifier/src/notifier/handler.py:49-52,60,192-193`: 3 report attempts with jittered backoff.
  Before this change the pauses were fixed at 1 s and 3 s, so containers that failed together retried in step.
  `NotifierReportFailures` is emitted only after the last failed attempt (existing behaviour, now pinned).
- Under K6 the duplicate comes from core re-sending rows that stay `queued` (`ResendAsync`). K6 removes that
  re-send in core (B02). With it gone, a notifier that sent and acked but could not report no longer produces a
  second email. The test the audit proposed ("redelivered to a fresh container") needs core as the source of
  truth. That is the core side, and K6 chose "no re-send" over a notifier status pre-check, so the notifier does
  not call a new route.
- `services/notifier/README.md` "Report" and "Duplicate avoidance": the retry schedule, the K6 policy, and the
  runbook advice to disable `developercards-automation-tick` together with the notify event source mapping
  during a mail incident. `infra/RUNBOOK.md` §7 is outside this issue's allowed paths (`services/`,
  `docs/delivery/r18-issues/`), so the same sentence must land there in the infra wave.
- Existing assertion updated because the finding makes the old behaviour wrong:
  `tests/test_handler.py::TestHandler::test_report_failure_does_not_change_the_send_decision` asserted fixed
  sleeps `[1.0, 3.0]`. It now asserts two pauses, each inside its jitter range. The attempt count (3), the ack
  and the metric names are unchanged.
- Tests: `tests/test_handler.py::TestR18bFixes::test_report_is_retried_three_times_with_jittered_backoff`,
  `::test_real_jitter_stays_inside_each_pause_range`, `::test_a_report_that_recovers_emits_no_failure_metric`
  (with a small `report_script` seam added to `tests/conftest.py::FakeCore`).

### backend-design-3

Status: partially fixed (the notifier side of K4; core's `AutomationStepFailures` gauge and `failedSteps` are
B02's, the alarm is the infra wave's)

- `services/notifier/src/notifier/handler.py:340-344,376-396`: `failedSteps` from the tick response is logged
  in `tick_ok`, returned, and, when non-empty, logged as `tick_steps_failed` at warn level with `job` and
  `tickId`. Non-string entries are dropped. The notifier still returns normally when core answers 200: the
  alarm is core's `AutomationStepFailures` gauge (K4), so the notifier does not raise, which would double-count
  under `notifier-errors`.
- Existing assertion updated: `tests/test_handler.py::TestHandler::test_tick_and_digest_events_call_the_tick_route`
  compared the whole return value. It now includes `"failedSteps": []`.
- Tests: `tests/test_handler.py::TestR18bFixes::test_failed_steps_are_logged_as_a_warning`,
  `::test_no_failed_steps_means_no_warning`.

### cloud-security-resilience-5

Status: partially fixed (the notifier side of K5; switching the `automation-tick-missing` alarm to
`AutomationTicks` is the infra wave's)

- `services/notifier/src/notifier/emf.py:15-16,76-77` and `services/notifier/src/notifier/handler.py:347-349`:
  `AutomationTicks` once per tick invocation, whatever core answers, including when the internal secret is
  missing. SQS email deliveries and the digest job never emit it, so they cannot keep the alarm green.
- README "Scheduler path" and "Metrics" updated.
- Existing assertions updated: `tests/test_handler.py::TestHandler::test_tick_failure_emits_metric_and_raises`
  now expects `["AutomationTicks", "AutomationTickFailures"]` for the failed tick (the digest half is unchanged).
  `tests/test_emf.py::TestEmf::test_emf_lines_match_contract_names_and_dimensions` also covers `emf.tick`.
- Tests: `tests/test_handler.py::TestR18bFixes::test_every_tick_invocation_emits_one_automation_ticks_heartbeat`.
