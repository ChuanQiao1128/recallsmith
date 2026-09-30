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
| `evals/tests/test_backfill.py` | New, 18 tests. |
| `evals/tests/test_report.py` | The committed-runs check skips `evals/reports/backfill/` (proposal files, not eval run files). |
| `evals/README.md` | New section "Citation backfill"; layout line. |
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
  (not after e.g./i.e./etc., not before a lower-case word) and never across a line break. A
  window starts on a character that is neither lower-case nor `#` and ends with `.`, `?` or `!`.
  A window holding wording the project keeps out of tracked files is never proposed
  (`EXCLUDED_WORDING`, stored as sha256 digests of the lower-case terms so the list itself is not in
  the repo). One real doc passage was dropped this way (two ccdvf cards got another quote). Seed =
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
- chunk-edge fragments (lower-case start, no final stop) and Markdown headings are never quoted;
- excluded wording (a stand-in digest) is never quoted; the committed digests are sha256 hex;
- the command end to end: cards with a source skipped, fragment dropped, ledger CSV fallback,
  review table weakest first, deck untouched without `--apply`, patch reproduces the proposals;
  `--min-score` and `--limit`; uncached pages skipped; `--apply`; a patched deck that does not
  parse exits 1 and writes nothing; the hybrid ranker with a fake embedder.

Commands: `cd evals && uv lock --check && uv run --python 3.12 pytest -q` and `V03.verify.sh`.

## The run

Run on the owner's Mac on 2026-10-01 (file date 2026-09-30, UTC), ranker `hybrid` (fastembed
installed in `evals/.venv`), default `--min-score 0.1`. The fetch step added the ledger-fallback
pages of aws-saa-c03 and the 72 claude-ccdv-f pages V02 had not fetched to the local cache
(sequential, 1 s apart); the final runs used `--offline` on that cache. Outputs:
`evals/reports/backfill/2026-09-30-{aws-saa-c03,claude-ccdv-f}-sources.{jsonl,md,patch}`.

| deck | cards | already sourced | proposed | high | medium | low | skipped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| aws-saa-c03 | 371 | 0 | 306 | 205 | 81 | 20 | 65: 61 no ledger URL (ledger rows without a URL), 4 no quotable sentence |
| claude-ccdv-f | 441 | 0 | 439 | 317 | 105 | 17 | 2: below --min-score |
| total | 812 | 0 | 745 | 522 | 186 | 37 | 67 |

Longest quote: 713 characters (aws), 570 (ccdvf); every quote is one line and at most 1000
characters. The patched decks parsed with zero errors through `parse-deck.mts`, and both
`.patch` files pass `git apply --check` against this branch.

### Spot-check (20 cards, done by hand)

Sample: `random.Random(20)`, per deck 2 low, 3 medium and 5 high proposals. The question was:
does the quote state (part of) what the card's answer asserts?

| # | card | conf. | supports? | note |
| ---: | --- | --- | --- | --- |
| 1 | aws-api-gateway-caching-and-throttling | low | yes | token-bucket throttling (the rate/burst part) |
| 2 | aws-shared-responsibility-model | low | yes | AWS host/virtualisation vs customer guest OS |
| 3 | aws-sns-fanout-filtering | medium | no | "Amazon SQS FIFO queues." only |
| 4 | aws-managed-vs-self-hosted-rule | medium | yes | EventBridge Scheduler replaces the cron box (one part) |
| 5 | aws-alarm-on-healthy-host-count-mcq-29 | medium | yes | TargetGroup dimension of the metric |
| 6 | aws-kinesis-shards-and-partition-keys | high | no | fragment about on-demand shard splits |
| 7 | aws-kms-envelope-encryption | high | yes | Decrypt returns the plaintext data key (starts mid-sentence) |
| 8 | aws-lex-service-card | high | no | publishing channels, not intents/slots |
| 9 | aws-kinesis-video-streams-service-card | high | yes | retention period |
| 10 | aws-aurora-vs-rds | high | no | engine list, not the storage/replica claims |
| 11 | ccdvf-breaking-behavior-changes-releases | low | no | model feature list |
| 12 | ccdvf-mcp-toolset-allowlist-denylist | low | yes | the denylist pattern |
| 13 | ccdvf-mcp-connector-request-shape | medium | no | a newer beta header, not the request shape |
| 14 | ccdvf-tool-result-content-types-mcq-01 | medium | yes | tool_result content block types |
| 15 | ccdvf-cc-monorepo-rules-mcq-04 | medium | no | CLAUDE.local.md order, not path-scoped rules |
| 16 | ccdvf-memory-tool-client-side | high | yes | client-side execution, /memories prefix |
| 17 | ccdvf-high-signal-tool-responses | high | yes | high-signal responses, semantic identifiers |
| 18 | ccdvf-adaptive-thinking-support-by-model | high | no | older models' thinking support only |
| 19 | ccdvf-zero-one-multi-shot | high | yes | examples steer format; few-shot |
| 20 | ccdvf-system-vs-user-placement | high | yes | system instructions take precedence |

**Precision estimate: 12 / 20 = 60 %** (95 % Wilson interval about 39-78 %). By confidence:
low 3/4, medium 3/6, high 6/10, so the lexical score is a weak predictor and every row needs the
owner's review; the `.md` table already lists the weakest first. Two earlier passes of the same
check (13/20 each) found quotes cut at chunk edges ("credentials for AWS STS ... in that the") and
Markdown headings; both are now excluded (windows must start on a non-lower-case character that is
not `#` and end with `.`, `?` or `!`), with tests. A remaining weakness: a chunk that starts
mid-sentence on a capitalised word (row 7) still passes.

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
- Chunks that dc-ingest starts mid-sentence on a capitalised word can still give a fragment quote;
  re-cutting windows on the reconstructed full page text would fix it.
- The 61 aws-saa-c03 cards whose ledger rows carry no URL get no proposal.
- A semantic support check (entailment) of the quote against the answer: the score is lexical.
