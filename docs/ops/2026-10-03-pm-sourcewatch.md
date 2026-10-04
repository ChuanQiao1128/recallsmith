# developercards-prod-source-watch-missing 告警事后复盘（2026-09-27 15:38Z）

> 核查说明：2026-10-02T20:18Z 前后，用 `AWS_PROFILE=dev`、`ap-southeast-2`（账号 622994489535，`aws sts get-caller-identity` 已确认）把所有只读命令重跑了一遍，并在 `/Users/qc/src/recallsmith-sup`（`origin/main` = `5bc57f4`）里读了相关提交和文件。改过的地方用 **【已更正】** 标出，原文里不准确的写法写在后面括号里。

## 摘要

1. 2026-09-27T15:37:10Z，Terraform 新建了告警 `developercards-prod-source-watch-missing`，定义来自 commit `2143271`。证据：`describe-alarm-history` 中的 Create 记录，以及 CloudTrail 里 Terraform/1.16.3 发起的 `PutMetricAlarm`。告警第一次评估时回看了三个小时窗口，`evaluatedDatapoints` 分别是 12:38、13:38、14:38Z，合起来就是 12:38–15:38Z。这段时间里 `SourceWatchRuns` 一个数据点也没有，原因如下：
   - 14:28Z 之前计划任务一直是 DISABLED。
   - 14:28Z 和 15:28Z 两次调用跑的是版本 1 和版本 2，这两个版本还没有心跳代码。
   
   缺失数据按 `breaching` 计算，所以告警在 15:38:41Z 直接进入 ALARM。
2. source-watcher 一直在跑。计划任务启用后每小时都被调用一次（14:28、15:28、16:28Z……），`AWS/Lambda Invocations` 在 14:00–18:00Z 每小时 Sum=1，`Errors` 全是 0。告警创建时 `actionsEnabled=false`，`--history-item-type Action` 查出来是 0 条，说明没有向 SNS 发过通知，用户、数据和费用都没有受影响。
3. 16:05:17Z 发布了带心跳的版本 3（`ee7d84c`）。第一个心跳出现在 16:28:45Z，告警在 16:29:41Z 回到 OK，16:41:16Z 通过 CLI 打开了告警动作。之后每 24 小时稳定有 24 个心跳。根本原因是上线顺序：告警（D04）先于发心跳的代码（D03）进了生产。

## 时间线（UTC / 新西兰 NZDT，UTC+13）

| UTC | 新西兰时间 | 事件 | 证据 |
|---|---|---|---|
| 2026-09-27 12:07:09 | 09-28 01:07 | 日志组 `/aws/lambda/developercards-source-watcher` 创建 | `aws logs describe-log-groups`，creationTime=1790510829742，换算为 12:07:09.742Z |
| 12:07:28–12:07:34 | 01:07 | Terraform `CreateFunction` 创建函数，`CreateAlias prod`（指向 `$LATEST`） | CloudTrail `ResourceName=developercards-source-watcher`；`EventName=CreateAlias20150331` |
| 12:07:34 | 01:07 | Terraform `CreateSchedule developercards-source-watch`，state=**DISABLED**，`rate(1 hour)`，目标为 `developercards-source-watcher:prod` | `cloudtrail lookup-events EventSource=scheduler.amazonaws.com`；`scheduler get-schedule`（Target.Arn） |
| 14:27:21–14:27:23 | 03:27 | `deploy-python-lambda.sh` 发布版本 1（描述中含 `e9e866c`），`prod` 别名改指向 1 | CloudTrail `PublishVersion20150331`（14:27:21Z）、`UpdateAlias20150331`（14:27:23Z）；`lambda list-versions-by-function` |
| 14:28:01 | 03:28 | CLI `UpdateSchedule` 改为 **ENABLED**。同一批 CLI 操作还在 14:28:03、14:28:04Z 启用了 `developercards-automation-tick` 和 `developercards-automation-digest` | CloudTrail（aws-cli/2.18.5）；`scheduler get-schedule` 中 LastModificationDate=2026-09-28T03:28:01.493+13:00 |
| 14:28:45 | 03:28 | 第 1 次调用（Version 1），`nothing_to_watch`，effectiveMode=off，**没有发心跳** | `logs filter-log-events` 12:00–19:00Z |
| 15:17:24–15:17:26 | 04:17 | 发布版本 2（`240e0a3`），别名改指向 2 | CloudTrail `PublishVersion`/`UpdateAlias` |
| 15:27:51 | 04:27 | 加入心跳的代码提交 `902c071`（D03），这个提交不在 `240e0a3` 中 | `git log -1 902c071`（2026-09-28T04:27:51+13:00）；`git merge-base --is-ancestor 902c071 240e0a3` 返回 NOT |
| 15:28:45 | 04:28 | 第 2 次调用（Version 2），观测 targetId 2，status ok，httpStatus 200。只发了 `SourceWatchChecks`/`SourceWatchLatency`，**没有发心跳** | filter-log-events |
| 15:32:40 | 04:32 | 告警定义提交 `2143271`（D04） | `git log -1 2143271` |
| 15:37:10 | 04:37 | Terraform `PutMetricAlarm` 创建告警，`actionsEnabled=false`，`treatMissingData=breaching` | `describe-alarm-history` Create 记录（createdAlarm.actionsEnabled=False）；CloudTrail `PutMetricAlarm` |
| **15:38:41** | **04:38** | **INSUFFICIENT_DATA → ALARM**：3 个周期（12:38、13:38、14:38）都没有数据，按 breaching 计 | `describe-alarm-history`（StateUpdate，stateReasonData.evaluatedDatapoints） |
| 16:03:11 | 05:03 | 合并 `ee7d84c`（PR #484，release/r18d），其中包含 `902c071` 和 `2143271` | `git log`；`merge-base --is-ancestor` 两个都返回包含 |
| 16:05:17–16:05:19 | 05:05 | 发布版本 3（`ee7d84c`），别名改指向 3 | CloudTrail |
| 16:09:49 | 05:09 | CLI `DescribeAlarms` 同时查了这个告警和 `developercards-prod-automation-tick-missing`。这是第一次通过 CLI 查看；在这之前只有 Terraform 刷新时发出的 DescribeAlarms（15:37:10、15:37:17、15:49:55Z） | CloudTrail `ResourceName=告警名`（userAgent aws-cli/2.18.5） |
| 16:10:42 | 05:10 | 提交 `ab64280`，在 runbook 中加入"Upgrading a running system (R18D)"，顺序是先部署 D03，再确认心跳，最后打开动作 | `git show ab64280` |
| 16:28:45 | 05:28 | 第 3 次调用（Version 3），**发出第一个 `SourceWatchRuns=1`**（EMF Timestamp 1790526525928，即 16:28:45.928Z） | filter-log-events；period 60 的 `get-metric-statistics` 中最早的数据点是 16:28 |
| 16:29:41 | 05:29 | **ALARM → OK**，评估的是 15:29–16:29 窗口，值为 1.0 | `describe-alarm-history` |
| 16:41:16 | 05:41 | CLI `EnableAlarmActions`，告警配置变为 actionsEnabled=true | CloudTrail；`describe-alarm-history`（ConfigurationUpdate，type=Update） |
| 17:28:45 | 06:28 | 第 4 次调用，**仍是 Version 3**，心跳正常 | filter-log-events（`START ... Version: 3`） |
| 17:33:06–17:33:07 | 06:33 | **【已更正】** 发布版本 4（`c95ed55`），别名改指向 4。原文写"17:32:58 起"，但 17:32:58 是 `UpdateFunctionCode`，也就是版本的 LastModified 时间，并不是别名切换的时间 | CloudTrail `PublishVersion`（17:33:06Z）、`UpdateAlias`（17:33:07Z）；`list-versions-by-function` |
| 18:28:45 | 07:28 | 第 5 次调用（Version 4），心跳正常 | filter-log-events |

**【已更正】** 原表最后一行写的是"17:32:58 起 版本 4，17:28 和 18:28 的心跳都正常"，这会让人以为 17:28 那次跑的是版本 4。日志显示 17:28 跑的是 Version 3，只有 18:28 跑的是 Version 4。

## 如何发现

- 这次没有通知。告警进入 ALARM 时 `actionsEnabled=false`，证据有两处：告警历史 Create 记录里 `createdAlarm.actionsEnabled=false`，以及 16:41 Update 记录里的 `originalUpdatedFields.actionsEnabled:false`。用 `describe-alarm-history --history-item-type Action --start-date 2026-09-01T00:00:00Z` 查询，结果是 0 条。告警当前的 AlarmActions/OKActions 都是 `developercards-alerts`（`describe-alarms`），那段时间这个 SNS 主题没有收到任何动作。
- 第一次通过 CLI 查看是在 16:09:49Z，`devcards-admin` 用 aws-cli/2.18.5 调用了 `DescribeAlarms`（CloudTrail）。之后在 16:25:44Z 和 16:41:12Z 又用 CLI 查了两次，16:41:16Z 打开了动作。告警处于 ALARM 期间，Terraform 也发过几次 DescribeAlarms（15:49:55、16:11:43、16:28:30Z），那是 plan/apply 刷新状态，不算有人查看。这几次查看对应 runbook 中规定的上线检查步骤（`origin/main:infra/RUNBOOK.md:199-205`），不是因为收到告警才去查的。CloudTrail 只记录了 IAM 用户 `devcards-admin`，所以调用者是人还是 supervisor agent **未能确认**。

## 影响

- **用户**：没有影响。source-watcher 只是每小时检查一次引用来源，不面向用户。当时的运行模式是 `off`（14:28）和 `dry_run`（16:28、17:28、18:28，见日志中的 `effectiveMode`）。15:28 那次（Version 2）的日志里没有 `effectiveMode` 字段。
- **数据**：没有丢失。计划任务启用后每小时都有调用：`AWS/Lambda Invocations` 在 14:00–18:00Z 每小时 Sum=1，`Errors` 每小时 Sum=0（`get-metric-statistics` 10:00–19:00Z，period 3600）。15:28 那次观测返回 `status=ok, httpStatus=200`。12:07–14:28Z 期间没有运行，是因为 Terraform 按设计把计划任务建成了 DISABLED（`infra/README.md:161` 的 A10 条目写着 "all created **DISABLED** with `ignore_changes = [state]`"），不属于故障。
- **费用**：没有产生额外调用，每小时仍是 1 次。相关三次调用（14:28、15:28、16:28）的计费时长分别是 1546 ms、6466 ms、1703 ms，内存 512 MB（日志 REPORT 行）。之后两次分别是 4875 ms（17:28）和 1667 ms（18:28）。具体金额**未能确认**，因为没有查 Cost Explorer。不过调用次数没有增加，没有可归因于这次事件的额外费用。
- **通知**：没有发出，原因是告警动作当时处于关闭状态，见上文。

## 根因（附证据）

**直接原因：告警一创建就处于 ALARM。** 告警定义在 `origin/main:infra/modules/observability/alarms_r18a.tf:107-126`，和 `describe-alarms` 返回的结果一致：

- 指标：`DeveloperCards / SourceWatchRuns`，维度 `Service=source-watcher`，统计方式 Sum
- 周期 3600 s，`EvaluationPeriods=3`，`DatapointsToAlarm=3`，条件 `LessThanThreshold 1`
- `TreatMissingData=breaching`，`actions_enabled=false`，并设了 `lifecycle.ignore_changes=[actions_enabled]`（第 119-125 行）

告警创建于 15:37:10Z，第一次评估在 15:38:41Z，回看 12:38–15:38Z 三个小时。这段时间里：

1. 12:07–14:28Z 计划任务是 DISABLED（CloudTrail 中 `CreateSchedule state=DISABLED` 在 12:07:34Z，`UpdateSchedule state=ENABLED` 在 14:28:01Z），所以没有调用。
2. 14:28Z 和 15:28Z 两次调用跑的是版本 1（`e9e866c`）和版本 2（`240e0a3`），都不包含心跳代码（`902c071` 不在 `e9e866c` 中，也不在 `240e0a3` 中）。日志里这两次也没有 `SourceWatchRuns` 的 EMF 行。
3. 用 period 60 的 `get-metric-statistics` 查 09-27 10:00–19:00Z，只有 16:28、17:28、18:28 三个数据点，最早的是 16:28Z。

3 个周期都没有数据，又按 breaching 计，于是立即进入 ALARM。告警历史中的 stateReason 原文是 "Threshold Crossed: no datapoints were received for 3 periods and 3 missing datapoints were treated as [Breaching]."

**深层原因：上线顺序。** 告警（D04，`2143271`）在 15:37Z 就通过 Terraform apply 进了生产，而发心跳的代码（D03，`902c071`）要到 16:05Z 版本 3 部署后才上线。`origin/main:infra/RUNBOOK.md:192-197` 写明：旧版 watcher 不发 `SourceWatchRuns`，在缺失数据按 breaching 计的情况下，如果在新 watcher 运行前打开动作，大约三小时内就会告警。这段升级顺序（`ab64280`，16:10:42Z）是在告警进入 ALARM 之后才补上的。在 `2143271` 时的 RUNBOOK 里，只在第 182 行有一句"启用计划任务后执行 `enable-alarm-actions`"，而且这句只覆盖 tick 告警，没有提到 source-watch 告警，也没有"先确认 OK"这个条件（`git show 2143271:infra/RUNBOOK.md`）。

**为什么没有造成误报通知：** 设计上已经考虑到这一点。告警建好时动作是关闭的（`alarms_r18a.tf` 第 102-106 行的注释），等心跳出现、告警变成 OK 之后才手动打开。

## 处理过程

1. 16:05:17Z 部署 source-watcher 版本 3（`ee7d84c`，包含 D03 心跳），见 CloudTrail `PublishVersion`/`UpdateAlias`。
2. 16:09:49、16:25:44、16:41:12Z 用 CLI `DescribeAlarms` 查了三次状态（CloudTrail）。
3. 16:28:45Z 收到第一个心跳，16:29:41Z 告警自动回到 OK。
4. 16:41:16Z 执行 `EnableAlarmActions`，和 runbook 中"先 OK、后打开动作"的顺序一致（`origin/main:infra/RUNBOOK.md:199-205`）。
5. 之后的验证：**【已更正/补充口径】** 用 period 86400 查 `SourceWatchRuns` 时，结果取决于起点对齐方式：
   - 以 16:00Z 为起点：09-27T16 到 10-01T16 这 5 个周期每个都是 24，10-02T16:00Z 起的这个周期在查询时（我在 20:18Z 查的，原文写的是 20:16Z）是 4，和 16:28、17:28、18:28、19:28 四次运行对得上。
   - 按 UTC 自然日（00:00Z 起）：09-27 是 8（16–23 点），09-28 到 10-01 每天 24，10-02 截至查询时是 20。
   
   原文"09-27 到 10-01 每天都是 24"只在以 16:00Z 为起点时成立。告警当前状态是 `OK`、`ActionsEnabled=true`（`describe-alarms`，2026-10-02T20:18Z）。

## 改进项

**已做**

- `ab64280`（2026-09-28T05:10:42+13:00）：在 `infra/RUNBOOK.md` 中加入"Upgrading a running system (R18D)"清单，顺序是部署 D03，然后确认 `Sum ≥ 1` 或告警为 OK，最后执行 `enable-alarm-actions`。同一提交还把原来的"启用后打开动作"一句改成了"once each heartbeat alarm reads `OK`"，并更新了 `docs/runbooks/automation-operations.md`（`git show --stat ab64280`：2 个文件）。这个提交在 `c95ed55` 中，不在 `ee7d84c` 中（`merge-base --is-ancestor`）。
- 16:41:16Z 已打开告警动作（CloudTrail `EnableAlarmActions`）。
- `2143271` 本身沿用了"建好时动作关闭"的模式，所以没有发出误报通知。这是事前就有的防护，不是事后补的。

**未做（建议）**

1. 心跳类告警目前仍是 `treat_missing_data = "breaching"`，Terraform 建好时动作关闭（`origin/main:alarms_r18a.tf:119-125`；`automation-tick-missing` 在第 93-99 行，同样如此，只是用 2 个周期）。以后新建环境或重建告警，仍会一创建就进入 ALARM。可以考虑把告警的 apply 放到心跳代码部署之后，或者在计划（plan）里明确写出"告警 apply 必须在代码部署之后"作为闸门。
2. 打开动作完全靠人工操作，而 Terraform 会忽略 `actions_enabled`。如果有人忘了，这个告警就会一直静默。建议在 synthetic-check 或 resident-agent 的巡检里加一项：列出 `ActionsEnabled=false` 的生产告警，超过 N 小时就提醒。我在 `origin/main` 的 `services/synthetic-check` 和 `src_C/Vpc/Automation` 里执行了 `git grep -E 'ActionsEnabled|actionsEnabled|actions_enabled'`，没有结果。把范围扩大到 `services`、`src_C`、`scripts` 并加上 `DescribeAlarms|describe_alarms` 后，只有 `services/notifier/tests/test_db_outage_paging.py:70` 一处命中，那是单元测试里的断言，不是运行时巡检。所以目前没有这类检查。
3. 在 D 轮的拆分里，D03（代码）和 D04（告警）是两个独立的条目，但 D04 的 apply 时间早于 D03 的部署时间。建议让 delivery wave 的计划支持"部署依赖"这种边（告警 apply 依赖对应 Lambda 部署完成）。现有 plan schema 是否已经支持，**未能确认**，因为没有读 plan-to-wave 的代码。

## 经验

- "缺失即告警"的心跳告警，必须在心跳的生产者上线之后才建，或者至少等到那之后才打开动作。否则告警一创建就是 ALARM。
- 新告警"建好时动作关闭，状态 OK 后再打开"这个模式这次起了作用：真实的 ALARM 状态（持续约 51 分钟，15:38:41→16:29:41Z）没有变成误报通知。代价是必须有人记得打开动作，需要一个机器检查来兜底（见改进项第 2 条）。
- runbook 的升级顺序最好在 apply 之前写好，而不是像这次在进入 ALARM 之后才补。`ab64280`（16:10:42Z）比告警进入 ALARM（15:38:41Z）晚了 32 分钟。

## 证据清单

- `aws cloudwatch describe-alarms --alarm-names developercards-prod-source-watch-missing`：定义；当前 OK，ActionsEnabled=true；AlarmConfigurationUpdatedTimestamp 16:41:16.833Z；StateUpdatedTimestamp 16:29:41.122Z
- `aws cloudwatch describe-alarm-history --alarm-name developercards-prod-source-watch-missing`：Create 15:37:10.554Z，ALARM 15:38:41.221Z，OK 16:29:41.122Z，Update 16:41:16.833Z
- `aws cloudwatch describe-alarm-history ... --history-item-type Action`：0 条
- `aws cloudwatch get-metric-statistics ... SourceWatchRuns`：
  - period 60（09-27 10:00–19:00Z）：16:28、17:28、18:28
  - period 3600：16、17、18 点各 1
  - period 86400：以 16:00Z 为起点时每周期 24，按 UTC 自然日时 09-27 为 8
- `aws cloudwatch get-metric-statistics AWS/Lambda Invocations/Errors/Duration FunctionName=developercards-source-watcher`（10:00–19:00Z）：14–18 点每小时 1 次调用，0 错误
- `aws logs filter-log-events --log-group-name /aws/lambda/developercards-source-watcher`（09-27 12:00–19:00Z，31 条，没有 nextToken）：版本 1、2 没有心跳；版本 3 起有心跳；17:28 是 Version 3，18:28 是 Version 4
- `aws scheduler get-schedule --name developercards-source-watch`：rate(1 hour)，ENABLED，创建时间 01:07:34+13，修改时间 03:28:01+13，目标 `:prod`
- `aws lambda list-aliases` / `list-versions-by-function`：别名 prod 当前指向 6；版本 1–4 的 LastModified 和描述（e9e866c、240e0a3、ee7d84c、c95ed55）
- `aws cloudtrail lookup-events`：
  - EventSource=scheduler.amazonaws.com：`CreateSchedule DISABLED` 12:07:34Z，`UpdateSchedule ENABLED` 14:28:01Z
  - EventName=PublishVersion20150331 / UpdateAlias20150331 / CreateAlias20150331：发布和别名切换分别在 14:27:21/23、15:17:24/26、16:05:17/19、17:33:06/07Z；CreateAlias 在 12:07:34Z
  - ResourceName=developercards-source-watcher：CreateFunction 12:07:28Z；UpdateFunctionCode 14:27:14、15:17:17、16:05:09、17:32:58Z
  - ResourceName=告警名：`PutMetricAlarm` 15:37:10Z（actionsEnabled=False，treatMissingData=breaching）；CLI `DescribeAlarms` 16:09:49、16:25:44、16:41:12Z；`EnableAlarmActions` 16:41:16Z
- git（`/Users/qc/src/recallsmith-sup`）：`902c071`（D03 心跳）、`2143271`（D04 告警）、`ee7d84c`（PR #484）、`ab64280`（runbook 升级步骤）、`240e0a3`（PR #469）、`e9e866c`（PR #454）、`c95ed55`（PR #495）
- 文件：
  - `origin/main:infra/modules/observability/alarms_r18a.tf:93-99, 102-126`
  - `infra/RUNBOOK.md:182-205`
  - `infra/README.md:161, 165`
  - `services/source-watcher/src/source_watcher/emf.py:14-15`

备注：所有 AWS 命令都是只读的（describe/list/get/filter/lookup）。转达过来的用户消息讲的是"两条路径都换成 GPT-6.1 Sol，先开始做"和"同意花 1–3 美元做 60 张卡片的健康检查"，没有提到这份复盘。这份复盘是按工作流脚本给出的任务做的，用户批准的那两件事这次都没有开始做。

## 核查记录

| # | 核查项 | 命令 / 来源 | 结果 |
|---|---|---|---|
| 1 | 账号 | `aws sts get-caller-identity` | 622994489535，相符 |
| 2 | 告警定义与当前状态 | `describe-alarms` | 指标、维度、Sum、3600/3/3、LessThan 1、breaching 都相符；当前 OK，ActionsEnabled=true |
| 3 | 告警历史四个时间点 | `describe-alarm-history` | 15:37:10、15:38:41、16:29:41、16:41:16Z，相符 |
| 4 | 首次评估窗口与 stateReason | HistoryData 解析 | evaluatedDatapoints 12:38/13:38/14:38，相符；原文引用的 reason 是原文的子串 |
| 5 | Create 时 actionsEnabled=false；Update 的 originalUpdatedFields | ConfigurationUpdate HistoryData | 相符 |
| 6 | Action 历史为空 | `--history-item-type Action` | 0 条，相符 |
| 7 | 日志组创建时间 | `describe-log-groups` | 1790510829742，即 12:07:09.742Z，相符 |
| 8 | 计划任务 | `scheduler get-schedule` + CloudTrail | 相符。补充：14:28:03–04Z 同一批 CLI 操作还启用了 tick 和 digest |
| 9 | 版本 1–3 发布和别名时间 | CloudTrail PublishVersion/UpdateAlias | 相符 |
| 10 | 版本 4 时间 | 同上 | **原文有误**：17:32:58 是 UpdateFunctionCode；发布在 17:33:06Z，别名切换在 17:33:07Z |
| 11 | 17:28 跑的版本 | filter-log-events | **原文有误**：是 Version 3，不是版本 4；18:28 才是 Version 4 |
| 12 | 各次调用的心跳 | filter-log-events（31 条） | 版本 1、2 没有心跳，版本 3 起有，相符；首个心跳在 16:28:45.928Z |
| 13 | 计费时长 | REPORT 行 | 1546、6466、1703 ms，512 MB，相符 |
| 14 | Invocations 每小时 1 次 | get-metric-statistics AWS/Lambda | 14–18 点每小时 Sum=1，相符；Errors 为 0 |
| 15 | 分钟级最早数据点 | period 60，10:00–19:00Z | 16:28Z，相符 |
| 16 | 每日 24 次 | period 86400 | 以 16:00Z 为起点时相符；按 UTC 自然日 09-27 为 8，已补充口径 |
| 17 | 10-02T16Z 周期为 4 | 同上，20:18Z 查询 | 4，相符；原文的 20:16Z 时间点无法复现，但数值一致 |
| 18 | CLI DescribeAlarms 时间 | CloudTrail ResourceName=告警名 | 16:09:49、16:25:44、16:41:12Z，相符；16:09:49 那次同时查了 tick 告警 |
| 19 | PutMetricAlarm / EnableAlarmActions | 同上 | 15:37:10Z（Terraform）、16:41:16Z（aws-cli），相符 |
| 20 | 提交时间与内容 | `git log -1` | 2143271 15:32:40Z、902c071 15:27:51Z、ee7d84c 16:03:11Z（PR #484 release/r18d）、ab64280 16:10:42Z，相符 |
| 21 | 祖先关系 | `git merge-base --is-ancestor` | 902c071 不在 240e0a3、e9e866c 中；902c071 和 2143271 都在 ee7d84c、c95ed55 中；ab64280 在 c95ed55 中、不在 ee7d84c 中，相符 |
| 22 | ab64280 改动范围 | `git show --stat ab64280` | infra/RUNBOOK.md、docs/runbooks/automation-operations.md，相符 |
| 23 | Terraform / RUNBOOK 行号 | `git show origin/main:...` | 定义在 107-126（原文写 107-125）；注释 102-106，相符；119-125（原文写 119-124）；tick 告警 93-99（原文写 93-98）；RUNBOOK 升级说明在 192-197（原文写 194-197），清单 199-205，相符。以上都已改正 |
| 24 | emf.py:14-15 | `git show origin/main:.../emf.py` | `RUNS = "SourceWatchRuns"` 及注释，相符 |
| 25 | README:165 D04 条目 | `git show origin/main:infra/README.md` | 相符 |
| 26 | 没有 ActionsEnabled 巡检 | `git grep` synthetic-check、src_C/Vpc/Automation | 没有命中，相符；扩大范围后只有 notifier 单测一处 |
| 27 | "CloudTrail lambda 查询达到 2000 条上限" | 未复现 | 我改用 EventName 精确查询，四组发布和别名事件都查到了。原文这条说法**未能确认**，但不影响结论 |
| 28 | 调用者是人还是 agent | CloudTrail 只有 IAM 用户 devcards-admin | **未能确认** |
| 29 | 具体费用金额 | 没有查 Cost Explorer | **未能确认** |
| 30 | plan schema 是否支持部署依赖 | 没有读 plan-to-wave 代码 | **未能确认** |