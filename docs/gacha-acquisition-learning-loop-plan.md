# DeveloperCards 抽卡引流与学习闭环优化规格

| 项目 | 内容 |
| --- | --- |
| 状态 | 产品与实现计划，代码核验修订版，未开工 |
| 修订日期 | 2026-09-10 |
| 代码基线 | `main@08cfc09` |
| 范围 | Mobile 抽卡、学习、奖励、首次体验；首发方向为 C# 14 / .NET 10 LTS 与 AWS SAA-C03 |
| 工作流 | 计划 → issues → 实现 → review → merge |
| 本次边界 | 只修订计划，不修改应用代码 |

## Context

DeveloperCards 的差异化不是“又一个题库”，而是把新知识变成可抽取、可收藏、可间隔复习的卡片：

> 每抽必新，学习赚下一抽。

抽卡负责期待和发现，学习调度负责长期掌握。用户是否拥有卡、卡片有多难、视觉上有多稀有、用户是否掌握，是四件不同的事。

本版先逐条核对真实代码，再吸收外部审查。审查意见不是事实来源；凡与代码冲突，以代码和可复现测试为准。

### 已确认的产品裁决

1. 产品最终重点是 `C# Interview` 与 `AWS SAA-C03` 两个方向，但允许按批次先完成一个再完成另一个。
2. 不新增独立“免费诊断题”入口；能力信号从正常抽卡、首次学习与后续复习中形成。
3. Udemy 课程只用于确定知识范围和章节结构，不复制、逐题改写或发布课程题干、选项与解析。
4. AWS 卡片独立创作并由 AWS 官方资料核验；C# / .NET 卡片由 Microsoft 官方资料核验。
5. 不销售随机抽卡币，不做重复卡碎片、付费正确率、付费掌握度或断签惩罚。
6. 当前奖励政策保持“真实 full clear 得 1 抽”；本轮不借修 bug 改成分档奖励。
   > 2026-09-21：裁决 6 已由 `docs/economy-v2-learn-to-earn-2026-09-19.md` §2（R1–R10，学一张赚一抽）替换；本条保留为历史。
7. 到期学习是主任务，抽卡是奖励与新内容入口，不能让“继续抽”长期压过“开始学习”。

### 文档优先级

本文是此产品方向后续 issue 的依据。当它与早期 v7/v9 设计或本文旧版附录冲突时，以本修订版为准；在 issue merge 前，线上行为仍以当前代码为准。

## Goals

1. 新用户不经过考试、注册或通知授权，即可选择真实存在的学习方向并看到第一次抽卡。
2. `sessionLimit` 与奖励分母来自同一份真实可学习工作，不再出现“界面还有一张、实际已无卡”的路线。
3. 在受支持客户端、单设备且持久化成功的范围内，钱包容量不再导致已赚奖励被确定性丢弃。
4. 抽卡结果优先进入刚抽到卡片的学习，而不是默认继续清空钱包。
5. 内容进入发布管线前，import、API、DB、publish、mobile 与 analytics 对 difficulty 使用同一契约。
6. C# 与 AWS 内容均独立原创、可追溯；版本化元数据按真实消费者分阶段建设。
7. 用获客、抽卡→学习转化和延迟回忆共同证明价值，不用开包次数冒充学习效果。

## Non-Goals

- 不在本计划中扩展到 AWS DVA、Cloud Practitioner、Azure、GCP 或 AI 卡池。
- 不建立完整模拟考试、排名、PvP、现金奖励或付费随机结果。
- 不一次性改造整个 SRS、钱包事件系统或多设备冲突模型。
- 不宣称现有本地 receipt + LWW wallet 已经在任意崩溃和多设备场景下 exactly-once。
- 不预先承诺“每池 20–30 张”；内容数量由 golden slice 的真实成本和私测消耗倒推。
- 不把七八个新字段一次穿透所有系统层。
- 不在本轮实现 `Supersedes` 生命周期、完整来源版本系统或 rarity/difficulty 物理拆分。
- 不把收藏完成、自我评分或 App 徽章包装成考试通过概率或官方认证。

## Current System

### 已核实的代码事实

| 事实 | 代码依据 | 产品含义 |
| --- | --- | --- |
| 新账户一次性获得 3 抽 | `mobile/src/features/gacha/rewards/rewardWallet.ts:33-37,162-190` | 首次抽卡可以很快发生 |
| 抽卡只从未拥有卡选择，并按 `StableUid` 去重 | `mobile/src/features/gacha/draw/poolSelection.ts` | “每抽必新”与真实机制一致 |
| Owned + pity 先写为一个 draw-state；钱包随后另写 | `mobile/src/features/gacha/draw/drawCommit.ts:66-92`、`mobile/src/screens/DrawScreen.tsx:500-568` | 当前抽卡失败方向偏向用户，但卡与扣券不是同一事务 |
| Route planner 只统计 due/new，picker 还会选择 updated，并受 mode/owned gate 影响 | `sessionPlanner.ts:74-152` | 路线分母与真实候选来源并未统一 |
| `due=0,new=1/2` 且无 updated 补位时，route 分别错误显示 2/3 | `sessionBuilder.ts:40-44` | 用户学完真实卡仍无法 full clear |
| `due=0,new=3+` 时 route 为 3，picker 可以真的完成 3 张 | `sessionBuilder.ts:41-44`、`sessionReviewHelpers.ts:74-89` | “三张 starter 全抽后一定失败”不成立 |
| full clear 是获得 1 抽的唯一路径 | `rewardResolver.ts:12-29` | 错误的 `sessionLimit` 会直接污染奖励 |
| `minimumGoal` 被传入奖励函数但没有被读取 | `rewardResolver.ts:19-28` | 契约暗示不存在的奖励分档 |
| streak 实际由第一次 hard/good/easy 评分触发，不真正读取 `minimumGoal` | `sessionStore.ts:54-58` | 将来 minimumGoal > 1 时会产生错误；Again 的 UI/持久化也可能分歧 |
| Challenge 仍宣称 full clear `+2`，真实规则是 `+1` | `mobile/src/screens/ChallengeScreen.tsx:20-32` | 用户承诺与结算不一致 |
| 钱包 available 上限 30、reserve 上限 5，超出进入 `dropped` | `rewardWallet.ts:50-65` | 已赚奖励会因容量被确定性丢弃 |
| 当前 Summary 可在 dropped 后仍显示“added”和可使用新奖励 | `summaryMapper.ts:198-264`、`SessionSummaryScreen.tsx:156-175` | 比单句“reserve full for now”更严重：UI 会显示假成功 |
| Session receipt 先写、wallet 后写，崩溃窗主动选择少发 | `rewardWallet.ts:311-330`、`rewardWalletOrdering.test.ts:46-73` | 新增 overflow 字段不能解决原子性 |
| Economy floor 仅在 Home 刷新且三个饥饿条件同时成立时，每本地日最多发 1 抽 | `economyFloor.ts:49-147`、`HomeScreen.tsx:219-272` | 它是安全网，不是 session 奖励；新用户也可能同日得到，而非必等次日 |
| Audience Survey 存在，但抽卡输入不读取其偏好 | `AudienceSurveyScreen.tsx`、`poolSelection.ts` | 首抽前增加了未兑现的摩擦 |
| Draw Result 有券时偏向继续抽 | `DrawResultScreen.tsx` | 收藏行为容易压过刚抽到卡片的学习 |
| C# 已有发布过 115 张卡的仓库记录 | `docs/content-delivery-v3.md:3-6` | 不需要再凭空手写 20–30 张 C# 才能验证机制；先确认当前生产 manifest |
| AWS SAA 目前只在 mock/UI 文案中可见，未核实真实内容卡池 | `mobile/src/mock/*`、`LevelScreen.tsx` | 两方向 onboarding 不能先于真实 AWS golden slice 上线 |
| `Topic` 等八个拟议字段均不在 Card 主契约 | `frontend/src/types/card.ts`、`001_init.sql:36-54`、`Cards.cs`、`deckExport.ts` | 它们不是“顺手加几列”，必须按消费者拆分 |
| Mobile 已零散读取未接线的 `Tag`，Tag Explorer 仍用 mock | `cardIcon.ts:149-170`、`CardDetailScreen.tsx:171-184`、`TagExplorerScreen.tsx` | 新增 `Topic` 前必须裁决 Topic/Tag，不能再造同义字段 |

代码核验时，`mobile` 的 unit suite 为 50 个文件、320 项测试全部通过。这说明现有测试没有覆盖上述 route cardinality 红例，并不说明红例不存在。

### 外部审查裁决台账

| 审查主张 | 裁决 | 证据与计划影响 |
| --- | --- | --- |
| due=0 时路线可能比真实卡多一个 | **部分成立** | fresh mixed 的 new=1/2 成立；new=3+ 不成立；有 updated 时也可能补位。Issue A 必须从统一 eligible work 推导，不钉死“一行修复” |
| 三张 starter 全抽后只能学两张、首日奖励必为 0 | **不成立** | 当前 limit=3，picker 能连续给出三张新卡；测试必须把这条保留为绿例，防止以后再次误判 |
| 路线偏差会进入奖励判定 | **成立** | `plannedLimit → sessionLimit → computeSessionRewardPulls` 调用链成立 |
| 新用户失败后必等次日 floor | **不成立** | 若当天尚未领取 floor，返回 Home 后可同日补发；真实问题是奖励因果和文案失真 |
| `minimumGoal` 在奖励接缝是死参数 | **成立** | 保持 full-clear-only，删除奖励函数中的假参数；streak 契约另行对齐 |
| 满钱包丢奖励且文案误导 | **成立** | 不只 `reserve full for now`；现代 Summary 还可能显示“added”与错误 CTA |
| 20–30/池把最大工作量藏进一格 | **成立** | 删除固定数量；先做 5 张 golden slice 并测真实中位工时、返工率和内容消耗 |
| 新字段全部不存在 | **成立** | 但“每个字段都要走 analytics 六层”过度概括；改为 runtime、authoring、deck、future lifecycle 四类 |
| 需要混版本客户端不变式 | **成立** | P0 复用现有 reserve，避免老客户端覆盖未知 pending 字段；公开保证限定受支持版本 |

### Difficulty 的真实分歧

这不是简单的“0..4 vs 1..3”两方分歧：

1. Console 控件只能新选 1/2/3，但共享 validator 和 markdown import 接受 0..4。
2. API、cards DB 与 publish 只要求整数，不限制范围。
3. Mobile loader 将 0 静默改为 2，却保留 4；rarity 再把 4 折叠成 LEG。
4. Review event 将 0 变 null、保留 4。
5. Analytics 以三档算法处理，最终 snapshot 表只接受 1/2/3；一条越界数据可能让整批 import 回滚。
6. 当前 importer 没有持久化 staging table。“盘点 import 暂存数据”不是可执行任务。

因此先盘点，后迁移/隔离，再收紧写入口；不能先上 validator，也不能 clamp 或默认成 2。

### 当前漏斗

`App Store → Welcome → Audience Survey → Notification Prompt → Home → Draw → Ceremony → Result → Library/Study`

目标漏斗是：

`App Store → 选择真实卡池 → 首抽 → 学习刚抽到的卡 → 真实奖励 → 再抽/回访`

## Proposed Architecture

### 1. 三层职责

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| Discovery / Collection | 选卡池、抽未拥有卡、开包、收藏 | 不计算 mastery |
| Study / SRS | eligible work、首次学习、到期复习、版本更新复习 | 不改变拥有权或视觉稀有度 |
| Reward / Economy | 根据已完成的真实路线结算抽数 | 不把 floor、付费或单次自我评分伪装成掌握 |

### 2. Route 与 Reward 使用同一事实来源

P0 引入一个纯的 eligible-work 结果，至少包含候选 `StableUid`、候选原因（due / updated / new）、mode 与 owned-gate 结果。Planner、Session picker、进度分母和 Reward 全部消费同一个结果，不再各自重算相似数字。

行为契约：

1. 同一 session 的候选 uid 去重并在开始时确定；评分不会凭空扩大 full-clear 分母。
2. `review-due` 只把 due 放进路线，`learn-new` 只把 new 放进路线，`mixed` 明确使用 due → updated → new 的优先级。
3. `sessionLimit` 等于本轮选中的候选数，并受明确的 session cap 限制。
4. 没有 eligible work 时不创建可领奖的假路线。
5. 为避免把 bug 修复变成节奏实验，fresh mixed P0 默认保留当前可达行为：1/2/3/5 张 new 对应 1/2/3/3 张路线。
6. Full clear 继续只发 1 抽；`minimumGoal` 从 reward 计算签名退出，只用于已明确的 streak/进度语义。
7. Economy floor 保留，但事件、文案和指标都标记为 floor grant，不能记成“学习赚到”。

这一裁决会让“抽 1 张→学 1 张→赚 1 抽”成为合法路径。它可能鼓励连续解锁，也可能帮助学习转化；P0 先保证承诺真实，再用延迟回忆数据判断是否需要跨日或批量奖励，不能用不可达路线暗中限流。

### 3. Wallet 复用现有 reserve，不新增 pending 字段

P0 选择：

- `availablePulls` 保留产品上限 30，表示现在可消费的抽数。
- `reservePulls` 保留原字段名，但取消产品层 5 抽上限，表示已赚、等待自动补位的 backlog。
- 奖励先补 available，剩余全部进入 reserve；新版 `dropped` 必须恒为 0。
- 消费后继续使用现有 reserve → available 自动补位。
- UI 只显示“30 ready · N queued”，不再宣称钱包整体 full，也不把总余额称作“刚赚到的 1 抽”。

选择它而不是 `pendingEarnedPulls` 的原因：mobile、本地 JSON、sync、C# endpoint 和 Postgres 已经携带 reserve 且没有读入上限；老客户端也会保存和消费大于 5 的 reserve。新增第三字段会被老客户端解析后覆盖，并要求服务端部分字段合并。

P0 的诚实保证范围是：

> 在当前受支持客户端、单设备且持久化写入成功时，钱包容量不会造成奖励丢弃。

P0 **不**宣称解决：receipt-first/wallet-second 崩溃少发、跨设备 LWW、卸载/换机 receipt 丢失、旧客户端继续产生的新奖励 drop。若产品要公开承诺“任何情况下永不丢”，必须另建原子 reward ledger；一个新 pending 标量不够。

### 4. 新用户与回访旅程

新用户：

1. Welcome 只说明“每抽必新，学习赚下一抽”。
2. 内部版可在两个 golden slice 就绪后测试双方向选择；公开版必须等两池同时通过来源、质量与 unique-draw runway 门槛。
3. 不先注册、不先要通知权限；选择直接设 active deck 并进入首抽。
4. Result 主 CTA 学习本次 drawn uid；继续抽为次要动作。
5. 第一次真实评分并计算出下次复习时间后，再解释通知用途并请求权限。

回访用户：

1. 有 due/new/updated 工作时，Home 主 CTA 进入学习。
2. 完成真实路线后显示实际结算位置：available 或 reserve。
3. Summary 的 Draw CTA 只在真实可消费抽数存在时出现。
4. 已拥有卡只由 SRS/版本更新重现，不伪装成重复抽卡。

### 5. 两个重点内容方向

| 卡池 | 核心用户 | 内容骨架 | 进度表达 |
| --- | --- | --- | --- |
| C# Interview | 准备中级 Full Stack / .NET 面试的开发者 | 语言与类型、OOP/SOLID、async/concurrency、ASP.NET Core/API、EF Core/数据、测试/调试/安全 | Collected、Topic coverage、Due、Mastery |
| AWS SAA-C03 | 复习 Solutions Architect Associate 的学习者 | Secure 30%、Resilient 26%、High-Performing 24%、Cost-Optimized 20% | Collected、四领域 coverage、Due、Mastery |

截至本次修订，C# 内容的版本敏感部分以 [C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) / [.NET 10 LTS](https://dotnet.microsoft.com/en-us/platform/support/policy) 为发布基线；基础概念仍按跨版本方式表达。AWS 领域权重以当前 [AWS SAA-C03 Exam Guide](https://docs.aws.amazon.com/aws-certification/latest/solutions-architect-associate-03/solutions-architect-associate-03.html) 为准。版本和权重用于内容核验与覆盖，不用于宣称模拟成绩或通过概率。

### 6. 内容按 golden slice 和批次推进

“20–30 张/池”从承诺改为待验证结果：

1. Golden slice 1：从现有 C# 内容选择 5 张，补齐来源与主题，走通写作/审核→发布→下载→抽取→学习。
2. Golden slice 2：独立创作 5 张 AWS 卡，至少覆盖四个考试领域，再走同一链路。
3. 两个 golden slice 只证明工程和内容工作流，不称为市场 pilot。
4. 每批记录每张卡的写作+核验中位耗时、返工率、发布失败率、draw→first-study 和接近抽空时间。
5. 私测所需卡数按下式裁决，而不是先拍 20–30：

   `每池最小卡数 = max(主题覆盖下限, 目标观察期内 P75 用户累计唯一抽卡数 + 缓冲)`

6. 在没有数据前，每次只增加 5 张；任何更大批量都要由覆盖缺口或用户消耗证据触发。

### 7. 元数据按消费者分层

P0 runtime 只新增两个字段：

- `Topic`：单值、受控的主要知识主题；它取代当前未接线的 `Tag` 概念，不并存两套同义字段。
- `SourceUrl`：用户可在 Card Detail 打开的官方依据链接。

P0 发布规则只对两个目标 pilot deck 强制 Topic/SourceUrl；legacy deck 保持 nullable，避免一次迁移所有历史内容。

其余元数据不作为 P0 Card runtime 字段：

| 元数据 | 首期位置 | 以后何时进入产品契约 |
| --- | --- | --- |
| `LastVerifiedAt` | authoring/release 核验台账 | 需要自动过期提醒时 |
| `SourceVersion` | authoring/release 核验台账 | 版本变化需要机器筛选时 |
| `ContentOrigin` | authoring/release 核验台账 | 出现多个内容供应渠道时 |
| `CurriculumReference` | 内部台账，仅记录 Udemy 章节范围 | 预计不下发 mobile，也不作为事实来源 |
| `ExamCode` | Deck 级，AWS golden slice 固定 SAA-C03 | 出现同证书多考试版本并存时 |
| `Supersedes` | 独立未来生命周期/关系设计 | 第一例真正需要替代旧 StableUid 时 |

现有 `Revision` 已能表示同一概念卡的内容修订，不是新字段。

### 8. 随机性与稀有度

1. 抽卡继续只从当前卡池未拥有卡中选择，收藏无重复，复习可以重复。
2. P0 不把 due 卡放回抽卡池；SRS 与抽卡职责分开。
3. `Difficulty 1/2/3 → COM/RAR/LEG` 暂时保留，但产品文案解释为挑战深度，不代表价值或 mastery。
4. 有 Topic 数据后再判断用户主动选主题还是透明 coverage guard；不先写隐藏操控算法。
5. Fast Open、复杂保底、rarity/difficulty 拆分和收藏终局玩法都等真实行为数据。

## Data Model

### Card runtime contract

| 字段 | 当前状态 | P0 规则 |
| --- | --- | --- |
| `StableUid` | 已存在 | deck 内唯一；文案修订不改变 |
| `Revision` | 已存在 | 正整数；同一概念内容改变时递增 |
| `Difficulty` | 已存在但契约分裂 | 统一为 1/2/3；存量先迁移或隔离，禁止 silent clamp/default |
| `Topic`（mobile）/ `topic`（JSON/API）/ `topic`（DB） | 不存在 | legacy nullable；目标 pilot 发布必填；mobile 展示与 coverage 使用 |
| `SourceUrl` / `sourceUrl` / `source_url` | 不存在 | legacy nullable；目标 pilot 发布必填；只允许受支持的 HTTPS 官方来源 |

Topic/SourceUrl 是一组共享 plumbing，但只修改真实消费者：DB migration、Cards API、console type/form/import、publish whole/chunk/patch、content contract、mobile mapper/type/Card Detail，以及对应 contract tests。Topic analytics 单独延期，不和 runtime 字段同批搭建。

### Authoring and release ledger

版本化先作为发布质量能力存在，不等同于把所有字段都塞进 Card runtime：

| 字段 | 粒度 | 首期规则 |
| --- | --- | --- |
| `deckSlug` | Deck/release | 标识被发布的真实内容方向 |
| `contentBaseline` | Deck/release | C# 使用 `csharp14-dotnet10`；基础概念卡也记录本次核验基线 |
| `examCode` | Deck/release | AWS 固定 `SAA-C03`；考试版本变化时创建明确的新 release 决策 |
| `sourceVersion` | Card authoring record | 只有来源本身有可辨版本时填写，不伪造版本号 |
| `lastVerifiedAt` | Card authoring record | 人工完成官方来源核对的 UTC 时间，不由生成时间代替 |
| `contentOrigin` | Card authoring record | `independent-original`；不能标成 Udemy-derived question |
| `curriculumReference` | Internal authoring record | 可记录 Udemy 课程章节/知识范围，不下发题干、选项或解析 |

每次目标 deck 发布必须生成可审计 ledger snapshot。它回答“这张卡按哪个考试/语言基线、何时、由谁依据什么核过”，但 P0 mobile 只消费 Topic 和 SourceUrl。未来真正出现考试换版或卡片替代关系时，再把 version lifecycle 与 `Supersedes` 提升为产品契约。

### Difficulty inventory 与迁移

强校验前必须生成：

1. 生产 `cards` 中按 deck、active/deleted、difficulty 分组的报告。
2. 当前已发布 whole deck、chunk 与 patch artifacts 中的 0/4/其他越界 uid 清单。
3. 用户手中未入库 markdown 只能在用户提供后扫描；当前系统没有 import staging table。

每个越界 uid 只能进入两种有审计记录的结果：人工迁移到 1/2/3，或隔离为不可发布。部署顺序为 inventory → 人工裁决 → 重发干净 artifacts → 收紧 import/API/publish → DB constraint → mobile 严格处理 → analytics 隔离坏维度。Review 事实不能因为 difficulty 非法而被丢弃，也不能默认成 2；analytics 必须隔离该维度而不是回滚整批。

### Wallet and reward

| 字段/事实 | P0 语义 | 保证 |
| --- | --- | --- |
| `availablePulls` | 当前可消费 | `0..30` |
| `reservePulls` | 已赚、等待补位的 backlog | `>=0`，无产品层 5 上限，仍受底层 Int32 范围约束 |
| local session receipt | 本设备的重复结算防线 | 正常重放不重复；当前崩溃窗仍可能少发 |
| `dropped` | 兼容期计算结果 | 新版成功路径必须恒为 0，后续删除 |

### Progress projections

| 投影 | 来源 | 不得替代 |
| --- | --- | --- |
| Collection | owned `StableUid` | 不等于 Mastery |
| Learning | SRS progress | 不等于 rarity |
| Coverage | Card Topic + 可达/已学状态 | 不等于考试得分 |
| Mastery | 跨日复习证据 | 不从抽到数量或 Difficulty 推导 |

## API and Job Contracts

这里的“contract”包含本地模块边界，不代表都要新建网络 API。

| 命令/事件 | 输入 | 成功结果 | 失败/重放 |
| --- | --- | --- | --- |
| `planEligibleSessionWork` | deck, progress, owned, mode, cap, now | 返回去重 uid + reason；其长度就是 sessionLimit | 空列表不创建奖励路线；所有消费者共享该结果 |
| `computeSessionRewardPulls` | sessionDone, sessionLimit | 仅真实 full clear 返回 1 | 不接收 `minimumGoal`，不发部分奖励 |
| `applySessionRewardToWallet` | local sessionId, reward | 先补 available，余量全部进 reserve | 正常 replay 幂等；崩溃原子性保持已知限制，不能虚假宣称解决 |
| `applyEconomyFloorIfStarved` | ownedNew, due, wallet, local day | 符合条件时标记为 floor grant | 每本地日一次；不得计入 session-earned 指标 |
| `commitDraw` | deck, count, current owned/pity | 每个成功槽位新增此前未拥有 uid | 空池不收费；现有卡先落盘、钱包后扣的偏向用户策略保持已知 |
| `upsertCard` | 现有 card + optional Topic/SourceUrl | 保留字段并通过 optimistic concurrency | 目标 pilot 缺元数据在 publish gate 失败，不破坏 legacy edit |
| `publishDeck` | deck + cards | whole/chunk/patch 都保留 P0 字段 | invalid difficulty 或目标 pilot 缺元数据时发布前拒绝 |
| `syncDrawState` | owned, pity, available, reserve | reserve 任意正常业务值往返不缩小 | 保留当前 LWW 已知限制；不上传 local session receipts |

### Funnel event contract

在 App Privacy 与真实网络行为对齐之前，不发送新的远程漏斗事件。获准后的最小集合：

- `onboarding_started`
- `track_selected`
- `starter_draw_committed`
- `draw_result_viewed`
- `drawn_card_study_started`
- `first_rating_recorded`
- `session_completed`
- `session_reward_settled`
- `economy_floor_granted`
- `collection_completed`

事件只保留时间、匿名/账户 scope、deck slug、card uid/revision、结果和客户端版本。不发送题干、答案、自由文本、课程内容或密钥。

## State and Error Handling

### 状态列表

Wallet 不是一个互斥 enum。它由数值事实和正交投影表达：

- Spendability：`EMPTY`（available=0）或 `READY`（available>0）。
- Backlog：`NONE`（reserve=0）或 `QUEUED`（reserve>0）。
- 当前不存在合法的“总钱包已满且必须丢奖励”状态。

Card lifecycle：

- `MISSING`：卡池存在、用户未拥有。
- `OWNED_NEW`：已抽到、未完成首次评分。
- `LEARNING`：已评分、未满足跨日掌握。
- `MASTERED`：满足现有 mastery 规则。

Session lifecycle：

- `IDLE`：无 session。
- `ACTIVE`：eligible uid 列表与 limit 已确定。
- `EXHAUSTED_EARLY`：`done < limit` 但无下一候选；这是错误状态，不是正常完成。
- `COMPLETED`：`done === limit`。
- `SETTLEMENT_PENDING`：完成但奖励尚未成功写入钱包。
- `SETTLED`：正常路径已写 receipt 和余额。
- `ABANDONED`：用户暂停；已保存评分保留，不伪造奖励。

`SUPERSEDED` 不属于本轮 Card 状态；它随未来独立 issue 再加入。

P0 中 `SETTLEMENT_PENDING` 只是进程内的逻辑状态，不是可恢复的持久状态；现有 receipt-first/wallet-second 顺序无法在重启后可靠区分“已写 receipt、未写余额”与真正 `SETTLED`。只有后续原子 ledger 才能把这两个状态做成可证明的持久生命周期。

### 事件列表

外部事件：选择卡池、抽卡、开始学习、查看答案、评分、暂停、消费抽数。

内部事件：eligible work planned、draw committed、progress persisted、route exhausted、session completed、reward calculated、reward settled、reserve promoted、floor granted、card published、difficulty quarantined、sync retried。

### 状态转移表

| 原状态/事实 | 事件 | 目标状态/事实 | 副作用 | 拒绝/恢复 |
| --- | --- | --- | --- | --- |
| Wallet EMPTY + unseeded | starter grant | READY | 一次性写 3 available + seeded marker | 重放不再发 |
| Card MISSING + available>0 | draw commit + charge | OWNED_NEW | owned/pity 落盘，按实际卡数扣券 | 空结果不扣；跨写崩溃可能免费发卡，当前偏向用户 |
| Session IDLE + eligible>0 | start | ACTIVE | 固定候选 uid 与 limit | eligible=0 不开始奖励路线 |
| Session ACTIVE | rating persisted | ACTIVE/COMPLETED | done+1、更新 SRS、消费一个候选 | 同 uid 不作为第二个 distinct 节点 |
| Session ACTIVE | no candidate and done<limit | EXHAUSTED_EARLY | 记录错误，不显示 full clear | A1 后自动测试中必须不可达 |
| Session COMPLETED | calculate reward | SETTLEMENT_PENDING | full clear 产生 1 抽 | 非 full clear 为 0 |
| available<30 | settle reward | SETTLED + available 增长 | 先填 available | receipt 重放不二次发 |
| available=30 | settle reward | SETTLED + reserve 增长 | 全量进 reserve，dropped=0 | 不得显示 wallet full 或 added-without-delta |
| reserve>0 + consume | READY + smaller reserve | 消费后自动补位 | 总扣除量只等于实际 draw | 重试不凭空增加总量 |
| Wallet EMPTY + 无 due/new | floor grant | READY | 单独标记 economy floor | 不得记作 session reward |
| OWNED_NEW | first rating persisted | LEARNING | 更新 progress/revision | sync 失败保留本地待重试事实 |
| LEARNING | mastery threshold met | MASTERED | 更新 mastery 投影 | 单次抽卡/付费不能触发 |

### 不变式

1. 每个消费的抽数对应一张此前未拥有的 `StableUid`；部分十连只按实际返回数量收费。
2. `sessionLimit`、进度 UI 与奖励分母来自同一 eligible uid 集合。
3. `EXHAUSTED_EARLY` 不能成为发布后的合法用户终态。
4. 当前奖励规则唯一：full clear +1；minimumGoal 不改变抽数。
   > 2026-09-21：不变量 4 已由 `docs/economy-v2-learn-to-earn-2026-09-19.md` §3 的不变量 4' 替换；本条保留为历史。
5. 新版成功 settlement 满足 `reward = available增量 + reserve增量`，且 `dropped=0`。
6. Floor grant 与 session-earned reward 在存储、文案和 analytics 中可区分。
7. 收藏、Difficulty、视觉 rarity、Coverage 与 Mastery 互不替代。
8. Difficulty 0/4 不得静默 clamp、默认或折叠后继续发布。
9. Legacy payload 缺 Topic/SourceUrl 仍可读取；目标 pilot 发布必须具备两字段。
10. 新版写出的 reserve>5 经受支持的 mobile/API/DB round trip 不缩小。
11. 公开文案只能声明实际完成的保证；未引入 ledger 前不能写“任何崩溃和设备下永不丢”。

### 非法转移

- EMPTY 消费抽数。
- 扣券但 owned 不增长，或空池继续扣券。
- `done < sessionLimit` 却显示 full clear 或发 session reward。
- 满 available 时将成功结算奖励放进 dropped。
- 余额没有增加却显示“pull added”或“Use 1 new pull”。
- 将 economy floor 显示为用户刚学到的奖励。
- 用 `minimumGoal` 参数暗示奖励分档，但实现不读取。
- 一次 hard/good/easy 在 minimumGoal>1 时直接保存 streak。
- 0/4 在 mobile 变成 2/LEG 后继续污染 analytics。
- Topic 与 Tag 作为两个同义字段并存。
- 卡片仅因抽到 RAR/LEG 就进入 MASTERED。

### 持久化影响

- P0 不新增 wallet 字段和 DB column；复用 `reserve_pulls`，降低混版本数据丢失风险。
- 老客户端能保留和消费 reserve>5，但可能继续显示旧“full”文案，也可能丢弃它自己后来赚到的奖励；零 drop 指标只能按支持版本 cohort 统计。
- 当前 local receipt 不同步，且 receipt-first/wallet-second 存在少发窗口；保留失败注入测试与已知限制，直到原子 ledger issue。
- Wallet 仍是 LWW snapshot；多设备同时离线改余额可能丢失或复活抽数。
- Topic/SourceUrl 对 legacy cards nullable；目标 deck 的 publish gate 实施条件必填。
- Difficulty constraint 必须在存量清理和 artifact 重发后启用，不能让老数据突然不可编辑或让 analytics 整批失败。

### 测试清单

允许转移、非法转移、重复事件和部分失败的具体矩阵见 Verification Plan；任何状态实现都必须同时覆盖四类，不能只测 happy path。

## Security and Privacy

1. 不使用真题、回忆题、dump 或未授权课程题目。
2. Udemy 只作为内部 curriculum reference；公开卡片必须独立写作。参考：[Udemy Copyright Guidelines](https://support.udemy.com/hc/en-us/articles/8926247886871-Copyright-guidelines-for-instructors)。
3. AWS 内容不声称 AWS 背书、官方题库或保证通过。
4. `SourceUrl` 只允许受支持的 HTTPS 官方域名，并通过普通系统浏览器打开；不得携带 token。
5. 在来源机制建立前，Agent MVP 只允许改善清晰度，不增加新事实；事实扩写必须等待来源+人工核验流程。
6. 不在 analytics 发送题干、答案、自由文本、课程章节内容或密钥。
7. App Store 当前显示 `Data Not Collected`，但 App 有账户和状态同步；新增远程漏斗前必须做 App Privacy 对照。
8. Premium 可以卖明确的内容访问、定制与分析，不卖随机结果、正确率或 mastery。

## Rollout Plan

### 组织原则

每个 GitHub issue 都是独立 merge 单元，结束时仓库必须可测试、可演示、可讲。A–G 是有顺序的里程碑，不是把多个跨层改动塞进一个 PR 的许可。

每个 issue 走：

1. **Plan**：当前行为、代码证据、风险、不变式、可证伪预测。
2. **Issue**：英文 scope / non-goals / acceptance / verification / rollback。
3. **Implementation**：只改该状态边界，不顺手扩 scope。
4. **Review**：代码、状态转移、失败注入和真机旅程。
5. **Merge**：完成定义全部满足，主分支仍能演示。

### A–G 里程碑与独立 issues

| 里程碑 | 独立 issue 单元 | 每次 merge 后能讲什么 |
| --- | --- | --- |
| **A. Reward denominator truth** | **A1** 统一 eligible work/limit/picker 并补 mode+updated+owned 矩阵；**A2** 删除 reward 的死 `minimumGoal` 参数并统一 +1 文案；**A3** 让 streak 真正服从 minimumGoal 与评分规则 | “一张、两张或三张都只展示真实路线，奖励分母和用户看到的一样。” |
| **B. Capacity truth** | **B1** 取消 reserve 产品上限与 dropped；**B2** 修 Summary/Home/Draw 文案和 CTA；**B3** reserve>5 的本地、sync、API、DB 与旧客户端兼容测试 | “钱包 30+5 后继续学习，奖励进入已有 reserve，不会因容量消失。” |
| **C. Difficulty contract** | **C0** 生产 DB + published artifacts 只读盘点；**C1** 每个 0/4 的迁移/隔离裁决；**C2** 按部署顺序统一 import/API/publish/DB/mobile/analytics | “一张卡在所有入口与消费者只有一个 difficulty 含义。” |
| **D. Draw → Study** | **D1** Result 主 CTA 改为学习；**D2** 本次 drawn uid 精确交给 session；**D3** Collection 与 Mastery 双进度 | “首抽不是消费终点，刚抽到的内容有明确学习去向。” |
| **E. Metadata golden slice** | **E0** Topic vs Tag ADR、SourceUrl 可见性与 authoring/release ledger 契约；**E1** 两个 runtime 字段共享 plumbing；**E2** 选择 5 张既有 C# 卡补齐、生成 ledger snapshot 并全链路发布 | “来源、版本基线和主题不是文档愿望，真实卡能穿过整条发布链并在 App 打开来源。” |
| **F. AWS + first-minute activation** | **F0** 独立创作并核验 5 张 AWS golden slice；**F1** internal flag 下测试两个真实 track 与直达首抽；**F2** 删除无效 survey、延后通知；**F3** 每次 5 张扩量并用私测计算 runway；**F4** 两池过门后才开放公开双方向 onboarding | “C# 和 AWS 都是真卡池，用户先得到价值再被请求权限，而且不会在首次体验中立刻抽空。” |
| **G. Evidence and storefront** | **G0** App Privacy 对照；**G1** 最小事件契约；**G2** 获准后埋点；**G3** Store positioning、onboarding、Result CTA 实验 | “可以证明抽卡带来学习与回忆，而不只是更多开包。” |

### 砍线

**发布不可违反：**

- Route/奖励分母与真实工作一致。
- 成功 settlement 不因钱包容量 drop。
- Difficulty 不静默纠正，发布内容独立原创且有官方依据。
- 新远程埋点前完成隐私对照。

**战略目标但可分期：**

- C# 与 AWS 最终都作为重点；内部实现和内容审核可以先 C# 后 AWS。
- 双方向 onboarding 可在两个真实 golden slice 后内部测试；公开开放还必须通过每池 unique-draw runway 门槛。

**优先延后：**

- 原子 reward ledger 与多设备 wallet event log。
- `Supersedes`、完整版本字段、Topic analytics 与自动过期提醒。
- Coverage guard、rarity/difficulty 拆分、Fast Open、社交、Daily Seed、排名与收藏终局。
- 5+5 golden slice 以外的内容扩量，直到私测 runway 证明需要。

### 发布与回滚

1. A/B 先在现有 C# 数据上完成，不依赖 AWS 或新 metadata。
2. C 先盘点和重发 clean artifacts，再收紧边界；validator 的回滚不能重新引入 silent clamp。
3. E 的新字段先 nullable/additive，再更新 producers，最后对目标 deck 启用 publish gate。
4. F 的 AWS golden slice 和双 track 先 behind internal flag；两池通过来源、质量与 runway 门槛后才公开开放 track 选择。
5. 导航和文案使用可逆配置；回滚 UI 不删除 owned/progress/reserve。
6. 若出现扣券不一致、reserve 缩小、收藏回退、复习不可达或发布坏数据，关闭对应新入口并保留已写用户事实。

## Verification Plan

### A. Route、Reward 与 Streak

Characterization 和修复后矩阵至少包括：

| mode / 条件 | 修复后结果 |
| --- | --- |
| mixed, due=0, updated=0, new=1/2/3/5 | limit=1/2/3/3 |
| mixed, due=0, updated=1, new=1 | 两个 distinct uid 均可完成；limit=2 |
| review-due, due=1, new=1 | 只计划 due；limit=1 |
| learn-new, due=1, new=1 | 只计划 new；limit=1 |
| 任意 mode + owned gate | 候选只来自 owned set |
| eligible=0 | 不建立可领奖假路线 |

还必须验证：

- 每次 `nextCurrent=null` 时，要么 `done===limit`，要么显式进入 EXHAUSTED_EARLY 并令测试失败。
- `floor 1 抽 → 抽 1 → 学 1 → session reward 1` 同日可继续，且下一抽不是 floor 冒充。
- `starter 3 抽 → 抽 3 → 学 3 → reward 1` 保持绿例。
- full clear +1；partial 0；修改 `minimumGoal` 不改变 reward。
- minimumGoal=2 时完成一张不持久化 streak；Again 不显示已保存 streak。
- Challenge、Session、Summary 所有活跃入口只承诺 +1。
- 每条钉子测试做隔离变异验证：恢复旧分母或旧文案时，目标测试必须单独变红。

### B. Wallet

- `available=30,reserve=5,+1 → 30/6,dropped=0`。
- `available=30,reserve=100,consume=1 → 30/99`。
- reserve=100 经本地 load/save 不缩小。
- reserve=100 经 mobile→API→Postgres→mobile round trip 不缩小。
- Session reward、economy floor 与 draw refund 等所有 wallet credit path 共用同一无 drop 分配规则。
- 新 UI 不输出固定 “30+5 full”，也不在余额无增量时输出 “added/Use new pull”。
- 旧客户端解析和消费大 reserve 不 clamp；它自己的新 reward drop 作为版本 cohort 已知限制记录。
- receipt 写成功、wallet 写失败的现有红/特征测试保留，直到独立 ledger issue；B 不伪装已解决。
- 两设备 LWW 测试继续标为已知限制。

### C. Difficulty

- d0/d1/d3/d4/d9 贯穿 import→API→DB→publish→whole/chunk/patch→mobile→review event→snapshot 的契约矩阵。
- 存量报告覆盖 cards DB 与已发布 artifacts；每个 0/4 有可追溯裁决。
- 新 0/4 在发布前被拒绝，旧 0/4 不被自动变成 2/LEG。
- Invalid difficulty 不丢 review 事实、不污染为 2、不让 snapshot 整批回滚。

### D–F. 产品与内容旅程

1. 首次分别选择 C# 与 AWS，都能到真实首抽，不先注册或请求通知。
2. Result 的主 CTA 精确学习本次 drawn uid，不随机换成别张卡。
3. Collection 与 Mastery 显示不同数字和解释。
4. Topic/SourceUrl create/get/update/CAS→publish→patch→mobile 完整保留；旧 payload 缺字段仍加载。
5. Topic/SourceUrl 改动触发 DeckDiff；markdown round trip 重导入为 no-op。
6. 五张 C# 与五张 AWS 均有官方来源、人工核验记录、独立原创确认和真机路径证据。
7. 五张 AWS 收齐后不再扣券，并导向学习进度；“收齐”不显示“已掌握”。

### 产品指标

Acquisition：Store impression→install、first launch→track selected、track→first draw、time-to-first-draw。

Activation：first draw→drawn-card study、study→first rating、session full clear→earned pull spent、floor attribution、EXHAUSTED_EARLY、capacity drop。

Learning：D1/D7、7/14 日延迟回忆、Again/Hard 后成功率、Collected−Mastered、各 Topic/rarity 的 draw→study、用户抽空卡池所需时间。

不把总开包数、收藏数或连续登录单独作为成功指标。除正确性必须为 0 的错误指标外，先建立基线再定百分比。

### 可证伪预测

1. Result 主 CTA 改为 Study 会提高 draw→first-study，但减少单次会话开包数；后者不自动视为负面。
2. 一卡 full clear +1 会提高连续学习与解锁，也可能增加快速自评、降低 7-day recall；若后者出现，再测试批量或跨日奖励。
3. 真实卡池选择会降低 time-to-first-draw，且不降低 first-rating 转化。
4. 若 rarity 只是 difficulty 外观，RAR/LEG 的 draw→first-study 会低于 COM；若数据不支持，不为了架构纯度拆字段。
5. Golden slice 的真实写作+核验中位耗时会决定批量成本；外部估算 15–25 分钟/张只作为待测假设。
6. `MARKDOWN_ROUNDTRIP_DRIFT` 预计非零；如果实际为 0，照实把该门标记为低价值，而不是制造成功故事。

### 三个发布实验

1. **Store positioning**：比较“Every pull is new. Learn to earn the next one.”与“Five minutes a day for C# interviews and AWS SAA-C03.”；共同观察安装、首抽、首评和 D7。
2. **Onboarding path**：旧 gate 与“真实卡池选择→直达首抽”比较；观察 time-to-first-draw、首评和通知授权，不用权限率牺牲首次价值。
3. **Result CTA**：Continue draw 与 Study drawn cards 比较；主指标是 draw→study 与 7-day recall，开包数只作 guardrail。

## Open Questions

1. C# 与 AWS 哪个完全免费，哪个使用 preview + Premium？当前不猜定价。
2. 现网 manifest 是否仍是记录中的 115-card `csharp-basics`？E0 前要读真实 manifest，而不是只信历史文档。
3. Golden slice 后，私测观察期与 P75 unique-draw runway 取多少天？有数据后再定批量。
4. Topic 是单一主类；AWS service 等第二维是否以后增加 tags？P0 不同时实现两维。
5. 何时值得把 authoring 核验台账中的 `sourceVersion` / `lastVerifiedAt` 升成产品字段？
6. 何时投入原子 reward ledger，替换 local receipt + wallet LWW 的已知限制？
7. 一卡 full clear +1 是否导致刷评分而非学习？用延迟回忆裁决，不凭抽卡量决定。
8. 通知最佳时机是首次 rating 后还是首次 full clear 后？只实现一个实验版本。
9. App Store 用统一页面还是 C# 求职者/AWS 学习者两套素材？

## Definition of Done

本计划完成需同时满足：

- eligible work、sessionLimit、picker、进度和 reward 使用同一事实来源，红例与绿例矩阵全部通过。
- Full-clear +1、minimumGoal/streak 和所有用户文案契约一致。
- 受支持版本中容量不再产生 dropped；reserve>5 可持久化、同步和消费。
- Difficulty 存量完成迁移/隔离，所有新入口统一为 1/2/3，analytics 不丢 review 或整批回滚。
- Draw Result 能进入本次 drawn uid 的学习，Collection 与 Mastery 分开。
- Topic/SourceUrl 在两个 golden slice 中完成全链路；其他字段没有被假装成 P0。
- 五张 C# 与五张 AWS 独立原创、已核验、可发布、可抽取、可学习，并生成 release ledger snapshot；它们只作为内部闭环证据。
- 两池按私测数据达到公开 runway 后，新用户可选择真实方向并直达首抽，不被无效 survey、注册或通知挡住。
- App Privacy 对齐后才启用远程漏斗；报告同时包含获客、抽卡→学习、延迟回忆和正确性错误。
- 文档明确保留 receipt 崩溃窗和多设备 LWW 边界；没有 ledger 前不宣传“任意场景永不丢”。

---

本修订已将旧附录 A 的正确发现并入正文，同时删除或纠正其未经代码支持的严重度结论，避免一份计划同时保留两个互相冲突的事实版本。

---

# 附录 B · 第二轮交叉复核记录（2026-09-10）

> 性质：**复核日志，不是与正文并列的规格。** 正文仍是唯一施工依据。
> 本附录只保留两类内容：(1) 已被撤回的主张（防止重新提出）；(2) 本轮新核实、
> 尚未并入正文的发现（供下次修订吸收）。
> 复核者：Claude（Opus 5）× Codex 交叉验证 · 基准 `main@08cfc09` · 未修改任何应用代码。

## B.1 已撤回的主张（不要重新提出）

以下曾被提出并被代码否证。记录在此，是为了避免下一轮再次消耗时间。

| 撤回的主张 | 否证依据 |
| --- | --- |
| 「三张 starter 全抽后首日奖励必为 0」 | `effectiveNew` 只存在于 `sessionBuilder.ts:41/43/47`，从不外传；picker 无新卡上限。`due=0/new=3` 可满勤 |
| 「每个新用户第一天都拿不到奖励」 | 同上，真实窗口是 `due=0 且 new ∈ {1,2}` |
| 「`minimumGoal` 驱动 streak」 | `sessionStore.ts:57` streak 由首个 hard/good/easy 评分触发，与 `minimumGoal` 无关 |
| 「删掉 `canAcceptMorePulls` 会造成测试真空」 | 反了。`homeSelectors.spec.ts:130/234` 已钉住旧 `wallet-full` 语义，旧测试会**主动保卫错误行为** |
| 「抽卡链路权限检查完全为零」 | `deckRepository.ts:510` 对非会员把 remoteUrl 换成 previewPath，下载层有间接限制 |
| 「`poolExhausted` 可直接接成 Collection complete」 | 其定义是 `cards.length < drawCount`（`poolSelection.ts:154`）。恰好剩 10 张 Open10 得 `false`，但抽完已集齐 |
| 「stale UID 会造成完成判定**双向**错」 | `>=` 下 stale UID 只能造成假完成。假未完成需要 `===`，或当前 deck 存在重复 UID |

**这批错误有同一个形状：从命名与单文件推断作用域和语义，未核全链路引用。** 建议实现阶段沿用同一条纪律——任何关于「某个值影响什么」的判断，以 `rg` 全仓引用为准，不以函数名为准。

## B.2 本轮新核实、尚未并入正文的发现

### B.2.1 [P1] 三值权限概念已经存在，缺的只是接线

`deckRepository.ts:167-171` 有一段已写好的注释与实现：

> `resolved: false` means "we could not find out", which is a different fact
> from "this user is not premium" and must not be spelled the same way.

也就是说，**「无法确定」与「不是会员」的区分在仓库里已经存在，并且作者明确写下了理由**。它只在 `resolveDeckBySlug` 一个调用点生效。

而 `SessionCardScreen.tsx:226-228` 把同一件事塌成了布尔：

```ts
} catch {
  return false;          // 网络失败 → 判定为非会员 → 随后 goPaywall
}
```

**因此 Access 状态模型不是新增概念，是把既有概念接到第二个消费点。** 这在实现难度与评审风险上都低得多，issue 描述应当据此改写——否则会被误当成一次架构扩张而被排到后面。

命中条件：`isPremiumUser` 缓存为 false 但用户确实已订阅（重装、换设备、清缓存）且此刻网络不佳。**后果是付费用户被自己已购买的卡组弹到付费墙。**

### B.2.2 [P1] 两道门的失败方向自相矛盾

| 门 | 未知时倒向 | 依据 |
| --- | --- | --- |
| 拥有权门（存储读失败） | **失效开放**，且刻意不缓存失败读 | `drawStateStore.ts` 的 catch 分支与其注释 |
| 权限门（entitlement 验证失败） | **失效关闭**，直接判非会员 | `SessionCardScreen.tsx:226-228` |

拥有权门当年写得很讲究，注释明说「一次坏读不能把空收藏钉在内存里」。**而代价更高的那道门——错了会挡住付费用户——反而倒向了更差的一边。**

修订注意：这不等于权限门应当无条件失效开放。「设备上有文件」不能证明「订阅仍然有效」，否则已过期订阅可以无限离线使用。正确形态是**有限离线宽限 + 可信快照**（见正文 Access 状态表），而不是简单反转失败方向。

### B.2.3 [P1] entitlement 服务端缓存未按用户隔离

- `premiumStore.ts:50-57`：**按用户分键**（`keyForUser`），且注释自述「只是缓存，不应作为安全放行的真相源」——这一层是对的。
- `deckRepository.ts:139-140`：`let _premiumServerCache = { atMs: 0, value: false }`，模块级、TTL 60 秒、**无 user key**。

两者不一致。切换账号后的 60 秒内存在串用窗口。修 Access 模型时必须一并处理，否则新状态机会建立在一个会串号的输入上。

### B.2.4 收藏进度失真的准确范围

- **失真的只有展示**：`drawCommit.ts:117-118` 的 `ownedAfter`（历史全量 owned）与 `totalCards`（当前 deck 长度）口径不一致，`DrawResultScreen.tsx:329` 直接渲染 `${ownedAfter}/${totalCards}`，可能出现 `2/1`。
- **真实完成判定是安全的**：`DrawScreen.tsx:118-119` 遍历**当前 deck** 的每张卡检查是否在 owned 中，stale UID 从不被遍历，因此不受影响。

**结论：当前是展示缺陷 + 危险的数据契约，不是已经发生的锁池错误。** 正确做法是抽出统一的 current-deck unique-UID 投影，供 Draw / commit / Result 共同消费；并由 Issue A 的 validator 拒绝空 UID 与重复 UID（重复 UID 是唯一能让计数型判定产生**假未完成**的原因）。

### B.2.5 付费抽数的 ledger 门是不可逆的

正文已把 ledger 列为商业化发布门，此处补一条时序约束：

> 一旦抽数具有现金价值，LWW 造成的任何一次余额错误都从体验问题变为财务纠纷，而**历史事件无法事后重建**。

因此该门的正确表述不是「必须先做」，而是：

> **在第一笔现金可购买的 pull 发生之前，服务端原子、幂等的 grant/spend journal 必须已经在线运行并已在记录真实事件。**

免费余额可以在切换时写成一次 `legacy_free_opening_balance`，不必伪造历史；但切换后必须阻止旧客户端继续覆盖 LWW snapshot，否则 ledger 会被绕过。

范围边界（避免扩大本期 P0）：若只销售 Premium 订阅、pulls 仍全部靠学习获得，则 wallet ledger **不是**订阅上线的前置条件。

## B.3 交叉复核本身的两条经验

1. **对抗式复核有效，但只在双方都读代码时有效。** 本轮七条被撤回的主张，全部是靠打开被引用的文件否证的，没有一条是靠论证否证的。
2. **一份计划不应同时保留两个互相冲突的事实版本。** 正文第一次修订时删除未获代码支持的严重度结论，是正确处理；本附录因此只记录撤回清单与尚未并入的发现，不重复正文已有内容。
