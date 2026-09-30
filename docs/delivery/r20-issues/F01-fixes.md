# F01 — R20 review fixes: evals/tools (V01-V04)

Issue #582, fix round R20X, wave e. Each finding was checked against the code before any change.
No paid model call was made: the tests fake the CLI and the embedder, and the only model run was
the local open-source `BAAI/bge-small-en-v1.5` through fastembed for the V02 retrieval run.

### e-correctness-1

Status: fixed

- Confirmed: `ClaudeCliClient.env` built the child environment with `dict(os.environ)`, so an
  exported `ANTHROPIC_API_KEY` reached `claude -p`, which then bills the API key instead of the
  subscription login. `make_review_client` (`dc-evals review`) uses that client unchanged.
- Fix (root cause, contract §10.7): `evals/src/dc_evals/claude_cli.py` gains `PAID_API_ENV`
  (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`,
  `CLAUDE_CODE_USE_VERTEX`); `ClaudeCliClient.env` drops them from every `claude -p` child, so it
  covers `dc-evals review` and `dc-evals run --provider claude-cli` alike (the supervisor item).
  The module docstring, `evals/README.md` (review section) and the V01 notes say so.
- Tests (both fail on the base, pass now), `evals/tests/test_claude_cli.py`:
  `test_claude_cli_child_env_drops_paid_api_credentials` (ClaudeCliClient level: all five names
  set in the parent, none in the runner's `env`; other variables and
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS` kept) and `test_dc_evals_review_client_is_the_scrubbed_cli`
  (the client `make_review_client` builds sends no `ANTHROPIC_API_KEY`).

### e-security-1

Status: fixed

- Same root cause as e-correctness-1 (the `run_review` settings env is only read by
  `load_settings`; the key reached the CLI through `ClaudeCliClient.env`). Fixed by the same
  change and proved by the same two tests.
- `max_cost_usd=float("inf")` is kept: with the paid credentials removed the child can only use
  the subscription login, where there is no per-call spend to cap, and `--limit` (default cap)
  still bounds the card count. The README claim "spends no API money" is now true in code.

### e-tests-1

Status: fixed

- Confirmed: `docs/delivery/r20-issues/V02-notes.md` held `RUN_RESULTS_PLACEHOLDER` and no
  `evals/reports/*-retrieval.*` file existed.
- Done (with the supervisor item): `dc-evals fetch-sources` (cache `~/.cache/developercards/sources`;
  611 distinct pages, 602 cached, 9 failed after `--retry-failed`, each recorded with its reason),
  `uv sync --extra embeddings` in this worktree's venv only, then `dc-evals retrieval --date
  2026-10-01` with bm25, embed and hybrid. Committed `evals/reports/2026-10-01-retrieval.json` and
  `.md` (metrics, config, counts, failure reasons; no page text). The placeholder in the V02 notes
  is replaced by the measured table and the failed pages.
- Proof: `F01.verify.sh` checks that a retrieval report is committed and that the placeholder is
  gone; the report's own shape is covered by the existing `evals/tests/test_retrieval.py`.

### e-correctness-2

Status: fixed

- Same finding as e-tests-1 (the placeholder and the missing report file); fixed by the same run
  and commit.

### e-tests-2

Status: fixed

- Confirmed by joining the committed `evals/reports/semantic-dupes/2026-09-30-*.json` pairs with
  the `mcq` field of `evals/data/cards-<slug>.jsonl`: of the 63 pairs at or above 0.90, 40 are
  concept + MCQ, 9 are MCQ + MCQ and 14 are concept + concept (1 in aws-saa-c03, 13 in
  claude-ccdv-f), exactly as the reviewer said.
- Changed `docs/delivery/r20-issues/V04-notes.md`: the false "every pair is a concept card and an
  MCQ card" bullet is replaced by the per-deck pair mix; the threshold argument now rests on the
  real mix (0.90 is where the concept-card duplicates first appear, lowest 0.903); a new section
  "Owner review: likely duplicates" lists all 14 concept + concept pairs (the sampling-params,
  model-lifecycle and instruction-placement pairs first) and points at the MCQ + MCQ pairs.
- Test: docs-only finding (no code changed). The counts are reproducible from the two committed
  files with the join described above.

### e-tests-3

Status: fixed

- Confirmed: no test or CI step ran `evals/scripts/parse-deck.mts` or `export-cards.mts --check`;
  the Python tests replace the parser.
- Added `frontend/tests/evalsParseDeck.test.ts` (runs in the existing CI frontend job,
  `npx vitest run`). It starts the real scripts as child processes and checks: the twelve export
  keys in order and the field values for a two-card fixture deck; stdin `-` gives the same output
  as the file; a headerless deck exits 1 with `<file>:1: MISSING_DECK_HEADER` (file and stdin);
  usage errors exit 2; `export-cards.mts --check` exits 0 with no stderr. CI's frontend job runs
  Node 20, which cannot strip types, so on a Node without `process.features.typescript` the child
  gets a module hook that strips types with esbuild (a frontend dependency) and changes nothing
  else. Checked under Node 24 (native) and Node 20.20 (hook).
- Proof it catches drift: renaming `realWorldUsage` in `deck-lib.mts` `exportCard` makes two of
  its five tests fail (the key-order test and `export-cards --check`); reverted.
- `.github/workflows/ci.yml` is outside this issue's scope, so no separate CI step was added; the
  vitest file is the CI check.

### e-tests-4

Status: fixed

- Confirmed: `test_confidence_thresholds` only compared `confidence_for` with the module's own
  constants.
- Added `test_confidence_thresholds_are_the_documented_values` in
  `evals/tests/test_backfill.py`: `(HIGH_SCORE, MEDIUM_SCORE) == (0.5, 0.3)` and the four
  boundary literals 0.5 / 0.4999 / 0.3 / 0.2999. The constants already hold the documented
  values, so the test passes on the base; it was checked by mutation: with `HIGH_SCORE = 0.4` the
  new test fails and the old one still passes (reverted).

## Files changed

- `evals/src/dc_evals/claude_cli.py`, `evals/README.md`
- `evals/tests/test_claude_cli.py`, `evals/tests/test_backfill.py`
- `frontend/tests/evalsParseDeck.test.ts`
- `evals/reports/2026-10-01-retrieval.json`, `evals/reports/2026-10-01-retrieval.md`
- `docs/delivery/r20-issues/V01-notes.md`, `V02-notes.md`, `V04-notes.md`, `F01-fixes.md`
