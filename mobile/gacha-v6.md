# RecallSmith Mobile · v6 · RN 实现级 PRD（Implementation-ready · Mock-first · 分阶段交付）

> **v6 目标**：把 v5.3 所有悬而未决的决议全部锁死 · 转译成 **React Native + Expo + TypeScript** 代码生成所需的一切设计说明 · 使用 **mock 数据**驱动（后端待 v6 定稿后再对齐）· 分 **5 阶段**交付 · 每阶段产出可运行的 RN app 子集（边看设计边改代码）。
>
> **v6 与 v5 的关系**：
> - v5（v5.0-v5.3）= 设计 storyboard + 反思清单 + 问题挖掘 · 给 Claude Design 画图
> - v6 = **实现 PRD** · 给 Claude Code / FE 工程师 **写代码**
> - v6 **自包含**——FE 只需要 v6 + Figma 返稿 + `mockDB.ts` 即可开工
>
> **日期**：2026-04-22 · **签收**：产品经理 Chuan Qiao · 3 PM 验证通过
>
> **技术栈**：React Native 0.81 · Expo SDK 54 · TypeScript 5.9 · React Navigation 6 · Zustand 4 · Reanimated 3 · Expo Router（可选）· 所有数据从 `src/mock/*.ts` 读取
>
> **屏幕总数**：**70 个 Screen/State**（46 主要 + 12 变体 + 12 边缘/错误/空态）· 分 5 阶段交付

---

## 目录

- §0 · v6 Meta + 3 PM 圆桌验证（读这一节 15 分钟理解全局）
- §1 · 锁定的产品决议（所有 v5 P0/P1 问题的最终回答）
- §2 · Information Architecture（导航 / 路由 / 状态机）
- §3 · Design System tokens（可直接 `export const` 到 `src/theme`）
- §4 · 70 Screen 完整目录（每屏 props / state / mock / 交互 / 成功态 / 错误态）
- §5 · Mock 数据层（RN 实现 · `src/mock/*.ts` 结构）
- §6 · 组件库（RN 组件签名 · 约 40 个组件）
- §7 · 动画规格（Reanimated 3 · 按屏给时长/曲线）
- §8 · 成功 / 错误 / 空态矩阵（所有 70 屏 × 7 类状态）
- §9 · 分阶段交付计划（5 Phases · 每 Phase 可运行 · 可独立验收）
- §10 · 3 PM 最终签字页 + 一致性 Checklist
- §11 · v6 修订日志

---

## 0. v6 Meta + 3 PM 圆桌验证

### 0.1 三位产品经理画像

| PM | 关注点 | 否决权范围 |
|----|----|----|
| **PM1 · 张经理 · 产品架构师** | 核心机制 / FSRS 正确性 / 经济系统 / 长期可扩展性 | 抽卡保底规则 · Mastery 定义 · 池结构 |
| **PM2 · 李经理 · 用户体验官** | 情绪旅程 / 无障碍 / 极端用例 / 防流失 | 文案温度 · 错误提示 · 新手阻力 |
| **PM3 · 王经理 · 交付负责人** | RN 技术可行性 / v1 scope 纪律 / 上线风险 | 砍功能 · 推迟 P1 到 v2 · 锁交付日期 |

### 0.2 圆桌议题 1 · Streak 作用域（v5.3 决议 A）

**张经理**：Streak 必须 **Global** · 跨池累计 · 学任一池都续 streak。理由：Global streak 鼓励用户回来就学，不强迫双池。
**李经理**：同意 Global。但新增 **Week Streak 🔥 Wk N**（每周 ≥ 2 天活跃）· 给 User E 周末型用户情绪出口。
**王经理**：Week Streak 后端状态机简单 · FE 只多展示一个 badge · 同意 v1 上线。

**最终决议**：
- **Daily Streak 🔥 N**（global · 跨池累计 · 每天至少开 app + 完成 1 张卡 = 续 streak）
- **Week Streak 🔥 Wk N**（每周 ≥ 2 天活跃 = 续 week streak）· v1 上线同时发布
- 断 Daily Streak **不触发**失败感 UI（只在下次打开时温和提示）
- 断 Week Streak **完全不提示**（仅用户主动看 Profile 时显示历史）

### 0.3 圆桌议题 2 · Free Pull 过期规则（v5.3 决议 B）

**张经理**：建议"60 天过期"· 给深度用户缓冲。
**李经理**："过期"这个词对用户不友好 · 建议改叫 **"30 天内使用"提醒 + 软上限 30 张**（超了新获得的进临时袋 · 7 天未清就消失）。
**王经理**：规则越简单越好 v1。**锁死：上限 30 张 · 达到上限不再发放新的**· 过期机制推到 v2。

**最终决议**：
- Free Pull **上限 30 张** · 达到上限时新获得显示 `⚠️ Free pulls full · use before earning more`
- Pity / Streak 奖励发放时**检查上限**· 已满则不发放（但**显示"本该给你的 +1"灰态提示**）
- v1 **不设时间过期**（上限已经约束了）
- v2 再做 "30 天缓冲袋" 机制

### 0.4 圆桌议题 3 · Audience Filter 位置（v5.3 决议 C）

**张经理**：放 Settings · 全局生效（最简单）
**李经理**：放 **Pool Picker Sheet 里**· 每个池独立 Audience 设置（User D 可能只 C# 选 Junior · AWS 选 Both）
**王经理**：Pool Picker 里放会让 Sheet 变拥挤 · 决议放 **Settings · 全局**· Pool-specific 推到 v2

**最终决议**：
- Settings · Content preferences 新增 `Audience: Junior / Both / All`（默认 Both）
- Daily Dose Selector **尊重此设置**（Junior 模式下只挑 Junior 卡）
- FSRS 调度**尊重此设置**（但不会把已抽卡隐藏，只影响"下次出现哪些卡"）
- Level Q 面**不再显示 Audience Badge**（因为已在 Settings 里过滤了，不需要提醒）——这是对 v5 Screen 07 的**覆盖**

### 0.5 圆桌议题 4 · Fresh Start 阈值（v5.3 决议 D）

**张经理**：沉默 ≥ 7 天解锁 · 太早不合适
**李经理**：沉默 ≥ 7 天温和推送解锁 · 但用户也应在 **Settings → Account** 主动触发 Fresh Start（不管多少天都行 · 只需二次确认）
**王经理**：同意。但 v1 API 只实现自动解锁 · 主动触发 v1.1 · 不阻塞上线

**最终决议**：
- 沉默 ≥ 7 天自动 **解锁 Fresh Start 推送 + Home 顶部 banner**
- Settings → Account 里**始终**可以触发 "Reset review schedule"（保留 Collection/Mastery）
- Fresh Start 效果：
  - 所有 `🪙 Drawn-not-learned` 和 `🎓 Learning` 卡 state 重置为 `New`
  - `💎 Mastered` 卡**不受影响**（保留成就）
  - `lapses` 计数不清零（数据层保留历史）
  - Next review schedule 全部重算为 "today"（用户打开就能学）

### 0.6 圆桌议题 5 · Gold / Diamond 触发指标（v5.3 决议 E）

**张经理**：**Mastery 双轨**· Collection 到 X% = 💫 COLLECTION 徽章（Bronze/Silver/Gold）· Mastery 到 Y% = 🏆 MASTERY 徽章（Gold/Platinum/Diamond）
**李经理**：双轨会让 Plan 卡 Milestone 显示太多——建议 **Collection = 基础徽章（Bronze/Silver/Gold）**· **Mastery = 额外金星**（Gold 加钻 · Silver 加星 · Bronze 加铜）
**王经理**：两轨 = 两个 banner 组件 + 两套数据 · FE 成本可接受 · 锁双轨

**最终决议**（双轨并行 · 两套里程碑）：

| 轨道 | 20% | 50% | 80% | 100% |
|----|----|----|----|----|
| **Collection** 轨 | 🥉 Bronze Collect | 🥈 Silver Collect | 🥇 Gold Collect | 🏆 Complete Collector |
| **Mastery** 轨 | ⭐ Junior Master | ⭐⭐ Journey Master | ⭐⭐⭐ Senior Master | 💎 Diamond Master |

- 每个池独立计算
- 两轨仪式**不同时触发**（避免仪式叠加）· 若同日触发 · 按**先 Mastery 后 Collection** 分 2 次播（间隔 3 秒淡入）
- 仪式冷却期：同一**池内**同一**轨**两次里程碑间隔 ≥ 5 天才触发仪式（不够不播 · 徽章静默上架）

### 0.7 圆桌议题 6 · 卡面是否显示 Audience Badge（v5 覆盖）

（因 §0.4 的 Audience Filter 决议 · 卡面不再需要 Badge）

**张经理**：取消卡面 Audience Badge · 理由：Settings 已过滤
**李经理**：但 Level Q 面（学习中）仍保留 `Audience: MID` 小标签 · 因为这帮助用户理解"这张卡的难度定位"
**王经理**：中间方案——卡面（抽卡结果 / Library）取消 · Level Q 面保留

**最终决议**：
- **抽卡结果卡（Screen 04）· Library 卡（Screen 11）· Settlement 缩略卡**：**不显示 Audience Badge**
- **Level Q 面（Screen 07 · D2-02 · D3-02 等）顶部 Header**：**保留小 13pt 文字** `Audience: MID`（灰色 · 不作主视觉）

### 0.8 圆桌议题 7 · 是否需要登录 / 账户系统（v6 新增）

**张经理**：v1 必须有账户 · 不然换手机数据丢
**李经理**：v1 匿名就够 · 注册卡新用户 40% · 强制登录不合适
**王经理**：折中——v1 **用 Device ID 匿名登录**（开 app 自动创建 user）· **提供"绑定 Apple / Google"入口**但不强制 · v2 再做邮箱注册

**最终决议**：
- v1 启动**不需要任何登录操作**
- 首次打开自动创建 `user.device_id = <UUID>`
- Settings → Account 提供 `[ Link Apple ID ]` / `[ Link Google ]` · 点击弹出 OS 原生 OAuth
- 绑定成功后数据可跨设备同步（后端支持）
- 未绑定用户：卸载 = 数据丢失 · Settings 顶部常驻 `⚠️ Bind account to save progress` 软提示

### 0.9 v6 与 v5 的 11 项 Override

v5 的部分决定被 v6 覆盖。以下是**覆盖清单**（优先级：v6 > v5.3 > v5.2 > ...）：

| # | v5 原定 | v6 锁定 | 原因 |
|----|----|----|----|
| 1 | Streak = 单池（v5.1） | **Global + Week Streak 双轨** | 议题 1 |
| 2 | Free Pull 无过期（v5.2） | **上限 30 张** | 议题 2 |
| 3 | Audience 卡面显示（v4） | **卡面不显示 · Settings 过滤** | 议题 7 |
| 4 | Level Q 带 Audience Badge（v5 Screen 07） | **保留但降级为 13pt 小字** | 议题 7 |
| 5 | Milestone 单轨（v5.2） | **Collection + Mastery 双轨** | 议题 6 |
| 6 | Fresh Start 未定义 | **≥ 7 天自动 + Settings 主动双入口** | 议题 5 |
| 7 | 账户系统未定义 | **Device ID 匿名 + 可选绑定 Apple/Google** | 议题 8 |
| 8 | Library 2 列（v5.1 → v5.2 回 3 列） | **锁 3 列 + 16pt gutter**（v5.2 延续） | v5.2 已定 |
| 9 | Leech 选项 3 项（v5.2） | **扩 4 项 · 加 "Bury 7 days"** | §13 问题 4 |
| 10 | 推送 3/天固定 | **按用户状态分级 + 合并推送** | §13 问题 11 + 13 |
| 11 | Daily Dose 仅 Day-1 | **每池首次激活各 1 次**（AWS 激活也弹） | §13 问题 12 |

---

## 1. 锁定的产品决议（v6 全量）

> v5 所有 P0/P1 问题的最终回答汇总在这一节。FE 实现时以此为唯一依据。

### 1.1 Core 机制

**1.1.1 抽卡 · Draw**
- 10 连抽保底：每次 10 连至少 1 张 RAR+（Per-pool pity）
- Pity 计数：连续抽了 N 张都是 COM → 第 10 张保 RAR+ · Per-pool 独立
- 成本：每次 10 连 = 1 Free Pull（无 Free Pull 时 CTA 灰态 + tooltip `Come back tomorrow for free pulls`）
- Free Pull 上限：**30** · 已满不发新的
- 稀有度概率：COM 70% · RAR 27% · LEG 3%（保底除外）

**1.1.2 FSRS 调度**
- Again → 10 min 内重排（同一会话结尾重现）
- Hard → 1-2 天 · 难度 +0.15 · stability 减半
- Good → 2-4 天 · 难度不变 · stability ×1.5
- Easy → 4-7 天 · 难度 -0.10 · stability ×2
- Mastery 定义：
  - COM 卡：连续 5 次 Good/Easy = 💎 Mastered
  - RAR 卡：连续 4 次 Good/Easy = 💎 Mastered
  - LEG 卡：连续 2 次 Good/Easy = 💎 Mastered
- 降级：累计 3 次 Again = 🎓 → 🪙（state New · reps=0 · lapses++）
- Leech：连续 3 次 Hard 或累计 5 次 Again = 弹 4 选项 Modal（Pause 3 days · Bury 7 days · Reset · Keep）

**1.1.3 Streak（v6 Override v5）**
- **Daily Streak 🔥 N**：每天 ≥ 1 张卡 Good/Easy = +1（Hard 也算 · Again 不算）
- 打开 app 但不学 = **不算**（保护机制：Nothing-to-Learn 空池日例外 · 算 mindful minute）
- 断 Daily Streak 不推送 · 不提示 · 仅下次打开时 Home Plan 卡 "rebuilding" 态
- **Week Streak 🔥 Wk N**：周一 00:00 - 周日 23:59 期间 ≥ 2 天活跃 = +1 Wk
- Wk N ≥ 4 触发 Profile 里的 "Weekend Warrior 🏅" 徽章（User E 专属）

**1.1.4 Mastery · Collection 双轨里程碑**

| 里程碑 | 触发 | 奖励 | 仪式 |
|----|----|----|----|
| 🥉 Bronze Collect | 任一池 Collection 20% | +3 Free Pull | Cosmic 金光 1200ms |
| 🥈 Silver Collect | 任一池 Collection 50% | +5 Free Pull | Cosmic 银光 1400ms |
| 🥇 Gold Collect | 任一池 Collection 80% | +7 Free Pull + 外观 Shimmer | Cosmic 金光 1600ms |
| 🏆 Complete | 任一池 Collection 100% | +10 Free Pull + "All Collected" Profile 徽 | Cosmic 虹光 2000ms |
| ⭐ Junior Master | 任一池 Mastery 20% | +3 Free Pull | 轻金光 800ms |
| ⭐⭐ Journey Master | 任一池 Mastery 50% | +5 Free Pull | 金光 1000ms |
| ⭐⭐⭐ Senior Master | 任一池 Mastery 80% | +7 Free Pull + Mastery Hall unlock | 深金 1200ms |
| 💎 Diamond Master | 任一池 Mastery 100% | +10 Free Pull + Diamond 徽 + Hall 顶位 | Cosmic 钻光 2200ms |

**仪式冷却**：同池同轨 ≥ 5 天才触发仪式（不够 = 徽章静默上架 · Profile 显示）

**1.1.5 双池（Day-15 上线）**
- Streak / Free Pull = **Global**（跨池）
- Pity / Collection / Mastery = **Per-pool**
- Daily Dose = **每池首次激活各弹 1 次**
- Library 顶部 Pool Switcher · 切池 180ms 动画

**1.1.6 推送（v6 Override）**
- 用户状态机：`Active`（7 天内活跃）· `Dormant`（7-14 天未开）· `Paused`（用户主动暂停）· `Churned`（> 14 天）
- 频次：Active 最多 3/天（合并推送）· Dormant 1/天 · Paused 0 · Churned 1/7天（Fresh Start 邀请）
- **合并推送文案**：`🔔 3 C# + 2 AWS · 5 cards today · 2 min`

### 1.2 UX 文案原则（v6 锁定）

1. **永远不用"失败 / lost / broken"**：streak 断 = "reset to 🔥 0" 或"rebuilding" · 不说"lost"
2. **错误提示用琥珀不用红**：所有警告色 = `#C8883A` · 非 `#D43535`
3. **空态给路径**：每个空态必须给至少 1 个可行动 CTA（非 dead end）
4. **数字总带单位 / Total**：`7 / 115` 不写 `7` · `5 min` 不写 `5`
5. **金色仪式不超过 2200ms**：避免沉浸过载

### 1.3 v6 不做的 P1/P2（推迟到 v2）

- Binge 批量评分（§13 #8）
- Mindful minute streak 保护（§13 #14）
- Mastery Hall 深度用户页（§13 #18）
- 仪式冷却期细化（§13 #17 · v1 用简单"≥5 天"规则）
- Pool-specific Audience 设置（v1 只全局）
- 多语言（v1 仅英文 + 中文 2 语）
- 分享到社交（v1 CTA 灰态 · v2 接通）

---

## 2. Information Architecture

### 2.1 导航总览

```
Root NavigationContainer
│
├── AuthStack（仅首次打开 · 绑定后跳过）
│   ├── SplashScreen
│   ├── WelcomeScreen（3 屏滑动介绍）
│   └── AudienceSurveyScreen（Junior/Both/All 三选一）
│
└── MainStack
    ├── TabNavigator（底部 4 Tab）
    │   ├── HomeTab → HomeStack
    │   │   ├── HomeScreen（根据用户状态分 8 种态）
    │   │   ├── DailyDoseScreen
    │   │   ├── DrawConfirmSheet
    │   │   ├── DrawCeremonyScreen
    │   │   ├── DrawResultScreen
    │   │   ├── LevelScreen（Stage Q/A/IRL · 切关）
    │   │   └── SettlementScreen
    │   │
    │   ├── LibraryTab → LibraryStack
    │   │   ├── LibraryScreen（3 列 + Pool Switcher）
    │   │   └── CardDetailScreen
    │   │
    │   ├── PlanTab → PlanStack
    │   │   ├── PlanOverviewScreen
    │   │   ├── PlanCalendarScreen
    │   │   └── MilestoneHistoryScreen
    │   │
    │   └── MoreTab → MoreStack
    │       ├── ProfileScreen
    │       ├── AchievementsScreen
    │       ├── SettingsMainScreen
    │       ├── SettingsNotificationsScreen
    │       ├── SettingsAudienceScreen
    │       ├── SettingsSessionLimitScreen
    │       ├── SettingsThemeScreen
    │       ├── SettingsA11yScreen
    │       ├── SettingsAccountScreen
    │       ├── HelpScreen
    │       └── AboutScreen
    │
    ├── Modal（全屏 Modal · 可从任意 Tab 触发）
    │   ├── PoolLaunchModal（Day-15 专属）
    │   ├── MilestoneCeremonyModal（Bronze/Silver/Gold/Diamond ×2 轨）
    │   ├── WeekSummaryModal
    │   ├── MonthSummaryModal
    │   ├── FreshStartLandingModal
    │   ├── LeechWarningModal（4 选项）
    │   ├── DemoteModal（降级 Modal · 单按钮强制）
    │   ├── BacklogModePromptModal
    │   ├── FreePullUseModal（mid-session）
    │   └── PausedPoolConfirmModal
    │
    └── Sheet（底部 Sheet）
        ├── PoolPickerSheet
        ├── DensitySelectorSheet
        └── SortFilterSheet（Library）
```

### 2.2 状态机（关键 3 个）

**2.2.1 User 状态机**

```
[New] ──首次打开──> [Active]
[Active] ──7天未开──> [Dormant]
[Dormant] ──打开──> [Active]
[Dormant] ──14天未开──> [Churned]
[Churned] ──打开（点 Fresh Start）──> [Active]（FSRS 重置）
[Active] ──主动 Pause──> [Paused]
[Paused] ──打开──> [Active]
```

**2.2.2 Card 状态机**

```
[Unseen] ──Draw 抽到──> [Drawn 🪙]
[Drawn 🪙] ──Level 首次学 Good/Easy──> [Learning 🎓 1/N]
[Learning 🎓] ──持续 Good/Easy 累计 N──> [Mastered 💎]
[Learning 🎓] ──累计 3 次 Again──> [Drawn 🪙] (state=New · reps=0 · lapses++)
[Mastered 💎] ──FSRS 长期复习 Good──> 保持 💎（reps 继续累计）
[Any] ──用户 Bury 7 days──> [Buried] (state=Suspended)
[Buried] ──7 天后自动──> [Learning 🎓]（之前的进度）
```

**2.2.3 Streak 状态机**

```
[🔥 0] ──当天学 1 张 Good/Easy──> [🔥 1]
[🔥 N] ──连续当天学──> [🔥 N+1]
[🔥 N] ──某天未学──> [🔥 0]（不显示"lost"）
Week Streak 每周日 23:59 结算：当周 ≥ 2 天活跃 = Wk +1
```

### 2.3 路由参数 schema

所有 route 的 params 都严格 TS 化 · 定义在 `src/navigation/types.ts`：

```typescript
// 示例
type RootStackParamList = {
  Home: undefined;
  DailyDose: { poolId: string; firstTime: boolean };
  Level: { cardIds: string[]; sessionId: string };
  Settlement: { sessionId: string };
  CardDetail: { cardId: string };
  MilestoneCeremony: { milestone: 'bronze' | 'silver' | 'gold' | 'diamond' | 'mastery20' | 'mastery50' | 'mastery80' | 'mastery100'; poolId: string };
  // ...
};
```

---

## 3. Design System tokens（RN `src/theme/*.ts` 可直接 export）

### 3.1 色

```typescript
// src/theme/colors.ts
export const colors = {
  parchment: {
    bg: '#FAF3E0',
    bgDeep: '#F3E8C8',
    ink: '#2A2218',
    inkSecondary: '#5A4B38',
  },
  cosmic: {
    bg: '#0B1030',
    bgDeep: '#070A1F',
    inkOnCosmic: '#F5ECC4',
    glowGold: '#E8B85A',
  },
  accent: {
    gold: '#C8883A',
    amber: '#E8B85A',
    mint: '#7E9D5E',
    warn: '#C8883A',
    // v6 新增
    nothingRed: '#AA3636',  // 仅用于 Settings 破坏性操作的二次确认
    successGreen: '#7E9D5E',
  },
  rarity: {
    com: '#8C7A5B',
    rar: '#6E4C9F',
    leg: '#C8883A',
  },
  vscode: {
    bg: '#1E1E1E',
    comment: '#6A9955',
    keyword: '#569CD6',
    string: '#CE9178',
    identifier: '#9CDCFE',
  },
  tag: {
    // 14 类 Tag · key = kebab-case
    'async-await': '#7CB5D9',
    'aspnet-core': '#6E4C9F',
    'testing': '#7EC9A8',
    'oop': '#C8883A',
    'solid-patterns': '#9D4B4B',
    'ef-core': '#4A7BA6',
    'linq': '#B5965D',
    'errors-logging': '#A7503B',
    'performance': '#D9A541',
    'devops': '#5C7C3E',
    'messaging': '#8B5A9F',
    'security': '#AA3636',
    'cloud': '#5F8DC9',
    'docker': '#3F8BB5',
    // AWS 池预留 14 类（v1.1 双池上线时补齐）
  },
} as const;
```

### 3.2 字体

```typescript
// src/theme/typography.ts
export const typography = {
  fonts: {
    sans: 'Inter',  // 或 SF Pro（iOS 原生 · Expo 默认）
    mono: 'JetBrainsMono',
  },
  sizes: {
    // 卡面
    keywordLarge: 30,      // 抽卡结果大卡
    keywordMedium: 22,     // Library 3 列卡
    keywordSmall: 18,      // Settlement 缩略
    tag: 11,               // 卡面顶部 Tag
    stars: 14,             // 大卡星级
    starsSmall: 10,        // 小卡星级
    // 正文
    bodyLarge: 17,
    body: 15,
    bodySmall: 13,
    caption: 11,
    // 标题
    title1: 28,
    title2: 22,
    title3: 17,
    // 按钮
    buttonPrimary: 15,
    buttonSmall: 13,
    // 代码
    code: 13,
  },
  weights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  letterSpacing: {
    tagHeader: 0.12,  // 全大写 Tag 顶部
    normal: 0,
  },
  lineHeight: {
    body: 1.5,
    title: 1.2,
  },
} as const;
```

### 3.3 间距 / 尺寸

```typescript
// src/theme/spacing.ts
export const spacing = {
  // 基本
  xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48,
  // 屏幕
  screenPadding: 32,       // 左右 safe margin（iPhone 15 Pro 1170pt 宽）
  bottomTabHeight: 72,
  navHeaderHeight: 56,
  // 卡片
  cardRadius: 16,
  buttonRadius: 12,
  cardBorderCom: 2,
  cardBorderRar: 3,
  cardBorderLeg: 4,
  // Library 3 列
  libraryColumns: 3,
  libraryGutter: 16,
  libraryCardHeight: 260,
  // Draw Result 2×5 grid
  drawGridColumns: 2,
  drawGridGutter: 20,
} as const;
```

### 3.4 动画常量

```typescript
// src/theme/animation.ts
export const animation = {
  durations: {
    fast: 180,
    normal: 300,
    slow: 500,
    ceremony: 1200,
    ceremonyLong: 2200,
  },
  easings: {
    standard: 'ease-in-out',
    bounce: 'back(1.7)',       // Reanimated 3
    decel: 'ease-out',
  },
} as const;
```

### 3.5 a11y 常量

```typescript
// src/theme/a11y.ts
export const a11y = {
  // Reduce Motion 自动缩短动画
  reduceMotionMultiplier: 0.4,
  // 字体膨胀检测阈值
  maxFontScale: 1.5,
  // 最小可点击区
  minTouchTarget: 44,  // iOS HIG
} as const;
```

---

## 4. 70 Screen 完整目录

> **阅读指南**：每屏含 7 个字段——
> ① **ID / Route**：React Navigation 路由名（PascalCase）· FE 建文件直接对应
> ② **Purpose**：这一屏要让用户做什么（一句话）
> ③ **Props**：TS 接口签名（从路由参数拿什么）
> ④ **Key components**：这一屏由哪些 `src/components/*` 组件组合（详见 §6）
> ⑤ **States**：normal / loading / empty / success / error / edge（至少覆盖 3 种）
> ⑥ **Mock**：指向 `src/mock/*.ts` 里哪个 fixture
> ⑦ **Nav / Interactions**：按钮 → 跳哪一屏 · 事件 → 改哪个 zustand slice
>
> **屏幕 ID 命名**：`S{cluster}-{n}`（cluster 1-10 · n 从 1 起）· 10 个 cluster 合计 70 屏。

### 4.1 Cluster 1 · Auth / Onboarding（5 屏）

#### S1-1 · Splash
- **Route**：`Splash`（AuthStack 根）
- **Purpose**：App 冷启动 → 读取 AsyncStorage 里 deviceId + user state · 判断跳 Welcome / Home / Paused / FreshStart
- **Props**：无
- **Key components**：`SplashLogo` · `LoadingDots`
- **States**：
  - normal：羊皮纸背景 + logo 居中 + 0.8s fade-in
  - loading：底部 3 个点脉动（最多 1500ms · 超时回退 Welcome）
  - error：AsyncStorage 读失败 → 仍跳 Welcome（不阻塞）
- **Mock**：`src/mock/user.ts · getCurrentUserState()`
- **Nav**：
  - `user = null` → Welcome
  - `user.state = Active / Dormant` → Home
  - `user.state = Paused` → PausedPool 或 Home（看是否有活跃池）
  - `user.state = Churned` → FreshStartPrompt

#### S1-2 · Welcome
- **Route**：`Welcome`
- **Purpose**：首次打开 · 解释"收集 + 复习"机制 · 1 个 CTA
- **Props**：无
- **Key components**：`WelcomeHero`（插画 · 3 张样卡堆叠）· `PrimaryButton`
- **States**：
  - normal：3 页轮播（←左右 swipe）· 最后一页 CTA "开始收集"
  - skip：顶部右上角"跳过" → 直接 AudienceSurvey
- **Mock**：无
- **Nav**：CTA → AudienceSurvey

#### S1-3 · AudienceSurvey
- **Route**：`AudienceSurvey`
- **Purpose**：首次引导 · 选 Level + Role + Pool · 决定首抽 10 连池子
- **Props**：无
- **Key components**：`LevelPicker`（Junior/Mid/Senior 三选一）· `RolePicker`（Backend/Frontend/Fullstack）· `PoolPicker`（C#/.NET 默认勾选）· `PrimaryButton`
- **States**：
  - normal：3 区块纵向 · 至少 1 项未选时 CTA 灰
  - success：3 项齐 → CTA 高亮"进入收集 →"
  - error：网络失败（mock 场景无）· 保底 AsyncStorage 写失败 toast
- **Mock**：`src/mock/user.ts · DEFAULT_AUDIENCE`
- **Nav**：CTA → HomeFirstDraw（带 preset）· 后台 create user + device_id

#### S1-4 · HomeFirstDraw（引导首抽）
- **Route**：`Home` with `firstDrawCoach = true`
- **Purpose**：新用户第一次进主屏 · 聚焦 Draw 10 按钮 · 蒙层教学
- **Props**：`{ firstDrawCoach: boolean }`
- **Key components**：`HomeStats` · `DrawCTA` · `CoachOverlay`（暗层 + 箭头）
- **States**：
  - normal：蒙层高亮 Draw CTA · 其余灰化 · tap 蒙层也触发 Draw
  - skip：右上角 "Skip" · 蒙层消失
- **Mock**：`src/mock/home.ts · INITIAL_HOME_STATE`（0 卡 · 0 streak · 免费首抽）
- **Nav**：Draw CTA → DrawIntro

#### S1-5 · PermissionPrompt（推送授权）
- **Route**：`PermissionPrompt`
- **Purpose**：首抽后弹出 · 解释每日提醒作用 · 不授权也能用
- **Props**：无
- **Key components**：`PermissionHero` · `PrimaryButton` · `GhostButton`
- **States**：
  - normal："每天 1 条 · 不打扰 · 可随时关"
  - denied：Ghost 按钮 "稍后设置" → 直接 Home（不阻塞）
- **Mock**：无
- **Nav**：Allow → `Notifications.requestPermissionsAsync()` → Home · Deny → Home

### 4.2 Cluster 2 · Home stack（8 屏）

#### S2-1 · Home
- **Route**：`Home`（TabNav 第 1 个 tab · 默认）
- **Purpose**：状态总览 + 主要 CTA（Draw / Review）· 双池切换入口
- **Props**：无
- **Key components**：`TopBar`（池切换 + streak badge）· `HomeStats`（3 ring：Owned / Due / Mastered）· `DoubleStreak`（🔥 Daily + 🔥 Wk）· `DrawCTA` · `ReviewCTA` · `DailyDoseCard` · `PoolMilestoneRow`
- **States**：
  - normal · 单池：全部 C#/.NET 数据
  - normal · 双池：TopBar 显示当前池名 · 横滑切池
  - empty：0 卡（新用户 · 仅首抽前）· Owned ring 灰 + "还没有卡片" + CTA → Draw
  - due=0：Review CTA 替换为 "今天都复习完了 · 再来一抽？"
  - offline：顶部 thin banner（羊皮纸橙条）"离线 · 进度会在联网后同步"（mock 下永远在线）
- **Mock**：`src/mock/home.ts · HOME_SNAPSHOTS`（Day1/Day3/Day7/Day15/Day30 五档 snapshot）
- **Nav**：DrawCTA → DrawIntro · ReviewCTA → LevelIntro · TopBar 池 → PoolPickerSheet · streak → WeekSummarySheet

#### S2-2 · PoolPickerSheet
- **Route**：`PoolPickerSheet`（bottomSheet modal）
- **Purpose**：双池时切换当前主池 · 显示每池 KPI
- **Props**：`{ activePoolId: string }`
- **Key components**：`BottomSheet` · `PoolRow × N`
- **States**：
  - normal：2 行（C#/.NET + AWS SAA）· 当前池打勾
  - singlePool：只有 1 行 + "✨ Day15 会解锁 AWS SAA 池"（未解锁提示）
- **Mock**：`src/mock/pools.ts · POOLS`
- **Nav**：tap pool → setActivePool → dismiss → Home 刷新

#### S2-3 · DailyDoseCard（Home 内嵌子屏 · 独立路由供复用）
- **Route**：`DailyDose`（从 Plan tab 也可进）
- **Purpose**：展示今日推荐的 3-5 张卡 · 快速进入学习
- **Props**：`{ poolId: string }`
- **Key components**：`DoseHeader`（今日 N 张 · 预计 M 分钟）· `CardMiniRow × N` · `PrimaryButton` "开始今日"
- **States**：
  - normal：3-5 张 mini 卡缩略
  - empty：`today.length = 0` · "今日无到期 · 要不要多抽一张？" → DrawIntro
- **Mock**：`src/mock/daily.ts · DAILY_DOSE_BY_DAY`
- **Nav**：PrimaryButton → LevelIntro with `cards: today[]`

#### S2-4 · WeekSummarySheet
- **Route**：`WeekSummarySheet`（modal · 周日晚/周一早主动弹 · 也可点 🔥Wk 触发）
- **Purpose**：周回顾 · 本周 Owned/Reviewed/Mastered + 下周 plan
- **Props**：`{ weekNo: number }`
- **Key components**：`WeekHero`（大字 "Wk 3 · 🔥"）· `WeekStatsGrid`（4 格：New / Review / Mastered / Streak days）· `NextWeekHint`
- **States**：
  - normal：有数据
  - empty：本周 0 活跃 → "这周还没开始 · 现在打开吧" + CTA Home
- **Mock**：`src/mock/week.ts · WEEK_SUMMARIES`
- **Nav**：close → Home · "看详情" → PlanWeekly

#### S2-5 · MonthSummary
- **Route**：`MonthSummary`（独立屏幕 · 非 modal · 月末主动引导进入）
- **Purpose**：月度回顾 · Hero 数字（Owned N · Mastered M · streak 最长 X 天）· 可分享（v2 再说）
- **Props**：`{ month: string }`（"2026-04"）
- **Key components**：`MonthHero` · `MonthStatsList` · `MonthTimelineChart`（简单 bar chart · 每日 review 数）· `GhostButton` "回到 Home"
- **States**：
  - normal：月末自动进
  - partial：月中手动进 → "本月还未结束 · 这是到今天的数据"
- **Mock**：`src/mock/month.ts · MONTH_SUMMARIES`
- **Nav**：回到 Home

#### S2-6 · PoolLaunchCelebration
- **Route**：`PoolLaunchCelebration`（Day-15 新池上线 · 自动触发 · 全屏 modal）
- **Purpose**：Cosmic Ceremony · 欢迎用户开第二池 AWS SAA
- **Props**：`{ poolId: 'aws-saa' }`
- **Key components**：`CosmicBackground`（深蓝粒子）· `PoolLogoBurst` · `PoolIntroText`（"AWS SAA · 60 cards · 10 days to Bronze"）· `DualCTA`（"先看看" · "马上抽 10 连"）
- **States**：
  - normal：Cosmic 2200ms 动画
  - reduceMotion：动画缩到 800ms · 仍保留高潮音效
  - skip：右上角 "Skip" · 仍把 "已展示" flag 写 AsyncStorage（不重弹）
- **Mock**：`src/mock/events.ts · POOL_LAUNCH_EVENT`
- **Nav**：先看看 → LibraryPool（aws-saa · 0 owned 空态）· 马上抽 → DrawIntro(aws-saa)

#### S2-7 · FreshStartPrompt
- **Route**：`FreshStartPrompt`（全屏 modal · Churned 用户打开 app 触发 · 也可 Settings 手动进）
- **Purpose**：回流用户询问是否重置进度 · 保留卡片收藏但清 FSRS schedule
- **Props**：`{ trigger: 'auto' | 'manual' }`
- **Key components**：`FreshStartHero`（羊皮纸 · 欢迎回来）· `RadioGroup`（"继续我的进度" / "重新开始"）· `FreshStartDetails`（展开显示"重新开始会把所有卡还原为新卡 · Owned 收藏不丢"）· `PrimaryButton`
- **States**：
  - normal：两选项
  - confirmingReset：点重新开始后显示二次确认 sheet · 文案 "这会清除 N 天的复习记录 · 不可撤销"
  - success：重置完成 → Home + `toast("已重新开始 · 今天从 0 张开始")`
- **Mock**：`src/mock/user.ts · FRESH_START_FLOW`
- **Nav**：继续 → Home · 重置 → confirm → 写 `schedule = []` → Home

#### S2-8 · PausedPoolScreen
- **Route**：`PausedPool`
- **Purpose**：用户在 Settings 主动 pause 某池 · 进 Home 时该池 tab 变为 PausedPool 屏
- **Props**：`{ poolId: string }`
- **Key components**：`PausedHero`（半透卡面 + "此池暂停中"）· `PausedInfo`（暂停于 · 保留的 owned 数）· `PrimaryButton` "恢复此池"
- **States**：
  - normal：展示暂停信息
  - success · 恢复：调 resumePool → pool 状态回 Active → Home 刷新
- **Mock**：`src/mock/pools.ts · PAUSED_POOL_FIXTURE`
- **Nav**：恢复 → Home(poolId)

### 4.3 Cluster 3 · Draw flow（5 屏）

#### S3-1 · DrawIntro
- **Route**：`DrawIntro`
- **Purpose**：展示池的抽卡概率 + 保底进度 + 1 个大 CTA
- **Props**：`{ poolId: string }`
- **Key components**：`PoolBanner`（池名 + logo）· `RarityOdds`（COM 70 / RAR 27 / LEG 3）· `PityBar`（保底进度 · M/10）· `BigDrawButton` · `FreePullChip`（有免费抽时显示）
- **States**：
  - normal · 有免费抽：CTA 文案"免费抽 10 连"· 扣 1 个 Free Pull
  - normal · 无免费抽 · v1 mock：CTA 仍可抽（v1 不做付费 · mock 经济无限）
  - disabled · 今日已超额：（v1 mock 不限次）
  - error：抽卡服务异常 → inline error + retry button
- **Mock**：`src/mock/draw.ts · POOL_ODDS`
- **Nav**：CTA → DrawAnimation

#### S3-2 · DrawAnimation
- **Route**：`DrawAnimation`
- **Purpose**：Cosmic Ceremony 播抽卡动画 · 10 张依次出场 · LEG 有额外光效
- **Props**：`{ poolId: string · drawResult: DrawResult }`
- **Key components**：`CosmicBG` · `CardFlipSequence` · `SkipButton`
- **States**：
  - normal：2200ms 全动画
  - reduceMotion：800ms 快速淡入
  - skip：点"跳过"→ 直接 DrawResult
- **Mock**：`src/mock/draw.ts · mockDraw10(poolId)` · 返回 10 张卡（含保底注入）
- **Nav**：动画完 → DrawResult

#### S3-3 · DrawResult
- **Route**：`DrawResult`
- **Purpose**：展示 10 张抽到的卡 · 2×5 grid · 可点单卡看大图
- **Props**：`{ drawResult: DrawResult }`
- **Key components**：`ResultHeader`（"10 张新卡" + 其中 LEG/RAR 数）· `CardGrid2x5` · `PrimaryButton` "进入学习" · `SecondaryButton` "暂存到 Library"
- **States**：
  - normal：10 张全部 COM + 少量 RAR
  - success · 出 LEG：LEG 卡有金色脉动边 + 顶部 "🎉 SSR 登场"
  - edge · 全是已 owned（重复）：mock 场景 0 重复 · v1 不做 dup handling · v2 再说
- **Mock**：`src/mock/draw.ts · DRAW_RESULT_FIXTURES`
- **Nav**：进入学习 → LevelIntro(newCards: drawResult.cards) · 暂存 → Home + toast

#### S3-4 · CardDetailModal（抽卡结果内点单卡）
- **Route**：`CardDetailModal`（modal over DrawResult · 也从 Library 复用）
- **Purpose**：看单卡详情 · Keyword / Tag / Stars / Mastery progress / Notes
- **Props**：`{ cardId: string · from: 'draw' | 'library' }`
- **Key components**：`CardBigFace` · `CardMetaList` · `CardNotes`（v2 编辑 · v1 只读）· `CloseButton`
- **States**：
  - normal：展示完整
  - mastered：顶部 💎 Mastered badge
  - demoted：顶部 🪙 "此卡已回到新卡池"
- **Mock**：`src/mock/cards.ts · getCardById(id)`
- **Nav**：close → 回原屏

#### S3-5 · PityTriggeredToast（抽卡 10 连中保底触发时 · 非独立屏 · 轻量 toast）
- **Route**：无路由 · 从 DrawAnimation 内嵌显示
- **Purpose**：10 连最后一张保底触发 RAR 或 LEG 时弹出金色 toast "保底守住 · 已补一张 ★4+"
- **Props**：`{ rarity: 'rar' | 'leg' }`
- **States**：
  - normal：金色 2.5s 自动消失
  - reduceMotion：静态显示 · 1.5s
- **Mock**：`src/mock/draw.ts · triggersPity(rarity)`
- **Nav**：无

### 4.4 Cluster 4 · Level flow（7 屏）

#### S4-1 · LevelIntro
- **Route**：`LevelIntro`
- **Purpose**：进入学习前的 pre-session · 展示今日要学的卡 + 预计时长 + 情绪缓冲
- **Props**：`{ cards: Card[] · mode: 'new' | 'review' | 'mixed' }`
- **Key components**：`SessionHeader`（今日 N 张 · 预计 M 分钟）· `SessionModeChip` · `PrimaryButton` "开始"
- **States**：
  - normal：有卡
  - empty：cards=[] 不应到此屏 · 保底文案"今日无卡 · 返回主屏"
- **Mock**：`src/mock/session.ts · buildSession()`
- **Nav**：开始 → LevelStageQuestion(index=0)

#### S4-2 · LevelStageQuestion
- **Route**：`LevelStageQ`
- **Purpose**：Stage 1 · 只看 Keyword + Tag · 用户自问"能不能答上"· 按"看答案"进 Stage A
- **Props**：`{ sessionId · cardIndex `
- **Key components**：`StageHeader`（Stage 1/3 · 题目）· `CardFaceKeyword`（大字 Keyword · 顶部 Tag · 底部 Stars）· `AudienceMicroBadge`（小型 audience badge）· `PrimaryButton` "看答案"
- **States**：
  - normal：显示 Keyword + Tag
  - reduceMotion：去除打字机效果
- **Mock**：`src/mock/cards.ts · getCardFullContent(id)`
- **Nav**：看答案 → LevelStageAnswer

#### S4-3 · LevelStageAnswer
- **Route**：`LevelStageA`
- **Purpose**：Stage 2 · 展示核心答案（Definition + 3 要点 + Code 例子）
- **Props**：`{ sessionId · cardIndex }`
- **Key components**：`StageHeader`（Stage 2/3）· `AnswerBody`（Markdown · 支持 code block）· `CodeBlock`（VSCode 主题）· `PrimaryButton` "来真场景"
- **States**：
  - normal：完整答案
  - long · 滚动：支持垂直滚动
- **Mock**：同上
- **Nav**：→ LevelStageIRL

#### S4-4 · LevelStageIRL
- **Route**：`LevelStageIRL`
- **Purpose**：Stage 3 · 真实场景题 · 问"生产里你会怎么用"· 用户心答完按评分
- **Props**：`{ sessionId · cardIndex }`
- **Key components**：`StageHeader`（Stage 3/3）· `IRLPromptCard`（"你有个 100k QPS 的 API · 下列 async 写法哪个会 GC?"）· `IRLHint`（可选 · 点击展开）· `RatingBar`
- **States**：
  - normal：隐藏 Hint
  - hintOpen：展开 hint
- **Mock**：同上
- **Nav**：评分 → 写 FSRS schedule → 下一张 or LevelSettlement

#### S4-5 · LevelRatingBar（非独立屏 · Stage IRL 底部组件）
- **Route**：无路由 · 内嵌 `LevelStageIRL`
- **Purpose**：4 按钮横排（Again / Hard / Good / Easy）· 每按下时伴随轻触反馈 + 颜色
- **Props**：`{ cardId · onRate(rating) }`
- **Key components**：`RatingButton × 4`（颜色：red-amber / amber / mint / mint-deep）
- **States**：
  - normal：4 键可点
  - pressed：按下时 scale 0.96 + 触感反馈
- **Mock**：`src/mock/fsrs.ts · rate()`
- **Nav**：调 rate → 路由到下一张 or Settlement

#### S4-6 · LeechWarning
- **Route**：`LeechWarning`（modal · 学习中途触发）
- **Purpose**：检测到 Leech（连 3 Hard or 累计 5 Again）· 给 3 选项
- **Props**：`{ cardId: string · reason: 'threeHard' | 'fiveAgain' }`
- **Key components**：`LeechHero`（羊皮纸 · 鼓励文案"这张卡被反复困住了 · 试试重新学一遍？"）· `LeechActions`（3 钮：Bury 3天 · 拆解教程 · 继续学）
- **States**：
  - normal：3 选项
  - dismissed：关闭 · 回 LevelStageQ
- **Mock**：`src/mock/fsrs.ts · detectLeech()`
- **Nav**：Bury → setBuried(3d) → 跳过此卡 · 拆解 → v2（v1 置灰 + tooltip "即将上线"）· 继续 → 留在 LevelStageQ

#### S4-7 · DemoteCardToast（卡降级 · 非独立屏 · toast）
- **Route**：无路由 · 学习完 3 连 Again 该卡被 demote 时弹
- **Purpose**：告知用户"这张卡回到了新卡池 · 重新开始"（避免用户以为丢卡）
- **Props**：`{ cardId: string }`
- **States**：
  - normal：羊皮纸 toast + "已回到🪙新卡 · 下次再遇见"
  - reduceMotion：静态
- **Mock**：`src/mock/fsrs.ts · demote()`
- **Nav**：无

### 4.5 Cluster 5 · Settlement（4 屏）

#### S5-1 · SessionSettlement
- **Route**：`Settlement`
- **Purpose**：1 次 session 结束 · 展示 Mastered 增量 + streak + 下次 due · 用户情绪正反馈
- **Props**：`{ sessionId: string }`
- **Key components**：`SettlementHero`（Owned + N · Mastered + M · streak 🔥N）· `SettlementCardStrip`（本次学的卡的缩略 · 点可进 CardDetail）· `SettlementCTA`（"继续多一轮" or "回主屏"）
- **States**：
  - normal：常规结算
  - success · 升 mastery：某卡刚到 Mastered → Hero 下加一行"💎 新解锁 1 张 Mastered"
  - success · 新 streak milestone：🔥7/🔥30/🔥100 → 顶部插入 streak burst
- **Mock**：`src/mock/settlement.ts · SETTLEMENT_FIXTURES`
- **Nav**：继续 → LevelIntro（next batch）· 回主屏 → Home

#### S5-2 · MasteredCelebration（mastery milestone modal · 从 Settlement 自动弹）
- **Route**：`MasteredCelebration`
- **Purpose**：当某张卡首次 Mastered · 羊皮纸 ceremony（静态 · 1200ms）
- **Props**：`{ cardId: string }`
- **Key components**：`MasteryHero`（卡面 + 💎 Mastered 印章）· `NextGoal`（"离 Junior Track 还差 N 张"）· `CloseButton`
- **States**：
  - normal：1200ms hold
  - reduceMotion：500ms
- **Mock**：`src/mock/milestones.ts · MASTERED_FIRSTS`
- **Nav**：close → 回 Settlement

#### S5-3 · CollectionMilestoneModal（Bronze/Silver/Gold · 池级 Owned% 触发）
- **Route**：`CollectionMilestone`
- **Purpose**：pool 的 Owned% 到 25/50/75/100 触发 · Bronze/Silver/Gold/Complete 徽章
- **Props**：`{ poolId · tier: 'bronze' | 'silver' | 'gold' | 'complete' }`
- **Key components**：`CollectionHero`（金/银/铜徽章 + 池名）· `ProgressBar`（N / Total）· `NextTierHint`
- **States**：
  - normal：4 档样式
  - cooldown · 5 天内已弹过本池相同 tier：跳过（mock flag）
- **Mock**：`src/mock/milestones.ts · COLLECTION_MILESTONES`
- **Nav**：close → Settlement

#### S5-4 · MasteryMilestoneModal（Junior/Journey/Senior/Diamond · 池级 Mastered% 触发）
- **Route**：`MasteryMilestone`
- **Purpose**：pool 的 Mastered% 到 25/50/75/100 触发 · 与 Collection 独立
- **Props**：`{ poolId · tier: 'junior' | 'journey' | 'senior' | 'diamond' }`
- **Key components**：`MasteryHero` · `ProgressBar` · `CooldownInfo`
- **States**：
  - normal：常规
  - conflict · 同天同池 Collection + Mastery 都到 tier：队列 · Collection 先播 · 2s 后 Mastery
- **Mock**：`src/mock/milestones.ts · MASTERY_MILESTONES`
- **Nav**：close → Settlement

### 4.6 Cluster 6 · Library / Pool（6 屏）

#### S6-1 · LibraryHome
- **Route**：`Library`（TabNav 第 2 个 tab）
- **Purpose**：展示用户当前池的所有 Owned 卡 · 3 列 grid · 可筛选 / 排序
- **Props**：无（从 store 拿 activePool）
- **Key components**：`LibraryHeader`（池切换 + 统计条 Owned/Due/Mastered）· `LibraryToolbar`（Sort + Filter）· `CardGrid3Col` · `CardSmall × N`
- **States**：
  - normal：有 >=1 卡
  - empty · 0 卡：Hero "还没有卡片 · 去抽 10 连" + CTA → DrawIntro
  - empty · 筛选后 0 卡：保留 toolbar + "没符合条件的卡 · 清除筛选"
  - loading：刷新时顶部 thin loader
- **Mock**：`src/mock/library.ts · LIBRARY_SNAPSHOT`
- **Nav**：tap 卡 → CardDetailModal · tool → SortFilterSheet

#### S6-2 · SortFilterSheet
- **Route**：`SortFilterSheet`（bottomSheet modal）
- **Purpose**：筛选 Rarity / Tag / Mastery / Audience · 排序 Recent / Keyword A-Z / Mastery%
- **Props**：`{ current: FilterState }`
- **Key components**：`BottomSheet` · `ChipGroup × 4`（Rarity / Tag / Mastery / Audience）· `SortRadio` · `ApplyButton` · `ResetGhostButton`
- **States**：
  - normal：可多选 tag · 单选其他
  - applied：关闭 sheet · Library 刷新 · 显示 "N 张符合"
- **Mock**：`src/mock/library.ts · FILTER_META`
- **Nav**：Apply → dismiss · Reset → 清回默认

#### S6-3 · CardDetailFull（从 Library 点卡 · 独立全屏 · 非 modal）
- **Route**：`CardDetailFull`
- **Purpose**：比 CardDetailModal 更完整 · Notes + 本卡历史复习曲线 + related cards
- **Props**：`{ cardId: string }`
- **Key components**：`CardBigFace` · `CardMetaList` · `ReviewHistoryChart`（mini chart · 最近 10 次 rating）· `RelatedCards`（同 tag / 同 audience 推荐）· `BackButton`
- **States**：
  - normal：有历史
  - new · 0 history：ReviewHistoryChart 空态 "还没复习过这张卡"
- **Mock**：`src/mock/cards.ts · getCardDetail(id)`
- **Nav**：back → Library · related 卡点击 → 本屏递归

#### S6-4 · PoolOverview
- **Route**：`PoolOverview`
- **Purpose**：当前池的全景仪表盘 · 4 环（Owned / Due / Mastered / Leech）+ 池里程碑进度
- **Props**：`{ poolId: string }`
- **Key components**：`PoolStatRings` · `MilestoneTrackCollection` · `MilestoneTrackMastery` · `TagBreakdown`（横向 stack bar 显示各 tag 已收集 %）
- **States**：
  - normal：有数据
  - empty：0 owned 时仅显示"先去抽 10 连" CTA
- **Mock**：`src/mock/pools.ts · POOL_OVERVIEW`
- **Nav**：rings → 进入对应筛选的 Library · milestone → MilestoneDetail

#### S6-5 · TagExplorer
- **Route**：`TagExplorer`
- **Purpose**：14 tag 的收集情况概览 · 每 tag 显示 Owned/Total + %
- **Props**：`{ poolId: string }`
- **Key components**：`TagGridList`（14 行 · 每行 color dot + tag name + progress bar + N/M）
- **States**：
  - normal
  - empty · 某 tag 0 owned：行灰 + "还没有"
- **Mock**：`src/mock/library.ts · TAG_BREAKDOWN`
- **Nav**：tap tag → Library with tag filter preset

#### S6-6 · AudienceFilter（Library 内 · 从 SortFilterSheet 衍生的专用 sheet）
- **Route**：`AudienceFilterSheet`
- **Purpose**：Audience 是 Settings 全局 · 此 sheet 仅为 Library 临时查看用
- **Props**：`{ current: AudienceFilter }`
- **Key components**：`BottomSheet` · `AudienceMatrix`（Level × Role 二维勾选）· `ApplyButton`
- **States**：
  - normal · 临时覆盖：顶部 banner "临时筛选 · 离开 Library 后复位"
- **Mock**：`src/mock/user.ts · AUDIENCE_MATRIX`
- **Nav**：Apply → dismiss → Library 刷新

### 4.7 Cluster 7 · Plan（4 屏）

#### S7-1 · PlanHome
- **Route**：`Plan`（TabNav 第 3 个 tab）
- **Purpose**：今日 / 本周 / 未来 7 天的学习计划鸟瞰
- **Props**：无
- **Key components**：`PlanSegmentedControl`（Today / Week / Month）· `PlanBody`（切换子屏）
- **States**：
  - normal
  - empty · 未来 7 天 0 卡：hero "计划是空的 · 去抽 10 连 · 就有每日推送了"
- **Mock**：`src/mock/plan.ts · PLAN_SNAPSHOTS`
- **Nav**：segment → PlanToday / PlanWeek / PlanMonth

#### S7-2 · PlanToday
- **Route**：`PlanToday`（Plan 子屏 · default segment）
- **Purpose**：今日全部 due 卡 · 分 new / review 两栏
- **Props**：无
- **Key components**：`SectionHeader × 2` · `CardMiniRow × N` · `StartSessionButton`
- **States**：
  - normal
  - empty · 今日 0 due：hero "今天都复习完了 · 再抽 10 连？"
- **Mock**：`src/mock/plan.ts · PLAN_TODAY`
- **Nav**：StartSession → LevelIntro

#### S7-3 · PlanWeekly
- **Route**：`PlanWeek`
- **Purpose**：本周 7 天每天的 due 数 · 横条图 · 辅助 User E 周末型用户安排
- **Props**：无
- **Key components**：`WeeklyBarChart`（7 根 bar · 当日高亮）· `WeeklyLegend`
- **States**：
  - normal
  - weekend_heavy：周六/日 bar 显著 · 提示 "周末比较多 · 记得安排"
- **Mock**：`src/mock/plan.ts · PLAN_WEEK`
- **Nav**：tap bar → PlanDay(date)

#### S7-4 · PlanMonth
- **Route**：`PlanMonth`
- **Purpose**：下个 30 天的 heat map · 极度概览
- **Props**：无
- **Key components**：`MonthHeatmap`（6 × 5 grid）· `LegendColorScale`
- **States**：
  - normal
  - surge · 某日 >20：该格金色边 + tooltip "这天比较重"
- **Mock**：`src/mock/plan.ts · PLAN_MONTH`
- **Nav**：tap 格 → PlanDay

### 4.8 Cluster 8 · Milestone / Summary（9 屏）

> Cluster 8 汇集所有 ceremony / milestone / summary 非日常流 · 部分在前面 cluster 已点名 · 此处列出统一索引。

#### S8-1 · MilestoneHall（入口屏 · More tab 内）
- **Route**：`MilestoneHall`
- **Purpose**：用户查看所有解锁过的 milestone 徽章 · 按池分组
- **Props**：无
- **Key components**：`PoolGroupHeader × N` · `BadgeGrid`（每池 8 徽章：Bronze/Silver/Gold/Complete + Junior/Journey/Senior/Diamond）
- **States**：
  - normal · 锁定态：未解锁灰 + 解锁条件 tooltip
  - normal · 解锁态：彩色 + 解锁日期
- **Mock**：`src/mock/milestones.ts · MILESTONE_HALL`
- **Nav**：tap badge → MilestoneDetail

#### S8-2 · MilestoneDetail
- **Route**：`MilestoneDetail`
- **Purpose**：单个 milestone 的详情 · 解锁条件 / 解锁日期 / 奖励
- **Props**：`{ milestoneId: string }`
- **Key components**：`BadgeHero` · `UnlockConditions` · `RewardInfo` · `RelatedCards`
- **States**：
  - normal · 已解锁
  - locked · 未解锁：显示"还差 N"
- **Mock**：`src/mock/milestones.ts · MILESTONE_DETAIL`
- **Nav**：back

#### S8-3 · StreakMilestoneModal（🔥7 / 🔥30 / 🔥100）
- **Route**：`StreakMilestone`（modal）
- **Purpose**：daily streak 到 7/30/100 时 ceremony
- **Props**：`{ days: 7 | 30 | 100 }`
- **Key components**：`StreakHero`（大火焰 + 天数）· `StreakSummary` · `RewardInfo`（+3 免费抽 etc · v1 mock 写死）
- **States**：
  - normal
  - reduceMotion：去火焰粒子
- **Mock**：`src/mock/milestones.ts · STREAK_MILESTONES`
- **Nav**：close → 原屏

#### S8-4 · WeekStreakModal（🔥Wk 4 / 🔥Wk 13 / 🔥Wk 52）
- **Route**：`WeekStreakMilestone`
- **Purpose**：week streak 到 4/13/52 周（月/季/年）
- **Props**：`{ weeks: number }`
- **Key components**：`WeekStreakHero` · `WeeklyHistoryChart`
- **States**：normal
- **Mock**：同上
- **Nav**：close

#### S8-5 · FreePullGrantModal
- **Route**：`FreePullGrant`（modal · 领奖自动弹）
- **Purpose**：得到新免费抽时的 ceremony（来自 streak / milestone / daily gift）· 解释来源
- **Props**：`{ count: number · source: 'streak' | 'milestone' | 'daily' }`
- **Key components**：`GrantHero`（+N 🎴 免费抽）· `SourceLabel`（"来自 🔥7 连续" etc）· `PrimaryButton` "马上抽"
- **States**：
  - normal · 未达上限
  - capped · 已到 30 · 不再发放：文案改 "库存已满 · 先抽一点"
- **Mock**：`src/mock/economy.ts · FREE_PULL_GRANTS`
- **Nav**：马上抽 → DrawIntro · 之后 → 原屏

#### S8-6 · FreePullInventorySheet
- **Route**：`FreePullInventorySheet`
- **Purpose**：展示当前免费抽库存 + 最近获得来源
- **Props**：无
- **Key components**：`BottomSheet` · `CountBig` · `RecentGrantsList`
- **States**：
  - normal · >0
  - empty · 0：文案 "暂无库存 · 保持 streak 就会发"
- **Mock**：`src/mock/economy.ts · INVENTORY_VIEW`
- **Nav**：close

#### S8-7 · DailyDigestModal（每日推送点进来 · 第一屏）
- **Route**：`DailyDigest`
- **Purpose**：从 push notification 进来时 · 展示今日 dose · 直接开学或查看
- **Props**：`{ fromPush: boolean }`
- **Key components**：`DigestHero`（问候 + 今日 N 张 · 预计 M 分钟）· `CardStripCompact` · `DualCTA`（开学 / 稍后）
- **States**：
  - normal
  - empty · 今日 0：文案 "今日已清 · 要不要多抽一张？"
- **Mock**：`src/mock/daily.ts · DIGEST_BY_DAY`
- **Nav**：开学 → LevelIntro · 稍后 → Home

#### S8-8 · WeekPlannerPrompt（周日晚 8 pm 触发）
- **Route**：`WeekPlannerPrompt`
- **Purpose**：主动问用户下周想学多少 · 设 week goal
- **Props**：无
- **Key components**：`GoalSlider`（5-50 张/周）· `Preview`（你去年同期平均 N）· `PrimaryButton`
- **States**：
  - normal
  - skipped：5 天内不再提示
- **Mock**：`src/mock/plan.ts · WEEK_GOAL_DEFAULTS`
- **Nav**：save → Home · skip → Home

#### S8-9 · MonthRewindModal（每月最后一晚自动 · 类似 Spotify Wrapped）
- **Route**：`MonthRewind`
- **Purpose**：月末庆祝 · 本月关键数字 + 高光时刻
- **Props**：`{ month: string }`
- **Key components**：`RewindHeroSlides`（5 页：Owned 总 · Mastered 总 · 最长 streak · 高光卡 · 来月展望）
- **States**：
  - normal：滑动 5 页
  - reduceMotion：静态分屏
- **Mock**：`src/mock/month.ts · REWIND_SLIDES`
- **Nav**：close → Home

### 4.9 Cluster 9 · Recovery（4 屏 · 处理遗忘 / 掉队 / 回流）

#### S9-1 · BacklogWarning
- **Route**：`BacklogWarning`（modal · 累计 >20 张 due 未复习时 Home 进入自动弹）
- **Purpose**：温和告知 backlog 很重 · 给 3 方案（一次清 / 分 3 天 / 降低目标）
- **Props**：`{ backlogCount: number }`
- **Key components**：`BacklogHero`（羊皮纸 · 非红字 · "积累了 N 张 · 不急"）· `ActionChoice × 3`
- **States**：
  - normal · 20-50 张：中度提示
  - heavy · >50 张：加多一行 "也可以 Fresh Start"
- **Mock**：`src/mock/recovery.ts · BACKLOG_FIXTURES`
- **Nav**：一次清 → LevelIntro(all) · 分 3 天 → 写计划 → Home · 降目标 → WeekPlannerPrompt

#### S9-2 · BacklogBurstSession（一次清的专用 session · 改造版 LevelIntro）
- **Route**：`BacklogBurst`
- **Purpose**：比普通 session 更长 · UI 加"第 X/Y 张 · 还剩 ~M 分钟"倒计时
- **Props**：`{ cards: Card[] }`
- **Key components**：`LevelStageQ/A/IRL`（复用 · 加 progress bar）· `BurstProgressBar`
- **States**：同 Level 流
- **Mock**：`src/mock/recovery.ts · BURST_SESSION`
- **Nav**：完成 → Settlement

#### S9-3 · FreshStartConfirmSheet（深度确认 · 与 S2-7 FreshStartPrompt 不同 · 这是点击"重新开始"后的二次确认）
- **Route**：`FreshStartConfirmSheet`（bottomSheet）
- **Purpose**：把"要清除的内容"列清楚 · 防止误点
- **Props**：`{ summary: FreshStartSummary }`
- **Key components**：`BottomSheet` · `DiffList`（保留：收藏卡 N · 清除：schedule · streak · milestones）· `DestructiveButton`（红字 · "确定重置"）· `GhostCancel`
- **States**：
  - normal
  - confirming：点击后 3s 倒数 · 可取消
- **Mock**：`src/mock/recovery.ts · FRESH_START_SUMMARY`
- **Nav**：确定 → 写 AsyncStorage → Home · 取消 → dismiss

#### S9-4 · DormantNudgeModal（用户 3 天未登录 · 下次打开自动弹）
- **Route**：`DormantNudge`
- **Purpose**：温和欢迎 · 不施压 · 展示最后一次的进度 + 1 键继续
- **Props**：无
- **Key components**：`NudgeHero`（欢迎回来 + 离开天数）· `LastSessionSummary` · `PrimaryButton` "继续"
- **States**：
  - normal · 3-6 天
  - long · 7+ 天：文案改 "好久不见 · 想不想 Fresh Start?" + 二选一
- **Mock**：`src/mock/recovery.ts · DORMANT_FIXTURES`
- **Nav**：继续 → Home · FreshStart → FreshStartPrompt

### 4.10 Cluster 10 · Profile / Settings / Error / Misc（18 屏）

#### S10-1 · MoreTab
- **Route**：`More`（TabNav 第 4 个 tab · 内含 9 行 menu）
- **Purpose**：进入 Profile / Milestone Hall / Settings / About
- **Key components**：`MenuRow × 9`
- **States**：normal
- **Mock**：无
- **Nav**：各 row → 各子屏

#### S10-2 · ProfileHome
- **Route**：`Profile`
- **Purpose**：用户概况 · avatar / nickname / audience / 加入日 / 总学习时长
- **Props**：无
- **Key components**：`ProfileHero` · `LifetimeStats` · `EditProfileButton`
- **States**：
  - normal · 匿名：nickname 默认 "学习者 #{deviceId 后 4 位}"
  - linked：顶部显示 "Apple 账号已关联"
- **Mock**：`src/mock/user.ts · PROFILE`
- **Nav**：Edit → EditProfile · avatar 点击 → AvatarPicker

#### S10-3 · EditProfile
- **Route**：`EditProfile`
- **Purpose**：修改 nickname · 选择 avatar · 重设 audience
- **Props**：无
- **Key components**：`TextInput` · `AvatarPickerGrid`（12 预设 · v1 不支持上传）· `AudiencePicker`
- **States**：
  - normal
  - error · nickname 空：inline error "昵称不能为空"
  - success：保存后 toast "已保存" → 返回 Profile
- **Mock**：`src/mock/user.ts · PROFILE_EDIT`
- **Nav**：save → Profile

#### S10-4 · SettingsHome
- **Route**：`Settings`
- **Purpose**：设置主屏 · 分 5 组：Audience · Notifications · Pools · Appearance · Account
- **Key components**：`SettingsSection × 5`
- **States**：normal
- **Mock**：`src/mock/settings.ts · SETTINGS_SNAPSHOT`
- **Nav**：各 row → 各子屏

#### S10-5 · SettingsAudience
- **Route**：`SettingsAudience`
- **Purpose**：修改全局 audience（level + role）· 即时生效
- **Key components**：`LevelPicker` · `RolePicker` · `PreviewCard`（右侧实时展示样卡 audience badge 变化）
- **States**：
  - normal
  - success：自动保存 · toast "已更新"
- **Mock**：`src/mock/settings.ts`
- **Nav**：back

#### S10-6 · SettingsNotifications
- **Route**：`SettingsNotifications`
- **Purpose**：开关 daily push + 时间选择 + quiet hours
- **Key components**：`Switch` · `TimePicker` · `QuietHoursRange`
- **States**：
  - normal
  - permissionDenied：开关灰 + "系统已关 · 前往系统设置" CTA
- **Mock**：同上
- **Nav**：back

#### S10-7 · SettingsPools
- **Route**：`SettingsPools`
- **Purpose**：每池的开关（active / paused）+ 查看池信息
- **Key components**：`PoolSettingsRow × N`
- **States**：
  - normal · 单池：只 1 行
  - dual：2 行
- **Mock**：同上
- **Nav**：tap row → PausedPool 或 PoolOverview

#### S10-8 · SettingsAppearance
- **Route**：`SettingsAppearance`
- **Purpose**：羊皮纸/Cosmic 主题 · Library 卡面密度（Compact / Standard · v1 只做 Standard · Compact 置灰）· 字体缩放（跟随系统）
- **Key components**：`ThemePicker` · `DensitySelector` · `InfoNote`
- **States**：
  - normal
  - v1 limitation：Compact 灰 + "v2 上线"
- **Mock**：同上
- **Nav**：back

#### S10-9 · SettingsAccount
- **Route**：`SettingsAccount`
- **Purpose**：关联 Apple / Google · 数据导出 · 删除账号
- **Key components**：`LinkProviderRow × 2`（Apple · Google）· `ExportDataButton` · `DeleteAccountButton`（红字）
- **States**：
  - normal · 未关联
  - linked · 已关联：显示关联账号
  - exporting：loading + toast "导出中"
  - deleting：confirm sheet → 3s 倒数
- **Mock**：同上
- **Nav**：delete → DeleteAccountConfirm

#### S10-10 · DeleteAccountConfirmSheet
- **Route**：`DeleteAccountConfirm`
- **Purpose**：极度明确的破坏性二次确认 · 展示要删除的全部数据
- **Key components**：`BottomSheet` · `DeletionSummary`（卡 N · streak · milestones · 总学习时间）· `TypeToConfirm`（输入 "DELETE" 解锁按钮）· `DestructiveButton`
- **States**：
  - normal · 按钮灰
  - typed · 解锁：按钮变红可点
- **Mock**：`src/mock/settings.ts · DELETE_PREVIEW`
- **Nav**：确定 → 清 AsyncStorage → Splash

#### S10-11 · About
- **Route**：`About`
- **Purpose**：版本号 / 开源许可 / 致谢
- **Key components**：`AboutList`
- **States**：normal
- **Mock**：无
- **Nav**：back

#### S10-12 · HelpFAQ
- **Route**：`HelpFAQ`
- **Purpose**：FAQ 列表（约 15 条 · 从 v5 用户疑问里总结）
- **Key components**：`FAQAccordion`
- **States**：normal
- **Mock**：`src/mock/faq.ts · FAQ_LIST`
- **Nav**：back · 每条 accordion 展开

#### S10-13 · ErrorNetworkScreen
- **Route**：`ErrorNetwork`（全屏 · 仅 hard offline 时 · v1 mock 不触发 · 留桩）
- **Purpose**：极端情况展示 · 给 retry 按钮
- **Key components**：`ErrorHero`（羊皮纸 · 温和文案 · 非红色 · "好像离线了"）· `RetryButton`
- **States**：
  - normal · 重试 3 次失败：显示"找客服" link（v2）
- **Mock**：无
- **Nav**：retry → 前一屏

#### S10-14 · ErrorGenericScreen
- **Route**：`ErrorGeneric`
- **Purpose**：兜底错误屏 · 未归类的崩溃
- **Key components**：`ErrorHero` · `ReportButton`（v2）
- **States**：normal
- **Mock**：无
- **Nav**：back

#### S10-15 · ToastHost（全局 · 非独立屏 · 列为 S10-15 是为了在 §8 状态矩阵统计）
- **Route**：无路由
- **Purpose**：全局 toast 容器 · 4 级（info / success / warn / error）
- **Key components**：`Toast` · `ToastQueue`
- **States**：
  - info：灰 · 3s
  - success：mint · 2s
  - warn：amber · 3s
  - error：nothingRed · 4s
- **Mock**：`src/mock/toast.ts · TOAST_FIXTURES`
- **Nav**：无

#### S10-16 · CoachOverlayHost（全局）
- **Route**：无路由
- **Purpose**：首次引导蒙层 · 各屏首次访问时逐步教学
- **Key components**：`CoachOverlay` · `CoachStepQueue`
- **States**：
  - showing：当前 step
  - done：本屏 seen 写 AsyncStorage
- **Mock**：`src/mock/coach.ts · COACH_STEPS`
- **Nav**：无

#### S10-17 · OfflineBanner（全局 · 顶部 thin bar）
- **Route**：无路由
- **Purpose**：离线时顶部 banner · 不阻塞交互
- **Key components**：`OfflineBanner`
- **States**：
  - online：隐藏
  - offline：羊皮纸橙条 + "离线 · 数据会在联网后同步"
- **Mock**：v1 假装永远 online
- **Nav**：无

#### S10-18 · DebugMenu（只在 dev build · TestFlight 屏蔽）
- **Route**：`DebugMenu`（10 下点击 About 版本号解锁）
- **Purpose**：QA 快速切换 user state / mock 场景 / 清 AsyncStorage
- **Key components**：`DebugActions`
- **States**：dev-only
- **Mock**：`src/mock/debug.ts`
- **Nav**：action → 对应 mock reset

---

## 5. Mock 数据层（`src/mock/*.ts`）

> **原则**：v1 所有数据从 mock 读 / 写 · 后端接口同形（`Promise<T>` 返回）· v1.1 换 real API 只改 `src/api/*.ts` 一层 · 屏幕无感。

### 5.1 目录结构

```
src/mock/
├── index.ts              // 统一 export · MSW 式拦截（可选）
├── types.ts              // 所有 TS 类型
├── user.ts               // 用户 / profile / audience / fresh start
├── pools.ts              // 池 metadata / pool overview / pool states
├── cards.ts              // 卡片内容（115 C# + 60 AWS = 175 张）
├── fsrs.ts               // rate() · schedule · leech detect · demote
├── draw.ts               // 抽卡概率 / 10 连保底算法 / 结果生成
├── home.ts               // Home snapshot（5 天档）
├── library.ts            // library snapshot / tag breakdown / filter meta
├── plan.ts               // daily / weekly / monthly plan
├── daily.ts              // 每日 digest / dose
├── week.ts               // 周 summary
├── month.ts              // 月 summary / rewind
├── milestones.ts         // collection / mastery / streak milestones
├── economy.ts            // free pull inventory / grants
├── settlement.ts         // session settlement
├── session.ts            // session builder
├── recovery.ts           // backlog / fresh start / dormant
├── settings.ts           // settings snapshot
├── toast.ts              // toast fixtures
├── coach.ts              // coach overlay steps
├── faq.ts                // FAQ 15 条
├── events.ts             // pool launch event
└── debug.ts              // dev-only mock reset
```

### 5.2 核心类型（`types.ts`）

```typescript
export type Rarity = 'com' | 'rar' | 'leg';
export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type UserState = 'new' | 'active' | 'dormant' | 'paused' | 'churned';
export type CardState = 'new' | 'learning' | 'review' | 'mastered' | 'demoted' | 'buried' | 'leech';
export type PoolId = 'csharp-net' | 'aws-saa';

export interface Audience {
  level: 'junior' | 'mid' | 'senior';
  role: 'backend' | 'frontend' | 'fullstack';
}

export interface Card {
  id: string;
  poolId: PoolId;
  tag: string;
  keyword: string;
  rarity: Rarity;
  stars: 1 | 2 | 3 | 4 | 5;
  audience: Audience[];
  content: {
    definition: string;
    points: string[];
    code?: string;
    irlPrompt: string;
    irlHint?: string;
  };
}

export interface CardProgress {
  cardId: string;
  state: CardState;
  rating: { again: number; hard: number; good: number; easy: number };
  consecutiveHard: number;
  totalAgain: number;
  lastReviewAt: number | null;
  nextDueAt: number | null;
  intervalDays: number;
  ease: number;
  masteryCount: number;
  buriedUntil?: number;
}

export interface Pool {
  id: PoolId;
  name: string;
  totalCards: number;
  launchedAt: number;
  state: 'active' | 'paused' | 'locked';
}

export interface UserProfile {
  deviceId: string;
  nickname: string;
  avatar: string;
  audience: Audience;
  joinedAt: number;
  state: UserState;
  dailyStreak: number;
  weekStreak: number;
  lastActiveAt: number;
  freePullInventory: number;
}

export interface DrawResult {
  poolId: PoolId;
  cards: Card[];
  pityTriggered: boolean;
  pityRarity?: Rarity;
  cost: { freePull: 1 } | { gems: number };
}

export interface Session {
  id: string;
  poolId: PoolId;
  cards: Card[];
  mode: 'new' | 'review' | 'mixed' | 'backlogBurst';
  startedAt: number;
  endedAt?: number;
  results: Array<{ cardId: string; rating: Rating; elapsedMs: number }>;
}

export interface Milestone {
  id: string;
  type: 'collection' | 'mastery' | 'streakDaily' | 'streakWeekly';
  poolId?: PoolId;
  tier: string;
  unlockedAt: number | null;
  reward: { freePull?: number };
}
```

### 5.3 关键 mock 实现（节选 · FE 参考签名）

```typescript
// src/mock/draw.ts
export async function mockDraw10(poolId: PoolId): Promise<DrawResult> {
  // 1. 滚 10 次 · 每次按 [0.70 / 0.27 / 0.03] 抽稀有度
  // 2. 最后 1 张检测保底：若 10 连中无 RAR+ · 把最后 1 张升级为 RAR（读 pity 计数）
  // 3. 按稀有度从 cards.ts 按 tag × audience 过滤后抽样
  // 4. 写 user.ownedCardIds · 返回 DrawResult
}

// src/mock/fsrs.ts
export function rate(cardId: string, rating: Rating): CardProgress {
  // 1. 读当前 progress
  // 2. 按 intervals table 更新 intervalDays / nextDueAt
  //    Again  → reset intervalDays = 0.01（10min · 回 new 队列）
  //    Hard   → intervalDays * 1.2（min 1d）
  //    Good   → intervalDays * ease（min 2d）
  //    Easy   → intervalDays * ease * 1.3（min 4d）
  // 3. 更新 rating 计数
  // 4. 检测 leech：consecutiveHard >= 3 || totalAgain >= 5 → state = 'leech'
  // 5. 检测 demote：本 session 内 3 次 again → state = 'demoted' · reset 所有进度
  // 6. 检测 mastery：rating.good + rating.easy >= threshold（COM 5 / RAR 4 / LEG 2）→ state = 'mastered'
}

// src/mock/home.ts
export const HOME_SNAPSHOTS = {
  day1: { /* 10 owned · 0 mastered · streak 1 */ },
  day3: { /* 30 owned · 2 mastered · streak 3 */ },
  day7: { /* 50 owned · 8 mastered · streak 7 */ },
  day15: { /* 80 owned · 20 mastered · streak 14 · pool 2 just launched */ },
  day30: { /* 110 owned · 45 mastered · streak 28 · weekStreak 4 */ },
};

// src/mock/cards.ts
export const CARDS_CSHARP: Card[] = [/* 115 张 · 14 tag 分布 */];
export const CARDS_AWS: Card[] = [/* 60 张 · 14 AWS tag */];
```

### 5.4 Mock 场景切换（DebugMenu）

- **新手 Day1**：刚 onboard · 0 抽
- **正常 Day7**：单池 50 cards
- **双池 Day15**：pool launch 当日
- **长线 Day30**：双池 · streak 28
- **流失候选 Day-3-inactive**：3 天未登录 · 弹 DormantNudge
- **重度 backlog**：>50 due
- **Churned 返场**：9 天未登录 · 弹 FreshStart

切换方式：`DebugMenu → Load Scenario → 重启 app`

---

## 6. 组件库（`src/components/*` · 40 个组件 · RN + TS 签名）

### 6.1 Atoms（原子组件 · 10 个）

```typescript
// Button.tsx
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size: 'large' | 'medium' | 'small';
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}

// Badge.tsx
interface BadgeProps {
  label: string;
  variant: 'mint' | 'amber' | 'gold' | 'cosmic' | 'muted';
  size?: 'sm' | 'md';
}

// ProgressBar.tsx
interface ProgressBarProps {
  value: number;       // 0-1
  height?: number;
  color?: string;
  bgColor?: string;
}

// Star.tsx · StarRow.tsx · RarityBorder.tsx · TagPill.tsx · Chip.tsx · Switch.tsx · Divider.tsx
```

### 6.2 Molecules（分子组件 · 14 个）

```typescript
// CardFace.tsx - 大卡面（抽卡结果 + CardDetail）
interface CardFaceProps { card: Card; size: 'large' | 'medium'; showMastery?: boolean; }

// CardSmall.tsx - Library 3 列小卡
interface CardSmallProps { card: Card; progress?: CardProgress; onPress: () => void; }

// CardMiniRow.tsx - PlanToday 横排 mini
// StatRing.tsx - Home 3 ring
// StatTriRow.tsx - Home 3 ring 组
// DoubleStreak.tsx - 🔥Daily + 🔥Wk
// PityBar.tsx - 保底进度
// MilestoneTrack.tsx - Collection / Mastery 进度带
// BottomSheet.tsx - 通用底弹
// CoachOverlay.tsx - 首次引导蒙层
// Toast.tsx - Toast 组件
// RatingButton.tsx - Again/Hard/Good/Easy 单键
// CodeBlock.tsx - VSCode 主题代码块
// AudiencePicker.tsx - Level × Role 选择器
```

### 6.3 Organisms（有机体组件 · 10 个）

```typescript
// HomeStats.tsx - Home 顶部统计区（三环 + streak + 免费抽 chip）
// DrawCTA.tsx - 主 CTA 区
// LevelStage.tsx - 共用 Stage 壳（Q/A/IRL 切换）
// SettlementHero.tsx - 结算 hero
// CardGrid3Col.tsx - Library 3 列 grid
// CardGrid2x5.tsx - Draw Result 2×5
// PoolStatRings.tsx - PoolOverview 4 环
// MilestoneHallGrid.tsx - 徽章墙
// SessionBody.tsx - Level session 主体（含 progress bar + stage 切换）
// SettingsSection.tsx - 设置分组 row 容器
```

### 6.4 Templates / Screens（页面级 6 个）

直接对应 §4 cluster 模板：
`AuthTemplate` · `HomeTemplate` · `LibraryTemplate` · `LevelTemplate` · `SettlementTemplate` · `SettingsTemplate`

---

## 7. 动画规格（Reanimated 3 · 按屏列出时长 / 曲线）

| 屏幕 | 动画 | 时长（normal / reduceMotion） | 曲线 |
|---|---|---|---|
| Splash | logo fade-in | 800 / 400 | ease-out |
| Welcome | 页间 swipe | 300 | ease-in-out |
| DrawIntro | PityBar 脉动 | 2000 loop | ease-in-out |
| DrawAnimation | Cosmic 全流程 | 2200 / 800 | custom（见 §7.1） |
| DrawResult | 卡片依次 scale-in | 每卡 120 · 错峰 80 | spring(0.8, 10) |
| LevelStageQ | Keyword 打字机 | 600 / 0 | decel |
| LevelStageA | Code fade-in | 400 | ease-out |
| RatingButton | tap scale | 120 | spring |
| SessionSettlement | 数字 tick | 1000 | ease-out |
| MasteredCelebration | 💎 印章盖下 | 1200 / 500 | bounce |
| CollectionMilestone | 徽章弹出 + 光效 | 1800 / 800 | spring + custom |
| StreakMilestone | 火焰粒子 | 1500 / 500 | custom（粒子系统） |
| PoolLaunchCelebration | Cosmic 粒子 | 2200 / 800 | custom |
| MonthRewind | 5 页依次 slide | 每页 800 | ease-in-out |
| BacklogWarning | Hero 缓入 | 400 | ease-out |

### 7.1 Cosmic Ceremony 细节（DrawAnimation / PoolLaunch）

```typescript
// 阶段 1 · 0-400ms · 深蓝背景浮现 + 粒子从底部升起
// 阶段 2 · 400-1000ms · 中心出现金光旋涡
// 阶段 3 · 1000-1600ms · 10 张卡从旋涡甩出（stagger 60ms）
// 阶段 4 · 1600-2000ms · 稀有度闪光（LEG 有额外金色 burst）
// 阶段 5 · 2000-2200ms · 淡出 · 转 DrawResult
//
// reduceMotion：阶段 1+5 保留 · 中间跳过 · 总长 800ms
```

### 7.2 a11y 注意

- 所有动画尊重系统 Reduce Motion（`AccessibilityInfo.isReduceMotionEnabled()`）
- 动画期间文本始终可读（不在文本上加 blur）
- 无关键信息只通过颜色传达（加 icon / 文字辅助）

---

## 8. 成功 / 错误 / 空态矩阵（70 屏 × 关键状态）

> **约定**：每屏至少要实现的状态 = normal + 至少 2 个其他（empty / error / success / loading / edge）。

### 8.1 全局状态类别

| 代码 | 含义 | 典型文案（羊皮纸温度） |
|---|---|---|
| `OK` | normal 正常 | （无文案） |
| `EMP` | empty 空态 | "还没有 · 试试 ..." |
| `LD` | loading 加载 | 顶部细线 loader |
| `ERR_NET` | 网络错误 | "好像离线了 · 重试" |
| `ERR_SRV` | 服务错误 | "出了点问题 · 再试一次" |
| `ERR_INPUT` | 输入错误 | inline · 羊皮纸橙字 |
| `SUCC` | 成功 toast | mint 2s |
| `EDGE` | 边缘态 | 各屏详见 §4 |
| `PERM` | 权限拒绝 | "系统已关 · 去设置" |
| `COOLDOWN` | 冷却中 | "5 天内已展示 · 跳过" |

### 8.2 覆盖率 checklist（节选 · 完整见附录）

| Cluster | OK | EMP | ERR | EDGE | 小计 |
|---|---|---|---|---|---|
| 1 · Auth | 5 | 2 | 3 | 1 | 5 屏 |
| 2 · Home | 8 | 5 | 3 | 4 | 8 屏 |
| 3 · Draw | 5 | 0 | 2 | 3 | 5 屏 |
| 4 · Level | 7 | 1 | 2 | 4 | 7 屏 |
| 5 · Settlement | 4 | 0 | 1 | 3 | 4 屏 |
| 6 · Library | 6 | 3 | 2 | 2 | 6 屏 |
| 7 · Plan | 4 | 2 | 1 | 2 | 4 屏 |
| 8 · Milestone | 9 | 2 | 1 | 5 | 9 屏 |
| 9 · Recovery | 4 | 0 | 1 | 3 | 4 屏 |
| 10 · Profile/Settings/Err | 18 | 3 | 6 | 6 | 18 屏 |
| **Total** | **70** | **18** | **22** | **33** | **70** |

**FE 验收标准**：每屏 implement 所有"√"标记的状态 · QA 在 DebugMenu 切场景逐一验收。

### 8.3 错误文案表（统一措辞 · FE 直接用）

| code | 文案 | 按钮 |
|---|---|---|
| `ERR_NET_COLD` | "好像离线了 · 数据会在联网后同步" | 重试 |
| `ERR_SRV_500` | "出了点问题 · 稍等一下" | 重试 |
| `ERR_VALIDATION_EMPTY` | "这里不能留空" | （inline） |
| `ERR_LIMIT_PULL` | "每日抽卡额度已用完 · 明天再来"（v1 不启用） | 好 |
| `ERR_DUP_ACCOUNT` | "这个账号已关联到另一台设备" | 切换 / 取消 |
| `ERR_FS_FULL` | "存储空间不足 · 清理后重试" | 去设置 |

---

## 9. 分阶段交付计划（5 Phases · 每 Phase 可运行 · 可独立验收）

### Phase 1 · Skeleton + Theme + Navigation（1 周 · 屏幕 5/70）

**目标**：跑起来一个空 RN app · 导航结构 + 主题 + Splash/Welcome

**交付**：
- `src/theme/*.ts` 全套 tokens（colors / typography / spacing / animation / a11y）
- React Navigation 全结构（AuthStack + MainStack + TabNav · 所有屏幕壳空白）
- S1-1 Splash · S1-2 Welcome · S1-3 AudienceSurvey（5 屏 UI 完整）
- `src/mock/user.ts` + `src/mock/types.ts`
- Zustand store 骨架（user slice · pool slice · session slice · ui slice）
- i18n 搭建（中英文 · v1 先中文）

**验收**：能从 Splash 走到 Home（空白占位）· 选 audience 能保存

### Phase 2 · Home + Plan + Mock 经济（1.5 周 · 屏幕 20/70）

**目标**：Home + Plan tab + 抽卡前状态展示（不含动画）· mock 经济跑起来

**交付**：
- Cluster 2 全部 8 屏（Home · PoolPicker · DailyDose · WeekSummary · MonthSummary · PoolLaunch · FreshStart · PausedPool）
- Cluster 7 全部 4 屏（PlanHome · PlanToday · PlanWeek · PlanMonth）
- Cluster 8 部分：S8-1 MilestoneHall · S8-2 MilestoneDetail（静态展示 · 无动画）
- S10-1 MoreTab（入口齐全）
- `src/mock/home.ts · pools.ts · plan.ts · milestones.ts · economy.ts`
- Atoms + Molecules 大部分组件

**验收**：能看到 Home 三环 · streak · pool 切换 · plan 三档切换

### Phase 3 · Draw + Animations + FSRS（2 周 · 屏幕 35/70）

**目标**：抽卡全流程 · Cosmic 动画 · FSRS rate 核心

**交付**：
- Cluster 3 全部 5 屏（DrawIntro · DrawAnimation · DrawResult · CardDetailModal · PityToast）
- Cluster 4 全部 7 屏（LevelIntro · StageQ · StageA · StageIRL · RatingBar · LeechWarning · DemoteToast）
- Cluster 5 前 2 屏（Settlement · MasteredCelebration）
- `src/mock/draw.ts · fsrs.ts · cards.ts（至少 30 张 seed · 后续补齐）· session.ts · settlement.ts`
- Reanimated 3 · Cosmic Ceremony 动画
- a11y：Reduce Motion 生效

**验收**：能完整抽 10 连 → 进 session → rate 4 类 → 结算 · 动画流畅 · a11y 切换有效

### Phase 4 · Level + Settlement + Milestones 完整（1.5 周 · 屏幕 48/70）

**目标**：结算 + milestone 体系完整 · 所有 ceremony 上线

**交付**：
- Cluster 5 剩余 2 屏（CollectionMilestone · MasteryMilestone）
- Cluster 8 全部 9 屏（Hall · Detail · Streak/WeekStreak milestones · FreePull grant/inventory · DailyDigest · WeekPlanner · MonthRewind）
- Cluster 9 全部 4 屏（Backlog · BurstSession · FreshStartConfirm · DormantNudge）
- 测试：7 用户 30 天 mock 场景跑通 · DebugMenu 完成

**验收**：7 用户场景（A-G）都能在 DebugMenu 里 load 并走完

### Phase 5 · Library + Profile + Settings + Errors（2 周 · 屏幕 70/70）

**目标**：补齐所有剩余屏 · 全产品完整 · 可提测

**交付**：
- Cluster 6 全部 6 屏（LibraryHome · SortFilter · CardDetailFull · PoolOverview · TagExplorer · AudienceFilter）
- Cluster 10 全部 18 屏（More · Profile · EditProfile · Settings 5 子屏 · DeleteConfirm · About · FAQ · ErrorNetwork · ErrorGeneric · ToastHost · CoachOverlay · OfflineBanner · DebugMenu）
- 所有 §8 错误 / 空态实现
- 卡片数据补齐（C# 115 + AWS 60 = 175 张）
- E2E 测试：7 用户 × 30 天场景全覆盖
- a11y 完整 sign-off（VoiceOver / Dynamic Type / Reduce Motion）

**验收**：
- 所有 70 屏可访问
- 所有状态可通过 DebugMenu 复现
- 通过 3 PM 最终签字（§10）
- TestFlight beta 发布候选

### Phase 总览

| Phase | 周 | 累计屏 | 关键里程碑 |
|---|---|---|---|
| P1 | 1 | 5 | 骨架跑通 |
| P2 | 1.5 | 20 | Home 可看 |
| P3 | 2 | 35 | 抽卡 + 学习可玩 |
| P4 | 1.5 | 48 | milestone 完整 |
| P5 | 2 | 70 | 产品完整 · 可提测 |
| **总计** | **8 周** | **70** | v1 MVP 完整 |

---

## 10. 3 PM 最终签字页 + 一致性 Checklist

### 10.1 PM 签字（全部 Yes 才进 Phase 1）

| PM | 关注域 | v6 是否满足 | 备注 |
|---|---|---|---|
| **PM1 · 张经理** | FSRS 正确性 | ✅ | Again 10min · Hard ×1.2 · Good ×ease · Easy ×1.3 · 匹配 v5.3 §13 #4 |
| PM1 | 抽卡保底 | ✅ | 10 连中无 RAR+ 则最后 1 张强制 RAR · pool-scoped pity |
| PM1 | Mastery 定义 | ✅ | COM 5 / RAR 4 / LEG 2 · 累计 good+easy · 与 v5 一致 |
| PM1 | 多池架构 | ✅ | pool-scoped 的 pity / collection / mastery · global 的 streak / free pull |
| **PM2 · 李经理** | 情绪文案 | ✅ | 全文无"失败/丢失/破坏"· amber 不 red · 羊皮纸暖色系 |
| PM2 | 空态 CTA | ✅ | 每个 empty 都给下一步（18 个空态已覆盖） |
| PM2 | a11y | ✅ | Reduce Motion · Dynamic Type · VoiceOver 完整支持 |
| PM2 | 极端用例 | ✅ | Churned / Dormant / BacklogHeavy / Leech / Demote 都有屏 |
| **PM3 · 王经理** | RN 可行性 | ✅ | 所有动画 Reanimated 3 可做 · 无原生桥接 |
| PM3 | v1 scope 纪律 | ✅ | §1.3 明确 6 项推迟 v2（Binge / Mindful / Mastery Hall 编辑 / Pool-specific Audience / 多语言 / Social） |
| PM3 | 上线风险 | ✅ | Mock-first · 无后端依赖 · 8 周可出 TestFlight |
| PM3 | 测试覆盖 | ✅ | 7 用户 × 30 天场景 + DebugMenu 场景切换 |

### 10.2 一致性 Checklist（FE 开工前过一遍）

- [ ] 所有色值只从 `src/theme/colors.ts` 引用 · 无 hardcode
- [ ] 所有字号只从 `typography.sizes` 引用
- [ ] 所有间距只从 `spacing` 引用
- [ ] 所有动画时长只从 `animation.durations` 引用
- [ ] 所有 Touchable 最小 44×44（iOS HIG）
- [ ] 所有文案进 i18n 文件 · 不 hardcode 中文
- [ ] 所有错误文案对照 §8.3
- [ ] 所有 modal 有 Esc / swipe-down 关闭
- [ ] 所有破坏性操作有二次确认
- [ ] 所有 ceremony 尊重 Reduce Motion

### 10.3 a11y sign-off（上线前）

- [ ] VoiceOver：所有 Touchable 有 `accessibilityLabel`
- [ ] Dynamic Type：支持到 XXL（1.5× scale）· 超 1.5× 用 `maxFontScale`
- [ ] 色对比：所有文本 ≥ WCAG AA（4.5:1）
- [ ] Reduce Motion：所有 >500ms 动画自动缩短至 40%
- [ ] 键盘（iPad · v1 non-goal · 但 input 至少支持返回键 dismiss）

### 10.4 RN 技术可行性 sign-off

- [ ] Expo SDK 54 支持的 API 内完成所有动画
- [ ] 无需 eject · 无自定义 native module
- [ ] Push 用 `expo-notifications`（v1 本地推送即可）
- [ ] AsyncStorage（v1 持久化）+ mmkv（v2 换）
- [ ] i18n 用 `i18n-js`
- [ ] 图标用 `@expo/vector-icons` + 自定义 SVG
- [ ] Fonts 用 `expo-font`（Inter · JetBrainsMono）

---

## 11. v6 修订日志

| 版本 | 日期 | 主要变更 |
|---|---|---|
| **v6.0** | 2026-04-22 | 首次把 v5.3 所有问题落地到 RN 实现 PRD · 70 Screen 目录 · 5 Phase 交付 · 3 PM 签字 |
| v5.3 | 2026-04-21 | 7 用户 × 30 天模拟 + pool 扩展（AWS SAA · Day-15 解锁） |
| v5.2 | 2026-04-20 | Library 3 列 revert · 用户 A Day-3→Day-7 · 用户 B 边缘情况 · 12 条设计反思 |
| v5.1 | 2026-04-19 | 首版 storyboard |

### 11.1 v5 → v6 11 项关键变更

1. **Streak 作用域**：Global Daily + 新增 Weekly（解决 User E 周末型）
2. **Free Pull 机制**：cap-30 · 无时间过期 · v2 再做衰减
3. **Audience Filter**：Settings 全局 · 非 per-pool（pool-specific 推迟 v2）
4. **Fresh Start**：≥7 天自动 prompt · Settings 手动入口
5. **Milestones 双轨**：Collection（Bronze/Silver/Gold/Complete）+ Mastery（Junior/Journey/Senior/Diamond）独立
6. **Audience Badge**：从卡面移除 · 仅在 Stage Q 显示小型 badge
7. **Auth 系统**：Device ID 匿名 + optional Apple/Google · 非强制注册
8. **多池 Daily Dose**：每池独立推送 · 每池首次激活触发自己的 Daily Dose
9. **Demote 机制**：显式 toast + CardDetail 顶部提示 · 非静默（v5 静默用户不知）
10. **Cooldown**：同池同轨 milestone 5 天内不重弹（避免 E 档用户疲劳）
11. **Mock-first**：所有数据从 `src/mock/*.ts`· 后端对齐推迟到 v7

### 11.2 推迟到 v2 清单

- Binge batch rating（批量快速过卡）
- Mindful minute streak（冥想式学习）
- Mastery Hall 编辑（自定义 Hall 卡片展示）
- Pool-specific Audience（per-pool 不同 level/role）
- 多语言（仅中文 · 英文 v2）
- Social sharing（微信 / Twitter 分享月报）
- 付费 gems 抽卡（v1 mock 无限 · v2 接 IAP）
- 云同步（v1 仅本地 AsyncStorage · v2 接后端）

---

## 12. 附录

### 12.1 70 屏速查表

| Cluster | 屏数 | ID 范围 | 关键屏 |
|---|---|---|---|
| 1 · Auth/Onboarding | 5 | S1-1 ~ S1-5 | Splash · AudienceSurvey |
| 2 · Home | 8 | S2-1 ~ S2-8 | Home · PoolLaunch · FreshStart |
| 3 · Draw | 5 | S3-1 ~ S3-5 | DrawIntro · Animation · Result |
| 4 · Level | 7 | S4-1 ~ S4-7 | Stage Q/A/IRL · Leech · Demote |
| 5 · Settlement | 4 | S5-1 ~ S5-4 | Settlement · Mastered · Milestones ×2 |
| 6 · Library/Pool | 6 | S6-1 ~ S6-6 | Library · CardDetailFull · PoolOverview |
| 7 · Plan | 4 | S7-1 ~ S7-4 | PlanHome · Today/Week/Month |
| 8 · Milestone/Summary | 9 | S8-1 ~ S8-9 | Hall · Streak · FreePull · Rewind |
| 9 · Recovery | 4 | S9-1 ~ S9-4 | Backlog · Burst · FreshStartConfirm · Dormant |
| 10 · Profile/Settings/Err | 18 | S10-1 ~ S10-18 | More · Profile · Settings ×6 · Errors · Global hosts |
| **总计** | **70** | | |

### 12.2 路由树完整图

```
AppRoot
├── AuthStack
│   ├── Splash (S1-1)
│   ├── Welcome (S1-2)
│   ├── AudienceSurvey (S1-3)
│   ├── HomeFirstDraw (S1-4 · 特殊 Home · coach=true)
│   └── PermissionPrompt (S1-5)
│
└── MainStack
    ├── TabNav
    │   ├── HomeStack
    │   │   ├── Home (S2-1)
    │   │   └── (modals / sheets 挂在 RootStack)
    │   ├── LibraryStack
    │   │   ├── Library (S6-1)
    │   │   ├── CardDetailFull (S6-3)
    │   │   ├── PoolOverview (S6-4)
    │   │   └── TagExplorer (S6-5)
    │   ├── PlanStack
    │   │   ├── Plan (S7-1)
    │   │   ├── PlanToday (S7-2)
    │   │   ├── PlanWeek (S7-3)
    │   │   └── PlanMonth (S7-4)
    │   └── MoreStack
    │       ├── More (S10-1)
    │       ├── Profile (S10-2)
    │       ├── EditProfile (S10-3)
    │       ├── Settings (S10-4)
    │       ├── SettingsAudience/Notifications/Pools/Appearance/Account (S10-5~9)
    │       ├── About (S10-11)
    │       ├── HelpFAQ (S10-12)
    │       ├── MilestoneHall (S8-1)
    │       └── MilestoneDetail (S8-2)
    │
    ├── Modals（全局 · 从任一屏触发）
    │   ├── PoolLaunchCelebration (S2-6)
    │   ├── FreshStartPrompt (S2-7)
    │   ├── PausedPool (S2-8)
    │   ├── CardDetailModal (S3-4)
    │   ├── LeechWarning (S4-6)
    │   ├── MasteredCelebration (S5-2)
    │   ├── CollectionMilestone (S5-3)
    │   ├── MasteryMilestone (S5-4)
    │   ├── StreakMilestone (S8-3)
    │   ├── WeekStreakMilestone (S8-4)
    │   ├── FreePullGrant (S8-5)
    │   ├── DailyDigest (S8-7)
    │   ├── WeekPlannerPrompt (S8-8)
    │   ├── MonthRewind (S8-9)
    │   ├── BacklogWarning (S9-1)
    │   └── DormantNudge (S9-4)
    │
    ├── Sheets（bottom sheets）
    │   ├── PoolPickerSheet (S2-2)
    │   ├── SortFilterSheet (S6-2)
    │   ├── AudienceFilterSheet (S6-6)
    │   ├── FreePullInventorySheet (S8-6)
    │   ├── FreshStartConfirmSheet (S9-3)
    │   └── DeleteAccountConfirm (S10-10)
    │
    ├── Flows（非 tab 的流程）
    │   ├── DrawIntro/Animation/Result (S3-1~3, S3-5)
    │   ├── LevelIntro/Stage Q/A/IRL/Settlement (S4-1~5, S5-1)
    │   ├── BacklogBurst (S9-2)
    │   └── MonthSummary (S2-5)
    │
    └── Global Hosts（不在导航栈 · 挂在 App 根）
        ├── ToastHost (S10-15)
        ├── CoachOverlayHost (S10-16)
        ├── OfflineBanner (S10-17)
        └── DebugMenu (S10-18 · dev only)
```

### 12.3 Zustand store 切片

```typescript
// src/store/index.ts
interface AppStore {
  user: UserProfile | null;
  pools: Record<PoolId, Pool>;
  activePoolId: PoolId;
  cardProgress: Record<string, CardProgress>;
  ownedCardIds: string[];
  currentSession: Session | null;
  freePullInventory: number;
  milestones: Milestone[];
  ui: {
    coachSeen: Record<string, boolean>;
    offlineMode: boolean;
    reduceMotion: boolean;
  };
  // actions
  setActivePool(poolId: PoolId): void;
  rate(cardId: string, rating: Rating): void;
  draw10(poolId: PoolId): Promise<DrawResult>;
  startSession(cards: Card[], mode: SessionMode): void;
  endSession(): void;
  unlockMilestone(milestoneId: string): void;
  // ...
}
```

---

**v6 完稿。** 下一阶段：按 Phase 1 → Phase 5 生成 RN 代码 · 每阶段结束后我们 review · 改 v6 的细节 · 同步改代码。

*Prepared by Chuan Qiao · 2026-04-22 · 3 PM 签字版*
