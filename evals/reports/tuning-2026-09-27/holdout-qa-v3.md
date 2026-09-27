# AI QA eval: claude-cli claude-opus-5 qa-v3

- Run: `d6a67fd5-3a07-404a-8bad-978f6a1f4167` started 2026-09-27T05:57:48.954707Z, dataset `seeded-v1`, 100 cards
- Gate (recall >= 0.80 and precision >= 0.70): **FAIL**
- Estimated cost: $3.9205
- Latency: p50 17237 ms, p95 39777 ms

## Overall

| TP | FP | FN | Recall | Precision | F1 | Control FP rate |
|---:|---:|---:|---:|---:|---:|---:|
| 36 | 5 | 10 | 0.7826 | 0.8780 | 0.8276 | 0.0926 |

Defective cards flagged under a category outside their accepted set: 1.

## Per class

| Class | TP | FN | Recall |
|---|---:|---:|---:|
| incorrect_answer | 8 | 0 | 1.0000 |
| multiple_correct | 9 | 0 | 1.0000 |
| answer_leak | 7 | 0 | 1.0000 |
| ambiguous_stem | 3 | 5 | 0.3750 |
| outdated_fact | 6 | 1 | 0.8571 |
| qualifier_mismatch | 3 | 4 | 0.4286 |

## Errors

None.
