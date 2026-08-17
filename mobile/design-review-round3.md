# RecallSmith Mobile · 第三轮 Codex Review · v7 落地 + 全屏巡检

> **评审对象**：Codex 当前状态下 `recallsmith/mobile/src/screens/*.tsx` 全部 72 张（含 deprecated）
> **对照文档**：`gacha-v7.md`（当前 SoT）/ `gacha-v6.1.md`（v7 未覆盖部分）/ `AGENTS.md`
> **评审形式**：纯静态代码审查 + tsc 类型检查 + 静态守门 grep
> **输出形态**：可执行 checklist。每条带文件路径、行号锚点、改法。Codex 应按 `[P0/P1/P2] · 屏幕 · 条目`顺序逐条 patch
> **日期**：2026-05-04

---

## 0 · 执行须知（Codex 必读）

### 0.1 优先级语义

- **P0** = 必须改。违反 v7 §1 变更总表 / §2 非谈判原则 / AGENTS.md §3 严禁修改 / §4 mobile design rules，或会引发用户误解 / 数据错误。
- **P1** = 应当改。文案、视觉一致性、信息架构问题；不阻塞 v7 但拖累用户体验。
- **P2** = 可以改。token 化、命名一致性、未来重构对齐；本轮不强求。

### 0.2 不要做的事

- 不要为每个屏幕新建 PR。按"Phase A→B→C→D"分批；本文 §A / §B / §C / §D 章节标号即为推荐分批顺序。
- 不要在改 v7 已修过的文件时引入 inline hex；本文已经为对应屏幕标出违规行号。
- 不要把 deprecated 屏幕（ReviewScreen、LevelScreen、SettlementScreen、AppInfoScreen-mock 屏）"顺手"重写。先标 deprecated，主链路改完再统一处理（§E）。
- 不要修 `src/review/**`、`src/content/**`、`src/auth/**`、`src/premium/**`、`src/sync/**`、`src/theme/**`、`src/components/CodeBlock.tsx`、`src/navigation/types.ts` 现有字段（AGENTS.md §3）。
- 不要把 deprecated 屏幕的新 mock 数据、新 internal copy 当成需要"打磨"的真功能。

### 0.3 改前先读

- `gacha-v7.md` §1（变更总表）/ §2（非谈判原则）/ §3（屏幕级 acceptance）/ §4（横切要求）
- `AGENTS.md` §3（严禁修改路径）/ §4（mobile design rules：360pt、numberOfLines、文案禁用词）
- 本 review §F（静态守门 + 横切结论）

### 0.4 静态守门 baseline（执行任何改动后必须复跑且不退化）

```bash
# 1. 类型
npm run test:typecheck                                  # 当前：通过 ✓
# 2. 文件体量上限 800（除 ReviewScreen 已 deprecated 外）
wc -l src/screens/*.tsx | awk '$2!="total" && $2!="src/screens/ReviewScreen.tsx" && $1>=800'   # 当前：空 ✓
# 3. summary 文案禁用词
grep -nE "(lost|missed|forfeit|wasted|expired|gone)" src/features/gacha/session/summaryMapper.ts  # 当前：空 ✓
# 4. v7 修过的文件不允许 inline hex
grep -nE "#[0-9A-Fa-f]{6}" src/screens/HomeScreen.tsx src/screens/ChallengeScreen.tsx src/screens/SessionCardScreen.tsx src/screens/SessionSummaryScreen.tsx src/screens/LibraryScreen.tsx src/screens/DeckScreen.tsx src/screens/SettingsScreen.tsx  # 当前：空 ✓
# 5. UI 文案禁用词（全局，AGENTS.md §4）— 当前 1 条命中（ErrorNetworkScreen），见 §D
grep -nE "(lost|missed|forfeit|wasted|expired|gone)" src/screens/*.tsx
```

### 0.5 体量当前（截至本评审）

| 文件 | 行数 | 上限 | 状态 |
|---|---|---|---|
| HomeScreen | 633 | 800 | ✓ |
| DeckScreen | 597 | 600 | ✓（紧贴上限，下次别再涨） |
| SettingsScreen | 480 | 800 | ✓ |
| SessionCardScreen | 730 | 800 | ✓ |
| LibraryScreen | 319 | 400 | ✓ |
| ChallengeScreen | 293 | 300 | ✓（紧贴上限） |
| SessionSummaryScreen | 392 | 400 | ✓ |
| ReviewScreen | 884 | — | deprecated（v7 §5.4 允许保留） |
| LevelScreen | 503 | — | deprecated（见 §E） |
| SettlementScreen | 346 | — | 半 deprecated（见 §A.4） |

---

## A · v7 主链路屏幕（核心循环）

### A.1 HomeScreen — `src/screens/HomeScreen.tsx`

✅ 已对齐 v7 §3.1：
- 单主 CTA + 折叠 deck/calendar/draw-support 三个抽屉
- HomeVM 9 态体系（loading/error 分支已实现）
- testID 正确（`screen-home-primary-cta` / `home-collapse-*-toggle`）
- 文件 633 行 < 800

需要修的：

- [ ] **P0 · A.1.1 · header subtitle 在 360pt 会截断** — `HomeScreen.tsx:399-401`
  当前 `Today: decide if you should run, how many cards, and where to start.` 14 词，单行 `numberOfLines={1}`，360pt 下右侧会出现省略号。
  **改法**：要么压到 ≤ 6 词（例 `Today's plan, in one screen.`），要么改 `numberOfLines={2}`、字号降到 `typography.bodySmall`。

- [ ] **P0 · A.1.2 · "Week support" / "Draw support" / "Your decks" 三个抽屉过载** — `HomeScreen.tsx:463-568`
  三个 collapse header 默认全部 closed 但同时存在，首屏拼凑感重。v7 §3.1.3 要求次级元素压缩，未明确允许 3 个并列 toggler。
  **改法**：
  1. 把 "Draw support" 抽屉删除。draw 状态已经在 hero 区 `drawBadge`（line 454）显示了；first draw coach 的"Open first draw route"按钮（line 541）应改为 hero 区下方的次级 link，不要再独立成抽屉。
  2. 保留 "Your decks (N)"、"Week support" 两个抽屉。
  3. 抽屉 header 加一句单行副标题（如"折叠时显示精炼摘要"），这样 closed 状态下用户也能感知里面有什么。

- [ ] **P1 · A.1.3 · `v6HomeState` fallback 卡片是 v6 残留** — `HomeScreen.tsx:238-248, 569-578`
  `MOCK_HOME_STATES[v6HomeState]` 读 mock 文案，仅在 `v6HomeState !== 'active'` 时显示。v7 已经把 9 种状态封进 `HomeVM`，这个分支属于 v6 残留。
  **改法**：删除 lines 238-248 和 569-578 的整个 stateCard。如果某些状态（如 wallet_full / dormant）真的需要额外提示，应通过 `HomeVM.hero` 或 `goal` 字段表达，而不是再起一个并列 card。

- [ ] **P1 · A.1.4 · `cachedPremium` 计算后被丢弃** — `HomeScreen.tsx:77-79`
  ```ts
  const cachedPremium = usePremiumUser(authUserSub);
  const [serverPremium, setServerPremium] = useState(false);
  const isPremiumUser = serverPremium;
  ```
  `cachedPremium` 计算了但未使用。在 server fetch 完成前，`isPremiumUser` 永远是 false，会导致首帧错把 premium 用户当作 non-premium。
  **改法**：改成 `const isPremiumUser = serverPremiumLoaded ? serverPremium : cachedPremium;`，并加一个 `serverPremiumLoaded` 布尔。

- [ ] **P2 · A.1.5 · inline rgba 较多** — `HomeScreen.tsx:598, 600, 610, 612, 615, 616, 619, 622, 625, 628, 630`
  v7 §4.3 + AGENTS.md §4 严格说"不允许 inline hex"。rgba 不在 grep 守门里，但精神上同样应该走 token。
  **改法**：在 `src/theme/colors.ts` 不新增 token 的前提下（v7 §4.3 不许新增），把这些 rgba 抽到 HomeScreen 顶部一个 `const HOME_TOKENS = {...} as const;`，规避字面量散落。

---

### A.2 ChallengeScreen — `src/screens/ChallengeScreen.tsx`

✅ 已对齐 v7 §3.2：
- 单主 CTA `Begin`，testID `challenge-begin-cta`
- 双行目标（minimum + full clear）
- 文案改造（动词 / 不再是 MVP 骨架）
- 293 行 < 300（紧贴上限）

需要修的：

- [ ] **P1 · A.2.1 · `eyebrow` 与 `title` 语义重复** — `ChallengeScreen.tsx:23, 31-33, 152-157`
  eyebrow 是 `Today's challenge`，title 是 `Tuesday · 4 cards ahead`。两条都在说"今天"。
  **改法**：删除 eyebrow，把日期 + 卡数信息直接放进 title；用更亮的 eyebrow 作为路线名（如 `Default route`、`Sprint route`）反而更有用。

- [ ] **P1 · A.2.2 · `minimumLine(1)` 文案不一致** — `ChallengeScreen.tsx:27-28`
  ```ts
  minimumLine: (minimumGoal: number) =>
    minimumGoal > 1 ? `Keep your streak alive with ${minimumGoal} cards.` : 'Keep your streak alive with one clear recall.',
  ```
  `>=2` 用 `cards`，`==1` 用 `recall`。复数处理偏脆。
  **改法**：统一使用 `cards`：`'Keep your streak alive with 1 card.'`，与 fullClearLine 的 `${limit} cards` 保持一致。

- [ ] **P2 · A.2.3 · `'← Home'` back button 和"single primary CTA"原则的视觉权重** — `ChallengeScreen.tsx:146-150`
  当前 backButton 和 primaryButton 都是大按钮形态。背景较浅。在 360pt 下两者并列时仍会争夺注意力。
  **改法**：backButton 改为更小的 chevron 图标 + "Home" 文字，alignSelf: 'flex-start'，不要再用整宽 background。

---

### A.3 SessionCardScreen — `src/screens/SessionCardScreen.tsx`

✅ 已对齐 v7 §3.3：
- 顶部 SessionProgressHeader + ScrollView 内容 + 底部 stick rating dock
- testID `screen-session-card-primary-surface` / `review-rating-dock` / `review-rating-bar`
- ratingDockHeight 动态根据 `insets.bottom` 调整
- 文件 730 行 < 800

需要修的：

- [ ] **P0 · A.3.1 · `minimumGoal: 1` 硬编码 + reward 公式硬编码** — `SessionCardScreen.tsx:453, 564, 572`
  Settlement / Summary 跳转时都硬编码 `minimumGoal: 1` 和 `rewardPulls = sessionDone >= sessionLimit ? 2 : sessionDone >= 1 ? 1 : 0`。  
  v7 §2.2 明确 minimum goal 与 streak 解耦，但具体数字应来自 selector/planner，不是 screen 内硬写。SessionSummaryScreen.tsx:64 也重复了同一公式。
  **改法**：
  1. 抽 `src/features/gacha/rewards/sessionRewardCalc.ts` 导出 `computeSessionRewardPulls({ sessionDone, sessionLimit, minimumGoal })`。
  2. SessionCardScreen + SessionSummaryScreen 都调它。
  3. `minimumGoal` 也走 `planChallengeRoute` 输出，screen 不再写死。

- [ ] **P0 · A.3.2 · SessionProgressHeader 颜色不一致** — `src/features/gacha/components/SessionProgressHeader.tsx:45-61`
  使用 indigo 系 `#4F46E5` / `#4338CA` / `#111827` / `#6B7280`，与 v7 主题 parchment+ink 完全冲突。Hot path 上唯一一个"非 parchment"组件。
  **改法**：替换为 theme tokens（`colors.ink` / `colors.inkSecondary` / `colors.gold` / `colors.glowGold`）。`#4F46E5` 主推进条改成 `colors.gold`，roleLabel 改成 `colors.ink`。

- [ ] **P1 · A.3.3 · `← Challenge` 和"主操作即评分"的张力** — `SessionCardScreen.tsx:521-528`
  v7 §2.3 要求"评分区行就是主操作"。当前左上有大尺寸 backButton "← Challenge"。学生在 review 模式下点击 back 容易把 session 中断。
  **改法**：
  - 把 backButton 文案改为更弱的 "Pause"，并在点击时弹一个 confirm（"Pause and lose progress?" 不允许；改成 "Pause this run? Your ratings are saved."）。
  - 或者把 backButton 缩成纯图标 + 顶部 right-aligned，不与 deck title 抢视觉。

- [ ] **P1 · A.3.4 · `'View summary'` 和 `Continue` 命名不统一** — `SessionCardScreen.tsx:578` vs `SessionSummaryScreen.tsx:165`
  Route complete 卡片上的 CTA 是"View summary"，但 SessionSummary 自己的主 CTA 是"Continue"。从用户视角是连续两步"View summary → Continue"。
  **改法**：Route complete 的按钮就直接用 `Continue`，无须再多一层"View summary"字面。

- [ ] **P2 · A.3.5 · trial preview / non-premium 路径**（待补） — `SessionCardScreen.tsx:62-66, 220+`
  `trialRef` 在屏幕里维护，但 trial 转 paywall 的 UX 没看到清晰的状态展示（preview 还剩几张？）。本轮 v7 不做 premium 改造，留作 P2 标记，后续 phase 重看。

---

### A.4 SessionSummaryScreen — `src/screens/SessionSummaryScreen.tsx`

✅ 已对齐 v7 §3.4：
- Reward layer → Progress layer → Next action 三段顺序正确
- testID `summary-reward-block` / `summary-progress-block` / `screen-session-summary-primary-cta`
- empty / loading / error 三态都有
- 文件 392 行 < 400

需要修的：

- [ ] **P0 · A.4.1 · empty-state 文案把 Library 当作 session 配置入口** — `SessionSummaryScreen.tsx:152, 164`
  ```ts
  // line 152
  isSummaryEmpty ? 'Open your library to choose cards for the next run.'
  // line 164
  isSummaryEmpty ? 'Open library'
  ```
  v7 §3.5.3 明确 Library 不承担 session config / mode launch；"choose cards for the next run" 暗示用户能从图鉴启动 session，违反 Library 角色定义。
  **改法**：empty state 文案改为：`'Browse your library while we wait for tomorrow's run.'`；CTA 还可以保留 "Open library"，但不能暗示在那里"组装 session"。

- [ ] **P1 · A.4.2 · `actionTitle = 'Next action'` 是机器味** — `SessionSummaryScreen.tsx:144`
  在 ready 态下，actionCard header 写 "Next action"。v7 §3.4.2 强调奖励 + 鼓励语气，"Next action" 像 jira 任务。
  **改法**：
  - full-clear → `'Cleared today. What now?'`
  - streak-saved → `'Streak saved. Keep moving?'`
  - 把映射放到 `summaryMapper.ts` 的 VM 里，screen 不再硬写。

- [ ] **P1 · A.4.3 · primaryActionLabel 在 wallet-full 状态会非常长** — `SessionSummaryScreen.tsx:165, 272-274`
  当 `summary.vm.nextAction.primary.label` 来自 mapper，wallet-full 状态推荐文案可能是 `Use your free pulls`（≤ 18 字符 OK）。但 360pt 下 minHeight 44 + paddingHorizontal `spacing.md` 留给文字的空间约 280pt，对应 ≈ 22 中文字符 / 18 英文 emoji，需要在 mapper 里硬约束所有 primary label ≤ 22 字符。
  **改法**：在 `summaryMapper.ts` 里给所有 `nextAction.primary.label` 加单元测试，断言 `.length <= 22`。AGENTS.md §4 已要求"主按钮 360pt 单行"，这条是测试保障。

- [ ] **P2 · A.4.4 · milestoneCard 单条显示** — `SessionSummaryScreen.tsx:217-229`
  `latestMilestone = newMilestones[0]`，多里程碑同时解锁时只渲染第一条。本轮 v7 不做 milestone ceremony，留作 P2。
  **改法**：在 mapper 里加 `extraMilestonesCount` 字段，UI 提示 `+2 more milestones unlocked`。

---

### A.5 SettlementScreen — `src/screens/SettlementScreen.tsx`

⚠️ **架构问题**：v7 主链路是 `SessionCard → SessionSummary`，Settlement 仅在 `completionRoute === 'settlement'`（SessionCard:559, BacklogBurstScreen:24）时使用。当前是 v6.1 残留 + 部分场景仍依赖。

- [ ] **P0 · A.5.1 · 使用 mock session 数据渲染真 Settlement** — `SettlementScreen.tsx:7-9, 22-23`
  ```ts
  import { MOCK_SETTLEMENT } from '../mock/settlement';
  import { buildMockSessionCards } from '../mock/session';
  // ...
  const cards = useMemo(() => buildMockSessionCards(), []);
  ```
  Settlement 进来后画面 100% 用 mock 数据生成 ledger 行、grade 分布、mastery 列表。真实 session 数据完全没接入。
  **改法**：本轮不投入精力修，先在文件首行加 `/** @deprecated v7 — settlement-route is being collapsed into SessionSummary; see Phase D */` 注释；同时检查所有 `navigation.navigate('Settlement', ...)` 调用点（grep 一下），尽量改为走 SessionSummary。BacklogBurstScreen:24 是其中一处。

- [ ] **P0 · A.5.2 · 大量 inline hex（5 处） + 大量硬编码字号 / 间距** — `SettlementScreen.tsx:14-18, 220, 240, 246, 251-252, 257, 262-264, 271-272, 276-279, 284, 288, 294, 297, 299, 311, 316, 323-325, 327-328, 330-331, 333-334, 338, 344`
  ```ts
  const GRADE_TONES = {
    again: '#C8544F',
    hard: '#D68B2D',
    good: '#2E8C6A',
    easy: '#5C6BE0',
  };
  ```
  以及 backgroundColor: '#F6EFD9' / '#F2E8D5' / '#FCF8EF' / '#DFA847' / '#241D15' / '#7C5CE0' / '#C8883A' / '#7A6242' / '#75644F'…
  **改法**：因为 Settlement 即将被 deprecate（A.5.1），本轮**不**为它新增 token；标 deprecated + 不再花精力 token 化。

- [ ] **P0 · A.5.3 · Settlement 主屏堆 4 个 CTA 同等权重** — `SettlementScreen.tsx:195-209`
  ```
  Return home / Celebrate mastery / Open collection milestone / Open mastery milestone
  ```
  后三个明显是开发自测入口，不应出现在用户主流程。
  **改法**：删除 lines 199-209 三个 milestone secondary CTA。仅保留 `Return home` 和（可选的）`Open reward draw`（line 184，只在 pulls > 0 时存在）。

- [ ] **P1 · A.5.4 · `gradeLegendRow` 数据冗余** — `SettlementScreen.tsx:148-154`
  上一行 `gradeTrack` 已经把 label + count 渲染在分段里；下面又来了一遍 4 项 legend，重复信息。
  **改法**：删除 lines 148-154，只保留 gradeTrack。

- [ ] **P2 · A.5.5 · `'Settlement'` eyebrow 是机器味** — `SettlementScreen.tsx:102, 108`
  改成 `'Run closed'` 或直接删 eyebrow。

---

### A.6 DrawScreen — `src/screens/DrawScreen.tsx`

- [ ] **P0 · A.6.1 · `deckTitle` 硬编码** — `DrawScreen.tsx:126`
  ```ts
  const deckTitle = !hasActivePool ? 'No active pool' : slug === 'aws' ? 'AWS SAA' : slug ? 'C# Interview' : 'No active pool';
  ```
  当用户安装了非 aws / 非 csharp 的 deck，会被错误标记为 "C# Interview"。
  **改法**：从已 fetch 的 deck record 里读 `deck.Title`。当前 useFocusEffect 已经 resolveDeckBySlug，把 title 也带回 state。

- [ ] **P0 · A.6.2 · "Open 1 pull" / "Preview 1 pull" 标签错位** — `DrawScreen.tsx:374-393`
  ```ts
  // 当 drawVm.canOpen=false：
  void openPull(1, { previewOnly: true });
  // 但按钮文字还是 "Open 1 pull"
  ```
  preview-only 不消耗 wallet，文字必须区分。
  **改法**：
  ```ts
  text = drawVm.canOpen ? 'Open 1 pull' : 'Preview 1 pull (free)';
  ```

- [ ] **P0 · A.6.3 · `setPityBefore(8)` 硬编码** — `DrawScreen.tsx:103`
  pity 起始永远从 8 开始，跨 session 不持久。`buildPityProgressLabel` 在 line 331 显示出来给用户看，是错的。
  **改法**：从 wallet 或 progress 持久化读取真实 pity 计数。本轮如不接入真实 pity 模型，至少删除 line 331 的 "pity progress" 显示，避免误导。

- [ ] **P0 · A.6.4 · drop odds 70%/27%/3% 硬编码** — `DrawScreen.tsx:319-328`
  对所有 pool 都展示同一组 odds。Pool config 里如果有不同的概率分布，这里看不到。
  **改法**：从 pool config 读取，或在没有 pool 概念前完全删除 oddsRow（改为后续随 multi-pool 一起加）。

- [ ] **P0 · A.6.5 · `navigation.navigate('Deck', { slug } as any)`** — `DrawScreen.tsx:363`
  v7 §3.6 已经把 DeckScreen 收敛为 install/update/trial gate；从 lockout 状态跳 Deck 不符合 v7 角色定义。`as any` 也违反类型保证。
  **改法**：
  - 当 `!drawVm.canOpen && hasActivePool && slug` 时，应该跳回 Home（`navigation.navigate('Home')`）而不是 Deck。
  - 删除 `as any`。

- [ ] **P1 · A.6.6 · 主背景 Cosmic + 行动卡 Parchment 切换** — `DrawScreen.tsx:519-524`
  actionCard 用 `colors.parchmentBgDeep` 作为背景嵌在 Cosmic 主屏内。design-review-round2.md §A.2 §Screen 02 已建议过"仪式归仪式 / 日常归日常"切回羊皮纸——这部分实现到位，**保留**。

- [ ] **P2 · A.6.7 · 18 颗装饰粒子 + 5 张卡背 stack** — `DrawScreen.tsx:24, 38-44, 285-303`
  decorative 粒子 + 旋转卡背 stack 没有交互意义；360pt 下高度 stackStage 240pt 占屏幕 30%+。
  **改法**：保留视觉，但把 stackStage 高度改为响应式 `Math.min(240, height * 0.3)`。

---

### A.7 DrawCeremonyScreen — `src/screens/DrawCeremonyScreen.tsx`

- [ ] **P0 · A.7.1 · 文案 sci-fi jargon 太重** — `DrawCeremonyScreen.tsx:162-198, 304-310`
  当前文案：
  ```
  "Cards entering orbit"
  "Center card charging the reveal"
  "Result spread stabilizing"
  "Flip breach armed"
  "Front face unlocked · Flip axis at 180°"
  "LEG core breach"
  "RAR resonance"
  "COM drift"
  "Pity triggered · RAR+ guaranteed in this reveal"
  "Glyph field online · { } () => ; 0 1"
  "Reduced-motion ceremony enabled"
  ```
  design-review-round2.md §A.1 已经标记过 RecallSmith 基调是"温和、克制、不焦虑"，这堆 sci-fi narration 是反方向。Round-2 §A.2 也提到"符号是装饰，不是关键字"——`Glyph field online` 把背景符号显式当主角。
  **改法**：全部替换为人话：
  ```
  "Single pull: warming up" → "Drawing one card..."
  "Single pull locking onto the center card" → "Almost there..."
  "Single pull reward revealed" → "Your card"
  "Cards entering orbit" → "Drawing 10 cards..."
  "Center card charging the reveal" → "Hold for the highlight..."
  "Result spread stabilizing" → "Lining up your draws..."
  "Flip breach armed" → "Tap to reveal"  // 或直接删
  "Front face unlocked · Flip axis at 180°" → "" // 删
  "LEG core breach" → "Legendary"
  "RAR resonance" → "Rare"
  "COM drift" → "Common"
  "Pity triggered · RAR+ guaranteed in this reveal" → "Pity bonus: rare or better"
  "Glyph field online · { } () => ; 0 1" → ""  // 删
  "Reduced-motion ceremony enabled" → "Reduced motion on"
  ```
  把这些常量集中到 `src/features/gacha/draw/ceremonyCopy.ts`，加单元测试断言不含 ":", "·", "axis", "breach", "drift", "resonance", "core", "armed", "unlocked"。

- [ ] **P1 · A.7.2 · `seed #----` 占位符暴露** — `DrawCeremonyScreen.tsx:304`, `DrawResultScreen.tsx:211`
  当 `drawResult.seedLabel` 为空时，UI 显示 `seed #----`。占位符外露。
  **改法**：当 seedLabel 为空时整个 metaLine 不显示该字段。

- [ ] **P1 · A.7.3 · `Skip ceremony` 按钮文案** — `DrawCeremonyScreen.tsx:391`
  对于希望快速进入结果的用户来说，"Skip ceremony" 是中性正确的；但和 ceremony 是"礼物"的设计意图不一致。改为 `Tap to reveal` 或 `Show result` 更好。

- [ ] **P2 · A.7.4 · 大量 inline rgba** — `DrawCeremonyScreen.tsx:34-48, 225-226, 291, 356-358`
  CEREMONY_COLOR 是文件级 const，不算"散落 hex"，但仍可移到 theme/draw 命名空间。

---

### A.8 DrawResultScreen — `src/screens/DrawResultScreen.tsx`

- [ ] **P0 · A.8.1 · `deriveCardTag` 是关键字嗅探** — `DrawResultScreen.tsx:28-37`
  ```ts
  function deriveCardTag(question: string) {
    const q = question.toLowerCase();
    if (q.includes('middleware') || q.includes('asp.net')) return 'ASP.NET CORE';
    // ...
    return 'CORE';
  }
  ```
  非 c# / aws 内容会被错误归类为 'CORE'。卡片元数据应有 `tag` 字段，screen 不该做 NLP。
  **改法**：从 `card.tag` 字段读取（如果 deck schema 没有，应在 deckExport types 里加）。本轮如果 schema 改不动，至少把 `'CORE'` 默认值改成空串，不显示假 tag。

- [ ] **P0 · A.8.2 · `deckLabel = slug === 'aws' ? 'AWS SAA' : 'C# Interview'`** — `DrawResultScreen.tsx:67`
  同 DrawScreen.tsx:126，硬编码 deck 名。
  **改法**：DrawCeremony 跳过来时把 deck title 通过 navigation params 带过来，或者 DrawResultScreen useFocusEffect 时 resolveDeckBySlug 一次。

- [ ] **P0 · A.8.3 · modalBody 文案泄露** — `DrawResultScreen.tsx:367`
  ```
  "{tag} · {stars} · This reveal layer keeps the draw feeling premium before the full library detail takes over."
  ```
  "This reveal layer..." 是产品内部 design rationale，不是面向用户的文案。
  **改法**：完全替换：仅显示 `{tag} · {stars}`，或者展示卡片的 question 摘要。

- [ ] **P0 · A.8.4 · "View library first" 实际跳 Deck** — `DrawResultScreen.tsx:332`
  ```ts
  onPress={() => navigation.navigate('Deck', { slug })}
  ```
  按钮文字说 library，行为却是 deck。误导。
  **改法**：改为 `navigation.navigate('Library')`。Deck 不是浏览页（v7 §3.6）。

- [ ] **P1 · A.8.5 · 3 个 CTA（primary + secondary + ghost）** — `DrawResultScreen.tsx:312-351`
  ```
  "Start studying drawn cards" / "View library first" / "Back to Home"
  ```
  v7 §2.3 "single primary CTA" + 1 个次级链接。当前是 1 主 + 1 次 + 1 ghost = 3 层。
  **改法**：删除 ghostButton "Back to Home"。Home 通过顶部 backButton 进。

- [ ] **P1 · A.8.6 · "ceremonyEcho" 后置卡片重复信息** — `DrawResultScreen.tsx:221-236`
  ```
  "Ceremony afterglow / LEG carryover / Center card revealed last · Flip axis at 180°"
  ```
  和 ceremony 里的 "Front face unlocked · Flip axis at 180°" 重复，且仍是 sci-fi 文案。
  **改法**：
  - 如果想要 ceremony→result 的连续感，afterglow pill 只保留 `LEG · just drawn` 这种简短状态；删除 `phaseCue`。
  - 或彻底移除 afterglow（A.7.1 文案改造后 ceremonyEcho 失去意义）。

- [ ] **P2 · A.8.7 · 18 SPARKS + 装饰层** — `DrawResultScreen.tsx:12-17, 191-208`
  和 DrawScreen.PARTICLES 重复实现。
  **改法**：抽 `src/features/gacha/components/Sparks.tsx`，DrawScreen 和 DrawResult 都用。

---

### A.9 BacklogBurstScreen 走 Settlement — `src/screens/BacklogBurstScreen.tsx:24`

- [ ] **P1 · A.9.1 · `navigation.navigate('Settlement', ...)`** — `BacklogBurstScreen.tsx:24`
  唯一另一个跳 Settlement 的入口。给 hardcoded `slug: 'csharp'` / `deckTitle: 'C# Interview'` / `rewardPulls: 2` / `masteredCount: 1`。
  **改法**：改跳 SessionSummary（或保留 Settlement 作 demo screen，但承认它不是真 session 出口）。本屏幕本身是 mock screen，结合 §E 一起处理。

---

## B · 图鉴 / 卡组 / 池子

### B.1 LibraryScreen — `src/screens/LibraryScreen.tsx`

✅ 已对齐 v7 §3.5：
- 浏览页角色清晰，无 launch 入口
- 4 项 filter（All / New / Learning / Mastered）
- 2 列 / 3 列响应式（width < 390）
- testID 完整
- 文件 319 行 < 400

需要修的：

- [ ] **P0 · B.1.1 · `vm.drawStatusLabel` 出现在 Library 里** — `LibraryScreen.tsx:175-177`
  ```tsx
  <Text style={styles.statusLine} numberOfLines={1}>
    {vm.drawStatusLabel}
  </Text>
  ```
  v7 §3.5.3 明确 Library 不承担 draw / mode launch。即便只是显示一个 label，也会让用户以为这里有抽卡入口。
  **改法**：删除 statusLine 这一段；如果 drawStatusLabel 在 mapper 里仍要算（其它消费方），保留 mapper 输出但 screen 不渲染。

- [ ] **P1 · B.1.2 · `'Open deck gate'` 文案对用户不明** — `LibraryScreen.tsx:249`
  empty state 主 CTA："Open deck gate"。"deck gate" 是 v7 内部叫法。
  **改法**：改为 `'Install a deck'` 或 `'Open Deck'`。

- [ ] **P1 · B.1.3 · 卡片 question `numberOfLines={1}`** — `LibraryScreen.tsx:264-266`
  v7 §4.1 `卡片 question numberOfLines={2}`。当前是 1，更激进。
  **改法**：改为 `numberOfLines={2}`。card minHeight 116（line 312）够 2 行 bodySmall。

- [ ] **P1 · B.1.4 · `statusBadge` 用单一 glowGold 不分状态** — `LibraryScreen.tsx:317`
  ```ts
  statusBadge: { ... backgroundColor: colors.glowGold }
  ```
  无论 state 是 `New` / `Learning` / `Mastered` 都同色，badge 失去信息量。
  **改法**：在 mapper 里输出 `tone: 'new' | 'learning' | 'mastered'`，screen 根据 tone 选 mint / gold / glowGold（仅用现有 token）。

- [ ] **P2 · B.1.5 · ListHeaderComponent 内联渲染**  — `LibraryScreen.tsx:164-226`
  60+ 行的 header inline 在 FlatList prop 里，可读性差。
  **改法**：抽成 `LibraryHeader` 内部组件 / 或独立文件 `src/features/gacha/library/LibraryHeader.tsx`。

---

### B.2 DeckScreen — `src/screens/DeckScreen.tsx`

✅ 已对齐 v7 §3.6：
- 单 gate（install/update/trial/paywall/sign-in/coming/none）
- 597 行 < 600（紧贴上限）
- `@v7 deck install gate only` 注释
- 无卡片网格、无 mode picker

需要修的：

- [ ] **P1 · B.2.1 · `'Deck gate'` eyebrow 是 jargon** — `DeckScreen.tsx:432`
  用户不知道 "gate" 是什么。
  **改法**：改为 `'Deck'` 或 `'Install'`（与当前 gate action 配合）。

- [ ] **P1 · B.2.2 · `'Remote version: 1.2.3'` 暴露版本** — `DeckScreen.tsx:451-454`
  ```
  Remote version: {state.updateInfo.remoteVersion}
  ```
  普通用户不需要看 manifest 版本。
  **改法**：删除整个 versionLine。如有需要保留给开发者，加 `__DEV__` 守卫。

- [ ] **P2 · B.2.3 · install 完成后强制跳 Library** — `DeckScreen.tsx:297, 312`
  install / update / trial-start 完成后总跳 Library。如果 user 通过 Home → Settings → 多 deck install 流程进来，他可能希望保留在原页面。
  **改法**：在 navigation params 上加 `returnTo?: 'home' | 'library' | 'settings'`，根据来源决定。本轮 v7 不强求。

---

### B.3 CardDetailScreen — `src/screens/CardDetailScreen.tsx`

⚠️ 全部 mock 实现。

- [ ] **P0 · B.3.1 · 没有真实 Q/A 内容** — `CardDetailScreen.tsx:11-50`
  CardDetail 不显示卡的 question / answer / IRL 三段——而 RecallSmith 的"原子单位是 Q/A/IRL 三段"（design-review-round2.md §A.1 Screen 02 已强调）。当前 panel 都是产品理论叙述。
  **改法**：
  1. 通过 `loadDeckProgress` + `resolveDeckBySlug` 拿真实 card 数据
  2. 显示 question / answer / IRL（参考 SessionCard 的 ReviewBody，但不接受评分）
  3. 显示真实 stage / due / lastReviewed（从 progress.find by id）

- [ ] **P0 · B.3.2 · panelBody 是 design rationale** — `CardDetailScreen.tsx:25, 30`
  ```
  "Recent ratings: Again → Hard → Good → Easy. Use this card to understand whether..."
  "Treat card detail like a real reference stop: enough context..."
  ```
  设计语言泄露给用户。
  **改法**：替换为真实 progress 状态（next due, stage, last result）。

- [ ] **P0 · B.3.3 · gradient `'#F5F3FF'` lavender 不一致** — `CardDetailScreen.tsx:17, 55`
  和 v7 parchment 主题冲突。
  **改法**：改 `[colors.parchmentBg, colors.parchmentBgDeep]`。

- [ ] **P1 · B.3.4 · 全屏 inline hex** — `CardDetailScreen.tsx:55-69`
  21 处。
  **改法**：用 theme tokens 重写。

---

### B.4 TagExplorerScreen / SortFilterScreen / AudienceFilterScreen / PoolPickerScreen / PoolOverviewScreen / PoolLaunchScreen / PausedPoolScreen / FreshStartLandingScreen / FreshStartConfirmScreen

这一堆是 mock-only / scaffold 屏幕，共同问题集中处理见 §E（统一 deprecated 处理）：
- 全部 inline hex
- 全部 mock data
- 全部 design-rationale 泄露文案
- 全部用 `'#F5F3FF'` lavender gradient
- 全部硬编码 fontSize / padding
- 全部 "Back to X" 反向导航 CTA

**特别项**：

- [ ] **P0 · B.4.1 · PoolPickerScreen 出现 "V6"** — `PoolPickerScreen.tsx:19`
  ```
  body="V6 uses this as the light-weight switcher between active pools and launch-ready pools."
  ```
  版本号泄露 + 设计语言泄露。
  **改法**：用户文案里全删 "V6 / v6 / phase A / phase B / B-system" 这类词；如果本屏 v7 不接入真实数据，直接走 §E 的"deprecated mock screen guard"。

- [ ] **P0 · B.4.2 · TagExplorerScreen title 用 raw poolId** — `TagExplorerScreen.tsx:17`
  ```
  <Text style={styles.title}>{route.params.poolId} tag coverage</Text>
  ```
  显示成 `csharp tag coverage`（小写 slug），没有 textTransform。
  **改法**：从 manifest 读 deck title；或改成 `'Tag coverage'` 不带 poolId。

---

## C · 计划 / 复习 / Backlog

所有 Plan*Screen 使用共享的 `ParchmentScaffold` 组件（好），但 body 文案全部是 design rationale（不好）。

- [ ] **P0 · C.1 · PlanOverviewScreen / PlanTodayScreen / PlanWeekScreen / PlanMonthScreen body 文案全部泄露设计语言** — `PlanOverviewScreen.tsx:16-19`、`PlanTodayScreen.tsx:14-15`、`PlanWeekScreen.tsx:14-15, 24`、`PlanMonthScreen.tsx:17, 23-24`
  例：
  - `'Turn planning into a calm support surface'`
  - `'Bar rows are framed as a planner artifact rather than raw instrumentation.'`
  - `'Density is shown as collectible tiles instead of generic grid blocks.'`
  - `'Long-range planning now feels like a parchment heat map.'`
  **改法**：替换为说明用户能做什么的句子。例：
  - PlanOverview body → `'See today's load, this week's curve, and what's coming up next month.'`
  - PlanToday body → `'New cards proposed today plus the review pressure already due.'`
  - PlanWeek body → `'7-day forecast — heavy days are easier to spot before they pile up.'`
  - PlanMonth body → `'30-day load. Darker tiles = more cards due that day.'`

- [ ] **P0 · C.2 · BacklogWarningScreen / BacklogBurstScreen / DormantNudgeScreen body 同病** — `BacklogWarningScreen.tsx:17`、`BacklogBurstScreen.tsx:17`、`DormantNudgeScreen.tsx:18`
  例：
  - `'Backlog warning reframes pressure into options'`
  - `'Burst is the high-pressure recovery option. It should feel deliberate, not like the app is punishing the user.'`
  **改法**：改为用户视角（"What's next"）：
  - BacklogWarning body → `'Your queue is growing. Pick a way to unstack it.'`
  - BacklogBurst body → `'Run a focused {N}-card recovery, then a smaller route tomorrow.'`
  - DormantNudge body → 已经 OK（用 fixture 的 lastSessionSummary）

- [ ] **P1 · C.3 · WeekPlannerPromptScreen secondary CTAs 太散** — `WeekPlannerPromptScreen.tsx:25-32`
  3 个并列 CTA：Save and go home / Back to week plan / Open month rewind。
  **改法**：删除 month rewind（不属于"planner prompt"任务）。保留 Save + Back。

- [ ] **P2 · C.4 · 全部 plan/backlog 屏幕 mock-only**
  Plan / Backlog 都不接 review/storage 真实数据。本轮 v7 不在 phase 内，留 §E 集中标注。

---

## D · 仪式 / 里程碑 / 成就 / 设置 / 账户 / Onboarding / 系统

### D.1 通用模式（涵盖几乎全部本节屏幕）

这一类屏幕都是 `AppInfoScreen`-mock 实现，问题高度同构：

- [ ] **P0 · D.1.1 · 文案/标题泄露 v6 / phase / B-system jargon** — 全局命中
  ```
  src/screens/AboutScreen.tsx:18:        { title: 'Build', subtitle: 'RecallSmith mobile v6 candidate build' },
  src/screens/AboutScreen.tsx:25:        { title: 'Product', subtitle: 'RecallSmith v6' },
  src/screens/CollectionMilestoneScreen.tsx:18: ...phase-A ceremony for owned-card progress before Hall lands in phase B.
  src/screens/FreePullGrantScreen.tsx:18: ...part of the B-system reward layer
  src/screens/MasteredCelebrationScreen.tsx:18: ...This is the v6 shell for the higher-energy mastery moment.
  src/screens/MasteryMilestoneScreen.tsx:18: ...This is the base phase-A mastery ceremony so settlement can hand off
  src/screens/PermissionPromptScreen.tsx:17: ...In v6 this sits after first draw...
  src/screens/PoolPickerScreen.tsx:19: V6 uses this as the light-weight switcher
  src/screens/StreakMilestoneScreen.tsx:17: ...is now a real B-system route
  src/screens/WelcomeScreen.tsx:16: ...v6 is built around small daily closure.
  src/screens/WelcomeScreen.tsx:54: What changes in phase A
  ```
  AGENTS.md §4 + v7 §3.2.3 都禁止 MVP / placeholder / coming soon 类 jargon。version 号 / phase 名属于同类问题。
  **改法**：grep 一遍 `src/screens/*.tsx`，替换：
  - `v6` / `V6` → 直接删除该句或换成"今天"/"现在"
  - `phase A/B` → 删
  - `B-system` → 删
  - `MVP` / `placeholder` / `shell` / `scaffold` / `front-end build` → 删
  
  如果删完整段就空了，保留 stats / sections，删掉 body 段落。

- [ ] **P0 · D.1.2 · ErrorNetworkScreen 用 banned word `'lost'`** — `ErrorNetworkScreen.tsx:12`
  ```
  title="Connection lost, but your route is still safe"
  ```
  AGENTS.md §4 文案禁用词 `lost`。
  **改法**：title 改为 `'Offline for now — your route is still safe'`。

- [ ] **P1 · D.1.3 · MoreScreen 主 CTA 跳 mock Profile** — `MoreScreen.tsx:43-47`
  当前底部 tab `Me` → MoreScreen → primary `Profile`（mock）/ secondary `SettingsMain`（mock）/ tertiary `Help`（mock）。**真正可用的设置屏 `Settings` 不在 MoreScreen 入口里**。用户从 `Me` tab 进来根本到不了真 settings。
  **改法**：
  1. 把 `secondaryLabel='Settings'` 的 onSecondary 改为 `navigation.navigate('Settings')`（真 SettingsScreen），而不是 SettingsMain（mock）。
  2. `primaryLabel='Profile'` 暂时降级为 secondary，或在 §E 一并 deprecate ProfileScreen 后改为 `Settings` 主入口。

- [ ] **P1 · D.1.4 · `'tier' + 'poolId'` 显示原始 slug** — `CollectionMilestoneScreen.tsx:16`、`MasteryMilestoneScreen.tsx:16`
  `{tier} collection reached in {poolId}` → "bronze collection reached in csharp"
  **改法**：从 manifest 读 deck title；tier 加 textTransform: 'capitalize'。

- [ ] **P1 · D.1.5 · MilestoneDetailScreen 里 `route.params.milestoneId` 当用户可见 metadata** — `MilestoneDetailScreen.tsx:26-29`
  ```
  <Text style={styles.summaryValue}>{route.params.milestoneId}</Text>
  <Text style={styles.summaryLabel}>Milestone id</Text>
  ```
  把 raw id（如 `bronze-collect`）当 stat 展示。
  **改法**：删除这一格 summaryCard。

- [ ] **P1 · D.1.6 · CollectionMilestone / MasteryMilestone 主 CTA 是 "Back to settlement" 但带硬编码 slug** — `CollectionMilestoneScreen.tsx:21-23`、`MasteryMilestoneScreen.tsx:21-23`
  ```ts
  navigation.navigate('Settlement', { slug: 'csharp', deckTitle: 'C# Interview', ... })
  ```
  从 `Settlement → CollectionMilestone → Back to settlement` 形成循环 + 硬编码 slug。
  **改法**：用 navigation.goBack()；不要硬编码 slug。

- [ ] **P1 · D.1.7 · Welcome 引导文案存在版本号** — `WelcomeScreen.tsx:16, 54`
  见 D.1.1。

- [ ] **P1 · D.1.8 · PermissionPrompt "Allow" / "Not now" 都跳同一目的地** — `PermissionPromptScreen.tsx:19-22`
  ```
  Allow and continue → Home(firstDrawCoach: true)
  Not now → Home(firstDrawCoach: true)
  ```
  实际没接 OS notification permission。是 fake permission flow。
  **改法**：调用 `Notifications.requestPermissionsAsync()`（已在 expo-notifications 依赖里）。`Allow` 才请求，`Not now` 直接跳过。本轮如果不接，至少把"Allow"按钮改为 `Continue` 不要骗用户它做了什么。

- [ ] **P1 · D.1.9 · ProfileScreen 全部 mock + 真实数据应来自 Settings** — `ProfileScreen.tsx`
  ProfileScreen 用 `MOCK_USER` 渲染 streak / weekStreak / audience / accountMode。SettingsScreen 已经有真 streak / authStore email / audience。重复实现。
  **改法**：要么 ProfileScreen 用真实数据（同 SettingsScreen 数据源），要么走 §E 标 deprecated。

### D.2 SettingsScreen — `src/screens/SettingsScreen.tsx`

✅ 已对齐 v7 §3.7：
- 480 行 < 800
- 子 region 已抽到 `src/features/gacha/settings/{account,content,reminders,appearance,about,debug}/...`
- 文案压缩（结果腔，不是原理腔）
- DebugSection `__DEV__` 守门
- testID 主 CTA

需要修的：

- [ ] **P1 · D.2.1 · "Premium" section 对已 premium 用户也显示** — `SettingsScreen.tsx:326-341`
  没有 `if (!isPremium)` 守门。已订阅用户会看到 "Open premium" 入口。
  **改法**：包一层 `{!isPremium ? (<View>...</View>) : null}`。

- [ ] **P1 · D.2.2 · `Account, content, reminders, and app basics.` 标题列表化** — `SettingsScreen.tsx:286-288`
  把所有 section 列在 title 里，反而稀释信息。
  **改法**：删除 title，eyebrow `Settings` 已经够了。

- [ ] **P2 · D.2.3 · header eyebrow + `Close` 按钮的视觉次序** — `SettingsScreen.tsx:275-284`
  Close 在右上 OK，但视觉权重和 eyebrow 一致。改为 chevron icon。

### D.3 SignInScreen / SignUpScreen / ConfirmSignUpScreen

- [ ] **P1 · D.3.1 · gradient lavender 不一致** — `SignInScreen.tsx:77`、`SignUpScreen.tsx`、`ConfirmSignUpScreen.tsx`
  用 `['#F5F3FF', '#E0F2FE']`（紫蓝），整个 v7 主题是 parchment + cosmic ceremony。
  **改法**：改 `[colors.parchmentBg, colors.parchmentBgDeep]`。需要同步改三个 auth 屏。

- [ ] **P1 · D.3.2 · SignInScreen subtitle 14 词在 360pt** — `SignInScreen.tsx:104`
  `'Sign in to restore your study progress, sync, and account recovery.'` —— "study progress, sync, and account recovery" 三件事并列冗长。
  **改法**：压成 `'Sign in to sync progress across devices.'`

### D.4 SplashScreen — `src/screens/SplashScreen.tsx`

- [ ] **P2 · D.4.1 · tagline `'Adaptive study, wrapped like a ritual.'`** — `SplashScreen.tsx:31`
  和 v7 §3.2.3 "不再是 MVP 骨架感"对齐良好；但 "wrapped like a ritual" 偏文学。Splash 出现时间极短（<1s），可保留。

- [ ] **P2 · D.4.2 · inline hex** — `SplashScreen.tsx:28-32, 43-46`
  6 处。改 token。

### D.5 PaywallScreen — `src/screens/PaywallScreen.tsx`

- 复杂 RevenueCat 集成，体量 375 行。其本身在 v7 §2.1 "src/premium/* 不许动" 边缘——逻辑不动，但 UI 里也有 inline hex / 文案。
- [ ] **P1 · D.5.1 · 中文注释残留** — `PaywallScreen.tsx:31, 73, 99`
  代码注释含 `// ✅ 更鲁棒：...`。可保留但建议统一英文以方便他人维护。**P2**。

### D.6 LevelScreen — `src/screens/LevelScreen.tsx`

⚠️ **架构问题**：与 SessionCardScreen 是并行的两套 review 实现。LevelScreen 是 v6 路径（DailyDose / Draw result → Level），SessionCardScreen 是 v7 路径（Challenge → SessionCard）。

- [ ] **P0 · D.6.1 · `deckTitleForSlug` 硬编码** — `LevelScreen.tsx:39-41`
  同 DrawScreen.tsx:126 / DrawResultScreen.tsx:67。
  **改法**：见 §E.1（统一处理）。

- [ ] **P0 · D.6.2 · `demoteText` 含 banned 边缘词** — `LevelScreen.tsx:79`
  `'... You did not lose it — it will cycle back later.'`
  AGENTS.md §4 禁用 lost/missed 等。`'did not lose'` 在 grep 里命中（`grep -E "(lost|missed|...)"`），属边缘违规。
  **改法**：改为 `'... It will cycle back when timing is right.'`

- [ ] **P1 · D.6.3 · LevelScreen 整体 mock-only**
  cards 来自 `buildMockSessionCards`，settlement 跳转写死。本质是 v6 演示路径，应在 v7 phase D 收尾时 deprecate（连同 DailyDose / Draw → Level 路由），统一改走 SessionCard。

- [ ] **P2 · D.6.4 · 大量 inline hex** — `LevelScreen.tsx:32-36`、`82` 起到末尾。
  同 §E。

---

## E · Deprecated / mock-only 屏幕处理

### E.1 应统一处理的文件清单

下列屏幕在 v7 期间不属于"该投入精力打磨"的范围，但需要明确标记 + 统一兜底，避免误改：

| 文件 | 状态 | 处理 |
|---|---|---|
| `src/screens/ReviewScreen.tsx` | v7 §5.4 已 deprecated | ✓ 已处理（保留可运行）|
| `src/screens/LevelScreen.tsx` | 与 SessionCardScreen 重复 | 加 `@deprecated v7 — replaced by SessionCardScreen`，并把 DailyDoseScreen / DrawResultScreen / BacklogBurstScreen 跳 `Level` 的地方改为跳 `SessionCard` |
| `src/screens/SettlementScreen.tsx` | 见 §A.5 | 加 `@deprecated v7 — replaced by SessionSummaryScreen`，BacklogBurstScreen:24 跳转改 SessionSummary |
| `src/screens/CardDetailScreen.tsx` | mock | 接真实卡数据 OR 标 deprecated |
| `src/screens/TagExplorerScreen.tsx` | mock | 标 deprecated（v7 §0.3 不做 multi-pool）|
| `src/screens/SortFilterScreen.tsx` | mock，未在主链路使用 | 标 deprecated 或检查 navigation entry，删 route|
| `src/screens/AudienceFilterScreen.tsx` | mock | 标 deprecated（真 audience 在 SettingsScreen 的 ContentSection）|
| `src/screens/PoolPickerScreen.tsx` | mock | 标 deprecated（v7 不做 multi-pool）|
| `src/screens/PoolOverviewScreen.tsx` | mock | 标 deprecated |
| `src/screens/PoolLaunchScreen.tsx` | mock | 标 deprecated |
| `src/screens/PausedPoolScreen.tsx` | mock | 标 deprecated |
| `src/screens/FreshStartLandingScreen.tsx` | mock | v7 不引入自动 Fresh Start 弹窗（§0.3）。标 deprecated |
| `src/screens/FreshStartConfirmScreen.tsx` | mock | 同上 |
| `src/screens/PlanOverviewScreen.tsx` 等 5 个 Plan* | 全部 mock | §0.3 v7 明确不做。标 deprecated |
| `src/screens/BacklogWarningScreen.tsx` / BacklogBurstScreen / DormantNudgeScreen | mock | 标 deprecated |
| `src/screens/MilestoneHallScreen.tsx` / MilestoneDetailScreen / AchievementsScreen | mock | v7 §0.3 不做 Mastery Hall。标 deprecated |
| `src/screens/CollectionMilestoneScreen.tsx` / MasteryMilestoneScreen / MasteredCelebrationScreen / StreakMilestoneScreen / WeekStreakMilestoneScreen | mock 仪式 shells | v7 §0.3 不做 milestone ceremony。标 deprecated |
| `src/screens/DailyDigestScreen.tsx` / DailyDoseScreen / WeekSummaryScreen / MonthRewindScreen / MonthSummaryScreen | mock | 标 deprecated（v7 §0.3 不做 Week/Month Summary）|
| `src/screens/FreePullGrantScreen.tsx` / FreePullInventoryScreen | mock | v7 不做 free pull inventory UX。标 deprecated |
| `src/screens/SettingsMainScreen.tsx` 等 6 个 SettingsXxxScreen | mock，与真 SettingsScreen 重复 | 标 deprecated；MoreScreen 入口指向真 SettingsScreen（D.1.3）|
| `src/screens/ProfileScreen.tsx` / EditProfileScreen / AboutScreen / HelpFAQScreen / DebugMenuScreen / CoachOverlayScreen / OfflineBannerScreen / ToastHostScreen / ErrorNetworkScreen / ErrorGenericScreen | mock | 各自标 deprecated 或接真实数据 |

### E.2 推荐执行流程

1. **加 `@deprecated` 注释**（首行 JSDoc）。例：
   ```ts
   /** @deprecated v7 — mock-only screen; do not invest visual polish here. */
   ```

2. **挂"Deprecated demo"角标**：在每个 deprecated 屏幕的 eyebrow 旁边渲染一个小红 chip `[DEMO]`，仅在 `__DEV__` 下显示。这样 QA / 设计师扫一眼能区分真假。

3. **不要再为它们做以下任何工作**（v7 范围外）：
   - 抽 token / 改 inline hex
   - 改 mock 数据接真接口
   - 加 numberOfLines / 测试
   - 改文案

4. **Phase D 收尾时**：
   - 检查 `src/navigation/RootNavigator` 是否还指向 deprecated 路由
   - 把不再被任何主链路指向的 deprecated 屏幕从 `RootStackParamList` 中删除（AGENTS.md 允许"新增"，删除谨慎处理）
   - 统一删 `src/mock/*` 中只服务于 deprecated 屏幕的 fixtures

---

## F · 横切问题（不属于单屏）

### F.1 Theme token 蔓延

- [ ] **P0 · F.1.1 · v7 修过文件中的 inline rgba** — Home / Challenge / Session* / Library / Deck / Settings 都有零散 rgba 字面量（详见各屏 P2 项）。
  AGENTS.md §4 + v7 §4.3 严格只 grep `#hex`。但 rgba 同样违反 token 约束。
  **改法**：保留现状（grep 不命中）但在该文件顶部抽 `const TOKENS = { ... } as const;`，避免今后扩散。**作为 Phase D 收尾的一个统一收口任务**。

### F.2 deck title 硬编码三连发

`'aws' ? 'AWS SAA' : 'C# Interview'` 出现在：
- `src/screens/DrawScreen.tsx:126`
- `src/screens/DrawResultScreen.tsx:67`
- `src/screens/LevelScreen.tsx:39-41`

- [ ] **P0 · F.2.1 · 抽公共 `resolveDeckTitle` helper**
  ```ts
  // src/features/gacha/library/deckTitleResolver.ts
  export async function resolveDeckTitle(slug: string): Promise<string> {
    const deck = await resolveDeckBySlug(slug);
    return deck?.Title ?? slug;
  }
  ```
  三处都改成 await 这个 helper（或同步缓存版本）。

### F.3 ceremonyEcho / phaseCue 文案泄露

`Front face unlocked · Flip axis at 180°` / `Center card revealed last · Flip axis at 180°` / `LEG core breach` 等出现在：
- `src/screens/DrawCeremonyScreen.tsx:144-148, 187-198, 304-310`
- `src/screens/DrawResultScreen.tsx:223-234`
- `src/navigation/types.ts:108-111`（ceremonyEcho 类型定义）

- [ ] **P0 · F.3.1 · 集中替换**
  详见 §A.7.1。`ceremonyEcho.phaseCue` 字段值都来自这两个文件，改完字符串源即可。`navigation/types.ts` 字段类型可保留（仅允许新增；不动现有）。

### F.4 navigation tab "Me" 走不到真 Settings

详见 §D.1.3。

### F.5 wallet/pulls 单位语义不清

DrawScreen:134-138 中：
```ts
const result = previewOnly ? null : await consumePullsFromStoredWallet(1);
const drawResult = buildPoolDrawResult(slug, pityBefore, drawCount);
```

调用时 `drawCount = 10`（Open 10 pull）但 `consumePullsFromStoredWallet(1)` —— 1 pull 还是 1 个 10-card 包？目前所有逻辑像是"1 pull = 10 cards"，但没有显式约定。

- [ ] **P1 · F.5.1 · 在 `rewardWallet.ts` 顶部加约定注释**：
  ```ts
  /** A single "pull" yields 10 cards (one ceremony). The wallet stores pulls, not cards. */
  ```
  并在 `consumePullsFromStoredWallet` 文档中明确 cost。如果实际语义是 1 pull = 1 card，则 DrawScreen.tsx 的 `Open 10 pull` 应改为 `Open 10 pulls (consume 10)` 并 consume 10。本轮**不动 src/sync / src/premium 内核**（AGENTS.md §3），但 DrawScreen 调用方需要改对。

### F.6 文案禁用词全局守门

AGENTS.md §4 禁用 `lost/missed/forfeit/wasted/expired/gone`，目前的 `npm run` 脚本只 grep `summaryMapper.ts`：
```bash
grep -nE "(lost|missed|forfeit|wasted|expired|gone)" src/features/gacha/session/summaryMapper.ts
```

- [ ] **P0 · F.6.1 · 把守门扩展到全 screens**
  在 AGENTS.md §5 / package.json 加：
  ```bash
  grep -rnE "(lost|missed|forfeit|wasted|expired|gone)" src/screens/*.tsx src/features/gacha/**/*.tsx src/features/gacha/**/*.ts
  ```
  当前只命中 `ErrorNetworkScreen.tsx:12 'Connection lost'`（见 D.1.2）。修复后这条 grep 应为空。

### F.7 v7 修过的文件 inline hex 守门

```bash
grep -nE "#[0-9A-Fa-f]{6}" src/screens/HomeScreen.tsx src/screens/ChallengeScreen.tsx src/screens/SessionCardScreen.tsx src/screens/SessionSummaryScreen.tsx src/screens/LibraryScreen.tsx src/screens/DeckScreen.tsx src/screens/SettingsScreen.tsx
```
当前为空 ✓，**不能让 Codex 后续 patch 破坏这条守门**。任何 patch 都应在改完后跑这条 grep。

### F.8 SessionProgressHeader 调色板异类

详见 §A.3.2。`src/features/gacha/components/SessionProgressHeader.tsx` 是 v7 hot-path 上的组件，但调色板是 indigo 系。整个 v7 chain 视觉冲突。

### F.9 测试缺口（v7 §6 要求）

v7 §6.2-6.3 列出新增测试：
- `tests/unit/homeSelectors.spec.ts` — 9 个 HomeVM 状态枚举
- `tests/unit/summaryMapper.spec.ts` — 4 种 wallet 状态 + 文案禁用词检查
- `tests/unit/libraryMapper.spec.ts` — 4 种 filter
- `tests/unit/deckActionResolver.spec.ts` — install/update/trial 三种分支
- `tests/integration/home-primary-cta.spec.tsx`
- `tests/integration/summary-reward-priority.spec.tsx`
- `tests/integration/library-360-columns.spec.tsx`
- `tests/integration/deck-no-launch.spec.tsx`

- [ ] **P1 · F.9.1 · 跑一次 `npm run test:unit` / `test:integration` 看实际覆盖率**
  本评审只跑了 typecheck（pass）。Codex 在每次 patch 后应该把这 8 个 spec 都跑一遍，任何 fail 必须 fix；如缺失，按 v7 §6.2-6.3 补齐。

---

## G · 推荐 patch 批次

| 批次 | 包含 | 估算 | 依赖 |
|---|---|---|---|
| **Batch 1** · v7 主链路文案/逻辑 P0 | A.1.1, A.1.2, A.1.3, A.1.4 / A.3.1, A.3.2 / A.4.1 / A.6.1, A.6.2, A.6.3, A.6.4, A.6.5 / A.7.1, A.7.2 / A.8.1, A.8.2, A.8.3, A.8.4 / B.1.1 / B.3.1, B.3.2, B.3.3 / D.1.2 / D.6.1, D.6.2 / F.2.1, F.3.1, F.6.1 | 1.5 天 | 不依赖其他批次 |
| **Batch 2** · v7 主链路 P1 | A.2.1, A.2.2 / A.3.3, A.3.4 / A.4.2, A.4.3 / A.5.3, A.5.4 / A.6.6 / A.7.3 / A.8.5, A.8.6 / B.1.2, B.1.3, B.1.4 / B.2.1, B.2.2 | 1 天 | 在 Batch 1 之后 |
| **Batch 3** · Deprecated 标记 | §E 整章；§D.1.1 文案 jargon 全局清理 | 0.5 天 | 不依赖其他批次（可与 Batch 1 并行）|
| **Batch 4** · Settings/账户/onboarding | D.1.3, D.1.7, D.1.8 / D.2.1, D.2.2 / D.3.1, D.3.2 | 0.5 天 | 在 Batch 1 之后 |
| **Batch 5** · 横切收口 | F.1.1（rgba token化）/ F.4 / F.5.1 / F.7 / F.8（SessionProgressHeader 配色）/ F.9.1（补测试）| 0.5 天 | 最后 |

**总计**：约 4 天 Codex 工作量，对应 v7 Phase A→D 完整收尾。

---

## H · 一句话总结

Codex 这一版 v7 主链路（Home / Challenge / Session / Summary / Library / Deck / Settings）的**结构已经到位**：单主 CTA、文件瘦身、testID、loading/empty/error 三态都按 v7 §3 落地了。

但还有两类问题没收：

1. **Draw / Ceremony / Result 三屏的 sci-fi 文案**（A.7.1）和 mock 数据 / 硬编码 deck title（A.6.1, F.2.1）—— 这是用户真正会看见的"违和感来源"。
2. **Mock screens 群** —— 50% 的屏幕是 v6.1 留下的演示 shell，文案里到处是 "v6 / phase A / B-system" 这种内部黑话，AppInfoScreen 一看就能识别。这堆不打算在 v7 修，**但必须明确标 deprecated**，否则下一轮 Codex 会无差别"打磨"它们，浪费时间还可能误删。

把上面 Batch 1-5 跑完，v7 §0.2 的 6 条成功标准就基本满足。再往后才轮到 Week Streak / Mastery Hall / Multi-pool。
