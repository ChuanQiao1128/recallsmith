# RecallSmith Mobile · v6.1 · RN 实现指导 PRD

> 目标：在保留已有 Claude Design 大方向的前提下，修复 `gacha-v6.md` 中的规则冲突和 scope 膨胀问题，把 RN 落地路径收敛成“可阶段实现、可逐阶段验收、可直接指导编码”的版本。
>
> 本版不是推翻重做，而是做 3 件事：
> 1. 锁死唯一规则真表
> 2. 先把核心日循环做扎实
> 3. 再分阶段补外围系统
>
> 适用对象：Claude Code / 前端工程师 / 自己分阶段推进 RN 实现。

---

## 0. 本版定位

### 0.1 v6.1 与 v6 的关系

- `gacha-v6.md`：保留为大而全实现草案，可参考其 screen 覆盖面和组件野心。
- `gacha-v6.1.md`：作为真正的 RN 实施准绳，优先级高于 v6。
- 原则：如果 v6 与 v6.1 冲突，以 v6.1 为准。

### 0.2 本版核心判断

v6 的主要问题不是设计图错，而是：

- 主循环还没锁稳，就先把外围系统铺太满
- 文档内部存在规则冲突，不能安全直接编码
- 太多功能并行推进，容易把实现拖成“能跑，但体验不聚焦”

因此 v6.1 的目标不是“更多 screen”，而是“更小、更稳、更能真正指导代码”。

### 0.3 v6.1 成功标准

当以下 5 件事同时成立，才算 v6.1 成功：

1. 新用户 30-60 秒内可完成第一张卡
2. 首页只表达一件事：今天该不该打、打多少、点哪里开始
3. 单次 session 能闭环：Home → Challenge → Single Card → Summary
4. 所有关键规则只有一套解释，不再互相打架
5. 每个阶段都能在 RN 中独立预览和验收

---

## 1. v6.1 非谈判原则

### 1.1 核心循环优先于外围系统

v1 的优先级严格按以下顺序：

1. Home
2. 今日路线 / Challenge
3. 单卡交互
4. Session Summary
5. Draw / Inventory / Library
6. 其余外围系统

任何会拖慢前 4 项验证的功能，都不能先做成主路径依赖。

### 1.2 记忆调度高于游戏包装

- 先决定今天哪些卡应该出现
- 再把这些卡包装成普通 / 精英 / boss / 收尾关
- 不能为了让它更像游戏而篡改 due review

### 1.3 先保留现有 4 档评分算法，不在 v6.1 重写复习内核

当前代码里已经有可运行的 4 档评分与调度：

- `mobile/src/review/model.ts`
- `mobile/src/review/storage.ts`

v6.1 的产品实现应该复用这套底层能力，先把前台体验重构好；不要在本轮同时重写调度算法。

### 1.4 视觉大方向保留，结构与规则修正

Claude Design 已经跑过，说明大方向可用。
本轮不追求“重新发明视觉语言”，只做：

- 首页层级纠偏
- session 路径减负
- 总结页奖励逻辑校正
- 文案与状态统一

---

## 2. v6.1 唯一规则真表

本节是实现唯一依据。所有页面、交互、埋点、数据逻辑必须与本节一致。

### 2.1 Streak

最终规则：

- Daily Streak：当天首次完成 1 张卡，且评分为 `hard / good / easy` 任意之一，即续 streak
- `again` 不算续 streak
- 仅打开 app 不算 streak
- `Nothing to learn` 空日不自动送 streak
- v6.1 不做 `mindful minute` 保护
- Week Streak 推迟到后续阶段，不进入核心实现

实现备注：

- Home 只展示 `Daily Streak`
- 周维度徽章、周总结、月总结都不进入 Phase 1-4 主链路

### 2.2 Audience / 内容偏好

最终规则：

- Audience 只影响“新卡供给”和“推荐抽取候选”
- Audience 不影响已经进入复习系统的 due cards
- 切换 Audience 不能让今天应复习的卡消失
- v6.1 首页和单卡主视觉不强调 Audience Badge
- 如设计稿已有相关信息，只允许放在弱化元信息行，不影响主视觉层级

实现备注：

- 现阶段如未接入 per-card audience 字段，可只保留设置占位与接口预留
- 不把 Audience 做成主链路阻塞项

### 2.3 Mastery

最终规则：

为避免“高稀有卡反而更容易 mastered”的问题，v6.1 不按 COM/RAR/LEG 分不同 mastered 阈值。

v6.1 的 UI 采用与当前代码兼容的简化定义：

- `New`：从未完整评分过，`lastReviewedAt` 为空
- `Learning`：已学习，但 `stage < 4`
- `Mastered`：已学习，且 `stage >= 4`

说明：

- `stage` 来自 `mobile/src/review/model.ts`
- 稀有度决定包装身份，不决定 mastered 判定门槛
- 未来若要引入更复杂 mastery 指标，再新增独立字段，不在 v6.1 混做

### 2.4 Free Pull / 奖励上限

最终规则：

- 主钱包上限：30
- 溢出缓冲：5
- 超过 30 但未超过 35 的奖励，进入 `overflow reserve`
- 超过 35 的部分才真正不发放
- UI 文案不允许出现“本该给你但没了”这种强损失感表达
- 推荐文案：`Free pulls full · 5 pending in reserve`

实现备注：

- Phase 4 之前只需要先做数据结构和 summary 占位
- 真正抽卡结果流可在 Phase 5 接上

### 2.5 Fresh Start

最终规则：

- v6.1 不做自动弹出的 Fresh Start 回流流程
- 仅保留 Settings 手动入口，且放到后续阶段
- Fresh Start 只重置 schedule，不删除拥有关系
- 如果实现：
  - `New / Learning` 卡重置到未排程
  - `Mastered` 卡保留拥有关系，但 schedule 可改为重新进入轻量复习
- Fresh Start 不进入 Phase 1-4 主链路

### 2.6 Boss / Elite / 普通关

最终规则：

- 普通 / 精英 / boss 是包装角色，不是独立题型
- 先根据 due/new 生成今日 roster，再映射角色
- 没有合适高压卡时，可以没有 boss
- 用户在疲劳日、轻量日，不强制必须打 boss

### 2.7 首日路径

最终规则：

- 首开不允许 3 屏 onboarding 阻塞主路径
- 首次进入应尽快到 Home
- 第一个主 CTA 必须直达今天挑战
- 任何 survey / welcome / 多层解释只能弱化或推迟，不得阻断第一把

---

## 3. v6.1 范围

### 3.1 本版必须做

1. Home（聚焦今日目标）
2. Challenge 路线页（今日要打什么）
3. Single Card（Question → Answer → 评分）
4. Session Summary（今日完成感 + 奖励 + 下一步）
5. 基础 Draw 解锁逻辑
6. 基础 Library / Inventory 浏览
7. 最小可用 Settings

### 3.2 本版推迟做

以下内容可以保留设计预留，但不进入前 4 个阶段的主链路实现：

- Week Streak
- Month Summary
- Mastery Hall
- 复杂 milestone ceremony
- 自动 Fresh Start 回流弹窗
- 多池 Day-15 扩张
- push 状态机精细分层
- pool-specific audience
- 复杂 boss 仪式冷却

### 3.3 本版允许保留的现有能力

以下现有代码能力不推翻，尽量复用：

- 内容下载 / manifest / premium 内容门控
- 登录与账户能力
- RevenueCat / Paywall
- review schedule / progress storage / sync
- `CodeBlock` 组件

这些能力在 v6.1 中属于“外壳基础设施”，不是本轮产品主角。

---

## 4. 目标信息架构

### 4.1 v6.1 推荐路由

当前代码已有：

- `Home`
- `Deck`
- `Review`
- `Settings`
- `Paywall`
- `SignIn / SignUp / ConfirmSignUp`

v6.1 推荐升级为：

- `HomeScreen`
- `ChallengeScreen` 或 `RouteScreen`
- `SessionCardScreen`
- `SessionSummaryScreen`
- `LibraryScreen`
- `CardDetailScreen`（可后置）
- `SettingsScreen`
- `PaywallScreen`
- `Auth screens`

建议做法：

- 不要一口气推翻 `App.tsx`
- 先在现有 stack 中新增目标 screens
- 当新 screen 验收通过后，再把旧 `DeckScreen / ReviewScreen` 的职责逐步拆出去

### 4.2 v6.1 首页信息层级

首页第一屏只允许有以下层级：

1. 今日一句话战报
2. 今日普通 / 精英 / 黄金数量
3. 最低目标（如：1 张保 streak）
4. 主 CTA：开始今日挑战
5. 抽卡入口状态（锁 / 可解锁 / 可领取）

不允许首页首屏同时承载：

- 周总结
- 月总结
- 多块并列仪表盘
- 复杂账号状态说明
- 多个等权 CTA

### 4.3 Challenge 路线页

职责：

- 展示“今天这一把”由哪些节点构成
- 给用户开始前的心理预期
- 清楚告诉用户最少要做多少、完整做完能拿什么

页面应包含：

- 今日路线标题
- 普通 / 精英 / boss 数量
- 最低目标与 full clear 目标
- 节点列表或路线预览
- 单一 CTA：开始挑战

### 4.4 Single Card

职责：

- 尽可能低摩擦完成一张卡
- 内容阅读优先，游戏反馈后置

页面结构：

- 顶部：当前进度 + 当前节点身份
- 中部：Question / Answer / Code / Usage
- 底部：Again / Hard / Good / Easy
- 评分后短反馈，再立即进入下一张

### 4.5 Session Summary

职责：

- 告诉用户“今天没有白来”
- 明确奖励、进展、下一步

必须包含：

- 今日完成数量
- streak 变化
- 学习状态推进（例如 new → learning / learning → mastered）
- free pull 奖励或解锁资格
- 下一步 CTA（继续抽 / 返回首页）

---

## 5. 推荐代码架构（基于当前仓库）

### 5.1 保留现有基础模块

继续复用：

- `mobile/src/review/model.ts`
- `mobile/src/review/storage.ts`
- `mobile/src/content/*`
- `mobile/src/auth/*`
- `mobile/src/premium/*`
- `mobile/src/sync/*`

### 5.2 新增 gacha/session 特性层

建议新增目录：

```text
mobile/src/features/gacha/
  contracts.ts
  constants.ts
  debugSeeds.ts
  selectors/
    homeSelectors.ts
    progressSelectors.ts
  planner/
    sessionPlanner.ts
    sessionRoles.ts
    sessionBuilder.ts
  session/
    sessionStore.ts
    sessionMapper.ts
    summaryMapper.ts
  rewards/
    rewardWallet.ts
    rewardResolver.ts
  library/
    libraryMapper.ts
  components/
    HomeHero.tsx
    TodayPressureCard.tsx
    RoutePreview.tsx
    SessionProgressHeader.tsx
    RatingBar.tsx
    RewardSummaryCard.tsx
```

### 5.3 新 screen 建议

```text
mobile/src/screens/
  HomeScreen.tsx                 // 可重构现有文件
  ChallengeScreen.tsx            // 新增
  SessionCardScreen.tsx          // 新增；逐步替代旧 ReviewScreen
  SessionSummaryScreen.tsx       // 新增
  LibraryScreen.tsx              // 新增或由 DeckScreen 演化
  CardDetailScreen.tsx           // 可后续补
```

### 5.4 迁移策略

建议采用“并行新建 + 逐步切流”，不要直接在旧大文件里硬改到底：

1. 保留现有 `HomeScreen.tsx`、`ReviewScreen.tsx` 可运行状态
2. 新建 planner / mapper / summary 纯逻辑层
3. 新建 `ChallengeScreen.tsx` 与 `SessionSummaryScreen.tsx`
4. 把 `ReviewScreen.tsx` 中“选下一张卡”的逻辑抽到 `sessionPlanner.ts`
5. 稳定后再把旧 screen 大文件瘦身

这样能避免“巨型文件边改边塌”。

---

## 6. 页面级实现要求

### 6.1 HomeScreen

目标：把当前 Home 从“综合 deck/下载/账户状态页”收敛成“今日开打页”。

必须有的状态：

- 新用户空态
- 正常有挑战态
- 只有 due review 无新卡态
- 今日已完成态
- 奖励可领取态
- loading / error

不得首屏抢主视觉的内容：

- deck 安装细节
- premium 长说明
- auth 细节
- manifest 更新细节

技术建议：

- 现有 deck、progress、manifest 数据读取保留
- 新增 `homeSelectors.ts`，把首页渲染所需数据统一映射为：
  - `todayCounts`
  - `streakState`
  - `ctaState`
  - `drawState`
  - `routePreview`
- screen JSX 只消费 view model，不直接在页面里混大量业务判断

### 6.2 ChallengeScreen

目标：明确告诉用户“今天这一把怎么打”。

输入：

- active deck / active pool
- progress
- 今日 due/new 候选
- 首页传来的 route seed（可选）

输出：

- 节点列表
- 普通 / 精英 / boss 分布
- 最低目标
- full clear 奖励

关键要求：

- 路线页是“准备开打”的确认页，不是图鉴页
- 不做复杂地图漫游
- 不做强剧情层
- 不允许用户在这里分神到太多 secondary action

### 6.3 SessionCardScreen

目标：把当前 ReviewScreen 重构成更干净的单卡战斗页。

必须保留的现有优点：

- 4 档评分
- 代码块渲染
- 复习调度能力

必须修正的问题：

- 页面职责太重
- 状态和 gating 逻辑混在一起
- session 完成、trial、premium、下一张选择耦合太深

建议拆分：

- `sessionPlanner.ts`：决定下一张是谁
- `sessionStore.ts`：记录当前 session 内完成数、路由节点、奖励状态
- `SessionCardScreen.tsx`：只负责单张卡渲染与评分动作

### 6.4 SessionSummaryScreen

目标：让用户感受到“打完一把”的闭环。

必须展示：

- 今日完成数
- streak 是否续上
- 普通 / 精英 / boss 清掉多少
- 新进入 mastered 的数量
- free pull / reward 状态
- 下一步 CTA

注意：

- summary 不能只是数字 dashboard
- 上半屏偏奖励，下半屏偏学习进展
- 必须同时让用户感到“我赢了”和“我真的学了”

### 6.5 LibraryScreen

目标：支持用户查看已拥有内容，但不抢核心学习流。

要求：

- 默认从 Summary 或 Home 次级入口进入
- 首屏不抢过 Home 主路径
- 状态分层：New / Learning / Mastered
- 支持简单筛选，不做 v6 那种过重的仪式系统

---

## 7. 今日路线生成规则（实现版）

### 7.1 输入来源

路线生成只依赖三类输入：

1. `due review cards`
2. `eligible new cards`
3. `session policy`

其中：

- due cards 来源于现有 progress + schedule
- new cards 来源于当前 deck / inventory 中未学习卡
- session policy 决定今日上限和角色包装

### 7.2 v6.1 默认 session policy

MVP 默认规则：

- 默认主线长度：4 张
- 最低完成目标：1 张
- full clear 目标：4 张
- 超过 4 张的 due 卡进入 backlog，不在首页首屏直接压给用户

优先级：

1. due cards
2. 昨日未完成的新卡
3. 今日允许的新卡

### 7.3 角色包装规则

推荐简单版：

- 第 1 张：普通节点，低压力，负责保 streak
- 中间节点：普通 / 精英混合
- 最后 1 张：如存在高压卡则包装为 boss；否则仍可普通收尾

这样既有“打一把”的感觉，又不会把所有天都强行做成大戏。

### 7.4 不做的复杂度

v6.1 不做：

- 多 boss 日复杂排程
- 复杂 theme hunt 模板树
- 仪式冷却交叉判断
- 多池并行竞争首页资源

---

## 8. 分阶段实现计划

以下阶段是 v6.1 真正的编码顺序。每个阶段都必须“可运行、可验收、可回滚”。

## Phase 0 · 基础收敛层

### 目标

在不大改视觉的前提下，把业务规则和页面职责先解耦，为后续阶段扫雷。

### 任务

1. 新建 `src/features/gacha/` 目录
2. 抽出 Home / Session / Summary 所需 contracts
3. 新建 planner / mapper / selector 文件
4. 把 v6.1 唯一规则真表写成常量与注释
5. 在 `src/navigation/types.ts` 增加新 screens 路由类型
6. 保留旧 screen 可运行，不要在本阶段强行删除

### 关键文件

- Create: `mobile/src/features/gacha/contracts.ts`
- Create: `mobile/src/features/gacha/constants.ts`
- Create: `mobile/src/features/gacha/selectors/homeSelectors.ts`
- Create: `mobile/src/features/gacha/planner/sessionPlanner.ts`
- Modify: `mobile/src/navigation/types.ts`
- Modify: `mobile/App.tsx`

### 验证

命令：

```bash
cd recallsmith/mobile
npx tsc --noEmit
npm run start -- --clear
```

人工检查：

- app 可以正常启动
- 旧 Home / Review 不崩
- 新增路由已注册，但即使页面为空骨架也能导航到位

### 出口标准

- 业务规则从 screen JSX 中开始搬出
- 新目录结构稳定
- 后续阶段不再需要在巨型 screen 文件里硬写所有逻辑

---

## Phase 1 · Home 重构为“今日开打页”

### 目标

把 Home 变成真正的产品首页，而不是综合状态页。

### 任务

1. 抽出 `HomeViewModel`
2. 只保留 1 个主 CTA：开始今日挑战
3. 首页首屏只保留：战报、数量、最低目标、抽卡状态
4. 把 deck 下载、账号、premium 等信息降到次级区域
5. 加入完整的 loading / empty / completed / blocked states

### 关键文件

- Modify: `mobile/src/screens/HomeScreen.tsx`
- Create: `mobile/src/features/gacha/selectors/homeSelectors.ts`
- Create: `mobile/src/features/gacha/components/HomeHero.tsx`
- Create: `mobile/src/features/gacha/components/TodayPressureCard.tsx`
- Create: `mobile/src/features/gacha/components/RoutePreview.tsx`

### 验证

命令：

```bash
cd recallsmith/mobile
npx tsc --noEmit
npm run start -- --clear
```

人工检查清单：

- 新用户首屏能理解“先点哪里”
- 老用户首屏能看懂今天压力级别
- 已完成用户首屏有明确后续动作
- 首页不再像 dashboard / deck admin

### 出口标准

- Home 首屏只剩 1 个主任务
- 用户不用滚很久就能决定“开打”

---

## Phase 2 · 今日路线页 ChallengeScreen

### 目标

在点击 CTA 后，不是直接掉进巨型 Review，而是先进入“今天这把”的准备页。

### 任务

1. 新建 `ChallengeScreen.tsx`
2. 用 planner 生成今日 route
3. 展示节点列表与最低目标 / full clear 目标
4. 只提供 1 个开始按钮
5. 预留后续 boss / elite 包装位，但先用简单版

### 关键文件

- Create: `mobile/src/screens/ChallengeScreen.tsx`
- Create: `mobile/src/features/gacha/planner/sessionRoles.ts`
- Create: `mobile/src/features/gacha/planner/sessionBuilder.ts`
- Modify: `mobile/App.tsx`
- Modify: `mobile/src/navigation/types.ts`

### 验证

人工场景：

1. 新用户：今天应看到 1-3 个低压力节点
2. 老用户：有 due review 时优先显示 due
3. 无 boss 日：页面不强行显示 boss
4. 轻量日：最低目标清晰可见

### 出口标准

- Home → Challenge 的路径稳定
- 用户知道自己将要打什么，而不是一头扎进卡片堆

---

## Phase 3 · Single Card / SessionCard 重构

### 目标

把当前 `ReviewScreen.tsx` 拆成更纯粹的单卡体验页。

### 任务

1. 新建 `SessionCardScreen.tsx`
2. 把“下一张选择”搬到 `sessionPlanner.ts`
3. 把 session 进度状态搬到 `sessionStore.ts`
4. 复用 `CodeBlock.tsx`
5. 保留 4 档评分，但把微反馈简化、缩短
6. 评分后直接切下一张，不做重演出阻塞

### 关键文件

- Create: `mobile/src/screens/SessionCardScreen.tsx`
- Create: `mobile/src/features/gacha/session/sessionStore.ts`
- Create: `mobile/src/features/gacha/components/SessionProgressHeader.tsx`
- Create: `mobile/src/features/gacha/components/RatingBar.tsx`
- Modify: `mobile/src/review/model.ts`（仅当需要补注释或导出 helper，不要大改算法）
- Keep for reference: `mobile/src/screens/ReviewScreen.tsx`

### 验证

人工检查：

- Question → Answer → Rating 路径顺畅
- Again / Hard / Good / Easy 都能写入进度
- 第一张完成后如果评分非 again，则 streak 正常续上
- 评分反馈不拖延下一张出现
- 长 explanation、code snippet、usage 均能正常滚动阅读

### 出口标准

- 单卡页职责清晰
- 旧 Review 中巨型耦合逻辑被拆开
- 用户体验更像“打一串卡”，不是“维护进度系统”

---

## Phase 4 · Session Summary + Reward 解锁

### 目标

让一次 session 真正闭环，并建立奖励与下一步动作。

### 任务

1. 新建 `SessionSummaryScreen.tsx`
2. 新建 `summaryMapper.ts`
3. 新建 `rewardWallet.ts` 与 `rewardResolver.ts`
4. 实现 `30 + 5 overflow reserve` 规则
5. Summary 给出明确下一步：返回首页 / 去抽卡 / 去图鉴
6. milestone 只做静态占位，不做复杂 ceremony

### 关键文件

- Create: `mobile/src/screens/SessionSummaryScreen.tsx`
- Create: `mobile/src/features/gacha/session/summaryMapper.ts`
- Create: `mobile/src/features/gacha/rewards/rewardWallet.ts`
- Create: `mobile/src/features/gacha/rewards/rewardResolver.ts`

### 验证

人工场景：

1. 只完成 1 张：有“今天没白来”反馈
2. full clear：有更完整奖励反馈
3. 钱包 29 → +3：应显示 30 主钱包 + 2 reserve
4. 钱包 35 再获奖：应给温和的“已满”提示，但不使用损失性文案

### 出口标准

- session 有清晰收尾
- 奖励逻辑不再伤害情绪
- 用户知道打完后下一步是什么

---

## Phase 5 · Draw / Library / Inventory 接入

### 目标

把“学完再抽 / 查看拥有内容”接上，但不抢前 4 阶段的主链路。

### 任务

1. 把抽卡入口从 summary / home 次级位接入
2. Library 默认展示已拥有内容
3. 状态标签统一为 `New / Learning / Mastered`
4. 抽卡只负责提供新内容，不覆盖今天 due 的优先级
5. 若设计稿已有 draw result、库存页，则在此阶段接入

### 关键文件

- Create or evolve: `mobile/src/screens/LibraryScreen.tsx`
- Create: `mobile/src/features/gacha/library/libraryMapper.ts`
- Optional: `mobile/src/screens/CardDetailScreen.tsx`
- Optional: `mobile/src/features/gacha/draw/*`
- Reference existing content loaders: `mobile/src/content/*`

### 验证

人工检查：

- Draw 入口不是首页主视觉主角
- 新卡供给不会压过 due review
- Library 可清楚区分 new / learning / mastered
- 用户可以回看内容，但不会从主学习路径中迷失

### 出口标准

- 抽卡与复习形成正确先后关系
- Library 成为支持页，而不是主循环干扰项

---

## Phase 6 · 支持系统与延期项

### 目标

在核心循环稳定后，再逐个接入外围系统。

### 可进入本阶段的内容

- Settings 中 Audience 偏好
- 手动 Fresh Start
- Week Streak
- 轻量 milestone 展示
- Push reminder 细化
- 第二池 / 多 deck 扩张

### 原则

这些功能必须逐个加入；每加一个，都不能破坏前 4 个阶段已经稳定的主链路。

---

## 9. 每阶段通用验收规范

### 9.1 技术验收

每个阶段结束都要过：

```bash
cd recallsmith/mobile
npx tsc --noEmit
npm run start -- --clear
```

如果使用 dev client，再补：

```bash
npm run ios
```

### 9.2 人工产品验收

每阶段至少用以下 6 个场景自测：

1. 新用户首开
2. due-only 的复习日
3. 只有 1 分钟的忙碌用户
4. full clear 用户
5. 没有新卡可抽的一天
6. 有奖励但钱包已接近上限的情况

### 9.3 视觉验收

不是看“像不像设计稿截图”，而是看：

- 首屏是否只有一个明显动作
- 单卡页是否读起来舒服
- summary 是否有完成感
- 页面是否变成 dashboard 或任务清单

---

## 10. 明确不允许发生的实现偏差

### 10.1 不要把首页做成运营后台

Home 不是 deck 管理台，不是 premium 中控，不是下载中心。

### 10.2 不要把单卡页塞回巨型业务逻辑

评分、trial、premium、下一张、summary 跳转、同步都写在一个 screen 文件里，会再次失控。

### 10.3 不要让 Audience 篡改 due review

这是产品底线。

### 10.4 不要把复杂 ceremony 提前于主循环

用户首先要的是“顺”，不是“华丽”。

### 10.5 不要让奖励提示制造损失感

奖励系统要鼓励学习，而不是教育用户“你来晚了 / 你满仓了 / 你损失了”。

---

## 11. 最终落地建议

如果现在开始写 RN 代码，建议严格按下面顺序推进：

1. Phase 0：先收敛规则和目录
2. Phase 1：只做 Home
3. Phase 2：接 Challenge
4. Phase 3：重做单卡页
5. Phase 4：补 Summary + Reward
6. Phase 5：最后接 Draw / Library
7. Phase 6：再做 Audience / Fresh Start / Week Streak / Multi-pool

一句话：

先证明“今天这一把值得打”，再扩系统宇宙。

---

## 12. 对 Claude Code / FE 的执行提示

实现时请遵守：

- 不要边写边改产品定义
- 不要跳过 Phase 顺序
- 每阶段结束后必须可运行、可预览、可人工验收
- 优先抽离 selector / planner / mapper，减少 screen JSX 里的业务判断
- 优先复用现有 `review/model.ts` 与 `review/storage.ts`
- 当前仓库里旧 screen 很大，建议采用“新建替换”而不是“继续往旧大文件加逻辑”

当 v6.1 与现有代码冲突时，先修正结构和规则，不要为了兼容旧代码而牺牲主链路质量。
