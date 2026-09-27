# QA prompt tuning, 2026-09-27 (qa-v1 → qa-v3)

Model: Claude Opus 5 (`claude-opus-5`), run locally through the owner's Claude Code CLI
(`dc-evals run --provider claude-cli`; structured outputs off = the Bedrock path). Bedrock model
access for this account is still pending the Anthropic use-case form, so no Bedrock run exists yet.
Review date 2026-09-27. Dataset `seeded-v1` (200 cards: 100 seeded defects, 100 untouched controls).

## Method (no tuning on the test half)

1. Baseline: qa-v1 on all 200 cards → `../2026-09-27-claude-cli-claude-opus-5-qa-v1.*`.
2. Split by card number: odd ids = **dev** (`split-dev.jsonl`, 100), even ids = **holdout**
   (`split-holdout.jsonl`, 100). Prompt changes were derived only from dev errors.
3. The 29 controls qa-v1 flagged were adjudicated independently against AWS / Anthropic
   documentation (`adjudication-controls-qa-v1.json`, one verdict per finding with sources):
   5 cards carry real defects, 9 are debatable, 15 are false alarms. The false alarms had two root
   causes that are product facts, not item-specific tuning: the app shows `codeSnippet` and
   `realWorldUsage` only after the learner answers, and the deck reflects AWS/Anthropic changes newer
   than the model's training data (for example the S3 Standard-IA 30-day minimum removed on
   2026-07-16, regional NAT gateways, `AnthropicBedrockMantle`).
4. qa-v2 (dev): explicit multiple-choice procedure; `answer_leak` limited to decisive surface cues.
5. qa-v3 (dev): + answer-side fields; + "a claim newer than your knowledge is not evidence it is
   false — do not block on uncertainty"; + the stated-requirement rule that separates
   `ambiguous_stem` / `qualifier_mismatch` / `multiple_correct`.
6. qa-v3 measured once on the holdout half.

## Results

| Run | Cards | TP | FP | FN | Recall | Precision | Control FP rate | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| qa-v1 dev | 100 | 43 | 13 | 11 | 0.796 | 0.768 | 0.283 | 0.782 |
| qa-v2 dev | 100 | 41 | 10 | 13 | 0.759 | 0.804 | 0.217 | 0.781 |
| qa-v3 dev | 100 | 43 | 4 | 11 | 0.796 | 0.915 | 0.087 | 0.852 |
| **qa-v1 holdout** | 100 | 36 | 16 | 10 | 0.783 | 0.692 | 0.296 | 0.735 |
| **qa-v3 holdout** | 100 | 36 | 5 | 10 | 0.783 | 0.878 | 0.093 | 0.828 |

On the held-out half qa-v3 keeps recall and cuts false alarms on untouched cards from 16 to 5
(−69%). qa-v1 rows for dev/holdout are the baseline run re-scored on each half.

## Known limits of seeded-v1 (why recall plateaus near 0.78–0.80)

- `ambiguous_stem` mutations delete the qualifier ("LEAST operational overhead") from the stem. In
  6 of the 7 dev cards the remaining stated requirements still select exactly one option (e.g.
  "no one, including the root user, can delete" → only Object Lock compliance mode), so the
  mutated card is not actually ambiguous and the reviewer is right not to flag it. Counted as FN.
- Some `qualifier_mismatch` swaps pick a qualifier the options happen to tie on; the reviewer then
  reports a minor "qualifier does not discriminate" note instead of a major finding.
- `seeded-v2` (X04) rewrites those templates, adds a `source_unsupported` class and gives every
  card a source; the stricter gate (control FPR ≤ 0.10, per-class recall floor, complete runs,
  precision at 10% prevalence) applies to it. Its run is the next report in this folder's parent.

Estimated cost of all runs at Bedrock list prices: ≈ $23 (the runs used the owner's local
subscription, so nothing was billed).
