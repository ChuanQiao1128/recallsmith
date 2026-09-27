# A09 notes — notifier Lambda (`services/notifier`)

Choices the brief makes beyond A00 §12.3, and readings made while implementing them.

## Choices beyond A00 §12.3

- **`BAD_MESSAGE` is reported.** A00 §12.3 only says "bad shape ⇒ log + ack". When the
  `notificationId` is still a valid UUID the notifier also reports `failed` / `BAD_MESSAGE`, so the
  email log row does not sit in `queued` until core's resend rule re-enqueues the same bad message
  five times. Without a valid id there is no row to update; the message is only logged and acked.
  The report needs the internal secret: when it is missing, the bad message is still acked (it can
  never be sent) and only logged.
- **No send without the internal secret.** A missing or placeholder `notifier-secret` makes every
  record a batch item failure before SES is called. Sending without being able to report would
  leave the row `queued`, and core's resend (queued > 15 min, `attempts < 5`) would send the same
  email again. After five receives the message lands in the DLQ and the DLQ alarm fires, which is
  the right signal for a configuration error.
- **In-container duplicate cache.** An LRU of at most 1000 `notificationId → sesMessageId`. A
  redelivery of an email this container already sent (a lost SQS delete, or a report that failed
  and core resent) reports `sent` again with the remembered id instead of sending twice. It is
  per-container only; core's sticky `sent` covers the rest.
- **Dry-run guard.** Core renders the "(dry run)" marker (A00 §12.2). As a belt-and-braces check
  for owner decision 7, a `dry_run` message whose subject lacks `(dry run)` gets it inserted after
  the `[DeveloperCards] ` prefix (or both prepended) and a `dry_run_marker_added` warn log, so a
  core rendering bug can never make a dry run look live. The body is never touched.
- **Other 4xx ⇒ `failed`.** A00 §12.3 names the permanent codes and "other 5xx/connection errors"
  but not other 4xx. Those (for example `AccessDeniedException` before A11's grant exists) are
  configuration errors that redelivery cannot fix, so they are `failed` with their code; retrying
  them would only delay the alarm by five receives.

## Other readings

- **Recipient validation.** `get_recipient()` returns `None` unless the value is exactly one
  address (one `@` with text on both sides, no whitespace, ≤ 254 characters). An invalid value is
  not cached (like the placeholder), so a corrected SSM value is picked up on the next message.
- **Error texts.** `ses.ERROR_TEXTS` holds a fixed sentence per known code; an unknown code gets
  `SES send failed with <code> (HTTP <status>).`, built from the sanitised code alone. The SES
  message is never read.
- **Throttle then another error.** The two in-process throttle retries continue with the normal
  classification: a throttle followed by a permanent error is `failed` with that code.
- **Unexpected exceptions from `send`.** Anything that is neither an SES `ClientError` nor one of
  the four botocore transport errors propagates to the per-record handler and becomes a batch item
  failure (step 9), so it is redelivered and eventually reaches the DLQ.
- **Tick path.** One attempt with a 28 s timeout (`retry_pauses=()`). The 401/403 retry with
  `notifier-secret-previous` still applies, as for every internal call. The logged and returned
  `actions` keep integer values only; `skipped` is kept only when it is a string.
- **`tick_failed` log** carries `status` (the HTTP status or `null`) and the client's own error text
  (for example `HTTP 503`), never a response body.
