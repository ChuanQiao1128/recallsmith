# A02 — Home batch 1 (`home-batch-1`)

F6 remove mocked packs + empty-state guard · F1 remove kicker + shrink hero copy · F13 center draw label · F15 delete breath loop + reduce-motion guard · F7 wordmark · F8 type floor

## Context

Home renders two hard-coded "Coming soon" packs (`mobile/src/screens/HomeScreen.tsx:50-54`, merged at `:577-589`) that dead-end in an `Alert` (`:632-637`, `:807-810`), runs two infinite `Animated.loop`s with no reduce-motion check (`:130-152`), and stacks a 28pt wordmark (`:503-505`, style `:991`), a breathing kicker (`:710-719`), a two-line hero title and a subline (`:723-728`) so that the primary CTA drops below the fold on 360–390pt phones (gacha-v7 §0.2 item 1 requires the CTA to be visible at 360pt). The draw-status label is left-aligned because `rewardStatusRow` (`:1130-1133`) is never applied, and `TodayPressureCard.tsx:91,108,109` use 9/10pt text below the 11pt caption floor. This issue applies the six verified S-size fixes F6/F1/F13/F15/F7/F8 from `docs/home-review-and-launch-copy-2026-09-17.md` §1.3 (use the 建议改法 column; §1.4 is the target Home v5 layout) exactly as corrected below, and adds five regression cases to `mobile/tests/integration/home.screen.test.tsx`.

Read first, in this order: `HomeScreen.tsx:45-71` (mock constant + `readRN` facades), `:125-155` (animation effect), `:498-531` (header + hero comment), `:532-661` (deck list / featured deck / press handler), `:661-729` (hero JSX), `:731-780` (action group), `:782-858` (selector), `:981-1103` and `:1128-1139` (styles); `TodayPressureCard.tsx:74-110`; `home.screen.test.tsx:1-163` (mocks + fixtures).

## Constraints

- **Scope (only these may change):** `mobile/src/screens/HomeScreen.tsx`, `mobile/src/features/gacha/components/TodayPressureCard.tsx`, `mobile/tests/integration/home.screen.test.tsx`. No other file, no new files.
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also do NOT touch `mobile/src/theme/packArt.ts` (the aws→cloud normalisation is deliberate per `docs/aws-saa-demo-deck-plan-2026-09-16.md:27`) or `mobile/src/features/gacha/selectors/homeSelectors.ts`.
- **No new dependencies; no new imports from `react-native` in HomeScreen.** Do NOT import `src/theme/motion.ts` (its top-level `Easing.out(...)` throws under the home tests' `react-native` mock, `home.screen.test.tsx:12-29`). Every `AccessibilityInfo` / `Easing` access goes through the existing `readRN(key, fallback)` guard (`HomeScreen.tsx:57-64`) and is optional-chained — the four Home test mocks export neither.
- **testIDs that must stay exactly where they are:** `screen-home-root` (SafeAreaView), `screen-home-primary-cta` (View), `home-primary-cta` (via `homeState.vm.cta.testID`, exactly one Pressable), `home-pack-visual` (the horizontal ScrollView — ALWAYS rendered, even with 0 or 1 tiles), `home-draw-status-badge` (on the `Text` whose `children` is `homeState.vm.draw.label` — never on a wrapper), `home-featured-pack`, `home-today-count-grid/-normal/-elite/-boss/-total`, `home-study-due-link`, `home-first-draw-link`, `home-collapse-decks-toggle`, `home-collapse-week-support-toggle`, `home-deck-row-{slug}` (hidden `HomeDeckRow` probes at `:928-941` keep calling `handleDeckPress` — `home-primary-cta.test.tsx:507` depends on it), `home-error-retry`.
- **Byte-identical:** `TodayPressureCard.tsx` style keys `metric` (`:93-100`), `metricWide` (`:101`), `metricCompact` (`:102`) and the `width < 390` compact rule (`:20-21`) — `home-primary-cta.test.tsx:269-275` compares them. The four label strings `Normal` / `Elite` / `Boss` / `Total` stay (`home-primary-cta.test.tsx:264-267`).
- **Ordering:** TodayPressureCard stays ABOVE the CTA (gacha-v7 §3.1.1: counts before CTA). The pack stays 168×240 (`heroPackFloat` / `heroPackFallback`) and `heroHalo` stays 240.
- **Banned literal:** the string `Coming soon` / `coming soon` must not appear anywhere in `HomeScreen.tsx` after the change (gacha-v7 §3.2.3). Use `Soon`.
- **Existing test literals allowed to change:** none. You may only ADD cases to `home.screen.test.tsx`; do not alter or delete the five existing `it(...)` blocks.

## Changes required

1. **F6 — delete the mocked shelf (`HomeScreen.tsx:45-54`, `:541-593`).**
   a. Delete the comment block and `MOCKED_HOME_DECKS` constant (`:45-54`) and `realSlugSet` (`:542`) and the whole `mockedFillerDecks` merge (`:577-588`). Set `const visualDecks = realVisualDecks;` (`:589`).
   b. Introduce a local type above `HomeScreen` and use it for the array so the empty fallback type-checks:
      ```ts
      type HomeVisualDeck = {
        slug: string;
        title: string;
        realRow: HomeDeckVM | null;
        cover: ReturnType<typeof packImageForSlug>;
        palette: ReturnType<typeof packPaletteFromSlug>;
        status: string;
        isFullyMastered: boolean;
        disabled: boolean;
        selected: boolean;
      };
      ```
      `const realVisualDecks: HomeVisualDeck[] = realRows.map(...)` — drop the `tagline: ''` field (`:566`); set `disabled: realRow.actionHint === 'none'` (`:572`); and add the first status branch `if (realRow.actionHint === 'none') status = 'Soon';` before the `paywall` branch (`:558`). `statusDotColor` (`:613`) takes `HomeVisualDeck` and its first line becomes `if (!deck.realRow || deck.status === 'Soon') return colors.inkMuted;`.
   c. Empty-state guard (required — `home-cta-target.test.tsx:265-288` mounts Home with zero deck summaries). Replace `:590-602` (both `featuredDeck` and the duplicate `featuredDeckProvisional`) with ONE constant:
      ```ts
      const EMPTY_FEATURED: HomeVisualDeck = {
        slug: 'default',
        title: 'Your first pack',
        realRow: null,
        cover: packImageForSlug('default'),
        palette: packPaletteFromSlug('default'),
        status: 'Soon',
        isFullyMastered: false,
        disabled: true,
        selected: false,
      };
      const featuredDeck: HomeVisualDeck =
        visualDecks.find((d) => d.selected)
        ?? visualDecks.find((d) => !d.disabled)
        ?? visualDecks[0]
        ?? EMPTY_FEATURED;
      const isFeaturedMastered = featuredDeck.isFullyMastered;
      ```
      `heroTitle` (`:603-610`) keeps its expression (it already falls through to `homeState.vm.hero.headline`).
   d. `handleFeaturedPackPress` (`:631-638`): replace the `Alert.alert(... Coming soon ...)` branch with `if (!featuredDeck.realRow) { void refreshHome(); return; }`. The rest of the handler is unchanged (F12 is a later batch). Pack Pressable `accessibilityLabel` (`:675`) becomes `featuredDeck.realRow ? \`Open ${featuredDeck.title} pack\` : 'Connect to load packs'`. Keep the `Alert` import — `:403` still uses it.
   e. Selector (`:783-812`): label text `Choose a pack` → `Your packs`. Keep the `ScrollView testID="home-pack-visual"` unconditional (no length check, no early return). On each tile Pressable add `disabled={d.disabled}` and replace the `onPress` body with:
      ```ts
      onPress={() => {
        if (!d.realRow) return;
        const hint = d.realRow.actionHint;
        if (hint === 'open' || hint === 'none') {
          void setActiveDeckSlug(d.slug);
          setSelectedSlug(d.slug);
          void refreshHome();
          return;
        }
        void handleDeckPress(d.realRow);
      }}
      ```
      No `Alert` anywhere in the selector. The hidden `home-deck-row-*` probes (`:928-941`) are NOT changed.
   f. Rewrite the three stale comments so the literal `Coming soon` and the words "mock"/"kicker" disappear from the file (the verify grep is case-insensitive on `coming soon` and also matches comments): the hero comment `:525-531` (drop "kicker breathes"), the list-build comment `:533-540` (say: real manifest rows only; `availability: 'coming'` rows render as disabled "Soon" tiles), and the press-handler comment line `:623` (`mocked-only … → Coming soon alert` → `no real deck (empty manifest) → refresh`).

2. **F1 + F15 — delete the kicker and the breath loop, gate the bob (`HomeScreen.tsx:125-155`, `:706-728`, `:1024-1028`, `:1070-1103`).**
   a. Delete `kickerBreathRef` (`:131`), the `breath` loop + `breath.start()` + `breath.stop()` (`:140-147`, `:150`), and the kicker `AnimatedView` block (`:706-719`). Delete styles `heroKickerWrap` and `heroKicker` (`:1070-1081`). Rewrite the comment at `:125-129` to describe the single bob.
   b. Add two module-level facades next to `RNImage` (`:65`): `const AI: any = readRN('AccessibilityInfo', null);` and `const RNEasing: any = readRN('Easing', null);`.
   c. Replace the `[]` effect body (`:132-152`) with exactly this shape:
      ```ts
      useEffect(() => {
        if (!hasAnimated) return;
        const easing = RNEasing?.inOut ? RNEasing.inOut(RNEasing.ease) : undefined;
        const bob = A.loop(
          A.sequence([
            A.timing(packBobRef.current, { toValue: 1, duration: 2400, easing, useNativeDriver: true }),
            A.timing(packBobRef.current, { toValue: 0, duration: 2400, easing, useNativeDriver: true }),
          ]),
        );
        let stopped = false;
        const apply = (enabled: boolean) => {
          if (enabled) {
            try { bob.stop(); } catch { /* noop */ }
            packBobRef.current?.setValue?.(0.5);
          } else if (!stopped) {
            bob.start();
          }
        };
        AI?.isReduceMotionEnabled?.().then(apply).catch(() => bob.start()) ?? bob.start();
        const sub = AI?.addEventListener?.('reduceMotionChanged', apply);
        return () => {
          stopped = true;
          try { bob.stop(); } catch { /* noop */ }
          sub?.remove?.();
        };
      }, []);
      ```
      `packTranslateY` (`:153-155`, amplitude −3/+3) is unchanged. No `duration: 1500` / `duration: 1100` may remain.
   d. Hero copy: the `heroTitle` Text (`:723-725`) becomes `numberOfLines={1}`; delete the `heroSupport` Text (`:726-728`) and its style (`:1091-1098`). `heroTitle` style (`:1082-1090`) is unchanged and stays the only `typography.title1` in the hero.
   e. Spacing: `heroBand.paddingBottom` `spacing.lg` → `spacing.md` (`:1027`); `actionGroup.marginTop` `spacing.md` → `spacing.sm` (`:1102`).

3. **F13 — center the draw label (`HomeScreen.tsx:756-762`, `:1128-1139`).** Do NOT add a wrapper node. Delete `rewardStatusRow` (`:1130-1133`). `rewardStatusText` becomes:
   ```ts
   rewardStatusText: {
     marginTop: spacing.sm,
     alignSelf: 'center',
     textAlign: 'center',
     fontSize: typography.caption,
     fontWeight: '800',
     color: colors.inkSecondary,
     letterSpacing: 0.3,
   },
   ```
   The `testID="home-draw-status-badge"` stays on that `Text` (`:757`).

4. **F7 — wordmark (`HomeScreen.tsx:991`).** `title: { fontSize: typography.title3, fontWeight: '900', letterSpacing: 0.4, color: colors.inkSecondary },` (drop `marginTop: 4`). The `DeveloperCards` text (`:503-505`), `headerStatusSubtitle` and the settings gear (`:516-523`) are unchanged. The `heroSupport` half of F7 is superseded by 2d (the subline is no longer rendered).

5. **F8 — type floor.**
   a. `TodayPressureCard.tsx:91` `subtitle` → `{ marginTop: 2, fontSize: typography.caption, color: colors.inkSecondary }`; `:107` `metricValue` → `{ fontSize: typography.title3, fontWeight: '900', color: colors.ink }`; `:108` `metricLabel` → `{ marginTop: 2, fontSize: typography.caption, fontWeight: '800', color: colors.inkSecondary, letterSpacing: 0.5 }` (drop `textTransform: 'uppercase'`); `:109` `footnote` → `{ marginTop: 8, fontSize: typography.caption, color: colors.inkSecondary }`. Nothing else in the file changes (see Constraints: `metric`/`metricWide`/`metricCompact`/`:20-21` byte-identical; `card`/`row`/`title` untouched).
   b. `HomeScreen.tsx:1009` `homeNoticeText.fontSize: 12` → `typography.bodySmall`; `:1251` `errorRetryText.fontSize: 12` → `typography.bodySmall`. Leave `settingsText` (`:1015`, glyph) and `footerLinkArrow` (`:1287`, glyph) as they are.

6. **Tests — append five cases to `mobile/tests/integration/home.screen.test.tsx` inside the existing `describe('HomeScreen v9')`, with these exact titles** (the verify script greps them). Add `import { Alert } from 'react-native';` next to the `HomeScreen` import (`:113`) — the mock at `:26` exposes `Alert.alert` as a `vi.fn`. A dry run of these five cases against the fixed source passes (30/30) and each of the five fails on the base tree. Helper: `const textBlob = (tree) => tree.root.findAll((n) => n.type === 'Text').map((n) => Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')).join('\n')`; tiles = `tree.root.findByProps({ testID: 'home-pack-visual' }).findAll((n) => n.type === 'Pressable' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.includes(' pack — '))`.
   1. `it('lists only real packs under Your packs', ...)` — default fixtures (csharp + aws): `tiles` has length 2; text blob contains `Your packs`, does not contain `Choose a pack`, and no tile label contains `Coming`.
   2. `it('selects an installed pack in place without leaving Home', ...)` — press the tile whose label starts with `AWS Core pack`; expect `setActiveDeckSlugMock` toHaveBeenCalledWith `'aws'` and `navigateMock` not toHaveBeenCalledWith `'Library'`.
   3. `it('renders the hero and pack shelf with zero decks', ...)` — `deckSummariesFixture = []`, `activeSlugFixture = null`, `(Alert.alert as any).mockClear()`; expect `home-pack-visual` and `home-featured-pack` to exist, `tiles` length 0, the `home-featured-pack` Pressable's `accessibilityLabel` toBe `'Connect to load packs'`, and after pressing it `Alert.alert` not called and `navigateMock` not called.
   4. `it('renders a manifest coming deck as a disabled Soon tile', ...)` — push `{ slug: 'aws-saa-c03', title: 'AWS SAA-C03', locale: 'en-US', version: '1', deckType: 1, availability: 'coming', totalCards: 120, localCards: 0, studyCards: 0, canStudy: false, dueToday: 0, plannedToday: 0, newToday: 0, masteredApprox: 0, percent: 0 }` onto the fixture; the tile with label `AWS SAA-C03 pack — Soon` exists and has `props.disabled === true`; `tiles` length 3.
   5. `it('centers the draw status label under the CTA', ...)` — select the HOST node, not the mock component: `badge = tree.root.find((n) => n.props?.testID === 'home-draw-status-badge' && (n.type as any) === 'Text')` (`findByProps` returns the composite `Text` mock, whose `type` is a function); expect `badge.props.style` toEqual `expect.objectContaining({ textAlign: 'center', alignSelf: 'center' })`.

## Acceptance

Run from the worktree root. All five are re-run verbatim by `docs/delivery/r16-issues/A02.verify.sh`.

- `cd mobile && npx vitest run tests/integration/home.screen.test.tsx tests/integration/home-primary-cta.test.tsx tests/integration/home-cta-target.test.tsx tests/integration/home-economy-floor.spec.tsx --reporter=dot` — 4 files pass, 30 tests (25 existing + 5 new).
- `cd mobile && npm run test:typecheck` — exit 0.
- HomeScreen + test grep guards (exit 0): `f=mobile/src/screens/HomeScreen.tsx; t=mobile/tests/integration/home.screen.test.tsx; ! grep -Eq "MOCKED_HOME_DECKS|[Cc]oming soon|Choose a pack|kickerBreathRef|heroKicker|heroSupport|rewardStatusRow|duration: 1500|duration: 1100|theme/motion" "$f" && grep -q "Your packs" "$f" && grep -q "readRN('AccessibilityInfo'" "$f" && grep -q "isReduceMotionEnabled" "$f" && grep -q "reduceMotionChanged" "$f" && [ "$(grep -c 'duration: 2400' "$f")" = 2 ] && grep -q "Connect to load packs" "$f" && grep -q "status = 'Soon'" "$f" && grep -q "disabled={d.disabled}" "$f" && grep -q "style={styles.heroTitle} numberOfLines={1}" "$f" && grep -q "testID=\"home-pack-visual\"" "$f" && grep -q "testID=\"home-draw-status-badge\"" "$f" && for s in 'lists only real packs under Your packs' 'selects an installed pack in place without leaving Home' 'renders the hero and pack shelf with zero decks' 'renders a manifest coming deck as a disabled Soon tile' 'centers the draw status label under the CTA'; do grep -Fq "it('$s'" "$t"; done`
- TodayPressureCard guards (exit 0): `p=mobile/src/features/gacha/components/TodayPressureCard.tsx; ! grep -Eq "fontSize: (9|10|18)[,} ]|textTransform" "$p" && grep -Fq "metricWide: { flex: 1, minWidth: 0 }," "$p" && grep -Fq "metricCompact: { width: '48%' }," "$p" && grep -Fq "const useCompactMetrics = width < 390;" "$p" && [ "$(grep -c 'typography.caption' "$p")" = 3 ]`
- Scope + frozen guard (exit 0): `mb=$(git merge-base HEAD delivery/r16-a-home); [ -z "$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/theme/packArt.ts mobile/src/features/gacha/selectors/homeSelectors.ts)" ] && [ -z "$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard; } | grep -Ev '^(mobile/src/screens/HomeScreen\.tsx|mobile/src/features/gacha/components/TodayPressureCard\.tsx|mobile/tests/integration/home\.screen\.test\.tsx)$' )" ]`

## DO NOT

- Do NOT reorder the CTA above `TodayPressureCard`; do NOT shrink the 168×240 pack or the 240 halo; do NOT change `heroTitle`'s font size.
- Do NOT touch `packArt.ts`, `homeSelectors.ts`, `HomeDeckRow.tsx`, `deckActionResolver.ts`, or any file outside the three scope paths. The `statusLabel: 'Coming soon'` in `homeSelectors.ts:580` is out of scope (it only feeds the hidden probe).
- Do NOT apply F2/F3/F4/F5/F9/F10/F11/F12/F14/F16 (later batches) — no label renames in TodayPressureCard, no `handleFeaturedPackPress` re-routing beyond the empty-state branch, no `vm.goal` line.
- Do NOT add a wrapper `View` around the draw-status `Text`; do NOT move any testID.
- Do NOT import `motion.ts`, `AccessibilityInfo` or `Easing` by name from `react-native`.
- Do NOT modify or delete existing `it(...)` cases, existing fixtures' values, or any test in `home-primary-cta.test.tsx` / `home-cta-target.test.tsx` / `home-economy-floor.spec.tsx`.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy / EAS command, no `npm ci`, no test gutting (no `.skip`, no `@ts-ignore`, no `eslint-disable`, no loosening tsconfig).
