# RecallSmith Mobile · v6.1 In-Place Refactor Map

> 用途：这不是新的产品稿，而是“基于当前已有代码怎么拆、怎么留、怎么渐进改”的手术图。
> 目标：后续真正改代码时，不按 greenfield 重写，而是围绕当前 `HomeScreen.tsx`、`ReviewScreen.tsx`、`DeckScreen.tsx` 渐进重构。

---

## 0. 改造总策略

### 0.1 改造原则

本轮不是：

- 先新建一套完整新页面
- 再整体切换路由
- 再删除旧代码

本轮应该是：

1. 先识别现有大文件里“稳定可复用”和“高耦合待抽离”的部分
2. 先抽纯函数、selector、planner、mapper
3. 再把现有 screen 的首屏和主流程瘦下来
4. 当某块结构已经稳定时，再决定要不要独立成新 screen / 新组件

### 0.2 最高优先级

真正的优先级不是“页面数量”，而是：

1. 让 Home 首屏只服务今日开打
2. 让 Review 不再同时承担 deck 加载、trial/premium 判定、session 编排、单卡 UI、结束态
3. 让主链路变成：
   - Home
   - Challenge（可先借旧路由承载）
   - SessionCard（可先从现有 Review 内部结构长出来）
   - Summary

---

## 1. 当前代码结构判断

### 1.1 `HomeScreen.tsx` 的现状判断

当前 `mobile/src/screens/HomeScreen.tsx` 混在一起的职责主要有 6 类：

1. 纯工具函数
   - `clamp01`
   - `startOfToday`
   - `weekdayShort`
   - `formatMonthDay`
   - `isLearned`
   - `isScheduled`
   - `buildUpcoming`
   - `isTruthyEnv`

2. 网络/权限/付费相关逻辑
   - `fetchPremiumDeckUrl`
   - `fetchServerPremium`
   - auth init
   - server premium 真值同步

3. 首页核心数据聚合逻辑
   - `computeHomeState`
   - `loadHomeFromLocal`
   - deck summaries
   - updates
   - upcoming week/month

4. 首次启动 bootstrap 安装逻辑
   - auto install public decks
   - bootstrap modal

5. 首页实际 UI
   - heading
   - calendar week/month
   - month gate
   - decks list
   - deck download / full install / preview install 入口

6. 导航与交互分发
   - `openMonth`
   - `openDeck`
   - settings 跳转
   - sign in / sign up 跳转

问题不在于功能多，而在于：

- 首页承担了太多“平台层职责”
- 首屏最重要的信息层级被 Calendar 和 Deck 管理抢掉了
- `computeHomeState` 太重，既做 deck 安装兜底，又做产品首页 view model 聚合
- deck 行点击里混了 premium / preview / full install / alert / load spinner / recompute state 多重分支

结论：
`HomeScreen.tsx` 不能直接重写，但必须“先抽数据聚合，再瘦首屏，再下沉 deck 安装分支”。

### 1.2 `ReviewScreen.tsx` 的现状判断

当前 `mobile/src/screens/ReviewScreen.tsx` 混在一起的职责主要有 7 类：

1. 纯工具函数
   - `buildPreviewDeck`
   - `buildCardMap`
   - `sortCards`
   - `startOfToday`
   - `isLearned`
   - `isNewCard`
   - `isScheduled`
   - `isDueTodayBucket`
   - `countDueToday`
   - `getCardRevision`
   - `getSeenRevision`
   - `isUpdatedCard`
   - `modeLabel`
   - `normalizeCodeLanguage`
   - `renderSimpleMarkdown`

2. premium / trial 判断逻辑
   - `showTrialUpsellDialog`
   - `computePremiumActive`
   - `goPaywall`
   - `ensurePremiumOnce`

3. 选卡与 session 编排逻辑
   - `pickNextCard`
   - `sessionDone / sessionLimit`
   - `avoidUidRef`

4. deck 加载与安装逻辑
   - manifest gate
   - auto-install if public deck not installed
   - premium/trial resolve
   - active slug sync
   - remote progress apply

5. 单卡显示逻辑
   - flip animation
   - front/back rendering
   - explanation / code / usage
   - rating buttons

6. rating 提交与持久化
   - `handleRating`
   - `scheduleNextReview`
   - `saveDeckProgress`
   - `recordReviewEvent`
   - `scheduleProgressSync`
   - `syncDailyReminders`

7. 结束态处理
   - 当前是 `!current` 时在同一页显示 done card
   - 还没有真正的 Summary 页面

问题比 Home 更严重：

- 这是一个“从 deck gate 到单卡交互到结束态”全部塞在一起的超级 screen
- 读卡体验本身其实不差，但被外围加载/权限逻辑包住了
- `handleRating` 已经近似是 session 内核，但又没有 session store 抽象
- 选下一张卡的策略被直接绑死在 screen 里

结论：
`ReviewScreen.tsx` 不应该直接被删除；应该先把它拆成：

- 纯 planner / selector
- session 进度状态
- card display 组件
- rating action handler
- summary 跳转条件

---

## 2. HomeScreen in-place refactor map

## 2.1 哪些保留在 `HomeScreen.tsx`

短期内保留：

1. 页面入口壳子
   - SafeArea / Gradient / Scroll 容器
   - Settings 入口按钮

2. 首页状态总控
   - loading / bootstrap modal 展示
   - selectedSlug / deckFilter 等真正页面级 UI 状态

3. 临时保留的 deck 列表渲染
   - 因为现在 deck 行点击与安装逻辑耦合很深
   - 第一轮不要急着全拆

4. auth/premium 刷新入口 effect
   - 先保留在 screen 内
   - 后面再决定是否抽 hook

理由：
这些部分虽然重，但属于页面壳子和现有流程中枢，贸然挪走风险大。

## 2.2 哪些第一批必须抽出去

### A. 工具函数 → `progressSelectors.ts` / `homeSelectors.ts`

从 `HomeScreen.tsx` 抽出：

- `isLearned`
- `isScheduled`
- `buildUpcoming`
- `clamp01`
- 与 week/month count 计算直接相关的纯函数

目标：

- screen 不再定义复习状态判断
- 后面 Home / Summary / Library 都能复用

### B. 首页 view model 聚合 → `homeSelectors.ts`

`computeHomeState()` 不要第一刀就整个搬走，但要拆成两层：

1. `loadRawHomeData()`
   - 仍由当前 screen 调用底层 repo/storage
   - 负责拿原始 deck/progress/update 数据

2. `buildHomeVM(raw)`
   - 纯映射
   - 输出首页真正需要的：
     - hero 文案
     - today counts
     - cta state
     - route preview
     - draw state

第一阶段不要试图把 bootstrap 安装逻辑也塞进 selector；那会把 selector 污染成副作用层。

### C. 首页 hero 区块 → 组件

从现有 Home 顶部抽成：

- `HomeHero`
- `TodayPressureCard`
- `RoutePreview`

注意：
这些组件只接 `vm`，不直接读 auth/store/content。

## 2.3 哪些继续留在 Home，但降级到次级区域

以下内容不是删除，而是从首页首屏降权：

1. Calendar
   - 保留 week view 能力
   - 但不再占据首页首屏视觉核心

2. Month gate / Month modal
   - 继续保留
   - 作为次级能力，不再主导首页

3. Deck list
   - 继续保留
   - 但放到 hero / 今日挑战信息之后

4. bootstrap / download 过程
   - 保留 modal
   - 不出现在首页首屏叙事里

## 2.4 哪些后续再拆，不是第一刀

这些不要第一轮就动：

1. premium full install / preview install 分支
2. `fetchPremiumDeckUrl`
3. `fetchServerPremium`
4. bootstrap 自动安装完整流程
5. Month view 网格渲染

原因：
这些是高风险基础设施，先动它们不会提升主体验，反而容易把现有可运行流程弄坏。

## 2.5 Home 重构顺序

建议顺序：

### 第 1 步
抽纯函数和首页 selector，不改视觉

### 第 2 步
把首屏重排成：

- Hero
- 今日 counts
- 最低目标
- 主 CTA
- 抽卡状态

### 第 3 步
把 Calendar 下沉到首屏后

### 第 4 步
把 Deck list 下沉到首页后半段

### 第 5 步
再考虑 deck row 点击逻辑是否拆到 `deckActions.ts` / `deckInstallResolver.ts`

## 2.6 Home 的明确不动项

本轮前两刀不动：

- `Settings` 跳转
- sign in / sign up 流转
- bootstrap modal UI
- month modal UI

因为这些不是“首页主链路模糊”的根因。

---

## 3. ReviewScreen in-place refactor map

## 3.1 哪些保留在 `ReviewScreen.tsx`

第一阶段保留：

1. 卡片正反面 UI
2. flip animation
3. `CodeBlock` 渲染
4. rating 按钮布局
5. 加载/错误壳子

理由：

- 这些是当前 screen 里相对最稳定、最接近未来 `SessionCard` 的部分
- 用户体验问题主要不在这层，而在它背后的选卡/权限/结束态混杂

## 3.2 哪些第一批必须抽出去

### A. 纯选卡逻辑 → `sessionPlanner.ts`

从 `ReviewScreen.tsx` 抽出：

- `isNewCard`
- `isDueTodayBucket`
- `countDueToday`
- `isUpdatedCard`
- `pickNextCard`

目标：

- screen 不再决定“下一张是谁”
- 后续 Challenge / SessionSummary 都能共享 session route 概念

### B. trial / premium 判定辅助 → 单独 helper

先不要整个抽光，但应先拆：

- `computePremiumActive`
- `buildPreviewDeck`
- `showTrialUpsellDialog`

建议放去：

- `features/gacha/session/sessionMapper.ts`
- 或 `features/gacha/planner/sessionPlanner.ts` 的辅助文件

注意：
`goPaywall` 这种带导航副作用的函数，可以暂时留在 screen。

### C. rating 后进度更新序列 → `sessionStore` + action helper

`handleRating()` 现在做了这些事：

1. schedule next review
2. 写入 progress
3. 记录 sync event
4. 处理 trial 完成弹窗
5. 更新 sessionDone
6. 选下一张
7. reset flip
8. sync reminders

这说明它已经不是单纯的 click handler，而是 session action pipeline。

应该先拆成：

- `applyRatingToProgress(...)`
- `enqueueReviewSync(...)`
- `getNextSessionState(...)`

短期仍由 `ReviewScreen` 调用；但逻辑本体从 screen 里拿出去。

## 3.3 哪些继续留在 Review，但先做“内部换骨”

第一阶段不急着把 `ReviewScreen` 改名/拆新页面，而是先在内部换结构：

1. 保留 `ReviewScreen` 路由入口
2. 让它内部逐步变成：
   - load gate section
   - session shell section
   - card view section
   - rating action section
   - completion redirect section

也就是先把一个“大一坨 screen”变成“几个清晰块”。

## 3.4 哪些后续再拆，不是第一刀

先别急着拆：

1. manifest 检查与 auto install
2. paywall 兜底逻辑
3. RevenueCat 二次验证
4. remote progress apply

原因同 Home：
这些是基础设施，不是当前“读卡体验结构混乱”的第一来源。

## 3.5 Review 重构顺序

### 第 1 步
抽纯选卡逻辑和 progress 判断函数

### 第 2 步
抽 `handleRating()` 的纯逻辑部分

### 第 3 步
在 `ReviewScreen` 内引入 `SessionProgressHeader` 和 `RatingBar` 组件

### 第 4 步
让 `!current` 不再显示“done card 原地结束”，而是跳到 summary 承载页

### 第 5 步
当上述结构稳定后，再决定：

- 是把 `ReviewScreen` 继续演化成 `SessionCardScreen`
- 还是保留 `Review` 路由，仅内部换壳

我的倾向：
前两轮先不改路由名，先把结构拆好。

## 3.6 Review 的明确不动项

前两轮不动：

- flip 动画实现
- CodeBlock 的使用方式
- 现有四个 rating 按钮的语义
- review/model.ts 的底层 schedule 规则

---

## 4. DeckScreen 的处理策略

`DeckScreen.tsx` 当前承担：

- deck 概览
- start review 入口
- trial/premium gating 一部分

短期策略：

1. 不把它当主战场
2. 不先大改
3. 只在 Home 主链路稳定后，再决定它的角色：
   - 继续做 Library/Deck detail
   - 或变成次级页

也就是说：

- 现在不从 `DeckScreen` 开始大动
- 但 Home 到 Challenge 的新主链路会逐步降低它的中心性

---

## 5. 实际改造顺序图

## 5.1 第一波：只抽逻辑，不改大路由

做：

1. 从 `HomeScreen.tsx` 抽 `homeSelectors.ts`
2. 从 `HomeScreen.tsx` 抽共用 progress helper
3. 从 `ReviewScreen.tsx` 抽 `sessionPlanner.ts`
4. 从 `ReviewScreen.tsx` 抽 rating pipeline helper

不做：

- 不先新建整套 screen
- 不先改动 bootstrap/premium 基础设施

## 5.2 第二波：重排 Home 首屏

做：

1. 先在现有 `HomeScreen.tsx` 上插入 hero / today pressure / route preview
2. 把 Calendar 下沉
3. 把 Deck list 放到更后

不做：

- 不先删 calendar / month / deck list
- 不先改 deck 安装流程

## 5.3 第三波：Review 内部换骨

做：

1. `ReviewScreen.tsx` 内引入 `SessionProgressHeader`
2. 引入 `RatingBar`
3. 让选卡与 rating pipeline 外置
4. 让 done 态跳去 summary 承载

不做：

- 不先整页重写 UI
- 不先全面切新路由名

## 5.4 第四波：再决定新 screen 形态

等前 3 波完成后，再判断：

- `Challenge` 是否需要独立 route
- `SessionCard` 是否需要独立 route
- `Summary` 是否直接新增 route

这里我判断：

- Summary 大概率应尽快独立
- Challenge 可以先轻量独立或先借旧入口承载
- SessionCard 则可以从现有 Review 演化出来

---

## 6. 文件级操作建议

## 6.1 `HomeScreen.tsx`

### 第一批该做

- 抽 selector
- 抽 hero components
- 首屏重排

### 第二批再做

- deck row action 拆分
- calendar / month 抽组件

### 暂时不做

- 重写 bootstrap
- 改 premium/full install 机制

## 6.2 `ReviewScreen.tsx`

### 第一批该做

- 抽 planner
- 抽 rating pipeline helper
- 抽 progress header / rating bar

### 第二批再做

- 抽 session shell
- done -> summary

### 暂时不做

- 全部路由替换
- 重写底层 schedule 模型

## 6.3 `DeckScreen.tsx`

### 当前策略

- 先少动
- 只在 Home 主链路稳定后再调角色

---

## 7. 最后结论

如果后续我要开始改代码，最正确的方式不是：

“我先新建 ChallengeScreen、SessionCardScreen、SessionSummaryScreen，然后再慢慢接”

而是：

“我先把 Home 和 Review 里真正该抽的逻辑抽出去，把首屏和单卡主流程瘦下来；等结构成型，再决定哪些块独立成 screen。”

一句话总结：

先做 in-place refactor，让旧代码变清晰；再做 route-level 演化，而不是先 route-level 重写。