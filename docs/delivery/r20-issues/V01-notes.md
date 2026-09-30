# V01 — dc-evals review: local pre-publish AI QA self-check (claude-cli, zero API spend)

Issue #555, wave r20-e. Contract §1 and §8 (Evals).

## What changed

| File | Change |
| --- | --- |
| `evals/scripts/deck-lib.mts` | New. The one copy of the console-parser loader (esbuild from frontend/node_modules, bundle imported from a data: URL) and `exportCard`. |
| `evals/scripts/export-cards.mts` | Uses `deck-lib.mts` instead of its own loader; output unchanged (`--check` passes). |
| `evals/scripts/parse-deck.mts` | New. Prints a deck's cards as QaCard-shaped JSON lines. |
| `evals/src/dc_evals/deck_review.py` | New. Selection, the claude-cli review, the table, exit codes. |
| `evals/src/dc_evals/cli.py` | New `review` subcommand. |
| `evals/tests/test_review.py` | New, 32 tests. |
| `evals/README.md` | New section "Local pre-publish review", layout and command list. |
| `.gitignore` | `evals/.cache/` (the review output). |

## Surface shipped

```
node evals/scripts/parse-deck.mts <deck.md | ->
```

One JSON object per card on stdout, keys `sourceUid, deckSlug, stableUid, difficulty, topic,
question, explanation, codeSnippet, codeLanguage, realWorldUsage, mcq, source` (the same as
export-cards). A parse error prints `file:line: CODE message` per issue on stderr (stdin is named
`-`) and exits 1; a deck without a `# deck:` header is reported as `MISSING_DECK_HEADER`. A usage
error or an unreadable file exits 2.

```
dc-evals review --deck PATH (--changed-since REF | --cards UID[,UID...] | --all)
    [--provider claude-cli] [--model claude-opus-5] [--concurrency 2] [--limit 60]
    [--out FILE] [--review-date YYYY-MM-DD] [--dry-run]
```

- Selection: exactly one option. `--changed-since` compares each card's sorted-key JSON with the
  deck at `git show REF:<path>` (parsed by the same script over stdin); new uids and changed
  content are selected, in deck order. A deck missing at REF selects every card; an unknown REF
  exits 2. None of the three exits 2 listing them; two of them exit 2 (argparse).
- Provider: only `claude-cli`; anything else exits 2 with "paid providers are not available here;
  use dc-evals run", before the deck is read or a client is built.
- Review: `load_settings` with `AI_PROVIDER=anthropic`, `AI_MODEL=--model`,
  `AI_STRUCTURED_OUTPUTS=off`, the second reviewer off; profile `default` (ai_qa SYSTEM_PROMPT /
  PROMPT_VERSION); `ClaudeCliClient(settings.model)`; the rows go through `runner.run_eval`, so each
  card is `review_card(...)` through `RecordingClient` exactly like `run --provider claude-cli`,
  including the served-model check.
- `--limit`: a selection over the cap (default 60) exits 2 before any call.
- Output: a table grouped by card (stableUid | severity | category | message | suggestedFix),
  totals, and the path of the JSONL (`{"type":"review"}` header plus one `{"type":"item"}` line per
  card). Default file `evals/.cache/review/<date>-<deck stem>.jsonl`.
- Exit: 0 no blocker/major, 1 at least one blocker/major, 2 usage/config, 3 any card errored
  (3 wins over 1).

## How it is tested

`evals/tests/test_review.py` (pytest, no node, no claude): the parser and the client are
replaced through the module seams `deck_review.parse_deck` and `deck_review.make_review_client`
(a `FakeLlm`). Covered: no selection, two selections, `--all`, `--cards` (and an unknown uid),
`--changed-since` against a temporary git repo (edited + new cards, a ref without the deck, no
change, an unknown ref), sorted-key content, provider refusal for five values, default and
overridden model, the production prompt with structured outputs off, the limit cap, dry-run
(no client, no file), a missing deck, a parse failure, exit codes 0/1/3, the table layout and
totals, the JSONL file, the default output path and that it is git-ignored, and the node command
(`node <evals/scripts/parse-deck.mts> <path>` / `-` with stdin) plus the missing-esbuild message.

Commands run:

```
cd evals && uv lock --check && uv run --python 3.12 pytest -q
node evals/scripts/export-cards.mts --check
```

Also checked by hand (no CLI call): `dc-evals review --deck ../content/decks/claude-ccdv-f.md
--changed-since HEAD --dry-run` selects 0 cards on a clean tree and exactly the edited card after
a one-line TOPIC edit (reverted); `--all` exits 2 at the 60-card cap; `--provider anthropic` exits 2.

## Owner steps

1. `test -d frontend/node_modules || (cd frontend && npm ci)` once.
2. Before importing or publishing an edited deck:
   `cd evals && uv run --python 3.12 dc-evals review --deck ../content/decks/<slug>.md --changed-since main`
   (add `--dry-run` first to see the selection). Fix any blocker/major finding (exit 1).

## Deferred

- No live CLI run was made in this issue (the worker has no business spending the owner's
  subscription); the first real run is the owner's.
- The review items are not scored against labels; they are a self-check, not gate evidence.

## Correction after review (F01, 2026-10-01)

The "zero API spend" claim did not hold as first delivered: `ClaudeCliClient.env` passed the whole
process environment to `claude -p`, so an exported `ANTHROPIC_API_KEY` would have made the CLI bill
API credits. F01 (e-correctness-1, e-security-1) removes `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK` and
`CLAUDE_CODE_USE_VERTEX` from every `claude -p` child (contract §10.7); the claim holds from F01 on.
See `F01-fixes.md`.

The parser behaviour promised above (the exported keys, stdin as `-`, `MISSING_DECK_HEADER`
exit 1, usage exit 2, and `export-cards.mts --check` passing after the deck-lib refactor) was
checked by no test or CI step when V01 shipped; F01 (e-tests-3) adds
`frontend/tests/evalsParseDeck.test.ts`, which runs the real scripts in the frontend vitest job.
