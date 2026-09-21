#!/usr/bin/env bash
# C03 — home-batch-3 verify. cwd = worktree root. Re-runs the brief's
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/tests/unit/homeBatch3.spec.ts does not exist on base
#   - the C01/C02 prerequisites are absent on base too: constants.ts still says
#     FREE_PULL_CAP = 30, sessionBuilder.ts still has `effectiveNew`, and
#     planner/loadForecast.ts does not exist (C03 mirrors C02's limit formula,
#     so both must be merged before C03 is cut)
# Step 2 (literal guards) would also fail on base: the three locked labels, the
# two F9 sublines, `masteredCount`, `'Caught up'` and the moved test literals
# are all absent. Steps 3/4 are the tsc / targeted-vitest gates and step 5 is a
# purely negative scope + frozen + OTA guard; those pass on base by design.
#
# Network: none. No npm install, no expo, no prebuild. Runtime ~60-90 s
# (tsc once + eleven vitest files).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C03 VERIFY FAIL: $*" >&2; exit 1; }

CONTRACTS=mobile/src/features/gacha/contracts.ts
SEL=mobile/src/features/gacha/selectors/homeSelectors.ts
RES=mobile/src/features/gacha/home/deckActionResolver.ts
HOME_SCREEN=mobile/src/screens/HomeScreen.tsx
FAQ=mobile/src/content/faq.ts
SPEC=mobile/tests/unit/homeBatch3.spec.ts
T_HOME=mobile/tests/integration/home.screen.test.tsx
T_SEL=mobile/tests/unit/homeSelectors.spec.ts
T_FLOOR=mobile/tests/integration/home-economy-floor.spec.tsx
T_CTA=mobile/tests/integration/home-primary-cta.test.tsx
# prerequisites (C01 / C02)
CONSTANTS=mobile/src/features/gacha/constants.ts
BUILDER=mobile/src/features/gacha/planner/sessionBuilder.ts
FORECAST=mobile/src/features/gacha/planner/loadForecast.ts

# ── 1. Scope files exist (FAILS ON BASE) + C01/C02 prerequisites ───────────
echo "[1/5] scope files exist (+ C01/C02 prerequisites)"
[ -f "$SPEC" ] || fail "$SPEC does not exist (base tree fails here)"
for f in "$CONTRACTS" "$SEL" "$RES" "$HOME_SCREEN" "$FAQ" "$T_HOME" "$T_SEL" "$T_FLOOR" "$T_CTA"; do
  [ -f "$f" ] || fail "$f does not exist"
done
grep -Fq "export const FREE_PULL_CAP = 60;" "$CONSTANTS" || fail "constants.ts: FREE_PULL_CAP is not 60 — C01 must be merged before C03"
grep -Fq "Math.min(SESSION_MAIN_ROUTE_DEFAULT, dueCount + newCount)" "$BUILDER" || fail "sessionBuilder.ts lacks C02's limit formula — C02 must be merged before C03"
grep -q "effectiveNew" "$BUILDER" && fail "sessionBuilder.ts still has effectiveNew — C02 incomplete"
[ -f "$FORECAST" ] || fail "$FORECAST is missing — C02 must be merged before C03"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. contracts.ts — masteredCount? appended after percent inside DeckSummary
grep -Fq "masteredCount?: number;" "$CONTRACTS" || fail "contracts.ts lacks masteredCount?: number;"
grep -F -A3 "  percent: number;" "$CONTRACTS" | grep -Fq "masteredCount?: number;" \
  || fail "contracts.ts: masteredCount? must sit within three lines after percent: number;"
# base already has LibraryStatusCounts.masteredCount (:99, non-optional) and a comment mention (:114);
# the new field is the only optional one and must not land on TodayCounts.
[ "$(grep -c "masteredCount?:" "$CONTRACTS" || true)" -eq 1 ] || fail "contracts.ts: exactly one optional 'masteredCount?:' (DeckSummary only)"
grep -Fq "  masteredCount: number;" "$CONTRACTS" || fail "contracts.ts: LibraryStatusCounts.masteredCount (:99) must be untouched"
awk '/^export type TodayCounts = \{/{t=1} t && /masteredCount/{bad=1} t && /^\};/{t=0} END{exit bad}' "$CONTRACTS" \
  || fail "contracts.ts: masteredCount must not be added to TodayCounts"

# 2b. deckActionResolver.ts — isMasteredProgress import + three masteredCount literals
grep -Eq "import \{[^}]*isMasteredProgress[^}]*\} from '\.\./selectors/progressSelectors';" "$RES" \
  || fail "deckActionResolver.ts must import isMasteredProgress from ../selectors/progressSelectors"
grep -Fq "isMasteredProgress(" "$RES" || fail "deckActionResolver.ts never calls isMasteredProgress("
grep -Fq "ownedSet.has(" "$RES"     || fail "deckActionResolver.ts: the mastered filter must apply the owned gate (ownedSet.has)"
[ "$(grep -c "masteredCount: 0," "$RES" || true)" -eq 2 ] || fail "deckActionResolver.ts needs exactly two 'masteredCount: 0,' (the non-studiable branches)"
grep -F -A1 "masteredApprox: learned," "$RES" | grep -Fq "masteredCount: mastered," \
  || fail "deckActionResolver.ts: 'masteredCount: mastered,' must follow 'masteredApprox: learned,'"
grep -Fq "masteredApprox: learned," "$RES" || fail "deckActionResolver.ts: masteredApprox must keep meaning learned"
grep -Fq "percent: clamp01(learned / denom)," "$RES" || fail "deckActionResolver.ts: percent must still be fed by learned"

# 2c. homeSelectors.ts — signatures, the three locked labels, the two F9 sublines, the preview formula
for sym in \
  "function buildDrawVM(wallet?: RewardWalletState | null, selectedDeck?: DeckSummary | null): HomeDrawVM" \
  "buildDrawVM(wallet, selectedDeck)" \
  "draw: HomeDrawVM;" \
  "'No cards due · a free pull returns tomorrow'" \
  "'Clear today’s due cards to earn a pull'" \
  "'Learn a new card to earn a pull'" \
  "'Minimum goal done. Each new card you learn earns a pull.'" \
  "'Route done. Learn a new card to earn your next pull.'" \
  'Each new card you learn earns a pull · up to ${SESSION_MAIN_ROUTE_DEFAULT} cards a run.' \
  "Math.min(SESSION_MAIN_ROUTE_DEFAULT, due + selectedDeck.newToday)" \
  "selectedDeck.newToday >= 1" \
  "'New pulls unlock after you clear today’s work.'" \
  "'You can stop here or spend pulls and keep momentum.'" \
  "'Great close. Pulls are ready when you want them.'" \
  "'Pulls are full. Today’s review still comes first; spend a pull afterwards.'" \
  "state: 'locked'"; do
  grep -Fq "$sym" "$SEL" || fail "homeSelectors.ts lacks: $sym"
done
for bad in "Review today’s cards" "Math.min(selectedDeck.newToday, 2)" "Math.max(due, 1)" \
           "export function buildDrawVM" "export function buildHeroCopy" "Clear today's route"; do
  if grep -Fq "$bad" "$SEL"; then grep -Fn "$bad" "$SEL" >&2 || true; fail "homeSelectors.ts still contains: $bad"; fi
done
# the draw VM must be built before the hero copy receives it
awk '/const draw = buildDrawVM\(wallet, selectedDeck\);/{d=NR} /const heroCopy = buildHeroCopy\(/{h=NR} END{exit !(d>0 && h>0 && d<h)}' "$SEL" \
  || fail "homeSelectors.ts: buildDrawVM(wallet, selectedDeck) must precede buildHeroCopy(...) in buildHomeVM"

# 2d. HomeScreen.tsx — kicker + masteredCount
for sym in "'Caught up'" \
           "const masteredCount = (realRow.deck as any)?.masteredCount ?? 0;" \
           "masteredCount >= totalCards && dueCount === 0" \
           "'All caught up for now'" "'A reward draw is ready'" "'Tap your pack to begin'" \
           "'Mastered ✓'" "'Deck mastered 🎉'" \
           'testID="home-draw-status-badge"' 'testID="home-goal-line"' 'testID="home-pack-visual"'; do
  grep -Fq "$sym" "$HOME_SCREEN" || fail "HomeScreen.tsx lacks: $sym"
done
grep -Fq "selectedDeckRow?.deck.canStudy" "$HOME_SCREEN" || fail "HomeScreen.tsx: the Caught up branch must read selectedDeckRow?.deck.canStudy"
if grep -q "masteredApprox" "$HOME_SCREEN"; then
  grep -n "masteredApprox" "$HOME_SCREEN" >&2 || true
  fail "HomeScreen.tsx must no longer read masteredApprox (F11)"
fi
grep -q "subline" "$HOME_SCREEN" && fail "HomeScreen.tsx must not render hero.subline (F9 is VM-only, C00 §6 #6)"
[ "$(grep -c 'testID="home-primary-cta"\|testID={homeState.vm.cta.testID}' "$HOME_SCREEN" || true)" -eq 1 ] \
  || fail "HomeScreen.tsx: exactly one primary CTA testID"

# 2e. faq.ts — the two answers, the R1/R2 header, no old-rule sentence
grep -Fq "Every new card you learn earns 1 pull the first time you rate it Hard or better, and clearing all of today's due cards earns 1 more, once a day. New accounts start with 3 starter pulls, and if you have no cards left to study and no pulls, a 1-pull daily floor keeps you going. Pulls are never sold." "$FAQ" \
  || fail "faq.ts: 'How do I earn pulls?' answer is not the pinned text"
grep -Fq "Draw locks when you have no pulls to spend. Learn a new card to earn one, or wait for the daily floor pull if you have nothing left to study." "$FAQ" \
  || fail "faq.ts: 'Why is Draw locked?' answer is not the pinned text"
head -8 "$FAQ" | grep -q "R1" || fail "faq.ts header must name R1"
head -8 "$FAQ" | grep -q "R2" || fail "faq.ts header must name R2"
for bad in "per fully" "Fully clear today" "Clear today's review" "Clear today’s review"; do
  grep -Fq "$bad" "$FAQ" && fail "faq.ts still says: $bad"
done
grep -Fq "q: 'How do I earn pulls?'" "$FAQ" || fail "faq.ts: question 1 changed"
grep -Fq "q: 'Why is Draw locked?'" "$FAQ"  || fail "faq.ts: question 2 changed"

# 2f. tests — new spec, add-only integration cases, moved literals
grep -q "from 'fast-check'" "$SPEC" || fail "homeBatch3.spec.ts must use fast-check"
grep -q "fc.assert("          "$SPEC" || fail "homeBatch3.spec.ts has no fc.assert property"
grep -Fq "buildChallengeRoute" "$SPEC" || fail "homeBatch3.spec.ts must compare the preview against buildChallengeRoute"
grep -Fq "loadHomeDeckSummaries" "$SPEC" || fail "homeBatch3.spec.ts must exercise loadHomeDeckSummaries for masteredCount"
for s in \
  'says a free pull returns tomorrow when the selected deck is caught up' \
  'asks for the due cards when only due work remains' \
  'asks for a new card in every other locked case' \
  'keeps the three unlocked draw states untouched' \
  'tells a done-for-today user that each new card earns a pull while locked' \
  'tells a full-clear user to learn a new card while locked' \
  'leaves the wallet-full subline alone' \
  'counts mastered cards by stage, not by having been reviewed' \
  'reports masteredCount 0 for a deck that is not studiable' \
  'previews exactly as many nodes as the planner would schedule' \
  'previews as many nodes as the planner limit for any due/new pair'; do
  grep -Fq "it('$s'" "$SPEC" || fail "missing homeBatch3 test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$SPEC" || true)" -ge 11 ] || fail "homeBatch3.spec.ts needs >= 11 it() blocks"
for s in \
  'says Caught up in the header when the selected deck is clear and pulls are locked' \
  'celebrates a mastered deck only when every card reached the mastery stage'; do
  grep -Fq "it('$s'" "$T_HOME" || fail "missing home.screen.test.tsx case: $s"
done
[ "$(grep -cE "^\s*it\(" "$T_HOME" || true)" -ge 14 ] || fail "home.screen.test.tsx needs >= 14 it() blocks (12 existing + 2)"
grep -Fq "'No cards due · a free pull returns tomorrow'" "$T_HOME" || fail "home.screen.test.tsx must assert the caught-up badge"
grep -Fq "'Deck mastered 🎉'" "$T_HOME" || fail "home.screen.test.tsx must assert the mastered hero title"
grep -Fq "'Each new card you learn earns a pull · up to 5 cards a run.'" "$T_SEL" || fail "homeSelectors.spec.ts:293 literal not moved"
grep -Fq "toBe('Learn a new card to earn a pull')" "$T_SEL" || fail "homeSelectors.spec.ts:332 literal not moved"
grep -Fq "Review today’s cards" "$T_SEL" && fail "homeSelectors.spec.ts still pins the old locked label"
grep -Fq "expect(badgeText(tree)).toBe('Learn a new card to earn a pull');" "$T_FLOOR" || fail "home-economy-floor.spec.tsx:221 literal not moved"
grep -Fq "expectedDrawBadge: 'Learn a new card to earn a pull'," "$T_CTA" || fail "home-primary-cta.test.tsx:283 literal not moved"
grep -Fq "Review today’s cards" "$T_FLOOR" "$T_CTA" && fail "an integration test still pins the old locked label"
# the four existing titles around the moved literals must survive untouched
for s in 'hero subline no longer names route roles' 'draw badge speaks in pulls, not reserve'; do
  grep -Fq "it('$s'" "$T_SEL" || fail "homeSelectors.spec.ts lost: $s"
done
grep -Fq "it('leaves a user with cards to study exactly as poor as they were'" "$T_FLOOR" || fail "home-economy-floor.spec.tsx lost its second case"
grep -Fq "'keeps v9 reward gateway contract for %s wallet state'" "$T_CTA" || fail "home-primary-cta.test.tsx lost the gateway contract table"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" \
  "$CONTRACTS" "$SEL" "$RES" "$HOME_SCREEN" "$FAQ" "$SPEC" "$T_HOME" "$T_SEL" "$T_FLOOR" "$T_CTA" \
  && fail "test gutting / suppression found"

# ── 3. Typecheck (tests/ is under strict: true too) ────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest ─────────────────────────────────────────────────────
echo "[4/5] vitest homeBatch3 + the Home suites that pin the moved literals"
( cd mobile && npx vitest run \
    tests/unit/homeBatch3.spec.ts \
    tests/unit/homeSelectors.spec.ts \
    tests/unit/homeOwnedGate.spec.ts \
    tests/unit/summary-home.test.ts \
    tests/unit/deckActionResolver.spec.ts \
    tests/unit/planner.test.ts \
    tests/integration/home.screen.test.tsx \
    tests/integration/home-economy-floor.spec.tsx \
    tests/integration/home-primary-cta.test.tsx \
    tests/integration/home-cta-target.test.tsx \
    tests/integration/more.screen.test.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen + OTA guard (purely negative; passes on base) ────────
echo "[5/5] scope + frozen + OTA guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/review/storage.ts mobile/vitest.config.ts mobile/tsconfig.json mobile/tests/setup \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  mobile/src/features/gacha/planner mobile/src/features/gacha/components/TodayPressureCard.tsx \
  mobile/src/navigation/types.ts mobile/src/config \
  mobile/tests/unit/homeOwnedGate.spec.ts mobile/tests/unit/summary-home.test.ts \
  mobile/tests/unit/deckActionResolver.spec.ts mobile/tests/unit/planner.test.ts \
  mobile/tests/integration/home-cta-target.test.tsx mobile/tests/integration/more.screen.test.tsx mobile/tests/p2-smoke.ts)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed (OTA on 1.6.0 requires it)"
grep -Fq '"vite": "7.2.4"' mobile/package.json           || fail "vite pin changed"
grep -Fq '"version": "1.6.0"' mobile/app.json            || fail "app.json version is not 1.6.0"
grep -rq "@sentry" mobile/src 2>/dev/null && fail "@sentry reference found under mobile/src"
# exact line budgets on the three literal-move files and add-only on home.screen.test.tsx
ns() { git diff --numstat "$mb" -- "$1" | cut -f1,2; }
[ "$(ns "$T_SEL")"   = $'2\t2' ] || { ns "$T_SEL" >&2;   fail "homeSelectors.spec.ts must change exactly two lines (:293, :332)"; }
[ "$(ns "$T_FLOOR")" = $'1\t1' ] || { ns "$T_FLOOR" >&2; fail "home-economy-floor.spec.tsx must change exactly one line (:221)"; }
[ "$(ns "$T_CTA")"   = $'1\t1' ] || { ns "$T_CTA" >&2;   fail "home-primary-cta.test.tsx must change exactly one line (:283)"; }
home_del="$(git diff --numstat "$mb" -- "$T_HOME" | cut -f2)"
[ -n "$home_del" ] && [ "$home_del" = "0" ] || fail "home.screen.test.tsx must be add-only (deleted lines: ${home_del:-no diff})"
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json docs; } \
  | sort -u | grep -Ev '^(mobile/src/features/gacha/contracts\.ts|mobile/src/features/gacha/selectors/homeSelectors\.ts|mobile/src/features/gacha/home/deckActionResolver\.ts|mobile/src/screens/HomeScreen\.tsx|mobile/src/content/faq\.ts|mobile/tests/unit/homeBatch3\.spec\.ts|mobile/tests/integration/home\.screen\.test\.tsx|mobile/tests/unit/homeSelectors\.spec\.ts|mobile/tests/integration/home-economy-floor\.spec\.tsx|mobile/tests/integration/home-primary-cta\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C03 scope"; }

echo "C03 VERIFY OK"
