# Y03 — Python Lambdas round 2: per-finding fixes ledger

Scope: `services/*` and this file only. Parts that need `infra/`, `src_C/` or `frontend/` are
listed under "Handoff" in each section for the supervisor. Tests run: `uv lock --check && uv run
--python 3.12 pytest -q` in `services/ai-qa` (103 passed) and `services/webhook-dispatcher`
(114 passed).

### cloud-security-resilience-12

Status: partially fixed (everything on the Python side is fixed; the queue setting and the route
throttle are in `infra/`, outside this issue's paths)

- 429 is retryable in both internal clients: `is_retryable_status` (`status == 429 or 500 <=
  status < 600`) at `services/ai-qa/src/ai_qa/internal_client.py:53` and
  `services/webhook-dispatcher/src/webhook_dispatcher/internal_client.py:50`. It is used by both
  status branches (`:157`, `:166` in ai-qa).
- Exponential backoff with jitter: `InternalClient.post(..., retry_pauses=...)`
  (`ai-qa/.../internal_client.py:78-127`). The default stays one retry after 1 s, so the
  dispatcher, which has a 30 s budget, is unchanged apart from the 429. The ai-qa results report
  uses `REPORT_RETRY_PAUSES_S = ((1, 3), (4, 8), (15, 30))` (`handler.py:44`): 4 tries and at most
  about 41 s of pauses, jittered through the `jitter` seam (`handler.py:292`). The existing
  per-attempt budget check still caps them to the Lambda's remaining time.
- On a final report failure, `finish()` (`handler.py:345`) calls `_retry_soon`. This covers the
  deterministic paths (CONFIG, DISABLED, FAIL_FAST, a full chunk), not only the retryable-provider
  branch. That branch no longer schedules twice (`handler.py:413`).
- Visibility grows with the receive count: `_retry_soon` (`handler.py:118-128`) reads
  `ApproximateReceiveCount` (`_receive_count`, `:100`). It gives 60-120 s on the first receive
  and 540-660 s after that (`RETRY_VISIBILITY_LATER_*`, `:40-41`).
- No second model bill after a failed report: `finish()` keeps the reviewed items in
  `_unreported` (`_remember_unreported`, `:91`, capped by `UNREPORTED_CACHE_MAX = 500`). The
  redelivery sends the kept item again with no model call (log `card_report_pending`, `:385`). A
  later 200 moves the item to `_reported`.
- Existing assertions updated because the finding makes the old behaviour wrong:
  `test_report_failure_fails_the_message` (a 503 is now tried 4 times, not 2; card 0's kept item is
  reused in the second half) and `test_unreported_cards_are_reviewed_again_on_redelivery` (the card
  is still reported again, but its item is reused, so there are 2 model calls instead of 3).
  `tests/conftest.py` stubs `handler.sleep` so the backoff never waits in tests.
- Tests: ai-qa `tests/test_internal_client.py::test_429_is_retried_like_a_5xx`,
  `::test_retry_pauses_give_a_longer_backoff_schedule`,
  `::test_longer_schedule_still_stops_at_the_budget`;
  `tests/test_handler.py::test_failed_report_brings_the_chunk_back_soon_with_growing_visibility`,
  `::test_fail_fast_outcome_with_failed_report_is_retried_soon`,
  `::test_retryable_provider_error_with_failed_report_schedules_one_visibility_change`,
  `::test_throttled_report_that_recovers_is_acked`,
  `::test_unreported_cards_are_reviewed_again_on_redelivery`; dispatcher
  `tests/test_internal_client.py::test_429_is_retried_like_a_5xx`.
- Handoff (infra, supervisor):
  1. `infra/modules/worker/ai_qa.tf:18`: set `maxReceiveCount = 3`. The handler already waits
     540-660 s from the second receive, so a rate limit has about 11 minutes before the DLQ.
  2. `infra/modules/api/gateway.tf:67-68`: the anonymous `/api/internal/*` routes each have a
     `burst = 20, rate = 10` bucket that any internet caller can use up. Options: a WAF rate rule
     on those paths, or a Lambda/IAM authorizer. The retries above absorb short bursts only.
  3. Core follow-up (X03): have the results route return the chunk's done `cardIds`, so skipping
     them does not depend on container reuse.

### cloud-security-resilience-11

Status: partially fixed (the Python side and the runbook are done; core-vpc's second accepted
secret is out of this issue's paths and described below)

- ai-qa secret cache TTL: `SECRET_TTL_SECONDS = 300` (`services/ai-qa/src/ai_qa/settings.py:19`)
  and `_cached` (`:147`). It is the dispatcher's model (webhook `settings.py:18`), so a warm
  container picks up a rotated value within 5 minutes. `load_secret`/`get_secret(...,
  optional=True)` (`:158`, `:193`) cache an optional parameter's absence for the TTL and log a
  failed optional read at debug level only. `previous_secret_name` is at `:206`.
- Signing with a fallback to the previous secret: `InternalClient(previous_secret=<loader>)` in
  both services (`internal_client.py:67`, `:112-127`, `_load_previous` `:129`). When core answers
  401/403 to the current secret, the loader reads `<INTERNAL_SECRET_SSM_NAME>-previous` (only
  then, so normal runs make no extra SSM read). If it exists and differs, the same request is sent
  once more, at once, signed with it. ai-qa wires it in `_report` (`handler.py:288`), and the
  dispatcher in `_report` and `_claim` (`handler.py:195`, `:181`, `:358`). The Python side
  therefore works whichever side switches first: SSM first (sign new, fall back to old) or core
  first (sign old, which core accepts as its previous).
- Runbook: `services/ai-qa/README.md:264` "Internal shared secret rotation". The dispatcher
  README points to it (`services/webhook-dispatcher/README.md:50-53`). There is no
  `infra/RUNBOOK.md` edit because that path is outside this issue.
- Tests: ai-qa `tests/test_settings.py::test_loaded_secret_expires_after_the_ttl`,
  `::test_optional_secret_absence_is_cached_for_the_ttl`;
  `tests/test_internal_client.py::test_rejected_signature_is_sent_again_with_the_previous_secret`,
  `::test_rejected_signature_without_a_usable_previous_secret_is_not_retried`;
  `tests/test_handler.py::test_report_during_secret_rotation_falls_back_to_the_previous_secret`,
  `::test_warm_container_picks_up_a_rotated_secret_after_the_ttl`; dispatcher
  `tests/test_internal_client.py::test_rejected_signature_is_sent_again_with_the_previous_internal_secret`,
  `tests/test_handler.py::test_report_passes_a_previous_internal_secret_loader`.
- Handoff (core half, supervisor):
  1. `src_C` `Auth.VerifyInternalSignature` (Auth.cs:491-492): also accept an optional
     `INTERNAL_SHARED_SECRET_PREVIOUS`, compared with `CryptographicOperations.FixedTimeEquals`
     like the current one, and only when it is non-empty.
  2. `src_C/scripts/merge-env.sh:10`: `internal-shared-secret-previous` is an unmapped leaf today,
     so a core deploy would fail with "unmapped SSM parameter" while it exists. Add
     `"internal-shared-secret-previous":"INTERNAL_SHARED_SECRET_PREVIOUS"` to `SSM_TO_ENV` together
     with item 1, or list it in `SSM_NOT_ENV` until then. The same applies to the existing
     `webhook-signing-secret-previous` (not in `SSM_NOT_ENV` either).
  3. IAM (`infra/modules/identity/roles_r18.tf`): `ssm:GetParameter` on
     `…/internal-shared-secret-previous` for `developercards-ai-qa-role` and
     `developercards-webhook-dispatcher-role`. Until it is granted, the read is denied and treated
     as absent, and a 401/403 stands as before.

### cloud-security-resilience-7

Status: partially fixed (the dispatcher can sign per subscription; creating, storing and showing
the secret needs core + console + migration work outside this issue's paths)

- Per-subscription secret override: `_signing_secrets`
  (`services/webhook-dispatcher/src/webhook_dispatcher/handler.py:152-167`). When
  `<SIGNING_SECRET_SSM_NAME>-sub-<subscriptionId>` exists (`settings.subscription_secret_name`,
  `settings.py:143`, `SUBSCRIPTION_SECRET_INFIX` `:25`), it replaces the environment-wide secret for
  that subscription only. Its rotation uses `…-sub-<id>-previous`, and the existing
  `X-DeveloperCards-Signature-Previous` header behaviour is kept. The environment-wide `-previous`
  never appears on a subscription that has its own secret. The absence is cached for the TTL (one
  SSM read per subscription per container per 5 min, debug-level log). With no such parameter,
  the headers are byte-identical to before (`test_2xx_is_delivered_and_acked` is unchanged).
- Docs: `services/webhook-dispatcher/README.md:137` "Per-subscription secrets": how to give a
  subscription (for example a third-party n8n workspace) its own secret, and why the
  environment-wide secret should be rotated afterwards.
- Tests: `tests/test_handler.py::test_subscription_secret_replaces_the_environment_secret`,
  `::test_missing_subscription_secret_is_looked_up_once_per_ttl`,
  `tests/test_settings.py::test_presend_claim_flag_is_off_unless_set` (name helper).
- Handoff: IAM `ssm:GetParameter` on `…/webhook-signing-secret-sub-*` for the dispatcher role
  (infra). `SSM_NOT_ENV` in `src_C/scripts/merge-env.sh` must skip `webhook-signing-secret-sub-*`
  leaves (it matches exact names today, so this needs a prefix rule), or core deploys fail. The full
  fix is core + console: generate the secret when the subscription is created, show it once, store
  a reference (SSM name, or KMS/pgcrypto in a new migration 032+), and write it to the SSM name
  above.

### cloud-security-resilience-8

Status: partially fixed (the dispatcher half is implemented behind a flag; the claim route is
core-vpc and the console note is `frontend`, both outside this issue's paths)

- Pre-send claim: `_claim` (`services/webhook-dispatcher/src/webhook_dispatcher/handler.py:170-192`)
  POSTs signed `{"deliveryId","subscriptionId","attempt"}` to `CLAIM_PATH =
  /api/internal/webhooks/deliveries/claim` (`:33`) and expects `data = {"send": bool, "url"?}`.
  `_process` (`:214-241`) handles the answer. `send: false` means no request, no report, and the
  message is acked (`webhook_delivery_cancelled`). `send: true` sends to the current `url` when
  given, and it still goes through `check_url`. Any failure means nothing is sent and the attempt
  is a `retry` with `CLAIM_UNAVAILABLE` (fail closed: a URL core has not confirmed never gets a
  request).
- Flag: `WEBHOOK_PRESEND_CLAIM` (`settings.py:37`, `:71`), off unless `1`/`true`/`yes`. It stays
  out of `DEFAULTS` and `env/prod.env.json`, so the contract env file and its test are unchanged.
  It is off by default because the route does not exist yet, and with the flag on every delivery
  would end `dead`.
- Docs: `services/webhook-dispatcher/README.md:53-79`.
- Tests: `tests/test_handler.py::test_presend_claim_is_off_by_default`,
  `::test_presend_claim_cancelled_delivery_makes_no_attempt`,
  `::test_presend_claim_uses_the_current_url`, `::test_presend_claim_failure_sends_nothing_and_retries`,
  `tests/test_settings.py::test_presend_claim_flag_is_off_unless_set`.
- Handoff: core-vpc route `POST /api/internal/webhooks/deliveries/claim` (HMAC like `/report`).
  It returns `send=false` and settles the delivery row when the subscription is disabled or
  deleted, and the subscription's current `url` otherwise. (Corrected in Z02: no gateway route
  forwards it. R18 X08 replaced `/api/internal/webhooks/{proxy+}` with exact route keys, so the
  claim also needs an exact gateway route `POST /api/internal/webhooks/deliveries/claim`, auth
  none, its own throttle; see Z02-fixes.md.) After it is deployed, set
  `WEBHOOK_PRESEND_CLAIM=1` in `env/prod.env.json` (and the contract test) and deploy. Console:
  surface the behaviour in `WebhooksPage` (`frontend`).

### ai-agent-22

Status: declined (verified against the current documentation: structured outputs are not
supported on the Bedrock endpoint this service uses)

- Sources checked 2026-09-27:
  1. Live page "Claude in Amazon Bedrock (Opus 4.7 and later)",
     https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock. It covers the
     `/anthropic/v1/messages` endpoint on `bedrock-mantle.{region}.api.aws` that
     `anthropic.AnthropicBedrockMantle` calls (`providers.py:22`). Under "Feature support →
     Features not supported" the first entry is "Structured outputs".
  2. Bundled claude-api skill `shared/platform-availability.md` (line 11): "Structured outputs /
     strict tool use | … | Bedrock: Yes". That matches the legacy page "Claude on Amazon Bedrock
     (Opus 4.6 and earlier)"
     (https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy), whose
     "Supported feature highlights" include Structured outputs. That page describes the
     InvokeModel/Converse integration, not the Mantle endpoint.
- Decision: `auto` stays off for Bedrock. Flipping it would put a request feature the provider
  documents as unsupported onto the production path. The BadRequest fallback
  (`review.py:327-338`) would catch a rejection, but it costs a failed call per container. The
  finding's premise (the reference lists it as GA for the endpoint in use) does not hold for
  Mantle. `SYSTEM_PROMPT` and `PROMPT_VERSION` are untouched, as directed.
- Changed: `services/ai-qa/src/ai_qa/providers.py:38-44` docstring and
  `services/ai-qa/README.md` "Structured outputs — why `auto`" now cite both sources and say when
  to flip (once the Mantle page lists it, with an eval-gate rerun). `AI_STRUCTURED_OUTPUTS=on`
  remains available for a trial.
- Tests: the existing `tests/test_providers.py::test_structured_outputs_auto_is_on_for_anthropic_off_for_bedrock`
  pins the kept behaviour (no behaviour change, so no new failing-first test).
