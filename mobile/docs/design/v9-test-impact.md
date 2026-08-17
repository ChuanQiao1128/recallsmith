# v9 Test Impact (overrides v8 for 5 screens)

继承 `v8-test-impact.md` 的全部内容（其余 5 屏 + 共享组件 + 测试基础设施仍按 v8 实施）。本文档**覆盖** v8 中 Home / Draw / DrawCeremony / DrawResult / Library 的测试条目。

约定不变：**MUST UPDATE / SHOULD UPDATE / NEW / DELETE**。

---

## 1. HomeScreen

### MUST UPDATE

| 文件 | 改动 |
| --- | --- |
| `tests/integration/home.screen.test.tsx` | 删除 v8 hero / status-strip / collapsible 相关断言。新增：`home-pack-carousel` 渲染、3 张占位 / N 张真实 pack（按 mock manifest）；`home-pack-card-{slug}` 至少存在一个；点击 pack 调用 `navigation.navigate('Draw', { slug })`；底部 `home-study-link` 当 `totalDue > 0` 时渲染。 |
| `tests/integration/home-cta-target.spec.tsx` | CTA 标签从 `Start session` 等改为 `Open {deckTitle}`。当 wallet=0 时按钮 disabled。 |
| `tests/integration/home-primary-cta.spec.tsx` | 同上。增加 disabled 状态断言。 |
| `tests/unit/home-state.test.ts` | 期望 `HomeReady` 形状改为 `{ packs[], focusedSlug, focused, totalDue }`。 |
| `tests/unit/homeSelectors.spec.ts` | 删除 `stats: { streakDays, todayDone, todayTarget, pullsAvailable }` 断言；改为 `packs: [{ slug, walletPulls, dueCount, canOpen, ... }]`。 |
| `tests/unit/deckActionResolver.spec.ts` | 该 resolver 在 v9 不再决定 Home CTA target（Home CTA 始终 = `Draw`）。如果该 resolver 还被其他屏幕使用，保留并加注释；否则标 deprecated。 |
| `tests/unit/summary-home.test.ts` | Summary → Home 路由不变，但 Home 的 entry view 不同。验证不报错即可。 |

### NEW

| 文件 | 用途 |
| --- | --- |
| `tests/integration/home-pack-carousel.spec.tsx` | 滚动 carousel 改变 `focusedSlug`，PrimaryCTA label 与 PackFocusMeta 同步更新。仅首次 mount 触发"卡包浮入"动画（后续 mount 走静态布局）。验证 AsyncStorage `home:v9:hasMounted` 写入。 |
| `tests/integration/home-empty-no-decks.spec.tsx` | 无 deck 安装时显示占位卡 + `Browse packs` CTA → 跳 `Library` 的 install 流程。 |
| `tests/integration/home-study-link.spec.tsx` | `totalDue > 0` 时 link 出现并可点击；`= 0` 时不渲染。 |

### DELETE

无（v8 中规划但 v9 不做的 home-status-strip / home-skeleton 测试，可不创建；如已创建，删除）。

---

## 2. DrawScreen

### MUST UPDATE

| 文件 | 改动 |
| --- | --- |
| `tests/integration/draw.screen.test.tsx` | 删除 audience preference label、pity bar、multi-confirm sheet 相关断言。验证屏幕仅含：back 按钮、卡包 hero、wallet 角标 `× {n}`、`Open 10`、`Open 1`。点击 `Open 10` 直接 navigate ceremony，不弹 sheet。 |
| `tests/unit/draw.test.ts` | 期望 `DrawReady` 形状去掉 `audienceLabel`、`pityRarityHint`，去掉 v8 计划的 `pity` 渲染相关字段（pity 仍内部存在但不在 UI 状态形状中）。 |
| `tests/unit/pity.test.ts` | pity 计算逻辑保留并继续测试，仅去掉 pity-rarity-hint 的 UI 转换断言。 |

### NEW

| 文件 | 用途 |
| --- | --- |
| `tests/integration/draw-pack-hero.spec.tsx` | 卡包 hero 渲染 deck cover + `× {walletPulls}` 角标；breathing 动画在 reduced-motion 关闭时存在，开启时静态。 |
| `tests/integration/draw-only-two-buttons.spec.tsx` | 屏幕底部 region 内 Pressable 元素数 ≤ 2（back 按钮在 header 不计）。这是 v9 §6.1 的硬约束断言。 |

### DELETE

| 文件 | 说明 |
| --- | --- |
| `tests/integration/draw-confirm-sheet.spec.tsx` | v8 计划的 multi-confirm 测试，v9 删除。如已创建，删除。 |

---

## 3. DrawCeremonyScreen

### MUST UPDATE

| 文件 | 改动 |
| --- | --- |
| `tests/integration/draw-ceremony.screen.test.tsx` | 阶段名从 `warmup/focus/lock/reveal`（与 `orbit/charge/surge/stabilize`）改为 `approach/hold/tear-flip/flash-reveal/settle`（单/十连共用）。skip CTA 仅在 `settle` 阶段渲染。验证 reveal flash overlay 在 `flash-reveal` mount。 |
| `tests/unit/ceremony-copy.test.ts` | 验证 `CEREMONY_COPY_V9` 存在并包含 5 阶段 key + LEG/RAR/COM 的 approach title 变体。沿用 v8 的 jargon-free 规则（不允许出现 `axis/breach/drift` 等内部词）。 |

### NEW

| 文件 | 用途 |
| --- | --- |
| `tests/unit/ceremony-controller.test.ts` | 纯单元测试，`vi.useFakeTimers()` 推进时钟。断言：5 阶段顺序正确；hold 持续时间按稀有度等于 300/400/500ms；总时长精确等于上面 §3 时序表（± 16ms）；reduced motion 下 collapse 为单一阶段 600ms；`canSkip` 仅在 `settle` 为 true。 |
| `tests/integration/draw-ceremony-skip-gate.spec.tsx` | 验证 settle 之前 `screen-draw-ceremony-primary-cta` 不在 DOM；settle 后立即出现。 |
| `tests/integration/draw-ceremony-rarity-flash.spec.tsx` | 单卡 LEG → flash 颜色 = `colors.rarityLeg`；RAR → `colors.rarityRar`；COM → 白色。验证通过断言 `<RevealFlash>` 的 style.backgroundColor。 |
| `tests/integration/draw-ceremony-hold-static.spec.tsx` | hold 阶段所有 transform 值在该阶段持续期内不变（用 `draw-ceremony-hold-marker` 作为锚点）。 |

---

## 4. DrawResultScreen

### MUST UPDATE

| 文件 | 改动 |
| --- | --- |
| `tests/integration/draw-result.screen.test.tsx` | 删除 secondary CTA 断言。CTA 标签为 `Continue draw` 当 wallet > 0；为 `Go to Library` 当 wallet = 0。验证 `draw-result-collection-bar` 渲染 `{owned}/{total}`。验证 `draw-result-done-link` 存在。AllCardsSheet 单 snap = '92%'。 |

### NEW

| 文件 | 用途 |
| --- | --- |
| `tests/integration/draw-result-cta-routing.spec.tsx` | 参数化两种 wallet 状态，断言路由参数：`Continue draw` → navigate `Draw` with same slug；`Go to Library` → navigate `Library` with `{ focusSlug, scrollToNew: true }`。 |
| `tests/integration/draw-result-collection-bar.spec.tsx` | collection delta > 0 时数字 count-up + 1.05 scale 高亮；delta = 0 时静态。 |
| `tests/integration/draw-result-done-link.spec.tsx` | done link 点击 navigate `Home`。 |

### DELETE

| 文件 | 说明 |
| --- | --- |
| `tests/integration/draw-result-sheet.spec.tsx` 中的 "two snap points" 测试 | v9 单 snap，删除该 case，保留 sheet 打开 / 卡片点击 detail 部分。 |

---

## 5. LibraryScreen

### MUST UPDATE

| 文件 | 改动 |
| --- | --- |
| `tests/integration/library-final.screen.test.tsx` | filter sheet 中 testID `library-sheet-filter-unowned` 改 `library-sheet-filter-missing`。屏幕顶部新增 `library-collection-bar` 渲染。从 DrawResult 跳入时（带 `focusSlug` + `scrollToNew`），active deck 自动切换 + 滚动到第一张新卡 + 该卡 1.5s 高亮环。 |
| `tests/unit/library.test.ts` | mapper 输出中 `state` 的字符串 `'unowned'` 全部改 `'missing'`。所有调用点同步。 |
| `tests/integration/library-360-columns.spec.tsx` | 不变（栅格列数不变）。 |
| `tests/integration/library-filter-sheet.spec.tsx` | filter 选项断言更新：`all / owned / missing`（v8 是 `all / owned / unowned`）。新增二级 mastery filter 断言。 |
| `tests/integration/library-search.spec.tsx` | 不变（搜索逻辑不变）。 |
| `tests/integration/library-new-pulse.spec.tsx` | 不变（NEW pulse 逻辑不变；v9 在 RewardCard 上多加 NEW 文字角标，可补一条断言）。 |

### NEW

| 文件 | 用途 |
| --- | --- |
| `tests/integration/library-collection-bar.spec.tsx` | bar 渲染 owned/total；切换 deck 时数据更新。 |
| `tests/integration/library-from-draw-result.spec.tsx` | 路由参数 `{ focusSlug, scrollToNew: true }` → deck switcher 切到 focusSlug + 滚动 + 高亮环。 |
| `tests/integration/library-collection-complete.spec.tsx` | filter='missing' 且全部 owned → 显示 `Collection complete` 空态 + `Back to all` CTA。 |

---

## 6. 跨屏 / 基础设施

### MUST UPDATE

| 文件 | 改动 |
| --- | --- |
| `src/navigation/types.ts` | `Library` 路由参数追加可选 `{ focusSlug?: string; scrollToNew?: boolean }`。这是 v9 §0 边界内允许的"已有 route 加 optional param"。 |
| `tests/unit/main-tabs.test.ts` | 如有断言 Library 路由参数形状，更新。 |

### NEW

| 文件 | 用途 |
| --- | --- |
| `tests/perf/v9-ceremony.perf.ts` | 手工 perf 脚本：iPhone 12 / Pixel 5 真机，跑 ceremony 5 次记录 JS 帧时间和原生帧率，写入 `docs/qa/v9-perf-baseline.md`。 |
| `tests/perf/v9-carousel.perf.ts` | 同上，PackCarousel 滑动测试。 |
| `tests/perf/v9-multi-pull.perf.ts` | 连开 10 包 × 3 次的内存 / 状态稳定性测试。 |
| `tests/integration/v9-three-packs-isomorphic.spec.tsx` | v9 §6.1 第 4 条："三个卡包切换不改变交互结构"。参数化跑 3 个 pack slug，断言 PackHero / PackActionBar 组件结构 hash 相同（用 react-test-renderer 输出 toJSON 比较）。 |

---

## 7. v8 测试条目的处置（针对 5 屏）

`v8-test-impact.md` §1 中针对 Home / Draw / DrawCeremony / DrawResult / Library 的所有 MUST UPDATE / NEW 条目：

- 凡与 v9 spec 一致的：仍执行（如 v8 NEW 的 `tests/unit/ceremony-controller.test.ts` — v9 沿用并改阶段名）。
- 凡与 v9 spec 冲突的：以 v9 为准（如 v8 NEW 的 `tests/integration/home-status-strip.spec.tsx` — v9 不创建）。
- v8 §1 中针对未改 5 屏（Challenge / SessionCard / SessionSummary / Deck / Settings）的所有条目：完全不受 v9 影响，按 v8 实施。

---

## 8. testID 重命名 / 删除汇总

### v8 → v9 重命名（共存期间双 ID）

- `library-sheet-filter-unowned` → `library-sheet-filter-missing`（v9 内同节点挂双 ID，v9.1 删 unowned alias）

### v9 删除（v8 计划但 v9 不做）

- `home-status-strip`
- `draw-pity-bar`
- `draw-meta-wallet`
- `draw-multi-confirm-sheet`
- `draw-multi-confirm-yes`
- `draw-multi-confirm-no`
- `screen-draw-result-secondary-cta`

### v9 新增（v8 中没有）

- Home: `home-pack-carousel`, `home-pack-card-{slug}`, `home-focus-meta`, `home-study-link`
- Draw: `draw-pack-pulls-badge`
- DrawCeremony: `draw-ceremony-backdrop`, `draw-ceremony-skip-hint`, `draw-ceremony-hold-marker`
- DrawResult: `draw-result-collection-bar`, `draw-result-done-link`
- Library: `library-collection-bar`, `library-sheet-filter-missing`, `library-sheet-mastery-{none|learning|mastered}`

### v8 →v9 保留不变

凡 v8 spec 中标 "Preserved" 的 v9 五屏 testID，**全部继续保留**，作为兼容层。这意味着 codex 不能因为"v9 不再渲染某子组件"就把 testID 一起拆 — 把 testID 挂在替代节点（root view 或类似）上即可。

具体保留清单：
- Home: `screen-home-root`, `screen-home-primary-cta`, `home-header`, `home-first-draw-link`（挂 root view 上 no-op）
- Draw: `screen-draw-root`, `draw-card-stack-stage`, `screen-draw-primary-cta`, `screen-draw-secondary-cta`
- DrawCeremony: `screen-draw-ceremony-root`, `screen-draw-ceremony-primary-cta`, `draw-ceremony-stage`, `draw-ceremony-phase-copy`, `draw-ceremony-reveal-flash`, `draw-ceremony-footer-rarity`, `draw-ceremony-reveal-rarity`, `draw-ceremony-reveal-question`
- DrawResult: `screen-draw-result-root`, `screen-draw-result-featured-card`, `screen-draw-result-primary-cta`, `screen-draw-result-detail-close`, `screen-draw-result-grid-card-{i}`, `draw-result-header`, `draw-result-summary-strip`, `draw-result-all-cards-sheet`, `draw-result-confetti`
- Library: `screen-library-root`, `screen-library-primary-surface`, `library-card-grid`, `library-deck-switcher`, `library-empty-state`, `library-empty-cta`, `library-search`, `library-filter-summary`, `library-filter-sheet`, `library-card-{stableUid}`
