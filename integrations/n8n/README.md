# DeveloperCards n8n recipes

Two importable [n8n](https://n8n.io) workflows that receive DeveloperCards' signed outbound webhooks (contract R18-00 §6) and connect them to tools that do not talk to DeveloperCards directly:

| Workflow | Trigger | What it does |
|---|---|---|
| `workflows/card-flagged-to-slack-and-sheet.json` | `POST /webhook/developercards`, plus a 1-minute schedule | Checks the signature over the raw request bytes (401 on failure), then drops a delivery it already processed (`X-DeveloperCards-Delivery`). Every new verified event is written to the `Events` tab of a Google Sheet. A `card.flagged` event writes one row per card to the `Flagged` tab and joins its QA run's pending summary; the schedule posts **one** Slack message per QA run to `#developercards` (deck, number of flagged cards, blocker/major/minor totals, top 5 findings, console link) once the run has been quiet for 5 minutes. A `review.queued` event posts a Slack message with the console review link, so the human checkpoint is pushed rather than polled. The workflow answers `200` only after these writes succeed. |
| `workflows/weekly-digest.json` | Monday 08:00 `Pacific/Auckland` (cron `0 8 * * 1`) | Reads the `Events` tab and emails a digest of the last 7 days: decks published, cards flagged, draft batches queued for review, import failures (up to 10 latest per section). An empty week still sends a "quiet week" digest. |

Nothing here runs in the cloud or calls DeveloperCards; it only receives what the dispatcher sends.

## Layout

```
docker-compose.yml          pinned n8n image, port 5678, ./.n8n-data volume
.env.example                DC_WEBHOOK_SECRET, WEBHOOK_URL placeholders (copy to .env)
lib/verify-signature.mjs    signature check (the region between BEGIN/END is embedded in the workflow)
lib/recipe-logic.mjs        Events row, delivery de-duplication, per-run Slack summary, review Slack message, weekly digest (embedded in every Code node that uses it)
lib/*.test.mjs, lib/index.js  node:test suites
workflows/*.json            n8n exports (inactive, credential placeholders only)
scripts/send-test-event.py  stdlib signed test sender
fixtures/<event>.json       one sample body per event
```

The Code nodes contain the library regions **verbatim** (`lib/workflows.test.mjs` fails if they drift). When you change `lib/*.mjs`, paste the whole region (from the `// BEGIN …` line through the `// END …` line) into the matching Code nodes: `Verify signature` for the verifier; `Check delivery`, `Event row`, `Flagged message`, `Queue run summary`, `Review message`, `Remember delivery`, `Due run summaries`, `Mark summaries sent` and `Build digest` for the recipe logic.

## Pinned image

```
image: docker.io/n8nio/n8n:2.40.7@sha256:ffeb52485f78b1b06c9a832205853cf75da72a07a514c9a27724df85979d6c34
```

Read from the Docker Hub registry on 2026-09-27: tag `2.40.7` was the current `stable` and `latest`, OCI index digest `sha256:ffeb52485f78b1b06c9a832205853cf75da72a07a514c9a27724df85979d6c34`. The compose file also sets `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (the verifier's Code node calls `require('crypto')`) and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (it reads `$env.DC_WEBHOOK_SECRET`); n8n 2.x refuses both otherwise.

## Setup

1. **Environment file.**

   ```sh
   cd integrations/n8n
   cp .env.example .env
   ```

   `.env` and `.n8n-data/` are gitignored; never commit them.

2. **Signing secret (owner only, never committed).** The console's Webhooks page (`/admin/webhooks`) shows the SSM parameter name `/developercards/prod/webhook-signing-secret` (never the value). Fetch the value with your own AWS credentials and paste it into `.env` as `DC_WEBHOOK_SECRET=…`:

   ```sh
   aws ssm get-parameter --name /developercards/prod/webhook-signing-secret --with-decryption --query Parameter.Value --output text
   ```

   For a purely local run you can use the contract's fake secret instead: `DC_WEBHOOK_SECRET=whsec-test`.

3. **Start n8n.**

   ```sh
   docker compose up -d
   ```

   Open `http://localhost:5678` and create the owner account.

4. **Import both workflows.** In n8n: *Workflows → Import from file* → `workflows/card-flagged-to-slack-and-sheet.json`, then `workflows/weekly-digest.json`. Both import inactive.

5. **Create the three credentials** and pick them in the nodes (the exports only carry placeholder ids starting with `REPLACE_`):
   - `DeveloperCards Google Sheets` (Google Sheets OAuth2) — nodes `Events sheet`, `Flagged sheet`, `Read Events sheet`.
   - `DeveloperCards Slack` (Slack API token with `chat:write`) — nodes `Slack run summary` and `Slack review queued`; invite the app to `#developercards` or change the channel.
   - `DeveloperCards SMTP` — node `Email digest`; replace both `REPLACE_ME@example.com` addresses with the real sender and recipient.

6. **Google Sheet.** Create one spreadsheet with two tabs and these header rows, then replace `REPLACE_WITH_SHEET_ID` in the three Sheets nodes with the spreadsheet id:
   - `Events`: `eventId, occurredAt, event, deckSlug, summary`
   - `Flagged`: `eventId, occurredAt, deckSlug, stableUid, blocker, major, minor, topFinding, consoleUrl`

   Both writers use *append or update* matching `eventId`, so a retried delivery updates the existing row instead of adding a second one.

7. **Activate** `DeveloperCards: card flagged to Slack and Sheet` (and the digest when you want the Monday email). The delivery memory and the pending run summaries live in the workflow's static data, which n8n keeps only for an active workflow (not for *Test workflow* runs).

## Connect the console subscription

The dispatcher only delivers to public `https://` URLs (no localhost, no private addresses), so expose n8n first:

- **n8n Cloud:** import the same two workflows there; set `DC_WEBHOOK_SECRET` as an environment variable of the instance (Code nodes read it through `$env`).
- **Self-hosted behind a tunnel** (for example Cloudflare Tunnel or ngrok to `localhost:5678`): set `WEBHOOK_URL=https://<public host>/` in `.env` and run `docker compose up -d` again so n8n shows the public URL.

Then in the console go to **Webhooks** (`/admin/webhooks`) and create a subscription:

- URL: `https://<public host>/webhook/developercards`
- Events: `card.flagged`, `deck.published`, `review.queued`, `import.failed`

Press **Send test** on the subscription. A `webhook.test` event should appear in the n8n execution list and as a row in `Events`; the delivery shows `delivered` in the console.

## Local testing

With n8n running and the first workflow active (or listening via *Test workflow*, which uses `/webhook-test/developercards`):

```sh
DC_WEBHOOK_SECRET=whsec-test python3 scripts/send-test-event.py --event card.flagged
```

The secret must equal the one in `.env`. Options:

- `--event` one of `deck.published`, `import.failed`, `card.flagged`, `review.queued`, `webhook.test` (default `card.flagged`)
- `--url` receiver (default `http://localhost:5678/webhook/developercards`; only `https://…`, `http://localhost…` or `http://127.0.0.1…`)
- `--timestamp` signature timestamp in epoch seconds (default now)
- `--keep-ids` keep the fixture's `eventId` / `occurredAt` (re-running shows that the sheets do not get a second row)
- `--dry-run` print the signed request as JSON and send nothing

It prints the HTTP status and exits 0 on 2xx, 1 otherwise, 2 on bad arguments or a missing secret.

## Behaviour notes

- **Signature check.** `HMAC-SHA256(secret, "<timestamp>.<raw body>")`, bare lowercase hex, timestamp in epoch seconds, ±300 s tolerance, constant-time compare (`crypto.timingSafeEqual`). During a secret rotation DeveloperCards also sends `X-DeveloperCards-Signature-Previous`, made with the previous secret; the check accepts the delivery when either header matches (both compared in constant time), so this workflow keeps verifying between the moment the new secret is put and the moment you update `DC_WEBHOOK_SECRET` here (step 1 of the rotation runbook in `services/webhook-dispatcher/README.md`). The check runs over the raw request bytes (the webhook node has *Raw Body* on); re-serialising the parsed JSON would not reproduce the escaped bytes DeveloperCards signed.
- **401 is permanent.** On a bad or missing signature, a stale timestamp or a missing secret, the workflow answers `401 {"ok":false,"reason":…}`. The dispatcher treats any 4xx other than 408/429 as a permanent failure and does not retry, so fix the secret and use *Redeliver* in the console.
- **Verify, then process, then answer.** A verified delivery goes through `Check delivery` → `Events sheet` → the per-event branch → `Remember delivery` → `Respond 200`. Nothing answers early, and no node continues on failure: when a Sheets or Slack write still fails after its retry, the execution stops before any Respond node and n8n answers `500`. The dispatcher retries 5xx and timeouts with the same `X-DeveloperCards-Delivery`, so the event is processed again instead of being lost, and the console does not mark the delivery `delivered` until the receiver really processed it.
- **Retries.** `Events sheet`, `Flagged sheet` and `Slack review queued` retry once after 1 s (2 tries), so a retried write still fits the dispatcher's 10 s timeout; a slower delivery simply times out and is retried by the dispatcher. `Slack run summary` runs on the schedule, not inside a delivery, and tries 3 times 5 s apart.
- **Duplicates.** `Remember delivery` stores the delivery id (the `X-DeveloperCards-Delivery` header, else the `eventId`) only after every write for it succeeded, keeping the last 1000 ids. A redelivered id answers `200 {"ok":true,"duplicate":true}` without touching Sheets or Slack. Both sheets also *append or update* on `eventId`, and a run summary counts each `eventId` once, so a replay after the memory is full still adds no row and no count. Trade-off: if Slack accepted a `review.queued` message but a later node failed, the retry posts it again.
- **One Slack message per QA run.** `card.flagged` arrives once per flagged card (a 200-card run can flag dozens). Each one is written to the `Flagged` tab and added to its run (`runId`) in the static data; the `Every minute` schedule posts a run's summary once no flagged card arrived for it for 5 minutes (or after 30 minutes at most) and then drops it. A failed post stays pending and is tried again the next minute. Two executions that change the static data at the same moment can overwrite each other (n8n saves it per execution), which at worst drops a card from a Slack summary; the `Flagged` row is unaffected.
- **Test sender.** `scripts/send-test-event.py` sends a fresh `X-DeveloperCards-Delivery` every time, so re-sending with `--keep-ids` is a new delivery: the sheets update the same row, and a `review.queued` message is posted again.

## Tests

No npm or Python dependencies.

```sh
cd integrations/n8n
node --test lib/                 # lib/index.js loads every lib/*.test.mjs
node --test 'lib/*.test.mjs'
python3 -m unittest discover -s scripts -p 'test_*.py'
```
