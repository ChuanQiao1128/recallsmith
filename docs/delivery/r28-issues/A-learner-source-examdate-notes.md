# A — Learner UX: source line, editable study goal, daily target (U3 / U4 / U5)

Findings: `user-perspective-review-2026-10-04.md` §1 (U3, U4, U5). This change covers the parts that need no owner decision. The draw economy and the unlock rules are unchanged; exam mode was not approved.

## What changed

### U3: the source on the review screens
- `mobile/src/features/gacha/components/CardSourceLine.tsx` (new): one compact line, `Source: <host>`. Published sources (`cards[].source = { url, quote }`, contract `content/decks/FORMAT.md` `SOURCE:`) have no title, so the line shows the host from `sourceHostLabel`. The line is read from the installed deck file through the existing `content/cardSource.ts` reader, so it also shows offline. It is text only. It respects the `cardSource` flag and renders nothing when the card has no source or the read fails.
- `mobile/src/content/cardSourceLink.ts` (new): `isOpenableSourceUrl` / `openCardSourceUrl` check the URL again when the learner taps it. Only an absolute `http(s)://host…` URL is opened. Whitespace, control characters, userinfo (`@` in the authority) and every other scheme are refused, including `javascript:`, `data:`, `file:`, `intent:`, app schemes and relative URLs. If `openURL` throws or rejects, the error is swallowed.
- `mobile/src/screens/SessionCardScreen.tsx`: the line is rendered under the card once the answer is on screen. For an MCQ card that is the verdict, right or wrong. For a Q/A card it is after Reveal, and Hide removes the line again. The learning study view already has its own SOURCE block, so it gets no second one. The line is keyed by card.

### U4: change or clear the study goal after onboarding
- `mobile/src/features/gacha/settings/study/StudyGoalRow.tsx` and `studyGoalEditor.ts` (new): a "Study goal" row in Settings › Study.
  - The row shows the deck and the exam date, for example `Exam Thu, Oct 22, 2026 · in 18 days`, `… · today`, `… · passed`, `No exam date` or `Not set`.
  - Change (or "Set goal") opens an inline editor with the onboarding choices from `goalChoices.ts`: the three goal decks, "No date", the presets (2 weeks, 1/2/3 months) and ±1 week. A step can never land on today or earlier (`canStepExamDate`).
  - Save writes through `setStudyGoal`, with the same validation and the same key `recallsmith:study-goal:v1`. Remove goal calls `clearStudyGoal`. Cancel writes nothing. A failed or rejected write keeps the editor open and shows an error.
  - With no goal yet (for example a learner onboarded before R22), the editor starts from the active deck if it is a goal choice, and from the default deck otherwise.
- `StudySection.tsx` has an optional `goal` prop. `SettingsScreen.tsx` loads the goal and the active deck in its focus refresh. Home re-reads the goal on focus, so a change shows up when the learner goes back.

### U5: the daily target on Home
- `mobile/src/features/goal/examPace.ts` (new, pure): `buildExamPace` / `examPaceLabel`.
  - The target is the goal deck's cards not learned yet, spread over the local days from today up to the review cap day (`examReviewCapMs`, the day before the exam). The cap day itself is not a learning day; it stays free for the final review.
  - Output examples: `≈ 18 cards/day to be ready by Oct 21`, `Today's 18 done · on track for Oct 21`, `Every card learned · keep up your reviews`, and `Final review: go over the cards you know` once the cap has passed (exam today or tomorrow).
  - A missing, invalid or past date shows nothing. So does an empty deck or a goal deck that Home does not list.
- `mobile/src/features/goal/examPaceAnchor.ts` (new): the target is recalculated once a day. One device-local record (`recallsmith:exam-pace-anchor:v1` = local day, goal deck, exam date, cards left) stores the count from Home's first look each day. Today's target therefore holds while the learner works and moves only when the day or the goal changes. If more cards are left than the record says (the deck grew, or the account changed), the record is replaced. A storage error falls back to the live count.
- `mobile/src/features/gacha/home/useExamPaceLine.ts` (new) and `HomeScreen.tsx`: the line sits under the exam countdown (`home-exam-pace`) and uses the goal deck's `totalCards` and learned count (`masteredApprox`) from the deck summary. It does not use the selected deck.

## Tests
- `tests/unit/examPace.test.ts`: the whole suite runs in Pacific/Auckland, America/New_York and Asia/Kolkata. It includes a check that each zone took effect, both 2026 DST changes, the first and last minute of a day, the last learning day, the cap and exam days, a past or invalid date, an empty or finished deck, the daily anchor and an anchor that is too small.
- `tests/unit/examPaceAnchor.test.ts`: covers the first look of a day, a new day, a new deck or date, a deck that grew, a corrupt record and a storage error.
- `tests/unit/cardSourceLink.test.ts`: covers allowed http/https URLs, refused schemes and disguised URLs, and a missing, throwing or rejecting `openURL`.
- `tests/unit/studyGoalRow.test.tsx`: covers the helper labels and dates, setting a goal from none, ±1 week with the never-before-today rule, changing the deck, No date, Remove goal, Cancel, a failed write and retry, and a slug the shared validation rejects.
- `tests/integration/session-card-source.screen.test.tsx`: covers the line under a wrong and a right MCQ verdict and not before the verdict, the Q/A answer after Reveal and not after Hide, tap → `Linking.openURL`, no source / failed read / flag off, and no second line in the study view.
- `tests/integration/home.screen.test.tsx`: the target uses the goal deck and not the selected one and sits right under the countdown. It covers no date, a past date, an unlisted deck and a finished deck.
- `tests/integration/settings.screen.test.tsx`: in the full Settings screen, a learner sets a goal and it is written under the onboarding key.

## Ships how
- Mobile JS/TS only: no native module, no `app.json` or plugin change, no `runtimeVersion` change. The change goes out in the runtime-2.0.0 OTA after 2.0.0 is released. Nothing on the backend, Terraform or CD side changes.

## Follow-ups and owner decisions
- **Goal sync (U4, follow-up, not done).** The goal is still device-local: `STUDY_GOAL_KEY` is a device key, not an account-partitioned one. Syncing it, for example inside the draw-state snapshot, sends the exam date to the server. That is new data held server-side and probably needs a privacy-policy line, so it is the owner's call.
- **Moving the exam earlier.** Reviews already scheduled after the new cap are capped only when the card is next rated (`capNextReviewToExam` runs at rating time). Re-capping the stored schedule on save would touch the per-account progress and sync, so it was left out.
- **The pace and the draw economy (U5).** The target counts cards to learn, but a new card still has to be drawn first. The draw economy may supply fewer cards per day than the target asks for. Whether exam mode relaxes the gate is still the owner's decision.
- **Source coverage (U3 content).** The line shows wherever a card has a source. Today that is C# 217/217, CCDV-F 109/441 and AWS 20/371. Backfilling sources from the ledgers is separate content work (report §2.5 steps 2–3).
- **Date style.** The line uses the app's existing month-day order (`Oct 21`, as in `formatExamDate`) rather than `21 Oct`.
