# W04 (#672) — Plain words: Me, Profile, Help/FAQ, Settings, notifications + plain-words guard

Round r24b, wave e. Contract: `~/.rimv-delivery/r24b-common/R24B-00-contracts.md` §1-§4, facts-copy §3, §9, §14.
Copy-only: no behaviour, layout, navigation, economy or scheduling change. Identifiers, storage keys,
route names and event names are unchanged.

## What changed (files)

| File | Change |
|---|---|
| `mobile/src/content/faq.ts` | `FAQ_LIST` rewritten (7 entries) so every answer is true per §4; new `FAQ_DISCLAIMER` (the two §2 lines). Header comment no longer uses the old words. |
| `mobile/src/screens/HelpFAQScreen.tsx` | Intro body in plain words; renders `FAQ_DISCLAIMER` as the footer (`testID="help-faq-disclaimer"`, one Text per line). |
| `mobile/src/screens/MoreScreen.tsx` | Help row subtitle "Pulls, pity, offline, Android" → "Draws, rare cards, offline, devices". |
| `mobile/src/screens/ProfileScreen.tsx` | Chips "Momentum, Progress" → "Streak, Progress"; section "Momentum this week" → "Progress this week"; "Qualified runs" → "Sessions that counted"; "best run {n}" → "best streak {n}" (the value is `longestDailyStreak`, a streak length). |
| `mobile/src/screens/SettingsScreen.tsx` | Section title "Momentum" → "Progress"; "{n} days streak · {m} qualified sessions" → "{n} days streak · {m} sessions that counted". |
| `mobile/src/screens/MistakeBookScreen.tsx` | `REVIEW_HINT` (VoiceOver hint) → "Starts a focus session with these mistakes". |
| `mobile/src/notifications/reminders.ts` | Evening notification body → "You still have cards due today. Finish a quick session to stay on track." |
| `mobile/src/features/gacha/reminders/reminderPlanner.ts` | "Evening rescue at …" / "Evening rescue off" → "Evening reminder at …" / "Evening reminder off". |
| `mobile/src/features/gacha/settings/feedback/FeedbackSection.tsx` | Sound row → "Pack opening sounds. They stay quiet when your ringer is on silent." |
| `mobile/src/features/gacha/settings/account/AccountSection.tsx` | Delete-account body → "…the progress, cards and saved draws stored for it on our servers and on this device…". |

## FAQ surface shipped

1. How do I earn draws? — learn a new card (first Remembered/Hard/Good/Easy or a correct multiple-choice answer) earns a draw for its pack; clearing the pack's due cards adds one a day; 3 the first time a pack is opened and 3 at the end of the first lesson; 60 saved + 5 extra waiting per pack; never sold.
2. Why is Draw locked? — no draws for the picked pack; learn a card, or 1 free draw a day when nothing is left to study.
3. When is a rare card guaranteed? — after 10 Commons the next card is Rare or better while a Rare/Legendary is missing ("a rare card is guaranteed within 11 cards"); no duplicates; Open 1 / Open 10, you only spend draws for cards you receive.
4. What do I study? — the three free English decks with the §4 card counts, multiple-choice explanations (.NET and AWS), FSRS, 90-day cap, Mastered at 15+ days, iOS only.
5. Why is a card locked in the Library? — unchanged meaning, "pulled" → "drawn".
6. Does it work offline? Do I need an account? — "The first cards of each deck are in the app, so your first lesson works offline…"; full deck downloads online; account optional (cloud backup, Report a card, Premium; nothing premium to unlock yet).
7. How are the cards made? — AI-assisted from official documentation (AWS, Anthropic, Microsoft Learn), automated checks and AI review passes, spot-checked by the developer, Report a card.

Removed entries: "What is pity?" (now entry 3), "Is there an Android version?" (§4 forbids Android), "Is there a dark mode?"
(not one of the required topics; keeps the list at 7 within the 6-8 rule).

Footer: "Not official exam material and not an exam simulator." and the trademark line naming Amazon, Anthropic and Microsoft.

## Guard test

`mobile/tests/unit/plainWordsGuard.test.ts` parses each §3 module with the TypeScript compiler API, collects string
literals and the literal parts of template literals (text inside `${…}` is code, not copy), and fails on
`/\b(pulls?|pity|wallet|reserve|run|runs|boss|elite|node|full clear|readiness)\b/i`. `ceremonyCopy.ts` is scanned
only inside `CEREMONY_COPY_V9` / `CEREMONY_COPY_V10` (the test fails if either declaration disappears).
Not copy and skipped: import/export specifiers, literal types, property-name keys, element-access keys, and an exact
allow-list of homeSelectors code tokens (`'reserve'`, `'wallet-full'`, `'boss'`, `'elite'`: `HomeDrawState`
members and route-preview role values).

PENDING (owned by other issues of this wave; the release merge empties the list):
- `features/gacha/draw/ceremonyCopy.ts` — W01 #669
- `features/gacha/selectors/homeSelectors.ts` — W02 #670
- `features/gacha/session/summaryMapper.ts`, `features/gacha/rewards/rewardResolver.ts`, `features/gacha/mcq/mcqConstants.ts` — W03 #671

A separate test keeps PENDING honest: each listed module must be a §3 module and must still contain a banned word, so
once W01-W03 land the test fails until the entry is removed. Modules guarded and green now: `pity.ts`, `faq.ts`,
`mainTabs.ts`, `reminders.ts`, `reminderPlanner.ts`, `starterCopy.ts`, `collectionCopy.ts`.

## How it is tested

Tests were committed first and failed on the base (16 failures), then the copy change made them pass.
- `tests/unit/plainWordsGuard.test.ts` (new).
- `tests/integration/more.screen.test.tsx` — FAQ facts, forbidden claims, `FAQ_DISCLAIMER` exact text and rendered footer, Help row subtitle, Profile "Progress this week".
- `tests/integration/me-final.screen.test.tsx`, `me-real-data.spec.tsx` — Profile labels, "best streak 9".
- `tests/integration/settings.screen.test.tsx`, `settings-background-refresh.spec.tsx` — "Progress", "0 days streak · 0 sessions that counted".
- `tests/integration/mistakeBookDoneState.test.tsx` — `REVIEW_HINT`.
- `tests/unit/reminders.test.ts` — evening notification body.
- `tests/unit/p6-systems.test.ts` — "Evening reminder at 20:00" / "Evening reminder off".
- `tests/unit/settings-copy.spec.ts` — sound body, delete-account body, no old words in Settings section copy.

Commands: `cd mobile && npx tsc --noEmit && npx vitest run`.

## Owner steps

None for this issue. The release merge removes each PENDING entry once W01-W03 are merged (the honesty test forces it).

## Deferred / notes

- `mobile/app.json` photo-permission text ("saves a pull card image") belongs to R01.
- `npm run test:smoke` (`tests/p2-smoke.ts`) fails on the base as well: it asserts "+2 pull" on summaryMapper reward copy, which W03 owns. Not touched here.
- `tests/unit/otaReleaseScript.test.ts` times out (5 s per spawned script) in this worktree on the base commit as well; environmental, unrelated to copy.
