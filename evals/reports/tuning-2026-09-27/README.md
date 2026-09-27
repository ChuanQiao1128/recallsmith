# QA prompt tuning, 2026-09-27 (qa-v1 → qa-v3)

> **Status (corrected in Y05, audit round 2).** qa-v3 has **not** passed the rollout gate. Every
> run in this folder is proxy evidence (`claude-cli`, `seeded-v1`, one repetition), and the
> holdout run also fails the gate on substance: `dc-evals score --gate holdout-qa-v3.jsonl`
> reports recall 0.7826 < 0.80, `ambiguous_stem` recall 0.3750 and `qualifier_mismatch` recall
> 0.4286 below the 0.60 floor, and a control FP rate whose 95% interval reaches 0.199 (the dev run
> fails with `ambiguous_stem` at 0.1429). The holdout comparison below is also not fully clean
> (see step 3). The clean measurement is the run on `seeded-v3`, a dataset qa-v3 has never
> seen, of the configuration that ships:
> `dc-evals run --provider bedrock --model anthropic.claude-opus-5 --dataset v3 --reps 2`,
> then `dc-evals score --gate` exiting 0 (`evals/README.md`, "Rollout"). Until that report is
> committed, `AI_QA_ENABLED` stays `0`.

Model: Claude Opus 5 (`claude-opus-5`), run locally through the owner's Claude Code CLI
(`dc-evals run --provider claude-cli`; structured outputs off = the Bedrock path). Bedrock model
access for this account is still pending the Anthropic use-case form, so no Bedrock run exists yet.
Review date 2026-09-27. Dataset `seeded-v1` (200 cards: 100 seeded defects, 100 untouched controls).

## Method (dev/holdout split; see the contamination note in step 3)

1. Baseline: qa-v1 on all 200 cards → `../2026-09-27-claude-cli-claude-opus-5-qa-v1.*`.
2. Split by card number: odd ids = **dev** (`split-dev.jsonl`, 100), even ids = **holdout**
   (`split-holdout.jsonl`, 100). Prompt changes were meant to come only from dev errors, but
   see step 3: the control adjudication covered holdout controls too.
3. The 29 controls qa-v1 flagged were adjudicated independently against AWS / Anthropic
   documentation (`adjudication-controls-qa-v1.json`, one verdict per finding with sources):
   5 cards carry real defects, 9 are debatable, 15 are false alarms. The false alarms had two root
   causes that are product facts, not item-specific tuning: the app shows `codeSnippet` and
   `realWorldUsage` only after the learner answers, and the deck reflects AWS/Anthropic changes newer
   than the model's training data (for example the S3 Standard-IA 30-day minimum removed on
   2026-07-16, regional NAT gateways, `AnthropicBedrockMantle`).
   **Holdout contamination.** This adjudication looked at all 29 flagged controls, not only the
   dev half: 16 of the 29 ids are holdout rows (7 debatable, 6 false alarms, 3 real defects by
   id; 9 false-alarm findings), and holdout false alarms such as s-0010 and s-0038 (a newer API
   or limit the model did not recognise) and s-0116, s-0118, s-0146 and s-0158 (code or usage
   that is answer-side) are among the root causes behind the two main qa-v3 rules. So the
   holdout was inspected before qa-v3 was written, and its qa-v3 numbers are not a clean
   held-out result. Future tuning adjudicates only dev rows before the prompt is frozen.
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

On the holdout half qa-v3 keeps recall and cuts false alarms on untouched cards from 16 to 5
(−69%), but that half informed the qa-v3 rules through the control adjudication (step 3), so
the reduction is an optimistic estimate, not a clean held-out result. qa-v1 rows for
dev/holdout are the baseline run re-scored on each half.

## Known limits of seeded-v1 (why recall plateaus near 0.78–0.80)

- `ambiguous_stem` mutations delete the qualifier ("LEAST operational overhead") from the stem. In
  6 of the 7 dev cards the remaining stated requirements still select exactly one option (e.g.
  "no one, including the root user, can delete" → only Object Lock compliance mode), so the
  mutated card is not actually ambiguous and the reviewer is right not to flag it. Counted as FN.
- Some `qualifier_mismatch` swaps pick a qualifier the options happen to tie on; the reviewer then
  reports a minor "qualifier does not discriminate" note instead of a major finding.
- `seeded-v2` (X04) adds a `source_unsupported` class and gives every card a source, but it
  reuses the v1 `ambiguous_stem` and `qualifier_mismatch` templates unchanged (an earlier version
  of this line said it rewrote them; it did not). qa-v3 on it (`../2026-09-27-claude-cli-claude-opus-5-qa-v3.md`,
  240 cards, 1 rep): recall 0.817, precision 0.899, control FP rate 0.092; `ambiguous_stem` 0.40
  is the template problem, not the reviewer.
- `seeded-v3` (Y05) replaces those two classes with constructions that are ambiguous or mismatched
  by construction and removes the surface cues of the v2 subtle tiers. qa-v3 on it
  (`../2026-09-27-claude-cli-claude-opus-5-qa-v3-seeded-v3.md`, 226 cards x 2 reps = 452 reviews):
  recall 0.956 (95% CI 0.92-0.98), precision 0.927, F1 0.941, control FP rate 0.076 (0.05-0.12),
  every class >= 0.87. Every substantive gate condition passes; the gate still reports FAIL only on
  provenance (claude-cli is proxy evidence; the shipping provider is Bedrock), so `AI_QA_ENABLED`
  stays `0` until the same command runs on Bedrock.
- qa-v4 (audit pass 3: answer-side code never makes an answer_leak; a false fact inside
  codeSnippet / realWorldUsage is incorrect_answer) on the same seeded-v3 set
  (`../2026-09-27-claude-cli-claude-opus-5-qa-v4-seeded-v3.md`, 452 reviews): recall 0.951
  (0.92-0.97), precision 0.943, F1 0.947, control FP rate 0.058 (0.03-0.10). Versus qa-v3:
  precision +0.016 and control FP rate -0.018 at the same recall. Gate status is unchanged:
  every substantive condition passes, provenance (Bedrock) is the only open condition.

Estimated cost of all runs at Bedrock list prices: ≈ $72 (seeded-v1 tuning $23, seeded-v2 $9.87, seeded-v3 qa-v3 $19.12, seeded-v3 qa-v4 $19.41) (the runs used the owner's local
subscription, so nothing was billed).
