# 事后复盘：developercards-prod-synthetic-check-failing 于 2026-09-29 00:26Z 进入 ALARM

> 核查说明（2026-10-03）：所有数字都用只读命令在账户 622994489535（ap-southeast-2）里重新查过，代码在 `/Users/qc/src/recallsmith-sup` 里核对。代码行号以 `HEAD` = `origin/main` = `5bc57f4` 为准。改动处标了【更正】或【补充】，命令和结果见文末"核查记录"。

## 摘要（三句话）

1. 2026-09-29 00:26:07Z，Terraform 创建了告警 `developercards-prod-synthetic-check-failing`。这条告警设置了 `TreatMissingData=breaching`，创建时合成检查的 Lambda 和定时器还没部署、也还没启用。约 21 秒后（00:26:28.954Z，精确差值 21.6 s），告警把 23:56Z 和 00:11Z 两个 15 分钟周期的"无数据"当成失败，进入 ALARM（`describe-alarm-history`）。
2. 这不是线上故障。告警期间合成检查一次都没跑过，API Gateway `ktbq1sie2c` 在 00:00–01:00Z 的 5xx 为 0。告警创建时 `actionsEnabled=false`，所以本告警没有发出任何通知（本告警的 Action 历史共 0 条）。
3. 00:49Z 部署了真实代码，第一次运行成功；00:49:51Z 启用定时器。告警在 00:50:28Z 恢复 OK；01:14:08Z 打开了告警动作。根本问题还没修：在"告警先于数据源上线"的 Terraform 顺序下，这条告警一创建就必然误报。【补充】同一模式在 09-27 已经在 `automation-tick-missing` 和 `source-watch-missing` 两条告警上出现过（见改进项 4）。

## 时间线（UTC / 新西兰时间 NZDT，UTC+13）

| UTC | NZDT | 事件 | 证据 |
|---|---|---|---|
| 09-29 00:23:05 | 13:23:05 | H05 提交，新增合成检查的函数、定时器和告警 | `git show -s 64e442a`（13:23:05 +1300） |
| 00:26:07 | 13:26:07 | Terraform `PutMetricAlarm` 创建告警，参数为 `actionsEnabled=false`、`treatMissingData=breaching`、`evaluationPeriods=2`；同一秒 `CreateLogGroup` 建好 `/aws/lambda/developercards-synthetic-check`（creationTime 1790641567309 = 00:26:07.309Z） | CloudTrail `PutMetricAlarm`、`CreateLogGroup`；`describe-alarm-history`（Create 00:26:07.363）；`logs describe-log-groups` |
| 00:26:10–14 | 13:26:10–14 | 【补充】`CreateFunction` 失败 4 次，错误为 `InvalidParameterValueException: The role defined for the function cannot be assumed by Lambda`（IAM 角色刚建好，还没传播完）。Terraform 自动重试 | CloudTrail `EventName=CreateFunction20150331`（errorCode） |
| 00:26:18 | 13:26:18 | `CreateFunction` 成功，用的是占位 zip；version 1 的 LastModified 为 00:26:18.463，CodeSize 256 字节 | CloudTrail；`lambda list-versions-by-function`；`infra/modules/worker/synthetic.tf:11` |
| 00:26:24 | 13:26:24 | `CreateAlias prod→$LATEST`、`PutFunctionConcurrency`（1）、`PutFunctionEventInvokeConfig`（retry 0）；`CreateSchedule` 的 `state=DISABLED`、`rate(15 minutes)`（CreationDate 13:26:24.632+13:00） | CloudTrail（requestParameters）；`scheduler get-schedule`；`synthetic.tf:54` |
| **00:26:28.954** | **13:26:28** | **INSUFFICIENT_DATA → ALARM**。原因是 "no datapoints were received for 2 periods and 2 missing datapoints were treated as [Breaching]"，被评估的周期是 23:56Z 和 00:11Z | `describe-alarm-history --history-item-type StateUpdate`（HistoryData） |
| 00:33:01–00:34:35 | 13:33–13:34 | 【更正】SLO 告警这次 apply 共向 `developercards-alerts` 发了 **6** 条通知：2 条来自复合告警（`slo-api-availability-fast-burn`、`slo-sync-latency-fast-burn`，00:33:01），4 条来自指标告警（`slo-sync-latency-slow-burn`、`slo-publish-success-slow-burn`、`slo-publish-success-fast-burn`、`slo-api-availability-slow-burn`，00:33:26–00:34:35）。这 6 次都是新建告警 INSUFFICIENT_DATA→**OK** 的通知。本告警没有发通知 | `describe-alarm-history --history-item-type Action --alarm-types CompositeAlarm MetricAlarm`（00:00–02:00Z） |
| 00:38:49 | 13:38:49 | 【补充】devcards-admin 用 `aws-cli/2.18.5` 调 `DescribeAlarms`，读了本告警、`api-5xx` 和 `core-vpc-duration-p95`。当时本告警正处于 ALARM | CloudTrail `ResourceName=developercards-prod-synthetic-check-failing`（userAgent） |
| 00:46:03 | 13:46:03 | PR #525 合入 main（`6308761`），`64e442a` 包含在内 | `git show -s 6308761`；`git merge-base --is-ancestor 64e442a 6308761` |
| 00:48:55 | 13:48:55 | `deploy-python-lambda.sh` 部署 `6308761`：00:48:57 把 $LATEST 冻结为 version 1，00:48:58 alias→1，00:48:59 `UpdateFunctionConfiguration`，00:49:06 `UpdateFunctionCode`，00:49:14 发布 version 2，00:49:16 alias→2 | CloudTrail（PublishVersion 的 description："deploy-python-lambda.sh 2026-09-29T00:48:55Z 6308761"） |
| 00:49:48–49 | 13:49:48 | 第一次运行，冷启动（INIT_START 00:49:48.880），RequestId `80629b65-890e-4493-8983-caef5699838a`，Version 2。`SyntheticCheckSuccess=1`，`SyntheticCheckLatency=888` ms（REPORT Duration 890.69 ms），`api-health` 返回 200，`failedChecks=[]` | `logs filter-log-events`（00:00–06:00Z） |
| 00:49:51 | 13:49:51 | `UpdateSchedule state=ENABLED`，由 devcards-admin 执行 | CloudTrail UpdateSchedule；`scheduler get-schedule`（LastModificationDate 13:49:51.082+13:00） |
| **00:50:28.954** | **13:50:28** | **ALARM → OK**。00:35 周期的数据点为 1.0，另一个缺失数据点仍按 Breaching 计（"minimum 1 datapoint for ALARM -> OK transition"） | `describe-alarm-history`；`describe-alarms` 的 StateReason/StateReasonData |
| 00:50:31 | 13:50:31 | 第二次运行，成功，热启动。`SyntheticCheckLatency=893` ms（Duration 896.07 ms），RequestId `8e6abb0b-2f86-43cc-9ec2-709401390d94` | `logs filter-log-events` |
| 01:05:11 | 14:05:11 | 第三次运行，成功，`SyntheticCheckLatency=2209` ms（Duration 2211.84 ms）。之后每 15 分钟（:05/:20/:35/:50）都成功 | `logs filter-log-events`；`get-metric-statistics SyntheticCheckSuccess`（00:45–02:50Z 全部为 1.0） |
| 01:10:12 | 14:10:12 | 【补充】出现一次 INIT_START 和 AssumeRole，但没有 START 或 REPORT，`Invocations` 也没有对应计数（01:00 桶只有 1 次）。原因未能确认，可能是 Lambda 的预初始化。这条与本次事件无关 | `logs filter-log-events`（01:09–01:12Z）；CloudTrail AssumeRole；`AWS/Lambda Invocations` |
| 01:14:08 | 14:14:08 | `EnableAlarmActions`，由 devcards-admin 用 aws-cli 执行 | CloudTrail EnableAlarmActions；告警 ConfigurationUpdate（actionsEnabled=True，01:14:08.380） |
| 04:50:09–27 | 17:50:09–27 | 【更正】部署 `7fcc894`：04:50:11 `UpdateFunctionConfiguration`，04:50:17 `UpdateFunctionCode`，04:50:25 发布 version 3，04:50:27 alias→3。version 3 包含运行总时限修复 `b4a4cfe`。04:50:11 的定时运行仍在 version 2 上 | CloudTrail PublishVersion/UpdateAlias；`list-versions-by-function`（v3 LastModified 04:50:17） |
| 04:50:41 / 04:50:52 | 17:50:41 / 17:50:52 | 【补充】部署后有两次非定时调用，都在 version 3 上。04:50:41（RequestId `d4e73b12-…`）的 payload 不是 `{"job":"synthetic-check"}`，日志只有 `synthetic-skip`，没写指标。04:50:52（`ff8a4d30-…`）运行成功，耗时 765 ms。之后告警没有再变过状态 | `logs filter-log-events`（04:50:30–04:51Z）；`handler.py:21-23`（6308761）；告警历史只有两次 StateUpdate |

## 如何发现

- **没有实时通知。** 告警创建时 `actionsEnabled=false`（CloudTrail PutMetricAlarm；`infra/modules/observability/alarms_r18h.tf:16`），本告警的 Action 历史为 0 条（`describe-alarm-history --alarm-name … --history-item-type Action`）。所以 ALARM 期间没有往 `developercards-alerts` 发过邮件或通知。
- 【更正】SNS 主题 `developercards-alerts` 在 00:30Z 的 5 分钟桶里发布了 6 条消息，Delivered 也是 6（`get-metric-statistics AWS/SNS NumberOfMessagesPublished / NumberOfNotificationsDelivered`）。**这 6 条全部能对上来源**：
  - 2 条来自复合告警 `slo-api-availability-fast-burn` 和 `slo-sync-latency-fast-burn`（00:33:01）；
  - 4 条来自指标告警 `slo-sync-latency-slow-burn`、`slo-publish-success-slow-burn`、`slo-publish-success-fast-burn`、`slo-api-availability-slow-burn`。
  - 都是新建 SLO 告警进入 OK 时发的通知，和本告警无关。原文说"另外 2 条来源未能确认"，是因为 `describe-alarm-history` 默认只返回 MetricAlarm，查询时要加 `--alarm-types CompositeAlarm MetricAlarm`。
  - 01:15 桶的 3 条来自三个 slow-burn 复合告警在 01:16:14 的 OK 通知（WaitPeriod 结束后才发出）。
- 【更正】这次是事后查告警状态历史时发现的。ALARM 期间告警状态**被读取过**：00:26:37–00:35:06Z 之间 Terraform 读了 8 次（apply 中的 DescribeAlarms），00:38:49Z devcards-admin 用 aws-cli 读了一次（CloudTrail userAgent）。但 CloudTrail 不记录 DescribeAlarms 的返回内容，所以读的人有没有注意到 ALARM，**未能确认**。

## 影响

- **用户：无。** 告警期间（00:26:28–00:50:28Z，共 24 分钟）合成检查一次都没运行。`AWS/Lambda Invocations` 第一个数据点在 00:45 的 15 分钟桶（值为 2），第一次 START 在 00:49:49Z。所以告警反映的是"检查没在跑"，不是"服务坏了"。佐证：
  - API Gateway `ktbq1sie2c` 在 00:00–01:00Z 共 19 次请求，5xx 为 0（`get-metric-statistics AWS/ApiGateway Count/5xx`，period 3600）。这 19 次里有 4 次是 00:49 和 00:50 两次合成运行发出的探测请求（RUNBOOK:405 写明每次运行发 2 个 API 请求）。
  - 00:49:49Z 第一次运行时 `api-health` 返回 200，其余 4 项也都通过（`api-auth-guard` 返回预期的 401）。
- **数据：合成检查本身不写数据。** 五项检查都是 GET 请求（`infra/RUNBOOK.md:405`；日志里的 `checks`）。【更正】原文"这段时间没有任何写操作涉及用户数据"**未能确认**：本次没有查数据库或应用的写日志。能确认的只是本告警和合成检查与用户数据写入无关。
- **费用：可以忽略。** 告警期间 Lambda 调用次数为 0。00:00–06:00Z 函数 Errors 为 0、Throttles 为 0（`get-metric-statistics AWS/Lambda Errors/Throttles`）。具体金额**未能确认**：本次没有查 Cost Explorer。
- **监控覆盖：** 00:26–00:49Z 之间合成探测并不存在。这是首次上线本来就会有的空档，不是回归。

## 根因（附证据）

1. **告警比数据源先生效，而且缺数据按失败算。**
   - 告警定义：`SyntheticCheckSuccess`（`DeveloperCards`，`Service=synthetic-check`），`Maximum`，`Period=900`，`EvaluationPeriods=2`，`DatapointsToAlarm=2`，`LessThanThreshold 1`，`TreatMissingData=breaching`（`describe-alarms`；`alarms_r18h.tf:7-15`）。
   - 同一次 apply 里，函数只有占位代码（`synthetic.tf:11`；version 1 CodeSize 256），定时器创建时是 `DISABLED`（`synthetic.tf:54`；CloudTrail CreateSchedule `state=DISABLED`），所以这个指标从来没有数据。`get-metric-statistics` 查 09-28 20:00Z 起的数据，第一个点在 00:45Z。
   - CloudWatch 第一次评估（00:26:28Z）就把 23:56Z 和 00:11Z 两个周期按"缺数据=失败"处理，直接进入 ALARM（StateUpdate HistoryData 的 `evaluatedDatapoints`）。
2. **设计里预料到了"先别打扰人"，但没预料到会进 ALARM 状态。**
   - `alarms_r18h.tf:1` 的注释写明：因为定时器起始是 DISABLED，告警创建时关闭动作，"two good runs" 之后再打开。所以通知被压住了，但状态照样变成 ALARM。
   - `infra/RUNBOOK.md:527-528` 只写了"两次成功的定时运行后"执行 `enable-alarm-actions`，没有说明"上线阶段这条告警一定是 ALARM、属于预期"（`git grep` RUNBOOK 里所有含 ALARM 的句子，只有 SLO 相关的几句，见第 397、426、449–453 行）。
3. **恢复靠的是部署后的第一次运行，不是定时器。**
   - 告警在 00:50:28Z 转为 OK，依据的是 00:35 周期里 00:49:49Z 那次运行写出的 `SyntheticCheckSuccess=1`（EMF Timestamp 1790642989908 = 00:49:49.908Z）。
   - 那次运行早于 `UpdateSchedule ENABLED`（00:49:51Z），而 `deploy-python-lambda.sh` 自己不做 invoke（`services/deploy-python-lambda.sh:118-119` 写着 "no invoke"）。所以它大概率是 RUNBOOK 里那种部署后的手动受监督调用（`infra/RUNBOOK.md:516-518` "One supervised run"）。
   - 【补充】旁证：它的 RequestId `80629b65-890e-4493-…` 是随机 UUID。之后所有定时运行的 RequestId 都是 `8e6abbXX-XXXX-43cc-9ec2-709401390d94` 这种共享后缀的格式。04:50 那两次显然是手动的调用（`d4e73b12-…`、`ff8a4d30-…`）也是随机 UUID。
   - Lambda Invoke 是数据事件，`cloudtrail lookup-events EventName=Invoke` 查不到任何记录，所以调用来源**未能确认**。
   - 00:50:31Z 那次运行的 RequestId（`8e6abb0b-2f86-43cc-9ec2-709401390d94`）和之后每 15 分钟的定时运行同一模式，推断是定时器启用后的第一次触发（推断，未直接证实）。

## 处理过程

1. 00:48:55Z 起，用 `deploy-python-lambda.sh` 部署 `6308761`，alias `prod`→version 2（CloudTrail）。
2. 00:49:49Z 运行一次，成功（日志）。
3. 00:49:51Z 用 `update-schedule` 启用定时器（CloudTrail UpdateSchedule，devcards-admin）。
4. 00:50:28Z 告警自动转为 OK（告警历史）。
5. 定时运行 00:50:31Z、01:05:11Z 都成功后，01:14:08Z 执行 `enable-alarm-actions`（CloudTrail EnableAlarmActions）。【更正】这只是**部分符合** `infra/RUNBOOK.md:527-528`。"两次成功的定时运行"满足了，但括号里的"≥ 30 minutes with `SyntheticCheckSuccess = 1`"没满足：从第一个成功数据点（00:49:49.908Z）到 01:14:08Z 只有 24 分 18 秒。
6. 04:50Z 部署 `7fcc894`（version 3），后续运行全部成功（日志查到 05:50Z），告警没有再变过状态（告警历史只有 2 次 StateUpdate）。

## 改进项

**已做**

| 项 | 证据 |
|---|---|
| 告警创建时关闭动作，避免上线期误报打扰人（这次确实没发通知） | `alarms_r18h.tf:16`（`actions_enabled=false`），`git blame` 指向 `64e442a` |
| RUNBOOK 写明受监督调用、启停定时器、打开/关闭告警动作的步骤 | `infra/RUNBOOK.md:516-533`，`git blame` 全部指向 H06 commit `c4036e6`（13:30:16+13:00，已包含在 `6308761` 里） |
| 合成检查加了运行总时限（DNS、慢速回包都有上限），减少超时导致的真失败。与本次根因无关，属于同一组件的加固 | commit `b4a4cfe`（13:54:10+13:00，不在 `6308761` 里，在 `7fcc894` 里），于 04:50Z 部署为 version 3 |

**未做（建议）**

1. **上线阶段别让告警进 ALARM。** 二选一：
   - (a) 新建时用 `treat_missing_data = "notBreaching"`，启用定时器并跑出两次成功后再改成 `breaching`；
   - (b) 把告警的创建放到"代码部署 + 定时器启用"之后的单独一次 apply。
   - 目前 `alarms_r18h.tf:15` 仍是 `breaching`，`7fcc894..HEAD` 之间没有提交改过 `alarms_r18h.tf` 或 `synthetic.tf`（`git log`）。
2. **在 RUNBOOK 里写明预期状态。** 在 `infra/RUNBOOK.md` 合成检查小节注明：新建或定时器 DISABLED 期间，这条告警在约 20 秒内就会进 ALARM，属于预期，不要当事故处理。另外，计划内停用定时器时，即使执行了 `disable-alarm-actions`，告警状态同样会变成 ALARM。目前没有这句话（`git grep` 找不到）。
3. **让手动调用可追溯。** 部署后的受监督调用请在 payload 里或在调用后的日志里留下标记（比如 `"source":"manual"`），以后复盘能分清手动调用和定时调用。这次无法确认 00:49:49Z 那次调用的来源。【补充】04:50:41Z 还出现过一次 payload 不对、只记了 `synthetic-skip` 的调用，也说明手动调用需要更清楚的记录。
4. 【更正】**同一模式已经出现过，不只是"可能"。** `alarms_r18a.tf:93`（`automation-tick-missing`）和 `:119`（`source-watch-missing`）也用了 `treat_missing_data = "breaching"` 和 `actions_enabled = false`。告警历史显示两条都在 09-27 创建后一两分钟内进了 ALARM：
   - `automation-tick-missing`：12:07:40Z 创建，12:08:51Z ALARM，14:29:06Z OK；
   - `source-watch-missing`：15:37:10Z 创建，15:38:41Z ALARM，16:29:41Z OK。
   - 两条创建时动作都是关的，所以 ALARM 没有发通知。但 `automation-tick-missing` 在 14:28:06Z 打开动作后，14:29:06Z 恢复 OK 时**发了一条 OK 通知**。所以"先开动作、后恢复"的顺序会产生一条没有对应 ALARM 通知的 OK 消息。
   - 修复第 1 项时，应该把这三条告警一起处理。

## 经验

- `TreatMissingData=breaching` 加上"告警先于数据源上线"，新告警必然立刻 ALARM。CloudWatch 第一次评估会回看创建前的周期，不会等一个完整周期。本次 21.6 秒，09-27 的两条分别约 71 秒和 91 秒。
- 关闭动作只能挡住通知，挡不住状态。看板、复合告警，以及任何读告警状态的东西都会看到这次 ALARM。
- 心跳类告警（"没跑也算失败"）上线时要按顺序来：代码 → 启用定时器 → 确认有数据 → 创建或打开告警。最好把这个顺序写进 RUNBOOK 和 Terraform 结构里，不要只靠注释。
- 【补充】查账户里所有告警的 Action 或 StateUpdate 历史时，要加 `--alarm-types CompositeAlarm MetricAlarm`，否则复合告警会被漏掉。

## 证据清单

- `aws cloudwatch describe-alarms --alarm-names developercards-prod-synthetic-check-failing`：告警定义、当前状态 OK、ActionsEnabled=True、StateReasonData（queryDate 00:50:28.952）。
- `aws cloudwatch describe-alarm-history --alarm-name developercards-prod-synthetic-check-failing`：共 4 条记录。00:26:07.363 创建（actionsEnabled=false），00:26:28.954 ALARM，00:50:28.954 OK，01:14:08.380 actionsEnabled=True。本告警的 Action 记录为 0 条。
- 【更正】`aws cloudwatch describe-alarm-history --history-item-type Action --alarm-types CompositeAlarm MetricAlarm --start-date 2026-09-29T00:00:00Z --end-date 2026-09-29T02:00:00Z`：00:33:01–00:34:35Z 共 6 条（2 条复合告警、4 条指标告警）；01:11:14 三条被 WaitPeriod 压住；01:16:14 三条复合告警 slow-burn 发出。
- `aws cloudwatch get-metric-statistics DeveloperCards SyntheticCheckSuccess Service=synthetic-check`（09-28 20:00Z – 09-29 03:00Z，5 分钟）：第一个数据点在 00:45Z，此后全部为 1.0。
- `aws cloudwatch get-metric-statistics AWS/Lambda Invocations / Errors / Throttles FunctionName=developercards-synthetic-check`：Invocations 从 00:45 桶开始（值为 2），04:45 桶为 3；00–06Z 的 Errors 为 0、Throttles 为 0。
- `aws cloudwatch get-metric-statistics AWS/ApiGateway Count / 5xx ApiId=ktbq1sie2c`（00:00–01:00Z）：19 次请求，5xx 为 0。
- `aws cloudwatch get-metric-statistics AWS/SNS NumberOfMessagesPublished / NumberOfNotificationsDelivered TopicName=developercards-alerts`：00:30 桶 6 条，01:15 桶 3 条。
- `aws logs filter-log-events --log-group-name /aws/lambda/developercards-synthetic-check`（09-29 00:00–06:00Z，142 条事件）：第一次 START 在 00:49:49。之后所有 `synthetic-run` 都是 `ok:true`；04:50:41 有一条 `synthetic-skip`。
- `aws logs describe-log-groups`：creationTime 1790641567309（00:26:07.309Z），保留 30 天。
- `aws scheduler get-schedule --name developercards-synthetic-check`：`rate(15 minutes)`，ENABLED，创建于 13:26:24.632+13:00，修改于 13:49:51.082+13:00，目标是 `:prod`，MaximumRetryAttempts 0。
- `aws lambda list-versions-by-function` / `get-alias` / `get-function-configuration` / `get-function-concurrency`：
  - version 1 是 00:26:18.463 的占位代码（256 B）；
  - version 2 的 LastModified 是 00:49:06（`6308761`）；
  - version 3 的 LastModified 是 04:50:17（`7fcc894`，04:50:25 发布）；
  - alias `prod`→3；timeout 60 s，内存 256 MB，预留并发 1。
- `aws cloudtrail lookup-events`：
  - PutMetricAlarm 00:26:07Z（actionsEnabled=false，breaching，userAgent terraform）
  - CreateLogGroup 00:26:07Z
  - CreateFunction 失败 4 次（00:26:10–14Z），00:26:18Z 成功
  - CreateAlias / PutFunctionConcurrency / PutFunctionEventInvokeConfig / CreateSchedule（DISABLED）00:26:24Z
  - DescribeAlarms：00:26:37–00:35:06Z 共 8 次（terraform），00:38:49Z 1 次（aws-cli）
  - PublishVersion 00:48:57 / 00:49:14 / 04:50:25Z
  - UpdateAlias 00:48:58 / 00:49:16 / 04:50:27Z
  - UpdateFunctionConfiguration 00:48:59 / 04:50:11Z
  - UpdateFunctionCode 00:49:06 / 04:50:17Z
  - UpdateSchedule（ENABLED）00:49:51Z
  - EnableAlarmActions 01:14:08Z（aws-cli）
  - 查不到 Invoke 事件
  - 执行者都是 devcards-admin。
- 代码与文档（`HEAD` = `origin/main` = `5bc57f4`）：
  - `/Users/qc/src/recallsmith-sup/infra/modules/observability/alarms_r18h.tf:1-22`
  - `/Users/qc/src/recallsmith-sup/infra/modules/observability/alarms_r18a.tf:81-100,107-125`
  - `/Users/qc/src/recallsmith-sup/infra/modules/worker/synthetic.tf:1-69`
  - 【更正行号】`/Users/qc/src/recallsmith-sup/infra/RUNBOOK.md:405-411,441,516-533`
  - `/Users/qc/src/recallsmith-sup/services/deploy-python-lambda.sh:118-119`
  - `/Users/qc/src/recallsmith-sup/services/synthetic-check/src/synthetic_check/handler.py:20-23`（在 `6308761` 中）
  - `/Users/qc/src/recallsmith-sup/docs/delivery/r18-issues/H05-notes.md:23`
- Git：
  - `64e442a`（H05，13:23:05+13:00）
  - `6308761`（PR #525 合入，13:46:03+13:00）
  - `c4036e6`（H06 RUNBOOK §8，13:30:16+13:00，已包含在 `6308761` 里）
  - `b4a4cfe`（运行总时限，13:54:10+13:00，父提交是 `6308761`）
  - `7fcc894`（PR #532 合入，17:46:39+13:00）
  - 四个提交都在 `origin/main` 上。

## 核查记录

| # | 检查内容 | 命令或来源 | 结果 |
|---|---|---|---|
| 1 | 账户 | `aws sts get-caller-identity` | 622994489535，正确 |
| 2 | 告警定义和当前状态 | `aws cloudwatch describe-alarms --alarm-names developercards-prod-synthetic-check-failing` | Maximum/900/2/2/LessThan 1/breaching、当前 OK、ActionsEnabled=True 全部一致 |
| 3 | 告警全部历史 | `describe-alarm-history --alarm-name … --max-records 100` | 共 4 条：Create 00:26:07.363、ALARM 00:26:28.954、OK 00:50:28.954、actionsEnabled=True 01:14:08.380。评估周期 23:56Z/00:11Z、OK 依据 00:35 周期，均一致。原文"21 秒"实为 21.6 s，可以接受 |
| 4 | 本告警的 Action | `describe-alarm-history --alarm-name … --history-item-type Action` | 0 条，正确 |
| 5 | 全账户的 Action | `describe-alarm-history --history-item-type Action --alarm-types CompositeAlarm MetricAlarm`（00:00–02:00Z） | **原文有误**：不是 4 条，是 6 条。另 2 条是复合告警 fast-burn 在 00:33:01 发的。原文漏掉是因为默认只查 MetricAlarm。"另外 2 条来源未能确认"改为已确认 |
| 6 | 全账户的 StateUpdate | 同上，`--history-item-type StateUpdate`（00:20–01:30Z） | 6 次通知都是 SLO 告警 INSUFFICIENT_DATA→OK；01:15 桶 3 条对应 01:16:14 复合告警的通知 |
| 7 | 告警相关的 CloudTrail | `cloudtrail lookup-events ResourceName=developercards-prod-synthetic-check-failing` | PutMetricAlarm 00:26:07（actionsEnabled=false）和 EnableAlarmActions 01:14:08 正确。补充：ALARM 期间有 terraform 8 次、aws-cli 1 次（00:38:49）DescribeAlarms |
| 8 | 函数相关的 CloudTrail | `lookup-events ResourceName=developercards-synthetic-check`；`EventName=CreateFunction20150331 / CreateAlias20150331 / PublishVersion20150331 / UpdateAlias20150331 / UpdateFunctionCode20150331v2 / CreateSchedule / UpdateSchedule / CreateLogGroup / Invoke` | 原文所有时间点一致。补充两点：CreateFunction 在 00:26:10–14 失败 4 次；7fcc894 部署的完整时间是 04:50:09–27，原文写的 04:50:09–17 不完整。Invoke 查不到，正确 |
| 9 | 函数版本、alias、配置 | `lambda list-versions-by-function`、`get-alias`、`get-function-configuration`、`get-function-concurrency` | v1 00:26:18.463、v2 00:49:06、v3 04:50:17，alias prod→3，description 中的 commit 均一致 |
| 10 | 定时器 | `scheduler get-schedule --name developercards-synthetic-check` | rate(15 minutes)、ENABLED、13:26:24.632 / 13:49:51.082、:prod、retry 0，正确 |
| 11 | 日志组 | `logs describe-log-groups --log-group-name-prefix /aws/lambda/developercards-synthetic-check` | creationTime 1790641567309 = 00:26:07.309Z，保留 30 天，正确 |
| 12 | 运行日志 | `logs filter-log-events`（00:00–06:00Z，以及 01:09–01:12、04:50:30–04:51、00:49:40–00:50:40 三个窗口） | RequestId、888/893/2209 ms（都是 SyntheticCheckLatency，REPORT Duration 分别为 890.69/896.07/2211.84 ms）、200、failedChecks=[] 一致；EMF Timestamp 1790642989908 = 00:49:49.908Z。补充：01:10:12 有 INIT_START 但没有调用；04:50:41 有一次 synthetic-skip；04:50:52 有一次手动成功运行 |
| 13 | 指标 SyntheticCheckSuccess | `get-metric-statistics DeveloperCards SyntheticCheckSuccess`（09-28 20:00Z – 09-29 03:00Z，300 s） | 第一个点在 00:45Z，之后全部为 1.0，正确 |
| 14 | Lambda Invocations/Errors/Throttles | `get-metric-statistics AWS/Lambda …`（00–06Z） | Invocations 从 00:45 桶开始（2），Errors 0，Throttles 0，正确 |
| 15 | API Gateway | `get-metric-statistics AWS/ApiGateway Count/5xx ApiId=ktbq1sie2c`（00–01Z，3600 s 和 300 s） | 19 次、5xx 0，正确 |
| 16 | SNS | `get-metric-statistics AWS/SNS NumberOfMessagesPublished/NumberOfNotificationsDelivered` | 00:30 桶 6 条、01:15 桶 3 条，正确；Delivered 与 Published 相同 |
| 17 | Git 提交与时间 | `git show -s` 查 64e442a / 6308761 / c4036e6 / b4a4cfe / 7fcc894；`git merge-base --is-ancestor` | 时间和标题全部一致；64e442a∈6308761；b4a4cfe∉6308761、∈7fcc894；c4036e6∈6308761；全部在 origin/main 上 |
| 18 | Terraform 行号 | `nl alarms_r18h.tf`、`synthetic.tf`；`git blame -L 15,16` | :1 注释、:7-15 定义、:15 breaching、:16 actions_enabled=false（来自 64e442a）、synthetic.tf:11 占位 zip、:54 DISABLED，全部正确 |
| 19 | RUNBOOK 行号 | `git show HEAD:infra/RUNBOOK.md`；`git blame -L 516,533` | "One supervised run" 在 516 行，enable 步骤在 527-528 行，521-533 来自 c4036e6，正确。原文"404-410"应为 405-411（差一行，已更正） |
| 20 | RUNBOOK 是否写了"预期 ALARM" | `git grep -i -E "expected.*ALARM\|…" HEAD -- infra/RUNBOOK.md` | 没有合成检查相关的说明，原文结论正确 |
| 21 | 是否已有修复 | `git log 7fcc894..HEAD -- alarms_r18h.tf synthetic.tf` | 没有提交，"仍是 breaching"正确 |
| 22 | deploy 脚本不做 invoke | `nl services/deploy-python-lambda.sh` 105-130 行；`grep invoke` | 第 119 行 "no invoke"，正确 |
| 23 | handler 跳过逻辑 | `git show 6308761:…/handler.py` | 只有 `{"job":"synthetic-check"}` 会运行，否则记 `synthetic-skip`、不写指标；可以解释 04:50:41 那次 |
| 24 | H05 notes | `git show HEAD:docs/delivery/r18-issues/H05-notes.md` 第 23 行 | 写着 "alarms_r18h.tf (new) … actions disabled"，正确 |
| 25 | 同类告警 | `describe-alarm-history` 查 `developercards-prod-automation-tick-missing` 和 `developercards-prod-source-watch-missing`（StateUpdate、ConfigurationUpdate、Action） | **原文写"未核实"，现已核实**：两条都在 09-27 创建后约 71 秒和 91 秒进入 ALARM，创建时 actionsEnabled=false；tick-missing 打开动作后在恢复 OK 时发了 1 条 OK 通知 |
| 26 | RUNBOOK 合规 | 计算 01:14:08 − 00:49:49.908 | 24 分 18 秒，不足 RUNBOOK 要求的 "≥ 30 minutes"。"符合"改为"部分符合" |
| 27 | 数据写入、费用金额、ALARM 是否被人注意到 | — | 未能确认：没查数据库或应用写日志、没查 Cost Explorer；CloudTrail 不记录 DescribeAlarms 的返回内容 |

我只运行了 describe、list、get、filter、lookup 这类只读命令，没有改动账户或仓库里的任何状态。