# S02 — Two rating buttons by default (Forgot / Remembered); four as an opt-in setting

Round r22, wave s. Contract: `R22-00-contracts.md` §1.4, §5 (hint copy), §6.

## What changed (files)

- `mobile/src/features/gacha/study/studyPrefs.ts` (new): device-global study prefs.
  AsyncStorage key `recallsmith:study-prefs:v1`, value `{ fourButtons: boolean }`.
  `getStudyPrefsSync()`, `loadStudyPrefs(probe?)`, `setStudyPrefs(next)`, `hasAnyLearnedCard()`.
- `mobile/src/features/gacha/components/RatingBar.tsx`: new `fourButtons?: boolean` prop (default
  `false`). Adds `TWO_RATING_ITEMS` (Forgot → `again`, Remembered → `good`). `RATING_ITEMS` is still the
  four-button scale. `onRate(ReviewRating)`, testIDs (`review-rating-<rating>`) and
  `ratingA11yLabel` don't change. New hint copy.
- `mobile/src/screens/SessionCardScreen.tsx`: reads the study prefs on focus and passes `fourButtons` to
  the RatingBar. MCQ cards still use `McqActionDock`, so verdict mapping is unchanged.
- `mobile/src/features/gacha/settings/study/StudySection.tsx` (new): a "Study" Settings card with the
  switch "Show all four rating buttons".
- `mobile/src/features/gacha/settings/feedback/FeedbackSection.tsx`: `ToggleRow` is now exported so
  StudySection can reuse it. Its behaviour is the same.
- `mobile/src/screens/SettingsScreen.tsx`: loads the study prefs in the focus refresh, renders
  StudySection below "Sound & haptics", and saves the toggle optimistically.

## Shipped surface

- Rating dock, default: two buttons, **Forgot** ("Forgot, show soon" → `again`) and **Remembered**
  ("Remembered, normal gap" → `good`).
- Four-button mode (setting on): Again / Hard / Good / Easy, as before, with the 2x2 reflow at large font
  scales. Two-button mode stays one row.
- Hint before reveal (both modes): "Try to recall the answer, then reveal it."
  After reveal: "Did you remember it?" with two buttons, "How well did you recall it?" with four.
- Default when the key is absent: `hasAnyLearnedCard()` scans all stored deck progress in the current user
  scope (`loadAllProgress`) for a row with `lastReviewedAt > 0` (`isLearnedProgress`). If it finds one,
  `fourButtons` is `true` and existing users keep four buttons. Otherwise it is `false`. The result is
  then stored, so the decision is made once. A stored or malformed value is handled like this: a valid
  stored value always wins; a malformed one reads as absent. If storage or the probe errors, the
  in-memory value is kept and nothing is stored, so the next read decides again.

## Tests

- `tests/unit/studyPrefs.test.ts` (new): new-learner default is two buttons and gets stored; an existing
  learner with a learned card gets four and keeps it (stored); a stored value beats the probe; malformed
  values; persistence across module loads; storage and probe failures.
- `tests/unit/ratingBar.test.tsx`: new hint copy; two-button default (Forgot/Remembered, testIDs,
  `again`/`good` routing); four-button opt-in restores all four.
- `tests/unit/a11yPass.test.tsx`: four-button labels unchanged; two-button labels and roles.
- `tests/unit/dynamicType.test.tsx`: the 2x2 reflow applies to four buttons; two buttons stay one row.
- `tests/unit/studySection.test.tsx` (new): switch role, label, checked state, flip callback.
- `tests/integration/session-card.screen.test.tsx`: hint copy; a new learner sees two buttons and
  Remembered rates `good`; an existing learner keeps four buttons; a stored choice wins.
- `tests/integration/settings.screen.test.tsx`: the setting shows as on for an existing learner and the
  toggle persists `{ fourButtons: false }`.
- Session-flow tests that pressed `Good` / `Again` now press `Remembered` / `Forgot`, which send the
  same ratings: session-card, -focus, -mcq (Q/A kill-switch case), -mistakes, mistake-loop,
  owned-gate-entry-points.
- Gates: `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration` all pass. `npm run
  test:smoke` fails the same way on the untouched base (d47f168): 32 TS errors from the symlinked
  `node_modules` typings and from `deckRepository.ts`/`chunkedInstall.ts`. That is unrelated to S02.

## Owner steps

- None. JS-only (OTA-safe), with no package/app/eas/native change and no frozen file touched. Spot-check on
  device: a fresh install shows Forgot/Remembered, and an upgraded install with study history shows four
  buttons with the Settings → Study switch on.

## Deferred / notes

- The learning-check rating (Remembered → `hard` on a first-exposure recall check) is S01's scope (§6).
  The RatingBar is unchanged for that: S01 maps the button press at its own call site.
- The prefs are device-global, like the feedback prefs. The learned-card probe reads only the active
  user scope. A device whose first read happens while signed out, with history only in another account
  scope, defaults to two buttons. The learner can switch to four in Settings.
- App-wide preloading of the prefs at launch (App.tsx) is out of scope. The session screen seeds from
  the in-memory default and corrects itself after the focus read, which is microseconds after mount.
