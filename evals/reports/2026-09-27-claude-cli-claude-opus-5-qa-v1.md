# AI QA eval: claude-cli claude-opus-5 qa-v1

- Run: `784a5cfb-b9b9-47bc-ab1e-2835a62c028d` started 2026-09-27T04:58:19.019529Z, dataset `seeded-v1`, 200 cards
- Gate (recall >= 0.80 and precision >= 0.70): **FAIL**
- Estimated cost: $9.8488
- Latency: p50 21192 ms, p95 41982 ms

## Overall

| TP | FP | FN | Recall | Precision | F1 | Control FP rate |
|---:|---:|---:|---:|---:|---:|---:|
| 79 | 29 | 21 | 0.7900 | 0.7315 | 0.7596 | 0.2900 |

Defective cards flagged under a category outside their accepted set: 4.

## Per class

| Class | TP | FN | Recall |
|---|---:|---:|---:|
| incorrect_answer | 20 | 0 | 1.0000 |
| multiple_correct | 20 | 0 | 1.0000 |
| answer_leak | 15 | 0 | 1.0000 |
| ambiguous_stem | 2 | 13 | 0.1333 |
| outdated_fact | 13 | 2 | 0.8667 |
| qualifier_mismatch | 9 | 6 | 0.6000 |

## Errors

None.
