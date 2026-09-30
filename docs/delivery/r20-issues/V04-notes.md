# V04: local card embeddings (dc-evals embed-cards, push, semantic-dupes)

Issue #558, wave r20-e. Contract §1, §5 (canonical text, textSha256, model/dim, the
card-embeddings route) and §8 (Evals). No paid model call anywhere: vectors come from the
open-source `BAAI/bge-small-en-v1.5` through fastembed on the owner's Mac (the optional
`embeddings` extra, never a default dependency). Tests use a deterministic fake embedder and a
fake HTTP layer: no network, no model download.

## What changed

| File | Change |
| --- | --- |
| `evals/src/dc_evals/embed_cards.py` | New. Canonical text + textSha256, L2 normalisation, deck loading, the local vector cache, batching and the push, the nearest-pair report. |
| `evals/src/dc_evals/cli.py` | New subcommands `embed-cards` and `semantic-dupes`. |
| `evals/tests/test_embed_cards.py` | New, 26 tests. |
| `evals/README.md` | New section "Card embeddings"; commands and layout lines. |
| `evals/reports/semantic-dupes/2026-09-30-semantic-dupes-{aws-saa-c03,claude-ccdv-f}.{json,md}` | The real run for both decks (below). |
| `.gitignore` | `evals/.embed-cache/`, for a `$DC_EMBED_CACHE` pointed inside the checkout. |

`evals/pyproject.toml` and `evals/uv.lock` are unchanged: V02 already added the `embeddings`
extra (`fastembed>=0.7`), and `uv lock --check` passes.

## Surface shipped

```
dc-evals embed-cards --deck PATH_OR_SLUG [--out FILE] [--push --api-base URL]
dc-evals semantic-dupes --deck PATH_OR_SLUG [--min-cosine 0.90] [--embeddings FILE]
    [--date YYYY-MM-DD] [--out DIR]            (--out default evals/reports)
```

- `--deck`: a file (`.md` through V01's `deck_review.parse_deck`, i.e. `evals/scripts/parse-deck.mts`;
  `.jsonl` read as an export), or a slug: `evals/data/cards-<slug>.jsonl` for `aws-saa-c03` and
  `claude-ccdv-f`, otherwise `content/decks/<slug>.md`. An unknown deck exits 2.
- Canonical text `question.strip() + "\n\n" + explanation.strip()` (a missing explanation is
  `""`); `textSha256` = lower hex SHA-256 of its UTF-8 bytes.
- Embedding: fastembed `BAAI/bge-small-en-v1.5` (V02's `retrieval.load_embedder`), each vector
  checked for 384 dims and finite values, then L2-normalised. Without fastembed: exit 2,
  "cannot embed: fastembed is not installed (cd evals && uv sync --extra embeddings)".
- Output: JSONL, one `{deckSlug, stableUid, textSha256, model, dim, embedding}` per card in deck
  order, written atomically to `--out FILE` or `$DC_EMBED_CACHE/<slug>.jsonl` (default
  `~/.cache/developercards/embeddings/<slug>.jsonl`). A record whose (stableUid, textSha256,
  model, dim) is already in that file is reused; only new or edited cards are embedded.
- `--push --api-base URL`:
  - Needs `DC_ADMIN_TOKEN` in the environment; without it exits 2 before embedding anything. The
    token is only ever put in the `Authorization: Bearer` header; any error text that contains it
    is printed with `[redacted]` in its place.
  - `--api-base` must be https; plain http only to localhost / 127.0.0.1 / ::1 (exit 2 otherwise).
  - `PUT {api}/api/v1/admin/card-embeddings`, `Content-Type: application/json`, body
    `{model:"BAAI/bge-small-en-v1.5", dim:384, items:[{deckSlug, stableUid, textSha256,
    embedding}]}`, batches of at most 100 (contract §5 as amended: the Lambda caps bodies at 1 MiB).
    Full-precision floats; a test serialises a worst-case 100-item batch (23-character floats,
    128-character uids) under 1,000,000 bytes.
  - Reads the `Res` envelope (`data.upserted`, `data.unknownCards`, `data.staleText`), sums over
    the batches and prints `pushed N in B batches: upserted X, unknownCards Y, staleText Z`, then
    up to 20 uids of each non-empty list.
  - `503` with `error.code = VECTOR_NOT_READY`: stops, prints "the owner must CREATE EXTENSION
    vector and re-run the migration", exit 3. Any other non-2xx status or a transport error: exit 1
    with the status, error code and message (capped at 300 characters).
- `semantic-dupes`: loads the deck, reuses the cached vectors (embedding only missing or edited
  cards, so fastembed is optional once the cache is warm), writes
  `<date>-semantic-dupes-<slug>.json` and `.md`: every unordered pair with cosine >=
  `--min-cosine`, highest first, at most 50, shown by stableUid and question text only (never the
  explanation); the 10 closest pairs below the threshold; the distribution of each card's
  nearest-neighbour cosine (min / p50 / p90 / p99 / max, nearest-rank, and buckets). Similarity is
  the cosine of the canonical-text vectors, the same vectors the server stores, so the report
  previews what V06's `semantic-duplicates` route will return.

## Contract digest (pinned)

Question `What is S3?`, explanation `Object storage.` → canonical text `"What is S3?\n\nObject storage."` →

```
657f8dad50869de985f7a8d76cbd7dca0cae9f9a49dba025459e40c2dfe94ebb
```

Asserted as a literal in `test_text_sha256_is_the_pinned_contract_digest`; V06 pins the same
literal in C#. Note: Python `str.strip()` and C# `string.Trim()` agree on every whitespace
character real cards contain; they differ only on the control characters U+001C..U+001F (Python
strips them, C# does not), which the deck format never produces.

## The run (2026-09-30 UTC, fastembed 0.8.1, owner's Mac, CPU)

`uv run --python 3.12 --extra embeddings dc-evals semantic-dupes --deck <slug> --out reports/semantic-dupes`
from the exported decks. Loading the deck file instead (`content/decks/aws-saa-c03.md`) gives the
same 371 digests, so the export is current.

| Deck | Cards | Pairs >= 0.90 | Cards with a neighbour >= 0.90 | NN min | NN p50 | NN p90 | NN p99 | NN max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aws-saa-c03 | 371 | 25 | 49 (13 %) | 0.7275 | 0.8490 | 0.9045 | 0.9523 | 0.9567 |
| claude-ccdv-f | 441 | 38 | 71 (16 %) | 0.7116 | 0.8507 | 0.9092 | 0.9453 | 0.9500 |

Nearest-neighbour buckets (cards):

| Range | aws-saa-c03 | claude-ccdv-f |
| --- | --- | --- |
| 0.70-0.75 | 2 | 5 |
| 0.75-0.80 | 44 | 42 |
| 0.80-0.85 | 142 | 170 |
| 0.85-0.88 | 86 | 101 |
| 0.88-0.90 | 48 | 52 |
| 0.90-0.92 | 25 | 52 |
| 0.92-0.95 | 20 | 17 |
| 0.95-0.98 | 4 | 2 |
| >= 0.98 | 0 | 0 |

### Is 0.90 right?

Reasonable as a "likely overlap, review it" flag; too low to call a pair a true duplicate.

- bge-small cosines of same-domain cards are compressed: the median card's nearest neighbour is
  already 0.85, and nothing reaches 0.98. No two cards in either deck are word-for-word copies.
- The 63 pairs at or above 0.90 are three kinds (corrected in F01, e-tests-2; the first version
  of these notes said every pair was a concept card and an MCQ card, which the reports do not
  support). Card kind read from the `mcq` field of `evals/data/cards-<slug>.jsonl`:

  | Deck | concept + MCQ | MCQ + MCQ | concept + concept | Total |
  |---|---|---|---|---|
  | aws-saa-c03 | 16 | 8 | 1 | 25 |
  | claude-ccdv-f | 24 | 1 | 13 | 38 |

  Concept + MCQ pairs are the same scenario and answer asked two ways (for example
  `aws-quick-service-card` / `aws-bi-dashboard-choice-mcq-36` 0.957,
  `ccdvf-cache-min-prefix-by-model` / `ccdvf-cache-silently-not-written-mcq-03` 0.950); that is by
  design, but an author should see them before adding a third card on the same point, which is the
  job of the authoring-time `likelyDuplicate` flag. The 14 concept + concept pairs are different:
  several look like true duplicates the deck already holds, and they are owner review items (see
  "Owner review: likely duplicates" below).
- The distribution has no gap at 0.90. The 10 closest pairs below it (0.89-0.90) look like the
  pairs just above it (for example, the RDS encryption concept card and its MCQ at 0.898). A
  threshold of 0.90 flags 13-16 % of cards. At 0.93 only 5-6 pairs per deck remain, and at
  0.95 only 1-2.
- Recommendation: keep 0.90 for `SemanticDuplicateThreshold` (a warning, not a block): it is
  the level at which the claude-ccdv-f concept-card duplicates below appear at all (the lowest is
  0.903), so a higher threshold would hide real duplicates, while most other pairs are intended
  concept/MCQ twins that a block would wrongly stop. If the
  console's duplicates list feels noisy, raise its default `minCosine` to 0.92-0.93 rather than
  changing the shared constant. Judge it again after the owner pushes vectors and V10 shows the
  live list.

## Tests

`evals/tests/test_embed_cards.py` (26 tests, all offline):

- Canonical text (strip both parts, blank-line join, missing explanation); the pinned digest;
  UTF-8 bytes for non-ASCII text.
- `l2_normalize`: unit length; zero, NaN and infinite vectors refused.
- `embed-cards`: the record shape in the default cache (`DC_EMBED_CACHE`), a non-unit fake vector
  comes out unit length, `--out` overrides the cache, unchanged cards reuse their vector (the fake
  is called only for the edited card), the known-slug path reads the export, fastembed missing →
  exit 2 with the install hint, a wrong dimension → exit 1, unknown deck → exit 2.
- Batching: 250 → 100/100/50; a worst-case 100-item batch < 1,000,000 bytes.
- Push request shape with a recording fake HTTP layer: PUT, URL (trailing slash in the base
  handled), Bearer header, JSON body keys, item keys, batch sizes; counts summed across batches.
- Push command: counts printed; no token → exit 2 with nothing embedded or sent; `--push` without
  `--api-base` → argparse exit 2; plain http to a remote host refused, localhost allowed; 503
  VECTOR_NOT_READY → exit 3 with the owner message, stops after the first batch; 400 → exit 1.
- Token never in output: a successful push, a 401 whose message echoes the token and a transport
  error that includes the header all leave stdout, stderr and the cache files free of the token.
- Pair ranking with a fake embedder: each unordered pair once, highest first, threshold and limit;
  nearest-neighbour distribution; the report is question-only (an explanation marker never appears
  in the JSON or Markdown); the second run uses the cache and embeds nothing; the 50-pair cap with
  66 qualifying pairs.

Gates run: `cd evals && uv lock --check && uv run --python 3.12 pytest -q` (all pass) and
`V04.verify.sh`.

### Owner review: likely duplicates

The concept + concept pairs at or above 0.90 (from the 2026-09-30 reports). The first three look
like the same card written twice; review each pair and merge or retire one card where they are:

| Cosine | Card A | Card B |
|---|---|---|
| 0.942 | `ccdvf-instruction-placement-tool-result-vs-user-turn` | `ccdvf-own-instructions-not-in-tool-result` |
| 0.940 | `ccdvf-model-lifecycle-states` | `ccdvf-model-deprecation-lifecycle` |
| 0.909 | `ccdvf-sampling-params-removed` | `ccdvf-sampling-parameters-removed` |
| 0.930 | `ccdvf-parallel-tool-results-single-message` | `ccdvf-parallel-tool-calls-execution` |
| 0.921 | `ccdvf-batch-cache-seed-1h` | `ccdvf-batch-plus-cache-stacking` |
| 0.913 | `ccdvf-model-id-pinning-dateless` | `ccdvf-dateless-id-not-alias` |
| 0.913 | `ccdvf-context-window-accounting` | `ccdvf-context-window-what-counts` |
| 0.912 | `ccdvf-usage-input-token-fields` | `ccdvf-usage-object-fields` |
| 0.912 | `ccdvf-claude-md-context-not-enforcement` | `ccdvf-permission-rules-not-model` |
| 0.912 | `ccdvf-claude-md-context-not-enforcement` | `ccdvf-cc-hook-vs-claude-md-enforcement` |
| 0.909 | `aws-rds-multi-az-vs-read-replica` | `aws-rds-multi-az-cluster-vs-instance` |
| 0.904 | `ccdvf-batch-async-lifecycle` | `ccdvf-batch-api-limits` |
| 0.904 | `ccdvf-settings-file-scopes` | `ccdvf-cc-local-vs-shared-settings` |
| 0.903 | `ccdvf-foundry-deployment-and-auth` | `ccdvf-foundry-hosting-option-choice` |

The 9 MCQ + MCQ pairs (8 in aws-saa-c03, for example `aws-asg-scale-workers-on-queue-mcq-06` /
`aws-queue-backlog-per-instance-mcq-08` 0.952, and `ccdvf-prefill-removed-mcq-01` /
`ccdvf-prefill-400-mcq-09` 0.915) are worth the same look.

## Owner steps

1. Once V06 is deployed and `CREATE EXTENSION vector` has been run as the RDS master followed by
   the migration (contract §9 step 1), push each deck with a console access token in the
   environment (it is never put on the command line):

   ```
   cd evals
   export DC_ADMIN_TOKEN=...   # a super_admin console access token; typed or pasted, not saved
   uv run --python 3.12 --extra embeddings dc-evals embed-cards --deck ../content/decks/aws-saa-c03.md \
       --push --api-base https://<api host>
   uv run --python 3.12 --extra embeddings dc-evals embed-cards --deck claude-ccdv-f \
       --push --api-base https://<api host>
   unset DC_ADMIN_TOKEN
   ```

   Exit 3 means the extension or table is not there yet. `unknownCards` are cards the server does
   not have (an unpublished deck or edit); `staleText` are cards whose published text differs from
   the local file. Re-embed from the published deck file and push again.
2. Re-run the push after publishing edits. Only edited cards are embedded again.

## Deferred / notes

- The first model load downloads bge-small (about 130 MB) into fastembed's own cache. At exit on
  macOS, onnxruntime sometimes prints `libc++abi: ... recursive_mutex lock failed` after the
  command has finished and written its files. This is an onnxruntime teardown quirk; the output is
  complete.
- No `--from-cache` push without a deck: the push always re-derives the digests from the deck, so
  a stale cache cannot be pushed by mistake.
- No retry or backoff on the push. It is a manual, idempotent owner command (the server upserts),
  so it can simply be re-run.
