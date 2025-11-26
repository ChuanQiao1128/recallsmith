<!-- docs/pricing-and-modes.md -->

# Pricing & Modes – RecallSmith Full‑Stack Interview Trainer

> 本文是 **收费与权限策略的“规范文档”**，供未来后端 / 前端 / 产品实现时对照使用。  
> 策略类型：**策略 B – 强试用 + 强免费层**。

---

## 1. 产品定位快速说明

RecallSmith 面向的用户：

- 准备找工作的 **Full‑Stack Developer / Engineer**；
- 主要目标：
  - 覆盖求职过程中常见的技术栈（前端 / 后端 / 数据库 / 云端 / DevOps）；
  - 使用 **记忆规律（间隔重复）+ 日历 / 提醒** 帮用户持续复习，不轻易忘掉。

产品核心价值：

1. **题库覆盖**：围绕全栈求职路线，覆盖 JavaScript / HTTP / C# / .NET / SQL / AWS / Azure 等。
2. **记忆系统**：每次学习 / 复习后，为每张卡片计算下一次复习时间；提供首页复习列表与日历视图。
3. **长期陪伴**：通过 Starter Deck 与免费层，让用户即使不付费也能保持一定的学习节奏。

收费模式围绕 “**题库访问权限 + 记忆系统能力 + 编辑能力**” 三个维度设计。

---

## 2. 核心术语与模式

### 2.1 用户模式（User Modes）

系统中存在三类用户模式：

- `TRIAL_FULL`：试用期用户（注册后前 14 天）
- `FREE`：试用期结束后未付费的长期免费用户
- `PREMIUM`：付费订阅用户（订阅有效期内）

后端判断模式的伪代码：

```text
if now <= user.trial_ends_at:
    user_mode = TRIAL_FULL
else if user.has_valid_subscription:
    user_mode = PREMIUM
else:
    user_mode = FREE

```

注：trial_ends_at 默认 = 用户注册时间 + 14 天。
订阅有效期过期后，用户从 PREMIUM 自动回到 FREE。

2.2 Deck 类型（题库类型）

所有题库（Deck）按收费属性分为两类： 1. Starter Deck（永久免费基础题库） 2. Paid Deck（收费向题库，部分免费预览）

后端在 Catalog 中需要至少有这些字段

catalog_decks:
id
slug
title
locale
total_cards -- 总卡片数（发布时写入）
free_card_count -- 免费卡片数量（默认 50）
is_free_starter -- 是否 Starter Deck
... 3. Starter Deck 设计（永久免费）

试用期结束后，Starter Deck 继续完整免费，并且享受完整记忆规划 + 日历视图。

3.1 Starter Deck #1 – JavaScript 核心基础（永久免费）
• 目标
让任何前端 / 全栈候选人都能白嫖到一个“足够扎实”的 JS 基础。
• 内容构成（示例大纲）
• 类型系统：number / string / boolean / null / undefined / object / symbol；
• 作用域 & 闭包；
• this 绑定规则；
• 原型和原型链；
• 异步：
• Callback → Promise → async/await；
• 常见陷阱（如 Promise.then 链、错误处理）；
• 常见坑：
• == vs ===；
• 浮点数精度问题；
• 常用 Array API（map/filter/reduce 等）。
• 用途
• 这是主打的“JavaScript 可以一直免费”的题库；
• 很多用户可以只靠这个 Deck 就感受到系统的记忆能力与日历提醒。

⸻

3.2 Starter Deck #2 – HTTP & REST 基础（永久免费）
• 目标
通用面试必考知识，前后端候选人都可以使用。
• 内容构成（示例大纲）
• HTTP 基础：
• 请求方法：GET / POST / PUT / DELETE / PATCH；
• 常见状态码：200 / 201 / 204 / 400 / 401 / 403 / 404 / 500 等。
• REST 设计：
• 资源 / 动词；
• 幂等（Idempotent）的含义和典型例子；
• 统一响应体和错误码。
• HTTP 头与缓存：
• Cache-Control / ETag / If-Modified-Since；
• 简单的客户端 / CDN 缓存。
• 面试常见问题：
• GET vs POST 区别；
• PUT vs PATCH 区别；
• 幂等操作是什么；
• 301 vs 302 等。
• 用途
• 帮用户打牢网络与 REST API 基础，为后端 / 全栈面试做准备；
• 也是一个适合长期反复复习的基础知识 Deck。

⸻

3.3 Starter Deck #3 – 全栈面试基础（永久免费）

名称建议：Full‑Stack Interview Basics / 全栈面试基础概览
不是“核心 100 题”，而是整体 基础大纲题库。

    •	目标
    •	给纯新手一个“全局预览”：

知道一个全栈开发面试大致会考哪些方向。
• 覆盖一点点前端、后端、数据库、DevOps、云等，让用户大致形成知识地图。
• 内容构成（示例大纲）
• 每个主题仅挑选少量基础题，但覆盖面尽量广：
• 前端基础（HTML/CSS/JS 简要）；
• 后端基础（API、认证、错误处理）；
• 数据库与 SQL 基础；
• 部署与运维（简单 CI/CD）；
• 云服务基础（AWS/Azure 非深入，偏概念）。
• 每张卡尽量单点、浅显，并附带简单解释。
• 用途
• 让免费用户也能通过这套 Deck 跑完一圈全栈知识图谱；
• 也为后续付费 Deck 指明方向，例如：
• 想深入 JS → 去 JS 进阶 / React；
• 想深入后端 → 去 C#/.NET / SQL；
• 想走云方向 → 去 AWS/Azure Deck。

⸻

4. Paid Deck 规划（收费向题库）

以下为示意性规划，具体 Deck 名称和数量可在实现时微调，但收费策略不变：
• 前端 & JS
• Modern JavaScript / ES6+ 进阶（收费，前 50 卡免费预览）
• TypeScript for JS Devs
• React Fundamentals
• React Hooks & 状态管理
• 后端 & .NET
• C# 语言基础（收费主力 Deck）
• ASP.NET Core / .NET 8 Web API（收费主力 Deck）
• 数据访问 & EF Core & SQL 实战
• 数据库 & 通用后端
• SQL & 数据库设计入门 + 进阶
• System Design Basics
• 云 & DevOps / 证书类
• AWS Certified Developer 核心知识点（收费，部分预览）
• Azure AZ‑204 核心知识点（收费，部分预览）
• CI/CD & 部署最佳实践

统一规则：
• 所有非 Starter Deck 均视为 Paid Deck；
• 每个 Paid Deck 都有 free_card_count（默认 50）用于免费预览。

⸻

5. 用户模式下的行为矩阵

5.1 内容访问矩阵（Deck & Card）

5.1.1 Deck 访问层级
维度
TRIAL_FULL（试用）
FREE（长期免费）
PREMIUM（订阅）
Starter Deck 列表可见性
全部可见
全部可见
全部可见
Starter Deck 内容访问
全部卡片可用
全部卡片可用
全部卡片可用
Paid Deck 列表可见性
全部可见
全部可见
全部可见
Paid Deck 内容访问
全部卡片可用
每个 Deck 仅前 free_card_count（默认 50）卡片可用
全部卡片可用

5.1.2 卡片数量限制（单 Deck）
模式
Starter Deck 卡片数
Paid Deck 卡片数
TRIAL_FULL
无限制（全部）
无限制（全部）
FREE
无限制（全部）
限制为 free_card_count（配置项，默认 50）
PREMIUM
无限制（全部）
无限制（全部）

5.2 记忆系统 & 日历能力矩阵

记忆系统包括：
• 间隔重复算法（为每张卡片计算 nextReviewAt 等）；
• 当日复习列表（首页）；
• 日历视图（未来几天的复习任务分布）；
• 通知提醒。

5.2.1 间隔重复算法使用范围
维度
TRIAL_FULL
FREE
PREMIUM
Starter Deck 是否使用算法
是（完整）
是（完整）
是（完整）
Paid Deck（前 free_card_count）
是（完整）
是（但可选限制每日新卡/复习上限）
是（完整）
Paid Deck 超出 free_card_count 部分
是（完整）
否（不可加入记忆计划，卡片被锁，仅显示“解锁后可复习”提示）
是（完整）

备注：FREE 模式下，可选增加一个每日免费新卡/复习上限，例如：
“每天最多允许 20 张 Paid Deck 卡片进入当日复习队列”。

5.2.2 日历视图（Calendar）
维度
TRIAL_FULL
FREE
PREMIUM
Starter Deck 在日历中的展示
可查看未来 7 ～ 14 天完整安排
可查看未来 7 ～ 14 天完整安排
可查看未来 30 ～ 60 天完整安排
Paid Deck 在日历中的展示
可查看未来 7 ～ 14 天完整安排
仅显示“今天 / 明天”的 Paid 复习任务，远期具体安排可隐藏或聚合成“升级可见”的提示
可查看未来 30 ～ 60 天完整安排
今日任务（首页）
展示所有 Deck 的今日待复习卡片
展示 Starter Deck 全部 + Paid Deck 在免费限制范围内的卡片
展示所有 Deck 的全部待复习卡片

5.2.3 通知提醒（Notification）
维度
TRIAL_FULL
FREE
PREMIUM
支持的提醒时间段数量
1 ～ 2 个固定时间段
1 个默认时间段或简化提醒
多时段可自定义（例如早/午/晚分别设置）
提醒内容
“今日有 X 张卡待复习（具体 Deck）”
“今日有 X 张卡待复习（可弱化 Paid 细节）”
“今日有 X 张卡待复习”+ 可选 Deck 级别提示

5.3 编辑 & 个人 Deck 能力矩阵

5.3.1 官方 Deck 编辑能力
维度
TRIAL_FULL
FREE
PREMIUM
编辑官方 Deck 内容（题干、答案等）
否（只读）
否（只读）
否（只读，安全起见不修改官方内容）
对官方 Card 添加“个人备注”
是（本地/云端存储，参与复习显示）
可选：仅对 Starter Deck 支持简单备注
是（可对任意 Deck 的 Card 添加多行备注）
将官方 Card 复制到个人 Deck 再编辑
可选（试用期可开启体验）
否
是（可复制任意 Card 到个人 Deck 并自定义）

5.3.2 个人 Deck（用户自建题库）
维度
TRIAL_FULL
FREE
PREMIUM
可创建个人 Deck 数量
限制数量（例如最多 2 个）
限制更严格（例如仅 1 个“本地草稿 Deck”，不云同步）
无明显限制（可设置较高上限，如 50+）
每个个人 Deck 最大卡片数
适中限制（例如 100 张 / Deck）
严格限制（例如 50 张 / Deck，总卡数有限）
高上限（例如 500+ 张 / Deck）
个人 Deck 是否参与记忆算法
是，完整体验
简化版（比如简单间隔，或仅“每日复习列表”不做长周期规划）
是，完整参与间隔重复算法及日历视图
个人 Deck 是否云端同步
可选：试用期间模拟同步体验
否（仅保存在本机）
是（登录同账号的设备间共享）

6. 业务规则速查（给开发用的小抄）

6.1 常量与配置建议
• 试用期长度：TRIAL_DAYS = 14
• 每个 Paid Deck 默认免费卡片数量：DEFAULT_FREE_CARD_COUNT = 50
• FREE 模式下 Paid Deck 的每日免费复习上限（可选）：例如 FREE_PAID_DAILY_LIMIT = 20

6.2 Starter Deck 标记

在 Catalog 发布时，需将以下 Deck 标记为 Starter： 1. JavaScript 核心基础
• is_free_starter = true
• free_card_count = total_cards（全部免费） 2. HTTP & REST 基础
• is_free_starter = true
• free_card_count = total_cards 3. 全栈面试基础
• is_free_starter = true
• free_card_count = total_cards

所有其他 Deck：
• is_free_starter = false
• free_card_count = DEFAULT_FREE_CARD_COUNT（可以按 Deck 配置调整）

6.3 模式判断与接口行为约定（高层）

伪代码示意（仅说明逻辑，不是最终实现）：
mode = resolveUserMode(user, now) // TRIAL_FULL / FREE / PREMIUM

if request is "list cards of a deck":
load deck meta (is_free_starter, total_cards, free_card_count)

    if mode == TRIAL_FULL or mode == PREMIUM:
        max_cards = total_cards
    else if mode == FREE:
        if deck.is_free_starter:
            max_cards = total_cards
        else:
            max_cards = deck.free_card_count  // 默认 50
    end

    // 按 max_cards 限制查询范围，并返回分页结果

日历 & 今日任务接口在实现时需要参考：
• 对 Starter Deck：
• 所有模式均展示完整记忆安排（FREE 也不阉割 Starter 的体验）。
• 对 Paid Deck：
• FREE 模式仅对 <= free_card_count 范围的卡片参与计算；
• FREE 模式的日历可限制仅显示「今日 / 明日」的 Paid 任务；
• TRIAL_FULL / PREMIUM 对所有卡片开放完整日历视图。

7. 后续演进预留

本策略文档是当前版本的“定稿”：
• 如果后续增加：
• 题库打包售卖（如 AWS Bundle、Full‑Stack Bundle）；
• 一次性买断某个 Deck；
• 企业版本（团队题库分发）；
• 建议在本文件基础上追加章节，而不是直接修改已有规则，以保证历史版本的可追溯性。

当前实现顺序建议： 1. 按本文件先在数据库 / 模型中预留字段：
• is_free_starter / free_card_count / total_cards； 2. 在 Catalog API 读侧中接入上述“卡片访问限制逻辑”； 3. 待 Authoring 侧 Card 建模完成后，再实现实际的发布与计数逻辑； 4. 最后接入用户模式（TRIAL/FREE/PREMIUM）的鉴权逻辑与日历/记忆系统。

本文件一旦入库（放入 docs/pricing-and-modes.md），视为这一阶段的定版规则。
