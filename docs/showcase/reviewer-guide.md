# Reviewer guide: approving AI drafts and AI QA findings

**Who this is for:** the person who decides which flashcards reach learners. You do not need to
write code. Everything below happens in the DeveloperCards admin console,
`https://console.developercards.app`, in your browser.

**What you will do:** read cards that an AI assistant drafted from a source document, check them
against that source, and accept, edit or reject each one. Later, before a deck is published, you
read a second AI's review of the changed cards and act on what it found.

**The one rule:** the AI proposes, you decide. Nothing an AI writes reaches a learner until a
person has accepted it, and the AI's own login cannot accept, reject or publish anything
(`src_C/Vpc/AgentClientPolicy.cs`).

---

## 1. The whole flow in one picture

```
 Author's computer                          Admin console (you)                    Learners
 ─────────────────                          ───────────────────                    ────────
 AI assistant reads a source ─► drafts ─►  Review queue (/review)
 (a web page or PDF), checks                 accept / edit / reject
 duplicates and quotes                              │ accepted cards join the deck
                                                    ▼
                                            AI QA (/decks/qa)
                                              a second AI reviews changed cards;
                                              you mark findings fixed or dismiss them
                                                    │
                                                    ▼
                                            Publish ─────────────────────────────►  the app
                                                    │
                           Slack / Google Sheet / weekly email  ◄── notifications (n8n)
```

Four console pages matter here. Each has a link in the console's top navigation:

| Nav link | Route | What it is for | Who sees it |
|---|---|---|---|
| Review queue | `/review` (add `?deckId=<id>` to open one deck) | Decide on AI drafts | console admins |
| AI QA | `/decks/qa?deckId=<id>` | Run the AI check and act on its findings; see whether publishing is blocked | console admins |
| Automation ledger | `/ledger` | See what the automation did and what your decisions added up to | console admins |
| Webhooks | `/admin/webhooks` | Set up where notifications go | the owner (super admin) only |

No screenshots are committed yet; the page names and button labels below are the ones in the
console code (`frontend/src/pages/ReviewQueuePage.tsx`, `frontend/src/pages/DeckQaPage.tsx`).

---

## 2. Where drafts come from (so you know what to trust)

The author runs an AI assistant (Claude, in Claude Code) on their own computer with a project
skill that tells it how to write cards (`.claude/skills/author-cards/SKILL.md`). Before a draft
reaches you, the assistant has:

1. Read the source document and split it into numbered passages ("chunks").
2. Written the card and copied a **quote**, word for word, from one passage.
3. Searched the deck for similar cards and dropped likely duplicates.
4. Asked a separate checker (a sub-assistant that sees only the card and its passage) whether the
   passage supports the card, and dropped or rewritten cards that were not supported.
5. Run the same format checks the console importer runs.
6. Submitted the batch. The submit step itself refuses any card whose quote does not appear in
   the document the assistant actually read in that session (`tools/mcp-server/README.md`,
   `submit_draft`).

What those checks **do not** prove: that the source is the right page, that the quote actually
supports the answer, or that the answer is correct and the only correct one. That is your job.

When a batch arrives, a Slack message can tell you (section 6).

---

## 3. Reviewing a draft in the Review queue (`/review`)

Choose a deck from the list (or follow the link in the Slack message, which opens the right deck).
The drafts list defaults to **Pending**; you can also filter **Accepted**, **Rejected** or
**All**. The first pending draft opens automatically. You see:

- **Left:** the card itself in the normal card editor (question, answer, options for a
  multiple-choice card, code sample, real-world usage note).
- **Right, "Source":** a link to the source page, the quote highlighted, and a badge.
  **"Quote found in the source"** means the quote was matched in the text the assistant read;
  the line under it names the passage (chunk) and how many characters were quoted.
- **Right, "Similar cards":** existing cards in the deck that read alike, with a similarity
  percentage.
- **Below, lint:** format problems, if any. **Accept** stays disabled until there are none.

### 3.1 What to check, in this order

1. **Open the source link.** Is it an official page for the topic (for example the AWS or
   Anthropic documentation), and does the page still contain the highlighted quote? The badge
   only tells you the quote was in the text the assistant fetched; you are confirming it is the
   right page and that it still says this. If the source was a downloaded file, the link is the
   page the author said it came from, so open it.
2. **Does the quote support the answer?** Not "is it about the same topic" but "does it state
   what the answer claims". Every number, name, limit and default in the answer should be in the
   quote or be basic knowledge for the deck's level.
3. **Is the answer correct, and the only correct answer?** For a multiple-choice card, exactly the
   keyed options should be right, and each wrong option should be wrong for the reason its
   explanation gives.
4. **Is the question clear?** If it asks for the LEAST cost or the MOST available option, the key
   must win on exactly that. If two options would both meet everything the question states, the
   question is ambiguous.
5. **Does the question give the answer away?** For example, the right option repeats the
   question's wording and no other option does. Note that the code sample and the real-world
   usage note are shown to learners only **after** they answer, so it is fine for them to name
   the answer.
6. **Is it a duplicate?** Look at "Similar cards". A high percentage is a prompt to compare, not
   a verdict.

### 3.2 Your three choices

| Button | Use it when | What happens |
|---|---|---|
| **Accept** | The card is right as written. | The card is added to the deck. It is **not** published yet; it goes out with the deck's next publish, and AI QA will count it as a changed card. |
| **Accept with edits** | The card is worth keeping but needs a fix (wording, a number, an option). Edit it on the left, then press this. | Same as Accept, and the console keeps both the draft and your edited version. |
| **Reject** | The card should not exist. Choose a reason (required) and optionally add a note (up to 500 characters). | The draft is closed. Nothing is added to the deck. |

Reject reasons (`frontend/src/lib/draftReview.ts`):

| Reason in the picker | Choose it when | Counts as a defect caught? |
|---|---|---|
| Incorrect | The answer or a key fact is wrong. | Yes |
| Ambiguous | More than one answer fits, or the question can be read two ways. | Yes |
| Duplicate | The deck already teaches this. | Yes |
| Not supported by the source | The quote does not back the claim, or the source is the wrong page. | Yes |
| Off topic | Correct, but not what this deck is for. | No |
| Low value | Correct, but not worth a learner's time. | No |
| Other | None of the above; say why in the note. | No |

If the console says **"A live card already uses this stable uid"**, the card's ID clashes with an
existing card. Change the ID and use **Accept with edits**, or reject it as a Duplicate if it is
the same card.

### 3.3 Why your reason and your time matter

Every decision is written to an audit log that cannot be edited afterwards (who decided, when,
the reason, and for edits the before and after versions; `src_C/Vpc/Db/Migrations/030_ai_review_queue.sql`).
Three things are computed from it:

- **The assistant's quality numbers.** The Automation ledger (`/ledger`) shows an "AI draft
  quality" tile: acceptance rate, how often accepted cards needed edits, and the defect rate
  (rejections as Incorrect, Ambiguous, Duplicate or Not supported by the source). Picking
  "Other" when "Incorrect" is true makes the assistant look better than it is.
- **Defects caught before publish.** A rejection with one of the four defect reasons is counted
  as a defect stopped before it reached learners.
- **Human time.** The console measures how long a draft was open and visible to you, from
  opening to deciding, capped at 30 minutes per draft (`frontend/src/lib/draftReview.ts`). That
  time is recorded as the real human cost and subtracted from the time the automation is
  credited with saving. The clock pauses while the tab is hidden, so switching away does not
  inflate it.

---

## 4. Reading AI QA findings (`/decks/qa`)

AI QA is a second, independent check: a different AI (Claude Opus 5, called from DeveloperCards'
AWS account through Amazon Bedrock) reads each new or changed card and reports problems. It never
edits a card and never publishes.

**It is switched off until the owner turns it on.** While it is off the page says "AI QA is
switched off on the server" and no review can start. The owner switches it on only after its
accuracy has been measured on the production setup (see the case study,
`docs/showcase/process-redesign-case-study.md`, section 5).

### 4.1 The page, top to bottom

1. **Publish gate.** Tells you whether AI QA is advisory ("publishing is not blocked by it") or
   required, how many cards changed since the last publish, which of them have not been reviewed
   at their current content, and any open blockers.
2. **Start a review.** Choose the scope: the changed cards (the usual choice), every card, or cards
   you pick. The page shows the card count and an estimated cost before you start. A run is
   limited to 200 cards and to a daily spending cap (both set by the owner). Press
   **Start AI QA**. The page updates on its own while the run is in progress.
3. **Findings.** Grouped by card. Each finding shows a severity, a category, the AI's message and
   usually a suggested fix, plus an **Edit card** link.
4. **Past runs.** Earlier runs with their counts and estimated cost.

### 4.2 Severity: how bad is it

| Severity | Meaning | Examples (category) |
|---|---|---|
| **blocker** | A learner would be taught something false, or cannot pick one right answer. | Incorrect answer, Multiple correct answers |
| **major** | The card works but is flawed in a way a learner would notice. | Answer leak, Ambiguous question, Outdated fact, Qualifier mismatch (the question asks for "cheapest" but the key wins on something else), Source does not support the answer |
| **minor** | Worth a look, not urgent. | Weak wrong option, Other |

The category decides the severity, not the AI's own opinion (`services/ai-qa/README.md`,
"Replies"), so the same kind of problem always gets the same severity.

### 4.3 Your actions on a finding

| Action | Use it when | Effect |
|---|---|---|
| **Edit card**, then **Mark fixed** | The finding is right. Fix the card first, then mark it. | For a blocker or major finding, the ledger counts one defect caught before publish. |
| **Dismiss** | The finding is wrong (a false alarm). Add a short note saying why. | Counted as an AI QA false positive in the ledger. This is how the owner learns where the AI is unreliable. |
| **Waive** (owner only) | The AI refused or failed on a card and publishing is required to pass AI QA. | Lets that exact card version through the gate. It is an owner action through the API, with a required note, not a console button (`src_C/Vpc/Qa/QaRuns.cs`). Any later edit needs a fresh review. |

Both **Mark fixed** and **Dismiss** are final for that finding. The optional note field next to
the buttons is saved with your decision.

**Mark fixed only after you changed the card.** The gate treats a finding marked fixed as
resolved. Editing the card changes its content, so the card then needs a fresh AI QA review:
it appears under "Not reviewed at their current content" until you run AI QA again on the
changed cards.

### 4.4 Do not trust a blocker blindly

The AI's knowledge has a cut-off date; the decks are kept current with the documentation. When
the check was measured, most of its false alarms on correct cards had two causes: it called
recent, real changes wrong (for example an S3 lifecycle rule AWS removed in July 2026), and it
flagged code samples as "giving away the answer" although learners only see them after
answering (`evals/reports/tuning-2026-09-27/adjudication-controls-qa-v1.json`). The prompt was
changed for both, and the false-alarm rate on correct cards fell, but it is not zero: in the
latest measurement 7.6% of correct cards were still flagged
(`evals/reports/2026-09-27-claude-cli-claude-opus-5-qa-v3-seeded-v3.md`, control FP rate 0.0756).
Before you act on a blocker, check it against the card's source. If the source proves the card
right, **Dismiss** and say so in the note.

The same measurement also shows why the check is worth running: it found five real problems in
cards that had already passed the importer checks and the author's own source check.

### 4.5 What the publish gate does

The owner can make AI QA **required**. Then, when someone presses Publish:

- If any changed card has not been reviewed at its current content, publishing is refused with
  `AI_QA_REQUIRED`. The server starts (or reuses) a review of those cards for you; wait for it
  to finish and publish again.
- If any changed card has an open **blocker**, publishing is refused with `AI_QA_BLOCKED` and the
  list of cards. Fix and mark fixed, or dismiss with a reason.

Majors and minors never block; they are there for you to judge. When AI QA is off or only
advisory, nothing is blocked (`src_C/Vpc/Qa/QaGate.cs`). The Publish dialog on the deck list shows
the same gate summary and links to the AI QA page.

---

## 5. What happens after publish

Publishing uses the existing pipeline: the deck is built and delivered to the app. Accepted AI
cards carry their source, and the 1.8.0 app update adds a Source row to the card detail screen
(`mobile/src/content/cardSource.ts`), so learners can check the claim themselves.

---

## 6. Notifications: webhooks and n8n

DeveloperCards sends a signed message (a "webhook") when something happens. The owner connects
these to n8n, a workflow tool, which forwards them to Slack, a Google Sheet and email
(`integrations/n8n/README.md`).

| Event | When | What you get (with the n8n recipes) |
|---|---|---|
| `review.queued` | The assistant submitted new drafts. | A Slack message with a link straight to the Review queue for that deck. |
| `card.flagged` | AI QA finished a card with a blocker or major finding. | One row per card in the Sheet's `Flagged` tab, and **one** Slack summary per AI QA run (deck, number of flagged cards, blocker/major/minor totals, top findings, link to `/decks/qa`), sent once the run has been quiet for 5 minutes. |
| `deck.published` | A publish finished. | A row in the Sheet's `Events` tab. |
| `import.failed` | A bulk import into the console was refused. | A row in the `Events` tab. |
| (weekly) | Monday 08:00 New Zealand time. | An email digest of the last 7 days: publishes, flagged cards, draft batches queued, import failures. |

As a reviewer you only need to click the link in the Slack message. If messages stop arriving, tell
the owner: the **Webhooks** page (`/admin/webhooks`) shows each delivery's status and has
**Send test** and **Redeliver** buttons, and every message is signed so that n8n can reject
anything that did not come from DeveloperCards (`services/webhook-dispatcher/README.md`).

---

## 7. Quick reference

- **Accept** only what you checked against the source. **Accept with edits** beats rejecting a
  good card with a small flaw.
- **Always pick the true reject reason.** The four defect reasons feed the assistant's quality
  numbers.
- **Mark fixed** after editing, not instead of editing. **Dismiss** wrong findings with a note.
- Accepting is not publishing. Publishing is a separate step, and AI QA can be required first.
- The AI's login can only submit drafts. Every decision in this guide is yours.
