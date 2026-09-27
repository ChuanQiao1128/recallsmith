# AI QA eval: claude-cli claude-opus-5 qa-v3

- Run: `7b9ed62e-4d01-49d3-a93e-3e5448798f46` started 2026-09-27T06:07:04.529012Z, dataset `seeded-v2` (sha256 `21eb85a9df8a435694b45fc3c4e6beaa53307f206c998fc5127f345ff90c0564`), 240 items, 1 rep(s)
- Settings: review date 2026-09-27, effort high, structured outputs off (items on 0, off 240)
- Gate (recall >= 0.80, precision >= 0.70, control FP rate <= 0.10, every class recall >= 0.60, unscored controls <= 0.02, provider in anthropic/bedrock, complete `seeded-v2` run): **FAIL**
  - provider 'claude-cli' is not one of ['anthropic', 'bedrock']
  - class ambiguous_stem recall 0.4000 < 0.60
- Estimated cost: $9.8715
- Latency: p50 17626 ms, p95 33984 ms

## Overall

| TP | FP | FN | Recall (95% CI) | Precision | F1 | Control FP rate (95% CI) |
|---:|---:|---:|---:|---:|---:|---:|
| 98 | 11 | 22 | 0.8167 (0.74-0.88) | 0.8991 | 0.8559 | 0.0917 (0.05-0.16) |

Precision at a 10% defect prevalence (from recall and the control FP rate; information only): 0.4975.
Unscored (errored/refused/skipped): 0 defective (counted as misses), 0 controls (left out of the FP rate; rate 0.0000).
Defective cards flagged under a category outside their accepted set: 1.

## Per class

| Class | TP | FN | Recall | 95% CI |
|---|---:|---:|---:|---:|
| incorrect_answer | 20 | 0 | 1.0000 | 0.84-1.00 |
| multiple_correct | 14 | 6 | 0.7000 | 0.48-0.85 |
| answer_leak | 14 | 1 | 0.9333 | 0.70-0.99 |
| ambiguous_stem | 6 | 9 | 0.4000 | 0.20-0.64 |
| outdated_fact | 14 | 1 | 0.9333 | 0.70-0.99 |
| qualifier_mismatch | 10 | 5 | 0.6667 | 0.42-0.85 |
| source_unsupported | 20 | 0 | 1.0000 | 0.84-1.00 |

## Per difficulty tier

| Tier | TP | FN | Recall | 95% CI |
|---|---:|---:|---:|---:|
| adversarial | 2 | 0 | 1.0000 | 0.34-1.00 |
| easy | 15 | 0 | 1.0000 | 0.80-1.00 |
| subtle | 81 | 22 | 0.7864 | 0.70-0.85 |

## Errors

None.
