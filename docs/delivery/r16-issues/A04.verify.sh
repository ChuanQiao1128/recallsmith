#!/usr/bin/env bash
# A04 — Home batch 3 (F3 first-run CTA → Draw, F12 pack = primary decision, F16 goal line)
# Re-runs the brief's Acceptance from the worktree root. Exits non-zero on the
# untouched base tree (verified on c9ddc8d: 12 failures, exit 1): P1 (HomeHero.tsx
# still exists), P2 (no home-goal-line testID), P3 (no vm.goal read), P4 (no
# @deprecated in homeSelectors), P5 (buildHomeVM's override never references
# DRAW_CTA_LABEL), P6/P7 (new test cases absent), T1/T2 (4 and 5 `it(` on base),
# N1/N2/N3 (old pack-handler comment bullets and a11y label still present).
# On a pre-A02 base (92cebbd) N4 / G12 also fail (HomeScreen still has "Coming
# soon" and no 'Connect to load packs'); on the intended post-A02 base they pass
# and simply re-check A02's empty-featured contract after A04 lands.
# Every G*/F* line is a purely negative guard (kept testIDs, frozen files, scope)
# that passes on base by design, as do TC/VT (base typecheck and tests are green).
# Runs in ~70 s (typecheck ~15-45 s, targeted vitest ~5 s).
set -euo pipefail

# cwd = worktree root. The driver runs this script from the issue worktree while
# the script file lives outside it, so ROOT must come from git, not BASH_SOURCE.
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-a-home}}"
# Long steps get a hard cap when coreutils `timeout` is on PATH, so a hung vitest
# worker fails loudly instead of stalling the wave (the driver has no timeout).
TIMEOUT=""; command -v timeout >/dev/null 2>&1 && TIMEOUT="timeout 240"

HOME_SCREEN=mobile/src/screens/HomeScreen.tsx
SELECTORS=mobile/src/features/gacha/selectors/homeSelectors.ts
HERO=mobile/src/features/gacha/components/HomeHero.tsx
T_CTA=mobile/tests/integration/home-cta-target.test.tsx
T_HOME=mobile/tests/integration/home.screen.test.tsx

FAILS=0
fail() { echo "FAIL: $*" >&2; FAILS=$((FAILS + 1)); }
ok()   { echo "ok:   $*"; }
check() { # check <label> <command...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$label"; else fail "$label"; fi
}
absent() { # absent <label> <pattern> <files...>  (fails when the pattern IS found)
  local label="$1" pat="$2"; shift 2
  if grep -q -- "$pat" "$@" 2>/dev/null; then fail "$label (found: $pat)"; else ok "$label"; fi
}
present() { # present <label> <pattern> <file>
  local label="$1" pat="$2" file="$3"
  if grep -q -- "$pat" "$file" 2>/dev/null; then ok "$label"; else fail "$label (missing: $pat in $file)"; fi
}

echo "== A04 verify (root: $ROOT, base: $BASE_REF) =="

# ---------- Positive checks: fail on the untouched base tree ----------
if [ -e "$HERO" ]; then fail "P1 HomeHero.tsx must be deleted"; else ok "P1 HomeHero.tsx deleted"; fi
present "P2 goal line testID"            'testID="home-goal-line"'            "$HOME_SCREEN"
check   "P3 goal line reads vm.goal"     grep -Eq 'vm\.goal\.(minimum|fullClear)' "$HOME_SCREEN"
present "P4 hero.helper marked deprecated" '@deprecated'                      "$SELECTORS"
# On base `nav: 'draw'` already appears inside mapStatusToCta, so P5 checks the
# buildHomeVM override specifically: the first_run override must mention DRAW_CTA_LABEL
# (base override only assigns 'Open library').
check   "P5 first_run override can hand the button to the draw" \
  bash -c "awk '/export function buildHomeVM/,0' '$SELECTORS' | grep -q 'DRAW_CTA_LABEL'"
present "P6 home-cta-target covers Draw target"   'rewardPending: true'      "$T_CTA"
present "P7 home.screen presses the featured pack" 'home-featured-pack'      "$T_HOME"
# Test-count guards: base has 4 and 5 `it(` cases respectively.
n_cta=$(grep -cE '^\s*it\(' "$T_CTA" || true)
n_home=$(grep -cE '^\s*it\(' "$T_HOME" || true)
if [ "${n_cta:-0}" -ge 6 ]; then ok "T1 home-cta-target has $n_cta cases (>=6)"; else fail "T1 home-cta-target has ${n_cta:-0} cases, need >=6"; fi
if [ "${n_home:-0}" -ge 7 ]; then ok "T2 home.screen has $n_home cases (>=7)"; else fail "T2 home.screen has ${n_home:-0} cases, need >=7"; fi

# ---------- Negative greps that fail on base (old branches must be gone) ----------
absent "N1 old 'installed + has pulls' pack branch removed" 'installed + has pulls' "$HOME_SCREEN"
absent "N2 old 'Installed + no pulls' pack branch removed"  'Installed + no pulls'  "$HOME_SCREEN"
absent "N3 old pack a11y label removed"                     'Open ${featuredDeck.title} pack' "$HOME_SCREEN"
# A02 contract re-checked after A04 (gacha-v7 §3.2.3 bans the copy; A02's zero-decks test asserts the label)
absent  "N4 no coming-soon copy"                            '[Cc]oming soon'        "$HOME_SCREEN"
present "G12 empty-featured a11y label kept"                'Connect to load packs' "$HOME_SCREEN"

# ---------- Purely negative guards (pass on base; must still pass after) ----------
absent  "G1 no hardcoded 'earn 1 pull'" 'earn 1 pull' "$HOME_SCREEN" "$SELECTORS"
absent  "G2 no literal home-primary-cta testID on any second element" 'testID="home-primary-cta"' "$HOME_SCREEN"
cnt=$(grep -c 'testID={homeState.vm.cta.testID}' "$HOME_SCREEN" || true)
if [ "${cnt:-0}" = 1 ]; then ok "G3 exactly one primary CTA Pressable"; else fail "G3 primary CTA Pressable count is ${cnt:-0}, expected 1"; fi
for id in screen-home-root screen-home-primary-cta home-draw-status-badge home-pack-visual \
          home-featured-pack home-error-retry home-study-due-link home-first-draw-link \
          home-collapse-decks-toggle home-collapse-week-support-toggle; do
  present "G4 kept testID $id" "testID=\"$id\"" "$HOME_SCREEN"
done
present "G5 badge still renders draw.label" '{homeState.vm.draw.label}' "$HOME_SCREEN"
present "G6 drawStatusLabel kept"           'drawStatusLabel'            "$SELECTORS"
present "G7 goal VM kept"                   'goal: buildGoalVM(selectedDeck)' "$SELECTORS"
present "G8 'Open library' fallback kept"   "label: 'Open library'"      "$SELECTORS"
present "G9 DRAW_CTA_LABEL literal kept"    "const DRAW_CTA_LABEL = 'Open reward draw'" "$SELECTORS"
absent  "G10 Home does not install in the draw path" "executeDeckAction(await resolveDeckAction" "$HOME_SCREEN"
absent  "G11 no ts-ignore / eslint-disable added" '@ts-ignore\|@ts-expect-error\|eslint-disable' "$HOME_SCREEN" "$SELECTORS" "$T_CTA" "$T_HOME"

# ---------- Frozen files + scope (git numstat) ----------
if BASE="$(git merge-base HEAD "$BASE_REF" 2>/dev/null)"; then
  frozen_diff="$(git diff --numstat "$BASE" -- \
    mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
    mobile/src/features/gacha/contracts.ts \
    mobile/tests/integration/home-primary-cta.test.tsx mobile/tests/integration/home-economy-floor.spec.tsx \
    mobile/tests/unit/homeSelectors.spec.ts mobile/tests/unit/summary-home.test.ts mobile/tests/p2-smoke.ts)"
  if [ -z "$frozen_diff" ]; then ok "F1 frozen / out-of-scope files untouched"; else fail "F1 frozen or out-of-scope files changed:"$'\n'"$frozen_diff"; fi
  # Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
  # worktree (a symlink is not matched by the `node_modules/` gitignore rule).
  scope_bad="$( { git diff --name-only "$BASE"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx; } | sort -u | grep -vE \
    '^(mobile/src/features/gacha/selectors/homeSelectors\.ts|mobile/src/screens/HomeScreen\.tsx|mobile/src/features/gacha/components/HomeHero\.tsx|mobile/tests/integration/home-cta-target\.test\.tsx|mobile/tests/integration/home\.screen\.test\.tsx|docs/delivery/r16-issues/.*)$' || true)"
  if [ -z "$scope_bad" ]; then ok "F2 all changed paths inside scope"; else fail "F2 out-of-scope paths changed:"$'\n'"$scope_bad"; fi
else
  fail "F0 cannot resolve merge-base with $BASE_REF (set BASE_REF=<integration branch>)"
fi

# ---------- Project gates ----------
echo "== typecheck =="
if (cd mobile && $TIMEOUT npm run test:typecheck >/dev/null 2>&1); then ok "TC mobile typecheck"; else fail "TC mobile typecheck (run: cd mobile && npm run test:typecheck)"; fi

echo "== targeted vitest =="
# Never pipe vitest into tail: tail waits for EOF from every writer, so a lingering
# vitest worker holding the pipe can hang the script. Log to a file, tail afterwards.
VT_LOG="${TMPDIR:-/tmp}/a04-vitest.$$.log"
if (cd mobile && $TIMEOUT npx vitest run \
      tests/integration/home-cta-target.test.tsx \
      tests/integration/home.screen.test.tsx \
      tests/integration/home-primary-cta.test.tsx \
      tests/integration/home-economy-floor.spec.tsx \
      tests/unit/homeSelectors.spec.ts \
      tests/unit/summary-home.test.ts \
      --reporter=dot > "$VT_LOG" 2>&1); then ok "VT targeted vitest"; else tail -20 "$VT_LOG"; fail "VT targeted vitest"; fi
rm -f "$VT_LOG"

echo "== result: $FAILS failure(s) =="
[ "$FAILS" -eq 0 ]
