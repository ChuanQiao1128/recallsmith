# Case study: redesigning card authoring around an AI agent, a human gate and a measured QA check

DeveloperCards is a spaced-repetition flashcard product for developers (a mobile app, an admin
console and an AWS backend), built and run by one person. Release 1.8.0 changes how cards are
written, checked and shipped. This document describes the process before and after, how the AI
quality check was evaluated, what was measured, and what is still waiting on the owner.

**Rule for every number here:** it comes from a committed file, cited by path. Anything not
measured yet is written ‹owner to measure›.

**Status on 2026-09-27, in one paragraph.** The authoring agent, the review queue, the webhooks,
the n8n recipes and the automation ledger are built. The cloud AI QA check is built and
evaluated, but switched off: `AI_QA_ENABLED` is `"0"` in both `services/ai-qa/env/prod.env.json`
and `src_C/env/prod.env.json`, because its evaluation, which meets every accuracy condition, ran
through a local proxy rather than the production Bedrock path (section 5.7). The production
ledger has no live runs yet; its only data is a backfill of history priced with placeholder
baselines (section 6).

---

## 1. The problem

The two current decks are large and fact-dense: `aws-saa-c03` has 371 cards
(`content/decks/aws-saa-c03.REPORT.md`, section 1) and `claude-ccdv-f` has 441
(`content/decks/claude-ccdv-f.REPORT.md`, section 1). Many cards state limits, defaults and
product behaviour that the vendors change often. The goals of the redesign:

1. Let an AI do the slow part (reading documentation and drafting cited cards) without letting it
   publish anything.
2. Put a named person's decision on every card, with the source in front of them.
3. Add an independent check before publish, and measure how good that check is before trusting it.
4. Tell the team when something needs attention instead of making them poll a console.
5. Record what the automation does, so claims about time saved rest on data, not on guesses.

---

## 2. Before (up to release 1.7.0)

How the full `aws-saa-c03` deck was produced on 2026-09-21, as recorded in
`content/decks/aws-saa-c03.REPORT.md`:

1. Cards were drafted in 21 Markdown fragments in the deck format
   (`content/decks/FORMAT.md`), from a backlog of 492 planned rows.
2. Sources and fact checks were kept in a separate CSV ledger, one row per fact and source page
   (`content/decks/aws-saa-c03.ledger.csv`, 911 rows). The cards themselves had no source field.
3. A one-off script assembled the fragments into one file, and the lint script
   (`frontend/scripts/lint-deck.mts`) checked the format.
4. The file was pasted into the console importer, which wrote the cards straight into the deck.
5. The deck was published through the existing publish pipeline.

What that process lacked:

| Gap | Consequence |
|---|---|
| The source lived in a CSV, not on the card | A reviewer in the console, and a learner in the app, could not see why a card is true. |
| No separate approval step | Whatever was pasted into the importer became a card. The only automatic gates were format lint and the multiple-choice publish check. |
| No independent content check | Errors that pass lint (a wrong limit, two correct options, a stem that gives the answer away) were caught only if the author noticed. Section 5.3 shows such errors existed. |
| No notifications | Publishes and failures were visible only by looking at the console. |
| No measurement | Nobody recorded how long a card took, how many were fixed, or what automation saved. |

History recovered by the ledger backfill: 117 successful publishes and 11 bulk imports totalling
941 cards between December 2025 and September 2026
(`docs/showcase/data/ledger-2025-10-01_2026-09-27.json`, `automations` and `series`). The imports
are inferred, not logged: the backfill counts 5 or more cards created in the same minute as one
import (`src_C/Vpc/Ledger/LedgerRoutes.cs`, `BackfillHeuristic`).

---

## 3. After (release 1.8.0)

```
 OWNER'S MACHINE (local, owner's Claude subscription)          AWS (production)
 ─────────────────────────────────────────────────            ────────────────
 Claude Code + author-cards skill
   │  read_source ──► dc-ingest: PDF/web page → numbered chunks
   │  find_similar_cards ─────────────────────────────────►  similarity search
   │  verifier sub-agent (sees only card + chunk)
   │  lint_card (the console importer's own rules)
   └► submit_draft ──(agent token: 3 endpoints only)──────►  review queue (ai_drafts)
                                                                  │ webhook review.queued
                                           HUMAN: /review  ◄──────┘
                                           accept / edit / reject + reason
                                                                  │ accepted → card in deck
                                           HUMAN: /decks/qa  ─────► AI QA run
                                                 core-vpc → SQS → ai-qa Lambda → Claude Opus 5
                                                 (Bedrock) → signed callback → findings
                                                 webhook card.flagged ◄┘
                                           HUMAN: publish ───────► publish gate → build → app
                                                                  │ webhook deck.published
 n8n (owner-hosted) ◄── signed webhooks ── dispatcher Lambda ◄────┘
   Slack · Google Sheet · weekly email
                                           every step above ───► automation ledger (/ledger)
```

| Stage | What runs where | Guardrail | Detail |
|---|---|---|---|
| Ingest | `dc-ingest`, a Python CLI on the owner's machine, turns a PDF, web page or text file into numbered chunks. | https URLs only; local files only from an allowed folder; credentials folders refused; page text is data, never instructions. | `tools/ingest/README.md` |
| Draft | Claude Code on the owner's subscription, following the `author-cards` skill, calls the DeveloperCards MCP server (four tools: `read_source`, `find_similar_cards`, `lint_card`, `submit_draft`). A sub-agent that sees only the card and its chunk checks that the chunk supports it. | The skill writes drafts only, never deck files; one fact per card; no copying exam dumps. | `.claude/skills/author-cards/SKILL.md`, `tools/mcp-server/README.md`, `.mcp.json` |
| Ground | `submit_draft` refuses a card unless its quote appears word for word in a chunk the agent read in the same session; quotes under 40 characters or 6 words are refused as too vague. | The reviewer only ever sees quotes that exist in the cited document. | `tools/mcp-server/README.md` (`submit_draft`, `lint_card`) |
| Human review | Console page `/review`: card, source link, highlighted quote, similar cards, lint. Accept, accept with edits, or reject with a reason. | The agent's token cannot call accept, reject, publish, QA or anything else. Decisions are append-only. | `frontend/src/pages/ReviewQueuePage.tsx`, `src_C/Vpc/Review/Drafts.cs`, `docs/showcase/reviewer-guide.md` |
| AI QA | A person starts a run on `/decks/qa`. core-vpc queues chunks of up to 5 cards on SQS; the `developercards-ai-qa` Lambda (outside the VPC) calls Claude Opus 5 on Bedrock once per card and posts typed findings back over an HMAC-signed callback. | Off by default; per-run card cap and daily USD cap; category fixes severity; card text is data, never instructions; emergency stop documented. | `services/ai-qa/README.md`, `infra/RUNBOOK.md` section 7 |
| Publish gate | When the owner sets both `AI_QA_ENABLED` and `AI_QA_REQUIRED`, publish refuses changed cards that have no review at their current content, or that have an open blocker. The build then refuses cards that changed after the gate passed. | Never blocks while either flag is off. | `src_C/Vpc/Qa/QaGate.cs`, `src_C/Vpc/Db/Migrations/033_ai_qa_drafts_round2.sql` |
| Notify | Events (`review.queued`, `card.flagged`, `deck.published`, `import.failed`) go through SQS to a dispatcher Lambda that signs and delivers them, with retries and a dead-letter queue. Two n8n recipes turn them into Slack messages, Sheet rows and a weekly email. | HMAC-SHA256 signature with a 300 s timestamp window; receiver dedupes by delivery id; the dispatcher refuses private and localhost targets. | `services/webhook-dispatcher/README.md`, `integrations/n8n/README.md` |
| Measure | Every automation writes a ledger row: units, outcome, human minutes, defects caught. The `/ledger` page turns them into hours saved against per-unit baselines. | Baselines are labelled default or measured; backfilled history is shown separately from live data; recorded review time is capped at 30 minutes per draft. | `src_C/Vpc/Db/Migrations/028_automation_ledger.sql`, `frontend/src/pages/LedgerPage.tsx` |

On the learner side, the app gains a Mistake Book (missed cards plus related cards to review,
no AI involved; `mobile/src/screens/MistakeBookScreen.tsx`) and a Source row on the card detail
screen (`mobile/src/content/cardSource.ts`).

---

## 4. Before and after

| | Before (up to 1.7.0) | After (1.8.0) |
|---|---|---|
| Who drafts | The author, outside the product, into Markdown fragments; nothing records how each card was drafted | A local agent on the owner's subscription, with the agent, model and skill version stored on each draft; a person reviews |
| Where the source lives | A separate CSV (`content/decks/aws-saa-c03.ledger.csv`) | On the card: `source.url` plus a verbatim `source.quote`, checked against the fetched text at submit |
| Duplicate check | Manual, at assembly time | Similarity search per draft; top matches shown to the reviewer |
| Fact check before a human sees it | The author's own check rows in the CSV | Verifier sub-agent (card + chunk only), then the human reviewer |
| Format check | Lint script and importer | The same rules, run by the agent before submit and again in the review page |
| Approval | None separate from authoring: import wrote cards directly | Review queue: accept, edit or reject with a reason; the agent cannot decide |
| Independent content QA | None | AI QA per changed card, with severity and suggested fix; can block publish (flag-gated, off today) |
| Notifications | None | Signed webhooks to n8n: Slack, Google Sheet, weekly email |
| Measurement | None | Automation ledger: runs, units, human minutes, defects caught, false positives |
| Minutes to produce one accepted, cited card | Not recorded | ‹owner to measure› (the ledger's 12 minutes for a hand-authored card is a placeholder default, not a measurement: `src_C/Vpc/Db/Migrations/028_automation_ledger.sql`) |
| Share of AI drafts accepted, edited, rejected as defects | n/a | ‹owner to measure›: no draft has been decided in production yet (`agentDrafts.decided = 0` in `docs/showcase/data/ledger-2025-10-01_2026-09-27.json`) |
| Model cost to draft | Not recorded | No per-call bill: it runs on the owner's existing subscription (`docs/ai-agents-plan-2026-09-27.md`, decision update item 1) |
| Model cost to QA one card | n/a | About $0.042 estimated at Bedrock list prices ($19.12 for 452 reviews in `evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v3-seeded-v3.md`); real Bedrock bill ‹owner to measure› |
| QA latency per card | n/a | Median 17.3 s, 95th percentile 41.9 s through the proxy (same report); on Bedrock ‹owner to measure› |

---

## 5. Evaluation: is the AI QA check good enough to trust?

A check that blocks good cards, or that reviewers learn to ignore, can do more harm than good. So
the QA check was measured before it could be switched on, and the switch is tied to a written pass
bar.

### 5.1 Method

- **Seeded-defect datasets.** Real cards from the two decks are copied; some copies get one
  deliberate defect of a known class (wrong answer, two correct options, answer leak, ambiguous
  stem, outdated fact, qualifier mismatch, and from v2 on a quote that does not support the
  answer); the rest stay untouched as **controls** (`evals/README.md`).
- **Scoring.** A card counts as flagged when it gets at least one blocker or major finding.
  Recall = seeded defects caught with an accepted category. Precision = share of flagged cards
  that were seeded defects. **Control false-positive (FP) rate** = share of untouched cards
  flagged; this is the number a reviewer feels as noise.
- **Same code as production.** The harness imports the Lambda's own review function, prompt,
  schema and settings (`evals/README.md`, first section).
- **Pass bar** (`evals/README.md`, "Gate"): recall at least 0.80 with its 95% lower bound at least
  0.75; precision at least 0.70; control FP rate at most 0.10 with its 95% upper bound at most
  0.15; every defect class at least 0.60 recall on at least 30 items; at least 2 repetitions; and
  the run must use the shipping provider, model, prompt version and settings.

### 5.2 Baseline: prompt qa-v1

On `seeded-v1` (200 cards: 100 seeded, 100 controls), qa-v1 reached recall 0.790, precision 0.732
and a control FP rate of 0.290. It caught every wrong answer, double answer and answer leak, but
only 2 of 15 ambiguous stems (recall 0.133). It failed the bar in force at the time, recall at
least 0.80 and precision at least 0.70 (`evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v1.md`).

The number that mattered most was 29 of 100 untouched cards flagged. With that much noise,
reviewers would soon stop reading the findings.

### 5.3 Error analysis: the "false alarms" were not all false

Each of the 33 findings on those 29 flagged controls was adjudicated against the current AWS and
Anthropic documentation, one verdict per finding, with the sources recorded
(`evals/reports/tuning-2026-09-27/adjudication-controls-qa-v1.json`):

| Verdict | Findings | Cards |
|---|---:|---:|
| Real defect | 5 | 5 |
| Debatable | 9 | 9 |
| False alarm | 19 | 15 (plus one card that also has a real defect) |

**Five real defects.** All five are in untouched cards from the committed `claude-ccdv-f` deck,
cards that had already passed lint and the author's source check. One teaches that a tool
definition has "three required fields" when the API marks `description` optional; four are
multiple-choice cards whose right option echoes the question's wording, so a learner can pick it
without knowing the topic. The deck text of these five cards is unchanged at this commit
(`content/decks/claude-ccdv-f.md`); fixing them is an open content task.

**Seventeen of the 19 false-alarm findings had two root causes, both product facts the prompt
did not state** (classified from each finding's `reason` field in the same file):

- **9 were the model's knowledge being older than the deck.** It called real, recent changes wrong,
  for example the S3 Standard-IA 30-day transition minimum that AWS removed on 2026-07-16,
  regional NAT gateways, and the `AnthropicBedrockMantle` client.
- **8 were "answer leaks" in fields learners never see while answering.** The app shows the code
  sample and the real-world usage note only after the learner answers, so they cannot give the
  answer away.
- The remaining 2 were plain model errors (Rekognition handwriting support; MFA context on
  AssumeRole credentials).

The lesson: a slice of the "false positives" were the grader being out of date, and a separate
slice were true positives that the untouched-control label hid. The response was to change the
prompt, and later the dataset, not to loosen the pass bar.

### 5.4 Prompt changes and the dev/holdout check

Cards were split by id into a dev half and a holdout half (`evals/reports/tuning-2026-09-27/README.md`):

- **qa-v2:** an explicit multiple-choice procedure; `answer_leak` limited to decisive surface cues.
- **qa-v3:** code and usage notes declared answer-side; "a claim newer than your knowledge is not
  evidence it is false; do not block on uncertainty"; a rule that separates ambiguous stem,
  qualifier mismatch and multiple correct by what the stem actually states
  (`services/ai-qa/src/ai_qa/prompts.py`).

| Run (seeded-v1 halves) | Recall | Precision | Control FP rate |
|---|---:|---:|---:|
| qa-v1 dev | 0.796 | 0.768 | 0.283 |
| qa-v2 dev | 0.759 | 0.804 | 0.217 |
| qa-v3 dev | 0.796 | 0.915 | 0.087 |
| qa-v1 holdout | 0.783 | 0.692 | 0.296 |
| qa-v3 holdout | 0.783 | 0.878 | 0.093 |

Source: `evals/reports/tuning-2026-09-27/README.md`, "Results". On the holdout half, false alarms
on untouched cards fell from 16 to 5. **This holdout is contaminated**: the adjudication in 5.3
looked at all 29 flagged controls, 16 of which are holdout rows, and some of those shaped the
qa-v3 rules. The holdout figures are therefore optimistic, and the tuning README says so.

### 5.5 Fixing the dataset, not only the prompt

Recall on `seeded-v1` stalled near 0.78 to 0.80 because some mutations did not create the defect
they were labelled with: in 6 of the 7 dev cards, deleting "LEAST operational overhead" from the
stem still left exactly one option that met the remaining requirements, so the reviewer was right
not to flag them (`evals/reports/tuning-2026-09-27/README.md`, "Known limits").

- `seeded-v2` added the `source_unsupported` class but reused the weak templates. qa-v3 scored
  recall 0.817, precision 0.899, control FP rate 0.092, with ambiguous-stem recall 0.40
  (`evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v3.md`).
- `seeded-v3` was rebuilt so each judgment-class defect is defective by construction, each with a
  hand-reviewed rationale; controls are matched to defects on length and shape so no surface cue
  separates them; and it was never used for tuning (`evals/README.md`, "Dataset seeded-v3").

### 5.6 Final measurement: qa-v3 on seeded-v3

226 cards (113 seeded, 113 controls) × 2 repetitions = 452 reviews
(`evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v3-seeded-v3.md` and `.json`):

| Metric | Result | Pass bar |
|---|---:|---:|
| Recall (95% CI) | **0.956** (0.92 to 0.98) | ≥ 0.80, lower bound ≥ 0.75 |
| Precision | **0.927** | ≥ 0.70 |
| F1 | 0.941 | n/a |
| Control FP rate (95% CI) | **0.076** (0.05 to 0.12) | ≤ 0.10, upper bound ≤ 0.15 |
| Lowest class recall | 0.867 (answer leak, outdated fact) | ≥ 0.60 per class |
| Errors | 1 `SCHEMA_INVALID` of 452 | unscored controls ≤ 2% (0.44%) |
| Latency | p50 17.3 s, p95 41.9 s | n/a |
| Estimated cost | $19.12 | n/a |

Every substantive condition passes. The report still says **FAIL**, for provenance only: the
provider was `claude-cli`, not `bedrock`, and the model id was `claude-opus-5`, not
`anthropic.claude-opus-5`.

Baseline to final (different datasets, so read as direction, not as a controlled A/B): recall
0.790 → 0.956, precision 0.732 → 0.927, control FP rate 0.290 → 0.076.

### 5.7 Caveats, stated plainly

1. **Proxy provider.** Every run went through the owner's local Claude Code CLI
   (`dc-evals run --provider claude-cli`), because this AWS account cannot call Claude on Bedrock
   until the owner submits Anthropic's use-case form. The proxy uses the same prompt, parsing and
   repair logic, but sends the repair turn as a single message, adds a little Claude Code context,
   and reports estimated token counts (`evals/src/dc_evals/claude_cli.py`). The gate therefore
   treats it as proxy evidence, and `AI_QA_ENABLED` stays `0` until the same command passes on
   Bedrock.
2. **Holdout contamination** of the seeded-v1 split, as described in 5.4.
3. **Seeded is not natural.** Defects were planted by the project, and the seeded-v3 constructions
   were written and reviewed inside the project, not by an independent party.
4. **Prevalence.** Precision 0.927 is at the dataset's 50% defect rate. At a 10% defect rate the
   same reviewer would have precision of about 0.58, so roughly 4 in 10 flags would be false alarms
   (`precisionAtPrevalence` in the seeded-v3 report). The real defect rate of new drafts is
   ‹owner to measure›. This is why reviewers can dismiss findings and why only blockers can block.
5. **Unflagged controls were not adjudicated.** The five real defects came from the 29 flagged
   controls; the 71 unflagged ones were not checked, so defects the model missed there are
   unknown.
6. **Cost figures are estimates.** All runs together come to about $52 at Bedrock list prices; they
   used the owner's subscription, so nothing was billed (`evals/reports/tuning-2026-09-27/README.md`,
   last line).

---

## 6. What the automation ledger shows today

Export from the production ledger for 2025-10-01 to 2026-09-27
(`docs/showcase/data/ledger-2025-10-01_2026-09-27.json`):

| | Value |
|---|---:|
| Runs | 128 |
| Units | 1,058 (117 publishes, 941 imported cards) |
| Hours saved (as computed) | 62.53 |
| Live runs | 0 |
| Human minutes recorded | 0 |
| Defects caught before publish | 0 |
| AI drafts decided | 0 |

**All 62.53 hours come from backfilled history priced with default baselines.** The export's own
breakdown says so: `totals.bySource.backfill.hoursSaved` is 62.53 and `bySource.live` is 0;
`byBaselineSource.default.minutesSaved` is 3,751.5 and `measured` is 0. The defaults (20 minutes
per publish, 1.5 minutes per imported card) are placeholders seeded by the migration, marked "to be
measured and replaced" (`src_C/Vpc/Db/Migrations/028_automation_ledger.sql`). So 62.53 hours is
the count of real past events multiplied by placeholder minutes, not a measured saving.

What would turn it into evidence (‹owner to measure›):

- Time a few hand-authored cited cards, a manual second-reader QA pass and a manual publish, and
  store them as measured baselines on the `/ledger` page.
- Run the first live authoring batch through `/review`; the ledger then records review time per
  decision and the agent's acceptance, edit and defect rates.
- Run AI QA on Bedrock; findings marked fixed and dismissed then give live defects-caught and
  false-positive counts.

---

## 7. Design decisions and trade-offs

**No in-app AI tutor yet; a Mistake Book instead.** The original plan included an AI that explains
wrong answers to learners. Server data showed no card-level answer data for any deck in the
previous 30 days, so there was no demand signal for it
(`docs/ai-agents-plan-2026-09-27.md`, decision update). The app got a Mistake Book with related-card
review instead: plain TypeScript, no model cost, shippable as an over-the-air update to the 1.7.0
app. The tutor design is kept for when usage justifies it. Trade-off: no user-facing AI in this
release, in exchange for no per-learner model cost and no new privacy surface.

**Authoring runs locally on the owner's Claude subscription.** Drafting is done by one person,
when they choose to. Running it in Claude Code with an MCP server means no per-call model
bill, no cloud agent service, no API key in the cloud, and no new infrastructure (the original
plan's Bedrock VPC endpoint and Step Functions pipeline were dropped). Costs: throughput is limited
by the subscription's usage window, so a large deck takes several sessions; and the subscription
is used only by the owner on the owner's machine, never as a service for others
(`docs/ai-agents-plan-2026-09-27.md`, decision update items 1 and 5). The plan's running-cost
estimate fell from about $35 a month to about $2 to $7 a month; that is a planning estimate, not a
bill.

**The QA check runs in the cloud on Bedrock, and every flag defaults to off.** A publish gate has
to run where publishing happens. The backend's VPC has no internet access, so the check is a
separate Lambda outside the VPC, reached through SQS, calling Bedrock with the Lambda's IAM role:
no API key to store or rotate. The role may call exactly one model
(`infra/modules/identity/roles_r18.tf`, `bedrock-mantle:CreateInference` pinned to one model id).
Anything that spends money or can block an author is off until measured: `AI_QA_ENABLED=0` and
`AI_QA_REQUIRED=0`, a 200-card cap per run and a daily USD cap
(`src_C/env/prod.env.json`). Stopping it in an emergency means disabling the queue consumer, which
takes effect at once (`infra/RUNBOOK.md`, "Emergency stop for the SQS consumers").

**Other choices in the QA call** (`services/ai-qa/README.md`):

- No fallback model on refusal: a silent switch would make the measured numbers describe a model
  that did not answer.
- The finding's category decides its severity, so the gate follows the written rubric even when
  the model's own severity disagrees.
- Card text and quotes are passed as data inside tags, with the system prompt stating they are
  never instructions.
- Structured outputs are off on Bedrock because the Bedrock endpoint in use does not support them;
  replies are validated against the same schema, with one repair turn.

**The agent's token is least-privilege.** The MCP server signs in as the owner through a separate
app client. A token from that client can reach three endpoints only: list decks, find similar cards
and submit drafts. Everything else, including accept, reject, publish, QA, webhooks and the ledger,
answers 403 `AGENT_CLIENT_FORBIDDEN` (`src_C/Vpc/AgentClientPolicy.cs`). API Gateway enforces the
same three routes with a separate authorizer (`infra/modules/api/gateway.tf`), and a check script
exits non-zero if the gateway routes, the MCP server's calls and the backend allowlist drift apart
(`infra/scripts/check-agent-routes.py`). So even a prompt-injected agent cannot approve or publish
its own work.

**Measure before claiming.** The ledger stores events, not savings; savings are computed when read
from baselines that are labelled default or measured. Backfilled history and live data are shown
separately, failures save nothing, and human review time is subtracted
(`src_C/Vpc/Db/Migrations/028_automation_ledger.sql`). That is why section 6 can say exactly how
much of its headline number is placeholder.

---

## 8. What remains owner-gated

In order (`services/ai-qa/README.md`, "Rollout"; `evals/README.md`, "Gate"):

1. **Bedrock access.** Submit the Anthropic use-case form in the Bedrock console. Until then
   Bedrock answers this account with an access error, which the Lambda reports as
   `PROVIDER_ACCESS_DENIED`.
2. **Re-run the gate on Bedrock**, the shipping configuration:
   `dc-evals run --provider bedrock --model anthropic.claude-opus-5 --dataset v3 --reps 2`, then
   `dc-evals score --gate` must exit 0, and the report is committed. This spends money (the proxy
   run of the same size was estimated at $19.12).
3. **Enable AI QA:** set `AI_QA_ENABLED=1` in `services/ai-qa/env/prod.env.json` and
   `src_C/env/prod.env.json`, then deploy both.
4. **Optionally make it required:** `AI_QA_REQUIRED=1` on the backend, which turns on the publish
   gate.

Also waiting on the owner:

- Fix the five real defects found in 5.3 in `content/decks/claude-ccdv-f.md`.
- Host n8n at a public https URL, add the Slack, Google Sheets and SMTP credentials, and create the
  webhook subscription on `/admin/webhooks` (`integrations/n8n/README.md`, "Setup").
- Replace the default ledger baselines with measured ones (section 6).
- Publish the mobile over-the-air update (Mistake Book, Source row), if it has not gone out yet.

---

## 9. Evidence index

| Claim | File |
|---|---|
| Product decisions (local agent, cloud QA, tutor deferred) | `docs/ai-agents-plan-2026-09-27.md` |
| Baseline eval | `evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v1.md` |
| Prompt tuning, dev/holdout, caveats | `evals/reports/tuning-2026-09-27/README.md` |
| Adjudication of flagged controls | `evals/reports/tuning-2026-09-27/adjudication-controls-qa-v1.json` |
| qa-v3 on seeded-v2 | `evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v3.md` |
| Final measurement (qa-v3 on seeded-v3) | `evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v3-seeded-v3.md` |
| Eval harness, datasets, gate | `evals/README.md` |
| Ledger export | `docs/showcase/data/ledger-2025-10-01_2026-09-27.json` |
| QA Lambda | `services/ai-qa/README.md` |
| Webhook dispatcher | `services/webhook-dispatcher/README.md` |
| MCP server and ingest CLI | `tools/mcp-server/README.md`, `tools/ingest/README.md` |
| Authoring skill | `.claude/skills/author-cards/SKILL.md` |
| n8n recipes | `integrations/n8n/README.md` |
| Operations and alarms | `infra/RUNBOOK.md` |
| Reviewer instructions | `docs/showcase/reviewer-guide.md` |
| Demo script | `docs/showcase/demo-video-script.md` |
