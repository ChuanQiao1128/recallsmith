#!/usr/bin/env bash
# C02 — new-card-quota-forecast verify. cwd = worktree root. Re-runs the brief's
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/features/gacha/planner/loadForecast.ts and
#     mobile/tests/unit/loadForecast.test.ts do not exist on base
#   (step 1 then also checks the C01 prerequisite: sessionRewards.ts must
#   exist and export settleRatingReward with a newCardsLearnedToday step field,
#   because the screen feeds that number into computeTomorrowLoad)
# Step 2 (literal guards) would also fail on base: sessionBuilder.ts still
# carries `effectiveNew` / `Math.max(dueCount, 1)` and the five test literals
# are still at their old values. Steps 3/4 are the tsc / targeted-vitest gates
# and step 5 is a purely negative scope + frozen + OTA guard; both pass on base
# by design.
#
# Not repeated here (the driver runs them after this script): the full mobile
# root gate (npm run test:typecheck && npx vitest run), the diff-scoped
# banned-term grep (its list lives in the driver's wave config) and the
# suppression scan over the whole diff.
#
# Network: none. No npm install, no expo, no prebuild. Runtime ~20 s.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C02 VERIFY FAIL: $*" >&2; exit 1; }

SB=mobile/src/features/gacha/planner/sessionBuilder.ts
LF=mobile/src/features/gacha/planner/loadForecast.ts
SC=mobile/src/screens/SessionCardScreen.tsx
HS=mobile/src/features/gacha/selectors/homeSelectors.ts
SR=mobile/src/features/gacha/rewards/sessionRewards.ts
LT=mobile/tests/unit/loadForecast.test.ts
PT=mobile/tests/unit/planner.test.ts
OT=mobile/tests/unit/ownedGatePredicates.test.ts
SM=mobile/tests/p2-smoke.ts
ST=mobile/tests/integration/session-card.screen.test.tsx
EF=mobile/tests/integration/economy-floor.spec.tsx
OG=mobile/tests/integration/owned-gate-entry-points.spec.tsx

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C01 prerequisite)"
for f in "$LF" "$LT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$SB" "$SC" "$PT" "$OT" "$SM" "$ST" "$EF" "$OG"; do
  [ -f "$f" ] || fail "$f is missing"
done
[ -f "$SR" ] || fail "$SR is missing — C01 must be merged before C02 (the screen reads step.newCardsLearnedToday)"
grep -Eq "export (async )?function settleRatingReward" "$SR" || fail "sessionRewards.ts lacks settleRatingReward (C01 incomplete)"
grep -Fq "newCardsLearnedToday" "$SR"                        || fail "sessionRewards.ts lacks newCardsLearnedToday (C01 incomplete)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. sessionBuilder.ts — the §2.5 formula, byte for byte; the quota and the floor are gone
grep -Fq "const limit = hasTodayWork ? Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dueCount + newCount)) : 1;" "$SB" \
  || fail "sessionBuilder.ts: the C00 §2.5 limit line is missing or not byte-identical"
grep -Fq "const hasElite = dueCount >= 2 || newCount >= 1;" "$SB" || fail "sessionBuilder.ts: hasElite must read newCount >= 1"
grep -Fq "const hasBoss = dueCount >= 3;" "$SB"                   || fail "sessionBuilder.ts: hasBoss line changed"
grep -Fq "const hasTodayWork = dueCount > 0 || newCount > 0;" "$SB" || fail "sessionBuilder.ts: hasTodayWork line changed"
grep -Fq "import { SESSION_MAIN_ROUTE_DEFAULT, SESSION_MIN_GOAL } from '../constants';" "$SB" || fail "sessionBuilder.ts: constants import changed"
grep -Fq "fresh" "$SB"                                            || fail "sessionBuilder.ts: the summary's 'fresh' wording must stay"
if grep -Eq "effectiveNew|Math\.max\(dueCount, 1\)" "$SB"; then
  grep -En "effectiveNew|Math\.max\(dueCount, 1\)" "$SB" >&2 || true
  fail "sessionBuilder.ts still rations new cards / floors dueCount (base tree fails here)"
fi
[ "$(grep -c '^export function' "$SB" || true)" -eq 1 ] || fail "sessionBuilder.ts must keep exactly one export function (buildSweepRoute is C04's)"
# 2b. loadForecast.ts — exports, constants, copy, purity
for sym in "export const FORECAST_START = 20;" "export const FORECAST_STEP = 10;" "export type TomorrowLoad" \
           "export function computeTomorrowLoad" "export function forecastLine" \
           "import { buildUpcoming } from '../selectors/progressSelectors';" \
           "tomorrowDue" "milestone" "newCardsLearnedToday" \
           'At this pace, about ${n} card${n === 1 ? '"'"' comes'"'"' : '"'"'s come'"'"'} due tomorrow.'; do
  grep -Fq "$sym" "$LF" || fail "loadForecast.ts lacks: $sym"
done
if grep -Eq "from 'react|require\(|Date\.now|Math\.random|AsyncStorage|Alert|from '\.\./constants'" "$LF"; then
  grep -En "from 'react|require\(|Date\.now|Math\.random|AsyncStorage|Alert|from '\.\./constants'" "$LF" >&2 || true
  fail "loadForecast.ts must stay pure (no react / require / clock / randomness / storage / dialog) and needs nothing from constants.ts"
fi
# 2c. SessionCardScreen.tsx — import, testID, wiring, style, no dialog on the added lines
grep -Fq "import { computeTomorrowLoad, forecastLine } from '../features/gacha/planner/loadForecast';" "$SC" || fail "SessionCardScreen.tsx: loadForecast import missing"
grep -Fq 'testID="session-card-load-forecast"' "$SC" || fail "SessionCardScreen.tsx: forecast testID missing"
grep -Fq '<Text testID="session-card-load-forecast" numberOfLines={2} style={styles.forecastLine}>' "$SC" || fail "SessionCardScreen.tsx: the C00 §2.5 opening tag <Text testID=\"session-card-load-forecast\" numberOfLines={2} style={styles.forecastLine}> is missing or wrapped over several lines"
grep -Fq "computeTomorrowLoad({" "$SC" || fail "SessionCardScreen.tsx: computeTomorrowLoad not called"
grep -Eq "newCardsLearnedToday: [A-Za-z_][A-Za-z0-9_]*\.newCardsLearnedToday" "$SC" || fail "SessionCardScreen.tsx: forecast must read <step>.newCardsLearnedToday from C01's settled step"
grep -Fq "progress: nextState.updatedProgress," "$SC" || fail "SessionCardScreen.tsx: forecast must read nextState.updatedProgress"
grep -Eq "^\s*forecastLine: \{" "$SC" || fail "SessionCardScreen.tsx: styles.forecastLine missing"
grep -Fq "const [loadForecast, setLoadForecast] = useState<string | null>(null);" "$SC" || fail "SessionCardScreen.tsx: state line 'const [loadForecast, setLoadForecast] = useState<string | null>(null);' missing"
grep -Fq "setLoadForecast(null);" "$SC" || fail "SessionCardScreen.tsx: the forecast is not cleared on load (setLoadForecast(null);)"
if grep -Eq "const \[forecastLine," "$SC"; then
  fail "SessionCardScreen.tsx: the state must not be named forecastLine (it shadows the import) — use loadForecast/setLoadForecast"
fi
# 2d. homeSelectors.ts is C03's (C00 §6 #7)
# (checked against the merge base in step 5; here only that the old preview formula is still there,
#  i.e. nobody 'helpfully' aligned it in this issue)
grep -Fq "const fresh = Math.min(selectedDeck.newToday, 2);" "$HS" || fail "homeSelectors.ts buildRoutePreview was edited — that is C03's change, not C02's"
# 2e. moved test literals
grep -Fq "expect(challenge.limit).toBe(5);" "$PT"   || fail "planner.test.ts: due 3/new 2 must expect limit 5"
grep -Fq "expect(planned.limit).toBe(3);" "$PT"     || fail "planner.test.ts: due 1/new 2 must expect limit 3"
grep -Fq "expect(challenge.limit).toBe(4);" "$PT"   && fail "planner.test.ts still expects limit 4 (base tree fails here)"
grep -Fq "expect(planned.limit).toBe(2);" "$PT"     && fail "planner.test.ts still expects limit 2 for due 1/new 2"
grep -Fq "expect(planned.limit).toBe(4);" "$OT"     || fail "ownedGatePredicates.test.ts: ungated due 2/new 2 must expect limit 4"
grep -Fq "expect(planned.limit).toBe(2);" "$OT"     || fail "ownedGatePredicates.test.ts: gated due 1/new 1 must still expect limit 2"
grep -Fq "expect(planned.limit).toBe(3);" "$OT"     && fail "ownedGatePredicates.test.ts still expects limit 3"
grep -Fq "assert.equal(challenge.limit, 5);" "$SM"        || fail "p2-smoke.ts: challenge.limit must be 5"
grep -Fq "assert.equal(plannedChallenge.limit, 3);" "$SM" || fail "p2-smoke.ts: plannedChallenge.limit must be 3"
grep -Fq "assert.equal(challenge.limit, 4);" "$SM"        && fail "p2-smoke.ts still asserts limit 4"
grep -Fq "assert.equal(plannedChallenge.limit, 2);" "$SM" && fail "p2-smoke.ts still asserts limit 2"
grep -Fq "expect(blob).toContain('Run 0/1');" "$EF" || fail "economy-floor.spec.tsx: the one-owned-card run must read Run 0/1"
grep -Fq "'Run 0/2'" "$EF"                          && fail "economy-floor.spec.tsx still pins Run 0/2 (the F10 two-node route)"
grep -Fq "Clear today’s run (1 cards) for +2 free pulls." "$OG" || fail "owned-gate-entry-points.spec.tsx: the one-owned-card challenge must read (1 cards)"
grep -Fq "Clear today’s run (2 cards) for +2 free pulls." "$OG" && fail "owned-gate-entry-points.spec.tsx still pins (2 cards)"
grep -Fq "expect(blob).toContain('Run 0/1');" "$OG" || fail "owned-gate-entry-points.spec.tsx: the zero-owned Run 0/1 pin must stay"
# 2f. new / kept it() titles
for s in \
  'creates a boss-ending route for a real due backlog' \
  'creates a one-node maintenance route when today is clear' \
  'derives counts from deck progress' \
  'does not force a boss node when there is no high-pressure backlog' \
  'counts overdue scheduled cards into today' \
  'prefers due cards in review-due mode' \
  'prefers new cards in learn-new mode' \
  'falls back to updated learned cards in mixed mode when no due cards exist' \
  'reuses the avoided uid only when no better candidate exists' \
  'gives a single new card a one-node route' \
  'grows the route with every new card up to the cap'; do
  grep -Fq "it('$s'" "$PT" || fail "missing planner test case: $s"
done
for s in \
  'plans a route off whole-deck counts' \
  'plans a shorter route because the deck is no longer the pool'; do
  grep -Fq "it('$s'" "$OT" || fail "missing ownedGatePredicates test case: $s"
done
grep -Fq "it('walks from an empty collection to exactly one studiable card'" "$EF" || fail "economy-floor.spec.tsx: first-day case missing"
grep -Fq "it('sizes today’s run from the collection, not the deck file'" "$OG"     || fail "owned-gate-entry-points.spec.tsx: challenge-route case missing"
for s in \
  'starts a session and routes to SessionSummary after the last rating' \
  'passes the planner minimum goal to SessionSummary' \
  'uses Continue in the route-complete state' \
  'routes to SessionSummary when Continue is pressed in the route-complete state' \
  'shows passive trial preview progress without adding another action' \
  'keeps rating dock mounted while content scrolls' \
  'shows the tomorrow-load forecast line on the 20th new card and not on the 19th'; do
  grep -Fq "it('$s'" "$ST" || fail "missing session-card screen test case: $s"
done
grep -Fq "session-card-load-forecast" "$ST" || fail "session-card.screen.test.tsx: forecast testID not asserted"
grep -Fq "settleRatingReward" "$ST"         || fail "session-card.screen.test.tsx: the forecast case must arm C01's settleRatingReward mock"
grep -Eq "newCardsLearnedToday: 20|rateOnce\(20\)|stepWith\(20\)" "$ST" || fail "session-card.screen.test.tsx: a step reporting newCardsLearnedToday 20 is not exercised"
grep -Eq "newCardsLearnedToday: 19|rateOnce\(19\)|stepWith\(19\)" "$ST" || fail "session-card.screen.test.tsx: a step reporting newCardsLearnedToday 19 is not exercised"
for s in \
  'flags a milestone at 20 and at every 10th new card after it' \
  'never flags a milestone below 20 or between steps' \
  'counts only owned cards when a gate is passed' \
  'says nothing off a milestone' \
  'pins the forecast copy for zero, one and many cards'; do
  grep -Fq "it('$s'" "$LT" || fail "missing loadForecast test case: $s"
done
grep -Fq "it(\"reads tomorrow's due count off the two-day calendar\"" "$LT" || fail "missing loadForecast test case: reads tomorrow's due count off the two-day calendar"
grep -q "from 'fast-check'" "$LT"  || fail "loadForecast.test.ts must use fast-check (C00 §3.3)"
grep -q "fc.assert(" "$LT"         || fail "loadForecast.test.ts has no fc.assert property"
grep -Fq "buildUpcoming" "$LT"     || fail "loadForecast.test.ts must cross-check tomorrowDue against buildUpcoming"
for s in "At this pace, about 0 cards come due tomorrow." "At this pace, about 1 card comes due tomorrow." "At this pace, about 12 cards come due tomorrow."; do
  grep -Fq "$s" "$LT" || fail "loadForecast.test.ts does not pin the copy: $s"
done
[ "$(grep -cE "^\s*it\(" "$PT" || true)" -ge 11 ] || fail "planner.test.ts needs >= 11 it() blocks"
[ "$(grep -cE "^\s*it\(" "$OT" || true)" -eq 19 ] || fail "ownedGatePredicates.test.ts must keep exactly 19 it() blocks"
[ "$(grep -cE "^\s*it\(" "$EF" || true)" -eq 12 ] || fail "economy-floor.spec.tsx must keep exactly 12 it() blocks"
[ "$(grep -cE "^\s*it\(" "$ST" || true)" -ge 8 ]  || fail "session-card.screen.test.tsx needs >= 8 it() blocks"
[ "$(grep -cE "^\s*it\(" "$LT" || true)" -ge 6 ]  || fail "loadForecast.test.ts needs >= 6 it() blocks"
# 2g. suppression / gutting: whole file for the two new files
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$LF" "$LT" && fail "test gutting / suppression found in a new file"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest (the new file + the five files whose literals moved) ─
echo "[4/5] vitest loadForecast / planner / ownedGatePredicates / session-card / economy-floor / owned-gate-entry-points"
( cd mobile && npx vitest run \
    tests/unit/loadForecast.test.ts \
    tests/unit/planner.test.ts \
    tests/unit/ownedGatePredicates.test.ts \
    tests/integration/session-card.screen.test.tsx \
    tests/integration/economy-floor.spec.tsx \
    tests/integration/owned-gate-entry-points.spec.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen + OTA guard (purely negative; passes on base) ────────
echo "[5/5] scope + frozen + OTA guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/review/storage.ts "$HS" \
  mobile/src/features/gacha/constants.ts mobile/src/features/gacha/planner/sessionPlanner.ts mobile/src/features/gacha/planner/sessionRoles.ts \
  mobile/src/features/gacha/contracts.ts mobile/src/screens/ChallengeScreen.tsx \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/vitest.config.ts mobile/tests/setup)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed"
grep -Fq '"vite": "7.2.4"' mobile/package.json           || fail "vite pin changed"
grep -Fq '"version": "1.6.0"' mobile/app.json              || fail "app.json version changed (OTA runtimeVersion 1.6.0)"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of 1.6.0)"; fi
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs; } | sort -u | grep -Ev '^(mobile/src/features/gacha/planner/sessionBuilder\.ts|mobile/src/features/gacha/planner/loadForecast\.ts|mobile/src/screens/SessionCardScreen\.tsx|mobile/tests/unit/loadForecast\.test\.ts|mobile/tests/unit/planner\.test\.ts|mobile/tests/unit/ownedGatePredicates\.test\.ts|mobile/tests/p2-smoke\.ts|mobile/tests/integration/session-card\.screen\.test\.tsx|mobile/tests/integration/economy-floor\.spec\.tsx|mobile/tests/integration/owned-gate-entry-points\.spec\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C02 scope"; }
# Literal-move files: small diffs only (a rewrite here is a gutted test, not a moved literal).
numstat_max() { # $1 file, $2 max added, $3 max deleted
  local line added deleted
  line="$(git diff --numstat "$mb" HEAD -- "$1" || true)"
  [ -n "$line" ] || return 0
  added="$(printf '%s' "$line" | cut -f1)"; deleted="$(printf '%s' "$line" | cut -f2)"
  [ "$added" -le "$2" ] && [ "$deleted" -le "$3" ] || fail "$1 changed by $added/+ $deleted/- (max $2/$3) — only the named literal(s) may move"
}
numstat_max "$SM" 2 2
numstat_max "$OT" 2 2
numstat_max "$EF" 6 6
numstat_max "$OG" 6 6
# Suppression / dialog guard over the ADDED lines of the edited files (SessionCardScreen.tsx
# carries a pre-existing eslint-disable-next-line at its load effect; it is not this issue's).
added="$(git diff -U0 "$mb" HEAD -- "$SB" "$SC" "$PT" "$OT" "$SM" "$ST" "$EF" "$OG" | grep '^+' | grep -v '^+++' || true)"
if printf '%s\n' "$added" | grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable"; then
  printf '%s\n' "$added" | grep -En "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" >&2 || true
  fail "test gutting / suppression in an added line"
fi
app_added="$(git diff -U0 "$mb" HEAD -- "$SB" "$SC" | grep '^+' | grep -v '^+++' || true)"
if printf '%s\n' "$app_added" | grep -Eq "Alert\.alert|Modal|setTimeout\(|setInterval\("; then
  printf '%s\n' "$app_added" | grep -En "Alert\.alert|Modal|setTimeout\(|setInterval\(" >&2 || true
  fail "R7 is one line, not a dialog / timer — an added line of sessionBuilder.ts / SessionCardScreen.tsx opens one"
fi

echo "C02 VERIFY OK"
