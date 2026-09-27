# AI QA eval: claude-cli claude-opus-5 qa-v2

- Run: `d349aca9-156e-4d55-ac95-6757c1f5504b` started 2026-09-27T05:32:39.350660Z, dataset `seeded-v1`, 100 cards
- Gate (recall >= 0.80 and precision >= 0.70): **FAIL**
- Estimated cost: $4.9815
- Latency: p50 19728 ms, p95 64064 ms

## Overall

| TP | FP | FN | Recall | Precision | F1 | Control FP rate |
|---:|---:|---:|---:|---:|---:|---:|
| 41 | 10 | 13 | 0.7593 | 0.8039 | 0.7810 | 0.2174 |

Defective cards flagged under a category outside their accepted set: 1.

## Per class

| Class | TP | FN | Recall |
|---|---:|---:|---:|
| incorrect_answer | 12 | 0 | 1.0000 |
| multiple_correct | 11 | 0 | 1.0000 |
| answer_leak | 8 | 0 | 1.0000 |
| ambiguous_stem | 0 | 7 | 0.0000 |
| outdated_fact | 5 | 3 | 0.6250 |
| qualifier_mismatch | 5 | 3 | 0.6250 |

## Errors

None.
