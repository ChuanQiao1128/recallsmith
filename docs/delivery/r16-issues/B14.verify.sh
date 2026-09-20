#!/usr/bin/env bash
# B14 — docs-licenses verify. cwd = worktree root. Re-runs the brief's seven
# acceptance bullets verbatim; never trusts the worker's report. Prose only:
# no vitest/tsc in the mobile tree (the driver's Gate 2 runs those anyway).
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/docs/design/v10-ceremony-seam-of-light.md, LICENSE-ASSETS and
#     mobile/assets/sfx/LICENSES.md do not exist (the `[ -f ]` guards fire), and
#   - mobile/docs/qa/animation-quality-rubric.md is 71 lines (< 90) with no
#     2026-09-20 date in its first three lines.
# If step 1 were skipped, step 2 fails on base too (the rubric still says
# `orbit -> charge -> stabilize` / `charge@` / `2100ms ~ 2600ms` and has none of
# the v10 literals), step 3 (v10 doc absent), step 4 (no Superseded banner on
# either v9 doc) and step 5 (licence files absent). Steps 6 and 7 are negative
# guards that pass on base by design.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B14 VERIFY FAIL: $*" >&2; exit 1; }

RUBRIC=mobile/docs/qa/animation-quality-rubric.md
V10=mobile/docs/design/v10-ceremony-seam-of-light.md
V9A=mobile/docs/design/v9-draw-final-spec-and-qa.md
V9B=mobile/docs/design/v9-copy-delta.md
LIC=LICENSE-ASSETS
SFX=mobile/assets/sfx/LICENSES.md
FIVE=("$RUBRIC" "$V10" "$V9A" "$V9B" "$LIC" "$SFX")

mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# ── 1. Files exist, non-trivial, dated (FAILS ON BASE) ─────────────────────
echo "[1/7] files exist, sizes, dates"
for f in "$V10" "$LIC" "$SFX"; do
  [ -f "$f" ] || fail "step 1: $f does not exist (base tree fails here)"
done
[ -f "$RUBRIC" ] || fail "step 1: $RUBRIC missing"
[ "$(wc -l < "$RUBRIC")" -ge 90 ]  || fail "step 1: $RUBRIC has $(wc -l < "$RUBRIC") lines, need >= 90 (base tree: 71)"
[ "$(wc -l < "$V10")" -ge 150 ]    || fail "step 1: $V10 has $(wc -l < "$V10") lines, need >= 150"
[ "$(wc -l < "$LIC")" -ge 25 ]     || fail "step 1: $LIC has $(wc -l < "$LIC") lines, need >= 25"
[ "$(wc -l < "$SFX")" -ge 40 ]     || fail "step 1: $SFX has $(wc -l < "$SFX") lines, need >= 40"
for f in "$RUBRIC" "$V10" "$LIC" "$SFX"; do
  head -n 3 "$f" | grep -Fq "2026-09-20" || fail "step 1: $f lacks the date 2026-09-20 in its first three lines"
done

# ── 2. Rubric literal guards (FAILS ON BASE) ───────────────────────────────
echo "[2/7] rubric guards"
DEVICE_ROW='| DEVICE | 600 | 360 / 620 / 880 | 600 | 320 | 520 | 900 | 600 / 860 / 1100 | 1800 | 400 | 600 | 200 |'
TEST_ROW='| TEST_BASE | 300 | 140 / 180 / 220 | 360 | 220 | 200 | 620 | 220 / 260 / 300 | 940 | 280 | 300 | 500 |'
EVIDENCE='| Device | Width | Pull | toTableMs | Cap | p95 ms | max ms | LEG flip stall ms | RM | VoiceOver | Fallback | Recording |'
for s in 'swipe -> approach -> hold -> tear-flip -> flash-reveal -> settle -> cards-on-table' \
         'TO_TABLE_CAP_MS' 'p95' '22 ms' '50 ms' "$DEVICE_ROW" "$TEST_ROW" '| 3120 | 3300 |' '| 5000 | 5500 |' \
         "$EVIDENCE" 'CeremonyTuning' 'Pack inbound' 'Pack open' \
         A-P0-NO-ANTICIPATION A-P0-ORDER-BROKEN A-P0-TIMING-OUT A-P0-REDUCED-MOTION-MISSING A-P0-FRAME-JANK A-P0-COPY-MISMATCH \
         A-P0-EARLY-TELL A-P0-NATIVE-CALLBACK A-P0-RM-FLASH A-P0-SKIP-ESCAPES A-P0-CANVAS-BUDGET A-P0-A11Y-PACK; do
  grep -Fq -- "$s" "$RUBRIC" || fail "step 2: rubric lacks literal: $s (base tree fails here)"
done
if grep -Fq -e 'orbit -> charge -> stabilize' -e 'warmup -> focus -> reveal' -e 'charge@' -e 'stabilize@' \
            -e '2100ms ~ 2600ms' -e '1100ms ~ 1400ms' -e 'Legendary inbound' -e 'Rare inbound' "$RUBRIC"; then
  grep -Fn -e 'orbit -> charge -> stabilize' -e 'warmup -> focus -> reveal' -e 'charge@' -e 'stabilize@' \
           -e '2100ms ~ 2600ms' -e '1100ms ~ 1400ms' -e 'Legendary inbound' -e 'Rare inbound' "$RUBRIC" >&2 || true
  fail "step 2: rubric still carries a v9 phase name / timing window / copy literal (base tree fails here)"
fi
[ "$(grep -cE '^\|.*\| *TBD *\|' "$RUBRIC" || true)" -ge 6 ] || fail "step 2: rubric evidence table needs >= 6 rows with TBD cells"

# ── 3. v10 design doc guards (FAILS ON BASE: file absent) ──────────────────
echo "[3/7] v10 doc guards"
[ "$(head -n 1 "$V10")" = '# v10 仪式设计：Seam of Light（1.6.0）' ] || fail "step 3: v10 H1 is not the contract title"
HEADINGS=(
  '## 0. 结论与范围'
  '## 1. 状态机（7 阶段）'
  '## 2. 时长表：DEVICE / TEST_BASE 与上限'
  '## 3. 减弱动态路径（Reduce Motion）'
  '## 4. Fallback 渲染器与 feature flag'
  '## 5. 无障碍路径（VoiceOver）'
  '## 6. 玩家主动权：skip policy 与 tap-to-flip'
  '## 7. 稀有度预告：tell / beat / spill'
  '## 8. 音频与触觉'
  '## 9. 素材表与许可'
  '## 10. 原生依赖钉版（Skia / Reanimated / worklets）'
  '## 11. 文件地图与 testID 契约'
  '## 12. 开发工具（CeremonyTuning / DebugMenu）'
  '## 13. 证据表（真机 QA 填写）'
)
prev=0
for h in "${HEADINGS[@]}"; do
  ln="$(grep -nF -- "$h" "$V10" | head -1 | cut -d: -f1)"
  [ -n "$ln" ] || fail "step 3: v10 lacks heading: $h"
  [ "$ln" -gt "$prev" ] || fail "step 3: v10 heading out of order: $h (line $ln after $prev)"
  prev="$ln"
done
for s in 'Seam of Light' motionAvailable skiaAvailable seamOfLight forceFallback settleMs rimSettleMs tableTailMs beatMs flipMs \
         TO_TABLE_CAP_MS REDUCED_MOTION_FLASH_MS REDUCED_MOTION_SETTLE_MS SFX_ALIASES CEREMONY_GAIN skipPolicy buildSpillSchedule centreSlot \
         '2.2.12' react-native-worklets react-native-reanimated expo-audio RoundedRect 'Pack inbound' 'Pack open' 'Reward pack' \
         'Leave ceremony' 'Speed up' draw-ceremony-stage-canvas draw-ceremony-fallback-stage draw-ceremony-reveal-flash CeremonyTuning \
         LICENSE-ASSETS LICENSES.md B00-contracts.md "$DEVICE_ROW" "$TEST_ROW" '| 3120 | 3300 |' '| 5000 | 5500 |' "$EVIDENCE"; do
  grep -Fq -- "$s" "$V10" || fail "step 3: v10 lacks literal: $s"
done
[ "$(grep -cE '^\|.*\| *TBD *\|' "$V10" || true)" -ge 6 ] || fail "step 3: v10 evidence table needs >= 6 rows with TBD cells"

# ── 4. Superseded banners on both v9 docs (FAILS ON BASE) ──────────────────
echo "[4/7] v9 banners"
for f in "$V9A" "$V9B"; do
  grep -Fq '> **Superseded — 2026-09-20.**' "$f" || fail "step 4: $f lacks the Superseded banner (base tree fails here)"
  grep -Fq 'v10-ceremony-seam-of-light.md' "$f"  || fail "step 4: $f banner does not link the v10 doc"
  sed -n 3p "$f" | grep -Fq '> **Superseded — 2026-09-20.**' || fail "step 4: $f banner must be line 3 (blank line 2 after the H1)"
  read -r add del _ < <(git diff --numstat "$mb" -- "$f" | awk '{print $1, $2, $3}'; echo "0 0 -")
  [ "${add:-0}" -eq 2 ] && [ "${del:-0}" -eq 0 ] || fail "step 4: $f diff must be exactly 2 added / 0 deleted lines (got +$add -$del)"
done
[ "$(head -n 1 "$V9A")" = '# v9 Draw Final Spec + Quantitative QA Gates (Full Contract)' ] || fail "step 4: $V9A line 1 changed"
[ "$(head -n 1 "$V9B")" = '# v9 Copy Delta (vs v8)' ]                                       || fail "step 4: $V9B line 1 changed"

# ── 5. Licence files (FAILS ON BASE: absent) ───────────────────────────────
echo "[5/7] LICENSE-ASSETS + LICENSES.md guards"
for s in MIT LICENSE 'mobile/assets/' 'mobile/assets/sfx/LICENSES.md' 'All rights reserved' Sonniss 'not affiliated'; do
  grep -Fq -- "$s" "$LIC" || fail "step 5: $LIC lacks literal: $s"
done
for w in crinkle air shimmer-pad choir-swell whoosh rip card-slide stack-thud seam-burst card-flip card-drop chime stinger shimmer legendary sparkle-tail soft-chime; do
  grep -Fq -- "$w.wav" "$SFX" || fail "step 5: $SFX lacks $w.wav"
done
for s in SFX_ALIASES 'mobile/scripts/gen_sfx.py' Sonniss royalty-free CC0 CC-BY CC-BY-NC; do
  grep -Fq -- "$s" "$SFX" || fail "step 5: $SFX lacks literal: $s"
done
wav_rows="$(grep -cE '^\| *`?[a-z-]+\.wav`? *\|' "$SFX" || true)"
[ "$wav_rows" -eq 17 ] || fail "step 5: $SFX must have exactly 17 table rows whose first cell is a .wav name (found $wav_rows)"
if grep -Eq 'YOUR NAME|\[year\]|\[fullname\]|<name>' "$LIC" "$SFX"; then fail "step 5: template placeholder left in a licence file"; fi
lic_diff="$(git diff --numstat "$mb" -- LICENSE README.md)"
[ -z "$lic_diff" ] || { echo "$lic_diff" >&2; fail "step 5: LICENSE / README.md must not change"; }

# ── 6. Links + fully-qualified paths resolve (the spec's 链接存在) ─────────
echo "[6/7] relative links + backticked repo paths"
python3 - "${FIVE[@]}" <<'PY' || fail "step 6: unresolved link or path (listed above)"
import os, re, sys
root = os.getcwd()
top = r'(?:frontend|mobile|src_C|pg-layer|snowflake|docs|\.github)'
# same shape as frontend/tests/docsPaths.test.ts:95-98 (CITATION), :N / :N-M suffix tolerated
cite = re.compile(r'`(' + top + r'/[A-Za-z0-9._/-]+?)(?::[0-9]+(?:-[0-9]+)?)?`')
link = re.compile(r'\]\(([^)\s]+)\)')
bad = []
for f in sys.argv[1:]:
    text = open(f, encoding='utf-8').read()
    # citations are read with any paths-not-on-disk block removed (docsPaths.test.ts convention)
    prose = re.sub(r'<!--\s*paths-not-on-disk\b[\s\S]*?-->', '', text)
    for p in sorted(set(cite.findall(prose))):
        if not os.path.exists(os.path.join(root, p)):
            bad.append(f'{f}: cited path not on disk: {p}')
    for target in link.findall(text):
        if re.match(r'^(https?:|mailto:|#)', target):
            continue
        t = target.split('#', 1)[0]
        if not t:
            continue
        resolved = os.path.normpath(os.path.join(os.path.dirname(f), t))
        if not os.path.exists(os.path.join(root, resolved)):
            bad.append(f'{f}: relative link does not resolve: {target} -> {resolved}')
for b in bad:
    print(b, file=sys.stderr)
sys.exit(1 if bad else 0)
PY
# top-level docs/*.md untouched → frontend/tests/docsPaths.test.ts (scans only docs/*.md, :85/:110) cannot be affected.
# ':(glob)' keeps '*' from matching '/' (a plain 'docs/*.md' pathspec also matches docs/delivery/r16-issues/*.md).
top_docs="$(git diff --name-only "$mb" -- ':(glob)docs/*.md' || true)"
[ -z "$top_docs" ] || { echo "$top_docs" >&2; fail "step 6: a top-level docs/*.md changed (out of scope; docsPaths.test.ts territory)"; }
if [ -x frontend/node_modules/.bin/vitest ]; then
  ( cd frontend && npx vitest run tests/docsPaths.test.ts tests/rootReadmePaths.test.ts --reporter=dot ) \
    || fail "step 6: frontend docsPaths/rootReadmePaths tests failed"
else
  echo "step 6: frontend/node_modules absent in this worktree — docsPaths/rootReadmePaths run skipped (no install allowed); the bash reproduction above covers the new files"
fi

# ── 7. Hygiene + scope + frozen (purely negative; passes on base) ───────────
echo "[7/7] hygiene + scope + frozen guard"
if grep -Eq '(^|[^0-9])920([^0-9]|$)|5020' "${FIVE[@]}"; then
  grep -En '(^|[^0-9])920([^0-9]|$)|5020' "${FIVE[@]}" >&2 || true
  fail "step 7: storyboard timing 920/5020 written into a doc (B00 §9 #3: multi approach is 900, table at 5000)"
fi
if grep -Eiq 'humanizer|bypass|undetect|detector|evade|Gemini said' "${FIVE[@]}"; then
  grep -Ein 'humanizer|bypass|undetect|detector|evade|Gemini said' "${FIVE[@]}" >&2 || true
  fail "step 7: banned term in a doc"
fi
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/assets/sfx/README.md mobile/assets/packs/README.md mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/scripts)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "step 7: frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } \
  | grep -Ev '^(mobile/docs/qa/animation-quality-rubric\.md|mobile/docs/design/v10-ceremony-seam-of-light\.md|mobile/docs/design/v9-draw-final-spec-and-qa\.md|mobile/docs/design/v9-copy-delta\.md|LICENSE-ASSETS|mobile/assets/sfx/LICENSES\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "step 7: files changed outside B14 scope"; }
grep -Fq '"vite": "7.2.4"' mobile/package.json || fail "step 7: vite pin 7.2.4 lost"
if grep -rq "@sentry" mobile/src; then fail "step 7: @sentry reference under mobile/src (Sentry is out of 1.6.0)"; fi

echo "B14 VERIFY OK"
