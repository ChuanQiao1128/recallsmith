# RecallSmith Mobile · v7 · 收尾打磨增量 PRD

> v7 不是新需求，是把 v6.1 已经落地的主链路从“能跑”推进到“顺手”。
>
> **优先级**：v7 > v6.1 > v6。冲突一律以本文为准。
>
> **适用对象**：任何在 `recallsmith/mobile/` 上动 UI 的人。
>
> 早期版本（v3 到 v6.1）与它们的任务清单、审计表、diff 已经删除。
> 本文是唯一的现行规格，历史仍在 git 里。
>
> **本文与实现不一致处，一律以 `docs/design/gacha-gate-decision-log.md` 为准**：
> 那里逐条记着 ownership gate（issue #11–#16）落地时留下的偏差、当时的取舍、
> 以及什么条件下要复议。本文中已被推翻的行会就地划掉并指向对应条目。

---

## 0. 本版定位

### 0.1 v7 是什么 / 不是什么

v7 **是**：

- v6.1 主链路的“收口版” — 把 audit checklist 里 P0/P1 列的产品瑕疵真正治掉
- 一份增量文档：只描述相对 v6.1 的变化、约束、验收标准
- 移动端优先文档：所有验收必须能在 iPhone SE / 14 / 15 Pro Max 三档宽度上跑通

v7 **不是**：

- 新主线功能稿（不引入新 ceremony / 新 pool / 新评分机制）
- 视觉重构稿（保留 Claude Design 大方向，不重做 token、不改 Cosmic/Parchment 主题）
- 复习内核重写稿（`review/model.ts`、`review/storage.ts` 不动）
- 把 v6 大草案再翻案的稿

### 0.2 v7 成功标准

v7 完成后，下面 6 件事必须同时为真：

1. Home 首屏在 360pt 宽度上能一眼看出“今天该不该打 / 点哪里开始”，无文字重叠、无两个并列主 CTA
2. Summary 在不靠动画的前提下，能让用户感到“战利品 + 学习进展 + 下一步”三件事同时存在
3. Library 是纯粹的拥有内容浏览页，Deck 不再承担 launchpad 职责
4. Challenge 文案不再像 MVP 骨架，能让用户在开打前建立明确预期
5. 所有屏幕没有一个文件继续超过 800 行；HomeScreen / DeckScreen / SessionCardScreen 必须显著瘦身
6. v7 范围内所有 acceptance 都有对应的单元 / 集成 / 类型测试守住，不靠人工记忆

### 0.3 v7 不做的事

下列内容即使在 v6 草案里出现过，本轮也明确不做：

- Week Streak / Month Summary / Mastery Hall 真接入
- 多池 Day-15 扩张
- 复杂 milestone ceremony（动画、声音、shimmer 全部推迟）
- 自动 Fresh Start 弹窗
- pool-specific Audience
- 新增 Cosmic 场景 / 新背景动画
- 评分算法迭代（FSRS 改造、leech 升级、降级仪式）

---

## 1. v7 vs v6.1 变更总表

> 这张表是 v7 唯一的“需求清单”。每一行都必须可在代码里被定位、可在测试里被验证。

| # | 区域 | v6.1 现状 | v7 要求 | 主要影响文件 | 验收方式 |
|---|---|---|---|---|---|
| 1 | Home 主 CTA | 首屏存在 deck list、premium 行、CTA 三方争夺注意力 | 首屏只剩 1 个真正的主 CTA：`Start today's challenge` | `src/screens/HomeScreen.tsx`, `src/features/gacha/components/HomeHero.tsx` | 单元 + 视觉 acceptance §3.1 |
| 2 | Home deck 区 | Deck list 行内承载 install / update / trial / premium gate | Deck 区降级为可折叠次级区域，install/update/trial 由 action resolver 异步处理 | `src/screens/HomeScreen.tsx`, 新建 `src/features/gacha/home/deckActionResolver.ts` | §3.1 acceptance + 集成 |
| 3 | Home 信息密度 | Calendar、Momentum、Reward、Streak 同时出现，首屏上半区拥挤 | 首屏只允许：战报 / counts / 最低目标 / 主 CTA / 抽卡状态。其余移到次级区 | `HomeScreen.tsx`, `homeSelectors.ts` | §3.1 acceptance |
| 4 | Summary 奖励层 | 奖励显示偏轻，靠数字和 2 个按钮承担情绪 | 奖励区视觉权重提升到首屏第一视觉锚点；明确区分“最低目标达成 / full clear / reserve” | `src/screens/SessionSummaryScreen.tsx`, 新建 `src/features/gacha/components/RewardSummaryCard.tsx` | §3.4 acceptance |
| 5 | Summary 文案 | reward 文案偏中性 | 奖励文案“鼓励 + 进展”双语义，钱包满 / reserve 不允许出现 lost / missed / forfeit 系列词 | `summaryMapper.ts`, `SessionSummaryScreen.tsx` | 单元测试覆盖文案常量 §6.2 |
| 6 | Library 角色 | DeckScreen 同时是 gate + library + launchpad | LibraryScreen 成为唯一的“拥有内容浏览页”；DeckScreen 仅作为 deck install / update / 试用 gate | `src/screens/LibraryScreen.tsx`, `src/screens/DeckScreen.tsx`, `src/features/gacha/library/libraryMapper.ts` | §3.5 + §3.6 |
| 7 | Library 状态 | 已有 New / Learning / Mastered 状态映射 | 状态在 360pt 宽下仍清晰可分；筛选只保留 4 项（All / New / Learning / Mastered），不引入更多 | `LibraryScreen.tsx`, `libraryMapper.ts` | §3.5 |
| 8 | Challenge 文案 | 结构对，但偏 MVP 骨架 | 标题 / 副标题 / minimum goal / full clear 都用更人话的语言；不引入新动画 | `src/screens/ChallengeScreen.tsx` | §3.2 acceptance |
| 9 | Review 节奏 | explanation / code / usage 长时，rating 区可能远离视野 | rating 行在长内容场景下保持在屏幕底部可达；不引入复杂 sticky 行为，但要确保不被遮挡 | `src/screens/SessionCardScreen.tsx`, 可能 `RatingBar.tsx` | §3.3 acceptance + 集成 |
| 10 | Settings 文案 | 长说明腔较重 | Audience / Fresh Start / Reminders 解释一律压到 ≤ 1 句结果性语言 | `SettingsScreen.tsx` 及对应子页 | §3.7 acceptance |
| 11 | 文件体量 | HomeScreen 1577 / DeckScreen 1435 / SettingsScreen 1615 / SessionCardScreen 962 行 | 每个 screen 文件 ≤ 800 行；超出的部分必须抽到 `features/gacha/{home,session,library,settings}/...` | 上述四个 screen | §6.3 静态检查 |
| 12 | 移动端宽度 | 未系统验证窄屏 | 所有 acceptance 必须在 360 / 375 / 390 / 430 pt 宽度下都成立；文字不允许重叠、不允许 2 行 CTA | 全部 screen | §6.4 |

---

## 2. v7 非谈判原则

### 2.1 不许动的代码

- `src/review/model.ts`、`src/review/storage.ts` — 评分与调度内核
- `src/content/*` — 内容下载 / manifest 解析
- `src/auth/*`、`src/premium/*`、`src/sync/*` — 账号、付费、同步基础设施
- `src/components/CodeBlock.tsx` — 代码块渲染（仅允许 props 兼容修改）

任何看起来需要改这些文件的 v7 任务，先停下来与作者对齐，不要默认改。

### 2.2 主链路只能一种解释

v6.1 §2 “唯一规则真表”继续有效，v7 不引入新规则、不修改阈值。具体含义：
> 2026-09-21：经济规则以 `docs/economy-v2-learn-to-earn-2026-09-19.md` §2 为准（rules R1–R10, cap 60+5）；下面 "30 主钱包 + 5 reserve" 一条保留为历史，不再生效。

- Streak：`hard / good / easy` 计入；`again` 不计；不做 mindful minute
- Mastery 判定：`stage >= 4`，与稀有度解耦
- Free pull cap：30 主钱包 + 5 reserve；超过 35 才不发；不允许“损失感”文案
- Audience 永不影响 due review
- 首日不允许多屏 onboarding 阻塞主路径

如果代码里发现任何与上述任一条不一致，按上述规则修正即可，不需要在 v7 中再争论。

### 2.3 单一主 CTA 原则

每个主线屏幕第一屏（above the fold）只允许有一个**视觉权重最高**的按钮：

| Screen | 主 CTA |
|---|---|
| Home | Start today's challenge |
| Challenge | Begin |
| SessionCard | （评分区行就是“主操作”，不另设按钮） |
| SessionSummary | Continue（具体跳向：返回 Home / 抽卡 / 图鉴，由状态决定） |
| Library | （无主 CTA，是浏览页） |
| Deck | 只在 install / update / trial 有按钮，但不是主链路 |

副 CTA 必须用更弱的视觉处理（次级文字按钮、非渐变、字号低于主 CTA ≥ 2pt）。

### 2.4 移动端优先

所有验收都默认在窄屏发生：

- 测试宽度集合：`360 / 375 / 390 / 430`（pt）
- 任何文本元素都必须有 `numberOfLines` 或显式的 wrap 策略
- 任何卡片高度都不允许写死 ≥ 屏宽 1.0 倍的固定 px 值
- 不允许 2 行布局的主 CTA — 文案要在 360pt 下单行可读
- 复杂 metric 行（如 Today's pressure 4 列）在 360pt 下必须降为 2×2 网格或滚动行

### 2.5 不允许的实现偏差

- 不要在 v7 中再扩 `features/gacha/` 子目录（已经够用了）
- 不要新增主线 screen（v7 不增 route，只在已有 route 上重写内容）
- 不要把"瘦身"做成"复制文件再删旧文件"，必须是真正抽离逻辑
- 不要把 deprecated 的 DeckScreen 长期保留 — v7 必须给出明确弃用条件
- 不要在文档里留 TODO，所有 TODO 必须落到 task list

---

## 3. 屏幕级 Acceptance

### 3.1 HomeScreen

#### 3.1.1 屏内信息层级（自上而下，固定顺序）

1. 一句话战报（HomeHero / 8-12 字英文 + 数字）
2. 今日 counts（普通 / 精英 / boss / 总数）
3. 最低目标行（保 streak 需要做几张 + full clear 几张）
4. 主 CTA（Start today's challenge / 已完成 / 空态）
5. 抽卡状态徽章（locked / available / wallet-full-with-reserve）

之后才允许：

6. 折叠的 Deck list（默认收起，标题如 "Your decks (3)"）
7. 折叠的 Streak / Calendar 总览（默认收起）
8. Settings 入口（icon-only，不放主行）

#### 3.1.2 必须存在的状态

- `first_run`：从未完成过任何卡的用户
- `today_pending`：今天还没打的活跃用户
- `today_partial`：今天已部分完成
- `today_done`：今天已达 minimum goal
- `today_full_clear`：今天已 full clear
- `due_only`：当天没有新卡，仅有 due review
- `nothing_to_learn`：当天既无 due 也无新卡
- `wallet_full`：奖励钱包已满（30+5）
- `loading` / `error`

每个状态要有：明确的战报文案、明确的 CTA 文案、明确的次级提示。

#### 3.1.3 必须消失的元素（v6.1 残留）

- 首屏不允许出现 premium 营销长说明（≤ 1 行 lockup）
- 首屏不允许出现 deck install/update/trial 状态详情文字（移到 deck 行二级抽屉）
- 首屏不允许出现 calendar 30 天热力图（折叠，默认收起）
- 首屏不允许出现 month summary 入口（折叠或移到 More）

#### 3.1.4 文件级要求

- `src/screens/HomeScreen.tsx` ≤ 800 行；超出部分迁出到：
  - `src/features/gacha/home/homeStateMachine.ts`（已存在，扩展）
  - `src/features/gacha/home/deckActionResolver.ts`（**新增**）
  - `src/features/gacha/home/HomeDeckRow.tsx`（**新增**，从 HomeScreen 抽出 deck row 渲染与点击逻辑）
- `src/features/gacha/components/HomeHero.tsx` 只接 `HomeVM.hero` 字段，不读 store
- `src/features/gacha/selectors/homeSelectors.ts` 必须导出一个 `buildHomeVM(input): HomeVM`，screen 只调用一次

#### 3.1.5 测试

- 单元：`buildHomeVM` 8 种状态各一例
- 集成：渲染 Home，断言只有 1 个 testID 为 `home-primary-cta` 的按钮可见
- 类型：HomeVM 中 `cta.kind` 为 union，9 种状态枚举完整

---

### 3.2 ChallengeScreen

#### 3.2.1 必须有

- 标题：日期感 + 进度感（例 `Tuesday · 4 cards ahead`）
- 节点列表：4 节点，最后一节点根据是否有高压卡决定是否包装为 boss
- 双行目标：`Stay on streak` 行（最低目标）+ `Full clear` 行（full clear 奖励）
- 单一主 CTA：`Begin`

#### 3.2.2 不许有

- 多节点动画 / 地图漫游
- 内容预览（用户在这里看不到具体卡内容）
- secondary action（去抽卡 / 去图鉴 / 去 settings）

#### 3.2.3 文案要求（替换 MVP 骨架感）

- 用动词而非名词：`Begin` 而不是 `Start session`
- 不出现 `MVP` / `placeholder` / `coming soon`
- minimum goal 用结果语言：`Keep your 7-day streak alive` 而不是 `Minimum 1 card`

#### 3.2.4 文件

- `src/screens/ChallengeScreen.tsx` 保留 ≤ 300 行
- `planChallengeRoute` 仍在 `sessionPlanner.ts`，签名不变
- 不新增组件

#### 3.2.5 测试

- 单元：`planChallengeRoute` 在“无 boss 候选”时不强制返回 boss role 节点
- 集成：渲染 Challenge，断言 testID 为 `challenge-begin-cta` 唯一可见主按钮

---

### 3.3 SessionCardScreen / Review

#### 3.3.1 行为要求

- Question → Answer → Rating 路径流畅，rating 后立即取下一张，不阻塞
- 长 explanation / code / usage 滚动时，rating 行始终在视口可达（屏幕底部，最多被键盘遮挡，但内容滚动不顶掉它）
- 4 档评分语义保留：`Again / Hard / Good / Easy`
- `again` 不续 streak；首次出现 `hard / good / easy` 时本 session 标记 streakEarned

#### 3.3.2 视觉要求

- 顶部进度条 + 当前节点角色徽章 ≤ 56pt 高
- rating 行在 360pt 宽下能 4 个按钮单行排开（每键最低 64pt 触达）
- explanation / usage 区有清晰分块（标题 + 间距），不要一坨灰文字

#### 3.3.3 文件

- `src/screens/SessionCardScreen.tsx` ≤ 800 行；超出部分迁出到：
  - `src/features/gacha/session/sessionReviewHelpers.ts`（已存在，扩展）
  - `src/features/gacha/session/reviewContentHelpers.tsx`（已存在，扩展）
  - 渲染长内容的子组件可放 `src/features/gacha/components/ReviewBody.tsx`（**按需新增**）
- ~~旧 `ReviewScreen.tsx` 在 v7 中**显式标记为 deprecated**，并在 navigation 中不再被任何主链路指向（可保留为 fallback 路由）~~
  **已作废（issue #11）**：该文件已删除。「保留为 fallback 路由」这条在实践中的结果是：
  一份 904 行、用户永远到不了、却要跟着 SessionCardScreen 一起被审的第二实现。
  删除前逐条比对过两边逻辑，dead 侧没有任何 live 侧缺的修复（差异全部是
  SessionCard 更严格或更新：`!showAnswer` 评分门、`await setIsPremiumUser`、
  planner 算出的 minimumGoal、settlement 分支）。

#### 3.3.4 测试

- 集成：长内容滚动测试，断言 rating 行 testID 在视口
- 单元：streakEarned 在 again→good 序列下值为 true
- 类型：SessionStore action union 完整

---

### 3.4 SessionSummaryScreen ⭐（本版重点）

#### 3.4.1 信息层级（强制顺序）

1. **奖励层（上半屏）** — 视觉最重
   - 战利品视觉：基于 `RewardSummaryCard`，明确显示获得的 free pulls
   - 钱包变化：`29 → 30 (+2 reserve)`，包含 reserve 数字
   - 可领取入口：`Use 2 pulls` 次级按钮（仅在 wallet > 0 时显示）
2. **学习进展层（中段）** — 视觉次重
   - 完成数：`4 / 4 cards · full clear` 或 `1 / 4 · streak saved`
   - streak 状态：`🔥 8` 或 `🔥 0 → 1`
   - 状态迁移摘要：`2 cards entered Learning · 1 card mastered`
3. **下一步层（下半屏）** — 视觉最轻
   - 主 CTA：`Continue` 或 `Open library`，根据状态决定
   - 次级链接：`Back home`

#### 3.4.2 文案约束（强制）

- 不出现 lost / missed / forfeit / wasted / gone / expired
- 钱包满时使用：`Free pulls full · 5 pending in reserve` 而非 `+3 lost`
- minimum goal 达成：`You kept the streak.` 而非 `Minimum done.`
- full clear：`Cleared today's run.` 而非 `Full session complete.`

文案常量集中放在 `summaryMapper.ts` 的常量表中，并由单元测试覆盖。

#### 3.4.3 视觉要求

- 上半屏奖励层不允许只是“数字 + 文字”；必须有：
  - 一个视觉锚（金币/卡背 illustration 或纯几何块均可，但不能空白）
  - 一个变化箭头或动效（即使是静态 → 也行）
  - reserve 用次级颜色标注，与主钱包数字区分
- 下半屏 CTA 高度统一，不允许主 CTA 矮于次 CTA

#### 3.4.4 文件

- `src/screens/SessionSummaryScreen.tsx` ≤ 400 行；视觉块抽到：
  - `src/features/gacha/components/RewardSummaryCard.tsx`（**新增**）
  - `src/features/gacha/components/SummaryProgressBlock.tsx`（**新增**）
- `summaryMapper.ts` 输出 `SessionSummaryVM`，包含 `reward / progress / nextAction` 三个子结构

#### 3.4.5 测试

- 单元：4 种钱包状态（0、1-29、29→30、wallet-full）下 VM 文案与字段
- 单元：summary 文案表不含禁用词（lost / missed / forfeit / wasted / gone / expired）
- 集成：渲染 Summary，断言 reward 块 testID 在 progress 块之上
- 类型：SessionSummaryVM 三个 sub-VM 字段稳定

---

### 3.5 LibraryScreen

#### 3.5.1 角色定义

Library 是**纯拥有内容浏览页**：

- 默认入口在 More / Summary 次级链接 / Home 折叠区
- 不承担 deck install
- 不承担 mode launch
- 不承担 premium gate（gate 留在 DeckScreen）

#### 3.5.2 必须有

- 顶部 deck/pool 切换（如果当前只有一个 deck，可隐藏 switcher）
- 4 项筛选：All / New / Learning / Mastered
- 卡片网格：3 列（≥ 390pt 宽）/ 2 列（< 390pt 宽）
- 单卡基本信息：question 截断 1 行 + 状态徽章

#### 3.5.3 不许有

- 抽卡入口
- 模式切换（learn-new / review-due / mixed）— 这些是 session 配置，不应在浏览页
- premium gate 弹窗
- onboarding 提示

#### 3.5.4 文件

- `src/screens/LibraryScreen.tsx` ≤ 400 行
- `src/features/gacha/library/libraryMapper.ts` 输出 `LibraryVM`，包含 `decks / filter / cards`
- v7 期间不再让 DeckScreen 跳转到 Library 之外的 launch 行为

#### 3.5.5 测试

- 单元：libraryMapper 在 `filter=Learning` 时只返回 `stage>=1 && stage<4` 的卡
- 集成：在 360pt 宽度下渲染 Library，断言列数为 2

---

### 3.6 DeckScreen（弃用计划）

DeckScreen 当前承担 gate + library + launchpad 三职责。v7 把它收敛为：

- **保留**：deck install / update / trial / premium gate
- **移除**：mode launch（learn-new / review-due / mixed 选择移除或迁到 Settings）
- **移除**：library 浏览（迁出到 LibraryScreen）

最终形态：DeckScreen 在 v7 完成后只在 install/update/trial 流程中被打开，不在主链路常驻。

#### 3.6.1 文件

- `src/screens/DeckScreen.tsx` ≤ 600 行；library 相关代码全部删除（不是注释保留）
- 任何 `mode` 选择 UI 全部移除
- 顶部不再有“今天怎么打”的引导

#### 3.6.2 测试

- ~~集成：从 Home 主 CTA 不会进入 DeckScreen（只能进 ChallengeScreen）~~
  **半条作废（issue #16 记账）**：「不进 DeckScreen」仍然成立且仍被测试钉着；
  「只能进 ChallengeScreen」已不成立 —— Home 主 CTA 现在直接进 SessionCard，
  Challenge 只留在底部 Review tab 与深链入口。理由与复议条件见
  `docs/design/gacha-gate-decision-log.md` D3。现行落点由
  `tests/integration/home-cta-target.test.tsx` 钉住（钉的是产品，不是本行规格）。
- 集成：DeckScreen 不再渲染任何卡片网格

---

### 3.7 SettingsScreen

#### 3.7.1 文案约束

每个设置项最多 1 句解释，且必须是“结果”而不是“原理”：

| Setting | 旧（解释腔） | 新（结果腔） |
|---|---|---|
| Audience | "This filters which new cards we propose..." | "Choose who today's new cards are aimed at." |
| Fresh Start | "Resetting will recompute schedules without removing ownership..." | "Clear today's schedule. Keeps your owned cards." |
| Reminders | "Daily reminders help you keep your streak..." | "Send a reminder if you haven't started by [time]." |

#### 3.7.2 信息分组

- Account
- Content preferences（Audience）
- Reminders
- Appearance
- Premium
- About / Help / Debug（debug 仅在 dev build 可见）

#### 3.7.3 不许有

- 任何 "wipe" / "delete all" 在非二次确认页之外的入口
- 红色 destructive 按钮在主 settings 列表（destructive 只能出现在二级确认页）

#### 3.7.4 文件

- `src/screens/SettingsScreen.tsx` 当前 1615 行，v7 要求 ≤ 800 行
- 子区域逻辑迁出到 `src/features/gacha/settings/`（按 region 拆：account / content / reminders / appearance / about / debug）
- 不允许通过引入新 stack route 来"假瘦身"（仍是同一个 SettingsScreen 入口）

---

## 4. 横切要求

### 4.1 文本溢出与 wrap

每个屏幕实现时遵守：

- 主标题 `numberOfLines={2}` 上限
- 副标题 `numberOfLines={1}`
- 卡片 question `numberOfLines={2}`
- 按钮文字必须能在 360pt 下单行显示，不允许 wrap

### 4.2 触达区

- 任何可点击元素 ≥ 44×44pt
- rating 按钮 ≥ 64×56pt
- 列表行高 ≥ 56pt

### 4.3 主题 token

- 不新增颜色 token
- 所有颜色通过 `src/theme/colors.ts` 引用，不允许 inline hex（v7 修过的文件必须满足）

### 4.4 Loading / Empty / Error

每个主屏必须能渲染下列三种态而不崩：

- `loading`：≥ 1 个 spinner 或 skeleton；不展示功能区
- `empty`：明确文案 + 至少 1 个可行 CTA
- `error`：明确文案 + retry CTA

### 4.5 时间与时区

- 所有“今日”判定必须走 `formatDateKey(...)`，不允许直接 `new Date().toDateString()`
- 不允许在 UI 层做日期算术（用 selector）

---

## 5. 文件改动地图

### 5.1 必须修改

| 文件 | 修改性质 |
|---|---|
| `src/screens/HomeScreen.tsx` | 大幅瘦身 + 信息层级重排 |
| `src/screens/ChallengeScreen.tsx` | 文案改造 |
| `src/screens/SessionCardScreen.tsx` | rating 行视觉与可达性修复，长内容渲染抽出 |
| `src/screens/SessionSummaryScreen.tsx` | 重构信息层级，奖励层强化 |
| `src/screens/LibraryScreen.tsx` | 收敛角色，2/3 列响应式 |
| `src/screens/DeckScreen.tsx` | 移除 library + launch 职责 |
| `src/screens/SettingsScreen.tsx`（及子页） | 文案压缩 |
| `src/features/gacha/selectors/homeSelectors.ts` | 输出更精简 HomeVM |
| `src/features/gacha/session/summaryMapper.ts` | 输出三层结构 VM + 文案常量 |
| `src/features/gacha/library/libraryMapper.ts` | 4 项筛选 |

### 5.2 必须新增

| 文件 | 用途 |
|---|---|
| `src/features/gacha/home/deckActionResolver.ts` | 把 deck install/update/trial 逻辑从 HomeScreen 抽出 |
| `src/features/gacha/home/HomeDeckRow.tsx` | 折叠 deck row 渲染 |
| `src/features/gacha/components/RewardSummaryCard.tsx` | Summary 上半屏奖励视觉 |
| `src/features/gacha/components/SummaryProgressBlock.tsx` | Summary 中段进展 |
| `gacha-v7-audit-checklist.md` | 本文 §6 的人工版 |
| `docs/plans/2026-05-xx-v7-mobile-fix.md` | 实施计划文件（按 phase 拆批次） |

### 5.3 严禁修改

- `src/review/model.ts`
- `src/review/storage.ts`
- `src/content/*`
- `src/auth/*`
- `src/premium/*`
- `src/sync/*`
- `src/components/CodeBlock.tsx`
- `src/theme/*`（v7 不动 token）
- `src/navigation/types.ts` 的现有 route（**仅允许新增**，不允许删/改字段）
  - **例外一处，已记账（issue #11）**：`Review` 条目随 `ReviewScreen.tsx` 一起删除。
    留着它并不是「保守」——`RootStackParamList` 里有 `Review` 而 `App.tsx` 里没有
    对应 `Stack.Screen`，意味着 `navigate('Review', ...)` 能通过类型检查、到运行时才
    炸。删掉是把一个运行时故障换成编译期错误。该条目全仓零引用，删除不影响任何调用点。
  - **第二处例外，同样记账（issue #11）**：`src/sync/progressSync.ts` 顶部注释第 43 行
    的 `ReviewScreen` 改成 `SessionCardScreen`。只改了注释里的一个标识符，零行为变化；
    改它是因为 #11 的验收条件是「全仓 grep 对已删文件零引用」，而那行注释是在教下一个
    人去看一个不存在的文件。除此之外 `src/sync/*` 一行未动。

### 5.4 弃用

- ~~`src/screens/ReviewScreen.tsx` — 标 deprecated 注释，首行加 `@deprecated v7 - replaced by SessionCardScreen`，但保留可运行直到 v7 全部 phase 完成~~
  **已执行完毕（issue #11）**：文件、`App.tsx` 注册、`RootStackParamList.Review`
  与 `tests/integration/review-summary.flow.test.tsx` 一并删除。该测试唯一的断言
  （done 态 → `SessionSummary` 的 payload）已移植到
  `tests/integration/session-card.screen.test.tsx`，而不是随文件消失。

---

## 6. 验证

### 6.1 命令

每次提交必须本地全过：

```bash
cd recallsmith/mobile
npm run test:typecheck
npm run test:unit
npm run test:integration
```

涉及视觉变更时，至少在以下宽度跑模拟器：

```bash
# 360pt — Android 小屏
# 375pt — iPhone SE
# 390pt — iPhone 14
# 430pt — iPhone 15 Pro Max
```

### 6.2 单元测试新增清单

- `tests/unit/homeSelectors.spec.ts` — 9 个 HomeVM 状态枚举
- `tests/unit/summaryMapper.spec.ts` — 4 种 wallet 状态 + 文案禁用词检查
- `tests/unit/libraryMapper.spec.ts` — 4 种 filter
- `tests/unit/deckActionResolver.spec.ts` — install/update/trial 三种分支

### 6.3 集成测试新增清单

- `tests/integration/home-primary-cta.spec.tsx` — 唯一主 CTA
- `tests/integration/summary-reward-priority.spec.tsx` — reward 层在 progress 层之上
- `tests/integration/library-360-columns.spec.tsx` — 360pt 下 2 列
- `tests/integration/deck-no-launch.spec.tsx` — DeckScreen 不再渲染卡片网格

### 6.4 手工验收（必须 6 个场景全过）

按 v6.1 audit 的 6 场景人工跑一遍：

1. 新用户首开 / 无 deck
2. 有 starter deck + due review
3. due 少 / fresh card 多
4. full clear 完成
5. premium 试用中
6. 登录用户改 Audience / Fresh Start

每个场景都要在至少 360 / 390 / 430 三档宽度上跑，截屏存到 `docs/screens/v7/<scenario>/<width>/`。

### 6.5 静态指标守门

- `wc -l src/screens/*.tsx` 输出中没有任何文件 ≥ 800 行
- `grep -nE "#[0-9A-Fa-f]{6}" src/screens/*.tsx src/features/gacha/components/*.tsx` 无新增 inline hex
- `grep -nE "(lost|missed|forfeit|wasted|expired|gone)" src/features/gacha/session/summaryMapper.ts` 无命中

---

## 7. 阶段计划

v7 总共 4 个 phase，按顺序执行，不允许并行。

### Phase A · Home 减重

**范围**：变更总表 #1 / #2 / #3 / #11（仅 HomeScreen）

**改动**：
- 重写 HomeScreen 信息层级
- 抽出 `deckActionResolver.ts` / `HomeDeckRow.tsx`
- HomeVM 9 态完整

**出口**：
- HomeScreen ≤ 800 行
- 集成测试 `home-primary-cta` 通过
- 360pt 截图通过人工

### Phase B · Summary 强化

**范围**：变更总表 #4 / #5

**改动**：
- 新增 `RewardSummaryCard` / `SummaryProgressBlock`
- 重写 `summaryMapper`，导出三层结构 VM
- 文案常量化 + 禁用词测试

**出口**：
- 单元测试覆盖 4 种钱包状态
- 集成测试 `summary-reward-priority` 通过

### Phase C · Library / Deck 角色分离

**范围**：变更总表 #6 / #7

**改动**：
- LibraryScreen 收敛为浏览页
- DeckScreen 删除 library + mode launch
- libraryMapper 4 项筛选

**出口**：
- 集成测试 `library-360-columns` / `deck-no-launch` 通过
- DeckScreen ≤ 600 行
- LibraryScreen ≤ 400 行

### Phase D · 文案 / 节奏 / Settings 瘦身 / 全局打磨

**范围**：变更总表 #8 / #9 / #10 / #11（Settings 部分）/ #12

**改动**：
- Challenge 文案改造
- Review rating 可达性
- Settings 文案压缩 + 文件瘦身（迁出到 `src/features/gacha/settings/`）
- 全屏宽度审计

**出口**：
- 6 场景 × 3 宽度截图归档
- 静态指标守门通过（含 SettingsScreen ≤ 800 行）

---

## 8. 给 Claude Code 的执行约定

### 8.1 单次任务 prompt 模板

```text
请按 recallsmith/mobile/gacha-v7.md 完成 [Phase X] 的 [具体范围]。

允许改：
- [明确文件列表]

禁止改：
- src/review/model.ts
- src/review/storage.ts
- src/content/*
- src/theme/*
- 不在本范围内的其他 screen

要求：
1. 先读 gacha-v7.md §[相关章节]
2. 给出 ≤ 10 行实施计划
3. 直接修改代码
4. 跑 npm run test:typecheck && npm run test:unit
5. 总结改了什么、还剩什么风险
```

### 8.2 不允许的 agent 行为

- 跨 phase 改动（Phase A 的任务不允许同时修 Summary）
- 创建本文 §5 之外的新文件
- 自作主张改 navigation route 字段
- 把 HomeScreen 拆成多个 screen（只能拆成组件 + helper）
- 在文档里留 TODO（必须落到 task list）

### 8.3 验收顺序

每个 phase 走完后，按以下顺序检查：

1. `npm run test:typecheck`
2. `npm run test:unit`
3. `npm run test:integration`
4. `wc -l` 检查文件体量
5. `grep` 检查文案禁用词与 inline hex
6. 在模拟器跑 6 场景 × 3 宽度
7. 截图归档

---

## 9. 一句话总结

v7 不扩功能，不改美学，不动内核。
v7 只做一件事：把 v6.1 已经能跑通的主链路，在移动端真正变得顺手 —— 一个明确的主 CTA、一段有重量的奖励反馈、一个职责干净的图鉴页。

完成 v7 之后，再去想 Week Streak / Mastery Hall / Multi-pool。

不是先追 v6 的宇宙，是先把今天这一把打到位。
