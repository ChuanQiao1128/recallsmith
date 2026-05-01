# RecallSmith Mobile · v6.1 Implementation Task List

> 用途：这是给我自己执行的代码任务清单，不是再给 Claude Code 的需求稿。
> 目标：按 `gacha-v6.1.md` 的产品约束，把当前 mobile 代码逐阶段改造成稳定的 `Home → Challenge → Single Card → Summary` 主链路。
> 执行原则：小步提交、每阶段可运行、每阶段可人工验收、先结构后视觉、先主链路后外围。

---

## 0. 执行总原则

### 0.1 先后顺序

严格按以下顺序做，不跳阶段：

1. Phase 0：结构收敛
2. Phase 1：Home 重构
3. Phase 2：Challenge 路线页
4. Phase 3：Single Card / SessionCard
5. Phase 4：Summary + Reward
6. Phase 5：Draw / Library 接入
7. Phase 6：延期系统补接

### 0.2 每阶段通用验收

每阶段结束必须跑：

```bash
cd recallsmith/mobile
npx tsc --noEmit
npm run start -- --clear
```

如涉及 iOS 真机/模拟器交互，再补：

```bash
npm run ios
```

每阶段都要做 4 类人工检查：

1. 新用户首开
2. 有 due review 的老用户
3. 已完成今日挑战的用户
4. premium / 非 premium 用户都不崩

### 0.3 不允许的实现方式

- 不在 `HomeScreen.tsx` / `ReviewScreen.tsx` 继续堆新业务判断
- 不把“规则真表”写散在多个 screen 里
- 不把 Audience 过滤混入 due review
- 不先做 Week/Month summary、复杂 ceremony、Hall
- 不因为想复用旧代码而牺牲主链路结构
- 不按 greenfield 思路先另起一整套脱离现有 mobile 代码的并行应用骨架

### 0.4 本轮改造约束：基于当前代码渐进改

本轮后续真正开始改代码时，必须遵守：

1. 以当前已有 screen / store / review / content 能力为起点
2. 优先做“抽离逻辑 + 瘦身页面 + 渐进替换入口”，不是整包重写
3. 旧页面在新路径稳定前，不直接删除
4. 能在原文件上拆函数、拆 selector、拆 mapper 的，先拆，不先追求大迁移
5. 新文件只为降低耦合而建，不为了制造第二套系统

一句话：是“在现有代码上做手术式重构”，不是“另起炉灶再切换”。

---

## 1. 当前代码基线（开工前确认）

### 1.1 当前主要入口

- `mobile/App.tsx`
- `mobile/src/navigation/types.ts`
- `mobile/src/screens/HomeScreen.tsx`
- `mobile/src/screens/DeckScreen.tsx`
- `mobile/src/screens/ReviewScreen.tsx`
- `mobile/src/screens/SettingsScreen.tsx`

### 1.2 当前底层能力（尽量复用）

- 调度模型：`mobile/src/review/model.ts`
- 进度存储：`mobile/src/review/storage.ts`
- 内容解析/下载：`mobile/src/content/*`
- 登录：`mobile/src/auth/*`
- 付费：`mobile/src/premium/*`
- 同步：`mobile/src/sync/*`
- 代码块组件：`mobile/src/components/CodeBlock.tsx`

### 1.3 规则实现基线

执行时所有规则以 `mobile/gacha-v6.1.md` 为准，重点记住：

- streak：`hard/good/easy` 计入，`again` 不计
- 没有 mindful minute
- Audience 不影响 due review
- mastery 用 `stage >= 4` 的简化 UI 判定
- free pull 用 `30 + 5 overflow reserve`
- 首开不能被 onboarding 阻塞

---

## 2. Phase 0 · 结构收敛任务

目标：先把未来会反复用到的 planner / selector / mapper / session state 抽出来，避免后面每一步都在巨型 screen 里打补丁。

### Task 0.1 新建目录骨架

创建：

```text
mobile/src/features/gacha/
  contracts.ts
  constants.ts
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
```

完成定义：

- 所有文件先有最小导出，不报 TS 错
- 先不要急着填满逻辑
- 这些文件是为了从现有 `HomeScreen.tsx` / `ReviewScreen.tsx` / `DeckScreen.tsx` 中抽逻辑，不是为了先搭一套脱离现有页面的新 app 壳子

### Task 0.2 写 `contracts.ts`

定义最小共享类型：

- `TodayCounts`
- `RouteNodeRole`
- `RouteNode`
- `ChallengeRoute`
- `SessionProgressVM`
- `SummaryRewardVM`
- `HomeVM`
- `DrawWalletState`

要求：

- 类型名称稳定
- 尽量只放页面共享 contract，不把底层存储类型全搬进来

### Task 0.3 写 `constants.ts`

把 v6.1 真表中的常量先锁住：

- `DAILY_STREAK_ALLOWED_RATINGS = ['hard', 'good', 'easy']`
- `SESSION_MAIN_ROUTE_DEFAULT = 4`
- `SESSION_MIN_GOAL = 1`
- `FREE_PULL_CAP = 30`
- `FREE_PULL_OVERFLOW_CAP = 5`
- `MASTERY_STAGE_THRESHOLD = 4`

完成定义：

- 后续 screen 不再硬编码这些数值

### Task 0.4 写 `progressSelectors.ts`

抽纯函数：

- `isNewProgress(progress)`
- `isLearningProgress(progress)`
- `isMasteredProgress(progress)`
- `isDueTodayProgress(progress, now)`
- `countDue(progressList, now)`
- `countMastered(progressList)`

要求：

- 尽量复用 `review/model.ts`
- 不依赖 React

### Task 0.5 写 `homeSelectors.ts`

输入：

- deck 数据
- progress 数据
- today 状态
- reward 钱包状态

输出：

- 首页一句话战报
- 今日 counts
- CTA 状态
- draw 状态
- route 预览

完成定义：

- `HomeScreen` 后续只消费 `HomeVM`

### Task 0.6 扩展导航类型

修改：

- `mobile/src/navigation/types.ts`

新增路由：

- `Challenge`
- `SessionCard`
- `SessionSummary`
- `Library`
- 可选：`CardDetail`

要求：

- 不移除旧 `Deck`、`Review`
- 先并存，后续逐步切流

### Task 0.7 在 `App.tsx` 注册新 screen 占位

修改：

- `mobile/App.tsx`

动作：

- 仅在确认需要新导航节点时注册最小占位 screen
- 如果某阶段可以先复用旧 `Review` / `Deck` 路由承载新结构，就不要为了“形式完整”强行先塞很多空 screen
- 目标是为渐进迁移留入口，不是先把导航体系全部重写

### Phase 0 验证

命令：

```bash
cd recallsmith/mobile
npx tsc --noEmit
npm run start -- --clear
```

人工检查：

- 旧 Home 仍能打开
- 新增 screen 路由可导航，不崩
- TS 零错误

### Phase 0 完成定义

- 结构搭好
- 真表常量统一
- 后面不需要再往旧大文件塞所有新逻辑

---

## 3. Phase 1 · Home 重构任务

目标：把 Home 变成“今日开打页”，不是 deck 管理台。

### Task 1.1 盘点现有 Home 内容并分类

阅读并标记 `mobile/src/screens/HomeScreen.tsx` 中现有内容，分成 3 类：

1. 必须保留在首页首屏
2. 可以降到次级区域
3. 应该迁走或延后

执行输出：

- 在本地做一个临时注释清单或 TODO 注释
- 不立即大删，先分类

### Task 1.2 写 `HomeHero` 组件

创建：

- `mobile/src/features/gacha/components/HomeHero.tsx`

职责：

- 渲染一句话战报
- 渲染主 CTA
- 渲染最低目标

要求：

- props 只接 `HomeVM` 的必要字段
- 不自行读取 store

### Task 1.3 写 `TodayPressureCard` 组件

展示：

- 普通 / 精英 / 黄金数量
- 今日压力级别
- 今日是否有 boss

要求：

- 只做展示，不写业务判断

### Task 1.4 写 `RoutePreview` 组件

展示：

- 今日 4 节点主线的轻量预览
- 不做复杂地图
- 只让用户知道今天“差不多要打什么”

### Task 1.5 在 `HomeScreen.tsx` 接入 `homeSelectors.ts`

动作：

- 把首页业务判断收敛成 `buildHomeVM(...)`
- screen JSX 改成消费 `vm`
- 从首屏拿掉 deck 安装/更新/账号说明等重内容

### Task 1.6 重新安排首页版面层级

首页第一屏只保留：

- 一句话战报
- counts
- 最低目标
- 主 CTA
- 抽卡入口状态

其余内容：

- deck 管理
- premium 说明
- 安装/更新细节
- 账号状态

都降到折叠区或次级区域。

### Task 1.7 完成首页状态覆盖

至少覆盖：

- 首开空态
- 正常挑战态
- 无新卡但有 due 态
- 已完成态
- loading 态
- error 态

### Task 1.8 让首页主 CTA 跳到 `Challenge`

要求：

- 当前首页点击“开始今日挑战”进入新 `ChallengeScreen`
- 暂时不要再直接掉进旧 `ReviewScreen`

### Phase 1 验证

人工检查：

1. 首屏只有一个主动作
2. 用户能快速理解今天要不要打
3. 不需要滚动很多才能找到 CTA
4. 页面不再像 dashboard

### Phase 1 完成定义

- Home 首屏完成产品化收敛
- 主链路起点成立

---

## 4. Phase 2 · Challenge 路线页任务

目标：在正式开打前，先给用户一个“今天这一把”的准备页。

### Task 2.1 写 `sessionRoles.ts`

定义节点角色：

- `normal`
- `elite`
- `boss`
- 可选：`warmup`

规则：

- 第 1 张偏低压力
- 最后一张如合适则 boss
- 没有高压卡时允许无 boss

### Task 2.2 写 `sessionBuilder.ts`

职责：

- 从 due/new 候选生成今日主线
- 默认主线长度 4
- 最低目标 1
- due 优先于 new

### Task 2.3 写 `sessionPlanner.ts`

职责：

- 整合候选卡、角色包装、session policy
- 返回 `ChallengeRoute`

### Task 2.4 新建 `ChallengeScreen.tsx`

展示内容：

- 今日标题
- 节点列表
- 最低目标
- full clear 奖励预告
- 开始按钮

要求：

- 单一主 CTA
- 不做图鉴/内容浏览器
- 不抢到 draw / settings 等 secondary actions

### Task 2.5 从 Home 导航传入最小参数

参数可选：

- 当前 slug
- mode
- route seed（如果需要稳定路线）

原则：

- 参数尽量少
- 挑战页自身也能从 active deck 恢复

### Task 2.6 挑战页开始按钮跳到 `SessionCard`

要求：

- 使用 planner 生成的 route 初始化 session
- 不直接让单卡页自己再重新决定整个路线

### Phase 2 验证

人工检查：

- 首页点 CTA 可以进入挑战页
- 挑战页看得懂今天有几张、压力如何
- 无 boss 日能正常显示
- 有 due review 时 due 优先进入路线

### Phase 2 完成定义

- Home → Challenge 链路成立
- 用户心理预期先建立，再进入单卡

---

## 5. Phase 3 · Single Card / SessionCard 任务

目标：把当前 Review 的“单卡体验”抽出来，做成干净的 session 卡片页。

### Task 3.1 新建 `sessionStore.ts`

状态至少包含：

- `sessionId`
- `slug`
- `route`
- `currentIndex`
- `completedCount`
- `streakEarned`
- `sessionRatings`
- `startedAt`

要求：

- Zustand 或轻量 store 都可
- 不跟账号/premium/store 强耦合

### Task 3.2 写 `SessionProgressHeader.tsx`

展示：

- 当前第几张 / 共几张
- 当前节点角色
- 今日完成进度

### Task 3.3 写 `RatingBar.tsx`

封装：

- Again
- Hard
- Good
- Easy

要求：

- 文案与样式统一
- 不在组件里直接写存储逻辑

### Task 3.4 新建 `SessionCardScreen.tsx`

职责：

- 渲染当前卡
- 支持翻面 / 查看 explanation / code / usage
- 点击评分后写入 progress
- 通知 sessionStore 前进到下一张

### Task 3.5 把“下一张是谁”的逻辑迁出旧 Review

动作：

- 从 `ReviewScreen.tsx` 中抽离选卡逻辑到 `sessionPlanner.ts`
- 旧 `ReviewScreen` 先不删
- 新 `SessionCardScreen` 走新的 planner / store

### Task 3.6 处理 streak 写入逻辑

要求：

- 第一次出现 `hard/good/easy` 时，本次 session 标记 streak earned
- `again` 不触发
- 不做 mindful minute

### Task 3.7 处理长内容渲染

确认：

- Explanation 长文可滚动
- CodeBlock 渲染正常
- Real World Usage 能显示完整
- 评分区始终可达

### Task 3.8 session 结束跳转到 Summary

条件：

- 完成 route 主线
- 或达到 session 结束条件

要求：

- 不回旧 Review 的收尾逻辑

### Phase 3 验证

人工检查：

- 单卡体验流畅
- 4 档评分都能更新进度
- 下一张出现稳定
- 不会被 trial/premium/复杂逻辑打断阅读
- 结束后能进入 Summary

### Phase 3 完成定义

- 单卡页干净可用
- 主战斗链路成立

---

## 6. Phase 4 · Summary + Reward 任务

目标：让一次 session 真正闭环，并修复奖励体验。

### Task 4.1 写 `rewardWallet.ts`

定义：

- 主钱包数量
- reserve 数量
- 可写入规则

接口示例：

- `applyRewardToWallet(current, delta)`
- `canAcceptMorePulls(current)`

### Task 4.2 写 `rewardResolver.ts`

根据 session 结果计算：

- 是否完成最低目标
- 是否 full clear
- 奖励多少 free pulls
- 是否进入 reserve

### Task 4.3 写 `summaryMapper.ts`

输入：

- sessionStore
- progress 变化
- reward 结果

输出：

- `SessionSummaryVM`

### Task 4.4 新建 `SessionSummaryScreen.tsx`

上半屏：

- 奖励
- 解锁资格
- free pull 状态

下半屏：

- 完成数
- streak
- new → learning / learning → mastered 变化
- 下一步 CTA

### Task 4.5 接入 `30 + 5 overflow reserve`

要求：

- 30 内正常入主钱包
- 31-35 入 reserve
- >35 才不发
- 文案温和，不出现“本该给你但没了”

### Task 4.6 Summary 行为收口

CTA 至少有：

- 返回首页
- 去抽卡（如满足条件）
- 去图鉴（次级）

### Phase 4 验证

场景：

1. 只做 1 张，能得到“今天没白来”
2. full clear，能看到完整收尾
3. 钱包 29 + 奖励 3，正确进入 reserve
4. 钱包 35，再奖励时文案不刺痛

### Phase 4 完成定义

- Session 闭环完成
- 奖励体验从“损失感”变成“进展感”

---

## 7. Phase 5 · Draw / Library / Inventory 任务

目标：把内容扩张与拥有关系接回主系统，但不喧宾夺主。

### Task 5.1 写 `libraryMapper.ts`

统一把卡片状态映射成：

- `New`
- `Learning`
- `Mastered`

### Task 5.2 新建或演化 `LibraryScreen.tsx`

建议：

- 不直接在旧 `DeckScreen.tsx` 上继续叠太多逻辑
- 可先复制骨架，再逐步替代

### Task 5.3 接入 Summary / Home 的 draw 入口

原则：

- draw 是奖励后的下一步
- 不是首页最强入口
- 不得压过 due review

### Task 5.4 接入基础 draw 状态

至少区分：

- locked
- available
- reward pending
- wallet full with reserve

### Task 5.5 图鉴筛选最小实现

最小支持：

- 全部
- New
- Learning
- Mastered

### Phase 5 验证

人工检查：

- 用户可以看到自己拥有内容
- draw 不抢核心挑战 CTA
- due review 优先级不被新卡供给破坏

### Phase 5 完成定义

- 学习主链路与抽卡/图鉴关系正确

---

## 8. Phase 6 · 延期系统任务

目标：在主链路稳定后，再逐个加外围系统。

### 可选任务池

1. Audience 设置页面化
2. Settings 手动 Fresh Start
3. Week Streak
4. 轻量 milestone
5. push reminder 细化
6. 多池 / 多 deck 扩张

### 进入条件

只有当前面 5 个阶段都稳定后，才允许进入。

---

## 9. 代码层面的执行顺序建议

真正开始改代码时，按下面更细的顺序：

1. 先写纯 TS 文件
   - contracts
   - constants
   - selectors
   - planner
   - reward resolver

2. 再写小组件
   - HomeHero
   - TodayPressureCard
   - RoutePreview
   - SessionProgressHeader
   - RatingBar

3. 再写新 screen
   - ChallengeScreen
   - SessionCardScreen
   - SessionSummaryScreen

4. 最后把旧 screen 的入口逐步切到新 screen

原因：

- 先把纯逻辑抽出来，返工成本最低
- 组件和 screen 可以后续持续替换视觉
- 不会一上来就在旧大文件里打死结

---

## 10. 每次开始编码前的微流程

每次开始一个任务前，执行：

1. 明确只改一个子目标
2. 先看相关文件
3. 先改纯函数/类型，再改 UI
4. 改完立刻 `npx tsc --noEmit`
5. 再跑 expo
6. 再做 1-2 个人工场景验证

---

## 11. 第一批我应该实际执行的任务

这是开工顺序，不是备选项；但执行方式改为“优先在现有代码里抽离与瘦身”，不是一上来就新建完整替代页面。

### 第一轮

1. 建 `src/features/gacha/` 最小骨架
2. 写 `contracts.ts`
3. 写 `constants.ts`
4. 写 `progressSelectors.ts`
5. 扩 `navigation/types.ts`（只加确实即将使用的路由）
6. 评估 `App.tsx` 是否需要立即注册新路由；如果暂时不需要，就先不加空页面

### 第二轮

7. 写 `homeSelectors.ts`
8. 先从现有 `HomeScreen.tsx` 抽 `HomeHero` 所需数据
9. 写 `HomeHero.tsx`
10. 写 `TodayPressureCard.tsx`
11. 写 `RoutePreview.tsx`
12. 在现有 `HomeScreen.tsx` 上重排首屏层级
13. 让 Home CTA 指向新的挑战入口（新路由或旧路由承载新逻辑，按实现成本决定）

### 第三轮

14. 写 `sessionRoles.ts`
15. 写 `sessionBuilder.ts`
16. 写 `sessionPlanner.ts`
17. 优先从现有 `ReviewScreen.tsx` 抽出 route/session 选择逻辑
18. 再决定是新增 `ChallengeScreen.tsx`，还是先用旧入口承载 Challenge 结构
19. 打通 `Challenge -> SessionCard`

### 第四轮

20. 写 `sessionStore.ts`
21. 写 `SessionProgressHeader.tsx`
22. 写 `RatingBar.tsx`
23. 优先在现有 `ReviewScreen.tsx` 上拆出 `SessionCard` 结构
24. 当新结构稳定后，再决定是否独立成 `SessionCardScreen.tsx`
25. 打通 `SessionCard -> SessionSummary`

### 第五轮

26. 写 `rewardWallet.ts`
27. 写 `rewardResolver.ts`
28. 写 `summaryMapper.ts`
29. 先把 summary 结构落在可运行页面上（可新建，也可先借旧流转页）
30. 接入 reserve 逻辑
31. 完成 summary CTA

这 31 个任务做完，主链路就成立了。

---

## 12. 完成标准

当出现以下结果，才算 v6.1 主链路完成：

1. 从首页能一键开始今日挑战
2. 挑战前能看懂今天这一把
3. 单卡页能顺畅完成完整学习动作
4. 打完后有真正 summary，而不是回到信息堆里
5. 奖励逻辑不会制造损失感
6. 旧系统能力仍可复用，但不再主导首页与 session 体验

一句话：

不是“功能都还在”就算完成，而是“用户第一次用就能顺畅打一把”才算完成。
