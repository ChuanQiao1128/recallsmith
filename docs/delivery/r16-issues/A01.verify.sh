#!/usr/bin/env bash
# A01 feature-flags — mechanical verification. cwd = worktree root.
#
# On the UNTOUCHED base tree (delivery/r16-a-home) this script exits non-zero at
# the first check: mobile/src/config/featureFlags.ts does not exist, so every
# grep in step 1 fails; step 2's statement-order check fails because
# forceUpdateGate.ts has no applyRemoteFeatures call; step 3 fails because
# remoteConfig.ts has no `features?:`; step 5 fails because vitest is handed a
# test file that is not on disk; step 6 fails because base has zero importers
# and exactly one is expected. Steps 4 and 7 are purely negative guards
# (suppressions, frozen files / scope / untouched suites) and pass on base by
# construction — they exist to catch the change overreaching, not to prove it.
#
# Checked 2026-09-19 against a conforming prototype: exits 0; moving the call
# below the early return or adding an eslint-disable line makes it exit 1.
set -euo pipefail

BASE_REF="${BASE_REF:-${BASE:-delivery/r16-a-home}}"   # driver exports BASE
FF=mobile/src/config/featureFlags.ts
GATE=mobile/src/config/forceUpdateGate.ts
RC=mobile/src/config/remoteConfig.ts
TEST=mobile/tests/unit/featureFlags.test.ts

fail() { echo "A01 VERIFY FAIL: $*" >&2; exit 1; }
need() { grep -qE -- "$2" "$1" || fail "$1 lacks /$2/"; }

# 1. featureFlags.ts exists and exports the contract.        (fails on base: file absent)
[ -f "$FF" ] || fail "$FF missing"
need "$FF" "^export type FeatureFlags\b"
need "$FF" "^export const DEFAULT_FEATURE_FLAGS\b"
need "$FF" "^export function getFeatureFlags\("
need "$FF" "^export function applyRemoteFeatures\("
need "$FF" "^export function subscribeFeatureFlags\("
need "$FF" "^export function useFeatureFlags\("
need "$FF" "useSyncExternalStore"
need "$FF" "^import type \{[^}]*RemoteConfig[^}]*\} from '\./remoteConfig';"
grep -qE "^import \{[^}]*\} from '\./remoteConfig'" "$FF" && fail "$FF imports a runtime value from ./remoteConfig (forceUpdateGate.test.tsx mocks that module entirely)"
need "$FF" "next cold start"
need "$FF" "Object\.freeze"
need "$FF" "Number\.isInteger"
# spec defaults spelled out somewhere in the store
need "$FF" "maxPerRun: 2\b"
need "$FF" "answerTelemetry: false\b"
need "$FF" "hidden: false\b"

# 2. forceUpdateGate.ts: import + one call, placed after the await and before the early return.
#                                                              (fails on base: no call)
need "$GATE" "^import \{ applyRemoteFeatures \} from '\./featureFlags';"
CALLS=$(grep -cE "^\s*applyRemoteFeatures\(config\);" "$GATE" || true)
[ "$CALLS" = "1" ] || fail "$GATE must contain exactly one 'applyRemoteFeatures(config);' statement (found $CALLS)"
L_AWAIT=$(grep -nE "const config = await loadRemoteConfig\(url\);" "$GATE" | cut -d: -f1 | head -1)
L_CALL=$(grep -nE "^\s*applyRemoteFeatures\(config\);" "$GATE" | cut -d: -f1 | head -1)
L_RET=$(grep -nE "if \(cancelled \|\| !config\) return;" "$GATE" | cut -d: -f1 | head -1)
[ -n "$L_AWAIT" ] && [ -n "$L_CALL" ] && [ -n "$L_RET" ] || fail "$GATE lost one of the anchor lines (await / call / early return)"
[ "$L_AWAIT" -lt "$L_CALL" ] && [ "$L_CALL" -lt "$L_RET" ] || fail "$GATE: applyRemoteFeatures(config) must sit after line $L_AWAIT (await) and before line $L_RET (early return); found at $L_CALL"
# the gate's own contract is untouched
need "$GATE" "if \(!ios\.forceUpdate\) return;"
need "$GATE" "useState<ForceUpdateGate \| null>\(null\)"

# 3. remoteConfig.ts: additive type only.                     (fails on base: no features?:)
need "$RC" "^export type RemoteFeatures\b"
need "$RC" "^export type McqRemoteFeatures\b"
need "$RC" "^export type PaywallRemoteFeatures\b"
need "$RC" "features\?: RemoteFeatures;"
need "$RC" "maxPerRun\?: number;"
need "$RC" "answerTelemetry\?: boolean;"
need "$RC" "hidden\?: boolean;"
need "$RC" "REMOTE_CONFIG_CACHE_KEY = 'recallsmith:remote-config:last-good:v1'"
for fn in fetchRemoteConfig loadCachedRemoteConfig loadRemoteConfig resolveIosUpdate getCurrentAppVersion compareSemver; do
  need "$RC" "^export (async )?function $fn\("
done

# 4. No suppressions in the scope files.                      (negative; passes on base)
for f in "$FF" "$GATE" "$RC" "$TEST"; do
  [ -f "$f" ] || continue
  grep -nE "@ts-ignore|@ts-expect-error|eslint-disable" "$f" && fail "suppression comment in $f"
done

# 5. Targeted tests + typecheck.                              (fails on base: featureFlags.test.ts absent)
[ -f "$TEST" ] || fail "$TEST missing"
need "$TEST" "useForceUpdateGate"
need "$TEST" "subscribeFeatureFlags"
need "$TEST" "useFeatureFlags"
need "$TEST" "applyRemoteFeatures\(null\)"
need "$TEST" "maxPerRun: 0\b"
grep -qE "\.(skip|only)\(" "$TEST" && fail "$TEST uses .skip/.only"
( cd mobile && npx vitest run tests/unit/featureFlags.test.ts tests/unit/forceUpdateGate.test.tsx tests/unit/remoteConfig.test.ts --reporter=dot )
( cd mobile && npm run test:typecheck )

# 6. No consumer wiring: the only importer of featureFlags under mobile/src + App.tsx is the gate.
#    Valid in A01's own worktree only: A06 (paywall, depends on A01) wires two
#    screens to this store later, so do not re-run this step on the integration
#    branch after A06 has merged.                               (fails on base: 0 importers, exactly one expected)
IMPORTERS=$(grep -rlE "from '(\./|\.\./)*(config/)?featureFlags'" mobile/src mobile/App.tsx | sort || true)
[ "$IMPORTERS" = "$GATE" ] || fail "featureFlags importers must be exactly [$GATE]; got: ${IMPORTERS:-<none>}"

# 7. Frozen files untouched; every changed/untracked path under mobile/src, mobile/tests, mobile/App.tsx is in scope.
#                                                              (negative; passes on base)
git rev-parse --verify -q "$BASE_REF" >/dev/null || fail "base ref $BASE_REF not found (set BASE_REF)"
MB=$(git merge-base HEAD "$BASE_REF")
for f in mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts; do
  N=$(git diff --numstat "$MB" -- "$f" | wc -l | tr -d ' ')
  [ "$N" = "0" ] || fail "frozen file changed: $f"
done
SCOPE_RE='^mobile/(src/config/remoteConfig\.ts|src/config/featureFlags\.ts|src/config/forceUpdateGate\.ts|tests/unit/featureFlags\.test\.ts)$'
CHANGED=$( { git diff --name-only "$MB" -- mobile/src mobile/tests mobile/App.tsx; git ls-files --others --exclude-standard -- mobile/src mobile/tests; } | sort -u )
OUT_OF_SCOPE=$(printf '%s\n' "$CHANGED" | grep -vE "$SCOPE_RE" | grep -v '^$' || true)
[ -z "$OUT_OF_SCOPE" ] || fail "out-of-scope mobile changes: $OUT_OF_SCOPE"
# the two pre-existing suites must be byte-identical to base
for f in mobile/tests/unit/forceUpdateGate.test.tsx mobile/tests/unit/remoteConfig.test.ts; do
  git diff --quiet "$MB" -- "$f" || fail "existing test modified: $f"
done

echo "A01 VERIFY OK"
