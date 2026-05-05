# RecallSmith v9 设计方向（参考卡包产品体验）

**状态**：Draft v2（供 Claude/Codex 读取并实施）

**结论先行**：`v9` 不重写，不放弃 `v8`。采用 **v8 架构保留 + 关键体验重做** 的策略。

- 保留：导航结构、现有测试框架、主题双 register（Study / Reward）、现有数据管道。
- 重做：Home 卡包入口、Draw 入口结构、DrawCeremony 动画节奏、DrawResult 收敛、Library 收藏表达。

---

## 0. v9 与 v8 的关系（实施顺序）

`v8` 的设计 spec 已存在但**未实施**。`v9` 不是 v8 之后的下一轮，而是 v8 的**修正版方向**。codex 实施时按下表处理：

| 屏幕 | v9 处置 | 实施依据 |
| --- | --- | --- |
| HomeScreen | **v9 重写**（卡包入口化） | v9-screen-diff.md §1 |
| DrawScreen | **v9 重写**（极简两按钮 + 卡包大图） | v9-screen-diff.md §2 |
| DrawCeremonyScreen | **v9 重写**（5 阶段商业级节奏） | v9-screen-diff.md §3 |
| DrawResultScreen | **v9 重写**（hero 主卡 + 路由收敛） | v9-screen-diff.md §4 |
| LibraryScreen | **v9 重写**（Owned/Missing 一级维度） | v9-screen-diff.md §5 |
| ChallengeScreen | **v8 实施**（v9 不动） | v8-screen-diff.md §2 |
| SessionCardScreen | **v8 实施**（v9 不动） | v8-screen-diff.md §3 |
| SessionSummaryScreen | **v8 实施**（v9 不动） | v8-screen-diff.md §4 |
| DeckScreen | **v8 实施**（v9 不动） | v8-screen-diff.md §9 |
| SettingsScreen | **v8 实施**（v9 不动） | v8-screen-diff.md §10 |

**所有 token、共享组件、测试基础设施、依赖、a11y 基线**继承自 v8，见：

- 设计令牌 / 共享组件：`v8-product-spec.md` §2、§3
- 依赖清单（Reanimated / lucide / bottom-sheet / haptics / svg）：`v8-product-spec.md` §9
- 测试基础设施（Vitest + react-test-renderer，per-file rn-mock）：`v8-product-spec.md` §7、`v8-test-impact.md` §4

v9 的 5 屏 spec **覆盖**（override）v8 在同一屏上的描述。其余 5 屏完全按 v8 实施。

---

## 1. 参考产品的设计逻辑（逆向拆解）

## 1.1 主循环不是“页面”，是“奖励回路”

参考产品核心回路：

1. 首页看到多卡包入口（可选）
2. 进入开包入口页（只做选择 + 开封）
3. 进入开包动画（沉浸、可期待）
4. 进入结果页（即时反馈 + 继续）
5. 自动回到收藏上下文（图鉴进度可感知）

它的本质不是“展示信息”，而是“让用户持续完成一轮再一轮抽取”。

## 1.2 每屏职责单一

- 首页：只负责“今天开哪个包”
- 开包入口：只负责“开 1 包 / 开 10 包”
- 动画：只负责“等待 + 期待 + 揭示”
- 结果：只负责“你拿到了什么”
- 收藏：只负责“你还差什么”

## 1.3 三个卡包是同构界面，不同内容

参考产品并没有为每个卡包发明不同 UI，而是用同一套组件：

- 相同结构
- 相同按钮位置
- 相同动效轨道
- 不同皮肤（封面、配色、稀有度语义）

这直接降低实现复杂度，并提高学习成本收益比（用户无需重新学习操作）。

## 1.4 动画价值在“时间控制”

它的商业感来自时序，不是复杂粒子：

- 进入：慢速拉近 + 轻微漂浮
- 锁定：短暂停顿（制造“要开了”）
- 揭示：清晰瞬态（亮、震、翻）
- 收尾：快速落到结果

你之前的反馈“现在太简单太快”，核心就是 **缺少停顿和层次**。

## 1.5 收藏页表达的是“拥有度”，不是学习状态

参考产品把“是否拥有”作为首层信息：

- 已拥有：亮色、完整卡面
- 未拥有：暗色、占位格

这与 `Learned/New` 不是一回事。学习状态是二级维度，收藏状态是一级维度。

---

## 2. 当前 RecallSmith（v8）与参考逻辑的差异

1. **入口心智差异**：当前 Home 更像学习任务入口，参考更像卡包选择入口。
2. **Draw 信息过量**：当前 Draw 有较多说明区块；参考是强视觉 + 极少文案。
3. **操作复杂度**：当前部分流程含多段解释；参考始终只有少量高确定动作。
4. **动画节奏偏短**：当前开封更偏“功能动画”；参考是“奖励动画”。
5. **Library 主维度不对齐**：当前偏 `Learned/New`；参考偏 `Owned/Unowned`。

---

## 3. v9 策略决策（不是重写）

## 3.1 采用“体验对齐”，不做“视觉抄写”

- 对齐：流程、信息层级、交互结构、节奏。
- 不对齐：品牌素材、IP 资产、具体美术。

## 3.2 技术策略

- 保留 `v8` 的 token、路由、测试体系。
- 在 `Draw*` 与 `Library` 相关屏幕做组件级替换。
- 用“单一卡包组件 + 皮肤配置”覆盖三卡包重复界面。

---

## 4. v9 屏幕级要求（实施合同）

## 4.1 HomeScreen（卡包入口化）

**目标**：让用户在首页立即选择卡包并进入 Draw。

**必须**：

- 首页主区域是一个 **PackCarousel**：水平滚动的卡包列表。
- 卡包数量取自 `deckRepository` manifest，**v9.0 不限定 3 个**。展示策略：
  - 若 manifest 卡包数 ≤ 3：全部并列展示，不滚动。
  - 若 > 3：水平 carousel，每页一张卡包，左右半屏可见相邻卡包边缘作为滚动暗示。
- 当前焦点卡包下方显示：可开次数（available pulls）、剩余 due 卡数（学习状态），紧凑 1 行。
- 点击卡包大图 = 进入 `Draw`，路由参数带 `slug`（沿用现有 `DrawParamList.slug`，不引入 `packId`）。
- 学习入口保留但**降权**：底部一个文字链 "Study {n} due cards"，点击进入 `Challenge`（现有 v8 流程）。

**避免**：

- 复杂文字说明块
- 多个同权重 CTA
- 把"今日目标 / 提醒 / 成就"塞回首页 — v9 把这些移到 Settings momentum strip（v8 §4.10 已规划）。

## 4.2 DrawScreen（极简两按钮）

**目标**：围绕卡包大图，只保留两个核心动作。

**必须**：

- 卡包图下方只保留两个按钮：
  - `Open 10`
  - `Open 1`
- 其他说明文案与次级卡片全部移除或收进二级入口。
- 仅保留必要的可用次数/资源状态（紧凑显示）。

**你明确提出的约束**：  
“reward draw 图片下面放两个按钮就行，其他都删掉” —— v9 按此执行。

## 4.3 DrawCeremonyScreen（商业级节奏）

**目标**：把“抽卡”做成奖励瞬间，而不是快速过场。

**建议时序（可参数化）**：

1. `approach`：450-700ms（包体入场）
2. `hold`：300-500ms（悬停蓄势）
3. `tear/flip`：350-550ms（关键动作）
4. `flash/reveal`：250-400ms（揭示）
5. `settle`：250-450ms（进入结果）

**必须**：

- 引入至少一次“停顿”阶段（hold）。
- 支持跳过，但仅在关键揭示后开放（避免破坏奖励感）。
- 不同稀有度可影响 `flash` 强度与停顿时长。

## 4.4 DrawResultScreen（结果导向）

**目标**：清晰告诉用户“抽到了什么”，并引导下一步。

**必须**：

- 主卡突出（hero）+ 其余卡简化列表/网格。
- 单主 CTA，按以下规则决策：
  - 若 `walletPulls + reservePulls > 0`（钱包还有 pull）→ CTA = `Continue draw` → 路由 `Draw`。
  - 若钱包为空 → CTA = `Go to Library` → 路由 `Library`，自动滚动到本次新增卡片。
- 次级链接（不与主 CTA 等权）：`Done`，路由回 `Home`。
- 新获得卡明确打标（`NEW`），与 v9 Library 的 "new pulse" 状态共享视觉。

## 4.5 LibraryScreen（收藏优先）

**目标**：先看拥有度，再看学习状态。

**必须**：

- 栅格中：
  - 已拥有卡：亮色可读
  - 未拥有卡：暗色/占位态（明显可区分）
- 一级筛选维度切换为 `All / Owned / Missing`（或语义等价）。
- `Learned / New` 下沉为二级标签，不再作为主过滤入口。

## 4.6 未改 5 屏的导航地位（不可省）

v9 Home 重定位为卡包入口后，学习闭环必须仍可达。导航完整性约束：

- **Home → Challenge**：通过 Home 底部 "Study {n} due cards" 文字链（§4.1）。
- **Challenge → SessionCard → SessionSummary**：v8 流程不变。
- **SessionSummary → Home**：完成后回首页（卡包入口），不直接弹 Draw。SessionSummary 的 `RewardStripCTA`（v8 §4.4）保留，但 v9 中"领取"动作的目标改为：把 reward pulls 写入钱包后回 Home，让用户在卡包前再决定开哪个。
- **Deck（gate）**：从 Library 卡片或 Settings → "Manage decks" 进入，未在 v9 主流程出现。
- **Settings**：右上角入口，从 Home 顶栏进入（v8 §4.10 不变）。

> **设计意图**：v9 把"学什么 / 开什么"两个决策**物理分离**。学习是一条线，奖励是另一条线，Home 是分叉点。这与参考产品的"卡包入口式首页"对齐，同时不削弱学习闭环。

---

## 5. 组件与状态模型建议

## 5.1 三卡包同构组件

新增统一组件（示例命名）：

- `PackCarousel`（承载 3 包）
- `PackHero`（单包主视觉）
- `PackActionBar`（仅双按钮）

由 `packTheme` 驱动差异：

```ts
type PackTheme = {
  id: string;
  coverAsset: string;
  accent: string;
  rarityScale: 'standard' | 'premium';
};
```

## 5.2 Draw 流程状态

```ts
type DrawFlowState =
  | { kind: 'idle'; packId: string; availablePulls: { one: boolean; ten: boolean } }
  | { kind: 'opening'; packId: string; count: 1 | 10; phase: 'approach' | 'hold' | 'reveal' | 'settle' }
  | { kind: 'result'; packId: string; cards: PulledCard[] };
```

---

## 6. 测试与验收（v9 最小门槛）

## 6.1 必过用例

1. DrawScreen 仅存在两个主按钮（`Open 10` / `Open 1`）。
2. DrawCeremony 至少经历一个 `hold` 阶段再进入 reveal。
3. Library 在同一屏同时可见 owned 与 missing 的视觉差异。
4. 三个卡包切换不改变交互结构，仅改变主题数据。

## 6.2 性能门槛（移动端）

基准设备：iPhone 12（iOS 17+）和 Pixel 5（Android 13+）。在这两台真机上必须达到：

- DrawCeremony 五阶段期间，JS 线程平均帧时间 ≤ 16ms（60fps），最差单帧 ≤ 33ms。
- PackCarousel 滑动时，UI 线程帧率 ≥ 55fps。
- 连续开 10 包 × 3 次（共 30 次开包）后，内存增长 ≤ 30MB，无 RN 红屏，所有按钮可响应。
- 冷启动到 HomeScreen ready 状态 ≤ 2.5s（中位数，3 次取样）。

测量工具：Reanimated 自带的 `runOnUI` perf logger，结合 React DevTools Profiler 抓 JS 线程；原生帧率用 Xcode Instruments / Android Studio Profiler。codex 在 `tests/perf/` 下加 3 个手工 perf 脚本（Ceremony、Carousel、连开），结果记录到 `docs/qa/v9-perf-baseline.md`。

## 6.3 视觉契约（必须，给测试用）

避免"无明显掉帧"这种不可测描述，下列视觉规则是断言可写的：

- **Owned vs Missing**：missing 卡片 `opacity` 必须在 `[0.30, 0.50]` 区间，且封面叠加灰阶滤镜（`tintColor` 或 `<Image>` 的 `style.opacity`）。
- **NEW 标记**：右上角徽章，文字 `NEW`，背景 `colors.glowGold`，文字 `colors.cosmicBg`。
- **Pack focus**：carousel 中焦点卡 `scale = 1.0`，相邻卡 `scale = 0.86 + opacity 0.55`。
- **Hold 阶段**：卡包动画完全静止 ≥ 300ms（断言通过 controller 的 `phase === 'hold'` 持续时间）。

---

## 7. 实施边界（给 Claude/Codex）

**优先改动**：

- `/Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/HomeScreen.tsx`
- `/Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawScreen.tsx`
- `/Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawCeremonyScreen.tsx`
- `/Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/DrawResultScreen.tsx`
- `/Users/qc/Desktop/DeveloperCards/recallsmith/mobile/src/screens/LibraryScreen.tsx`
- 对应 `features/gacha/*` 的 view-model / mapper / selectors / tests

**不建议先动**：

- 路由图大改
- 全局 IA 重构
- 与 v9 目标无关的主题系统重写

**依赖**：v9 不引入新依赖。继承 v8 §9 的依赖清单：`react-native-reanimated`、`lucide-react-native`、`expo-haptics`、`@gorhom/bottom-sheet`、`react-native-svg`。codex 在落 v8 共享组件时一并装好。

**TestID 处置**：v9 五屏的 testID 契约见 `v9-test-impact.md`。规则：
- v8 spec 中标"Preserved"的 testID，在 v9 五屏中仍**全部保留**（codex 把现有测试改 query 即可，不动 testID）。
- v9 新增的 testID 在 `v9-screen-diff.md` 每屏的 "TestIDs" 段列出。
- v9 显式删除某 testID 时，必须在 `v9-test-impact.md` 标 "DELETE"。

---

## 8. 给 Claude 的执行提示（可直接复制）

> 请基于 `docs/design/v9-reference-aligned-spec.md` 实施 v9。  
> 目标是体验对齐：三卡包同构、Draw 双按钮极简、Ceremony 商业级节奏、Library Owned/Missing 一眼可见。  
> 不改导航结构。优先改 Home/Draw/DrawCeremony/DrawResult/Library 及对应测试。  
> 每改完一个屏幕，先跑该屏幕最小测试，再继续下一屏。最后输出：变更文件、通过测试、剩余风险。

