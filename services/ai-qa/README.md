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
| `prompts.py` | `PROMPT_VERSION` (currently `"qa-v4"`; history and evidence in `evals/reports/tuning-2026-09-27/README.md`), the static `SYSTEM_PROMPT` (rubric of §7.6); `PROMPT_VERSION_AUTOMATION` (`"qa-v4-auto"`) and `SYSTEM_PROMPT_AUTOMATION` for the automation profile |
| `schema.py` | `ModelFinding`, `ModelReview` (pydantic v2, `extra="forbid"`) |
| `review.py` | `review_card(card, *, client, settings, review_date)` → one §7.7 item |
| `converse_client.py` | `ConverseClient`: Bedrock Converse for non-Anthropic models (provider `bedrock-converse`), Anthropic-shaped responses |
| `openai_mantle_client.py` | `OpenAiMantleClient`: OpenAI Chat Completions on Bedrock Mantle (provider `openai-mantle`, the GPT-5.5 automation reviewer), Anthropic-shaped responses |
| `second_opinion.py` | the optional second reviewer: its settings, the merge policy |
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
| `AI_PROVIDER` | `bedrock` | `bedrock` \| `anthropic` \| `bedrock-converse` \| `openai-mantle` (see "Other models (Bedrock Converse) and the second opinion" and "Provider `openai-mantle`") |
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
| `AI_QA_AUTOMATION_PROVIDER` | empty = unset | the automation reviewer's provider (see "Automation profile (R18A)"); committed as `openai-mantle` |
| `AI_QA_AUTOMATION_MODEL` | provider default; required for `bedrock-converse` and `openai-mantle` | the automation reviewer's model id (same rules as `AI_MODEL`); committed as `openai.gpt-5.5` |
| `AI_QA_AUTOMATION_REGION` | `us-east-1` | the bedrock-mantle region of provider `openai-mantle` (any profile); committed as `us-east-1`. The other providers keep `AI_BEDROCK_REGION` |
| `AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK` / `AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK` | unset | USD per million tokens for the automation reviewer's estimate; committed as `5.5` / `33` (GPT-5.5 In-Region, "Pricing" below) |
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

## Other models (Bedrock Converse) and the second opinion

Cards are authored by Claude, and a Claude reviewer shares its blind spots. Two optional switches
let a model from another vendor review them. **Both are off**: `env/prod.env.json` keeps
`AI_PROVIDER=bedrock` and has no `AI_QA_SECOND_*` key, so production behaviour is exactly as above
(the separate automation reviewer is described in "Automation profile (R18A)").

**Provider `bedrock-converse`** (`src/ai_qa/converse_client.py`). `ConverseClient` offers the same
`messages.create(...)` / `with_options(...)` as the anthropic clients, and each call is one
`bedrock-runtime` `Converse` call (boto3, region `AI_BEDROCK_REGION`): the system blocks joined into
one `system` text, user/assistant turns as text (an assistant turn given as content blocks is
flattened to its text), `inferenceConfig.maxTokens = 16000`. `thinking` and `output_config.effort`
are not sent: no AWS document names a Converse request field for reasoning effort on these models
(the OpenAI parameter page covers only `gpt-oss`, and the GPT-5.5 model card lists Converse as not
supported on its endpoint), so the reviewer runs at the provider's default effort. That is recorded,
never silent: `providers.effective_effort` answers `provider-default` for this provider (the
configured `AI_EFFORT` otherwise); every `card_result` log line carries `effort`, the usage EMF line
carries it as the plain property `Effort` (not a dimension), and a message reviewed this way logs
`effort_not_sent` (info) with `configuredEffort` and `effectiveEffort`. Structured outputs are always off for this provider (prompt-forced JSON, then the
usual validation and one repair turn); a request that carries `output_config.format` is rejected
as `CONFIG`. Reply mapping: the first text block; `stopReason` `end_turn`/`stop_sequence` →
`end_turn`, `max_tokens` → `MAX_TOKENS`, `content_filtered`/`guardrail_intervened` → `refusal`
(`REFUSAL`); `usage.inputTokens`/`outputTokens` (cache fields 0); the request id from
`ResponseMetadata.RequestId`. `with_options(timeout, max_retries)` builds a botocore config with
that read timeout and `retries={"max_attempts": max_retries + 1, "mode": "standard"}` (default
120 s, 2 retries, like the other clients). `AI_MODEL` is required (no default) and must not start
with `anthropic.`: Claude always goes through the Mantle client (`bedrock`).

Example model ids in Bedrock Sydney (ap-southeast-2), all through Converse:
`global.openai.gpt-5.5`, `global.moonshotai.kimi-k3`, `qwen.qwen3-235b-a22b-2507-v1:0`,
`deepseek.v3.2`.

**Second opinion.** With `AI_QA_SECOND_PROVIDER` set, every card whose primary review is `done`
is reviewed a second time by that provider/model with the same `SYSTEM_PROMPT` and user turn.
Merge policy: all primary findings stay; a second-opinion finding is added only when its category
is in `AI_QA_SECOND_SCOPE` and no primary finding (nor an earlier added one) has that category, at
most 10 findings in all; its message is prefixed `[second opinion: <model>] ` (then cut to 1000
characters) and its severity comes from the category table like any other finding. Both calls'
usage, latency and estimated cost are summed into the item; `requestId`, `status` and the report's
`provider`/`model` stay the primary's. When the second review errors, is refused, hits the deadline
guard or cannot build its client, the primary item is reported unchanged, the log line
`second_opinion_failed` carries only the error code, and `AiQaSecondOpinionErrors` is emitted. A
primary card that did not finish (`error`, `refused`) gets no second review.

| Var | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `bedrock` | also accepts `bedrock-converse` (then `AI_MODEL` is required) |
| `AI_QA_SECOND_PROVIDER` | empty = off | `bedrock-converse` \| `bedrock` \| `anthropic` |
| `AI_QA_SECOND_MODEL` | provider default; required for `bedrock-converse` | the second reviewer's model id (same prefix rules as `AI_MODEL`) |
| `AI_QA_SECOND_SCOPE` | `facts` | `facts` = `incorrect_answer`, `multiple_correct`, `outdated_fact`, `source_unsupported`; `all`; or a comma-separated list of categories |
| `AI_QA_SECOND_PRICE_INPUT_PER_MTOK` / `AI_QA_SECOND_PRICE_OUTPUT_PER_MTOK` | unset | USD per million tokens for the second reviewer's estimate. No default: unset = the second call is estimated at 0 and `second_opinion_price_unset` is logged once per container. Set them from the model's current Bedrock price page |

The primary estimate keeps using `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK`; with
`AI_PROVIDER=bedrock-converse` set those to the chosen model's prices too (their defaults are the
Claude prices).

**Cost.** The second opinion roughly **doubles the per-card cost** (two reviews per card, plus any
repair turns). The Lambda adds no cap of its own — core-vpc enforces `AI_QA_DAILY_USD_CAP` from the
reported estimates — so the owner should raise that cap knowingly before turning it on, and set the
second-reviewer prices so the estimates are not 0.

**Metrics.** `AiQaSecondOpinionAdded` (Count, `Service`): findings the second reviewer added to a
card (0 included). `AiQaSecondOpinionErrors` (Count, `Service, ErrorCode`): a second review that did
not finish.

**Errors from Converse** (botocore `ClientError` codes, and transport errors):

| Code | Source |
|---|---|
| `PROVIDER_ACCESS_DENIED` | `AccessDeniedException`; `ValidationException` whose message says access is not allowed, "verify you are a corporate customer" or "unsupported countries" |
| `CONFIG` | any other `ValidationException`, `ResourceNotFoundException`, another 4xx code |
| `PROVIDER_RATE_LIMITED` | `ThrottlingException`, `ServiceQuotaExceededException` |
| `PROVIDER_TIMEOUT` | `ModelTimeoutException`, `ReadTimeoutError`, `ConnectTimeoutError`, `EndpointConnectionError` |
| `PROVIDER_ERROR` | `ModelErrorException`, `InternalServerException`, `ServiceUnavailableException`, another 5xx code |

The Anthropic SDK mappings above are unchanged.

## Provider `openai-mantle` (GPT-5.5, R18C L1)

The AWS GPT-5.5 model card
(https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html, read 2026-09-28)
lists `bedrock-runtime` as **not supported** for every API (Converse included) and only the
`bedrock-mantle` endpoint with Responses and Chat Completions under `/openai/v1`, model id
`openai.gpt-5.5`, "Geo inference ID: Not supported", "Global inference ID: Not supported", and
In-Region availability in `us-east-1` and `us-east-2` only. `bedrock-converse` /
`global.openai.gpt-5.5` stays a fallback provider (Q02 saw that profile `ACTIVE` in ap-southeast-2),
but the committed automation reviewer is this provider.

**Client** (`src/ai_qa/openai_mantle_client.py`). `OpenAiMantleClient` offers the same
`messages.create(...)` / `with_options(...)` as the other clients. One call is one `POST` to
`https://bedrock-mantle.<AI_QA_AUTOMATION_REGION>.api.aws/openai/v1/chat/completions` (stdlib
`urllib`), SigV4-signed with botocore for service `bedrock-mantle` with the Lambda role's
credentials (the same signing as the Claude Mantle client; no new dependency, no API key). Request:
the system blocks joined into one `system` message, user/assistant turns as text (blank → `(empty
reply)`), `max_completion_tokens = 16000`, and `AI_EFFORT` sent as **`reasoning_effort`**
(`low`/`medium`/`high`/`xhigh` as-is, `max` → `xhigh`, the highest Chat Completions level).
`providers.effective_effort` answers the value actually sent, so logs, EMF and the run header
record the real effort (no `effort_not_sent` line unless `max` was mapped). Structured outputs are
off (prompt-forced JSON with the validation and repair turn); a request with `output_config.format`
is `CONFIG`. Reply mapping: `choices[0].message.content`; `finish_reason` `stop` → `end_turn`,
`length` → `max_tokens` (`MAX_TOKENS`), `content_filter` → `refusal` (`REFUSAL`), a non-empty
`message.refusal` with no content → `refusal`; `usage.prompt_tokens` minus
`prompt_tokens_details.cached_tokens` → input, the cached tokens → cache read (0.1 × the input price,
matching the card's $0.55 cached input), `completion_tokens` → output; request id from
`x-amzn-RequestId` (else the body `id`); the reply's `model` → `response.model` (the served id, with
`openai.` prepended when the reply omits it, so it reads like the configured `openai.gpt-5.5`; None
when absent), which the eval harness records as `servedModel` (D03). Timeout 120 s, `max_retries=2` (429 and 500/502/503/504 and
no-response errors are retried with 0.5 s, 1 s, … backoff, capped at 4 s); `with_options` narrows
both per card like the other clients.

**Errors** (HTTP answers; the provider text is kept on the exception, capped at 500 characters, never
logged):

| Code | Source |
|---|---|
| `PROVIDER_AUTH` | 401 |
| `PROVIDER_ACCESS_DENIED` | 403; a 4xx whose message says access is not allowed, "verify you are a corporate customer", "unsupported countries" or "don't have access" (the Bedrock allowlisting answers); error code `AccessDeniedException` |
| `CONFIG` | 400, 404 and any other 4xx; missing AWS credentials |
| `PROVIDER_RATE_LIMITED` | 429 (after retries) |
| `PROVIDER_TIMEOUT` | 408; no HTTP response (connect/read timeout, DNS, TLS) |
| `PROVIDER_ERROR` | 5xx (after retries); a 2xx body that is not a JSON object |

**Pricing** (model card above, read 2026-09-28, Standard tier, Commercial Regions, short context
≤ 272K input tokens, In-Region): input **$5.50**, cached input $0.55, output **$33.00** per million
tokens (long context: $11.00 / $1.10 / $49.50; a card review is far below 272K). Committed as
`AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK=5.5` and `AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK=33`.

**Data location.** With this provider, the card text of automation drafts (public study content
only: question, options, answer, explanation and the cited source quote; no user data, no secrets)
leaves ap-southeast-2 and is processed In-Region in `us-east-1`. Human card QA stays on Claude in
ap-southeast-2.

**IAM (infra side, not in this service).** The action is the one the Claude Mantle client already
uses: `bedrock-mantle:CreateInference` on the resource type `project`, here
`arn:aws:bedrock-mantle:us-east-1:<account>:project/default` (the client sends no `OpenAI-Project`
header), with `StringEquals bedrock-mantle:Model = openai.gpt-5.5` (AWS Service Authorization
Reference, list_bedrock-mantle.html). Until that grant is applied every automation call answers
403 → `PROVIDER_ACCESS_DENIED` (fail fast, acked; core routes the draft to a human).

**Owner probe (one call, after Bedrock allowlisting and the IAM grant, before any paid eval run).**
Each probe is one tiny paid request; run it only as the owner, from a shell with the ai-qa role or an
equivalent admin profile:

```bash
# openai-mantle (the committed reviewer): expect HTTP 200 and a chat.completion body.
uvx --from awscurl awscurl --service bedrock-mantle --region us-east-1 -X POST \
  -H 'Content-Type: application/json' \
  -d '{"model":"openai.gpt-5.5","messages":[{"role":"user","content":"Reply with OK."}],"max_completion_tokens":64,"reasoning_effort":"low"}' \
  https://bedrock-mantle.us-east-1.api.aws/openai/v1/chat/completions

# bedrock-converse fallback: expect a converse reply, or a ValidationException naming the model.
aws bedrock-runtime converse --region ap-southeast-2 --model-id global.openai.gpt-5.5 \
  --messages '[{"role":"user","content":[{"text":"Reply with OK."}]}]' --inference-config maxTokens=64
```

A 403 or an allowlisting message is the account (grant, Marketplace terms, allowlisting), not this
code. Only a 200 on the first probe makes `dc-evals run --provider openai-mantle` meaningful.

**Before turning either switch on (owner-approved only):**

- **Marketplace terms.** Third-party models on Bedrock are sold through AWS Marketplace: the first
  invocation of such a model subscribes the account to it and accepts its terms. Only the owner
  decides that; no test, eval or deploy here invokes one.
- **Allowlisting.** The account needs Bedrock access for the chosen model (model access /
  allowlisting). Until then Bedrock answers with a `ValidationException` such as "verify you are a
  corporate customer", which maps to `PROVIDER_ACCESS_DENIED` (fail fast, acked) — or, for the
  second opinion, to `second_opinion_failed` with the primary items unaffected.
- **IAM.** The Lambda role grants only `bedrock-mantle:CreateInference` (above); Converse needs
  `bedrock:InvokeModel` on the chosen model / inference profile. That grant is an infra change
  outside this service; without it the calls fail with `AccessDeniedException` →
  `PROVIDER_ACCESS_DENIED`.

## Automation profile (R18A)

The automation flow (contract A00 §4, §9) has core-vpc send each draft card to the same queue as
**one draft per message**, and source re-check chunks with the automation reviewer. Two optional
message keys select this (`src/ai_qa/profiles.py`):

| Key | Values | Absent means |
|---|---|---|
| `target` | `card` \| `draft` | `card` (the human QA path; in a `draft` message `cards[].cardId` is the draft id, only echoed) |
| `profile` | `default` \| `automation` | `default` (the configured `AI_PROVIDER` / `AI_MODEL` reviewer) |

Any other value (`null`, a number, `"deck"`, `"fast"`, …) makes the message a bad message: logged
`bad_message`, acked, no report, no model call. This Lambda never reads `AUTOMATION_MODE` and
decides nothing about drafts: it reviews and reports; core decides.

**Report keys.** The results report adds `"target": "draft"` only when the target is `draft`, and
`"profile": "automation"` only when the profile is `automation`. A human run's report therefore
keeps exactly the seven keys `v`, `runId`, `chunk`, `provider`, `model`, `promptVersion`, `items`
(pinned by `tests/test_handler.py`, `test_results_body_matches_contract`) and stays byte-identical.
Core treats an absent `target` as the card path, so this is wire-compatible. A source re-check
chunk (`profile` only) reports `"profile": "automation"` and no `target`. `provider` / `model` are
the reviewer actually used.

**Effort key (contract O1).** Every automation-profile report (draft QA and source re-checks) also
carries a top-level `"effectiveEffort"`: `providers.effective_effort` of the automation reviewer's
settings, the value the review actually sent (`provider-default` for `bedrock-converse`, `xhigh` for
`AI_EFFORT=max` on `openai-mantle`, `AI_EFFORT` otherwise). It is the same value the eval gate records
as `reviewer.effectiveEffort`, and core requires the two to match at a live auto-accept (otherwise
`REVIEWER_NOT_GATED`; a missing key fails closed). It is absent only when the automation reviewer has
no valid settings (every item is `CONFIG` then). Default-profile reports never carry it. Deploy this
Lambda before switching `AUTOMATION_MODE` to live; after a gate is recorded, a new dry-run decision's
details should show `reviewerMatchesGate: true` (pinned by `tests/test_profiles.py`,
`TestEffortInReport`).

| Var | Default | Meaning |
|---|---|---|
| `AI_QA_AUTOMATION_PROVIDER` | empty = unset | `openai-mantle` \| `bedrock-converse` \| `bedrock` \| `anthropic`; anything else is `CONFIG` for automation-profile messages only |
| `AI_QA_AUTOMATION_MODEL` | provider default; required for `bedrock-converse` and `openai-mantle` | same prefix rules as `AI_MODEL` (no `anthropic.` id for `bedrock-converse` / `openai-mantle`) |
| `AI_QA_AUTOMATION_REGION` | `us-east-1` | region of `openai-mantle`; a value that is not an AWS region is `CONFIG` for automation-profile messages only (the default region is kept) |
| `AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK` | unset | USD per million input tokens for the automation estimate |
| `AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK` | unset | USD per million output tokens for the automation estimate |

With `AI_QA_AUTOMATION_PROVIDER` empty the other three keys are ignored. An invalid provider,
model or price never fails loading (R18B, B03): `load_settings` records the reason in
`Settings.automation_config_error`, and `settings_for(cfg, "automation")` raises it, so only
automation-profile messages answer `CONFIG`; default-profile (human) card QA keeps running. An
**absent** automation price never fails loading either, so human runs and the evals (which load
`env/prod.env.json`) are unaffected.

**`settings_for(cfg, profile)`** derives the reviewer for one message: `default` returns the loaded
settings unchanged; `automation` returns them with the automation provider, model and both prices,
and the second reviewer switched off. It raises `ConfigError` (logged `profile_config_invalid` with
`runId`, `chunk`, `profile` and the key names; every card reported `error` / `CONFIG`, no model
call, message acked) when:

- an `AI_QA_AUTOMATION_*` key is invalid (`automation_config_error`);
- `AI_QA_AUTOMATION_PROVIDER` or `AI_QA_AUTOMATION_MODEL` is unset;
- either `AI_QA_AUTOMATION_PRICE_*` key is unset: a zero estimate would disable the daily USD cap
  (`AI_QA_DAILY_USD_CAP`, enforced by core from the reported estimates) for drafts;
- the profile is not `default` or `automation`.

In that case the report's `provider` / `model` are the automation keys' values (or `unset`), never
the default Claude reviewer's names, which would mislabel the draft decision. The order of outcomes
is unchanged: invalid settings ⇒ `CONFIG`; `AI_QA_ENABLED` off ⇒ every card `skipped` / `DISABLED`
(for every profile); then the profile check; then the client.

**Prompt version `qa-v4-auto`** (R18B contract K1, `src/ai_qa/prompts.py`). The default profile
keeps `PROMPT_VERSION = "qa-v4"` and `SYSTEM_PROMPT` byte for byte. The automation profile reviews
with `SYSTEM_PROMPT_AUTOMATION = SYSTEM_PROMPT + AUTOMATION_ADDENDUM`, version
`PROMPT_VERSION_AUTOMATION = "qa-v4-auto"`: under this profile a minor finding lets the card be
accepted and published with no human reading it, so a factual claim (answer, options, code or
usage) that `source.quote` does not support and that cannot be confirmed as well-established fact
is `source_unsupported` (major), never downgraded to minor (the qa-v4 Currency rule stays in force
for human runs). `profiles.prompt_version_for(profile)` / `system_prompt_for(profile)` pick them; a
message's `promptVersion` is checked against its profile's version (`prompt_version_mismatch`, warn,
with `profile`), and the report echoes the version that actually ran. The per-container
reported-cards key carries that version too.

**Second opinion.** Never for the automation profile: `settings_for` clears the second reviewer and
the handler runs it only for `default`. A default message on the same Lambda still gets it when
`AI_QA_SECOND_*` is set.

**Why GPT-5.5.** The drafts are authored by Claude; a reviewer from another vendor does not share
its blind spots (owner decision 4), so the committed reviewer is GPT-5.5 with no second opinion,
on the transport its model card lists: `openai-mantle` / `openai.gpt-5.5` in `us-east-1` (C03, R18C
L1; `bedrock-converse` / `global.openai.gpt-5.5` remains the fallback). Its findings route a draft to a human; core decides
(A00 §5.4).

**Pricing.** Committed from the GPT-5.5 model card (read 2026-09-28): $5.50 input / $33.00 output
per million tokens In-Region (see "Provider `openai-mantle`"). This replaces the earlier "pricing
pending" note (the AWS Price List still has no GPT-5.5 entry; the model card publishes the price).
With both keys set, the automation profile no longer answers `CONFIG` for missing prices.

**IAM.** `openai-mantle` needs `bedrock-mantle:CreateInference` on the us-east-1 `project/default`
with `bedrock-mantle:Model = openai.gpt-5.5` (infra wave, see "Provider `openai-mantle`"); the Q02
Converse grant for `global.openai.gpt-5.5` stays for the fallback. No new SSM parameter, dependency
or metric; EMF item metrics carry the provider actually used.

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

Neither role can read the global `internal-shared-secret`; only core-vpc still uses it
(docs/runbooks/secrets-rotation.md; edge-public, the other holder on paper, was retired on 2026-10-04). The procedure below is the same for both leaves.

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
