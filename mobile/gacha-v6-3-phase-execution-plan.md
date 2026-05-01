# RecallSmith Mobile · gacha-v6 · 3阶段执行计划

> 目标：把 `gacha-v6.md` 里的完整产品，大体在手机端做出来，不包含后端；按 3 个连续执行阶段推进；每个阶段内部不中途停下，阶段结束后才统一回报。

## 0. 执行原则

1. 以 `mobile/gacha-v6.md` 为产品目标，以当前 `mobile/` 代码为实现基线。
2. 不 greenfield 重写，继续沿用现有 v6.1 主链路，逐步扩成 v6 产品壳。
3. 每个阶段都包含：
   - 功能实现
   - mock 数据接入
   - 关键 screen/state 落地
   - unit/integration/smoke/typecheck/coverage 回归
4. 每个阶段内部连续推进，不因中间小完成停下。
5. 只在以下情况才中断：
   - 真 blocker
   - 高风险 destructive decision
   - 文档与现有代码冲突到无法合理默认

---

## 1. 总体阶段划分

把原 v6 的 5 phases 压缩重组为 3 个更适合当前仓库的阶段：

### 阶段 A · 前台主循环扩成 v6 主产品壳
对应原 v6：P1 + P2 + P3 的主体 + P4 的一部分

### 阶段 B · 收藏/里程碑/计划/回流系统成型
对应原 v6：P4 主体 + Cluster 6/7/8/9 的大头

### 阶段 C · Profile/Settings/错误态/调试入口/收尾提测
对应原 v6：P5 + 全局错误空态 + 可提测收口

---

## 2. 阶段 A · 前台主循环扩成 v6 主产品壳

### 2.1 目标

把当前 v6.1 的“可用主链路”扩成更接近 v6 的完整前台体验：
- 首开路径成立
- Home 多状态成立
- Daily Dose 成立
- Draw 全链路成立
- Level/Settlement 从“学习页”扩成“v6 会话流”

### 2.2 功能范围

#### A1. 首开 / Auth 壳
实现大体产品壳：
- `SplashScreen`
- `WelcomeScreen`（3 屏可简化为 pager）
- `AudienceSurveyScreen`
- 首开完成标记持久化
- 首开后跳到主栈

说明：
- 不做真实后端账户系统
- Device ID / 绑定 Apple/Google 只做前端入口壳和 mock 状态

#### A2. Home Stack 扩展
在现有 `HomeScreen` 基础上扩成 v6 Home cluster 的大体：
- Home 多状态（new / active / dormant / churned / paused / clear day / backlog / reward-ready）
- PoolPickerSheet
- DailyDoseScreen
- WeekSummaryModal
- MonthSummaryModal
- PoolLaunchModal
- FreshStartLandingModal
- PausedPoolConfirmModal

说明：
- 这些先以前端 mock / local state 驱动
- 周/月总结先做产品壳和关键内容，不追求复杂统计完全真实

#### A3. Draw 全链路
在当前 `DrawScreen` 基础上扩成：
- DrawConfirmSheet
- DrawCeremonyScreen
- DrawResultScreen
- pity 进度可视化
- free pull inventory / capped copy 联动
- Draw -> 结果 -> 进入学习的路径

#### A4. Level Flow
把当前 `SessionCardScreen` / `ReviewScreen` 向 v6 Level flow 靠拢：
- LevelIntro
- Stage Q
- Stage A
- Stage IRL
- RatingBar 保持四档
- LeechWarningModal
- DemoteToast / demote 提示
- audience badge 在 Stage Q 弱化显示

#### A5. Settlement Flow
在当前 `SessionSummaryScreen` 基础上扩：
- SettlementScreen
- MasteredCelebration
- draw / streak / reward / completion 的统一结算层

### 2.3 需要新增/重点改动的文件方向

建议新增：
- `src/screens/SplashScreen.tsx`
- `src/screens/WelcomeScreen.tsx`
- `src/screens/AudienceSurveyScreen.tsx`
- `src/screens/DailyDoseScreen.tsx`
- `src/screens/DrawCeremonyScreen.tsx`
- `src/screens/DrawResultScreen.tsx`
- `src/screens/LevelScreen.tsx` 或在 `SessionCardScreen.tsx` 内分 stage 子组件后再抽 route
- `src/screens/SettlementScreen.tsx`

建议新增逻辑层：
- `src/features/gacha/onboarding/*`
- `src/features/gacha/home/homeStateMachine.ts`
- `src/features/gacha/draw/pity.ts`
- `src/features/gacha/session/levelFlow.ts`
- `src/features/gacha/settlement/*`
- `src/mock/user.ts`
- `src/mock/home.ts`
- `src/mock/draw.ts`
- `src/mock/session.ts`
- `src/mock/settlement.ts`

建议重点改动：
- `App.tsx`
- `src/navigation/types.ts`
- `src/screens/HomeScreen.tsx`
- `src/screens/DrawScreen.tsx`
- `src/screens/SessionCardScreen.tsx`
- `src/screens/SessionSummaryScreen.tsx`
- `src/screens/SettingsScreen.tsx`

### 2.4 阶段 A 测试要求

必须新增/补齐：
- 首开 onboarding / audience survey integration tests
- Home 多状态至少覆盖 3-5 个关键状态
- Draw full flow integration tests
- Level stage 切换与 rating path tests
- Settlement reward/streak/draw handoff tests
- 关键 pure logic unit tests（home state, pity, level flow, settlement vm）

阶段 A 验收命令：
- `npm run test:typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:smoke`
- `npm run test:coverage`
- `npm test`
- iOS simulator 人工走查主链路

### 2.5 阶段 A 完成定义

用户可以从：
- 首开 -> Welcome -> AudienceSurvey -> Home
- Home -> DailyDose / Draw / Level
- Draw -> Ceremony -> Result -> 学习
- Level -> Settlement
完成一套更接近 v6 的完整前台循环。

### 2.6 预估工时
- 60 ~ 110 小时

---

## 3. 阶段 B · 收藏/里程碑/计划/回流系统成型

### 3.1 目标

把 v6 中“让产品变厚”的中层系统做出来：
- Library / Pool
- Plan
- Milestone / Hall
- Recovery / 回流系统

### 3.2 功能范围

#### B1. Library / Pool cluster
实现大体产品壳：
- `LibraryScreen`（从当前 Deck/Library 收口升级）
- `SortFilterSheet`
- `CardDetailScreen`
- `PoolOverviewScreen`
- `TagExplorerScreen`
- `AudienceFilterScreen`
- Pool Switcher（global UI + per-pool 展示）

说明：
- 当前已有 `DeckScreen` 和 library mapper，可作为起点
- 这一阶段要把“Deck”真正产品化成 v6 的 `Library/Pool` 系统

#### B2. Plan cluster
实现：
- `PlanOverviewScreen`
- `PlanTodayScreen`
- `PlanWeekScreen`
- `PlanMonthScreen`
- 周目标与月回顾的前端表达

说明：
- 可复用现有 Home calendar support 和 month support 的能力
- 但页面语义要从 support widget 升级为独立计划页

#### B3. Milestone / Summary cluster
实现：
- `MilestoneHall`
- `MilestoneDetail`
- `StreakMilestoneModal`
- `WeekStreakModal`
- `FreePullGrantModal`
- `FreePullInventorySheet`
- `DailyDigestModal`
- `WeekPlannerPrompt`
- `MonthRewindModal`

说明：
- 当前已有 streak / milestone 基础逻辑
- 这一阶段把它升级成 v6 的完整产品层和 ceremony 壳

#### B4. Recovery cluster
实现：
- `BacklogWarning`
- `BacklogBurstSession`
- `FreshStartConfirm`
- `DormantNudge`

说明：
- 当前已有 Fresh Start 和部分 streak/recovery 基础
- 这一阶段让 backlog / dormant / returnee 路径有明确前台体验

### 3.3 需要新增/重点改动的文件方向

建议新增：
- `src/screens/LibraryScreen.tsx`
- `src/screens/CardDetailScreen.tsx`
- `src/screens/PoolOverviewScreen.tsx`
- `src/screens/TagExplorerScreen.tsx`
- `src/screens/PlanOverviewScreen.tsx`
- `src/screens/PlanWeekScreen.tsx`
- `src/screens/PlanMonthScreen.tsx`
- `src/screens/MilestoneHallScreen.tsx`
- `src/screens/MilestoneDetailScreen.tsx`
- `src/screens/DailyDigestScreen.tsx`
- `src/screens/BacklogWarningScreen.tsx`
- `src/screens/DormantNudgeScreen.tsx`

建议新增逻辑层：
- `src/features/gacha/pools/*`
- `src/features/gacha/plan/*`
- `src/features/gacha/hall/*`
- `src/features/gacha/recovery/*`
- `src/mock/pools.ts`
- `src/mock/plan.ts`
- `src/mock/milestones.ts`
- `src/mock/economy.ts`
- `src/mock/recovery.ts`
- `src/mock/daily.ts`
- `src/mock/month.ts`

### 3.4 阶段 B 测试要求

必须新增/补齐：
- Library / filter / card detail integration tests
- Pool switcher / pool overview tests
- Plan screens view-model unit tests
- Milestone hall/detail tests
- recovery/backlog/dormant integration tests
- free pull inventory / grant flow tests

阶段 B 验收命令：
- 全套自动化回归同阶段 A
- 补真实模拟器人工走查：Library / Plan / Milestone / Recovery

### 3.5 阶段 B 完成定义

用户不仅能完成学习循环，还能：
- 浏览池与图鉴
- 查看里程碑与奖励库存
- 看到周/月计划与回顾
- 走 backlog / dormant / fresh-start 等恢复路径

### 3.6 预估工时
- 70 ~ 120 小时

---

## 4. 阶段 C · Profile/Settings/错误态/调试入口/收尾提测

### 4.1 目标

把剩余的 Profile / Settings / 错误空态 / Debug / a11y / 提测收尾做完整，让产品达到“v6 大体齐全可提测”。

### 4.2 功能范围

#### C1. More / Profile / Achievements
实现：
- `MoreTab` 正式入口页
- `ProfileScreen`
- `AchievementsScreen`
- `EditProfileScreen`（可先 mock）
- 徽章、池进度、streak、week streak、收藏/掌握概览

#### C2. Settings 子页体系
把当前单页 Settings 拆成 v6 的大体结构：
- `SettingsMainScreen`
- `SettingsNotificationsScreen`
- `SettingsAudienceScreen`
- `SettingsSessionLimitScreen`
- `SettingsThemeScreen`
- `SettingsA11yScreen`
- `SettingsAccountScreen`
- `HelpScreen`
- `AboutScreen`
- `DeleteConfirmScreen`（仅前端壳 / mock）

说明：
- 可保留当前 SettingsScreen 作为聚合壳，再逐步拆子页
- 账户绑定、删除、通知权限等先用前端 mock / native ability 检测做壳

#### C3. 全局错误/空态/杂项
实现：
- `ErrorNetworkScreen`
- `ErrorGenericScreen`
- `ToastHost`
- `CoachOverlay`
- `OfflineBanner`
- `DebugMenu`

说明：
- `DebugMenu` 很关键，用来切 7 用户 / 30 天 mock 场景
- 这是 v6 大体完整的关键提测工具

#### C4. 可访问性 / 主题 / 视觉收口
实现：
- Reduce Motion 真正贯通 ceremony
- Dynamic Type 基本兼容
- Theme token 统一
- 关键视觉风格收口（parchment / cosmic 两套表达）

### 4.3 需要新增/重点改动的文件方向

建议新增：
- `src/screens/ProfileScreen.tsx`
- `src/screens/AchievementsScreen.tsx`
- `src/screens/EditProfileScreen.tsx`
- `src/screens/SettingsMainScreen.tsx`
- `src/screens/SettingsNotificationsScreen.tsx`
- `src/screens/SettingsAudienceScreen.tsx`
- `src/screens/SettingsSessionLimitScreen.tsx`
- `src/screens/SettingsThemeScreen.tsx`
- `src/screens/SettingsA11yScreen.tsx`
- `src/screens/SettingsAccountScreen.tsx`
- `src/screens/HelpScreen.tsx`
- `src/screens/AboutScreen.tsx`
- `src/screens/ErrorNetworkScreen.tsx`
- `src/screens/ErrorGenericScreen.tsx`
- `src/screens/DebugMenuScreen.tsx`

建议新增基础设施：
- `src/theme/colors.ts`
- `src/theme/typography.ts`
- `src/theme/spacing.ts`
- `src/theme/animation.ts`
- `src/theme/a11y.ts`
- `src/mock/debug.ts`
- `src/mock/scenarios.ts`

### 4.4 阶段 C 测试要求

必须新增/补齐：
- Profile / Settings 子页 integration tests
- DebugMenu 场景切换 tests
- 错误态 / empty state tests
- theme / a11y 相关 unit tests（能做的纯逻辑部分）
- 关键 smoke case 扩展

阶段 C 验收命令：
- 全套自动化回归
- iOS simulator 全产品走查
- 至少一轮真机走查

### 4.5 阶段 C 完成定义

达到以下状态：
- v6 的主要 screen/state 大体都有了
- More/Profile/Settings/Errors/Debug 可访问
- 7 用户场景能通过 DebugMenu 复现
- 产品可交给你做集中人工测试

### 4.6 预估工时
- 50 ~ 90 小时

---

## 5. 总工时与节奏建议

### 总工时
- 阶段 A：60 ~ 110 小时
- 阶段 B：70 ~ 120 小时
- 阶段 C：50 ~ 90 小时

合计：
- 乐观：180 小时左右
- 现实：240 ~ 320 小时
- 保守：400+ 小时

### 建议节奏
如果连续推进，不在阶段中途停：
- 阶段 A：约 2 ~ 3 周
- 阶段 B：约 2 ~ 3 周
- 阶段 C：约 1.5 ~ 2 周

总计：
- 6 ~ 8 周最现实

---

## 6. 每阶段统一门禁

每阶段结束都必须跑：
- `npm run test:typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:smoke`
- `npm run test:coverage`
- `npm test`

并做：
- iOS 模拟器人工走查
- 关键路径手测记录

---

## 7. 下一步执行方式

如果开始执行：
1. 先做阶段 A，不中途停
2. 阶段 A 完成后统一回报
3. 再继续阶段 B，不中途停
4. 阶段 B 完成后统一回报
5. 再继续阶段 C，不中途停
6. 阶段 C 完成后交给你集中测试

这就是把 `gacha-v6.md` 的完整产品，大体在手机端做出来的三阶段落地方式。
