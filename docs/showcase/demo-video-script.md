# Demo video script: AI drafts, human decisions, measured QA (2 min 58 s)

**Audience:** a hiring manager or a non-engineering reviewer. **Goal:** in under three minutes,
show the human-in-the-loop authoring pipeline end to end (agent → review queue → AI QA → publish →
notifications → ledger) and one honest evaluation result.

**Format:** screen recording at 1920×1080 with voice-over and burned-in captions. Speed up long
waits (agent tool calls, AI QA run) 2× to 4× and mark them with a small "sped up" caption.
Narration is about 380 words, a relaxed 150 words a minute, leaving room for the on-screen actions.

Every number spoken or shown comes from a committed file listed under "Sources" below. Background
for the narrator: `docs/showcase/process-redesign-case-study.md`.

---

## Before recording (owner checklist)

- [ ] **Demo deck.** Create a throwaway deck for the recording (for example slug `demo-recording`),
      so accepted demo cards never land in a real deck. There is no staging environment, so this
      deck lives in production: do **not** publish it (see shot 8).
- [ ] **Publish shot.** Shot 8 needs a real publish. Either publish a real deck whose accepted
      cards you intend to ship anyway, or skip the click and show a `deck.published` row from an
      earlier real publish in the Sheet.
- [ ] **Agent ready.** MCP server built and signed in, `developercards` approved in Claude Code
      (`/mcp` lists four tools), `uv` installed (`.claude/skills/author-cards/SKILL.md`, "Setup").
- [ ] **Source page.** An official AWS documentation page. `content/decks/aws-saa-c03.ledger.csv`
      lists the pages the deck already cites; a page not on that list gives fewer duplicates.
- [ ] **n8n live.** n8n at a public https URL with both workflows active, and a subscription on
      `/admin/webhooks` for `review.queued`, `card.flagged`, `deck.published` and `import.failed`
      (`integrations/n8n/README.md`, "Setup"). Press **Send test** once to confirm delivery.
- [ ] **AI QA state.** Shot 6 needs `AI_QA_ENABLED=1`, which waits for the Bedrock gate run
      (case study, section 8). **Do not switch it on just for the video.** If it is still off,
      record shot 6 as its "B" variant below. When it is on, a 5-card run is estimated at about
      $0.21 (5 × $0.042, the per-card estimate in the case study's before-and-after table).
- [ ] **Ledger range.** On `/ledger`, set From `2025-10-01`, To `2026-09-27`, granularity month,
      so the tiles match the committed export. The page defaults to the last 90 days.
- [ ] **Nothing secret on screen.** No terminal showing tokens or `.env`; the Webhooks page shows
      only the SSM parameter name, never the secret. Blur email addresses in Slack and the Sheet.

---

## Shot list

| # | Time | On screen | Narration |
|---|---|---|---|
| 1 | 0:00–0:11 | Title card: "DeveloperCards: AI drafts, human decisions, measured QA". Owner's name underneath. | "DeveloperCards is a flashcard app for developers that I build alone. This is how I rebuilt card authoring around an AI agent that is never allowed to publish." |
| 2 | 0:11–0:22 | Split screen. Left: a card in `content/decks/aws-saa-c03.md` and rows of `content/decks/aws-saa-c03.ledger.csv`. Right: the console's deck import page. Caption: "Before: sources in a spreadsheet · no approval step · no numbers". | "Before, cards went into Markdown files, sources lived in a separate spreadsheet, and the file was pasted into the console. No approval step, no independent check, no numbers." |
| 3 | 0:22–0:48 | Claude Code in the repo. Type: *Use author-cards to draft 5 cards for demo-recording from* ‹source URL›. Sped up: `read_source`, `find_similar_cards`, a verifier sub-agent, `lint_card`, `submit_draft`. Hold on the final summary: `batchId`, created 5. Caption each tool name as it appears. | "Now an agent in Claude Code, on my own subscription, reads the source through our MCP server, checks for duplicates, has a second agent verify each card against its passage, and runs the same lint as the console. Every card must quote the source word for word, or the server refuses it. Its login cannot approve or publish anything." |
| 4 | 0:48–0:55 | Slack channel: the n8n message for `review.queued` with the draft count and a console link. Cursor clicks the link. | "A signed webhook reaches n8n, which posts to Slack with a link to the review queue." |
| 5 | 0:55–1:29 | Console `/review?deckId=…`. Zoom on the Source panel: link, highlighted quote, "Quote found in the source". Pan to Similar cards and the lint panel. Draft 1: open the source link in a new tab, find the quote (Cmd+F), come back, **Accept**. Draft 2: change one word, **Accept with edits**. Draft 3: **Reject**, reason "Not supported by the source", short note. | "In the console, a person reviews each draft next to its source and the quote the agent used. I check the page really says it, that the answer is right, and that it is not a duplicate. Accept, accept with edits, or reject with a reason. Reasons matter: they become the agent's defect rate, and my review time is recorded as the real human cost." |
| 6A | 1:29–1:57 | *(AI QA on.)* `/decks/qa?deckId=…`. Publish gate panel. Start a review: scope "changed", card count and estimated cost visible, **Start AI QA**. Sped up to the finished run: findings grouped by card with blocker / major / minor badges. One finding: **Edit card**, fix, back, **Mark fixed**. Another: note "source confirms the card", **Dismiss**. | "Before publishing, a second model, Claude Opus 5 on Amazon Bedrock, reviews every changed card and reports problems by severity. It shows the cost before it runs, it is off by default, and a blocker can stop a publish only when I switch that on. I fix real problems and dismiss false alarms with a note." |
| 6B | 1:29–1:57 | *(AI QA still off.)* `/decks/qa?deckId=…` showing "AI QA is switched off on the server" and the Start button disabled. Then scroll `services/ai-qa/README.md` to the "Rollout" steps. | "Before publishing, a second model, Claude Opus 5 on Amazon Bedrock, is built to review every changed card and report problems by severity. It stays switched off until it passes its accuracy bar on Bedrock itself, and this page says exactly that." |
| 7 | 1:57–2:28 | `evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v1.md` (Overall table), then `evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v3-seeded-v3.md` (Overall table). Overlay: **Before** recall 0.79 · precision 0.73 · flags on untouched cards 29% → **After** 0.956 · 0.927 · 7.6%. Small caption: "Measured through a local Claude Code proxy; Bedrock run pending." | "I measured it before trusting it. With planted defects, the first prompt flagged 29 of 100 untouched cards. Checking those against the documentation found five real errors in my own deck, and showed most false alarms came from the model's older knowledge or from fields learners only see after answering. After fixing the prompt and the dataset: recall 0.96, precision 0.93, 7.6 percent false alarms. That ran through a local proxy; it goes live only after the same test passes on Bedrock." |
| 8 | 2:28–2:36 | Deck list: **Publish** on a real deck you intend to ship (never the demo deck; see the checklist). Cut to the Google Sheet `Events` tab: the `deck.published` row. | "Publishing sends another signed event; n8n logs it and emails a weekly digest." |
| 9 | 2:36–2:53 | `/ledger` with the range set above. Hold on the "Hours saved" tile and its detail lines ("of which inferred from history", "on default baselines"), then the per-automation table. | "Everything lands in an automation ledger. When I exported it, it showed 62.5 hours saved, but that is past events multiplied by placeholder baselines, and the page says so. Real numbers start with the first live batch." |
| 10 | 2:53–2:58 | End card: the paths of `docs/showcase/reviewer-guide.md` and `docs/showcase/process-redesign-case-study.md`, and the repository URL. | "The reviewer guide and the full case study are in the repo." |

Total: 2 min 58 s.

---

## Notes for the edit

- **Shot 7 overlay wording must stay exact.** The two runs used different datasets (`seeded-v1`
  for the baseline, `seeded-v3` for the final), so the overlay says "Before" and "After", never "a
  gain of X points". The proxy caption is not optional.
- **Shot 9 number.** 62.53 hours in the export is rounded to 62.5 in speech. If the ledger has
  live runs by recording day, the tile will differ: show whatever the page says and change the
  line to "…it shows N hours saved; X of them measured, the rest on placeholder baselines",
  reading both numbers off the tile's detail lines.
- **If shot 3 hits a refusal** (for example `SOURCE_QUOTE_NOT_IN_CHUNK` or a duplicate dropped),
  keep it: a guardrail firing on camera is better evidence than a clean run. Trim elsewhere to stay
  under 3:00.
- **Real time vs sped up.** Do not present sped-up footage as real time. The median AI QA time per
  card in the proxy run was 17.3 s; the Bedrock time is ‹owner to measure›.

---

## Sources for every number in the video

| Spoken or shown | Value | File |
|---|---|---|
| Baseline recall / precision / flags on untouched cards | 0.79 / 0.7315 / 0.29 (29 of 100) | `evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v1.md` |
| Five real errors found among flagged untouched cards | 5 `real_defect` verdicts | `evals/reports/tuning-2026-09-27/adjudication-controls-qa-v1.json` |
| Most false alarms: older knowledge or answer-side fields | 17 of 19 false-alarm findings (9 + 8) | same file, `reason` fields; summary in `docs/showcase/process-redesign-case-study.md`, section 5.3 |
| Final recall / precision / control FP rate | 0.9558 / 0.927 / 0.0756 | `evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v3-seeded-v3.md` |
| Proxy, not Bedrock | provider `claude-cli`, gate FAIL on provenance only | same report; `evals/reports/tuning-2026-09-27/README.md` |
| Hours saved in the ledger | 62.53, all backfill on default baselines | `docs/showcase/data/ledger-2025-10-01_2026-09-27.json` |
| Median QA time per card (proxy) | 17.3 s | `evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v3-seeded-v3.md` |
