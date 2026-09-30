# V02 — Retrieval eval: fetch the cited pages, BM25 / local embeddings / hybrid, recall@k and MRR

Issue #556, wave r20-e. Contract §1 (rules 1, 9) and §8 (Evals). No paid model call anywhere:
BM25 is pure Python, the embeddings are the open-source `BAAI/bge-small-en-v1.5` run locally
through fastembed, and the tests use a fake fetcher and a fake embedder.

## What changed

| File | Change |
| --- | --- |
| `evals/src/dc_evals/source_cache.py` | New. `fetch-sources`: the distinct cited pages, dc-ingest fetch, the `$DC_SOURCES_CACHE` cache and its manifest. |
| `evals/src/dc_evals/retrieval.py` | New. Tokenizer, BM25, page ranking by best chunk, fastembed embedder (optional), RRF, recall@k / MRR, the report files. |
| `evals/src/dc_evals/cli.py` | New subcommands `fetch-sources` and `retrieval`. |
| `evals/pyproject.toml`, `evals/uv.lock` | `developercards-ingest` as an editable path dependency (like ai-qa); optional extra `embeddings = ["fastembed>=0.7"]`, never a default dependency. Lock regenerated (`uv lock --check` passes). |
| `evals/tests/test_retrieval.py` | New, 20 tests. |
| `evals/README.md` | New section "Retrieval eval"; layout and command list. |
| `.gitignore` | `evals/.sources-cache/` and `fastembed_cache/`, in case either cache is ever pointed inside the checkout (the defaults are outside it). |
| `evals/reports/2026-10-01-retrieval.json`, `.md` | The real run (metrics, method config, counts; no page text). |

## Surface shipped

```
dc-evals fetch-sources [--deck SLUG ...] [--max-pages N] [--delay-s 1.0] [--retry-failed]
```

- Pages: every distinct https URL in `evals/data/sources-<deck>.jsonl` (both decks by default),
  `#fragment` dropped, in ledger order: 611 pages for the two decks.
- Each page goes through `dc_ingest.core.ingest` (https only, https-only redirects,
  `DC_INGEST_ALLOWED_HOSTS`, 10 MB cap) with 1500-character chunks and 150 of overlap (fits
  bge-small's 512-token window). A `UserAgentHandler` added to dc-ingest's own opener sends
  `developercards-evals-retrieval/1.0 (offline retrieval eval; sequential, one request per
  second) developercards-ingest/1.8.0`.
- Sequential, `--delay-s` seconds between network requests (cache hits never wait).
- Cache: `$DC_SOURCES_CACHE` (default `~/.cache/developercards/sources`), one
  `<sha256(url)>.json` per page (`{v, url, cachedAt, chunking, doc}`, `doc` = the dc-ingest
  document) plus `manifest.json` (`pages[url] = {key, status ok|failed, httpStatus, reason
  (one line, at most 300 chars), chunks, at}`), written atomically after every page.
- A failure (an `IngestError`, or any other exception from one page) is recorded and the run goes
  on. A re-run skips cached pages and recorded failures; `--retry-failed` retries failures;
  `--max-pages N` caps the network fetches of one run.
- Prints `fetched F, cached C, failed X, not fetched (--max-pages) S`; exit 0.

```
dc-evals retrieval [--deck SLUG ...] [--k 1,5,10] [--methods bm25,embed,hybrid]
    [--date YYYY-MM-DD] [--out evals/reports]
```

- Pairs: distinct (uid, page) rows of the deck's sources file whose page is cached and whose
  card is in `data/cards-<deck>.jsonl`. Query = `mutations._answer_text(card)` (question,
  explanation, code, keyed options). Corpus = every chunk (title + chunk text) of every cached
  page the deck cites. Pages ranked by best chunk; a pair's rank counts pages tied with the gold
  page as ahead of it (pessimistic).
- `bm25`: k1 = 1.5, b = 0.75, idf ln(1 + (N - df + 0.5) / (df + 0.5)), tokens lower-case
  `[a-z0-9]+` minus a stop list, each distinct query term once.
- `embed`: fastembed `BAAI/bge-small-en-v1.5`, cosine (numpy when it is present, which fastembed
  brings; pure Python otherwise). Without fastembed, or when the model cannot load, the method is
  reported `{"status": "skipped", "reason": ...}` and the command still exits 0.
- `hybrid`: RRF, sum of 1 / (60 + rank) over the bm25 and embed page orderings; skipped with embed.
- `--k` and `--methods` are validated (positive integers; the three method names) by argparse.
- Writes `<out>/<date>-retrieval.json` (`date, type, decks{<slug>: pages{cited, cached, failed,
  notFetched}, chunks, pairs{total, evaluated, pageNotCached, cardNotInExport}, cardsEvaluated,
  metrics{<method>: {n, recall@k..., mrr}}, cards{...}}, overall, overallCards, methods, config,
  failureReasons`) and `.md` (the same as tables).

## The run on this machine (2026-10-01)

Run on the owner's Mac on 2026-10-01 (F01 fix round; the V02 worker left this section as a
placeholder and never committed the report). Commands, from `evals/`:

```
uv run --python 3.12 dc-evals fetch-sources                 # then once more with --retry-failed
uv sync --python 3.12 --extra embeddings                    # this worktree's venv only
uv run --python 3.12 --extra embeddings dc-evals retrieval --date 2026-10-01
```

Report: `evals/reports/2026-10-01-retrieval.json` and `.md` (metrics, config, counts, failure
reasons; no page text). fastembed `BAAI/bge-small-en-v1.5`, local CPU; no paid model call.

Pages: 611 cited, 602 cached, 9 failed (still failing after `--retry-failed`), 0 not fetched. Chunks:
8,682 (aws-saa-c03) and 4,538 (claude-ccdv-f). Pairs evaluated: 738 of 753 (aws-saa-c03; 15 cite
a failed page) and 587 of 587 (claude-ccdv-f).

Pairs (one per card and cited page), page-level, corpus = every cached page the deck cites:

| Deck | Method | n | recall@1 | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- | --- | --- |
| overall | bm25 | 1325 | 0.4370 | 0.7713 | 0.8649 | 0.5798 |
| overall | embed | 1325 | 0.4226 | 0.7404 | 0.8279 | 0.5588 |
| overall | hybrid | 1325 | 0.4196 | 0.7691 | 0.8634 | 0.5758 |
| aws-saa-c03 | bm25 | 738 | 0.2818 | 0.6680 | 0.8022 | 0.4472 |
| aws-saa-c03 | embed | 738 | 0.2846 | 0.6328 | 0.7493 | 0.4347 |
| aws-saa-c03 | hybrid | 738 | 0.2764 | 0.6626 | 0.7954 | 0.4484 |
| claude-ccdv-f | bm25 | 587 | 0.6320 | 0.9012 | 0.9438 | 0.7465 |
| claude-ccdv-f | embed | 587 | 0.5963 | 0.8756 | 0.9267 | 0.7148 |
| claude-ccdv-f | hybrid | 587 | 0.5997 | 0.9029 | 0.9489 | 0.7360 |

Cards (best rank over the card's cited pages):

| Deck | Method | n | recall@1 | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- | --- | --- |
| overall | bm25 | 748 | 0.7741 | 0.9599 | 0.9799 | 0.8521 |
| overall | embed | 748 | 0.7487 | 0.9599 | 0.9786 | 0.8392 |
| overall | hybrid | 748 | 0.7433 | 0.9666 | 0.9799 | 0.8451 |
| aws-saa-c03 | bm25 | 307 | 0.6775 | 0.9349 | 0.9707 | 0.7871 |
| aws-saa-c03 | embed | 307 | 0.6840 | 0.9446 | 0.9642 | 0.7908 |
| aws-saa-c03 | hybrid | 307 | 0.6645 | 0.9446 | 0.9642 | 0.7882 |
| claude-ccdv-f | bm25 | 441 | 0.8413 | 0.9773 | 0.9864 | 0.8973 |
| claude-ccdv-f | embed | 441 | 0.7937 | 0.9705 | 0.9887 | 0.8728 |
| claude-ccdv-f | hybrid | 441 | 0.7982 | 0.9819 | 0.9909 | 0.8846 |

Reading: BM25 is the strongest single method on these decks (the cards reuse the pages'
service and API names); embed alone is a little weaker, and RRF hybrid does not beat BM25 on
MRR, only on recall@5/@10 for claude-ccdv-f. aws-saa-c03 is harder at the pair level: its corpus
is about four times larger (497 pages) and a card cites 2.4 pages on average, so only one of a
card's pages can rank first.

Failed pages (recorded in the cache manifest; the run went on):

| Page | Reason |
| --- | --- |
| https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/ | HTTP error 404 fetching https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/ |
| https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-limits.html | no extractable text |
| https://docs.aws.amazon.com/cost-management/latest/userguide/sp-recommendations.html | no extractable text |
| https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/us-east-1/index.csv | unsupported content type application/octet-stream |
| https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/us-east-1/index.csv | unsupported content type application/octet-stream |
| https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.csv | unsupported content type application/octet-stream |
| https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEFS/current/us-east-1/index.csv | unsupported content type application/octet-stream |
| https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.csv | unsupported content type application/octet-stream |
| https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3GlacierDeepArchive/current/us-east-1/index.csv | unsupported content type application/octet-stream |

## Why the lexical chooser is not a baseline

`mutations.supporting_source` picks, for a card, the one of its own ledger URLs whose
`fact_checked` note shares the most content words with the card. It never sees the other pages
of the deck (one to a few candidates, all correct by construction) and it reads the ledger's
summary notes, not the page text, so its hit rate is agreement between two notes about the same
card. The report explains this and gives only the corpus-wide numbers.

## How it is tested

`evals/tests/test_retrieval.py` (no network, no model download, temporary cache):

- tokenizer; BM25 ranking on a three-chunk fixture corpus; BM25 against the formula by hand;
  pages ranked by their best chunk;
- pessimistic tie ranks; RRF fusion math (k = 60); recall@k and MRR math, and the empty case;
- `page_url` / `url_key`, the default and `$DC_SOURCES_CACHE` cache directory;
- a fake fetcher: miss then hit, delays only between network requests, an HTTP 404 and an
  unexpected exception recorded in the manifest without stopping the run, a re-run that makes no
  request, `--retry-failed`, and `--max-pages`;
- the User-Agent handler on dc-ingest's https-only opener;
- a fake embedder: the embed scoring path, and `evaluate` running all three methods (chunks and
  queries embedded once each);
- embed skipped cleanly when `fastembed` cannot be imported, with bm25 still reported;
- the CLI: `fetch-sources` with a patched fetcher and `retrieval` writing both report files;
  unknown methods and a zero k rejected. The report is checked to hold no page text.

Commands run: `cd evals && uv lock --check && uv run --python 3.12 pytest -q` (all pass) and the
V02 verify script.

## Owner steps

- None required. To refresh the numbers after the ledgers change:
  ```
  cd evals
  uv run --python 3.12 dc-evals fetch-sources
  uv run --python 3.12 --extra embeddings dc-evals retrieval
  ```
  `--extra embeddings` installs fastembed (onnxruntime, numpy, tokenizers) into `evals/.venv`;
  the model (about 130 MB) goes to fastembed's own cache. Plain `uv run` / `uv sync` removes the
  extra again.

## Deferred

- Query variants (question only, an instruction prefix for bge) and chunk-size sweeps: one
  configuration is measured here.
- A cross-deck or open-web corpus: the corpus is the pages each deck already cites.
- The ledger rows that `export-sources` drops (no note, a note over 1000 characters, or not in
  the deck) are not ground truth here; they were not needed.
