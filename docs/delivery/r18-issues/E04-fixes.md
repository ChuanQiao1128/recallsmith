# E04 — Evals round 4 (R18E, wave T)

Issue #488. Scope: `evals/` and this ledger. Each fix has a test in `evals/tests/test_e04_fixes.py`.
On the base `delivery/r18e-t` (0cba6f6), 17 of its 25 tests fail with the base `runner.py` and
`automation_gate.py`. The 8 that pass there pin behaviour that must not change: the gate passing a
matching run, and `model_matches` still matching, or still refusing, the existing forms. Nothing
calls a model. `dc-evals run|author|jury` was not run. No file under `evals/reports/` changed, and
`uv lock --check` is green.

## Findings

### ai-agent-19
Status: fixed (evals side; the adapter already reports the served model, D03)

- `evals/src/dc_evals/runner.py:31-56`: `_DATED_SNAPSHOT` now accepts OpenAI's `-YYYY-MM-DD` suffix
  as well as Anthropic's `-YYYYMMDD`. `_bare_model` strips the `openai.` namespace, along with any
  region prefix before it, in the same way it already stripped `anthropic.`. So
  `openai.gpt-5.5-2026-08-07`, the id the openai-mantle adapter reports for a dated snapshot, matches
  the requested `openai.gpt-5.5` or `global.openai.gpt-5.5`. `openai.gpt-5.5-mini`, `openai.gpt-5.4-…`
  and a malformed date still do not match. Such a reply is still recorded as `MODEL_MISMATCH`.
- `evals/src/dc_evals/automation_gate.py:499` `_served_model_failures`, called for both runs at
  `:758-759`, checks every scored item (`score.is_scored`) of an `openai-mantle` run:
  - An item without a `servedModel` fails closed with `<run> run: N scored items carry no verified
    served model id`. This mirrors `score.py:451-453` for the human gate.
  - A `servedModel` that `model_matches` refuses against the header's model fails with
    `<run> run: scored items were served by <ids>, not the gated model '<model>'`.
  - Nothing is checked on `bedrock-converse`, because Converse replies carry no model id
    (`services/ai-qa/src/ai_qa/converse_client.py:79-81`). Requiring one there would block the
    fallback provider permanently.
  - The report still records the ids in `reviewer.servedModels`.
- `evals/README.md`: the dated-snapshot rule is added to the run section, and a `served model` row
  is added to the automation-gate check table.
- Tests (`evals/tests/test_e04_fixes.py`):
  - `test_model_matches_knows_openai_dated_snapshots`
  - `test_a_dated_openai_reply_is_not_a_model_mismatch`: a fake reply model of
    `openai.gpt-5.5-2026-08-07`.
  - `test_gate_passes_an_openai_mantle_run_served_by_a_dated_snapshot`
  - `test_gate_fails_an_openai_mantle_run_without_a_served_model`: no model on the reply.
  - `test_gate_fails_an_openai_mantle_run_served_by_another_model`
  - `test_gate_counts_only_scored_items_without_a_served_model`
- Existing assertions updated, because the finding makes their old fixture wrong. The two
  openai-mantle gate tests below used records whose `servedModel` was `anthropic.claude-opus-5`,
  the conftest default, under a gated model of `openai.gpt-5.5`. That is exactly the rerouted run
  the gate must now refuse. Their records now carry `openai.gpt-5.5`, through the new helper
  `mantle_served`. Nothing else in these tests changed.
  - `evals/tests/test_c06_fixes.py::test_gate_passes_for_an_openai_mantle_reviewer_and_pins_it`
  - `evals/tests/test_d06_fixes.py::test_gate_compares_the_run_effort_with_production`: its Markdown
    assertion now expects `served by openai.gpt-5.5`.

### ai-agent-25
Status: fixed

- `evals/src/dc_evals/automation_gate.py:541` `author_vendors`: the vendors of the authored-v2 authors.
  - `anthropic` is always included, because both authoring paths are Claude: `dc-evals author` for
    the docs stratum and the author-runner's claude CLI for the new-facts stratum.
  - The vendor of every recorded `authorModel` (docs rows) and `authorConfig.model` (new-facts rows)
    is added.
- `automation_gate.py:558` `juror_vendor`: a `claude-cli` or `anthropic` juror is `anthropic`,
  whatever its model string says. Any other juror is `vendor_of(model)`, so `bedrock:us.anthropic.…`
  also resolves to `anthropic`.
- `automation_gate.py:566` `_jury_failures`: `evaluate_gate` now passes it the author vendors.
  - It fails any juror whose vendor is an author vendor, with `juror <j> shares the author's vendor
    <v>; the authored labels are not independent`. The existing reviewer-vendor check and its
    message are unchanged.
  - It fails a summary whose `jurors` list is empty or missing, with `... names no jurors; the
    labels' independence cannot be checked`, instead of passing it vacuously.
- `evals/README.md`: the jury default note and the automation-gate `jury` row state that jurors must
  come from neither the reviewer's vendor nor the author's, so there is no Anthropic juror for
  authored-v2.
- Tests (`evals/tests/test_e04_fixes.py`):
  - `test_gate_fails_a_juror_from_the_author_vendor`: claude-cli, anthropic, bedrock and region-prefixed
    Anthropic jurors.
  - `test_gate_fails_a_juror_from_a_recorded_author_model_vendor`
  - `test_gate_fails_a_jury_summary_without_jurors`: an empty list and a missing key.
  - `test_default_jurors_are_independent_of_reviewer_and_author`

## Contract

No N-item (N1-N6) touches the evals root: they are core, console, runner and email changes. E04 only
implements the evals side of the two findings above. The gate report keeps its shape: no key was
added or renamed, `reviewer.servedModels` still carries the served ids, and `authored.author.authorConfigId`
(M1/N1) is unchanged. K1-K7, L1-L6 and M1-M6 hold as before.
