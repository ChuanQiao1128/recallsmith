#!/usr/bin/env bash
# E15 — docs-runbooks verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# FAILS ON BASE at step 1:
#   - docs/runbooks/deploy-rollback.md, docs/runbooks/incident.md,
#     docs/runbooks/dr-restore-drill.md and docs/runbooks/staging-promotion.md
#     do not exist on base.
#   (step 1 then also checks the prerequisites E00 §4 merges before E15 and
#   the runbooks cite: README.md:1 == "# DeveloperCards" (E14),
#   docs/runbooks/secrets-rotation.md + scripts/invoke-as-admin.sh (E06),
#   infra/README.md + infra/RUNBOOK.md (E01), infra/scripts/rds-snapshot.sh
#   (E02), scripts/rollback.sh + scripts/smoke.sh + the three workflows (E11),
#   mobile/src/config/hosts.ts + site/deploy.sh (E09), src_C/env/staging.env.json
#   (E10), InternalEvents.cs (E12), DeckRollback.cs (E03) — present on the
#   integration branch, absent on base.)
# Step 2 (literal guards: H2 sets, the thirteen alarm names, hostnames, script
# paths, endpoints, the README headings/table rows, brand/suppression/secret
# greps, path citations) would also fail on base. Step 3 = docs gates (fence
# parser, `# who:` labels, bash -n on every bash block, json blocks), step 4 =
# the two vitest files that read prose, step 5 = scope + frozen + OTA + apply
# guard; they pass on base by design and are never reached there.
#
# No AWS CLI, no Terraform, no Docker, no network, nothing executed from the
# runbooks (bash -n parses; it never runs). Step 4 uses the symlinked
# frontend/node_modules. Runtime < 1 min. The driver's diff-scoped banned-term
# grep and suppression scan run separately; this script does not spell the six
# terms (E00 §0).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E15 VERIFY FAIL: $*" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── paths ──────────────────────────────────────────────────────────────────
RB_DIR=docs/runbooks
RB_DEPLOY=$RB_DIR/deploy-rollback.md
RB_INCIDENT=$RB_DIR/incident.md
RB_DR=$RB_DIR/dr-restore-drill.md
RB_STAGING=$RB_DIR/staging-promotion.md
RB_SECRETS=$RB_DIR/secrets-rotation.md
README=README.md
RUNBOOKS="$RB_DEPLOY $RB_INCIDENT $RB_DR $RB_STAGING"

# E00 §5 apply guard pattern (state-changing commands).
APPLY_RE='terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-'

need()   { grep -Fq -- "$2" "$1" || fail "$1 lacks: $2"; }
absent() { if grep -Fq -- "$2" "$1"; then fail "$1 must not contain: $2"; fi; }
count()  { grep -Fc -- "$2" "$1" || true; }

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ E01/E02/E03/E06/E09/E10/E11/E12/E14 prerequisites)"
for f in $RUNBOOKS; do
  [ -s "$f" ] || fail "$f does not exist or is empty (base tree fails here)"
done
[ "$(sed -n '1p' "$README")" = "# DeveloperCards" ] || fail "README.md:1 must be '# DeveloperCards' — E14 must be merged before E15 (E00 §4)"
for f in "$RB_SECRETS" scripts/invoke-as-admin.sh infra/README.md infra/RUNBOOK.md infra/scripts/rds-snapshot.sh \
         scripts/rollback.sh scripts/smoke.sh .github/workflows/cd.yml .github/workflows/ota.yml .github/workflows/terraform.yml \
         mobile/src/config/hosts.ts site/deploy.sh src_C/env/staging.env.json src_C/Vpc/Internal/InternalEvents.cs \
         src_C/Vpc/Authoring/DeckRollback.cs; do
  [ -f "$f" ] || fail "$f is missing — an earlier Wave E issue is not merged (E00 §4 orders E01…E14 before E15)"
done
mb="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || git merge-base "origin/$BASE_REF" HEAD 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
git diff --quiet HEAD -- "$README" "$RB_DIR" || fail "uncommitted changes in README.md / docs/runbooks — commit before verifying (diffs are taken against HEAD)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
git diff -U0 "$mb" HEAD -- "$README" | grep -E '^\+[^+]' | sed 's/^+//' > "$TMP/readme.added" || true
git diff -U0 "$mb" HEAD -- "$README" | grep -E '^-' | grep -Ev '^--- ' | sed 's/^-//' > "$TMP/readme.removed" || true
git show "$mb:$README" > "$TMP/readme.base"
cat $RUNBOOKS "$TMP/readme.added" > "$TMP/all.added"

# 2a. Structure of every runbook: H1 on line 1, H2 sets verbatim, no CJK, relative links resolve,
#     cited repo paths exist (wider prefix list than rootReadmePaths.test.ts), fences balanced.
python3 - "$ROOT" $RUNBOOKS <<'PY' || fail "runbook structure check failed"
import re, sys, os
root = sys.argv[1]; files = sys.argv[2:]
expected = {
  "deploy-rollback.md":  ["When to use","Commands","Rollback matrix","Migrations and rollback","After a rollback"],
  "incident.md":         ["When to use","Commands","Alarm map","Common causes","After the incident"],
  "dr-restore-drill.md": ["When to use","Commands","Real restore","What an RDS restore does not bring back","Drill log"],
  "staging-promotion.md":["When to use","Commands","Migration rules","Infra promotion","Mobile promotion","Staging hostnames"],
}
CJK = re.compile(r'[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]')
CITE = re.compile(r'`((?:frontend|mobile|src_C|pg-layer|snowflake|docs|\.github|infra|scripts|site)/[A-Za-z0-9._/-]+?)(?::[0-9]+(?:-[0-9]+)?)?`')
LINK = re.compile(r'\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)')
bad = []
for f in files:
    name = os.path.basename(f)
    lines = open(f, encoding="utf-8").read().split("\n")
    if not lines or not lines[0].startswith("# "): bad.append(f"{f}: line 1 is not an H1")
    if CJK.search("\n".join(lines)): bad.append(f"{f}: contains CJK characters (English only)")
    h2 = []; infence = False; prose = []
    for ln in lines:
        if ln.startswith("```"):
            infence = not infence; continue
        if infence: continue
        prose.append(ln)
        if ln.startswith("## "): h2.append(ln[3:].strip())
    if infence: bad.append(f"{f}: unbalanced code fences")
    if h2 != expected[name]: bad.append(f"{f}: H2 set is {h2}, expected {expected[name]}")
    text = "\n".join(prose)
    for m in CITE.finditer("\n".join(lines)):
        p = m.group(1)
        if not os.path.exists(os.path.join(root, p)): bad.append(f"{f}: cites {p} which is not on disk")
    for m in LINK.finditer(text):
        t = m.group(1)
        if re.match(r'^[a-z]+:', t): continue
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), t))): bad.append(f"{f}: link target {t} does not resolve")
if bad:
    print("\n".join(bad)); sys.exit(1)
PY

# 2b. deploy-rollback.md
for s in "scripts/rollback.sh api" "scripts/rollback.sh worker" "scripts/rollback.sh console" \
         "eas update:republish --group" "eas update --channel production" \
         "/api/v1/admin/decks/" "/rollback" '"buildId"' "previousBuildId" "manifestRebuilt" \
         "ENV=prod ./src_C/deploy.sh" "PUBLISH_ALIAS=staging" "/api/v1/admin/db/migrate" "SERVER_NOT_READY_SCHEMA" \
         "scripts/smoke.sh prod" "infra/scripts/rds-snapshot.sh" "pre-deploy-" "frontend/deploy.sh" "site/deploy.sh" \
         ".github/workflows/cd.yml" ".github/workflows/ota.yml" ".github/workflows/terraform.yml" \
         "EXPO_PUBLIC_API_BASE=https://api.developercards.app" "EXPO_PUBLIC_CONTENT_BASE_URL=https://cdn.developercards.app" \
         "runtimeVersion" "mobile/scripts/release/ios-build.sh" "recallsmith-tfstate-622994489535" "check-plan.py" \
         "https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com" "https://d1ditdi9jqpy6n.cloudfront.net" \
         "https://d12pfy1rhi3ekm.cloudfront.net" "mobile/src/config/hosts.ts" \
         "secrets-rotation.md" "dr-restore-drill.md" "incident.md" "staging-promotion.md" \
         "| What | Command | RTO | Caveat |"; do
  need "$RB_DEPLOY" "$s"
done

# 2c. incident.md — thirteen alarms, each exactly once, as table rows 1..13 in order
ALARMS="developercards-prod-api-5xx developercards-prod-core-vpc-errors developercards-prod-worker-errors
developercards-prod-core-vpc-throttles developercards-prod-worker-throttles developercards-prod-core-vpc-duration-p95
developercards-prod-sqs-oldest-age developercards-prod-dlq-nonempty developercards-prod-rds-cpu
developercards-prod-rds-free-storage developercards-prod-rds-connections developercards-prod-outbox-backlog
developercards-prod-scheduler-errors"
i=0
for a in $ALARMS; do
  i=$((i+1))
  grep -Eq "^\| *$i *\| *\`?$a\`? *\|" "$RB_INCIDENT" || fail "incident.md: alarm map row $i must start '| $i | $a |'"
done
[ "$(grep -Ec '^\| *[0-9]+ *\|' "$RB_INCIDENT" || true)" = "13" ] || fail "incident.md: the alarm map must have exactly 13 numbered rows"
for s in "developercards-alerts" "developercards-prod" "/aws/lambda/core-vpc" "/aws/lambda/worker-lambda" \
         "/aws/apigateway/developercards-api" 'filter level = "error"' "filter status >= 500" 'tag = "unhandled"' \
         'tag = "schema"' "requestId" "integrationError" "authorizerError" "routeKey" "OutboxPending" "SchemaBehind" \
         '"action":"health/deep"' "schemaVersion" "list-event-source-mappings" "start-message-move-task" \
         "/api/v1/admin/publish/reap" "developercards-publish-jobs-dlq" "Performance Insights" "PG_MAX=1" \
         "outbox-publish" "snapshot-import" "reap-orphans" "scripts/smoke.sh prod" "https://api.developercards.app/health" \
         "deploy-rollback.md" "secrets-rotation.md" "staging-promotion.md"; do
  need "$RB_INCIDENT" "$s"
done

# 2d. dr-restore-drill.md
for s in "developercards-drill" "restore-db-instance-from-db-snapshot" "--snapshot-type automated" \
         "sort_by(DBSnapshots,&SnapshotCreateTime)[-1]" "default-vpc-04af44dd8f5f48717" "sg-0d2541aec08b1a215" \
         "sg-0fbc6607e6473cbd3" "default.postgres17" "wait db-instance-available" "Endpoint.Address" \
         "core-vpc-staging" "worker-lambda-staging" "--name staging" '.PGHOST = $h' "update-function-configuration" \
         "wait function-updated" "publish-version" "update-alias" "scripts/smoke.sh staging" "/api/v1/authoring/dashboard" \
         "RTO" "delete-db-instance" "--skip-final-snapshot" "wait db-instance-deleted" "restore-db-instance-to-point-in-time" \
         "list-object-versions" "12:55-13:25" "secrets-rotation.md" \
         "| Date | Snapshot | T0 → T1 (RTO) | Smoke | Notes |" "(none yet)"; do
  need "$RB_DR" "$s"
done
if grep -F 'Environment.Variables' "$RB_DR" | grep -Ev '=\$\(|="\$\(|^\s*#' | grep -q .; then
  grep -nF 'Environment.Variables' "$RB_DR" >&2 || true
  fail "dr-restore-drill.md: Environment.Variables must only appear captured into a shell variable (never printed)"
fi

# 2e. staging-promotion.md
for s in "deploy-staging" "smoke-staging" "deploy-prod" "smoke-prod" "developercards-gha-staging" "developercards-gha-plan" \
         "infra-prod" "ENV=staging ./src_C/deploy.sh" "ENV=prod ./src_C/deploy.sh" "core-vpc-staging:staging" \
         "/api/v1/admin/db/migrate" "scripts/smoke.sh staging" "scripts/smoke.sh prod" "pre-deploy-" \
         "developercards-console-staging" "https://console-staging.developercards.app" "https://api-staging.developercards.app" \
         "https://cdn-staging.developercards.app" "SchemaVersion.Required" "SERVER_NOT_READY_SCHEMA" "MIGRATION_IN_PROGRESS" \
         "dryRun" "if not exists" "staging-internal-release" "developercards_staging" "developercards-publish-jobs-staging" \
         "MobileDeveloperCards-staging" "console-staging" "infra/envs/staging" "../../infra/README.md" \
         "| Purpose | Staging | Production |"; do
  need "$RB_STAGING" "$s"
done

# 2f. README.md — headings, order, tables, links, removed content
[ "$(count "$README" "## Architecture")" = "1" ] || fail "README.md: '## Architecture' must appear exactly once"
[ "$(count "$README" "### Hostnames")" = "1" ]   || fail "README.md: '### Hostnames' must appear exactly once"
[ "$(count "$README" "## Deployment")" = "1" ]   || fail "README.md: '## Deployment' must appear exactly once"
l1="$(grep -nF '## 1. What is in this repository' "$README" | head -1 | cut -d: -f1)"
la="$(grep -nF '## Architecture' "$README" | head -1 | cut -d: -f1)"
l2="$(grep -nF '## 2. Running it' "$README" | head -1 | cut -d: -f1)"
ld="$(grep -nF '## Deployment' "$README" | head -1 | cut -d: -f1)"
l3="$(grep -nF '## 3. How one request flows' "$README" | head -1 | cut -d: -f1)"
for v in l1 la l2 ld l3; do [ -n "${!v}" ] || fail "README.md: heading for $v missing"; done
{ [ "$l1" -lt "$la" ] && [ "$la" -lt "$l2" ] && [ "$l2" -lt "$ld" ] && [ "$ld" -lt "$l3" ]; } \
  || fail "README.md: heading order must be '## 1.' < '## Architecture' < '## 2. Running it' < '## Deployment' < '## 3. How one request flows'"
prev=0
for layer in "Clients" "Edge" "API" "Compute" "Data" "Async publish" "Analytics" "Identity" "Observability" "Delivery" "Infrastructure as code"; do
  ln="$(grep -nE "^\| *$layer *\|" "$README" | head -1 | cut -d: -f1)"
  [ -n "$ln" ] || fail "README.md: Architecture table lacks the row '| $layer |'"
  [ "$ln" -gt "$prev" ] || fail "README.md: Architecture row '$layer' is out of order"
  prev="$ln"
done
for s in "| Purpose | Hostname | Legacy name (still served) |" \
         "https://api.developercards.app" "https://cdn.developercards.app" "https://console.developercards.app" \
         "https://developercards.app" "https://www.developercards.app" "https://api-staging.developercards.app" \
         "https://cdn-staging.developercards.app" "https://console-staging.developercards.app" \
         "https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com" "https://d1ditdi9jqpy6n.cloudfront.net" \
         "https://d12pfy1rhi3ekm.cloudfront.net" \
         "infra/README.md" "infra/RUNBOOK.md" ".github/workflows/cd.yml" ".github/workflows/terraform.yml" ".github/workflows/ota.yml" \
         "src_C/deploy.sh" "src_C/env/prod.env.json" "frontend/deploy.sh" "site/deploy.sh" "scripts/rollback.sh" "scripts/smoke.sh" \
         "infra/scripts/rds-snapshot.sh" "docs/runbooks/deploy-rollback.md" "docs/runbooks/incident.md" \
         "docs/runbooks/dr-restore-drill.md" "docs/runbooks/staging-promotion.md" "docs/runbooks/secrets-rotation.md" \
         "mobile/src/content/deckRepository.ts" "**SPA fallback.**" "**Cache split.**" "**Build-time config.**"; do
  need "$README" "$s"
done
for s in "aws s3 sync dist s3://recallsmith-console-622994489535" "CI does not deploy" "Deploying is two commands" "the RecallSmith API"; do
  absent "$README" "$s"
done
if grep -Eq 'aws +[a-z0-9-]+ +[a-z-]+' "$TMP/readme.added"; then
  grep -En 'aws +[a-z0-9-]+ +[a-z-]+' "$TMP/readme.added" >&2 || true
  fail "README.md: no aws command in added lines (commands live in the runbooks)"
fi
# README path citations (wider prefix list than rootReadmePaths.test.ts) exist; >= 12 citations for the test's floor
python3 - "$ROOT" "$README" <<'PY' || fail "README.md cites a path that is not on disk (or fewer than 12 citations)"
import re, sys, os
root, f = sys.argv[1], sys.argv[2]
CITE = re.compile(r'`((?:frontend|mobile|src_C|pg-layer|snowflake|docs|\.github|infra|scripts|site)/[A-Za-z0-9._/-]+?)(?::[0-9]+(?:-[0-9]+)?)?`')
cited = sorted(set(m.group(1) for m in CITE.finditer(open(f, encoding="utf-8").read())))
missing = [p for p in cited if not os.path.exists(os.path.join(root, p))]
narrow = [p for p in cited if re.match(r'^(frontend|mobile|src_C|pg-layer|snowflake|docs|\.github)/', p)]
if missing: print("missing:", missing)
if len(narrow) < 12: print("only", len(narrow), "rootReadmePaths-style citations")
sys.exit(1 if missing or len(narrow) < 12 else 0)
PY
# README removed lines ⊆ base :71-100 ∪ :304
python3 - "$TMP/readme.base" "$TMP/readme.removed" <<'PY' || fail "README.md: a removed line lies outside base :71-100 / :304 (E00 §2.15: only the Deployment section and the :304 brand string change)"
import sys
base = open(sys.argv[1], encoding="utf-8").read().split("\n")
allowed = set(base[70:100]) | {base[303]}
removed = [l for l in open(sys.argv[2], encoding="utf-8").read().split("\n")]
if removed and removed[-1] == "": removed = removed[:-1]
bad = [l for l in removed if l not in allowed]
if bad:
    print("\n".join(bad)); sys.exit(1)
PY
[ "$(sed -n '1p' "$TMP/readme.base")" = "$(sed -n '1p' "$README")" ] || fail "README.md:1 changed"

# 2g. Brand, suppression, secret-leak, CJK over every added line
if grep -F 'RecallSmith' "$TMP/all.added" | grep -vF 'RecallSmith.Lambda' | grep -q .; then
  grep -nF 'RecallSmith' "$TMP/all.added" | grep -vF 'RecallSmith.Lambda' >&2 || true
  fail "brand string 'RecallSmith' in an added line (only RecallSmith.Lambda paths may carry it)"
fi
if sed -E 's/recallsmith-publish-jobs|recallsmith-console-622994489535|recallsmith-tfstate-622994489535|snowflake-recallsmith-s3-role|ChuanQiao1128\/recallsmith|com\.timeawake\.recallsmith//g' "$TMP/all.added" | grep -q 'recallsmith'; then
  fail "lowercase 'recallsmith' in an added line outside the adopted resource names"
fi
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" $RUNBOOKS "$TMP/readme.added" \
  && fail "test gutting / suppression found"
if grep -Eq '#pragma warning disable|\[Fact\(Skip|\[Theory\(Skip' "$TMP/all.added"; then fail "suppression token in an added line"; fi
if grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]' "$TMP/all.added"; then
  fail "secret-leak guard (E00 §5): a secret-named key is assigned a literal value in an added line"
fi
SECRET_NAMES='(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)'
if grep -E "${SECRET_NAMES}=" "$TMP/all.added" | grep -Ev "${SECRET_NAMES}=('|\"|[\$]|<|\`|…|\.\.\.| |$)" | grep -q .; then
  grep -En "${SECRET_NAMES}=" "$TMP/all.added" >&2 || true
  fail "a secret-named variable is assigned something other than a quoted '<…>' placeholder or \$(…) in an added line"
fi
python3 -c 'import re,sys; sys.exit(1 if re.search(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]", open(sys.argv[1], encoding="utf-8").read()) else 0)' "$TMP/readme.added" \
  || fail "CJK in an added README line"

# ── 3. Docs gates: fence parser, `# who:` labels, bash -n per block, json blocks, apply guard per block ──
echo "[3/5] docs gates (fence parser + # who: labels + bash -n + json + per-block apply guard)"
python3 - "$TMP" "$APPLY_RE" $RUNBOOKS <<'PY' || fail "docs gate failed"
import re, sys, os, subprocess, json
tmp, apply_re = sys.argv[1], re.compile(sys.argv[2]); files = sys.argv[3:]
WHO = re.compile(r'^# who: (supervisor|owner|ci|anyone)$')
bad = []; nblocks = 0
for f in files:
    lines = open(f, encoding="utf-8").read().split("\n")
    i = 0; prose = []
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            lang = ln[3:].strip()
            if lang not in ("bash", "json", "text"): bad.append(f"{f}:{i+1}: fence language must be bash, json or text (got '{lang or '<none>'}')")
            j = i + 1; body = []
            while j < len(lines) and not lines[j].startswith("```"):
                body.append(lines[j]); j += 1
            if j >= len(lines): bad.append(f"{f}:{i+1}: unterminated fence"); break
            if lines[j].strip() != "```": bad.append(f"{f}:{j+1}: closing fence must be a bare ```")
            nblocks += 1; text = "\n".join(body)
            role = None
            if lang == "bash":
                m = WHO.match(body[0]) if body else None
                if not m: bad.append(f"{f}:{i+2}: bash block must start with '# who: supervisor|owner|ci|anyone'")
                else: role = m.group(1)
                p = os.path.join(tmp, f"block-{nblocks}.sh"); open(p, "w").write(text + "\n")
                r = subprocess.run(["bash", "-n", p], capture_output=True, text=True)
                if r.returncode != 0: bad.append(f"{f}:{i+1}: bash -n failed: {r.stderr.strip()}")
                noncomment = "\n".join(l for l in body if not l.lstrip().startswith("#"))
                if role in (None, "anyone") and apply_re.search(noncomment): bad.append(f"{f}:{i+1}: state-changing command in a '# who: anyone' (or unlabelled) block")
                if re.search(r'(^|[\s;&|(])eas\s', noncomment) and role not in ("owner", "ci"): bad.append(f"{f}:{i+1}: eas command outside an owner/ci block")
                if re.search(r'terraform +(apply|import)', noncomment) and role not in ("supervisor", "ci"): bad.append(f"{f}:{i+1}: state-changing terraform command outside a supervisor/ci block")
                if re.search(r'(^|[\s;&|(])(echo|printf|cat)\b.*\$(cur|merged|current)\b', noncomment): bad.append(f"{f}:{i+1}: prints a captured environment variable")
            else:
                if apply_re.search(text): bad.append(f"{f}:{i+1}: state-changing command in a {lang} block")
                if lang == "json":
                    try: json.loads(text)
                    except Exception as e: bad.append(f"{f}:{i+1}: json block does not parse: {e}")
            i = j + 1; continue
        prose.append(ln); i += 1
    for k, ln in enumerate(prose):
        if apply_re.search(ln): bad.append(f"{f}: prose line matches the apply guard: {ln.strip()[:80]}")
if nblocks == 0: bad.append("no fenced blocks found in any runbook")
if bad:
    print("\n".join(bad)); sys.exit(1)
print(f"docs gate: {nblocks} fenced blocks parsed")
PY
# No root changes: nothing to gate; a diff there is a scope failure (step 5), reported early here for clarity.
roots_changed="$(git diff --name-only "$mb" HEAD -- infra scripts src_C frontend mobile site .github snowflake pg-layer)"
[ -z "$roots_changed" ] || { echo "$roots_changed" >&2; fail "a code/infra root changed — E15 is docs + README only"; }

# ── 4. Targeted tests: the two vitest files that read prose ────────────────
echo "[4/5] vitest docsPaths + rootReadmePaths"
[ -e frontend/node_modules ] || fail "frontend/node_modules missing (the driver symlinks it; no npm install here)"
( cd frontend && npx vitest run tests/docsPaths.test.ts tests/rootReadmePaths.test.ts --reporter=dot ) || fail "docsPaths / rootReadmePaths failed"

# ── 5. Scope + frozen + OTA + apply guard ──────────────────────────────────
echo "[5/5] scope + frozen + OTA + apply guard"
# 5a. Frozen mobile files and the OTA manifest set are zero-diff; no Sentry
git diff --quiet "$mb" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "a frozen mobile file changed"
git diff --quiet "$mb" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  || fail "OTA manifest set changed (package.json / package-lock.json / app.json / eas.json)"
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "mobile/app.json version changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary, not this wave)"; fi
# 5b. Do-not-touch set: E06's runbook, every top-level docs/*.md, LICENSE, every root
untouched="$(git diff --numstat "$mb" HEAD -- "$RB_SECRETS" ':(glob)docs/*.md' LICENSE infra scripts src_C frontend mobile site .github snowflake pg-layer)"
[ -z "$untouched" ] || { echo "$untouched" >&2; fail "a do-not-touch file changed"; }
# 5c. Every changed or untracked path is one of the five scope entries (pathspec-scoped untracked scan:
#     the driver symlinks node_modules, and a bare scan would list it)
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- docs README.md infra scripts src_C frontend/src frontend/tests mobile/src mobile/tests site .github snowflake; } \
  | sort -u | grep -Ev '^(docs/runbooks/(deploy-rollback|incident|dr-restore-drill|staging-promotion)\.md|README\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E15 scope"; }
# 5d. Apply guard (E00 §5 + task rule): no added README line, and no non-comment line of this
#     script, runs terraform apply/import or an aws create/update/delete/put command. (The
#     runbooks were checked block by block in step 3: only '# who: supervisor|owner|ci' blocks may.)
if grep -Ev '^\s*(#|//|--|/\*|\*)' "$TMP/readme.added" | grep -Eq "$APPLY_RE"; then
  fail "an added README line runs a state-changing terraform or aws command (commands live in # who: blocks of the runbooks)"
fi
if grep -Ev '^\s*#' "$0" | grep -Ev "APPLY_RE=" | grep -Eq "$APPLY_RE"; then
  fail "E15.verify.sh itself contains a state-changing command outside comments"
fi

echo "E15 VERIFY OK"
