# D02 — Progress by domain screen with Practice, opened from Library and More (#631)

Contract: `R24-00-contracts.md` §1.2–§1.3. Builds on D01 (`computeDomainProgress`, `examDomains`). JS-only, OTA-safe;
no Home change, no frozen file touched.

## What changed

- `mobile/src/screens/DomainProgressScreen.tsx` (new) — stack screen `DomainProgress { slug }`, titled
  "Progress by domain". Exports `DOMAIN_PROGRESS_TITLE`, `DOMAIN_PROGRESS_FOOTER`, `PRACTICE_DISABLED_TEXT`.
- `mobile/src/features/domains/domainPractice.ts` (new) — pure `pickDomainPracticeUids(...)`,
  `DOMAIN_PRACTICE_LIMIT = 15`.
- `mobile/src/navigation/types.ts` — `DomainProgress: { slug: string }`.
- `mobile/App.tsx` — registers `<Stack.Screen name="DomainProgress" />`.
- `mobile/src/features/gacha/library/LibraryHeader.tsx` — new optional prop `onOpenDomains`; renders the
  "By domain" link (`library-domains-link`) in one row with the Mistakes pill. Its styles live in the header file
  (`libraryScreenStyles.ts` is out of scope).
- `mobile/src/screens/LibraryScreen.tsx` — passes `onOpenDomains` → `navigate('DomainProgress', { slug: selectedDeckSlug })`.
- `mobile/src/screens/MoreScreen.tsx` — row "Progress by domain" (`more-row-domains`, subtitle "Cards learned in
  each exam area"), placed right after the Mistake Book row.

## Surface

Screen loads with the existing loaders — `getCachedDeck`, `loadDeckProgress`, `resolveEffectiveOwned`,
`loadMistakeBook` + `activeMistakes(book, { deckSlug })` — on mount and on every focus. Per domain row
(`domain-row-<key>`):

- title; `"<weight> of the exam"` when the domain has an exam weight (`domain-weight-<key>`);
- `"34 of 61 learned · 12 mastered"` (`domain-counts-<key>`);
- a thin bar (`domain-bar-<key>`) drawn with flex shares learned : (total − learned), no number;
- chips `"N due"` / `"N mistake(s)"` only when > 0;
- `Practice` (`domain-practice-<key>`) → `navigate('SessionCard', { slug, focusUids })` with up to 15 owned
  (effective owned set), learned cards of the domain, ordered: active mistakes of this deck, then due, then
  lowest stage, then oldest `lastReviewedAt`, then deck order. With none, the button is disabled and
  "Learn a card in this domain first" shows under it (`domain-practice-note-<key>`).

Footer (`domain-progress-footer`), exactly: "Cards you have studied, not an exam score. DeveloperCards is not an
exam simulator." A deck not on the device shows `domain-progress-empty`.

Entry points: Library header link "By domain" (always shown for the selected deck, next to the Mistakes pill);
More row "Progress by domain" → active deck (`loadActiveDeckSlug`), else the first drawn deck
(`listDrawStateSlugs`), else `Library`.

No percentage text about the learner: the only `%` on screen is the exam's own weight line.

## Tests

- `tests/integration/domain-progress.screen.test.tsx` (new): counts/weight/chips/bar render, no learner
  percentage, Practice passes the right `focusUids` in order, disabled state + note, exact footer, missing deck.
- `tests/unit/domainPractice.test.ts` (new): ordering, owned/learned filter, cap at 15, empty result.
- `tests/integration/library.screen.test.tsx`: "By domain" link navigates to `DomainProgress { slug }`.
- `tests/integration/more.screen.test.tsx`: More row opens the active deck; falls back to a drawn deck, then Library.
- `tests/integration/mistake-entry-points.test.tsx`: row order pin updated (Profile, Mistake Book, Progress by
  domain, Settings).
- `tests/unit/retiredScreens.test.ts` stays green.
- Commands: `cd mobile && npx tsc --noEmit && npx vitest run` (274 files, 2002 tests pass); `D02.verify.sh`.

## Owner steps

None (OTA-safe JS change).

## Deferred

- Phase 2 copy pass (r24b) may reword the More subtitle "Cards learned in each exam area".
- `npm run test:smoke` fails in this worktree with TS errors in untouched files (`apiClient.ts`,
  `chunkedInstall.ts`, `mistakeBook.ts`, node_modules type conflicts); it compiles without the project
  tsconfig and is unrelated to D02.
