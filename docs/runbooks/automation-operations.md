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
   source-watcher and notifier Lambdas (`DRY_RUN=1` first), enable the three schedules, then the
   actions of the two heartbeat alarms, tick-missing and source-watch-missing, each only once its alarm
   is `OK` after the first heartbeat (infra/RUNBOOK.md §7 recipe), deploy the console. Terraform
   ignores `actions_enabled`, so no apply turns them on. A system whose schedules are already enabled
   follows "Upgrading a running system" below instead.
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
   `openai-mantle` / `openai.gpt-5.5` / `qa-v4-auto` / effective effort `high` (or `bedrock-converse` /
   `global.openai.gpt-5.5` / `qa-v4-auto` / `provider-default` if the fallback was the provider actually
   used), and the author configuration id the runner uses now (the runner's run meta, `authorConfigId`).
   The reviewer's effective effort (`reviewer.effectiveEffort`) must equal what production ai-qa sends
   for `AI_EFFORT` in `services/ai-qa/env/prod.env.json` (`high` → `high` on `openai-mantle`; `max` is
   sent as `xhigh`; `bedrock-converse` sends none, `provider-default`): core compares it with every QA
   report's `effectiveEffort` (contract O1). Then, with ai-qa deployed at or after R18F (F02, which added
   `effectiveEffort` to the report; step 4 or "Upgrading to R18E–R18G"), open a dry-run decision made
   **after** the gate was recorded (Decisions tab, the decision's event details): it shows
   `reviewerMatchesGate: true` and `authorMatchesGate: true`. `false` there means a live auto-accept on
   the same draft would route to a person (`REVIEWER_NOT_GATED` / `AUTHOR_NOT_GATED`): fix the mismatch
   before step 7.
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
    record a new gate (5.2–5.3) before expecting auto-accepts again. The claude arguments include the
    MCP tool surface (tool names, descriptions and input schemas, lint limits and the MCP server
    version, R18E N4), so an MCP server release that changes it (R18G P3 bumped `MCP_SERVER_VERSION`)
    is an author change too.
    **Changed reviewer → new gate** (contracts N2, O1). The same holds on the reviewer side: a change of
    the automation reviewer's provider, model, prompt version or **effective effort** needs a new gate
    (5.2–5.3; the new-facts stratum stays valid while the author is unchanged). ai-qa has one
    `AI_EFFORT` for both reviewer profiles (`services/ai-qa/env/prod.env.json`), so changing it for
    human QA also changes the automation reviewer's effort: after that deploy every live draft routes to
    a person with `REVIEWER_NOT_GATED` until a gate measured at the new effort is recorded. Change
    `AI_EFFORT` only together with a new gate, or not at all while live.

## Upgrading a running system (R18D, 2026-09-28)

Production has run the automation since the R18A/B/C dry_run deploy, so its schedules are already
enabled and rollout step 1 is behind it. The round-D `developercards-prod-source-watch-missing` alarm
(R18D M6) was created by the D04 apply with its actions **disabled**, and Terraform ignores
`actions_enabled` (`infra/modules/observability/alarms_r18a.tf`, `lifecycle { ignore_changes }`), so
no apply ever turns them on. Enable them by hand, in this order; enabling them before the round-D
watcher runs pages within about three hours, because the older watcher emits no `SourceWatchRuns` and
missing data counts as breaching.

- [ ] Deploy the source-watcher with the round-D (D03) code: `DRY_RUN=1 services/deploy-python-lambda.sh
      source-watcher`, then the same without `DRY_RUN=1`.
- [ ] Wait for the next hourly `{"job":"source-watch"}` run and confirm one heartbeat datapoint:
      `aws cloudwatch get-metric-statistics --namespace DeveloperCards --metric-name SourceWatchRuns --dimensions Name=Service,Value=source-watcher --start-time <UTC now − 2 h> --end-time <UTC now> --period 3600 --statistics Sum`
      shows a `Sum` ≥ 1, or `aws cloudwatch describe-alarms --alarm-names developercards-prod-source-watch-missing --query 'MetricAlarms[0].StateValue'`
      reads `OK` (not `INSUFFICIENT_DATA` or `ALARM`).
- [ ] Enable its actions: `aws cloudwatch enable-alarm-actions --alarm-names developercards-prod-source-watch-missing`.
- [ ] Check: `aws cloudwatch describe-alarms --alarm-names developercards-prod-source-watch-missing developercards-prod-automation-tick-missing --query 'MetricAlarms[].[AlarmName,StateValue,ActionsEnabled]'`
      shows both `OK` and `true` (the tick alarm's actions were enabled with the schedules in rollout
      step 1; if not, enable them the same way once it is `OK`).

The same step is in infra/RUNBOOK.md §7, next to the tick alarm step.

## Upgrading to R18E–R18G (2026-09-28)

Rounds E–G changed the author identity, the QA report and the Mac tools. After deploying them to a
running system, in this order (the automation stays in `dry_run` throughout; switch to live only via
the promotion checklist):

- [ ] Core first: `DRY_RUN=1 ENV=prod ./src_C/deploy.sh`, then `ENV=prod ./src_C/deploy.sh` (the
      round's core and core-vpc code: the gate intake, the `effectiveEffort` match, P1 and P2).
- [ ] Then ai-qa (contract O1, R18F F02: every automation-profile report carries `effectiveEffort`):
      `DRY_RUN=1 services/deploy-python-lambda.sh ai-qa`, then the same without `DRY_RUN=1`. Deploy it
      **before** `AUTOMATION_MODE` is ever set to `live`: core fails closed on a report without the key,
      so every live draft would route to a person with `REVIEWER_NOT_GATED`.
- [ ] On the Mac, after `git pull`, rebuild both tools the hourly job runs, then check:
      `(cd tools/mcp-server && npm ci && npm run build)`,
      `(cd tools/author-runner && npm ci && npm run build)`,
      `node tools/author-runner/dist/index.js status`. Without a `tools/mcp-server/dist/tool-surface.json`
      that describes the built `dist/index.js` (R18E N4, R18F bundle hash) the runner claims nothing
      and logs `author_config_error` (tools/author-runner/README.md, "Upgrading").
- [ ] Re-produce any new-facts stratum captured before the upgrade (rollout step 5.1, QA off around the
      window). R18E put the MCP tool surface into `authorConfigId`, and R18G P3 bumped the MCP server
      version, so a stratum captured with an older runner measured an author no live draft carries;
      then run and record a new gate (5.2–5.3).
- [ ] After the gate is recorded, open a dry-run decision made after it (Decisions tab, the decision's
      event details): `reviewerMatchesGate: true` and `authorMatchesGate: true` (rollout step 5,
      Check). `reviewerMatchesGate: false` means the reviewer, its prompt version or its effective
      effort differs from the gate's (for example ai-qa not yet deployed, or `AI_EFFORT` changed);
      `authorMatchesGate: false` means the runner's `authorConfigId` differs (rebuild or re-gate).
- [ ] Queue only `http(s)` URLs (R18G P3): in an automation run the MCP server refuses a local file
      source (`SOURCE_LOCAL_NOT_ALLOWED_IN_AUTOMATION`), so such an item fails like any other run error.

## Promotion checklist (dry_run → live)

All must hold on the day of step 7; record the numbers in the release notes.

- **Eval gate** (enforced by core; A00 §15.3): the newest gate is passed and unrevoked, for the exact
  reviewer above: provider, model, prompt version **and effective effort** (rollout step 5, Check).
  Its thresholds: seeded recall ≥ 0.90 (95 % CI lower bound ≥ 0.85), every class ≥ 0.75,
  control false-positive rate ≤ 0.20; auto-accept precision ≥ 0.97 (CI lower bound ≥ 0.93) on ≥ 120
  distinct would-accept cards; defect escape rate ≤ 0.20; two reps each; a new-facts stratum of
  ≥ 51 distinct would-accept cards with precision ≥ 0.97 (CI lower bound ≥ 0.93).
- **Author = the gated author** (R18D M1): the gate's author configuration id equals the `authorConfigId`
  in the runner's current run meta. If the runner's model, skill, prompt or arguments changed since the
  gate, it does not: produce a new stratum and gate first (rollout step 10), or every live draft routes
  to a person with `AUTHOR_NOT_GATED`.
- **Reviewer effort = the gated effort** (contract O1): the gate's `reviewer.effectiveEffort` equals the
  effort production ai-qa sends for its current `AI_EFFORT` (`services/ai-qa/env/prod.env.json`). If
  `AI_EFFORT` changed since the gate (it is shared with human QA), it does not: run and record a new
  gate first (rollout step 10), or every live draft routes to a person with `REVIEWER_NOT_GATED`.
- **ai-qa deployed with O1, matches shown:** ai-qa is deployed at or after R18F (F02), and a dry-run
  decision made after the gate was recorded shows `reviewerMatchesGate: true` and
  `authorMatchesGate: true` in its event details (Decisions tab).
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
  The weekly digest shows the same blind rate; the batch summary shows no rate.
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
- `runner_stalled` (runner in error; R18G P1) — the runner's heartbeat is fresh but its state is `error`
  (a `last_error` that is not `RUNNER_UNAVAILABLE`), due queued items wait, and it started no run in the
  last 2 h: it wakes up but refuses to claim (for example `author_config_error` after a pull without a
  rebuild). One email per runner and UTC day; it names `last_error` → on the Mac, read the error
  (`node tools/author-runner/dist/index.js status`, the runner log), fix it (usually rebuild both tools,
  "Upgrading to R18E–R18G"), and check that the next hourly run claims.
- `runner_login_expiring` — the runner's agent login expires soon → on the Mac,
  `node tools/mcp-server/dist/index.js login`.
- `runner_run_failed` — one authoring run failed → read the error in the Runs tab (`?tab=runs&runId=`);
  the queue item is retried on its own (up to three attempts, one hour apart per attempt), except an
  agent block (next entry).
- `queue_item_failed` (subject "queue item N failed 3 times") — a queue item failed three times and is
  dropped → open the URL; if the source is unusable, leave it; otherwise re-add it in the Queue tab after
  fixing the cause.
- `queue_item_failed` (partial item; R18G P2) — the runner became unavailable (`RUNNER_UNAVAILABLE`)
  after the run had already submitted drafts for the item, so the item was finished `done` with only
  part of its page authored and is **not** put back in the queue (re-authoring would draft its cards
  twice). One email per item → review the submitted drafts as usual; fix the runner (see
  `runner_unavailable`), then re-add the same URL in the Queue tab so the rest of the page is authored
  (the author-cards skill checks duplicates, so the new run should not redraft the submitted cards;
  reject any duplicate it still drafts).
- `queue_item_failed` (agent blocked; subject "agent blocked on queue item N", `lastError` starting with
  `AGENT_BLOCKED`) — the agent said it could not do the item; the item failed on this first attempt and
  is **not** retried → read the reason in `lastError`, then fix the source (a better URL, a different
  deck) and re-add the item in the Queue tab, or leave it.
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
- `runner_unavailable` (R18D M5, R18E N3) — the runner could not run at all (claude does not start, not
  on the subscription, MCP server does not start, usage or rate limit) and stopped; the claimed item went
  back to `queued` without using an attempt, but not at once: it is due again after 15 min, then 30 min
  (15 min × 2^(n−1), at most 24 h, n = its consecutive `RUNNER_UNAVAILABLE` completes). At the third
  consecutive one the item is not requeued: it stops for a person with `RUNNER_UNAVAILABLE_REPEATED`
  and one exception email says so (deduped). If the run had already submitted drafts, the item is not
  put back either: it finishes `done` and the partial-item `queue_item_failed` email above says how to
  author the rest (R18G P2). For a cause a retry cannot fix (wrong provider, the MCP
  server failing, claude missing) the runner also holds itself on the Mac, like after a usage limit
  (`<log dir>/runner-state.json`, tools/author-runner/README.md), and the hold clears when the
  author configuration or the Claude CLI changes, or when you delete `<log dir>/runner-state.json`
  after fixing the cause → read the `RUNNER_UNAVAILABLE:` error in the Runs
  tab, fix it on the Mac (log in, wait for the limit, `status`); the next scheduled run resumes the
  requeued items, and a `RUNNER_UNAVAILABLE_REPEATED` item must be re-added in the Queue tab.
- `agent_note` (R18B K3) — a run finished with notes from the agent and no decisions (it drafted nothing)
  → read the notes in the Runs tab (`?tab=runs&runId=`) or the email; they usually say why nothing was
  drafted (source unsuitable, every card already exists, the deck needs a different source). Act on it:
  skip or re-queue the item, add a better URL, or adjust the deck.

Non-exception emails:

- **Batch summary**, one per run. In `dry_run` it lists no draft: "NEEDS YOU" is one count line ("N
  draft(s) of this run wait for your decision in the review queue; verdicts stay hidden until you
  decide") with a review-queue link, so a later decision stays blind (R18D M3). Its per-state counts
  appear only once none of the run's drafts is pending a human decision; until then it shows only the
  total (R18E N6). In `live` "NEEDS YOU" has one line per draft routed to a person (uid, reason,
  review-queue link) and "DONE" one line per auto-accepted card. "Agent notes:" shows the agent's notes
  when present. It shows no shadow agreement rate.
- **Source changed**: cards re-checked after a source changed; flagged cards need a person.
- The Monday **weekly digest**: hours saved, decisions, the blind shadow agreement (the same rate as the
  Overview), the live override rate (R18D M2), the open human backlog. In `dry_run` it, too, keeps a
  run's per-state counts back while any of its drafts is pending a human decision (R18E N6).

## Reading the Automation page

Console → Automation (`/automation`); mutating controls need super_admin.

- **Overview.** The mode banner shows configured vs effective mode and `liveBlockedReason` (for example
  `EVAL_GATE_MISSING`). The eval-gate card shows the current gate and has *Revoke gate*. Also: runners
  (heartbeat age; login expiry turns red at `AUTOMATION_LOGIN_WARN_DAYS`), queue counts, decisions of the
  last 24 h by state and reason (in `dry_run` a drill-down hides pending drafts' verdicts, as the
  Decisions tab does), the dry-run shadow agreement (blind, R18D M3), the live override rate
  (`autoAccepted30d`, `deletedByPerson`, `editedByPerson`, `overrideRate`; R18D M2), today's AI QA spend vs the cap (automation
  share), the open human backlog (R18B K7), watch and email summaries.
- **Runs.** One row per authoring run with counts and publish outcomes, and the agent's notes; a row
  opens its decisions. In `dry_run` a run's split by state shows only once none of its drafts is
  pending a human decision (R18E N5).
- **Decisions.** Every automatic decision: state (`would_accept`, `auto_accepted`, `human`, `superseded`,
  …), reason, QA reviewer and finding counts. A `human` decision that a person already handled shows the
  person's action instead of "Needs human". The drawer shows the card, the QA findings and the event
  timeline, and links to the review queue for `human` drafts. **Blind in `dry_run`** (R18E N5): while the
  effective mode is `dry_run`, every draft still pending a human decision hides its state, reason, QA
  counts and decide links here, in the run sections and in the Overview drill-downs, as the review
  queue does. Revealing one (or filtering by a verdict) is recorded in the browser, so a later decision
  on that draft, from any tab of the same browser, is sent as not blind (`verdictShown: true`) and does
  not count toward the blind shadow agreement. Decide from the review queue without revealing to keep
  a decision blind.
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
4. **Stop the automation:** `"AUTOMATION_MODE":"off"` + deploy (nothing is deleted or undone: pending
   drafts stay in the review queue, and cards live already auto-accepted stay in their decks, see step 6).
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

## Card reports (R20 V05)

Learners report a problem with a card from the mobile app; the reports wait for a person in the console.
Nothing here calls a model unless the triage flag below is on *and* AI QA is on, and even then only the card
goes to the reviewer, never the learner's note.

**Deploy order.** Code first, then `POST /api/v1/admin/db/migrate` (applies `037_card_reports.sql`, which
also lets webhook subscriptions pick `card.reported`). Until the migration runs every card report route
answers `503 NOT_READY` ("Run the database migration") and the status/digest counts read zero. The R20X fix
round adds `041_card_reports_question.sql` (one nullable `question` column); between the code deploy and that
migration the learner routes also answer `503 NOT_READY`.

**What a learner can report.** Only a card they can see: a live deck (not `coming` or `retired`) that is free, or
premium with an active entitlement in `user_premium_state` (the premium download rule). Anything else answers the
same `404 CARD_NOT_FOUND` as an unknown card. *My reports* shows the question as it was when the report was created
(first 200 characters), never later edits of the card; reports created before 041 show `question: null`.

**Switches** (`src_C/env/prod.env.json`, read on every request, deploy to change):

| Key | Default | Effect |
|---|---|---|
| `CARD_REPORTS_ENABLED` | `"1"` | `"0"` makes both learner routes answer `503 CARD_REPORTS_DISABLED`. The console routes keep working so the backlog can still be triaged. |
| `CARD_REPORT_DAILY_LIMIT` | `"5"` | New reports per learner per UTC day; the next one is `429 REPORT_DAILY_LIMIT`. Re-reporting a card that already has an open report by the same learner returns that report (`duplicate: true`) and does not count. |
| `CARD_REPORT_AI_TRIAGE` | `"0"` | `"1"` starts a one-card AI QA re-check (`scope=cards`, `requested_by_sub = card_report`) for every new signed-in report. With `AI_QA_ENABLED=0` it does nothing and records nothing. Anonymous reports never start one. |
| `CARD_REPORT_ANON_DAILY_CAP` | unset = `100` | New anonymous reports per UTC day across all callers; the next one is `429 REPORT_DAILY_CAP` (one `card_report_anon_daily_cap` warn line per container per hour). `"0"` turns the anonymous route off (`503 CARD_REPORTS_DISABLED`) and leaves the signed-in route alone. `CARD_REPORTS_ENABLED=0` turns both off. |

The mobile report button has its own flag (`features.cardReport.enabled`, default off); the server switch
does not turn it on. A signed-out learner sees the form only with `features.cardReport.anonymous: true` as well
(default off; without it the sheet says "Sign in to report a problem").

**Anonymous reports (R28 ANONREPORT, user-perspective review U2).** A learner who is not signed in reports through
`POST /api/v1/public/card-reports` (exact gateway route, no authorizer, burst 5 / rate 2; core-vpc never reads a bearer
for it). The body is `{ "deckSlug", "stableUid", "reason", "appVersion" }` and nothing else: any other key, a note
included, is `400 VALIDATION_ERROR`, so free text cannot arrive by mistake. The app posts it without a token, a trace
header or a Sentry header (the funnel's transport). Limits: body at most 1 KB (`413`), 30 requests per minute per
container (`429 RATE_LIMITED`, `Retry-After: 60`), one report per card, reason and UTC day (a repeat answers the same
`202 {"received": true}` as a new report and stores and emits nothing), and the daily cap above. Only a card of a live
free deck (`404 CARD_NOT_FOUND` otherwise). The row is an ordinary `card_reports` row with `user_sub` and `note` null
(`client_version` = the app version, `question` captured as for any report), so it is in the console list (marked
"Not signed in"; `anonymous: true` in the API), in `automation/status`, in the digest line and in the `card.reported`
webhook, and it is resolved the same way. Nobody can see it in *My reports* and account deletion never touches it
(there is no account). Nothing identifies the sender: no account, device or install id, no IP in the table; the
gateway access log keeps the source IP for 30 days for every route, this one included (as for the funnel,
docs/privacy-anonymous-funnel-2026-10-02.md §6).

Deploy order: code first, then `POST /api/v1/admin/db/migrate` (applies `046_card_reports_anonymous.sql`: `user_sub`
nullable, a no-note check for anonymous rows, the per-day unique index; the migrate stops before 045 unless it carries
`confirmDestructive=45`, so run 045 first if it is still pending). Until 046 runs the anonymous route answers `503
NOT_READY` and nothing else changes. The gateway route comes from the Terraform pipeline
(docs/delivery/r28-issues/ANONREPORT.plan-allow.json); without it the path falls to the console-JWT catch-all and the
app gets 401. Turn on `features.cardReport.anonymous` after all three.

**Triage.** `GET /api/v1/admin/card-reports?status=open|resolved|all&deckId=&limit=&cursor=` lists the reports
of the decks the admin may read (super_admin: all), newest first, with the learner's note. It never returns a
user sub or an email. `POST /api/v1/admin/card-reports/<reportId>/resolve` with
`{"resolution":"fixed|wont_fix|duplicate|invalid","note":"..."}` needs deck write; a second resolve is
`409 ALREADY_RESOLVED`. The learner sees the resolution and its note in *My reports*.

**Watching.** `GET /api/v1/admin/automation/status` → `cardReports: {open, openedLast7d}`; the Monday digest
has a line `Card reports: N open (M new this week)`. Both count anonymous reports too. There is no per-report email. Subscribe a webhook to
`card.reported` (`{reportId, deckSlug, stableUid, reason, createdAt}`, no note, no user) for a chat ping.

**The note is untrusted text.** It is capped at 500 characters, stored as is, shown only to console admins
with deck read, and never logged. Treat it like any other learner input: do not paste it into a prompt or a
shell.

## Card embeddings and semantic duplicates (R20 V06)

Semantic similarity uses vectors computed on the owner's Mac (`BAAI/bge-small-en-v1.5`, 384 dims, cosine) and
pushed to the server. The server never calls a model. Everything here needs the PostgreSQL `vector` extension
(pgvector); until it is installed, the routes below answer `503 VECTOR_NOT_READY`, the status route reports
`engine: "none"`, and `POST /api/v1/authoring/cards/similar` keeps its trigram engine.

**Why an owner step.** pgvector is not a trusted extension: only a superuser (on RDS, the master user through
`rds_superuser`) can create it. Migration `038_card_embeddings.sql` tries to create it only when the migrating role
holds CREATE on the database, and turns every refusal into a NOTICE ("vector not installed ..."): no CREATE (the
prod app role), CREATE but not a superuser (a role that owns its database, such as the staging app role:
`insufficient_privilege`), or an extension the server does not allow or ship (`feature_not_supported`,
`undefined_file`). In each case 038 records itself as applied without `card_embeddings`, and 039 and 040 still
apply after it (R20X F02).

**Turning it on (owner, once):**

1. As the RDS master user: `CREATE EXTENSION IF NOT EXISTS vector;` in the app database.
2. `POST /api/v1/admin/db/migrate` through `scripts/invoke-as-admin.sh` (press Migrate). Every migrate call, also
   one with nothing pending, re-runs the guarded `card_embeddings` block of 038 (`Migrate.EnsureVectorObjectsSql`),
   so the table appears, owned by the app role. No `schema_migrations` row has to be deleted. The response carries
   `vectorReady: true` once the extension and the table exist (`false` while the extension is missing).
3. Readiness is cached for 5 minutes per Lambda container (the migrate call clears it in its own container).
   `GET /api/v1/admin/card-embeddings/status` shows `engine: "vector"` once it has expired.
4. Push the vectors: `dc-evals embed-cards --deck <slug> --push`, with a super_admin console token in the environment.

**Routes:**

| Route | Who | What |
|---|---|---|
| `PUT /api/v1/admin/card-embeddings` | super_admin | `{model, dim:384, items:[{deckSlug, stableUid, textSha256, embedding}]}`, 1..100 items → `{upserted, unknownCards, staleText}`. The server recomputes each card's `textSha256` from `question.Trim() + "\n\n" + explanation.Trim()`. An item whose hash differs (the card changed after it was embedded) is not stored and is listed in `staleText`. Re-embed those cards. |
| `GET /api/v1/admin/card-embeddings/status?deckId=` | admin (deck read) | `{engine, model, cards, embedded, stale}`. `stale` counts stored vectors whose card text changed since. |
| `GET /api/v1/admin/decks/<deckId>/semantic-duplicates?minCosine=0.90&limit=50` | admin + deck read | Pairs of live cards with cosine ≥ minCosine, each pair once, highest first. |
| `POST /api/v1/authoring/cards/similar` + `embedding` | admin | Engine `vector` (cosine, `likelyDuplicate` at ≥ 0.90) when the store is ready; otherwise the trigram answer is unchanged. |

**Body size.** The API rejects bodies over 1 MiB (`413`). A 384-number vector printed at full float precision is
about 8.5 KB, so 200 items (about 1.7 MB) never fit; the route therefore accepts at most 100 items (contract
R20-00 §10.1), and a 100-item full-precision batch fits (about 0.85 MB, covered by a test). A body that is not JSON
(for example a bare `NaN` from Python's `json.dumps`) answers `400 VALIDATION_ERROR`, like any other invalid item.

**Rollback.** The table only adds data. To stop using it, stop pushing vectors. To remove it, the master can run
`DROP TABLE card_embeddings;`, and the routes return `503 VECTOR_NOT_READY` once the 5-minute cache expires. Do not
drop the extension while the table exists.

## Change impact of the source watch (R20 V07)

The source watch now says which cards a change touches. Everything here is deterministic (SQL only), works with
`AI_QA_ENABLED=0`, and never edits a card: the output is a list for a person to check.

**Deploy order.** Code first, then `POST /api/v1/admin/db/migrate` (applies `039_source_watch_impact.sql`, one
additive `possibly_affected_cards jsonb` column on `source_watch_feed_items`). Before the migration the page
impact below already works (it lives in the event's `details` jsonb); the release-notes analysis is skipped with
an `impact_not_migrated` log line, the watch route answers `recentFeedItems: []` and the digest counts zero.

**Changed or gone page.** Each `changed`/`gone` event stores `details.affectedCards`: the live cards (card and
deck not deleted) whose `source.url` is exactly the page URL, by card id, at most 200, each with
`quoteMissing` when the watcher could not find its quote. `details.needsHumanReview` becomes `true` when such
cards exist and the AI QA re-check is unavailable (AI QA off, or the re-check was given up). The
`source_changed` email then lists up to 20 of them under NEEDS YOU with a console editor link
(`<CONSOLE_BASE_URL>/decks/cards/edit?deckId=<id>&cardId=<id>`); when a re-check ran they are listed under
DETAILS instead. A URL that differs in any character (query string, trailing slash) is a different page.

**New release-notes item.** For each new item matching a feed's title pattern (not the first, baseline
observation), core runs PostgreSQL full-text search over the live cards of the feed's deck (all decks when the
feed has none): `to_tsvector('english', question || ' ' || explanation)` against the item's title (plus its
`summary`, when the watcher sends one), the terms OR-ed, ranked with `ts_rank_cd`. The top 5 with rank ≥ 0.2
are stored. Each occurrence of a query word in a card is worth 0.1, so 0.2 means at least two hits; a single
shared word such as "Amazon" does not qualify. The Monday digest lists the week's items that have possibly
affected cards (one line each, with ranks and editor links) and a NEEDS YOU line with their count.

**Where to look.** `GET /api/v1/admin/automation/watch`: each `recentEvents[]` entry has `affectedCards` and
`needsHumanReview`; `recentFeedItems` holds the latest 20 analysed items with `possiblyAffectedCards`. The cards
are deck-scoped: an admin who is not super_admin sees only the cards of decks they may read (also inside
`details.affectedCards`); the events and items themselves are listed for every admin (R20X F02).
`GET /api/v1/admin/automation/status` → `watch.needsReview`: changed/gone events of the last 30 days flagged for
a human review. The flag is informational; nothing clears it, so the 30-day window keeps the count current. An
event older than 30 days drops out of the count whether or not someone checked its cards, and fixing the cards
does not lower it: look at the watch route's events, not only the count (contract §10.4).

**Title only in production.** The current source watcher (`services/source-watcher`) reports feed items as
`{url, title, publishedAt}`, without a `summary`, so the full-text query is the item title alone. A card then
needs two title-word hits to be listed.

**Rollback.** Revert the code; the column and the extra `details` keys are ignored by older code.

## Usage analytics and freshness (R20 V08)

Three read-only numbers for the console, all SQL, all UTC. Definitions are in
`docs/delivery/r20-issues/V08-notes.md`.

**Deploy order.** Code first, then `POST /api/v1/admin/db/migrate` (applies `040_usage_analytics.sql`: additive
columns on `analytics_daily` and `analytics_deck_daily`). Before the migration the tick step `analytics_daily`
logs `analytics_not_migrated` and skips (the tick reports no failed step) and
`GET /api/v1/admin/analytics/usage` answers `503 NOT_READY`.

**Usage.** The tick step `analytics_daily` runs on the first tick of each UTC day while the mode is not `off`
and recomputes the 8 complete days before today from `user_progress_events` (reviews only). Rerunning is safe.
`GET /api/v1/admin/analytics/usage?days=30` returns the stored days (DAU/WAU/MAU, reviews, new users, cards
learned, D1/D7 retention) and per-deck numbers for the last 30 days (`decks[]`: every deck for a super_admin, only
the decks the caller may read for anyone else; `days[]` is site-wide). To keep test devices out, list their learner
subs in `ANALYTICS_EXCLUDED_SUBS` (comma-separated) in `src_C/env/prod.env.json` and redeploy; the next day's run
recomputes the window without them. The route reports only how many subs are excluded, never which.
With `AUTOMATION_MODE=off` the tick returns early and nothing is recomputed; the stored rows stay readable.
The step is the last one of the tick and reads the whole review history, so it is bounded (R20X F02, contract
§10.8): it is skipped with an `analytics_deferred` log line when less than half of the tick's 20 s budget is left
(the next tick runs it), each of its statements runs under `set local statement_timeout = 3000` (3 s), and after a
failure (for example `57014` statement timeout, counted once in `AutomationStepFailures`) the same Lambda container
logs `analytics_backoff` and does not retry until the next UTC day. A new container may try once more.

**Freshness.** `GET /api/v1/admin/automation/freshness?days=30` lists each changed/gone page and each matched
release-notes item with the time it was detected, queued, drafted, decided and published, plus the median
minutes to each stage. A null stage means the chain stopped there (not queued, no run, no decision yet, not
published). `automation/status` → `freshness.medianMinutesToPublish` and `n` (items that reached a publish).

**Measured baselines.** `GET /api/v1/admin/automation/baselines` → `ai_draft_review.suggestedMeasuredMinutes`
is the median console review time once at least 5 decisions recorded one (`suggestedFromN`). It is only a
suggestion: adopt it with the existing super_admin PUT and `baselineSource: "measured"`.

**Rollback.** Revert the code; the new columns are nullable and ignored by older code.
