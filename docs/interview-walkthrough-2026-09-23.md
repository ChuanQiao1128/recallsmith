# DeveloperCards — 面试讲解手册（2026-09-23）

用途：把这个项目讲给中级/高级工程师岗位的面试官。每条事实都可被追问、可被验证（代码、AWS 控制台、App Store 都在）。
配套：`docs/backend-architecture-review-2026-09-22.md`（生产就绪评审）、`docs/recallsmith-resume-bullets.md`（简历口径纪律）。

**主张纪律**：只有已上线且有证据的行为才用过去式。没做的事在 §7 明写，面试时主动说——主动暴露边界比被问出来强得多。

---

## §0 一页速览（背下来）

| 项 | 事实 |
|---|---|
| 是什么 | iOS 学习 App：用抽卡收集的方式做考试备考。上架 App Store（1.6.1，2026-09-23 上线） |
| 我的角色 | 独立开发：产品、iOS、后端、控制台、数据、基础设施、发布全栈 |
| 规模 | 手机端 ~40k 行 / 234 文件（TS），后端 ~31k 行 / 260 文件（C#），控制台 ~13.5k 行 / 71 文件（TS），2,300+ 自动化测试 |
| 线上内容 | 3 个卡组、893 张卡（C# 81、AWS SAA-C03 371、Claude CCDV-F 441），其中 307 张是带解析的选择题 |
| 技术栈 | React Native + Expo（TS）· React + Vite 控制台 · .NET 8 Lambda（API + Worker）· PostgreSQL RDS · S3 + CloudFront · SQS · Cognito · Snowflake（分析）· Terraform |
| 近一个发布周期 | 196 次提交 / 85 个合并 PR / 1 次二进制审核 + 4 次 OTA 热更新 |
| 成本 | 生产环境 ≈ US$42/月（单人项目的显式成本取舍） |

**30 秒版本**："我做了一个上架 App Store 的 iOS 备考应用。技术上它是一个四层系统：Expo 的离线优先客户端、.NET 8 的 serverless 后端、React 的内容控制台、S3+CloudFront 的内容分发链路。我自己做产品决策、写三端代码、管 AWS 基础设施和发布流程。最近一个周期我把内容从 235 张扩到 893 张，加了选择题卡型，并把基础设施全部纳入 Terraform 管理。"

---

## §1 产品：需求 → 约束 → 取舍

**问题**：备考类 App 的留存差，因为"背卡"没有即时回报；而抽卡类游戏留存好，但和学习目标脱节。

**产品决策**：把两者的激励对齐——**抽数只能靠学习赚，不能买**。
- 学会一张新卡（第一次评到 Hard 以上）→ +1 抽
- 清空当天到期卡 → +1 抽（每天一次）
- 抽到的卡才进入你的学习路线：**你抽到什么，就学什么**

**约束**（这些决定了架构）：
1. **一个人维护** → 不能有需要值班的组件；所有东西 serverless、按量付费
2. **离线可用** → 学习是在地铁上发生的；复习和进度必须离线优先
3. **内容会持续增长** → 卡组内容和代码必须解耦，内容更新不能走 App 审核
4. **不能卖抽数** → 没有内购经济，作弊的动机低，但客户端仍不可信任
5. **审核周期 1–3 天** → 功能迭代不能每次都等审核

**关键取舍**：
- **二进制 / OTA 拆分**：原生依赖变化才发版本；纯 JS 改动走 Expo OTA。这一个周期里我发了 1 次二进制、4 次 OTA。
- **稀有度 = 难度**：不是随机稀有度，而是 Common/Rare/Legendary 直接映射卡片难度，收集欲和学习价值同向。
- **卡池 = 未拥有**：永不重复抽到已有卡，避免"氪度"式的挫败。
- **调度器只有一个**：选择题的作答结果映射到已有的四档评分（Again/Hard/Good/Easy），**不引入第二套排期算法**——这是我最满意的一个约束（见 §3.4）。

---

## §2 系统架构

```
 iOS App (Expo/RN, TS)            Console SPA (React/Vite)
   │  离线优先：本地卡组 + 进度        │  作者端：Markdown 导入、发布、内容分析
   │  Cognito (mobile pool)          │  Cognito (console pool)
   └──────────┬──────────────────────┘
              │ Bearer JWT（Lambda 内验签：JWKS/issuer/exp）
       API Gateway (HTTP API) ──► core-vpc Lambda (.NET 8, in VPC)
              │                        ├─► RDS PostgreSQL（卡片、进度、发布任务、事件 outbox）
              │                        ├─► SQS publish-jobs ──► worker Lambda
              │                        └─► S3 presign（付费卡组）
                                       worker：生成 deck.json / 分块 / delta 补丁 → S3
                                              → 重建 manifest.json → CloudFront
 手机安装：manifest → 分块下载 → sha256 校验 → 本地库
 分析：事务内写 outbox → S3 JSONL → Snowpipe → Snowflake marts → 内容质量快照回写
```

### 2.1 客户端：离线优先 + 可证明的内容分发
- **进度模型**：7 档间隔阶梯（1/2/4/8/15/30/60 天）。评分先写本地，再异步同步；多设备用 **LWW（last-write-wins）+ 单语句 ingest** 合并，服务端不做复杂冲突解决——这是刻意的简化，代价是"同一秒两台设备"会丢一次评分，收益是 ingest 是一条 SQL、幂等、可重放。
- **内容分发**：`manifest.json`（60 秒 TTL + ETag 条件请求）→ 不可变的 `builds/<buildId>/deck.json` → 大卡组走**分块下载 + 逐块 sha256 校验 + 断点续传**，小改动走 **delta 补丁**（服务端算好两个 build 之间的差异）。CloudFront 缓存不可变对象，manifest 短 TTL。
- **发布字节契约**：新增字段（`topic`、`mcq`）用 `WhenWritingNull` 序列化，**没有该字段的卡组导出必须与升级前逐字节一致**——有黄金测试钉住。这让"老客户端收到新内容"不是祈祷，而是被 CI 证明的。

### 2.2 后端：serverless，但按可靠性设计
- **两个 Lambda**：API（在 VPC 内，连 RDS）和 Worker（消费 SQS）。用**别名 + 版本**发布，API Gateway 和 SQS 触发器都指向 `prod` 别名（见 §3.1 的事故）。
- **发布流水线**：控制台点发布 → API 写任务行 + 发 SQS（同一事务里）→ Worker 取任务、生成产物、上传 S3、重建 manifest → 失败进 **DLQ（重投 3 次）**，孤儿任务有定时清理；卡组有 **live_build_id 指针**，回滚是改指针而不是重新发布。
- **鉴权**：Cognito 两个用户池（控制台 / 手机）。Lambda 内做 **JWKS 验签 + issuer + 过期 + token_use** 校验；因为 Lambda 在 VPC 里没有出网，JWKS 公钥**打包进部署包**，网络刷新只是兜底。
- **迁移**：编号 SQL + `schema_migrations` 表 + 事务包裹 + 建议锁；代码对"列还不存在"（Postgres 42703）显式容错，这样**先部署代码再跑迁移**的顺序不会 500。

### 2.3 内容作者链路（控制台）
Markdown 导入器：**词法宽松、载荷严格**——`OPT: a *`、`WHY:`、`TOPIC:` 这类标记用宽松正则识别，但载荷用一整套错误码（选项数、键序、正确数、缺解释…）阻断。导入是**幂等 reconcile**：按 stableUid 比较，产出 create/update/unchanged 计划，先预览再执行。还有一道**服务端就绪守卫**：第一张选择题写完后回读，字段没回来就中止——防止部署顺序错误把选择题静默写成普通卡（这个守卫在 2026-09-21 真的救了一次，见 §3.1）。

### 2.4 数据与分析（设计完成，尚未常态运行）
评论事件和业务写在**同一个事务**里进 `analytics_event_outbox`；发布器把 outbox 排空成 S3 JSONL，Snowpipe 入 Snowflake，staging→marts 算每张卡的质量基线（按 `answer_mode` 区分问答/选择题，否则 dwell time 不可比）。**诚实说明**：这条链路跑通过一次，目前没有定时触发，属于"设计完成、待接定时器"。

### 2.5 基础设施（Wave E，进行中）
93 个线上资源已用 **Terraform `import` 块**纳管（一次状态导入，AWS 侧零变更）；之后每次改动都是可 review 的 plan。已上线：RDS 删除保护 + 14 天备份、S3 版本化、CloudTrail、12 条 CloudWatch 告警 + SNS、SQS DLQ、IAM 拆角色去掉四个 `*FullAccess`。进行中：密钥进 SSM、网关授权器、staging 环境、CI/CD、自定义域名。

---

## §3 五个可以深挖的技术故事

面试官最想听的不是"我用了什么"，而是"你怎么发现问题、怎么判断、代价是什么"。每个故事都有提交记录。

### 3.1 部署只动了 $LATEST，而 API Gateway 调的是别名
**现象**：内容导入在第一道选择题上失败（"服务端未就绪"），而我刚部署过新代码、也点过数据库迁移，控制台显示"迁移完成"。
**排查**：迁移"成功"但列没建 → 说明跑迁移的是**旧代码** → 查 API Gateway 集成 URI，指向 `core-vpc:prod` 别名，而 `deploy.sh` 只做了 `update-function-code`（只动 `$LATEST`）。别名还停在一个月前的版本。
**修复**：部署脚本改为 `update-function-code` → `publish-version` → `update-alias` → **再对别名校验一次 CodeSha256**。
**收获**：这次是导入器的就绪守卫把问题挡在了数据损坏之前——**守卫的价值在于它替你发现你以为不会发生的事**。

### 3.2 一个会多发货币的并发缺陷（对抗式审查抓到）
**背景**：新经济规则是"每张新卡只付一次抽数"，用 AsyncStorage 里的账本去重。
**发现**：合并前我让独立的 agent 以"找出会多付钱的路径"为目标审查，它构造出：匿名使用 → 登录 → 账本被标记为"已初始化"但没有回填已学卡 → 该账号**每张已学过的卡都会再付一次**，最多把钱包打满（60+5）。它写了复现测试证明。
**修复**：账本用显式的"已初始化"标记 + 登录时从**存储里重读**进度回填，并加"远端进度未落地就不付款"的门（宁可少付，不可多付）。
**收获**：金额/库存类逻辑必须有"永不多付"的不变量测试，不能只测 happy path。

### 3.3 抽卡音效"一直卡顿"的真实原因
**用户反馈**（我自己在真机上）："声音一直卡顿"。
**排查**：环境底噪是 `loop=true` 播放一个 **0.25 秒**的占位音频；iOS 的循环实现是"播完 → seek(0) → 再播"，于是每秒 4 个接缝。另外播放器是仪式进行中懒创建的，在 JS 线程上造成掉帧。
**修复**：用脚本合成 **8 秒无缝循环**（首尾交叉淡化，并用数值验证接缝处的步进小于内部 p99）+ 进场前预热全部播放器 + 每个音效 2 个播放器轮转。同时把动画里每帧的 JS 工作搬到 UI 线程，十连的卡桌提前挂载。
**收获**："卡顿"这种主观反馈要先量化成可测的量（接缝、帧间隔、首帧延迟），否则只能瞎调。

### 3.4 选择题接入，但不新增第二个调度器
**需求**：加选择题卡型（307 张已上线）。
**诱惑**：给选择题单独做一套排期/正确率模型。
**决定**：不做。定义一张 7 行映射表，把 (判定, 自信度, 是否改选, 快慢, 首次/复习) 映射到已有的四档评分：答错⇒Again；部分正确⇒Hard；不确定⇒永不 Good/Easy；首次见面⇒永不 Easy。用属性测试（fast-check）钉住这些不变量。
**收益**：进度模型、同步协议、连续天数、奖励规则**一行都不用改**；老客户端收到选择题卡时降级成普通问答卡，不崩。
**收获**：新功能最贵的不是实现，是它引入的新状态。能映射到已有状态就别新增。

### 3.5 生产事故：网关限流写成 0，14 分钟全部 429
**经过**：加访问日志时，Terraform 里 stage 的限流字段写成了 `rate=0, burst=0`；API Gateway 把 0 理解为"全部限流"。下一次 apply 触发 stage 更新后，线上所有请求返回 429。
**发现**：**不是告警**——是我 apply 后的冒烟检查（`curl /health` → 429）。12 条告警盯的是 5xx 和 Lambda/RDS/SQS，限流是 4xx，漏了。
**修复**：CLI 先恢复，然后把限流改成带 `validation { condition > 0 }` 的变量，plan 与线上一致后再继续。
**收获**：(1) 0 在很多云 API 里不是"不限制"而是"全禁"；(2) 告警覆盖面要按**失败模式**设计，不是按资源；(3) 每次 apply 后必须有冒烟检查——这次它就是唯一的探测器。

> 还有两个可以备用的：JWT 回退路径没有验签（任何人可以伪造 super_admin，已修并在生产验证伪造 token 返回 401）；Terraform 的 plan 允许清单抓到一次真实漂移（SQS 触发器 apply 后被置为 Disabled）。

---

## §4 讲解脚本

### 2 分钟版（"介绍一个你做过的项目"）
1. **一句话**：上架 App Store 的 iOS 备考应用，把抽卡收集和间隔重复绑在一起；我一个人做完产品、三端代码、AWS 基础设施和发布。
2. **规模**：3 个卡组 893 张卡，2300+ 测试；一个发布周期 85 个 PR、1 次审核 + 4 次热更新。
3. **一个有意思的架构点**：二进制和 OTA 拆分——原生依赖变了才发版本，纯 JS 走 Expo OTA，所以我能在审核期间继续给用户交付功能。
4. **一个我会拿出来讲的问题**：任选 §3 里一个（推荐 3.1 或 3.5，因为它们体现"排查 + 系统性修复"）。
5. **收尾**：我知道它离生产级还差什么——CD、staging、数据管道常态化，正在按一份评审文档逐条补。

### 10 分钟版（白板）
按这个顺序画，每画一块说一句"为什么"：
1. 两个客户端 + 两个 Cognito 池 → **为什么两个池**（作者和用户是两类身份，权限模型不同）
2. API Gateway → Lambda 别名 → **为什么别名**（可回滚、可灰度；顺带讲 §3.1 事故）
3. RDS + SQS + Worker → **为什么异步**（发布是分钟级的 CPU 活，不能占着 API 连接）
4. S3 + CloudFront + manifest/分块/delta → **为什么不直接查 API 取卡**（离线、成本、CDN 缓存命中）
5. 事务 outbox → S3 → Snowflake → **为什么 outbox**（业务写和分析写必须同生共死，又不能让分析拖慢请求）
6. 最后画一条"发布一张卡"的完整数据流，从控制台点击到手机上出现——这条线能把上面所有组件串起来。

### 被问"这个项目有 AI 参与吗"
直说：**内容初稿和大量代码是我用 agent 流水线产出的，但设计、契约、门禁和上线决策是我的**。然后讲流水线本身——这是加分项，不是减分项：
- 每个 issue 有 brief（契约、范围、验收）、独立 worker、三层门禁（禁用词/抑制扫描、按根测试、per-issue verify 脚本）、不合格自动重试、失败自动阻塞并通知
- 基础设施 issue 的 worker **只允许 `terraform plan`**，apply 由我核对允许清单后执行
- 它抓到过真实缺陷（§3.2 的多付货币），也踩过真实的坑（脚本的 grep 把 `--` 当选项、依赖判定把"被阻塞"当"已完成"），每个坑都进了复盘清单
一句话总结："我用 agent 提高吞吐，用门禁保证我仍然为每一行负责。"

---

## §5 20 道追问（含答题要点）

**架构**
1. 为什么 serverless 而不是一台 EC2？→ 单人维护、流量个位数并发、按量付费；代价是冷启动（用 SnapStart）和 VPC 内无出网（所以 JWKS 打包）。
2. Lambda 在 VPC 里怎么访问 S3/SQS？→ VPC endpoint；也正因为没有 NAT，运行时取密钥要走 endpoint（成本），所以选择部署时注入。
3. 为什么内容走 CDN 而不是 API？→ 不可变构建 + 长缓存 + 离线安装；API 只回 manifest。
4. 卡组更新怎么不重复下载？→ delta 补丁（服务端算两个 build 的差异）+ 分块 + 逐块 sha256 + 断点续传。
5. 手机离线改了进度，两台设备冲突怎么办？→ LWW + 单语句 ingest；讲清楚为什么不做 CRDT（收益不抵复杂度）。

**可靠性**
6. 消息消费失败去哪？→ DLQ + 重投 3 次；可见超时必须大于函数超时（我踩过：300s < 615s）。
7. 发布错了怎么回滚？→ `live_build_id` 指针，改指针即回滚；Lambda 回滚是把别名指回上一个版本。
8. 部署顺序错了会怎样？→ 讲 42703 容错和"先部署代码、后迁移"的向前兼容规则。
9. 你怎么知道线上坏了？→ 诚实回答：12 条告警 + SNS，且承认 §3.5 那次是冒烟检查发现的，告警没覆盖 4xx，已补。
10. RPO/RTO？→ RDS 自动备份 14 天 + 迁移前手工快照；目标 RPO 24h / RTO 数小时；没开 Multi-AZ 是成本取舍，开它是一个参数。

**安全**
11. API 怎么鉴权？→ Cognito JWT，**在 Lambda 内验签**（JWKS/issuer/exp/token_use）；网关授权器作为第二层在排期中。可以主动讲 §3 里那个未验签回退的修复。
12. 密钥放哪？→ 现状是 Lambda 环境变量，正在迁 SSM SecureString（部署时注入，运行时不取，因为 VPC 无出网）；轮换流程写在 runbook。
13. 最小权限怎么落地？→ 讲拆角色 + 去掉四个 `*FullAccess` + 按桶/前缀/队列限定；用 `simulate-principal-policy` 验证。
14. 客户端能改自己的余额吗？→ 能改本地，但服务端有账本；并坦白服务端钱包权威化还在计划里（诚实比吹牛安全）。
15. 支付回调怎么防重放/丢失？→ RevenueCat webhook 用共享密钥 + 常量时间比较；DB 失败必须回 5xx 让对方重试（原来吞成 200，是个真实缺陷）。

**数据与产品**
16. 为什么要 outbox？→ 业务与分析同事务，异步排空，不阻塞请求，可重放。
17. 选择题为什么不单独做调度？→ §3.4 的 7 行映射表 + 不变量测试。
18. 内容怎么保证不重复/不侵权？→ 只取材公开官方文档，逐张记来源；卡组描述写明非官方、非模拟考。
19. 怎么衡量一张卡是好是坏？→ Snowflake 里按 `answer_mode` 分组的基线（失败率、dwell time），标"有挑战性"vs"可能表述不清"；坦白目前数据量不足。
20. 下一步最想做什么？→ CD + staging + 数据管道定时化；理由是它们直接降低我犯 §3.1/§3.5 那类错误的概率。

---

## §6 可以带去面试的证据

- App Store 链接（1.6.1 在架）
- 仓库：`docs/backend-architecture-review-2026-09-22.md`（我自己给自己做的生产就绪评审，含差距表和路线图）
- 仓库：`docs/delivery/r16-issues/`（每个 issue 的契约 + 验收脚本）
- 事故复盘：`~/.claude/skills/dynamic-delivery-workflow/references/postmortem.md`（13 条流水线事故）
- 测试：`mobile/tests`（1,062）、`frontend/tests`（832）、`src_C/Tests`（462）

---

## §7 我会主动说的边界（不说会被问出来）

| 没做 | 为什么 / 现状 |
|---|---|
| 真实用户数据 | 刚上架，没有 DAU/留存/p95 可引用；不编数字 |
| CI/CD | CI 跑测试，部署仍是脚本手动触发；CD 在 Wave E 的计划里 |
| Staging | 只有生产；迁移直接打生产（有快照和向前兼容规则兜底） |
| Snowflake 常态运行 | 管道搭好、SQL 验证过，但没有定时触发器 |
| 崩溃上报 | Sentry 在 1.6.0 被移除（隐私标签 + 原生依赖），下一个二进制回归 |
| Multi-AZ / WAF / 多区域 | 显式成本取舍，$42/月的单人项目 |
| Android | 只有 iOS 构建通道 |

---

## §8 简历写法（2026-09-23 修订：第 1 条改为项目描述行；补入 Snowflake 数据链路）

### 中文

> **DeveloperCards** — 独立开发的 iOS 备考应用（App Store 在架）· React Native/Expo (TypeScript)、React、C#/.NET 8、PostgreSQL、AWS（Lambda / API Gateway / SQS / RDS / S3+CloudFront / Cognito）、Snowflake、Terraform · 产品、三端代码、数据与基础设施均由本人完成

1. **设计并实现离线优先的内容与进度链路**：卡组以不可变构建发布，支持**分块下载、delta 补丁与逐块 sha256 校验**；离线评分经**事务型 outbox** 以单条语句入库；新增字段保持**导出字节级向后兼容**（黄金测试钉住），老版本客户端无需升级即可接收新内容。线上内容从 235 张扩展到 **893 张（含 307 道带解析的选择题）**，新卡型复用既有调度模型、未引入第二套排期。
2. **搭建行为数据链路并用于内容质量评估**：业务写与分析写在同一事务内落 outbox，异步排空为 S3 JSONL，经 Snowpipe 进入 Snowflake，staging/marts 按**作答形式分区**计算每张卡的失败率与停留时长基线，将卡片标记为"有挑战性"或"可能表述不清"并回写控制台；全链路已端到端验证，定时调度为下一步。
3. **把 click-ops 的生产环境纳入 Terraform**（一次性导入 93 个线上资源、AWS 侧零变更），并补齐生产级基线：SQS 死信队列与重投、12 条 CloudWatch 告警 + SNS、CloudTrail、RDS 删除保护与 14 天备份、拆分执行角色并移除 4 个 `*FullAccess`；同期清理闲置资源使月度成本下降约 12%。
4. **用自建的多 agent 交付流水线提高吞吐，并用门禁保证质量**：每个 issue 带契约与验收脚本，三层门禁（静态扫描、按模块测试、逐 issue 验收）+ 对抗式审查；该流程在合并前拦下一个会重复发放游戏内货币的并发缺陷，并促成一处未验签 JWT 鉴权漏洞的修复（生产验证伪造管理员令牌返回 401）。一个发布周期内交付 **85 个合并 PR、1 次二进制审核与 4 次 OTA 热更新**。

### English

> **DeveloperCards** — Independent iOS exam-prep app, live on the App Store · React Native/Expo (TypeScript), React, C#/.NET 8, PostgreSQL, AWS (Lambda, API Gateway, SQS, RDS, S3+CloudFront, Cognito), Snowflake, Terraform · sole engineer across product, three clients, data and infrastructure

1. Designed and built the offline-first content and progress pipeline: immutable deck builds with chunked download, delta patches and per-chunk SHA-256 verification; offline reviews reconciled through a transactional outbox and single-statement ingest; new fields keep exports byte-identical for older clients (pinned by golden tests). Grew live content from 235 to 893 cards, including 307 explained multiple-choice items, reusing the existing scheduling model instead of adding a second one.
2. Built the behavioural-analytics path used to score content quality: business and analytics writes share one transaction via an outbox, drained asynchronously to S3 JSONL, ingested by Snowpipe into Snowflake, where staging/mart models compute per-card failure-rate and dwell-time baselines partitioned by answer mode and flag cards as "productively challenging" or "possibly unclear" back in the console; validated end to end, scheduled ingestion is the next step.
3. Brought a click-ops production environment under Terraform (93 live resources adopted with zero AWS-side change) and closed the production-readiness gaps: SQS dead-letter queue with redrive, 12 CloudWatch alarms with SNS, CloudTrail, RDS deletion protection and 14-day backups, split execution roles replacing four `*FullAccess` policies; retiring idle resources cut the monthly bill by ~12%.
4. Ran delivery through a self-built multi-agent pipeline — per-issue contracts, acceptance scripts, three gate layers and adversarial review — which caught a concurrency defect that would have double-granted in-app currency and drove the fix for an unverified-JWT auth path (forged admin tokens now rejected in production); 85 merged PRs, one binary review and four OTA releases in a single cycle.

### 口径说明
- 第 1 条的"235 → 893"和"307 道选择题"可由线上 manifest 验证；"字节级向后兼容"有黄金测试。
- 第 2 条**不说"生产运行中"**：管道已实现并端到端验证，但目前没有定时触发器。补上 EventBridge 定时（约 1 小时工作量）后，把"定时调度为下一步"换成"每 15 分钟增量入库"。
- 第 3 条的"约 12%"= 删除无流量的旧 Lambda 版本、预置并发、陈旧密钥后，月账单从 ≈$42 降到 ≈$37；被追问时给这个明细。
- 第 4 条的两个缺陷都有提交记录和复现测试。
