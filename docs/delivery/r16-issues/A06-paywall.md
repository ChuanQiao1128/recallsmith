# A06 — R3 paywall: price + period, Terms of Use / Privacy links, remote hide flag on the Home + Settings entrances

> Line numbers below are as of base `92cebbd` on `delivery/r16-a-home`. A02 and A04 land on the integration branch before your worktree is cut and rewrite large parts of `HomeScreen.tsx` (A02 removes the mocked packs and the kicker, A04 replaces `handleFeaturedPackPress` and adds the goal line) and add nine Home test cases, so every `HomeScreen.tsx` anchor drifts by dozens of lines. Locate by identifier, never by number: before editing grep for `action.kind === 'paywall'`, `const isPremiumUser`, `'../premium/premiumStore'` and the `handleDeckPress` `useCallback` deps array `[isPremiumUser, isSignedIn, navigation, refreshHome]`.

## Context

The Premium paywall asks for a recurring purchase without ever showing a price or a Terms of Use link: `mobile/src/screens/PaywallScreen.tsx:209-212` renders the whole billing disclosure as the literal `Monthly subscription`, and `mobile/src/premium/revenuecat.ts:391-406` fetches the RevenueCat offering (`Purchases.getOfferings()` at `:395`) only inside the purchase call, so `pkg.product.priceString` never reaches the UI (App Review Guideline 3.1.2 — `mobile/docs/qa/1.5.0-preflight-findings.md:28-40`, `docs/home-review-and-launch-copy-2026-09-17.md:441`, `docs/release-1.6.0-plan-2026-09-19.md:238` row R3). This change renders `${priceString} / month` in the Billing row, adds Terms of Use + Privacy Policy links on the paywall, and hides the two entrances (`mobile/src/screens/SettingsScreen.tsx:326-341` "Open premium" card, `mobile/src/screens/HomeScreen.tsx:389-392` `navigation.navigate('Paywall')`) when the remote flag `features.paywall.hidden` is true. The flag store is delivered by A01 (`mobile/src/config/featureFlags.ts`: `getFeatureFlags()` sync, `useFeatureFlags()` hook, `applyRemoteFeatures()`); read that file FIRST and use the export names it actually has.

Read before editing, in this order:
- `mobile/src/config/featureFlags.ts` (A01 output — confirm `useFeatureFlags` / `getFeatureFlags` names and the merged-defaults shape `{ paywall: { hidden: boolean } }`)
- `mobile/src/screens/PaywallScreen.tsx:2-24` (imports: no `Linking`, no `useEffect` yet), `:158-287` (JSX), `:209-212` (Billing row), `:234-259` (purchase Pressable), `:278-280` (footer)
- `mobile/src/premium/revenuecat.ts:246-281` (`ensureConfigured`), `:351-365` (`pickMonthlyPackage`), `:391-406` (`rcPurchaseMonthly`)
- `mobile/src/screens/SettingsScreen.tsx:50-51` (`PRIVACY_URL`), `:93-100` (hooks block), `:184` (first early return — hooks must go above it), `:326-341` (Premium card)
- `mobile/src/screens/HomeScreen.tsx:4` (`Alert` already imported), `:108-111` (premium hooks), `:376-411` (`handleDeckPress`, deps array at `:410`)
- `mobile/tests/integration/settings.screen.test.tsx:25-133` (the mock set a Settings render needs) and `:289-305` (existing "Open premium" test that must stay green unchanged)

## Constraints

- Scope — only these paths may change: `mobile/src/screens/PaywallScreen.tsx`, `mobile/src/premium/revenuecat.ts`, `mobile/src/screens/SettingsScreen.tsx`, `mobile/src/screens/HomeScreen.tsx`, and the NEW file `mobile/tests/integration/paywall.screen.test.tsx`. Nothing else, no new files elsewhere, no shared-constants module.
- Frozen (gacha-v7.md §2.1, wave rule): `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts` — zero diff.
- `revenuecat.ts` is additive only: ONE new exported function; do not change any existing export's signature or behaviour; do not add `@ts-ignore` (the file has exactly 4 today at `:263,:265,:375,:377` — that count must stay 4).
- No new dependencies (`package.json` / lockfile unchanged). No `@ts-ignore`, `@ts-expect-error`, `eslint-disable` anywhere in the diff.
- Existing testIDs to keep untouched: `screen-settings-root`, `screen-settings-primary-cta` (SettingsScreen), `screen-home-root`, `home-featured-pack`, `screen-home-primary-cta`, `home-pack-visual` (HomeScreen; `home-primary-cta` lives in the hero child component and is asserted by the Home suites). New testIDs (exact): `paywall-billing-value`, `paywall-subscribe`, `paywall-terms-link`, `paywall-privacy-link`.
- Exact literals this change introduces (tests grep them; do not paraphrase):
  - `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/` (Terms of Use)
  - Privacy URL: byte-identical copy of `SettingsScreen.tsx:51` — `https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Privacy-Policy-2bfa758eb54580db99a3ed89369f9a13?pvs=74`
  - Link labels: `Terms of Use`, `Privacy Policy`
  - Billing values: `${priceString} / month` (single space each side of `/`), `Loading price…` (Unicode ellipsis), `Not available right now`
  - Home hidden-tap alert: title `Not available right now`, body `Premium packs are not available yet. Free packs stay open.`
- Literals allowed to disappear: `Monthly subscription` (PaywallScreen only). Do NOT change any literal that `settings.screen.test.tsx` or the four Home suites assert (`Premium`, `Open premium`, everything in Home).
- Copy rules: no `coming soon` / `placeholder` / `MVP` (gacha-v7 §3.2.3); no odds/percentages.
- Rules of hooks: `useFeatureFlags()` must be called unconditionally at the top of the component, above every early `return` (SettingsScreen has three at `:184`, `:204`, `:235`).
- HomeScreen is also touched by A02/A04 in this wave: keep the HomeScreen diff to the hook line + the `handleDeckPress` paywall branch + its deps array (≈10 lines). Do not reformat or move anything else in that file.
- Test conventions: `react-test-renderer` + the per-file `vi.mock('react-native', …)` double (copy `settings.screen.test.tsx:25-45` and add `Linking: linkingMock`). `vi.mock` factories are hoisted above the file's `const`s, so anything a factory reads EAGERLY must be created with `vi.hoisted`: `const linkingMock = vi.hoisted(() => ({ canOpenURL: vi.fn(async () => true), openURL: vi.fn(async (_url: string) => {}) }));` (a plain `const` here throws "Cannot access 'linkingMock' before initialization"). Mocks that are only called lazily inside arrow functions (`() => rcGetMonthlyPackageSafeMock()`, `() => featureFlagsMock()`) can stay plain `const`s. Mock `../../src/premium/revenuecat` and `../../src/config/featureFlags` at module level; never import the real `react-native-purchases`, `aws-amplify/auth`, or `expo-*` in this suite.

## Changes required

1. `mobile/src/premium/revenuecat.ts` — add, directly after `rcPurchaseMonthly` (`:406`), one export:
   ```ts
   /** Paywall display only: current monthly package, or null when RC is not configured / no offering / network error. Never throws. */
   export async function rcGetMonthlyPackageSafe(): Promise<PurchasesPackage | null> {
     try {
       await ensureConfigured();
       const offerings = await Purchases.getOfferings();
       return pickMonthlyPackage(offerings);
     } catch (e) {
       if (__DEV__) console.warn('[rc] getOfferings failed (non-fatal):', (e as any)?.message ?? e);
       return null;
     }
   }
   ```
   No login call (price display must work signed-out). `rcPurchaseMonthly` keeps its own `getOfferings` call — do not refactor it.

2. `mobile/src/screens/PaywallScreen.tsx` — price state + Billing row + conditional purchase button:
   - Imports: add `useEffect` to the React import (`:2`), add `Linking` to the `react-native` import (`:3-11`), add `rcGetMonthlyPackageSafe` to the `../premium/revenuecat` import (`:19-24`).
   - Module-level constants (after the imports, before `type Props`):
     `const TERMS_OF_USE_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';`
     `const PRIVACY_URL = '<byte-identical to SettingsScreen.tsx:51>'; // keep in sync with SettingsScreen.tsx PRIVACY_URL (verify.sh diffs them)`
   - State: `type PricingState = { kind: 'loading' } | { kind: 'ready'; label: string } | { kind: 'unavailable' };` and `const [pricing, setPricing] = React.useState<PricingState>({ kind: 'loading' });`
   - Fetch once on mount (plain `useEffect(() => {…}, [])` with a `cancelled` guard, NOT inside the sign-in-gated `useFocusEffect` at `:36-58`): `const pkg = await rcGetMonthlyPackageSafe(); const price = String(pkg?.product?.priceString ?? '').trim(); setPricing(price ? { kind: 'ready', label: `${price} / month` } : { kind: 'unavailable' });`
   - Billing row (`:209-212`): replace the `Monthly subscription` value with `<Text style={styles.kValue} testID="paywall-billing-value">{pricing.kind === 'ready' ? pricing.label : pricing.kind === 'loading' ? 'Loading price…' : 'Not available right now'}</Text>`. The `Monthly subscription` literal must no longer exist in the file.
   - Purchase button (`:234-259`): render the `Pressable` ONLY when `pricing.kind === 'ready'` (`{pricing.kind === 'ready' ? (<Pressable testID="paywall-subscribe" …existing props…>) : null}`). Everything inside the Pressable (busy spinner, `Premium active` / `Unlock Premium` / `Sign in to continue` labels, `handleSubscribe`) is unchanged. `Restore Purchases` (`:261-273`) stays always rendered.
   - Legal links: directly below the `footerBox` (`:278-280`) add a row `<View style={styles.legalRow}>` with two `Pressable`s — `testID="paywall-terms-link"` label `Terms of Use` → `onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}`, and `testID="paywall-privacy-link"` label `Privacy Policy` → `onPress={() => void Linking.openURL(PRIVACY_URL)}` — separated by a `·` Text. Add `legalRow` (row, centered, `marginTop: 12`, `gap: 8`), `legalLinkText` (`fontSize: 12`, `color: colors.pokeBlueDeep`, `fontWeight: '800'`) and `legalDot` (`fontSize: 12`, `color: colors.inkMuted`) to the `StyleSheet` (`:301+`). Use `Linking.openURL` directly (not `canOpenURL` first) so the test can assert one call per press.

3. `mobile/src/screens/SettingsScreen.tsx` — hide the Premium card behind the flag:
   - `import { useFeatureFlags } from '../config/featureFlags';` next to the other config import (`:18`).
   - In the hooks block (`:93-100`, above the first early return at `:184`): `const featureFlags = useFeatureFlags(); const paywallHidden = featureFlags.paywall.hidden === true;`
   - Wrap the Premium card (`:326-341`) as `{paywallHidden ? null : (<View style={styles.sectionCard}>…unchanged…</View>)}`. `PREMIUM_COPY`, `PRIVACY_URL`, `SUPPORT_URL`, `AboutSection` props: unchanged.

4. `mobile/src/screens/HomeScreen.tsx` — hide the Home entrance behind the flag (minimal diff):
   - `import { useFeatureFlags } from '../config/featureFlags';` next to `../premium/premiumStore` (`:38`).
   - After `const isPremiumUser = …` (`:111`): `const paywallHidden = useFeatureFlags().paywall.hidden === true;`
   - In `handleDeckPress` (`:389-392`) replace the branch with:
     ```ts
     if (action.kind === 'paywall') {
       if (paywallHidden) {
         Alert.alert('Not available right now', 'Premium packs are not available yet. Free packs stay open.');
         return;
       }
       navigation.navigate('Paywall');
       return;
     }
     ```
     and add `paywallHidden` to the `useCallback` deps at `:410`. Nothing else in HomeScreen changes (`handleFeaturedPackPress` already routes paywall hints through `handleDeckPress` at `:641-647`).

5. NEW `mobile/tests/integration/paywall.screen.test.tsx` (vitest + react-test-renderer, same helpers as `settings.screen.test.tsx:137-170`: `flush`, `nodeText`, `findPressableByText`, `findHostNodesByTestID`). Module mocks: `react-native` (with the shared `linkingMock` `{ canOpenURL, openURL }`), `react-native-safe-area-context`, `expo-linear-gradient`, `@react-navigation/native` (`useFocusEffect` → `useEffect`), `../../src/auth/authStore` (`status: 'signed_in'`, `email`, `loading: false`, `signOutNow`), `../../src/premium/premiumStore` (`usePremiumUser: () => false`, `setIsPremiumUser: vi.fn(async () => {})`), `../../src/premium/revenuecat` (`rcGetMonthlyPackageSafe: () => rcGetMonthlyPackageSafeMock()`, plus `rcPurchaseMonthly`, `rcRestore`, `rcGetCustomerInfoSafe` as `vi.fn(async () => ({ entitlements: { active: {} } }))`, `isPremiumActive: () => false`), `../../src/config/featureFlags` (`useFeatureFlags: () => featureFlagsMock()`, `getFeatureFlags: () => featureFlagsMock()`, default `{ mcq: { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false }, paywall: { hidden: false } }`), and — for the Settings block — every mock from `settings.screen.test.tsx:68-133` (`async-storage`, `expo-file-system`, `react-native-purchases`, `deckRepository`, `remoteConfig`, `reminders`, `audiencePrefs`, `review/storage`, `streakTracker`). Set `(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true` in `beforeEach`. Cases (names exact so verify.sh can count them):
   - `describe('PaywallScreen')`
     1. `it('renders priceString with the monthly period and the purchase button when a package is available')` — mock resolves `{ product: { identifier: 'premium_monthly', priceString: 'NZ$4.99' } }`; after `flush()`: `findHostNodesByTestID(tree, 'Text', 'paywall-billing-value')[0]` text equals `NZ$4.99 / month`; `findHostNodesByTestID(tree, 'Pressable', 'paywall-subscribe')` has length 1; joined text blob does NOT contain `Not available right now` and does NOT contain `Monthly subscription`.
     2. `it('renders Not available right now and no purchase button when no priceString is available')` — mock resolves `null`; billing value text equals `Not available right now`; `paywall-subscribe` Pressables length 0; `Restore Purchases` Pressable still present (`findPressableByText`).
     3. `it('opens Terms of Use and Privacy Policy with Linking.openURL')` — press `paywall-terms-link` then `paywall-privacy-link`; `expect(linkingMock.openURL).toHaveBeenNthCalledWith(1, 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')` and `toHaveBeenNthCalledWith(2, 'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Privacy-Policy-2bfa758eb54580db99a3ed89369f9a13?pvs=74')`.
   - `describe('SettingsScreen paywall entrance')`
     4. `it('hides the Open premium card when features.paywall.hidden is true')` — `featureFlagsMock` returns `paywall: { hidden: true }`; render `SettingsScreen` with the `settings.screen.test.tsx:172-188` harness; joined text blob does NOT contain `Open premium`; `screen-settings-root` and `screen-settings-primary-cta` still exactly 1 each.
     5. `it('shows the Open premium card and routes to Paywall when the flag is false')` — default flags; blob contains `Open premium`; pressing it calls `navigate('Paywall')`.

## Acceptance

Run from the worktree root. All must pass; `A06.verify.sh` runs exactly these.

- `cd mobile && npm run test:typecheck`
- `cd mobile && npx vitest run tests/integration/paywall.screen.test.tsx --reporter=dot` (file must exist; 5 tests, all green)
- `cd mobile && npx vitest run tests/integration/settings.screen.test.tsx tests/integration/home.screen.test.tsx tests/integration/home-cta-target.test.tsx tests/integration/home-primary-cta.test.tsx tests/integration/home-economy-floor.spec.tsx --reporter=dot` (regression, unchanged files; all tests in the five files green — the count grows after A02/A04, so do not pin it)
- Literal / testID guards (each is a `grep -q` in verify.sh): `PaywallScreen.tsx` contains `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`, ` / month`, `Not available right now`, `Loading price…`, `Terms of Use`, `Privacy Policy`, `paywall-billing-value`, `paywall-subscribe`, `paywall-terms-link`, `paywall-privacy-link`, `rcGetMonthlyPackageSafe`, and does NOT contain `Monthly subscription`; the Privacy URL line in `PaywallScreen.tsx` is byte-identical to `SettingsScreen.tsx`'s; `revenuecat.ts` exports `rcGetMonthlyPackageSafe` and still has exactly 4 `@ts-ignore`; `SettingsScreen.tsx` and `HomeScreen.tsx` each import from `'../config/featureFlags'` and reference `paywall.hidden`; `HomeScreen.tsx` contains `Premium packs are not available yet. Free packs stay open.`; the diff adds no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`/`coming soon`.
- Diff guards: `git diff --numstat $(git merge-base HEAD delivery/r16-a-home)` touches only the 5 scope paths (untracked files likewise), zero lines in the three frozen files, `mobile/package.json` + `mobile/package-lock.json` unchanged.

## DO NOT

- No push, no PR, never touch `main`, no deploy (`eas update`, `eas build`, `expo publish`, etc.), no `npm ci` / `npm install`.
- Do not disable, skip, delete, or weaken any test; do not edit `settings.screen.test.tsx` or any Home suite — they are out of scope and must stay green as-is.
- Do not touch the frozen files, `DeckScreen.tsx:318` (Library/Deck paywall entrance is out of scope; A09 owns Library), `AboutSection.tsx`, `App.tsx`, `navigation/types.ts`, or anything under `mobile/src/config/` (A01 owns the flag store — consume it, do not modify it).
- Do not gate the price fetch on sign-in, do not call `Purchases.*` from the screen, do not add a `getOfferings` retry loop, do not cache the price in AsyncStorage.
- Do not export `PRIVACY_URL` from `SettingsScreen.tsx` and import a screen module into `PaywallScreen.tsx` (that drags the whole Settings import graph into the paywall); duplicate the literal and keep it byte-identical.
- Do not add pricing copy beyond what is specified (no auto-renew boilerplate, no trial wording, no odds/percentages), and do not rename/remove existing Paywall alerts or the `Restore Purchases` control.
- Do not change the RevenueCat env keys, entitlement/product IDs, `ALLOW_SANDBOX` logic, or anything that could initiate a live charge.
