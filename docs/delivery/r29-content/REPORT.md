# R29 内容来源回填与 AWS 复核报告（2026-10-04）

分支 `content/sources-backfill`（`/Users/qc/src/recallsmith-src`）。只做了本地提交：没有 push，没有开 PR，没有写生产，没有导入或发布卡组，AWS 只做了只读访问。

## 1. 覆盖率

| 卡组 | 卡数 | 之前（线上） | 之后（本分支） | 仍无来源 |
|---|---|---|---|---|
| csharp-basics | 217 | 217（100%） | 217（100%） | 0 |
| claude-ccdv-f | 441 | 109（24.7%） | 434（98.4%） | 7 |
| aws-saa-c03 | 371 | 20（5.4%） | 366（98.7%） | 5 |

"之后"指本分支的卡组文件。要等 owner 导入并发布，线上才会变成这样。

## 2. 数量
- **回填**：622 张中加了 614 张，放弃 8 张。AWS 289/290，CCDV-F 325/332。
- **复核 61 张 AWS 线上卡**：
  - 48 张两位核查员都判正确，已加来源。
  - 9 张两位都指出同一个问题，我在官方页面上确认后改了答案，也加了来源。
  - 4 张两位意见不一致，没有改。
- **本轮新增来源**：57 张卡、56 个 URL，全部带引用，用 watcher 自己的代码核对，0 失败。
- **逐卡记录**：`docs/delivery/r29-content/verify-applied.json`。

## 3. 已修正的 9 张卡
只改了 A: 正文，uid、顺序、题干、USAGE、难度都没动。

| uid | 问题 | 改前 → 改后 | 来源 |
|---|---|---|---|
| aws-cognito-user-pool-vs-identity-pool | refresh token 不是可校验的 JWT，它是加密、不透明的 | "(ID, access and refresh) … verify directly." → "ID and access tokens as OIDC JSON web tokens … plus an encrypted refresh token that only the user pool can read." | cognito …using-tokens-with-identity-providers.html |
| aws-s3-block-public-access | RestrictPublicBuckets 也阻断公开访问；设置层级有组织、账号、桶、access point 四级 | "cross-account access … account level and bucket level" → "public and cross-account access … organisation, account, bucket and access point level" | S3 access-control-block-public-access.html |
| aws-s3-encryption-options-sse | Bucket Key 让 CloudTrail 只记桶 ARN，削弱逐对象审计；2026 年 4 月起新的通用桶默认禁用 SSE-C | 两句末尾各补一个限定 | S3 bucket-key.html（另见 serv-side-encryption.html） |
| aws-cloudhsm-vs-kms | 集群备份由 CloudHSM 自动完成 | "own availability, backups and scaling" → "own availability and scaling by adding HSMs, while CloudHSM still takes periodic cluster backups automatically" | cloudhsm backups.html |
| aws-elb-deregistration-delay | 不必等满整个 delay：in-flight 请求完成或超时，先到者为准 | "the full delay must elapse…" → "Auto Scaling waits until in-flight requests finish or the delay expires…" | ELB edit-target-group-attributes.html |
| aws-cloudfront-origin-failover | 连接失败对应 503，超时对应 504，是一对一的 | "cannot be reached or times out once 503 and 504 are listed" → "cannot connect to it (when 503 is listed) or its response times out (when 504 is listed)" | CloudFront high_availability_origin_failover.html |
| aws-ebs-multi-attach-io2 | io1 现在也支持 NVMe reservations | "io2 supports…, io1 does not." → "Both io1 and io2 support NVMe reservations… (on by default for io2 created after 18 Sep 2023 and io1 created after 1 Oct 2026)" | EBS nvme-reservations.html |
| aws-appsync-graphql | DataStore 只在 Amplify Gen 1 里，Gen 1 在 2027-05-01 停止支持 | DataStore 那句 → "sync operations on versioned DynamoDB data sources let a client that was offline fetch only the data changed since its last query." | AppSync conflict-detection-and-sync.html |
| aws-compute-optimizer-and-rightsizing | 内存指标现在可以从外部可观测性产品接入；Trusted Advisor 新的 EC2 检查会给出目标资源 | 内存句和陷阱句都改了 | compute-optimizer external-metrics-ingestion.html（另见 cost-optimization-checks.html） |

## 4. 闸门
1. lint 0 issues，exit 0，warnings 189/152/0 与之前相同。
2. plan-vs-live：CCDV-F exit 0。AWS 在 `10cd57f` 时 exit 0；在 HEAD 时按设计 exit 1，只列出上面 9 张卡，字段都是 [explanation, source]。
3. 卡片导出 `--check` 通过。
4. 前端测试 59/59、1511/1511。
5. evals 的 export-sources、seed v1/v2/v3 检查全部通过，pytest 345 通过。
6. AWS 与 origin/main 的 diff 里删掉的 9 行，正好是这 9 张卡的旧 A: 行。

seeded-v1 能保持不变，靠的是 `evals/data/seeded-v1-pins.json`。思路和 R20 一样：冻结基准不跟着卡组修正变化。

## 5. 需要 owner 决定的事项

### 5.1 意见不一致的 4 张 AWS 卡（没改，也没加来源）
- **aws-sqs-message-retention-and-size**：答案里说"考试题还用 256 KB"，这没有官方来源。What's New（2025-08-04）确认限制从 256 KiB 提到了 1 MiB。建议采纳第二位核查员的改法。
- **aws-data-transfer-costs-az-region**："you pay only CloudFront egress"漏了按请求计费，也和 aws-cloudfront-cost-reduction 那张卡矛盾。另外，EC2 定价页的价格是 JS 渲染的，watcher 抓不到引用，需要换来源页。建议采纳第二位。
- **aws-cloudwatch-alarm-vs-eventbridge-rule**：USAGE 里的 EMF 对这个场景没必要，请 owner 判断。
- **aws-cloudwatch-logs-metric-filters-and-insights**：干扰项已过时，2026-07 推出了 CloudWatch Log Alarms，Alarm-On-Logs.html 现在列出了 Log Alarm 这种做法。建议采纳第二位。

### 5.2 回填时放弃的 8 张卡
- CCDV-F 3 张写的是 Opus 5，页面现在是 Opus 5.5，要先改卡：opus-sonnet-haiku-use-cases、choosing-a-model-two-approaches、model-lineup-price-context。
- CCDV-F 4 张 MCP 卡唯一的来源是 modelcontextprotocol.io，要不要加进白名单？
- AWS 的 aws-glue-etl-and-catalog 需要单独复核一轮。

### 5.3 已加来源但要看一眼的 4 张 CCDV-F 卡
- **max-tokens-vs-effort-vs-task-budget**、**rerun-failures-higher-effort**：卡上的 Opus 5 数字页面上已经没有了，现在是 Opus 5.5 的数字。
- **mcp-connector-request-shape**：页面多了新 header `mcp-client-2026-09-15`，旧的仍在主示例里，卡没有错。
- **readonly-assistant-allowlist-mcq-07**：说 allowlist 最安全，和推荐 denylist 的另外两张卡矛盾。

### 5.4 其他
- **9 张修正卡默认不升 revision**：只改了答案细节，没改正确答案或题干。要提示学习者"已更新"，请在控制台手动升。
- **只有一位核查员提出、没改的**：elb-deregistration-delay 的 USAGE 行略有夸大。
- **判为正确、只提了细节的**：IMDSv2 hop limit 在某些默认设置下是 2；Route 53 已改名为 VPC Resolver；EBS 增量复制还要求最近一份副本没被归档；Trusted Advisor 的 Low utilization 已是 legacy 检查；Session Manager 可以用 DHMC 代替 instance profile。s3-lifecycle-rules-minimums 依赖 2026-07-16 的规则变化，不要回退到旧资料。
- platform.claude.com messages 页面约 5.1 MB，接近 watcher 的 5 MiB 上限。
- **Dependabot**：本分支比 origin/main 落后两个提交（#755，mobile vitest），可以无冲突合并。
- **评估改动**：请审一下提交 1413793 的 evals 改动。

## 6. 上线步骤
这些是生产写操作，只有 owner 或经 owner 批准的 supervisor 执行，worker 不执行。

1. 控制台 https://console.developercards.app（或 https://d12pfy1rhi3ekm.cloudfront.net）→ Decks > aws-saa-c03（deckId 13）> Cards > Import Markdown，路由 `/decks/cards/import?deckId=13`。
2. 粘贴完整的 `content/decks/aws-saa-c03.md`，点 Preview import。
3. 核对预览：create 0，update 346，unchanged 25，conflict 0，没有 slug-mismatch 横幅。337 行的 detail 只有 source；上面 9 张卡的 detail 是 "explanation, source"。出现其他字段说明数据库里有没发布的编辑，**停下**。
4. 点 Import，会发 `POST /api/v1/authoring/cards/import {deckId, cards}`：一个事务，最多 500 张，按 (deckId, stableUid) upsert，`uq_cards_deck_order` 延迟检查。orderInDeck 不变，不升 revision。
5. 再点一次 Preview import，必须全部显示 unchanged。
6. Decks > Publish，会发 `POST /api/v1/authoring/publish {deckId, note}`。等 `GET /api/v1/authoring/publish/jobs` 显示 SUCCESS。
7. 对 claude-ccdv-f（deckId 14）重复以上步骤。预期 update 325，unchanged 116，每行 detail 都只有 source。

发布后验证（只读）：
- 跑 `node docs/delivery/r29-content/plan-vs-live.mts content/decks/<slug>.md`，要看到 sourcesLive == sourcesFile（AWS 366，CCDV-F 434）且 updates 0。
- 或者查 https://d1ditdi9jqpy6n.cloudfront.net/content/manifest.json 和新的 deck.json。

source-watcher 不需要部署。相比 origin/main 一共新增 345 个 URL（本轮新加 47 个），每次查 60 个，第一遍大约 6 小时。

R20 的 set_sources.py 只写 source，不会带上这 9 处 explanation 修正，所以这次请走控制台导入。
