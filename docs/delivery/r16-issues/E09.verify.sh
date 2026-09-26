#!/usr/bin/env bash
# E09 — domain-wiring verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - infra/modules/edge/dns.tf, certs.tf, site.tf,
#     mobile/src/config/hosts.ts, mobile/tests/unit/hosts.test.ts,
#     mobile/tests/unit/apiClientFallback.test.ts, site/index.html,
#     site/styles.css, site/deploy.sh and
#     docs/delivery/r16-issues/E09.plan-allow.json do not exist on base
#   (step 1 then also checks the E01/E08 prerequisites: infra/envs/prod/main.tf,
#   infra/scripts/check-plan.py, the `cognito-jwt-mobile` authorizer and the
#   `console_dev` client must be on the integration branch — E00 §4 orders
#   E01 → … → E08 → E09)
# Step 2 (literal guards: addresses, hostnames, cert/validation resources, the
# hosts.ts signatures, the it('…') titles, the landing-page sentences) would also
# fail on base. Step 3 = root gates (terraform fmt/init/validate, tsc, frontend
# lint+build, bash -n), step 4 = the read-only plan against the real backend
# (E01 gap 13 / E08 recipe: init -reconfigure, plan -lock=false) → check-plan.py
# + an independent strict shape check, targeted vitest, site checks, DRY_RUN
# runs; step 5 = scope + frozen + OTA + apply/secret guards. 3–5 pass on base by
# design (never reached there).
#
# Worker safety (E00 §0): this script runs `terraform init -backend=false` (for
# validate), `terraform init -input=false -reconfigure` + `terraform plan
# -lock=false -out` + `terraform show -json` (state READ with s3:GetObject, never
# locked, never written) and read-only `aws … get/list/describe` calls. It never
# applies, never imports by command, never touches state, and runs no deploy
# script without DRY_RUN=1. The plan file, its JSON and the temp var-file are
# deleted by the trap (Lambda environment blocks are not sensitive in
# hashicorp/aws 6.66 — E00 §0); only address / action / changed-key names,
# hostnames and booleans are printed.
#
# Precondition: E01–E08 applied by the supervisor and their second plan empty
# (E00 §0) — otherwise the plan carries their changes and step 4 fails.
#
# Network: AWS read-only (AWS_PROFILE=dev) for the state read, the refresh and
# four get/list/describe calls; `terraform init` may download the pinned provider
# once into TF_PLUGIN_CACHE_DIR. No npm install, no expo, no eas. Runtime ≈ 4–7
# min (the refresh dominates, then the frontend build).
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (E00 §0).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E09 VERIFY FAIL: $*" >&2; exit 1; }

export AWS_PROFILE="${AWS_PROFILE:-dev}"
export AWS_REGION="${AWS_REGION:-ap-southeast-2}"
export AWS_PAGER=""
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
export TF_IN_AUTOMATION=1
mkdir -p "$TF_PLUGIN_CACHE_DIR"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/e09-verify.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# infra
PROD=infra/envs/prod
MAIN=$PROD/main.tf
VARS=$PROD/variables.tf
OUTS=$PROD/outputs.tf
EXAMPLE=$PROD/prod.auto.tfvars.example
EDGE=infra/modules/edge
DNS=$EDGE/dns.tf
CERTS=$EDGE/certs.tf
SITE_TF=$EDGE/site.tf
CDN=$EDGE/cdn.tf
EDGE_VARS=$EDGE/variables.tf
EDGE_OUTS=$EDGE/outputs.tf
API=infra/modules/api
GATEWAY=$API/gateway.tf
API_VARS=$API/variables.tf
API_OUTS=$API/outputs.tf
IDENTITY=infra/modules/identity
COGNITO=$IDENTITY/cognito.tf
ID_VARS=$IDENTITY/variables.tf
INFRA_README=infra/README.md
CHECKER=infra/scripts/check-plan.py
ALLOW=docs/delivery/r16-issues/E09.plan-allow.json
# mobile
HOSTS=mobile/src/config/hosts.ts
CLIENT=mobile/src/api/apiClient.ts
HOME_REMOTE=mobile/src/features/gacha/home/homeRemote.ts
PREMIUM_API=mobile/src/content/premiumDeckApi.ts
RC=mobile/src/premium/revenuecat.ts
HT=mobile/tests/unit/hosts.test.ts
FT=mobile/tests/unit/apiClientFallback.test.ts
# console + site
ENV_PROD=frontend/.env.production
ENV_DEV=frontend/.env.development
FE_DEPLOY=frontend/deploy.sh
SITE_HTML=site/index.html
SITE_CSS=site/styles.css
SITE_DEPLOY=site/deploy.sh

ZONE_ID=Z0284954BSN00C8BF94Q
CONSOLE_POOL=ap-southeast-2_4Vf8uCXKt
SPA_CLIENT=6lkofepp2llp6v4nueg52mcm5v
TAB="$(printf '\t')"

count() { grep -Ec -- "$1" "$2" || true; }        # ERE count, 0 when no match
fcount() { grep -Fc -- "$1" "$2" || true; }       # fixed-string count, 0 when no match
need() { grep -Fq -- "$2" "$1" || fail "$1 lacks: $2"; }                    # fixed string (-- : patterns may start with -)
needre() { grep -Eq -- "$2" "$1" || fail "$1 lacks a line matching: $2"; }  # ERE (terraform fmt re-aligns '=')
absent() { if grep -Fq -- "$2" "$1"; then grep -Fn -- "$2" "$1" >&2 || true; fail "$1 must not contain: $2"; fi; }

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ E01/E08 prerequisites)"
for f in "$DNS" "$CERTS" "$SITE_TF" "$HOSTS" "$HT" "$FT" "$SITE_HTML" "$SITE_CSS" "$SITE_DEPLOY" "$ALLOW"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$MAIN" "$VARS" "$OUTS" "$EXAMPLE" "$CDN" "$EDGE_VARS" "$EDGE_OUTS" "$GATEWAY" "$API_VARS" "$API_OUTS" \
         "$COGNITO" "$ID_VARS" "$INFRA_README" "$CHECKER" "$PROD/imports.tf" "$PROD/backend.tf" \
         "$CLIENT" "$HOME_REMOTE" "$PREMIUM_API" "$RC" "$ENV_PROD" "$ENV_DEV" "$FE_DEPLOY"; do
  [ -f "$f" ] || fail "$f is missing from the tree (E01 skeleton / base file)"
done
[ -x "$SITE_DEPLOY" ] || fail "$SITE_DEPLOY must be executable (chmod +x)"
grep -Fq 'cognito-jwt-mobile' "$GATEWAY"   || fail "gateway.tf lacks the cognito-jwt-mobile authorizer — E08 must be merged before E09 (E00 §4)"
grep -Fq 'console_dev' "$COGNITO"          || fail "cognito.tf lacks the console_dev client — E08 must be merged before E09 (E00 §4)"
grep -Fq 'configuration_aliases' "$EDGE/main.tf" || fail "modules/edge/main.tf must declare configuration_aliases = [aws.use1] (E01, E00 §0)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
# 2a. root: variable, example, outputs, wiring, the zone import block, CORS origin
need   "$VARS" 'variable "domain"'
needre "$VARS" '^\s*default\s*=\s*"developercards\.app"'
needre "$EXAMPLE" '^\s*domain\s*=\s*"developercards\.app"'
for o in zone_name_servers api_hostname cdn_hostname console_hostname site_hostname site_distribution_id cloudfront_cert_arn api_cert_arn; do
  need "$OUTS" "output \"$o\""
done
needre "$MAIN" '^\s*to\s*=\s*module\.edge\.aws_route53_zone\.main\[0\]'
needre "$MAIN" "^\s*id\s*=\s*\"$ZONE_ID\""
needre "$MAIN" '^\s*domain\s*=\s*var\.domain\s*$'
needre "$MAIN" '^\s*manage_domain\s*=\s*true\s*$'
needre "$MAIN" '^\s*site_bucket_name\s*=\s*"developercards-site-622994489535"'
needre "$MAIN" '^\s*api_cert_arn\s*=\s*module\.edge\.api_cert_arn'
needre "$MAIN" '^\s*zone_id\s*=\s*module\.edge\.zone_id'
needre "$MAIN" '^\s*console_hostname\s*=\s*"console\.\$\{var\.domain\}"'
need   "$MAIN" '"https://console.${var.domain}"'
absent "$MAIN" 'aws_route53_zone.main"'
# imports.tf / backend / versions / providers / lock are frozen after E01 (E00 §1.1, §6 #20)
git diff --quiet "$mb" -- "$PROD/imports.tf" "$PROD/backend.tf" "$PROD/versions.tf" "$PROD/providers.tf" "$PROD/.terraform.lock.hcl" \
  || fail "imports.tf / backend.tf / versions.tf / providers.tf / .terraform.lock.hcl changed — E09 may not touch them (E00 §1.1)"
# 2b. edge interface (append-only variables/outputs)
for v in domain manage_domain cloudfront_cert_arn cdn_hostname console_hostname site_bucket_name; do
  need "$EDGE_VARS" "variable \"$v\""
done
for o in zone_id zone_name_servers cloudfront_cert_arn api_cert_arn site_distribution_id cdn_hostname console_hostname; do
  need "$EDGE_OUTS" "output \"$o\""
done
# 2c. dns.tf — adopted zone (count-guarded), data source for staging, alias records
need   "$DNS" 'resource "aws_route53_zone" "main"'
needre "$DNS" '^\s*count\s*=\s*var\.manage_domain \? 1 : 0'
needre "$DNS" '^\s*name\s*=\s*var\.domain\s*$'
needre "$DNS" '^\s*comment\s*=\s*"HostedZone created by Route53 Registrar"'
needre "$DNS" '^\s*prevent_destroy\s*=\s*true'
need   "$DNS" 'data "aws_route53_zone" "main"'
needre "$DNS" '^\s*count\s*=\s*var\.manage_domain \? 0 : 1'
for r in cdn console site_apex site_www; do need "$DNS" "resource \"aws_route53_record\" \"$r\""; done
needre "$DNS" '^\s*for_each\s*=\s*local\.record_types\s*$'
needre "$DNS" '^\s*for_each\s*=\s*local\.site_record_types\s*$'
needre "$DNS" '^\s*record_types\s*=\s*toset\(\["A", "AAAA"\]\)'
needre "$DNS" '^\s*site_record_types\s*=\s*var\.manage_domain \? local\.record_types : toset\(\[\]\)'
needre "$DNS" '^\s*cdn_hostname\s*=\s*var\.cdn_hostname != "" \? var\.cdn_hostname : "cdn\.\$\{var\.domain\}"'
needre "$DNS" '^\s*console_hostname\s*=\s*var\.console_hostname != "" \? var\.console_hostname : "console\.\$\{var\.domain\}"'
needre "$DNS" '^\s*zone_id\s*=\s*coalesce\(one\(aws_route53_zone\.main\[\*\]\.zone_id\), one\(data\.aws_route53_zone\.main\[\*\]\.zone_id\)\)'
needre "$DNS" '^\s*name\s*=\s*"www\.\$\{var\.domain\}"'
[ "$(count '^\s*evaluate_target_health\s*=\s*false' "$DNS")" -ge 4 ] || fail "dns.tf: every alias record sets evaluate_target_health = false"
# 2d. certs.tf — two wildcard certs, one shared validation CNAME, two validations
need "$CERTS" 'resource "aws_acm_certificate" "cloudfront"'
need "$CERTS" 'resource "aws_acm_certificate" "api"'
[ "$(count '^\s*provider\s*=\s*aws\.use1' "$CERTS")" -ge 2 ] || fail "certs.tf: the CloudFront certificate AND its validation use provider = aws.use1"
[ "$(count '^\s*domain_name\s*=\s*var\.domain\s*$' "$CERTS")" -ge 2 ] || fail "certs.tf: both certificates carry domain_name = var.domain"
[ "$(count '^\s*subject_alternative_names\s*=\s*\["\*\.\$\{var\.domain\}"\]' "$CERTS")" -ge 2 ] || fail "certs.tf: both certificates carry the wildcard SAN"
[ "$(count '^\s*validation_method\s*=\s*"DNS"' "$CERTS")" -ge 2 ] || fail "certs.tf: both certificates use DNS validation"
[ "$(count '^\s*create_before_destroy\s*=\s*true' "$CERTS")" -ge 2 ] || fail "certs.tf: both certificates need lifecycle create_before_destroy"
need   "$CERTS" 'resource "aws_route53_record" "cert_validation"'
need   "$CERTS" 'for dvo in flatten(aws_acm_certificate.cloudfront[*].domain_validation_options)'
need   "$CERTS" 'if dvo.domain_name == var.domain'
needre "$CERTS" '^\s*allow_overwrite\s*=\s*true'
need   "$CERTS" 'resource "aws_acm_certificate_validation" "cloudfront"'
need   "$CERTS" 'resource "aws_acm_certificate_validation" "api"'
[ "$(count '^\s*validation_record_fqdns\s*=\s*\[for r in aws_route53_record\.cert_validation : r\.fqdn\]' "$CERTS")" -ge 2 ] \
  || fail "certs.tf: both validations reference the shared cert_validation records"
needre "$CERTS" '^\s*cloudfront_cert_arn\s*=\s*var\.manage_domain \? one\(aws_acm_certificate_validation\.cloudfront\[\*\]\.certificate_arn\) : var\.cloudfront_cert_arn'
# 2e. cdn.tf — aliases + ACM viewer certificates on both adopted distributions
needre "$CDN" '^\s*aliases\s*=\s*\[local\.cdn_hostname\]'
needre "$CDN" '^\s*aliases\s*=\s*\[local\.console_hostname\]'
[ "$(count '^\s*acm_certificate_arn\s*=\s*local\.cloudfront_cert_arn' "$CDN")" -ge 2 ] || fail "cdn.tf: both distributions use the ACM certificate"
[ "$(count '^\s*ssl_support_method\s*=\s*"sni-only"' "$CDN")" -ge 2 ] || fail "cdn.tf: both distributions need sni-only"
[ "$(count '^\s*minimum_protocol_version\s*=\s*"TLSv1\.2_2021"' "$CDN")" -ge 2 ] || fail "cdn.tf: both distributions need TLSv1.2_2021"
absent "$CDN" 'cloudfront_default_certificate = true'
# 2f. site.tf — landing bucket set, OAC, distribution, policy (all count-guarded)
for r in 'resource "aws_s3_bucket" "site"' 'resource "aws_s3_bucket_public_access_block" "site"' \
         'resource "aws_s3_bucket_server_side_encryption_configuration" "site"' 'resource "aws_s3_bucket_ownership_controls" "site"' \
         'resource "aws_s3_bucket_versioning" "site"' 'resource "aws_s3_bucket_policy" "site"' \
         'resource "aws_cloudfront_origin_access_control" "site"' 'resource "aws_cloudfront_distribution" "site"'; do
  need "$SITE_TF" "$r"
done
[ "$(count '^\s*count\s*=\s*var\.manage_domain \? 1 : 0' "$SITE_TF")" -ge 8 ] || fail "site.tf: every site resource is count-guarded by var.manage_domain"
needre "$SITE_TF" '^\s*bucket\s*=\s*var\.site_bucket_name'
needre "$SITE_TF" '^\s*name\s*=\s*"developercards-site-oac"'
needre "$SITE_TF" '^\s*aliases\s*=\s*\[var\.domain, "www\.\$\{var\.domain\}"\]'
needre "$SITE_TF" '^\s*default_root_object\s*=\s*"index\.html"'
needre "$SITE_TF" '^\s*http_version\s*=\s*"http2and3"'
needre "$SITE_TF" '^\s*price_class\s*=\s*"PriceClass_All"'
needre "$SITE_TF" '^\s*cache_policy_id\s*=\s*"658327ea-f89d-4fab-a63d-7e88639e58f6"'
needre "$SITE_TF" '^\s*response_headers_policy_id\s*=\s*"67f7725c-6f97-4210-82d7-5512b31e9d03"'
[ "$(count '^\s*response_page_path\s*=\s*"/index\.html"' "$SITE_TF")" = "2" ] || fail "site.tf: 403 and 404 map to /index.html (200)"
needre "$SITE_TF" '^\s*minimum_protocol_version\s*=\s*"TLSv1\.2_2021"'
needre "$SITE_TF" '^\s*ssl_support_method\s*=\s*"sni-only"'
needre "$SITE_TF" '"AWS:SourceArn"\s*=\s*aws_cloudfront_distribution\.site\[0\]\.arn'
needre "$SITE_TF" '^\s*status\s*=\s*"Enabled"'
needre "$SITE_TF" '^\s*object_ownership\s*=\s*"BucketOwnerEnforced"'
needre "$SITE_TF" '^\s*sse_algorithm\s*=\s*"AES256"'
needre "$SITE_TF" '^\s*block_public_acls\s*=\s*true'
needre "$SITE_TF" '^\s*comment\s*=\s*"DeveloperCards landing page"'
# 2g. api module — custom domain, mapping to $default, alias records, interface
for v in domain api_hostname api_cert_arn zone_id; do need "$API_VARS" "variable \"$v\""; done
for o in api_hostname api_domain_target_domain_name api_domain_hosted_zone_id; do need "$API_OUTS" "output \"$o\""; done
need   "$GATEWAY" 'resource "aws_apigatewayv2_domain_name" "api"'
needre "$GATEWAY" '^\s*domain_name\s*=\s*local\.api_hostname'
needre "$GATEWAY" '^\s*certificate_arn\s*=\s*var\.api_cert_arn'
needre "$GATEWAY" '^\s*endpoint_type\s*=\s*"REGIONAL"'
needre "$GATEWAY" '^\s*security_policy\s*=\s*"TLS_1_2"'
need   "$GATEWAY" 'resource "aws_apigatewayv2_api_mapping" "api"'
needre "$GATEWAY" '^\s*stage\s*=\s*aws_apigatewayv2_stage\.default\.id'
absent "$GATEWAY" 'api_mapping_key'
need   "$GATEWAY" 'resource "aws_route53_record" "api"'
needre "$GATEWAY" '^\s*for_each\s*=\s*var\.zone_id == "" \? toset\(\[\]\) : toset\(\["A", "AAAA"\]\)'
need   "$GATEWAY" 'aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name'
need   "$GATEWAY" 'aws_apigatewayv2_domain_name.api.domain_name_configuration[0].hosted_zone_id'
needre "$GATEWAY" '^\s*api_hostname\s*=\s*var\.api_hostname != "" \? var\.api_hostname : "api\.\$\{var\.domain\}"'
absent "$GATEWAY" 'disable_execute_api_endpoint = true'
# 2h. identity — console callbacks (string input only, no module output)
need "$ID_VARS" 'variable "console_hostname"'
need "$COGNITO" '"https://${var.console_hostname}/auth/callback"'
need "$COGNITO" '"https://${var.console_hostname}/"'
need "$COGNITO" '"https://d12pfy1rhi3ekm.cloudfront.net/auth/callback"'
need "$COGNITO" 'var.console_hostname == "" ? []'
# 2i. no imperative escape hatches in any E09 .tf; no hard-coded profile; README §6 line
for f in "$DNS" "$CERTS" "$SITE_TF" "$CDN" "$GATEWAY" "$COGNITO" "$MAIN"; do
  if grep -Eq 'provisioner|local-exec|null_resource|"external"|archive_file' "$f"; then
    grep -En 'provisioner|local-exec|null_resource|"external"|archive_file' "$f" >&2 || true
    fail "$f: provisioner / local-exec / null_resource / external / archive_file are forbidden (E00 §0)"
  fi
done
[ -z "$(grep -rn 'profile *= *"' infra --include='*.tf' || true)" ] || fail "a provider block hard-codes profile (E00 §0)"
need "$INFRA_README" 'E09'
need "$INFRA_README" "$ZONE_ID"
# 2j. mobile — hosts.ts (pure, literal process.env members), apiClient fallback, three callers
need "$HOSTS" "export const DEFAULT_API_BASE = 'https://api.developercards.app';"
need "$HOSTS" "export const FALLBACK_API_BASE = 'https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com';"
need "$HOSTS" 'export type HostEnv = {'
need "$HOSTS" 'export function resolveApiBase(env: HostEnv = bundledEnv()): string'
need "$HOSTS" 'export function resolveApiFallback(env: HostEnv = bundledEnv()): string | null'
need "$HOSTS" 'EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,'
need "$HOSTS" 'EXPO_PUBLIC_API_BASE: process.env.EXPO_PUBLIC_API_BASE,'
need "$HOSTS" 'EXPO_PUBLIC_API_BASE_FALLBACK: process.env.EXPO_PUBLIC_API_BASE_FALLBACK,'
need "$HOSTS" "replace(/\\/+\$/, '')"
if grep -Eq "from 'react|require\(|AsyncStorage|Date\.now|Math\.random|fetch\(" "$HOSTS"; then
  fail "hosts.ts must stay pure (no react / require / storage / clock / randomness / fetch)"
fi
need "$CLIENT" "import { resolveApiBase, resolveApiFallback } from '../config/hosts';"
need "$CLIENT" 'let activeBase: string | null = null;'
need "$CLIENT" 'export function resetApiBaseForTests(): void'
need "$CLIENT" 'export async function apiJson<T>('
need "$CLIENT" 'e instanceof TypeError'
need "$CLIENT" 'base === primary && !!fallback && fallback !== primary && isNetworkError(e)'
need "$CLIENT" 'err.apiErrorCode ='
absent "$CLIENT" 'Missing EXPO_PUBLIC_API_BASE'
absent "$CLIENT" 'process.env.'
for f in "$HOME_REMOTE" "$PREMIUM_API" "$RC"; do
  [ "$(fcount 'resolveApiBase()' "$f")" = "1" ] || fail "$f must call resolveApiBase() exactly once"
  absent "$f" 'process.env.EXPO_PUBLIC_API_BASE'
done
need "$HOME_REMOTE" "import { resolveApiBase } from '../../../config/hosts';"
need "$PREMIUM_API" "import { resolveApiBase } from '../config/hosts';"
need "$RC" "import { resolveApiBase } from '../config/hosts';"
# only hosts.ts and the frozen deckRepository.ts may read the API env directly
readers="$(grep -rl 'process.env.EXPO_PUBLIC_API_BASE' mobile/src | sort | tr '\n' ' ')"
[ "$readers" = "mobile/src/config/hosts.ts mobile/src/content/deckRepository.ts " ] \
  || fail "process.env.EXPO_PUBLIC_API_BASE* may be read only by hosts.ts and the frozen deckRepository.ts; got: $readers"
# 2k. mobile tests — titles, harness
need "$HT" "from '../../src/config/hosts'"
need "$HT" "from 'fast-check'"
need "$HT" 'fc.assert('
for s in \
  'defaults to api.developercards.app when no env is set' \
  'prefers EXPO_PUBLIC_API_BASE_URL over EXPO_PUBLIC_API_BASE' \
  'trims whitespace and strips trailing slashes' \
  'treats a blank env value as unset' \
  'offers the legacy execute-api host as fallback only for the default base' \
  'honours EXPO_PUBLIC_API_BASE_FALLBACK verbatim (trimmed)' \
  'reads the bundled env through literal process.env members' \
  'never returns a trailing slash or surrounding whitespace (property)'; do
  grep -Fq "it('$s'" "$HT" || fail "missing hosts test case: $s"
done
need "$FT" "from '../../src/api/apiClient'"
need "$FT" 'resetApiBaseForTests()'
need "$FT" "new TypeError('Network request failed')"
need "$FT" "name: 'AbortError'"
need "$FT" 'globalThis.fetch = vi.fn('
for s in \
  'calls the primary host once on success' \
  'retries once on the fallback host after a network error on the primary' \
  'does not retry on an HTTP error status' \
  'does not retry on a timeout abort' \
  'remembers the working host for later calls in the process' \
  'never retries when the fallback is disabled by a custom base' \
  'propagates the network error when the fallback also fails' \
  'keeps Authorization and JSON body on the retried request'; do
  grep -Fq "it('$s'" "$FT" || fail "missing apiClientFallback test case: $s"
done
[ "$(count "^\s*it\(" "$HT")" -ge 8 ] || fail "hosts.test.ts needs >= 8 it() blocks"
[ "$(count "^\s*it\(" "$FT")" -ge 8 ] || fail "apiClientFallback.test.ts needs >= 8 it() blocks"
# 2l. console config + deploy script
need "$ENV_PROD" 'VITE_API_BASE=https://api.developercards.app'
need "$ENV_PROD" 'VITE_COGNITO_REDIRECT_URI=https://console.developercards.app/auth/callback'
need "$ENV_PROD" 'VITE_COGNITO_LOGOUT_URI=https://console.developercards.app/'
need "$ENV_PROD" "VITE_COGNITO_CLIENT_ID=$SPA_CLIENT"
absent "$ENV_PROD" 'execute-api'
absent "$ENV_PROD" 'VITE_COGNITO_REDIRECT_URI=https://d12pfy1rhi3ekm'
dev_id="$(sed -n 's/^VITE_COGNITO_CLIENT_ID=//p' "$ENV_DEV" | tr -d '[:space:]')"
[[ "$dev_id" =~ ^[a-z0-9]{26}$ ]] || fail ".env.development: VITE_COGNITO_CLIENT_ID must be a 26-char Cognito client id (got '$dev_id')"
[ "$dev_id" != "$SPA_CLIENT" ] || fail ".env.development still uses the spa client; it must use the console-dev client (E08, E00 §2.9.5)"
grep -Fq "$dev_id" "$INFRA_README" || fail ".env.development client id $dev_id is not recorded in infra/README.md §6 (supervisor pastes it after E08's apply)"
need "$ENV_DEV" 'VITE_COGNITO_REDIRECT_URI=http://localhost:5173/auth/callback'
need "$FE_DEPLOY" 'CONSOLE_URL="${CONSOLE_URL:-https://console.developercards.app}"'
need "$FE_DEPLOY" 'curl -fsSL "$CONSOLE_URL/index.html"'
absent "$FE_DEPLOY" 'curl -fsSL "https://d12pfy1rhi3ekm.cloudfront.net/index.html"'
# 2m. landing page — pinned content (launch copy :127, :136, :165-183, :188-189), links, structure
need "$SITE_HTML" '<!DOCTYPE html>'
need "$SITE_HTML" '<html lang="en">'
need "$SITE_HTML" '<meta charset="utf-8">'
need "$SITE_HTML" '<meta name="viewport" content="width=device-width, initial-scale=1">'
need "$SITE_HTML" '<title>DeveloperCards</title>'
need "$SITE_HTML" '<link rel="stylesheet" href="styles.css">'
need "$SITE_HTML" '<h1>Every pull is earned. Every pull is new.</h1>'
[ "$(fcount 'DeveloperCards: spaced-repetition flashcards for developers where card packs are earned by studying, never bought, and never deal a duplicate. 81 C# / .NET + 154 AWS SAA-C03 cards, free, iOS.' "$SITE_HTML")" -ge 2 ] \
  || fail "index.html: the EN one-liner must appear as meta description and as the lede"
need "$SITE_HTML" 'href="https://apps.apple.com/app/id6756044885"'
need "$SITE_HTML" 'Prepping a .NET interview or the AWS SAA-C03? DeveloperCards turns the prep into a collection you build by showing up.'
for h in "WHAT'S INSIDE" 'HOW PULLS WORK' 'HOW STUDY WORKS' 'FROM ONE DEVELOPER'; do need "$SITE_HTML" "<h2>$h</h2>"; done
need "$SITE_HTML" 'Two free decks, both in English:'
need "$SITE_HTML" 'C# / .NET &mdash; 81 interview cards, fundamentals to intermediate (async/await, boxing, controllers, OOP and more) with a C# code snippet on essentially every card.'
need "$SITE_HTML" 'AWS Associate Architect &mdash; 154 scenario-style SAA-C03 cards (S3 storage classes, ElastiCache Multi-AZ, IAM, Lambda and more) with a real-world usage note on nearly every card.'
need "$SITE_HTML" 'Rarity is difficulty: Common, Rare and Legendary map to how hard the question is, so a Legendary is one of the hardest questions in the deck.'
need "$SITE_HTML" 'Pulls are earned, never sold. Learn a new card, earn a pull: the first time you rate a card Hard, Good or Easy, one pull lands in your wallet, no claim button. Clearing everything due for the day adds one more, once a day. New players start with 3 pulls, so the first pack opens in seconds.'
need "$SITE_HTML" 'Never a duplicate. The draw pool is only the cards missing from your collection.'
need "$SITE_HTML" 'Pity: after 10 Commons in a row, the next card is Rare or better, as long as an unowned Rare or Legendary is still in the pack.'
need "$SITE_HTML" 'Open 1 or Open 10. You are only charged for cards you actually receive.'
need "$SITE_HTML" 'Your wallet holds up to 60 pulls plus a 5-pull reserve. If you ever have nothing left to study and no pulls, you get 1 pull a day.'
need "$SITE_HTML" 'Every draw is seeded and replayable, so the app can show why you got what you got.'
need "$SITE_HTML" 'Rip the foil, watch the cards drop, tap to flip. Rare and Legendary reveals get their own sound and haptics.'
need "$SITE_HTML" 'Rate each card Again / Hard / Good / Easy. Cards return on a 7-stage ladder of 1, 2, 4, 8, 15, 30 and 60 days; a card is Mastered once it reaches the 15-day stage. Reviewing a single card keeps your streak alive. Streaks and milestones are tracked; the Library shows each card as New, Learning or Mastered.'
need "$SITE_HTML" 'DeveloperCards is an indie project: one person built the app and the backend and writes or edits every card by hand. Both decks are free. A monthly Premium subscription exists for future premium decks, but there is nothing premium to unlock yet. Next up: more decks. Feedback is welcome.'
need "$SITE_HTML" '<a href="https://github.com/ChuanQiao1128/recallsmith">Source</a>'
need "$SITE_HTML" '<a href="https://github.com/ChuanQiao1128/recallsmith/issues">Support</a>'
absent "$SITE_HTML" 'OFFLINE, NO ACCOUNT NEEDED'
absent "$SITE_HTML" 'cloud backup'
absent "$SITE_CSS" '@import'
absent "$SITE_CSS" 'url('
# 2n. site/deploy.sh — supervisor-only script, DRY_RUN-guarded
need "$SITE_DEPLOY" 'set -euo pipefail'
need "$SITE_DEPLOY" 'BUCKET="${SITE_BUCKET:-developercards-site-622994489535}"'
need "$SITE_DEPLOY" 'DIST_ID="${SITE_DISTRIBUTION_ID:-}"'
need "$SITE_DEPLOY" 'SITE_URL="${SITE_URL:-https://developercards.app}"'
need "$SITE_DEPLOY" '--exclude deploy.sh'
need "$SITE_DEPLOY" 'if [ "${DRY_RUN:-0}" = 1 ]; then'
need "$SITE_DEPLOY" "--paths '/*'"
need "$SITE_DEPLOY" 'shasum -a 256'
# 2o. suppression / gutting across every E09 code file
if grep -Eq '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "$HOSTS" "$CLIENT" "$HOME_REMOTE" "$PREMIUM_API" "$RC" "$HT" "$FT"; then
  grep -En '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "$HOSTS" "$CLIENT" "$HOME_REMOTE" "$PREMIUM_API" "$RC" "$HT" "$FT" >&2 || true
  fail "test gutting / suppression found"
fi
# 2p. the allow file equals (as JSON) the brief's "Changes required" #12
python3 - "$ALLOW" <<'PY' || fail "E09.plan-allow.json differs from the brief's pinned allow-list"
import json, sys
got = json.load(open(sys.argv[1]))
exp = {
  "tags_only_updates": True,
  "changes": {
    "module.edge.aws_acm_certificate.cloudfront[0]": "create",
    "module.edge.aws_acm_certificate.api[0]": "create",
    "module.edge.aws_route53_record.cert_validation[\"apex\"]": "create",
    "module.edge.aws_acm_certificate_validation.cloudfront[0]": "create",
    "module.edge.aws_acm_certificate_validation.api[0]": "create",
    "module.edge.aws_route53_record.cdn[\"A\"]": "create",
    "module.edge.aws_route53_record.cdn[\"AAAA\"]": "create",
    "module.edge.aws_route53_record.console[\"A\"]": "create",
    "module.edge.aws_route53_record.console[\"AAAA\"]": "create",
    "module.edge.aws_route53_record.site_apex[\"A\"]": "create",
    "module.edge.aws_route53_record.site_apex[\"AAAA\"]": "create",
    "module.edge.aws_route53_record.site_www[\"A\"]": "create",
    "module.edge.aws_route53_record.site_www[\"AAAA\"]": "create",
    "module.edge.aws_s3_bucket.site[0]": "create",
    "module.edge.aws_s3_bucket_public_access_block.site[0]": "create",
    "module.edge.aws_s3_bucket_server_side_encryption_configuration.site[0]": "create",
    "module.edge.aws_s3_bucket_ownership_controls.site[0]": "create",
    "module.edge.aws_s3_bucket_versioning.site[0]": "create",
    "module.edge.aws_s3_bucket_policy.site[0]": "create",
    "module.edge.aws_cloudfront_origin_access_control.site[0]": "create",
    "module.edge.aws_cloudfront_distribution.site[0]": "create",
    "module.edge.aws_cloudfront_distribution.content": {"action": "update", "keys": ["aliases", "viewer_certificate"]},
    "module.edge.aws_cloudfront_distribution.console": {"action": "update", "keys": ["aliases", "viewer_certificate"]},
    "module.api.aws_apigatewayv2_domain_name.api": "create",
    "module.api.aws_apigatewayv2_api_mapping.api": "create",
    "module.api.aws_route53_record.api[\"A\"]": "create",
    "module.api.aws_route53_record.api[\"AAAA\"]": "create",
    "module.api.aws_apigatewayv2_api.http": {"action": "update", "keys": ["cors_configuration"]},
    "module.identity.aws_cognito_user_pool_client.spa[0]": {"action": "update", "keys": ["callback_urls", "logout_urls"]}
  },
  "outputs": ["zone_name_servers", "api_hostname", "cdn_hostname", "console_hostname", "site_hostname",
              "site_distribution_id", "cloudfront_cert_arn", "api_cert_arn"]
}
if got != exp:
    for k in sorted(set(exp["changes"]) ^ set(got.get("changes", {}))):
        print("allow-list address mismatch:", k, file=sys.stderr)
    sys.exit(1)
PY

# ── 3. Root gates ──────────────────────────────────────────────────────────
echo "[3/5] gates: terraform fmt/init/validate, tsc, frontend lint+build, bash -n"
terraform fmt -check -recursive infra >/dev/null || fail "terraform fmt -check -recursive infra failed (run terraform fmt -recursive infra)"
( cd "$PROD" && terraform init -backend=false -input=false >/dev/null && terraform validate >/dev/null && terraform fmt -check -recursive .. >/dev/null ) \
  || fail "infra root gate failed (init -backend=false / validate / fmt in $PROD)"
( cd mobile && npm run test:typecheck ) || fail "mobile typecheck failed"
( cd frontend && npm run lint && npm run build ) || fail "frontend lint/build failed (.env.production must still parse and build)"
bash -n "$SITE_DEPLOY" || fail "site/deploy.sh: bash -n failed"
bash -n "$FE_DEPLOY"   || fail "frontend/deploy.sh: bash -n failed"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$ALLOW" || fail "$ALLOW is not valid JSON"
python3 -m py_compile "$CHECKER" || fail "check-plan.py does not compile"

# ── 4. Read-only plan (real backend, -lock=false) → check-plan.py + strict shape check ──
echo "[4/5] terraform plan (read-only, real backend, -lock=false) -> check-plan.py + shape assertions; vitest; site; DRY_RUN"
# 4a. Same recipe as E04/E06/E08.verify.sh: the remote state is READ (s3:GetObject), never locked or
# written (-lock=false), so this plan is the supervisor's plan and E09.plan-allow.json applies verbatim.
aws sts get-caller-identity --query Account --output text >"$TMP/acct.txt" 2>&1 || fail "AWS credentials unavailable (export AWS_PROFILE=dev, read-only)"
[ "$(tr -d '[:space:]' <"$TMP/acct.txt")" = "622994489535" ] || fail "wrong AWS account for the plan"
# Root variables without defaults are answered from the .example file; the two live-dependent ones
# (alert_email from the budget subscriber, snowflake_external_id from iam get-role) are replaced with
# the live values so no unlisted update appears. Written to $TMP only, never printed.
VARFILE="$TMP/e09.auto.tfvars"
if [ -f "$EXAMPLE" ]; then cp "$EXAMPLE" "$VARFILE"; else : > "$VARFILE"; fi
if grep -Fq 'variable "alert_email"' "$VARS" && [ -z "${TF_VAR_alert_email:-}" ]; then
  notif="$(aws budgets describe-notifications-for-budget --account-id 622994489535 --budget-name "My Monthly Cost Budget" --query 'Notifications[0]' --output json 2>/dev/null || true)"
  if [ -n "$notif" ] && [ "$notif" != "null" ]; then
    TF_VAR_alert_email="$(aws budgets describe-subscribers-for-notification --account-id 622994489535 --budget-name "My Monthly Cost Budget" --notification "$notif" --query 'Subscribers[?SubscriptionType==`EMAIL`]|[0].Address' --output text 2>/dev/null || true)"
  fi
  [ -n "${TF_VAR_alert_email:-}" ] && [ "$TF_VAR_alert_email" != "None" ] || unset TF_VAR_alert_email
fi
if [ -n "${TF_VAR_alert_email:-}" ]; then
  grep -v '^[[:space:]]*alert_email[[:space:]]*=' "$VARFILE" > "$VARFILE.tmp" || true; mv "$VARFILE.tmp" "$VARFILE"
  printf 'alert_email = "%s"\n' "$TF_VAR_alert_email" >> "$VARFILE"
fi
if grep -Fq 'variable "snowflake_external_id"' "$VARS" && [ -z "${TF_VAR_snowflake_external_id:-}" ]; then
  TF_VAR_snowflake_external_id="$(aws iam get-role --role-name snowflake-recallsmith-s3-role --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
  [ -n "$TF_VAR_snowflake_external_id" ] && [ "$TF_VAR_snowflake_external_id" != "None" ] || unset TF_VAR_snowflake_external_id
fi
if [ -n "${TF_VAR_snowflake_external_id:-}" ]; then
  grep -v '^[[:space:]]*snowflake_external_id[[:space:]]*=' "$VARFILE" > "$VARFILE.tmp" || true; mv "$VARFILE.tmp" "$VARFILE"
  printf 'snowflake_external_id = "%s"\n' "$TF_VAR_snowflake_external_id" >> "$VARFILE"
fi
unset TF_VAR_alert_email TF_VAR_snowflake_external_id
( cd "$PROD" \
  && terraform init -input=false -reconfigure >/dev/null \
  && terraform plan -lock=false -input=false -refresh=true -var-file="$VARFILE" -out="$TMP/e09.tfplan" >"$TMP/plan.log" 2>&1 \
  && terraform show -json "$TMP/e09.tfplan" > "$TMP/e09.plan.json" ) \
  || { grep -E '^(Error|│ Error|Plan:)' "$TMP/plan.log" >&2 || true; fail "terraform init/plan/show failed (real backend, read-only; E01–E08 must be applied and their second plan empty)"; }
grep -E '^Plan:' "$TMP/plan.log" >&2 || true
rm -f "$VARFILE"
git diff --quiet -- "$PROD/.terraform.lock.hcl" || fail "terraform init changed .terraform.lock.hcl (the lock must already carry this platform's hash)"
python3 "$CHECKER" --plan "$TMP/e09.plan.json" --allow "$ALLOW" || fail "check-plan.py rejected the plan against the committed E09.plan-allow.json"
# Independent strict check (does not trust check-plan.py): every effective managed change is listed
# with its action; update keys are compared after masking after_unknown (computed attributes such as
# etag / status never count); the zone is the only `importing` entry; output_changes == the 8 new
# outputs; shape assertions on hostnames. Prints addresses, actions, key names, hostnames only.
python3 - "$TMP/e09.plan.json" "$ALLOW" <<'PY' || fail "plan shape check failed"
import json, sys
plan = json.load(open(sys.argv[1]))
allow = json.load(open(sys.argv[2]))
changes = allow["changes"]
tags_only = bool(allow.get("tags_only_updates"))
ZONE = "module.edge.aws_route53_zone.main[0]"
def mask(val, unk):
    """Drop from `val` every leaf that `after_unknown` marks unknown."""
    if unk is True:
        return None
    if isinstance(unk, dict) and isinstance(val, dict):
        return {k: (mask(v, unk[k]) if k in unk else v) for k, v in val.items() if unk.get(k) is not True}
    if isinstance(unk, list) and isinstance(val, list):
        return [mask(v, unk[i]) if i < len(unk) else v for i, v in enumerate(val)]
    return val
def known_diff(ch):
    before = ch.get("before") or {}
    after = ch.get("after") or {}
    unk = ch.get("after_unknown") or {}
    bm = mask(before, unk) or {}
    return {k for k in set(bm) | set(after) if unk.get(k) is not True and bm.get(k) != after.get(k)}
after_of, seen, importing, bad, eff = {}, set(), set(), [], 0
for rc in plan.get("resource_changes", []):
    if rc.get("mode") != "managed":
        continue
    addr, ch = rc["address"], rc["change"]
    actions = ch.get("actions", [])
    seen.add(addr)
    after_of[addr] = ch.get("after") or {}
    if ch.get("importing"):
        importing.add(addr)
    if actions == ["no-op"]:
        continue
    eff += 1
    act = "replace" if set(actions) == {"delete", "create"} else actions[0]
    diff = known_diff(ch) if act == "update" else set()
    spec = changes.get(addr)
    if spec is not None:
        want = spec if isinstance(spec, str) else spec["action"]
        if want != act:
            bad.append(f"{addr}: planned {act}, allowed {want}"); continue
        if isinstance(spec, dict) and not diff <= set(spec.get("keys", [])):
            bad.append(f"{addr}: changed keys {sorted(diff)} exceed allowed {spec.get('keys')}"); continue
        print(f"{addr:88s} {act:8s} {sorted(diff)}"); continue
    if act == "update" and tags_only and diff and diff <= {"tags", "tags_all"}:
        print(f"{addr:88s} update   tags-only"); continue
    bad.append(f"{addr}: {act} {sorted(diff)} is not in the E09 allow-list")
for addr in changes:
    if addr not in seen:
        bad.append(f"{addr}: listed in the allow-list but absent from the plan")
if importing != {ZONE}:
    bad.append(f"importing entries must be exactly the zone; got {sorted(importing)}")
outs = {n: oc.get("actions") for n, oc in (plan.get("output_changes") or {}).items() if oc.get("actions") != ["no-op"]}
if set(outs) != set(allow["outputs"]) or any(a != ["create"] for a in outs.values()):
    bad.append(f"output_changes must be exactly the 8 new outputs (create); got {sorted(outs)}")
def a(addr): return after_of.get(addr) or {}
def first(lst): return (lst or [{}])[0] if isinstance(lst, list) else {}
checks = [
  (a("module.edge.aws_cloudfront_distribution.content").get("aliases") == ["cdn.developercards.app"], "content aliases"),
  (a("module.edge.aws_cloudfront_distribution.console").get("aliases") == ["console.developercards.app"], "console aliases"),
  (sorted(a("module.edge.aws_cloudfront_distribution.site[0]").get("aliases") or []) == ["developercards.app", "www.developercards.app"], "site aliases"),
  (a("module.api.aws_apigatewayv2_domain_name.api").get("domain_name") == "api.developercards.app", "api domain name"),
  (first(a("module.api.aws_apigatewayv2_domain_name.api").get("domain_name_configuration")).get("endpoint_type") == "REGIONAL", "api endpoint_type"),
  (first(a("module.api.aws_apigatewayv2_domain_name.api").get("domain_name_configuration")).get("security_policy") == "TLS_1_2", "api security_policy"),
  (a("module.api.aws_apigatewayv2_api_mapping.api").get("stage") == "$default", "mapping stage"),
  # 2026-09-26: provider 6.x folds the apex into the planned SAN set -> set check, not list equality
  (a("module.edge.aws_acm_certificate.cloudfront[0]").get("domain_name") == "developercards.app" and {"*.developercards.app"} <= set(a("module.edge.aws_acm_certificate.cloudfront[0]").get("subject_alternative_names") or []) <= {"*.developercards.app", "developercards.app"}, "cloudfront cert names"),
  (a("module.edge.aws_acm_certificate.api[0]").get("domain_name") == "developercards.app" and {"*.developercards.app"} <= set(a("module.edge.aws_acm_certificate.api[0]").get("subject_alternative_names") or []) <= {"*.developercards.app", "developercards.app"}, "api cert names"),
  ({"https://console.developercards.app", "https://d12pfy1rhi3ekm.cloudfront.net"} <= set(first(a("module.api.aws_apigatewayv2_api.http").get("cors_configuration")).get("allow_origins") or []), "cors origins"),
  ({"https://console.developercards.app/auth/callback", "https://d12pfy1rhi3ekm.cloudfront.net/auth/callback"} <= set(a("module.identity.aws_cognito_user_pool_client.spa[0]").get("callback_urls") or []), "spa callback_urls"),
  ({"https://console.developercards.app/", "https://d12pfy1rhi3ekm.cloudfront.net/"} <= set(a("module.identity.aws_cognito_user_pool_client.spa[0]").get("logout_urls") or []), "spa logout_urls"),
  (a("module.edge.aws_s3_bucket.site[0]").get("bucket") == "developercards-site-622994489535", "site bucket name"),
  (a(ZONE).get("name") == "developercards.app", "zone name"),
]
for ok, label in checks:
    print(f"shape {label}: {ok}")
    if not ok: bad.append(f"shape assertion failed: {label}")
if bad:
    print("\n".join(bad), file=sys.stderr); sys.exit(1)
print(f"PLAN OK {eff} effective, 1 importing (zone), {len(outs)} new outputs")
PY
rm -f "$TMP/e09.tfplan" "$TMP/e09.plan.json"
# 4b. The console-dev client id in .env.development matches the live client named console-dev (read-only).
live_dev_id="$(aws cognito-idp list-user-pool-clients --user-pool-id "$CONSOLE_POOL" --max-results 60 \
  --query "UserPoolClients[?ClientName=='console-dev'].ClientId | [0]" --output text 2>/dev/null || true)"
{ [ -n "$live_dev_id" ] && [ "$live_dev_id" != "None" ]; } || fail "no live app client named console-dev on $CONSOLE_POOL — E08 must be applied before E09 (E00 §4)"
[ "$live_dev_id" = "$dev_id" ] || fail ".env.development VITE_COGNITO_CLIENT_ID=$dev_id but the live console-dev client is $live_dev_id"
# 4c. Mobile targeted vitest
( cd mobile && npx vitest run tests/unit/hosts.test.ts tests/unit/apiClientFallback.test.ts --reporter=dot ) || fail "mobile targeted vitest failed"
# 4d. Frontend targeted vitest (E00 §3.3 list for E09)
( cd frontend && npx vitest run tests/uiLanguage.test.ts tests/deckFormFieldDrop.test.tsx tests/newDeckPage.test.tsx tests/docsPaths.test.ts tests/rootReadmePaths.test.ts --reporter=dot ) \
  || fail "frontend targeted vitest failed"
# 4e. Site: ASCII only, well-formed, tag/href whitelist, no script/img/style/on*, red lines
python3 - "$SITE_HTML" "$SITE_CSS" <<'PY' || fail "site checks failed"
import sys
from html.parser import HTMLParser
html_path, css_path = sys.argv[1], sys.argv[2]
for p in (html_path, css_path):
    open(p, "rb").read().decode("ascii")   # raises on any non-ASCII byte
VOID = {"meta", "link", "br", "hr"}
ALLOWED = {"html", "head", "meta", "title", "link", "body", "main", "header", "p", "h1", "h2", "a", "section", "ul", "li", "footer"}
HREFS = {"styles.css", "https://apps.apple.com/app/id6756044885",
         "https://github.com/ChuanQiao1128/recallsmith", "https://github.com/ChuanQiao1128/recallsmith/issues"}
class P(HTMLParser):
    def __init__(self):
        super().__init__(); self.stack = []; self.bad = []
    def handle_starttag(self, tag, attrs):
        if tag not in ALLOWED: self.bad.append(f"tag <{tag}> not allowed")
        for k, v in attrs:
            if k.startswith("on") or k in ("src", "style"): self.bad.append(f"attribute {k} on <{tag}> not allowed")
            if k == "href" and v not in HREFS: self.bad.append(f"href {v!r} not in the whitelist")
        if tag not in VOID: self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in VOID: return
        if not self.stack or self.stack[-1] != tag: self.bad.append(f"unbalanced </{tag}> (open: {self.stack})")
        else: self.stack.pop()
p = P(); p.feed(open(html_path, encoding="ascii").read()); p.close()
if p.stack: p.bad.append(f"unclosed tags: {p.stack}")
if p.bad:
    print("\n".join(p.bad), file=sys.stderr); sys.exit(1)
print("site: ascii, balanced, whitelist ok")
PY
[ "$(grep -c '<script' "$SITE_HTML" || true)" = "0" ] || fail "index.html contains <script>"
# Red lines of the launch copy (E00 §2.9.6), case-insensitive, over both files.
if grep -Eiq 'thousands|android|google play|three decks|official|guarantee|fsrs|sm-2|anki|epic|trial|verified against' "$SITE_HTML" "$SITE_CSS"; then
  grep -Ein 'thousands|android|google play|three decks|official|guarantee|fsrs|sm-2|anki|epic|trial|verified against' "$SITE_HTML" "$SITE_CSS" >&2 || true
  fail "landing page hits a launch-copy red line"
fi
# 4f. DRY_RUN run of site/deploy.sh with a stub `aws` on PATH: it must print the DRY lines and never call aws.
mkdir -p "$TMP/bin"; printf '#!/bin/sh\necho "aws must not run under DRY_RUN" >&2; exit 99\n' > "$TMP/bin/aws"; chmod +x "$TMP/bin/aws"
dry="$(PATH="$TMP/bin:$PATH" DRY_RUN=1 bash "$SITE_DEPLOY")" || fail "DRY_RUN=1 site/deploy.sh exited non-zero (it must not call aws)"
printf '%s\n' "$dry" | grep -Fq -- 'DRY: aws s3 sync' || fail "DRY_RUN=1 site/deploy.sh did not print the sync command"
printf '%s\n' "$dry" | grep -Fq -- 'DRY: aws cloudfront cre''ate-invalidation' || fail "DRY_RUN=1 site/deploy.sh did not print the invalidation command"
# frontend/deploy.sh's DRY_RUN path runs `npm run build` first (already built in step 3) — bash -n only.

# ── 5. Scope + frozen + OTA + apply/secret guards ──────────────────────────
echo "[5/5] scope + frozen + OTA + apply/secret guards"
# 5a. frozen files (E00 §0) and the OTA set
git diff --quiet "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "a frozen file changed (deckRepository.ts / progressSync.ts / model.ts)"
git diff --quiet "$mb" -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  || fail "OTA guard: package.json / package-lock.json / app.json / eas.json changed"
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version is not 1.6.1"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary, not this wave)"; fi
grep -Fq "https://d1ditdi9jqpy6n.cloudfront.net" mobile/src/content/deckRepository.ts || fail "deckRepository.ts lost its CloudFront default"
# 5b. the three callers: exactly the four-line env literal removed, <= 3 lines added
for f in "$HOME_REMOTE" "$PREMIUM_API" "$RC"; do
  ns="$(git diff --numstat "$mb" -- "$f" | cut -f1,2)"
  add="${ns%%${TAB}*}"; del="${ns##*${TAB}}"
  # 2026-09-26: check 2o forbids @ts-ignore anywhere in these files, so pre-existing dead
  # `// @ts-ignore` comment lines may also be removed; they do not count toward the four.
  ign="$(git diff -U0 "$mb" -- "$f" | grep -E '^-[^-]' | grep -cE '^-[[:space:]]*// @ts-ignore[[:space:]]*$' || true)"
  del=$(( ${del:-0} - ${ign:-0} ))
  [ "${del:-0}" = "4" ] || fail "$f: expected exactly 4 removed lines (the env literal), got '${ns:-<no diff>}'"
  [ "${add:-0}" -le 3 ] || fail "$f: expected <= 3 added lines (import + resolveApiBase()), got $add"
done
# 5c. every changed or untracked path is in the E09 scope. Pathspec-scoped, never bare:
# the driver symlinks mobile/node_modules and frontend/node_modules into the worktree.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- infra mobile/src mobile/tests frontend/src frontend/tests frontend/.env.production frontend/.env.development frontend/deploy.sh site docs; } \
  | sort -u | grep -Ev '^(infra/envs/prod/(main|variables|outputs)\.tf|infra/envs/prod/prod\.auto\.tfvars\.example|infra/modules/edge/(dns|certs|site|cdn|variables|outputs)\.tf|infra/modules/api/(gateway|variables|outputs)\.tf|infra/modules/identity/(cognito|variables|outputs)\.tf|infra/README\.md|mobile/src/config/hosts\.ts|mobile/src/api/apiClient\.ts|mobile/src/features/gacha/home/homeRemote\.ts|mobile/src/content/premiumDeckApi\.ts|mobile/src/premium/revenuecat\.ts|mobile/tests/unit/hosts\.test\.ts|mobile/tests/unit/apiClientFallback\.test\.ts|frontend/\.env\.production|frontend/\.env\.development|frontend/deploy\.sh|site/(index\.html|styles\.css|deploy\.sh)|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E09 scope"; }
# 5d. no plan / state / tfvars artefact tracked; no secret literal in added lines
[ -z "$(git ls-files infra | grep -E '\.(tfplan|plan\.json|tfstate)$|generated.*\.tf$|[^e]\.auto\.tfvars$' || true)" ] || fail "a plan/state/tfvars artefact is tracked under infra"
if git diff -U0 "$mb" HEAD -- infra mobile/src frontend site | grep -E '^\+[^+]' \
   | grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]'; then
  fail "a secret literal appears in an added line"
fi
# 5e. apply guard: no worker artefact (every E09 file except the two supervisor-only deploy
# scripts, which are DRY_RUN-guarded and exercised above) runs an apply / a state-changing
# import command / a mutating aws call outside a comment. The pattern is assembled from
# pieces so this script's own source never spells the forbidden commands.
PAT="terraform +(app""ly|imp""ort)|aws +[a-z0-9-]+ +(cre""ate|upd""ate|del""ete|pu""t)-"
hits="$(grep -nE "$PAT" "$DNS" "$CERTS" "$SITE_TF" "$CDN" "$GATEWAY" "$COGNITO" "$MAIN" "$VARS" "$OUTS" "$EXAMPLE" \
          "$EDGE_VARS" "$EDGE_OUTS" "$API_VARS" "$API_OUTS" "$ID_VARS" "$HOSTS" "$CLIENT" "$HOME_REMOTE" "$PREMIUM_API" "$RC" "$HT" "$FT" \
          "$ENV_PROD" "$ENV_DEV" "$SITE_HTML" "$SITE_CSS" "$ALLOW" 2>/dev/null \
        | grep -vE '^[^:]+:[0-9]+:\s*(#|//|\*|<!--)' || true)"
[ -z "$hits" ] || { echo "$hits" >&2; fail "a worker artefact carries an apply / state-changing import / mutating aws command outside a comment"; }
# The two deploy scripts may name them only after the DRY_RUN block or inside a DRY echo.
for s in "$SITE_DEPLOY" "$FE_DEPLOY"; do
  dryline="$(grep -nF 'if [ "${DRY_RUN:-0}" = 1 ]; then' "$s" | head -1 | cut -d: -f1)"
  [ -n "$dryline" ] || fail "$s has no DRY_RUN block"
  early="$(head -n "$dryline" "$s" | grep -nE "$PAT" | grep -vE '^[0-9]+:\s*#' || true)"
  [ -z "$early" ] || { echo "$early" >&2; fail "$s runs a mutating aws command before the DRY_RUN check"; }
done

echo "E09 VERIFY OK"
