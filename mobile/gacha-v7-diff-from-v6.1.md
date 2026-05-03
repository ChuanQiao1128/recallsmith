# RecallSmith Mobile · v7 ↔ v6.1 Diff Hint

> 本文是 [gacha-v7.md](./gacha-v7.md) §1 变更总表的"代码近距离版"。
> 每条 diff 给出：v6.1 现状（含文件行号 / 标识符）、v7 目标、改造路径、测试守门。
>
> 本文不是设计稿，是给 agent / 工程师"今天就要改这个"的施工图。

---

## 总览

| # | 区域 | 主屏 / 主文件 | Phase |
|---|---|---|---|
| 1 | Home 主 CTA 唯一化 | HomeScreen | A |
| 2 | Home deck 行 install/update/trial 抽出 | HomeScreen + 新增 deckActionResolver | A |
| 3 | Home 信息密度收敛 | HomeScreen + homeSelectors | A |
| 4 | Summary 奖励视觉强化 | SessionSummaryScreen + 新增 RewardSummaryCard | B |
| 5 | Summary 文案禁用词 | summaryMapper | B |
| 6 | Library / Deck 角色分离 | LibraryScreen + DeckScreen | C |
| 7 | Library 4 项筛选与响应式 | libraryMapper + LibraryScreen | C |
| 8 | Challenge 文案改造 | ChallengeScreen | D |
| 9 | Review rating 行可达性 | SessionCardScreen | D |
| 10 | Settings 文案 + 瘦身 | SettingsScreen + 新增 features/gacha/settings/ | D |
| 11 | 文件体量守门 | HomeScreen / DeckScreen / SessionCardScreen / SettingsScreen | A-D |
| 12 | 移动端宽度审计 | 全部主屏 | A-D |

## 0. 当前代码位置核对

> 核对时间：2026-05-03。以下行号来自当前工作区代码，不是目标行号。后续如果先改了 import 区，必须同步更新本节。

### 0.1 HomeScreen import baseline

`src/screens/HomeScreen.tsx` 当前 1577 行，顶部 import 区为第 2-56 行。

关键锚点：

- 第 20 行 `loadActiveDeckSlug, setActiveDeckSlug` — Diff 2 抽 deck action 时会受影响
- 第 24 行 `CalendarDay, DeckSummary` — Diff 3 缩减 HomeState 后 `CalendarDay` 应被移出 screen 或只留折叠区
- 第 25 行 `buildHomeVM` — Diff 1 / Diff 3 的主入口
- 第 26 行 `buildUpcoming, clamp01, isLearnedProgress, isScheduledProgress, startOfToday` — Diff 3 的 above-the-fold VM 收敛应减少 screen 直接计算
- 第 30 行 `fetchPremiumDeckUrl, fetchServerPremium` — Diff 2 只抽 deck row action，不先碰远端 premium bootstrap
- 第 31 行 `loadRewardWalletState, type RewardWalletState` — Diff 1 draw badge / wallet 状态来源
- 第 43-50 行 `checkManifestForUpdates, resolveDeckBySlug, listManifestDecks, installDeckFromUrl, type ManifestDeckEntry, type UpdateInfo` — Diff 2 的直接 import 移除目标，尤其是 `installDeckFromUrl`
- 第 53 行 `usePremiumUser, setIsPremiumUser` — Diff 2 action resolver 输入来源，不要把 premium store 读写塞进 row component
- 第 56 行 `useAuthStore` — Diff 2 `signedIn` 输入来源

### 0.2 SessionSummaryScreen import baseline

`src/screens/SessionSummaryScreen.tsx` 当前 239 行，顶部 import 区为第 1-12 行。

关键锚点：

- 第 8 行 `buildSessionSummaryVM` — Diff 5 VM shape 变更后所有 `summary.vm.*` 调用都会受影响
- 第 9 行 `applySessionRewardToWallet, canAcceptMorePulls, loadRewardWalletState, type RewardWalletState` — Diff 4 奖励卡会继续依赖 wallet before/after；`canAcceptMorePulls` 如不再控制按钮样式，必须删除未用 import
- 第 10 行 `buildDrawState` — Diff 4 的 draw CTA 仍可保留为 next action 输入
- 第 11 行 `applySessionStreak, loadStreakSnapshot, type StreakSnapshot` — Diff 4 的 progress block 输入
- 第 12 行 `resolveNewMilestones, type Milestone` — Diff 4 保留 milestone，但不让它压过 reward block

### 0.3 SettingsScreen import baseline

`src/screens/SettingsScreen.tsx` 当前 1615 行，顶部 import 区为第 2-49 行。

关键锚点：

- 第 16-17 行重复从 `react-native-safe-area-context` 引入 `SafeAreaProvider` / `SafeAreaView` — Diff 10 瘦身时应合并
- 第 22-24 行 `AsyncStorage` / `FileSystem` / `Purchases` — Diff 10 应下沉到 account/debug/premium action 文件
- 第 27 行 `checkManifestForUpdates, installDeckFromUrl` — Diff 10 内容更新 section 的 action 候选
- 第 39-44 行 reminder prefs imports — Diff 10 下沉到 `features/gacha/settings/reminders/`
- 第 45 行 `getAudiencePreference, setAudiencePreference, type AudiencePreference` — Diff 10 下沉到 `features/gacha/settings/content/`
- 第 46 行 `getAudiencePreferenceLabel` — Diff 10 下沉到 content section
- 第 47 行 `buildReminderPlanVM` — Diff 10 下沉到 reminders section
- 第 48 行 `loadStreakSnapshot, type StreakSnapshot` — Diff 10 下沉到 account/progress section
- 第 49 行 `resetAllReviewSchedules` — Diff 10 下沉到 account action，主列表不能直接呈现危险语义

---

## Diff 1 · Home 主 CTA 唯一化

**v6.1 现状**

`src/screens/HomeScreen.tsx`（1577 行，从 §0.1 起就在做太多事）：
- 第 657 行 `const { loading, asOfISO, deckSummaries, updates, allUpcoming30, monthCounts } = state;` — Home 同时持有 calendar / month 数据
- 第 707-708 行调用 `buildHomeVM`，但 VM 只覆盖 hero，deck list 仍在 screen 内自行渲染
- premium / install / update 行作为首屏视觉一部分

**v7 目标**

首屏 above-the-fold 只渲染：

1. Hero 战报
2. Today counts
3. Minimum goal
4. **唯一**主 CTA（testID=`home-primary-cta`）
5. Draw status 徽章

其他全部下沉到次级折叠区。

**改造路径**

1. 扩 `homeSelectors.ts`：在现有 `buildHomeVM` 输出里新增 `cta: { kind, label, testID }`，禁止 screen 自己拼 CTA
2. HomeScreen 只渲染 `vm.cta` 单一按钮；premium 按钮、deck 行点击、install action 全部移到次级区或异步 resolver
3. 折叠区用 `Collapsible` / `Accordion` 模式（如无现成组件可用 `<Pressable> + show/hide`）
4. 主 CTA 文案由 9 种状态枚举决定（v7 §3.1.2 列出）

**测试**

- `tests/unit/homeSelectors.spec.ts` 覆盖 9 种 `cta.kind`
- `tests/integration/home-primary-cta.spec.tsx` 渲染 Home，断言 `getAllByTestId('home-primary-cta').length === 1`

---

## Diff 2 · Home deck 行 install/update/trial 抽出

**v6.1 现状**

HomeScreen 第 401 / 414 / 431 行：
```tsx
const ok = await installDeckFromUrl(c.slug, c.remoteUrl, c.remoteVersion, c.remoteSha256);
const stored = await loadActiveDeckSlug();
updates = await checkManifestForUpdates(isPremiumUser);
```

这些 await 与 setState 调用在屏幕里混杂，没有"按下 deck 行做什么"的统一入口。

**v7 目标**

- 新建 `src/features/gacha/home/deckActionResolver.ts` 导出：

```typescript
export type DeckAction =
  | { kind: 'open'; slug: string }
  | { kind: 'install'; slug: string; remoteUrl: string; remoteVersion: number; remoteSha256?: string }
  | { kind: 'update'; slug: string; updateInfo: UpdateInfo }
  | { kind: 'trial-start'; slug: string }
  | { kind: 'paywall'; slug: string };

export async function resolveDeckAction(input: {
  deck: DeckSummary;
  premium: boolean;
  signedIn: boolean;
  updates: Record<string, UpdateInfo>;
}): Promise<DeckAction>;

export async function executeDeckAction(action: DeckAction): Promise<{ activeSlug: string }>;
```

- HomeScreen 只调用 `resolveDeckAction` + `executeDeckAction`，不再直接 import `installDeckFromUrl` / `checkManifestForUpdates`
- 新建 `src/features/gacha/home/HomeDeckRow.tsx` 渲染单行，接受 `(deck, action, onPress)`，内部不读 store

**严禁**

- 不要在 deckActionResolver 里改 `src/content/*`
- 不要让 HomeScreen 第 43-50 行的 deckRepository import 仍包含 `installDeckFromUrl`（grep 检查）

**测试**

- `tests/unit/deckActionResolver.spec.ts`：5 种 `DeckAction.kind` 各一例
- 集成：HomeScreen 渲染 deck 行点击后跳到正确目的地（install / open / paywall）

---

## Diff 3 · Home 信息密度收敛

**v6.1 现状**

HomeScreen 同时持有 `allUpcoming30: CalendarDay[]` / `monthCounts` / 多个 modal / streak banner / reward banner。第 62-71 行的 state 类型本身就是症状：

```tsx
type HomeState = {
  loading: boolean;
  asOfISO: string;
  deckSummaries: DeckSummary[];
  updates: Record<string, UpdateInfo>;
  allUpcoming30: CalendarDay[];
  monthCounts: Record<string, number>;
};
```

**v7 目标**

- HomeVM 必须能完整代表 above-the-fold 渲染，不允许 screen 自行重新计算
- Calendar / month / streak detail 一律移到次级折叠区，默认收起
- HomeState 缩减为 `{ loading, error, vm: HomeVM }`，不再持有 raw data

**改造路径**

1. `homeSelectors.ts` 输出形态升级（保持 `buildHomeVM` 入口签名稳定）：

```typescript
export type HomeVM = {
  hero: { headline: string; subline: string };
  counts: TodayCounts;
  goal: { minimum: string; fullClear: string };
  cta: { kind: HomeCtaKind; label: string; testID: 'home-primary-cta'; nav: HomeCtaNav };
  draw: { state: 'locked' | 'available' | 'reserve' | 'wallet-full'; label: string };
  // 折叠区内容
  decks: { rows: HomeDeckVM[]; defaultOpen: boolean };
  calendar: { compact: HomeCalendarCompact; defaultOpen: false };
  account: { lockup: string | null };
};
```

2. HomeScreen 渲染时遵守"上半屏只 5 行"。
3. Calendar 数据可保留计算，但展示控件默认 collapsed。

**测试**

- 单元：HomeVM 在 9 种状态下，`hero` / `cta` / `draw` 字段满足 v7 §3.1.2 要求
- 集成：渲染 Home 后，断言 calendar / account 区初始为 collapsed（`hidden` 或 `not visible`）

---

## Diff 4 · Summary 奖励视觉强化

**v6.1 现状**

`src/screens/SessionSummaryScreen.tsx` 第 86-142 行：奖励层是简单 `Text + Text + Text`，没有视觉锚，没有钱包状态变化的差异化。

```tsx
<Text style={styles.cardTitle}>{summary.vm.rewardTitle}</Text>
<Text style={styles.walletFootnote}>Wallet now: ...</Text>
<Text style={styles.cardBody}>{summary.vm.progressBody}</Text>
```

**v7 目标**

新建 `src/features/gacha/components/RewardSummaryCard.tsx`：

```tsx
type RewardSummaryCardProps = {
  reward: {
    pulls: number;
    walletBefore: { available: number; reserve: number };
    walletAfter: { available: number; reserve: number };
    fullClear: boolean;
    minimumGoalMet: boolean;
  };
  testID?: string;
};
```

视觉要求：

- 一个 illustration 锚（暂用 `LinearGradient` 圆形 + 数字也可，禁止空白）
- 钱包变化必须用 `before → after` 的箭头表示
- reserve 数字用 `colors.accent.gold` 区分主钱包

新建 `src/features/gacha/components/SummaryProgressBlock.tsx`：

```tsx
type SummaryProgressBlockProps = {
  done: number;
  total: number;
  streak: { before: number; after: number; earned: boolean };
  transitions: { newToLearning: number; learningToMastered: number };
};
```

`SessionSummaryScreen.tsx` 重构为：

```tsx
<RewardSummaryCard reward={...} />        // 上半屏
<SummaryProgressBlock {...} />            // 中段
<NextActionRow primary={...} secondary={...} />  // 下半屏
```

导入区改造：

- 在 `SessionSummaryScreen.tsx` 第 8 行之后新增 `RewardSummaryCard` / `SummaryProgressBlock` imports
- 如果 `canAcceptMorePulls` 不再控制按钮样式，同步删除第 9 行的该 named import

**测试**

- 集成：`tests/integration/summary-reward-priority.spec.tsx` 渲染后，断言 reward block 的 layout y 小于 progress block 的 layout y（用 `onLayout` 或 testID + ref）

---

## Diff 5 · Summary 文案禁用词

**v6.1 现状**

`src/features/gacha/session/summaryMapper.ts` 当前 62 行。第 5-15 行是平铺 VM type，第 44-58 行是 VM construction：

```tsx
export type SessionSummaryVM = {
  title: string;
  subtitle: string;
  rewardTitle: string;
  rewardBody: string;
  rewardBadge: string;
  completionLabel: string;
  progressBody: string;
  nextActionLabel: string;
  secondaryActionLabel: string;
};
```

平铺 9 个字符串，且 `rewardTitle` / `rewardBody` / `progressBody` / action label 文案散在 inline。

**v7 目标**

- 改成三层结构 VM：

```typescript
export type SessionSummaryVM = {
  reward: {
    title: string;
    body: string;
    badge: string;
    walletBefore: { available: number; reserve: number };
    walletAfter: { available: number; reserve: number };
  };
  progress: {
    completionLabel: string;
    body: string;
    streakNote: string | null;
    transitionsNote: string | null;
  };
  nextAction: {
    primary: { label: string; kind: HomeCtaKind };
    secondary: { label: string; kind: HomeCtaKind } | null;
  };
};
```

- 所有文案集中在文件顶部 `const COPY = { ... }` 常量表
- COPY 中不允许出现：`lost / missed / forfeit / wasted / expired / gone`
- 钱包满文案：`Free pulls full · ${reserve} pending in reserve`
- minimum goal：`You kept the streak.`
- full clear：`Cleared today's run.`

**测试**

- `tests/unit/summaryMapper.spec.ts`：4 种 wallet 状态（0 / 1-29 / 29→30 / wallet-full）下 VM 字段
- 同文件追加禁用词测试：

```typescript
const FORBIDDEN = ['lost', 'missed', 'forfeit', 'wasted', 'expired', 'gone'];
test('COPY contains no loss-aversion terms', () => {
  const all = JSON.stringify(COPY).toLowerCase();
  for (const w of FORBIDDEN) expect(all).not.toContain(w);
});
```

- 静态：`grep -nE "(lost|missed|forfeit|wasted|expired|gone)" src/features/gacha/session/summaryMapper.ts` 必须无命中

---

## Diff 6 · Library / Deck 角色分离

**v6.1 现状**

`src/screens/DeckScreen.tsx`（1435 行）目前同时是：

- gate（trial / premium）— 第 869 行 `if ((mode === 'learn-new' || mode === 'mixed') && previewDone)`
- library（卡片网格）— 第 805-1022 行围绕 `libraryVm` 的渲染
- launchpad（mode 选择）— 第 843 行 `async function startMode(mode: StudyMode)` 与 `learn-new / review-due / mixed` UI

**v7 目标**

- DeckScreen 只剩 install / update / trial / premium gate
- LibraryScreen 接管所有 `libraryVm` / 卡片网格渲染
- mode 选择 UI 全部删除（不是注释保留）；session 默认为 `mixed`
- DeckScreen 不再从 Home / Summary / Challenge 主链路被导航到

**改造路径**

1. 把 DeckScreen 第 805-1022 行涉及 `buildLibraryVM` / `buildLibraryCardRows` / `libraryRows` 的代码，全部迁到 LibraryScreen
2. 删除 `import type { ... StudyMode }` 与 `startMode` 函数
3. `RootStackParamList` 中 `StudyMode` 类型保留（用于路由参数兼容），但 Library / Deck 之间不再传该参数
4. Home / Summary 中所有跳到 DeckScreen 的入口改为跳到 LibraryScreen
5. DeckScreen 顶部 docstring 加 `@v7 deck install gate only`

**严禁**

- 不要把 DeckScreen 里 trial / premium gate 也搬走（它就该留在这里）
- 不要在 LibraryScreen 里复活 mode 选择

**测试**

- `tests/integration/deck-no-launch.spec.tsx`：渲染 DeckScreen，断言无 `mode-selector` testID、无 `library-card-grid` testID
- `tests/integration/home-cta-target.spec.tsx`：从 Home 主 CTA 触发，断言 navigation 目标是 `Challenge`，不是 `Deck`

---

## Diff 7 · Library 4 项筛选与响应式

**v6.1 现状**

`src/features/gacha/library/libraryMapper.ts`：
- 第 7 行 `LibraryCardStatus = 'new' | 'learning' | 'mastered'`
- 第 54 行 `buildLibraryCardRows` 已经能产出按状态分类的行
- 但筛选 UI 与列数响应式没有在 LibraryScreen 中实现

**v7 目标**

- LibraryScreen 顶部 4 项筛选：`All / New / Learning / Mastered`
- 列数响应式：`< 390pt` 用 2 列，`>= 390pt` 用 3 列
- 卡片状态徽章必须在 360pt 下不与 question 文字重叠

**改造路径**

1. `libraryMapper.ts` 暴露 `LibraryFilter = 'all' | 'new' | 'learning' | 'mastered'`
2. `buildLibraryVM` 接受 `filter` 参数，输出 `cards` 已经按 filter 过滤
3. LibraryScreen 用 `useWindowDimensions().width` 决定 `numColumns`
4. 卡片用 `flex` + `gap`，不允许写死 `width: 120`

**测试**

- `tests/unit/libraryMapper.spec.ts`：4 种 filter 各一例
- `tests/integration/library-360-columns.spec.tsx`：mock window width 360，断言 `numColumns === 2`；mock 390，断言 `=== 3`

---

## Diff 8 · Challenge 文案改造

**v6.1 现状**

`src/screens/ChallengeScreen.tsx`（215 行）结构干净，但文案偏 MVP 骨架：

- 标题没有时间感
- minimum goal / full clear 都是 `Minimum 1 card` / `Full session 4 cards` 这类技术语言

**v7 目标**

- 标题用日期感 + 任务感：`Tuesday · 4 cards ahead`（动态生成）
- minimum goal 改成结果语言：`Keep your 7-day streak alive`
- full clear 改成结果语言：`Clear today's run for +2 free pulls`
- CTA 文案：`Begin`（不是 `Start session`）

**改造路径**

1. 文案集中放到 `ChallengeScreen.tsx` 顶部 `const COPY = { ... }`
2. 日期 / streak 数 / reward 数从 `planChallengeRoute` 输出读取，不在 screen 里重新算

**严禁**

- 不要在 Challenge 里加二级 CTA（去抽卡 / 去图鉴）
- 不要加节点动画或地图漫游

**测试**

- 集成：渲染 Challenge，断言 testID 为 `challenge-begin-cta` 唯一可见主按钮
- 单元：`planChallengeRoute` 在没有高压候选时不返回 `boss` 角色节点

---

## Diff 9 · Review rating 行可达性

**v6.1 现状**

`src/screens/SessionCardScreen.tsx`（962 行）：

- 渲染逻辑混合在 screen 内
- 长 explanation / code / usage 时，rating 行可能在 ScrollView 内被滚走

**v7 目标**

- rating 行始终在屏幕底部可达；ScrollView 只滚动内容区，rating 行用绝对定位 + safe area
- 在 360pt 宽下 4 个 rating 按钮单行排开，每键 ≥ 64×56pt

**改造路径**

1. SessionCardScreen 顶层 layout 改为：

```tsx
<SafeAreaView>
  <SessionProgressHeader ... />            // 顶部固定
  <ScrollView style={{ flex: 1 }}>          // 内容区
    <ReviewBody ... />                       // 新组件，封装 question / answer / code / usage
  </ScrollView>
  <RatingBar ... />                          // 底部固定
</SafeAreaView>
```

2. 新建 `src/features/gacha/components/ReviewBody.tsx` 接收 `(card, faceUp, onFlip)`
3. `RatingBar.tsx` 已存在，调整内边距与最小触达即可
4. 长内容 markdown / CodeBlock 渲染从 SessionCardScreen 抽到 ReviewBody

**严禁**

- 不要用复杂 sticky scroll（`sticky position` 在 RN 不可靠）
- 不要让 RatingBar 自己读 sessionStore（仍然由 screen 传 props）

**测试**

- 集成：渲染长 content 卡，触发 ScrollView 滚动到底，断言 RatingBar testID 仍可见
- 类型：`SessionStore` action union 完整

---

## Diff 10 · Settings 文案 + 瘦身

**v6.1 现状**

- `src/screens/SettingsScreen.tsx` 1615 行
- 子页 `SettingsAudienceScreen.tsx` 37 行（薄壳）、`SettingsNotificationsScreen.tsx` 37 行
- 文案偏"原理"而非"结果"

**v7 目标**

- SettingsScreen ≤ 800 行
- 每个设置项最多 1 句解释，用结果语言
- 文件按 region 拆到 `src/features/gacha/settings/`：

```
src/features/gacha/settings/
  account/
    AccountSection.tsx
    accountActions.ts
  content/
    ContentSection.tsx
    audienceActions.ts
  reminders/
    RemindersSection.tsx
  appearance/
    AppearanceSection.tsx
  about/
    AboutSection.tsx
  debug/
    DebugSection.tsx     // 仅 dev build
```

**改造路径**

1. SettingsScreen 顶层只剩 `<Section />` 列表 + scroll
2. 每个 section 内部组件接 props，不读 store
3. 文案集中到各 section 的 `COPY` 常量
4. 不允许通过 `Stack.Screen` 假瘦身（仍然是同一个 SettingsScreen 入口）

**测试**

- 静态：`wc -l src/screens/SettingsScreen.tsx` ≤ 800
- 单元：每个 section 的 COPY 常量做禁用词检查（`wipe / delete all` 不能出现在主列表 section）

---

## Diff 11 · 文件体量守门

**v6.1 现状**

```
HomeScreen.tsx        1577
SettingsScreen.tsx    1615
DeckScreen.tsx        1435
SessionCardScreen.tsx  962
ReviewScreen.tsx       884  (deprecated)
```

**v7 目标**

| 文件 | 上限 |
|---|---|
| HomeScreen.tsx | 800 |
| ChallengeScreen.tsx | 300 |
| SessionCardScreen.tsx | 800 |
| SessionSummaryScreen.tsx | 400 |
| LibraryScreen.tsx | 400 |
| DeckScreen.tsx | 600 |
| SettingsScreen.tsx | 800 |
| ReviewScreen.tsx | （deprecated，不强求；但禁止增长） |

**守门命令**

```bash
wc -l src/screens/*.tsx | awk '$2 != "total" && $2 != "src/screens/ReviewScreen.tsx" && $1 >= 800'   # 必须为空
```

CI 中可包成一个 check script。

---

## Diff 12 · 移动端宽度审计

**v6.1 现状**

无系统化窄屏验证记录。

**v7 目标**

每个主屏在 `360 / 375 / 390 / 430` pt 下都需通过：

- 文字不溢出、不重叠
- 主 CTA 单行
- 卡片网格列数符合 §3.5.2
- rating 行触达 ≥ 64×56pt

**审计步骤**

1. iOS 模拟器跑 iPhone SE (375) / iPhone 14 (390) / iPhone 15 Pro Max (430)
2. Android 模拟器跑 Pixel 3a (411) / 任一 360pt 设备
3. 6 场景 × 4 宽度 = 24 张截图
4. 截图归档：`docs/screens/v7/<scenario>/<width>/<screen>.png`

**自动化**

- 集成测试用 `useWindowDimensions` mock 检验布局
- 不要求像素级回归测试（成本太高），但要求关键 testID 在所有宽度下可见

---

## 收尾

每条 diff 都对应到 v7 §3 的 acceptance + §6 的测试。改完一条不要急着做下一条；先按 v7 §7 的 phase 顺序合并。

如果改的过程中发现某条 diff 与 v6.1 实际代码不一致，**先停下** — 要么是 v6.1 已悄悄被改过（更新 v7 的 baseline 描述），要么是某条 diff 写错了（修文档不修代码）。不要直接调整代码"对齐文档"。
