# developercards-ai-qa

The pre-publish AI QA Lambda (`developercards-ai-qa`, handler `ai_qa.handler.lambda_handler`,
Python 3.12, arm64). It reviews each new or changed card once with Claude Opus 5 and turns the
answer into typed findings that core-vpc stores and the publish gate reads (contract §7).

## Flow (§7.1)

```
console "Run AI QA"
  → POST /api/v1/authoring/qa/runs            (core-vpc: rows in ai_qa_runs / ai_qa_items)
  → SQS developercards-ai-qa-jobs             (one message = one chunk of ≤ 5 cards, §7.4)
  → this Lambda                               (one model call per card, plus at most one repair turn)
  → POST https://api.developercards.app/api/internal/ai-qa/results   (HMAC, §4.3 / §7.7)
  → findings stored; the console polls GET …/qa/runs/:runId
```

Why a separate Lambda **outside the VPC** (§14 #1-#2): core-vpc has no internet egress and no
Lambda endpoint — its only way out is the SQS interface endpoint — and edge-public's source is not
in the repo. So the console reaches the model through core-vpc → SQS → this function → HMAC
callback. That also keeps a second JWT verifier out of Python and avoids the 30 s API Gateway
integration timeout. No Bedrock VPC endpoint is needed.

## Package layout

| Module | Role |
|---|---|
| `settings.py` | `Settings` (frozen dataclass), `load_settings(env)`, `ConfigError`, SSM `load_secret` |
| `providers.py` | `make_client(settings, *, api_key=None)`, `structured_outputs_on(settings)` |
| `prompts.py` | `PROMPT_VERSION` (currently `"qa-v4"`; history and evidence in `evals/reports/tuning-2026-09-27/README.md`), the static `SYSTEM_PROMPT` (rubric of §7.6) |
| `schema.py` | `ModelFinding`, `ModelReview` (pydantic v2, `extra="forbid"`) |
| `review.py` | `review_card(card, *, client, settings, review_date)` → one §7.7 item |
| `handler.py` | SQS entry point: message validation, kill switch, deadline guard, chunk policy, report |
| `internal_client.py` | signed `POST` to core-vpc (§4.3; same design as the webhook dispatcher's) |
| `emf.py` | CloudWatch EMF lines (§7.8) |

The evals harness (T04) imports `load_settings`, `make_client`, `review_card`, `PROMPT_VERSION`
and `ModelReview` unchanged, so its measured recall/precision describe exactly this code.

## Provider switch (§7.5, §7.9)

| `AI_PROVIDER` | Client | Credentials | Default model |
|---|---|---|---|
| `bedrock` (default) | `anthropic.AnthropicBedrockMantle(aws_region=AI_BEDROCK_REGION)` — endpoint `https://bedrock-mantle.<region>.api.aws/anthropic/` | the Lambda role, SigV4 per request (`bedrock-mantle:CreateInference`) | `anthropic.claude-opus-5` |
| `anthropic` | `anthropic.Anthropic(api_key=…)` | SSM `ANTHROPIC_API_KEY_SSM_NAME`, read only for this provider and only when the kill switch is on | `claude-opus-5` |

Both clients: timeout 120 s, `max_retries=2`. A Bedrock model id must start with `anthropic.`
and a first-party id must not (a bare first-party id is never sent to Bedrock); a mismatch is a
`ConfigError`.

**Bedrock IAM (R18 Y04).** The Mantle client signs for service `bedrock-mantle`, so the only action
it needs is `bedrock-mantle:CreateInference`; it never calls `bedrock:InvokeModel`, and the role no
longer grants it. The grant (`infra/modules/identity/roles_r18.tf`, Sid `BedrockMantleInference`)
names one resource, the account's `default` Mantle project (the client sends no `OpenAI-Project`
header), and pins `bedrock-mantle:Model` to one model id (prod: `anthropic.claude-opus-5`). IAM
therefore denies any other `AI_MODEL`: changing the model means changing `ai_qa_model_id` in
`infra/envs/prod/main.tf` (applied) together with `AI_MODEL` in `env/prod.env.json` (deployed); a
model changed only here fails every chunk with `PROVIDER_ACCESS_DENIED`.

Today Bedrock answers this account with an access error about **unsupported countries** until the
owner submits the Anthropic use-case form in the Bedrock console. That error arrives as
`PermissionDeniedError` → `PROVIDER_ACCESS_DENIED` (fail fast, acked). The alternative is
`AI_PROVIDER=anthropic` plus a real value in `/developercards/prod/anthropic-api-key`; a missing
key or the `PLACEHOLDER-set-by-supervisor` value is `CONFIG`.

## Environment

Committed in `env/prod.env.json` (overlaid by the deploy script; no secret values):

| Var | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `bedrock` | `bedrock` \| `anthropic` |
| `AI_MODEL` | `anthropic.claude-opus-5` / `claude-opus-5` | model id; blank = provider default |
| `AI_BEDROCK_REGION` | `ap-southeast-2` | Mantle region |
| `AI_EFFORT` | `high` | `output_config.effort`: `low` \| `medium` \| `high` \| `xhigh` \| `max` |
| `AI_STRUCTURED_OUTPUTS` | `auto` | `auto` \| `on` \| `off` (below) |
| `AI_QA_ENABLED` | `0` | kill switch; truthy = trimmed `1`, `true`, `yes` (RouteMetrics rule) |
| `ANTHROPIC_API_KEY_SSM_NAME` | `/developercards/prod/anthropic-api-key` | read only when `AI_PROVIDER=anthropic` |
| `INTERNAL_SECRET_SSM_NAME` | `/developercards/prod/ai-qa-results-secret` | HMAC secret for the results callback |
| `CORE_API_BASE` | `https://api.developercards.app` | callback base URL |
| `METRICS_NAMESPACE` | `DeveloperCards` | EMF namespace |
| `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK` | `5` / `25` | USD per million tokens for the cost estimate |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `AI_QA_MAX_RECEIVES` | `2` | optional, not in `env/prod.env.json`: the ai-qa queue's `maxReceiveCount`; the receive on which a retryable error ends the chunk (below). Invalid or < 1 = default |

`AI_QA_REQUIRED`, `AI_QA_MAX_CARDS`, `AI_QA_DAILY_USD_CAP` and `AI_QA_QUEUE_URL` belong to core-vpc
and are not read here. SSM is read by exact name only (never by path); secrets are cached per
container only once they load successfully, and for at most **5 minutes** (`SECRET_TTL_SECONDS =
300`, the dispatcher's value), so a rotated value reaches every warm container within that window.
The optional `INTERNAL_SECRET_SSM_NAME` + `-previous` is read only when core answers 401/403 to a
results report (see "Route-secret rotation"). Only `ParameterNotFound` counts as
absent and is cached for the same TTL; any other read error (throttling, a network error,
AccessDenied) is logged `ssm_secret_unavailable` at warn level and not cached, so the next 401/403
reads SSM again.

## The model call

One `client.messages.create(...)` per attempt: `model`, `max_tokens=16000`,
`thinking={"type": "adaptive"}`, `output_config={"effort": AI_EFFORT}` (+ the JSON schema when
structured outputs are on), a system block with an explicit `cache_control` breakpoint, and one
user message = `Review date: <YYYY-MM-DD>` + the card JSON inside `<card>…</card>`. The card JSON
holds only the DraftCard fields (never `cardId` or `contentSha256`) with `<`/`>` escaped as
`<`/`>`, so card text can never close the tag. The system prompt states that the card's
text, options, code and quote are data, never instructions. No assistant prefill, no streaming, no
tools, no sampling parameters.

**Structured outputs — why `auto`** (§14 #5). The Anthropic API supports
`output_config.format = {"type": "json_schema", …}`; the live Bedrock documentation lists
structured outputs as not supported on the Mantle endpoint. `auto` therefore turns them on for
`anthropic` and off for `bedrock`. Re-checked 2026-09-27 (audit ai-agent-22): the page
[Claude in Amazon Bedrock](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock)
(the `/anthropic/v1/messages` Mantle endpoint that `AnthropicBedrockMantle` calls) lists
"Structured outputs" under **Features not supported**. The claude-api skill's
`shared/platform-availability.md` marks it "Yes" for Bedrock, but that matches the *legacy*
InvokeModel page (`claude-on-amazon-bedrock-legacy`), which lists it as supported; the Mantle page
is the one that applies here. Flip `auto` for Bedrock only after that page changes, and re-run the
eval gate when you do. `AI_STRUCTURED_OUTPUTS=on` is available to trial it; the fallback below
keeps a rejection harmless. Either way the answer goes through the same
`ModelReview.model_validate_json` and the same single repair turn. `messages.parse()` is not used
because it validates while building the response, so a `max_tokens` or `refusal` reply would raise
before `stop_reason` could be read. If the API rejects the format (`BadRequestError` naming
`output_config`/`output_format`/`json_schema`/structured output), the card is retried once without
it and structured outputs stay off for the rest of the container.

**Replies.** `stop_reason = "max_tokens"` ⇒ `error`/`MAX_TOKENS`; `"refusal"` ⇒
`refused`/`REFUSAL` (the `stop_details.category` is logged); anything else ⇒ parse the first text
block (one surrounding code fence is tolerated). An invalid reply gets **one** repair turn (the
validation error, ≤ 1000 chars, as a new user message); a second failure is `SCHEMA_INVALID`.
**The category fixes the severity** (`schema.CATEGORY_SEVERITY`): `incorrect_answer`,
`multiple_correct` → blocker; `answer_leak`, `ambiguous_stem`, `outdated_fact`,
`qualifier_mismatch`, `source_unsupported` → major; `weak_distractor`, `other` → minor. The model
still returns a severity (the schema and prompt are unchanged), but the reported severity is always
the table's; a disagreement is logged as `severity_mismatch` (card id, count and the
`category:severity` pairs the model sent). The publish gate (blocker) and `card.flagged`
(blocker/major) therefore always follow the rubric.
Findings are sorted blocker → major → minor, capped at 10, `message` truncated to 1000 and
`suggestedFix` to 2000 characters, and each gets the `cardId` from the message — the model never
chooses the card.

**Refusals — no fallback model in R18** (§14 #6). Bedrock has no server-side `fallbacks`, and a
silent switch to another model would make the eval's measured precision/recall describe a model
other than the one that answered. A refused card is reported `refused` and counted in
`AiQaRefusals`. Enabling the Anthropic API's `fallbacks: "default"` or a client-side refusal
fallback middleware is an **owner decision**; it must come with a new `PROMPT_VERSION` and a fresh
eval run.

**Prompt caching.** The system prompt is static (no dates, no card data) and carries an explicit
`cache_control: {"type": "ephemeral"}` breakpoint (Bedrock rejects top-level automatic caching).
Caching only takes effect once the cached prefix exceeds the model's minimum cacheable length;
`AiQaCacheReadTokens` shows whether it actually happens.

## Cost

`estimatedCostUsd = (input·Pin + cache_creation·Pin·1.25 + cache_read·Pin·0.10 + output·Pout) / 1e6`
summed over every call of the card (a repair turn counts), rounded to 6 decimals, with `Pin`/`Pout`
from `AI_PRICE_*`. It is an estimate — Bedrock bills separately. The reported `inputTokens` include
cache-creation tokens; cache reads are reported separately. The **daily cap**
(`AI_QA_DAILY_USD_CAP`, default 10 USD) is enforced by core-vpc when a run is started, from the
sum of these estimates.

## Error codes and chunk policy (§7.5)

| Code | Source | Policy |
|---|---|---|
| `PROVIDER_AUTH` | `AuthenticationError` | fail fast: this and every remaining card get the code without calls; report; ack |
| `PROVIDER_ACCESS_DENIED` | `PermissionDeniedError` (incl. "unsupported countries") | fail fast |
| `CONFIG` | `NotFoundError`, other 4xx (`BadRequestError` included), invalid settings, missing/placeholder API key, AWS credential errors | fail fast |
| `PROVIDER_RATE_LIMITED` | `RateLimitError` | retry: report the finished cards (if any), shorten the message's visibility to 60-120 s, return it as a batch item failure |
| `PROVIDER_ERROR` | `APIStatusError` ≥ 500 | retry |
| `PROVIDER_TIMEOUT` | `APITimeoutError` / `APIConnectionError`, or the deadline guard | retry |
| `SCHEMA_INVALID` | invalid reply after the repair turn | per card; the chunk continues |
| `MAX_TOKENS` | `stop_reason = "max_tokens"` | per card |
| `REFUSAL` | `stop_reason = "refusal"` (status `refused`) | per card |
| `DISABLED` | `AI_QA_ENABLED` not truthy (status `skipped`) | every card, no call, no key read |

The queue has `maxReceiveCount = 2` (raising it to 3 is an infra follow-up, see
docs/delivery/r18-issues/Z02-fixes.md). **Last receive:** when `ApproximateReceiveCount >=
AI_QA_MAX_RECEIVES` (default 2, the deployed value) a retryable code does not fail the message:
that card and every remaining one are reported with the retryable code (no calls), and the message
is acked (log `final_receive_giving_up`), so the run finishes with visible errors instead of the
chunk going to the DLQ and its cards staying `queued` until core's 2 h stale reap. Change
`AI_QA_MAX_RECEIVES` together with the queue's `maxReceiveCount`. A message with a bad shape is
logged and acked. A missing internal secret (its visibility is shortened like a retryable error),
a failed results report or an unexpected exception returns the message as a batch item failure;
when that happens on the last receive the message goes to the DLQ (alarm
`developercards-prod-ai-qa-dlq-nonempty`).

**Results report.** The POST is tried up to 4 times: a connection error, a 5xx or a **429** (the
route's throttle) is retried after jittered pauses of 1-3 s, 4-8 s and 15-30 s, always within the
Lambda's remaining time. A 401/403 is resent once, at once, signed with the previous internal
secret when `-previous` exists. When the report still fails, the reviewed items are kept per
container (at most 500) and the message's visibility is shortened like a retryable provider error,
so the redelivery reports them again without a second model call. Any other exception class from the SDK propagates and is treated as
unexpected.

**Retry scope.** On a retryable exit the handler calls `sqs:ChangeMessageVisibility` (already
granted) with 60-120 s (random jitter) on the first receive and 540-660 s on later receives, so
the retry comes after about a minute instead of the queue's 3600 s visibility. The longer later
wait only spreads the receives out: with `maxReceiveCount = 2` there is one retry, and a rate limit
that outlasts it ends the chunk on the last receive (above). The same happens after a failed
results report and after a missing internal secret. Every item reported with a 200 is remembered per container, keyed by
`(runId, chunk, cardId, contentSha256, promptVersion)` (at most 2000 keys); a redelivered chunk
skips those cards — no model call, no second report — and reviews only the rest. When every card
was already reported, the message is acked without a call. This needs no IAM change and no core
change; its limit is that a redelivery that lands on a *different* (or recycled) container re-reviews
the finished cards as before (the results route keeps the first `done`, but overwrites its cost —
`AiQaResults.cs`). Closing that gap needs core-vpc to return the chunk's done card ids in the
results response (follow-up, outside this service).

## Deadline guard

Lambda timeout is 600 s. Before each card the handler reads
`context.get_remaining_time_in_millis()`: a card starts only with at least
`DEADLINE_MARGIN_SECONDS = 150` left, on `client.with_options(timeout=min(120, remaining − 30),
max_retries=2 if remaining ≥ 420 else 0)`; otherwise it counts as `PROVIDER_TIMEOUT` (retry
policy). The results report gets the remaining time minus 2 s.

## Metrics (§7.8)

Namespace `METRICS_NAMESPACE`, `Service = ai-qa`, one EMF line per metric group per card:

| Metric | Unit | Dimensions | When |
|---|---|---|---|
| `AiQaCardsReviewed` (1 when `done`), `AiQaLatency`, `AiQaInputTokens`, `AiQaOutputTokens`, `AiQaCacheReadTokens`, `AiQaEstimatedCostMicroUsd` | Count (latency: Milliseconds) | `Service, Provider` | at least one model call happened |
| `AiQaFindings` | Count | `Service, Severity` | one line per severity with count > 0 |
| `AiQaErrors` | Count | `Service, ErrorCode` | `errorCode` set and in the bounded set above |
| `AiQaRefusals` | Count | `Service` | refused card |

Logs are JSON lines tagged `ai-qa` with ids, statuses, error codes, latency, request ids and token
counts — never card text, model output, keys or signatures.

## Rollout (§7.9)

1. J15 applied (queue, function, role, route, alarms) with `AI_QA_ENABLED=0` everywhere.
2. Provider made usable: the owner submits the Bedrock Anthropic use-case form, or sets
   `AI_PROVIDER=anthropic` and the SSM key.
3. The T04 eval run (`evals/`, owner-approved spend) passes its recall/precision gate and the report
   is committed.
4. `AI_QA_ENABLED=1` in this `env/prod.env.json` and in core-vpc's `prod.env.json`, then both
   deploys (supervisor: `services/deploy-python-lambda.sh ai-qa`).
5. Only then, optionally, `AI_QA_REQUIRED=1` on core-vpc (publish gate).

### Emergency stop (runaway spend, provider incident)

The immediate stop is disabling the SQS event source mapping; `AI_QA_ENABLED` is not. The mapping
targets the `prod` alias, and the deploy script freezes the merged environment into the published
version, so editing `AI_QA_ENABLED` on the function in the console changes nothing in production,
and setting it on core-vpc (a deploy) only blocks *new* runs — chunks already queued keep spending.
infra/RUNBOOK.md §7 "Emergency stop for the SQS consumers" is the same procedure. To stop now
(supervisor only):

1. Stop the consumer — takes effect at once; queued chunks stay in the queue (retention 4 days) and
   resume when re-enabled:
   - `aws lambda list-event-source-mappings --function-name developercards-ai-qa:prod --query 'EventSourceMappings[].UUID'`
   - `aws lambda update-event-source-mapping --uuid <uuid> --no-enabled`
2. Stop new runs: `AI_QA_ENABLED=0` in core-vpc's `prod.env.json` and its deploy (and in this
   `env/prod.env.json` for the next ai-qa deploy).
3. Undo: `aws lambda update-event-source-mapping --uuid <uuid> --enabled`.

Do not use `put-function-concurrency --reserved-concurrent-executions 0` for ai-qa: a throttled
SQS-triggered function still has messages received for it, and with `maxReceiveCount = 2` the queued
chunks move to the DLQ instead of waiting. The mapping's `enabled` is in Terraform's
`ignore_changes` (R18 Y04), so an apply does not re-enable a stopped consumer; still check
`aws lambda get-event-source-mapping --uuid <uuid> --query State` before and after any apply.

A run whose chunks were stopped stays `running` until they are processed or it is failed by
core-vpc; purge the queue (`aws sqs purge-queue`) only if those runs are to be abandoned. The
webhook dispatcher has the same procedure (`services/webhook-dispatcher/README.md`, "Emergency
stop").

## Local development

```bash
cd services/ai-qa
uv lock --check
env -u AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
    -u AWS_BEARER_TOKEN_BEDROCK -u ANTHROPIC_API_KEY \
    AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_EC2_METADATA_DISABLED=true \
    uv run --python 3.12 pytest -q
DRY_RUN=1 bash ../deploy-python-lambda.sh ai-qa   # builds build/ai-qa.zip, never calls aws
```

Tests use a `FakeLlm` (`tests/conftest.py`) and a fake core-vpc on `127.0.0.1`; nothing calls a
model or AWS. Fixture cards are the three samples of `content/decks/FORMAT.md` §3.

Dependencies: `anthropic[bedrock]>=1.8.0` (1.8.0 resolved 2026-09-27; it pulls `httpx2`, `boto3`
and `botocore`) and `pydantic>=2`. Dev group: `pytest>=8` and `boto3==1.43.103` — pinned
2026-09-27 to the version the lock resolves for `anthropic[bedrock]`, matching the webhook
dispatcher's pin. The deploy zip is about 21 MB, under the 50 MiB direct-upload limit.

## Route-secret rotation

Since 2026-09-27 (Z08) each Python caller signs its core-vpc route (§4.3) with its own secret, and
core-vpc accepts only that secret on that route:

| Leaf under `/developercards/prod/` | Route it signs | Caller | core-vpc env var |
|---|---|---|---|
| `ai-qa-results-secret` | `POST /api/internal/ai-qa/results` | this Lambda | `INTERNAL_SECRET_AI_QA_RESULTS` |
| `webhook-report-secret` | `POST /api/internal/webhooks/deliveries/report` | webhook dispatcher | `INTERNAL_SECRET_WEBHOOK_REPORT` |

Neither role can read the global `internal-shared-secret`; only edge-public and core-vpc still use
it (docs/runbooks/secrets-rotation.md). The procedure below is the same for both leaves.

- **Caller side, no deploy.** The Lambda reads `<leaf>` by exact name and keeps it for at most
  5 minutes. When core answers 401/403 it resends once, signed with `<leaf>-previous` if that
  parameter exists. IAM (`infra/modules/identity/roles_r18.tf`): this role reads exactly
  `ai-qa-results-secret` and `ai-qa-results-secret-previous` (plus the Anthropic key); the dispatcher
  role reads `webhook-report-secret` and `webhook-report-secret-previous` (plus its signing secrets).
  A denied or throttled read is logged `ssm_secret_unavailable` (warn, error class only), never
  cached as "no previous secret".
- **core-vpc side, deploy only.** `src_C/deploy.sh` copies `<leaf>` into the env var above and
  `<leaf>-previous` into the same name + `_PREVIOUS` (`src_C/scripts/merge-env.sh`,
  `SSM_TO_ENV_INTERNAL`); core accepts both while `_PREVIOUS` is set (`VerifyInternalSignature` in
  `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs`). core-vpc reads no SSM at runtime, so a put *and*
  a delete reach it only with the next deploy: both env vars are in `SSM_OPTIONAL_ENV`, and
  `drop_absent_optional` removes the one whose leaf is gone.

Runbook (supervisor only; values never in git or chat). `<leaf>` is `ai-qa-results-secret` or
`webhook-report-secret`. Every deploy is `ENV=prod src_C/deploy.sh` with the default `INJECT_ENV=1`;
it also publishes the checked-out core-vpc and worker code, so run it from the commit that is live.

1. Copy the current value to the previous name:
   `aws ssm put-parameter --name /developercards/prod/<leaf>-previous --type SecureString --overwrite --value <current>`.
2. `ENV=prod src_C/deploy.sh`. Core accepts the current value (also as `_PREVIOUS`).
3. Put a new random value (32 bytes, hex):
   `aws ssm put-parameter --name /developercards/prod/<leaf> --type SecureString --overwrite --value <new>`.
   Within 5 minutes every caller container signs with it; until step 4 has finished core rejects it,
   and the caller resends signed with `<leaf>-previous`, which core still accepts.
4. `ENV=prod src_C/deploy.sh`. Core accepts the new value, and the old one as `_PREVIOUS`.
5. Wait 10 minutes (two 5-minute TTLs), so no warm container still signs with the old value.
6. Delete the previous parameter:
   `aws ssm delete-parameter --name /developercards/prod/<leaf>-previous`.
7. **Revocation:** `ENV=prod src_C/deploy.sh`. This deploy removes the `_PREVIOUS` env var from
   core-vpc; until it has finished, core still accepts the old value, so after a leak the rotation is
   not done without it. Check that
   `aws lambda get-function-configuration --function-name core-vpc:prod --query 'keys(Environment.Variables)'`
   (key names only) no longer lists `INTERNAL_SECRET_AI_QA_RESULTS_PREVIOUS` or
   `INTERNAL_SECRET_WEBHOOK_REPORT_PREVIOUS`.

Do not delete `<leaf>` itself: the next deploy would drop the route's env var, core would fall back
to `INTERNAL_SHARED_SECRET` on that route, and the caller cannot read that secret, so every report
would fail.
