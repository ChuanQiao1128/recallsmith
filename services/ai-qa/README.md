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
| `prompts.py` | `PROMPT_VERSION = "qa-v1"`, the static `SYSTEM_PROMPT` (rubric of §7.6) |
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
| `INTERNAL_SECRET_SSM_NAME` | `/developercards/prod/internal-shared-secret` | HMAC secret for the results callback |
| `CORE_API_BASE` | `https://api.developercards.app` | callback base URL |
| `METRICS_NAMESPACE` | `DeveloperCards` | EMF namespace |
| `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK` | `5` / `25` | USD per million tokens for the cost estimate |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

`AI_QA_REQUIRED`, `AI_QA_MAX_CARDS`, `AI_QA_DAILY_USD_CAP` and `AI_QA_QUEUE_URL` belong to core-vpc
and are not read here. SSM is read by exact name only (never by path); secrets are cached per
container only once they load successfully.

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
`anthropic` and off for `bedrock`. Either way the answer goes through the same
`ModelReview.model_validate_json` and the same single repair turn. `messages.parse()` is not used
because it validates while building the response, so a `max_tokens` or `refusal` reply would raise
before `stop_reason` could be read. If the API rejects the format (`BadRequestError` naming
`output_config`/`output_format`/`json_schema`/structured output), the card is retried once without
it and structured outputs stay off for the rest of the container.

**Replies.** `stop_reason = "max_tokens"` ⇒ `error`/`MAX_TOKENS`; `"refusal"` ⇒
`refused`/`REFUSAL` (the `stop_details.category` is logged); anything else ⇒ parse the first text
block (one surrounding code fence is tolerated). An invalid reply gets **one** repair turn (the
validation error, ≤ 1000 chars, as a new user message); a second failure is `SCHEMA_INVALID`.
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
| `PROVIDER_RATE_LIMITED` | `RateLimitError` | retry: report the finished cards (if any), return the message as a batch item failure |
| `PROVIDER_ERROR` | `APIStatusError` ≥ 500 | retry |
| `PROVIDER_TIMEOUT` | `APITimeoutError` / `APIConnectionError`, or the deadline guard | retry |
| `SCHEMA_INVALID` | invalid reply after the repair turn | per card; the chunk continues |
| `MAX_TOKENS` | `stop_reason = "max_tokens"` | per card |
| `REFUSAL` | `stop_reason = "refusal"` (status `refused`) | per card |
| `DISABLED` | `AI_QA_ENABLED` not truthy (status `skipped`) | every card, no call, no key read |

The queue has `maxReceiveCount = 2`: a retried message gets one more attempt, then goes to the DLQ
(alarm `developercards-prod-ai-qa-dlq-nonempty`). A message with a bad shape is logged and acked. A
missing internal secret, a failed results report or an unexpected exception returns the message as
a batch item failure. Any other exception class from the SDK propagates and is treated as
unexpected.

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
