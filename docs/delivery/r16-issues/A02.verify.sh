#!/usr/bin/env bash
# A02 — Home batch 1 verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 3:
#   - the negative grep hits MOCKED_HOME_DECKS / "Coming soon" / kickerBreathRef /
#     heroKicker / heroSupport / rewardStatusRow / duration: 1500|1100 in HomeScreen.tsx
#   - the positive greps ("Your packs", readRN('AccessibilityInfo', reduceMotionChanged,
#     duration: 2400 x2, "Connect to load packs", status = 'Soon', disabled={d.disabled},
#     heroTitle numberOfLines={1}) find nothing
#   - none of the five new it('...') titles exist in home.screen.test.tsx
# and at step 4 (TodayPressureCard still has fontSize: 9/10/18 + textTransform and
# zero typography.caption). Steps 1, 2 and 5 pass on base by design: 1/2 are the
# baseline gates (25 tests / tsc) and 5 is a purely negative scope+frozen guard.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-a-home}}"   # driver exports BASE
fail() { echo "A02 VERIFY FAIL: $*" >&2; exit 1; }

f=mobile/src/screens/HomeScreen.tsx
p=mobile/src/features/gacha/components/TodayPressureCard.tsx
t=mobile/tests/integration/home.screen.test.tsx
[ -f "$f" ] && [ -f "$p" ] && [ -f "$t" ] || fail "scope file missing"

# ── 1. Targeted vitest (4 Home files) ──────────────────────────────────────
echo "[1/5] vitest home files"
( cd mobile && npx vitest run \
    tests/integration/home.screen.test.tsx \
    tests/integration/home-primary-cta.test.tsx \
    tests/integration/home-cta-target.test.tsx \
    tests/integration/home-economy-floor.spec.tsx \
    --reporter=dot ) || fail "vitest home files failed"

# ── 2. Typecheck ───────────────────────────────────────────────────────────
echo "[2/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 3. HomeScreen + test grep guards (FAILS ON BASE) ───────────────────────
echo "[3/5] HomeScreen.tsx / home.screen.test.tsx guards"
if grep -Eq "MOCKED_HOME_DECKS|[Cc]oming soon|Choose a pack|kickerBreathRef|heroKicker|heroSupport|rewardStatusRow|duration: 1500|duration: 1100|theme/motion" "$f"; then
  grep -En "MOCKED_HOME_DECKS|[Cc]oming soon|Choose a pack|kickerBreathRef|heroKicker|heroSupport|rewardStatusRow|duration: 1500|duration: 1100|theme/motion" "$f" >&2 || true
  fail "banned identifier/literal still present in HomeScreen.tsx (base tree fails here)"
fi
grep -q "Your packs" "$f"                                   || fail "missing 'Your packs' label"
grep -q "readRN('AccessibilityInfo'" "$f"                   || fail "AccessibilityInfo must be read via readRN"
grep -q "isReduceMotionEnabled" "$f"                        || fail "missing isReduceMotionEnabled"
grep -q "reduceMotionChanged" "$f"                          || fail "missing reduceMotionChanged listener"
[ "$(grep -c 'duration: 2400' "$f")" = 2 ]                  || fail "bob must use duration: 2400 on both halves"
grep -q "Connect to load packs" "$f"                        || fail "missing empty-state a11y label"
grep -q "status = 'Soon'" "$f"                              || fail "missing 'Soon' status branch"
grep -q "disabled={d.disabled}" "$f"                        || fail "tile Pressable must receive disabled={d.disabled}"
grep -q "style={styles.heroTitle} numberOfLines={1}" "$f"   || fail "heroTitle must be numberOfLines={1}"
grep -q 'testID="home-pack-visual"' "$f"                    || fail "home-pack-visual testID missing"
grep -q 'testID="home-draw-status-badge"' "$f"              || fail "home-draw-status-badge testID missing"
grep -q 'testID="home-featured-pack"' "$f"                  || fail "home-featured-pack testID missing"
grep -q 'testID="screen-home-primary-cta"' "$f"             || fail "screen-home-primary-cta testID missing"
# rewardStatusText block must carry the centering keys (no wrapper node)
awk '/rewardStatusText: \{/,/\},/' "$f" | grep -q "textAlign: 'center'"  || fail "rewardStatusText lacks textAlign center"
awk '/rewardStatusText: \{/,/\},/' "$f" | grep -q "alignSelf: 'center'"  || fail "rewardStatusText lacks alignSelf center"
awk '/rewardStatusText: \{/,/\},/' "$f" | grep -q "marginTop: spacing.sm" || fail "rewardStatusText lacks marginTop sm"
# spacing + wordmark
awk '/heroBand: \{/,/\},/' "$f" | grep -q "paddingBottom: spacing.md"     || fail "heroBand.paddingBottom must be spacing.md"
awk '/actionGroup: \{/,/\},/' "$f" | grep -q "marginTop: spacing.sm"      || fail "actionGroup.marginTop must be spacing.sm"
grep -Eq "^  title: \{[^}]*typography\.title3" "$f"                        || fail "wordmark title must be typography.title3"
grep -Eq "^  title: \{[^}]*colors\.inkSecondary" "$f"                      || fail "wordmark title must be inkSecondary"
# pack stays 168x240, halo 240
[ "$(grep -c 'height: 240,' "$f")" -ge 3 ]                                 || fail "pack/halo height 240 changed"
grep -q "width: 168," "$f"                                                 || fail "pack width 168 changed"
# no named RN import of AccessibilityInfo / Easing
grep -Eq "^[[:space:]]*(AccessibilityInfo|Easing),?[[:space:]]*$|import \{[^}]*(AccessibilityInfo|Easing)[^}]*\} from 'react-native'" "$f" && fail "AccessibilityInfo/Easing must not be imported by name"
# five new test cases
for s in \
  'lists only real packs under Your packs' \
  'selects an installed pack in place without leaving Home' \
  'renders the hero and pack shelf with zero decks' \
  'renders a manifest coming deck as a disabled Soon tile' \
  'centers the draw status label under the CTA'; do
  grep -Fq "it('$s'" "$t" || fail "missing test case: $s (base tree fails here)"
done
# existing test cases untouched
for s in \
  'renders root shell with one primary CTA surface' \
  'shows due-card study link and routes it directly to SessionCard' \
  'hides due-card study link when no deck has due work' \
  'keeps settings button accessible and opens first draw coach link when enabled' \
  'routes primary CTA to study even when pulls are available'; do
  grep -Fq "it('$s'" "$t" || fail "existing test case removed: $s"
done
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$t" "$f" "$p" && fail "test gutting / suppression found"

# ── 4. TodayPressureCard guards (FAILS ON BASE) ────────────────────────────
echo "[4/5] TodayPressureCard.tsx guards"
if grep -Eq "fontSize: (9|10|18)[,} ]|textTransform" "$p"; then
  grep -En "fontSize: (9|10|18)[,} ]|textTransform" "$p" >&2 || true
  fail "sub-floor font size or uppercase still present (base tree fails here)"
fi
grep -Fq "metricWide: { flex: 1, minWidth: 0 }," "$p"        || fail "metricWide changed"
grep -Fq "metricCompact: { width: '48%' }," "$p"             || fail "metricCompact changed"
grep -Fq "const useCompactMetrics = width < 390;" "$p"       || fail "compact width rule changed"
[ "$(grep -c 'typography.caption' "$p")" = 3 ]               || fail "expected exactly 3 typography.caption uses (subtitle, metricLabel, footnote)"
grep -Eq "metricValue: \{ fontSize: typography\.title3," "$p" || fail "metricValue must be typography.title3"
awk '/^  metric: \{/,/^  \},/' "$p" > "${TMPDIR:-/tmp}/a02-metric.txt"
diff -u - "${TMPDIR:-/tmp}/a02-metric.txt" <<'EXPECTED' || fail "styles.metric block is not byte-identical"
  metric: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: TODAY_PRESSURE_TOKENS.metricBorder,
    alignItems: 'center',
  },
EXPECTED
for s in Normal Elite Boss Total; do grep -q "^            $s\$" "$p" || fail "metric label '$s' changed"; done

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/theme/packArt.ts mobile/src/features/gacha/selectors/homeSelectors.ts)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx; } | grep -Ev '^(mobile/src/screens/HomeScreen\.tsx|mobile/src/features/gacha/components/TodayPressureCard\.tsx|mobile/tests/integration/home\.screen\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside A02 scope"; }

echo "A02 VERIFY OK"
