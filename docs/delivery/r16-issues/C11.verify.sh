#!/usr/bin/env bash
# C11 — mcq-console-importer verify. cwd = worktree root. Re-runs the brief's
# five acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - frontend/src/lib/mcqRules.ts, frontend/src/types/mcq.ts and
#     frontend/tests/deckImport.mcq.test.ts do not exist on delivery/r16-c-economy
#   (step 1 then also checks the C06 prerequisite: deckImport.ts must already
#   carry TOPIC_MARKER / 'DUPLICATE_TOPIC', because C11 inserts its three
#   branches after the TOPIC: branch and appends 'mcq' after 'topic' in
#   COMPARABLE_FIELDS — on base that check would fail too, C06 is not merged)
# Step 2 (literal guards) would also fail on base: no scope file mentions `mcq`
# (grep -c mcq over deckImport.ts / deckImportRunner.ts / deckImport.test.ts
# prints 0 there) and the plan doc still registers deckImport.mcq.test.ts.
# Step 3 is the frontend lint + `tsc -b && vite build`, step 4 the targeted
# vitest run (the three importer suites + the census / docsPaths tests a
# careless edit trips) plus a python reproduction of docsPaths rules (a)/(b)
# over the one top-level doc C11 edits, step 5 a purely negative scope + frozen
# guard; all pass on base by design and are never reached there.
#
# The six banned terms are NOT grepped here (C00 §0 deliberately does not spell
# them out and a verify script is prose workers copy); the driver's diff-scoped
# gate covers them after this script.
#
# Network: none. No npm install. Runtime ~30 s (lint ~4 s, build ~10 s,
# vitest ~3 s).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C11 VERIFY FAIL: $*" >&2; exit 1; }

DI=frontend/src/lib/deckImport.ts
MR=frontend/src/lib/mcqRules.ts
MT=frontend/src/types/mcq.ts
RN=frontend/src/lib/deckImportRunner.ts
NT=frontend/tests/deckImport.mcq.test.ts
DT=frontend/tests/deckImport.test.ts
RT=frontend/tests/deckImportRunner.test.ts
PD=docs/delivery-wave-1.6-plan-2026-09-19.md
SCOPE_SRC=("$DI" "$MR" "$MT" "$RN")
SCOPE_ALL=("$DI" "$MR" "$MT" "$RN" "$NT" "$DT")

# first line number of a fixed string in a file ("" when absent)
lineof() { grep -nF -- "$1" "$2" | head -1 | cut -d: -f1 || true; }

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C06 prerequisite)"
for f in "$MR" "$MT" "$NT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$DI" "$RN" "$DT" "$RT" "$PD"; do
  [ -f "$f" ] || fail "$f is missing (renamed or deleted — out of scope)"
done
grep -Fq 'const TOPIC_MARKER = /^TOPIC:(.*)$/;' "$DI" || fail "deckImport.ts lacks TOPIC_MARKER — C06 must be merged before C11"
grep -Fq "'DUPLICATE_TOPIC'" "$DI"                  || fail "deckImport.ts lacks 'DUPLICATE_TOPIC' — C06 must be merged before C11"
grep -Fq 'topic: optionalText(card.topic ?? null),' "$RN" || fail "deckImportRunner.ts lacks C06's topic param — C06 incomplete"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. types/mcq.ts — the two interface lines verbatim (C00 §2.11), no imports
grep -Fq 'export interface McqOption { key: string; text: string; why: string | null; correct: boolean }' "$MT" \
  || fail "types/mcq.ts: McqOption interface line missing/changed (C00 §2.11)"
grep -Fq 'export interface McqBlob { v: 1; qualifier: string | null; shuffle: boolean; options: McqOption[] }' "$MT" \
  || fail "types/mcq.ts: McqBlob interface line missing/changed (C00 §2.11)"
if grep -Eq '^\s*import\b' "$MT"; then
  grep -En '^\s*import\b' "$MT" >&2 || true
  fail "types/mcq.ts must have no imports"
fi
# 2b. mcqRules.ts — union (all 19 codes), three regexes verbatim, exports, purity
grep -Fq 'export type McqIssueCode' "$MR" || fail "mcqRules.ts lacks 'export type McqIssueCode'"
for code in MCQ_BAD_OPT_LINE MCQ_QUALIFIER_EMPTY MCQ_QUALIFIER_IS_CHOOSE_N MCQ_TOO_FEW_OPTIONS MCQ_TOO_MANY_OPTIONS \
            MCQ_KEY_SEQUENCE MCQ_DUPLICATE_OPTION_KEY MCQ_OPTION_EMPTY MCQ_OPTION_TEXT_DUPLICATE MCQ_NO_CORRECT \
            MCQ_TOO_MANY_CORRECT MCQ_ALL_CORRECT MCQ_WHY_MISSING MCQ_WHY_WITHOUT_OPTION MCQ_FORBIDDEN_OPTION_TEXT \
            MCQ_LETTER_REFERENCE MCQ_QUALIFIER_NOT_IN_STEM MCQ_CHOOSE_N_MISMATCH MCQ_DIFFICULTY_RANGE; do
  grep -Fq "'$code'" "$MR" || fail "mcqRules.ts: McqIssueCode lacks '$code'"
done
if grep -Fq "'MCQ_DUPLICATE_QUALIFIER'" "$MR"; then
  fail "mcqRules.ts must not carry 'MCQ_DUPLICATE_QUALIFIER' — that code lives on ImportIssueCode in deckImport.ts (C00 §2.11)"
fi
grep -Fq 'export const OPT_PAYLOAD = /^[ \t]*([A-Fa-f])[ \t]*(\*)?[ \t]*$/;' "$MR" \
  || fail "mcqRules.ts: OPT_PAYLOAD regex line missing/changed (C00 §2.11)"
grep -Fq 'export const LETTER_REFERENCE = /\b(?:Option|Answer|Choice)\s+[A-F]\b|\b[A-F]\)\s/;' "$MR" \
  || fail "mcqRules.ts: LETTER_REFERENCE regex line missing/changed (uppercase only, no i flag — C00 §2.11)"
grep -Fq 'export const FORBIDDEN_OPTION_TEXT = /\b(all|none) of the above\b|\bboth [a-f] and [a-f]\b/i;' "$MR" \
  || fail "mcqRules.ts: FORBIDDEN_OPTION_TEXT regex line missing/changed (C00 §2.11)"
for sym in 'export const CHOOSE_N_STEM' 'export const QUALIFIER_IS_CHOOSE_N' \
           'export const MCQ_MIN_OPTIONS' 'export const MCQ_MAX_OPTIONS' 'export const MCQ_MAX_CORRECT' \
           'export function validateMcq(' 'export function normalizeMcqForCompare(' 'export function mcqOf(' \
           "import type { McqBlob" "from '../types/mcq'"; do
  grep -Fq "$sym" "$MR" || fail "mcqRules.ts lacks: $sym"
done
if grep -Eq "cardRules|from 'react|require\(" "$MR"; then
  grep -En "cardRules|from 'react|require\(" "$MR" >&2 || true
  fail "mcqRules.ts must stay pure: no cardRules import (tests/cardRulesWiring.test.ts:173-196 pins that table), no react, no require"
fi
imports_other="$(grep -E '^\s*import\b' "$MR" | grep -vF "'../types/mcq'" || true)"
[ -z "$imports_other" ] || { echo "$imports_other" >&2; fail "mcqRules.ts may import only from '../types/mcq'"; }
# 2c. deckImport.ts — markers verbatim, types, unions, section keys, drop semantics
grep -Fq 'const OPT_MARKER = /^OPT:(.*)$/;' "$DI"             || fail "deckImport.ts: OPT_MARKER literal missing/changed (C00 §2.11)"
grep -Fq 'const WHY_MARKER = /^WHY:(.*)$/;' "$DI"             || fail "deckImport.ts: WHY_MARKER literal missing/changed (C00 §2.11)"
grep -Fq 'const QUALIFIER_MARKER = /^QUALIFIER:(.*)$/;' "$DI" || fail "deckImport.ts: QUALIFIER_MARKER literal missing/changed (C00 §2.11)"
grep -Fq '  mcq?: McqBlob;' "$DI" || fail "deckImport.ts: DeckCardContent lacks 'mcq?: McqBlob;'"
if grep -Eq 'mcq\?: McqBlob \| null' "$DI"; then
  fail "deckImport.ts: DeckCardContent.mcq must be absent-or-blob, never null (that shape belongs to the runner params / types/card.ts)"
fi
grep -Fq "'MCQ_DUPLICATE_QUALIFIER'" "$DI" || fail "deckImport.ts: ImportIssueCode lacks 'MCQ_DUPLICATE_QUALIFIER'"
grep -Fq 'McqIssueCode' "$DI"              || fail "deckImport.ts: ImportIssueCode must widen with McqIssueCode"
grep -Fq "from '../types/mcq'" "$DI"       || fail "deckImport.ts must import type McqBlob from '../types/mcq'"
grep -Fq "from './mcqRules'" "$DI"         || fail "deckImport.ts must import from './mcqRules'"
grep -Fq '`option:${string}`' "$DI"        || fail "deckImport.ts: SectionKind lacks the \`option:\${string}\` member"
grep -Fq '`why:${string}`' "$DI"           || fail "deckImport.ts: SectionKind lacks the \`why:\${string}\` member"
grep -Fq 'McqDraft' "$DI"                  || fail "deckImport.ts: CardDraft must hold an McqDraft (mcq: McqDraft | null)"
grep -Fq 'dropped: boolean' "$DI"          || fail "deckImport.ts: CardDraft lacks 'dropped: boolean'"
grep -Fq 'd.dropped' "$DI"                 || fail "deckImport.ts: finishCard must drop a card flagged by MCQ_BAD_OPT_LINE (d.dropped)"
for sym in "'MCQ_BAD_OPT_LINE'" "'MCQ_WHY_WITHOUT_OPTION'" "'MCQ_DUPLICATE_OPTION_KEY'" \
           'validateMcq(' 'normalizeMcqForCompare(' 'mcqOf(' 'OPT_PAYLOAD.exec(' 'shuffle: true' 'v: 1'; do
  grep -Fq "$sym" "$DI" || fail "deckImport.ts lacks: $sym"
done
grep -Eq '\.\.\.\(mcq( !== null)? \? \{ mcq \} : \{\}\)' "$DI" \
  || fail "deckImport.ts: card literal must spread mcq conditionally (...(mcq ? { mcq } : {})) so Q/A cards have no mcq key"
grep -Fq "  | 'mcq';" "$DI" || fail "deckImport.ts: ComparableField must end with | 'mcq';"
last_two="$(sed -n '/^const COMPARABLE_FIELDS/,/^\];/p' "$DI" | grep -E "^[[:space:]]+'[A-Za-z]+',?[[:space:]]*$" | tail -2 | tr -d " ,'" | paste -sd, -)"
[ "$last_two" = "topic,mcq" ] || fail "deckImport.ts: COMPARABLE_FIELDS must end with 'topic', 'mcq' (found: '${last_two}')"
# lexer placement: TOPIC: branch (C06) < the three MCQ branches < Q: branch
t_line="$(lineof 'TOPIC_MARKER.exec(' "$DI")"
qual_line="$(lineof 'QUALIFIER_MARKER.exec(' "$DI")"
opt_line="$(lineof 'OPT_MARKER.exec(' "$DI")"
why_line="$(lineof 'WHY_MARKER.exec(' "$DI")"
q_line="$(lineof 'QUESTION_MARKER.exec(' "$DI")"
[ -n "$qual_line" ] && [ -n "$opt_line" ] && [ -n "$why_line" ] || fail "deckImport.ts: the lexer never evaluates one of QUALIFIER_MARKER/OPT_MARKER/WHY_MARKER"
[ -n "$t_line" ] && [ -n "$q_line" ] || fail "deckImport.ts: the TOPIC: or Q: branch moved — out of scope"
for l in "$qual_line" "$opt_line" "$why_line"; do
  [ "$t_line" -lt "$l" ] || fail "deckImport.ts: MCQ branches must come AFTER C06's TOPIC: branch"
  [ "$l" -lt "$q_line" ] || fail "deckImport.ts: MCQ branches must come BEFORE the Q: branch (C00 §2.11)"
done
# serializer order inside serializeDeckMarkdown: header < QUALIFIER: < Q: < OPT: < WHY: < A: (only out.push(...) lines count)
ser="$(sed -n '/^export function serializeDeckMarkdown/,/^}/p' "$DI")"
[ -n "$ser" ] || fail "deckImport.ts: serializeDeckMarkdown not found"
sline() { printf '%s\n' "$ser" | grep -nE -- "$1" | head -1 | cut -d: -f1 || true; }
s_h="$(sline 'out\.push\(`## \$\{card\.stableUid\} \| d\$\{card\.difficulty\}`\);')"
s_qual="$(sline 'out\.push\(.*QUALIFIER: \$\{')"
s_q="$(sline "out\.push\('Q:'\);")"
s_opt="$(sline 'out\.push\(.*OPT: \$\{')"
s_why="$(sline 'out\.push\(.*WHY:')"
s_a="$(sline "out\.push\('A:'\);")"
[ -n "$s_h" ] && [ -n "$s_q" ] && [ -n "$s_a" ] || fail "deckImport.ts: serializeDeckMarkdown header/Q:/A: pushes moved — out of scope"
[ -n "$s_qual" ] && [ -n "$s_opt" ] && [ -n "$s_why" ] || fail "deckImport.ts: serializeDeckMarkdown does not emit QUALIFIER:/OPT:/WHY:"
[ "$s_h" -lt "$s_qual" ] && [ "$s_qual" -lt "$s_q" ] || fail "deckImport.ts: QUALIFIER: must be emitted after the card header and before Q:"
[ "$s_q" -lt "$s_opt" ] && [ "$s_opt" -lt "$s_a" ] && [ "$s_why" -lt "$s_a" ] || fail "deckImport.ts: OPT:/WHY: must be emitted between the question and A:"
# 2d. deckImportRunner.ts — params, explicit null, guard, sentence verbatim
grep -Fq "export const SERVER_NOT_READY_MCQ = 'SERVER_NOT_READY_MCQ';" "$RN" || fail "deckImportRunner.ts lacks the SERVER_NOT_READY_MCQ export"
grep -Fq 'The server is not ready for MCQ cards (migration 019 / Lambda not deployed); nothing after this card was written.' "$RN" \
  || fail "deckImportRunner.ts: describeFailure readiness sentence missing/changed (C00 §2.11)"
[ "$(grep -c '^  mcq?: McqBlob | null;$' "$RN" || true)" -eq 2 ] \
  || fail "deckImportRunner.ts: CreateCardParams and UpdateCardParams must each declare 'mcq?: McqBlob | null;'"
grep -Fq 'mcq: card.mcq ?? null,' "$RN"        || fail "deckImportRunner.ts: createParamsFor does not send mcq (explicit null on Q/A cards)"
grep -Fq 'mcq: action.card.mcq ?? null,' "$RN" || fail "deckImportRunner.ts: updateParamsFor does not send mcq (explicit null on Q/A cards)"
grep -Fq 'mcqOf(outcome.data)' "$RN"           || fail "deckImportRunner.ts: the readiness guard must read the echo through mcqOf(outcome.data)"
grep -Fq "import { mcqOf } from './mcqRules'" "$RN" || fail "deckImportRunner.ts must import mcqOf from './mcqRules'"
grep -Fq "import type { McqBlob } from '../types/mcq'" "$RN" || fail "deckImportRunner.ts must import type McqBlob from '../types/mcq'"
grep -Fq 'mcqProbed' "$RN" || fail "deckImportRunner.ts: the guard must probe once per run (mcqProbed flag)"
if grep -Eq '\baborted\b' "$RN"; then
  fail "deckImportRunner.ts: ImportRunResult gains no field (no 'aborted'); skipped actions go into failures"
fi
# 2e. new test — property harness, fixtures, the 23 contract cases
grep -q "from 'fast-check'" "$NT" || fail "deckImport.mcq.test.ts must use fast-check (C00 §3.3)"
grep -q "fc.assert(" "$NT"        || fail "deckImport.mcq.test.ts has no fc.assert property"
for sym in mcqArb aws-sqs-order-buffer-mcq-01 aws-s3-compliance-copy-mcq-02 'answer a question' SERVER_NOT_READY_MCQ \
           runImport describeFailure validateMcq normalizeMcqForCompare LETTER_REFERENCE 'LEAST operational overhead'; do
  grep -Fq -- "$sym" "$NT" || fail "deckImport.mcq.test.ts lacks: $sym"
done
if grep -Fq '现有 154' "$NT"; then
  fail "deckImport.mcq.test.ts quotes the placeholder header of the MCQ plan fence (:175) — only the two cards at :177-253 may be copied"
fi
for s in \
  'parses the single-answer example card: options a-d, correct b, qualifier set' \
  'parses the choose-two example card: options a-e, correct a and c, no qualifier' \
  'reports no issues for the example document' \
  'leaves the mcq key absent on Q/A cards in the same document' \
  'reports a mistyped OPT: line as MCQ_BAD_OPT_LINE at that line and drops the card' \
  'never glues a mistyped OPT: line into the open section' \
  'accepts an uppercase key and normalizes it to lowercase' \
  'reports a WHY: before any OPT: as MCQ_WHY_WITHOUT_OPTION' \
  'reports a second QUALIFIER: as MCQ_DUPLICATE_QUALIFIER and keeps the first' \
  'reports a repeated OPT: key as MCQ_DUPLICATE_OPTION_KEY, not DUPLICATE_SECTION' \
  'reports a second WHY: for one option as DUPLICATE_SECTION and keeps the first' \
  'produces every McqIssueCode from at least one positive case' \
  'does not flag "answer a question" as a letter reference' \
  'checks choose-N in both directions' \
  'blocks an invalid MCQ card through validateCards and planImport as INVALID_CARD' \
  'round trips: serialize then parse returns every MCQ field unchanged' \
  'serializes QUALIFIER: before Q: and OPT:/WHY: between the question and A:' \
  're-planning the serialized document against rows built from it is all unchanged' \
  'normalizeMcqForCompare treats server null and file absence alike and ignores spacing, key order and v' \
  'stops after the first MCQ write whose echo lacks mcq and lists the rest as SERVER_NOT_READY_MCQ' \
  'continues when the echo carries an mcq object' \
  'never inspects the echo of a Q/A-only run' \
  'describeFailure names the server readiness problem'; do
  grep -Fq "it('$s'" "$NT" || fail "missing deckImport.mcq test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$NT" || true)" -ge 23 ] || fail "deckImport.mcq.test.ts needs >= 23 it() blocks"
# 2f. deckImport.test.ts — surgical edits present, fixture and title set intact
grep -Fq 'mcq' "$DT" || fail "deckImport.test.ts never mentions mcq — the cardArb branch / contentOf spread are missing"
grep -Fq '...(card.mcq !== undefined ? { mcq: card.mcq } : {}),' "$DT" \
  || fail "deckImport.test.ts: contentOf / the server-row model must spread mcq only when defined"
grep -Fq 'mcqArb' "$DT" || fail "deckImport.test.ts: cardArb lacks the optional mcqArb branch"
if sed -n "/it('reads every card field'/,/^  });/p" "$DT" | grep -q 'mcq'; then
  fail "deckImport.test.ts: the exact-key fixture (reads every card field) must stay byte-identical — no mcq key"
fi
[ "$(grep -cE "^\s*it\(" "$DT" || true)" -ge 46 ] || fail "deckImport.test.ts lost it() blocks (needs >= 46)"
for s in \
  'reads every card field' \
  'lists every changed field for the preview' \
  'round trips: serialize then parse returns every field unchanged' \
  'blank lines and CRLF anywhere do not change the parse result' \
  'any document with a repeated uid is rejected' \
  'planImport is idempotent and calls identical content unchanged' \
  'every reported issue points at a real line'; do
  grep -Fq "it('$s'" "$DT" || fail "deckImport.test.ts: existing case renamed/removed: $s"
done
# 2g. suppression / gutting; no CJK in the four frontend/src scope files (tests/uiLanguage.test.ts scans src/ only)
if grep -Eq '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "${SCOPE_ALL[@]}"; then
  grep -En '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "${SCOPE_ALL[@]}" >&2 || true
  fail "test gutting / suppression found"
fi
if perl -CSD -ne 'exit 1 if /[\x{3000}-\x{30ff}\x{3400}-\x{4dbf}\x{4e00}-\x{9fff}\x{ff00}-\x{ffef}]/' "${SCOPE_SRC[@]}"; then :; else
  fail "a CJK character in a frontend/src scope file (tests/uiLanguage.test.ts would fail)"
fi
# 2h. the plan doc: bullet gone from the first paths-not-on-disk block, :115 citation kept, other bullet kept
python3 - "$PD" <<'PY' || fail "plan doc: paths-not-on-disk block not edited as C00 §6 #12 requires (details above)"
import re, sys
text = open(sys.argv[1], encoding='utf-8').read()
blocks = re.findall(r'<!--\s*paths-not-on-disk\b([\s\S]*?)-->', text)
bad = []
if len(blocks) != 1:
    bad.append(f'expected exactly one paths-not-on-disk block, found {len(blocks)}')
entries = []
for line in (blocks[0] if blocks else '').split('\n'):
    m = re.match(r'^\s*-\s+([A-Za-z0-9._/-]+)', line)
    if m:
        entries.append(m.group(1))
if 'frontend/tests/deckImport.mcq.test.ts' in entries:
    bad.append('frontend/tests/deckImport.mcq.test.ts is still registered as not-on-disk (rule b of docsPaths.test.ts goes red)')
if 'docs/design/v10-ceremony-seam-of-light.md' not in entries:
    bad.append('the block lost its other bullet (docs/design/v10-ceremony-seam-of-light.md) — only :229 may be deleted')
if '`frontend/tests/deckImport.mcq.test.ts`' not in text:
    bad.append('the C11 row (:115) no longer cites `frontend/tests/deckImport.mcq.test.ts`')
for b in bad:
    print(b, file=sys.stderr)
sys.exit(1 if bad else 0)
PY

# ── 3. Lint + build (tsc -b type-checks tests/ too) ────────────────────────
echo "[3/5] npm run lint && npm run build"
( cd frontend && npm run lint )  || fail "eslint failed"
( cd frontend && npm run build ) || fail "tsc -b && vite build failed"

# ── 4. Targeted vitest + docsPaths reproduction ────────────────────────────
echo "[4/5] vitest deckImport.mcq / deckImport / deckImportRunner + cardRulesWiring + docsPaths + census"
( cd frontend && npx vitest run \
    tests/deckImport.mcq.test.ts \
    tests/deckImport.test.ts \
    tests/deckImportRunner.test.ts \
    tests/cardRulesWiring.test.ts \
    tests/docsPaths.test.ts \
    tests/rootReadmePaths.test.ts \
    tests/uiLanguage.test.ts \
    tests/apiSurfaceCensus.test.ts \
    tests/consoleDirectoryLayout.test.ts \
    tests/hookWiring.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"
# docsPaths rules (a) cited-exists-or-registered and (b) registered-must-not-exist, reproduced in python
# for the one top-level doc C11 edits (same CITATION / EXEMPTION_BLOCK / bullet shapes as docsPaths.test.ts:95-131).
python3 - "$PD" <<'PY' || fail "docsPaths rules (a)/(b) fail on the plan doc (listed above)"
import os, re, sys
root = os.getcwd()
top = r'(?:frontend|mobile|src_C|pg-layer|snowflake|docs|\.github)'
cite = re.compile(r'`(' + top + r'/[A-Za-z0-9._/-]+?)(?::[0-9]+(?:-[0-9]+)?)?`')
block_re = re.compile(r'<!--\s*paths-not-on-disk\b([\s\S]*?)-->')
bad = []
for f in sys.argv[1:]:
    text = open(f, encoding='utf-8').read()
    blocks = block_re.findall(text)
    exempt = [m.group(1) for m in (re.match(r'^\s*-\s+([A-Za-z0-9._/-]+)', l) for l in (blocks[0] if blocks else '').split('\n')) if m]
    prose = block_re.sub('', text)
    for p in sorted(set(cite.findall(prose))):
        if not os.path.exists(os.path.join(root, p)) and p not in exempt:
            bad.append(f'{f}: cited path not on disk and not registered: {p}')
    for p in exempt:
        if os.path.exists(os.path.join(root, p)):
            bad.append(f'{f}: registered as not-on-disk but exists: {p}')
for b in bad:
    print(b, file=sys.stderr)
sys.exit(1 if bad else 0)
PY

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  frontend/src/types/card.ts frontend/src/api/authoring.ts frontend/src/lib/cardRules.ts \
  frontend/src/pages frontend/src/components frontend/src/hooks \
  frontend/tests/deckImportRunner.test.ts frontend/tests/authoringRequestBody.test.ts frontend/tests/cardRulesWiring.test.ts \
  frontend/tests/deckImport.topic.test.ts frontend/tests/support \
  frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/eslint.config.js \
  frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.test.json frontend/tsconfig.node.json \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# The only top-level docs/*.md C11 may touch is the plan doc, and only by deleting its :229 bullet
# (':(glob)' keeps '*' from crossing '/', so docs/delivery/r16-issues/*.md is not matched).
top_docs="$(git diff --name-only "$mb" -- ':(glob)docs/*.md' | grep -vxF "$PD" || true)"
[ -z "$top_docs" ] || { echo "$top_docs" >&2; fail "a top-level docs/*.md other than the plan doc changed (out of C11 scope)"; }
pd_stat="$(git diff --numstat "$mb" -- "$PD" | awk '{print $1"\t"$2}')"
[ "$pd_stat" = "$(printf '0\t1')" ] || fail "plan doc numstat must be exactly 0 added / 1 deleted (found: '${pd_stat:-no diff}')"
pd_removed="$(git diff -U0 "$mb" -- "$PD" | grep '^-' | grep -v '^---' || true)"
[ "$pd_removed" = "-     - frontend/tests/deckImport.mcq.test.ts" ] \
  || { echo "$pd_removed" >&2; fail "plan doc: the one deleted line must be the deckImport.mcq.test.ts bullet (:229), nothing else"; }
# deckImport.test.ts keeps its it('…') title set byte-identical to the merge-base version (C00 §3.1: the
# cardArb branch / contentOf spread are the only edits; no case added, renamed or removed).
titles_base="$(git show "$mb:$DT" | grep -oE "^\s*it\('[^']*'" | sed -E 's/^\s*//' | sort)"
titles_head="$(grep -oE "^\s*it\('[^']*'" "$DT" | sed -E 's/^\s*//' | sort)"
[ "$titles_base" = "$titles_head" ] || { diff <(echo "$titles_base") <(echo "$titles_head") >&2 || true; fail "deckImport.test.ts it('…') title set differs from the base (C00 §3.1: no case added/renamed/removed)"; }
# Untracked scan is pathspec-scoped: the driver symlinks frontend/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- frontend/src frontend/tests docs; } | sort -u | grep -Ev '^(frontend/src/lib/deckImport\.ts|frontend/src/lib/mcqRules\.ts|frontend/src/types/mcq\.ts|frontend/src/lib/deckImportRunner\.ts|frontend/tests/deckImport\.mcq\.test\.ts|frontend/tests/deckImport\.test\.ts|docs/delivery-wave-1\.6-plan-2026-09-19\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C11 scope"; }

echo "C11 VERIFY OK"
