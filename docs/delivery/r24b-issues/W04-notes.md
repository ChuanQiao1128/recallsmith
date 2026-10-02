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
3. When is a rare card guaranteed? — after 10 Commons the next card is Rare or better while a Rare/Legendary is missing ("a rare card is guaranteed within 11 cards"); no repeat draws (a card you have drawn never comes up again; F04 wording); Open 1 / Open 10, you only spend draws for cards you receive.
4. What do I study? — the three free English decks with the §4 card counts, multiple-choice explanations (.NET and AWS), FSRS, 90-day cap, Mastered at 15+ days, iOS only.
5. Why is a card locked in the Library? — unchanged meaning, "pulled" → "drawn".
6. Does it work offline? Do I need an account? — "The first cards of each deck are in the app, so your first lesson works offline…"; full deck downloads online; account optional (cloud backup, Report a card, Premium; nothing premium to unlock yet).
7. How are the cards made? — AI-assisted from official documentation (AWS, Anthropic, Microsoft Learn), automated checks and AI review passes, Report a problem (F04 removed the "spot-checked by the developer" claim: no record supports it).

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
members and route-preview role values). F04: the allow-list is the `allow` field of the homeSelectors entry and
applies to that module only (it was global before, which exempted those words in every guarded module).

PENDING as W04 shipped it (owned by other issues of this wave). The merge did NOT empty it on its own: on
release/r24b (cd6a0c6) the honesty test was red for all five entries. F04 (r24bx) emptied the list; every §3
module now runs its own "uses plain words" test and passes:
- `features/gacha/draw/ceremonyCopy.ts` — W01 #669
- `features/gacha/selectors/homeSelectors.ts` — W02 #670
- `features/gacha/session/summaryMapper.ts`, `features/gacha/rewards/rewardResolver.ts`, `features/gacha/mcq/mcqConstants.ts` — W03 #671

A separate test keeps PENDING honest: each listed module must be a §3 module and must still contain a banned word, so
once W01-W03 land the test fails until the entry is removed by hand. Modules guarded and green when W04 shipped: `pity.ts`, `faq.ts`,
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

W04 as shipped needed one: after merging W01-W03, delete their entries from PENDING in plainWordsGuard.test.ts (the
honesty test turns red until someone does; nothing does it automatically). W03's three modules were already clean
on r24b-x. Done in F04 (r24bx); no owner step is left.

## Deferred / notes

- `mobile/app.json` photo-permission text ("saves a pull card image") belongs to R01.
- `npm run test:smoke` (`tests/p2-smoke.ts`) fails on the base as well: it asserts "+2 pull" on summaryMapper reward copy, which W03 owns. Not touched here.
- `tests/unit/otaReleaseScript.test.ts` and `tests/unit/releasePlumbing190.test.ts` timed out at vitest's 5 s default (on the base commit as well) while the machine's load average was above 30. Their spawn-heavy `describe` blocks now carry an explicit 30 s `timeout` (`SPAWN_TIMEOUT_MS`). Every assertion is unchanged and the gate is green.
  Correction (F04): W03 changed the same lines of `otaReleaseScript.test.ts` with `OTA_CASE_TIMEOUT_MS`, so the release
  merge of waves e and x conflicted there; it was resolved by hand in cbf4e1c (W03's constant kept). R01 edited
  `releasePlumbing190.test.ts` the same way; the merged file keeps one constant (`SPAWN_TIMEOUT_MS`).
