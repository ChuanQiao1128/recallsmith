# C06 fixes: evals, fix round 2 (R18C wave T)

Issue #460. Scope: `evals/` only (no server, runner, infra or ai-qa change). Every existing file
under `evals/reports/` is byte-identical. `cd evals && uv lock --check && uv run --python 3.12 pytest -q`:
197 passed (183 existing, 14 new in `evals/tests/test_c06_fixes.py`). The suite also passes, 197
of 197, when the sibling C03 ai-qa (with the real `openai-mantle` provider) comes first on the
path. No model was called and no `dc-evals run|author|jury` was run.

### ai-agent-12

Status: fixed (the `feed_item` side point is documented, not changed; see below)

- `evals/README.md:564-626` ("New-facts stratum (owner, production in dry_run)") replaces the
  sandbox/`AUTOMATION_MODE=off` procedure. It runs on the only stack there is (production, `infra/envs/prod`) in
  `AUTOMATION_MODE=dry_run`, the mode in which the runner claims and drafts while nothing is
  auto-accepted or published. It explains why neither `off` (runner.ts exits idle; RunnerRoutes claim
  answers no items) nor `live` works. It makes the explicit QA choice `AI_QA_ENABLED=0` for the whole
  window. With QA off every eval decision routes `human`/`QA_UNAVAILABLE` (src_C `DraftDecisions`
  `QaAvailable()`) and never reaches `would_accept`, so the shadow agreement, which counts
  `would_accept` decisions only (`StatusRoutes.cs` shadow query), never includes an eval draft, even
  after it is rejected. This excludes the eval drafts from shadow agreement without a server change.
  The eval items are queued with `"note": "eval:new-facts"`, their item ids are recorded, and the
  drafts of those items are exported with `GET /api/v1/authoring/drafts/:draftId`. The drafts are
  then rejected (`POST /api/v1/authoring/drafts/:draftId/reject`), leftover items are skipped, and
  the mode and QA flag are restored.
- `evals/src/dc_evals/drafts_import.py:48-53`: `NEW_FACTS_AUTOMATION_MODE = "dry_run"` and
  `NEW_FACTS_QUEUE_NOTE = "eval:new-facts"`, the values the README and the tests pin; the module
  docstring and the `import-drafts --drafts` help (`cli.py`) no longer say "sandbox".
- The runbook block in the "Automation gate" section says "production runner path in AUTOMATION_MODE=dry_run".
- Side point, `feed_item` branch: an admin route that queues `feed_item` items would be a src_C change
  (not this issue's paths, and not an L-item). The README now says plainly that the stratum runs
  the prompt's manual-item path, not its `feed_item` branch.
- Tests: `test_new_facts_procedure_uses_a_mode_the_runner_claims_under`. It reads the README
  procedure's `AUTOMATION_MODE=` values, the runner's no-claim modes from
  `tools/author-runner/src/runner.ts` (`effectiveMode === '…'`) and `RunnerRoutes.cs`
  (`mode.Effective == AutomationMode.…`), and the modes from `AutomationMode.cs`. It asserts that the
  procedure's only mode is `dry_run`, a known mode, not a no-claim mode, and not `live`.
  `test_new_facts_procedure_runs_on_the_stack_that_exists` checks for: no sandbox, production,
  `AI_QA_ENABLED=0` with `QA_UNAVAILABLE` and shadow agreement, the `eval:new-facts` note, the GET
  export, the reject route and `--runs-dir`.

### ai-agent-15

Status: fixed

- `evals/src/dc_evals/automation_gate.py:80-88`: new `NEW_FACTS_AUTO_ACCEPT_PRECISION_CI_LOWER_GATE`
  = `AUTO_ACCEPT_PRECISION_CI_LOWER_GATE` (0.93). The new-facts stratum must meet both pooled
  precision gates on its own: the point estimate and the lower bound of its card-clustered 95%
  Wilson interval (`score.clustered_wilson_ci`, the interval every other gate uses).
  `_new_facts_failures` (`:435-467`) checks the bound after the point estimate.
- The minimum is now the smallest sample that can pass, documented in the constant's comment and the
  README (`README.md:606-613`). With every card correct in both repetitions the bound is the
  distinct-card Wilson bound, which first reaches 0.93 at 51 cards (50 give 0.9286). One wrong card
  needs 77 cards, two need 100. So `MIN_NEW_FACTS_WOULD_ACCEPT_CARDS` = 51 (was 30).
  - Before: a reviewer with true precision 0.95 passed a 30-card stratum with probability 0.95^30 ≈ 0.21.
  - Now: at the 51-card minimum, 0.95^51 ≈ 0.07; at 60 cards, about 0.05 (exact binomial over the
    clustered bound).
- `THRESHOLDS` gains `newFactsAutoAcceptPrecisionCiLower` (`:124`), appended after the B06 keys. The
  per-stratum Markdown gate column shows the bound (`:681-683`). The src_C `EvalGate` recomputes no
  stratum figure (it reads only the A00 §15.4 keys), so nothing needs mirroring there.
- Tests: `test_new_facts_minimum_is_the_smallest_sample_that_can_pass_the_ci_bound`,
  `test_new_facts_stratum_fails_on_its_ci_lower_bound_when_the_point_estimate_passes` (61 cards,
  120 of 122 items correct: the point estimate passes and the bound fails; this passed the old
  gate), and `test_new_facts_stratum_at_the_minimum_passes`.
- Existing assertions updated because the finding makes the old behaviour wrong:
  - `tests/test_automation_gate.py` `authored_spec`: the default new-facts fixture grows from 40 to
    60 cards, because 40 all-correct cards can no longer pass. New-facts rows also carry the author
    configuration (ai-agent-3).
  - `test_each_threshold_failure_is_reported` "precision-ci": its 40 new-facts cards now also report
    the new-facts minimum.
  - `test_report_json_has_the_contract_keys`: the thresholds are 51 and the new key, and `authored`
    ends with `author`.
  - `tests/test_b06_gate_fixes.py`:
    - `test_report_has_per_stratum_precision`: docs 80/70/20, new-facts 60/120/60.
    - `test_gate_fails_closed_below_the_new_facts_minimum_sample`: 50 cards, fewer than 51.
    - `test_new_facts_stratum_must_meet_the_precision_gate_on_its_own`: 120 of 124 is 0.9677, and the
      CI lower-bound failure is now reported too.
    - `test_gate_fails_closed_when_the_jury_excluded_too_many_rows`: 7 of 67 new-facts rows; docs 18 of 98.

### ai-agent-3

Status: partially fixed (the evals side is fixed; server enforcement needs src_C and runner changes outside this issue's paths)

- `import-drafts` records the author configuration. `drafts_import.py:56-145`: `read_author_config`
  reads `<runs dir>/<runId>.meta.json`, the run record `tools/author-runner/src/runner.ts` writes,
  and takes its complete `authorConfig`. That is the runner's `AuthorConfig`: `id`, `model`,
  `skillVersion`, the skill, prompt, CLAUDE-args and MCP-bundle SHA-256s, `claudeVersion`,
  `runnerVersion`.
  - `draft_rows` (`:156-212`) copies the configuration onto each new-facts row as `authorConfig`.
  - It leaves out and reports a draft with no run record, an unreadable or foreign record, an
    incomplete config, a path-like run id, or a draft whose `agent.model`/`agent.skillVersion` is
    not its run's.
  - `--runs-dir` (`cli.py:143-149`, `:377-380`) defaults to `$DC_RUNNER_LOG_DIR/runs`, else
    `~/Library/Logs/DeveloperCards/runs` (`default_runs_dir`, the runner's `logDir`).
- The gate binds it. `automation_gate.py:470-512` `author_binding`, reported as `authored.author`
  (`:664`): `{model, skillVersion, authorConfigIds, configs}`.
  - The gate fails closed when a new-facts row has no complete `authorConfig`, or when the rows
    span more than one author model or skill version.
  - Different hashes or CLI versions under one model and skill are all listed in `authorConfigIds`,
    so the gate is bound to each of them.
  - The Markdown has an "Author (new-facts stratum)" line (`:734-742`).
- `README.md:620-626` ("Author binding"): any change of the author configuration (a new
  `authorConfig` id) requires a new gate.
- Not done here (outside `evals/` and `docs/delivery/`, and no L-item covers it):
  - the runner does not send `authorConfigId` on `POST /runner/complete`;
  - there is no `automation_runs.author_config_id` column (migration 035);
  - there is no `AUTHOR_NOT_GATED` routing in src_C.

  The README says so (`README.md`, the last paragraph of "Automation gate"): until core compares
  them, the owner reruns the gate after any author configuration change.
- Tests: `test_gate_report_binds_the_author_configuration`,
  `test_gate_fails_closed_on_new_facts_rows_without_an_author_configuration`,
  `test_gate_fails_on_new_facts_rows_from_two_author_models_and_lists_every_configuration`,
  `test_import_drafts_records_the_run_author_configuration`, `test_default_runs_dir_is_the_runner_log_dir`.
- Existing tests updated because `draft_rows`/`import-drafts` now need the run records:
  `test_import_drafts_builds_new_facts_rows`, `test_import_drafts_rows_join_the_jury_and_the_run` and
  `test_cli_import_drafts_arguments` pass a runs directory (`_runs_dir`). The builds test also asserts
  the copied `authorConfig`. Hand-made new-facts rows in `_with_excluded` and
  `test_new_facts_stratum_must_meet_the_precision_gate_on_its_own` carry `AUTHOR_CONFIG`.

### ai-agent-11

Status: partially fixed (the evals side of L1 is fixed; the adapter, env, IAM and src_C `EvalGate` belong to C03, C04 and C01/C02)

- `automation_gate.py:55-61`: `AUTOMATION_GATE_PROVIDERS = {"openai-mantle", "bedrock-converse"}`.
  The reviewer triple in the report is unchanged and still pins the provider the runs used. The
  existing configuration check (`_configuration_failures`) still requires both runs to use the
  provider `AI_QA_AUTOMATION_PROVIDER` names.
- `cli.py:38-40`, `:66-75`: `run --provider openai-mantle` (`RUN_PROVIDERS`) reviews in-process
  through ai-qa (`load_settings` with `AI_PROVIDER=openai-mantle`, `make_client`), and the region
  comes from `AI_QA_AUTOMATION_REGION`. When the installed ai_qa does not know the provider, `run`
  exits 2 with ai-qa's own `AI_PROVIDER must be one of …`.
- `README.md`:
  - "Configurations in `run`" describes openai-mantle, cites the model card URL, and says the card
    text leaves ap-southeast-2 (public study content only).
  - The allowlisting note covers openai-mantle.
  - The gate intro names `openai-mantle` / `openai.gpt-5.5`, with `bedrock-converse` as the
    fallback.
  - The owner runbook uses openai-mantle and adds a one-call probe for each path (`--limit 1 --reps 1`,
    written outside `reports/`) after allowlisting and before any paid run.
  - The check table lists both providers.
  - The env paragraph names the keys L1 commits.
- The prices are not repeated in the evals README. The gate reads them from `prod.env.json`, which
  C03 owns and which cites the model card.
- Tests: `test_gate_accepts_both_automation_providers`,
  `test_gate_passes_for_an_openai_mantle_reviewer_and_pins_it`,
  `test_cli_run_reviews_in_process_with_openai_mantle` (fake client; the provider is added to ai_qa
  `PROVIDERS` only when the installed ai_qa lacks it), and
  `test_cli_run_refuses_openai_mantle_when_ai_qa_has_no_such_provider`.
- Existing assertion updated: `test_configuration_mismatch_fails_the_gate` now expects
  `not one of ['bedrock-converse', 'openai-mantle']`.

## Contract

- **L1** (evals side). The automation-gate providers are exactly `{"openai-mantle", "bedrock-converse"}`
  (`automation_gate.AUTOMATION_GATE_PROVIDERS`), and the report's `reviewer` block pins the provider
  actually used. `dc-evals run --provider openai-mantle --model openai.gpt-5.5` reviews in-process
  through ai-qa's `openai-mantle` client. It uses `AI_QA_AUTOMATION_REGION` (default us-east-1) and
  runs `--profile automation` as before. Tests use fakes only. The README has the probe per path
  and the data-location note.
- **L3** (text only). The gate's "failed" Markdown line (`automation_gate.py:823-826`) and the README
  no longer say a failed report is never recorded. They say that a posted failed report is recorded
  as a failed evaluation which, as the newest, keeps `live` off. No route is called from evals.
- L2, L4, L5, L6: not touched (no evals side).

## Deviations

- The gate needs one author model and one skill version across the new-facts rows. It allows several
  `authorConfig` ids under them, all bound in the report, so an autoupdate of the Claude CLI during
  the eval window does not force a rerun.
- The eval drafts are kept out of shadow agreement by the procedure (`AI_QA_ENABLED=0`, so the eval
  decisions never reach `would_accept`), not by a server-side filter on the `eval:new-facts` note,
  which would be a src_C change.
