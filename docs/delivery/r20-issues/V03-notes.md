# V03: citation backfill proposer (verbatim SOURCE quotes for cards without a source)

Issue #557, wave r20-e. Contract §1 (rules 7, 9) and §8 (Evals). No paid model call: ranking is
BM25 (pure Python), fused with the local open-source `BAAI/bge-small-en-v1.5` through fastembed
when the optional `embeddings` extra is installed. Tests use no network, no model and no node.
The deck files are not edited in this issue.

## What changed

| File | Change |
| --- | --- |
| `evals/src/dc_evals/backfill.py` | New. Candidate pages, chunk ranking, quote windows, SOURCE insertion, unified patch, patched-deck validation, report files, `--apply`. |
| `evals/src/dc_evals/cli.py` | New subcommand `backfill-sources`. |
| `evals/tests/test_backfill.py` | New, 15 tests. |
| `evals/reports/backfill/<date>-<slug>-sources.{jsonl,md,patch}` | The real run output for both decks (see "The run"). |

## Surface shipped

```
dc-evals backfill-sources --deck SLUG [--limit N] [--min-score X] [--out DIR] [--date YYYY-MM-DD]
    [--offline] [--apply]
```

- Cards: `content/decks/<slug>.md` read through `evals/scripts/parse-deck.mts` (the console
  parser, via V01's `deck_review.parse_deck`). Cards whose `source` is set are skipped and counted.
  `--limit N` processes the first N cards without a source, in deck order.
- Candidate pages per card: the card's pages in `evals/data/sources-<slug>.jsonl` (URL fragment
  dropped); only when they give no proposal at or above `--min-score`, every https URL of the
  card's rows in `content/decks/<slug>.ledger.csv` (all URLs of a cell, any `in_deck` value).
- Pages come from the V02 cache (`$DC_SOURCES_CACHE`, default `~/.cache/developercards/sources`).
  Uncached candidate pages are fetched first with V02's `fetch_sources` (sequential, 1 s apart,
  failures recorded); `--offline` never fetches.
- Ranking: every chunk of every candidate page of the processed cards is indexed with V02's BM25;
  with fastembed, chunks and queries are embedded with bge-small and the card's candidate chunks
  are ordered by RRF (k = 60) of the BM25 and cosine orderings (`hybrid`), otherwise by BM25 alone.
  Query = question + explanation + code + keyed options (`mutations._answer_text`).
- Quote window, in each of the best 3 chunks: sentences split at `.`/`?`/`!` followed by space
  (not after e.g./i.e./etc., not before a lower-case word) and never across a line break. Seed =
  the sentence sharing the most answer terms (explanation + keyed options; tokens as V02, plural
  `s` stripped); grow by the same-line neighbour adding the most new answer terms (following one
  on a tie) while it adds at least one, up to 3 sentences and 1000 characters. A window whose
  first sentence starts with a deck marker (`Q:`, `A:`, `## `, `SOURCE:` ...) is never used.
  The quote is asserted to be a verbatim substring of the page text. Best window over the 3
  chunks wins.
- Score = (answer terms in quote / distinct quote terms) x min(1, answer terms in quote / 6).
  Confidence: high >= 0.5, medium >= 0.3, low below. `--min-score` (default 0.1) skips weaker ones.
- Outputs in `--out` (default `evals/reports/backfill`), written only after validation:
  - `<date>-<slug>-sources.jsonl`: one row per proposed card, `{uid, url, quote, score,
    confidence, reason}`.
  - `<date>-<slug>-sources.md`: summary counts, how to apply, a table sorted by confidence then
    score ascending (weakest first) with an answer excerpt beside each quote, and the skipped cards
    with their reason.
  - `<date>-<slug>-sources.patch`: a unified diff (`a/content/decks/<slug>.md`) that adds
    `SOURCE: <url>` plus the one-line quote after the card's last non-blank line, which is the
    canonical position (SOURCE is the last section in FORMAT §1.4).
- Validation: the original and the patched deck text both go through parse-deck.mts (stdin);
  zero parse errors, the same cards, every proposed card reads back exactly `{url, quote}`, every
  other card keeps its source. Any failure exits 1 and writes nothing.
- `--apply` writes the patched text over the deck file. The owner runs it; this issue did not.

## How it is tested

`evals/tests/test_backfill.py` (tmp cache, a Python stand-in for the parse-deck seam, fastembed
blocked or a fake embedder):

- sentence split: abbreviations, `?`/`!`, no sentence across a line;
- quote window: verbatim, starts and ends on sentence boundaries, prefers the highest overlap,
  skips a marker line, respects the cap (a sentence over the cap is never used), None on no overlap;
- confidence thresholds at their boundaries and the score formula;
- canonical insertion in a fixture deck with a Q/A card (after USAGE), an MCQ card with OPT/WHY,
  A and a CODE body (after the code line, before the next header) and the last card of the file;
  refusal for a card that already has a SOURCE or does not exist;
- the patch applies cleanly with `git apply` (also for a deck without a final newline);
- the command end to end: cards with a source skipped, fragment dropped, ledger CSV fallback,
  review table weakest first, deck untouched without `--apply`, patch reproduces the proposals;
  `--min-score` and `--limit`; uncached pages skipped; `--apply`; a patched deck that does not
  parse exits 1 and writes nothing; the hybrid ranker with a fake embedder.

Commands: `cd evals && uv lock --check && uv run --python 3.12 pytest -q` and `V03.verify.sh`.

## The run

RUN_RESULTS

## Owner steps

1. Read `evals/reports/backfill/<date>-<slug>-sources.md`, weakest rows first; drop the hunks you
   reject from the `.patch` (or re-run with a higher `--min-score`).
2. From the repo root: `git apply evals/reports/backfill/<date>-<slug>-sources.patch` (or
   `cd evals && uv run --python 3.12 --extra embeddings dc-evals backfill-sources --deck <slug> --apply`).
3. `node frontend/scripts/lint-deck.mts content/decks/<slug>.md`, then import and publish through
   the console (contract §9 step 3).

## Deferred

- Quotes spanning several lines of the page (lists, tables): kept to one line so the deck parser
  reads the quote back byte for byte.
- A semantic support check (entailment) of the quote against the answer: the score is lexical.
