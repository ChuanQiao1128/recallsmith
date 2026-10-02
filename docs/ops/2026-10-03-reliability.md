# 自动化可靠性报告：2026-09-03 至 2026-10-02（UTC）（核查修订版）

账号 622994489535，区域 ap-southeast-2，`AWS_PROFILE=dev`。核查时只用了只读命令。核查时 `date -u` 的结果是 `Fri Oct 2 20:26:00 UTC 2026`。

## 0. 结论

- **窗口说明：** 名义窗口是 30 天，但这些自动化真正启用的时间很短。
  - tick、digest、source-watch 从 2026-09-27T14:28:01–04Z 起启用，到截止时间约 5.23 天（5 天 5 小时 32 分）[C4]。
  - synthetic-check 从 2026-09-29T00:49:51Z 起启用，约 3.80 天（3 天 19 小时 10 分）[C4]。
- **调度任务：**
  - 启用期间 EventBridge Scheduler 一共投递了 **995** 次 [C12]，没有一个时段漏跑。
  - Lambda Errors 为 0，Throttles 为 0 [C5]。
  - Scheduler 的 TargetErrorCount、InvocationDroppedCount、InvocationThrottleCount、TargetErrorThrottledCount 都没有数据点 [C12]。
- **探测：** synthetic 探测 **367/367** 次全部通过，每次跑 5 项检查 [C11][C14]。这 367 次里有 365 次是定时触发，另外 2 次是部署时的手动调用。
- **队列任务：**
  - 一共 **20** 条消息：publish 13 条，notify 7 条。Sent、Received、Deleted 三个数相等 [C18]。
  - 4 个 DLQ 的消息数从建队到现在一直是 0 [C18][C19]。
- **ai-qa 和 webhook-dispatcher：** 窗口内没有调用数据点 [C5]，所以没有数据能说明它们是否可靠。
- **自动化当时主要是演练（已修正，原文说"没有执行真正的自动化动作"，这个说法不准确）：**
  - automation tick 的 core 端全程是 `effectiveMode=dry_run`。只有 1 次是 `off`，即启用后的第一次。
  - 不过有两类动作是真实执行的：
    1. **summaries=2 和 alerts=3 发出了 5 封真实邮件。** 它们是 notify 队列 7 封邮件里的 2 封 `batch_summary` 和 3 封 `exception` [C7][C9]。
    2. **RevenueCat 删除步骤不受 dry_run 控制。** notifier v7（2026-10-02T07:43:13Z 部署）之后，每次 tick 都会执行这一步（`services/notifier/src/notifier/handler.py:356-362,378-380`）。截止前一共跑了 51 次，`outcome=done` 51 次，`deleted=0`，`not_found=5`，`failed=0` [C26]。

**数据截止时间：** 统一截到 **2026-10-02T20:00:00Z**。

- 原文引用的 `date -u` 输出是 `Fri Oct 2 20:11:21 UTC 2026`。那次输出本身**未能确认**，因为它是以前的终端输出。
- 本次核查时 `date -u` 显示 `Fri Oct 2 20:26:00 UTC 2026`，可以确认当时 10-03 UTC 还没到。

---

## 1. 资源清单（真实名称）

| 角色 | Lambda | 触发方式 | 证据 |
|---|---|---|---|
| automation tick | `developercards-notifier:prod` | schedule `developercards-automation-tick`，`rate(15 minutes)`，Input `{"job":"tick"}`，RetryPolicy 最多重试 2 次 | [C2][C3] |
| automation digest | `developercards-notifier:prod`（和 tick 是同一个函数） | schedule `developercards-automation-digest`，`cron(0 8 ? * MON *)`，Pacific/Auckland 时区，Input `{"job":"digest"}`，最多重试 2 次 | [C2][C3] |
| source watch | `developercards-source-watcher:prod` | schedule `developercards-source-watch`，`rate(1 hour)`，Input `{"job":"source-watch"}`，重试 0 次 | [C2][C3] |
| synthetic check | `developercards-synthetic-check:prod` | schedule `developercards-synthetic-check`，`rate(15 minutes)`，Input `{"job":"synthetic-check"}`，重试 0 次 | [C2][C3] |
| notifier（队列） | `developercards-notifier:prod` | SQS `developercards-notify`，batch 1，MaximumConcurrency 2 | [C2] |
| worker publish | `worker-lambda:prod` | SQS `recallsmith-publish-jobs`，batch 1，MaximumConcurrency 2 | [C2] |
| webhook dispatcher | `developercards-webhook-dispatcher:prod` | SQS `developercards-webhook-events`，batch 1 | [C2] |
| ai-qa | `developercards-ai-qa:prod` | SQS `developercards-ai-qa-jobs`，batch 1 | [C2] |

- tick、digest 和 notify 队列共用 `developercards-notifier`，所以下面按日志里的 `event`/`job` 字段把三者拆开统计。
- 这些 schedule 在 Terraform 里都以 `state = "DISABLED"` 创建，并且 `ignore_changes = [state]`。位置是 `infra/modules/worker/automation.tf:151-210` 和 `infra/modules/worker/synthetic.tf:51-69`（原文写 51-72，已修正；schedule 块到第 69 行结束）。
- **提交引用（已修正）：** 引入这些 schedule 的提交只有两个。
  - `fdc3154`（A10，2026-09-28 00:59:57 +1300）引入了 source-watch、tick 和 digest。
  - `64e442a`（H05，2026-09-29 13:23:05 +1300）引入了 synthetic-check。
  - `6e4f827`（B04）**没有引入 schedule**。它在 automation.tf 里加的是 `aws_lambda_function_event_invoke_config`（异步重试改为 0，把 maximum_event_age 设为 900），并把 reserved concurrency 改为 4（`git show 6e4f827 -- infra/modules/worker/automation.tf`）。

## 2. 每个 schedule 的启用时间（CloudTrail）

证据：[C4] `aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=CreateSchedule|UpdateSchedule|DeleteSchedule`，查询范围 09-01 到 10-04。

| schedule | CreateSchedule（以 DISABLED 创建） | UpdateSchedule 改为 ENABLED | 之后是否被关闭 | 截至截止时间启用了多久 |
|---|---|---|---|---|
| developercards-source-watch | 2026-09-27T12:07:34Z | **2026-09-27T14:28:01Z** | 没有 | 约 5 天 5.5 小时 |
| developercards-automation-tick | 2026-09-27T12:07:40Z | **2026-09-27T14:28:03Z** | 没有 | 约 5 天 5.5 小时 |
| developercards-automation-digest | 2026-09-27T12:07:40Z | **2026-09-27T14:28:04Z** | 没有 | 约 5 天 5.5 小时 |
| developercards-synthetic-check | 2026-09-29T00:26:24Z | **2026-09-29T00:49:51Z** | 没有 | 约 3 天 19.2 小时 |

- 上面这些事件都由 `arn:aws:iam::622994489535:user/devcards-admin` 发起。`get-schedule` 返回的 CreationDate 和 LastModificationDate 是 +13:00 时区，换算成 UTC 后和上表一致 [C3]。
- 窗口内没有任何 DeleteSchedule 事件，也没有改回 DISABLED 的 UpdateSchedule 事件 [C4]。
- 另有一个 `RunNewsPipelineDaily`，目标是 `generateArticleAudio`，状态 DISABLED。它是别的项目，不在本报告范围内 [C2]。

## 3. 调度任务：按"应跑次数和实跑次数"算可靠性

计算方法：应跑次数按启用后第一次实际触发的时间加上调度周期推算，再和日志里的成功事件数、Scheduler 的投递次数对账。

| 任务 | 启用期间应跑 | Scheduler 实投 | 成功 | 失败 | 成功率（只算启用期间） | 相邻两次的最大间隔 | 证据 |
|---|---|---|---|---|---|---|---|
| automation tick | 503 次（09-27 14:28:46Z 到 10-02 19:58:44Z，每 15 分钟一次） | 503 | 503（`tick_ok`） | 0（没有 `tick_failed` 或 `tick_steps_failed` 事件，`failedSteps` 全部为空） | **100%** | 15.08 分钟 | [C7][C8][C9] |
| automation digest | 1 次（2026-09-27T19:00Z，即新西兰时间 2026-09-28 周一 08:00 NZDT） | 1 | 1 | 0 | **100%** | 不适用 | [C7][C13] |
| source watch | 126 次（REPORT 时间 09-27 14:28:47Z 到 10-02 19:28:47Z，每小时一次） | 126 | 126（Lambda Errors 为 0） | 0 | **100%** | 61.14 分钟（按 REPORT 时间算；10-01 05:29 那一轮跑了 70 s，所以间隔被拉长） | [C6][C10] |
| synthetic check | 365 次（REPORT 时间 2026-09-29T00:50:32Z 到 10-02 19:50:13Z） | 365 | 365 | 0 | **100%** | 15.03 分钟 | [C6][C11] |
| **合计** | **995** | **995** | **995** | **0** | **100%** | | [C12] |

**和 Scheduler 指标对账。** `AWS/Scheduler InvocationAttemptCount` 在 09-03 到 10-02T20:00Z 的合计是 **995**，带维度 ScheduleGroup=default 和不带维度两种查法结果相同。995 等于 503 + 1 + 126 + 365。TargetErrorCount、InvocationDroppedCount、InvocationThrottleCount 和 TargetErrorThrottledCount 在这段时间都没有数据点 [C12]。

**有些调用不是 Scheduler 触发的，已从上表剔除：**

- **notifier：**
  - 2026-10-02 出现了两次 tick，两个 requestId 不同：
    - 第一次 START 07:43:32.433，requestId `c6b99045-…`，冷启动，tick_ok 时间 07:43:35.325。
    - 第二次 START 07:43:39.423，requestId `916abf60-…-4ed5-bfab-1c77fe99491b`。
  - Scheduler 在 07:43 那一分钟只投递了 1 次 [C13]，所以其中一次不是 Scheduler 触发的。
  - 补充一条推断：Scheduler 触发的调用，requestId 的后缀看起来是固定的。07:58 那次定时 tick 的 requestId 是 `916abf64-…-4ed5-bfab-1c77fe99491b`，后缀和第二次相同。所以非 Scheduler 的那次应该是 07:43:32 的 `c6b99045`，即部署 v7（`LastModified` 07:43:13Z）后的冷启动调用 [C8][C15]。
  - 具体是谁触发的，**未能确认**：CloudTrail 的 lookup-events 不包含 Lambda Invoke 这种数据事件。
- **synthetic-check：**
  - 2026-09-29 00:49:49Z 那次（START 00:49:49.019，requestId `80629b65…`）早于 ENABLED 事件（00:49:51Z）。
  - 04:50:41Z 那次是 `synthetic-skip`，输入不是 job 事件。
  - 04:50:52Z 那次和正点的 04:50:14Z（REPORT 时间）在同一分钟，而 Scheduler 那一分钟只投递了 1 次。
  - 365 次定时调用的 requestId 后缀都是 `-43cc-9ec2-709401390d94`，上面三次都不是这个后缀 [C11]。
  - 这三次都和部署时间吻合：v2 的 LastModified 是 00:49:06Z，v3 是 04:50:17Z。应该是部署后的冒烟调用 [C11][C13][C15]。

**tick 实际做了什么：**

- 504 个 tick 事件里，`effectiveMode=dry_run` 有 503 个，`effectiveMode=off, skipped=off` 有 1 个，就是启用后第一次（14:28:46Z）。这 504 个事件包含 10-02 07:43 那次非 Scheduler 调用 [C7]。
- 各项 actions 的合计中只有 `summaries=2` 和 `alerts=3` 不为 0，其余全是 0 [C9]。它们的时间是：
  - alerts=1：09-29 19:43:44Z、09-30 00:13:44Z、10-01 00:13:44Z。
  - summaries=2：10-01 04:28:44Z。
  - 这几次分别对应 notify 队列里 3 封 `exception` 邮件和 2 封 `batch_summary` 邮件 [C7]。所以 dry_run 期间**确实发出了真实的告警邮件和汇总邮件**。
- **（新增）RevenueCat 删除步骤：**
  - notifier v7 加了 `_revenuecat_step`（`handler.py:356-362`）。tick 跑完后一定会执行它，不看 core 返回的 mode（`handler.py:378-380`）。
  - 10-02 07:43:35Z 到 19:58:44Z 共 51 次，`deleted=0`，`not_found=5`，`failed=0`，`pending` 最大为 2 [C26]。
  - 其中 08:13、08:28、08:43 三次分别出现 pending 2、2、1 和 not_found 2、2、1。代码注释说 core 收到 404 后会删除对应行。为什么连续 3 次 tick 仍有待处理项，**未能确认**：可能是新入队的删除，也可能是上报后没有删掉。
- 这说明 tick 主要证明的是**调度链路**可靠（Scheduler、Lambda、core 的 `/api/internal/automation/tick`），**不是**真实自动化动作的可靠性。
- core 端的 tick 路由：`DeveloperCards Latency`（Service=core-vpc，Method=POST，Route=`/api/internal/automation/tick`）的 SampleCount 是 505（504 次 tick 加 1 次 digest），p95 3152.8 ms，最大 6622.05 ms，Errors 合计 0 [C14]。

**source-watch 的细节：**

- 126 次运行里，104 次是 `nothing_to_watch`，只有 22 次真的检查了目标（`count_distinct(watchRunId)=22`）[C10]。
- 一共 262 次目标检查（`observe_start` 262 条，`observation` 262 条）：`status=ok` 260 次，`failed` 2 次。
- 这 2 次失败都是 `platform.claude.com` 返回 `errorCode=TIMEOUT`，latencyMs 分别是 10045 和 10043，时间是 2026-10-01T05:29:19Z 和 05:29:33Z，属于同一个 watchRunId `7d3ff0c3…`，targetId 分别是 45 和 47。函数本身没有报错，按设计逐个目标隔离失败 [C10]。
- 和 EMF 对账：`SourceWatchChecks` 的 Outcome=ok 是 260，Outcome=failed 是 2 [C14]。

## 4. 每个 Lambda 的指标（09-03 到 10-02T20:00Z）

证据：[C5] `aws cloudwatch get-metric-data`，namespace `AWS/Lambda`，维度 FunctionName，Period 2577600。超时配置来自 [C15] `lambda get-function-configuration --qualifier prod`。

| 函数 | 调用次数 | Errors | Throttles | 成功率 | 平均时长 | p95 | 最大时长（发生时间） | 超时设置 | 最大并发 |
|---|---|---|---|---|---|---|---|---|---|
| developercards-notifier | 512（504 tick + 1 digest + 7 SQS）[C7] | 0 | 0 | 100% | 5075.1 ms | 7578.0 ms | 11252.75 ms（2026-09-27T19:00:14.698Z，digest）[C16] | 60 s | 3 |
| developercards-source-watcher | 126 | 0 | 0 | 100% | 4103.1 ms | 10061.7 ms | 70016.7 ms（REPORT 时间 2026-10-01T05:29:55.898Z，就是两次 TIMEOUT 的那一轮）[C10] | 300 s | 1 |
| developercards-synthetic-check | 368（365 次定时 + 2 次手动 + 1 次 skip） | 0 | 0 | 100% | 2064.4 ms | 2603.7 ms | 2733.7 ms | 60 s | 1 |
| worker-lambda（publish） | 13 | 0 | 0 | 100% | 3512.0 ms | 4457.6 ms | 4584.18 ms | 615 s | 2 |
| developercards-webhook-dispatcher | 0（没有数据点） | 无数据点 | 无数据点 | 无法计算 | 无 | 无 | 无 | 30 s | 无 |
| developercards-ai-qa | 0（没有数据点） | 无数据点 | 无数据点 | 无法计算 | 无 | 无 | 无 | 600 s | 无 |

- notifier 的 p95 7578.0 ms 来自 CloudWatch 指标。用 Logs Insights 的 `pct(@duration,95)` 算出来是 7536.7 ms，两者计算方法不同。
- **worker-lambda 的应用层结果：**
  - 日志里有 13 条 `Processing message`、13 条 `Job completed successfully`、13 条 `Processing completed successfully`。正则 `(?i)(fail|error|exception)` 匹配 0 条 [C17]。
  - 13 次调用分布在 09-16（2 次）、09-21（5 次）、09-26（2 次）和 10-01（4 次）[C5 每日][C17]。
  - **（新增）** 原文的正则漏掉了 7 条 `⚠️ WARNING: MANIFEST_QUEUE_URL is not set. Skipping manifest rebuild event.`。它们出现在 09-16（10:31:42Z、15:19:11Z）和 09-21（03:17:44Z、03:17:45Z、10:54:12Z、11:01:57Z、18:33:18Z）。也就是说，13 个 publish 任务里有 7 个跳过了 manifest rebuild 事件 [C17]。09-26 和 10-01 的 6 次调用没有这条警告。这些任务的应用层结果是"成功"，但 manifest 下游有没有因此漏更新，**未能确认**。
- **notifier 的 7 条 SQS 投递：** 都是 `notification_sent`。按时间顺序，kind 分别是：
  - test：09-27 14:29Z
  - weekly_digest：09-27 19:00Z
  - exception×3：09-29 19:43Z、09-30 00:13Z、10-01 00:13Z
  - batch_summary×2：10-01 04:28Z

  按小时看，它们和 `developercards-notify` 的 Sent、Received、Deleted 完全一致 [C7][C18]。
- **（新增）** notifier 日志里还有 51 条 `revenuecat_delete` 事件，全部在 10-02，是 v7 新增的那一步（见第 3 节）[C26]。
- **Errors 为 0 不等于探测通过：** synthetic-check 的 handler 会捕获检查过程中的异常，然后照常写 EMF 和日志（`services/synthetic-check/src/synthetic_check/handler.py:20-37`）。`emf.run_line` 的注释写着 "Never raises"（`emf.py:20`）。所以它的 Errors=0 不能说明探测通过，探测结果要看第 6 节的 EMF 指标。

## 5. SQS 和 DLQ

证据：[C18] `get-metric-data`，namespace `AWS/SQS`，Period 3600，Maximum/Sum，09-03 到 10-03。[C19] `sqs get-queue-attributes`。

| 队列 | 创建时间 | 每小时最大可见消息数（期间最大值） | 最大值出现时间 | 当前可见 | Sent / Received / Deleted | 最老消息年龄最大值 |
|---|---|---|---|---|---|---|
| developercards-notify-dlq | 2026-09-27T12:07:09Z | **0** | 不适用（从未大于 0） | 0 | 0/0/0 | 0 |
| developercards-publish-jobs-dlq | 2026-09-22T11:25:07Z | **0** | 不适用 | 0 | 0/0/0 | 0 |
| developercards-webhook-events-dlq | 2026-09-27T04:22:01Z | **0** | 不适用 | 0 | 0/0/0 | 0 |
| developercards-ai-qa-jobs-dlq | 2026-09-27T04:42:32Z | **0** | 不适用 | 0 | 0/0/0 | 0 |
| developercards-notify（源队列） | 2026-09-27T12:07:35Z | 0 | 不适用 | 0 | 7/7/7 | 0 |
| recallsmith-publish-jobs（源队列） | 2026-03-31T00:15:19Z | 0 | 不适用 | 0 | 13/13/13 | 0 |
| developercards-webhook-events（源队列） | 2026-09-27T04:22:27Z | 0 | 不适用 | 0 | 0/0/0 | 0 |
| developercards-ai-qa-jobs（源队列） | 2026-09-27T04:42:58Z | 0 | 不适用 | 0 | 0/0/0 | 0 |

- **重驱策略：** notify 和 webhook 的 maxReceiveCount 是 5，publish 和 ai-qa 是 3 [C19]。源队列的 Received 等于 Sent，说明每条消息只被接收了一次，从来没有重试，更没有进入 DLQ。
- **DLQ 指标有空档：**
  - DLQ 的小时数据点只有 54 到 97 个，因为 SQS 不会给闲置队列发布指标。本次查询截到 10-03T00:00Z，比原文多了一个小时，所以比原文的"53 到 96"各多 1 个。
  - DLQ 的保留期是 1209600 s（14 天），源队列是 345600 s（4 天）。当前 `ApproximateNumberOfMessages=0`，DLQ 的 Deleted 也是 0。
  - 标准队列的消息进入 DLQ 后，保留期仍从最初入队的时间算起。所以 09-22 之后进过 DLQ 的消息，最早也要到 10-06 才会过期，现在应该还在里面。可以合理判断从来没有消息进过 DLQ。
  - 09-03 到 09-22 之间 publish 队列还没有 `developercards-publish-jobs-dlq`。那段时间的 DLQ 状态**未能确认**，但那段时间的 3 条消息（09-16 两条、09-21 一条……按 Sent 小时分布看，09-22 之前共 7 条）都是 Received=Sent。

## 6. synthetic 探测通过率（EMF）

synthetic-check 每次运行会发一条 EMF 指标 `DeveloperCards/SyntheticCheckSuccess`（维度 Service=synthetic-check），只有 5 项检查全部通过时取值为 1。5 项检查是 `api-health`、`cdn-manifest`、`cdn-deck`、`console-index`、`api-auth-guard`。定义见 `services/synthetic-check/src/synthetic_check/emf.py:15-45` 和 `checks.py:33`。

| 指标（09-03 到 10-02T20:00Z） | 值 | 证据 |
|---|---|---|
| SyntheticCheckSuccess Sum / SampleCount | 367 / 367，Minimum 为 1 | [C14] |
| 日志里的 `synthetic-run` 统计 | `ok=1` 有 367 条，`ok=0` 有 0 条 | [C11] |
| 通过率 | **100%**（367 次运行，其中 365 次定时、2 次部署时手动调用；共 1835 项检查） | |
| SyntheticCheckLatency | p95 2585.5 ms，最大 2726 ms | [C14] |

## 7. 告警触发次数（describe-alarm-history，09-03 到 10-03）

证据：
- [C20] `describe-alarm-history --history-item-type StateUpdate`，一共 80 条，没有 NextToken。最早一条是 2026-09-22T12:33:25Z（developercards-prod-rds-cpu）。CloudTrail 里最早的 PutMetricAlarm 在 2026-09-22T12:32:56Z，所以这一条确实是告警刚创建的时候。
- [C21] Action 历史，57 条。
- [C22] CloudTrail `EnableAlarmActions`。

| 告警 | 转入 ALARM 的次数 | 时间（UTC） | 恢复时间 | 是否发了通知 | 判断 |
|---|---|---|---|---|---|
| developercards-prod-automation-tick-missing | 1 | 2026-09-27T12:08:51Z（从 INSUFFICIENT_DATA 转入） | 14:29:06Z | ALARM 那次没发，因为 actions 到 14:28:06Z 才启用 [C22]。OK 那次发了 SNS（14:29:06.086Z）[C21] | 部署时的假告警：发生在 schedule 启用之前 |
| developercards-prod-source-watch-missing | 1 | 2026-09-27T15:38:41Z（从 INSUFFICIENT_DATA 转入） | 16:29:41Z | 没发，actions 到 16:41:16Z 才启用 [C22] | 埋点上线滞后，见下方说明 |
| developercards-prod-synthetic-check-failing | 1 | 2026-09-29T00:26:28Z（从 INSUFFICIENT_DATA 转入） | 00:50:28Z | 没发，actions 到 01:14:08Z 才启用 [C22] | 部署时的假告警：schedule 当时还是 DISABLED |
| developercards-prod-core-vpc-duration-p95（已于 2026-09-29T00:33:01Z 删除） | 6 | 2026-09-27 15:30:13、15:53:13、15:59:13、16:17:13、19:04:13、19:14:13Z | 分别在 1、1、10、10、5、2 分钟后恢复 | 12 次状态变化都发了 SNS [C21] | 不是自动化告警，是 core-vpc 的 API 时延，见下方说明 |
| 其余 **53** 个告警（**已修正**，原文写 51）：48 个 MetricAlarm 加 5 个 CompositeAlarm，包括 notifier-errors、source-watcher-errors、automation-step-failures、notify-dlq-nonempty、webhook-*、ai-qa-*、worker-errors、dlq-nonempty 和 SLO burn 系列 | 0 | | | | 当前状态全部为 OK [C24] |

- **source-watch-missing 的原因：**
  - 心跳 `SourceWatchRuns` 是在提交 `902c071`（2026-09-28 04:27:51 +1300，即 2026-09-27T15:27:51Z）里加的。v3 于 16:05:09Z 部署 [C15][C23]。
  - 14:28 和 15:28 两次运行用的是 v1/v2，没有发心跳。所以 SourceWatchRuns 是 124，而调用是 126 [C14]。SourceWatchRuns 的小时数据从 09-27T16:00Z 开始。
  - 实际 126 次运行一次都没漏。
- **core-vpc-duration-p95 的原因：**
  - 低流量加冷启动，导致告警来回抖动。
  - `aba7314`（H06）把它删除了。`infra/README.md:166`（OPS01，"flapped 6 times on 2026-09-28"）和 `:168`（H06 删除记录）有记录。README 里写的 "2026-09-28" 是新西兰日期。

**说明：**

- 当前一共有 51 个 MetricAlarm 和 5 个 CompositeAlarm，全部为 OK。其中 51 个 MetricAlarm 已经包含上表前三个告警，所以"其余"是 48 + 5 = 53 个 [C24]。
- 只看启用期间、并且归属自动化的告警，**真正的触发次数是 0**。source-watch-missing 那次虽然发生在启用之后，但原因是埋点比 schedule 晚上线，不是漏跑。
- `AutomationTickFailures`、`AutomationStepFailures` 和 `NotificationFailures` 这三个指标在 `list-metrics` 里都不存在 [C25]。list-metrics 只列最近两周有数据的指标，所以这说明最近两周从来没发出过这三个指标。notifier 的代码里定义了 `AutomationTickFailures`（`services/notifier/src/notifier/emf.py:14`）。

---

## 8. 可以写进简历的汇总表

| 指标 | 数值 | 统计范围 |
|---|---|---|
| 定时自动化投递次数（4 个 EventBridge schedule） | 995/995 成功，0 次漏跑 | tick 和 source-watch 5.2 天，synthetic 3.8 天 |
| Lambda 错误和限流（6 个函数，其中 2 个没有调用） | 0 次错误，0 次限流，一共 1019 次调用（512 + 126 + 368 + 13） | 09-03 到 10-02 |
| synthetic 端到端探测 | 367/367 次通过（1835 项检查），p95 2.6 s | 3.8 天 |
| 队列任务（publish 13 条，notify 7 条） | 20/20 一次处理成功，DLQ 一直为 0 | 30 天 |
| 自动化相关的真实告警 | 0 次（3 次部署期的 INSUFFICIENT_DATA 假告警已确认原因） | |

建议的英文写法（数字都能在本报告里找到出处；因为 tick 是 dry-run，建议加上 "dry-run"）：

> "Built a serverless automation layer (EventBridge Scheduler → Lambda → SQS with DLQs, EMF heartbeats, synthetic probes, CloudWatch alarms); first 5 days in production (dry-run mode): 995/995 scheduled runs on time with zero Lambda errors or DLQ messages, 367/367 synthetic probes passing."

## 9. 需要如实说明的局限

1. **启用时间很短。** 30 天窗口里只有大约 5.2 天（synthetic 只有 3.8 天）是真正在跑的。"30 天"的说法只对 worker-lambda 和 SQS 成立。
2. **样本小，100% 的含义有限。** 按零失败时的"三法则"估计 95% 置信下限：995 次调度对应成功率至少约 99.7%，367 次探测至少约 99.2%，20 条队列消息只能说至少约 85%。
3. **tick 的 core 端全程是 `dry_run`。** 除了 summaries=2 和 alerts=3，其他动作计数全是 0。这 5 次动作发出了真实邮件。另外，10-02 07:43Z 之后的 RevenueCat 删除步骤不受 dry_run 控制，一共跑了 51 次，deleted 0 次，not_found 5 次，failed 0 次。能证明的主要是调度和调用链路可靠，不是自动化动作本身可靠。
4. **流量很低。** webhook-dispatcher 和 ai-qa 窗口内调用 0 次，无法评价。notifier 真实发出的通知只有 7 封。
5. **有非 Scheduler 的调用。** notifier 有 1 次，synthetic 有 3 次，都已从调度成功率里剔除。notifier 那次的来源**未能确认**，按 requestId 推断是 07:43:32 那次冷启动调用。
6. **synthetic 的 Lambda Errors 不能当作探测结果。** handler 会吞掉检查过程中的异常，探测结果只能看 EMF 的 `SyntheticCheckSuccess`。
7. **心跳上线晚于 schedule。** 头两次 source-watch 没有心跳，触发了一次 missing 告警。调度链路本身没问题，但这说明监控是边上线边补齐的。
8. **SQS 指标在闲置队列上有空档。** DLQ 一直为 0 的结论还依赖第 5 节的推理：14 天保留期，加上当前 0 条、Deleted 也是 0。
9. **短时间内多次部署。** 09-27 到 10-02 期间各函数的发布版本数如下 [C15]。这些发布都没有引起 Lambda 错误，但统计期内代码并不是同一个版本。
   - notifier 7 个（v1–v7）
   - source-watcher 6 个（v1–v6）
   - synthetic-check 3 个（v1–v3）
   - **（新增）** worker-lambda 14 个（v13–v26，09-27T06:02Z 到 09-30T22:07Z）
10. **超过 15 天的数据精度较低。** CloudWatch 的 60 秒数据只保留 15 天，之后聚合为 5 分钟粒度。这影响 09-03 到 09-17 的 worker 数据，不影响总数，只影响分钟级定位。Scheduler 的分钟级对账只用于 15 天内的时间点。
11. **（新增）publish 任务有配置警告。** 13 个 publish 任务里有 7 个记录了 `MANIFEST_QUEUE_URL is not set. Skipping manifest rebuild event.`（09-16、09-21）。"100% 成功"指的是任务本身完成，不代表下游 manifest rebuild 被触发。（补充核实：这 7 条警告来自 E03 之前的旧 worker 版本。E03（提交 4493c2a）改为发布成功后在进程内直接重建 manifest，并删除了读取 `MANIFEST_QUEUE_URL` 的发送方；当前 main 中这个变量已无人读取，worker 与 core-vpc 的生产环境也都没有这个变量。这是已修复的历史问题。）

---

## 附：命令和证据索引

- 所有命令都带 `AWS_PROFILE=dev AWS_REGION=ap-southeast-2`。
- Logs Insights 用辅助脚本调用 `aws logs start-query` 和 `get-query-results`，查询范围是 1788393600（09-03T00:00Z）到 1790971200（10-02T20:00Z）。
- 脚本在 `/private/tmp/claude-501/-Users-qc-Desktop-2026-9--DeveloperCards-recallsmith/f8b2a83a-2194-44bb-8945-6a41db8be0d6/scratchpad/lq.py`。注意：脚本默认的结束时间是 1790985600（10-03T00:00Z），所以必须显式传入 1790971200。

AWS 证据：

- **[C1]** `aws lambda list-functions`，`aws sqs list-queues`。本次核查改用 get-function-configuration 和 get-queue-url 逐个确认。
- **[C2]** `aws scheduler list-schedules`，`aws lambda list-event-source-mappings`。4 个 ESM 都是 batch 1、MaximumConcurrency 2、Enabled。
- **[C3]** `aws scheduler get-schedule --name <4 个 schedule>`（表达式、时区、Input、RetryPolicy、CreationDate、LastModificationDate）。
- **[C4]** `aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue={CreateSchedule,UpdateSchedule,DeleteSchedule} --start-time 2026-09-01T00:00:00Z --end-time 2026-10-04T00:00:00Z`。
- **[C5]** `aws cloudwatch get-metric-data`：
  - AWS/Lambda 的 Invocations、Errors、Throttles（Sum），Duration（Average、Maximum、p95），ConcurrentExecutions（Maximum）。
  - Period 2577600，截至 2026-10-02T20:00Z。
  - 每日分布用 `get-metric-statistics --period 86400`。
- **[C6]** 同 [C5]，用于 source-watcher 和 synthetic-check。
- **[C7]** Logs Insights，`/aws/lambda/developercards-notifier`：
  - `filter ispresent(event) | stats count() by event, job, effectiveMode` 的结果：tick_ok/tick/dry_run 503，tick_ok/tick/off 1，tick_ok/digest/dry_run 1，notification_sent 7，**revenuecat_delete 51**（原文漏掉了这一项）。
  - `filter @type="REPORT" | stats count()` 的结果是 512。
  - `filter event="notification_sent" | fields @timestamp, kind` 的结果是 7 条。
- **[C8]** 同一日志组：
  - 按时间排序 tick_ok/tick，计算相邻间隔：最小 0.073 分钟（10-02 07:43:35 → 07:43:39），最大 15.08 分钟（07:43:39.706 → 07:58:44.588）。剔除 07:43:35 那次后，最小 14.93 分钟，最大 15.08 分钟。
  - `level="error" or level="warn" or event in ["tick_failed","tick_steps_failed"]` 为 0 条。
  - 10-02 07:43–08:00 的 START/REPORT 明细：requestId 分别是 c6b99045、916abf60 和 916abf64。
- **[C9]** 同一日志组：
  - `stats sum(actions.*) by job`：tick 只有 summaries=2、alerts=3 不为 0，digest 全为 0。
  - `stats count() by ispresent(failedSteps.0)`：结果为 0 的有 **505** 条（**已修正**，原文写 506）。505 = 504 tick + 1 digest。
- **[C10]** `/aws/lambda/developercards-source-watcher`：
  - 按 event 统计：nothing_to_watch 104，observe_start 262，observation 262。
  - `count_distinct(watchRunId)` 为 22。
  - observation 按 status 统计：ok 260，failed 2，两次都是 TIMEOUT。
  - REPORT 统计：126 条，max 70016.7。
  - REPORT 间隔：最小 59.17 分钟，最大 61.14 分钟。
- **[C11]** `/aws/lambda/developercards-synthetic-check`：
  - `ispresent(SyntheticCheckSuccess)` 有 367 条，sum 367，min 1。
  - `synthetic-run` 按 ok 统计：ok=1 有 367 条。
  - `synthetic-skip` 有 1 条（04:50:41.258Z）。
  - START 共 368 条，其中 requestId 后缀为 `709401390d94` 的有 365 条。
  - 剔除 3 次后，REPORT 间隔最小 14.69 分钟，最大 15.03 分钟。
- **[C12]** `get-metric-statistics` AWS/Scheduler `InvocationAttemptCount`，ScheduleGroup=default 和不带维度两种查法都是 995。TargetErrorCount、InvocationDroppedCount、InvocationThrottleCount、TargetErrorThrottledCount 都没有数据点。
- **[C13]** `get-metric-statistics` AWS/Scheduler InvocationAttemptCount，Period 60。各时间段的结果：
  - 10-02 07:30–08:00：07:35、07:43、07:50、07:58 各 1 次。
  - 09-29 00:45–01:10：00:50、00:58、01:05 各 1 次。
  - 09-29 04:45–05:00：04:50、04:58 各 1 次。
  - 09-27 14:25–14:35：14:28 有 2 次。
  - 09-27 18:55–19:05：18:58、19:00 各 1 次。
- **[C14]** `get-metric-data`，namespace `DeveloperCards`：
  - AutomationTicks 504。
  - SourceWatchRuns 124，小时数据从 09-27T16:00Z 开始。
  - SourceWatchChecks：ok 260，failed 2。
  - SyntheticCheckSuccess：Sum 367，SampleCount 367，Min 1。
  - SyntheticCheckLatency：p95 2585.5，max 2726。
  - tick 路由的 Latency：SampleCount 505，p95 3152.8，max 6622.05。Errors 为 0。
- **[C15]** `aws lambda get-function-configuration --qualifier prod`（超时、内存、LastModified），`list-versions-by-function`，`get-alias --name prod`。prod 别名指向：notifier v7，source-watcher v6，synthetic-check v3，worker-lambda v26，webhook-dispatcher v5，ai-qa v9。
- **[C16]** notifier：`filter @type="REPORT" and @duration > 10000`，只有 1 条：2026-09-27 19:00:14.698，11252.75 ms。
- **[C17]** `/aws/lambda/worker-lambda`：
  - REPORT 统计：13 条，按天分别是 2、5、2、4。
  - 三类 msg 各 13 条。
  - `(?i)(fail|error|exception)` 匹配 0 条。用 `(?i)(PROCESSING)` 匹配到 26 条，说明 `(?i)` 写法在这里有效。
  - **补充：** 用 `/rror|ail|xception|ERROR|WARN/` 匹配到 7 条 `MANIFEST_QUEUE_URL is not set` 警告。
- **[C18]** `get-metric-data` AWS/SQS，8 个队列，指标为 ApproximateNumberOfMessagesVisible（Max）、NumberOfMessagesSent、Received、Deleted（Sum）和 ApproximateAgeOfOldestMessage（Max），Period 3600，09-03 到 10-03。没有 NextToken。
- **[C19]** `aws sqs get-queue-attributes --attribute-names CreatedTimestamp ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible RedrivePolicy MessageRetentionPeriod`。
- **[C20]** `aws cloudwatch describe-alarm-history --history-item-type StateUpdate --alarm-types MetricAlarm CompositeAlarm --start-date 2026-09-03T00:00:00Z --end-date 2026-10-03T00:00:00Z`，结果 80 条。另外查了 CloudTrail `PutMetricAlarm`：最早在 2026-09-22T12:32:56Z。
- **[C21]** `aws cloudwatch describe-alarm-history --history-item-type Action`（同一时间段），57 条。
- **[C22]** `aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=EnableAlarmActions`：
  - tick-missing：2026-09-27T14:28:06Z
  - source-watch-missing：2026-09-27T16:41:16Z
  - synthetic-check-failing：2026-09-29T01:14:08Z
  - 另外查了 `DeleteAlarms`：core-vpc-duration-p95 和 api-5xx 在 2026-09-29T00:33:01Z 删除。
- **[C23]** `git log -S 'SourceWatchRuns' 5bc57f4 -- services/source-watcher`，结果是 `902c071 2026-09-28 04:27:51 +1300` 和 `5793c9d`（D03 的 ledger 和 README）。source-watcher v3 的 LastModified 是 2026-09-27T16:05:09Z [C15]。
- **[C24]** `aws cloudwatch describe-alarms --alarm-types MetricAlarm CompositeAlarm`：51 个 MetricAlarm 和 5 个 CompositeAlarm，当前全部为 OK。
- **[C25]** `aws cloudwatch list-metrics --namespace DeveloperCards`：共 152 条，指标名有 10 种。其中没有 AutomationTickFailures、AutomationStepFailures 和 NotificationFailures。
- **[C26]（新增）** `/aws/lambda/developercards-notifier`：
  - `filter event="revenuecat_delete" | stats count(), sum(deleted), sum(not_found), sum(failed), max(pending) by outcome` 的结果：done 51，deleted 0，not_found 5，failed 0，pending 最大 2。时间范围是 2026-10-02 07:43:35 到 19:58:44。
  - `pending>0 or not_found>0` 共 3 条（08:13、08:28、08:43）。

代码证据（基于 `origin/main` = `5bc57f4`，用 `git show 5bc57f4:<path>` 读取）：

- 告警定义：`infra/modules/observability/alarms_r18a.tf:3-178`。原文写 3-180，已修正：文件只有 178 行。
- synthetic 告警：`infra/modules/observability/alarms_r18h.tf:3-22`。原文写 5-15，这里给出整个资源块的范围。
- schedule 定义：`infra/modules/worker/automation.tf:151-210`，`infra/modules/worker/synthetic.tf:51-69`。
- notifier 的 job 处理：`services/notifier/src/notifier/handler.py:365-428`；RevenueCat 步骤在 `handler.py:356-362` 和 `:378-380`。
- 删除 p95 告警：`aba7314`（2026-09-29 13:28:39 +1300，H06）。
- 当前 main：
  - 本地 `refs/remotes/origin/main` 指向 `5bc57f4`（2026-10-02 23:04:13 +1300，Merge #728）。
  - 本地 `refs/heads/main` 仍是旧的 `bada1f7`。
  - 本次核查没有 fetch，所以远端 main 之后是否还有新提交，**未能确认**。

---

## 核查记录

| # | 核查项 | 命令或证据 | 结果 |
|---|---|---|---|
| 1 | 账号和当前时间 | `aws sts get-caller-identity`；`date -u` | 622994489535；20:26:00Z。原文的 20:11:21 无法复现，标为**未能确认**，但不影响截止时间 |
| 2 | schedule 列表、表达式、Input、时区 | `scheduler list-schedules`、`get-schedule` | 一致。补充了 RetryPolicy：tick 和 digest 重试 2 次，source-watch 和 synthetic 重试 0 次 |
| 3 | Create/Update/DeleteSchedule 时间和发起人 | `cloudtrail lookup-events`（3 种事件名） | 8 条事件，时间和发起人全部一致；没有 Delete 事件 |
| 4 | 启用时长 | 算术 | 5 天 5 小时 32 分（5.23 天）；3 天 19 小时 10 分（3.80 天）。一致 |
| 5 | Scheduler 合计 995，以及 4 个错误类指标 | `get-metric-statistics` AWS/Scheduler，两种维度 | 995；错误类指标无数据点。一致 |
| 6 | 每分钟投递次数 | Period 60 的 5 个时间段 | 一致；07:43、00:50、04:50 都只有 1 次 |
| 7 | notifier 事件拆分 | Logs Insights stats by event/job/effectiveMode | 503/1/1/7 一致；**原文漏了 revenuecat_delete 51 条** |
| 8 | notifier REPORT 512、最大时长 11252.75 ms | Logs Insights | 一致 |
| 9 | tick 间隔：最小 0.07 分钟，最大 15.08 分钟 | 导出 504 条 tick_ok 计算 | 一致；剔除手动那次后最大仍是 15.08 分钟 |
| 10 | 07:43 两次 tick 的时间 | START/REPORT 明细 | 07:43:32 和 07:43:39 是 START 时间，一致；补充了 requestId 推断 |
| 11 | failedSteps 为空的条数 | `stats count() by ispresent(failedSteps.0)` | **505，不是 506**，已修正 |
| 12 | tick_failed 或 warn/error 条数 | Logs Insights | 0，一致 |
| 13 | actions 合计 | `stats sum(actions.*) by job` | summaries=2、alerts=3，一致；补充了发生时间，以及它们产生了真实邮件 |
| 14 | "没有执行真正的自动化动作" | 代码 `handler.py:356-380` 加 [C26] | **不准确**：RevenueCat 步骤不受 dry_run 控制，跑了 51 次；alerts 和 summaries 发出了 5 封真实邮件。已改写 |
| 15 | 6 个 Lambda 的 Invocations、Errors、Throttles、Duration、并发 | `get-metric-data` AWS/Lambda | 全部一致，合计 1019；webhook 和 ai-qa 是"无数据点"，不是 0 |
| 16 | 超时设置和版本数 | `get-function-configuration`、`list-versions-by-function` | 60/300/60/615/30/600 s 一致；版本数 7/6/3 一致；补充 worker 14 个版本 |
| 17 | worker 日志 | Logs Insights | 13/13/13 和每日分布一致；**新发现 7 条 MANIFEST_QUEUE_URL 警告** |
| 18 | source-watcher：104/22/262/260/2/TIMEOUT 时间/126/70016.7/61.14 | Logs Insights | 全部一致 |
| 19 | synthetic：367/368/skip/3 次非定时调用/365/15.03 | Logs Insights 加 requestId 后缀 | 全部一致；按 requestId 后缀确认了 365 次定时调用 |
| 20 | EMF 指标 | `get-metric-data` DeveloperCards | 504/124/260/2/367/367/1/2585.5/2726/505/3152.8/6622.05/0，全部一致 |
| 21 | SQS 属性 | `get-queue-attributes` 8 个队列 | 创建时间、当前 0 条、重驱策略 5/3/5/3、保留期 14 天和 4 天，全部一致 |
| 22 | SQS 指标 | `get-metric-data` AWS/SQS | 7/7/7、13/13/13、DLQ 全为 0，一致；DLQ 数据点 54–97（多查了 1 小时） |
| 23 | notify 每小时数量和邮件 kind | Logs Insights 对照 SQS 小时数据 | 一致；补充了时间 |
| 24 | 告警状态历史：80 条，4 个告警转入 ALARM 的时间 | `describe-alarm-history StateUpdate` | 全部一致 |
| 25 | Action 历史和 EnableAlarmActions | `describe-alarm-history Action`、CloudTrail | 一致 |
| 26 | "其余 51 个告警" | `describe-alarms` | 当前 51 个 MetricAlarm（已包含 3 个自动化告警）加 5 个 Composite；**其余应为 53 个**，已修正 |
| 27 | p95 告警删除 | CloudTrail DeleteAlarms；`infra/README.md:166,168` | 2026-09-29T00:33:01Z 删除；README 行号和日期说明一致 |
| 28 | 缺失的失败类指标 | `list-metrics --namespace DeveloperCards` | 3 个都不存在，一致 |
| 29 | 提交 fdc3154、6e4f827、64e442a | `git show --stat`、`git show 6e4f827 -- automation.tf` | **6e4f827 没有引入 schedule**（只加了 async no-retry 和 concurrency 4），已修正 |
| 30 | 902c071 的时间 | `git log -S SourceWatchRuns` | 2026-09-28 04:27:51 +1300，一致 |
| 31 | 代码行号 | `git show 5bc57f4:<path>` | automation.tf:151-210 一致；synthetic.tf 应为 51-69；alarms_r18a.tf 只有 178 行；handler.py 的 `_handle_job` 从 365 行开始；synthetic 的 handler 是 20-37 行，均已修正 |
| 32 | main 指向 | `git for-each-ref` | origin/main 是 5bc57f4（未 fetch），本地 main 是 bada1f7；远端是否有更新提交**未能确认** |
| 33 | digest 时间换算 | `TZ=Pacific/Auckland date` | 09-27T19:00Z = 2026-09-28 周一 08:00 NZDT，一致 |
| 34 | 三法则下限 | 算术 1−3/n | 99.70% / 99.18% / 85%，一致 |
| 35 | RevenueCat 的 pending 未清除原因 | 只有日志计数 | **未能确认**：代码不记录 sub，日志只有计数 |