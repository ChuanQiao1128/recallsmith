# W02 — Plain words: Home, Library, Card detail (issue #670)

Copy-only change under R24B-00 §0/§1. No behaviour, layout, navigation, economy or scheduling change.
Identifiers (`HomeCtaNav 'challenge'`, `'wallet-full'`, `'reserve'`, `'boss'`/`'elite'` roles,
`availablePulls`, `FREE_PULL_CAP`, …) keep their words.

## Files changed

- `mobile/src/features/gacha/selectors/homeSelectors.ts`: draw badge, primary button, hero fields
  (rendered or not), draw status line, session preview strings, plus one comment.
- `mobile/src/screens/HomeScreen.tsx`: header and hero "A reward pack is ready", first-draw coach VoiceOver
  label "Open reward pack", plus one comment.
- `mobile/src/features/gacha/library/LibraryHeader.tsx`: first-pack banner title and VoiceOver label.
- `mobile/src/screens/CardDetailScreen.tsx`: locked-card button text and VoiceOver label.
- Tests: `tests/unit/homeSelectors.spec.ts`, `tests/unit/homeBatch3.spec.ts`, `tests/unit/sessionWords.test.tsx`,
  `tests/unit/summary-home.test.ts`, `tests/integration/home-economy-floor.spec.tsx`,
  `tests/integration/home-primary-cta.test.tsx`, `tests/integration/home-cta-target.test.tsx`,
  `tests/integration/home.screen.test.tsx`, `tests/p2-smoke.ts`; new `tests/unit/homePlainWords.spec.ts`.

## Surface shipped (old → new)

Home badge / button (homeSelectors):
- "Pack wallet full ({cap} + {overflow})" → "Saved draws full ({cap} + {overflow} waiting)"
- "{n} pull(s) ready for this pack · {r} more waiting" → "{n} draw(s) ready for this pack · {r} more waiting"
- "{n} pull(s) ready for this pack" → "{n} draw(s) ready for this pack"
- "No cards yet · a free pull returns tomorrow" → "No cards yet · a free draw returns tomorrow"
- "No cards due · a free pull returns tomorrow" → "No cards due · a free draw returns tomorrow"
- "Clear today’s due cards to earn a pull" → "Clear today’s due cards to earn a draw"
- "Learn a new card to earn a pull" → "Learn a new card to earn a draw"
- "Open reward draw" → "Open reward pack"
- "Start/Continue today’s challenge" → "Start/Continue today’s session"

Hero fields (homeSelectors; title is a fallback, the rest are not rendered — facts-copy §10):
- "Install one deck to unlock today’s challenge." → "… today’s session."
- "Finish setup, then start today’s run" → "Finish setup, then start today’s session"
- "…today’s route appears once you hold some." → "…today’s session appears once you hold some."
- "Every card you pull joins today’s run; learning it earns the next pull." → "Every card you draw joins today’s session; learning it earns the next draw."
- "Minimum goal done. Each new card you learn earns a pull." → "… earns a draw."
- "You can stop here or spend pulls and keep momentum." → "You can stop here or open your draws and keep going."
- "{n} card(s) still available for full clear." → "{n} card(s) still available today."
- "Full clear completed" → "All due cards done"
- "Route done. Learn a new card to earn your next pull." → "Session done. Learn a new card to earn your next draw."
- "Great close. Pulls are ready when you want them." → "Great close. Draws are ready when you want them."
- "No remaining route pressure in this deck." → "Nothing left to study in this deck today."
- "Reward wallet is full" → "Saved draws are full"
- "Pulls are full. Today’s review still comes first; spend a pull afterwards." → "Saved draws are full. Today’s review still comes first; open a pack afterwards."
- "{cap} ready and {overflow} reserve are currently occupied." → "{cap} saved and {overflow} extra draws waiting."
- "Each new card you learn earns a pull · up to {n} cards a run." → "Each new card you learn earns a draw · up to {n} cards a session."
- "Clear {n} card(s) to keep momentum. Full run stays capped at {n} cards." → "Clear {n} card(s) to keep making progress. A full session stays capped at {n} cards."
- drawStatusLabel "New pulls unlock after you clear today’s work." → "New draws unlock after you clear today’s work."

Session preview (homeSelectors, dead route preview — facts-copy §10):
- "No active route yet" → "No session yet"; "…then today’s route will appear here." → "…today’s session will appear here."
- "Boss check" → "Final check"; "Elite review" → "Harder recall"
- "Low-friction first win to keep momentum." → "An easy first card to get you going."
- "A tougher recall check to close the run." → "… to close the session."
- "One higher-pressure card in the middle." → "One harder card in the middle."

Home screen: "A reward draw is ready" → "A reward pack is ready" (header and hero); "Open reward draw" → "Open reward pack" (VoiceOver).
Library: "Earn pulls in a session, then open your first pack" → "Earn draws in a session, then open your first pack";
VoiceOver "Earn pulls in a session to open your first pack" → "Earn draws in a session to open your first pack".
Card detail: "Open reward draw" → "Open reward pack" (button and VoiceOver label).

## How it is tested

- Pinning tests updated to the new strings (list above). The sessionWords RoutePreview fixture title now says "Final check".
- New `tests/unit/homePlainWords.spec.ts`: walks every Home status kind × deck shape × wallet state and fails if any
  learner field (hero, CTA, draw badge, status line, session preview) matches the old jargon words; pins the fallback
  hero titles, the empty-deck helper, the status line and the preview titles. It also reads HomeScreen,
  LibraryHeader and CardDetailScreen as source text for the new strings; that source search is only a backstop.
  It shows a literal is somewhere in the file, not which branch it is on or that it reaches the rendered Text or
  VoiceOver label. It failed on the base and passes with the change.
- Rendered coverage of the Library banner and the Card detail locked-card button was added in the r24bx fix round
  (F02 h-tests-1): `tests/integration/plain-words-rendered.screen.test.tsx` renders LibraryHeader in both banner
  branches and CardDetailScreen on a locked card and checks the Text and the accessibilityLabel.
- Negative guards kept green: homeSelectors.spec "subline must not match /normal|elite|boss|pressure|route|node/",
  home-primary-cta "Peek at reward draw" / "Start first draw", the sessionWords "node" guards.
- Gates: `npx tsc --noEmit`, `npx vitest run` (unit 1636, integration 561 passing).

## Owner steps

None. JS-only, OTA-safe.

## Deferred

- `npm run test:smoke` (tests/p2-smoke.ts) fails on the base too, at the summaryMapper `rewardBadge` `/\+2 pull/i`
  assertion (it gets "Progress saved"), and in this worktree also on library type conflicts from the symlinked
  node_modules. Neither is in W02's scope. The one p2-smoke pin W02 owns ("Start today’s session") is updated.
- Code comments in HomeScreen, LibraryScreen and CardDetailScreen that say "pull" are not learner-visible and stay.
