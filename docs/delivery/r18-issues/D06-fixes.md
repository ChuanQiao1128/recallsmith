# D06 — Evals round 3 (R18D, wave T)

Issue #475. Scope: `evals/` and this ledger. Each fix has a test in `evals/tests/test_d06_fixes.py`.
Those tests fail on the base `delivery/r18d-t` @ 2f9b9ba: the file does not import there, and 15 of
its 18 tests fail even with only `drafts_import.py` updated. Nothing calls a model; `dc-evals run`
is tested only with the fake client. No file under `evals/reports/` changed.

## Findings

### ai-agent-9
Status: fixed (evals side; the "optional" separate `AI_QA_AUTOMATION_EFFORT` would be an ai-qa
change in `services/`, another wave's root, so it was not added)

- `evals/src/dc_evals/cli.py:365` `automation_run_env` and `:250-262`: `run --profile automation` now
  builds its settings like production does, with `ai_qa.profiles.settings_for(load_settings(env), "automation")`.
  - `--provider` and `--model` become `AI_QA_AUTOMATION_PROVIDER` / `_MODEL`.
  - `AI_EFFORT`, `AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK`, `_OUTPUT_PER_MTOK` and `AI_QA_AUTOMATION_REGION`
    come from the production env file (`services/ai-qa/env/prod.env.json`, hidden `--ai-qa-env`), never
    from the shell. A key that production leaves unset takes the ai-qa default.
  - A missing env file or missing automation prices exit 2.
  - The dry-run estimate uses the automation prices.
- `cli.py:352`: an automation-profile header also records `effectiveEffort` =
  `ai_qa.providers.effective_effort(settings)`, the value the review actually sent (`max` goes out as
  `xhigh` on openai-mantle, and bedrock-converse records `provider-default`). `effort` stays the
  configured `AI_EFFORT`. A default-profile header is unchanged.
- `evals/src/dc_evals/automation_gate.py:131` `REVIEWER_KEYS` adds `effort` and `effectiveEffort`, so the
  seeded and authored runs must match on both.
- `automation_gate.py:417-466` and `:469` `_effort_failures` check each run against production's
  `AI_EFFORT` (the ai-qa default `high` when unset). This mirrors `score.py:396`.
  - A header without `effectiveEffort` fails closed.
  - `effort` must equal production's `AI_EFFORT`.
  - `effectiveEffort` must equal that value as the run's provider sends it: `effective_effort` on the
    run's provider, through `REASONING_EFFORTS`.
  - An invalid production `AI_EFFORT` fails.
- The report's `reviewer` block also carries `servedModels` (`automation_gate.py:493`): the distinct
  `servedModel` ids that the client's responses reported in both runs. The Markdown reviewer line
  shows the effort, the value sent and the served models.
- README: `evals/README.md:510` (the run), the check table ("reviewer effort") and `:721` (report keys).
  The probe and run recipe no longer export prices or the region.
- Tests (`test_d06_fixes.py`):
  - `test_gate_fails_closed_on_runs_that_do_not_record_the_effort_sent`
  - `test_gate_compares_the_run_effort_with_production`
  - `test_gate_refuses_an_invalid_production_effort`
  - `test_seeded_and_authored_runs_must_send_the_same_effort`
  - `test_gate_reports_the_served_model_ids`
  - `test_cli_automation_run_takes_effort_prices_and_region_from_production`
  - `test_cli_automation_run_uses_the_ai_qa_default_when_production_sets_no_effort`
  - `test_cli_automation_run_refuses_without_the_production_env_or_prices`
- Existing tests updated because the finding makes the old shape wrong:
  - `test_automation_gate.py`: the shared `AUTOMATION` header fixture gains `effectiveEffort`, which
    is what a bedrock-converse run now records. `test_gate_passes_when_every_threshold_is_met` and
    `test_report_json_has_the_contract_keys` expect the three appended reviewer keys.
  - `test_c06_fixes.py::test_gate_passes_for_an_openai_mantle_reviewer_and_pins_it`: the mantle runs
    record `effectiveEffort="high"`.

### ai-agent-20
Status: fixed

- `automation_gate.py:193` `page_key`: the source page is the row's `sourceUrl`, with the scheme and
  host lowercased and the fragment and trailing slash dropped. A row without a URL counts as its own
  page.
- `automation_gate.py:203` `page_metrics`: every would-accept item of one page is one cluster, across
  all its cards and repetitions. It reports `unit` "source page", `wouldAcceptPages`, `effectiveN`
  (the design effect from `score.effective_n`) and the page-clustered `autoAcceptPrecisionCi95`.
- Each `strata` block (`:277`) now carries `byPage` and `autoAcceptPrecisionEffectiveN`, the card
  interval's `n_eff`. The report therefore states both units of analysis and both effective sample
  sizes.
- The new-facts gate is `_new_facts_failures` (`:535`):
  - Once the 51-card minimum holds, the would-accept cards must come from at least
    `MIN_NEW_FACTS_WOULD_ACCEPT_PAGES` = 51 distinct pages (`:106`, threshold
    `minNewFactsWouldAcceptPages`).
  - The page-clustered lower bound must reach 0.93, in addition to the card-clustered bound.
  - 51 is the smallest number of pages that can pass. With every item correct, `n_eff` equals the
    number of pages, and Wilson(50) = 0.9286.
- The Markdown per-stratum table shows the cards and the pages, each with its `n_eff`, and both
  intervals, followed by a units-of-analysis note (`UNIT_NOTE`).
- README "Unit of analysis" (`evals/README.md:636`): the minimum-sample argument now covers pages.
  51 cards from 18 pages give a page bound of 0.82 and fail.
- Consequence for the owner: the 18 pages of `data/authored-sources-v2-new-facts.json` cannot pass the
  gate. At least 51 announcement pages are needed. I did not add real post-cutoff URLs from here, so
  the gate fails closed until the owner extends the file (see Concerns).
- Tests (`test_d06_fixes.py`):
  - `test_51_cards_over_18_pages_fail_the_page_clustered_gate`: 51 cards over 18 pages give a page
    bound of about 0.82 and fail.
  - `test_page_minimum_is_the_smallest_that_can_pass_the_page_bound`
  - `test_wrong_cards_from_one_page_are_one_cluster`
  - `test_page_key_normalises_the_source_url`
- Existing tests updated:
  - `authored_spec` in `test_automation_gate.py` gives each new-facts card its own page (before, all
    rows shared one docs URL). This keeps the page and card intervals equal, so every earlier
    new-facts test measures what it did before.
  - `test_b06_gate_fixes.py::test_new_facts_stratum_must_meet_the_precision_gate_on_its_own` and
    `test_c06_fixes.py::test_new_facts_stratum_fails_on_its_ci_lower_bound_when_the_point_estimate_passes`
    also expect the page-clustered failure. In the first, both wrong cards are on one page.
  - The per-stratum Markdown row and gate text assertions follow the new table.

### automation-24
Status: partially fixed (the evals procedure and its tag are done; excluding the eval decisions from
the ledger and agent-quality numbers is a src_C change, which I did not make because it is another
wave's root; it is requested below)

- `evals/src/dc_evals/drafts_import.py:61` `NEW_FACTS_REJECT_REASON = "other"`. The rejection is
  procedural, so its reason is in `Drafts.RejectReasons` and in none of `Drafts.DefectReasons`. The
  ledger's `defectRejects` therefore never counts an eval reject. This corrects the audit's "no reason
  given": the route requires a reason, and the procedure now names it.
- README step 5 (`evals/README.md:612`) now rejects with
  `{ "reason": "other", "note": "eval:new-facts" }`. The eval tag is therefore on the reject event
  (`ai_review_events.note`) as well as on the queue item's note. Until core excludes these rejects,
  the owner records the eval window and the number of rejects next to the gate report.
- Shadow agreement is already unaffected: with `AI_QA_ENABLED=0` for the whole window (step 1), every
  eval decision is `human` / `QA_UNAVAILABLE` and never `would_accept`.
- **Server change requested (src_C wave, not made here):** exclude eval drafts from agent quality.
  An eval draft is one whose `automation_queue_items.note` starts with `eval:`, or whose
  `ai_review_events.note` starts with `eval:`.
  - Exclude them from `LedgerRoutes.AgentDraftQualityAsync` (`decided`, `accepted`, `rejected`,
    `acceptanceRate`, review time).
  - Exclude them from the `ai_draft_review` ledger events that `Drafts.cs` reject writes.
  - Exclude them from any shadow-agreement or M2 live computation that could see them.
  - Test: an eval reject leaves `agentDrafts.rejected` unchanged.
- Tests (`test_d06_fixes.py`):
  - `test_eval_drafts_are_rejected_with_a_non_defect_reason_and_the_eval_tag` reads `Drafts.cs`
    `RejectReasons` and `DefectReasons` and README step 5.
  - The existing `test_c06_fixes.py::test_new_facts_procedure_runs_on_the_stack_that_exists` still
    holds.

## Contract

- **M1 (evals side):**
  - `drafts_import.py:83` `gated_author_config_id` recomputes the runner's `authorConfigId`: sha256
    hex of the canonical JSON (sorted keys, no spaces) of
    {`argsSha256` = `claudeArgsSha256`, `model`, `promptSha256`, `skillSha256`, `skillVersion`}. It is
    pinned to a vector that node computes with the runner's algorithm, and to the five field names in
    `authorConfig.ts`.
  - `read_author_config` (`:130`) copies the id from the run meta (top level or `authorConfig`) onto
    the row's `authorConfig`. It refuses a record with two different ids, or with an id that does not
    match its fields.
  - `_author_problem` (`:195`) drops a draft whose `agent.authorConfigId` is another id.
  - `automation_gate.author_binding` (`:587`) writes `authored.author.authorConfigId`: the single id
    when every new-facts row carries a valid one. Otherwise the value is `null`, and the gate fails
    closed when a row has none (a pre-M1 record) or when the rows carry more than one id.
  - Tests: `test_gated_author_config_id_is_the_runners`, `test_import_copies_the_gated_id_from_the_run_record`,
    `test_gate_fails_closed_on_new_facts_rows_without_the_gated_id`, `test_gate_fails_on_more_than_one_gated_id`,
    `test_passing_report_carries_the_one_gated_id`.
  - Existing tests updated:
    - The fixtures `AUTHOR_CONFIG` and `RUN_AUTHOR` carry their gated id.
    - `test_gate_report_binds_the_author_configuration` expects the new key and Markdown.
    - In `test_gate_fails_on_new_facts_rows_from_two_author_models_and_lists_every_configuration`, a
      prompt change is now a second gated id and fails. The passing variant uses a changed CLI version,
      which M1 leaves out of the id.
    - `test_import_drafts_records_the_run_author_configuration` regates its other-model record.
- No other M-item touches evals. Routes, tables and env keys are unchanged. The report keys are
  additive, and the keys the server reads keep their places.

## Deviations

- ai-agent-20: I gate on both bounds and add a 51-page minimum instead of the audit's example of 30
  pages. With every item correct, 30 pages give a page bound of only 0.886. Only 51 pages can reach
  the 0.93 the README promises.
- ai-agent-9: effort is compared for the two gate providers only. For another provider the gate
  already fails on the provider, and the mapping would only add noise. A missing `effectiveEffort`
  fails for every provider.

## Concerns

- The gate cannot pass until `data/authored-sources-v2-new-facts.json` has at least 51 source pages
  (it has 18). The owner has to add real post-cutoff announcement pages.
- automation-24 needs the src_C exclusion above for the agent-quality numbers to be clean.
