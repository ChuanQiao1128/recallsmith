# 选择题卡型（MCQ）方案：给有真题的考试做"选、判、讲、排期"（2026-09-18）

> 状态：**方案，未改代码**。评审方式：4 条代码触点扫描（内容流水线 / 复习会话 / 事件与分析 / 抽卡与产品规则）→ 4 个不同优先级的独立设计（最小改动 / 学习科学 / 内容优先 / 产品体验）→ 3 个评委打分 → 合成 → 2 个反方逐条对照代码挑刺（**18 条，0 条阻断，全部已回写进本文**）。
> 代码基线：`main@b1ecb8c`。本文行号以该基线为准。
> 前置文档：`docs/gacha-acquisition-learning-loop-plan.md`（产品裁决）、`mobile/gacha-v7.md`（会话/奖励规则）、`docs/console-import-plan.md`（Markdown 录题格式）、`docs/content-delivery-v3.md`（分块交付）。

---

## 0. 结论先说

1. **能做，而且不用碰调度器、事件和分析的契约。** MCQ 不是新卡型替换旧卡型，是"叠加"在现有 Q/A 卡上的第二种格式：`cards` 表加一列 `mcq jsonb`，deck.json 里多一个可选 `mcq` 块，手机端多一个可选字段。`Question` 仍是题干，`Explanation` 仍是答案（且对 MCQ 卡强制非空、**不含字母**）。所以 1.4.x / 1.5.0 老客户端拿到新卡组后看到的是一张完整的场景 Q/A 卡，不需要强制更新。
2. **"按答对次数排期"就是现有的 stage 计数器。** 答题结果（对 / 部分对 / 错 × 自信 / 不自信 × 改没改选项 × 快慢）通过一个纯函数映射到现有四档 `again / hard / good / easy`，再走 `scheduleNextReview`。不加第五档评分、不加调度分支、不加进度字段——`review/model.ts`、`storage.ts`、`sessionStore`、奖励、连续天数、`progressSync`、后端 ingest、Snowflake 的 rating 白名单全部不动。
3. **那份 1019 题的 PDF 不能进 App。** 它是考试题库泄露转载；你的产品计划（`gacha-acquisition-learning-loop-plan.md:26-27`）本来就规定 AWS 卡片独立创作。它能贡献两样东西：题型格式（已从考试大纲知道：1 选 4、2 选 5、3 选 6，场景题干 + 限定词）和**主题频率**（只记编码不记文本，第 1 节）。另外一个副产品：910 题有社区投票，**38% 的题社区最高票 ≠ "官方答案"**——题库自己的答案都不可靠，这正是"每个错误选项都要有 WHY、答案要有 AWS 文档出处"的理由。
4. **一个人做的工作量：** Phase 1 服务端 + 控制台 9 天，Phase 2 手机端 1.6.0 10 天，Phase 3 分析分区 + 首批 15 题 2 天 + 8 小时写题，Phase 4 打磨 3 天。约 5 周开发 + 写题时间（每题 25–35 分钟）。
5. **要你先裁决 12 件事**（第 11 节），最要紧的 5 件：154 张现有 AWS 卡不转换、只追加新 uid；多选"只错一个"算 hard；先看题干再看选项（可远程关）；提交按钮是 "Sure / Not sure"；答错 → again → 不保连续天数（沿用现规则）。

---

## 1. 从题库学到的（只有频率，没有题目）

方法：`pdftotext` 抽文本后按 "Question #N" 切块，只统计结构和关键词；没有任何题干、选项、解释或评论进入本仓库或产品。

| 指标 | 数值（n = 1019） |
|---|---|
| 单选（官方答案 1 个字母） | 898（88%） |
| 多选 | 121（12%）："Choose two" 109、"Choose three" 14 |
| 选项个数 | 4 个：895（88%）；5 个：108（11%）；6 个：14（1%） |
| 题干长度 | 中位 64 词，p90 91 词，最长 141 词 |
| 限定词 "MOST cost-effective" | ≈ 131（13%） |
| 限定词 "LEAST operational overhead" | ≈ 131（13%） |
| 含 "MOST …" / 含 "LEAST …" | 各 ≈ 20% |
| "highly available / high availability" | 81（8%） |
| 提到 cost | 220（22%）；secur*：151（15%）；encrypt：61（6%） |
| **社区最高票 ≠ 官方答案** | **350 / 910（38%）** |
| 社区最高票 < 70%（争议题） | 112 / 910（12%） |

服务出现频率（题干 + 选项里至少出现一次）：EC2 46% · S3 39% · Lambda 26% · RDS 19% · ELB/ALB/NLB 16% · Auto Scaling 15% · VPC 12% · IAM 11% · DynamoDB 10% · ECS/Fargate/EKS 9% · CloudFront 9% · EBS 8% · CloudWatch 8% · Aurora 7% · SQS 7% · API Gateway 7% · KMS 6% · EventBridge 6% · EFS 6% · SNS 6% · Route 53 5% · Savings Plans/RI/Spot 5% · ElastiCache 5% · Glacier 5% · Organizations 4% · Systems Manager 4% · Kinesis 4% · VPN 4% · FSx 4% · Direct Connect 4% · DataSync 4% · Athena 4%（其余 < 4%）。

对设计的三条推论：
- 题型只需要支持 **3–6 个选项、1–3 个正确答案**；单/多选由正确答案个数推导，不单独存。
- 限定词（LEAST / MOST / BEST / FEWEST…）是这门考试的签名，卡片要把它单独标出来并在题干里加粗；"Choose two" 不是限定词，是题型。
- 38% 的官方 / 社区分歧意味着：**正确答案必须能用 AWS 文档证明，错误选项必须能说出"错在哪一条"**。这比"给个答案"重要得多，也是这套卡型相对题库的价值。

合法边界（`gacha-acquisition-learning-loop-plan.md:26-27, :260, :422`）：不抄、不改写、不翻译题库的题干 / 选项 / 解释 / 评论；频率表以私有表格存放在仓库外，只记编号、题型、服务代码、限定词类别、推测的考试域、是否争议，用完归档；每批导入前用仓库外脚本把新题和题库做 8 词 shingle 比对，通过后在 ledger 记 `similarityCheckedAt`（第 10 节）。

---

## 2. 设计原则（一句话版）

| 原则 | 落到哪 |
|---|---|
| 叠加，不替换 | `mcq` 为空 = Q/A；有 `OPT:` = MCQ；同一卡组可以混 |
| 四档评分不变 | `mapMcqVerdictToRating` 是纯函数，在 `handleRating` 之前把结果变成四档之一 |
| 答案不含字母 | 选项每次乱序、字母按位置分配；老客户端看不到选项，所以 `A:` 和 `WHY:` 必须用文字说清方案，不能写 "Option B" |
| 追加，不插入 | MCQ 新题永远追加在整份卡组 Markdown 文件末尾；`orderInDeck` 是文件位置 × 10，中间插入会撞 `uq_cards_deck_order` |
| 老客户端优雅降级 | API 强制 MCQ 行的 `explanation` 非空且不含字母；1.4.x / 1.5.0 的 mapper 丢掉 `mcq`，渲染题干 + 答案 |
| 有 kill switch | remote config `features.mcq.enabled / recallFirst / maxPerRun / answerTelemetry`，下次冷启动生效 |
| 不做考试模拟器 | 没有计时、没有分数、没有正确率百分比、没有"通过概率"；话术只讲记忆 |

---

## 3. 数据模型

### 3.1 PostgreSQL（新迁移 `src_C/Vpc/Db/Migrations/019_cards_mcq.sql`，一条语句）

```sql
alter table cards add column if not exists mcq jsonb null;
```

不加 `card_format` 列（格式 = `mcq is not null`），不加 jsonb 的 CHECK（形状在 API 边界 `McqValidation.Canonicalize` 和 publish 门禁校验）。`uq_cards_deck_uid`、`uq_cards_deck_order`（`001_init.sql:52-53`）不动。

一个现状要补：`question` 今天是必填（`Cards.cs:105-111`），但 `explanation` **不是**（`Cards.cs:127` 允许 null，PUT `:240` 接受 null，Worker 导出 `?? ""`，只有 Markdown 导入强制 `A:`）。老客户端渲染的就是 `Explanation`，所以 API 对 MCQ 行加规则：POST 里 `mcq` 非空但 `explanation` 为空 → `MCQ_EXPLANATION_REQUIRED`；PUT 在事务里 `UPDATE … RETURNING mcq, explanation` 后检查，不满足就回滚；`Publish.cs` 入队前再查一遍。

进度表、事件表、outbox、Content Intelligence 快照表在 Phase 0–4 **不动**。

### 3.2 `mcq` 的规范形状（API 校验后写入；Worker 原样透传 `JsonElement`）

```json
{
  "v": 1,
  "qualifier": "LEAST operational overhead",
  "shuffle": true,
  "options": [
    { "key": "a", "text": "…", "why": "…",  "correct": false },
    { "key": "b", "text": "…", "why": null, "correct": true  }
  ]
}
```

规则（导入器、API、publish 门禁、手机端 `normalizeMcq` 四处一致）：`v === 1`；3–6 个选项；`key` 小写 a–f、按存储顺序连续、唯一（它是分析用的稳定 id，**永远不是显示字母**）；`text` 非空 ≤ 600 字符；`correct` 布尔；`requiredCount = count(correct)` ∈ {1, 2, 3} 且 < 选项数；每个 `correct=false` 的选项必须有非空 `why`，正确选项的 `why` 可选；`qualifier` 可选，必须原样（不区分大小写）出现在题干里，且不能匹配 `/choose (two|three)/i`；`shuffle` 默认 true。**单选 / 多选由 `requiredCount` 推导，不单独存。** 调换选项顺序会改 key，属于内容变更。

PG jsonb 的键顺序是"先长度后字节"，所以存进去再读出来是 `{"v":1,"options":[{"key":..,"why":..,"text":..,"correct":..}],"shuffle":..,"qualifier":..}`——Worker 的字节级黄金测试要按这个顺序钉，不是按上面的书写顺序。

### 3.3 Worker 导出（`src_C/Worker/S3/IS3DeckUploader.cs:50-61` `CardExportData`）

在 `Topic` 之后追加（`Topic` 由 Wave C 的 C05 先落地，C00 §6 #2）；现有 9 个键与 `topic` 的字节保持一致：

```csharp
[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
public JsonElement? Mcq { get; set; }
```

这个 attribute 是承重的：`ContentJson.Options`（`ContentJson.cs:11-15`）只有 CamelCase + 不缩进，没有 null 忽略；不加它，每张 Q/A 卡都会多出 `"mcq":null`，`ContentSerializationContractTests.cs:28-45` 会红。Worker 的 mapper（`PublishJobProcessor.cs:119-148`）用 `JsonSerializer.Deserialize<JsonElement>(s)` 拿到一个自有副本，**不能**用 `JsonDocument.Parse(s).RootElement`——文档会在 `S3DeckUploader.cs:74` 序列化前被 dispose。

### 3.4 deck.json / chunk / delta 里的一张卡（camelCase，只增不改）

```json
{"stableUid":"aws-sqs-order-buffer-mcq-01","orderInDeck":1540,"difficulty":2,"question":"<题干>","explanation":"<不含字母的答案>","codeLanguage":null,"codeSnippet":"","realWorldUsage":"…","revision":1,
 "mcq":{"v":1,"options":[…],"shuffle":true,"qualifier":"LEAST operational overhead"}}
```

有 `topic`（Wave C C05）时它排在 `revision` 之后、`mcq` 之前；`mcq` 缺席 = Q/A。deck.json 的 `version`（= buildId）、package.json `schemaVersion 1`、delta `schemaVersion 2`、manifest `schemaVersion 2` **都不升**（`content-delivery-v3.md:34`；`deckRepository.ts:912-922, 1158-1166`；`chunkedInstall.ts:106`）。manifest 不加新键（`ManifestRebuild` 从不读 `cards`，加 `mcqCount` 要新聚合查询而且没人用——否决）。

### 3.5 DeckDiff / 补丁

`DeckDiff.CardChanged`（`DeckDiff.cs:60-71`）加 `|| !McqEquals(a.Mcq, b.Mcq)`，用 `JsonNode.DeepEquals` **结构比较**。反方抓到的坑：当前侧来自 `DbUtil.QueryAsync`（`DbUtil.cs:24`，PG jsonb 文本带 `": "` 分隔），上一版来自紧凑的 deck.json（`ContentArtifactsGenerator.cs:209-211`），原始字符串永远不相等，按文本比较会让每张 MCQ 卡每次发布都算 `updated`。不比较则"只改选项 / WHY"的更新到不了走补丁的客户端。

### 3.6 Authoring API 的响应

Npgsql 把 jsonb 列交给 `DbUtil` 的是 .NET `string`，不转换的话 API 会吐 `"mcq":"{\"v\": 1, …}"`（一个 JSON 编码的字符串）。新增共享 helper `Helpers.JsonbCell(row, "mcq")`，在 `Cards.cs` GET / POST RETURNING / PUT RETURNING、`CardsPage.cs` 分页、`Publish.cs` 预览这五处统一转成对象；控制台**不**做防御性解析，用一个 API 测试钉住 `ValueKind == Object`。

### 3.7 控制台类型

`frontend/src/types/card.ts` `Card.mcq: McqBlob | null`；`DeckCardContent.mcq?: McqBlob` 对 Q/A 卡**省略**（`deckImport.test.ts:85-98` 的 `toEqual` fixture 才不会红）；`createCard` / `updateCard` 加 `mcq?: McqBlob | null`，清空时显式发 `mcq: null`。

### 3.8 手机端（`mobile/src/types/deckExport.ts`）

```ts
export interface McqOption { key: string; text: string; why: string | null; correct: boolean }
export interface McqExport { v: 1; qualifier: string | null; shuffle: boolean; options: McqOption[] }
export interface CardExport { /* 现有 9 个字段不动 */ Mcq?: McqExport | null }
```

新纯模块 `features/gacha/mcq/normalizeMcq.ts`：`normalizeMcq(raw): McqExport | null`，永不抛，任何违规 → `null` → 按 Q/A 渲染。`isMcqCard(card, flags)` 只有 `card.Mcq` 非空**且** `flags.mcq.enabled !== false` 才为 true。两个安装 mapper（`deckRepository.ts:1611-1624` 和 `:1671-1684`）各加一行 `Mcq: normalizeMcq(c.mcq)`。分块拼装和 `applyDelta` 本来就整对象落盘。

**进度模型不加字段**（`storage.ts:143-189` 白名单不动）：MCQ 的知识状态完全由映射后的评分通过 stage / lapses / hardStreak 表达，多设备合并不需要任何新东西。

### 3.9 Remote config + feature flag store

`remoteConfig.ts:19-25` 的类型今天只有 `{ ios? }`，追加：

```ts
features?: { mcq?: { enabled?: boolean; recallFirst?: boolean; maxPerRun?: number; answerTelemetry?: boolean } }
```

缺省：enabled=true、recallFirst=true、maxPerRun=2、answerTelemetry=false。反方指出今天**没有**读 flag 的管道：配置只在 `useForceUpdateGate`（`forceUpdateGate.ts:42`）里拉一次然后丢掉。所以新增 `config/featureFlags.ts`：模块级快照，`getFeatureFlags()` 同步读、`applyRemoteFeatures(config)` 合并缺省、`useFeatureFlags()` 用 `useSyncExternalStore`；`useForceUpdateGate` 在 `loadRemoteConfig` 返回后立刻调 `applyRemoteFeatures`。**延迟老实说**：下次冷启动生效（`loadRemoteConfig` 先网络后 last-good），永远不在会话中途翻转；`SessionCardScreen` 在把卡设为 current 的同一批次里读 flag 并存 `renderAsMcq`，配置中途到达不会重绘已打开的卡。

### 3.10 难度

MCQ 卡只能 d1–d3：稀有度 = 难度（`cardRarity.ts:5-9`），且快照表 `stated_difficulty in (1,2,3)` 的 CHECK（`010_content_intelligence_snapshot.sql:45-46`）会让一整批快照导入回滚（`ContentIntelligenceSnapshotImport.cs:244-283`）。导入器对带 `OPT:` 的卡报 `MCQ_DIFFICULTY_RANGE`，publish 门禁再拦一次；Q/A 卡的 d0–d4 范围不动。

---

## 4. 录题格式（Markdown 扩展）

### 4.1 语法

在现有 `## <uid> | d<1-3>` / `Q:` / `A:` / `CODE:` / `USAGE:` 之上，加两个可重复的列 0 块标记和一个单行标记，卡内任意顺序：

- `OPT: <key>` 开一个选项；`OPT: <key> *` 标记正确；正文到下一个标记为止。key 是单个字母 a–f（大写接受、归一化为小写），必须按文件顺序连续。
- `WHY:` 开上一个 `OPT:` 的解释。
- `QUALIFIER: <phrase>`（单行，最多一次）：限定词，手机端在题干里加粗。**它不是题型**："Choose two/three" 由星号个数推导并和题干核对（`MCQ_CHOOSE_N_MISMATCH`）；`QUALIFIER:` 写成 choose-N 报 `MCQ_QUALIFIER_IS_CHOOSE_N`。

有至少一个 `OPT:` 的卡就是 MCQ；没有 `OPT:` 的文件和今天解析得一模一样。`Q:` `A:` 仍必填。词法器本来就丢空行（`deckImport.ts:24-28`），所以题干**不保留段落**——写成连续行，手机端渲染成一段。

### 4.2 放置规则

MCQ 题**追加**在整份卡组文件末尾（前面是现有 154 张），不另开文件、不插中间。原因：`orderInDeck` = 文件位置 × 10（`deckImport.ts:258`）且参与比较（`:521`）；runner 按文件顺序逐张写（`deckImportRunner.ts:158-166`），`Cards.cs` 不处理 23505——两张卡的单独文件会规划成 order 0 和 10 与线上撞 `uq_cards_deck_order`；中间插一张会把后面每张后移 10，第一张被移动的就撞上还没移的邻居。追加得到 1540、1550…，154 张现有卡全部 unchanged。

### 4.3 完整示例（整份 `aws-associate-architect` 文件的最后两张；独立创作，取材自 AWS 文档和我们自己的流水线）

```markdown
# deck: aws-associate-architect

## … 现有 154 张 Q/A 卡，不动 …

## aws-sqs-order-buffer-mcq-01 | d2
QUALIFIER: LEAST operational overhead
Q:
An order API runs on Amazon EC2 instances behind an Application Load Balancer.
During flash sales the downstream fulfilment service is overwhelmed and orders
are lost. The company wants the API to keep accepting orders while fulfilment
catches up, with the LEAST operational overhead. Which solution meets these
requirements?
OPT: a
Increase the instance size of the fulfilment service and enable detailed
CloudWatch monitoring.
WHY:
Vertical scaling raises the ceiling but does not buffer a burst; once the larger
instance saturates, orders are lost again, and someone has to keep resizing it.
OPT: b *
Publish each order to an Amazon SQS standard queue and run the fulfilment
service in an Auto Scaling group that scales on
ApproximateNumberOfMessagesVisible.
OPT: c
Write each order to an Amazon Kinesis Data Streams stream with one shard and
process it with AWS Lambda.
WHY:
A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard
count right is exactly the operational work the question asks to avoid.
OPT: d
Insert each order into an Amazon RDS table and have the fulfilment service poll
for unprocessed rows every second.
WHY:
Polling a relational table turns the database into a queue: extra load, locking
logic, and the two services stay coupled.
A:
Put an SQS standard queue between the API and fulfilment and scale the
fulfilment fleet on queue depth. The queue stores the burst durably and the
Auto Scaling group drains it with no manual work. Resizing the instance only
raises the ceiling, a one-shard Kinesis stream caps throughput and adds shard
management, and polling RDS makes the database a queue.
USAGE:
In my own checkout side project the checkout Lambda drops a message on SQS and
the email sender consumes it, so an email-provider outage never blocks a
purchase.

## aws-s3-compliance-copy-mcq-02 | d3
Q:
A company must keep a copy of every object written to an S3 bucket in a second
Region and must be able to prove that no copy can be deleted for seven years,
even by an account administrator. Which combination of actions meets these
requirements? (Choose two.)
OPT: a *
Enable versioning on both buckets and configure S3 Cross-Region Replication to
the destination bucket.
OPT: b
Enable S3 Transfer Acceleration on the source bucket.
WHY:
Transfer Acceleration speeds up uploads over long distances; it never copies an
object to another Region.
OPT: c *
Enable S3 Object Lock in compliance mode with a seven-year retention period on
the destination bucket.
OPT: d
Apply a bucket policy on the destination bucket that denies s3:DeleteObject to
all principals.
WHY:
A bucket policy can be edited or removed by an administrator, so it cannot prove
that a copy is undeletable; compliance-mode Object Lock cannot be shortened or
removed by anyone.
OPT: e
Enable MFA Delete on the source bucket.
WHY:
MFA Delete protects the source bucket's versions from casual deletion; it does
not cover the second-Region copy and an administrator with the MFA device can
still delete.
A:
Replicate with versioning enabled and lock the destination copies with Object
Lock in compliance mode for seven years. Replication provides the second-Region
copy; compliance mode is the only setting that no principal, including the root
user, can shorten or remove. Transfer Acceleration, a deny policy, and MFA
Delete do not meet the "cannot be deleted by anyone" requirement.
```

解析结果：卡 1 → `requiredCount 1`，选项 a–d，正确 {b}，有限定词；卡 2 → `requiredCount 2`，选项 a–e，正确 {a, c}，无限定词（choose-two 由推导得出并和题干核对）。正确选项可以没有 `WHY:`，错误选项必须有。

### 4.4 词法：宽松匹配 + 严格校验载荷

反方抓到的坑：现有词法器把任何不匹配标记的行追加到当前段（`deckImport.ts:421`），如果 `OPT_MARKER` 写成严格正则，`OPT: g`、`OPT: a Increase…`、`OPT: A)` 这类手误会被**静默粘到上一段正文**里，永远报不出错。所以标记按 `/^OPT:(.*)$/`、`/^WHY:(.*)$/`、`/^QUALIFIER:(.*)$/` 宽松识别，再校验载荷：`OPT:` 必须恰好是 `[ \t]*([A-Fa-f])[ \t]*(\*)?[ \t]*`，否则 `MCQ_BAD_OPT_LINE` 带行号、整张卡丢弃（和 `MISSING_QUESTION` 同等处理）。`openSection` 用 `option:<key>` 作段键，重复 `OPT:` 不算 `DUPLICATE_SECTION`；同一选项第二个 `WHY:` 仍算重复（首个生效）。

### 4.5 校验（全部阻断；非阻断的"警告层"是 Phase 4）

`MCQ_BAD_OPT_LINE` · `MCQ_QUALIFIER_EMPTY` · `MCQ_QUALIFIER_IS_CHOOSE_N` · `MCQ_TOO_FEW_OPTIONS`（< 3）· `MCQ_TOO_MANY_OPTIONS`（> 6）· `MCQ_KEY_SEQUENCE` · `MCQ_DUPLICATE_OPTION_KEY` · `MCQ_OPTION_EMPTY` · `MCQ_OPTION_TEXT_DUPLICATE` · `MCQ_NO_CORRECT` · `MCQ_TOO_MANY_CORRECT`（> 3）· `MCQ_ALL_CORRECT` · `MCQ_WHY_MISSING` · `MCQ_WHY_WITHOUT_OPTION` · `MCQ_FORBIDDEN_OPTION_TEXT`（"all/none of the above"、"both a and c"——乱序不安全）· `MCQ_LETTER_REFERENCE`（`A:` 或 `WHY:` 里出现 `Option B` / `choice C` / `B) …`；反方指出原来的 `/\b(option|answer|choice)\s+[a-f]\b/i` 会误伤 "answer a question"，改成只认大写字母并把反例钉进测试）· `MCQ_QUALIFIER_NOT_IN_STEM` · `MCQ_CHOOSE_N_MISMATCH` · `MCQ_DIFFICULTY_RANGE`。

Phase 4 的非阻断警告：正确选项明显最长（≥ 1.4× 错误选项中位）、WHY < 40 字符、题干 > 120 词、首句 > 140 字符（卡面截断）、题型形状（1→4、2→5、3→6）、缺 `USAGE:`。

### 4.6 往返、diff、runner

- `'mcq'` 进 `COMPARABLE_FIELDS`（`:518-526`），按规范化 JSON 比较（trim、`why` 空 → null、按 key 排序、去 `v`）；服务端 `null` 和文件缺席都视为 `''`，重导同一文件仍是全 unchanged。
- `serializeDeckMarkdown` 按 header、`QUALIFIER:`、`Q:`、`OPT:`/`WHY:`（key 序，正确加 ` *`）、`A:`、`CODE:`、`USAGE:` 输出；`parse(serialize(x))` 深等于 `x`；fast-check 的 `cardArb` 加可选 `mcq` 分支。
- `deckImportRunner.ts` 传 `mcq` / 显式 `mcq: null`。**服务端就绪守卫**：第一张 MCQ 卡 create/update 之后检查 API 回显里 `mcq` 是非空对象，否则中止余下动作并提示 "server not ready for MCQ"——这是对 `Helpers.BuildUpdateSet`（`Helpers.cs:58`）静默丢掉未知键的唯一防线（部署顺序错了不会悄悄变成 Q/A 卡）。

---

## 5. 调度：答题结果 → 现有四档评分

### 5.1 原则

不做第二个调度器，不加第五档评分，不加进度字段。`scheduleNextReview` / `foldProgress`（`review/model.ts:85-140, 213-219`）、`CardProgress` 白名单、`SCHEDULER_VERSION 'ladder-v1'`（`progressSync.ts:133`）、连续天数规则（`sessionStore.ts:54-58`）、奖励（`rewardResolver.ts:19-29`）、`ProgressEvents.cs:417-431`、`snowflake/001_content_intelligence_setup.sql:66-72,115` 全部保持。MCQ 屏幕产出一个判定 + 三个"反馈前"信号，纯函数 `mapMcqVerdictToRating`（新 `features/gacha/mcq/mcqVerdict.ts`，fast-check 测试）在 `handleRating`（`SessionCardScreen.tsx:396`）之前把它变成 `again|hard|good|easy` 之一。永远不传非评分字符串（`progressSync.ts:223-236` 会把未知值强转成 3 = good）。

### 5.2 输入

- `verdict`：单选——选中 = 正确 key → `correct`，否则 `wrong`。多选（UI 强制恰好选 `requiredCount` 个）——`k = |选中 ∩ 正确|`；`k == N` → `correct`；`k == N−1`（恰好错一个）→ `partial`；其余 → `wrong`。"I don't know"（不选）→ `wrong`。
- `confidence`：`sure | unsure`——按的是哪个提交按钮（反馈前捕获）。
- `changedPick`：提交的集合是否和第一次凑齐的集合不同。
- `responseMs`：选项出现 → 提交（不含读题干时间，也不是 `dwellTimeMs`）。
- `fast`：`responseMs ≤ 20 s`（≤ 4 个选项）/ `30 s`（5–6 个）；考试节奏是 120 s/题。
- `reviewStage`：`first_review` / `repeat_review`（和 `SessionCardScreen.tsx:430` 同规则）；`stage`、`hardStreak` 来自当前进度。

### 5.3 映射表（自上而下，首个命中）

| # | verdict | 自信 | 改选 | 快慢 | 阶段 | → 评分 | 阶梯效果（间隔 1/2/4/8/15/30/60 天） | 连续天数 |
|---|---|---|---|---|---|---|---|---|
| 1 | wrong（含 I don't know） | 任意 | 任意 | 任意 | 任意 | **again** | stage −2（最低 0），lapses+1，10 分钟后再来 | 不保 |
| 2 | partial（多选恰好错一个） | 任意 | 任意 | 任意 | 任意 | **hard** | stage 不动（连续第 3 个 hard 降 1），下次 = max(1, round(I×0.7)) 天 | 保 |
| 3 | correct | unsure | 任意 | 任意 | 任意 | **hard** | 同上；stage 0 时留在 0 一天，下一次自信答对就升到 1 | 保 |
| 4 | correct | sure | 任意 | 任意 | first_review | **good** | stage +1（第一次见面永远不给 easy：1 选 4 有 25% 蒙对） | 保 |
| 5 | correct | sure | 改过 或 慢 | 任意 | repeat_review | **good** | stage +1（改主意和费力回忆不罚，只是拿不到 easy） | 保 |
| 6 | correct | sure | 没改 | 快 | repeat_review 且 stage ≥ 1 且 hardStreak == 0 | **easy** | stage +2 | 保 |
| 7 | correct | sure | 没改 | 快 | repeat_review 其它（stage 0 的 10 分钟重发、或上一次是 hard） | **good** | stage +1 | 保 |

不变量（`tests/unit/mcqVerdict.spec.ts`，fast-check）：wrong ⇒ again；partial ⇒ hard；unsure ⇒ 永不 good/easy；first_review ⇒ 永不 easy；changedPick ⇒ 永不 easy；slow ⇒ 永不 easy；输出 ∈ 四档；纯且全域有定义。

### 5.4 为什么是这个形状

- `again` 是阶梯里唯一的失败信号，也是 Content Intelligence 里唯一算进 `failure_rate` / `again_rate` 的值（`snowflake/001_content_intelligence_setup.sql:166-168`）；把答错映射成更软的东西会同时污染两者。
- 提交时选自信度，零额外点击就抵消了 25% 的蒙对底线；反馈后再问"我是猜的吗"会被事后诸葛污染（备选见第 11 节）。
- 慢但对、改过但对**永远不产生 hard**：把它们喂进 hardStreak 会让一张学习者连续答对的卡在第 3 次被降级（`HARD_STREAK_TO_DEMOTE = 3`）。
- partial = 恰好错一个，不是"有一个对"：3 选 6 只对 1 个低于随机期望 1.5，属于失败桶。SAA-C03 本身没有部分分，但产品目标是记忆不是模拟分数。
- 答错 10 分钟后重发（此时是 `repeat_review`、stage 0）落在第 7 行 → good，永远到不了第 6 行 → easy（要求 stage ≥ 1），而且每次尝试选项都重新乱序，不能靠位置蒙。2026-09-22 补：stage ≥ 3 的卡答错后降到 stage ≥ 1，重发时本可满足第 6 行，所以 `mapMcqVerdictToRating` 多一个可选输入 `redeal`（`attemptIndex ≥ 1`），为真时把第 6 行封顶为第 7 行 → good——场内重发在任何阶段都到不了 easy。

### 5.5 连续天数 / 全清 / 掌握（按构造不变）

`sessionDone` 对每张提交的卡 +1，不看判定（`sessionReviewHelpers.ts:74`），所以全清 = `sessionDone ≥ sessionLimit` → 恰好 +1 抽（`rewardResolver.ts:27`），**正确率永远不影响抽数**（计划不变量 4，`gacha-acquisition-learning-loop-plan.md:384`）。`streakEarned` 由第一个 hard/good/easy 置位（`sessionStore.ts:57`），所以一场 0/5 拿到抽但不保连续天数——和今天自评 5 个 Again 一模一样（`gacha-v7.md:96, :236`）。partial 和 unsure-correct 都保连续天数。这个不对称是你的裁决（第 11 节）。掌握仍是 stage ≥ 4。

### 5.6 场内重发

`again` 把 `nextReviewAt` 设为 10 分钟后，仍在今天桶里，`pickNextCard` 绕过 `avoidUid` 后可能重发。重发时 `attemptIndex` +1，选项用 `hash(sessionId + StableUid + attemptIndex)` 重新乱序，和 Q/A 的 Again 重发一样占一个节点计入 ≤ 5 上限，横幅 "Back again — let's see if it stuck"。

### 5.7 出题顺序、上限、穿插（Phase 2 做，不延后）

`pickNextCard` 保持 due → updated → new 的桶序和 OrderInDeck 排序。反方指出：`pickWith` 返回第一张匹配（`sessionPlanner.ts:97-104`），每张卡都有进度条目（`storage.ts:314-322`），新卡每场只有 1–2 张（`sessionBuilder.ts:41`）——追加在 1540+ 的 MCQ 题会排在所有没复习过的 Q/A 卡后面**几个星期都出不来**。所以 `pickNextCard`（及第二个调用点 `buildRatedSessionState`）加可选参数 `kindHint?: { preferMcq; mcqAllowed }`：`pickNew` 先扫 `owns && isNew && 符合偏好`，找不到回退到普通扫描，桶序和 `owns` 守卫都保留，钉桶序的 planner 测试仍绿。调用方按会话状态算 hint：`mcqAllowed = 本场已出 MCQ 数 < flags.mcq.maxPerRun`（默认 2；0 = 新卡桶不出 MCQ），`preferMcq = mcqAllowed && 上一张新卡不是 MCQ`。上限只作用于**新卡桶**：到期的 MCQ 卡到期就是到期，永不推迟（推迟会改变阶梯的承诺）。

### 5.8 事件

`recordReviewEvent` 收到的 `rating` = 映射后的评分，`reviewStage`、`statedDifficulty`、`dwellTimeMs = 卡出现 → 点 Next`、`sessionId`、`cardRevision`、`progressAfter` 形状全部不变。老实说清楚：MCQ 的 dwell 跨三屏还包括读 WHY，结构上就比 Q/A 长，**不可**和 Q/A 的 `expected_dwell_time_ms` 比较——第 7 节从第一天起就按格式分区。`schedulerVersion` 仍是 `ladder-v1`，因为阶梯没变，映射是展示层的事。

---

## 6. 会话 UI（三屏）与卡面

### 6.1 分支点和保住的契约

都在现有 `SessionCard` 路由里；`load()`（`SessionCardScreen.tsx:186-382`）只多传一个 `kindHint`。`:699-721` 处渲染 `renderAsMcq ? <McqReviewBody/> : <ReviewBody/>`，放在同一个 ScrollView（testID `screen-session-card-primary-surface`）；dock 的 View 保留 testID `review-rating-dock`，MCQ 渲染 `<McqActionDock testID="review-rating-bar"/>`、Q/A 渲染 `<RatingBar/>`，所以 `session-card.screen.test.tsx:461-498` 和 Q/A 标签测试都不动。`McqReviewBody` 是 `ReviewBody` 的兄弟组件，不复用它的 `faceUp/onFlip`（ReviewBody 把题目截 4/2 行且允许"收回答案"，两者对 MCQ 都不对）。

每卡状态（放在 `showAnswer` 旁边，和 `setShowAnswer(false)` 同批次重置）：`renderAsMcq`、`mcqPhase: 'stem'|'options'|'verdict'`、`shownOrder`、`selectedKeys`、`firstPickKeys`、`pickChanged`、`confidence`、`verdict`、`attemptIndex`，以及 `optionsShownAtRef`、`submittedAtRef`、`mcqServedThisRunRef`、`lastNewKindRef`。`showAnswer` 语义不变（"答案可见"），提交时置 true，所以 `handleRating` 里的每个守卫（`:397-400`）继续生效。

### 6.2 首次引导（一次性）

设备第一次显示 MCQ 卡时（AsyncStorage `recallsmith:mcq:coach-seen:v1`，读失败默认"已看过"，谁都不会被横幅卡住），dock 上方一行可关闭的提示，三屏都在："New card type. Decide first, then reveal the options. Sure / Not sure tells the scheduler how confident you were; I don't know skips the guess and shows the explanations." 关闭或该卡 Next 后写标记。

### 6.3 第一屏：题干（`flags.mcq.recallFirst !== false` 时才有）

头部不变。卡头：难度徽章 + 芯片 "Multiple choice" / "Choose 2" / "Choose 3"（由 `requiredCount`）。题干完整显示、不截行；`qualifier` 原样加粗（兜底：把 ≥ 4 字母的全大写词加粗——MOST / LEAST / BEST / FEWEST）。下面一行 "Decide on your answer before you look at the options."。dock：一个主按钮 "Show options"（testID `mcq-show-options`）。

### 6.4 第二屏：选项（`optionsShownAtRef` 打点）

题干折叠成 3 行 + "Show full question"。选项按 `shownOrder` 列出（新 `mcq/mcqShuffle.ts` 的带种子 Fisher–Yates；`poolSelection.ts:63` 的 PRNG 是内联闭包不能复用），种子 `hash(sessionId + StableUid + attemptIndex)`；`shuffle === false` 时按存储顺序。**显示字母 A–F 按位置分配，永远不是 key。** 每行 ≥ 48pt 的 Pressable：字母圆盘、可换行文字、radio（N=1）或 checkbox（N>1）；testID `mcq-option-<key>`；`accessibilityRole 'radio'|'checkbox'`，标签 "Option B of 4: <text>"。单选：点一个选一个，再点另一个就换（有过选择再换 → `pickChanged`）。多选：点选切换；dock 里 "1 of 2 selected" 计数；超上限的点击忽略 + 轻震 + 提示 "Deselect one first"。**不**点即提交。dock：主按钮 "Sure"（`mcq-submit-sure`）+ 次按钮 "Not sure"（`mcq-submit-unsure`），选满前都禁用，提示 "How confident are you?"；再加一个文字链接 "I don't know"（`mcq-dont-know`），不选直接按 `wrong` 提交。三者都打 `submittedAtRef`。

### 6.5 第三屏：判定（`showAnswer` 同批次置 true）

触觉：成功 / 警告 / 错误。**只用记忆语言，不用考试评分词汇**（反方否决了 "the real exam scores this as wrong" 和 "EXAM TIP" 标题——和"不是考试模拟器"的定位冲突）。横幅："Correct" / "You knew 1 of 2" / "Not this time"，副标题写出真实的排期结果（用 `scheduleNextReview(current.progress, mappedRating, now)` 纯预览算出来）："Scheduled as Good · back in 2 days" / "Scheduled as Hard · the card stays where it is, back in 1 day" / "Scheduled as Again · back in 10 minutes"；(i) 打开一段规则说明。选项行变静态，用图标 + 文字 + 颜色（绝不只靠颜色）：正确且选了 → ✓ "Correct"；正确没选（多选）→ 空心 ✓ "You missed this one"；错误且选了 → ✗ "Your pick"，其 WHY **自动展开**；错误没选 → 变淡、折叠的 "Why not?" 展开器。列表下面沿用 ReviewBody 的分节样式："EXPLANATION" = `card.Explanation`；"WHY THE QUALIFIER MATTERS" **只在**有比较型限定词时渲染："The stem asked for the <qualifier> option. Several options would work; the one that best satisfies that phrase wins."；"REAL USAGE"、"CODING SAMPLE" 如有。没有 Hide、没有重提交、**没有 RatingBar、没有覆盖评分**（答错改成 Easy 会污染 `first_review_easy_rate`）。`announceForAccessibility("Correct. Scheduled as Good, back in 2 days.")`。dock：一个主按钮 "Next"（最后一个节点 "Finish run"，`mcq-next`）→ `handleRating(mapMcqVerdictToRating(...))`，之后 `:401-512` 原样跑完。

### 6.6 收尾

`:479-508` 不变。SessionSummary 加一个**可选**参数 `picks?: { landed, answered }`（可选是为了让传精确对象的测试仍绿），渲染成一行 "3 of 5 picks landed"（0 时 "0 of 5 picks landed — they're all back in 10 minutes"）。没有百分比、没有域条、没有分数、没有计时。

### 6.7 路线、上限、穿插

会话上限仍是 5（`constants.ts:7`，"一场短跑 = 一个赚到的抽"），路线节点仍按数量推导；planner 今天看不到卡型，所以一场理论上可以是 5 张 MCQ。保护是 5.7 的偏好轮换 + 远程 `maxPerRun`（无需发版）+ Phase 3 的退出指标（含 ≥ 3 张 MCQ 的场次的 dwell 中位数和完成率，事件里本来就有）。头部**不**给时间预估（picker 是惰性的，后面出什么卡型不知道）。

### 6.8 卡面

- **抽卡仪式 / DrawResult**（`DrawCeremonyScreen.tsx:231-240`、`DrawResultScreen.tsx:392-395`）：Phase 1–3 不动，显示稀有度 + `question`，3/4 行截断；选项、key、解释永远不上卡面。Phase 4（S）：`DrawnCardVm` 加 `tag?: string`（`drawCommit.ts:12-17` 今天没有这个字段，类型必须改）并对 MCQ 设 "Choice · pick 2" / "Choice"；只有 DrawResult 读 `tag`（`:69`），仪式面没有 tag 渲染，保持不变。长题干截断接受，零代码的缓解是录题规则"首句 ≤ 140 字符、先说重点"（老客户端的 ReviewBody 也是同样的截断）。
- **Library**（`libraryMapper.ts`、`LibraryCardTile.tsx:90-106`）：只显示 `question`；Phase 4 加一个 "MC" 小字。
- **CardDetail**：题干完整、LAST/NEXT/STAGE、"Open deck session" 不变；Phase 4 加芯片 "Multiple choice · pick 2"。**故意不**渲染选项和答案（会话前预读答案会把题变成复习）。
- **老客户端（1.4.x / 1.5.0）每个界面**：mapper 丢 `mcq`；卡面显示题干；会话显示题干（正面 4 行截断、翻开后可滚动）+ `Explanation` + `RealWorldUsage`。API 强制的"非空、不含字母"的 explanation 就是让它成为一张完整闪卡的东西。所有权、卡池、保底、稀有度、进度在所有客户端上一致（只看 StableUid + Difficulty）。

---

## 7. 分析

- **Phase 1（只改服务端）**：`ProgressEvents.cs` 的 outbox CTE（`:400-443`）`left join decks / cards`（和 `ContentIntelligence.cs:131-136` 同样的 join），payload 加一个键 `'card_format', case when c.mcq is not null then 'mcq' else 'qa' end`。带 42703 容错（列不存在就重试不带这个键），保持单语句 ingest。客户端不改、隐私标签不改（这是内容元数据，不是行为数据）。
- **Phase 3（内容上线前）**：Snowflake `stg_review_events` 投影 `card_format`（缺省 'qa'）并推导 `answer_mode`（`card_format = 'mcq'` 且事件信封 `client_features` 含 `'mcq'` 时为 `'mcq'`，否则 `'qa'`；`client_features` / `update_id` 由 C14 的信封字段 `clientFeatures` / `updateId` 落到 outbox payload，Snowflake 用 `array_contains('mcq'::variant, client_features)` 判断——不再看 `app_version`）；`user_baseline`（`001:131-137`）和 `expected_by_difficulty`（`:139-151`）的 GROUP BY 加 `answer_mode`；四条 Q/A 状态规则（`:204-218`）限定 `answer_mode='qa'`；MCQ 行显示 "MCQ · Not Assessed"。反方指出：如果等到 Phase 5 才分区，Phase 3–5 之间的历史会把 MCQ 和 Q/A 混在同一基线里，"人人答错的那张卡"会被标成 "Possibly Unclear" 并拿最高 fixPriorityScore。
- **Phase 5（隐私标签更新 + 你对冻结文件 `src/sync` 签字之后）**：`ProgressEvent` 加可选 `answer` 对象（选中 key、正确 key、展示顺序、responseMs、changedPick、confidence），`schemaVersion 2`，由 `features.mcq.answerTelemetry`（默认 false）门控；后端用 side list `::jsonb` 进 outbox，不加列；`snowflake/002_mcq_marts.sql`：`mcq_option_picks`、`mart_mcq_option_daily`（**干扰项质量**：哪个错误选项最常被选）、`mart_mcq_card_quality_daily`（Guessable / Lure Trap / Contested）、`mart_mcq_domain_daily`（按域的答题时间）、校准（自信 vs 正确）、调度器验证查询；迁移 020 给快照表加可空列；控制台加 "Exam items" 列。
- **不做**：新的 eventType（`card_observations` 会丢掉它）；把判定字符串当 `rating` 传；用 MCQ 的 dwell 和 Q/A 的比较。

---

## 8. 兼容性

| 项 | 结论 | 证据 |
|---|---|---|
| 老客户端 | 通过不变的 schemaVersion 2 manifest 收到新 AWS 构建；`isRawDeckFlat` 和卡片校验接受多一个 `mcq` 键；两个 mapper 丢掉它；ReviewBody 渲染题干 + 解释。**不**提高 `ios.minSupportedVersion`（今天服务的是 1.3.0）；没有按卡组的版本门禁，老客户端也不会尊重 | `deckRepository.ts:1573-1584, 907-910, 1611-1624, 1671-1684`；`ReviewBody.tsx:82-107, 132, 136`；`remoteConfig.ts:19-25` |
| 现有卡组字节 | 没有 MCQ 行时 `Mcq` 全 null，`WhenWritingNull` 让 deck.json / chunk / delta 字节一致；Phase 1 退出条件是**在建任何 staging 行之前**重新发布两个线上卡组并 diff 产物 | `IS3DeckUploader.cs:50-61`；`ContentSerializationContractTests.cs:28-45` |
| 测试内容不进生产 Home | 只有一个生产 manifest；发布任何卡组都会自动重建 manifest（`ManifestService.cs:46`），`ManifestRebuild` 输出所有未删除卡组，`listManifestDecks` 只隐藏 `retired`，`coming` 是可见 tile。所以 staging 卡组以 `availability='retired'` 创建（`Decks.cs:16` 接受），**永远不设 live / coming**：Worker 照常发布产物（unlisted），自动重建输出一个 `path: null` 的 retired 条目，所有客户端隐藏；内部构建用 `EXPO_PUBLIC_CONTENT_BASE_URL=https://<cdn>/staging` 读一份手工维护的 staging manifest，条目用绝对 URL 指向那些 unlisted 产物（`deckRepository.ts:507` 接受绝对 URL）。slug 前缀 `zz-staging-`，测完 `is_deleted=1` | `ManifestRebuild.cs:145, 266-286`；`deckRepository.ts:553, 507, 1290-1312`；`deckActionResolver.ts:135-149` |
| 身份、revision、所有权 | StableUid 处处是身份；新 MCQ 题是新 uid 追加，154 张老卡 uid 和 revision 不变：不降级、没有 "Updated" 墙、分析不按 card_revision 分裂。只改选项 / WHY 不升 revision（老客户端没见过选项；新客户端走 DeckDiff 补丁）；改正确集或重写题干是语义变更，作者在控制台手动升 revision | `storage.ts:380-397`；`sessionPlanner.ts:74-77`；`Cards.cs:247` |
| Sync 与进度 | 事件的 `rating` 1–4、`card_reviewed`、`schemaVersion 1`、`ladder-v1`、`progressAfter.stage` 0..6、`nextReviewAtMs ≤ 90 天` 线上形状不变；ingest、LWW 合并、`foldProgress == projection` 都成立 | `ProgressEvents.cs:16-18, 152-175, 212-213, 456-486`；`scheduler.properties.test.ts:223` |
| Content Intelligence | 不报错；Phase 3 起按 `answer_mode` 分区；d1–d3 三处强制保护单事务快照导入 | `010:45-46`；`ContentIntelligenceSnapshotImport.cs:244-283` |
| 产品规则 | 抽只来自真实全清；不卖概率；稀有度 = 难度；卡池 = 未拥有；≤ 5 张；一个 hard/good/easy 保连续；Mastered = stage ≥ 4；不承诺通过；没有计时 / 分数；AWS 内容独立创作——全部不变 | 各处如前 |
| 冻结文件 | `gacha-v7.md:83-90` 冻结的 `src/content/deckRepository.ts`（Phase 2 一行 mapper）和 `src/sync/progressSync.ts`（Phase 5 一个可选字段）各需要你显式签字 | — |
| Kill switch | `enabled=false` → 新客户端把 MCQ 当 Q/A 渲染，不用回滚内容，**下次冷启动生效**；`recallFirst=false` → 跳过题干屏；`maxPerRun` → 新卡桶每场上限（0 = 不出）；`answerTelemetry` → 隐私标签更新前不发行为数据。每次使用 kill switch 都在计划文档里记日期，因为那段时间的事件按内容标 'mcq' 但按 Q/A 作答 | `remoteConfig.ts:123-129` |

---

## 9. 分阶段实施

| 阶段 | 范围 | 退出条件 | 工作量 |
|---|---|---|---|
| **Phase 0 裁决 + 黄金内容**（和 Phase 1 并行） | 你在本文里回答第 11 节；写 5 张原创 MCQ（四个域各 1 + 1 张 choose-two）；建 ledger；加 AWS 商标 / 非关联声明 | 12 条裁决有答案；5 张卡追加到完整 AWS 文件后在 Phase 1 的导入器里零问题；每张有不含字母的 `A:`、d1–d3、ledger 行 | 1 天文档 + 3 小时写题 |
| **Phase 1 服务端 + 控制台**（线上不可见） | 迁移 019；`Cards.cs` / `Helpers.cs` 的 cast + `JsonbCell` + `McqValidation` + explanation 门禁；`CardsPage` / `Publish` 的 select 与门禁；Worker `CardExportData.Mcq`（WhenWritingNull，`Topic` 之后）+ `PublishJobProcessor` 42703 容错 select + `DeckDiff.McqEquals` + `PreviousCardDocument`；`ProgressEvents` 的 `card_format` 标签；控制台类型 + API client + runner 守卫；Markdown 导入器（标记、校验、往返、fast-check）；文档 | **建 staging 行之前**：重新发布两个线上卡组，deck.json / chunks / manifest 除 buildId / sha 外字节一致；`ContentSerializationContractTests` 绿；API 测试 `mcq` 是 Object；导入器 40+ 用例绿；staging 卡组（retired）发布成功并从 staging manifest 可安装 | **9 天** |
| **Phase 2 手机端 1.6.0** | `deckExport` 类型、`normalizeMcq` / `isMcqCard`、mapper 各一行、`remoteConfig` + `featureFlags` + `useForceUpdateGate` 接入；`mcqVerdict` / `mcqShuffle` / `mcqConstants` + 性质测试；`sessionPlanner` 的 `kindHint` + `maxPerRun`；`McqReviewBody` / `McqActionDock` / 引导行；`SessionCardScreen` 分支 + 状态重置；SessionSummary 可选参数 | 现有全部套件不动仍绿；新测试绿；用**内部构建**（`EXPO_PUBLIC_CONTENT_BASE_URL` 指 staging）在 375pt 设备上过 Dynamic Type XL 和 VoiceOver；kill switch 三个开关各验一次；提交 App Store（只需通过审核，内容还没上） | **10 天** |
| **Phase 3 分析分区 → 内容上线** | 先：Snowflake 分区 + `ContentIntelligence.cs` 的 live 回退限制 + 控制台横幅。然后，当 1.6.0 上架 ≥ 14 天**或** 7 日活跃里 ≥ 80% 是 1.6.0+：把黄金 5 + 10 张追加导入、发布、手动 rebuild manifest | 两个线上卡组的 Q/A 状态分区前后一致；1.5.0 设备上新卡显示为场景 Q/A 卡、delta 补丁生效、不崩；1.6.0 上三屏流程完整；含 ≥ 3 张 MCQ 的场次完成率和 dwell 中位数在可接受范围（否则 `maxPerRun` 降到 1） | 2 天 + 8 小时写题 |
| **Phase 4 打磨 + 录题 lint + 节奏** | CardList 徽章、CardForm 只读面板、`describeMcqDiff`；`DrawnCardVm.tag`、CardDetail 芯片、Library 字样；导入器非阻断警告层；按频率表每次发布 5–10 张直到 ~40 | 警告不阻断；黄金 5 重导零警告；≥ 40 张 MCQ 上线且有 ledger；现有控制台和卡面测试绿 | 3 天 + 每题 30 分钟 |
| **Phase 5 行为数据**（隐私标签更新 + `src/sync` 签字之后） | 可选 `answer` payload（flag 默认关）；ingest side list；`002_mcq_marts.sql`；迁移 020；快照导入 + 控制台 "Exam items" 列 | 标签先更新再开 flag；ingest 单语句测试绿；老形状事件不变；demo 卡组的 Q/A 状态前后一致 | 6 天 |
| **Phase 6 评估**（Phase 3 后 6–8 周，每卡 ≥ 30 次作答） | 重写 Guessable / Lure Trap / Contested 的卡（同 uid 升 revision）；跑调度验证和场次时长查询；决定要不要 `mcq-ladder-v1` 分支、要不要限制到期桶、`maxPerRun` 默认值、MCQ 占比要不要涨 | `docs/` 里一份带查询结果的决定记录 | 1–2 天 |

反方修正了原估算（Phase 1 原写 6 天、Phase 2 原写 8 天）：把 CardForm 面板、CardList 徽章、`describeMcqDiff`、`drawCommit.tag`、CardDetail 芯片、Library 字样挪到 Phase 4 后，重估为 9 / 10。

### 各层改动清单

| 层 | 改动 | 文件 | 量 |
|---|---|---|---|
| DB | 019 迁移一列 | `src_C/Vpc/Db/Migrations/019_cards_mcq.sql` | S |
| Authoring API | GET/POST/PUT 读写 `mcq`（`$n::jsonb`）、`UpdateField` 加 `Cast`、`McqValidation.Canonicalize`、explanation 门禁、editor 允许键 | `Cards.cs`、`Helpers.cs`、`McqValidation.cs`（新） | M |
| Authoring API（列表 / 预览 / 门禁） | `CardsPage.cs`、`Publish.cs` 的 select + `JsonbCell` + 入队前门禁 | 同名 | S |
| Worker | `CardExportData.Mcq`、mapper 的 `Deserialize<JsonElement>`、`DeckDiff.McqEquals`、`PreviousCardDocument` | `IS3DeckUploader.cs`、`PublishJobProcessor.cs`、`DeckDiff.cs`、`ContentArtifactsGenerator.cs` | M |
| Ingest 标签 | outbox payload `card_format`（42703 容错） | `ProgressEvents.cs` | S |
| 控制台类型 / client / runner | `card.ts`、`authoring.ts`、`deckImportRunner.ts` + 就绪守卫 | 同名 | S |
| 控制台导入器 | 宽松标记 + 载荷校验、段键、issue codes、往返、`COMPARABLE_FIELDS`、`cardArb` | `deckImport.ts`、`mcqRules.ts`（新） | M |
| 控制台 UI（Phase 4） | 徽章、只读面板、diff 提示 | `CardForm.tsx`、`CardListPage.tsx` | S |
| 手机内容类型 + flags | `deckExport.ts`、`normalizeMcq`、`isMcqCard`、`featureFlags.ts`、`forceUpdateGate.ts`、`remoteConfig.ts`、两处 mapper | 同名 | S |
| 手机 MCQ 领域 + planner | `mcqVerdict` / `mcqShuffle` / `mcqConstants`、`sessionPlanner.kindHint`、`sessionReviewHelpers` | 同名 | S |
| 手机 MCQ UI | `McqReviewBody`、`McqActionDock`、`McqCoachLine` | 新 | M |
| 手机会话屏 | 状态 + 三个 handler + 分支 + 重置；`navigation/types.ts`；`SessionSummaryScreen` | 同名 | M |
| 手机卡面（Phase 4） | `DrawnCardVm.tag`、CardDetail 芯片、Library 字样 | `drawCommit.ts`、`CardDetailScreen.tsx`、`LibraryCardTile.tsx` | S |
| Snowflake + 控制台分区（Phase 3） | `answer_mode` 投影、基线分组、Q/A 规则限定、横幅 | `snowflake/001_content_intelligence_setup.sql`、`ContentIntelligence.cs`、`ContentIntelligencePage.tsx` | S |
| 行为数据（Phase 5） | `answer` payload、ingest side list、`002_mcq_marts.sql`、迁移 020、快照 + 控制台 | `progressSync.ts`、`ProgressEvents.cs`、snowflake、`ContentIntelligenceSnapshotImport.cs` | S+M+L |
| 文档 | `content-delivery-v3.md`、`console-import-plan.md`、`aws-saa-mcq-authoring-guide.md`（新）、上架文案 | — | S |

---

## 10. 内容计划：怎么合法地写出第一套 MCQ

- **边界**：题库的题干 / 选项 / 解释 / 评论 / 答案不抄、不改写、不翻译。题库只贡献题型和频率。
- **频率表（只有编码）**：仓库外的私有表格，每行只有：题号、题型（单 / 二选 / 三选）、主要服务代码（受控列表）、限定词类别（least-ops / least-cost / most-performant / most-available / most-secure / fastest / least-change）、推测的域 D1–D4、`contested` 标记（社区最高票 < 70%）。产出一张 服务 × 限定词 × 域 的频率表（例如 "S3 × least-cost ≈ 4%"），用来定录题队列比例并对照 30/26/24/20 的域骨架。`contested` 只用来提醒"这对服务 / 限定词的公开答案有争议，查文档要更狠"。队列建好后表格归档，不提交任何东西。
- **独立性守卫**：每批导入前，仓库外脚本把每条新题干 / 选项 / WHY 和题库文本做 8 词 shingle 比对，任何共享片段即失败；通过后 ledger 记 `similarityCheckedAt`。ledger 每卡：deckSlug、examCode、contentOrigin = independent-original、sourceUrl（只允许 docs.aws.amazon.com）、lastVerifiedAt、similarityCheckedAt。**"Verified against official AWS docs" 只有在每张上线卡都有这些字段之后才能对外说**（对应上架文案文档的红线表）。
- **写题规则**（`docs/aws-saa-mcq-authoring-guide.md`）：场景来自你自己的系统（发布 worker、CloudFront 卡组交付、SQS outbox、RDS in VPC、KMS、Lambda）或原创的通用情境；题干先约束、再大写限定词、最后一句问句；写成连续行；首句 ≤ 140 字符。给定限定词恰好一个可辩护的正确答案。每个错误选项错在一条可命名的理由：(1) 违反限定词 (2) 服务不对 (3) 服务对、特性 / 配置不对 (4) 违反题干硬约束（RPO、Region、合规）(5) 过时做法；WHY 用一两句点名这条理由。选项长度对齐；绝对词不能只出现在干扰项；不用另一个选项的否定；禁 "all/none of the above"；`A:` 和 WHY 里禁字母；`A:` 先说方案为什么赢限定词，再一句一个被否选项——它是老客户端的全部答案，所以 API 强制非空。形状：1 正确 → 4 选项；2 → 5；3 → 6。难度（= 稀有度）：d1 = 一个服务一个事实；d2 = 两服务权衡由限定词决定；d3 = 多约束或 choose-2/3 且有两个貌似可行的组合。观测到的正确率**永远不**自动改难度；改标签走 revision 升级，让 "Difficulty relabeled" 有记录。纯概念卡（定义）留 Q/A；只有"场景 + 限定词"的题做 MCQ。154 张现有卡不转换；以后某张 Q/A 被判 "Too Shallow"，就用新 uid 加一张练同一概念的 MCQ。
- **预算**：每张经校验的原创题 25–35 分钟；黄金 5 张 ≈ 3 小时；40 张 ≈ 20 小时；60–80 张 ≈ 35–45 小时。
- **节奏**：黄金 5 → +10 → 每次发布 5–10 张按频率表推进到 ~40 → Phase 6 数据决定增长。
- **文案**：沿用已有的 "not official AWS material, not an exam simulator, won't pass the exam for you"，并加 "AWS and SAA-C03 are trademarks of Amazon Web Services, Inc. DeveloperCards is not affiliated with, sponsored by, or endorsed by AWS."（卡组描述、Home 卡组详情、App Store 描述、FAQ）。App 内 MCQ 话术只讲记忆。任何地方不出现正确率 %、readiness %、分数、通过概率。

---

## 11. 需要你决定的（推荐已标）

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 154 张线上 AWS Q/A 卡怎么办 | (a) 保留，MCQ 用**新 uid 追加**到同一卡组文件；(b) 同 uid 原地转换 + 升 revision（每个学习者降一级、154 个 "Updated" 徽章、分析按 revision 分裂、回忆练习变成识别）；(c) 新 slug 转换（所有权和进度清零，卡池重新装满重复内容） | **(a)**。零降级、零所有权重置、回忆和识别在同一场里穿插、上线前不用转换任何东西 |
| 2 | 混合卡组还是单独 "AWS Architect · Choice" 卡组 | 混合：一场、一个卡池、能穿插，分析从 Phase 3 起按格式分区。单独：老客户端不碰 Q/A 卡组，但抽卡跑道太薄（十连要 ≥ 10 张未拥有）、两场每日会话、第二个"练习"入口是计划禁止的 | **混合** |
| 3 | 答错保不保连续天数 | (a) 沿用：错 → again → 不保（和今天自评 5 个 Again 一样）；(b) 改成"提交即保"（要改 gacha-v7 §2.2/§3.3.1 和 `DAILY_STREAK_ALLOWED_RATINGS`）；(c) 答错扣天数 | **(a)** v1，总结页一句 "0 of 5 picks landed — they're all back in 10 minutes"；同场重发答对就保。永远不 (c) |
| 4 | 全清要不要正确率门槛 | (a) 只看完成：`sessionDone ≥ sessionLimit` → +1 抽；(b) ≥ N 对才给抽（引入计划已删掉的分档、引诱"为概率表演"、破坏奖励测试、可能让一场无法完成） | **(a)，坚定**。正确率计入排期（again = −2 级），永远不计入钱包 |
| 5 | 多选部分分 | (a) 恰好错一个 → hard，错 ≥ 2 → again；(b) 不全对即 again（考试的算法，但 App 里不说）；(c) 有一个对就 hard | **(a)** |
| 6 | 先看题干再看选项（"Show options" 门） | (a) v1 强制，远程 flag `recallFirst` 可关；(b) 默认关；(c) 用户设置 | **(a)**，Phase 3 前后测完成率 |
| 7 | 自信度怎么采 | (a) "Sure / Not sure" 两个提交按钮（反馈前、零额外点击、校准数据有效；unsure-correct → hard）；(b) 一个 Submit + 判定后 "I guessed" 链接（事后诸葛、少有人用）；(c) 两者都要 | **(a)**；嫌两个按钮重就 (b)，是映射表里一行的改动；不要 (c) |
| 8 | `maxPerRun` 默认值；到期桶要不要限 | (a) 2，只限新卡桶，到期 MCQ 永不推迟；(b) 1；(c) 也限到期桶（改变阶梯承诺） | **(a)**，Phase 3 指标不达标就远程降到 (b)；(c) 只在 Phase 6 用数据决定 |
| 9 | 老客户端 | (a) 优雅降级（题干 + API 强制的无字母答案），不强更；(b) `minSupportedVersion` 提到 1.6.0（连从不打开 AWS 卡组的人也被强更） | **(a)**；只在有工单证据且 1.6.0 上架 ≥ 60 天后才考虑 (b) |
| 10 | `answer` 行为数据什么时候发 | (a) 只在 Phase 5，客户端 flag 默认关，隐私标签更新 + 你对 `src/sync` 签字后；(b) 1.6.0 里带上但 flag 关（dark）；(c) 永不 | **(a)**；(b) 可接受，前提是你接受 flag 提前打开的拒审风险 |
| 11 | 商标 / 非关联声明的措辞和位置（仓库里今天一句都没有） | (a) 卡组描述 + Home 卡组详情 + App Store + FAQ；(b) 只 App Store | **(a)**，Phase 0 就加 |
| 12 | Staging 内容的做法 | (a) 生产 PG 里一条 `retired` 行 + 现有 bucket 下的 staging 前缀 + 一份手工 manifest（零基础设施；生产 manifest JSON 里可见一个 retired 条目但任何 Home 都不显示）；(b) 单独的 staging bucket + distribution + 第二个 Worker 部署 | **(a)** Phase 1–2；只有测试成常态才做 (b) |

---

## 12. 否决的备选（精选）与反方的 18 条

**否决**（每条都有代码依据，全文见 workflow 记录）：

- 调度分支 `mcq-ladder-v1`（"连续两次自信答对才升级、答错回 0"）：要在 ReviewEvent 加 itemType 保 fold==projection、改 `SCHEDULER_VERSION`、给 `CardProgress` 和白名单和 `progressAfter` 加计数器、动冻结的 `review/model.ts`——留到 Phase 6 用数据决定。
- 第五档评分 / 把判定字符串当 `rating`：`progressSync.ts:223-236` 会强转成 good，`ProgressEvents.cs:417-431` 在 outbox 置 null，Snowflake 过滤掉——答错要么记成成功要么消失。
- `card_format` 列 + CHECK：每个手写 select 都要多带一个谁都能从 `mcq is not null` 推出的字段。
- `card_options` 子表：所有手写 select 都要多 join；按选项的分析来自事件不来自内容。
- 存 `selectMode` / `selectCount`：两个真相来源会打架；`requiredCount` 处处推导。
- `Correct: B —` 的答案约定 + 不乱序：把显示字母烤进内容，10 分钟后重发可以靠位置答。
- 判定后再给 RatingBar 覆盖：答错改 Easy 会污染 `first_review_easy_rate`。
- 每次导入更新自动升 revision：会因为一个错别字修正让两个卡组的所有学习者降级，还破坏"全 unchanged"的幂等语义。
- 同一变更里加 topic / source_url 列和 `DOMAIN:` / `TOPIC:` / `SOURCE:` 标记：那是计划里程碑 E1 的范围。
- 会话头部的时间预估：路线只按数量建，picker 惰性，不预跑就不知道后面出什么。
- 抽奖仪式卡面加 tag 而不改类型：`DrawnCardVm` 没有 `tag`，仪式屏也不读。
- 在正式 manifest 里以 `live` 发一个 staging 卡组然后 retire、或用 `coming` 藏：发布自动重建 manifest，所有 1.4.x / 1.5.0 用户都会看到。
- 把 MCQ 题按 `OrderInDeck ≥ 1001` 作为录入参数：导入器不接受 order，只会按文件位置 × 10 分配。
- 全清正确率门槛 / 倍数；任何计时、分数、百分比、模拟考、通过概率文案；新的 eventType `mcq_answered`。

**反方 18 条的处理**（0 阻断、10 major、8 minor，全部回写）：DeckDiff 改结构比较（3.5）；jsonb 单元格转对象（3.6）；`OPT:` 宽松匹配 + 载荷校验（4.4）；feature flag 管道补全并老实写延迟（3.9）；staging 内容不进生产 manifest（8）；explanation 在 API 和 publish 门禁强制（3.1）；去掉 manifest `mcqCount`；仪式面 tag 挪到 Phase 4 且改类型；`QUALIFIER:` 禁 choose-N、EXAM TIP 只在有限定词时渲染且改成记忆语言（6.5）；穿插不延后（5.7）；分析从 Phase 1 打标、Phase 3 分区（7）；Phase 3 加 dwell / 完成率退出指标；工作量重估 9 / 10；题干不保留段落、字母正则改大写、示例说明是"追加到完整文件末尾"；首次引导行（6.2）。

---

## 13. 附：评审过程与没核的

- 4 条扫描共 94 个触点（内容流水线 21、复习会话 25、事件与分析 23、抽卡与规则 25），每条带 file:line。
- 4 个设计的评委总分：学习科学（recall-first + 自信加权映射到四档）21 > 内容优先 19 > 产品体验 18 > 最小改动 17。最终方案以学习科学版为骨架，数据模型取最小改动版（一列 jsonb + 一个字段），录题格式取内容优先版，三屏 UI 和话术取产品体验版。
- 我自己核过的：PDF 结构与统计（第 1 节）、`deckExport.ts`、`review/model.ts`、`ReviewBody` / `RatingBar`、`recordReviewEvent` 的入参、`001_init.sql` 的 cards 列、导入器的标记正则。
- 没有二次核验的：Worker / DeckDiff / ContentArtifactsGenerator 的具体行号、Snowflake mart 的行号、`useForceUpdateGate` 的调用链——实现时以代码为准。

<!-- paths-not-on-disk
计划中、尚未创建的文件（frontend/tests/docsPaths.test.ts 的守卫要求在此登记）：
     - docs/aws-saa-mcq-authoring-guide.md
     - snowflake/002_mcq_marts.sql
-->
