#!/usr/bin/env bash
# C12 — mcq-console-types-ui verify. cwd = worktree root. Re-runs the brief's
# five acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - frontend/tests/cardMcqConsole.test.tsx does not exist on base
#   (step 1 then also checks the C11 prerequisite: frontend/src/types/mcq.ts
#   must exist with `export interface McqBlob` / `export interface McqOption`,
#   because Card.mcq, the authoring params and the CardForm prop all import it)
# Step 2 (literal guards) would also fail on base: no `mcq` in types/card.ts,
# no `params.mcq` guard in authoring.ts, no badge, no fieldset, no `'mcq'` in
# the request-body test. Steps 3/4 are the lint+build / targeted-vitest gates
# and step 5 is a purely negative scope guard; both pass on base by design.
#
# Network: none. No npm install. Runtime ~60-90 s (lint + tsc -b + vite build
# dominate; the targeted vitest is a few seconds).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C12 VERIFY FAIL: $*" >&2; exit 1; }

CT=frontend/src/types/card.ts
AU=frontend/src/api/authoring.ts
CF=frontend/src/components/CardForm.tsx
CL=frontend/src/pages/CardListPage.tsx
EP=frontend/src/pages/EditCardPage.tsx
RB=frontend/tests/authoringRequestBody.test.ts
NT=frontend/tests/cardMcqConsole.test.tsx
MQ=frontend/src/types/mcq.ts

mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C11 prerequisite)"
[ -f "$NT" ] || fail "$NT does not exist (base tree fails here)"
[ -f "$MQ" ] || fail "$MQ is missing — C11 must be merged before C12 (McqBlob is imported by every scope file)"
grep -Fq "export interface McqBlob" "$MQ"   || fail "$MQ lacks 'export interface McqBlob' (C11 incomplete)"
grep -Fq "export interface McqOption" "$MQ" || fail "$MQ lacks 'export interface McqOption' (C11 incomplete)"
for f in "$CT" "$AU" "$CF" "$CL" "$EP" "$RB"; do
  [ -f "$f" ] || fail "$f does not exist"
done

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. types/card.ts — optional key, type-only import from ./mcq
grep -Fq "import type { McqBlob } from './mcq';" "$CT" || fail "types/card.ts lacks: import type { McqBlob } from './mcq';"
grep -Fq "mcq?: McqBlob | null;" "$CT"                 || fail "types/card.ts lacks: mcq?: McqBlob | null;"
if grep -Eq "^\s*mcq: McqBlob" "$CT"; then
  fail "types/card.ts declares mcq as REQUIRED — it must be optional (fixtures build Card literals without it)"
fi

# 2b. authoring.ts — params on both functions, the exact guard twice, null never coerced, no new export
grep -Fq "import type { McqBlob } from '../types/mcq';" "$AU" || fail "authoring.ts lacks: import type { McqBlob } from '../types/mcq';"
n_param="$(grep -cF "mcq?: McqBlob | null;" "$AU" || true)"
[ "$n_param" -eq 2 ] || fail "authoring.ts: 'mcq?: McqBlob | null;' must appear exactly twice (createCard + updateCard params), found $n_param"
n_guard="$(grep -cF "if (params.mcq !== undefined) body.mcq = params.mcq;" "$AU" || true)"
[ "$n_guard" -eq 2 ] || fail "authoring.ts: the guard 'if (params.mcq !== undefined) body.mcq = params.mcq;' must appear exactly twice, found $n_guard"
if grep -Eq "params\.mcq (\?\?|\|\|)|if \(params\.mcq\)|params\.mcq !?= null|params\.mcq !== null" "$AU"; then
  grep -En "params\.mcq (\?\?|\|\|)|if \(params\.mcq\)|params\.mcq !?= null|params\.mcq !== null" "$AU" >&2 || true
  fail "authoring.ts coerces or drops an explicit mcq: null — only the !== undefined guard is allowed"
fi
exp_base="$(git show "$mb:$AU" | grep -c '^export ' || true)"
exp_now="$(grep -c '^export ' "$AU" || true)"
[ "$exp_now" -eq "$exp_base" ] || fail "authoring.ts export count changed ($exp_base -> $exp_now); tests/apiSurfaceCensus.test.ts pins the surface"

# 2c. CardListPage.tsx — badge in the Rarity cell, column count untouched
grep -Fq 'data-testid="card-mcq-badge"' "$CL" || fail "CardListPage.tsx lacks data-testid=\"card-mcq-badge\""
grep -Fq '>MCQ</span>' "$CL"                  || fail "CardListPage.tsx: the badge text must be exactly MCQ with </span> on the same line"
grep -Fq 'card.mcq ?' "$CL"                   || fail "CardListPage.tsx: the badge must be gated on 'card.mcq ?' (truthiness: null and absent mean no badge)"
grep -Fq 'colSpan={8}' "$CL"                  || fail "CardListPage.tsx: colSpan={8} changed — no new column"
n_th="$(grep -c '<th ' "$CL" || true)"
[ "$n_th" -eq 8 ] || fail "CardListPage.tsx: expected 8 <th> lines, found $n_th — no new column"
grep -Fq "import { RarityBadge } from '../components/RarityBadge';" "$CL" || fail "CardListPage.tsx: RarityBadge import changed"

# 2d. CardForm.tsx — read-only fieldset, values/rules/exports untouched, no validation import
grep -Fq "import type { McqBlob } from '../types/mcq';" "$CF" || fail "CardForm.tsx lacks: import type { McqBlob } from '../types/mcq';"
grep -Fq "mcq?: McqBlob | null;" "$CF"                        || fail "CardForm.tsx lacks the optional prop mcq?: McqBlob | null;"
n_fs="$(grep -cF 'data-testid="card-form-mcq"' "$CF" || true)"
[ "$n_fs" -eq 1 ] || fail "CardForm.tsx: data-testid=\"card-form-mcq\" must appear exactly once, found $n_fs"
for sym in 'Multiple choice</legend>' 'data-testid="card-form-mcq-required"' 'data-testid="card-form-mcq-qualifier"' \
           'card-form-mcq-option-' 'data-testid="card-form-mcq-correct"' '<fieldset' '</fieldset>'; do
  grep -Fq "$sym" "$CF" || fail "CardForm.tsx lacks: $sym"
done
if awk '/^export interface CardFormValues \{/{f=1} f{print} f&&/^\}/{exit}' "$CF" | grep -q "mcq"; then
  fail "CardForm.tsx: CardFormValues must not gain an mcq field — the form never edits the blob"
fi
if awk '/data-testid="card-form-mcq"/{f=1} f{print} f&&/<\/fieldset>/{exit}' "$CF" | grep -Eq "<input|<textarea|<select|<button"; then
  fail "CardForm.tsx: the MCQ fieldset contains a form control — it must be read-only"
fi
if grep -q "mcqRules" "$CF"; then
  grep -n "mcqRules" "$CF" >&2 || true
  fail "CardForm.tsx must not import mcqRules — the panel renders, it never validates"
fi
if [ -n "$(git diff -U0 "$mb" HEAD -- "$CF" | grep '^[-+]' | grep -v '^[-+][-+]' | grep -E "cardRules|MAX_DIFFICULTY|MAX_UID_LENGTH|MIN_DIFFICULTY|hasContent|isValidDifficulty|isValidStableUid" || true)" ]; then
  fail "CardForm.tsx: a line mentioning the cardRules import surface changed — tests/cardRulesWiring.test.ts pins the consumer table"
fi
exp_base="$(git show "$mb:$CF" | grep -c '^export ' || true)"
exp_now="$(grep -c '^export ' "$CF" || true)"
[ "$exp_now" -eq "$exp_base" ] || fail "CardForm.tsx export count changed ($exp_base -> $exp_now); react-refresh/only-export-components"

# 2e. EditCardPage.tsx — passes the blob down, never sends it up
grep -Fq 'mcq={card.mcq ?? null}' "$EP" || fail "EditCardPage.tsx lacks: mcq={card.mcq ?? null} on the <CardForm/> mount"
if grep -Eq "^\s*mcq:" "$EP"; then
  grep -En "^\s*mcq:" "$EP" >&2 || true
  fail "EditCardPage.tsx: the submit literal must never carry an mcq key"
fi

# 2f. authoringRequestBody.test.ts — mcq in both sends objects, both absent lists, the null case
n_abs="$(grep -cF "'mcq'" "$RB" || true)"
[ "$n_abs" -ge 2 ] || fail "authoringRequestBody.test.ts: 'mcq' must be in both absent lists (found $n_abs occurrences)"
n_send="$(grep -cF "mcq: MCQ" "$RB" || true)"
[ "$n_send" -ge 4 ] || fail "authoringRequestBody.test.ts: 'mcq: MCQ' must be in both sends calls and both toMatchObject literals (found $n_send)"
grep -Fq "import type { McqBlob } from '../src/types/mcq';" "$RB" || fail "authoringRequestBody.test.ts: the MCQ fixture must be typed as McqBlob"
grep -Fq "mcq: null" "$RB"           || fail "authoringRequestBody.test.ts lacks a call with mcq: null"
grep -Fq ".mcq).toBeNull()" "$RB"    || fail "authoringRequestBody.test.ts must assert body.mcq is null"
grep -Fq "'mcq')).toBe(true)" "$RB"  || fail "authoringRequestBody.test.ts must assert Object.hasOwn(body, 'mcq') is true"
for s in \
  'sends every optional field that was supplied' \
  'leaves out what was not supplied, rather than sending undefined' \
  'omits the fields the caller left alone' \
  'sends no expectedVersion at all when the caller did not supply one' \
  'sends mcq: null as an own key with value null, which is how a clear reaches the server'; do
  grep -Fq "it('$s'" "$RB" || fail "missing authoringRequestBody test case: $s"
done
[ "$(grep -cF "it('sends every optional field that was supplied'" "$RB" || true)" -eq 2 ] \
  || fail "authoringRequestBody.test.ts: the two 'sends every optional field' cases must both survive"

# 2g. cardMcqConsole.test.tsx — jsdom, harness, the six cases, the assertions that matter
[ "$(head -1 "$NT")" = "// @vitest-environment jsdom" ] || fail "cardMcqConsole.test.tsx: line 1 must be // @vitest-environment jsdom"
for sym in "vi.mock('../src/api/authoring'" "await import('../src/pages/CardListPage')" "await import('../src/pages/EditCardPage')" \
           "await import('../src/pages/NewCardPage')" "import type { McqBlob } from '../src/types/mcq';" \
           "card-mcq-badge" "card-form-mcq" "'mcq')).toBe(false)" "Object.hasOwn(" "renderWithQuery" "MemoryRouter"; do
  grep -Fq "$sym" "$NT" || fail "cardMcqConsole.test.tsx lacks: $sym"
done
for s in \
  'shows an MCQ badge in the Rarity cell of a card that carries mcq' \
  'shows no MCQ badge on a Q/A card, whether mcq is null or absent' \
  'renders the read-only MCQ panel on the edit page when the card carries mcq' \
  'renders no MCQ panel on the edit page for a Q/A card' \
  'renders no MCQ panel on the new-card page' \
  'saving an MCQ card from the edit page sends no mcq key'; do
  grep -Fq "it('$s'" "$NT" || fail "missing cardMcqConsole test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$NT" || true)" -ge 6 ] || fail "cardMcqConsole.test.tsx needs >= 6 it() blocks"
if grep -Eiq "examtopics|question #[0-9]" "$NT" "$RB" "$CF"; then
  fail "exam-dump marker text found in a scope file — fixtures must use neutral placeholder text"
fi
if grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$CT" "$AU" "$CF" "$CL" "$EP" "$RB" "$NT"; then
  grep -En "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$CT" "$AU" "$CF" "$CL" "$EP" "$RB" "$NT" >&2 || true
  fail "test gutting / suppression found"
fi
if grep -Eq ": any\b|as any\b|<any>" "$NT" "$RB"; then
  fail "explicit any in a test file — eslint no-explicit-any is an error under npm run lint"
fi

# ── 3. Lint + typecheck/build (tsc -b covers src/ and tests/) ──────────────
echo "[3/5] npm run lint && npm run build"
( cd frontend && npm run lint )  || fail "eslint failed"
( cd frontend && npm run build ) || fail "tsc -b / vite build failed"

# ── 4. Targeted vitest (new + edited + the census fences + neighbours) ─────
echo "[4/5] vitest cardMcqConsole / authoringRequestBody / fences"
( cd frontend && npx vitest run \
    tests/cardMcqConsole.test.tsx \
    tests/authoringRequestBody.test.ts \
    tests/cardEntryDefects.test.tsx \
    tests/editCardVersionConflict.test.tsx \
    tests/cardFormHints.test.tsx \
    tests/cardRuleDivergence.test.tsx \
    tests/cardListPageDelete.test.tsx \
    tests/cardListPageQueryWiring.test.tsx \
    tests/deckImportRunner.test.ts \
    tests/cardRulesWiring.test.ts \
    tests/apiSurfaceCensus.test.ts \
    tests/consoleDirectoryLayout.test.ts \
    tests/hookWiring.test.ts \
    tests/uiLanguage.test.ts \
    tests/singleTheme.test.ts \
    tests/typeGateFileSet2.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
git diff --quiet "$mb" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "frozen mobile file modified"
# OTA guard (C00 §0): a console issue never touches the mobile manifests or dependency set either.
git diff --quiet "$mb" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  || fail "mobile/package.json / package-lock.json / app.json / eas.json changed (OTA on runtimeVersion 1.6.0 forbids it)"
git diff --quiet "$mb" HEAD -- frontend/package.json frontend/package-lock.json frontend/src/types/mcq.ts \
  frontend/src/lib frontend/src/hooks frontend/src/pages/NewCardPage.tsx frontend/src/pages/ContentIntelligencePage.tsx \
  || fail "out-of-scope frontend file modified (C11/C13 files, deps, lib/, hooks/, NewCardPage)"
# Untracked scan is pathspec-scoped: the driver symlinks frontend/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- frontend/src frontend/tests docs; } \
  | sort -u \
  | grep -Ev '^(frontend/src/types/card\.ts|frontend/src/api/authoring\.ts|frontend/src/components/CardForm\.tsx|frontend/src/pages/CardListPage\.tsx|frontend/src/pages/EditCardPage\.tsx|frontend/tests/authoringRequestBody\.test\.ts|frontend/tests/cardMcqConsole\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C12 scope"; }

echo "C12 VERIFY OK"
