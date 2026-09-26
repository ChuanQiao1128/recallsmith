# AWS SAA 演示卡组：今天上午上线方案（2026-09-16，下午 Summer of Tech）

> 状态：**方案，未执行**。本文只留存和 review，不改代码、不改数据。
> 结论先说：**可以做，但只做一个 12 到 15 张的"金片"卡组，走现有的 Markdown 批量导入 + 发布流水线，不改任何代码，12:00 前必须在手机上验证通过，否则下午只演示 C# 卡组。**
>
> **Review 结果（两个反调角色逐行读了代码，结论都是 go_with_fixes）**：原方案有 5 处事实错误、7 个漏掉的风险，全部已订正在第 11 节，并回写进第 5、6、7 节。最要紧的三条：**manifest 不会自动重建，要手动 POST**；**手机上找新卡组走 Home 不走 Library**；**上午验证只能单抽，十连留给下午，而且钱包要先有 ≥11 个 pull**。

---

## 1. 为什么可行（仓库里已经有的东西）

| 需要 | 现状 | 出处 |
|---|---|---|
| 批量录题入口 | 控制台已有 Markdown 导入页：解析 → 校验 → 对账（create / update / unchanged / conflict）→ 应用；重跑同一文件幂等 | `frontend/src/pages/DeckImportPage.tsx`、`frontend/src/lib/deckImport.ts`、`docs/console-import-plan.md` |
| 发布 | 现有异步发布流水线：API 幂等拦截 → SQS → Worker 构建；**manifest 重建要手动 POST**（Worker 只发一条无人消费的消息）；分块包 + 增量补丁（v3，2026-07-13 已上生产） | `docs/publish.md`、`docs/content-delivery-v3.md` |
| 手机端发现新卡组 | **动态读 manifest**，不写死卡组列表（`listManifestDecks()`） | `mobile/src/features/gacha/home/deckActionResolver.ts`、`mobile/src/content/deckRepository.ts` |
| 卡包封面 | slug 含 `aws` 会归一化到 `cloud` 封面（`cloud.png` 已存在）；没有专属封面也有 `default.png` 兜底 | `mobile/src/theme/packArt.ts` `normalizeSlugForPack` |
| 卡背 | 只有 csharp 有专属卡背，其他卡组走程序化卡背，**纯加法，不影响** | 同上 `CARD_BACK_IMAGES` |
| 产品方向 | AWS SAA-C03 本来就是两个首发方向之一；要求"AWS 卡片独立创作并由 AWS 官方资料核验" | `docs/gacha-acquisition-learning-loop-plan.md` |
| 卡组类型 | 新建即为 Starter（deckType 1，服务端默认）= 免费卡组，走分块交付；表单里的 Starter/Paid 单选不随请求发送，建完在 DeckEditPage 确认 | `frontend/src/pages/NewDeckPage.tsx:145-150`、`src_C/Vpc/Authoring/Decks.cs:139-141` |

**结论：不需要动一行代码，不需要发新版 app，不需要 OTA。** 是纯内容操作：建卡组 → 导入 → 发布 → 手机验证。

## 2. 范围（硬边界）

- **12 到 15 张卡**，不多。原因：(a) 你的投递前计划写明"求职前每个题库最多做 5 张金片"，今天是为演示破例到一个十连的量；(b) 一次十连抽 10 张，短包看的是**未拥有的卡** ≥ 10 而不是卡组张数（review 订正），所以卡组 ≥ 12 张且**下午之前不能在演示账号上十连**；(c) 12 到 15 张两小时写得完。
- 只做 **Starter（免费）** 卡组，slug 建议 `aws-saa-c03`（含 `aws`，封面自动落到 cloud 图）。
- **不碰**：代码、卡包封面 PNG、稀有度配置、Content Intelligence、C# 卡组。
- 题目**你自己写**（符合你"手动录入、生成效应"的原则）。我可以提供题目清单和 Markdown 骨架，是否让我起草初稿再由你改写，由你决定；起草了也必须按 AWS 官方文档逐条核验（计划文档的要求）。

## 3. 题目清单（12 到 15 张，选你在展位上讲得出的）

**只用 d1 / d2 / d3**（review 订正：d0 会被手机端改写成 2，d4 违反 Content Intelligence 快照表的 check 1..3）；稀有度由难度映射（3 传说，2 稀有，1 普通），所以给 2 到 3 张 d3 让十连里能出"传说"。

| # | stableUid | 难度 | 题目方向 | 和你经历的关联 |
|---|---|---|---|---|
| 1 | aws-iam-least-privilege | d1 | IAM 角色 vs 用户 vs 策略，最小权限 | Lambda 执行角色 |
| 2 | aws-s3-storage-classes | d1 | S3 Standard / IA / Glacier 选型 | 内容桶 |
| 3 | aws-s3-cloudfront-oac | d2 | CloudFront + 私有 S3（OAC）为什么不公开桶 | DeveloperCards 控制台部署 |
| 4 | aws-lambda-cold-start | d2 | Lambda 冷启动、INIT 阶段、并发限制 | 9.2 s → 3.7 s 那件事 |
| 5 | aws-sqs-vs-sns-vs-eventbridge | d2 | 队列 vs 扇出 vs 事件总线 | 发布流水线用 SQS |
| 6 | aws-sqs-dlq-visibility | d3 | 可见性超时、DLQ、幂等消费 | Dovetale DLQ 重处理 |
| 7 | aws-rds-multi-az-vs-replica | d2 | Multi-AZ（高可用）vs 读副本（扩读） | RDS PostgreSQL |
| 8 | aws-vpc-public-private-nat | d2 | 公有/私有子网、NAT、Lambda 进 VPC 的代价 | PostgreSQL in VPC |
| 9 | aws-alb-vs-nlb | d1 | 七层 vs 四层负载均衡 | 通用 |
| 10 | aws-dynamodb-capacity-modes | d2 | 按需 vs 预置、分区键设计 | 简历技能栏有 |
| 11 | aws-kms-envelope-encryption | d3 | 信封加密、SSE-KMS vs SSE-S3 | 通用 |
| 12 | aws-cloudwatch-alarm-vs-eventbridge | d2 | 指标告警 vs 事件规则 | CloudWatch EMF |
| 13 | aws-route53-routing-policies | d1 | 加权 / 延迟 / 故障转移 | 通用 |
| 14 | aws-well-architected-pillars | d1 | 六大支柱 | 通用 |
| 15 | aws-sagemaker-processing-vs-endpoint | d3 | 常驻端点 vs 按任务 Processing job 的成本模型 | 你实习时提的那个改造 |

展位上被问"这卡组谁写的"，答案是"我，按 AWS 官方文档核对过"，所以每张卡的 `USAGE:` 写你自己项目里的用法，别抄考试题库。

## 4. Markdown 格式（沿用现有规范，一字不改）

```markdown
# deck: aws-saa-c03

## aws-lambda-cold-start | d2
Q:
What happens during a Lambda cold start, and what can you move into the INIT phase to shorten it?
A:
A cold start creates a new execution environment: download code, start the runtime, run static initialisers, then invoke the handler. Work done outside the handler (module scope or the INIT phase) runs once per environment and is reused by warm invocations, so expensive setup such as opening a database connection belongs there.
CODE: csharp
// Connection created once per environment, reused across invocations
private static readonly NpgsqlDataSource Db = NpgsqlDataSource.Create(ConnString);
USAGE:
DeveloperCards ingest Lambda: moving the PostgreSQL connect into INIT cut cold start from 9.2 s to 3.7 s.
```

规则回顾：`# deck:` 一次；`## <uid> | d<0-4>` 开卡；`Q:` `A:` 必填；`CODE:` `USAGE:` 可选；uid 全文件唯一（这是抽卡重复发卡那个生产 bug 的 authoring 侧防线）。

## 5. 时间表（以 09:00 开工计，硬停 12:00）【已按 review 订正】

| 时间 | 步骤 | 检查点 |
|---|---|---|
| **08:50** | **先看演示手机的钱包**：Draw 页右上 `× N`。十连需要 N ≥ 10，加上上午一次单抽验证需要 **N ≥ 11**。不够就现在通关 C# 学习 session 攒（每通关一整场 +1，每场 3 张卡），或者把下午演示改成单抽 | N 写进这里：____ |
| 08:55 | 先看当前生产 manifest：`GET <CONTENT_BASE_URL>/content/manifest.json`，保存一份快照；看里面有没有种子数据里的 `aws-solution-architect`（premium, coming）和 `aws-cloud-practitioner`（coming）两个"幽灵"条目，有就在控制台把它们 isDeleted 或 retired（只动这两行，**不碰 csharp 行**） | 快照存好 |
| 09:00-09:10 | 用 **super_admin** 账号登控制台新建卡组：title 定死为 **"AWS SAA-C03"**（发布后 title 烤进 deck.json，不能再改），slug `aws-saa-c03`。新建表单里的 Starter/Paid 单选是摆设（不随请求发送），靠服务端默认 deck_type=1；**建完打开 DeckEditPage 确认 Starter/free、availability=live** | 卡组在列表中，未发布 |
| 09:10-10:40 | 写 12 到 15 张卡到本地 `.md`（不进仓库）。**只用 d1/d2/d3**：d0 会被手机端改写成 2，d4 会让 Content Intelligence 快照导入整批回滚。CODE 块里不能有空行、不能有列 0 的 `## `、`Q:` `A:` `CODE:` `USAGE:` 只在列 0 才算标记 | 每张有 Q/A，uid 唯一 |
| 10:40-10:55 | 导入页：粘贴 → 预览 parse errors 必须为 0、conflicts 为 0、全部 create → 应用。**卡片数看卡片列表页，不看卡组列表**（卡组列表显示的 total_cards 仍是 0） | 卡片列表 = 文件张数 |
| 10:55-11:00 | DeckEditPage → **"Apply to totalCards"**（把 total_cards 从 0 改成实际张数），保存。不做这一步，手机 Home 上会显示 "0 cards" | totalCards = 张数 |
| 11:00-11:10 | 卡组列表 Publish，看轮询到 SUCCESS | `deck_publishes` SUCCESS |
| **11:10-11:15** | **手动重建 manifest**（发布成功 ≠ manifest 更新；Worker 只是往 MANIFEST_QUEUE_URL 发一条消息，仓库里没有消费者，控制台对话框写的"自动重建"是空话）：`POST <api-base>/api/v1/admin/manifest/rebuild`，带 super_admin bearer token；响应里 deckCount 应 +1。然后 `GET .../content/manifest.json`（CDN 缓存 60 秒）确认 `aws-saa-c03` 存在且 `availability: live`、`downloadMode: public`、有 `path` 和 `buildId`、`deckType: 1`、`totalCards` 正确 | manifest 里有它 |
| 11:15-11:45 | **手机验证，走 Home 不走 Library**：打开 Home tab（Home 每次获得焦点会拉远端 manifest；Library 是缓存优先，而且对未安装卡组会直接抛错进"Library unavailable"）→ AWS 行显示 Install → 点安装 → 切到 Draw tab 滑到 AWS 卡包 → **只做 Open 1（单抽）**，看到一张 AWS 卡翻面 → 点进学习页读题翻答案评分 → 杀掉 app 重开 → 飞行模式再开一次。**不要十连**：十连会把 15 张里的 10 张永久标记为已拥有（服务端 union 不可撤销），下午的十连就只剩 5 张、走短包路径 | 单抽出 AWS 卡、学习页正常、离线可开、C# 不受影响 |
| 11:45 | Go / No-go | 见第 7 节 |

## 6. 风险和对策【已按 review 订正】

| 风险 | 概率 | 对策 |
|---|---|---|
| **manifest 没重建，手机看不到新卡组** | **高（原方案漏掉）** | 11:10 手动 POST rebuild + GET manifest.json 确认，见第 5 节 |
| **演示手机 pull 不够 10 个，十连按钮灰的** | 中 | 08:50 先看钱包；不够就通关 C# session 攒或改单抽演示；没有任何后台给 pull 的接口 |
| **上午十连把下午的十连废掉** | 高（原方案会踩） | 上午只 Open 1；或用另一个未登录/匿名账号验证（抽卡状态按用户隔离） |
| 发布流水线出错，manifest 重建把 C# 卡组带坏 | 低 | 已安装的 C# 本地包不受 manifest 影响，只有 availability=retired 才会被清；回滚 = DeckEditPage 把 AWS 卡组 isDeleted=true（或 retired + retiredAtMs），再手动 rebuild；**永远不动 csharp 行** |
| Home 上出现 "Coming soon" 的 AWS 幽灵行 | 中 | 08:55 查 manifest；有就删种子行；新卡组标题用 "AWS SAA-C03" 避免和幽灵行同名 |
| Home 显示 "0 cards" | 高（原方案漏掉） | 发布前 DeckEditPage "Apply to totalCards" |
| d0/d4 卡片污染 Content Intelligence 快照（check 1..3） | 中 | 只写 d1/d2/d3 |
| 导入解析踩坑（标记必须在列 0、CODE 内空行被吞、内容行不能以标记开头） | 中 | 预览 parse errors = 0 才导入 |
| 误点 Paid，手机进付费墙路径 | 低 | 建完在 DeckEditPage 确认 Starter/free，manifest 里确认 deckType 1 / tier free |
| 这份 checkout 在 iCloud 里，有 197 个 " 2.*" 冲突副本 | 与今天无关但必须记着 | **今天不 build、不打包、不部署**；真要构建从 iCloud 外的干净 clone 做 |
| 卡片质量差被问倒 | 中 | 只写你能讲的题，USAGE 写自己项目 |
| 时间超 | 高 | 硬停 12:00；<12 张不发布 |

## 7. Go / No-go 标准

**Go**（下午演示 AWS 卡组）：manifest.json 里有 aws-saa-c03（live/public/totalCards 正确）、Home 能安装、**单抽出一张 AWS 卡**、学习页正常、离线可打开、C# 卡组不受影响、演示手机钱包 ≥ 10 且 AWS 未拥有卡 ≥ 10。

**No-go**：任何一项没过 → 不再折腾，下午只演示 C# 卡组，口径改成 "AWS SAA deck is the next one, twelve cards written and importing this week"。演示用 C# 卡组一样能讲完抽卡 → 学习 → 同步的全流程。

## 8. 演示脚本（20 秒，两种卡组通用）

1. 打开 app，Home 上看到卡包（C# 紫色 / AWS 云图）
2. 十连抽（前提：钱包 ≥ 10、AWS 卡组未拥有卡 ≥ 10，上午没抽过十连），等卡落桌翻面；15 张里有 2 到 3 张 d3，十连里出传说几乎必然
3. 点一张卡进学习页，读题、翻答案、评分
4. 说一句：every card was written by me, and every interview question I miss becomes a new card

## 9. 今天不做的

- 不加 AWS 专属封面和卡背 PNG（需要改 `packArt.ts` 和发 app，今天没有）
- 不改稀有度概率、不动 pity / 经济保底
- 不写超过 15 张
- 不 commit（本 md 也不 commit，等 review）

## 10. 待你决定

1. 题目由你写，还是我起草你改写？
2. 卡组标题用 "AWS Solutions Architect" 还是 "AWS SAA-C03"？
3. 现在几点开工？12:00 硬停这个时间能接受吗？

---

## 11. Review 记录（2026-09-16 上午，两个反调角色逐行读代码）

**推翻的 5 处**
1. "发布后 manifest 自动重建"：错。`src_C/Worker/Manifest/ManifestService.cs:36-49` 只往 `MANIFEST_QUEUE_URL` 发一条 `{action: rebuild_manifest}`，仓库里没有消费者；`docs/content-delivery-v3.md:121-122` 自己也写了"rebuild remains a manual superadmin POST"。唯一写 manifest 的是 `src_C/Vpc/Authoring/ManifestRebuild.cs:118-121`（POST /api/v1/admin/manifest/rebuild，super_admin）。控制台 `DeckListPage.tsx:381` 对话框里的"2) Rebuild manifest.json"是空话。
2. "Library 下拉刷新发现新卡组"：错。全 app 没有 RefreshControl；`LibraryScreen.tsx:90` 的 `listManifestDecks()` 缓存优先，且对未安装 slug 直接抛错（104-106）。真正拉远端 manifest 的是 Home 获得焦点（`HomeScreen.tsx:302-313` → `deckActionResolver.ts:110` → `deckRepository.ts:463 loadManifestPreferRemote`），以及 Draw 的后台重验证（`DrawScreen.tsx:428`）+ 自动安装（362-371）。
3. "卡组 ≥12 张就避开短包"：错。短包看的是**未拥有池**（`poolSelection.ts:38-44, 109, 156`），已拥有按 slug 持久化并 union 到服务端（`drawCommit.ts:76-79`、`DrawScreen.tsx:543`、migration 014），重装、重启、Debug reset 都撤不掉。15 张卡只有**第一次**十连是干净的十张。
4. "coming soon 规则在 deckActionResolver 第 62 行"：错，62 行是注释；规则在 130-158 / 269-270 / 300-303，值来自 `decks.availability`，默认 live；live 但没有 SUCCESS 构建的卡组会被 manifest 直接省略（`ManifestRebuild.cs:284-287`），不是变成 coming。
5. "新建卡组选 Starter"：单选框是摆设，`NewDeckPage.tsx:145-150` 只发 slug/title/author/description；靠服务端 `coalesce($6,1)` 默认。

**漏掉的 7 个风险**：钱包 pull 数（`DrawScreen.tsx:447-448` `pulls >= 10` 才能十连，没有后台加 pull 的接口）；上午十连废掉下午十连；`decks.total_cards` 留 0 → Home 显示 "0 cards"（`Decks.cs:139-141` 不写，`HomeDeckRow.tsx:53-57` 直接渲染；修法 `DeckEditPage.tsx:354-356` Apply to totalCards）；种子数据里的 `aws-solution-architect`（premium, coming）/ `aws-cloud-practitioner`（coming）幽灵行（`005_decks_manifest_v2.sql:175,184`）；d0 被 `deckRepository.ts:1658-1661` 改写成 2、d4 违反快照表 `check (stated_difficulty in (1,2,3))`（`010_content_intelligence_snapshot.sql:45-46`）；导入词法（标记只认列 0，CODE 内空行被吞，`deckImport.ts:20-28, 136-141, 268-287`）；iCloud checkout 里 197 个冲突副本，今天不许 build/deploy。

**确认无误的**：Markdown 格式与 uid 规则；导入页对账幂等；发布 API 幂等拦截 + SQS 双写回退；手机端动态读 manifest、Draw 侧栏列出所有 live 卡组并可自动安装；slug 含 aws → cloud 封面、无卡背走程序化；稀有度映射 ≥3 传说 / 2 稀有；manifest.json 缓存 60 秒、构建目录不可变一年；8 月短包扣费修复真实存在（4a8c85d）；离线可开已安装卡组；C# 已安装本地包不受重建影响；钱包全局按用户、抽卡状态按卡组按用户隔离；新卡组不受 grandfather 逻辑影响；Content Intelligence 对零评分卡组不报错。

<!-- paths-not-on-disk
     本文档里出现、但磁盘上已经没有的仓库路径，逐条登记在这里（规则见 frontend/tests/docsPaths.test.ts）。
     E03（2026-09-22）把 manifest 重建移进 src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs，删除了下面这个文件；上文句子保持原样。
- src_C/Worker/Manifest/ManifestService.cs
-->
