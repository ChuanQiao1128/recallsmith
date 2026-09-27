# AI QA eval: claude-cli claude-opus-5 qa-v3

- Run: `5a90b115-961b-4237-81c7-6bb51a8aa34f` started 2026-09-27T05:48:03.945894Z, dataset `seeded-v1`, 100 cards
- Gate (recall >= 0.80 and precision >= 0.70): **FAIL**
- Estimated cost: $4.2845
- Latency: p50 16595 ms, p95 48053 ms

## Overall

| TP | FP | FN | Recall | Precision | F1 | Control FP rate |
|---:|---:|---:|---:|---:|---:|---:|
| 43 | 4 | 11 | 0.7963 | 0.9149 | 0.8515 | 0.0870 |

Defective cards flagged under a category outside their accepted set: 1.

## Per class

| Class | TP | FN | Recall |
|---|---:|---:|---:|
| incorrect_answer | 12 | 0 | 1.0000 |
| multiple_correct | 11 | 0 | 1.0000 |
| answer_leak | 8 | 0 | 1.0000 |
| ambiguous_stem | 1 | 6 | 0.1429 |
| outdated_fact | 6 | 2 | 0.7500 |
| qualifier_mismatch | 5 | 3 | 0.6250 |

## Errors

None.
