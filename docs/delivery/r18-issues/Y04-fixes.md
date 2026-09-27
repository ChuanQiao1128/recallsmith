# Y04 — Infra round 2: per-finding fixes ledger

Base: `delivery/r18y-p` (= `release/1.8.0` + Y03). Scope: `infra/`, `docs/delivery/r18-issues/`,
`services/ai-qa/README.md`, `services/webhook-dispatcher/README.md`. Nothing was applied; the supervisor
applies after merge against `docs/delivery/r18-issues/Y04.plan-allow.json`.

Real-backend plan (read-only, `-lock=false`, 2026-09-27): base tree `No changes`; this branch
**4 to add, 2 to change, 0 to destroy**, exactly the allow-list:

| Address | Action | Changed keys |
|---|---|---|
| `module.api.aws_apigatewayv2_authorizer.console` | update | `jwt_configuration` (audience → SPA client only) |
| `module.api.aws_apigatewayv2_authorizer.agent` | create | new `cognito-jwt-agent` |
| `module.api.aws_apigatewayv2_route.this["agent_admin_decks"]` | create | `GET /api/v1/admin/decks` |
| `module.api.aws_apigatewayv2_route.this["agent_cards_similar"]` | create | `POST /api/v1/authoring/cards/similar` |
| `module.api.aws_apigatewayv2_route.this["agent_drafts_submit"]` | create | `POST /api/v1/authoring/drafts` |
| `module.identity.aws_iam_role_policy.ai_qa` | update | `policy` |

The event source mapping `ignore_changes` additions produce no plan change.

## Cross-wave contract (ai-agent-6), as implemented here

- Gateway authorizer `console` (`cognito-jwt`): audience `[6lkofepp2llp6v4nueg52mcm5v]` (SPA only).
- Gateway authorizer `agent` (`cognito-jwt-agent`): same issuer (console pool), audience SPA +
  console-dev `5au94igdq00nipsst7spsqepb7`.
- `agent` is attached only to the three exact route keys the MCP server calls, enumerated from
  `tools/mcp-server/src`: `api.ts:97-100` (`GET /api/v1/admin/decks?q=…`, the slug lookup),
  `server.ts:98` (`POST /api/v1/authoring/cards/similar`), `server.ts:194` (`POST /api/v1/authoring/drafts`).
  Nothing else in `tools/mcp-server/src` calls the API.
- core-vpc's `AgentClientPolicy` stays as defence in depth. It currently also allows
  `GET /api/v1/authoring/decks` and `GET /api/v1/authoring/drafts/:draftId`; trimming it to the three
  routes is core-vpc's change (Y02, `src_C` is outside this issue's scope). Through the gateway those two
  are already unreachable with an agent token, and `check-agent-routes.py` prints them as warnings.

## Findings

### ai-agent-6

Status: fixed

- `infra/modules/api/gateway.tf:139`: the `console` authorizer's audience is `[var.console_client_id]`
  (was `concat([console_client_id], console_extra_audiences)`), so a console-dev token now gets 401 at the
  gateway on every console route, including all edge-public routes: `ANY /api/v1/admin/cognito/{proxy+}`
  (users list, disable, delete), `ANY /api/v1/ai/{proxy+}` (paid) and `ANY /api/v1/billing/{proxy+}`. The
  token never reaches edge-public, so `Auth.RequireSuperAdmin` not checking `IsAgentClient` no longer opens
  a path.
- `infra/modules/api/gateway.tf:144-156`: new `aws_apigatewayv2_authorizer.agent` (`cognito-jwt-agent`,
  audience `concat([var.console_client_id], var.agent_client_ids)`).
- `infra/modules/api/gateway.tf:55-60`: three exact routes with `auth = "agent"`; exact keys win over the
  greedy `ANY /api/v1/admin/{proxy+}` / `ANY /api/v1/authoring/{proxy+}` console routes. `:11-16` documents
  the rule. `:68-72` adds `agent` to `authorizer_ids`. core-vpc's alias permission already covers every
  route (`core_vpc.tf:58-65`), so no Lambda permission change.
- `infra/modules/api/variables.tf:128-132`: `console_extra_audiences` replaced by `agent_client_ids`;
  `infra/envs/prod/main.tf:120` passes `[module.identity.console_dev_client_id]`.
- `infra/README.md`: Y04 entry; J06 row marked superseded.
- Not done here (outside scope): the belt-and-braces `Auth.RequireSuperAdmin` → 403
  `AGENT_CLIENT_FORBIDDEN` check and its integration test live in `src_C` (another wave's root). The
  gateway change alone closes the reported path because an agent token cannot reach edge-public at all.
- Tests:
  - `Y04.verify.sh` step 3 plan-shape assertion: the `console` authorizer's audience does not contain
    `5au94igdq00nipsst7spsqepb7`, and some authorizer does (fails on the base tree, passes here).
  - `infra/scripts/check-plan.py --allow docs/delivery/r18-issues/Y04.plan-allow.json` → `PLAN OK 6`.
  - `infra/scripts/check-agent-routes.py` (new): the console audience is SPA-only, the agent authorizer adds
    `var.agent_client_ids`, the agent routes are exact keys, equal the MCP server's request set, and are on
    core-vpc's AgentClientPolicy allowlist. Base tree: exit 1 (4 violations). This branch: `AGENT ROUTES OK`.
    No CI job runs infra scripts (and `.github` is outside this scope), so run it by hand before an apply.

### cloud-security-resilience-13

Status: fixed

- AWS Service Authorization Reference, "Actions, resources, and condition keys for Amazon Bedrock Powered
  by AWS Mantle" (https://docs.aws.amazon.com/service-authorization/latest/reference/list_bedrock-mantle.html):
  `CreateInference` requires resource type `project`
  (`arn:${Partition}:bedrock-mantle:${Region}:${Account}:project/${ResourceId}`) and supports the condition
  keys `aws:ResourceTag/${TagKey}`, `bedrock-mantle:Model` and `bedrock-mantle:ServiceTier`. The Bedrock
  Projects guide names the account's default project `project/default`; the vendored
  `anthropic/lib/bedrock/_mantle.py` sends no `OpenAI-Project` header, so every ai-qa call lands there.
- `infra/modules/identity/roles_r18.tf:136-142`: one Bedrock statement, `BedrockMantleInference` =
  `bedrock-mantle:CreateInference` on `arn:aws:bedrock-mantle:ap-southeast-2:622994489535:project/default`
  (was `project/*`) with `StringEquals bedrock-mantle:Model = anthropic.claude-opus-5` (was no model limit).
  The never-exercised `BedrockInvokeProfile` and `BedrockInvokeFoundationModel` statements are removed.
  `:80-89` and `:108-109` replace the comment that claimed the models were "reachable only through the
  inference profile".
- `infra/modules/identity/variables.tf:96-105`: `bedrock_inference_profile_id` / `bedrock_foundation_model_id`
  replaced by `bedrock_mantle_model_id` and `bedrock_mantle_project_id` (default `default`).
- `infra/envs/prod/main.tf:6-9,65,164`: one local `ai_qa_model_id` feeds both the IAM condition and the
  function's create-time `AI_MODEL`, so Terraform cannot drift them apart (`services/ai-qa/env/prod.env.json`
  has the same value).
- `infra/README.md`: J15 row corrected in place; Y04 entry records the reference, what cannot be narrowed
  further (no inference-profile or routing key exists on this action), and that no `CreateInference` has
  run in the account yet (`AI_QA_ENABLED=0`; CloudTrail lookup empty), so the first enabled run is the live
  check of the model condition (a mismatch shows as `PROVIDER_ACCESS_DENIED`, alarmed).
  `services/ai-qa/README.md` "Bedrock IAM (R18 Y04)" explains the grant and that a model change needs the
  Terraform local and `AI_MODEL` changed together. RUNBOOK §7 `ai-qa-error-…` names the mismatch as a cause.
- Tests: `check-plan.py` against the allow-list (`module.identity.aws_iam_role_policy.ai_qa`, keys
  `[policy]`); the planned policy JSON was inspected: one Bedrock statement, resource `project/default`,
  condition `bedrock-mantle:Model`.

### cloud-security-resilience-14

Status: fixed

- `infra/RUNBOOK.md` §7 "Emergency stop for the SQS consumers (R18 Y04)" (`:110-133`): one procedure for
  ai-qa and webhook-dispatcher — disable the event source mapping (takes effect at once); for ai-qa also
  `AI_QA_ENABLED=0` on core-vpc (needs a deploy, blocks new runs only); explicitly not reserved concurrency 0
  for ai-qa (a throttled SQS-triggered function still has messages received, and `maxReceiveCount = 2`
  moves chunks to the DLQ); re-check the mapping state around any apply.
- `infra/RUNBOOK.md:99-106`: the `ai-qa-error-provider-*` / `-config` and `ai-qa-daily-cost` lines now
  point at that stop instead of "Set `AI_QA_ENABLED=0`". `:62-64` (§6 drift) records the ignored `enabled`.
- `infra/modules/worker/ai_qa.tf:77-81` and `infra/modules/worker/webhooks.tf:76-80`:
  `ignore_changes = [metrics_config, enabled]`, so an apply no longer re-enables a stopped consumer. No
  plan change (both mappings are enabled today).
- `services/ai-qa/README.md` "Emergency stop" (`:232-260`): the same order (mapping first,
  `AI_QA_ENABLED` second), the concurrency-0 option replaced by the reason not to use it, and the
  Terraform note. `services/webhook-dispatcher/README.md` "Supervisor-only operations" (`:244-255`): the
  same stop, concurrency 0 dropped with the reason (`maxReceiveCount = 5`).
- Tests: `terraform validate`, `terraform fmt -check -recursive infra`; the Y04 plan shows no change to either
  `aws_lambda_event_source_mapping` (checked by `check-plan.py`: any change there would be an unlisted
  violation). The three documents were cross-read for the same commands.

### automation-15

Status: fixed

- `infra/RUNBOOK.md:88-94` `webhook-enqueue-failures`: the row is kept as `enqueue_failed`, not lost; fix
  the queue or grants, wait 10 minutes, `POST /api/v1/admin/webhooks/deliveries/sweep`, repeat 10 minutes
  apart until `enqueueFailures` is 0 (links `X01-ledger-runbook.md`).
- `infra/RUNBOOK.md:79-85` `webhook-delivery-dead`: one procedure — console **Redeliver** on each `dead`
  row, then purge the webhook DLQ; never redrive the DLQ while automation-12 (a success report on a `dead`
  row is ignored by core-vpc) is not deployed. Links the dispatcher README section.
- `services/webhook-dispatcher/README.md` "Dead deliveries and the DLQ" (`:257-…`): the same procedure,
  the unsupported-version case (rows stay `queued` with 0 attempts; redrive only a DLQ that holds nothing
  else, or let the sweep re-send them after a purge), and the enqueue-failure sweep. The old
  "DLQ redrive, after fixing the cause" bullet is replaced.
- Procedure choice: Redeliver + purge is correct both before and after automation-12's core-vpc fix
  (Y01, not merged into this base), so the runbook is not wrong in either state. Once automation-12 is
  deployed, DLQ redrive can become an alternative; the README says the section changes only then.
- Tests: documentation only; cross-checked against `WebhookDeliveries.cs` sweep route (via
  `X01-ledger-runbook.md`) and `frontend/src/lib/webhookRules.ts:141` (`dead` rows are redeliverable).
