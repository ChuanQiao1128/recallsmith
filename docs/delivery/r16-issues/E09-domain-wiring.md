# E09 — domain wiring (`domain-wiring`)

Put the product on `developercards.app`: adopt the Route 53 zone the registrar created today, issue two DNS-validated wildcard certificates (us-east-1 for CloudFront, ap-southeast-2 for API Gateway), give the two adopted distributions their `cdn.` / `console.` aliases, map `api.developercards.app` onto the HTTP API's `$default` stage, add the console hostname to the API's CORS list and the Cognito `spa` client's callbacks, stand up a static landing page (private S3 + CloudFront) at the apex and `www`, switch the console's committed build config to the new hostnames, and make the four non-frozen mobile callers resolve `https://api.developercards.app` by default with a one-shot runtime fallback to the legacy `execute-api` host. Terraform only, plan-checked; the supervisor applies. Mobile changes are pure TS shipped OTA on runtime 1.6.1; the frozen `deckRepository.ts` keeps its defaults, and every legacy AWS hostname keeps working.

## Context

Base: `delivery/r16-e-prod` (== `main@4b07f19`, 2026-09-22). Every `file:line` below was read on that tree on 2026-09-22; every AWS fact was read the same day with `AWS_PROFILE=dev` (account `622994489535`), describe/get/list only. `docs/delivery/r16-issues/E00-contracts.md` (E00) is binding: §0 (`:9-35`), §1.1 rows for `infra/envs/prod/*`, `modules/edge`, `modules/api`, `modules/identity` (`:53`, `:55`, `:58`, `:62-64`), §1.2 rows for `frontend/.env.*`, `mobile/src/config/hosts.ts`, `site/*` (`:100-103`), §2.1.1 module interfaces (`:147-158`), §2.1.2 addresses (`:172`), §2.1.3 names (`:207`), §2.8 (`:331`, the `console_dev` client and the `spa` callbacks E08 leaves), **§2.9 (`:334-349`, this issue's contract)**, §2.10.1 (`:353`, what staging will reuse), §3.1 (`:419-430`), §3.3 (`:438`), §5 (`:470-480`), §6 #3, #7, #13, #16, #20, #21, #23, #24 (`:488`, `:492`, `:498`, `:501`, `:505-506`, `:508-509`). The review finding is `docs/backend-architecture-review-2026-09-22.md` §2.4.6 (`:137`; §1 table `:62` "无 custom domain"; §3 row `:202`).

What the account and the tree look like today:

- **The domain already exists on AWS — adopt, do not create.** `aws route53domains list-domains --region us-east-1` → `developercards.app`, registered 2026-09-22 18:19 NZST through Route 53 Domains, expiry 2027-09-22, auto-renew on. `aws route53 list-hosted-zones` → one zone, `Z0284954BSN00C8BF94Q` (`developercards.app.`), comment `HostedZone created by Route53 Registrar`, two record sets (NS + SOA), delegation set `ns-592.awsdns-10.net`, `ns-1407.awsdns-47.org`, `ns-307.awsdns-38.com`, `ns-1751.awsdns-26.co.uk`; `route53domains get-domain-detail` lists the same four name servers, so the delegation is already correct and ACM DNS validation can complete inside one apply. This supersedes E00 §2.9.1 ("`aws_route53_zone.main` created"), the "owner delegates NS" precondition, the tf-inventory row (`route53 list-hosted-zones → []`) and the two-step `-target` apply of §6 #7 (kept only as a fallback, see Verify). A `terraform plan -generate-config-out` probe (scratch, `-backend=false`, read-only) imports the zone as `comment = "HostedZone created by Route53 Registrar"`, `name = "developercards.app"`, `enable_accelerated_recovery = false`, `force_destroy = null`, `tags = {}` → **1 to import, 0 to add, 0 to change**: adoption is a no-op except for E02's provider `default_tags` (a tags-only update the checker admits).
- `aws acm list-certificates` in us-east-1 and ap-southeast-2 → `[]`; `aws apigatewayv2 get-domain-names` → `[]`; `aws s3api head-bucket --bucket developercards-site-622994489535` → 404. Nothing E09 creates exists.
- Distributions: `E28BKORJLV6UXG` (content, `d1ditdi9jqpy6n.cloudfront.net`, `http2`, WAF, no `default_root_object`) and `E85FKUMZZWQWX` (console, `d12pfy1rhi3ekm.cloudfront.net`, `http2and3`, `default_root_object = "index.html"`, 403/404 → `/index.html` 200, response-headers policy `67f7725c-6f97-4210-82d7-5512b31e9d03`) both have `Aliases: null` and `CloudFrontDefaultCertificate: true` (`minimum_protocol_version = "TLSv1"`) — the E01 curation renders that as `viewer_certificate { cloudfront_default_certificate = true … }` in `infra/modules/edge/cdn.tf`. Managed cache policy `658327ea-f89d-4fab-a63d-7e88639e58f6` (CachingOptimized) is on both.
- HTTP API `ktbq1sie2c`: `CorsConfiguration.AllowOrigins = ["http://localhost:5173", "https://d12pfy1rhi3ekm.cloudfront.net"]`, `DisableExecuteApiEndpoint = false` (stays false for the whole wave, E00 §0), endpoint `https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com`. Stage `dev` is kept (§6 #3); `api.developercards.app` maps `$default` only (§6 #23) — `src_C/Shared/RecallSmith.Lambda.Common/Validation.cs:159-176` (`NormalizePath`) already serves un-prefixed paths. The Lambda also reads `CORS_ORIGIN` (`src_C/Shared/RecallSmith.Lambda.Common/Res.cs:30`; live value `http://localhost:5173,https://d12pfy1rhi3ekm.cloudfront.net`) — with CORS configured on the HTTP API, API Gateway answers preflights and overwrites integration CORS headers, so the console works without touching that env var; folding the new origin into it is a supervisor post-apply note, not a file in this issue (`src_C/env/prod.env.json` belongs to E06/E13, E00 §1.2).
- Cognito console pool `ap-southeast-2_4Vf8uCXKt`, client `spa` = `6lkofepp2llp6v4nueg52mcm5v` (`My SPA app - mrj1i9`): today callbacks `http://localhost:5173/auth/callback` + `https://d12pfy1rhi3ekm.cloudfront.net/auth/callback`, logout `http://localhost:5173/` + `https://d12pfy1rhi3ekm.cloudfront.net/`. After E08 (`E00:331`) `spa` carries only the CloudFront pair and the new `console_dev` client (`name = "console-dev"`, localhost callbacks) exists; the supervisor pastes its id into `infra/README.md` §6 after E08's apply. Today `list-user-pool-clients` shows only `spa`, which is why this issue is queued after E08.
- **Console config.** `frontend/.env.production:11` `VITE_API_BASE=https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com/dev`, `:13` Cognito domain (unchanged), `:14` `VITE_COGNITO_CLIENT_ID=6lkofepp2llp6v4nueg52mcm5v`, `:15` `VITE_COGNITO_REDIRECT_URI=https://d12pfy1rhi3ekm.cloudfront.net/auth/callback`, `:16` `VITE_COGNITO_LOGOUT_URI=https://d12pfy1rhi3ekm.cloudfront.net/`. `frontend/.env.development:1-7` — same shape, `:4` the spa client id, `:5-6` localhost callbacks. `frontend/src/api/http.ts:12-13` reads `VITE_API_BASE_URL ?? VITE_API_BASE` (no `frontend/src` change is needed). `frontend/deploy.sh:9-11` bucket/distribution/region, `:26` hard-codes `curl -fsSL "https://d12pfy1rhi3ekm.cloudfront.net/index.html"` for the read-back hash (§6 #24). No frontend test reads `.env.production` or `deploy.sh` (`adminConsoleRequests.test.tsx:27` is a comment).
- **Mobile.** `mobile/src/api/apiClient.ts` (78 lines): `:4` `const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || '').trim().replace(/\/+$/, '');` — reads only `EXPO_PUBLIC_API_BASE` (§6 #24); `:21-30` `apiJson<T>(path, opts)` signature; `:31` throws `Missing EXPO_PUBLIC_API_BASE`; `:35-36` one `AbortController` + `opts.timeoutMs ?? 12000`; `:59-71` decorates non-2xx errors with `err.status` / `err.apiErrorCode`. Its only export consumed in the tree is `apiJson` (`mobile/src/sync/progressSync.ts:7`, `mobile/src/sync/drawStateSync.ts:4`); twelve unit suites `vi.mock('../../src/api/apiClient', …)` with `apiJson` only, so a second export is invisible to them. E00 §2.9.4 calls the function `apiFetch`; the tree's name is `apiJson` and stays.
  `mobile/src/features/gacha/home/homeRemote.ts:6-9` (`API_BASE_URL` = `EXPO_PUBLIC_API_BASE_URL || EXPO_PUBLIC_API_BASE || 'https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com'`, used at `:15`, `:57`); `:18-29` is the sandbox gate — one of its identifiers contains a word the driver's diff gate forbids, so those lines are never retyped. `mobile/src/content/premiumDeckApi.ts:5-8` (same three-line literal ending in `''`; guard `if (!API_BASE) throw …` at `:60` stays, harmless; use at `:76`; `:15` holds a property whose name contains that same forbidden word — untouched). `mobile/src/premium/revenuecat.ts:11-14` (same literal ending in `''`; guard `:434`; use `:440`). `mobile/src/content/deckRepository.ts:26-33` (frozen; blob `b8aa3b3e` at `4b07f19` — E00 §0 names `ab994b5a`, the guard is zero-diff, not a blob pin) keeps `https://d1ditdi9jqpy6n.cloudfront.net` and the execute-api default: only the owner's EAS env at OTA time moves those (§6 #7). `mobile/src/config/` holds `appEnv.ts`, `featureFlags.ts`, `forceUpdateGate.ts`, `remoteConfig.ts` — `hosts.ts` is new there. `mobile/app.json:7` `"version": "1.6.1"`; `mobile/eas.json:84` `"ascAppId": "6756044885"` (the App Store id); `mobile/package.json:43` `"expo-updates": "~29.0.15"`, `:66` `fast-check`, `:70` vitest 4. `mobile/tsconfig.json` is `strict: true` with no `include`, so `tests/` is typechecked; `mobile/vitest.config.ts` includes `tests/unit/**/*.test.ts`, `environment: 'node'`, setup `tests/setup/globals.ts` (defines `__DEV__`). Fetch-mock precedent: `mobile/tests/unit/remoteConfig.test.ts:46-50` (`globalThis.fetch = vi.fn(…) as unknown as typeof fetch`, plain `{ ok, status, … } as unknown as Response` objects).
  **Metro inlines only literal `process.env.EXPO_PUBLIC_*` member expressions**; a dynamic read (`env[name]`, or `process.env` passed as an object) is `undefined` in a release bundle. E00 §2.9.4's `resolveApiBase(env: NodeJS.ProcessEnv = process.env)` would therefore always return the default in a shipped bundle and ignore the owner's EAS override; the signatures below keep the names and semantics and read the three variables literally, once.
- **Landing copy** (`docs/home-review-and-launch-copy-2026-09-17.md`; never grep that file whole — its table at `:399-427` holds a forbidden phrase): EN one-liner `:127`, tagline `Every pull is earned. Every pull is new.` `:136`, description intro `:165`, `WHAT'S INSIDE` `:167-171`, `HOW PULLS WORK` `:173-180`, `HOW STUDY WORKS` `:182-183`, `FROM ONE DEVELOPER` `:188-189`. E00 §2.9.6 cites `:126`, `:134`, `:164-186`, `:191` — one to three lines off; the text is what is pinned below. Non-ASCII in the source: `•` bullets (become `<li>`) and two `—` (become `&mdash;`).
- `terraform` 1.16.3 and `hashicorp/aws` 6.66.0 are installed and cached; the dns/certs/site/gateway HCL below was `terraform validate`d in a scratch root on 2026-09-22 and is `terraform fmt`-clean as written. A read-only scratch plan with the same `import {}` block confirmed that the adopted zone's `zone_id` is known at plan time (`1 to import, 1 to add` for a record keyed on it), so nothing here needs a two-phase apply.
- **Sibling briefs (written the same day) that this issue must fit:** E01 gap 13 — `terraform init -backend=false` serves `validate` but not `plan` once `backend.tf` exists; E06/E08 therefore plan **against the real backend, read-only** (E02–E05 still use E01's gitignored `backend_override.tf` + an empty local state, which cannot judge "nothing else" once earlier issues have created resources — E00 §6 #25) (`terraform init -input=false -reconfigure`, `terraform plan -lock=false -input=false -refresh=true -var-file=<tmp>`; state is read with `s3:GetObject`, never locked or written), with `alert_email` / `snowflake_external_id` filled from read-only CLI into a temp var-file (E08.verify.sh step 4 is the recipe this verify copies). E05 deleted six `import {}` blocks from `imports.tf` (deletions only, its own change); for E09 the file is untouched. E08 leaves `spa` with `callback_urls = ["https://d12pfy1rhi3ekm.cloudfront.net/auth/callback"]` (no localhost) and creates `console_dev`. E10 builds its staging CloudFront/records **inline in the staging root** (its forbidden list names `modules/edge`, `aws_route53_zone`, `aws_acm_certificate`) and reuses **`modules/api`** with the prod cert ARN as a root variable; it pins the zone by id (`Z0284954BSN00C8BF94Q`) and creates `aws_route53_record.api` itself from `module.api.api_domain_target_domain_name` / `module.api.api_domain_hosted_zone_id` — so the api module's own records are created only when the root passes `zone_id`, and those two outputs are exported under exactly those names.

Gaps E00 leaves open (or that the tree contradicts) — resolved here and binding for this issue:

1. **Zone adoption, `[0]` addresses, one apply.** The zone is adopted with an `import {}` block in `infra/envs/prod/main.tf` (`imports.tf` is frozen after E01, §1.1/§6 #20; `import {}` blocks are configuration, E00 §0). Every prod-only resource in `edge` (zone, certificates, validation, site) is count-guarded by `var.manage_domain` so E10's staging root can call the same module with `manage_domain = false`; per E00 §2.1.2 their addresses carry `[0]`. The supervisor applies the whole plan once (certificates validate against the live, delegated zone inside the apply).
2. **The `api.` records live in `modules/api/gateway.tf`, not `edge/dns.tf`.** E00 §2.9.1 puts them in `edge`, which would make `edge` read `module.api` while `api` reads `module.edge.api_cert_arn` — the cross-edge §6 #13 forbids. `api` takes `zone_id` and `api_cert_arn` from `edge`; the graph stays identity → data → edge → api.
3. **Interface appendix (E09's only module-interface change).** `edge`: variables `domain`, `manage_domain`, `cloudfront_cert_arn`, `cdn_hostname`, `console_hostname`, `site_bucket_name`; outputs `zone_id`, `zone_name_servers`, `cloudfront_cert_arn`, `api_cert_arn`, `site_distribution_id`, `cdn_hostname`, `console_hostname` (the `manage_domain = false` path is for a future root; E10 builds its edge resources inline). `api`: variables `domain`, `api_hostname` (default `""` → `api.<domain>`), `api_cert_arn`, `zone_id` (default `""` → no records; E10 passes nothing and writes its own); outputs `api_hostname`, `api_domain_target_domain_name`, `api_domain_hosted_zone_id`. `identity`: variable `console_hostname` (a string — identity never reads another module, §2.1.1).
4. **`hosts.ts` signature** is `resolveApiBase(env: HostEnv = bundledEnv())` / `resolveApiFallback(env: HostEnv = bundledEnv())` for the Metro reason above; `NodeJS.ProcessEnv` is assignable to `HostEnv`.
5. **The pity bullet drops one word.** E00 asks for the description verbatim AND a negative grep for `guarantee`; the source bullet at `:176` contains "guaranteed". The landing page uses the red-line table's own allowed form — `the next card is Rare or better, as long as …` — and the grep keeps `guarantee`.
6. **`OFFLINE, NO ACCOUNT NEEDED` (`:185-186`) is not on the page** (E00's content list omits it; the red-line table asks for cloud-backup mentions to be rare until anonymous-to-signed-in migration is fixed). No privacy policy, no price (§6 #16); the `FROM ONE DEVELOPER` paragraph is verbatim, including its Premium sentence, which is the table's allowed wording.
7. **The worker's plan is the supervisor's plan** (E01 gap 13, E08 precedent; the driver's task text says the same): `terraform init -input=false -reconfigure` against the committed S3 backend, `terraform plan -lock=false -input=false -refresh=true` — read-only, never locked, never written, never applied. Precondition: E01–E08 applied by the supervisor and their second plan empty. The plan then holds exactly this issue's 27 creates + 4 updates, one `importing` entry (the zone, tags-only or no-op) and eight new outputs, and the committed `E09.plan-allow.json` applies verbatim on both sides (`check-plan.py`); the verify adds an independent strict check that prints only addresses, actions and changed-key names.
8. **`tags_only_updates: true`** in the allow file: the adopted zone receives E02's `default_tags` on adoption (`tags_all`), nothing else.
9. **`.env.development` client id** is read from `infra/README.md` §6 (E08's supervisor paste). If the paste is missing, read it with `aws cognito-idp list-user-pool-clients --user-pool-id ap-southeast-2_4Vf8uCXKt` (read-only; the client named `console-dev`) and say so in the PR text; the verify cross-checks the file against that call.
10. `prevent_destroy = true` on the zone and on the site bucket (a destroyed zone changes the delegation set; E00 §2.1.4 pattern for buckets).

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-35`), §1.1 (`:41-69`), §1.2 (`:100-103`), §2.1.1–2.1.4 (`:114-211`), §2.8 (`:305-332`), §2.9 (`:334-349`), §2.10.1 (`:353`), §3.1 (`:419-430`), §3.3 (`:438`), §5 (`:470-480`), §6 (`:484-509`).
2. `infra/envs/prod/main.tf`, `variables.tf`, `outputs.tf`, `prod.auto.tfvars.example`, `imports.tf` (read only — never edit), `infra/README.md` §1–§6, `infra/scripts/check-plan.py` (E01).
3. `infra/modules/edge/{main,variables,outputs,cdn,console_bucket}.tf` (E01), `infra/modules/api/{variables,outputs,gateway}.tf` (E01/E04/E08), `infra/modules/identity/{variables,outputs,cognito}.tf` (E01/E08) — the blocks you extend; copy their attribute style.
4. `mobile/src/api/apiClient.ts` (whole, 78 lines), `mobile/src/features/gacha/home/homeRemote.ts:1-30`, `mobile/src/content/premiumDeckApi.ts:1-20`, `:58-80`, `mobile/src/premium/revenuecat.ts:1-15`, `:430-445`, `mobile/src/content/deckRepository.ts:24-33` (frozen — read for the defaults you must not disturb).
5. `mobile/tests/unit/remoteConfig.test.ts:40-80` (fetch-mock style), `mobile/tests/unit/spillSchedule.test.ts:1-45` (fast-check style), `mobile/vitest.config.ts`, `mobile/tests/setup/globals.ts`.
6. `frontend/.env.production`, `frontend/.env.development`, `frontend/deploy.sh` (whole, 28 lines), `frontend/src/api/http.ts:8-20`.
7. `docs/home-review-and-launch-copy-2026-09-17.md:120-198` only (`sed -n '120,198p'`).
8. `docs/delivery/r16-issues/C07-topic-mobile.md` + `C07.verify.sh` (format and harness precedent), `docs/delivery/r16-issues/E09.verify.sh` (what will be run against you).

## Constraints

- **Scope (the ONLY files that may change):**
  `infra/envs/prod/main.tf`, `infra/envs/prod/variables.tf`, `infra/envs/prod/outputs.tf`, `infra/envs/prod/prod.auto.tfvars.example`;
  `infra/modules/edge/dns.tf` (new), `infra/modules/edge/certs.tf` (new), `infra/modules/edge/site.tf` (new), `infra/modules/edge/cdn.tf`, `infra/modules/edge/variables.tf`, `infra/modules/edge/outputs.tf`;
  `infra/modules/api/gateway.tf`, `infra/modules/api/variables.tf`, `infra/modules/api/outputs.tf`;
  `infra/modules/identity/cognito.tf`, `infra/modules/identity/variables.tf`, `infra/modules/identity/outputs.tf` (only if you add an output; none is required);
  `infra/README.md` (one appended line in §6);
  `docs/delivery/r16-issues/E09.plan-allow.json` (new);
  `mobile/src/config/hosts.ts` (new), `mobile/src/api/apiClient.ts`, `mobile/src/features/gacha/home/homeRemote.ts`, `mobile/src/content/premiumDeckApi.ts`, `mobile/src/premium/revenuecat.ts`, `mobile/tests/unit/hosts.test.ts` (new), `mobile/tests/unit/apiClientFallback.test.ts` (new);
  `frontend/.env.production`, `frontend/.env.development`, `frontend/deploy.sh`;
  `site/index.html` (new), `site/styles.css` (new), `site/deploy.sh` (new, `chmod +x`).
  Nothing else — in particular not `infra/envs/prod/imports.tf`, `backend.tf`, `versions.tf`, `providers.tf`, `.terraform.lock.hcl`, not `infra/modules/edge/main.tf` / `console_bucket.tf`, not `infra/modules/data/**`, `worker/**`, `observability/**`, not `src_C/**`, not `frontend/src/**` or `frontend/.env.e2e`, not `README.md`.
- **WORKER SAFETY RULE (verbatim, E00 §0):** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  Consequences here: `terraform init -backend=false -input=false` for `validate`; for the plan, `terraform init -input=false -reconfigure` in `infra/envs/prod` with the committed `backend.tf`, then `terraform plan -lock=false -input=false -refresh=true -var-file=<tmp var-file> -out=…` and `terraform show -json` (E08 recipe: the state is read, never locked, never written; you never `terraform state …`, never create or empty the bucket); `aws route53 get-hosted-zone`, `aws route53domains get-domain-detail --region us-east-1`, `aws acm list-certificates`, `aws apigatewayv2 get-domain-names`, `aws cognito-idp list-user-pool-clients`, `aws cloudfront get-distribution-config` are fine; `site/deploy.sh` and `frontend/deploy.sh` run only with `DRY_RUN=1`. The plan file and its JSON contain Lambda environment values (E00 §0): keep them in a temp dir, print only address/actions/keys, delete them.
- **Frozen files (E00 §0):** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts` — zero diff. The CDN default stays `https://d1ditdi9jqpy6n.cloudfront.net`.
- **OTA rule (E00 §0):** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json` (`"version": "1.6.1"`), `mobile/eas.json`; no dependency, no native module, no `@sentry/*`, no `npm install`.
- **Terraform rules (E00 §0, §2.1):** `hashicorp/aws ~> 6.0` as pinned by E01 (never upgrade the lock file); no `profile` in any provider; no `provisioner`, `local-exec`, `null_resource`, `external`, `archive_file`; no rename of any existing resource (the two distributions, the API, the pool client keep their addresses and names; the zone keeps its registrar comment); new names carry the `developercards-` prefix (`developercards-site-622994489535`, `developercards-site-oac`); `terraform fmt -recursive infra` before you finish. Module interfaces change only by the appendix in Context #3.
- **Secrets:** nothing secret exists in this issue; still, no `.tfplan`, `*.plan.json`, `generated*.tf`, `*.auto.tfvars` (other than the committed `.example`) may be tracked, and no plan text is pasted into the PR.
- **Banned literals in any new/changed line and in the PR text:** the six terms of B00 §0 (driver gate, case-insensitive) — do not retype the sandbox-gate lines of `homeRemote.ts:18-29` or `premiumDeckApi.ts:15`; say "sidestep", "work around", "guard", "fallback". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`, no `#pragma`.
- **Tests:** the only new tests are `mobile/tests/unit/hosts.test.ts` and `mobile/tests/unit/apiClientFallback.test.ts`. No existing test file changes anywhere (mobile, frontend, `src_C`). `cd mobile && npm run test:typecheck && npx vitest run` and `cd frontend && npm run lint && npx vitest run && npm run build` must stay green.
- **Landing page:** ASCII bytes only, no `<script>`, no `<img>`, no `<style>`/inline `style`, no `on*` attributes, no web fonts, no analytics, hrefs limited to `styles.css`, the App Store link and the two GitHub links; content only from `home-review-and-launch-copy:120-198` as pinned below; never quote `:399-427`.
- Standing rules: no `git push`, no PR creation, never touch `main`, no EAS / expo / deploy command, no npm/git activity outside your worktree.

## Changes required

Terraform values below are exact (the verify greps them with whitespace-tolerant patterns around `=`, so `terraform fmt` alignment is free).

1. **`infra/envs/prod/variables.tf`** — append:
   ```hcl
   variable "domain" {
     type        = string
     default     = "developercards.app"
     description = "Apex hostname. api./cdn./console. hang under it; the zone is adopted, not created (E09)."
   }
   ```
   **`infra/envs/prod/prod.auto.tfvars.example`** — append one line: `domain = "developercards.app"`.

2. **`infra/envs/prod/outputs.tf`** — append eight outputs, names exact:
   ```hcl
   output "zone_name_servers" {
     value = module.edge.zone_name_servers
   }
   output "api_hostname" {
     value = module.api.api_hostname
   }
   output "cdn_hostname" {
     value = module.edge.cdn_hostname
   }
   output "console_hostname" {
     value = module.edge.console_hostname
   }
   output "site_hostname" {
     value = var.domain
   }
   output "site_distribution_id" {
     value = module.edge.site_distribution_id
   }
   output "cloudfront_cert_arn" {
     value = module.edge.cloudfront_cert_arn
   }
   output "api_cert_arn" {
     value = module.edge.api_cert_arn
   }
   ```

3. **`infra/envs/prod/main.tf`** — additive wiring only:
   a. The zone import block (root module; `imports.tf` stays untouched):
      ```hcl
      # E09: the registrar created this zone on 2026-09-22 (Route 53 Domains). Adopt it; never recreate it.
      import {
        to = module.edge.aws_route53_zone.main[0]
        id = "Z0284954BSN00C8BF94Q"
      }
      ```
   b. `module "edge"` gains `domain = var.domain`, `manage_domain = true`, `site_bucket_name = "developercards-site-622994489535"` (the literal bucket name, one line each).
   c. `module "api"` gains `domain = var.domain`, `api_cert_arn = module.edge.api_cert_arn`, `zone_id = module.edge.zone_id`.
   d. `module "identity"` gains `console_hostname = "console.${var.domain}"` (a string expression on `var.domain`, never a module output).
   e. The list passed as `cors_allowed_origins` to `module "api"` gains the element `"https://console.${var.domain}"` (keep the two existing origins; if E01 made the list a root variable, wrap it: `concat(var.cors_allowed_origins, ["https://console.${var.domain}"])`).

4. **`infra/modules/edge/variables.tf`** — append (descriptions may differ, names/types/defaults may not):
   ```hcl
   variable "domain" {
     type        = string
     description = "Apex hostname, e.g. developercards.app. Every custom hostname of this module hangs under it."
   }
   variable "manage_domain" {
     type        = bool
     default     = false
     description = "true (prod): adopt the hosted zone, issue the two ACM certificates, create the landing site. false (staging): read the zone, use var.cloudfront_cert_arn."
   }
   variable "cloudfront_cert_arn" {
     type        = string
     default     = ""
     description = "us-east-1 certificate ARN used by the distributions when manage_domain = false (staging passes prod's)."
   }
   variable "cdn_hostname" {
     type        = string
     default     = ""
     description = "Alias of the content distribution; \"\" = cdn.<domain>."
   }
   variable "console_hostname" {
     type        = string
     default     = ""
     description = "Alias of the console distribution; \"\" = console.<domain>."
   }
   variable "site_bucket_name" {
     type        = string
     default     = ""
     description = "Landing-page bucket (prod: developercards-site-622994489535); required when manage_domain = true."
   }
   ```
   **`infra/modules/edge/outputs.tf`** — append:
   ```hcl
   output "zone_id" {
     value = local.zone_id
   }
   output "zone_name_servers" {
     value = try(aws_route53_zone.main[0].name_servers, [])
   }
   output "cloudfront_cert_arn" {
     value = local.cloudfront_cert_arn
   }
   output "api_cert_arn" {
     value = try(aws_acm_certificate_validation.api[0].certificate_arn, "")
   }
   output "site_distribution_id" {
     value = try(aws_cloudfront_distribution.site[0].id, "")
   }
   output "cdn_hostname" {
     value = local.cdn_hostname
   }
   output "console_hostname" {
     value = local.console_hostname
   }
   ```

5. **`infra/modules/edge/dns.tf` (new)** — verbatim:
   ```hcl
   # Hosted zone + alias records. The zone was created by Route 53 Domains on 2026-09-22
   # (registrar comment kept verbatim so the adoption is a no-op); staging reads it.
   locals {
     record_types      = toset(["A", "AAAA"])
     site_record_types = var.manage_domain ? local.record_types : toset([])
     cdn_hostname      = var.cdn_hostname != "" ? var.cdn_hostname : "cdn.${var.domain}"
     console_hostname  = var.console_hostname != "" ? var.console_hostname : "console.${var.domain}"
     zone_id           = coalesce(one(aws_route53_zone.main[*].zone_id), one(data.aws_route53_zone.main[*].zone_id))
   }

   resource "aws_route53_zone" "main" {
     count   = var.manage_domain ? 1 : 0
     name    = var.domain
     comment = "HostedZone created by Route53 Registrar"

     lifecycle {
       prevent_destroy = true
     }
   }

   data "aws_route53_zone" "main" {
     count        = var.manage_domain ? 0 : 1
     name         = var.domain
     private_zone = false
   }

   resource "aws_route53_record" "cdn" {
     for_each = local.record_types
     zone_id  = local.zone_id
     name     = local.cdn_hostname
     type     = each.key

     alias {
       name                   = aws_cloudfront_distribution.content.domain_name
       zone_id                = aws_cloudfront_distribution.content.hosted_zone_id
       evaluate_target_health = false
     }
   }

   resource "aws_route53_record" "console" {
     for_each = local.record_types
     zone_id  = local.zone_id
     name     = local.console_hostname
     type     = each.key

     alias {
       name                   = aws_cloudfront_distribution.console.domain_name
       zone_id                = aws_cloudfront_distribution.console.hosted_zone_id
       evaluate_target_health = false
     }
   }

   resource "aws_route53_record" "site_apex" {
     for_each = local.site_record_types
     zone_id  = local.zone_id
     name     = var.domain
     type     = each.key

     alias {
       name                   = aws_cloudfront_distribution.site[0].domain_name
       zone_id                = aws_cloudfront_distribution.site[0].hosted_zone_id
       evaluate_target_health = false
     }
   }

   resource "aws_route53_record" "site_www" {
     for_each = local.site_record_types
     zone_id  = local.zone_id
     name     = "www.${var.domain}"
     type     = each.key

     alias {
       name                   = aws_cloudfront_distribution.site[0].domain_name
       zone_id                = aws_cloudfront_distribution.site[0].hosted_zone_id
       evaluate_target_health = false
     }
   }
   ```
   (`aws_cloudfront_distribution.content` / `.console` are E01's adopted resources in `cdn.tf`; use their real resource names if E01 chose others — the E00 §2.1.2 addresses are `module.edge.aws_cloudfront_distribution.content` and `.console`.)

6. **`infra/modules/edge/certs.tf` (new)** — verbatim:
   ```hcl
   # Two wildcard certificates (apex + *.domain): us-east-1 for CloudFront, regional for
   # API Gateway. ACM issues the SAME validation CNAME for the apex and its wildcard, and
   # the same one in every region of one account, so one Route 53 record validates both.
   locals {
     cloudfront_cert_arn = var.manage_domain ? one(aws_acm_certificate_validation.cloudfront[*].certificate_arn) : var.cloudfront_cert_arn
   }

   resource "aws_acm_certificate" "cloudfront" {
     count                     = var.manage_domain ? 1 : 0
     provider                  = aws.use1
     domain_name               = var.domain
     subject_alternative_names = ["*.${var.domain}"]
     validation_method         = "DNS"

     lifecycle {
       create_before_destroy = true
     }
   }

   resource "aws_acm_certificate" "api" {
     count                     = var.manage_domain ? 1 : 0
     domain_name               = var.domain
     subject_alternative_names = ["*.${var.domain}"]
     validation_method         = "DNS"

     lifecycle {
       create_before_destroy = true
     }
   }

   resource "aws_route53_record" "cert_validation" {
     for_each = {
       for dvo in flatten(aws_acm_certificate.cloudfront[*].domain_validation_options) :
       "apex" => {
         name  = dvo.resource_record_name
         type  = dvo.resource_record_type
         value = dvo.resource_record_value
       }
       if dvo.domain_name == var.domain
     }

     allow_overwrite = true
     zone_id         = local.zone_id
     name            = each.value.name
     type            = each.value.type
     ttl             = 60
     records         = [each.value.value]
   }

   resource "aws_acm_certificate_validation" "cloudfront" {
     count                   = var.manage_domain ? 1 : 0
     provider                = aws.use1
     certificate_arn         = aws_acm_certificate.cloudfront[0].arn
     validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
   }

   resource "aws_acm_certificate_validation" "api" {
     count                   = var.manage_domain ? 1 : 0
     certificate_arn         = aws_acm_certificate.api[0].arn
     validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
   }
   ```
   The `for_each` key is the constant `"apex"` (known at plan time; the provider fills `domain_validation_options` with known domain names and unknown record values on create), so the plan needs no two-phase apply.

7. **`infra/modules/edge/site.tf` (new)** — verbatim:
   ```hcl
   # Landing page: private bucket behind CloudFront (OAC), apex + www aliases, SPA-style
   # 403/404 -> /index.html like the console. Content is synced by site/deploy.sh (supervisor).
   resource "aws_s3_bucket" "site" {
     count  = var.manage_domain ? 1 : 0
     bucket = var.site_bucket_name

     lifecycle {
       prevent_destroy = true
     }
   }

   resource "aws_s3_bucket_public_access_block" "site" {
     count                   = var.manage_domain ? 1 : 0
     bucket                  = aws_s3_bucket.site[0].id
     block_public_acls       = true
     block_public_policy     = true
     ignore_public_acls      = true
     restrict_public_buckets = true
   }

   resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
     count  = var.manage_domain ? 1 : 0
     bucket = aws_s3_bucket.site[0].id

     rule {
       apply_server_side_encryption_by_default {
         sse_algorithm = "AES256"
       }
     }
   }

   resource "aws_s3_bucket_ownership_controls" "site" {
     count  = var.manage_domain ? 1 : 0
     bucket = aws_s3_bucket.site[0].id

     rule {
       object_ownership = "BucketOwnerEnforced"
     }
   }

   resource "aws_s3_bucket_versioning" "site" {
     count  = var.manage_domain ? 1 : 0
     bucket = aws_s3_bucket.site[0].id

     versioning_configuration {
       status = "Enabled"
     }
   }

   resource "aws_cloudfront_origin_access_control" "site" {
     count                             = var.manage_domain ? 1 : 0
     name                              = "developercards-site-oac"
     description                       = ""
     origin_access_control_origin_type = "s3"
     signing_behavior                  = "always"
     signing_protocol                  = "sigv4"
   }

   resource "aws_cloudfront_distribution" "site" {
     count               = var.manage_domain ? 1 : 0
     enabled             = true
     is_ipv6_enabled     = true
     comment             = "DeveloperCards landing page"
     default_root_object = "index.html"
     aliases             = [var.domain, "www.${var.domain}"]
     http_version        = "http2and3"
     price_class         = "PriceClass_All"

     origin {
       domain_name              = aws_s3_bucket.site[0].bucket_regional_domain_name
       origin_id                = "site-s3"
       origin_access_control_id = aws_cloudfront_origin_access_control.site[0].id
     }

     default_cache_behavior {
       allowed_methods            = ["GET", "HEAD"]
       cached_methods             = ["GET", "HEAD"]
       target_origin_id           = "site-s3"
       compress                   = true
       viewer_protocol_policy     = "redirect-to-https"
       cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
       response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"
     }

     custom_error_response {
       error_code            = 403
       response_code         = 200
       response_page_path    = "/index.html"
       error_caching_min_ttl = 10
     }

     custom_error_response {
       error_code            = 404
       response_code         = 200
       response_page_path    = "/index.html"
       error_caching_min_ttl = 10
     }

     restrictions {
       geo_restriction {
         restriction_type = "none"
       }
     }

     viewer_certificate {
       acm_certificate_arn      = local.cloudfront_cert_arn
       ssl_support_method       = "sni-only"
       minimum_protocol_version = "TLSv1.2_2021"
     }
   }

   resource "aws_s3_bucket_policy" "site" {
     count  = var.manage_domain ? 1 : 0
     bucket = aws_s3_bucket.site[0].id
     policy = jsonencode({
       Version = "2012-10-17"
       Statement = [{
         Sid       = "AllowCloudFrontServicePrincipalReadOnly"
         Effect    = "Allow"
         Principal = { Service = "cloudfront.amazonaws.com" }
         Action    = "s3:GetObject"
         Resource  = "${aws_s3_bucket.site[0].arn}/*"
         Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site[0].arn } }
       }]
     })

     depends_on = [aws_s3_bucket_public_access_block.site]
   }
   ```

8. **`infra/modules/edge/cdn.tf`** — on BOTH adopted distributions: `aliases = [local.cdn_hostname]` (content) / `aliases = [local.console_hostname]` (console) replace `aliases = []`, and the `viewer_certificate` block becomes exactly
   ```hcl
     viewer_certificate {
       acm_certificate_arn      = local.cloudfront_cert_arn
       ssl_support_method       = "sni-only"
       minimum_protocol_version = "TLSv1.2_2021"
     }
   ```
   (`cloudfront_default_certificate = true`, `iam_certificate_id = null`, `acm_certificate_arn = null` go away). Nothing else in `cdn.tf` changes: `http_version` stays `http2` on content and `http2and3` on console, WAF, OACs, origins, cache behaviours, `custom_error_response`s, the content bucket policy — untouched.

9. **`infra/modules/api`** — `variables.tf` appends
   ```hcl
   variable "domain" {
     type        = string
     description = "Apex hostname; the API hostname is api.<domain> unless api_hostname is set."
   }
   variable "api_hostname" {
     type        = string
     default     = ""
     description = "Custom hostname of the HTTP API; \"\" = api.<domain> (staging: api-staging.<domain>)."
   }
   variable "api_cert_arn" {
     type        = string
     description = "Regional (ap-southeast-2) ACM certificate ARN for the custom hostname."
   }
   variable "zone_id" {
     type        = string
     default     = ""
     description = "Hosted zone that receives the api. alias records; \"\" creates none (the staging root writes its own)."
   }
   ```
   `outputs.tf` appends three outputs (multi-line blocks): `output "api_hostname" { value = local.api_hostname }`, `output "api_domain_target_domain_name" { value = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name }`, `output "api_domain_hosted_zone_id" { value = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].hosted_zone_id }`; **`gateway.tf`** appends, verbatim, after the stages:
   ```hcl
   # Custom hostname for the HTTP API: api.<domain> -> $default (no mapping key; the
   # execute-api endpoint stays enabled for 1.5.0 clients, E00 §0). The alias records are
   # created only when the root passes zone_id (prod); the staging root writes its own.
   locals {
     api_hostname = var.api_hostname != "" ? var.api_hostname : "api.${var.domain}"
   }

   resource "aws_apigatewayv2_domain_name" "api" {
     domain_name = local.api_hostname

     domain_name_configuration {
       certificate_arn = var.api_cert_arn
       endpoint_type   = "REGIONAL"
       security_policy = "TLS_1_2"
     }
   }

   resource "aws_apigatewayv2_api_mapping" "api" {
     api_id      = aws_apigatewayv2_api.http.id
     domain_name = aws_apigatewayv2_domain_name.api.id
     stage       = aws_apigatewayv2_stage.default.id
   }

   resource "aws_route53_record" "api" {
     for_each = var.zone_id == "" ? toset([]) : toset(["A", "AAAA"])
     zone_id  = var.zone_id
     name     = local.api_hostname
     type     = each.key

     alias {
       name                   = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
       zone_id                = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].hosted_zone_id
       evaluate_target_health = false
     }
   }
   ```
   No `api_mapping_key`; `disable_execute_api_endpoint` is never set to `true`; routes, authorizers, throttles (E08) untouched.

10. **`infra/modules/identity`** — `variables.tf` appends
    ```hcl
    variable "console_hostname" {
      type        = string
      default     = ""
      description = "Console hostname added to the spa client's callback/logout URLs; \"\" adds nothing (staging)."
    }
    ```
    and in `cognito.tf` the `spa` client's URL lists become, whatever shape E08 left them in, exactly these two sets:
    ```hcl
      callback_urls = concat(["https://d12pfy1rhi3ekm.cloudfront.net/auth/callback"], var.console_hostname == "" ? [] : ["https://${var.console_hostname}/auth/callback"])
      logout_urls   = concat(["https://d12pfy1rhi3ekm.cloudfront.net/"], var.console_hostname == "" ? [] : ["https://${var.console_hostname}/"])
    ```
    (the CloudFront pair stays until the console redeploy is confirmed — removal is post-wave). MFA, validity, `console_dev`, the mobile pool: untouched.

11. **`infra/README.md` §6** — append one line, e.g. `- 2026-09-2x E09: zone Z0284954BSN00C8BF94Q adopted (registrar-created); ACM wildcard certs (us-east-1 + ap-southeast-2); api./cdn./console. + apex/www records; site bucket developercards-site-622994489535 + distribution; spa callbacks + CORS gain console.developercards.app. Supervisor fills site_distribution_id after apply.` The verify greps `E09` and `Z0284954BSN00C8BF94Q`.

12. **`docs/delivery/r16-issues/E09.plan-allow.json` (new)** — exactly this content (JSON-equal; key order free):
    ```json
    {
      "tags_only_updates": true,
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
        "module.edge.aws_cloudfront_distribution.content": { "action": "update", "keys": ["aliases", "viewer_certificate"] },
        "module.edge.aws_cloudfront_distribution.console": { "action": "update", "keys": ["aliases", "viewer_certificate"] },
        "module.api.aws_apigatewayv2_domain_name.api": "create",
        "module.api.aws_apigatewayv2_api_mapping.api": "create",
        "module.api.aws_route53_record.api[\"A\"]": "create",
        "module.api.aws_route53_record.api[\"AAAA\"]": "create",
        "module.api.aws_apigatewayv2_api.http": { "action": "update", "keys": ["cors_configuration"] },
        "module.identity.aws_cognito_user_pool_client.spa[0]": { "action": "update", "keys": ["callback_urls", "logout_urls"] }
      },
      "outputs": ["zone_name_servers", "api_hostname", "cdn_hostname", "console_hostname", "site_hostname", "site_distribution_id", "cloudfront_cert_arn", "api_cert_arn"]
    }
    ```
    27 creates, 4 updates; the adopted zone `module.edge.aws_route53_zone.main[0]` is `importing` + (at most) a tags-only update and is deliberately not listed.

13. **`mobile/src/config/hosts.ts` (new, pure)** — verbatim:
    ```ts
    // mobile/src/config/hosts.ts
    // Wave E / E09: the API hostnames every non-frozen caller resolves. Pure: no react,
    // no storage, no clock, no fetch. deckRepository.ts (frozen, E00 §0) keeps its own
    // CloudFront + execute-api defaults; the EAS env at OTA-bundle time moves those.
    //
    // Metro (babel-preset-expo) inlines ONLY literal `process.env.EXPO_PUBLIC_*` member
    // expressions; a dynamic read such as `env[name]` is undefined in a release bundle.
    // The three reads below are therefore spelled out literally, once, and the resolvers
    // take an explicit env object only so tests can drive precedence.

    export const DEFAULT_API_BASE = 'https://api.developercards.app';
    export const FALLBACK_API_BASE = 'https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com';

    export type HostEnv = {
      EXPO_PUBLIC_API_BASE_URL?: string;
      EXPO_PUBLIC_API_BASE?: string;
      EXPO_PUBLIC_API_BASE_FALLBACK?: string;
    };

    function bundledEnv(): HostEnv {
      return {
        EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
        EXPO_PUBLIC_API_BASE: process.env.EXPO_PUBLIC_API_BASE,
        EXPO_PUBLIC_API_BASE_FALLBACK: process.env.EXPO_PUBLIC_API_BASE_FALLBACK,
      };
    }

    /** trim, drop trailing slashes; '' when unset or blank. */
    function cleanHost(v: string | undefined): string {
      return String(v ?? '').trim().replace(/\/+$/, '');
    }

    /** EXPO_PUBLIC_API_BASE_URL || EXPO_PUBLIC_API_BASE || DEFAULT_API_BASE, trimmed, no trailing slash. */
    export function resolveApiBase(env: HostEnv = bundledEnv()): string {
      return cleanHost(env.EXPO_PUBLIC_API_BASE_URL) || cleanHost(env.EXPO_PUBLIC_API_BASE) || DEFAULT_API_BASE;
    }

    /** EXPO_PUBLIC_API_BASE_FALLBACK || (the base is the default hostname ? the legacy execute-api host : null). */
    export function resolveApiFallback(env: HostEnv = bundledEnv()): string | null {
      return cleanHost(env.EXPO_PUBLIC_API_BASE_FALLBACK) || (resolveApiBase(env) === DEFAULT_API_BASE ? FALLBACK_API_BASE : null);
    }
    ```

14. **`mobile/src/api/apiClient.ts`** — the file becomes (the request body, header, token, timeout and error-decoration code is the existing `:33-75` moved into `requestOnce`; keep it byte-identical):
    ```ts
    // mobile/src/api/apiClient.ts
    import { resolveApiBase, resolveApiFallback } from '../config/hosts';

    type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

    type ApiOpts = {
      method?: ApiMethod;
      accessToken?: string | null; // ✅ now optional
      body?: any;
      timeoutMs?: number;
      headers?: Record<string, string>;
    };

    // The base that last answered. Null until a request settles, so every process starts
    // on the primary hostname; a network failure there moves it to the fallback for the
    // rest of the process, and a failure on the fallback sends the next call back to the
    // primary (E09, E00 §2.9.4).
    let activeBase: string | null = null;

    /** Test seam: forget the remembered base. */
    export function resetApiBaseForTests(): void {
      activeBase = null;
    }

    function joinUrl(base: string, path: string) { /* unchanged */ }

    function safeJsonParse(text: string): any | null { /* unchanged */ }

    /** A thrown TypeError is how fetch reports "could not reach the host" (DNS, TLS,
     *  connection refused). Aborts (timeouts) and HTTP statuses are never TypeErrors. */
    function isNetworkError(e: unknown): boolean {
      return e instanceof TypeError;
    }

    async function requestOnce<T>(base: string, path: string, opts: ApiOpts): Promise<T> {
      const url = joinUrl(base, path);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);
      try {
        // … the existing headers / token / fetch / text / json / !resp.ok block, verbatim,
        // including `err.status = resp.status;` and `err.apiErrorCode = …` …
        return (json as T) ?? (null as any);
      } finally {
        clearTimeout(timeout);
      }
    }

    export async function apiJson<T>(path: string, opts: ApiOpts): Promise<T> {
      const primary = resolveApiBase();
      const fallback = resolveApiFallback();
      const base = activeBase ?? primary;

      try {
        const out = await requestOnce<T>(base, path, opts);
        activeBase = base;
        return out;
      } catch (e) {
        const canRetry = base === primary && !!fallback && fallback !== primary && isNetworkError(e);
        if (!canRetry) {
          if (base !== primary) activeBase = null;
          throw e;
        }
        try {
          const out = await requestOnce<T>(fallback as string, path, opts);
          activeBase = fallback;
          return out;
        } catch (e2) {
          activeBase = null;
          throw e2;
        }
      }
    }
    ```
    Semantics (E00 §2.9.4): retry **once**, on the fallback, only for a thrown `TypeError` on the primary — never for an HTTP status, never for an abort/timeout; each attempt gets its own controller and timeout; the working base is remembered for the process. The `Missing EXPO_PUBLIC_API_BASE` throw (`:31`) is gone (the base is never empty); `process.env` is no longer read in this file. The verify greps `let activeBase: string | null = null;`, `export function resetApiBaseForTests(): void`, `export async function apiJson<T>(`, `e instanceof TypeError`, the exact `canRetry` expression and `err.apiErrorCode =`.

15. **The three callers** — replace the four-line env literal with one call, add one import, change nothing else (numstat `2	4` each; the verify pins exactly 4 removed lines and ≤ 3 added):
    - `mobile/src/features/gacha/home/homeRemote.ts`: `import { resolveApiBase } from '../../../config/hosts';` at the top; `:6-9` → `const API_BASE_URL = resolveApiBase();`. Lines `:18-29` stay byte-identical.
    - `mobile/src/content/premiumDeckApi.ts`: `import { resolveApiBase } from '../config/hosts';` next to the existing imports; `:5-8` → `const API_BASE = resolveApiBase();` (`:60` guard stays).
    - `mobile/src/premium/revenuecat.ts`: `import { resolveApiBase } from '../config/hosts';` next to `:4`; `:11-14` → `const API_BASE_URL = resolveApiBase();` (`:434` guard stays; `/api/v1/premium/sync` behaviour is unchanged, §6 #24).
    After this, `grep -rl 'process.env.EXPO_PUBLIC_API_BASE' mobile/src` lists exactly `hosts.ts` and the frozen `deckRepository.ts`.

16. **`mobile/tests/unit/hosts.test.ts` (new)** — header lines `import fc from 'fast-check';` and `import { DEFAULT_API_BASE, FALLBACK_API_BASE, resolveApiBase, resolveApiFallback } from '../../src/config/hosts';` (plus vitest's `afterEach, describe, expect, it`); an `afterEach` deletes the three `process.env` keys. Cases, titles verbatim, each its own `it`:
    1. `it('defaults to api.developercards.app when no env is set', …)` — `resolveApiBase({}) === DEFAULT_API_BASE === 'https://api.developercards.app'`; `resolveApiFallback({}) === FALLBACK_API_BASE === 'https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com'`.
    2. `it('prefers EXPO_PUBLIC_API_BASE_URL over EXPO_PUBLIC_API_BASE', …)` — both set → the URL variable wins; only `EXPO_PUBLIC_API_BASE` set → it is used.
    3. `it('trims whitespace and strips trailing slashes', …)` — `'  https://x.test///  '` → `'https://x.test'`; `'https://y.test/'` → `'https://y.test'`; `EXPO_PUBLIC_API_BASE_URL: '/'` falls through to `EXPO_PUBLIC_API_BASE`.
    4. `it('treats a blank env value as unset', …)` — `'   '` falls through; `''`/`''` → default; a blank `EXPO_PUBLIC_API_BASE_FALLBACK` → the legacy fallback.
    5. `it('offers the legacy execute-api host as fallback only for the default base', …)` — custom `EXPO_PUBLIC_API_BASE` or `_URL` → `null`; `EXPO_PUBLIC_API_BASE: DEFAULT_API_BASE` (with or without a trailing slash) → `FALLBACK_API_BASE`.
    6. `it('honours EXPO_PUBLIC_API_BASE_FALLBACK verbatim (trimmed)', …)` — `' https://fb.test/ '` → `'https://fb.test'` even with a custom base.
    7. `it('reads the bundled env through literal process.env members', …)` — set `process.env.EXPO_PUBLIC_API_BASE = 'https://proc.test/'` → `resolveApiBase()` (no argument) is `'https://proc.test'` and `resolveApiFallback()` is `null`; then `_URL` and `_FALLBACK` likewise.
    8. `it('never returns a trailing slash or surrounding whitespace (property)', …)` — `fc.assert(fc.property(piece, piece, piece, …), { numRuns: 200 })` with `piece = fc.oneof(fc.constant(undefined), fc.constant(''), fc.constant('   '), fc.constant('/'), fc.webUrl().map((u) => \`  ${u}///\`), fc.string())`: the base is non-empty, equals its `trim()`, does not end with `/`; the fallback, when not `null`, satisfies the same three.

17. **`mobile/tests/unit/apiClientFallback.test.ts` (new)** — header lines `import { apiJson, resetApiBaseForTests } from '../../src/api/apiClient';` and `import { DEFAULT_API_BASE, FALLBACK_API_BASE } from '../../src/config/hosts';` (plus vitest's `beforeEach, describe, expect, it, vi`). Harness: a `calls: { url: string; init: any }[]` log; `res(status, body)` builds `{ ok, status, statusText: String(status), text: async () => JSON.stringify(body) } as unknown as Response`; `scriptFetch(...steps)` sets `globalThis.fetch = vi.fn(async (url, init) => { calls.push(…); return steps[Math.min(i++, steps.length - 1)](); }) as unknown as typeof fetch`; `netErr = () => Promise.reject(new TypeError('Network request failed'))`, `abortErr = () => Promise.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))`, `http500` = a 500 with `{ error: { message: 'boom', code: 'BOOM' } }`; `beforeEach` deletes the three env keys, calls `resetApiBaseForTests()` and clears `calls`. Cases, titles verbatim:
    1. `it('calls the primary host once on success', …)` — one call to `` `${DEFAULT_API_BASE}/api/v1/x` ``, resolves `{ ok: true }`.
    2. `it('retries once on the fallback host after a network error on the primary', …)` — `netErr, ok` → two calls, the second to `` `${FALLBACK_API_BASE}/api/v1/x` ``, resolves.
    3. `it('does not retry on an HTTP error status', …)` — `http500` → one call; the rejection has `status === 500` and `apiErrorCode === 'BOOM'`.
    4. `it('does not retry on a timeout abort', …)` — `abortErr` → one call; `err.name === 'AbortError'`.
    5. `it('remembers the working host for later calls in the process', …)` — after case 2's sequence, a second `apiJson('/api/v1/y')` makes exactly one more call, to the fallback.
    6. `it('never retries when the fallback is disabled by a custom base', …)` — `process.env.EXPO_PUBLIC_API_BASE = 'https://custom.test'`, `netErr` → one call to `https://custom.test/api/v1/x`, rejects with the `TypeError`.
    7. `it('propagates the network error when the fallback also fails', …)` — `netErr, netErr` → two calls, rejects with a `TypeError`; a following call (fetch now `ok`) goes to the primary again.
    8. `it('keeps Authorization and JSON body on the retried request', …)` — `POST` with `accessToken: 't0k'`, `body: { a: 1 }` under `netErr, ok`: both calls carry `method 'POST'`, `headers.Authorization === 'Bearer t0k'`, `body === JSON.stringify({ a: 1 })`.

18. **Console config + deploy script (no `frontend/src` change):**
    - `frontend/.env.production`: `:11` → `VITE_API_BASE=https://api.developercards.app`; `:15` → `VITE_COGNITO_REDIRECT_URI=https://console.developercards.app/auth/callback`; `:16` → `VITE_COGNITO_LOGOUT_URI=https://console.developercards.app/`; the comment block `:1-10` may mention the new hostname; `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID=6lkofepp2llp6v4nueg52mcm5v`, `VITE_COGNITO_SCOPES` unchanged. `execute-api` and `d12pfy1rhi3ekm` no longer appear in the redirect line.
    - `frontend/.env.development`: `:4` → `VITE_COGNITO_CLIENT_ID=<the console-dev client id from infra/README.md §6>` (26 lowercase alphanumerics, not the spa id); every other line unchanged — the `…/dev` API base, `VITE_COGNITO_REDIRECT_URI=http://localhost:5173/auth/callback` and `VITE_COGNITO_LOGOUT_URI=http://localhost:5173/` stay.
    - `frontend/deploy.sh`: after `REGION=…` (`:11`) add `CONSOLE_URL="${CONSOLE_URL:-https://console.developercards.app}"`; `:26` becomes `REMOTE="$(curl -fsSL "$CONSOLE_URL/index.html" | shasum -a 256 | cut -c1-16)"`. Bucket, distribution id, DRY_RUN block unchanged.

19. **`site/index.html` (new)** — verbatim (ASCII only; the pity bullet is the red-line table's allowed form, Context gap #5):
    ```html
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>DeveloperCards</title>
      <meta name="description" content="DeveloperCards: spaced-repetition flashcards for developers where card packs are earned by studying, never bought, and never deal a duplicate. 81 C# / .NET + 154 AWS SAA-C03 cards, free, iOS.">
      <link rel="stylesheet" href="styles.css">
    </head>
    <body>
      <main>
        <header>
          <p class="brand">DeveloperCards</p>
          <h1>Every pull is earned. Every pull is new.</h1>
          <p class="lede">DeveloperCards: spaced-repetition flashcards for developers where card packs are earned by studying, never bought, and never deal a duplicate. 81 C# / .NET + 154 AWS SAA-C03 cards, free, iOS.</p>
          <p class="cta"><a class="button" href="https://apps.apple.com/app/id6756044885">Download on the App Store</a></p>
          <p>Prepping a .NET interview or the AWS SAA-C03? DeveloperCards turns the prep into a collection you build by showing up. The loop in one sentence: learn a new card, earn a pull, rip a pack, and what you draw becomes what you study.</p>
        </header>

        <section>
          <h2>WHAT'S INSIDE</h2>
          <p>Two free decks, both in English:</p>
          <ul>
            <li>C# / .NET &mdash; 81 interview cards, fundamentals to intermediate (async/await, boxing, controllers, OOP and more) with a C# code snippet on essentially every card.</li>
            <li>AWS Associate Architect &mdash; 154 scenario-style SAA-C03 cards (S3 storage classes, ElastiCache Multi-AZ, IAM, Lambda and more) with a real-world usage note on nearly every card.</li>
          </ul>
          <p>Every card is a question with a written explanation. Rarity is difficulty: Common, Rare and Legendary map to how hard the question is, so a Legendary is one of the hardest questions in the deck.</p>
        </section>

        <section>
          <h2>HOW PULLS WORK</h2>
          <ul>
            <li>Pulls are earned, never sold. Learn a new card, earn a pull: the first time you rate a card Hard, Good or Easy, one pull lands in your wallet, no claim button. Clearing everything due for the day adds one more, once a day. New players start with 3 pulls, so the first pack opens in seconds.</li>
            <li>Never a duplicate. The draw pool is only the cards missing from your collection.</li>
            <li>Pity: after 10 Commons in a row, the next card is Rare or better, as long as an unowned Rare or Legendary is still in the pack.</li>
            <li>Open 1 or Open 10. You are only charged for cards you actually receive.</li>
            <li>Your wallet holds up to 60 pulls plus a 5-pull reserve. If you ever have nothing left to study and no pulls, you get 1 pull a day.</li>
            <li>Every draw is seeded and replayable, so the app can show why you got what you got.</li>
            <li>Rip the foil, watch the cards drop, tap to flip. Rare and Legendary reveals get their own sound and haptics.</li>
          </ul>
        </section>

        <section>
          <h2>HOW STUDY WORKS</h2>
          <p>Rate each card Again / Hard / Good / Easy. Cards return on a 7-stage ladder of 1, 2, 4, 8, 15, 30 and 60 days; a card is Mastered once it reaches the 15-day stage. Reviewing a single card keeps your streak alive. Streaks and milestones are tracked; the Library shows each card as New, Learning or Mastered.</p>
        </section>

        <section>
          <h2>FROM ONE DEVELOPER</h2>
          <p>DeveloperCards is an indie project: one person built the app and the backend and writes or edits every card by hand. Both decks are free. A monthly Premium subscription exists for future premium decks, but there is nothing premium to unlock yet. Next up: more decks. Feedback is welcome.</p>
        </section>

        <footer>
          <p><a href="https://github.com/ChuanQiao1128/recallsmith">Source</a> &middot; <a href="https://github.com/ChuanQiao1128/recallsmith/issues">Support</a></p>
        </footer>
      </main>
    </body>
    </html>
    ```
    **`site/styles.css` (new)** — verbatim (ASCII; no `@import`, no `url(`):
    ```css
    /* DeveloperCards landing page. System font stack only; no imports, no images, no scripts. */
    * { box-sizing: border-box; }
    html {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.55;
      color: #1b1b1f;
      background: #fafaf7;
    }
    body { margin: 0; padding: 0 16px; }
    main { max-width: 40rem; margin: 0 auto; padding: 3rem 0 4rem; }
    .brand { margin: 0 0 0.5rem; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #6b6b75; }
    h1 { margin: 0 0 1rem; font-size: 2rem; line-height: 1.2; }
    h2 { margin: 2.5rem 0 0.75rem; font-size: 1rem; letter-spacing: 0.06em; }
    .lede { font-size: 1.125rem; }
    .button { display: inline-block; padding: 0.75rem 1.25rem; border-radius: 999px; background: #1b1b1f; color: #ffffff; font-weight: 600; text-decoration: none; }
    .button:hover, .button:focus { background: #3a3a44; }
    ul { padding-left: 1.25rem; }
    li { margin: 0.5rem 0; }
    a { color: #1f4fbf; }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #dddddd; color: #6b6b75; font-size: 0.9rem; }
    ```

20. **`site/deploy.sh` (new, `chmod +x`, supervisor-only, DRY_RUN-guarded)** — verbatim:
    ```bash
    #!/usr/bin/env bash
    # deploy.sh — publish the landing page: sync site/ into the site bucket (index.html as
    # no-cache), invalidate the distribution, then read back index.html's hash from the live host.
    #
    #   AWS_PROFILE=dev SITE_DISTRIBUTION_ID=<terraform output -raw site_distribution_id> ./deploy.sh
    #   DRY_RUN=1 ./deploy.sh        (prints the commands, touches nothing)
    #
    # Supervisor-only (E00 §0): workers run this with DRY_RUN=1 only.
    set -euo pipefail
    HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
    export AWS_PROFILE="${AWS_PROFILE:-dev}"
    BUCKET="${SITE_BUCKET:-developercards-site-622994489535}"
    DIST_ID="${SITE_DISTRIBUTION_ID:-}"
    SITE_URL="${SITE_URL:-https://developercards.app}"
    REGION="${AWS_REGION:-ap-southeast-2}"

    [ -f index.html ] || { echo "index.html missing" >&2; exit 1; }
    if [ "${DRY_RUN:-0}" = 1 ]; then
      echo "DRY: aws s3 sync . s3://$BUCKET --delete --exclude deploy.sh --exclude '.*' --exclude index.html --cache-control 'public,max-age=3600'"
      echo "DRY: aws s3 cp index.html s3://$BUCKET/index.html --cache-control no-cache --content-type text/html"
      echo "DRY: aws cloudfront create-invalidation --distribution-id ${DIST_ID:-<SITE_DISTRIBUTION_ID>} --paths '/*'"
      echo "DRY: curl -fsSL $SITE_URL/index.html | shasum -a 256"; exit 0
    fi
    [ -n "$DIST_ID" ] || { echo "SITE_DISTRIBUTION_ID is required (terraform output -raw site_distribution_id)" >&2; exit 1; }
    aws s3 sync . "s3://$BUCKET" --region "$REGION" --delete --exclude deploy.sh --exclude '.*' --exclude index.html --cache-control "public,max-age=3600"
    aws s3 cp index.html "s3://$BUCKET/index.html" --region "$REGION" --cache-control no-cache --content-type text/html
    INV="$(aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' --query 'Invalidation.Id' --output text)"
    echo "INVALIDATION=$INV"
    aws cloudfront wait invalidation-completed --distribution-id "$DIST_ID" --id "$INV"
    LOCAL="$(shasum -a 256 index.html | cut -c1-16)"
    REMOTE="$(curl -fsSL "$SITE_URL/index.html" | shasum -a 256 | cut -c1-16)"
    [ "$LOCAL" = "$REMOTE" ] || { echo "live index.html ($REMOTE) != local ($LOCAL)" >&2; exit 1; }
    echo "OK site index.html sha256[0:16]=$REMOTE"
    ```

Estimated size: infra ~330 lines across 14 files, allow file 40, `hosts.ts` 45, `apiClient.ts` +40/−10, callers 3 × (2/4), tests ~95 + ~120, console 4 lines, site ~75 + 20 + 35.

Supervisor post-apply (recorded here, not run by the worker, not verified by `E09.verify.sh`): (1) `terraform init` (real backend) → `terraform plan -out=e09.tfplan` → `terraform show -json e09.tfplan | python3 infra/scripts/check-plan.py --allow docs/delivery/r16-issues/E09.plan-allow.json` → `terraform apply e09.tfplan` (one apply; the two `aws_acm_certificate_validation` resources wait for issuance against the live zone — minutes; if it stalls, `apply -target=module.edge.aws_route53_record.cert_validation` first, then the full plan). (2) `terraform output zone_name_servers` must equal the registrar's set (already delegated; no owner action). (3) `SITE_DISTRIBUTION_ID="$(terraform output -raw site_distribution_id)" site/deploy.sh`. (4) `frontend/deploy.sh` (the console now answers on `https://console.developercards.app` and calls `https://api.developercards.app`). (5) Read-only smoke: `curl -sI https://api.developercards.app/health`, `https://cdn.developercards.app/content/manifest.json`, `https://console.developercards.app/`, `https://developercards.app/`, `https://www.developercards.app/` → 200. (6) Optional hygiene: add `https://console.developercards.app` to the Lambda `CORS_ORIGIN` on `$LATEST` (jq merge, E06's `merge-env.sh`) before the next `ENV=prod ./src_C/deploy.sh` — browsers are served by API Gateway's CORS config regardless. (7) Second `terraform plan` must be empty; paste `site_distribution_id` into `infra/README.md` §6. Owner (later, E15 runbook): `eas update` with `EXPO_PUBLIC_API_BASE=https://api.developercards.app` (+ optionally `EXPO_PUBLIC_CONTENT_BASE_URL=https://cdn.developercards.app`) in the EAS `production` environment; Cognito hosted-UI custom domain (`auth.`) is post-wave.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E09.verify.sh` re-runs exactly these (≈ 5–8 min; the plan dominates).

1. Scope files exist: `infra/modules/edge/{dns,certs,site}.tf`, `mobile/src/config/hosts.ts`, `mobile/tests/unit/{hosts,apiClientFallback}.test.ts`, `site/{index.html,styles.css,deploy.sh}` (executable), `docs/delivery/r16-issues/E09.plan-allow.json`; prerequisites on the integration branch: `infra/envs/prod/{main,imports,backend}.tf`, `infra/scripts/check-plan.py`, `cognito-jwt-mobile` in `gateway.tf`, `console_dev` in `cognito.tf`, `configuration_aliases` in `modules/edge/main.tf`.
2. Literal guards (all exit 0): root `variable "domain"` with default `"developercards.app"`, the example line, the eight outputs, the import block (`to = module.edge.aws_route53_zone.main[0]`, `id = "Z0284954BSN00C8BF94Q"`), the module arguments of #3b–d, `"https://console.${var.domain}"` in `main.tf`, no un-indexed `aws_route53_zone.main"` reference, `imports.tf`/`backend.tf`/`versions.tf`/`providers.tf`/lock file zero-diff; edge variables/outputs of #4; every resource, local and pinned attribute of #5–#8 (count guards, `comment = "HostedZone created by Route53 Registrar"`, `prevent_destroy = true`, `for_each = local.record_types` / `local.site_record_types`, ≥ 4 `evaluate_target_health = false`, both certificates' `domain_name`/SAN/`validation_method`/`create_before_destroy`, `provider = aws.use1` twice, the `flatten(…)` / `if dvo.domain_name == var.domain` validation record with `allow_overwrite = true`, both `validation_record_fqdns`, the `cloudfront_cert_arn` local, both `aliases`, ≥ 2 `acm_certificate_arn = local.cloudfront_cert_arn` / `sni-only` / `TLSv1.2_2021` in `cdn.tf` and no `cloudfront_default_certificate = true`, the eight site resources with ≥ 8 count guards, `developercards-site-oac`, the two managed policy ids, exactly two `response_page_path = "/index.html"`, `"AWS:SourceArn" = aws_cloudfront_distribution.site[0].arn`, `comment = "DeveloperCards landing page"`); api variables/outputs of #9 (`api_hostname`, `api_domain_target_domain_name`, `api_domain_hosted_zone_id`) and the domain-name / mapping (`stage = aws_apigatewayv2_stage.default.id`, no `api_mapping_key`) / `for_each = var.zone_id == "" ? toset([]) : toset(["A", "AAAA"])` records / `local.api_hostname`, no `disable_execute_api_endpoint = true`; identity `variable "console_hostname"`, both `https://${var.console_hostname}…` literals, the CloudFront callback kept, `var.console_hostname == "" ? []`; no `provisioner|local-exec|null_resource|"external"|archive_file` in any E09 `.tf`, no `profile = "` under `infra`; `E09` and `Z0284954BSN00C8BF94Q` in `infra/README.md`; `hosts.ts` constants, `HostEnv`, both signatures, the three literal `process.env.EXPO_PUBLIC_…` reads, the `replace(/\/+$/, '')` clean-up, purity; `apiClient.ts` import, `activeBase`, `resetApiBaseForTests`, `apiJson<T>(`, `e instanceof TypeError`, the `canRetry` expression, `err.apiErrorCode =`, no `Missing EXPO_PUBLIC_API_BASE`, no `process.env.`; each caller calls `resolveApiBase()` exactly once with the pinned import path and no `process.env.EXPO_PUBLIC_API_BASE`; `grep -rl` of that literal under `mobile/src` = `hosts.ts` + `deckRepository.ts`; both test files carry every `it('…')` title above (≥ 8 each), `fast-check` + `fc.assert(` in `hosts.test.ts`, `resetApiBaseForTests()`, `new TypeError('Network request failed')`, `name: 'AbortError'`, `globalThis.fetch = vi.fn(` in the fallback suite; console `.env.production` lines, `.env.development` client id (26 chars, ≠ spa id, present in `infra/README.md`), `deploy.sh` `CONSOLE_URL` + curl line and no CloudFront curl; landing page structure, `<title>`, H1, the one-liner twice, the App Store link, the four `<h2>`s, the pinned sentences, the two footer links, no `OFFLINE…` / `cloud backup`, no `@import` / `url(` in the CSS; `site/deploy.sh` bucket/dist/url defaults, `--exclude deploy.sh`, DRY_RUN block, `--paths '/*'`, `shasum -a 256`; no `.skip(`/`.only(`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` in any E09 TS file; the allow file JSON-equals #12.
3. Gates: `terraform fmt -check -recursive infra`; `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`; `cd mobile && npm run test:typecheck`; `cd frontend && npm run lint && npm run build`; `bash -n site/deploy.sh frontend/deploy.sh`; the allow file parses; `check-plan.py` compiles.
4. Plan + tests + site: `AWS_PROFILE=dev` account `622994489535`; a temp var-file = `prod.auto.tfvars.example` with `alert_email` / `snowflake_external_id` replaced by the live values (read-only CLI, never printed); `cd infra/envs/prod && terraform init -input=false -reconfigure && terraform plan -lock=false -input=false -refresh=true -var-file=<tmp> -out=<tmp>/e09.tfplan && terraform show -json …`; `.terraform.lock.hcl` unchanged by init; `python3 infra/scripts/check-plan.py --plan … --allow docs/delivery/r16-issues/E09.plan-allow.json` passes; independently: every effective managed change is listed in #12 with exactly its action and, for the four updates, known-value changed keys ⊆ its keys (the zone: `importing`, tags-only or no-op — the only `importing` entry), nothing else; `output_changes` = exactly the eight outputs of #2, all `create`; shape: both distributions' planned `aliases` are `["cdn.developercards.app"]` / `["console.developercards.app"]`, the site distribution's `["developercards.app", "www.developercards.app"]`, the API domain name is `api.developercards.app` with `REGIONAL`/`TLS_1_2`, the mapping's stage is `$default`, both certificates carry `developercards.app` + `*.developercards.app`, the API's planned `allow_origins` and `spa`'s planned `callback_urls`/`logout_urls` contain the console origin and keep the CloudFront one. Plan files deleted. `aws cognito-idp list-user-pool-clients` (read-only): the live `console-dev` id equals `.env.development`'s. `cd mobile && npx vitest run tests/unit/hosts.test.ts tests/unit/apiClientFallback.test.ts --reporter=dot`; `cd frontend && npx vitest run tests/uiLanguage.test.ts tests/deckFormFieldDrop.test.tsx tests/newDeckPage.test.tsx tests/docsPaths.test.ts tests/rootReadmePaths.test.ts --reporter=dot`; `site/index.html` + `styles.css` decode as ASCII, tags balanced and ⊆ the whitelist, hrefs ⊆ the four allowed, no `src`/`style`/`on*` attributes, `grep -c '<script'` = 0, no red-line hit (`thousands|android|google play|three decks|official|guarantee|fsrs|sm-2|anki|epic|trial|verified against`, case-insensitive); `DRY_RUN=1 site/deploy.sh` with a stub `aws` on `PATH` exits 0 and prints the `DRY:` sync + invalidation lines.
5. Scope + frozen + OTA + guards: the three frozen files zero-diff; `mobile/package.json`, `package-lock.json`, `app.json` (`"version": "1.6.1"`), `eas.json` zero-diff; no `@sentry` under `mobile/src`; `deckRepository.ts` still carries the CloudFront default; each caller numstat = 4 removed / ≤ 3 added; every changed or untracked path (pathspecs `infra mobile/src mobile/tests frontend/src frontend/tests frontend/.env.production frontend/.env.development frontend/deploy.sh site docs`) is a scope file or `docs/delivery/r16-issues/*`; no `*.tfplan` / `*.plan.json` / `*.tfstate` / `generated*.tf` / non-example `*.auto.tfvars` tracked under `infra`; no secret literal in added lines; no worker artefact (every E09 file except the two DRY_RUN-guarded deploy scripts) contains an apply / state-changing import / mutating `aws … create|update|delete|put-…` command outside a comment, and neither deploy script runs one before its `DRY_RUN` check.

## Verify

```bash
BASE=delivery/r16-e-prod AWS_PROFILE=dev bash docs/delivery/r16-issues/E09.verify.sh
```

Runs steps 1–5 above. Step 4's plan is read-only against the real backend (`-lock=false`; E01 gap 13, E08 precedent) and is the supervisor's plan: expect `Plan: 1 to import, 27 to add, 4 to change, 0 to destroy` (the import is the zone; `tags_all` may add it to the change count). If `init -reconfigure` fails because the state bucket or an earlier issue's apply is missing, stop and report — E01–E08 must be applied and their second plan empty before E09 runs. **The worker never applies**: the supervisor runs `terraform plan -out`, `check-plan.py --allow docs/delivery/r16-issues/E09.plan-allow.json`, `terraform apply`, then the post-apply list above, then a second plan that must be empty. The driver then runs the root gates (`infra`: init/validate/fmt; `mobile`: `npm run test:typecheck && npx vitest run`; `frontend`: `npm run lint && npx vitest run && npm run build`) plus the diff-scoped banned-term grep and the suppression scan; all must be green, so do not leave any other suite red.

## Do NOT

- Do NOT create the hosted zone, edit `imports.tf`, run `terraform import`, `terraform apply`, `terraform init -migrate-state`, `terraform state …`, `terraform plan` without `-lock=false` against the real backend (the read-only `init -input=false -reconfigure` + `plan -lock=false` of gap 7 is the ONLY real-backend contact allowed), any `aws … create/update/delete/put-…`, `eas`, or `site/deploy.sh` / `frontend/deploy.sh` without `DRY_RUN=1`.
- Do NOT rename or recreate `E28BKORJLV6UXG` / `E85FKUMZZWQWX` / `ktbq1sie2c` / the `spa` client; do NOT set `disable_execute_api_endpoint`, add a `/dev` mapping key, change `http_version` on the content distribution, or touch the WAF, OACs, the content bucket policy, `console_bucket.tf`, `modules/data`, `modules/worker`, `modules/observability`.
- Do NOT put the `api.` records in `edge`, read `module.edge`/`module.api` outputs from `identity`, or add a seventh module.
- Do NOT touch `deckRepository.ts`, `progressSync.ts`, `model.ts`, `package.json`, `package-lock.json`, `app.json`, `eas.json`; do NOT read `process.env.EXPO_PUBLIC_*` anywhere but `hosts.ts`; do NOT retry on HTTP statuses or aborts; do NOT keep a `Missing EXPO_PUBLIC_API_BASE` throw.
- Do NOT edit `frontend/src/**`, `frontend/.env.e2e`, any existing test, `src_C/**`, `README.md`, or any dated `docs/*.md`.
- Do NOT put JavaScript, images, fonts, inline styles, analytics, a privacy policy, prices or any sentence outside `home-review-and-launch-copy:120-198` on the landing page; do NOT quote `:399-427`.
- Do NOT run npm or git inside `/Users/qc/src/recallsmith` or anywhere under `/Users/qc/Desktop` — only inside your worktree.
