# Z04 — evals round 3: per-finding outcomes

Issue #388 (release 1.8.0 audit fix wave round 3, r18z-t). Paths are relative to the repo root;
line numbers are those on the Z04 branch. Every test is in `evals/tests/` and uses `FakeLlm`, a
faked `claude -p` subprocess, synthetic records or committed files. Nothing calls a model and
nothing runs `dc-evals run`. Every committed report under `evals/reports/` is byte-identical and
still scores (`dc-evals score` on each `.jsonl`). `seeded-v1`, `seeded-v2`, `seeded-v3` and every
mutation file are unchanged and rebuild byte for byte (`dc-evals seed [--dataset v2|v3] --check`).

Contract note (§12.1 report schema): the report JSON gains `unitOfAnalysis`, `labels` and
`proxyFidelity`, and `gate.thresholds.minClassItems` (30 pooled items) becomes
`gate.thresholds.minClassCards` (15 distinct cards). Every §12.1 key keeps its name and meaning.
No route, table, migration or env key changed.

### ai-agent-28

Status: fixed

- Every interval is card-clustered. `evals/src/dc_evals/score.py:114` `effective_n` computes
  the design effect of a rate pooled over cards (the cluster-robust variance of the ratio over
  cards / the binomial variance of the pooled items). The effective n stays between the distinct
  cards and the pooled items, and a rate of 0 or 1 uses the distinct cards.
  `:136` `clustered_wilson_ci` is the Wilson interval at that n. It equals `wilson_ci` when each
  card is reviewed once, and equals the distinct-card interval when every card gets the same
  verdict in each repetition. Cards are the record `id`, which is the same in every repetition
  (`:98` `card_key`, `:104` `clusters`). Every interval uses it: `recallCi95` per class and per
  tier (`:186` `_recall_block`), and overall `recallCi95` and `controlFalsePositiveRateCi95`
  (`score`). Point estimates still pool every repetition.
- The class minimum counts distinct cards. `MIN_CLASS_ITEMS = 30` (pooled items) became
  `MIN_CLASS_CARDS = 15` (`:37`), and the gate check uses the per-class card count
  (`:430`). One repetition is still refused by `MIN_GATE_REPS`.
- The report states the unit of analysis: `unitOfAnalysis` (`:52` `UNIT_OF_ANALYSIS`, plus card
  counts from `score`) and a "Unit of analysis" line in the Markdown
  (`evals/src/dc_evals/report.py:166` `_unit_line`). `gate.thresholds.minClassCards` is at
  `report.py:99`.
- Effect on the committed seeded-v3 proxy run (the report files are unchanged, and re-scoring
  gives these values): recall stays 0.9558. Its interval widens from the pooled one to one
  over 113 cards, because 4 of the 6 cards with a miss missed in both repetitions. The gate now
  needs recall ≥ 0.8319 when both repetitions miss the same cards. When they miss different
  cards it needs 0.8097, as before. README "Gate" has both values.
- Tests: `test_intervals_cluster_the_repetitions_of_a_card`,
  `test_effective_n_stays_between_the_cards_and_the_pooled_items`,
  `test_the_class_minimum_counts_distinct_cards`, `test_the_report_states_its_unit_of_analysis`,
  `test_the_committed_seeded_v3_proxy_run_scores_on_cards` (`evals/tests/test_score.py`).
- Existing assertions this finding makes wrong, updated:
  - `test_gate_checks_recall_and_its_lower_bound_on_a_complete_run`,
    `test_gate_bounds_the_control_false_positive_rate_independently_of_prevalence`,
    `test_gate_requires_every_class_to_reach_the_recall_floor_on_pooled_counts` and
    `test_score_gate_exit_codes` pinned pooled-item bounds on fixtures that miss or flag the
    same cards in both repetitions. They now build fixtures that miss different cards in each
    repetition (`gate_records(independent=True)`, `evals/tests/conftest.py`), so the numbers they
    pin are unchanged. The correlated case is pinned by the new tests.
  - `test_gate_requires_repetitions_and_a_minimum_class_sample` asserted that one repetition of
    a 15-row class fails a 30-pooled-item minimum. It now asserts that the repetition condition
    alone refuses such a run.
  - `test_gate_thresholds_live_in_one_place` now checks `MIN_CLASS_CARDS == 15`.
  - `test_report_json_matches_contract_schema` now includes the new top-level keys.

### ai-agent-27

Status: partially fixed

- Label provenance is recorded per judgment-class row. New module
  `evals/src/dc_evals/labels.py`:
  - `:72` `row_evidence` classifies every `ambiguous_stem` / `qualifier_mismatch` row as
    `self-evidenced` or `why-neutral`. A row is `self-evidenced` when its
    `rationale.evidence.text` is still in the field it quotes (the viable option's why, or the
    explanation), and `why-neutral` otherwise.
  - `:119` `labels_for` returns, for every judgment-class row (including `multiple_correct`),
    its class, its evidence and its human verdict, together with the label source.
- The committed labels are recorded as model-assisted, and every current row is recorded as
  self-evidenced. `evals/data/adjudications-v3.json` holds the dataset name and sha256,
  `labelSource: "model-assisted"`, a note on how the constructions were made, and an empty
  `verdicts` list.
- A human-adjudication file format with scorer support:
  - The format is documented in the `labels.py` docstring.
  - `:83` `load_adjudications` validates the file. It rejects an adjudication file for another
    dataset sha256, a row that is not a judgment-class row, an unknown verdict, the same row
    twice, and a verdict without an adjudicator or date.
  - `score()` (`evals/src/dc_evals/score.py:258`) drops a row judged `invalid` from every recall
    figure and from its class's card count, and lists it in `labels.excludedRows`.
  - The `labels` block (`:213` `_labels_block`) gives, per class, the rows, the self-evidenced
    and why-neutral counts, the human valid, invalid and unadjudicated counts, and recall per
    evidence tier.
  - The Markdown gains a "Label provenance" section (`report.py:176` `_labels_lines`).
  - `dc-evals score --adjudications <file>` scores with a draft file
    (`evals/src/dc_evals/cli.py`).
- The why-neutral tier is reported separately (`labels.perEvidence`) and, when a dataset has
  such rows, must reach the per-class floor on its own (`score.py:437`).
- `evals/README.md` states the limitation. The current rows are self-evidenced and their labels
  are model-assisted. It names s-0147 as debatable, and says "no surface cues" covers only the
  features that `tests/cues.py` measures. A new section, "Label provenance of the judgment
  classes", covers the adjudication workflow (at least 5 per class, stratified by deck and
  outcome).
- Not done, and why this is "partially fixed":
  - The human adjudication itself is not done, because an agent cannot supply an independent
    human verdict. The owner records it in `data/adjudications-v3.json`.
  - No why-neutral rows were built. They need new hand-reviewed constructions, which means a new
    dataset version. Editing seeded-v3 would break the dataset sha256 that the committed reports
    are bound to.
  - The brief's direction for this finding asks only for provenance, the adjudication format,
    scorer support and the README. All four are done.
- Tests (`evals/tests/test_labels.py`):
  - `test_every_committed_ambiguous_stem_and_qualifier_mismatch_row_is_self_evidenced`
  - `test_a_row_whose_card_text_no_longer_states_the_evidence_is_why_neutral`
  - `test_the_report_records_label_provenance_per_judgment_class`
  - `test_a_human_invalid_verdict_drops_the_row_from_scoring`
  - `test_the_why_neutral_tier_is_under_the_class_floor`
  - `test_an_adjudication_file_is_validated` (5 cases)
  - `test_a_verdict_on_a_row_outside_the_judgment_classes_is_refused`
  - `test_the_committed_adjudication_file_matches_the_dataset`
  - `test_score_cli_takes_an_adjudication_file`

### ai-agent-30

Status: fixed

- `evals/src/dc_evals/claude_cli.py` `ClaudeCliClient.create` now handles `max_tokens` and the
  stop reason:
  - It takes `max_tokens` and passes it to the CLI as `CLAUDE_CODE_MAX_OUTPUT_TOKENS`
    (`:140`, `ClaudeCliClient.env`).
  - It maps a CLI result whose `stop_reason` is `max_tokens` or `refusal` to that stop reason
    (`:171`). `refusal` carries `stop_details` when the CLI gives them, so `ai_qa.review` records
    `MAX_TOKENS` or `REFUSAL` exactly as on Bedrock. A result without a stop reason still reads
    as `end_turn`.
- A CLI error result raises `ClaudeCliError` with `error_code` `CLI_<SUBTYPE>`
  (`:51`, for example `CLI_ERROR_MAX_TURNS`). The runner records that code instead of
  `UNEXPECTED` (`evals/src/dc_evals/runner.py:99`).
- What the proxy cannot observe is stated in three places:
  - The fidelity notes in the module docstring (`:9-22`) list the max_tokens and thinking gap,
    the stop-reason dependency and the error codes.
  - A claude-cli report carries `proxyFidelity` (`claude_cli.py:38` `PROXY_UNOBSERVABLE`,
    `report.py:150`).
  - Its Markdown has a "Proxy fidelity" line (`report.py:229`). It says MAX_TOKENS and REFUSAL
    are unobservable unless the CLI reports the stop reason, that the run file does not record
    whether it did, and that both rates are checked on the Bedrock gate run.
- `evals/README.md` (the `--provider claude-cli` paragraph and the rollout status paragraph)
  names the Bedrock gate run as the place where the MAX_TOKENS and REFUSAL rates are checked.
- Tests:
  - `evals/tests/test_claude_cli.py`:
    - `test_claude_cli_maps_a_reported_max_tokens_stop_to_the_production_error`
    - `test_claude_cli_maps_a_reported_refusal_to_the_production_outcome`
    - `test_claude_cli_without_a_stop_reason_is_end_turn`
    - `test_claude_cli_error_subtype_becomes_a_distinct_error_code`
  - `evals/tests/test_report.py`: `test_a_proxy_report_states_what_the_transport_cannot_observe`
- Deviation: the finding asks for the status note in the tuning README
  (`evals/reports/tuning-2026-09-27/README.md`). This brief requires every committed file under
  `evals/reports/` to stay byte-identical, so the note is in `evals/README.md` (rollout
  paragraph) instead.
