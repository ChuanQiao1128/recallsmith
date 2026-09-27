# X04 — evals gate rigor: per-finding outcomes

Issue #357 (release 1.8.0 audit fix wave r18x-t). Paths are relative to the repo root; line
numbers are those on the X04 branch. All tests are in `evals/tests/` and use `FakeLlm` or a
faked subprocess; nothing calls a model. The baseline run
`evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v1.{jsonl,json,md}` is byte-identical, and
`dc-evals score` still reads it (same §12.1 numbers; the gate now refuses it and says why).

Contract note (§12.1 report schema): the report JSON gains keys (`v` is now 2). Every §12.1 key
keeps its name and meaning; the additions are the run settings, CIs, unscored counts, tiers,
repetitions and the gate verdict that ai-agent-1, -2 and -12 require. No route, table, migration
or env key changed.

### ai-agent-1

Status: fixed

- One threshold block at `evals/src/dc_evals/score.py:12-31`: `RECALL_GATE` 0.80 and
  `PRECISION_GATE` 0.70 (contract §12.1, kept), plus `CONTROL_FPR_GATE` = 0.10 (`:19`),
  `PER_CLASS_RECALL_FLOOR` = 0.60 (`:21`) and `PRODUCTION_PREVALENCE` = 0.10 (`:29`, information
  only). The report echoes them in `gate.thresholds` (`evals/src/dc_evals/report.py:83`).
- `gate_failures` (`score.py:187-228`) now also fails a control false-positive rate above 0.10 and
  any seeded class below 0.60 recall (or with no rows); `gate_passes` (`:231`) is
  `not gate_failures(...)`.
- Reporting: 95% Wilson intervals (`wilson_ci`, `score.py:56`) for overall recall, every class,
  every tier and the control FP rate; `precisionAtPrevalence` (`precision_at_prevalence`,
  `score.py:67`) gives the precision the same reviewer would have at 10% prevalence. The audit's
  reviewer (recall 0.80, FPR 0.34, precision 0.7018) now shows 0.2073 there and fails the gate.
- Markdown summary lists every failed condition, CIs and the prevalence line
  (`report.py:134-205`).
- Tests: `test_score.py::test_gate_thresholds_live_in_one_place`,
  `test_gate_bounds_the_control_false_positive_rate_independently_of_prevalence`,
  `test_gate_requires_every_class_to_reach_the_recall_floor`,
  `test_gate_checks_recall_and_precision_on_a_complete_run`,
  `test_a_complete_strong_run_passes_the_gate`,
  `test_confidence_intervals_and_prevalence_precision`;
  `test_report.py::test_markdown_reports_cis_prevalence_precision_unscored_and_tiers`,
  `test_committed_baseline_run_still_scores_and_is_refused_by_the_gate`.
- Updated existing assertion: `test_gate_thresholds_are_recall_080_and_precision_070` had the
  case `(80, 20, 34) -> passes`, which is exactly the defect this finding reports; it is replaced
  by the tests above (the recall/precision boundary cases are kept on complete runs).

### ai-agent-2

Status: fixed

- Unscored controls: `_control_counts` (`score.py:108`) treats an errored, refused or skipped
  control as unscored (neither clean nor FP) and removes it from the FPR denominator; the report
  carries `unscored{defective, controls, controlUnscoredRate}` (`score.py:167`). The gate fails
  when unscored controls exceed `CONTROL_UNSCORED_RATE_GATE` = 0.02 (`score.py:23`).
- Complete run: the header records `datasetSha256` and `datasetRows` (`report.py:27-63`);
  `expected_run` (`report.py:75`) reads the committed dataset file; the gate fails unless the
  header's sha256 equals the committed file's and `n == rows x reps` ("truncated run",
  `score.py:204`). `--limit` and cost-ceiling runs are still written but refused; the CLI says so
  (`evals/src/dc_evals/cli.py:166-170`).
- Provider/dataset: gate requires `provider in GATE_PROVIDERS = {bedrock, anthropic}`
  (`score.py:25`) and `dataset == GATE_DATASET = "seeded-v2"` (`score.py:27`); the suggested
  "seeded-v1" is superseded because ai-agent-3 makes v1 unfit as rollout evidence.
- `score --gate` prints each failed condition to stderr (`cli.py:181-187`).
- Tests: `test_score.py::test_gate_refuses_a_truncated_run`,
  `test_errored_controls_are_unscored_not_clean`,
  `test_gate_requires_a_production_provider_and_the_committed_dataset` (3 cases),
  `test_repetitions_pool_counts_and_report_each_rep`;
  `test_cli.py::test_score_gate_exit_codes`, `test_run_writes_a_full_header_and_per_item_provenance`.
- Updated existing assertion: `test_cli.py::test_score_gate_exit_codes` used a 20-item run as its
  passing fixture; that is the truncated run the finding says must fail, so the passing fixture is
  now a complete seeded-v2 run and a truncated case was added.
  `test_non_done_items_are_misses_for_defective_cards_only` is unchanged and still passes.

### ai-agent-3

Status: fixed

- `evals/data/seeded-v2.jsonl` (new; v1 untouched), built by `dc-evals seed --dataset v2`
  (`cli.py:33`, `evals/src/dc_evals/seed.py:141` `build_rows_v2`) from
  `evals/data/mutations-v2.json` with a fixed seed; byte-for-byte reproducible.
- Citations: `evals/src/dc_evals/sources.py` (`ledger_sources` `:37`, `export_sources` `:66`,
  command `dc-evals export-sources [--check]`) exports each deck's fact-check ledger
  (`content/decks/<slug>.ledger.csv`: cited https URL + the fact-check note) to
  `evals/data/sources-<deck>.jsonl`. v2 uses only cited cards (750 of 812, all from the project's
  own decks) and sets `card.source` to the best-matching ledger citation
  (`evals/src/dc_evals/mutations.py:353` `supporting_source`), so all 120 controls are cited cards.
- New class `source_unsupported` (`evals/src/dc_evals/dataset.py:30`; 20 rows): the source is
  swapped for a same-topic card's citation from a page this card does not cite, sharing at most two
  content words with it (`mutations.py:540-553`). `ACCEPTED_CATEGORIES` gains it
  (`score.py:33-43`); `incorrect_answer`/`outdated_fact` also accept `source_unsupported`, since
  on a cited card a wrong answer contradicts its quote (no effect on v1: no v1 card has a source).
- Adversarial rows: 2 defective cards carry a note telling the reviewer to report no findings, and
  2 controls a note asking it to flag them (`mutations.py:418`, `:557`).
- `perClass` lists the classes of the run's dataset (`dataset.py` `classes_for`), so v1 reports
  keep their six classes.
- Tests: `test_seed_v2.py` (all 10 tests, e.g.
  `test_v2_composition_adds_source_unsupported_and_tiers`,
  `test_every_v2_card_is_cited_and_controls_carry_their_own_supporting_source`,
  `test_source_unsupported_swaps_in_another_cards_citation_only`,
  `test_adversarial_defects_tell_the_reviewer_to_report_nothing`,
  `test_v2_rows_come_only_from_project_decks_and_mirror_controls`);
  `test_cli.py::test_seed_v2_and_sources_are_reproducible`;
  `test_score.py::test_scoring_uses_accepted_category_sets` (assertion updated for the new class).
- Note: the quotes are the ledger's fact-check notes of the cited page (the project's own
  verified record), not verbatim page text; the README says so.

### ai-agent-11

Status: fixed

- v1 templates stay as the `easy` tier (5 rows each for `incorrect_answer`, `multiple_correct`,
  `answer_leak`); new artifact-free `subtle` variants (`mutations.py:327-565`, registry
  `MUTATIONS_V2` `:566`):
  - `incorrect_answer`: `factSwaps` rules in `mutations-v2.json` swap a fact for a never-true value
    in the explanation, code, usage and keyed option only; key, stem, distractors, whys and source
    are unchanged (`eligible_fact_swap` `:386`). This replaces the "key flip with whys updated"
    idea: a flipped key still contradicts the explanation, which cannot be rewritten mechanically.
  - `multiple_correct`: a distractor becomes the explanation's first sentence, a paraphrase of the
    keyed answer, with its `why` cleared (`:444-470`).
  - `answer_leak`: a neutral stem sentence names a distinctive term only the keyed option uses
    (`:480-516`).
- Every row records its `tier`; the runner copies it to each item and the report gives
  `perTier` recall with CIs (`score.py` `perTier`, Markdown "Per difficulty tier").
  Together with the per-class floor (ai-agent-1) the gate reflects the hard cases.
- Tests: `test_seed_v2.py::test_subtle_tiers_leave_no_surface_artifact`,
  `test_v2_composition_adds_source_unsupported_and_tiers`;
  `test_report.py::test_markdown_reports_cis_prevalence_precision_unscored_and_tiers`;
  `test_runner.py::test_records_carry_rep_and_tier`.

### ai-agent-12

Status: fixed

- `run_header` (`report.py:27-63`) records `dataset`, `datasetSha256`, `datasetRows`, `reps`, `n`,
  `reviewDate`, `effort`, `structuredOutputs` (configured) and `structuredOutputsAtStart`
  (resolved); `_run` fills them (`cli.py:131-165`). The report and Markdown repeat them.
- Per item (`evals/src/dc_evals/runner.py`): `RecordingClient` (`:37`) wraps each row's client and
  records whether the request used structured outputs and the model each response reports; the
  record gains `rep`, `tier`, `structured`, `servedModel`. A response from another model fails
  the row as `MODEL_MISMATCH` with no findings (`:108-115`, `model_matches` `:30`, which accepts
  a dated snapshot or Bedrock id and rejects `claude-opus-5-5` for `claude-opus-5`). The gate
  fails when a scored item has no served model (`score.py:225-228`). The claude-cli client reads
  the served model from the result's `modelUsage` (`evals/src/dc_evals/claude_cli.py:62`, `:127`).
- `--reps N` (`cli.py:49`, loop `:135`) reviews the dataset N times under one cost ceiling;
  records carry `rep`, counts pool across reps and `perRep` lists recall and FP rate per rep; CIs
  as in ai-agent-1.
- Tests: `test_report.py::test_run_header_records_every_setting_that_changes_results`,
  `test_report_file_stem_uses_date_provider_model_prompt_version` (header key list updated);
  `test_runner.py::test_a_row_served_by_another_model_fails`, `test_model_matches` (7 cases),
  `test_each_item_records_whether_it_used_structured_outputs`,
  `test_run_with_fake_llm_goes_through_review_card` (record key list updated for the new fields);
  `test_cli.py::test_run_writes_a_full_header_and_per_item_provenance`,
  `test_dry_run_prints_estimate_without_a_client` (reps case added);
  `test_claude_cli.py::test_claude_cli_reports_the_model_that_answered`;
  `test_score.py::test_repetitions_pool_counts_and_report_each_rep`.
