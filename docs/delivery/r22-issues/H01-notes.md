# H01 — Onboarding asks what the learner wants to learn (+ optional exam date)

Issue #599 · round r22, wave h · contract `R22-00-contracts.md` §1.1, §3, §5.

## What changed (files)

| File | Change |
|---|---|
| `mobile/src/features/goal/goalChoices.ts` (new) | The three goal choices of §3 (AWS SAA-C03 first, `highlighted`), `NO_DATE_LABEL`, the four date presets, and pure JS date math: `examDateForPreset`, `stepExamDate`, `canStepExamDate`, `formatExamDate`. No date-picker dependency. |
| `mobile/src/screens/AudienceSurveyScreen.tsx` | The content-lane question is gone. Two steps on the same route: **goal** (*What do you want to learn?*) → **date** (optional). Finishing calls `setStudyGoal` (contract §2), `setActiveDeckSlug`, `completeOnboarding`, `markPermissionPromptPending`, then `replace('Home', { firstDrawCoach: true })` (unchanged; H02 changes it). The lane preference is no longer written. |
| `mobile/src/screens/WelcomeScreen.tsx` | The featured pack follows `DEFAULT_GOAL_DECK_SLUG` (`aws-saa-c03`) instead of a hard-coded `csharp`; the fallback title reads `AWS`. |
| `mobile/src/features/gacha/settings/content/ContentSection.tsx` | Settings section renamed **Card difficulty**; body *Choose how hard new cards should be. Balanced suits most learners.*; meta *Current: Balanced* (was *Current lane: …*). Default stays Balanced (`getAudiencePreference` → `both`). |
| `mobile/src/features/gacha/audience/audienceRules.ts` | Comment only (the survey no longer uses the labels). |
| Tests | see below |

## Surface shipped

1. Welcome → *Continue* → **What do you want to learn?** — radio cards:
   *AWS Solutions Architect (SAA-C03)* (pre-selected, thicker border), *Claude Developer (CCDV-F)*,
   *.NET interview questions*. One primary action: *Continue*.
2. **Do you have an exam date?** (eyebrow *OPTIONAL*) — first option, selected by default:
   *No date — I'm just learning* (`examDate: null`). Then chips *In 2 weeks · In 1 month · In 2 months ·
   In 3 months*. Once a preset is picked, *−1 week* / *+1 week* steppers move the day; the date shows as
   e.g. *Mon, Nov 2, 2026*. The −1 week stepper cannot reach today or the past. Primary action:
   *Finish setup*; secondary *Back* returns to the goal step.
3. Stored: `recallsmith:study-goal:v1` = `{ deckSlug, examDate }`, `active-deck-slug` = the chosen deck.
   Nothing requires a date.

The route keeps its `AudienceSurvey` name and the onboarding stage stays `audience`, so installs that were
mid-onboarding resume on the new step (no change to `onboardingPrefs.ts`, which is outside this scope).

## How it is tested

- `tests/unit/goalChoices.test.ts` (new): choice order/labels/highlight, no-date label, preset → day
  (incl. month-end clamp), week steppers and their lower bound, date formatting.
- `tests/integration/onboarding.screen.test.tsx`: rewritten for the goal step — asks the goal (not the lane),
  AWS first and selected; default finish saves `{ aws-saa-c03, null }`, sets the active deck, writes no lane,
  stage `done`, `replace('Home', { firstDrawCoach: true })`, permission prompt pending; .NET + *In 1 month*
  + steppers saves `2026-11-09`; preset then back to no date saves `null`; *Back* returns to the goal step.
- `tests/unit/audienceLabels.test.ts`: survey options removed; Settings title *Card difficulty*, *Current:
  Balanced*, no "lane" copy, default Balanced.
- `tests/integration/welcome-sign-in.spec.tsx`: Welcome features the AWS pack (not C#); Continue still opens
  the goal step.
- `tests/integration/me-real-data.spec.tsx`: test name/comment only (Profile still shows the stored label).

Gates run: `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration`, `npm run test:smoke`,
`H01.verify.sh`.

## Owner steps

None (JS-only, OTA-safe; no package/app/eas/native change, frozen files untouched).

## Deferred

- H02 replaces the navigation result (starter lesson before the first draw).
- Profile still titles the row *Audience* (`ProfileScreen.tsx` is outside this issue's scope); rename it to
  *Card difficulty* in a follow-up.
- `docs/qa/screen-quality-matrix.md` does not exist on this base; not created.
- Home's *Exam in N days* (§5) belongs to another issue.
