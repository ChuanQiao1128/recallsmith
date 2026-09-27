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
   tick-missing alarm's actions (infra/RUNBOOK.md §7 recipe), deploy the console.
   Check: `GET /api/v1/admin/automation/status` shows `mode.effective = "off"`; the Email log's test email
   shows `sent` and the owner received it; the notifier log shows ticks answered `skipped: "off"`;
   `developercards-prod-automation-tick-missing` is `OK`.
2. **Runner (owner, on the Mac, once).** Build `tools/mcp-server` and `tools/author-runner`
   (`npm ci && npm run build` in each), `node tools/mcp-server/dist/index.js login`,
   `tools/author-runner/scripts/install.sh`, `node tools/author-runner/dist/index.js status`.
   Check: the Overview tab lists the runner after its first hourly heartbeat.
3. **dry_run.** Set `"AUTOMATION_DECK_SLUGS":"aws-saa-c03,claude-ccdv-f"` (the two decks the eval gate
   measures) and `"AUTOMATION_MODE":"dry_run"`, commit, `ENV=prod ./src_C/deploy.sh`.
   Check: status `effective = "dry_run"`; the watcher's first hour records `baseline` for both feeds (no
   queue flood); batch summaries arrive marked "(dry run)"; the digest arrives Monday 08:00 NZ. While
   `AI_QA_ENABLED="0"` every eligible draft is `human` / `QA_UNAVAILABLE`, which is expected.
4. **AI QA on (owner-gated).** After Bedrock access to the automation reviewer (GPT-5.5 through
   `bedrock-converse`) and `AI_QA_AUTOMATION_PRICE_*` are in `services/ai-qa/env/prod.env.json`: set
   `AI_QA_ENABLED="1"` in both env files, `services/deploy-python-lambda.sh ai-qa` (after `DRY_RUN=1`) and
   `ENV=prod ./src_C/deploy.sh`. Dry run now QA-checks drafts within the shared USD cap.
   Check: new decisions reach `would_accept` or `human` with a QA reason; the `ai-qa-daily-cost` alarm
   (which sums bedrock, anthropic and bedrock-converse) stays `OK`.
5. **Eval gate (owner runs, supervisor records).** A00 §15.4: the two `dc-evals run` reports (seeded-v3 and
   authored-v2, `--reps 2`), `dc-evals automation-gate`, commit the reports, then paste the gate report into
   Automation → Overview → eval-gate card (or `POST /api/v1/admin/automation/eval-gate`).
   Check: the card shows a current, passed gate whose reviewer is
   `bedrock-converse` / `global.openai.gpt-5.5` / `qa-v4-auto`.
6. **Review the dry run** for at least two weeks against the promotion checklist below.
7. **live, publish held.** Set `"AUTOMATION_AUTO_PUBLISH":"0"` and `"AUTOMATION_MODE":"live"`, deploy.
   Check: status `effective = "live"`; watch the first live batch end to end (auto-accepted card, its
   mirror AI QA run, `publish_blocked` / `AUTO_PUBLISH_DISABLED` exception, ledger rows). For the first
   week a human publishes each deck from the console after checking the new cards.
8. **live, auto-publish.** After a clean first live week (no auto-accepted card rejected or deleted by a
   person), set `"AUTOMATION_AUTO_PUBLISH":"1"`, deploy, and watch the first auto-publish end to end
   (publish job `SUCCEEDED`, `deck.published` webhook, ledger `auto_publish` row).
9. Widen `AUTOMATION_DECK_SLUGS` to another deck only after an eval gate that measured that deck.

## Promotion checklist (dry_run → live)

All must hold on the day of step 7; record the numbers in the release notes.

- **Eval gate** (enforced by core; A00 §15.3): the newest gate is passed and unrevoked, for the exact
  reviewer triple above. Its thresholds: seeded recall ≥ 0.90 (95 % CI lower bound ≥ 0.85), every class
  ≥ 0.75, control false-positive rate ≤ 0.20; auto-accept precision ≥ 0.97 (CI lower bound ≥ 0.93) on
  ≥ 120 distinct would-accept cards; defect escape rate ≤ 0.20; two reps each.
- **Jury spot-check.** The authored-v2 precision labels come from a model jury only; no person labelled a
  card. The owner hand-checks about 50 jury-labelled authored-v2 cards (mixed correct and defective) and
  agrees with the jury on ≥ 0.95 of them. Below that, the gate's precision is not trusted: fix the labels
  and re-run the gate.
- **Dry run length:** at least two weeks of `dry_run` with AI QA on (step 4 onwards).
- **Shadow agreement** (Overview → dry-run shadow agreement; the status API's `shadow`, last 30 days):
  `humanDecided` ≥ 100 would-accept drafts decided by a person **without looking at the automation's
  verdict first** (decide from the review queue, not from the decision drawer), `agreementRate` ≥ 0.95,
  and **zero** would-accept drafts rejected for a factual error.
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
- `agent_note` (R18B K3) — a run finished with notes from the agent and no decisions (it drafted nothing)
  → read the notes in the Runs tab (`?tab=runs&runId=`) or the email; they usually say why nothing was
  drafted (source unsuitable, every card already exists, the deck needs a different source). Act on it:
  skip or re-queue the item, add a better URL, or adjust the deck.

Non-exception emails: a **batch summary** per run (its "NEEDS YOU" block lists the drafts routed to a
person; "Agent notes:" shows the agent's notes when present), **source changed** (cards re-checked after a
source changed; flagged cards need a person), and the Monday **weekly digest** (hours saved, decisions,
shadow agreement, open human backlog).

## Reading the Automation page

Console → Automation (`/automation`); mutating controls need super_admin.

- **Overview.** The mode banner shows configured vs effective mode and `liveBlockedReason` (for example
  `EVAL_GATE_MISSING`). The eval-gate card shows the current gate and has *Revoke gate*. Also: runners
  (heartbeat age; login expiry turns red at `AUTOMATION_LOGIN_WARN_DAYS`), queue counts, decisions of the
  last 24 h by state and reason, the dry-run shadow agreement, today's AI QA spend vs the cap (automation
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
