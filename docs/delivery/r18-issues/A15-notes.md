# A15 notes — `authored-v2` and `dc-evals automation-gate`

Contract: A00 §15 (whole), §3.2, §18. Code: `evals/src/dc_evals/automation_gate.py`,
`evals/src/dc_evals/dataset.py` (`AUTHORED_V2`), `evals/src/dc_evals/cli.py`, `evals/src/dc_evals/jury.py`;
data `evals/data/authored-sources-v2.json`; tests `evals/tests/test_automation_gate.py`,
`evals/tests/test_authored_sources_v2.py`; docs `evals/README.md` "Automation gate (R18A)".

## Decisions added to A00 §15

- **Inputs are run files.** A00 §15.4 step 2 writes `--seeded <run.json> --authored <run.json>`; the
  gate takes the `.jsonl` run files `dc-evals run` writes (a `type: run` header, then `type: item`
  lines), because the item records are what it scores. A missing file, or a file without a run
  header (for example the derived `.json` report), is exit 2 with `dc-evals: <message>` and nothing
  is written. `report` / `reportSha256` in the gate report name and hash those run files.
- **Seeded scoring.** The seeded block is `score.score` over the seeded run's items with the dataset's
  classes and the committed adjudication labels (`labels.labels_for`), which is exactly what
  `report.build_report` computes; the gate calls `score` directly because `build_report` also loads
  the rollout shipping configuration through `ai_qa.settings.load_settings`, which the gate must not do.
- **Automation keys read directly.** `AI_QA_AUTOMATION_PROVIDER`, `AI_QA_AUTOMATION_MODEL`,
  `AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK`, `AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK` are read from the
  env JSON with `json.loads`. An unreadable or missing file reads as empty (every key "is not set").
  A run's provider/model is compared with a key only when that key is set (a missing key is already
  one failure).
- **Extra checks.** Beyond A00 §15.3: (1) an authored run with no defective-labelled item fails
  ("the defect escape rate is undefined"), since precision alone cannot show that defects are caught;
  (2) jury independence: every juror in `data/authored-v2.labels.summary.json` whose
  `compare.vendor_of` equals the reviewer model's vendor is a failure, and a missing summary is a
  failure; (3) both runs must have the same reviewer (provider, model, prompt version, second reviewer);
  (4) a seeded class with no rows is a failure.
- **Nothing short-circuits.** Every check appends its failure; a truncated or misconfigured run still
  gets its metrics in the report. The truncation check is skipped only when the authored dataset files
  are missing (that is its own failure).
- **Failure texts** are the f-strings of the A15 brief, verbatim (`which` = `seeded` / `authored`, the
  env path relative to the repository root when inside it, dataset file paths relative to `evals/`).
- **`author` / `jury --dataset {authored-v1,authored-v2}`** (default `authored-v1`) only chooses the
  default paths (`author`: `--sources`, `--output`; `jury`: `--input`, `--output`); explicit flags win.
  `jury()` and `summarize()` take `dataset` (default `authored-v1`) so the summary names the labelled set.
- **`--ai-qa-env PATH`** is a hidden `automation-gate` flag (default `services/ai-qa/env/prod.env.json`)
  so tests use their own env files; the real file is never asserted on.
- **Sources.** Every url of `authored-sources-v2.json` is a `url` of `data/sources-<deck>.jsonl`. The
  16 v1 urls are the first 8 of each deck; every `topicHint` is the `topic` of a card citing that url
  (the v1 hint when a citing card carries it, else the most common one), and the other 44 urls were
  picked round-robin over the deck's labels (17 AWS labels, 7 Claude labels: no committed card cites a
  `platform.claude.com/docs` page under `D3 Claude Code`).

## Contract-only here

- The four `AI_QA_AUTOMATION_*` keys come from A07 (provider, model) and the owner (prices). On this
  branch `services/ai-qa/env/prod.env.json` has none of them, so any real gate run fails its
  configuration check until they land.
- The server record route `POST /api/v1/admin/automation/eval-gate` and its recomputation are A06.
- `data/authored-v2.jsonl`, `data/authored-v2.labels.jsonl` and `data/authored-v2.labels.summary.json`
  come from the owner's paid `author` / `jury` runs; no worker creates them.
