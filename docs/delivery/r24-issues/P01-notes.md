# P01 — API Gateway: POST /api/v1/public/events (R24, wave p)

Issue #640. Contract `R24-00-contracts.md` §3.3.

## What changed (files)

- `infra/modules/api/gateway.tf`
  - `local.routes.public_events = { route_key = "POST /api/v1/public/events", integration = "core_vpc", auth = "none" }`
  - `local.route_throttles["POST /api/v1/public/events"] = { burst = 10, rate = 5 }` (applies to both stages
    `default` and `dev` through the existing `route_settings` dynamic blocks).
- `infra/README.md` §6 — change-log line for P01.
- `docs/delivery/r24-issues/P01.plan-allow.json` — the expected plan, in the J15 / V12 format.
- `docs/delivery/r24-issues/P01-notes.md` — this file.

## Surface shipped

One exact, unauthenticated API Gateway route `POST /api/v1/public/events` to the core-vpc integration
(authorization NONE, no OPTIONS route: the mobile app is not a browser and needs no CORS preflight),
throttled per route to burst 10 / rate 5 requests per second on both stages. Exact key (X08 rule), so no
other `/api/v1/public/*` path is opened: anything else under that prefix still falls to `ANY /{proxy+}`
and keeps the console JWT. The core-vpc handler that serves this path is a separate issue; until it ships,
core-vpc answers its usual not-found for the path.

## Expected plan (P01.plan-allow.json)

- `module.api.aws_apigatewayv2_route.this["public_events"]` — create
- `module.api.aws_apigatewayv2_stage.default` — update, `route_settings` only
- `module.api.aws_apigatewayv2_stage.dev` — update, `route_settings` only

Nothing else; `tags_only_updates` false.

## How it is tested (offline; no plan or apply against AWS)

- `terraform fmt -check -recursive infra` — pass.
- `terraform -chdir=infra/envs/prod init -backend=false -input=false -lockfile=readonly` + `validate` — pass.
- `python3 infra/scripts/check-agent-routes.py` — pass (the new route is `auth = "none"`, so the agent
  route set is unchanged).
- `infra/scripts/check-plan.py --allow docs/delivery/r24-issues/P01.plan-allow.json` against a synthetic
  plan JSON holding exactly the three changes above — `PLAN OK 3` (confirms the allow file parses and
  admits exactly that shape).
- The `api` module has no `terraform test` suite and the brief's scope allows no new test file, so there
  is no failing-first unit test for this change; the verify script's checks above are the gate.

## Owner / supervisor steps

1. `terraform plan -out=p01.tfplan` in `infra/envs/prod`, then
   `terraform show -json p01.tfplan | python3 infra/scripts/check-plan.py --plan - --allow docs/delivery/r24-issues/P01.plan-allow.json`.
2. `terraform apply p01.tfplan`; a second plan must print `PLAN EMPTY`.
3. Order: apply after (or together with) the core-vpc release that serves `POST /api/v1/public/events`.

## Deferred / notes

- The server handler, validation and storage of the events, the mobile sender and the console funnel
  view are other R24 issues (contract §3.1–§3.5).
- The verify scope pattern `docs/delivery/r24-issues/P01-.*` does not match the required file name
  `P01.plan-allow.json` (R20 V12 used `V12[-.].*`); the file is written under the name the issue and the
  contract require.
