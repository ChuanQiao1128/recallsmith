# X03 — Python Lambdas hardening: per-finding outcome

Branch `delivery/r18xp/X03-355` (base `delivery/r18x-p`). Scope: `services/**` and this file only.
No IAM, Terraform, core-vpc (`src_C`) or console change is made here; the follow-ups that need one
are named per finding.

Gates run: `cd services/<svc> && uv lock --check && uv run --python 3.12 pytest -q` for both
services, `bash -n services/deploy-python-lambda.sh`, and
`DRY_RUN=1 bash services/deploy-python-lambda.sh <svc>` for both services.

## Metric contract (webhook-dispatcher, namespace `DeveloperCards`)

`WebhookDeliveryAttempts` (dimensions `Service=webhook-dispatcher`, `Outcome`) — unchanged names,
values already distinguish the two failure kinds:

| `Outcome` | Meaning |
|---|---|
| `delivered` | 2xx |
| `retry` | retryable failure, attempts left (visibility set to the backoff) |
| `failed` | **permanent** failure: non-retryable status (other 4xx/3xx/1xx) or `URL_REJECTED`; acked at once |
| `dead` | **gave up** after the last (5th) retryable attempt; headed for the DLQ |

`WebhookReportFailures` (dimension `Service`) is unchanged. ai-qa keeps `AiQaErrors` and
`AiQaRefusals` unchanged. Documented in `services/webhook-dispatcher/README.md:168`.

### cloud-security-resilience-1

Status: fixed

- `services/webhook-dispatcher/src/webhook_dispatcher/delivery.py:50-128`: `post_json` now enforces a
  wall-clock deadline for the whole attempt. A `threading.Timer` watchdog (`_abort`, :50) shuts the
  socket down (plain `socket.socket.shutdown`, so the TLS object is not torn out from under the
  reader) when `timeout` elapses; a blocked connect/send/recv then returns and the attempt is a
  retryable `timeout`. A deadline hit before the status line is `timeout`; once the status line and
  headers are in, the status counts and the drip-fed body is abandoned. Connect is done explicitly
  first so a deadline that passes during connect is also caught (:109).
- `services/webhook-dispatcher/src/webhook_dispatcher/handler.py:133` `_attempt_timeout`: the attempt
  is also capped at the Lambda's remaining time minus `ATTEMPT_REPORT_RESERVE_S = 6.0` (:37), floor
  1 s, so the attempt is always reported before the 30 s function timeout.
- README: "Delivery policy" section explains the whole-request bound.
- Tests: `tests/test_delivery.py::test_drip_fed_headers_are_cut_off_at_the_whole_request_deadline`
  (one header line every 0.2 s, `timeout=1.0`, asserts `duration_ms <= 1300` and wall time
  `<= 1300`; the old code ran until the drip stopped),
  `tests/test_delivery.py::test_drip_fed_body_keeps_the_status_and_ends_at_the_deadline` (the old
  code hung on it), `tests/test_handler.py::test_attempt_timeout_leaves_time_to_report`.

### cloud-security-resilience-4

Status: partially fixed

- Visibility (fixed): `services/ai-qa/src/ai_qa/handler.py:83` `_retry_soon` — on a retryable exit
  (`:356`) the handler calls `ChangeMessageVisibility` with a random 60-120 s
  (`RETRY_VISIBILITY_MIN/MAX_SECONDS`) instead of leaving the queue's 3600 s. The role already has
  `sqs:ChangeMessageVisibility` (roles_r18.tf SqsConsume); no IAM change. A failed visibility call
  is logged (`visibility_failed`, error class only) and the message still fails.
  `services/ai-qa/src/ai_qa/settings.py:177` adds the lazily created SQS client.
- Retry scope (best effort, no IAM and no core change): `handler.py:54` `_reported` remembers every
  item reported with a 200, keyed by `(runId, chunk, cardId, contentSha256, promptVersion)` (LRU,
  2000 keys); `handler.py:329` skips those cards on a redelivery (no model call, no second report);
  `handler.py:299` acks without a report when nothing is left. Chosen design: no new IAM (a trimmed
  re-send would need `sqs:SendMessage`) and no core change (the results response does not return
  done card ids, and `src_C` is outside this issue). Limit: a redelivery landing on a different or
  recycled container still re-reviews the finished cards. With reserved concurrency 2 and a 60-120 s
  return, it usually lands on a warm container that has the entries.
- Follow-up (core-vpc, outside `services/`): have `POST /api/internal/ai-qa/results` return the chunk's
  done card ids for the current hash, so the skip does not depend on container reuse.
- README: `services/ai-qa/README.md:158` ("Retry scope") and the chunk-policy table.
- Tests: `tests/test_handler.py::test_redelivered_chunk_makes_no_model_call_for_cards_already_reported`,
  `::test_unreported_cards_are_reviewed_again_on_redelivery`,
  `::test_remembered_items_are_keyed_by_content_hash`,
  `::test_visibility_change_failure_still_fails_the_message`. Existing
  `::test_deadline_guard_stops_before_the_lambda_timeout` now calls `handler.reset_client_cache()`
  between its invocations (a fresh container), because it replays an already-reported card to test
  the SDK options. Its assertions are unchanged.

### cloud-security-resilience-6

Status: fixed

- `services/ai-qa/README.md:202` "Emergency stop": explains why editing `AI_QA_ENABLED` on the function
  does nothing (the ESM targets the alias, and the published version freezes the env), then gives the
  commands: find the ESM UUID, `update-event-source-mapping --no-enabled`, or
  `put-function-concurrency --reserved-concurrent-executions 0`, and the undo commands (`--enabled`,
  or concurrency back to the Terraform value 2).
- `services/webhook-dispatcher/README.md:206`: the same procedure for
  `developercards-webhook-dispatcher`.
- Not done: reading `AI_QA_ENABLED` from SSM. That needs a new parameter and an IAM grant, and the
  ESM stop already covers an emergency.
- Tests: runbook only (docs); no code path changed.

### cloud-security-resilience-7

Status: partially fixed

- Rotation without a flag day (fixed): `services/webhook-dispatcher/src/webhook_dispatcher/settings.py:18`
  `SECRET_TTL_SECONDS = 300`. Loaded secrets are cached with a TTL (:62-120) instead of for the life of
  the container. `previous_secret_name` (:128) gives `/developercards/prod/webhook-signing-secret-previous`.
  It is read only if present (`optional=True`: a failed read is logged at debug level only, and the
  absence is cached for the TTL, :68).
- `handler.py:186-194`: while the previous secret exists (and differs from the current one), every
  attempt also carries `X-DeveloperCards-Signature-Previous` (`signing.py:11`). This is the same
  HMAC made with the old secret. With a single secret the headers are byte-identical to before
  (`test_2xx_is_delivered_and_acked` still asserts the exact header dict), so current receivers and
  the n8n verifier keep working. A separate header was chosen over `v1=…,v1=…` in the existing
  header, because a list would change the existing header's bytes during every rotation.
- README: `services/webhook-dispatcher/README.md:90` "Signing-secret rotation" (runbook) and receiver
  recipe step 3 (accept either header).
- **IAM needed (X08):** `ssm:GetParameter` on `…/developercards/prod/webhook-signing-secret-previous`
  for the dispatcher role (`infra/modules/identity/roles_r18.tf:45`). Until it is granted, the read is
  denied, treated as absent, and only the primary signature is sent.
- Not done: per-subscription secrets. They need schema, console and core changes (`src_C`,
  `frontend`), and contract §6.3 specifies the per-environment secret. Follow-up. Receivers of the
  shared secret (for example `integrations/n8n` verify-signature) should also accept the
  `-Previous` header (another wave's root).
- Tests: `tests/test_settings.py::test_loaded_secret_expires_after_the_ttl`,
  `::test_optional_secret_absence_is_cached_for_the_ttl`,
  `tests/test_handler.py::test_rotation_sends_a_second_signature_made_with_the_previous_secret`,
  `::test_missing_previous_secret_is_looked_up_once_per_ttl`.

### cloud-security-resilience-8

Status: partially fixed

- Documented (the finding's minimum): `services/webhook-dispatcher/README.md:53`. A queued delivery
  makes at most one more attempt to the URL it was enqueued with, then `stop` acks it. To cut a URL
  off at once, disable the subscription and stop the consumer (Emergency stop) or purge the queue.
- Not done: the pre-send claim check. It needs a new signed core-vpc route
  (`/api/internal/webhooks/deliveries/claim`) or cancel-on-disable in `WebhookSubscriptions.cs`,
  both in `src_C` (outside this issue's paths). The console note in `WebhooksPage` is `frontend`
  (another wave's root). Follow-up for core + console.
- Tests: none (documentation only; behaviour unchanged).

### cloud-security-resilience-9

Status: fixed

- `services/deploy-python-lambda.sh:81-84`: `uv export` now keeps uv.lock's sha256 hashes (no
  `--no-hashes`), and `uv pip install --require-hashes` refuses any artifact that does not match.
- `:61-70`: a real deploy refuses when `git status --porcelain -- services/<svc>` is non-empty.
  `DRY_RUN=1` only warns, so DRY_RUN keeps working in a working tree.
- `:72-75`: runs the service's tests (`uv run --frozen --python 3.12 pytest -q`, AWS credentials
  removed) before building; a failure aborts before anything is built.
- `:133-141`: reads the alias's current `FunctionVersion` before `update-alias` and prints the
  one-line rollback command.
- Verified: `bash -n services/deploy-python-lambda.sh` is clean; `DRY_RUN=1` for `webhook-dispatcher`
  (no runtime deps, empty hashed requirements) and `ai-qa` (every line carries `--hash=sha256:…`)
  both test, build and print. No real deploy was run.
- Tests: the deploy script has no unit test harness; covered by `bash -n` (CI) and the two DRY_RUN
  builds above.

### ai-agent-4

Status: fixed

- `services/ai-qa/src/ai_qa/schema.py:38` `CATEGORY_SEVERITY`: incorrect_answer and multiple_correct
  → blocker; answer_leak, ambiguous_stem, outdated_fact, qualifier_mismatch and source_unsupported →
  major; weak_distractor and other → minor. This matches the rubric in prompts.py.
- `services/ai-qa/src/ai_qa/review.py:129-155` `finalize_findings`: the reported severity always comes
  from the category (:150), and sorting uses it too (:141). When the model's own value disagrees, a
  `severity_mismatch` warning is logged with the card id, the count and the `category:severity`
  pairs, never the message text (:131-140). So an `incorrect_answer` sent as major now blocks
  publishing, and an `other` sent as blocker no longer does.
- `SYSTEM_PROMPT`, `PROMPT_VERSION` and the `ModelFinding` schema are unchanged, as directed (the
  prompt is being tuned against the eval separately).
- README: `services/ai-qa/README.md` ("Replies", the category-to-severity table).
- Tests: `tests/test_review.py::test_category_fixes_the_severity_whatever_the_model_says`
  (mismatched pairs are corrected and the mismatch is logged),
  `::test_category_severity_table_covers_every_category`.

### ai-agent-14

Status: partially fixed

- Re-review on retry: same change as cloud-security-resilience-4 (`handler.py:54,299,329,356`). A
  redelivery on the same container reviews only the cards not yet reported. The per-container cache
  is a best-effort limit.
- Not done: accumulating `estimated_cost_usd` and tokens on a done→done upsert. That is
  `src_C/Vpc/Internal/AiQaResults.cs:144-152` (core-vpc, outside `services/`). Follow-up. Change the
  update to add the new values to the stored ones for a done→done report, or return the done ids so
  the Lambda never re-reports.
- Tests: `tests/test_handler.py::test_redelivered_chunk_makes_no_model_call_for_cards_already_reported`
  (the second receive makes 2 model calls, not 3, and does not re-report card 101).

### automation-6

Status: fixed

- Same change as cloud-security-resilience-7: `settings.py:18` sets a 5-minute TTL, and there is an
  overlap window through `<name>-previous` plus `X-DeveloperCards-Signature-Previous`. The
  dispatcher signs with the current secret and also with the previous one while it exists.
- The rotation procedure is documented in `services/webhook-dispatcher/README.md:90`: first make
  every receiver accept either header; copy current→previous; put the new value; wait 10 min; update
  the receivers; delete previous. The document warns that a receiver's 401 is permanent, which is
  why receivers must be ready first. The receiver recipe (step 3) now says to accept either header.
- An SSM value of the form `new,old` was not used. A separate parameter keeps the current secret's
  value format unchanged and needs no parsing.
- IAM for the `-previous` read: X08 (see cloud-security-resilience-7). The n8n verifier and the
  webhookRules.ts snippet belong to other waves' roots (`integrations`, `frontend`). Follow-up:
  accept the `-Previous` header there.
- Tests: `tests/test_settings.py::test_loaded_secret_expires_after_the_ttl`,
  `::test_optional_secret_absence_is_cached_for_the_ttl`,
  `tests/test_handler.py::test_rotation_sends_a_second_signature_made_with_the_previous_secret`,
  `::test_missing_previous_secret_is_looked_up_once_per_ttl`.

### automation-7

Status: partially fixed

- `services/webhook-dispatcher/src/webhook_dispatcher/handler.py:104` `unsupported_version`, :153-157.
  A message that parses as a JSON object with a valid `deliveryId` but a `v` other than `1`
  (missing, `true`, `2`, …) is logged as `webhook_unsupported_version` (message id only) and returned
  as a batch item failure. SQS redrives it to the alarmed DLQ instead of acking it, so the delivery
  row is no longer left `queued` without trace, and the message can be redriven once a dispatcher
  that speaks that version is deployed. Truly malformed messages (no JSON, no valid deliveryId) are
  still acked as `webhook_bad_message`.
- README: step 1 of the flow and the policy table. Deploy order: the dispatcher first, then a core
  that emits a new version. Receiver recipe step 5: ignore unknown fields and headers.
- Not done: the additive `"v":1` in the §6.3 event body. The body is rendered by
  `WebhookEvents.RenderBody` in `src_C` (outside this issue). Follow-up for core.
- Existing test changed: `tests/test_handler.py::test_bad_message_shape_is_acked_without_retry` no
  longer lists `v=2` / `v=True` with a valid deliveryId, because the finding makes acking those wrong.
  Its `v=2` case keeps an invalid deliveryId, so it still covers the ack path. The removed cases
  moved to the new
  `::test_unknown_message_version_goes_to_the_dlq_instead_of_being_dropped` (v=2, v=True, v
  missing, unknown shape with a deliveryId), which asserts a batch item failure, no send and no
  report.
