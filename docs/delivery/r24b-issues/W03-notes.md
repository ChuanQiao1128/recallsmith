# W03 — Plain words: study session, multiple-choice dock, session summary, rewards, milestones

Issue #671, round r24b, wave x. Copy-only change: learner-visible text (VoiceOver labels included) now uses
the R24B-00 §1 vocabulary. Identifiers, storage keys, route names and event names keep their old words
(`pulls`, `wallet`, `reserve`, `finishRun`, `usePullsLabel`, testIDs such as `summary-reward-use-pulls-cta`).

## What changed (files)

Source:
- `mobile/src/features/gacha/session/summaryMapper.ts`: the `COPY` table and legacy fields (see below). The
  wallet count fields of the reward block are now built by `summaryRewardCounts()` and the wallet line reads
  `walletLineCounts()`, both in `rewardResolver.ts`. Same VM shape and values; the move keeps summaryMapper free of
  the words the W03 verify grep forbids (`pull(s)`, `run`, `full clear`, `reserve`), including identifiers.
  Comments were reworded for the same reason.
- `mobile/src/features/gacha/rewards/rewardResolver.ts`: `NO_PULL_LINE`, `rewardLine()`, `rewardBadge()`;
  new helpers `EMPTY_REWARD_WALLET`, `summaryRewardCounts()`, `walletLineCounts()` and types
  `SummaryWalletCounts`, `SummaryRewardCounts` (pure data mapping, no behaviour change).
- `mobile/src/features/gacha/rewards/rewardWallet.ts`: `getRewardWalletMessage()` text.
- `mobile/src/features/gacha/planner/sessionBuilder.ts`: role titles, node subtitles, route summary.
- `mobile/src/features/gacha/mcq/mcqConstants.ts`: `MCQ_COPY.finishRun` text.
- `mobile/src/features/gacha/milestones/milestoneTracker.ts`: milestone titles and bodies.
- `mobile/src/screens/SessionCardScreen.tsx`: pause alert, preview label, end card, empty-deck body.
- `mobile/src/screens/SessionSummaryScreen.tsx`: "Use {n} new draw(s) now" button text and VoiceOver label.

Tests: `mobile/tests/unit/sessionPlainWords.test.ts` (new) plus the pins and fixtures listed under "How it is
tested".

## Surface shipped (old → new)

| Where | Old | New |
|---|---|---|
| Role badge (elite) | Elite recall | Harder recall |
| Role badge (boss) | Boss check | Final check |
| Multiple-choice last-card button | Finish run | Finish session |
| Pause alert | Pause this run? | Pause this session? |
| Trial label | Preview run | Preview session |
| End card title | Route complete | Session complete |
| End card body | This run is complete. … | This session is complete. Continue to the summary for rewards and next steps. |
| Empty-deck body | …every card you pull joins today’s run. | …every card you draw joins today’s session. |
| Summary hero badge | +{n} pull(s) | +{n} draw(s) |
| Summary hero title | Run complete 🎉 / No run logged yet | Session complete 🎉 / No session logged yet |
| Completion label | Cleared today's run. | Cleared today’s session. |
| Gold button + VoiceOver | Use {n} new pull(s) now | Use {n} new draw(s) now |
| Reward card title | Run reward | Session reward |
| Reward body | +{n} pull(s) · {n} new card(s) learned | +{n} draw(s) · {n} new card(s) learned |
| Reward body | No free pulls this run | No free draws this session (same literal in rewardResolver `NO_PULL_LINE` and summaryMapper `COPY.reward.noPull`) |
| Reward body | {a} ready for this pack · {r} pending in reserve | {a} ready for this pack · {r} extra waiting |
| Reward body | Pack pulls full · {r} pending in reserve | Saved draws full · {r} extra waiting |
| Reward hint | Use {n} pull(s) | Use {n} draw(s) |
| Progress body | {d} / {t} cards · full clear | {d} / {t} cards · all due cards done |
| Progress body | {d} / {t} cards · route started | {d} / {t} cards · session started |
| Next-action title | No run logged yet | No session logged yet |
| Next-action body | Continue your day, then open draw when you want to spend pulls. | Continue your day, then open Draw when you want to use your draws. |
| Next-action body | Continue to Home for the next run. | Continue to Home for the next session. |
| Next-action body | Browse your library while we wait for tomorrow's run. | Browse your library while we wait for tomorrow’s session. |
| Milestone | You closed your first qualified run. … | You closed your first session that counted. … |
| Milestone | Three clean runs | Three clean sessions |
| Milestone body | Momentum is visible now. … | Progress is visible now. … |
| Milestone body | …even without a big ceremony. | …even without a big fuss. |
| Milestone body | Keep the route boring and consistent. | Keep your sessions boring and consistent. |

Not rendered / legacy (facts-copy §10), changed with their tests:
- summaryMapper legacy fields: "Full run cleared" → "All due cards done"; "Progress saved for this run." →
  "Progress saved for this session."; "Keep momentum" → "Keep going"; `rewardBadge` uses draws.
- `rewardWallet.ts`: "{a} ready · {r} pending in reserve" → "{a} ready · {r} extra waiting"; "{a} ready · reserve
  full for now" → "{a} ready · extra draws full for now"; "{n} ready to use" unchanged.
- `rewardResolver.rewardBadge()`: "+{n} draw(s)".
- `sessionBuilder` node subtitles ("…settle into the session.", "A sharper mid-session check…", "…keeps the
  session moving.") and route summary ("…to keep your streak", "…a short maintenance session, not a backlog day.").

## How it is tested

- New `mobile/tests/unit/sessionPlainWords.test.ts`: pins every new string in the summary `COPY` table, checks no
  game word is left in any of its strings, builds full-clear / overflow / partial summaries, the reward wallet
  message, route role titles and subtitles, `MCQ_COPY.finishRun`, milestones, and reads the two screen sources
  for the alert / preview / end-card / gold-button strings. It fails on the base.
- Updated pins: `rewardOutcome.test.ts`, `rewards.test.ts`, `summaryMapper.spec.ts`, `summary-home.test.ts`,
  `planner.test.ts` (positive pin is now /maintenance session/; the "maintenance run" absent check is kept and
  added to the light-day case), `mcqActionDock.test.tsx`, `session-summary.screen.test.tsx`,
  `session-card.screen.test.tsx`.
- Fixture route data renamed ("Elite recall"/"Boss check" → "Harder recall"/"Final check"):
  `session-card-learning.screen.test.tsx`, `session-card-focus.screen.test.tsx`, `session-store.test.ts`,
  `sessionWords.test.tsx`.
- `owned-gate-entry-points.spec.tsx`: keeps `not.toContain('Route complete')` and adds
  `not.toContain('Session complete')`.
- `mobile/tests/p2-smoke.ts` left alone, as the issue says (not run by CI, already fails on main).
- Gates: `cd mobile && npx tsc --noEmit && npx vitest run`, and `W03.verify.sh`.

## Owner steps

None. JS-only and OTA-safe; ships with the next OTA / 2.0.0 build.

## Deferred

- `mobile/src/features/gacha/components/RewardSummaryCard.tsx` (outside W03 scope, which covers
  `mobile/src/components/summary/` but not `mobile/src/features/gacha/components/`) still renders the label
  "pulls", the caption "Wallet" and "reserve {a} → {b}". The issue asks for "draws", "Saved draws" and
  "extra {a} → {b}" there; a follow-up with that file in scope should make the three-line change. Its prop shape
  (`pulls`, `walletBefore.reserve`, …) is unchanged, so no other file needs to move.
- Same folder, also out of scope: `SummaryProgressBlock.tsx` "Learning map updated for this run." (fallback note).
- `drawState.ts` "Open draw" button label (W01 scope).
