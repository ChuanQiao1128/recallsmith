# H03 — Home: one primary action per state, no truncated headline, exam countdown, plain words

Issue #601 · round r22, wave h · contract `R22-00-contracts.md` §1.6, §2 (`daysUntilExam`), §5.
Builds on H02 (#600): the starter-lesson Home state is kept as it is.

## What changed (files)

| File | Change |
|---|---|
| `mobile/src/screens/HomeScreen.tsx` | The primary CTA (`screen-home-primary-cta`) and the draw status line now sit directly under the hero, above the Today card. The hero title (`home-hero-title`) is `numberOfLines={2}` with `adjustsFontSizeToFit` / `minimumFontScale={0.75}`, so it shrinks instead of being cut off. The header line is context only: `Exam in N days` (`home-exam-countdown`) when the study goal has an exam date, otherwise a status that agrees with the hero (`home-header-subtitle`). The `Tap your pack to begin` branch is gone, and so is the copy of the starter headline in the header (the hero already shows it). The study goal is read with `getStudyGoal()` on every focus. The goal line renders `goal.text`. |
| `mobile/src/features/gacha/selectors/homeSelectors.ts` | `HomeGoalVM` is now `{ text }`: `Today: N cards` (singular for 1), where N is the planner's route length as before. An empty deck still gets `No cards yet · Open a pack to start`. New `HERO_HEADLINE_MAX_CHARS = 40`. Hero headlines no longer include the deck title, which the Today card already shows: `No cards in this deck yet`, `Today’s cards are in progress`, `N cards due today`, `A few new cards are ready`, `You are clear for now`. |
| `mobile/src/features/gacha/components/TodayPressureCard.tsx` | The fourth tile reads **Collected** (was Owned). The testID `home-today-count-total` and the value (`selectedOwned`) are unchanged. |
| `mobile/src/features/gacha/draw/pity.ts` | `buildPityProgressLabelV9` returns `A rare card is guaranteed within N card(s)` (was `N cards until guaranteed reveal`). The zero-remaining line is unchanged. |
| `mobile/src/features/gacha/home/examCountdown.ts` (new) | `buildExamCountdownLabel(examDate, nowMs)` wraps `daysUntilExam` from `features/goal/studyGoal.ts` (imported, not redefined). It returns `Exam in N days`, `Exam in 1 day` or `Exam today`, and `null` when there is no date or the date is past or invalid. |

## Surface shipped

- Home, from top to bottom: header (title, plus one context line) → hero pack → hero headline (at most 2 lines, never truncated) → **primary CTA** → draw status line → Today card (Due · New · Learned · **Collected**) → update notice → `Today: N cards` → pack shelf.
- At 390×844 (a 6.1-inch phone), the CTA's top is about 420pt below the safe-area top (header ≈ 46, hero band ≈ 346 including the 240pt pack and two 34pt headline lines, then 16pt margin), so it is visible without scrolling. Before this change the Today card (≈110pt) and the goal line sat above it.
- An exam date is set → the header line reads `Exam in N days` (`Exam today` on the day). No date → nothing on Home mentions an exam.
- Draw: the pity line reads `A rare card is guaranteed within 10 cards`.
- CTA targets, labels, testIDs and states are unchanged: `home-primary-cta` / `home-starter-cta` and every `cta.nav`.

## How it is tested

Tests were written first and failed on the base (commit `2af0a09`). Then came the fix.

- `tests/unit/homeSelectors.spec.ts`: goal line `{ text: 'Today: 5 cards' }` / `'Today: 1 card'` / the empty-deck line. A new test runs every status kind × deck shape with a long title (`AWS Solutions Architect (SAA-C03)`) and checks that the headline is ≤ `HERO_HEADLINE_MAX_CHARS` and never contains the title.
- `tests/unit/examCountdown.test.ts` (new): null for no date, a past date or an invalid date; `Exam in 12 days` (also late in the day); `Exam in 1 day`; `Exam today`.
- `tests/unit/pity.test.ts`, `tests/integration/pity-visibility.test.tsx`: the new pity copy, singular and plural.
- `tests/unit/todayPressureCard.spec.tsx`, `tests/integration/home-primary-cta.test.tsx`: the tile reads Collected, and Owned is absent.
- `tests/integration/home.screen.test.tsx`: the goal line reads `Today: N cards`. The CTA order is checked: hero title → CTA with nothing between them, and the Today grid and goal line after the CTA. The hero title has 2 lines and shrinks to fit. With `firstDrawCoach`, `Tap your pack to begin` is gone and the header agrees with the hero. `Exam in 12 days` shows with a study-goal date (the real `daysUntilExam` runs, and only `getStudyGoal` is mocked). Nothing about exams appears with a null date or no goal. `Owned` and `Keep streak` are gone.
- Gates: `npx tsc --noEmit` passes. `npx vitest run` passes (all suites). `H03.verify.sh` passes.

## Owner steps

None. JS-only, so it ships with the next OTA on runtime 1.9.0. On a 6.1-inch device, a quick look should confirm that the CTA is on the first screen and that the hero headline wraps rather than shrinking too far.

## Deferred

- `docs/qa/screen-quality-matrix.md` does not exist on this base, so nothing was added there.
- `tests/p2-smoke.ts` (`npm run test:smoke`) already fails on the base before it reaches any Home assertion. Its `tsc` step hits lib type clashes from the shared `node_modules`. With `--skipLibCheck` it then stops at the summary reward-badge assertion (`/\+2 pull/`, summary copy, which is out of scope per §5). It pins no string this issue changes.
- Other `Owned` wording (the Library subtitle, debug menu) and `pull/pulls` copy are left for the P1 copy pass (§5).
