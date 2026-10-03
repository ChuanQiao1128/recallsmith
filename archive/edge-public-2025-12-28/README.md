# edge-public (retired 2026-10-04)

This directory is a record, not code that runs. It holds the source of the Lambda function
`edge-public` exactly as AWS last served it, so the decision to retire it can be checked later.
Nothing builds, runs or deploys it: every CI job works inside its own directory (`frontend/`,
`mobile/`, `tools/*`, `integrations/n8n`, `src_C`, `services/*`, `infra/`), and none of them is
`archive/`. The one CI check that reads it is `infra/scripts/tests/test_r27_edge_public_retired.py`,
which confirms these files are here and that the manifests keep their `.archived` names (see Files).

GitHub's CodeQL default setup does analyse this directory: it covers `javascript-typescript` on pull
requests, on pushes to `main` and weekly, and default setup has no path exclusions, so `src/**/*.js`
here is scanned like live code. An alert on a file under `archive/` is about code that no longer runs:
dismiss it as "Won't fix" with the comment "archived, not deployed (archive/edge-public-2025-12-28)".
The likeliest subject is the unverified-token fallback in `src/common/auth.js`, reviewed below.

## What it was

A Node.js Lambda outside the VPC, behind the production HTTP API `developercards-api` (`ktbq1sie2c`),
on these three gateway routes, each with an unauthenticated `OPTIONS` twin that went to core-vpc:

| Route | Handler (`src/public/handler.js`) | Did |
|---|---|---|
| `ANY /api/v1/admin/cognito/{proxy+}` | `cognitoAdmin/users.js`, `disableUser.js`, `deleteUser.js` | list, create and disable console accounts in the console Cognito pool; delete was a 501 stub |
| `ANY /api/v1/ai/{proxy+}` | `ai/explainCard.js` | nothing: `POST /api/v1/ai/explain-card` answered 501 "TODO" |
| `ANY /api/v1/billing/{proxy+}` | `billing/verify.js`, `webhookApple.js`, `webhookGoogle.js` | nothing: every path answered 501 "TODO" |

Only the console's Admin Users page called any of them (`listAdminUsers` / `createAdminUser` in
`frontend/src/api/admin.ts`, GET and POST `/api/v1/admin/cognito/users`). The mobile app, the MCP
server, the author runner and every service called none.

| Fact | Value |
|---|---|
| Function | `edge-public`, unversioned (`$LATEST` only, no alias), runtime `nodejs24.x`, arm64, 128 MB, 15 s |
| Handler | `src/public/handler.handler` |
| CodeSha256 | `IzsqANaurZwmxTl1CI0kOJ5uKmgJ4GFA6D/kiHrqdPE=` (the downloaded zip hashes to this) |
| LastModified | `2026-09-22T10:00:36Z` (a configuration change; the files in the zip are dated 2025-12-28) |
| Zip | 21,941,638 bytes, 17,576 entries; all but the 15 files here are `node_modules/` |
| Environment keys | `ADMIN_GROUPS`, `COGNITO_SUPPRESS_INVITE`, `COGNITO_USER_POOL_ID`, `DEFAULT_NEW_ADMIN_GROUPS` (values not recorded) |
| Execution role | `service-role/edge-public-role-zezx326f`: inline `edge-public-cognito` (below) and the managed `AWSLambdaBasicExecutionRole-4587d025-…` (logs) |
| Source in the repository | never (enterprise audit SDLC-05 / ENT-01); `src_C/Public` was a C# rewrite that was never deployed |

## Traffic: none for 283 days

Measured on 2026-10-04 with the read-only operator role:

- CloudWatch `AWS/Lambda Invocations` for `edge-public`, daily sums from 2025-10-01 to 2026-10-03:
  **8 invocations in its whole life** (1 on 2025-12-14, 5 on 2025-12-15, 2 on 2025-12-25), 0 errors,
  **0 in the 90 days before retirement**. Its log group was created on 2025-12-14.
- Its newest log stream is `2025/12/25/[$LATEST]…`; the role's `RoleLastUsed` is 2025-12-25.
- API Gateway per-route counts over the same 90 days: `/api/v1/ai/{proxy+}` and
  `/api/v1/billing/{proxy+}` none; `ANY /api/v1/admin/cognito/{proxy+}` 2 requests on 2026-09-26 (UTC,
  08:30-08:35), both answered 4xx by the gateway without invoking the function (no
  `IntegrationLatency` datapoint, no Lambda invocation in that window), plus 1 `OPTIONS` in the same
  five minutes.
- The archived files are dated 2025-12-28, three days after the last invocation, so this exact code
  may never have served a request.

## Security review of this code

**Authentication.** `src/common/auth.js` takes the caller's claims from
`requestContext.authorizer.jwt.claims` when API Gateway supplies them. When it does not, it falls back
to base64-decoding the payload of the `Authorization: Bearer` token with **no signature, issuer,
audience or expiry check** (`decodeJwtWithoutVerify`, commented "fallback for local/dev (NOT SECURE)").
Roles come from `cognito:groups`: `super_admin`, or `editor` / `editor_*`.

- Until E08 (2026-09-26) the three routes had `AuthorizationType NONE` (E01 inventory, 2026-09-22), so
  the fallback was the only check: an unsigned, hand-made token carrying `cognito:groups: ["super_admin"]`
  would have been accepted for every Cognito admin action below. The metrics above show no invocation
  after 2025-12-25, so that window carried no traffic from then on; the eight December calls cannot be
  attributed (their log events have expired: 30-day retention since E02, 0 stored bytes on 2026-10-04).
  infra/RUNBOOK.md §14 asks the owner to list the console accounts once and confirm each is expected.
- From E08 on, the console JWT authorizer (`cognito-jwt`: console pool issuer, SPA client audience)
  sat in front of all three routes, so verified claims were always present and the fallback was
  unreachable through the gateway.

**Cognito admin actions** (`src/public/cognitoAdmin/cognito.js`; every route requires `super_admin`):

- List: `ListUsersInGroup` for each group in `ADMIN_GROUPS` (default `["super_admin","editor"]`), merged
  by username; returns username, sub, email, enabled, status, groups, created time.
- Create: `AdminCreateUser` with the caller's username and temporary password, attributes `email` and
  `email_verified=true` (marked verified without a verification step), `MessageAction=SUPPRESS` unless
  `COGNITO_SUPPRESS_INVITE` is `false` (default: no invitation email); then `AdminAddUserToGroup` for each
  group in `DEFAULT_NEW_ADMIN_GROUPS` (default `["editor"]`). A list containing `super_admin` is refused,
  but only in code: the IAM policy allows `AdminAddUserToGroup` for any group of the pool. The input
  checks were a `@` in the email and a temporary password of 8 or more characters. The console pool uses
  the email address as the username (`username_attributes = ["email"]`), while the console form sent a
  separate username such as `alice_editor`, which Cognito expects to be an email.
- Disable: `AdminDisableUser` (`POST …/users/<username>/disable`).
- Delete: answered 501; `AdminDeleteUser` was granted to the role but never called.
- Cognito's error message was returned to the caller (`COGNITO_ERROR`); the request log line carried the
  caller's sub, username and groups, never a token or a password.

IAM: inline policy `edge-public-cognito` allowed `ListUsersInGroup`, `AdminCreateUser`,
`AdminAddUserToGroup`, `AdminDisableUser` and `AdminDeleteUser` on the console pool
(`ap-southeast-2_4Vf8uCXKt`) only.

**Billing and AI.** Stubs: `billing/verify` (signed-in user, POST), `billing/webhook/apple` and
`billing/webhook/google` (no authentication and no signature check, POST) and `ai/explain-card` all
answered 501 "TODO" and touched nothing. `verifyInternalSignature` (HMAC-SHA256 over `ts.body` with
`INTERNAL_SHARED_SECRET`, 5-minute skew, constant-time compare) is defined in `auth.js` and never called;
`INTERNAL_SHARED_SECRET` was not in the function's environment.

**Dependencies.** `package.json` names the Cognito, S3 and SNS clients, the S3 presigner, `pg`,
`react-syntax-highlighter` and `react-native-syntax-highlighter`; the source loads only
`@aws-sdk/client-cognito-identity-provider`. `npm audit --package-lock-only` of the archived lockfile on
2026-10-04: 29 advisories (1 critical in `fast-xml-parser`, 1 high in `prismjs`, 27 moderate).

## Why retired rather than adopted

- Nothing used it: 8 invocations ever, none after 2025-12-25. Two of its three route families were
  501 stubs, and the third had no caller but one console page.
- Adopting it would have meant bringing unreviewed code into CI/CD with an unverified-token fallback, a
  role that can create console accounts and add them to any group, and a dependency tree it does not use
  with known advisories. The only real feature, managing a handful of console accounts, is owner work:
  the AWS CLI under the owner's MFA (`devcards-admin`) does it, with CloudTrail naming the actor.
- Retiring removes a standing privileged identity and three routes from the production API.

What replaced it: the console's Users & permissions page keeps deck permissions (core-vpc) and
migrations, and says where account management went; infra/RUNBOOK.md §14 has the `aws cognito-idp`
commands and the retirement and rollback procedure.

## Files

`src/**` are byte-identical to the deployed zip. The two manifests are stored as
`package.json.archived` and `package-lock.json.archived`, byte-identical to the zip's `package.json` and
`package-lock.json`: under their real names GitHub's dependency graph would read them as a live project,
and Dependabot security updates (enabled for the whole repository) would raise alerts and fix pull
requests for code that no longer runs. Rename them back to rebuild (RUNBOOK §14, Rollback).

| SHA-256 | File in the zip |
|---|---|
| `ef37bf5d420901174ccc6faa6994886eca6d0de104bd16e872afa9598cf963ef` | `package-lock.json` |
| `7d8d6ffcd221438d97c8e0dbf410d431f4cac32d76c273e8835144331c310b04` | `package.json` |
| `c0c50f4a5a49feeed50b8decf1a7e098e84cd52bda257bb92be844ad512ec8fa` | `src/common/auth.js` |
| `a5fda776acf9755890d8fa22d23e905c6518d8901847e94c94e817b0c3dc1a12` | `src/common/log.js` |
| `d6ae9e41744abda16f78f72e1366e8a64a6c66f0b38ea484c29b31e86595200c` | `src/common/res.js` |
| `70d4cf7aaf5f238fd619276b6dceda54409e10a6eb788046d2691eb3788b36b7` | `src/common/validate.js` |
| `f7dd2385a7238b6d22c1fc6973e7010c75f037af2e9f335751031117988d783b` | `src/public/ai/explainCard.js` |
| `d51f98cb3d1c513dff21be632b91a9b13fab47b32975937e907f5a798fc13193` | `src/public/billing/verify.js` |
| `d80c0e725cf0b5e159aaa5177c11d514797f42195357d5578be8f07b359a9a32` | `src/public/billing/webhookApple.js` |
| `30fb06d464a84ae9bfedc218d9a234f3e36f2516550d1d0a7bb837ad52722083` | `src/public/billing/webhookGoogle.js` |
| `42e21f67775c4909c17a3025ed320c30a8bfe52be3bb4d6162cf85fae749823c` | `src/public/cognitoAdmin/cognito.js` |
| `6eeb0039e3670e59d80aa8173f8aa920e5eec94c6657fd885dc63a4ef655ed58` | `src/public/cognitoAdmin/deleteUser.js` |
| `960be0ea2d06917f299f059c7c2eb408cc67269b079a95d4d0ef6d7a1bf11851` | `src/public/cognitoAdmin/disableUser.js` |
| `0a66173d8c6ae1d82d5e5157c21aa3230df9382cbefd1d969df2aa022e73c4b5` | `src/public/cognitoAdmin/users.js` |
| `be0897fc76ce24928fcdb7672a55925284257ca6e9791c617545103fdedefcea` | `src/public/handler.js` |

A grep of these files for keys, tokens, account-specific ARNs and URLs found nothing to redact: the code
reads its pool id and groups from the environment.
