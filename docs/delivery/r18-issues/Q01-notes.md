# Q01 — ai-qa: Bedrock Converse provider + optional cross-vendor second opinion (#399)

Everything is off by default. `services/ai-qa/env/prod.env.json`, `SYSTEM_PROMPT` and
`PROMPT_VERSION` are unchanged; with the current prod env the provider is `bedrock` and the second
opinion is off (`tests/test_second_opinion.py::test_prod_env_keeps_bedrock_and_the_second_opinion_off`).

## What was added (services/ai-qa/)

| Where | What |
|---|---|
| `src/ai_qa/settings.py:25-47` | `PROVIDERS` gains `bedrock-converse` (`CONVERSE_PROVIDER`); no `DEFAULT_MODELS` entry; `AI_QA_SECOND_*` key names and `SECOND_SCOPES` (`facts`, `all`) |
| `src/ai_qa/settings.py:89-93` | `Settings.second_provider`, `second_model`, `second_scope`, `second_price_input_per_mtok`, `second_price_output_per_mtok` (all defaulted: off) |
| `src/ai_qa/settings.py:157-201` | `_model` (per-provider model rules; `bedrock-converse` requires a model and rejects `anthropic.`), `_optional_price`, `_second_opinion` (parses/validates the second-reviewer keys) |
| `src/ai_qa/converse_client.py:156` | `ConverseClient` (`messages.create` → one `bedrock-runtime` `converse` call; `with_options`; `botocore_config`); `STOP_REASONS` at `:22`, request mapping `create` at `:131`, response mapping `to_response` |
| `src/ai_qa/providers.py:37-42,54-55` | `make_client` builds `ConverseClient(region=AI_BEDROCK_REGION, timeout=120, max_retries=2)`; `structured_outputs_on` is always False for `bedrock-converse` |
| `src/ai_qa/review.py:285-320` | `CLIENT_ERROR_CODES`, `ACCESS_DENIED_MARKERS`, `client_error_code` |
| `src/ai_qa/review.py:342-352` | `error_code_for`: `ClientError` → `client_error_code`; `ReadTimeoutError`/`ConnectTimeoutError`/`EndpointConnectionError` → `PROVIDER_TIMEOUT` (before the existing `BotoCoreError` → `CONFIG` fallback); `ConfigError` → `CONFIG`. Anthropic mappings unchanged |
| `src/ai_qa/review.py:398` | a `ClientError`'s `ResponseMetadata.RequestId` becomes the item's `requestId` |
| `src/ai_qa/second_opinion.py` | `enabled`, `second_settings` (derived `Settings` with the second provider/model/prices), `merge`, `apply`, the once-per-container `second_opinion_price_unset` log |
| `src/ai_qa/handler.py:249-307` | `_with_deadline` (the existing per-card `with_options` rule, extracted) and `_second_opinion` (runs the second reviewer, logs `second_opinion` / `second_opinion_failed`, emits EMF) |
| `src/ai_qa/handler.py:459-461` | called after a primary review whose status is `done` |
| `src/ai_qa/emf.py:23-24,115-121` | `AiQaSecondOpinionAdded`, `AiQaSecondOpinionErrors`, `emit_second_opinion` |
| `README.md` | section "Other models (Bedrock Converse) and the second opinion"; package-layout and `AI_PROVIDER` rows |
| `tests/test_converse_client.py` | Stubber-backed request/response mapping, every stopReason, usage/cost, `with_options`, every error-code mapping |
| `tests/test_second_opinion.py` | settings, merge policy, handler path (merge, failure, skip), prod env off |
| `tests/conftest.py` | clears the new env keys and the price-unset flag per test |

## Env keys

| Key | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `bedrock` | now also `bedrock-converse` |
| `AI_MODEL` | provider default; **required** for `bedrock-converse` (must not start with `anthropic.`) | |
| `AI_BEDROCK_REGION` | `ap-southeast-2` | also the Converse region |
| `AI_QA_SECOND_PROVIDER` | empty = off | `bedrock-converse` \| `bedrock` \| `anthropic` |
| `AI_QA_SECOND_MODEL` | provider default; required for `bedrock-converse` | same prefix rules as `AI_MODEL` |
| `AI_QA_SECOND_SCOPE` | `facts` | `facts` = `incorrect_answer`, `multiple_correct`, `outdated_fact`, `source_unsupported`; `all`; or a comma-separated category list |
| `AI_QA_SECOND_PRICE_INPUT_PER_MTOK` / `AI_QA_SECOND_PRICE_OUTPUT_PER_MTOK` | unset (no default price) | unset → the second call is estimated at 0, `second_opinion_price_unset` logged once per container |

The primary estimate still uses `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK`.

## Merge policy (exact)

Runs only when `AI_QA_SECOND_PROVIDER` is set **and** the primary item's status is `done`.

1. The second reviewer gets the same request as the primary (same `SYSTEM_PROMPT`, same user turn,
   same validation + one repair turn) with its own provider/model; its findings go through
   `finalize_findings`, so severity comes from the category table.
2. Every primary finding is kept, unchanged and in place.
3. Each second-opinion finding, in its (severity-sorted) order, is added only if its category is in
   `AI_QA_SECOND_SCOPE`, no primary finding and no already-added finding has that category (dedupe by
   category), and the item holds fewer than 10 findings.
4. An added finding's `message` becomes `"[second opinion: <AI_QA_SECOND_MODEL>] " + message`, cut
   to 1000 characters.
5. The merged findings are stably re-sorted by severity (blocker, major, minor).
6. `usage` (each field), `latencyMs` and `estimatedCostUsd` are the sums of both reviews;
   `status`, `errorCode`, `requestId` and the report's `provider`/`model` stay the primary's.
7. If the second review is not `done` (error, refusal, SCHEMA_INVALID, MAX_TOKENS), raises, cannot
   build its client (CONFIG), or would start with less than the deadline margin (PROVIDER_TIMEOUT),
   the primary item is reported exactly as it was; `second_opinion_failed` is logged with the error
   code only (unmapped exceptions log `PROVIDER_ERROR`) and `AiQaSecondOpinionErrors` is emitted
   (dimension `ErrorCode`).
8. `AiQaSecondOpinionAdded` = the number of findings added (emitted after every done second review,
   0 included).

## Not done here

- IAM for Converse (`bedrock:InvokeModel` on the chosen model) is infra (Q02); evals are Q03.
- No price is claimed for any model; nothing is enabled in prod.
