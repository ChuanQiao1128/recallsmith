#!/usr/bin/env bash
# C06 — topic-console verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - frontend/tests/deckImport.topic.test.ts does not exist on base
# Step 2 (literal guards) would also fail on base: none of the seven scope files
# mentions `topic` at all (grep -c topic over them prints 0 on delivery/r16-c-economy).
# Step 3 is the frontend lint + `tsc -b && vite build`, step 4 the targeted vitest
# run (the four deckImport/authoring files + the four census tests a careless
# edit trips), step 5 a purely negative scope + frozen guard; all pass on base by
# design and are never reached there.
#
# Network: none. No npm install. Runtime ~15 s (lint ~3 s, build ~5 s, vitest ~2 s).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C06 VERIFY FAIL: $*" >&2; exit 1; }

DI=frontend/src/lib/deckImport.ts
RN=frontend/src/lib/deckImportRunner.ts
CT=frontend/src/types/card.ts
AU=frontend/src/api/authoring.ts
NT=frontend/tests/deckImport.topic.test.ts
DT=frontend/tests/deckImport.test.ts
RB=frontend/tests/authoringRequestBody.test.ts
RT=frontend/tests/deckImportRunner.test.ts

# first line number of a fixed string in a file ("" when absent)
lineof() { grep -nF -- "$1" "$2" | head -1 | cut -d: -f1 || true; }

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist"
[ -f "$NT" ] || fail "$NT does not exist (base tree fails here)"
for f in "$DI" "$RN" "$CT" "$AU" "$DT" "$RB" "$RT"; do
  [ -f "$f" ] || fail "$f is missing (renamed or deleted — out of scope)"
done

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. deckImport.ts — marker, limit, types, unions
grep -Fq 'const TOPIC_MARKER = /^TOPIC:(.*)$/;' "$DI" || fail "deckImport.ts: TOPIC_MARKER literal missing/changed (C00 §2.8.2)"
grep -Fq 'export const TOPIC_MAX_LENGTH = 80;' "$DI"   || fail "deckImport.ts: TOPIC_MAX_LENGTH literal missing/changed"
grep -Fq '  topic?: string;' "$DI"                     || fail "deckImport.ts: DeckCardContent lacks 'topic?: string;'"
if grep -Eq 'topic\?: string \| null' "$DI"; then
  fail "deckImport.ts: DeckCardContent.topic must be absent-or-string, never null (that shape belongs to types/card.ts only)"
fi
grep -Fq "  | 'BAD_TOPIC'" "$DI"       || fail "deckImport.ts: ImportIssueCode lacks 'BAD_TOPIC'"
grep -Fq "  | 'DUPLICATE_TOPIC'" "$DI" || fail "deckImport.ts: ImportIssueCode lacks 'DUPLICATE_TOPIC'"
grep -Fq "  | 'topic';" "$DI"          || fail "deckImport.ts: ComparableField must end with | 'topic';"
last_field="$(sed -n '/^const COMPARABLE_FIELDS/,/^\];/p' "$DI" | grep -E "^[[:space:]]+'[A-Za-z]+',?[[:space:]]*$" | tail -1 | tr -d " ,'" || true)"
[ "$last_field" = "topic" ] || fail "deckImport.ts: COMPARABLE_FIELDS must list 'topic' LAST (found last entry: '${last_field}')"
# 2b. lexer placement: after the `if (!draft) {` stray guard, before Q:
d_line="$(lineof 'if (!draft) {' "$DI")"
t_line="$(lineof 'TOPIC_MARKER.exec(raw)' "$DI")"
q_line="$(lineof 'QUESTION_MARKER.exec(raw)' "$DI")"
[ -n "$t_line" ] || fail "deckImport.ts: the lexer never evaluates TOPIC_MARKER.exec(raw)"
[ -n "$d_line" ] && [ -n "$q_line" ] || fail "deckImport.ts: the stray-text guard or the Q: branch moved — out of scope"
[ "$d_line" -lt "$t_line" ] || fail "deckImport.ts: TOPIC: branch must come AFTER the if (!draft) guard (a TOPIC: before any card is TEXT_BEFORE_CARD)"
[ "$t_line" -lt "$q_line" ] || fail "deckImport.ts: TOPIC: branch must come BEFORE the Q: branch (C00 §2.8.2)"
# 2c. messages + drop/keep semantics
grep -Fq 'has an empty TOPIC: line.' "$DI"                            || fail "deckImport.ts: empty-topic BAD_TOPIC message missing"
grep -Fq 'is longer than ${TOPIC_MAX_LENGTH} characters.' "$DI"       || fail "deckImport.ts: over-long BAD_TOPIC message missing"
grep -Fq 'repeats the TOPIC: line; the first one wins.' "$DI"         || fail "deckImport.ts: DUPLICATE_TOPIC message missing"
grep -Fq '|| d.topicInvalid) return;' "$DI"                           || fail "deckImport.ts: finishCard must drop a BAD_TOPIC card (|| d.topicInvalid) return;)"
grep -Fq '...(d.topic !== null ? { topic: d.topic } : {}),' "$DI"     || fail "deckImport.ts: card literal must spread topic conditionally (absent, never null)"
# 2d. serialize: TOPIC: between the header push and Q:
grep -Fq 'out.push(`TOPIC: ${card.topic}`);' "$DI" || fail "deckImport.ts: serializeDeckMarkdown does not emit TOPIC:"
h_line="$(lineof 'out.push(`## ${card.stableUid} | d${card.difficulty}`);' "$DI")"
tp_line="$(lineof 'out.push(`TOPIC: ${card.topic}`);' "$DI")"
qq_line="$(lineof "out.push('Q:');" "$DI")"
[ -n "$h_line" ] && [ -n "$qq_line" ] || fail "deckImport.ts: serializeDeckMarkdown header/Q: pushes moved — out of scope"
[ "$h_line" -lt "$tp_line" ] && [ "$tp_line" -lt "$qq_line" ] || fail "deckImport.ts: TOPIC: must be emitted after the card header and before Q:"
# 2e. no MCQ pre-emption (C11 territory)
if grep -Eq 'OPT_MARKER|WHY_MARKER|QUALIFIER_MARKER|McqBlob|mcq' "$DI" "$RN" "$CT" "$AU"; then
  grep -En 'OPT_MARKER|WHY_MARKER|QUALIFIER_MARKER|McqBlob|mcq' "$DI" "$RN" "$CT" "$AU" >&2 || true
  fail "MCQ work found in C06 scope — that is C11/C12"
fi
# 2f. runner
grep -Fq 'topic: optionalText(card.topic ?? null),' "$RN"        || fail "deckImportRunner.ts: createParamsFor does not send topic"
grep -Fq 'topic: optionalText(action.card.topic ?? null),' "$RN" || fail "deckImportRunner.ts: updateParamsFor does not send topic"
[ "$(grep -c '^  topic?: string;$' "$RN" || true)" -eq 2 ]      || fail "deckImportRunner.ts: CreateCardParams and UpdateCardParams must each declare 'topic?: string;'"
# 2g. types/card.ts — after codeLanguage, before revision
grep -Fq '  topic?: string | null;' "$CT" || fail "types/card.ts: Card lacks 'topic?: string | null;'"
cl_line="$(lineof 'codeLanguage?: string | null;' "$CT")"
tc_line="$(lineof 'topic?: string | null;' "$CT")"
rv_line="$(lineof 'revision?: number | null;' "$CT")"
[ "$cl_line" -lt "$tc_line" ] && [ "$tc_line" -lt "$rv_line" ] || fail "types/card.ts: topic must sit between codeLanguage and revision"
# 2h. authoring.ts — params + body guards, twice
[ "$(grep -c 'if (params.topic !== undefined) body.topic = params.topic;' "$AU" || true)" -eq 2 ] \
  || fail "authoring.ts: createCard and updateCard must each guard-add body.topic"
[ "$(grep -c '^  topic?: string;$' "$AU" || true)" -eq 2 ] || fail "authoring.ts: createCard and updateCard params must each declare 'topic?: string;'"
# 2i. new test file — property harness + the 14 contract cases
grep -q "from 'fast-check'" "$NT" || fail "deckImport.topic.test.ts must use fast-check (C00 §3.3)"
grep -q "fc.assert(" "$NT"        || fail "deckImport.topic.test.ts has no fc.assert property"
grep -q "TOPIC_MAX_LENGTH" "$NT"  || fail "deckImport.topic.test.ts must import TOPIC_MAX_LENGTH"
grep -q "runImport" "$NT"         || fail "deckImport.topic.test.ts must exercise runImport"
for s in \
  'reads a TOPIC: line into card.topic, trimmed' \
  'leaves topic absent, not null, when there is no TOPIC: line' \
  'accepts TOPIC: anywhere inside the card without opening a section' \
  'flags an empty TOPIC: line as BAD_TOPIC and drops the card' \
  'flags a topic longer than TOPIC_MAX_LENGTH as BAD_TOPIC and accepts one exactly at the limit' \
  'keeps the first TOPIC: and reports the second as DUPLICATE_TOPIC' \
  'reports a TOPIC: line before any card as TEXT_BEFORE_CARD' \
  'reports text after TOPIC: and before the first section as TEXT_BEFORE_SECTION' \
  'emits TOPIC: directly under the card header and before Q:' \
  'round trips any topic through serialize and parse' \
  'lists topic last in changedFields' \
  'treats a server null topic and an absent TOPIC: line as unchanged' \
  'plans an update with changedFields [topic] when only the topic changed' \
  'sends topic on create and update, and an empty string when the file has none'; do
  grep -Fq "it('$s'" "$NT" || fail "missing deckImport.topic test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$NT" || true)" -ge 14 ] || fail "deckImport.topic.test.ts needs >= 14 it() blocks"
# 2j. deckImport.test.ts — surgical edits present, fixture and titles intact
grep -Fq 'topic: card.topic ?? null,' "$DT"                                  || fail "deckImport.test.ts: toExistingCard must carry topic: card.topic ?? null (idempotence property)"
grep -Fq '...(card.topic !== undefined ? { topic: card.topic } : {}),' "$DT" || fail "deckImport.test.ts: contentOf must spread topic only when defined"
grep -Fq 'topic: fc.option(topicArb, { nil: undefined }),' "$DT"             || fail "deckImport.test.ts: cardArb record lacks the topic branch"
grep -Fq '...(r.topic !== undefined ? { topic: r.topic } : {}),' "$DT"       || fail "deckImport.test.ts: cardArb map must spread topic only when defined"
if sed -n "/it('reads every card field'/,/^  });/p" "$DT" | grep -q 'topic'; then
  fail "deckImport.test.ts: the exact-key fixture (reads every card field) must stay byte-identical — no topic key"
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
# 2k. authoringRequestBody.test.ts — topic on the wire and in both absent lists
grep -Fq "'revision', 'topic']" "$RB"  || fail "authoringRequestBody.test.ts: createCard absent list must end with 'topic'"
grep -Fq "'stableUid', 'topic']" "$RB" || fail "authoringRequestBody.test.ts: updateCard absent list must end with 'topic'"
[ "$(grep -c "topic: 'Networking'," "$RB" || true)" -ge 4 ] || fail "authoringRequestBody.test.ts: topic must appear in both inputs and both expectations of the 'sends every optional field' cases"
for s in \
  'sends every optional field that was supplied' \
  'leaves out what was not supplied, rather than sending undefined' \
  'omits the fields the caller left alone' \
  'sends no expectedVersion at all when the caller did not supply one'; do
  grep -Fq "it('$s'" "$RB" || fail "authoringRequestBody.test.ts: existing case renamed/removed: $s"
done
# 2l. suppression / gutting
if grep -Eq '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "$DI" "$RN" "$CT" "$AU" "$NT" "$DT" "$RB"; then
  grep -En '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "$DI" "$RN" "$CT" "$AU" "$NT" "$DT" "$RB" >&2 || true
  fail "test gutting / suppression found"
fi

# ── 3. Lint + build (tsc -b type-checks tests/ too) ────────────────────────
echo "[3/5] npm run lint && npm run build"
( cd frontend && npm run lint )  || fail "eslint failed"
( cd frontend && npm run build ) || fail "tsc -b && vite build failed"

# ── 4. Targeted vitest ─────────────────────────────────────────────────────
echo "[4/5] vitest deckImport.topic / deckImport / authoringRequestBody / deckImportRunner + census"
( cd frontend && npx vitest run \
    tests/deckImport.topic.test.ts \
    tests/deckImport.test.ts \
    tests/authoringRequestBody.test.ts \
    tests/deckImportRunner.test.ts \
    tests/uiLanguage.test.ts \
    tests/cardRulesWiring.test.ts \
    tests/apiSurfaceCensus.test.ts \
    tests/typeGateFileSet2.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  frontend/src/lib/cardRules.ts frontend/tests/deckImportRunner.test.ts \
  frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/eslint.config.js \
  frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.test.json frontend/tsconfig.node.json \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# C06 edits no top-level docs/*.md (docsPaths.test.ts territory; ':(glob)' keeps '*' from crossing '/').
top_docs="$(git diff --name-only "$mb" -- ':(glob)docs/*.md' || true)"
[ -z "$top_docs" ] || { echo "$top_docs" >&2; fail "a top-level docs/*.md changed (out of C06 scope)"; }
# Untracked scan is pathspec-scoped: the driver symlinks frontend/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- frontend/src frontend/tests docs; } | sort -u | grep -Ev '^(frontend/src/lib/deckImport\.ts|frontend/src/lib/deckImportRunner\.ts|frontend/src/types/card\.ts|frontend/src/api/authoring\.ts|frontend/tests/deckImport\.test\.ts|frontend/tests/authoringRequestBody\.test\.ts|frontend/tests/deckImport\.topic\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C06 scope"; }

echo "C06 VERIFY OK"
