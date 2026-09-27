# Z02 — Python Lambdas round 3: per-finding fixes

Release 1.8.0 fix wave, round 3 (r18z-p). Scope: `services/*` and `docs/delivery/r18-issues/*`.
Anything outside those paths (infra, core-vpc, frontend, integrations) is recorded as a handoff at
the end, with the exact setting needed.

Gates run: `cd services/webhook-dispatcher && uv lock --check && uv run --python 3.12 pytest -q`,
the same in `services/ai-qa`.

### cloud-security-resilience-16

Status: fixed

- Root cause: `load_secret(optional=True)` treated every exception as "absent" and cached it for
  `SECRET_TTL_SECONDS`.
- `services/webhook-dispatcher/src/webhook_dispatcher/settings.py:103-170`: new
  `is_parameter_not_found` (botocore `ClientError` code `ParameterNotFound`, or the modeled
  `ssm.exceptions.ParameterNotFound` class). With `optional=True`, only that error (or an unset or
  placeholder value) is absence: logged at debug, cached for the TTL. Any other error (throttling,
  network, AccessDenied, unexpected) is logged `ssm_secret_unavailable` at warn, **never cached**,
  and raises the new `SecretUnreadable`. `get_secret(optional=True)` raises it too when the SSM
  client cannot be created. Required reads are unchanged (None, not cached).
- `handler.py:152-179` `_signing_secrets`: `SecretUnreadable` on `-sub-<id>` or on `-previous`
  returns `(None, None)`, which `_process` already maps to `kind="retryable",
  error=SIGNING_SECRET_MISSING`: nothing is posted, the attempt is reported as `retry` and backed
  off. So neither a fallback to the environment-wide secret nor a dropped
  `X-DeveloperCards-Signature-Previous` can happen after a transient SSM error.
- The previous *internal* secret loader (`_previous_internal_secret`) inherits the rule:
  `InternalClient._load_previous` already turns an exception into "no previous", and the error is
  no longer cached, so the next 401/403 reads SSM again.
- Same rule applied to ai-qa's `load_secret` (`services/ai-qa/src/ai_qa/settings.py:176-222`),
  whose only optional read is the previous internal secret (returns None, not cached, warn log).
- Existing tests updated because the finding makes their fake wrong: the fake SSM clients in
  `webhook-dispatcher/tests/test_handler.py`, `webhook-dispatcher/tests/test_settings.py`
  (`test_optional_secret_absence_is_cached_for_the_ttl`), `ai-qa/tests/test_handler.py` and
  `ai-qa/tests/test_settings.py` (`test_optional_secret_absence_is_cached_for_the_ttl`) signalled
  "not found" with `LookupError`/`RuntimeError("ParameterNotFound")`. They now raise what boto3
  raises, `ClientError` with code `ParameterNotFound`. No assertion was weakened.
- Tests (fail before, pass after):
  - `webhook-dispatcher/tests/test_settings.py::test_optional_read_error_is_not_absence_and_is_not_cached`
    `[throttling|access-denied|network|unexpected]`
  - `::test_parameter_not_found_is_recognised_by_code_and_by_modeled_class`
  - `::test_optional_read_without_an_ssm_client_is_unreadable`
  - `::test_required_read_error_still_counts_as_missing` (pins the unchanged required path)
  - `webhook-dispatcher/tests/test_handler.py::test_subscription_secret_read_error_retries_instead_of_signing_with_the_shared_secret`
    `[throttling|access-denied|network]` — the audit's reproduction: the first `-sub-12` read
    fails, the attempt is a retry with no POST, and the next receive (no cache reset) signs with
    the subscription's own secret.
  - `::test_previous_secret_read_error_retries_instead_of_dropping_the_previous_signature`
    `[throttling|access-denied|network]`
  - `::test_unreadable_previous_internal_secret_is_not_cached`
  - `ai-qa/tests/test_settings.py::test_optional_read_error_is_not_cached_as_absent`
    `[throttling|access-denied|network|unexpected]`, `::test_parameter_not_found_is_recognised_by_code_and_by_modeled_class`

### automation-20

Status: fixed

- Same root cause and fix as cloud-security-resilience-16 (above): a `ThrottlingException`, a
  network error or AccessDenied on `<name>-sub-<id>` now produces a `retry` report with
  `SIGNING_SECRET_MISSING` and no POST, and is not cached.
- AccessDenied "while there is no grant": the deployed dispatcher role has no grant on `-sub-*`
  (`infra/modules/identity/roles_r18.tf:47`), so with AccessDenied failing closed an unconditional
  `-sub-` read would fail every delivery. The per-subscription lookup is therefore behind a new
  optional flag, `WEBHOOK_SUBSCRIPTION_SECRETS` (`settings.py:38-39`, `:53-55`, `:77`), off unless
  `1`/`true`/`yes`, kept out of `DEFAULTS` and `env/prod.env.json` like `WEBHOOK_PRESEND_CLAIM`.
  Off (deployed): no `-sub-` read, the environment-wide secret signs, exactly today's effective
  behaviour. On: `ParameterNotFound` = no own secret (fallback, cached); any other error fails
  closed. The owner turns it on only after adding the `-sub-*` grant (README, "Per-subscription
  secrets").
- Tests: `webhook-dispatcher/tests/test_handler.py::test_subscription_secret_read_error_retries_instead_of_signing_with_the_shared_secret`,
  `::test_subscription_secrets_off_never_reads_a_subscription_parameter`,
  `tests/test_settings.py::test_subscription_secrets_flag_is_off_unless_set`. The two existing
  per-subscription tests (`test_subscription_secret_replaces_the_environment_secret`,
  `test_missing_subscription_secret_is_looked_up_once_per_ttl`) now set the flag; their assertions
  are unchanged.

### cloud-security-resilience-8

Status: partially fixed (docs corrected in this issue; the gateway route and the core-vpc route
are `infra` and `src_C`, outside this issue's paths — handoff below)

- `services/webhook-dispatcher/README.md` "Pre-send claim": the false sentence ("API Gateway's
  `/api/internal/webhooks/{proxy+}` already forwards it") is replaced by the deployed state: the
  flag is off by default (`settings.py:36-37`, `:71`); core-vpc has no claim route
  (`src_C/Vpc/VpcFunction.cs`); API Gateway has exact keys only for `…/deliveries/report` and
  `/api/internal/ai-qa/results` (`infra/modules/api/gateway.tf`), so the claim falls to
  `ANY /{proxy+}` with the console JWT and gets a 401, making every attempt `CLAIM_UNAVAILABLE`.
  It lists both prerequisites before the flag may be set and keeps the mitigation (disable the
  subscription and stop the event source mapping).
- `docs/delivery/r18-issues/Y03-fixes.md` (cloud-security-resilience-8 handoff): the same wrong
  sentence is corrected in place, pointing here.
- No dispatcher code change: `_claim` already fails closed (`CLAIM_UNAVAILABLE`, nothing sent), and
  the flag stays off. Existing tests `test_presend_claim_*` and
  `tests/test_settings.py::test_presend_claim_flag_is_off_unless_set` pin that.
- Handoff (infra, Z03): add the exact route key `POST /api/internal/webhooks/deliveries/claim` in
  `infra/modules/api/gateway.tf`, authorization NONE, its own route throttle (like the report
  route), plus its plan-allow entry.
- Handoff (core-vpc): the route in `VpcFunction.cs` with exact `RouteMatcher` dispatch and the
  report route's `CallerSecretEnv` HMAC check; answer `send=false` (and settle the row) for a
  disabled or deleted subscription, else the current `url`. Only after both are deployed: set
  `WEBHOOK_PRESEND_CLAIM=1` in `services/webhook-dispatcher/env/prod.env.json` (and its contract
  test) and deploy.

### automation-21

Status: partially fixed ((a), (b) and the receiver half of (c) fixed here; the fixture half of
(c) is `integrations/`, and (d)'s move into infra/RUNBOOK.md and the LedgerPage link are `infra`
and `frontend` — handoff below)

- (a) `services/webhook-dispatcher/README.md` "Dead deliveries and the DLQ" rewritten: the
  deployed report route lets `delivered` win over `dead` and records the ledger unit
  (`src_C/Vpc/Internal/WebhookDeliveryReport.cs` `Keep`, ledger block), so both recoveries are
  documented as correct: redrive the DLQ (same delivery id, up to five more attempts), or
  Redeliver + purge. Pick one per message, never both. It says that infra/RUNBOOK.md §7 still
  carries the old rule and that this section supersedes it.
- (b) Unsupported-version messages: "redrive the DLQ after deploying the newer dispatcher; never
  purge it". The README now says why no other path works (the sweep's `StrandedPredicate` requires
  `enqueued_at is null`, `WebhookEvents.cs:453`; the console refuses Redeliver on `queued`) and
  that a DLQ holding both kinds is redriven as a whole. The false claim that the sweep re-sends
  them is removed. The alternative (the sweep also claiming old `queued` rows with 0 attempts
  whatever their `enqueued_at`) is core-vpc code, not taken here.
- (c) Receiver docs (§6.3 section of the README): the body's top-level keys including
  `schemaVersion` (integer, currently 1, `WebhookEvents.BodySchemaVersion`; a breaking change to
  `data` or the envelope increments it; adding a field does not), plus receiver recipe step 6.
- (d) The dispatcher README now links the X01 runbook (docs/delivery/r18-issues/X01-ledger-runbook.md)
  as the operator runbook for the ledger backfill and the sweep.
- Also corrected, same class of stale doc: the `-previous` signing-secret IAM paragraph (the
  grant exists since X08; a failed read now fails closed), the configuration section (optional
  flags, which errors are cached), and the internal `-previous` note (the dispatcher role still
  cannot read it; now a warn log, not cached).
- Tests: documentation only for this finding; the behaviour it documents is pinned by the
  existing `test_unknown_message_version_goes_to_the_dlq_instead_of_being_dropped`. The fail-closed
  wording is covered by the cloud-security-resilience-16 tests.
- Handoff (infra): replace infra/RUNBOOK.md §7 `webhook-delivery-dead` (lines ~81-85) with the
  README's two recoveries and the "never purge unsupported-version messages" rule; move
  docs/delivery/r18-issues/X01-ledger-runbook.md into infra/RUNBOOK.md as §8.
- Handoff (frontend): point `LedgerPage.tsx:779` at infra/RUNBOOK.md §8 once it exists.
- Handoff (integrations): add `"schemaVersion": 1` as the last key of every
  `integrations/n8n/fixtures/*.json` body.

### cloud-security-resilience-12

Status: partially fixed (Python side fixed here; the queue's `maxReceiveCount` is
`infra/modules/worker/ai_qa.tf`, outside this issue's paths — exact setting below for Z03)

- Missing internal secret: `services/ai-qa/src/ai_qa/handler.py:344-347` now calls `_retry_soon`,
  so the chunk returns in 60-120 s (later receives 540-660 s) instead of after the 3600 s
  visibility.
- Final receive: new setting `AI_QA_MAX_RECEIVES` (`settings.py:46-51`, `:73`, `:136-146`),
  default **2** = the deployed `maxReceiveCount`, invalid or < 1 falls back to the default, not in
  the contract env file. `handler.py:410-416`: when `ApproximateReceiveCount >= max_receives` and
  a card ends with a retryable code (`PROVIDER_RATE_LIMITED`, `PROVIDER_ERROR`,
  `PROVIDER_TIMEOUT`), that card and every remaining card are reported with that code (no model
  calls) and the message is acked (log `final_receive_giving_up`). The run finishes with visible
  errors instead of a DLQ'd chunk whose cards stay `queued` until the 2 h reap (`QaRuns.cs:38`).
  If that final report fails, the message still fails and goes to the DLQ as before.
- Comment fixed (`handler.py:34-40`): the longer later visibility helps only with
  `maxReceiveCount >= 3`. README "Error codes and chunk policy" and "Retry scope" updated.
- Tests (fail before, pass after): `ai-qa/tests/test_handler.py::test_missing_internal_secret_brings_the_chunk_back_soon`,
  `::test_final_receive_reports_the_rest_with_the_retryable_code_and_acks`
  `[PROVIDER_RATE_LIMITED|PROVIDER_ERROR|PROVIDER_TIMEOUT]`,
  `::test_final_receive_follows_the_configured_max_receives`,
  `ai-qa/tests/test_settings.py::test_max_receives_defaults_to_the_deployed_redrive_policy`.
- Handoff (infra, Z03) — the exact setting:
  - `infra/modules/worker/ai_qa.tf`, `aws_sqs_queue.ai_qa_jobs.redrive_policy`:
    `maxReceiveCount = 3` (was 2), with a plan-allow entry for
    `module.worker.aws_sqs_queue.ai_qa_jobs [redrive_policy]`. Keep `visibility_timeout_seconds =
    3600` (the handler shortens it per message; 3600 still bounds a crashed invocation).
  - In the same release set `"AI_QA_MAX_RECEIVES": "3"` in `services/ai-qa/env/prod.env.json`
    (and in `tests/test_settings.py::test_prod_env_file_matches_contract`'s expectations), and
    deploy ai-qa after the queue change. Order matters little: with the queue at 3 and the setting
    at 2 the chunk just ends one receive early (visible errors, no stall); with the queue at 2 and
    the setting at 3 the last receive goes to the DLQ as today.

## Handoffs outside this issue's paths (summary)

1. infra (Z03): `ai_qa.tf` `maxReceiveCount = 3` + plan-allow; exact gateway route
   `POST /api/internal/webhooks/deliveries/claim`; infra/RUNBOOK.md §7 DLQ text and new §8 (ledger
   runbook); optional: `ssm:GetParameter` on `…/internal-shared-secret-previous` for the dispatcher
   and ai-qa roles (today a denied read is logged at warn on each 401/403 and the 401/403 stands),
   and on `…/webhook-signing-secret-sub-*` only when per-subscription secrets are wanted (then set
   `WEBHOOK_SUBSCRIPTION_SECRETS=1`).
2. core-vpc: the claim route.
3. frontend: LedgerPage link.
4. integrations: `schemaVersion` in the n8n fixtures.
