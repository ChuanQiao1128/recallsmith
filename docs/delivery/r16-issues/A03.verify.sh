#!/usr/bin/env bash
# A03 — Home batch 2 (F2 tiles Due/New/Learned/Total, F4 dedupe, F5 glossary).
# Re-runs the brief's five Acceptance bullets, in order, from the worktree root.
#
# On the UNTOUCHED base tree (delivery/r16-a-home @ 92cebbd or later, before A03):
#   step 1 (typecheck)        PASSES  — nothing to type-break yet
#   step 2 (vitest x3)        PASSES  — the three files are green on base
#   step 3 (source guard)     FAILS   — first positive grep ('Review today’s cards to earn a pull'
#                                        is not in homeSelectors.ts on base); every other positive
#                                        grep for the new literals / home-today-empty also fails
#   step 4 (test guard)       FAILS   — toContain('Due') / '1 pull ready · 2 more waiting' /
#                                        '3 due · 2 new' are not in the test files on base
#   step 5 (scope/frozen)     PASSES  — purely negative guard (empty diff on base)
# So the script exits non-zero on base because of steps 3 and 4; it tests the change, not the baseline.
set -euo pipefail

# cwd = worktree root (the driver runs this script from the issue worktree while the
# script itself lives outside it, so never derive ROOT from BASH_SOURCE).
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-a-home}}"

f=mobile/src/features/gacha/selectors/homeSelectors.ts
c=mobile/src/features/gacha/components/TodayPressureCard.tsx
r=mobile/src/features/gacha/home/HomeDeckRow.tsx
t=mobile/tests/integration/home-primary-cta.test.tsx
e=mobile/tests/integration/home-economy-floor.spec.tsx
u=mobile/tests/unit/homeSelectors.spec.ts

step() { printf '\n== A03 step %s: %s\n' "$1" "$2"; }
fail() { printf 'A03 FAIL: %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- 1. typecheck
step 1 "mobile typecheck"
( cd mobile && npm run test:typecheck )

# ---------------------------------------------------------------- 2. targeted vitest
step 2 "targeted vitest (3 files)"
( cd mobile && npx vitest run \
    tests/integration/home-primary-cta.test.tsx \
    tests/integration/home-economy-floor.spec.tsx \
    tests/unit/homeSelectors.spec.ts \
    --reporter=dot )

# ---------------------------------------------------------------- 3. source literal guard
step 3 "source literal guard"
# homeSelectors.ts — new copy present (each of these FAILS on base)
grep -qF "'Review today’s cards to earn a pull'" "$f"                                   || fail "$f: locked badge literal missing"
grep -qF 'more waiting`' "$f"                                                          || fail "$f: reserve badge must end with 'more waiting'"
grep -qF 'Wallet full (${FREE_PULL_CAP} + ${FREE_PULL_OVERFLOW_CAP})' "$f"             || fail "$f: wallet-full label must stay unchanged"
grep -qF 'Review today’s cards to earn pulls · at most ${SESSION_MAIN_ROUTE_DEFAULT} cards.' "$f" || fail "$f: hero subline (work) literal missing"
grep -qF "'Nothing due today; review later or browse your decks.'" "$f"                || fail "$f: hero subline (clear day) literal missing"
grep -qF "'You started today. Finish the remaining cards.'" "$f"                       || fail "$f: today_partial subtitle missing"
grep -qF "'Pulls are full. Today’s review still comes first; spend a pull afterwards.'" "$f" || fail "$f: wallet_full subtitle missing"
grep -qF "'No due cards and no new cards queued right now.'" "$f"                      || fail "$f: nothing_to_learn subtitle missing"
grep -qF 'A few new cards are ready in ${selectedDeck.title}' "$f"                     || fail "$f: default title (new cards) missing"
grep -qF 'due · ${deck.newToday} new`' "$f"                                            || fail "$f: progressLabel must say 'new'"
grep -qF 'due · ${deck.newToday} new`' "$r"                                            || fail "$r: fallback subtitle must say 'new'"
# homeSelectors.ts + HomeDeckRow.tsx — old jargon gone (negative; passes on base only for HomeDeckRow)
! grep -qE "Clear today’s route|in reserve|boss max|No pressure day|Finish the remaining route|reserve can flow|A short fresh run|newToday} fresh" "$f" "$r" \
  || fail "old planner jargon still present in $f / $r"

# TodayPressureCard.tsx — testIDs + style arrays kept, labels relabelled, footnote/subtitle tail gone
for id in home-today-count-grid home-today-count-normal home-today-count-elite home-today-count-boss home-today-count-total home-today-empty; do
  grep -qF "testID=\"$id\"" "$c" || fail "$c: testID $id missing"
done
grep -qF 'Nothing to review yet — open a pack to get your first cards.' "$c"           || fail "$c: empty-state line missing"
grep -qF "metricWide: { flex: 1, minWidth: 0 }" "$c"                                   || fail "$c: metricWide changed"
grep -qF "metricCompact: { width: '48%' }" "$c"                                        || fail "$c: metricCompact changed"
grep -qF 'counts.selectedDue' "$c"                                                     || fail "$c: Due tile must read counts.selectedDue"
grep -qF 'counts.selectedNew' "$c"                                                     || fail "$c: New tile must read counts.selectedNew"
grep -qF 'counts.selectedMastered' "$c"                                                || fail "$c: Learned tile must read counts.selectedMastered"
grep -qF 'counts.totalDueAllDecks' "$c"                                                || fail "$c: Total tile must read counts.totalDueAllDecks"
grep -qwE 'Due|Learned' "$c"                                                           || fail "$c: Due / Learned labels missing"
! grep -qwE 'Normal|Elite|Boss' "$c"                                                   || fail "$c: Normal / Elite / Boss labels still rendered"
! grep -qE "Today’s pressure|Mastered in selected deck| fresh|counts\.(normal|elite|boss)Count" "$c" \
  || fail "$c: old title / footnote / fresh / route counts still present"

# ---------------------------------------------------------------- 4. test literal guard
step 4 "test literal guard"
grep -qF "toContain('Due')" "$t"                        || fail "$t: toContain('Due') missing"
grep -qF "toContain('New')" "$t"                        || fail "$t: toContain('New') missing"
grep -qF "toContain('Learned')" "$t"                    || fail "$t: toContain('Learned') missing"
grep -qF "toContain('Total')" "$t"                      || fail "$t: toContain('Total') must stay"
grep -qF "'Review today’s cards to earn a pull'" "$t"   || fail "$t: locked badge literal not updated"
grep -qF "'1 pull ready · 2 more waiting'" "$t"         || fail "$t: reserve badge literal not updated"
grep -qF "'2 pulls ready'" "$t"                         || fail "$t: '2 pulls ready' must stay"
grep -qF "'Wallet full (30 + 5)'" "$t"                  || fail "$t: 'Wallet full (30 + 5)' must stay"
grep -qF "'Review today’s cards to earn a pull'" "$e"   || fail "$e: locked badge literal not updated"
grep -qF "'1 pull ready'" "$e"                          || fail "$e: '1 pull ready' must stay"
grep -qF "/Wallet full/i" "$u"                          || fail "$u: /Wallet full/i must stay"
grep -qF "Review today’s cards to earn pulls · at most 5 cards." "$u" || fail "$u: subline unit case missing"
grep -qF "'1 pull ready · 2 more waiting'" "$u"         || fail "$u: draw badge unit case missing"
grep -qF "'3 due · 2 new'" "$u"                         || fail "$u: progressLabel unit case missing"
! grep -qE "toContain\('(Normal|Elite|Boss)'\)|Clear today’s route|in reserve'" "$t" "$e" \
  || fail "old test literals still present in $t / $e"

# ---------------------------------------------------------------- 5. scope + frozen-file guard (negative)
step 5 "scope / frozen-file guard"
base=$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null) || fail "cannot resolve base ref $BASE_REF (driver exports BASE)"
frozen=$(git diff --numstat "$base" -- \
  mobile/src/content/deckRepository.ts \
  mobile/src/sync/progressSync.ts \
  mobile/src/review/model.ts \
  mobile/src/screens/HomeScreen.tsx \
  mobile/src/features/gacha/contracts.ts)
[ -z "$frozen" ] || { printf '%s\n' "$frozen" >&2; fail "frozen / out-of-scope file changed"; }
outside=$(git diff --name-only "$base" | grep -vE '^(mobile/src/features/gacha/selectors/homeSelectors\.ts|mobile/src/features/gacha/components/TodayPressureCard\.tsx|mobile/src/features/gacha/home/HomeDeckRow\.tsx|mobile/tests/integration/home-primary-cta\.test\.tsx|mobile/tests/integration/home-economy-floor\.spec\.tsx|mobile/tests/unit/homeSelectors\.spec\.ts)$' || true)
[ -z "$outside" ] || { printf '%s\n' "$outside" >&2; fail "files changed outside the A03 scope"; }

printf '\nA03 verify: all five steps passed\n'
