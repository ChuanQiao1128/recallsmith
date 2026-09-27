# AI QA eval: claude-cli claude-opus-5 qa-v3

- Run: `3083e7a3-28be-43de-b14f-ad5fcf4a7e3f` started 2026-09-27T06:45:40.704615Z, dataset `seeded-v3` (sha256 `d4a350cb003d932d8e49f83e3e8143d8d829a1d3e9be3bbc90a61b71db09dce2`), 452 items, 2 rep(s)
- Settings: review date 2026-09-27, effort high, structured outputs off (items on 0, off 452)
- Evidence class: **proxy** (a proxy run informs prompt work; it never satisfies the rollout gate by itself)
- Gate (recall >= 0.80 with 95% CI lower bound >= 0.75, precision >= 0.70, control FP rate <= 0.10 with 95% CI upper bound <= 0.15, every class recall >= 0.60 on >= 30 pooled items, >= 2 reps, unscored controls <= 0.02, provider in anthropic/bedrock, the shipping provider/model/prompt version/effort/structured mode, complete `seeded-v3` run): **FAIL**
  - provider 'claude-cli' is not one of ['anthropic', 'bedrock'] (proxy evidence, not rollout evidence)
  - provider 'claude-cli' is not the shipping provider 'bedrock'
  - model 'claude-opus-5' is not the shipping model 'anthropic.claude-opus-5'
- Estimated cost: $19.1200
- Latency: p50 17323 ms, p95 41929 ms

## Overall

| TP | FP | FN | Recall (95% CI) | Precision | F1 | Control FP rate (95% CI) |
|---:|---:|---:|---:|---:|---:|---:|
| 216 | 17 | 10 | 0.9558 (0.92-0.98) | 0.9270 | 0.9412 | 0.0756 (0.05-0.12) |

Precision at a 10% defect prevalence (from recall and the control FP rate; information only): 0.5843.
Unscored (errored/refused/skipped): 0 defective (counted as misses), 1 controls (left out of the FP rate; rate 0.0044).
Defective cards flagged under a category outside their accepted set: 0.

## Per class

| Class | TP | FN | Recall | 95% CI |
|---|---:|---:|---:|---:|
| incorrect_answer | 36 | 0 | 1.0000 | 0.90-1.00 |
| multiple_correct | 30 | 0 | 1.0000 | 0.89-1.00 |
| answer_leak | 26 | 4 | 0.8667 | 0.70-0.95 |
| ambiguous_stem | 29 | 1 | 0.9667 | 0.83-0.99 |
| outdated_fact | 26 | 4 | 0.8667 | 0.70-0.95 |
| qualifier_mismatch | 29 | 1 | 0.9667 | 0.83-0.99 |
| source_unsupported | 40 | 0 | 1.0000 | 0.91-1.00 |

## Per difficulty tier

| Tier | TP | FN | Recall | 95% CI |
|---|---:|---:|---:|---:|
| adversarial | 4 | 0 | 1.0000 | 0.51-1.00 |
| source-silent | 34 | 4 | 0.8947 | 0.76-0.96 |
| subtle | 178 | 6 | 0.9674 | 0.93-0.98 |

## Per repetition

| Rep | Recall | Control FP rate |
|---:|---:|---:|
| 1 | 0.9646 | 0.0619 |
| 2 | 0.9469 | 0.0893 |

## Errors

| Code | Count |
|---|---:|
| SCHEMA_INVALID | 1 |
