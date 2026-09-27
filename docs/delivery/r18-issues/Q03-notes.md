# Q03 — evals: agent-authored dataset, automated model jury, reviewer-configuration comparison (#401)

Nothing here was run for real: no `dc-evals author|jury|run` call, no model, no AWS. The tests use
fake clients, a fake ingest function and hand-built run files. `data/authored-v1.jsonl` and the
labels files do not exist yet; the owner creates them with the runbook below. Every file under
`evals/reports/` is unchanged.

## Commands (from `evals/`)

| Command | What it does | Default |
|---|---|---|
| `dc-evals author [--model M] [--sources P] [--output P] [--limit N]` | `dc-ingest --json` per source (via `uv run --project ../tools/ingest`), up to 4 chunks, one local `claude -p` request per source for up to 4 DraftCards; quote must be verbatim in one chunk; rejected cards retried once, then dropped | model `claude-opus-5-5`; sources `data/authored-sources-v1.json`; output `data/authored-v1.jsonl` |
| `dc-evals jury [--jurors provider:model,...] [--input P] [--output P] [--limit N]` | every juror votes on every authored row; label by the rule below; stores every vote | jurors `bedrock-converse:qwen.qwen3-235b-a22b-2507-v1:0,bedrock-converse:deepseek.v3.2,bedrock-converse:global.moonshotai.kimi-k3`; output `data/authored-v1.labels.jsonl` + `data/authored-v1.labels.summary.json` |
| `dc-evals run ... --provider bedrock-converse` | a non-Anthropic Bedrock model as the reviewer (ai-qa Q01 Converse client) | — |
| `dc-evals run ... --second-provider P --second-model M [--second-scope S]` | sets `AI_QA_SECOND_PROVIDER` / `AI_QA_SECOND_MODEL` / `AI_QA_SECOND_SCOPE` for the in-process review; merge = ai-qa `second_opinion.apply` | off (the key is forced empty when the flag is absent) |
| `dc-evals run ... --dataset authored-v1` | reviews the scorable jury-labeled rows | dataset default stays `v3` |
| `dc-evals compare RUN... --name N [--date D] [--out DIR] [--labels-summary P]` | `reports/<date>-compare-<name>.{json,md}` | out `reports/`, date = UTC today |

Juror providers: `claude-cli`, `bedrock-converse`, `bedrock`, `anthropic`. Second-reviewer
providers: `bedrock-converse`, `bedrock`, `anthropic` (ai-qa's list).

## Label rule (exact; `evals/src/dc_evals/jury.py` `label_votes`)

Each vote is `{juror, verdict, category, basis, reason, error}`; `verdict` ∈ `correct`,
`defective`, `unsure`; a failed call (`error` = the exception's `error_code` or class name) or an
unparseable reply (`error` = `INVALID_REPLY`) is an `unsure` vote.

1. Decisive votes are `correct` and `defective`; `unsure` votes do not count.
2. No decisive vote → excluded, `excluded: "all_unsure"`. `#correct == #defective` → excluded,
   `excluded: "tie"`. Otherwise `label` = the verdict with more votes.
3. `defective` label → `category` = the category named by the most `defective` votes (null
   categories ignored); a tie between categories → the one listed first in
   `ai_qa.schema.CATEGORIES`; no named category → null.
4. `unanimous` = every juror's verdict equals the label (any dissent or `unsure` → false).
5. `run`/`score` dataset: `correct` → control (`defect: null`); `defective` with a category in
   `dataset.DEFECT_CLASSES` (the seven blocker/major classes) → `defect` = that category; any
   other `defective` (`weak_distractor`, `other`, null) → `scorable: false`, left out like
   excluded rows.

Summary (`*.labels.summary.json`): `rows`, `labeled`, `excluded.{tie,all_unsure}`,
`labels.{correct,defective}`, `defectiveCategories`, `scorable`, `notScorable`, `unanimous`,
`unanimityRate` (= unanimous / labeled), `knowledgeBasisVotes`, and per juror `votes`, `unsure`,
`errors`, `knowledgeBasis`, `agreementWithMajority` (= votes equal to the label / the juror's
votes on labeled rows; `unsure` counts as disagreement).

## Where

| File | What |
|---|---|
| `evals/data/authored-sources-v1.json` | 16 sources: 8 `docs.aws.amazon.com` pages, 8 `platform.claude.com/docs` pages, each `{url, deckSlug, topicHint}` with a FORMAT.md §5 TOPIC label |
| `evals/src/dc_evals/author.py` | `skill_rules` / `build_system_prompt` (rules read from `.claude/skills/author-cards/` and `content/decks/FORMAT.md` at build time), `ingest`, `pick_chunks`, `check_card` / `quote_in_chunk`, `author_source` (one retry), `build_rows`, `author` |
| `evals/src/dc_evals/jury.py` | `parse_jurors`, `build_system_prompt` (checklist.md "## Content" inlined), `parse_vote`, `ask_juror`, `label_votes`, `summarize`, `dataset_rows`, `make_juror_client`, `jury` |
| `evals/src/dc_evals/compare.py` | `vendor_of`, `compare_row`, `build_compare`, `render_markdown`, `compare` |
| `evals/src/dc_evals/dataset.py` | `DatasetSpec.labels_path`, `AUTHORED` (`authored-v1`), `RUN_DATASETS`, `load_rows`, `spec_sha256` (authored bytes + labels bytes) |
| `evals/src/dc_evals/runner.py` | `_second_review`; `run_eval(..., second_client=)`; item `secondOpinion: {added, errorCode}` when on |
| `evals/src/dc_evals/report.py` | header + report `secondProvider`, `secondModel`; Markdown "Reviewers" line; `expected_run` via `load_rows`/`spec_sha256` |
| `evals/src/dc_evals/score.py` | `shipping_config` adds `secondProvider`/`secondModel` (null in prod); the gate refuses a run whose second reviewer differs |
| `evals/src/dc_evals/cli.py` | `run` flags, `second_reviewer_env`, `author`, `jury`, `compare` subcommands |
| `evals/tests/test_author.py`, `test_jury.py`, `test_compare.py`, `test_cli.py` (4 new tests), `test_report.py` / `test_score.py` (key lists extended) | fakes only |

## Runbook (owner only)

`author` → `jury` → `run` (Opus 5 alone, a Converse model alone, Opus 5 + that Converse model as
second opinion) × (`v3`, `authored-v1`) → `compare`. Full commands in `evals/README.md`. Pick the
Converse reviewer from a vendor not on the jury; `compare` warns otherwise. Third-party Bedrock
models need the owner's one-time Marketplace terms acceptance and Bedrock allowlisting first.

## Decisions not spelled out in the brief

- `unsure` is a valid juror verdict (the brief's "all-unsure rows"); invalid replies and failed
  calls count as `unsure`.
- Minor-category or uncategorized `defective` labels are kept in the labels file but not scored
  (the gate measures blocker/major recall only).
- A second reviewer changes the configuration, so `shipping_config` and the gate compare
  `secondProvider`/`secondModel` too (prod: off).
- `compare`'s cost per card = the run's estimated cost / its items; an unset second-reviewer
  price is estimated at 0 (ai-qa behaviour), so set `AI_QA_SECOND_PRICE_*` for real numbers.
