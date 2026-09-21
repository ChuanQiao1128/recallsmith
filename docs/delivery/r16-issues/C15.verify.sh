#!/usr/bin/env bash
# C15 — docs verify. cwd = worktree root. Re-runs the brief's five acceptance
# bullets verbatim; never trusts the worker's report. Prose only: no tsc, no
# dotnet, no build — the only executable gate is the frontend docsPaths pair.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - docs/mcq-card-type-plan-2026-09-18.md:64 still reads
#     `### 3.1 PostgreSQL（新迁移 `src_C/Vpc/Db/Migrations/018_cards_mcq.sql`，一条语句）`
#     so the grep -F for the 019 heading fires (base tree fails here);
#   (step 1 then also checks the C01…C14 prerequisites C15 documents —
#   019_cards_mcq.sql / 018_cards_topic.sql on disk, DeckDiff.McqEquals,
#   clientCapabilities.ts, mcqRules.ts, FREE_PULL_CAP = 60, the Home locked
#   copy, client_features in the Snowflake file — none of which exist on base)
# Step 2 (literal guards) would also fail on base: no scope doc carries any of
# the pinned literals (e.g. `revision, topic?, mcq? }`, `## 五、2026-09 增补`,
# `learn a new card, earn a pull`), the loop-plan / gacha-v7 / wave-plan numstat
# pins are empty, and the MCQ plan still registers 018_cards_mcq.sql.
# Step 3 (python reproduction of docsPaths rules a/b), step 4 (frontend
# docsPaths + rootReadmePaths vitest) and step 5 (purely negative scope + frozen
# + hygiene guard) pass on base by design and are never reached there.
#
# The six driver-banned terms are NOT grepped here (C00 §0 deliberately does not
# spell them out and a verify script is prose workers copy); the driver's
# diff-scoped gate covers them after this script. Step 2 does pin the one place
# they matter for C15: the `"no AI anywhere"` row at launch-copy :407 must be
# neither removed nor even a context line of the diff.
#
# Network: none. No npm install, no tsc, no dotnet. Runtime ~10 s (+ ~3 s for
# the vitest pair when frontend/node_modules is present).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C15 VERIFY FAIL: $*" >&2; exit 1; }

MCQ=docs/mcq-card-type-plan-2026-09-18.md
CDV=docs/content-delivery-v3.md
CIP=docs/console-import-plan.md
LOOP=docs/gacha-acquisition-learning-loop-plan.md
V7=mobile/gacha-v7.md
LC=docs/home-review-and-launch-copy-2026-09-17.md
WP=docs/delivery-wave-1.6-plan-2026-09-19.md
ECON=docs/economy-v2-learn-to-earn-2026-09-19.md
SCOPE=("$MCQ" "$CDV" "$CIP" "$LOOP" "$V7" "$LC" "$WP")
TOPDOCS=("$MCQ" "$CDV" "$CIP" "$LOOP" "$LC" "$WP")   # scanned by frontend/tests/docsPaths.test.ts (V7 is under mobile/)

mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
numstat() { git diff --numstat "$mb" -- "$1" | awk '{print $1" "$2}'; }   # "added deleted", empty when unchanged
count() { grep -o -F -- "$1" "$2" | wc -l | tr -d ' '; }                   # occurrences of a fixed string

# ── 1. Scope docs exist + primary landing literal (FAILS ON BASE) + prerequisites ─
echo "[1/5] scope docs exist, MCQ plan §3.1 names 019 (fails on base), C01…C14 prerequisites"
for f in "${SCOPE[@]}" "$ECON"; do
  [ -f "$f" ] || fail "step 1: $f does not exist"
done
grep -Fq '### 3.1 PostgreSQL（新迁移 `src_C/Vpc/Db/Migrations/019_cards_mcq.sql`，一条语句）' "$MCQ" \
  || fail "step 1: $MCQ §3.1 heading does not name 019_cards_mcq.sql (base tree fails here: it still says 018_cards_mcq.sql)"
# The code C15 documents must be on the tree (C00 §4: deps C01, C09, +C14 — last in the serial queue).
[ -f src_C/Vpc/Db/Migrations/018_cards_topic.sql ] || fail "step 1: 018_cards_topic.sql missing — C05 not merged"
[ -f src_C/Vpc/Db/Migrations/019_cards_mcq.sql ]   || fail "step 1: 019_cards_mcq.sql missing — C08 not merged"
grep -Fq 'public static bool McqEquals(JsonElement? a, JsonElement? b)' src_C/Worker/Content/DeckDiff.cs \
  || fail "step 1: DeckDiff.McqEquals missing — C09 not merged"
grep -Fq 'public JsonElement? Mcq { get; set; }' src_C/Worker/S3/IS3DeckUploader.cs || fail "step 1: CardExportData.Mcq missing — C09 not merged"
grep -Fq 'public string? Topic { get; set; }' src_C/Worker/S3/IS3DeckUploader.cs    || fail "step 1: CardExportData.Topic missing — C05 not merged"
[ -f frontend/src/lib/mcqRules.ts ]               || fail "step 1: frontend/src/lib/mcqRules.ts missing — C11 not merged"
grep -Fq "SERVER_NOT_READY_MCQ" frontend/src/lib/deckImportRunner.ts || fail "step 1: SERVER_NOT_READY_MCQ missing — C11 not merged"
[ -f mobile/src/sync/clientCapabilities.ts ]      || fail "step 1: mobile/src/sync/clientCapabilities.ts missing — C14 not merged"
grep -Fq 'client_features' snowflake/001_content_intelligence_setup.sql || fail "step 1: Snowflake client_features projection missing — C13 not merged"
grep -Fq 'export const FREE_PULL_CAP = 60;' mobile/src/features/gacha/constants.ts || fail "step 1: FREE_PULL_CAP is not 60 — C01 not merged"
[ -f mobile/src/features/gacha/rewards/newCardLedger.ts ] || fail "step 1: newCardLedger.ts missing — C01 not merged"
if grep -Fq 'only full clear earns pulls' mobile/tests/unit/rewards.test.ts; then fail "step 1: rewards.test.ts still pins the full-clear rule — C01 incomplete"; fi
grep -Fq 'Learn a new card to earn a pull' mobile/src/features/gacha/selectors/homeSelectors.ts || fail "step 1: Home locked copy not moved — C03 not merged"
grep -Fq -- '- [x] 总复习模式不给抽（R8）。' "$ECON" || fail "step 1: economy-v2 §6 is not signed on this tree (wave setup commit missing)"

# ── 2. Literal guards (per file) ─────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. MCQ plan — numbers, property order, answer_mode key, exemption block
for s in '| DB | 019 迁移一列 | `src_C/Vpc/Db/Migrations/019_cards_mcq.sql` | S |' \
         '在 `Topic` 之后追加' \
         '排在 `revision` 之后、`mcq` 之前' \
         '（WhenWritingNull，`Topic` 之后）' \
         'client_features' \
         "array_contains('mcq'::variant, client_features)"; do
  grep -Fq -- "$s" "$MCQ" || fail "step 2a: $MCQ lacks literal: $s"
done
[ "$(count '迁移 020' "$MCQ")" = "3" ] || fail "step 2a: $MCQ must say 迁移 020 exactly 3 times (:376, :406, :429), found $(count '迁移 020' "$MCQ")"
[ "$(count '迁移 019' "$MCQ")" = "1" ] || fail "step 2a: $MCQ must say 迁移 019 exactly once (the Phase 1 row), found $(count '迁移 019' "$MCQ")"
grep -F '迁移 019' "$MCQ" | grep -Fq 'Phase 1' || fail "step 2a: the one 迁移 019 mention must be on the Phase 1 row"
for s in '迁移 018' '018_cards_mcq' '最后一个属性' '作为**最后一个**属性追加' 'app_version ≥ 1.6.0' '018 迁移一列'; do
  if grep -Fq -- "$s" "$MCQ"; then grep -Fn -- "$s" "$MCQ" >&2 || true; fail "step 2a: $MCQ still contains: $s"; fi
done
python3 - "$MCQ" <<'PY' || fail "step 2a: MCQ plan exemption block not edited as C00 §6 #1 requires (details above)"
import re, sys
text = open(sys.argv[1], encoding='utf-8').read()
blocks = re.findall(r'<!--\s*paths-not-on-disk\b([\s\S]*?)-->', text)
bad = []
if len(blocks) != 1:
    bad.append('expected exactly one paths-not-on-disk block, found %d' % len(blocks))
entries = []
for line in (blocks[0] if blocks else '').split('\n'):
    m = re.match(r'^\s*-\s+([A-Za-z0-9._/-]+)', line)
    if m:
        entries.append(m.group(1))
want = ['docs/aws-saa-mcq-authoring-guide.md', 'snowflake/002_mcq_marts.sql']
if entries != want:
    bad.append('block entries must be exactly %r (018_cards_mcq.sql deleted, never renumbered), found %r' % (want, entries))
for b in bad:
    print(b, file=sys.stderr)
sys.exit(1 if bad else 0)
PY
ms="$(numstat "$MCQ")"; ma="${ms%% *}"; md="${ms##* }"
[ -n "$ms" ] || fail "step 2a: $MCQ unchanged"
[ "$ma" -le 12 ] && [ "$md" -le 12 ] || fail "step 2a: $MCQ diff too large ($ms) — in-place edits only, no reflow"
# 2b. content-delivery-v3 — card shape, 11 fields, runner note
for s in 'revision, topic?, mcq? }' 'omitted when null' 'appended last in that order' '11 card fields' 'DeckDiff.McqEquals' \
         '018/019 via the same runner' 'Client: `mobile/src/content/deckRepository.ts`.' \
         'Full-download validation requires `deck.json .version === manifest entry .version (buildId)`.'; do
  grep -Fq -- "$s" "$CDV" || fail "step 2b: $CDV lacks literal: $s"
done
if grep -Fq '9 card fields' "$CDV"; then fail "step 2b: $CDV still says 9 card fields"; fi
cs="$(numstat "$CDV")"; ca="${cs%% *}"; cd_="${cs##* }"
[ -n "$cs" ] || fail "step 2b: $CDV unchanged"
[ "$ca" -le 8 ] && [ "$cd_" -le 4 ] || fail "step 2b: $CDV diff too large ($cs)"
# 2c. console-import-plan — markers, field map, addendum, acceptance item; :1 and :16 verbatim
for s in '`TOPIC:`' '`OPT:`' '`WHY:`' '`QUALIFIER:`' 'TOPIC → topic' 'QUALIFIER → mcq' '## 五、2026-09 增补' \
         'SERVER_NOT_READY_MCQ' 'BAD_TOPIC' "'topic'" "'mcq'" '§4.1–4.5' 'docs/mcq-card-type-plan-2026-09-18.md' \
         'aws-sqs-order-buffer-mcq-01' 'aws-s3-compliance-copy-mcq-02' \
         '- **服务端零改动**:导入走既有 createCard/updateCard/fetchCardsByDeck API。' \
         '# Web 控制台录题/发布优化计划(2026-08)'; do
  grep -Fq -- "$s" "$CIP" || fail "step 2c: $CIP lacks literal: $s"
done
[ "$(count '全部 unchanged' "$CIP")" -ge 2 ] || fail "step 2c: $CIP must mention 全部 unchanged at least twice (§四 item 2 + the new §4.3 item)"
[ "$(head -1 "$CIP")" = '# Web 控制台录题/发布优化计划(2026-08)' ] || fail "step 2c: $CIP title changed"
is="$(numstat "$CIP")"; ia="${is%% *}"; id_="${is##* }"
[ -n "$is" ] || fail "step 2c: $CIP unchanged"
[ "$ia" -le 30 ] && [ "$id_" -le 3 ] || fail "step 2c: $CIP diff too large ($is) — an addendum, not a rewrite"
# 2d. loop-plan — exactly two pointer lines at the new :30 and :386
[ "$(numstat "$LOOP")" = "2 0" ] || fail "step 2d: $LOOP numstat must be exactly '2 0' (found '$(numstat "$LOOP")')"
l30="$(sed -n '30p' "$LOOP")"; l386="$(sed -n '386p' "$LOOP")"
for s in '2026-09-21' '`docs/economy-v2-learn-to-earn-2026-09-19.md`' '裁决 6'; do
  printf '%s' "$l30" | grep -Fq -- "$s" || fail "step 2d: $LOOP:30 (pointer after 裁决 6) lacks: $s"
done
for s in '2026-09-21' '`docs/economy-v2-learn-to-earn-2026-09-19.md`' '不变量 4'; do
  printf '%s' "$l386" | grep -Fq -- "$s" || fail "step 2d: $LOOP:386 (pointer after 不变量 4) lacks: $s"
done
sed -n '29p' "$LOOP"  | grep -Fq '6. 当前奖励政策保持' || fail "step 2d: $LOOP:29 (裁决 6) is no longer the original line"
sed -n '385p' "$LOOP" | grep -Fq '4. 当前奖励规则唯一：full clear +1' || fail "step 2d: $LOOP:385 (不变量 4) is no longer the original line"
# 2e. gacha-v7 — exactly one pointer line at the new :95
[ "$(numstat "$V7")" = "1 0" ] || fail "step 2e: $V7 numstat must be exactly '1 0' (found '$(numstat "$V7")')"
l95="$(sed -n '95p' "$V7")"
for s in '2026-09-21' '`docs/economy-v2-learn-to-earn-2026-09-19.md`' 'R1–R10' 'cap 60+5'; do
  printf '%s' "$l95" | grep -Fq -- "$s" || fail "step 2e: $V7:95 (pointer after :94) lacks: $s"
done
sed -n '94p' "$V7" | grep -Fq 'v6.1 §2' || fail "step 2e: $V7:94 changed"
sed -n '99p' "$V7" | grep -Fq 'Free pull cap：30 主钱包 + 5 reserve' || fail "step 2e: $V7:99 (history bullet) changed"
# 2f. launch copy — old rule / old cap gone, new phrases present, history rows untouched, counts honest
for s in 'Clear a short daily review, earn a pull' "clear today's 1–5 card review, earn one pull" \
         "Fully clear the day's route" 'holds up to 30 pulls plus a 5-pull reserve' \
         "Finish today's review (1–5 cards), get one pull" '30+5 wallet' '1 pull per full clear' \
         'clear the route, earn the next pull' '每天清完 1–5 张复习就得 1 抽' '钱包上限 30 抽 + 5 抽备用' \
         '只能靠今天学完那几张' "fully clearing today's review" 'caps at 30 pulls plus a 5-pull reserve' \
         "Clear the day's route and you earn one pull" 'earn one per cleared day' "earned only by clearing the day's route" \
         'one pull per cleared day' '全部清完得 1 抽' 'the route (3 cards) clears' "Clear today's route, 1–5 cards. +1 pull." \
         "clearing today's review (+1)" 'full clear = 1，否则 0' '1 pull per fully cleared review'; do
  if grep -Fq -- "$s" "$LC"; then grep -Fn -- "$s" "$LC" >&2 || true; fail "step 2f: $LC still carries old-rule copy: $s"; fi
done
[ "$(grep -io -- 'learn a new card, earn a pull' "$LC" | wc -l | tr -d ' ')" -ge 5 ] \
  || fail "step 2f: $LC must say 'learn a new card, earn a pull' at least 5 times (found $(grep -io -- 'learn a new card, earn a pull' "$LC" | wc -l | tr -d ' '))"
for s in '60+5 wallet' 'one pull per new card learned' \
         '| 部分完成也给抽 / 每场 2 抽 | R1：每张新卡首次 hard/good/easy +1；R2：清空当天到期卡每天 +1 一次；正确率与 minimumGoal 不改变抽数 | "one pull per new card learned" |' \
         '| full clear +1 / "1 pull per cleared review" | 2026-09-21 起由 R1/R2 替换（`docs/economy-v2-learn-to-earn-2026-09-19.md` §2） | "learn a new card, earn a pull" |'; do
  grep -Fq -- "$s" "$LC" || fail "step 2f: $LC lacks literal: $s"
done
[ "$(count '60 pulls plus a 5-pull reserve' "$LC")" = "2" ] || fail "step 2f: '60 pulls plus a 5-pull reserve' must appear exactly twice (:178, :279)"
[ "$(count '60 抽 + 5 抽备用' "$LC")" = "2" ]             || fail "step 2f: '60 抽 + 5 抽备用' must appear exactly twice (:247, :341)"
python3 - "$LC" <<'PY' || fail "step 2f: launch-copy length cells are not honest (details above)"
import re, sys
lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
bad = []
promo = [l for l in lines if l.startswith('| Promotional text（≤170） |')]
if len(promo) != 1:
    bad.append('expected one Promotional text row, found %d' % len(promo))
else:
    cells = [c.strip() for c in promo[0].strip().strip('|').split('|')]
    if len(cells) != 3 or not cells[2].isdigit():
        bad.append('Promotional text row must have 3 cells with a numeric length cell: %r' % promo[0])
    else:
        n, text = int(cells[2]), cells[1]
        if n != len(text) or n > 170:
            bad.append('Promotional text length cell %d != len(text) %d or > 170' % (n, len(text)))
        if 'Learn a new card, earn a pull' not in text:
            bad.append('Promotional text does not say "Learn a new card, earn a pull"')
def post_after(header_prefix):
    for i, l in enumerate(lines):
        if l.startswith(header_prefix):
            m = re.search(r'（(\d+) 字符）', l)
            j = i + 1
            while j < len(lines) and lines[j].strip() == '':
                j += 1
            body = []
            while j < len(lines) and lines[j].startswith('>'):
                body.append(lines[j][2:] if lines[j].startswith('> ') else lines[j][1:])
                j += 1
            return (int(m.group(1)) if m else None), '\n'.join(body)
    return None, None
for hdr in ('**[earned-gacha, core pitch]**', '**[thread opener, economy numbers]**', '**[dev-humor, Anki contrast (social only, never App Store)]**'):
    n, body = post_after(hdr)
    if body is None:
        bad.append('post header not found: %s' % hdr); continue
    if n is None or n != len(body):
        bad.append('%s: header count %r != recount %d' % (hdr, n, len(body)))
    if len(body) > 280:
        bad.append('%s: post is %d chars (> 280)' % (hdr, len(body)))
for b in bad:
    print(b, file=sys.stderr)
sys.exit(1 if bad else 0)
PY
# The row at :407 (the sixth banned term lives in its 为什么 cell) is never removed, never even a context line.
if git diff "$mb" -- "$LC" | grep -Fq 'no AI anywhere'; then
  fail "step 2f: the launch-copy diff touches or surrounds the \"no AI anywhere\" row (:407) — edit nothing between :404 and :410"
fi
lc_removed="$(git diff -U0 "$mb" -- "$LC" | grep '^-' | grep -v '^---' || true)"
for s in '| F5 |' '| F9 |' '| F10 |' 'Keep streak: 1 card' '**文案 / 信息架构**' '5 cards → earn a pull' '30 抽硬保底' 'Three free pulls to start'; do
  if printf '%s\n' "$lc_removed" | grep -Fq -- "$s"; then fail "step 2f: a history line was removed from $LC: $s"; fi
done
ls_="$(numstat "$LC")"; la="${ls_%% *}"; ld="${ls_##* }"
[ -n "$ls_" ] || fail "step 2f: $LC unchanged"
[ "$la" -le 27 ] && [ "$ld" -le 25 ] || fail "step 2f: $LC diff too large ($ls_) — line edits only"
# 2g. wave plan — the Snowflake clause on :121, nothing else
[ "$(numstat "$WP")" = "1 1" ] || fail "step 2g: $WP numstat must be exactly '1 1' (found '$(numstat "$WP")')"
grep -F '**Wave C 结束你要做的**' "$WP" | grep -Fq 'owner 重跑 Snowflake `snowflake/001_content_intelligence_setup.sql`' \
  || fail "step 2g: $WP wave-end line lacks the Snowflake re-run clause"
grep -F '**Wave C 结束你要做的**' "$WP" | grep -Fq '生产库跑 018/019 → owner 重跑 Snowflake' || fail "step 2g: the clause must follow 生产库跑 018/019"

# ── 3. docsPaths rules (a)/(b) reproduced over the six top-level docs ────────
echo "[3/5] docsPaths rules (a) cited-exists-or-registered / (b) registered-absent, reproduced in python"
python3 - "${TOPDOCS[@]}" <<'PY' || fail "step 3: docsPaths rules (a)/(b) fail (listed above) — frontend/tests/docsPaths.test.ts would go red"
import os, re, sys
root = os.getcwd()
top = r'(?:frontend|mobile|src_C|pg-layer|snowflake|docs|\.github)'
# same shape as frontend/tests/docsPaths.test.ts:95-98 (CITATION) and :100 (EXEMPTION_BLOCK); :N / :N-M suffix tolerated
cite = re.compile(r'`(' + top + r'/[A-Za-z0-9._/-]+?)(?::[0-9]+(?:-[0-9]+)?)?`')
block_re = re.compile(r'<!--\s*paths-not-on-disk\b([\s\S]*?)-->')
bad = []
for f in sys.argv[1:]:
    text = open(f, encoding='utf-8').read()
    blocks = block_re.findall(text)
    if len(blocks) > 1:
        bad.append('%s: %d paths-not-on-disk blocks (max 1)' % (f, len(blocks)))
    exempt = []
    for l in (blocks[0] if blocks else '').split('\n'):
        m = re.match(r'^\s*-\s+([A-Za-z0-9._/-]+)', l)
        if m:
            exempt.append(m.group(1))
    prose = block_re.sub('', text)
    for p in sorted(set(cite.findall(prose))):
        if not os.path.exists(os.path.join(root, p)) and p not in exempt:
            bad.append('%s: cited path not on disk and not registered: %s' % (f, p))
    for p in exempt:
        if os.path.exists(os.path.join(root, p)):
            bad.append('%s: registered as not-on-disk but exists: %s' % (f, p))
for b in bad:
    print(b, file=sys.stderr)
sys.exit(1 if bad else 0)
PY
[ -f "$ECON" ] || fail "step 3: the pointer target $ECON is missing"

# ── 4. Frontend docsPaths / rootReadmePaths vitest pair ─────────────────────
echo "[4/5] frontend vitest docsPaths + rootReadmePaths"
if [ -x frontend/node_modules/.bin/vitest ]; then
  ( cd frontend && npx vitest run tests/docsPaths.test.ts tests/rootReadmePaths.test.ts --reporter=dot ) \
    || fail "step 4: frontend docsPaths/rootReadmePaths tests failed"
else
  echo "step 4: frontend/node_modules absent in this worktree — vitest pair skipped (no install allowed); step 3 reproduced the rules"
fi

# ── 5. Scope + frozen + hygiene (purely negative; passes on base) ────────────
echo "[5/5] scope + frozen + hygiene guard"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts \
  frontend/src frontend/tests frontend/package.json frontend/package-lock.json src_C snowflake \
  "$ECON" docs/release-1.6.0-plan-2026-09-19.md)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "step 5: frozen / code / out-of-scope file modified"; }
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules and frontend/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- docs mobile/gacha-v7.md mobile/src mobile/tests frontend/src frontend/tests src_C snowflake; } \
  | sort -u | grep -Ev '^(docs/mcq-card-type-plan-2026-09-18\.md|docs/content-delivery-v3\.md|docs/console-import-plan\.md|docs/gacha-acquisition-learning-loop-plan\.md|mobile/gacha-v7\.md|docs/home-review-and-launch-copy-2026-09-17\.md|docs/delivery-wave-1\.6-plan-2026-09-19\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "step 5: files changed outside C15 scope"; }
if git diff -U0 "$mb" -- "${SCOPE[@]}" | grep '^+' | grep -v '^+++' | grep -Eq '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable'; then
  fail "step 5: suppression token in an added line"
fi
grep -Fq '"vite": "7.2.4"' mobile/package.json           || fail "step 5: vite pin 7.2.4 lost"
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "step 5: expo-updates pin lost"
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail "step 5: app.json version is not 1.6.0"
if grep -rq "@sentry" mobile/src; then fail "step 5: @sentry reference under mobile/src (Sentry is out of 1.6.0)"; fi

echo "C15 VERIFY OK"
