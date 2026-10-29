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

## Inactive compact proof transport and content diagnostics

`proof_transport_v4.py` represents every requested subset with an explicit mask
of the chunk-ID-sorted evidence registry. It sends full original evidence once
per group and uses a shared exact-quote registry in responses. The decoder
requires the host's requested memberships and atom IDs, rejects malformed JSON,
duplicate/missing/extra decisions, invalid indices and out-of-subset quotes, and
expands only explicitly returned rows. It never infers a superset decision or
replaces the original metric with prefix checks. Two checker roles receive
identical semantic projections; planning does not execute either role.

The default frozen limit is 255 subsets per call, prompt below 60,000 scalar
characters and raw response at most 48,000 UTF-8 bytes. Oversized prompts fail
before any request is returned. Oversized/truncated responses fail decoding;
a transport limit does not prove that a successful full semantic response fits.
`expand_response` requires keyword-only `atom_ids` as well as exact expected
subset tuples and the sorted chunk registry.

Static sizing against the saved A/B packets plans 296 calls per configuration,
592 total instead of 33,508 in the previous four-subset schedule. It preserves
all 133,432 explicit independent subset decisions. Measured largest prompts are
17,076 scalars for A and 15,935 for B. These use existing reference prose as
sizing fixtures, not reviewed v4 atom-label conversions. The synthetic all-UNKNOWN
response size is only a lower-demand fixture; actual output fit, semantic quality,
model latency, successful execution and protocol approval remain UNKNOWN.
The non-sensitive sizing result is [proof-transport-v4-sizing.json](proof-transport-v4-sizing.json).

`semantic_proof_v4.py` checks source/chunk/quote occurrence identity, exact host
batch membership and bindings, required fact+scope coverage, declared execution
metadata and separate checker identifiers. It computes a **non-authoritative**
diagnostic completion from explicit dual PASS/YES rows only. It does not open raw
receipt paths or authenticate executions, deny capabilities, establish semantic
truth, or reconstruct trusted source-review authority pins. Every result has
`rawExecutionVerified=false` and `releaseAuthorized=false`. Missing/malformed
batches reject rather than disappear from the denominator.

Both modules are offline helpers. They are deliberately disconnected from the
author, MCP, readiness and release gate; their diagnostics cannot unlock any
content calls. The platform-blocked source-boundary review remains UNKNOWN and
has not been retried. New holdout cases, new card bodies and learner simulations
remain zero. These helpers still need full gate/receipt integration and a real
approved execution canary after the required external prerequisites are met.
