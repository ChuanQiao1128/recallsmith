# Inactive v4 development implementation

`retrieval_v4.py` implements literal query facets, structural maps over exact
whole-source text, required-only radius-bounded closures, fenced-code retention,
and round-robin atomic packing of original chunks. Original IDs, text, offsets
and source versions are retained; both chunk and scalar-character budgets apply.

`retrieval_v4_dev.DevelopmentEvidenceIndexV4` connects those mechanics to the
existing offline BGE loader and read-only pgvector search. It takes an explicit
`A` (radius 1) or `B` (radius 2) configuration. It does not call the older v3
eligibility or query-normalization logic. The active corpus profile is not
changed. Its packets are development diagnostics: the complete frozen v4
envelopes, trusted profile registration and semantic gate are still required
before an author or MCP consumer can use them.

`proof_schedule_v4.py` preflights the original S2 all-subsets protocol. Each group
keeps all nonempty subsets of up to eight chunks, lexicographically sorted by
original IDs. Two checker schedules see identical blind projections with only
required facts, mandatory scope and complete original evidence. Anchors,
optional facts, ranks and peer decisions are excluded. Each call covers one
group and at most four subsets; a full prompt must be below 60,000 scalar
characters. Scheduling performs no inference and grants no semantic credit.
Real execution must retain independent raw receipts and apply existing quote,
identity and completion validation. Missing or overflowing output remains
UNKNOWN; the scheduler does not issue a release gate.

## Resource scope

Historical split keys remain unchanged. Under the reviewed design, all 80
previously observed queries are now development material: 64 positives and 148
required groups. At eight chunks per packet, that means 75,480 independent
subset decisions and at most 18,944 calls for this one-group/four-subset
schedule. The historical 40-query DEV subset alone has 65 groups and 33,150
decisions; it is not the whole new DEV set. Output lengths, actual model latency
and successful completion have not been established by these counts.

Prefix checks cannot replace the all-subsets protocol: a checker may return
UNKNOWN on a prefix while passing a smaller subset inside it. No prefix-MRR
equivalence or reduced-call execution approval is claimed.

## Checks and remaining gate

Run the tests from this directory with the existing local dependency runtime:

```text
python -m unittest discover -p 'test_*.py'
```

The v4 modules remain separate from existing authoring, evaluation and MCP
entry points. The historical failed holdout is observed, not a fresh blind test.
New holdout labels require the reviewed access/sealing prerequisites. The
previously platform-blocked source-boundary review remains UNKNOWN. Until those
required checks pass, this code does not authorize card generation or publishing.

## First actual local DEV observations

At runtime-source commit `0116675`, both predeclared configurations ran once
against all 80 already observed queries (64 positive, 16 negative, 148 required
groups). All 4,668 stored pgvector rows were checked against the source-bound
index before retrieval; corpus, active profile, source code and local model cache
hashes were unchanged afterward. No generative execution or new holdout occurred.

Legacy anchor Recall@8 was 0.59921875 for A and 0.6908854167 for B. Legacy MRR
was 0.6011904762 and 0.6317708333 respectively. These are legacy diagnostic
metrics, not the new complete-group semantic metrics or blind acceptance scores.
No configuration is approved for generation by these observations. Raw candidate
queues, original packets and packing traces are retained in the local workflow
control directory. The non-sensitive aggregate is
[retrieval-v4-dev-summary.json](retrieval-v4-dev-summary.json).

The two configuration observation slots are consumed; their low diagnostic scores
do not authorize retuning and repeating this cycle. Actual independent semantic
checks, a new independently sealed holdout, evidence readiness and the previously
blocked common source-boundary review remain unresolved. New card bodies remain
0/337 and learner simulations 0/3. Existing failed observations remain intact.
