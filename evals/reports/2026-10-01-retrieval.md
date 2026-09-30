# Retrieval eval 2026-10-01

Can the page the ledger cites for a card be found from the card's own text? Page-level, corpus-wide per deck. Metrics only; no page text is committed.

## Methods

- `bm25`: ok (k1=1.5, b=0.75, idf=ln(1+(N-df+0.5)/(df+0.5)), tokens=lower-case [a-z0-9]+ minus an English stop list)
- `embed`: ok (model=BAAI/bge-small-en-v1.5, similarity=cosine, queryPrefix=None)
- `hybrid`: ok (fusion=reciprocal rank fusion of bm25 and embed, rrfK=60)

## Pairs (one per card and cited page)

| deck | method | n | recall@1 | recall@5 | recall@10 | mrr |
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

## Cards (best rank over the card's cited pages)

| deck | method | n | recall@1 | recall@5 | recall@10 | mrr |
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

## Counts

| deck | pages cited | cached | failed | not fetched | chunks | pairs | evaluated | cards |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aws-saa-c03 | 497 | 488 | 9 | 0 | 8682 | 753 | 738 | 307 |
| claude-ccdv-f | 114 | 114 | 0 | 0 | 4538 | 587 | 587 | 441 |

Fetch failures: HTTP 404 x1, no extractable text x2, unsupported content type application/octet-stream x6

## Baseline

The existing lexical chooser (`mutations.supporting_source`) is not comparable and is not reported: it only picks among the card's own ledger URLs (one to a few candidates that are all correct by construction), and it scores the ledger's `fact_checked` summary notes, not the page text. Its hit rate measures agreement between two notes about the same card, not retrieval. The numbers here rank every cached page the deck cites, from the fetched page text.

## Config

```json
{
  "ks": [
    1,
    5,
    10
  ],
  "corpus": "every chunk of every cached page the deck's ledger cites; pages ranked by best chunk",
  "query": "card question + explanation + code + keyed options (mutations._answer_text)",
  "chunking": {
    "maxChunkChars": 1500,
    "overlapChars": 150,
    "chunkText": "page title + chunk text"
  },
  "rank": "1-based, pessimistic on ties",
  "groundTruth": "distinct (uid, page) pairs of data/sources-<deck>.jsonl, URL fragment dropped"
}
```
