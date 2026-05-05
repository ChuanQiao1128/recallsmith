# v9 Screen Diff (overrides v8 for 5 screens)

**读法**：先读 `v9-reference-aligned-spec.md` 拿到产品判断，再读这份做实施。本文档**覆盖** v8-screen-diff.md 中同名屏幕（Home / Draw / DrawCeremony / DrawResult / Library）的内容。其余 5 屏（Challenge / SessionCard / SessionSummary / Deck / Settings）继续按 v8 实施。

所有共享组件（`<Screen>`、`<PrimaryCTA>`、`<SecondaryCTA>`、`<RewardCard>`、`<Stat>`、`<Sheet>`）、设计令牌、a11y 基线、依赖清单 — 全部继承 v8。

每节结构：**Why · v9 layout · Component tree · State · Motion · TestIDs · Edge cases · Implementation notes**。

---

## 1. HomeScreen — 卡包入口化

### Why

v8 把 Home 设计成"今天该学什么"的决策卡。v9 重定位为"今天开哪个包"。学习入口降权为底部链接，但仍可达。这是产品方向的真正转折点 — Home 第一屏告诉用户 RecallSmith 是个卡包产品，学习是它的引擎。

### v8 → v9 layout

去掉：
- v8 的 `HomeHeroCard`（"12 cards waiting"）。
- v8 的 `StatusStrip`（streak/today/pulls 三 stat）— 这套数据迁到 Settings momentum strip。

保留：
- v8 的 `HomeHeader`（左上角是品牌 wordmark，右上角 settings cog）。
- pull-to-refresh。

新增：
- `<PackCarousel>`：水平卡包列表，焦点卡居中，相邻卡边缘可见。
- `<PackFocusMeta>`：焦点卡下方一行 "{pulls} pulls · {due} due"。
- 底部文字链 `Study {n} due cards` → 进入 `Challenge`。
- 首次进入做一次"卡包浮入"动画（仅首次会话），引导用户理解"卡包是主体"。

### Component tree

```tsx
<Screen register="reward" testID="screen-home-root" refresh={refresh} scrollable={false}>
  <HomeHeader onSettings={...} testID="home-header" />
  <PackCarousel
    packs={ready.packs}
    focusedSlug={ready.focusedSlug}
    onFocusChange={setFocusedSlug}
    onPackPress={openDraw}
    testID="home-pack-carousel"
  />
  <PackFocusMeta
    pulls={ready.focused.walletPulls}
    due={ready.focused.dueCount}
    testID="home-focus-meta"
  />
  <PrimaryCTA
    label={`Open ${ready.focused.deckTitle}`}
    onPress={() => openDraw(ready.focusedSlug)}
    testID="screen-home-primary-cta"
  />
  <StudyLink
    label={`Study ${ready.totalDue} due cards`}
    onPress={openChallenge}
    visible={ready.totalDue > 0}
    testID="home-study-link"
  />
</Screen>
```

注意：v9 Home 是 **reward register**（cosmic 渐变），不是 v8 的 study register。这是把"Home 属于奖励循环"具象化的一步。

### State

```ts
type HomeReady = {
  packs: Array<{
    slug: string;
    deckTitle: string;
    coverAsset: string;        // 来自 deckRepository
    accent: string;            // 主题色，从 deck manifest 或回落到 colors.glowGold
    walletPulls: number;
    dueCount: number;
    canOpen: boolean;          // walletPulls > 0
  }>;
  focusedSlug: string;          // 默认 = active deck slug 或第一个 pack
  focused: HomeReady['packs'][number];  // 派生
  totalDue: number;             // 跨所有 pack 的 due 总和
};
```

`useHomeViewModel()` 替换 v7 现有的 `homeSelectors.ts` 视图层（selectors 内核保留，外壳重写）。

### Motion

- PackCarousel 滚动：用 `react-native-reanimated` `useScrollViewOffset` 驱动 scale/opacity 插值。焦点卡 `scale=1.0`，相邻卡 `scale=0.86`，更外侧 `scale=0.78 opacity=0.35`。
- 进入屏幕时：每张卡包从 y+40 升到 y=0，stagger 80ms。仅首次进入；后续 mount（从其他屏返回）走静态布局。用 AsyncStorage flag `home:v9:hasMounted` 记录。
- 焦点切换：spring transition，无横向 snap 抖动。
- PrimaryCTA 文案随 focused 卡变化时做 240ms crossfade（不要瞬切，避免读者跟不上）。

### TestIDs

继承自 v8 Home（保留）：
- `screen-home-root`
- `screen-home-primary-cta`
- `home-header`
- `home-first-draw-link`（v9 不显示，但保留 ID 以兼容 v7 测试 — 在 v9.1 删除）

v9 新增：
- `home-pack-carousel`
- `home-pack-card-{slug}`（每个 PackCard 的 testID 模板）
- `home-focus-meta`
- `home-study-link`

v8 计划但 v9 删除：
- `home-status-strip`（v8 §1 提到的 3-stat 状态条 — v9 不渲染）
- v8 中 `home-collapse-decks-toggle` 和 `home-collapse-week-support-toggle` 已在 v8 中删除，v9 保持删除。

### Edge cases

- **Loading**：carousel 占位 3 张灰色卡片（不闪屏）。
- **Error**：屏幕中央 retry 卡，无 carousel。
- **Empty (no decks installed)**：carousel 显示一张 "Install your first deck" 占位卡，点击进入 Library 的 deck-install 流程。
- **No active deck slug**：focused = packs[0]。
- **All decks installed but no pulls anywhere**：PrimaryCTA 仍显示 `Open {deckTitle}`，但 disabled，文字 hint "Earn pulls in study"。底部 study link 强化（加图标 + 加粗）。

### Implementation notes

- 卡包 cover 资产：v9.0 不引入新资产管线。codex 复用 deck manifest 已有的 cover 字段（如不存在，临时用 `colors.glowGold` + deck title 大字做 placeholder）。资产管线在 v9.1 处理。
- carousel 使用 `react-native-reanimated`'s `Animated.ScrollView` + `useAnimatedScrollHandler`，不要用 FlatList（FlatList 的 viewability 回调和 carousel 焦点逻辑会打架）。
- PackFocusMeta 数字变化做 count-up（共用 v8 §3.3 `<Stat>` 组件的内部动画工具）。

---

## 2. DrawScreen — 极简两按钮

### Why

v9 的硬约束："reward draw 图片下面放两个按钮就行，其他都删掉"。v8 在 Draw 上已经简化到两按钮 + 底部 pity bar + 多确认 sheet。v9 进一步：pity 改隐式（无视觉条），audience label 删除，钱包数字进入 hero 一并显示。屏幕上**只剩**：返回、卡包大图、双按钮。

### v8 → v9 layout

去掉：
- v8 的 `<DrawMeta>` 整块（deckTitle、audienceLabel、wallet meta 全删）。
- v8 的 `<PityBar>` — 不再可见。pity 仍在内部 state，仅用于驱动 ceremony 内的稀有度暗示。
- v8 的 multi-confirm sheet — v9 不要这一步（用户从 Home 选了卡包，再从 Draw 二次确认 = 三次决策，太重）。

保留：
- 卡包大图（v8 `<DrawHero>` → v9 `<DrawPackHero>`，复用 v9 §1 的卡包 visual 定义）。
- 两按钮：`Open 1` / `Open 10`（注意：v9 把"主"和"副"的位置反过来 — Open 1 在上、Open 10 在下，因为 Open 1 是更常见的入门选择，但**视觉权重**仍是 Open 10 > Open 1，通过填充色和大小拉开）。

新增：
- 卡包大图右上角小角标显示 wallet pulls：`× 7`，纯数字 + 卡包图标。
- 长按 `Open 10` 显示 quick-tip "Spend 10 pulls now" — 不阻断，不需要确认。

### Component tree

```tsx
<Screen register="reward" testID="screen-draw-root" scrollable={false}>
  <DrawHeader onBack={...} testID="draw-header" />
  <DrawPackHero
    pack={ready.pack}
    walletPulls={ready.wallet.availablePulls}
    testID="draw-card-stack-stage"
  />
</Screen>
<FixedFooter direction="column" gap={spacing.xs}>
  <PrimaryCTA
    label="Open 10"
    onPress={pullMulti}
    disabled={!ready.canPullMulti}
    testID="screen-draw-primary-cta"
  />
  <SecondaryCTA
    label="Open 1"
    onPress={pullSingle}
    disabled={!ready.canPullSingle}
    testID="screen-draw-secondary-cta"
  />
</FixedFooter>
```

### State

```ts
type DrawReady = {
  pack: {
    slug: string;
    deckTitle: string;
    coverAsset: string;
    accent: string;
  };
  wallet: { availablePulls: number; reservePulls: number };
  canPullSingle: boolean;
  canPullMulti: boolean;
  pity: { progress: number; ceiling: number };  // 内部 state，不渲染
};
```

`useDrawViewModel(slug)` 继承 v8 的 hook 名，但移除 audience pref / pityBar 相关字段。pity 仍计算并传递给 ceremony route 参数。

### Motion

- 卡包大图：persistent breathing — `scale: 1.0 ↔ 1.02, 4s loop`，`rotate: -1° ↔ 1°, 6s loop`，互不同步。这是 v9 的"包在等你"暗示。reduced motion 下完全静止。
- 按钮按下：scale 0.97（继承 v8 `<PrimaryCTA>` 默认）。
- 提交开包后：卡包做 240ms 加速旋转 + 缩小到 0.8，背景渐黑，再 navigate 到 Ceremony — 这一段是 Draw → Ceremony 的视觉桥接，不是 Ceremony 的开始。

### TestIDs

继承自 v8（保留）：
- `screen-draw-root`
- `draw-card-stack-stage`
- `screen-draw-primary-cta`
- `screen-draw-secondary-cta`

v9 新增：
- `draw-header`
- `draw-pack-pulls-badge`

v8 计划但 v9 删除：
- `draw-pity-bar`
- `draw-meta-wallet`
- `draw-multi-confirm-sheet`
- `draw-multi-confirm-yes`
- `draw-multi-confirm-no`

### Edge cases

- **Loading**：卡包占位 + 双按钮 disabled + 灰色。
- **Error**：卡包替换为 retry 卡片，按钮隐藏。
- **Empty (0 pulls)**：双按钮均 disabled，背后浮一行小字 "Earn pulls by studying"，点击 = 跳 Challenge。
- **Single-only (1 pull)**：Open 10 disabled（视觉上灰但仍可见，告知"目标"），Open 1 active。
- **Reduced motion**：卡包静止，提交也不做旋转 — 直接 navigate。

### Implementation notes

- `<DrawPackHero>` 和 v9 §1 `<PackCard>` 共享 `<PackVisual>` 内核组件（封面 + accent halo + 数字角标），但 hero 版本尺寸更大、glow 更强。
- 移除 v8 的 audience preference 显示**不**意味着移除 audience 逻辑 — 后端逻辑保留，仅 UI 不显示。Audience 偏好的入口走 Settings。
- 角标 `× 7` 数字使用 `typography.counter`（tabular-nums），变化时做 240ms count-up。

---

## 3. DrawCeremonyScreen — 5 阶段商业级节奏

### Why

v8 写了 4 阶段（warmup / focus / lock / reveal），v9 改 5 阶段（approach / hold / tear-flip / flash-reveal / settle）— 多出来的 **hold** 是关键。v8 的 lock 阶段有"短暂凝滞"的意图，但只持续到下一个动作过渡，没真正"卡住"。v9 的 hold 是显式的"完全静止 ≥ 300ms"，制造"要开了"的悬念。

### v8 → v9 layout

去掉：
- v8 的 `MultiCeremonyPhase` 多套 4 阶段（orbit/charge/surge/stabilize）— v9 单/多 pull 共用同一套 5 阶段，差异只在 `flash-reveal` 时是单卡 flip 还是十卡 fan-out。
- v8 的 `<CeremonyBackdrop>` 复杂粒子层 — v9 用更克制的"暗场 + 单束光柱 + 偶尔尘粒"，强化 hold 的静感。

保留：
- 阶段 copy 系统（`CEREMONY_COPY`）。
- reduced motion 分支。
- skip 仅在关键揭示后开放（v8 是 lock 后开放，v9 是 flash-reveal 后开放 — 比 v8 更晚，避免用户切掉揭示瞬间）。

新增：
- 5 阶段精确时序（见下表）。
- 稀有度对 hold 时长和 flash 强度的影响：LEG hold 拉到 500ms，flash 用金色；RAR hold 400ms 紫色 flash；COM 维持 300ms 白色 flash。

### 阶段时序表

| 阶段 | 单卡（ms） | 十连（ms） | 视觉 | 可跳过 |
| --- | --- | --- | --- | --- |
| approach | 600 | 700 | 卡包从黑暗中浮出，轻微 z 轴推进 | 否 |
| hold | 300 (COM) / 400 (RAR) / 500 (LEG) | 同左 | 完全静止，只剩光柱微微呼吸 | 否 |
| tear-flip | 450 | 550 | 单卡：卡背撕裂裂纹 → 翻转。十连：卡包炸开，扇形铺开 | 否 |
| flash-reveal | 300 | 400 | 全屏 flash（rarity 染色），同时卡正面定型 | 否 |
| settle | 350 | 450 | 卡片定位到结果布局位置 | 是（点击直达 DrawResult） |

总时长：
- 单卡 COM：2000ms；LEG：2200ms。
- 十连 COM：2400ms；LEG：2600ms。

reduced motion：单一阶段 `flash-reveal` 600ms，跳过 approach/hold/tear-flip/settle。

### Component tree

```tsx
<Screen register="reward" testID="screen-draw-ceremony-root" scrollable={false}>
  <CeremonyBackdrop reduced={reduced} testID="draw-ceremony-backdrop" />
  <CeremonyStage
    phase={controller.phase}
    progress={controller.progress}
    rarity={params.peakRarity}
    isMulti={params.isMulti}
    cards={params.cards}
    testID="draw-ceremony-stage"
  />
  <CeremonyPhaseCopy
    phase={controller.phase}
    mode={isMulti ? 'multi' : 'single'}
    testID="draw-ceremony-phase-copy"
  />
  {controller.canSkip && (
    <SkipHint
      label="Show result"
      onPress={controller.skipToResult}
      testID="screen-draw-ceremony-primary-cta"
    />
  )}
  <RevealFlash
    visible={controller.phase === 'flash-reveal'}
    rarity={params.peakRarity}
    testID="draw-ceremony-reveal-flash"
  />
</Screen>
```

### State

`useDrawCeremonyController(rarity, isMulti)` 替代 v8 同名 hook：

```ts
type Phase = 'approach' | 'hold' | 'tear-flip' | 'flash-reveal' | 'settle';

{
  phase: Phase;
  progress: number;          // 0..1 within current phase
  canSkip: boolean;          // true 仅当 phase === 'settle'
  reduced: boolean;
  start: () => void;
  skipToResult: () => void;  // 从 settle 阶段直跳 navigate
}
```

`peakRarity` = 本次抽卡中最高的稀有度。单卡 = 唯一卡的 rarity；十连 = 数组中 max(rarityRank)。`peakRarity` 决定 hold 时长和 flash 颜色。

### Motion

- approach：卡包 `translateY: 60 → 0`、`scale: 0.7 → 0.95`、`opacity: 0 → 1`。easing `motion.easing.decelerate`。
- hold：所有变量定格。仅光柱做 `opacity: 0.6 ↔ 0.8` 微弱呼吸（500ms 周期）。这是 **不可省略** 的阶段。
- tear-flip 单卡：卡背做 SVG mask 撕裂动画（如果 svg 包成本太大，回落到简单 `rotateY: 0 → 90 → reveal → 180`）。tear 视觉强烈推荐用 `react-native-svg` 的路径动画。
- tear-flip 十连：卡包消失，从中心向外扇形撒出 10 张卡背，stagger 30ms。
- flash-reveal：`<RevealFlash>` 是一个全屏 absolute View，背景色 = rarity 主色（COM 白、RAR `colors.rarityRar`、LEG `colors.rarityLeg`），opacity `0 → 0.85 → 0`，总 300ms。
- settle 单卡：卡正面从中心位置 spring 落到结果布局占位。
- settle 十连：10 张卡 spring 到网格位置，stagger 40ms。

### TestIDs

继承自 v8（保留）：
- `screen-draw-ceremony-root`
- `screen-draw-ceremony-primary-cta`（仅 settle 阶段渲染）
- `draw-ceremony-stage`
- `draw-ceremony-phase-copy`
- `draw-ceremony-reveal-flash`
- `draw-ceremony-footer-rarity`（v9 仍渲染，位置改为屏幕底部居中小字）
- `draw-ceremony-reveal-rarity`
- `draw-ceremony-reveal-question`

v9 新增：
- `draw-ceremony-backdrop`
- `draw-ceremony-skip-hint`（与 `screen-draw-ceremony-primary-cta` 同节点，方便测试用语义化 ID 也可断言）
- `draw-ceremony-hold-marker`（hold 阶段挂的隐形 view，方便 perf 测试断言"hold ≥ 300ms"）

v8 计划但 v9 删除：
- v8 的 `orbit / charge / surge / stabilize` 多 pull 阶段名 — 测试中所有出现这些字符串的断言都改为新阶段名。

### Edge cases

- 缺 `drawResult` 参数（旧入口）：fallback 走 600ms generic ceremony 然后空结果。
- AppState 被切到后台：暂停 controller，前台恢复继续。
- 用户从 settle 阶段没点 skip：500ms 后自动 navigate（避免卡死）。
- Reduced motion 状态：进入即触发 `flash-reveal`，600ms 后自动跳 Result。skip CTA 立即可见。

### Implementation notes

- Controller 完全在 worklet 中跑（Reanimated `useFrameCallback`），主线程只在阶段切换时收到一次 setState。
- `RevealFlash` 用 `useAnimatedStyle` 加 absolute fill，避免主线程合成。
- 单元测试：`tests/unit/ceremony-controller.test.ts` 用 `vi.useFakeTimers()`，断言每个阶段持续时间精确等于表中数值（± 16ms 容差）。

---

## 4. DrawResultScreen — Hero 主卡 + 路由收敛

### Why

v8 已经简化为 hero featured + sheet 全卡。v9 进一步：CTA 从"双 CTA + sheet"收敛到"单 CTA 决策树"。CTA 的目标根据钱包余额自动变化，把"接下来该干嘛"的决策从用户身上拿走。

### v8 → v9 layout

去掉：
- v8 的 `<SecondaryCTA Open library>` — 单 CTA 即可。
- v8 的 `<AllCardsSheet snapPoints>` 双 snap point — v9 改成单 snap point 全屏（拖起就是全屏全卡 grid）。

保留：
- Hero featured card（继承 v8 `<FeaturedCardClaim>` 视觉）。
- LEG confetti。
- Card detail modal。

新增：
- 单 CTA 自动决策（`Continue draw` vs `Go to Library`，规则见 `v9-reference-aligned-spec.md` §4.4）。
- 顶部进度条 "{owned}/{deckTotal}"，当本次新增让 owned 数变化时数字 count-up + 高亮 200ms。
- 次级 `Done` 文字链回 Home。

### Component tree

```tsx
<Screen register="reward" testID="screen-draw-result-root" scrollable={false}>
  <ResultHeader
    title={`${ready.featured.deckTitle}`}
    onDone={goHome}
    testID="draw-result-header"
  />
  <CollectionProgressBar
    owned={ready.collectionOwned}
    total={ready.collectionTotal}
    delta={ready.collectionDelta}
    testID="draw-result-collection-bar"
  />
  <FeaturedCardClaim
    card={ready.featured}
    rarity={ready.featured.rarity}
    isNew={ready.featured.isNew}
    onPress={openCardDetail}
    testID="screen-draw-result-featured-card"
  />
  <ResultSummaryStrip
    counts={ready.rarityCounts}
    pityTriggered={ready.pityTriggered}
    testID="draw-result-summary-strip"
  />
</Screen>
<FixedFooter direction="column">
  <PrimaryCTA
    label={ready.cta.label}                  // "Continue draw" 或 "Go to Library"
    onPress={ready.cta.onPress}
    testID="screen-draw-result-primary-cta"
  />
  <DoneLink onPress={goHome} testID="draw-result-done-link" />
</FixedFooter>
<AllCardsSheet
  cards={ready.cards}
  onCardPress={openCardDetail}
  snapPoints={['92%']}
  testID="draw-result-all-cards-sheet"
/>
<CardDetailModal
  card={detailCard}
  onClose={closeDetail}
  testID="screen-draw-result-detail-close"
/>
{hasLegendary && <LegendaryConfetti testID="draw-result-confetti" />}
```

### State

```ts
type DrawResultReady = {
  featured: CardVM;                // featured.isNew 决定 NEW 角标
  cards: CardVM[];
  rarityCounts: { COM: number; RAR: number; LEG: number };
  pityTriggered: boolean;
  collectionOwned: number;
  collectionTotal: number;
  collectionDelta: number;         // 本次新增的 owned 卡数（0..N）
  cta: {
    label: 'Continue draw' | 'Go to Library';
    onPress: () => void;
  };
};
```

`useDrawResultViewModel(drawResult)` 内部：
```ts
const remainingPulls = wallet.availablePulls + wallet.reservePulls;
const cta = remainingPulls > 0
  ? { label: 'Continue draw', onPress: () => navigation.navigate('Draw', { slug }) }
  : { label: 'Go to Library', onPress: () => navigation.navigate('Library', { focusSlug: slug, scrollToNew: true }) };
```

`Library` 路由暂未定义 `focusSlug` / `scrollToNew` 参数 — codex 在 `src/navigation/types.ts` 给 `Library` 增补可选参数（不算"新增 route"，是给已有 route 加可选 param，符合 v9 §0 "不动路由图"约束的边界内可接受变更）。

### Motion

- collection bar 数字 count-up 240ms，本次 delta 期间整条 bar 做 1.05 scale 高亮。
- featured card 入场：spring `translateY: 80 → 0, scale: 0.9 → 1.0`。
- AllCardsSheet：拖起触发，单 snap = 92%。snap 关闭手势 = 下拽 30%+。
- 路由切换前做 200ms 淡出。

### TestIDs

继承自 v8（保留）：
- `screen-draw-result-root`
- `screen-draw-result-featured-card`
- `screen-draw-result-primary-cta`
- `screen-draw-result-detail-close`
- `screen-draw-result-grid-card-{i}`（在 sheet 内部仍按 index 命名）
- `draw-result-header`
- `draw-result-summary-strip`
- `draw-result-all-cards-sheet`
- `draw-result-confetti`

v9 新增：
- `draw-result-collection-bar`
- `draw-result-done-link`

v8 计划但 v9 删除：
- `screen-draw-result-secondary-cta`（已删，单 CTA）

### Edge cases

- **Loading**：sheleton hero + 灰条 collection bar。
- **Error**：full-screen retry。
- **Empty (no cards)**：hero 替换为 "Empty draw" + CTA = `Back to draw` → `Draw`。
- **All-COM low-value pull**：仍走正常流程。CTA 决策只看钱包，不看价值。
- **`focusSlug` / `scrollToNew` 路由参数**：codex 在 LibraryScreen 中读取并实施"打开后聚焦 deck + 自动滚到新卡"的 effect，详见 §5。

### Implementation notes

- `<CollectionProgressBar>` 是 v9 新原子组件，放 `src/components/v8/`（与共享组件同目录），未来 Library 顶部也可复用。
- `<DoneLink>` 是 `<Pressable>` + `typography.bodySmall` underlined，居中。

---

## 5. LibraryScreen — Owned/Missing 一级维度

### Why

v8 已经把 ownership 当作主轴，但 filter 仍写 `Owned / Unowned`。v9 改为 `Owned / Missing`（Missing 暗示动作），并把 `Learned / New / Mastered` 全部下沉为二级 chip 而不是主 filter。同时支持从 DrawResult 跳过来时的"聚焦 + 滚动到新卡"行为。

### v8 → v9 layout

去掉：
- v8 的 mastery 相关主 filter 选项（codex 在 v8 实施时如已加，v9 改为隐藏入口）。

保留：
- v8 的 search field。
- v8 的 deck switcher。
- v8 的 filter sheet 模式（不回退到 chip row）。

新增：
- 顶部 collection 进度条（与 DrawResult §4 共享 `<CollectionProgressBar>` 组件）。
- 卡片网格中 missing 卡视觉强化：`opacity 0.4 + 灰阶 + 居中 lock 图标`。Owned 全亮，NEW 卡有 gold pulse ring（来自 v8 §3.4）。
- 从 DrawResult 跳入时，自动 scroll 到第一张本次 acquired 卡，并对该卡做 1.5s 高亮环。
- 二级 mastery chip：在 filter sheet 内，作为"再筛选"，默认全选。

### Component tree

```tsx
<Screen register="study" testID="screen-library-root">
  <LibraryHeader>
    <DeckSwitcher
      value={activeDeck}
      onChange={setActiveDeck}
      testID="library-deck-switcher"
    />
    <CollectionProgressBar
      owned={ready.collectionOwned}
      total={ready.collectionTotal}
      testID="library-collection-bar"
    />
    <SearchField value={query} onChange={setQuery} testID="library-search" />
    <FilterSummaryButton
      summary={`${filterLabel} · ${sortLabel}`}
      onPress={openFilterSheet}
      testID="library-filter-summary"
    />
  </LibraryHeader>
  <LibraryGrid
    ref={gridRef}
    cards={ready.cards}
    columns={columns}                    // 2 on <390, 3 on >=390
    renderCard={(card) => (
      <RewardCard
        card={card}
        state={card.state}                // 'owned' | 'missing' | 'new'
        mastery={card.mastery}
        highlight={card.stableUid === highlightedCardUid}
        onPress={() => openDetail(card)}
        testID={`library-card-${card.stableUid}`}
      />
    )}
    testID="library-card-grid"
  />
  {ready.cards.length === 0 && (
    <EmptyState
      title="Nothing matches"
      cta={{ label: 'Reset filters', onPress: resetFilters }}
      testID="library-empty-state"
    />
  )}
</Screen>
<LibraryFilterSheet
  visible={filterOpen}
  filter={filter}                        // 'all' | 'owned' | 'missing'
  sort={sort}
  masteryFilter={masteryFilter}
  onChange={setFilter, setSort, setMasteryFilter}
  testID="library-filter-sheet"
/>
```

### State

```ts
type LibraryReady = {
  cards: Array<{
    stableUid: string;
    question: string;
    rarity: 'COM' | 'RAR' | 'LEG';
    state: 'owned' | 'missing' | 'new';   // v9 改：unowned → missing
    mastery: 'none' | 'learning' | 'mastered';
    acquiredAt?: number;
  }>;
  collectionOwned: number;
  collectionTotal: number;
  totalNewSinceLastVisit: number;
};
```

`libraryMapper.ts` 在 v8 基础上把 `'unowned'` 重命名为 `'missing'`。所有调用点同步改名（grep 全仓 + 替换）。

`useLibraryViewModel()` 接受可选路由参数 `{ focusSlug?: string; scrollToNew?: boolean }`：
- `focusSlug` 设置 deck switcher 初值。
- `scrollToNew` 触发 effect：`gridRef.current.scrollToCard(firstNewUid)` + 设置 `highlightedCardUid` 1.5s 后自动清除。

### Motion

- 卡片入场：v8 stagger 不变（前 12 张 100ms stagger）。
- NEW pulse：金色环 2s × 3 次 = 6s 后自停。
- Highlight ring（来自 DrawResult 跳入）：金色环 1.5s 单次，结束后过渡到 NEW pulse 状态（如卡仍是 NEW）。
- Filter sheet：标准 `<Sheet>` 行为。

### TestIDs

继承自 v8（保留）：
- `screen-library-root`
- `screen-library-primary-surface`（root view 的 no-op alias）
- `library-card-grid`
- `library-deck-switcher`
- `library-empty-state`
- `library-empty-cta`
- `library-search`
- `library-filter-summary`
- `library-filter-sheet`
- `library-card-{stableUid}`

v9 新增：
- `library-collection-bar`
- `library-sheet-filter-missing`（替代 v8 的 `library-sheet-filter-unowned`）
- `library-sheet-mastery-{none|learning|mastered}`

v8 计划但 v9 重命名：
- `library-sheet-filter-unowned` → `library-sheet-filter-missing`（v9 中两 ID 同节点共存，v9.1 删 unowned alias）

### Edge cases

- **从 DrawResult 跳入**：`scrollToNew` flag 有效，定位 + highlight ring。
- **从 Home 跳入**：无 focusSlug，使用 active deck slug。
- **没有 owned 卡**：filter='all' 时显示全部 missing；filter='owned' 时显示 empty + reset CTA。
- **没有 missing 卡（全 owned）**：filter='missing' 时显示 "Collection complete" + CTA `Back to all`。
- **卡片 long-press**：触发 quick-peek sheet（v8 §3.4）。

### Implementation notes

- `<RewardCard>` 的 `state` prop 已支持 `'unowned'`，v9 在该组件内部加 `state === 'missing'` 分支，与 unowned 视觉同步但语义独立。或者直接重命名（推荐）：把 `'unowned'` 全替换为 `'missing'`，与 mapper 一致。
- "Missing" 卡的灰阶用 `<Image>` 的 `tintColor` 属性 + `opacity: 0.4`。
- collection bar 与 DrawResult 共用组件，但 Library 不渲染 `delta`（不闪），用 `delta={undefined}` 跳过高亮。

---

## v8 与 v9 的同屏并存策略（实施期间）

- 共享组件库（`src/components/v8/`）保持目录名 `v8`，不要重命名为 `v9` — 否则全部 import 路径要改。把 v9 视为 "v8 设计系统的延续"，目录是历史名而已。
- 5 个 v9 重写屏单独走 `src/screens/{HomeScreen,DrawScreen,DrawCeremonyScreen,DrawResultScreen,LibraryScreen}.tsx`，老 v7 实现移到 `src/screens/_v7_archive/`（与 v8 §1 implementation notes 一致）。
- v9 五屏内禁止 import v7 archive 中的任何文件。
- 5 个未改屏（Challenge / SessionCard / SessionSummary / Deck / Settings）按 v8 实施，与 v9 五屏共用同一套共享组件、同一套 token、同一套 copy guide。

## Migration order（v9 推荐顺序）

把"风险大但收益高"放前面，把"基础设施"放更前面：

1. v8 设计 token（`colors.ts` / `typography.ts` / `spacing.ts` / 新增 `motion.ts` / `elevation.ts`）。
2. v8 共享组件（`<Screen>` / `<PrimaryCTA>` / `<SecondaryCTA>` / `<Stat>` / `<RewardCard>` / `<GateCard>` / `<Sheet>`）。
3. v8 hooks 骨架（`useHomeViewModel` 等 — 但仅做 v8 形态的，v9 五屏的 hook 在第 5 步覆盖）。
4. v8 五屏（**仅** Challenge / SessionCard / SessionSummary / Deck / Settings）。
5. v9 五屏（Home / Draw / DrawCeremony / DrawResult / Library）— 此时所有依赖、共享组件、token 都已就绪。
6. v9 perf baseline 测试（手工跑，记录到 `docs/qa/v9-perf-baseline.md`）。
7. 删 v7 archive（在下一个 release 后，v9.1 周期）。
