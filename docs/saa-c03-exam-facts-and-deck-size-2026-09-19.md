# SAA-C03 考试事实与"多少张卡才够"（2026-09-19）

> 状态：**研究结论，未改代码、未改内容**。方法：5 个方向并行检索（官方结构 / 计分真相 / 主流备考资源题量 / 大纲知识点计数 / 版本现状）→ 2 个反方对每条关键数字重新打开来源核对（只认官方 / 只查时效）→ 合成。共 148 条关键数字：135 条确认、12 条修正、31 条标为"无法用官方来源证实"（下文标注）。
> 所有"官方"数字来自 aws.amazon.com / docs.aws.amazon.com / d1.awsstatic.com / skillbuilder.aws 当天可访问的页面；社区和厂商数字单独标注。**没有任何题目内容进入本文。**

---

## 0. 结论先说

1. **考试 65 题，只有 50 题计分**，15 题是不计分的预测试题、混在里面认不出来。130 分钟。两种题型：单选（4 选 1）和多选（5+ 选 2+，即 "Choose two/three"）。答错不扣分，不答算错。
2. **及格线是 720 / 1000 的标度分**，不是 72% 正确率。AWS 不公布原始分换算，每套卷子通过统计等值（equating）单独定原始及格线；社区经验法则是"大约 72% ≈ 50 题里对 36 题"，稳妥目标 38 题。**四个域只看总分，没有单域最低线**（补偿式计分）。
3. **现行版本仍是 SAA-C03**（2022-08-30 上线，指南 v1.1）。截至今天官方没有任何 SAA-C04、beta 或退役日期；网上"SAA-C04 已于 2024 年 3 月发布"是 SEO 假消息。
4. **"全部掌握就够过"需要约 500 张卡**（330 张概念 Q/A + 170 张场景选择题），合理区间 400–550。推导完全来自官方大纲的可数单元：14 条 task statement、107 条 knowledge + 82 条 skills bullet、118 个 in-scope 服务。现在的 154 张只有 31%，成本域只覆盖 16%，场景选择题 0 张。
5. 500 张按每天 10 张新卡要学 50 天——所以 30 天冲刺只对现在这个 154–190 张的卡组成立；卡组做全之后，产品要对用户说的是"6–8 周、每天 30–40 分钟"，这和厂商公布的 60–120 小时备考时长一致。

---

## 1. 考试一共多少题（官方）

| 项 | 值 | 来源 |
|---|---|---|
| 总题数 | **65** | [考试页](https://aws.amazon.com/certification/certified-solutions-architect-associate/)："65 questions; either multiple choice or multiple response" |
| 计分题 | **50** | [官方指南 HTML](https://docs.aws.amazon.com/aws-certification/latest/solutions-architect-associate-03/solutions-architect-associate-03.html)："50 questions that affect your score" |
| 不计分题 | **15**，预测试题，混排、不可识别 | 同上："15 unscored questions that do not affect your score" |
| 时长 | **130 分钟**（平均 2 分钟/题，这是算术不是官方说法） | 考试页 "Exam duration 130 minutes" |
| 题型 | 单选：4 选 1；多选：5 个以上选项里选 2 个以上（"Choose two/three" 就是这一种）；**没有**实验题、排序题、匹配题、案例题 | 官方指南 "two or more correct responses out of five or more response options" |
| 猜题 | 不扣分；不答算错 | 官方指南 "no penalty for guessing" |
| 域权重 | 安全 30% / 韧性 26% / 高性能 24% / 成本 20%（按 50 题算约 15 / 13 / 12 / 10，官方只保证百分比） | 官方指南 |
| Task statement | **14 条**：D1 3 条、D2 2 条、D3 5 条、D4 4 条 | [指南 PDF v1.1](https://d1.awsstatic.com/training-and-certification/docs-sa-assoc/AWS-Certified-Solutions-Architect-Associate_Exam-Guide.pdf) |
| Knowledge / Skills bullet | **107 + 82 = 189 条**（D1 32、D2 43、D3 50、**D4 64**——权重最低的域条目最多）；去重后 164–170 个不同的 stem（取决于是否剥掉 "for example" 从句）；108 条带 "for example" 从句，共列出约 227–234 个具体项 | 指南 PDF / HTML 逐条计数（两个反方各自数了一遍） |
| In-scope 服务 | **现行 HTML 版 119 条 / 118 个唯一服务、16 类**（安全 19、管理与治理 18、分析 11、网络 10、数据库 9、计算 8、ML 8、存储 7、容器 6、应用集成 6、迁移 5、成本 4、前端 3、媒体 2、Serverless 2、开发者工具 1）。PDF v1.1 是 130 条 / 128 个，此后删了 11 个（AppSync、Application Discovery、Audit Manager、Data Pipeline、Migration Hub、Proton、Forecast、Fraud Detector、Kendra、Pinpoint、QLDB），加了 Data Firehose。**网上流传的 131 / 140 个都对不上任何官方版本** | [in-scope 页](https://docs.aws.amazon.com/aws-certification/latest/solutions-architect-associate-03/saa-03-in-scope-services.html) |
| Out-of-scope 服务 | HTML 版约 41 条（PDF v1.1 61 条）：CodeBuild / CodeDeploy / CodePipeline、Lightsail、Elemental、IoT、DeepRacer 等——**这些一张卡都不该写** | [out-of-scope 页](https://docs.aws.amazon.com/aws-certification/latest/solutions-architect-associate-03/saa-03-out-of-scope-services.html) |
| 费用 | **150 USD**/次（基础级 100，专业/专项 300），可能加税；重考全额；本地货币只有 AUD / EUR / KRW / JPY / CNY，每年 5 月刷新——NZ 考生付 150 USD | [考前政策](https://aws.amazon.com/certification/policies/before-testing/) |
| 有效期 | 3 年；通过后同一考试代码 2 年内不能重考 | [再认证页](https://aws.amazon.com/certification/recertification/) |
| 版本 | **SAA-C03 是唯一现行版本**（2026-09-19 核对：[考试指南索引](https://docs.aws.amazon.com/aws-certification/latest/examguides/aws-certification-exam-guides.html) 会列出即将到来的版本，例如 MLA-C02 beta，但没有 SAA 的新版本；[Coming Soon 页](https://aws.amazon.com/certification/coming-soon/) 只有 SOA-C02→C03 的改名）。唯一有日期的变化：意大利语版 2026-12-31 后退役。指南 PDF 创建于 2023-09-25、2025-02-08 修订；HTML 版是持续维护的那份（in-scope 列表已经和 PDF 分叉） | 上述各页 |

---

## 2. 现实中要多少分才能过

| 项 | 值 | 性质 |
|---|---|---|
| 标度分范围 | 100–1,000 | 官方 |
| 及格线 | **720**（所有 Associate 级；基础级 700，专业/专项 750） | 官方 |
| 计分模型 | **补偿式**：只要总分 ≥ 720，"you do not need to achieve a passing score in each section" | 官方指南 |
| 原始分 → 标度分 | **不公布**。第一套卷子用 Modified Angoff 专家法定线，之后每套卷子用统计等值定各自的原始及格线，所以"对多少题能过"每套卷子不一样；只有 50 道计分题算分。[AWS 培训博客](https://aws.amazon.com/blogs/training-and-certification/demystifying-your-aws-certification-exam-score/) 明确说 836 分不等于 83.6% 正确率 | 官方 |
| 社区经验法则 | 720 ≈ **72% 原始 ≈ 50 题对 36 题**，"每套卷子略高或略低于 72%"；Tutorials Dojo 员工（2025-01）确认所需答对数随题组变化。**稳妥目标 38/50** | 社区/厂商，无法用官方证实 |
| 成绩单 | 一个总分 + 分域表现表（官方提醒"谨慎解读分域反馈"）；5 个工作日内发到 AWS Certification Account；**考场当场是否显示通过与否，没有任何官方页面说明，社区说法互相矛盾** | 官方 + 未证实 |
| 重考 | 挂了等 14 天，次数不限，每次全额 150 USD；过了 2 年内不能考同一代码 | 官方 |
| 通过率 | AWS 从未公布；网上 60–68% / 65–75% 都是无来源估计 | 未证实 |

**模拟题分数怎么换算成"我能过"**（全部是社区/厂商数据，但方向一致）：

| 来源 | 数据 |
|---|---|
| TD 官网评论 | TD 最终模拟 83% → 实考 **721**（刚好压线：80% 是地板，不是余量） |
| dev.to 2024-06 | TD 首次 58%，8 个月兼职学习 + 100 张自制卡 → 791 |
| dev.to 2025-08 | 25 天 × 2 小时 + 350 道练习题、没做整卷模拟 → 800 |
| TD 评论区 | 实考 772 / 799 / 820 / 840 的人：模拟"稳定 80–100%" |
| readroo.st 2026-05 | TD 65% ≈ 实考 73–78%；TD 70% ≈ 78–82%；TD 60% ≈ 70%"正好在及格线"；低于 50% 建议推迟 |
| ExamCert 2026-06 | 未见过的模拟卷稳定 85%+ 是安全区；70–75% 是危险区 |
| Maarek | 6 套模拟每套 90%+ 才算准备好 |

**可操作的目标**：考前在**没见过的、计时的 65 题模拟卷**上稳定 80%+（85%+ 才舒服）。这是闪卡 App 做不到的一环——最后一道门必须是整卷模拟（Skill Builder 官方 65 题模拟考，或厂商题库）。

---

## 3. 主流备考资源有多少内容（基准）

| 资源 | 类型 | 规模 |
|---|---|---|
| AWS 官方练习题组（Skill Builder，免费） | 练习题 | 20 题 / 40 分钟（2026-07-17 更新） |
| AWS 官方模拟考（Skill Builder，订阅） | 整卷 | 65 题 / 130 分钟，同款标度计分 |
| AWS 官方备考计划 | 学习计划 | 18 项 / 18 小时 25 分；100+ 题；**40 张闪卡**；4 次 45 分钟域复习 |
| Stephane Maarek（Udemy） | 视频 | 27 小时 14 分、397 讲 |
| Maarek 模拟题 | 场景题库 | 6 × 65 = **390 题** |
| Tutorials Dojo | 场景题库 | 官网版 **401 题**，Udemy 版 390 题；学习路径 21 个核心服务组 + 11 个补充服务 + 15 组 "X vs Y" 对比 |
| Neal Davis / Digital Cloud Training | 视频 + 题库 | 23 小时 27 分；6 × 65 = 390 题（自设及格 72%）；书版附 500+ 题；52 页 cheat sheet |
| Adrian Cantrill | 视频 + 测验 | 60+ 小时；130 + 150 道题 |
| Brainscape 官方合集（与 DCT） | 闪卡 | **283 张** / 12 组 |
| AnkiWeb 最常被引用的 SAA-C03 卡组 | 闪卡（短问答） | **296 张**（2024-03） |
| AWSomecards | 闪卡 | **350+ 张** |
| Quizlet "Ultimate SAA-C03" | 闪卡 | 325 条 |
| Brainscape 社区大包 | 闪卡 | 1,217 / 2,000 张——几乎没人学 |
| 备考时长（厂商博客） | — | 有云背景 60–80 小时；IT 背景新接触 AWS 90–120 小时；零基础 130–150+ 小时 |

读法：**人们真正学完的概念闪卡组在 283–350 张；场景题库在 390–401 题。** 超过 1,000 张的卡组没人用。

---

## 4. 多少张卡才够：推导

### 4.1 六条规则（每张卡都能追溯到大纲的一个可数单元）

| 规则 | 单元 | 张数 |
|---|---|---|
| R1 概念卡 | 每条 **Knowledge bullet** 一张（跨 task 重复的 stem，如 "Load balancing concepts" ×4，各写一个域的角度，不合并） | 107 |
| R2 服务卡 | 每个 **in-scope 服务**一张"是什么 / 什么时候用 / 什么时候不用"——因为 118 个服务里约 **60 个从未在任何 task statement 里被点名**（CloudWatch、CloudTrail、Organizations、SNS、EventBridge、CloudFormation……），它们只以选项的身份出现，靠 bullet 规则覆盖不到 | 118 |
| R3 模式卡 | 每个 "(for example, …)" 里列出的**模式 / 特性 / 层级**一张（约 230 个具体项，减去 120–125 个已被 R2 计入的服务名） | ≈ 105 |
| **概念 Q/A 小计** | | **330** |
| R4 场景选择题 | 每条 **Skills bullet** 两张（一张"选最佳方案"，一张 Choose-two 或重干扰项变体） | 82 × 2 = 164 → **170** |
| R5 分配 | 概念卡按 bullet 分布（大纲的细节在哪就写到哪）；服务卡和 MCQ 按考试权重 30/26/24/20（自测比例和真卷一致） | — |
| R6 地板 / 天花板 | 地板 = 每条 bullet 一张（189）+ 出现在 2 条以上 task 的服务各一张对比卡（23–26）= **212–215**（只有覆盖没有深度，**不推荐**）；天花板 ≈ 500–550（再多就超过所有有人学完的社区卡组） | — |

**推荐总数：500 张（330 概念 + 170 场景选择题）；区间 400–550。**

### 4.2 按域

| 域 | 权重 | 概念 Q/A | 场景 MCQ | 合计 | 现有 | 覆盖率 |
|---|---|---|---|---|---|---|
| D1 安全架构 | 30% | 68（15 knowledge + 35 服务 + 18 模式） | 51 | 119 | 42 | 35% |
| D2 韧性架构 | 26% | 83（28 + 31 + 24） | 44 | 127 | 42 | 33% |
| D3 高性能架构 | 24% | 84（28 + 28 + 28） | 41 | 125 | 40 | 32% |
| D4 成本优化 | 20% | 95（36 + 24 + 35） | 34 | 129 | **21** | **16%** |
| 合计 | | 330 | 170 | **500** | 154（含 9 张运维类要重新归域） | **31%** |

D4 是权重最低但大纲条目最多的域（64 条 bullet，占 34%）：S3 存储类别与生命周期、Intelligent-Tiering、EBS/EFS 层级、购买选项（On-Demand / Reserved / Spot / Savings Plans）、NAT gateway vs instance 成本、数据传输成本、成本管理工具——现在只有 21 张。

### 4.3 前 25 个服务的最低张数

| 服务 | 最低 | 为什么 |
|---|---|---|
| S3（存储类别、生命周期、版本、复制、加密、Object Lock、事件通知、Transfer Acceleration、预签名 URL、静态托管） | 20 | 被最多 task 点名（1.3、3.1、3.5、4.1…） |
| EC2（实例族、购买选项、放置组、user data、instance store vs EBS、休眠、Spot 行为） | 16 | 3.2、4.2；购买选项是 D4 计算题的骨架 |
| VPC（子网、路由、SG vs NACL、NAT、endpoint、peering、TGW、flow logs、PrivateLink） | 16 | 1.2、3.4、4.4 |
| IAM + Identity Center（策略、角色、跨账号、联合、permission boundary、STS） | 14 | 1.1 几乎全是 IAM |
| RDS + Aurora（Multi-AZ、只读副本、Global/Serverless、备份、RDS Proxy、引擎选型） | 12 | 3.3、4.3 |
| ELB + Auto Scaling（ALB/NLB/GWLB、目标组、健康检查、扩缩策略、warm pool） | 12 | "Load balancing concepts" 重复 4 次 |
| Lambda | 8 | 2.1、3.2、4.2 |
| DynamoDB（容量模式、DAX、global tables、streams、TTL、索引、成本） | 8 | 3.3、4.3 |
| KMS + CloudHSM + ACM + Secrets Manager / Parameter Store | 8 | 1.3 共 11 条 bullet |
| Storage Gateway + DataSync + Transfer Family + Snow | 8 | 各自出现在 2+ task |
| 成本工具：Cost Explorer、Budgets、CUR、Compute Optimizer、Savings Plans vs RI vs Spot | 8 | 两条成本 stem 在 D4 四条 task 里全部重复 |
| 分析：Redshift、Athena、Glue、EMR、Lake Formation | 8 | 3.5 整条 task |
| EBS | 6 | 3.1、4.1 |
| EFS + FSx（Windows / Lustre / ONTAP / OpenZFS） | 6 | 存储场景的常驻干扰项 |
| CloudFront | 6 | 3.4 "edge networking" |
| Route 53 | 6 | 2.2 高可用 |
| SQS | 6 | 2.1 解耦 |
| SNS + EventBridge | 6 | 从未被点名但在 in-scope，事件驱动的标准答案 |
| CloudWatch + CloudTrail + Config | 6 | 同上 |
| ECS / EKS / Fargate | 6 | "when to use containers" 是 2.1 的 skill |
| Kinesis Data Streams + Data Firehose（+ MSK） | 6 | 3.5；Firehose 是新加进 in-scope 的 |
| Global Accelerator + API Gateway + WAF / Shield | 6 | — |
| ElastiCache + DAX | 5 | "Caching strategies" 在 2.1 和 3.3 重复 |
| Direct Connect + Site-to-Site VPN + Transit Gateway | 5 | 3.4、4.4 |
| Organizations + SCP + Control Tower + RAM | 5 | 1.1 第一条 bullet |

### 4.4 现在的 154 张离"够"有多远

- 总量 31%；低于所有有人用的社区卡组（283–350）；只到地板（212–215）的 72%。
- **场景选择题 0 张 vs 需要 170 张**——考试真正计分的能力（2 分钟内在 4–5 个都可行的选项里按限定词选最佳）现在完全没有练。
- 成本域 21 / 129。
- 服务深度：DynamoDB 6 vs 8（接近）；ELB/ASG 7 vs 12（短）；确认缺席：Amazon MQ、AWS Batch、S3 Event Notifications；约 60 个"从未被 task 点名"的 in-scope 服务大概率大多缺席（没有逐张审计，是从"运维类 9 张"推断的）。
- **净工作量：≈ 176 张概念 Q/A（优先级：D4 成本层级与购买选项 → 60 个未点名服务的服务卡 → ELB/ASG、VPC、IAM 深度）+ 170 张场景 MCQ（51 / 44 / 41 / 34）。** 按每张 25–35 分钟：概念卡约 75–100 小时，MCQ 约 70–100 小时。

### 4.5 "全部掌握就够过"为什么成立、以及它不保证什么

**成立的理由**：每一道计分题都必须落在 14 条 task statement 之一。500 张给了：189 条 bullet 每条至少一张概念卡（R1），82 条 skills 每条两次场景演练（R4），118 个服务每个一张"何时用"卡（R2，堵住约 60 个只以选项身份出现的服务），每个被点名的模式（DR 策略、存储层级、购买选项）自己一张卡（R3），MCQ 池按 30/26/24/20 配比。一个能冷答全部 330 张概念卡、在 170 张场景卡上都选对最佳项的人，按构造就在 ~72% 原始（36–38/50）之上，补偿式计分还会让弱域被强域抵消。

**不保证的**：
1. 原始及格线不公布且每卷不同，"72% 以上"是经验法则不是承诺。
2. 真题是 2 分钟的多约束场景 + 4–5 个貌似可行的选项；闪卡掌握必须用至少一套**没见过的、计时的 65 题模拟**验证到 80%+（85%+ 舒服）——卡组替代不了这一步。
3. 附录"非穷尽且可能变化"，HTML 版已经和 PDF 分叉（删 11 加 1）；大纲一变就要重新映射，SAA-C04 来了要重建。
4. AWS 的目标考生有 1 年动手经验；卡片给的是识别，不是控制台/CLI 的手感。
5. "掌握"是 SRS 意义上的全部成熟、几乎零 lapse——保留率 70% 的人会落在及格线附近（TD 83% → 721 那个数据点）。
6. 够不够还取决于卡的质量（解释是否讲清每个干扰项为什么错），数量不衡量这个。

---

## 5. 对产品节奏的推论

- 500 张 × 每天 10 张新卡 = 50 天学完 + 复习尾巴 → **完整卡组的承诺应该是"6–8 周、每天 30–40 分钟"**，和厂商的 60–120 小时一致。前一天的 30 天冲刺模拟只对现在 154–190 张成立。
- 30 天内学 500 张需要每天 19 张新卡——超过每天 20 张的安全护栏边缘，第二周会出现每天 80+ 张复习，不该作为默认路径推荐。
- 最后一道门（整卷计时模拟）在产品定位上是"不做考试模拟器"——**留给用户去 Skill Builder / 厂商题库做**，并在 App 里明说。

---

## 6. 反方核对时没能用官方来源证实的（31 条，只列影响决策的）

- 720 ≈ 72% ≈ 36/50：社区法则。
- 考场当场显示通过与否：官方无说明，社区互相矛盾。
- TD 官网 401 题 vs Udemy 版 390 题：厂商数字，未调和。
- R3 的"约 105 张模式卡"：230 个 "for example" 项里哪些是服务、哪些是模式，是编辑判断，未逐项分类。
- 出现在 2+ task 的服务数 23–26：取决于别名规则（Cost Explorer、Secrets Manager、Storage Gateway 在边界上）。
- 现有 154 张是否已覆盖那约 60 个未点名服务：推断，未逐张审计。
- Reddit r/AWSCertifications 无法访问，一手校准数据来自 dev.to、Hashnode 和 TD 官网评论。
