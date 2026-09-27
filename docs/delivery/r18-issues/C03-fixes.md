# C03 — Automation Python round 2: fixes per finding

Issue #457, wave r18c-p. Branch `delivery/r18cp/C03-457`, cut from `delivery/r18c-p`. Every path is relative to
the repo root. Only `services/` (ai-qa, source-watcher, the deploy script) and this ledger changed; src_C, infra,
evals, tools, docs/runbooks and the console belong to other waves and are untouched.

Gates run on this branch:

- `services/ai-qa`: `uv lock --check` OK; `uv run --python 3.12 pytest -q` 250 passed (207 before).
- `services/source-watcher`: `uv lock --check` OK; `uv run --python 3.12 pytest -q` 66 passed (50 before).
- `evals` (depends on `services/ai-qa` by path, not edited): `uv lock --check` OK; `pytest -q` 183 passed.
- `bash -n services/deploy-python-lambda.sh services/lambda-release.sh` clean;
  `DRY_RUN=1 bash services/deploy-python-lambda.sh source-watcher` and `... ai-qa` both build and print the DRY plan.

No dependency was added (the adapter uses stdlib `urllib` and botocore, already shipped with `anthropic[bedrock]`),
no SSM parameter, route or table. One env key was added: `AI_QA_AUTOMATION_REGION` (named by L1). No model, AWS
or bedrock-mantle call was made; every new test uses a fake HTTP transport, fake credentials or a fake `aws` CLI.

## Contract (R18C L-items touched)

- **L1 (GPT-5.5 transport), ai-qa side.** The model card
  (https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html) was read on 2026-09-28. It
  confirms bedrock-runtime not supported, only bedrock-mantle `/openai/v1` Responses and Chat Completions, model id
  `openai.gpt-5.5`, Geo and Global inference IDs not supported, In-Region us-east-1 and us-east-2, and In-Region
  prices of $5.50 input / $0.55 cached input / $33.00 output per MTok (≤ 272K context).
  - New provider `"openai-mantle"` (`services/ai-qa/src/ai_qa/settings.py:26-29`, accepted wherever a provider
    is: `AI_PROVIDER`, `AI_QA_SECOND_PROVIDER`, `AI_QA_AUTOMATION_PROVIDER`; the evals harness sets `AI_PROVIDER`
    from `--provider`). Model required, no `anthropic.` id (`settings.py:191`).
  - `AI_QA_AUTOMATION_REGION` (`settings.py:57-63,196-203,233-263`), default `us-east-1`, the bedrock-mantle region
    of `openai-mantle`. It never changes `AI_BEDROCK_REGION`, so the default profile and the `bedrock-converse`
    fallback are byte-compatible. An invalid value fails only the automation profile (`automation_config_error`),
    never loading or human QA.
  - Adapter `services/ai-qa/src/ai_qa/openai_mantle_client.py`: `OpenAiMantleClient` (`:209`) duck-types
    `messages.create` / `with_options` like `ConverseClient`. It POSTs Chat Completions to
    `https://bedrock-mantle.{region}.api.aws/openai/v1/chat/completions`, SigV4-signed with botocore for service
    `bedrock-mantle` (`sign`, `:95`). It sends `reasoning_effort` from `AI_EFFORT` (`:36-37,198-205`; `max` →
    `xhigh`). `finish_reason` stop/length/content_filter maps to end_turn/max_tokens/refusal (`:34`). Usage is
    mapped with the cached prompt tokens split out as cache reads (`to_response`, `:131`). It retries
    429/5xx/no-response up to `max_retries` (`post`, `:235`). Structured outputs are off for this provider
    (`providers.py:74`).
  - Wiring: `providers.make_client` builds it with `region=settings.automation_region` (`providers.py:45-50`), and
    `providers.effective_effort` answers the value actually sent (`providers.py:60-61`).
  - Error mapping in `services/ai-qa/src/ai_qa/review.py:330-365` (`mantle_error_code`): 401 → `PROVIDER_AUTH`;
    403, or a 4xx whose text is an allowlisting answer ("not allowed" + "access", "verify you are a corporate
    customer", "unsupported countries", "don't have access") → `PROVIDER_ACCESS_DENIED`; other 4xx → `CONFIG`;
    429 → `PROVIDER_RATE_LIMITED`; 408 and no response → `PROVIDER_TIMEOUT`; 5xx and a non-JSON 2xx →
    `PROVIDER_ERROR`.
  - `services/ai-qa/env/prod.env.json` commits `AI_QA_AUTOMATION_PROVIDER="openai-mantle"`,
    `AI_QA_AUTOMATION_MODEL="openai.gpt-5.5"`, `AI_QA_AUTOMATION_REGION="us-east-1"`, and the prices confirmed on
    the card: `AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK="5.5"`, `AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK="33"`.
    `bedrock-converse` stays a fallback provider, unchanged.
  - README (`services/ai-qa/README.md`, new section "Provider `openai-mantle` (GPT-5.5, R18C L1)") covers the
    model-card URL and date, the prices and the data-location note (automation card text, public study content
    only, now leaves ap-southeast-2 for us-east-1). It also documents the IAM grant the infra wave must apply, and
    an owner probe of one call per path (openai-mantle via awscurl; the Converse fallback via `aws bedrock-runtime
    converse`), both marked owner-only and paid.
  - **Not done here (other waves' paths):** the IAM grant (`infra/`, required: `bedrock-mantle:CreateInference` on
    `arn:aws:bedrock-mantle:us-east-1:<account>:project/default` with `StringEquals bedrock-mantle:Model =
    openai.gpt-5.5`), the accepted gate providers in `evals/.../automation_gate.py` and `src_C/.../EvalGate.cs`,
    effort in the evals run header / `REVIEWER_KEYS`, and the probe line in `docs/runbooks/` (outside this
    issue's allowed paths; the probe is in the ai-qa README).
- L2–L6 are not touched by this issue.

## Findings

### ai-agent-11

Status: fixed (the ai-qa side; the IAM grant and the gate provider lists belong to the infra, evals and src_C waves
under L1, see Contract).

- The automation reviewer now uses the transport the GPT-5.5 model card lists: provider `openai-mantle`
  (`services/ai-qa/src/ai_qa/openai_mantle_client.py`), region `us-east-1`, model `openai.gpt-5.5`
  (`services/ai-qa/env/prod.env.json`). Before, it used bedrock-runtime Converse with `global.openai.gpt-5.5` in
  ap-southeast-2, which the card lists as not supported.
- The bedrock-mantle allowlisting answers map to `PROVIDER_ACCESS_DENIED`, not `CONFIG`
  (`review.py:337-352`, shared `_names_no_access` also used for Converse, `review.py:330-334`).
- Prices are committed from the card (`5.5` / `33`), so the automation profile no longer answers `CONFIG` for
  missing prices. The stale "Pricing: pending" paragraph in the README is replaced with the card URL and the
  2026-09-28 date.
- Tests (new file `services/ai-qa/tests/test_openai_mantle_client.py`, all failing before: the module did not
  exist): `test_request_is_chat_completions_on_bedrock_mantle_signed_for_bedrock_mantle`,
  `test_region_comes_from_the_client`, `test_assistant_blocks_are_flattened_and_blank_turns_filled`,
  `test_finish_reason_maps_to_stop_reason`, `test_usage_and_request_id_are_mapped`,
  `test_refusal_message_reads_as_a_refusal`, `test_review_card_end_to_end_with_the_automation_prices`,
  `test_error_answers_map_to_the_bounded_codes`, `test_retryable_statuses_are_retried_then_mapped`,
  `test_a_retry_that_succeeds_returns_the_reply`, `test_connection_errors_are_provider_timeout`,
  `test_with_options_sets_timeout_and_retries_and_keeps_the_transport`,
  `test_make_client_builds_the_mantle_client_in_the_automation_region`,
  `test_an_invalid_region_fails_only_the_automation_profile`,
  `TestHandler::test_draft_is_reviewed_on_bedrock_mantle_with_the_effort_sent`,
  `TestHandler::test_allowlisting_error_fails_fast_as_access_denied`, and others in the file.
- Existing assertions updated because the finding makes the old values wrong:
  `services/ai-qa/tests/test_settings.py::test_prod_env_file_matches_contract` and
  `services/ai-qa/tests/test_profiles.py::TestSettingsFor::test_prod_env_loads_with_the_automation_reviewer` pinned
  `bedrock-converse` / `global.openai.gpt-5.5` with no prices. They now pin `openai-mantle` / `openai.gpt-5.5` /
  `us-east-1` / 5.5 / 33, and the second one also checks that the human reviewer and its region are unchanged.
  Nothing else was weakened.

### ai-agent-9

Status: fixed (the ai-qa side: effort is sent and recorded; adding it to the evals run header, `REVIEWER_KEYS` and
the core reviewer match is the evals/src_C side).

- With `openai-mantle`, `AI_EFFORT` is sent as `reasoning_effort` (`openai_mantle_client.py:198-205`; `max` →
  `xhigh`, since Chat Completions has no `max`). `providers.effective_effort` (`providers.py:60-61`) now answers the
  value actually sent, so the `card_result` log `effort` and the EMF `Effort` property name the real effort. There
  is no `effort_not_sent` line for this provider except when `max` is mapped to `xhigh`. A provider-side change of
  the default effort no longer changes the reviewer silently. The Converse fallback still records
  `provider-default`, unchanged.
- Tests: `test_ai_effort_is_sent_as_reasoning_effort_and_recorded` (parametrised over all five efforts),
  `TestHandler::test_draft_is_reviewed_on_bedrock_mantle_with_the_effort_sent` (request body carries
  `reasoning_effort: "high"`, the log records `effort: "high"`, no `effort_not_sent`).

### cloud-security-resilience-8

Status: fixed.

- Tree builder bounded (`services/source-watcher/src/source_watcher/normalize.py:35-131`). The end-tag search
  looks only at the `END_TAG_SEARCH_DEPTH = 64` innermost open elements (`handle_endtag`, `:121`). Beyond
  `MAX_OPEN_DEPTH = 512` open elements a start tag is appended without opening a scope (`:115`). Parsing is
  therefore linear. `MAX_ELEMENTS = 200 000` and a per-page `PARSE_TIME_BUDGET_SECONDS = 20` (clock read every
  1024 parser callbacks) raise `ParseLimitExceeded` (`:77`, `parse_document` `:134`).
- Decoding: `_known_codec` (`:228`) accepts only codecs in `ALLOWED_CODECS` (`:51`), the WHATWG text encodings by
  their Python canonical name. Anything else (punycode, idna, utf-7, rot13, …) decodes as UTF-8. Before, a
  `punycode` label was quadratic, and on non-ASCII bytes it raised `UnicodeDecodeError` and killed the run.
- Handler (`services/source-watcher/src/source_watcher/handler.py`): it logs `observe_start` with `targetId`,
  `host`, `kind` before any robots/fetch/parse work (`:182`). `ParseLimitExceeded` becomes a `failed` / `PARSE`
  observation plus a `parse_limit` warn log, and the run continues (`:201-205`). `_Reporter` (`:359`) posts each
  full batch of `REPORT_BATCH_SIZE` as soon as it is full, so a run killed later (timeout, OOM) has already
  reported what it finished. Batch contents and order are unchanged.
- Normaliser version stays `v1`: the output differs only for pages with > 512 open elements, an end tag whose
  opener is > 64 open elements up, or a non-WHATWG charset label. The existing fixture tests (`TestNormalize`,
  the handler hash tests) pass unchanged, and `test_realistic_malformed_page_is_unchanged` pins a realistic
  unclosed-`<p>`/stray-`</em>` page.
- Tests (fail before the fix: `ParseLimitExceeded` did not exist, the 280 KB page took ~52 s, and the punycode page
  raised): `services/source-watcher/tests/test_normalize.py::TestBoundedWork` —
  `test_unclosed_tags_and_stray_end_tags_parse_in_linear_time` (280 KB `<i>x`×n + `</b>`×n under 1 s),
  `test_open_depth_is_capped_and_text_is_kept`, `test_end_tag_search_is_bounded_to_the_innermost_elements`,
  `test_element_cap_raises_parse_limit`, `test_parse_time_budget_raises_parse_limit`,
  `test_non_whatwg_charsets_decode_as_utf8` (punycode body under 1 s), `test_whatwg_charsets_still_decode`,
  `test_realistic_malformed_page_is_unchanged`. Also `services/source-watcher/tests/test_handler.py::TestHostilePages`
  — `test_pathological_page_is_failed_parse_and_the_run_goes_on`, `test_target_id_is_logged_before_the_fetch`,
  `test_full_batches_are_reported_before_the_run_ends`.
- Not here: the lease order `last_checked_at nulls first` (src_C `SourceWatchRoutes.cs`) is core's side; with the
  bounds above a page can no longer hang the run, and a failed/PARSE observation updates the target like any
  other failure.

### cloud-security-resilience-12

Status: fixed.

- The AWS half of `services/deploy-python-lambda.sh` moved into the sourced library `services/lambda-release.sh`
  (`lambda_release`), so it can be tested with a fake `aws`. The script calls it after the unchanged
  build/DRY_RUN part.
  1. It reads the alias first. If it is on `$LATEST` (the Terraform-created source-watcher and notifier aliases),
     it publishes the live `$LATEST` (the placeholder), waits `published-version-active`, and moves the alias to
     that number before any configuration or code change. So nothing goes live before it is verified, and that
     number becomes the rollback target. A non-numeric alias target is refused.
  2. It updates the environment and code of `$LATEST`, then checks `LastUpdateStatus = Successful` and
     `CodeSha256`, as before.
  3. It publishes the version, waits `published-version-active` and requires
     `State, LastUpdateStatus, CodeSha256 = Active, Successful, <local sha>` for that version, with no invoke.
     Only then does it move the alias, re-check the alias `CodeSha256`, and print
     `ROLLBACK: … --function-version <previous number>`, never `$LATEST`.
- `DRY_RUN=1` is unchanged (it exits before any `aws` call); `bash -n` is clean for both files.
- Tests: `services/source-watcher/tests/test_deploy_release.py` (fake `aws` on PATH, real `merge-env.sh`):
  `test_first_deploy_freezes_the_live_code_before_changing_latest`,
  `test_later_deploy_rolls_back_to_the_previous_version`, `test_unhealthy_version_never_moves_the_alias`,
  `test_unhealthy_first_deploy_leaves_the_frozen_live_code`, `test_lib_and_script_parse`. The first fails against
  the old flow: it printed `--function-version $LATEST` and updated `$LATEST` while live.
- README: `services/source-watcher/README.md`, "Supervisor-only operations", paragraph "First deploy (C03)".
