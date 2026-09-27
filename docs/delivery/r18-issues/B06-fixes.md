# B06 — evals gate fixes (R18B fix round 1, wave T)

Scope: `evals/` and this file. Nothing here calls a model: `dc-evals run|author|jury` were not run,
and every new test uses fake clients, a fake ingest function and files in `tmp_path`. No file under
`evals/reports/` changed, and `uv lock --check` passes (no dependency added).

### ai-agent-5

Status: fixed (evals side; the prompt itself is ai-qa's side of contract K1)

What changed:

- (a) Automation profile. `evals/src/dc_evals/runner.py:21-29` defines the profiles and
  `AUTOMATION_PROMPT_VERSION = "qa-v4-auto"`; `runner.py:66` `profile_prompt` reads ai_qa
  `PROMPT_VERSION_AUTOMATION` / `SYSTEM_PROMPT_AUTOMATION` and refuses to run when they are missing or
  of another version (never falls back to qa-v4); `runner.py:87` `SystemPromptClient` swaps the system
  block of every review request (review_card always builds it with `SYSTEM_PROMPT`) and refuses a
  request carrying any other prompt. `cli.py:84` adds `run --profile default|automation`; the automation
  profile refuses a second reviewer, wraps the client (`cli.py:271`), records `promptVersion`
  `qa-v4-auto` and `"profile": "automation"` in the header (`cli.py:312`; a default header is unchanged)
  and in the file stem. The gate (`automation_gate.py:364-383`) now requires both runs to be of profile
  `automation` with `promptVersion` `qa-v4-auto` (and ai_qa's installed `PROMPT_VERSION_AUTOMATION`, when
  present, to equal it), and the report's `reviewer` records the triple plus `profile`
  (`automation_gate.py:99`).
- (b) New-facts stratum authored the production way. `evals/data/authored-sources-v2-new-facts.json`:
  18 official pages (10 AWS What's New posts for `aws-saa-c03`; the Claude Developer Platform release
  notes, the Opus 5.5 / Fable 5.1 "what's new" pages, feature pages the release notes link and the Opus
  5.5 announcement for `claude-ccdv-f`), none of them in `authored-sources-v2.json`, each with a FORMAT.md
  §5 TOPIC label and the feed title. `evals/src/dc_evals/drafts_import.py` (`dc-evals import-drafts`,
  `cli.py:123`) turns the drafts the author-runner wrote on a sandbox deck (the runner's queue-item
  prompt, CLAUDE args, MCP tools, skill and verifier; saved `GET /api/v1/authoring/drafts/:draftId`
  responses) into `n-NNNN` rows with `"stratum": "new-facts"`, `"authorPath": "author-runner"`, `runId`,
  `skillVersion`, `queueItemId` and `draftId`, attaching the dc-ingest chunk that holds each quote for the
  jury; drafts without `agent.runId`, with an unmapped deck or with a quote in no chunk are left out and
  reported (exit 1). `dataset.py:86-89` / `dataset.py:135` define the strata (a row without `stratum` is
  a docs row) and `jury.py:291` carries the stratum into the rows `run` reviews.
- (c) Per-stratum precision. `automation_gate.py:206` `strata_metrics` reports every authored metric per
  stratum (`authored.strata`); `automation_gate.py:425` `_new_facts_failures` fails closed when the
  stratum is absent, when a new-facts row is not from the runner, when it has fewer than
  `MIN_NEW_FACTS_WOULD_ACCEPT_CARDS = 30` distinct would-accept cards (`automation_gate.py:79`, the
  documented minimum sample), or when its own precision is below 0.97 (`automation_gate.py:78`). The
  Markdown report shows a per-stratum table and says which stratum is the production path.
- (d) Wording. `evals/README.md` no longer says the single-shot `author` is "the production skill": the
  docs stratum is described as the single-shot, tool-less author (not the production path) and the
  new-facts stratum and its runbook (sandbox deck, `AUTOMATION_MODE=off`, admin queue, `author-runner
  once`, `import-drafts`) are documented. The contract text (A00 §15.2) lives outside the repo and outside
  this issue's allowed paths, so it was not edited; the README is now the accurate description.

Tests (`evals/tests/test_b06_gate_fixes.py`): `test_gate_refuses_default_profile_runs`,
`test_gate_report_records_the_reviewer_triple_and_profile`,
`test_gate_refuses_an_installed_automation_prompt_of_another_version`,
`test_profile_prompt_never_falls_back_to_the_default_prompt`,
`test_automation_profile_reviews_with_the_automation_prompt`, `test_cli_run_with_the_automation_profile`,
`test_cli_run_automation_profile_needs_the_ai_qa_prompt`, `test_report_has_per_stratum_precision`,
`test_gate_fails_closed_without_a_new_facts_stratum`, `test_gate_fails_closed_below_the_new_facts_minimum_sample`,
`test_new_facts_stratum_must_meet_the_precision_gate_on_its_own`, `test_new_facts_rows_must_come_from_the_runner`,
`test_dataset_rows_carry_the_stratum`, `test_new_facts_sources_are_official_announcements`,
`test_import_drafts_builds_new_facts_rows`, `test_import_drafts_rows_join_the_jury_and_the_run`,
`test_cli_import_drafts_arguments`.

Existing assertions updated because the finding makes the old behaviour wrong
(`evals/tests/test_automation_gate.py`): the fixture runs are now automation-profile runs (`AUTOMATION`
overrides in `seeded_run` / `authored_run` and the "missing" case); `authored_spec` marks the last 40
control cards as runner-authored new-facts rows (carved out of existing rows, so every numeric
expectation is unchanged); the "prompt" case now expects qa-v4 to be refused in favour of qa-v4-auto; the
"missing" case also expects the new-facts failure; the contract-keys test expects the appended keys
(`reviewer.profile`, three thresholds, `authored.juryExcluded` / `conservativeAutoAcceptPrecision` /
`strata` / `ownerSample`) after the unchanged A00 §15.4 keys; the Markdown title expects `qa-v4-auto`.

### ai-agent-4

Status: fixed

What changed:

- Exclusions reported. `automation_gate.py:190` `exclusion_metrics` reads the labels file and reports
  `labelRows`, `tie`, `allUnsure`, `excludedRows`, `excludedRate` and `notScorable`, in
  `authored.juryExcluded` and per stratum in `authored.strata.<stratum>.juryExcluded`.
- Fail closed above a documented share. `JURY_EXCLUDED_RATE_GATE = 0.10` (`automation_gate.py:82`,
  threshold `juryExcludedRate`); `_excluded_failures` (`automation_gate.py:453`) fails the gate when the
  share is above it overall or in any stratum.
- Conservative precision. `automation_gate.py:184` `conservative_precision` = `wouldAcceptCorrect /
  (wouldAccept + excludedRows x reps)` (every excluded row counted as accepted and wrong in every rep),
  overall and per stratum, for information.
- Optional owner-adjudicated sample. `data/adjudications-authored-v2.json` (next to the dataset;
  `automation_gate.py:253`) in the existing adjudication file format, where for authored-v2 `valid` = the
  card is correct and `invalid` = defective. `owner_sample` (`automation_gate.py:257`) scores it on its
  own (`ownerAutoAcceptPrecision`, `juryOwnerAgreement`, counts per stratum and of jury-excluded cards)
  into `authored.ownerSample`, shown next to the jury result in the Markdown; an invalid file fails the
  gate, a valid one never decides it.
- Plain provenance. `JURY_LABEL_NOTE` (`automation_gate.py:116`) now says the labels are model-generated
  by default by the owner's decision (fully automated) and points to the optional owner sample; the
  README says the same.

Tests (`evals/tests/test_b06_gate_fixes.py`): `test_report_counts_the_rows_the_jury_excluded`,
`test_gate_fails_closed_when_the_jury_excluded_too_many_rows`,
`test_owner_sample_is_scored_next_to_the_jury_result`, `test_an_invalid_owner_sample_fails_the_gate`.

## Contract

- K1 (evals side): `dc-evals run --profile automation` reviews with ai_qa `SYSTEM_PROMPT_AUTOMATION`
  under `PROMPT_VERSION_AUTOMATION` = `qa-v4-auto` and records it; `automation-gate` accepts only runs of
  that profile and version, so the recorded reviewer triple is (`bedrock-converse`,
  `global.openai.gpt-5.5`, `qa-v4-auto`). The ai-qa constants land in a parallel wave; until they do,
  `run --profile automation` exits 2 with a clear message instead of reviewing with qa-v4, and the tests
  install the constants with `monkeypatch`. The report keeps every A00 §15.4 key in place (core's
  `EvalGate.Read` reads only those) and appends the new ones.
- K2–K7: not touched (no evals surface).

## Deviations

- The new-facts pages are queued through the admin route, which creates `manual` queue items (A00 §8.6);
  the runner has no owner-facing way to create a `feed_item`. Everything else the runner does (prompt,
  CLAUDE args, tools, skill, verifier) is the production path.
- Core recomputes only the A00 §15.4 checks; the new-facts, exclusion and owner-sample checks are
  enforced in the evals report (`passed`/`failures`, which core requires to be true/empty).
