# Automation operations runbook

How to run the card automation (R18A) as a business process: rolling it out from `off` to `dry_run`
to `live`, deciding when it may go live, acting on each exception email, reading the Automation page,
and rolling back, including undoing a card that was auto-accepted or auto-published.

Infrastructure (schedules, alarms, SES, the emergency stop) lives in
[infra/RUNBOOK.md](../../infra/RUNBOOK.md) §7, "Automation schedules and emergency stop". The design
contract is the R18A contract (A00) §3, §5, §6, §12, §15, §16 and §19; this page is its operating summary.

## The one switch

- `AUTOMATION_MODE` (`off` | `dry_run` | `live`) is read only by core-vpc, from `src_C/env/prod.env.json`,
  on every request. Change it by committing that file on main and running `ENV=prod ./src_C/deploy.sh`.
  The Lambdas and the local runner follow core's answers.
- **Effective** mode can be lower than configured: `live` is effective only while the **newest** row of
  the eval-gate table is passed and not revoked (R18B K2). A revoke, or a newer failed gate, drops live
  to `dry_run` on the next request; an older passed gate never takes over.
- Other core keys that shape a rollout (same file, same deploy):
  - `AUTOMATION_DECK_SLUGS`: comma list of deck slugs eligible for automation. Empty or absent means
    **every deck**; drafts for other decks go to a human with reason `DECK_NOT_ALLOWED`.
  - `AUTOMATION_AUTO_PUBLISH`: `0` keeps auto-accept but routes every publish to a human
    (`AUTO_PUBLISH_DISABLED`).
  - `AUTOMATION_SOURCE_HOSTS`: hosts a draft may cite to be auto-accepted.
  - `AI_QA_DAILY_USD_CAP`: the only spend limit (there is no count cap).
- Only brand-new cards are ever auto-accepted (a card with the same deck and stable id, live or deleted,
  routes the draft to a human with `EXISTING_CARD`).

| Effective | Drafts | Auto-accept | Auto-publish | Emails |
|---|---|---|---|---|
| `off` | plain review-queue drafts | never | never | none (except the test email) |
| `dry_run` | decided and recorded, QA runs | never (`would_accept`) | never (`would_publish`) | all, marked "(dry run)" |
| `live` | decided, QA runs | yes | yes (unless `AUTOMATION_AUTO_PUBLISH=0`) | all |

## Rollout: off → dry_run → live

Each step is done by the supervisor unless marked owner. Do not skip a step; each one's check must hold
before the next.

1. **off** (release, A00 §19.2 steps 3–8). Migrate (`034_automation.sql` listed by
   `GET /api/v1/admin/db/migrations`), deploy core with `"AUTOMATION_MODE":"off"`, deploy the ai-qa,
   source-watcher and notifier Lambdas (`DRY_RUN=1` first), enable the three schedules and the
   actions of the two heartbeat alarms, tick-missing and source-watch-missing (infra/RUNBOOK.md §7
   recipe), deploy the console.
   Check: `GET /api/v1/admin/automation/status` shows `mode.effective = "off"`; the Email log's test email
   shows `sent` and the owner received it; the notifier log shows ticks answered `skipped: "off"`;
   `developercards-prod-automation-tick-missing` and `developercards-prod-source-watch-missing` are `OK`
   (the watcher emits one `SourceWatchRuns` per hourly run, also when it has nothing to watch).
2. **Runner (owner, on the Mac, once).** Build `tools/mcp-server` and `tools/author-runner`
   (`npm ci && npm run build` in each), `node tools/mcp-server/dist/index.js login`,
   `tools/author-runner/scripts/install.sh`, `node tools/author-runner/dist/index.js status`.
   Check: the Overview tab lists the runner after its first hourly heartbeat.
3. **dry_run.** Set `"AUTOMATION_DECK_SLUGS":"aws-saa-c03,claude-ccdv-f"` (the two decks the eval gate
   measures) and `"AUTOMATION_MODE":"dry_run"`, commit, `ENV=prod ./src_C/deploy.sh`.
   Check: status `effective = "dry_run"`; the watcher's first hour records `baseline` for both feeds (no
   queue flood); batch summaries arrive marked "(dry run)"; the digest arrives Monday 08:00 NZ. While
   `AI_QA_ENABLED="0"` every eligible draft is `human` / `QA_UNAVAILABLE`, which is expected.
   This is the state the gate's **new-facts stratum** needs (step 5), so run its window now, before
   step 4, and no AI QA toggle is needed: follow evals/README.md, "New-facts stratum (owner,
   production in dry_run)", steps 1–6, and keep `AI_QA_ENABLED="0"` until it is done.
4. **AI QA on (owner-gated).** GPT-5.5 is served only by the bedrock-mantle OpenAI endpoint
   (`https://bedrock-mantle.{region}.api.aws/openai/v1`, model `openai.gpt-5.5`, In-Region us-east-1 /
   us-east-2; AWS model card model-card-openai-gpt-55.html, read 2026-09-28), so the committed automation
   reviewer is provider `openai-mantle` in `us-east-1` (R18C L1); `bedrock-converse` /
   `global.openai.gpt-5.5` in ap-southeast-2 stays as the fallback. Card text sent to the reviewer then
   leaves ap-southeast-2 for us-east-1 (public study content only). The ai-qa role's grant is
   `BedrockMantleOpenAiInference` = `bedrock-mantle:CreateInference` on
   `arn:aws:bedrock-mantle:us-east-1:<account>:project/default` with `bedrock-mantle:Model = openai.gpt-5.5`
   (infra identity `ai_qa_openai_mantle_*`). After Bedrock allowlisting and the apply of that grant, and
   before any paid eval run, the owner runs **one probe per path** (each is one tiny paid request; owner
   only, from a private shell with an admin profile):

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

   A 403 or an allowlisting message is the account (grant, Marketplace terms, allowlisting), not the code.
   Only a 200 on the first probe makes the eval runs in step 5 meaningful. Then, with
   `AI_QA_AUTOMATION_PRICE_*` in `services/ai-qa/env/prod.env.json`: set
   `AI_QA_ENABLED="1"` in both env files, `services/deploy-python-lambda.sh ai-qa` (after `DRY_RUN=1`) and
   `ENV=prod ./src_C/deploy.sh`. Dry run now QA-checks drafts within the shared USD cap.
   Check: new decisions reach `would_accept` or `human` with a QA reason; the `ai-qa-daily-cost` alarm
   (which sums bedrock, anthropic, bedrock-converse and openai-mantle) stays `OK`.
5. **Eval gate (owner runs, supervisor records).** A00 §15.4. The gate has three inputs and fails closed
   without any of them:
   1. **New-facts stratum** (evals/README.md, "New-facts stratum"): drafts the runner wrote in production
      `dry_run` with `AI_QA_ENABLED="0"` for the whole window, imported with `dc-evals import-drafts` into
      authored-v2. Done in step 3 on a first rollout. When it has to be (re)produced after step 4 (a new
      gate for a changed author configuration, a stratum below 51 would-accept cards, a new deck), turn
      AI QA **off around the window**: set `AI_QA_ENABLED="0"` in `services/ai-qa/env/prod.env.json` and
      `src_C/env/prod.env.json`, `services/deploy-python-lambda.sh ai-qa` (after `DRY_RUN=1`) and
      `ENV=prod ./src_C/deploy.sh`; run the window (README steps 1–5); then set both back to `"1"` and
      deploy both again (README step 6). **Meanwhile every real dry-run draft also routes to a human with
      `QA_UNAVAILABLE`**, so it adds nothing to the shadow agreement and does not count toward the two
      weeks of dry run with AI QA on: review those drafts by hand as usual, and keep the window short.
      Never turn QA on during the window (eval drafts would reach `would_accept` and their rejection would
      count as disagreement).
   2. The two `dc-evals run` reports (seeded-v3 and authored-v2 including the new-facts rows, `--reps 2`,
      provider `openai-mantle`), then `dc-evals automation-gate`. The gate report carries the author it
      measured in `authored.author.authorConfigId` (R18D M1); `automation-gate` fails closed when the
      new-facts runs carry more than one author configuration. Commit the reports.
   3. **Record the gate** (R18D M4): paste the gate report JSON into Automation → Overview → eval-gate card
      (or `POST /api/v1/admin/automation/eval-gate`). Record every well-formed report, **failing ones
      too**: a failing report becomes the newest gate and blocks live, so the console first asks to
      confirm that it will block live, then shows "Recorded as gate #N (failed): live mode now runs as a
      dry run" and refreshes the card. The other answers:
      - `400 EVAL_GATE_FAILED` — recorded as failed (above); fix the cause and run the gate again.
      - `400 EVAL_GATE_INVALID` — not recorded: the JSON is not a gate report, or a report with a
        new-facts stratum lacks `authored.author.authorConfigId`. Paste the `.json` gate report (not a
        run report or the `.md`) from a current `dc-evals automation-gate`.
      - `409 EVAL_GATE_STALE` — not recorded: its `generatedAt` is older than the newest recorded gate's
        report. An older report never replaces a newer one; run the gate again for a fresh report.
      - `409 EVAL_GATE_REVOKED` — not recorded: the same report bytes belong to a revoked gate. A revoke
        is final; run the evaluation again.
   Check: the card shows a current, passed gate whose reviewer is
   `openai-mantle` / `openai.gpt-5.5` / `qa-v4-auto` (or `bedrock-converse` / `global.openai.gpt-5.5` /
   `qa-v4-auto` if the fallback was the provider actually used), and the author configuration id the
   runner uses now (the runner's run meta, `authorConfigId`).
6. **Review the dry run** for at least two weeks against the promotion checklist below.
7. **live, publish held.** Set `"AUTOMATION_AUTO_PUBLISH":"0"` and `"AUTOMATION_MODE":"live"`, deploy.
   Check: status `effective = "live"`; watch the first live batch end to end (auto-accepted card, its
   mirror AI QA run, `publish_blocked` / `AUTO_PUBLISH_DISABLED` exception, ledger rows). For the first
   week a human publishes each deck from the console after checking the new cards.
   From now on **watch the live override rate** (R18D M2): the status API's `live` block and the
   Overview show, for the auto-accepted decisions of the last 30 days, `autoAccepted30d`,
   `deletedByPerson`, `editedByPerson` (a person changed the card after the automation accepted it) and
   `overrideRate` = (deleted + edited) / autoAccepted30d (`null` while nothing was auto-accepted); the
   weekly digest repeats it. Above 0.05 with at least 20 auto-accepted cards the `live_override_high`
   exception email fires (once per ISO week); treat it as a quality regression (see "Exception emails").
8. **live, auto-publish.** After a clean first live week (no auto-accepted card rejected or deleted by a
   person: `live.deletedByPerson` = 0, and `live.editedByPerson` only for changes you would have made
   anyway), set `"AUTOMATION_AUTO_PUBLISH":"1"`, deploy, and watch the first auto-publish end to end
   (publish job `SUCCEEDED`, `deck.published` webhook, ledger `auto_publish` row).
9. Widen `AUTOMATION_DECK_SLUGS` to another deck only after an eval gate that measured that deck.
10. **Changed author configuration → new gate** (R18D M1). The runner's `authorConfigId` is the sha256 of
    its author model, skill version, skill files, queue-item prompt and claude arguments (not the Claude
    CLI or runner version). A live auto-accept requires the draft's `agent.authorConfigId` to equal the
    newest gate's; any other draft routes to a person with `AUTHOR_NOT_GATED`. So after changing any of
    them (a new `DC_RUNNER_MODEL` or runner default model, an edited author-cards skill or prompt, new
    runner arguments), produce a new new-facts stratum with the new configuration (step 5.1, QA off around the window), run and
    record a new gate (5.2–5.3) before expecting auto-accepts again.

## Promotion checklist (dry_run → live)

All must hold on the day of step 7; record the numbers in the release notes.

- **Eval gate** (enforced by core; A00 §15.3): the newest gate is passed and unrevoked, for the exact
  reviewer triple above. Its thresholds: seeded recall ≥ 0.90 (95 % CI lower bound ≥ 0.85), every class
  ≥ 0.75, control false-positive rate ≤ 0.20; auto-accept precision ≥ 0.97 (CI lower bound ≥ 0.93) on
  ≥ 120 distinct would-accept cards; defect escape rate ≤ 0.20; two reps each; a new-facts stratum of
  ≥ 51 distinct would-accept cards with precision ≥ 0.97 (CI lower bound ≥ 0.93).
- **Author = the gated author** (R18D M1): the gate's author configuration id equals the `authorConfigId`
  in the runner's current run meta. If the runner's model, skill, prompt or arguments changed since the
  gate, it does not: produce a new stratum and gate first (rollout step 10), or every live draft routes
  to a person with `AUTHOR_NOT_GATED`.
- **Jury spot-check.** The authored-v2 precision labels come from a model jury only; no person labelled a
  card. The owner hand-checks about 50 jury-labelled authored-v2 cards (mixed correct and defective) and
  agrees with the jury on ≥ 0.95 of them. Below that, the gate's precision is not trusted: fix the labels
  and re-run the gate.
- **Dry run length:** at least two weeks of `dry_run` with AI QA on (step 4 onwards); days of a
  new-facts window with QA off (step 5.1) do not count.
- **Shadow agreement, blind** (R18D M3; Overview → dry-run shadow agreement; the status API's `shadow`,
  last 30 days). Only drafts a person decided **blind**, without the automation's verdict being shown
  (decide from the review queue, not from the decision drawer), count:
  `shadow.blindDecided` ≥ 100 would-accept drafts, `shadow.agreementRate` = `blindAccepted` /
  `blindDecided` ≥ 0.95 (accepted unedited), and **zero** would-accept drafts rejected for a factual
  error. The Overview reads "X of Y would-accept drafts decided blind were accepted unedited (Z%)" from
  exactly these server fields, with a second line for all human decisions (`humanDecided`, of which some
  after seeing the verdict); decisions made after seeing the verdict do not count toward the criterion.
  The digest and batch summaries show the same blind rate.
- **Human-route reasons** (Decisions tab, last two weeks): no reason you do not understand; `QA_TIMEOUT`,
  `ENQUEUE_FAILED` and QA provider errors are rare and explained.
- **Quiet health:** no `automation-step-failures`, `notifier-errors` or `notify-dlq-nonempty` alarm in the
  last week; the email volume is one batch summary per run plus real exceptions.
- **Scope:** `AUTOMATION_DECK_SLUGS` lists only the decks the gate measured; `AUTOMATION_AUTO_PUBLISH=0`
  for the first live week (step 7).

## Exception emails

Every exception email names its subkind in DETAILS (`Exception: <subkind>`) and links the console.
One line each: what it means → what to do.

- `runner_stalled` — the Mac runner sent no heartbeat within `AUTOMATION_RUNNER_STALE_MINUTES` → wake the
  Mac, `node tools/author-runner/dist/index.js status`, reinstall with `tools/author-runner/scripts/install.sh`
  if the launchd job is gone.
- `runner_login_expiring` — the runner's agent login expires soon → on the Mac,
  `node tools/mcp-server/dist/index.js login`.
- `runner_run_failed` — one authoring run failed → read the error in the Runs tab (`?tab=runs&runId=`);
  the queue item is retried up to three times on its own.
- `queue_item_failed` — a queue item failed three times and is dropped → open the URL; if the source is
  unusable, leave it; otherwise re-add it in the Queue tab after fixing the cause.
- `qa_provider_error` — the automation reviewer answered `PROVIDER_ACCESS_DENIED`, `PROVIDER_AUTH` or
  `CONFIG`; its drafts went to the review queue → check Bedrock model access and the ai-qa
  environment, then review the queued drafts by hand.
- `ai_qa_daily_cap` — the daily USD cap is reached; drafts wait for tomorrow → raise
  `AI_QA_DAILY_USD_CAP` only if the spend is expected; otherwise do nothing.
- `publish_blocked` — an auto-publish needs a person (the reason names why: a human change in the deck,
  deck settings changed, first publish, `AUTO_PUBLISH_DISABLED`, …) → check the deck's pending cards in
  the console and publish from the deck list, or leave it for the next human publish.
- `publish_failed` — the auto-publish job failed → read the job error in the deck list's publish jobs,
  fix, and publish by hand.
- `eval_gate_missing` — `AUTOMATION_MODE=live` but no current gate (none, revoked, or the newest failed),
  so the automation runs as a dry run → record a new passed gate, or set `AUTOMATION_MODE` back to
  `dry_run` so the email stops.
- `watch_failing` — a watched source failed three checks in a row → open the Watch tab
  (`?tab=watch&targetId=`); fix the URL or pattern, or deactivate the target.
- `source_gone` — a cited source page is gone → find a new source for the citing cards (Watch tab lists
  them) and edit those cards; deactivate the target.
- `live_override_high` (R18D M2) — in live, people deleted or edited more than 5 % of the cards the
  automation auto-accepted in the last 30 days (at least 20 cards; once per ISO week) → revoke the gate
  (Rollback step 1), open the Decisions tab (state `auto_accepted`) and read what people changed and why;
  restore live only with a new passed gate after the cause (source, skill, reviewer) is fixed.
- `runner_unavailable` (R18D M5) — the runner could not run at all (claude does not start, not on the
  subscription, MCP server does not start, usage or rate limit) and stopped; the claimed items went back
  to `queued` without using an attempt (once per UTC day) → read the `RUNNER_UNAVAILABLE:` error in the
  Runs tab, fix it on the Mac (log in, wait for the limit, `status`), and the next scheduled run resumes.
- `agent_note` (R18B K3) — a run finished with notes from the agent and no decisions (it drafted nothing)
  → read the notes in the Runs tab (`?tab=runs&runId=`) or the email; they usually say why nothing was
  drafted (source unsuitable, every card already exists, the deck needs a different source). Act on it:
  skip or re-queue the item, add a better URL, or adjust the deck.

Non-exception emails: a **batch summary** per run (its "NEEDS YOU" block lists the drafts routed to a
person; "Agent notes:" shows the agent's notes when present), **source changed** (cards re-checked after a
source changed; flagged cards need a person), and the Monday **weekly digest** (hours saved, decisions,
blind shadow agreement, live override rate, open human backlog).

## Reading the Automation page

Console → Automation (`/automation`); mutating controls need super_admin.

- **Overview.** The mode banner shows configured vs effective mode and `liveBlockedReason` (for example
  `EVAL_GATE_MISSING`). The eval-gate card shows the current gate and has *Revoke gate*. Also: runners
  (heartbeat age; login expiry turns red at `AUTOMATION_LOGIN_WARN_DAYS`), queue counts, decisions of the
  last 24 h by state and reason, the dry-run shadow agreement (blind, R18D M3), the live override rate
  (`autoAccepted30d`, `deletedByPerson`, `editedByPerson`, `overrideRate`; R18D M2), today's AI QA spend vs the cap (automation
  share), the open human backlog (R18B K7), watch and email summaries.
- **Runs.** One row per authoring run with counts and publish outcomes, and the agent's notes; a row
  opens its decisions.
- **Decisions.** Every automatic decision: state (`would_accept`, `auto_accepted`, `human`, `superseded`,
  …), reason, QA reviewer and finding counts. A `human` decision that a person already handled shows the
  person's action instead of "Needs human". The drawer shows the card, the QA findings and the event
  timeline, and links to the review queue for `human` drafts.
- **Queue.** Authoring queue items; add a URL for a deck, skip an item.
- **Watch.** Watched feeds and pages, their last check and failures, citing cards and recent events.
- **Email log.** Every automation email and its status; a row shows the body; send a test email.

## Rollback

From least to most drastic. Revoking the gate is instant and is the first move for anything that
auto-accepts or auto-publishes; the full emergency stop is infra/RUNBOOK.md §7.

1. **Back to dry run, instantly:** revoke the current gate (Overview → eval-gate card → *Revoke gate*, or
   `POST /api/v1/admin/automation/eval-gate/<gateId>/revoke`). No deploy; the next request is `dry_run`.
   Returning to live needs a new passed gate.
2. **Hold publishing only:** `"AUTOMATION_AUTO_PUBLISH":"0"` + deploy; auto-accept continues, every
   publish goes to a person.
3. **Narrow the scope:** shrink `AUTOMATION_DECK_SLUGS` + deploy.
4. **Stop the automation:** `"AUTOMATION_MODE":"off"` + deploy (no data change; pending drafts stay in the
   review queue).
5. **Stop the runner:** `tools/author-runner/scripts/uninstall.sh` on the Mac.
6. **Check what live already accepted** (after step 1 or 4). A rollback stops new auto-accepts; it does
   not undo old ones. Cards auto-accepted in live and not yet published are ordinary deck cards now, and
   **ship with the next human publish** (A00 §20.1). Before the next human publish, list the
   auto-accepted cards not yet published: Decisions tab, state `auto_accepted` (drawer → accepted card
   id), or the uids after "auto-accepted before rollback:" in a `publish_blocked` email. Delete any you
   do not trust (steps below); keep the rest.

**Undo a bad auto-accepted or auto-published card.**

1. Revoke the gate first (step 1 above) so nothing else is accepted or published while you work.
2. Find the card: Decisions tab (state `auto_accepted`) → drawer → accepted card id; or the batch summary.
3. Delete it in the console card list (*Delete card*, super_admin). This is a soft delete; the card's
   stable id stays reserved, so the automation will never auto-accept that card again
   (`EXISTING_CARD`).
4. If the card was published, publish the deck from the console deck list (a human publish), so the
   deck file and manifest no longer contain it. If it was accepted but not yet published, the next human
   publish leaves it out; nothing else is needed.
5. If the card was wrong, not just unwanted, treat it as a gate failure: look at its QA findings and the
   reviewer's verdict in the drawer, and do not restore `live` until a new gate (and the spot-check
   above) passes.
