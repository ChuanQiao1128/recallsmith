# Y05 — evals validity, round 2: per-finding outcomes

Issue #373 (release 1.8.0 audit fix wave round 2, r18y-t). Paths are relative to the repo root;
line numbers are those on the Y05 branch. Every test is in `evals/tests/` and uses `FakeLlm`,
synthetic records or committed files. Nothing calls a model and nothing runs `dc-evals run`.
Every committed report under `evals/reports/` is byte-identical except
`evals/reports/tuning-2026-09-27/README.md`, which the brief asks to correct. `seeded-v1` and
`seeded-v2` (and their mutation files) are unchanged and still rebuild byte for byte.

Contract note (§12.1 report schema): the report JSON gains `structuredOutputsAtStart`,
`evidenceClass` and `gate.expected.shipping`, and `gate.thresholds` gains the new constants.
Every §12.1 key keeps its name and meaning. No route, table, migration or env key changed.
`services/ai-qa/env/prod.env.json` is only read.

### ai-agent-11

Status: fixed

- New dataset `evals/data/seeded-v3.jsonl` (226 rows), built from `evals/data/mutations-v3.json`
  by `dc-evals seed --dataset v3` (`evals/src/dc_evals/dataset.py:48`,
  `evals/src/dc_evals/seed.py:194` `build_rows_v3`, registry
  `evals/src/dc_evals/mutations.py:849` `MUTATIONS_V3`). It has no easy tier: every v1 template
  that leaves an artifact is gone.
- (a) `multiple_correct`: a distractor becomes a hand-written paraphrase of the keyed answer from
  the committed `constructions`. It copies no 5-word run from the key or the explanation, its
  length stays inside the card's own option lengths, and it keeps a real `why` in the card's
  style that rejects the option on a wrong ground (`mutations.py:791`
  `apply_constructed_multiple_correct`). No why is cleared and no explanation text is copied.
- (b) Fact swaps (`incorrect_answer` factSwaps and `outdated_fact` rules) are split by what the
  source shows. Tier `subtle` keeps a quote that states the true value. Tier `source-silent`
  drops every quote clause that states the fact (`mutations.py:622` `silence_quote`, markers
  from each rule's `quoteMarkers`, `:605` `fact_markers`) or uses another of the card's own
  ledger citations that never states it (`:640` `_silent_source`). The adversarial rows are
  source-silent. `perTier` reports each tier separately.
- Scoring: `source_unsupported` is no longer accepted for `incorrect_answer` or `outdated_fact`
  (`evals/src/dc_evals/score.py:47`), so every accepted category of a blocker class is a
  blocker. Updated the existing assertion in `test_scoring_uses_accepted_category_sets`: the
  finding makes the old set wrong.
- (c) The source-silent tier is the measurement the finding asked for: a fact the source never
  states, which the currency rule has to catch from domain knowledge. It needs a real run (see
  ai-agent-17).
- Control matching: each control is the nearest unused card of the same deck and shape in
  length and option count (`seed.py:225` `_shape`, `:243` `_matched_controls`). Without it,
  length would separate the classes whose templates only fit long or short cards.
- Cue check (trains nothing): `evals/tests/cues.py` computes card features and compares defects
  with same-deck, same-shape controls by AUC. The features are option count, a distractor
  without a why, a keyed option with one, a distractor sharing an 8-word run with the
  explanation, keyed text inside a distractor, a Hint line, stem/explanation/quote length,
  keyed-minus-distractor length, option length spread and shortest why.
- Tests: `test_seed_v3.py::test_surface_cues_are_balanced_between_defects_and_controls` (the new
  data passes), `test_cue_check_catches_the_v2_artifacts` (the old data fails: the null-why and
  copied-explanation cues show AUC 1.00),
  `test_no_v3_row_clears_a_why_or_copies_the_explanation_into_an_option`,
  `test_fact_swap_tiers_say_what_the_source_shows`,
  `test_silence_quote_drops_only_the_clauses_that_state_the_fact`,
  `test_constructed_multiple_correct_rows_paraphrase_the_key_with_a_real_why`,
  `test_v3_composition_has_no_easy_tier_and_carries_rationales`,
  `test_seed_v3_regenerates_committed_dataset_byte_for_byte`;
  `test_score.py::test_a_source_unsupported_finding_does_not_catch_a_wrong_answer`,
  `test_every_accepted_category_of_a_blocker_class_is_a_blocker`,
  `test_scoring_uses_accepted_category_sets`; `test_cli.py::test_seed_v3_is_reproducible`.

### ai-agent-18

Status: fixed

- `ambiguous_stem` and `qualifier_mismatch` in v3 come from adjudicated `constructions` in
  `evals/data/mutations-v3.json`, not the v1 templates. The seed picks 15 per class from 23 and
  19 reviewed constructions. Candidates whose viability was doubtful were rejected, and a card
  named by a construction is reserved for it (`seed.py:267` `_build_tiered`).
  - `ambiguous_stem` (`mutations.py:806`): the stem loses the stated constraint (or qualifier)
    that one distractor's own `why` cites as its only reason for failing. `evidence` is a
    verbatim piece of that why, checked at seed time. That distractor then meets every stated
    requirement.
  - `qualifier_mismatch` (`mutations.py:823`): the qualifier becomes one that the card's own
    text (a why or the explanation, quoted in `evidence`) shows a named distractor beats the
    key on.
- Every row carries a machine-readable `rationale` (`mutations.py:760`, `seed.py:209`):
  `keyedOption`, `viableOption`, `reason`, and `removedConstraint` / `evidence`, or
  `qualifierFrom` / `qualifierTo` / `evidence`.
- The dataset is `seeded-v3`, and the gate moved to it (`score.py:38` `GATE_DATASET`). v2 is
  kept for comparison and no longer counts toward any floor.
- Tests: `test_seed_v3.py::test_constructed_ambiguous_stem_rows_make_a_named_distractor_viable`,
  `test_constructed_qualifier_mismatch_rows_name_the_option_that_wins`,
  `test_every_committed_construction_applies_to_its_card` (3 cases; unused constructions are
  checked too), `test_constructions_name_distinct_cards`;
  `test_score.py::test_gate_thresholds_live_in_one_place` (assertion updated for `seeded-v3`).
- Note: the adjudication was done in this session, by drafting candidates against the card text
  and reviewing each by hand. No independent human reviewed it. The rationale in each row makes
  every verdict checkable.

### ai-agent-17

Status: partially fixed

- The code and documentation part is fixed. `evals/reports/tuning-2026-09-27/README.md` now opens
  with a status block: qa-v3 has **not** passed the gate, and every run is proxy evidence that
  also fails on substance (recall 0.7826, `ambiguous_stem` 0.3750, `qualifier_mismatch` 0.4286).
  It names the required run
  (`dc-evals run --provider bedrock --model anthropic.claude-opus-5 --dataset v3 --reps 2` then
  `score --gate` exiting 0). It also corrects the false "seeded-v2 rewrites those templates" and
  "Its run is the next report" lines. `evals/README.md` ("Rollout") states the same.
  `dc-evals run` now defaults to `--dataset v3 --reps 2` (`evals/src/dc_evals/cli.py:50`, `:57`).
- Not done here: the paid Bedrock run itself. Workers may not run `dc-evals run` or spend money
  on a model, and Bedrock model access is still pending. The owner has to run it before
  `AI_QA_ENABLED` is switched on. It stays `0` in both prod env files.
- Tests: `test_report.py::test_no_committed_run_is_rollout_evidence_and_the_readmes_say_so`.

### ai-agent-19

Status: fixed

- `evals/reports/tuning-2026-09-27/README.md` states plainly, in step 2, a new "Holdout
  contamination" paragraph in step 3, the Results note and the section title, that the control
  adjudication covered holdout controls too: 16 of 29 ids (7 debatable, 6 false alarms and 3
  real defects by id; 9 false-alarm findings). It says the qa-v3 holdout numbers are therefore
  not a clean held-out result, points to the seeded-v3 run as the clean measurement, and says
  future tuning adjudicates only dev rows before the prompt freeze. The run files themselves are
  unchanged.
- Tests: `test_report.py::test_tuning_readme_discloses_that_the_holdout_informed_qa_v3` (it
  recomputes the 16-of-29 overlap from the committed files).

### ai-agent-20

Status: fixed

- `gate_failures` (`evals/src/dc_evals/score.py:225`) compares provider, model, `promptVersion`,
  `effort` and `structuredOutputsAtStart` with `shipping_config()` (`score.py:202`). That
  function reads `services/ai-qa/env/prod.env.json` through `ai_qa.settings.load_settings`,
  resolves the mode with `ai_qa.providers.structured_outputs_on` and takes
  `ai_qa.prompts.PROMPT_VERSION`. The result goes into `gate.expected.shipping`
  (`evals/src/dc_evals/report.py:137`).
- An `--provider anthropic` run (structured outputs on) and any run of another prompt, model or
  effort now fail the gate.
- `evidenceClass` is "rollout" for bedrock/anthropic and "proxy" for claude-cli (`score.py:219`,
  `report.py:123`). The Markdown summary says a proxy run never satisfies the rollout gate by
  itself (`report.py:168`). The report also carries `structuredOutputsAtStart` (`report.py:122`).
- Tests: `test_score.py::test_gate_binds_the_run_to_the_shipping_configuration` (5 cases),
  `test_shipping_config_is_read_from_the_production_env_file`,
  `test_claude_cli_runs_are_labelled_proxy_evidence`,
  `test_gate_requires_a_production_provider_and_the_committed_dataset`;
  `test_cli.py::test_run_writes_a_full_header_and_per_item_provenance` (an anthropic run is now
  refused for its structured mode); `test_report.py::test_report_json_matches_contract_schema`
  (key set updated).

### ai-agent-21

Status: fixed

- The gate (`score.py:225`) now requires:
  - at least `MIN_GATE_REPS` = 2 repetitions (`score.py:30`);
  - at least `MIN_CLASS_ITEMS` = 30 pooled items per class (`:32`), with the 0.60 floor applied
    to pooled counts;
  - a recall 95% Wilson lower bound of at least `RECALL_CI_LOWER_GATE` = 0.75 (`:18`);
  - a control-FPR 95% Wilson upper bound of at most `CONTROL_FPR_CI_UPPER_GATE` = 0.15 (`:25`).

  These come on top of the contract's point thresholds. Wilson intervals are already reported
  per class, per tier and overall; `--reps` aggregation pools counts.
- `dc-evals run --reps` defaults to 2 (`cli.py:50`).
- `class_floor_pass_probability` (`score.py:293`) gives the pass probabilities quoted in
  `evals/README.md` "Gate". At true recall 0.75, a single 15-item repetition fails some class in
  33.5% of runs. On 30 pooled items all seven floors pass with probability 0.86 (0.98 at 0.80),
  and a weak class at 0.50 passes only 18% of the time.
- Updated existing assertions: the gate fixtures in `test_score.py` and `test_cli.py` used
  one-repetition seeded-v2 runs as passing evidence. That is exactly what this finding and
  ai-agent-18/-20 make insufficient, so they now use complete two-repetition seeded-v3 runs of
  the shipping configuration (`conftest.py` `gate_header`, `gate_records`). The boundary cases
  were recomputed for 226 pooled defects and controls.
- Tests: `test_score.py::test_gate_requires_repetitions_and_a_minimum_class_sample`,
  `test_gate_uses_the_interval_bounds_not_only_the_point_estimates`,
  `test_gate_checks_recall_and_its_lower_bound_on_a_complete_run`,
  `test_gate_requires_every_class_to_reach_the_recall_floor_on_pooled_counts`,
  `test_class_floor_pass_probability_matches_the_audit_and_the_readme`,
  `test_gate_bounds_the_control_false_positive_rate_independently_of_prevalence`,
  `test_repetitions_pool_counts_and_report_each_rep`;
  `test_cli.py::test_dry_run_prints_estimate_without_a_client` (the default is 2 reps),
  `test_score_gate_exit_codes`.
