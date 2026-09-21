#!/usr/bin/env bash
# C14 — event-envelope-client-features verify. cwd = worktree root. Re-runs the
# brief's five acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/sync/clientCapabilities.ts,
#     mobile/tests/unit/clientCapabilities.test.ts,
#     mobile/tests/unit/progressSyncEnvelopeBytes.test.ts and
#     src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsClientFeaturesTests.cs
#     do not exist on base
#   (step 1 then also checks the C10 / C13 prerequisites: ProgressEvents.cs must
#   already carry C10's `card_format` fragment and BuildIngestSql, and C13's
#   snowflake/001 must already project client_features / update_id / answer_mode,
#   because C00 §4 orders C10 → C13 → C14 and C00 §6 #9 makes C14 grep, not edit,
#   the Snowflake expression)
# Step 2 (literal guards: the C00 §2.13 signatures, the four signed lines at their
# anchors in the frozen progressSync.ts, the two payload keys after card_format,
# the Batch() signature, the Fact names, the it('…') titles) would also fail on
# base. Step 3 is tsc, step 4 the targeted vitest + `dotnet test --filter`
# (Docker required), step 5 the scope + frozen (numstat 4/0) + OTA guard.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (C00 §0).
#
# Network: none. No npm install, no dotnet restore (implicit restore hits the
# local NuGet cache only), no expo, no prebuild. Runtime: mobile part ≈ 1–2 min
# (tsc + 7 suites); server part single-digit minutes (dotnet build + one
# Testcontainers Postgres start + the log-probe facts that ALTER SYSTEM/reload).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C14 VERIFY FAIL: $*" >&2; exit 1; }

CAP=mobile/src/sync/clientCapabilities.ts
PS=mobile/src/sync/progressSync.ts
CT=mobile/tests/unit/clientCapabilities.test.ts
ET=mobile/tests/unit/progressSyncEnvelopeBytes.test.ts
PE=src_C/Vpc/Runtime/ProgressEvents.cs
SST=src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsSingleStatementTests.cs
CFT=src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsClientFeaturesTests.cs
CFMT=src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsCardFormatTests.cs
PIT=src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsIntegrationTests.cs
ITB=src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs
SQL=snowflake/001_content_intelligence_setup.sql
MIG19=src_C/Vpc/Db/Migrations/019_cards_mcq.sql

# The four signed lines (C00 §0 #2, §2.13), byte for byte.
L1="import { getClientCapabilities } from './clientCapabilities';"
L2="  const caps = await getClientCapabilities();"
L3="        clientFeatures: caps.clientFeatures,"
L4="        updateId: caps.updateId,"
# Their anchors on the frozen file (the line each one must directly follow).
A1="import { invalidateDrawStateCache } from '../features/gacha/draw/drawStateCache';"
A2="  const deviceId = await getDeviceId();"
A3="        clientVersion: getClientVersion(),"
A4="        events: batch.map((ev: any) => ({"
# The only pre-existing line of ProgressEventsSingleStatementTests.cs that may change.
SST_OLD='    string? clientPlatform = "ios")'

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C10 / C13 prerequisites)"
for f in "$CAP" "$CT" "$ET" "$CFT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$PS" "$PE" "$SST" "$SQL"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
[ -f "$MIG19" ] || fail "$MIG19 is missing — C08 (and C10, C13) must be merged before C14 (C00 §4)"
[ -f "$CFMT" ]  || fail "$CFMT is missing — C10 must be merged before C14 (C00 §4)"
for sym in "string BuildIngestSql(bool withCardFormat)" \
           "BuildIngestSql(withCardFormat: true)" \
           "BuildIngestSql(withCardFormat: false)" \
           "'card_format', case when c.mcq is not null then 'mcq' else 'qa' end" \
           "from ins{cardFormatJoin}"; do
  grep -Fq -- "$sym" "$PE" || fail "ProgressEvents.cs lacks C10's: $sym (C10 must be merged before C14)"
done
for sym in "as client_features," "as update_id," "as answer_mode," "array_contains('mcq'::variant"; do
  grep -Fq -- "$sym" "$SQL" || fail "snowflake/001 lacks C13's: $sym (C13 must be merged before C14; C14 never edits snowflake/, C00 §6 #9)"
done

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. clientCapabilities.ts — the C00 §2.13 signatures + the pure normaliser, one dynamic import, no static one
for sym in "export type ClientCapabilities = { clientFeatures?: string[]; updateId?: string };" \
           "export const CLIENT_FEATURES: readonly string[] = [];" \
           "export async function getClientCapabilities(): Promise<ClientCapabilities>" \
           "export function resetClientCapabilitiesForTests(): void" \
           "export function normalizeClientFeatures(input: readonly unknown[]): string[]" \
           "export const MAX_CLIENT_FEATURES = 16;" \
           "export const MAX_UPDATE_ID_LENGTH = 64;" \
           '^[a-z][a-z0-9_-]{0,31}$' \
           "import('expo-updates')"; do
  grep -Fq -- "$sym" "$CAP" || fail "clientCapabilities.ts lacks: $sym"
done
[ "$(grep -Fc "'expo-updates'" "$CAP")" -eq 1 ] || fail "clientCapabilities.ts must name 'expo-updates' exactly once (inside the dynamic import())"
if grep -Eq "from 'expo-updates'|require\(|from 'react|AsyncStorage|expo-constants" "$CAP"; then
  grep -En "from 'expo-updates'|require\(|from 'react|AsyncStorage|expo-constants" "$CAP" >&2 || true
  fail "clientCapabilities.ts: no static expo-updates import, no require(), no react / storage / constants imports (C00 §2.13, §6 #17)"
fi
# 2b. progressSync.ts — 1868 + 4 lines; each signed line exactly once, directly after its anchor; nothing else new
[ "$(wc -l < "$PS" | tr -d ' ')" = "1872" ] || fail "progressSync.ts must be exactly 1872 lines (1868 + the four signed lines)"
for l in "$L1" "$L2" "$L3" "$L4"; do
  [ "$(grep -Fxc -- "$l" "$PS" || true)" = "1" ] || fail "progressSync.ts must contain exactly once, byte for byte: $l"
done
[ "$(grep -Fxc -- "$A1" "$PS" || true)" = "1" ] || fail "progressSync.ts anchor missing: $A1"
[ "$(grep -Fxc -- "$A2" "$PS" || true)" = "1" ] || fail "progressSync.ts anchor missing: $A2"
[ "$(grep -Fxc -- "$A3" "$PS" || true)" = "1" ] || fail "progressSync.ts anchor missing: $A3"
[ "$(grep -Fxc -- "$A4" "$PS" || true)" = "1" ] || fail "progressSync.ts anchor missing: $A4"
n1="$(grep -Fxn -- "$A1" "$PS" | cut -d: -f1)"; [ "$(sed -n "$((n1 + 1))p" "$PS")" = "$L1" ] || fail "progressSync.ts: the import must be the line directly after: $A1"
n2="$(grep -Fxn -- "$A2" "$PS" | cut -d: -f1)"; [ "$(sed -n "$((n2 + 1))p" "$PS")" = "$L2" ] || fail "progressSync.ts: 'const caps' must be the line directly after: $A2"
n3="$(grep -Fxn -- "$A3" "$PS" | cut -d: -f1)"
[ "$(sed -n "$((n3 + 1))p" "$PS")" = "$L3" ] || fail "progressSync.ts: 'clientFeatures: caps.clientFeatures,' must be the line directly after: $A3"
[ "$(sed -n "$((n3 + 2))p" "$PS")" = "$L4" ] || fail "progressSync.ts: 'updateId: caps.updateId,' must be the line directly after 'clientFeatures: caps.clientFeatures,'"
[ "$(sed -n "$((n3 + 3))p" "$PS")" = "$A4" ] || fail "progressSync.ts: 'events: batch.map(' must directly follow 'updateId: caps.updateId,' (no fifth line)"
[ "$(grep -c 'clientCapabilities' "$PS" || true)" -eq 1 ] || fail "progressSync.ts may mention clientCapabilities only in the one import line"
grep -q 'expo-updates' "$PS" && fail "progressSync.ts must not mention expo-updates (the read lives in clientCapabilities.ts)"
# 2c. ProgressEvents.cs — envelope read, helpers, the two parameters after userHashParam, the two payload keys after card_format
for sym in 'TryGetProperty("clientFeatures"' \
           'TryGetProperty("updateId"' \
           "private static string? ReadClientFeatures(JsonElement body)" \
           "private static string? ReadUpdateId(JsonElement body)" \
           "MaxClientFeatures = 16" \
           "MaxUpdateIdLength = 64" \
           '^[a-z][a-z0-9_-]{0,31}$' \
           "JsonValueKind.Array" \
           "SortedSet<string>(StringComparer.Ordinal)" \
           "var featuresParam = P(ref idx);" \
           "parameters.Add(clientFeatures);" \
           "var updateIdParam = P(ref idx);" \
           "parameters.Add(updateId);" \
           "'deck_version', deck_version{cardFormatKey}," \
           "'client_features', {featuresParam}::jsonb," \
           "'update_id', {updateIdParam}::text" \
           "insert into users (user_sub, email, last_seen_at, last_platform, last_version, last_device_id)" \
           "jsonb_strip_nulls(jsonb_build_object(" \
           "on conflict (event_id) do nothing"; do
  grep -Fq -- "$sym" "$PE" || fail "ProgressEvents.cs lacks: $sym"
done
for sym in "'client_features', {featuresParam}::jsonb," "'update_id', {updateIdParam}::text" "var featuresParam = P(ref idx);" "var updateIdParam = P(ref idx);"; do
  [ "$(grep -Fc -- "$sym" "$PE")" -eq 1 ] || fail "ProgressEvents.cs must contain exactly once: $sym"
done
pu="$(grep -Fn 'parameters.Add(userIdHash);' "$PE" | head -1 | cut -d: -f1)"
pf="$(grep -Fn 'var featuresParam = P(ref idx);' "$PE" | cut -d: -f1)"
[ -n "$pu" ] && [ -n "$pf" ] && [ "$pu" -lt "$pf" ] || fail "ProgressEvents.cs: featuresParam must be allocated after userHashParam"
[ "$(sed -n "$((pf + 1))p" "$PE" | tr -d ' ')" = "parameters.Add(clientFeatures);" ] || fail "ProgressEvents.cs: parameters.Add(clientFeatures); must directly follow var featuresParam"
[ "$(sed -n "$((pf + 2))p" "$PE" | tr -d ' ')" = "varupdateIdParam=P(refidx);" ]   || fail "ProgressEvents.cs: var updateIdParam must directly follow parameters.Add(clientFeatures);"
[ "$(sed -n "$((pf + 3))p" "$PE" | tr -d ' ')" = "parameters.Add(updateId);" ]       || fail "ProgressEvents.cs: parameters.Add(updateId); must directly follow var updateIdParam"
kd="$(grep -Fn "'deck_version', deck_version{cardFormatKey}," "$PE" | cut -d: -f1)"
[ "$(sed -n "$((kd + 1))p" "$PE" | tr -d ' ')" = "'client_features',{featuresParam}::jsonb," ] || fail "ProgressEvents.cs: 'client_features' must be the payload key directly after 'deck_version', deck_version{cardFormatKey},"
[ "$(sed -n "$((kd + 2))p" "$PE" | tr -d ' ')" = "'update_id',{updateIdParam}::text" ]        || fail "ProgressEvents.cs: 'update_id' must be the payload key directly after 'client_features' (and the last one)"
[ "$(sed -n "$((kd + 3))p" "$PE" | tr -d ' ')" = "))" ]                                        || fail "ProgressEvents.cs: jsonb_build_object must close directly after 'update_id' (no further key)"
[ "$(grep -Fc 'catch (PostgresException' "$PE")" -eq 1 ] || fail "ProgressEvents.cs must keep exactly one catch (PostgresException — C10's 42703 fallback, nothing new"
if grep -Eiq "alter table|information_schema|pg_attribute|to_regclass|BeginTransaction" "$PE"; then
  grep -Ein "alter table|information_schema|pg_attribute|to_regclass|BeginTransaction" "$PE" >&2 || true
  fail "ProgressEvents.cs: no column probe, no DDL, no transaction (C00 §6 #11)"
fi
if grep -Eq "last_client_features|last_update_id" "$PE"; then
  grep -En "last_client_features|last_update_id" "$PE" >&2 || true
  fail "ProgressEvents.cs must not write the markers to users (no column, no migration in C14)"
fi
# 2d. ProgressEventsSingleStatementTests.cs — Batch() signature, the two body lines, the pinned Fact names, F5 intact
for sym in "    string? clientPlatform = \"ios\"," \
           "    IReadOnlyList<string>? clientFeatures = null," \
           "    string? updateId = null)" \
           '    if (clientFeatures is not null) body["clientFeatures"] = clientFeatures;' \
           '    if (updateId is not null) body["updateId"] = updateId;' \
           "OneIngest_CostsOneStatement_AndNoTransactionShell" \
           "PreparedStatement_BindsNullAndNonNullParametersAlike" \
           "OneIngest_WithClientFeaturesAndUpdateId_IsStillOneStatement" \
           'clientFeatures: ["mcq"]' \
           'Assert.Contains("client_features", sql' \
           'Assert.Contains("update_id", sql' \
           'Assert.Contains("ensure_user", sql, StringComparison.Ordinal);' \
           'Assert.Contains("analytics_event_outbox", sql, StringComparison.Ordinal);' \
           "private static Task<JsonElement> PostAsync(string userSub, IEnumerable<object> events) =>"; do
  grep -Fq -- "$sym" "$SST" || fail "ProgressEventsSingleStatementTests.cs lacks: $sym"
done
[ "$(grep -c '\[Fact\]' "$SST" || true)" -ge 6 ] || fail "ProgressEventsSingleStatementTests.cs lost a [Fact] (add-only)"
# 2e. ProgressEventsClientFeaturesTests.cs — collection, class, the six Facts, outbox read
for sym in "[Collection(PostgresCollection.Name)]" \
           "public class ProgressEventsClientFeaturesTests" \
           "Payload_CarriesClientFeaturesAndUpdateId_WhenSent" \
           "Payload_HasNeitherKey_WhenAbsent" \
           "Payload_HasNeitherKey_WhenSentAsNull" \
           "ClientFeatures_AreNormalized_BeforeTheyReachThePayload" \
           "ClientFeatures_AreCappedAtSixteen" \
           "UpdateId_IsTrimmed_AndDroppedWhenBlankOrTooLong" \
           "analytics_event_outbox" \
           "LambdaHost.PostProgressEventsAsync(" \
           "JsonValueKind.Array" \
           "TryGetProperty(\"client_features\"" \
           "TryGetProperty(\"update_id\""; do
  grep -Fq -- "$sym" "$CFT" || fail "ProgressEventsClientFeaturesTests.cs lacks: $sym"
done
[ "$(grep -c '\[Fact\]' "$CFT" || true)" -ge 6 ] || fail "ProgressEventsClientFeaturesTests.cs needs >= 6 [Fact] cases"
if grep -Eq "Skip *=|Thread\.Sleep|log_statement|ALTER SYSTEM" "$CFT"; then
  grep -En "Skip *=|Thread\.Sleep|log_statement|ALTER SYSTEM" "$CFT" >&2 || true
  fail "ProgressEventsClientFeaturesTests.cs: no skipped facts, no sleeps, no second log probe (one statement is F5 + the new Fact)"
fi
# 2f. mobile tests — harnesses, property test, the golden-bytes assertions, titles
grep -Fq "from 'fast-check'" "$CT" || fail "clientCapabilities.test.ts must use fast-check (C00 §3.3)"
grep -Fq "fc.assert(" "$CT"        || fail "clientCapabilities.test.ts has no fc.assert property"
grep -Fq "vi.mock('expo-updates'" "$CT"  || fail "clientCapabilities.test.ts must mock expo-updates at top level"
grep -Fq "vi.doMock('expo-updates'" "$CT" || fail "clientCapabilities.test.ts must cover the throwing module (vi.doMock)"
grep -Fq "resetClientCapabilitiesForTests" "$CT" || fail "clientCapabilities.test.ts must reset the cache between cases"
grep -Fq "normalizeClientFeatures" "$CT" || fail "clientCapabilities.test.ts must exercise normalizeClientFeatures"
for s in \
  'resolves {} when expo-updates cannot be loaded' \
  'resolves {} against the real expo-updates module under node' \
  'resolves { updateId } lower-cased when expo-updates provides one' \
  'omits updateId when the module value is null or not a string' \
  'caches the update id until reset' \
  'never sends undefined-valued keys' \
  'ships no feature tokens in Wave C' \
  'normalizes feature tokens: trim, lower-case, grammar, dedupe, sort, cap at 16' \
  'is idempotent and keeps every valid token when at most sixteen'; do
  grep -Fq "it('$s'" "$CT" || fail "missing clientCapabilities test case: $s"
done
for sym in "vi.mock('../../src/sync/clientCapabilities'" \
           "JSON.stringify(body)" \
           "'ladder-v1'" \
           "'devcards:deviceId:v1'" \
           "recordReviewEvent(" \
           "forceProgressSync(" \
           "Object.keys(" \
           "['deviceId', 'clientPlatform', 'clientVersion', 'events']" \
           "['deviceId', 'clientPlatform', 'clientVersion', 'clientFeatures', 'updateId', 'events']" \
           "['deviceId', 'clientPlatform', 'clientVersion', 'updateId', 'events']"; do
  grep -Fq -- "$sym" "$ET" || fail "progressSyncEnvelopeBytes.test.ts lacks: $sym"
done
grep -Fq "vi.mock('expo-updates'" "$ET" && fail "progressSyncEnvelopeBytes.test.ts must mock clientCapabilities, not expo-updates (the golden test is about the envelope, not the read)"
for s in \
  'sends the pre-C14 envelope bytes when the client has no capabilities' \
  'places clientFeatures and updateId after clientVersion and before events' \
  'keeps an absent capability off the wire'; do
  grep -Fq "it('$s'" "$ET" || fail "missing progressSyncEnvelopeBytes test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$CT" || true)" -ge 9 ] || fail "clientCapabilities.test.ts needs >= 9 it() blocks"
[ "$(grep -cE "^\s*it\(" "$ET" || true)" -ge 3 ] || fail "progressSyncEnvelopeBytes.test.ts needs >= 3 it() blocks"
# 2g. suppression / gutting across every scope file. progressSync.ts is frozen
# and its canonical blob (7393f532) already carries four pre-existing, load-bearing
# `// @ts-ignore` comments (:319-327, guarding globalThis.atob / Buffer under strict
# TS) that C14 may neither remove nor alter — step 5a pins it to +4/-0 and removing
# them fails test:typecheck. Scanning that frozen file whole-file therefore
# contradicts 5a for every C14 tree, so its suppressions are checked diff-scoped
# (C00 §0: "no @ts-ignore in any DIFF") — the same scope the driver's own
# suppression gate uses. Every other scope file is new or fully owned by C14 and
# stays whole-file.
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$CAP" "$CT" "$ET" "$PE" "$SST" "$CFT" \
  && fail "test gutting / suppression found"
g2mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE) for the progressSync.ts suppression scan"
git diff -U0 "$g2mb" -- "$PS" | grep '^+' | grep -v '^+++' \
  | grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" \
  && fail "test gutting / suppression found in progressSync.ts added lines"
# 2h. Existing suites are zero-diff against the base (C00 §3.1: C14 edits only Batch())
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
git diff --quiet "$mb" -- \
  mobile/tests/unit/progressSyncDropCounter.test.ts \
  mobile/tests/unit/progressSyncPendingAdoption.test.ts \
  mobile/tests/unit/progressSyncPullPagination.test.ts \
  mobile/tests/unit/progressSyncPullTriggers.test.ts \
  mobile/tests/unit/progressSyncQueueRace.test.ts \
  mobile/tests/unit/multiDeviceSync.sim.test.ts \
  mobile/tests/unit/revisionDemotionSync.test.ts \
  mobile/tests/unit/drawStateCacheInvalidation.test.ts \
  mobile/tests/unit/deckActionResolver.spec.ts \
  mobile/tests/unit/homeOwnedGate.spec.ts \
  mobile/tests/unit/ratingPrompt.test.ts \
  mobile/tests/integration \
  "$PIT" "$CFMT" "$ITB" \
  || fail "an existing progressSync / integration suite changed — C14 is add-only on tests except Batch() (C00 §3.1)"
grep -rq 'expo-updates' mobile/tests/integration && fail "no integration suite may mock expo-updates (the dynamic import needs no mock)"
others="$(grep -rl 'expo-updates' mobile/tests/unit | grep -v -e "^$CT\$" -e "^$ET\$" || true)"
[ -z "$others" ] || { echo "$others" >&2; fail "only C14's two suites may mention expo-updates under mobile/tests/unit (no existing suite needs a mock)"; }
# 2i. OTA guard (C00 §0): no manifest / dependency change on runtimeVersion 1.6.0
git diff --quiet "$mb" -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  || fail "mobile/package.json / package-lock.json / app.json / eas.json changed (OTA on runtimeVersion 1.6.0 forbids it)"
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed"
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail "app.json version changed (OTA runtime 1.6.0)"
grep -Fq '"vite": "7.2.4"' mobile/package.json             || fail "vite pin changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of 1.6.0)"; fi

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted tests: the two new suites + the five progressSync suites; then dotnet (Docker) ──
echo "[4/5] vitest clientCapabilities / progressSyncEnvelopeBytes / progressSync*; dotnet test ProgressEventsClientFeaturesTests + ProgressEventsSingleStatementTests (Docker)"
( cd mobile && npx vitest run \
    tests/unit/clientCapabilities.test.ts \
    tests/unit/progressSyncEnvelopeBytes.test.ts \
    tests/unit/progressSyncDropCounter.test.ts \
    tests/unit/progressSyncPendingAdoption.test.ts \
    tests/unit/progressSyncPullPagination.test.ts \
    tests/unit/progressSyncPullTriggers.test.ts \
    tests/unit/progressSyncQueueRace.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"
docker info >/dev/null 2>&1 || fail "Docker is not running — ProgressEventsClientFeaturesTests / ProgressEventsSingleStatementTests need a Testcontainers Postgres (start Docker Desktop, then rerun)"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --nologo \
    --filter "FullyQualifiedName~ProgressEventsClientFeaturesTests|FullyQualifiedName~ProgressEventsSingleStatementTests" ) \
  || fail "dotnet test ProgressEventsClientFeaturesTests / ProgressEventsSingleStatementTests failed"

# ── 5. Scope + frozen-file + OTA guard ─────────────────────────────────────
echo "[5/5] scope + frozen guard"
# 5a. The signed exception: progressSync.ts is +4 / -0 and the four + lines are the signed lines, in order
numstat="$(git diff --numstat "$mb" -- "$PS" | cut -f1,2)"
[ "$numstat" = "$(printf '4\t0')" ] || fail "progressSync.ts numstat must be '4 0', got '${numstat:-<no diff>}'"
added="$(git diff -U0 "$mb" -- "$PS" | grep '^+' | grep -v '^+++' || true)"
[ "$added" = "$(printf '+%s\n+%s\n+%s\n+%s' "$L1" "$L2" "$L3" "$L4")" ] \
  || { printf '%s\n' "$added" >&2; fail "progressSync.ts: the only added lines must be the four signed lines, in order"; }
# the C00 §2.13 regexes, one hit each
printf '%s\n' "$added" | grep -Ec "^\+import \{ getClientCapabilities \} from '\./clientCapabilities';$" | grep -qx 1 || fail "regex 1 (import) did not match exactly once"
printf '%s\n' "$added" | grep -Ec '^\+  const caps = await getClientCapabilities\(\);$'                 | grep -qx 1 || fail "regex 2 (const caps) did not match exactly once"
printf '%s\n' "$added" | grep -Ec '^\+        clientFeatures: caps\.clientFeatures,$'                   | grep -qx 1 || fail "regex 3 (clientFeatures) did not match exactly once"
printf '%s\n' "$added" | grep -Ec '^\+        updateId: caps\.updateId,$'                               | grep -qx 1 || fail "regex 4 (updateId) did not match exactly once"
# 5b. The other two frozen files are zero-diff; the single-statement test file loses exactly one line (the old Batch() tail)
git diff --quiet "$mb" -- mobile/src/content/deckRepository.ts mobile/src/review/model.ts \
  || fail "deckRepository.ts / model.ts changed — frozen, zero-diff in C14 (C00 §0)"
removed="$(git diff -U0 "$mb" -- "$SST" | grep '^-' | grep -v '^---' || true)"
[ "$removed" = "-$SST_OLD" ] \
  || { printf '%s\n' "$removed" >&2; fail "ProgressEventsSingleStatementTests.cs may remove exactly one line, the old Batch() tail: $SST_OLD"; }
# 5c. Do-not-touch set (C00 §0, brief Constraints)
frozen="$(git diff --numstat "$mb" -- \
  mobile/src/review/storage.ts mobile/src/sync/drawStateSync.ts mobile/src/config mobile/src/api/apiClient.ts \
  mobile/tsconfig.json mobile/vitest.config.ts mobile/tests/setup \
  src_C/Vpc/Db/Migrations src_C/Vpc/Analytics src_C/Vpc/Authoring src_C/Worker src_C/Shared \
  snowflake frontend docs/*.md)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# 5d. Every changed or untracked path is one of the seven scope files. Untracked scan is
# pathspec-scoped: the driver symlinks mobile/node_modules and frontend/node_modules into
# the worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json src_C/Vpc src_C/Worker src_C/Tests src_C/Shared snowflake docs frontend/src frontend/tests; } | sort -u | grep -Ev '^(mobile/src/sync/clientCapabilities\.ts|mobile/src/sync/progressSync\.ts|mobile/tests/unit/clientCapabilities\.test\.ts|mobile/tests/unit/progressSyncEnvelopeBytes\.test\.ts|src_C/Vpc/Runtime/ProgressEvents\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/ProgressEventsSingleStatementTests\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/ProgressEventsClientFeaturesTests\.cs|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C14 scope"; }

echo "C14 VERIFY OK"
