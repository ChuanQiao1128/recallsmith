# 首页评审 + 推广台词 + 推广前还要补什么（2026-09-17）

> 状态：**评审与文案，未改代码**。首页 16 条结论每条都经过一个独立"反方"对照代码复核（0 条被推翻）；所有广告用语都对照一张从代码和线上 manifest 提取的"可宣传事实表"做过两轮事实核查。
> 代码基线：`main@b1ecb8c`，`mobile/src/screens/HomeScreen.tsx`（1293 行）。
> 本文的行号以该基线为准。

---

## 0. 先说三件事

1. **AWS 卡组已经上线了，而且是 154 张，不是 12–15 张。** 线上 manifest（`https://d1ditdi9jqpy6n.cloudfront.net/content/manifest.json`）里 `aws-saa-c03` 是 live / free / public，build `20260916T151907Z-e973860b`，154 张卡；`csharp-basics` 是 81 张（manifest 里 `totalCards: 115` 是手填的旧值，真实包只有 81 张）。`docs/aws-saa-demo-deck-plan-2026-09-16.md` 还写着"方案，未执行"，已经过期。**所以文案按"两套免费卡组、235 张卡"写，不要写 115。**
2. **首页不是"不好看"，是"没有一个赢家"。** 包、跳动的金色 kicker、28pt 标题、四色数字卡、蓝色按钮、缩略图全在抢注意力；同一个"12 张待复习"最多出现 5 次；而唯一的主按钮在 360–390pt 手机上掉到首屏以下。产品最核心的一句话——**学完今天的卡 → 赚 1 抽 → 开包 → 新卡**——首页从来没说过。
3. **推广前有 6 件事必须先做**，否则截图和评论区会出问题（详见 3.1）：① 线上 C# 卡组里有一张占位卡 `c-081`、三张 usage 以 "Gemini said" 开头、十五张 usage 和题目错位——我逐张核过；② **App Store 页面已经公开上架（2026-08-22，0 评分），但描述和 4 张截图还是旧的 "Spaced Recall" 日历产品**，每条帖子最终都落在这页；③ 首页假的 "AI / Cloud — Coming soon" 占位（且 mock 的 `csharp` slug 和真实 `csharp-basics` 不匹配，会出现一个假的 "C# — Coming soon" 和真 C# 并排）；④ 新用户拿着 3 抽却被按钮送去 Library，而 Library 在未安装时直接抛错；⑤ AWS 卡包在首页用的是一张写着 "RECALL deck / Cloud" 的模糊占位图；⑥ Home 每次刷新都会向系统请求通知权限，用户在提示页点了 "Not now" 也照样弹。付费墙没有价格、删账号是 mock、App 内没有分享入口，排在这些后面。

---

## 1. iOS 首页评审

### 1.1 首页现在从上到下是什么

| 顺序 | 元素 | 代码 | 高度（约） |
|---|---|---|---|
| 1 | "DeveloperCards" 28pt/900 + 状态副标题（`12 cards waiting today`）+ 带边框的齿轮 | `HomeScreen.tsx:502-525` | 65 |
| 2 | 金色光晕 + 168×240 浮动卡包（3 秒上下浮动）| `:665-705`, `:1024-1052` | 272 |
| 3 | 金色大写 kicker（呼吸闪烁：`12 DUE` / `READY`）| `:711-720` | 29 |
| 4 | 28pt/900 hero 标题（`12 cards waiting`）+ 11pt 副标题 | `:723-728` | 40–100 |
| 5 | "Today's pressure" 卡：Normal / Elite / Boss / Total 四个彩色格 + "Mastered in selected deck: N" | `TodayPressureCard.tsx` | 130–190 |
| 6 | 蓝色药丸主按钮（52pt）| `:738-756` | 68 |
| 7 | 抽卡状态文字（左对齐，没有上边距）| `:757-763` | 24 |
| 8 | "Choose a pack" 横向缩略图：C# / AI / Cloud，后两个 "Coming soon" | `:784-859` | 130 |
| 9 | "Sign in for cloud backup ›" | `:960-974` | 48 |

主按钮底边在 iPhone 15（可用高约 699pt）上约 677pt——标题一换行就掉出首屏；iPhone SE（可用约 587pt）上按钮顶边约 676pt，**永远看不到**。

### 1.2 核心诊断（三个视角的共识）

- **视觉层级**：两个 28pt/900 标题（品牌字 + 动作标题）相隔 300pt 互相打架；两个永不停止的动画（包浮动 3.0s、kicker 呼吸 2.2s）节奏不同、相距 40pt，眼睛停不下来；`TodayPressureCard` 是奶油色卡 + 四种粉彩格 + 5 条 1px 边框，压在奶油色渐变页面上，是全页最"忙"的区域，却不承载任何下一屏能验证的信息。约 30 处绕过 token 的字面量（9/10/12/18pt 字号、10/14/18 圆角、rgba）。
- **首次使用**：新用户带着 3 个启动抽进来，hero 说 "A reward draw is ready"，徽章说 "3 pulls ready"，包在发光——但唯一的按钮写 **"Open library"**，点包也去 Library。产品的招牌时刻（第一次开包）在另一个 tab，首页没有任何指向。
- **文案 / 信息架构**：首页用的是状态机内部词汇——pressure、route、node、Normal/Elite/Boss、fresh、reserve、full clear——之前没有任何屏幕定义过，之后 SessionCard / Draw / Library 也不再出现（唯一用这些词的 ChallengeScreen 已被从主路径移除）。"12 due" 这一个数字出现 5 次，而 `homeSelectors.ts:410-416` 已经算好的"最低目标行"（`Keep streak: 1 card · Full clear: 5 cards`）从未渲染。

### 1.3 逐条结论（16 条，全部通过反方复核）

严重度是反方复核后的修正值。"改测试"列出的是必须同步改的测试字面量，其余 testID 均可保留。

| # | 严重度 | 问题 | 证据 | 建议改法（经复核的安全版本） | 工作量 | 改测试 |
|---|---|---|---|---|---|---|
| F0 | P1 | **AWS 卡组在首页显示为一张 "RECALL deck / Cloud / CLD" 的模糊占位图**（素材扫描发现，我看过图）。AWS 上线后它出现在选择器里，被选中时就是 hero 大图——和猫头鹰包并排，是首页"看着不对"的直接原因之一 | `assets/packs/cloud.png`（400×580，gen_packs.py 生成，烤着旧品牌字）；`packArt.ts:215-223` 把任何含 `aws` 的 slug 归到 `cloud` | 出一张与 C# 同规格（1024×1536）的 AWS 封面 + 卡背；`normalizeSlugForPack` 加 `aws-saa-c03 → aws`（`aws.png` 也是占位图，一起换） | M（画图） | 无 |
| F1 | P1 | **主按钮在 360–390pt 手机上掉出首屏**，hero 区高 370–490pt | `HomeScreen.tsx:985-1114` 各段 padding/尺寸相加；`TodayPressureCard.tsx:20-22` 宽 <390 时四格变 2×2 | 卡包保持 168×240（"卡包就是主视觉"是产品规则）；从文案和留白里抠高度：删 kicker 行及其动画（`:710-719`、`:131`、`:142-143`、`:713`，−29pt）；按 `mobile/docs/design/v9-copy-delta.md:57-58` 不再渲染 heroTitle+heroSupport（或至少 heroTitle 单行、删 heroSupport，−40~64pt）；`heroBand paddingBottom lg→md`、`actionGroup marginTop md→sm`（−12pt）。改完 iPhone 15 上按钮底边约 575pt。**不要把按钮挪到 TodayPressureCard 上面**（gacha-v7 §3.1.1 规定计数在按钮前） | S | 无 |
| F2 | P1 | **Normal / Elite / Boss 三格数的是一条看不见的"路线预览"**，加起来不等于 Total；没东西可学时显示 "1 Normal"（warmup 节点被算进去） | `TodayPressureCard.tsx:32-64`；`homeSelectors.ts:102-122, 168-192` | 保留四个 testID 和 grid：改标签为 `Due`=selectedDue、`New`=selectedNew、`Learned`=selectedMastered（现有值本来就是 learned）、`Total` 保留；删 "Mastered in selected deck" 脚注；副标题只留卡组名；`homeSelectors.ts:515` 的 `N normal · N elite · N boss max` 改成不含角色词的文案；全 0 时渲染一行 "Nothing to review yet — open a pack to get your first cards." | S | `home-primary-cta.test.tsx:264-266` 三个字面量 |
| F3 | P1 | **新用户（3 抽、卡组未安装）被指向 Library，不是抽卡** | `homeSelectors.ts:246-248, 306-313, 650-665`；`HomeScreen.tsx:353-360, 641-648`；`rewardWallet.ts:37` | 在 `buildHomeVM` 的 override（`:658-665`）加一条：`first_run` 且 `draw.state !== 'locked'` 且 actionHint 为 `install` 时，CTA = `Open reward draw` / nav `draw`（DrawScreen 的 `resolveOrInstall` 会自己装卡组，Home 不要重复装）；包的 onPress 在 install+有抽时也去 Draw。`!selectedDeck` 分支不动 | M | 新增 2 个 case；`home-cta-target.test.tsx:264-289` 不动 |
| F4 | P2 | **同一个 due 数最多渲染 5 次**（header 副标题、金色 kicker、hero 标题、hero 副标题/卡副标题、Total 格） | `HomeScreen.tsx:507-513, 603-611, 716-718`；`homeSelectors.ts:515`；`TodayPressureCard.tsx:29` | 只改三处无增量的表面：header 副标题改成非数字的一行（星期/日期或固定产品语，保留 firstDrawCoach 的 "Tap your pack to begin" 分支）；hero.subline 默认值改成"赚抽规则"句；TodayPressureCard 副标题去掉 ` · N due · N fresh`。kicker 只在 Locked / Install / Update / Mastered ✓ 时显示状态字 | S | 无 |
| F5 | P2 | **首页说的是规划器术语**（pressure、route、node、reserve、fresh、full clear、run），之前没人定义、之后没人再用 | `TodayPressureCard.tsx:25-30`；`homeSelectors.ts:207, 214, 227, 458, 500, 515` 等 | 只换渲染出来的字符串、并保证每句 nudge 和"先学习"的 CTA 一致：`Today's pressure`→`Today`；`:227`→`Review today's cards to earn a pull`；`:214`→`N pulls ready · M more waiting`；`:207` 保留 "Wallet full" 字样；`:500`→`Pulls are full. Today's review still comes first; spend a pull afterwards.`；`fresh`→`new`。不动 CTA 标签（gacha-v7 §110 固定） | S | `home-economy-floor.spec.tsx:221`、`home-primary-cta.test.tsx:283/302/337` 的字面量 |
| F6 | P2 | **"Choose a pack" 并不 choose**：三个里两个是硬编码 "Coming soon" 假包（AI 是明确的 non-goal；"Cloud" 不是 AWS SAA-C03），点了弹 Alert；`disabled: true` 根本没传给 Pressable | `HomeScreen.tsx:49-54, 577-588, 795-812`；`docs/gacha-acquisition-learning-loop-plan.md:48-53` | 删 `ai` / `cloud` 两条（以及 mock 合并逻辑）；如要预告，走 manifest 的 `availability: 'coming'`（`homeSelectors.ts:535-536` 已给 actionHint `none`），渲染成真 disabled、无 Alert、状态字用 `Soon`（gacha-v7 §213 禁用 "coming soon" 字面）；标签改 `Your packs`；已安装的 tile 点击就地切换（`setActiveDeckSlug + setSelectedSlug + refreshHome`），只有 install/update/paywall/trial 才走 `handleDeckPress`；`visualDecks` 为空时用 `default` 封面兜底（`home-cta-target.test.tsx:265-288` 用 0 个卡组挂载，否则会抛）。`home-pack-visual` 的 ScrollView 始终渲染 | M | 无（保留 testID） |
| F7 | P2 | "DeveloperCards" 品牌字是第二个 28pt/900 标题，而解释性的副标题是全页最小的字 | `HomeScreen.tsx:503-505, 991, 1091-1097` | `title` → `typography.title3 / 900 / inkSecondary / letterSpacing 0.4`（当 wordmark，不当标题）；`heroSupport` → `bodySmall / inkSecondary`；heroTitle 是唯一的 title1 | S | 无 |
| F8 | P2 | 9pt 大写标签、10pt 副标题/脚注低于 11pt caption 下限；12/16/18pt 字面量 | `TodayPressureCard.tsx:85, 91, 98-100, 108-109`；`HomeScreen.tsx:1009, 1015, 1251, 1287` | `metricLabel` → `typography.caption`，去掉 uppercase；subtitle/footnote → caption；**metricValue 保持 18（或 title3 17），不要升到 22**，否则 2×2 布局又把按钮挤下去；不动 `metric/metricWide/metricCompact` | S | 无 |
| F9 | P2 | hero 副标题许诺的 pulls 和下方抽卡标签说的 "locked" 矛盾；标题在 HomeScreen 和 VM 两处决定 | `homeSelectors.ts:418, 466, 474`；`HomeScreen.tsx:597-610` | 只改 `today_done` / `today_full_clear` 两个分支：把 `draw` 传进 `buildHeroCopy`，`draw.state === 'locked'` 时用 "Minimum goal done — the rest of the route earns your next pull." / "Full clear done. Earn tomorrow's pull with tomorrow's route."；`wallet_full` 文案不动；HomeScreen 的标题 override 先留着 | M | 无 |
| F10 | P2 | **死胡同**：没东西可学 + 0 抽时，标签说 "Clear today's route to unlock pulls"、kicker 说 READY、按钮说 "Open library" | `homeSelectors.ts:225-228, 280, 363-379`；`HomeScreen.tsx:557` | `state: 'locked'` 不动，只改 label：`buildDrawVM(wallet, selectedDeck)`，`canStudy && due+new === 0` 时返回 `No cards due · a free pull returns tomorrow`（economyFloor 保证明天真的会发 1 抽，所以这句是诚实的）；kicker 在 `canStudy && due===0 && new===0 && !walletHasPulls` 时显示 `Caught up`。**另立 issue**：`sessionBuilder.ts:42` 对 1 张 fresh 卡给出 limit 2，导致永远无法 full clear、永远赚不到抽 | S | `home-economy-floor.spec.tsx:221` |
| F11 | P2 | "Deck mastered 🎉" 和 "Mastered in selected deck: N" 数的是"复习过一次"，不是 mastered（stage ≥ 4） | `deckActionResolver.ts:206, 241`；`progressSelectors.ts:16-17 vs 29`；`HomeScreen.tsx:550-561` | 保留 `masteredApprox`（有测试钉着、且喂 `percent`），在 `DeckSummary` 加可选字段 `masteredCount`，用 `isMasteredProgress` 计算；`isFullyMastered` 和 `selectedMastered` 改读它 | S | 无（字段可选，fixture 不用改） |
| F12 | P2 | 卡包是第二个主动作：a11y 标签说 "Open C# pack"，实际却进学习会话；和下方按钮的路由逻辑是两棵独立的决策树 | `HomeScreen.tsx:631-676`；`homeSelectors.ts:296-407` | `handleFeaturedPackPress` 改成：mock → disabled；`firstDrawCoach` → Draw；install/paywall/update/trial → `handleDeckPress`；其余 → `handlePrimaryCta()`，a11y 标签用用户看到的同一段文字；删掉 `walletHasPulls` 分支，让"有抽"永远不压过"有卡要复习"。**不要**给包加 `home-primary-cta` testID（测试断言只有一个） | S | 建议新增 2 个 case |
| F13 | P2 | 抽卡状态文字左对齐、无上边距：`rewardStatusRow` 定义了但从未使用 | `HomeScreen.tsx:755-762, 1130-1139` | 在 `rewardStatusText` 加 `marginTop: spacing.sm, textAlign: 'center', alignSelf: 'center'`，删 `rewardStatusRow`；testID 留在 Text 上 | S | 无 |
| F14 | P2 | TodayPressureCard 奶油叠奶油，四个任意粉彩格 + 5 条 hairline 边框挤在 130pt 里；Elite 格的填色就是页面渐变的终点色，看起来像个洞 | `TodayPressureCard.tsx:8-15, 73-106` | 不要套 StatePanel（会把高度撑回去）：去掉卡和格子的 borderWidth/borderColor，删四个粉彩 token，格子统一 `parchmentBg` 或透明，Total 只靠字重/墨色区分；style 数组结构保留（测试比对 `{width:'48%'}` / `{flex:1}`） | M | 无 |
| F15 | P2 | 静止页面上两个无限 Animated 循环，时长硬编码，不检查系统"减弱动态效果" | `HomeScreen.tsx:130-157`；`DrawCeremonyScreen.tsx:499-507` 已有正确模式 | 删 kicker 呼吸循环；包浮动改 2400ms/半周期并用 `readRN('AccessibilityInfo')` 守卫地读 `isReduceMotionEnabled` + `reduceMotionChanged`；**不要 import `src/theme/motion.ts`**（顶层 `Easing.out` 在 home 测试的 RN mock 下会抛） | S | 无 |
| F16 | P3 | 首页从不陈述循环"学 → 赚抽 → 开包 → 新卡"；规格要求的"最低目标行"算好了但没渲染 | `homeSelectors.ts:410-416, 705`；`HomeScreen.tsx` 无 `goal` 引用；`HomeHero.tsx` 无人 import | 在 TodayPressureCard 和主按钮之间渲染 `vm.goal`（`Keep streak: 1 card · Full clear: 5 cards`）为一行，新 testID `home-goal-line`；`home-draw-status-badge` 不动；"开包 → 新卡"那半句放 WelcomeScreen（`:79-82` 已有 "Open packs. Collect cards. Master the deck."）；删 `HomeHero.tsx`，`hero.helper` 标 @deprecated；**不要硬编码 "earn 1 pull"**（`summaryMapper.ts:209` 里 rewardPulls 按路线变） | S | 无 |

**未经反方复核的 9 条（可信度略低，按需处理）**：F17 manifest 里 `availability: 'coming'` 的卡组会被渲染成 "Ready" 绿点甚至成为 featured；F18 "Tap your pack to begin" 因三元顺序永远到不了目标用户；F19 主按钮 52pt 而其他四个屏都是 56pt，`PrimaryButton` 原语无人使用；F20 6px 纯颜色状态点、选中 tile 没有描边；F21 齿轮是全页唯一带边框的元素、且和 Me tab 重复；F22 约 20 处 rgba / 圆角 / padding 字面量，光晕永远是金色（哪怕包是紫色）；F23 "登录"在四处用四种说法卖；F24 错误态叠两个 "Try again"、同一句失败说三遍；F25 死代码（`renderCalendar`、未用样式、`HomeHero.tsx`）让文件维持 1293 行。

### 1.4 建议的首页结构（Home v5，从上到下）

目标：iPhone SE 首屏就能看到按钮；每个信息只说一次；新用户 10 秒内知道"这是什么、为什么有包、点哪里"。

```
┌──────────────────────────────────────┐
│ DeveloperCards (17pt 灰)        ⚙︎   │  ← wordmark 降级；齿轮去边框（F7, F21）
│                                      │
│           [ 卡包 168×240 ]           │  ← 保留，浮动改 2.4s + 减弱动态守卫；
│            (金色光晕)                │     点包 = 主按钮（F12, F15）
│                                      │
│   12 cards due in C# / .NET          │  ← 唯一的一行状态，22pt（F4, F9, F10）
│   Keep streak: 1 card · Full clear:  │  ← vm.goal，13pt（F16）
│   5 cards → earn a pull              │
│                                      │
│  [   Start today's challenge   ]     │  ← 56pt PrimaryButton（F19）
│      3 pulls ready · 0 waiting       │  ← 居中（F13, F5）
│                                      │
│  Today · C# / .NET                   │  ← 卡去边框去粉彩（F14）
│   12 Due  ·  3 New  ·  20 Learned  · │  ← 下一屏能验证的数字（F2, F11）
│   12 Total                           │
│                                      │
│  YOUR PACKS                          │  ← 只放真实卡组，就地切换（F6）
│  [C#/.NET ●12]  [AWS SAA ●]          │
│                                      │
│  Sign in to keep progress across     │  ← 一句话来自 VM（F23）
│  devices ›                           │
└──────────────────────────────────────┘
```

按 gacha-v7 §3.1.1 的顺序（计数在按钮前）保守估算：header 44 + hero 268 + 状态 30 + 目标 20 + 计数卡 ~110 + 按钮 72 + 标签 24 ≈ **568pt 到按钮底边**，iPhone SE（587）刚好首屏。如果你愿意修订 §3.1.1 把按钮提到计数卡前面，会到 ~458pt，所有机型都宽裕——这是产品决定，不是我能替你做的。

### 1.5 改动顺序

| 批次 | 内容 | 预计 | 说明 |
|---|---|---|---|
| **第 1 天（推广截图前必做）** | F6 删假包、F1 删 kicker + hero 文案缩减、F13 居中、F15 删呼吸循环 + 减弱动态、F7 wordmark 降级、F8 字号下限、F4 去重、F5 换词（含 3 处测试字面量）；**并行：F0 的 AWS 封面画起来** | 半天到一天 | 全是 S，改完 `npx vitest run` 应只有 F5 的字面量要跟着改。这批全是 JS，可以走 EAS Update OTA，不用等审核（见 3.6） |
| **第 2 天** | F2 四格改 Due/New/Learned/Total、F14 去边框去粉彩、F3 新用户 CTA 直达 Draw、F12 包 = 按钮、F16 渲染 goal 行 | 一天 | F3 + F12 一起改，Home 只剩一棵路由决策树 |
| **第 3 天** | F9、F10、F11 + F10 提到的 `sessionBuilder.ts:42` 根因 | 半天 | 都是 VM 层小改 |
| 之后 | F17–F25 | — | 先复核再改 |

---

## 2. 推广台词

> 生成方式：5 个不同切入角度（赚来的抽卡 / 面试与考试结果 / 独立开发者故事 / 反刷题 / 程序员幽默）各写一套 → 3 个评委（事实核查 / 资深开发者是否会尴尬 / 免费渠道转化）打分 → 以"赚来的抽卡"为主干合并 → 两个反方逐句对照事实表挑刺（10 处已改）。**下面所有数字都有代码或线上 manifest 出处**，见 2.10。

### 2.0 用之前先看这三条（我比 workflow 更保守的地方）

1. **"每张卡都是我手写的、没有 AI"——这句现在不能说。** 线上 C# 卡组里 `c-024`、`c-037`、`c-070` 的 realWorldUsage 以字面 "Gemini said" 开头；`c-059` 里贴着一段面试官对话；`c-001`–`c-015` 的 realWorldUsage 和题目对不上（`c-001` 问 `.Result` 线程饥饿，usage 讲 Python vs Java）；`c-081` 是一张题目为 "c-081"、解释为 "c-080121" 的占位卡，任何人开包都可能抽到。我今天用 curl 从 CloudFront 逐张核过。所以下面所有文案里我把 "written by me" 改成了 **"written or edited by me"**，FAQ 第一题给了两个版本，**你选真实的那个**——但无论选哪个，先把 3.1 第 1 条的内容清理做完再发帖，否则一张截图就能被打脸。
2. **"intermediate .NET interview prep" 改成 "fundamentals to intermediate"。** 81 张里 38 张是 OOP / 构造函数基础，11 张是明确的入门题（"What is a Method in C#?"、loop types），async 只有 2 张、threading 0 张。要么先按 3.4 重整卡组，要么用我改过的措辞。
3. **App Store 链接可以用了，但 listing 先别发。** 我自己查了 `itunes.apple.com/lookup?id=6756044885`：App 于 2026-08-22 以 1.5.0 公开上架，0 评分——但商店页面的描述还是旧产品 "DeveloperCards: Spaced Recall"（"Full Stack Questions"、"A concise calendar for preview"），4 张截图是旧的蓝色日历 UI，隐私政策链接标题还是 "DevCards Spaced Recall"，没有 marketing URL。**每一条帖子最终都落到这个页面**，所以 2.3 的 App Store 文案是这次最先要上的东西（纯 metadata，不用出 build）。链接：`https://apps.apple.com/app/id6756044885`。

### 2.1 定位与一句话

**定位（内部用，不对外）**
For developers prepping a .NET interview or the AWS SAA-C03 who would rather collect than grind, DeveloperCards is an iOS spaced-repetition app where every new card comes out of a pack you earned by clearing today's short review: pulls are never sold, a pull is never a duplicate, and rarity is difficulty. Unlike bulk-imported flashcard decks, the reason you open it on day 9 is the pack; unlike gacha games, the economy is tuned to find your study habit, not a whale.

**一句话（到处都用这一句）**

- EN：DeveloperCards: spaced-repetition flashcards for developers where card packs are earned by studying, never bought, and never deal a duplicate. 81 C# / .NET + 154 AWS SAA-C03 cards, free, iOS.
- ZH：DeveloperCards：给开发者的抽卡背题 App，抽数只能靠学习赚、每抽必新。81 张 C# / .NET + 154 张 AWS SAA-C03 卡（内容英文），免费，iOS。

**三个钩子的优先级（评委总分）**：赚来的抽卡 24 > 面试/考试结果 21 = 程序员幽默 21 > 独立开发者故事 20 > 反刷题 18。实际用法：抽卡钩子负责让人停下来滑动，结果钩子负责 App Store 描述，开发者故事负责长帖，幽默负责短帖。

### 2.2 Taglines

**英文（8 条）**

- Every pull is earned. Every pull is new.
- Interview prep with a pity system.
- The only whale here is your own discipline.
- Rarity is difficulty. Legendary just means it's hard.
- The only gacha where a 10-pull is 10 questions you haven't studied yet.
- Finish today's review. Rip a pack. Never a dupe.
- One developer. 235 free cards. Zero pulls for sale.
- Spaced repetition you actually open on day 9.

**中文（6 条）**

- 每抽必新，学习赚下一抽
- Legendary 不是更闪，是更难
- 抽卡不卖，只能靠学
- 一个人写的开发者抽卡背题 App：学习才能抽，抽了才能学
- 这款 gacha 里唯一的氪佬，是你自己的自律
- 抽到 Legendary 不是欧皇，是这题真的难

### 2.3 App Store 文案

| 字段 | 内容 | 长度 |
|---|---|---|
| Subtitle（≤30） | C# & AWS SAA-C03 flashcards | 27 |
| Promotional text（≤170） | Two free decks: 81 C# / .NET interview cards, 154 scenario-style AWS SAA-C03 cards. Learn a new card, earn a pull, rip a pack. Never a dupe, never for sale. | 156 |
| Keywords（≤100） | `csharp,dotnet,net,interview,srs,spaced,repetition,exam,quiz,gacha,study,cloud,architect,collect` | 95 |

**Description**

```text
Prepping a .NET interview or the AWS SAA-C03? DeveloperCards turns the prep into a collection you build by showing up. The loop in one sentence: learn a new card, earn a pull, rip a pack, and what you draw becomes what you study.

WHAT'S INSIDE
Two free decks, both in English:
• C# / .NET — 81 interview cards, fundamentals to intermediate (async/await, boxing, controllers, OOP and more) with a C# code snippet on essentially every card.
• AWS Associate Architect — 154 scenario-style SAA-C03 cards (S3 storage classes, ElastiCache Multi-AZ, IAM, Lambda and more) with a real-world usage note on nearly every card.
Every card is a question with a written explanation. Rarity is difficulty: Common, Rare and Legendary map to how hard the question is, so a Legendary is one of the hardest questions in the deck.

HOW PULLS WORK
• Pulls are earned, never sold. Learn a new card, earn a pull: the first time you rate a card Hard, Good or Easy, one pull lands in your wallet, no claim button. Clearing everything due for the day adds one more, once a day. New players start with 3 pulls, so the first pack opens in seconds.
• Never a duplicate. The draw pool is only the cards missing from your collection.
• Pity: after 10 Commons in a row, the next card is guaranteed Rare or better, as long as an unowned Rare or Legendary is still in the pack.
• Open 1 or Open 10. You are only charged for cards you actually receive.
• Your wallet holds up to 60 pulls plus a 5-pull reserve. If you ever have nothing left to study and no pulls, you get 1 pull a day.
• Every draw is seeded and replayable, so the app can show why you got what you got.
• Rip the foil, watch the cards drop, tap to flip. Rare and Legendary reveals get their own sound and haptics.

HOW STUDY WORKS
Rate each card Again / Hard / Good / Easy. Cards return on a 7-stage ladder of 1, 2, 4, 8, 15, 30 and 60 days; a card is Mastered once it reaches the 15-day stage. Reviewing a single card keeps your streak alive. Streaks and milestones are tracked; the Library shows each card as New, Learning or Mastered.

OFFLINE, NO ACCOUNT NEEDED
Decks are stored on your phone and reviews are offline-first. Signing in is optional and adds cloud backup of your progress and collection.

FROM ONE DEVELOPER
DeveloperCards is an indie project: one person built the app and the backend and writes or edits every card by hand. Both decks are free. A monthly Premium subscription exists for future premium decks, but there is nothing premium to unlock yet. Next up: more decks. Feedback is welcome.
```

**What's New（1.5.x）**

```text
• You study what you draw. The daily route now only includes cards you own, so your collection is the curriculum.
• New free deck: AWS Associate Architect, 154 scenario-style SAA-C03 cards with a real-world usage note on nearly every card.
• Fair charging on short packs. When a pack has fewer unowned cards than you asked for, you are only charged for the cards dealt, and a fully collected pack costs nothing.
```

### 2.4 短帖（英文，≤280 字符，8 条）

**[earned-gacha, core pitch]**（249 字符）

> I built a flashcard app where you can't buy pulls. Learn a new card, earn a pull, rip a pack. Every card is one you don't own yet, so no dupes, ever. Rarity = difficulty, so Legendary means the hardest questions. DeveloperCards, iOS, 235 free cards.

**[thread opener, economy numbers]**（257 字符）

> Thread: gacha economies are usually tuned to find the whale. I wanted one tuned to find your study habit. How the pull economy in DeveloperCards works, with the actual numbers (60+5 wallet, 10-Common pity, 3 starter pulls, one pull per new card learned). 1/

**[AWS SAA-C03, certification-community safe]**（279 字符）

> Sitting SAA-C03? 154 scenario-style cards in DeveloperCards: S3 storage classes, ElastiCache Multi-AZ, IAM, Lambda. Written explanations, a real-world usage note on nearly every one. Free, iOS, works offline. It won't pass the exam for you; it will make sure you review on day 9.

**[.NET interview, content first]**（277 字符）

> .NET interview coming up? 81 C# / .NET cards, fundamentals to intermediate (async/await, boxing, controllers, OOP) with a code snippet on essentially every one. Rate Again/Hard/Good/Easy; cards return at 1, 2, 4, 8, 15, 30, 60 days, Mastered at the 15-day stage. Free, iOS, written by one indie dev.

**[dev-humor, Anki contrast (social only, never App Store)]**（266 字符）

> Anki: here are 500 cards, good luck.
> 
> DeveloperCards: here are 3 pulls. Open a pack, study what you drew, learn a new card, earn the next pull. 1–5 cards a day, streak survives on 1 review. Intervals 1 → 60 days.
> 
> 235 free cards: 81 C# / .NET + 154 AWS SAA-C03. iOS.

**[dev-humor, rarity is difficulty]**（270 字符）

> In DeveloperCards rarity is difficulty. Common, Rare, Legendary map to how hard the question is, so pulling a Legendary is the app saying "you'll hate this one." Pity: 10 Commons in a row and the next card is Rare or better (while the pack has one). 235 free cards. iOS.

**[negative space, trust]**（272 字符）

> Things DeveloperCards doesn't do: sell pulls, sell loot boxes, deal you a duplicate. Things it does: 235 free cards across C# / .NET and AWS SAA-C03, 7-stage spaced repetition (1 to 60 days), a streak you keep alive with 1 card, and a pack ceremony with haptics and sound.

**[indie story, the stack]**（277 字符）

> One person, whole stack: React Native app, React admin console, C#/.NET Lambdas, PostgreSQL, Snowflake, and every card edited by hand. DeveloperCards: spaced-repetition flashcards for devs where card packs are earned by studying, never bought. 81 C# / .NET + 154 AWS SAA-C03 cards. Free, iOS.


### 2.5 短帖（中文，5 条）

**[核心卖点：抽卡靠学不靠氪]**

> 做了个给开发者的抽卡背题 App：DeveloperCards（iOS）。抽数不卖，只能靠学：每学会一张新卡赚一抽（第一次评到 Hard 以上就算学会），清空当天到期再加一抽。卡池里只有你还没拥有的卡，永远不重复。稀有度＝难度，Legendary 就是整套里最难的那一档题。现在两套免费卡组：C# / .NET 81 张、AWS SAA-C03 154 张，内容全英文。

**[经济系统：保底、钱包、兜底]**

> 把 gacha 的保底逻辑搬进 SRS：连出 10 张 Common，下一张保底 Rare 或更高（前提是包里还有你没拥有的 Rare / Legendary）；钱包上限 60 抽 + 5 抽备用；没卡可学又没抽数时，每天自动送 1 抽。你永远不会卡死，也永远不用花钱。

**[AWS SAA-C03 备考]**

> 用英文备考 AWS SAA-C03 的可以试试：154 张场景题卡（S3 存储类别、ElastiCache 多可用区、IAM、Lambda……），几乎每张带一句真实使用场景说明，顺便练英文题感。免费，iOS，离线可用。不承诺你能过，只想解决第 9 天打不开 App 的问题。

**[.NET 英文面试]**

> 准备英文 .NET 面试的：81 张 C# / .NET 面试题卡（基础到中级），async/await、装箱、Controller 这些常问点，基本每张带代码片段。Again / Hard / Good / Easy 四键打分，1、2、4、8、15、30、60 天回访，到 15 天档算 Mastered。免费，iOS，一个人写的独立项目。

**[程序员幽默：稀有度就是难度]**

> 稀有度就是难度，抽到 Legendary 不是欧皇，是这题真的难。每一抽必是你还没拥有的卡，所以十连就是十道你还没学过的题。DeveloperCards，iOS，235 张免费英文卡，抽数买不到，只能靠学会新卡。


### 2.6 长帖（英文，3 篇）

#### 渠道类型：Show HN / maker story (also dev.to, LinkedIn long-form, Summer of Tech follow-up)

**标题：** Show HN: I built a flashcard app where you can't buy the gacha pulls (C# + AWS SAA-C03, iOS, free)

```text
The problem with interview prep is rarely the material. It's opening the app on day 9.

I'm a solo developer and I built DeveloperCards end to end: the React Native app, a React admin console for authoring, a C#/.NET Lambda backend on PostgreSQL, and Snowflake for analytics. Every card is written or edited by me, one at a time, in that console.

The idea: spaced-repetition flashcards for developers, except new cards come out of card packs, and the only way to earn a pull is to study. The rules:

- Pulls can't be bought. Learn a new card, earn a pull: the first time you rate a card Hard, Good or Easy, one pull lands, and clearing everything due for the day adds one more, once a day. You start with 3 pulls so the first pack opens in seconds.
- Every pull is new. The draw pool is only the cards you don't own yet, so duplicates are impossible.
- Rarity is difficulty. Common / Rare / Legendary map to difficulty 1 / 2 / 3, so a Legendary drop is one of the hardest questions in the deck, not a shinier copy.
- Pity: 10 Commons in a row and the next card is guaranteed Rare or better, as long as an unowned Rare or Legendary is still in the pack. It can fire mid-pull.
- The wallet caps at 60 pulls plus a 5-pull reserve, and if you hit zero pulls with nothing left to study, the app grants 1 a day.
- You're only charged for cards you actually receive; a fully collected pack costs nothing.
- Every draw is seeded and replayable, so the app can explain exactly why you got what you got.

Your collection is your curriculum: you only review cards you've drawn. Scheduling is a 7-stage ladder (1, 2, 4, 8, 15, 30, 60 days) with Again / Hard / Good / Easy; Mastered at the 15-day stage; one review keeps the streak. Studying and drawing work offline and need no account; sign in only for cloud backup.

Content today, both decks free and in English: C# / .NET (81 interview cards from fundamentals to intermediate, code on essentially every one) and AWS Associate Architect (154 scenario-style SAA-C03 cards, a real-world usage note on nearly every one). 235 cards. iOS.

Monetization, for the record: nothing random is sold, ever. There is a monthly Premium subscription wired up for future premium decks, but no premium deck exists yet, so today it unlocks nothing; ignore it.

I'd like feedback on the economy, especially from people who've thought harder about pity systems than I have.
```

#### 渠道类型：.NET community (r/dotnet, r/csharp, a .NET Discord, NZ/AU tech Slack)

**标题：** 81 C# / .NET interview cards (fundamentals → intermediate), delivered as card packs you earn by studying

```text
I've been writing C# / .NET interview cards and shipping them in a small iOS app I built, DeveloperCards. Posting here because the deck is the part I most want picked apart by people who actually interview in .NET.

The deck: 81 cards aimed at interview prep, from fundamentals up to intermediate — async/await, boxing, controllers, OOP and more. Every card is a question with a written explanation, and there is a C# code snippet on essentially every card, so you're reading the behaviour, not a definition. It's in English, and it's free.

How you study it: a short daily route of 1–5 cards sized from what's actually due. Four buttons, Again / Hard / Good / Easy. Again brings the card back in 10 minutes and drops it two stages; Hard shortens the interval to 70%; Good moves up one stage; Easy jumps two. Intervals are 1, 2, 4, 8, 15, 30 and 60 days, and a card is Mastered once it reaches the 15-day stage. Reviewing one card keeps the streak alive. Works offline; no account needed.

How you get the cards, which is the odd part: they come out of card packs. Learn a new card, earn a pull. Rip the foil, cards drop, tap to flip; Rare and Legendary reveals get their own sound and haptics. Rarity is difficulty, so a Legendary is one of the hardest questions in the deck, not a cosmetic. Every pull is a card you don't own yet, so no duplicates, and after 10 Commons in a row the next card is guaranteed Rare or better (while an unowned Rare or Legendary remains). You only study what you've drawn. Pulls cannot be bought; you start with 3 and earn one per new card learned, plus one a day for clearing what's due.

Full disclosure on the stack, since it's relevant here: the backend is C#/.NET on AWS Lambda with PostgreSQL, the admin console is React, the app is React Native. One person, all of it, including writing or editing every one of the 81 cards.

What I'd like from you: which intermediate .NET interview topics are missing or wrong. If you'd ask it in a real interview and it isn't in the deck, tell me.
```

#### 渠道类型：AWS certification community (r/AWSCertifications, cloud study Discords, LinkedIn cloud groups)

**标题：** Free SAA-C03 scenario flashcards (154 cards) in a spaced-repetition app where new cards come from packs you earn by studying

```text
Up front, so nobody has to ask: this is not official AWS material, it's not an exam simulator, and it won't pass the exam for you. It's a set of 154 scenario-style flashcards for SAA-C03 topics, written or edited by me, inside a small iOS spaced-repetition app I built called DeveloperCards. The deck is free.

What's on the cards: scenario questions in the style of the exam, across S3 storage classes, ElastiCache Multi-AZ, IAM, Lambda and more. Every card has a written explanation, and nearly every card has a real-world usage note explaining when you'd actually reach for that option. Content is in English.

How the studying works: each day you get a short route of 1–5 cards sized from what's actually due. Rate each one Again / Hard / Good / Easy and it returns on a 1, 2, 4, 8, 15, 30 or 60-day interval; reach the 15-day stage and it's Mastered. One card a day keeps your streak. Works offline, no account needed; sign in only if you want cloud backup.

What's different: new cards come out of card packs, and pulls are earned only by learning new cards (you start with 3). Every pull is a card you don't own yet, so duplicates are impossible. Rarity is difficulty, so a Legendary is one of the hardest scenarios in the deck. After 10 Commons in a row the next card is guaranteed Rare or better, while an unowned Rare or Legendary remains. Pulls cannot be bought and nothing random is sold.

One honest note on pacing: at one pull per new card learned, the deck reveals itself at the pace you actually learn it, not in a weekend. It's built to be the thing you open every day alongside your main course and practice exams, not a cram dump the night before.

If you hold the cert and spot a scenario that's wrong or outdated, I'd genuinely like to hear it; I can patch cards and the app only downloads what changed.
```


### 2.7 长帖（中文，1 篇）

**标题：** 一个人做了个「抽卡靠学不靠氪」的开发者背题 App，C# 面试 + AWS SAA-C03，内容英文

```text
我一个人在做 DeveloperCards（iOS），给开发者用的间隔重复背题 App。和 Anki 最大的区别：新卡不是导入的，是从卡包里开出来的；抽数不卖，只能靠学。整条链路都是我：React Native 客户端、React 管理后台、C#/.NET Lambda + PostgreSQL 后端、Snowflake 做分析，每张卡都是我自己写或逐张改过的。

规则很简单：
- 每天一条 1–5 张的复习路线，按实际到期量生成。每学会一张新卡得 1 抽，清空当天到期再得 1 抽，新手送 3 抽。
- 每抽必新：卡池里只有你还没拥有的卡，绝不重复。
- 稀有度就是难度：Common / Rare / Legendary 对应难度 1 / 2 / 3，抽到 Legendary 不是欧皇，是这题真的难。
- 保底：连续 10 张 Common，下一张保底 Rare 或更高，前提是包里还有你没拥有的 Rare / Legendary。
- 钱包上限 60 抽 + 5 抽备用；没卡可学又没抽数时，每天自动给 1 抽，不会卡死。
- 按实收扣费：包里剩的没拥有的卡不够你要的数量，只扣实际发到手的；全收集的包不扣。
- 每次抽卡都记录种子，可以精确重放，App 能解释你为什么抽到这几张。

只复习自己抽到的卡，收藏就是课程表。Again / Hard / Good / Easy 四键，间隔 1、2、4、8、15、30、60 天七档，到 15 天档算 Mastered，每天复习 1 张就能保住连续天数。离线可用，不登录也能玩，登录只为云备份。

目前两套卡组，全部免费，内容全英文：「C# / .NET」81 张面试题（基础到中级，async/await、装箱、Controller 这些，基本每张带代码片段），「AWS Associate Architect」154 张 SAA-C03 场景题（S3 存储类别、ElastiCache 多可用区、IAM、Lambda 等，几乎每张带实际使用场景说明）。共 235 张，适合准备英文面试或用英文考 AWS 的同学，顺便练英文题感。目前只有 iOS。

说清楚钱的事：不卖抽数，不卖任何随机的东西。App 里有一个按月的 Premium 订阅，是给以后的付费卡组准备的，现在还没有任何付费卡组，所以订了也没东西解锁，不用管它。

不承诺你能过面试或考试。想听听大家对这个经济系统的看法，尤其是研究过保底的；题目写错的也欢迎挑刺。
```


### 2.8 15 秒视频脚本

> 前提：先换掉 AWS 卡包封面（现在 `assets/packs/cloud.png` 是一张写着 "RECALL deck / Cloud" 的模糊占位图，见 3.1 第 4 条），并删掉首页假包；否则 12–14s 那一帧和任何 Home 画面都不能用。10–12s 的 Open 10 需要用 Debug 菜单预置钱包（3.3 有方案），真实新用户第一周只有 Open 1。

| 时间 | 画面 | 字幕 / 旁白 |
|---|---|---|
| 0–2s | Draw tab. The purple C# foil pack with the owl wizard and glowing quill fills the frame on the cream parchment background; the pull count and the pokeBlue button are visible. Crop tightly; never show the Home tab's 'Coming soon' filler tiles. | Flashcards for devs. The cards come in packs. |
| 2–5s | Thumb swipes across the pack; the foil rips (rip sound), cards drop onto the table one by one (card-drop sound). | Every pull is a card you don't own yet. |
| 5–7s | Tap to flip; a Legendary reveals with the gold shimmer, the legendary sound and a haptic shown as a quick shake. Hold on the card face for a beat, question readable, no specific topic called out in the caption. | Rarity is difficulty. Legendary = the hardest questions. |
| 7–10s | Review tab. A C# card with a code snippet; thumb taps Good on a new card and the wallet ticks up +1 with no claim button, next card, Easy. | Learn a new card, earn a pull. Pulls can't be bought. |
| 10–12s | Back on Draw: an Open 10 after a run of Commons; caption overlay lands on the card that flips Rare. (Stage this from a real replay; do not fake the card.) | 10 Commons in a row? The next card is Rare or better, while the pack still has one. |
| 12–14s | Library tab: New / Learning / Mastered filters, the fresh card sliding into the collection, quick pan across the C# and AWS decks. Do not show a deck total in frame if it reads 115; it must read 81 or be cropped. | No duplicates. Ever. 81 C# / .NET + 154 AWS SAA-C03. |
| 14–15s | End card on parchment with the gold accent: app icon, wordmark, one line. | DeveloperCards. 235 free cards. iOS. |
### 2.9 评论区 FAQ（帖子发出去之后一定会被问的）

**Q: Are the cards AI-generated?**
选一个真实的版本，别混用：
- **版本 A（如果你用了 AI 起草）**：I draft with AI assistance and then rewrite and check every card myself before it ships — there's no automated generation in the pipeline, and every card has gone through my hands. I'm one person, so mistakes happen; if you find one, tell me and I'll patch it (updates ship as small deltas).
- **版本 B（只有在 3.1 第 1 条清理完、且属实时才用）**：No. I write each card by hand in the admin console I built. There's no AI generation anywhere in the pipeline. If you find a mistake, tell me and I'll patch the card.

**Q: Why gacha? Isn't that manipulative?**
The usual gacha economy is tuned to find the whale. This one can't be: pulls are never sold, the only ways to get them are learning a new card (+1 each, on its first Hard, Good or Easy), clearing everything due for the day (+1, once a day), the 3-pull starter grant and a 1-pull daily floor when you've run out of both cards and pulls. Every pull is a card you don't own yet, so there are no duplicates to farm, and rarity is just difficulty. The ceremony is there to get you to open the app on day 9, not to open your wallet.

**Q: Is it free?**
Yes. Both decks (81 C# / .NET, 154 AWS SAA-C03), drawing, studying, streaks, offline use and cloud backup for signed-in users are all free. There's a monthly Premium subscription in the app meant for future premium decks, but no premium deck exists yet, so today it unlocks nothing. I'm not asking anyone to buy it.

**Q: Can I buy pulls if I'm in a hurry?**
No, and there's no plan to add that. Nothing random is sold. Premium today does not touch pulls, pity or odds.

**Q: Android?**
iOS only right now. I don't have an Android date and I'd rather not promise one until I can keep it.

**Q: Can I import my Anki deck or export cards to Anki?**
Not today. Neither import nor export exists. The design is deliberately the opposite of a bulk import: you only study cards you've drawn. If export is something you'd actually use, say so and I'll weigh it.

**Q: Will this get me through SAA-C03 / the .NET interview?**
No promises, and I won't sell it that way. It isn't official AWS or Microsoft material, it isn't an exam simulator, and collecting cards or rating yourself Easy is not a pass probability. It's 235 well-explained questions on a 1-to-60-day review ladder, designed so you keep showing up. Pair it with a real course and practice exams.

**Q: How were the difficulty tiers / drop rates decided? Are the odds fixed?**
Rarity is the card's difficulty (1 = Common, 2 = Rare, 3 = Legendary), set when the card was written. A draw is a uniform random pick from the cards you're still missing, so there are no fixed percentages: the odds equal the deck's remaining difficulty mix and shift as you collect. Every draw is logged with its seed and can be replayed exactly.

**Q: Dark mode?**（一定会有人问）
Not yet — the app is light-only today (`userInterfaceStyle: light`). 老实答，别绕。

### 2.10 事实红线（哪怕顺口也不能说）

| 不能说 | 为什么 | 能说 |
|---|---|---|
| "thousands of cards" / 大题库 | 线上只有 235 张 | "235 free cards" / "81 + 154" |
| "115 C# cards" | manifest 里的 115 是手填旧值，包里是 81 | "80+" / "81" |
| "AI deck / Cloud deck / three decks" | Home 上的 AI / Cloud 是硬编码的假 tile | "two free decks" |
| "verified against official Microsoft / AWS docs" | 计划里写的原则，未执行；卡片没有来源字段 | "written or edited by me" |
| "no AI anywhere" | 线上卡里有 "Gemini said" 残留 | 见 2.9 第一题 |
| 官方 AWS / Microsoft 内容、模拟考、"保证通过" | 产品计划明令禁止；无授权 | "not official material, not an exam simulator" |
| Android / Google Play | eas.json 只有 iOS | "iOS" |
| "10 连必出 Legendary" / 固定掉率 70/25/5 | 保底是 Rare+，且只在包里还有未拥有 Rare+ 时；抽取是未拥有池均匀随机 | "after 10 Commons, next is Rare or better while the pack has one" |
| 买抽 / 补充钱包 / Epic 品级 / 30 抽硬保底 / Premium 更好保底 | 都没实现 | — |
| "premium decks available" / 免费试用 | manifest 里 0 个付费卡组；无试用定义 | "a Premium subscription exists but there's nothing premium yet" |
| 部分完成也给抽 / 每场 2 抽 | R1：每张新卡首次 hard/good/easy +1；R2：清空当天到期卡每天 +1 一次；正确率与 minimumGoal 不改变抽数 | "one pull per new card learned" |
| full clear +1 / "1 pull per cleared review" | 2026-09-21 起由 R1/R2 替换（`docs/economy-v2-learn-to-earn-2026-09-19.md` §2） | "learn a new card, earn a pull" |
| 所有人都云备份 | 只有登录用户；且匿名期抽到的卡登录后不迁移 | "sign in for cloud backup"（修好 3.2 第 5 条前少提） |
| 掌握庆祝 / 收藏里程碑仪式 | 是 mock 壳子 | "streaks and milestones are tracked" |
| App 内删账号 | 是不可达的 mock | — |
| FSRS / SM-2 / Anki 算法 | 自研 7 档阶梯 | "7-stage ladder, 1 → 60 days" |
| 中文内容 / 多语言 | 全 en-US | "content in English" |
| 每张卡都有可运行代码 | AWS 154 张里只有 6 张有代码 | "code snippets on C# cards" |
| "intermediate" 单独作为 C# 卡组定语 | 近半是基础题 | "fundamentals to intermediate" |
| 20 张一场 / 长会话 | 上限 5 | "1–5 cards a day" |
| "optional reminders" | 默认开启早 9 晚 8 两条 | "reminders you can turn off" |
| 报价格 / 试用期 | App 里没渲染价格 | — |

---

## 3. 推广前还要补什么

> 三条独立扫描（产品缺口 / 营销素材 / 内容覆盖）+ 一个"还漏了什么"的批评者。标 **[核]** 的是我自己另外用 curl / 读代码 / 看图核过的；其余是 agent 给出证据但我没有二次核验的。

### 3.1 本周必做（不做就别发帖）

按顺序，前 3 条不需要出新 build。

| # | 事情 | 为什么现在 | 怎么做 | 量 |
|---|---|---|---|---|
| 1 | **清理 C# 卡组的内容事故** [核] | 一张截图就能被发现：`c-081` 占位卡（题目 "c-081"）；`c-024` / `c-037` / `c-070` usage 以 "Gemini said" 开头；`c-059` 贴了面试官对话；`c-001`–`c-015` 的 realWorldUsage 和题目错位；`c-047` 代码注释里是你的真名；`c-051` 答非所问；`c-017` / `c-021` / `c-081` 的 codeLanguage 是 `js`；`c-019` / `c-021` / `c-023` / `c-057` 的代码编译不过。r/csharp 的第一条评论就会是这个 | 控制台改卡 → publish → 手动 `POST /api/v1/admin/manifest/rebuild`（你的 AWS 计划文档第 5 节已写清楚流程）。顺手把 manifest 里 C# 的 `total_cards` 从 115 改成 81 | 半天 |
| 2 | **改 App Store listing** [核] | 页面还在卖旧的 "Spaced Recall" 日历产品；0 评分；无 marketing URL；每条帖子都落到这页 | App Store Connect 纯 metadata：subtitle / promo / description / keywords 用 2.3；8 张新截图（3.3）；隐私政策 Notion 页改名；加 marketing URL（先指 GitHub README 顶部也行）。不用出 build | 半天（截图另计） |
| 3 | **首页三处 JS-only 修复，走 EAS Update OTA** | `expo-updates` 已启用（`runtimeVersion: appVersion`，线上 1.5.0）；这三处全是 JS，`eas update --channel production` 当天就能到所有已安装用户，不过 App Review | (a) 删 `MOCKED_HOME_DECKS`（F6）；(b) 新用户 CTA 直达 Draw（F3）——现在 "Open library" 点进去 `LibraryScreen.tsx:105-107` 直接抛 "Deck is not installed yet" [核]；(c) **`reminders.ts:275` 的 `ensurePermission()` 在每次 Home 刷新时调 `requestPermissionsAsync()`** [核]——用户在 PermissionPrompt 点了 "Not now"，落到 Home 几秒后系统弹窗照样出来，拒了就永久拒；改成只 `getPermissionsAsync()`，请求只在那个专门的提示页做。同一文件：默认早 9 晚 8 两条提醒都开着、通知标题是旧名 "DevCards"（`:161`） | 一天 |
| 4 | **AWS 卡包封面** [核] | `assets/packs/cloud.png` 是 gen_packs.py 生成的模糊占位图，烤着 "RECALL deck / Cloud / CLD" 旧品牌字；`packArt.ts` 把任何含 `aws` 的 slug 都归到它。现在 AWS 卡组已上线，Home 的选择器、Draw、开包仪式里 154 张的那套用的就是这张。这也是首页看着不对劲的原因之一 | 按 C# 猫头鹰的规格出一张 1024×1536 的 AWS 封面（+ 卡背），存 `aws.png` / `aws-back.png`，`normalizeSlugForPack` 加 `aws-saa-c03 → aws` | 1–2 天（画图为主） |
| 5 | **付费墙：要么显示价格 + 条款链接，要么先藏起来** | 订阅承诺 "Access all premium decks" 但 manifest 里 0 个付费卡组；不渲染 `priceString`；binary 里没有 EULA 链接。这是 Guideline 3.1.2 / 2.1 的常规拒审理由，也是评论区 "scam subscription" 截图的来源；付费墙离 Home 只有一跳 | 最省事：用 remote config 把 Home 和 Settings 的入口藏到有付费卡组为止（JS，可 OTA）。要留着就渲染 `pkg.product.priceString + '/month'`，加 Terms（Apple 标准 EULA）和 Privacy 链接 | 半天 |
| 6 | **崩溃上报 + ErrorBoundary** | 仓库里没有 Sentry / Crashlytics / ErrorBoundary；OTA 打开的情况下，一个坏 bundle = 所有人白屏，你唯一的信号是一星评论 | `@sentry/react-native` + 根 ErrorBoundary + "Something went wrong — Retry"；发布打 EAS update id 标签，出事能 `eas update:republish` 回滚。**需要出 binary（1.5.1）**，和下面其它原生改动一起 | 一天 |

### 3.2 让传播倍增的小功能（P1，1.5.1 一起出）

| 事情 | 现状 | 做法 |
|---|---|---|
| **分享抽卡结果** | 全 App 没有任何 Share / expo-sharing / view-shot；抽到 Legendary 的那张 "REG. 012 / 81" 卡出不了手机，而 gacha 类 App 的自然传播几乎全靠这个 | `react-native-view-shot` + `expo-sharing`；DrawResultScreen 的 registry 区块加 "Share pull"：包图 + 卡名 + 稀有度 + "x / 81 collected" + App 名 + 商店链接。7 天连续里程碑同样加 |
| **评分弹窗** | 0 评分；没装 `expo-store-review` | 第一次翻出 Legendary 或 7 天连续时 `requestReview()` 一次（≥3 次完成、AsyncStorage 标记）；Settings → About 加 "Rate" 行 |
| **归因**（不用写代码） | 无分析 SDK、无 scheme、无 UTM；你发完帖子不知道哪个渠道有用 | App Store Connect → Campaigns，每个渠道类型一个 `ct=` 链接；48 小时后看 App Analytics。QR 码印到你自己的域名（3.6），不要印到裸的商店链接 |
| **登录会丢匿名期抽到的卡** | `drawStateStore.ts:47-51` 注释已承认：匿名期的收藏在 anon 分区，登录后不迁移（review 事件会迁，抽卡状态不会）。Home 的 "Sign in for cloud backup" 正是把新用户推向这个坑 | 仿 `adoptPendingProgressEvents` 在登录时把 anon 分区的 draw state 并入；修好前把 Home 那句改成不承诺备份，或 anon 有 owned>0 时隐藏 |
| **manifest totalCards 115 → 81** [核] | Home 显示 "115 cards"，抽卡结果显示 "/ 81"；"Mastered ✓" 永远达不到 | 后端把 `total_cards` 改成构建实际张数（或 `ManifestRebuild.cs` 从 chunk 求和）；手机端 `deckActionResolver.ts:163-166` 已安装时优先用本地张数 |
| **deep link scheme** | `app.json` 无 `scheme`，NavigationContainer 无 `linking`；给 AWS 人群的帖子没法直接打开 AWS 包 | `"scheme": "developercards"` + linking 配置（Draw with slug / Library / CardDetail）；分享卡和活动 QR 用 `developercards://draw?slug=aws-saa-c03` |
| **Me / Help / Profile 占位文案** | Me tab 是设计稿原话（"Treat this tab as your support rail"、"Developer tools — Debug menu"）；Help 是 3 条 mock FAQ；Profile "Learner #local" | 重写成真页面：连续天数 / 收藏统计、Settings、Help、Privacy、联系、"Made by one developer in Auckland"、版本。FAQ 换成 2.9 那几条的用户版 |
| **署名 + 报错入口** | App 里没有任何 "made by"；Support / Privacy 指向标题为 "DevCards Spaced Recall" 的 Notion 页；没有邮箱；没有 "这张卡有错" 的入口 | AboutSection 加署名、"Report a card"（mailto 预填 deck slug + StableUid）、你的 GitHub / X / LinkedIn；Notion 页改名 |
| **通知权限时机** | Splash → Welcome → 问卷 → 通知权限 → Home：用户还没开过一个包就被要权限 | PermissionPrompt 移到第一次开包或第一次完成会话之后（配合 3.1 第 3(c) 条，否则移了也没用） |
| **麦克风权限字符串** | `expo-av` 只用来放 6 个音效，但 Info.plist 会带 `NSMicrophoneUsageDescription` 模板文案；评论区 "为什么背单词 App 要麦克风" 是送分题（证据来自过期的 `ios/` 预构建，出 build 前重新 prebuild 确认） | 换 `expo-audio`（只播放）或 expo-av 插件 `microphonePermission: false` |

### 3.3 素材清单（现在一样都没有）

| 素材 | 规格 | 备注 |
|---|---|---|
| **App Store 截图 ×8** | 6.9" 1320×2868；`supportsTablet: true` 所以还要 iPad 13" 2064×2752（或提交前关掉）；先 `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100` | 帧序 / 字幕（≤6 词、全部可核）：① 开包仪式，桌上一张 Legendary 翻面，猫头鹰包在后 → "Every pull is a new card" ② Draw 页，猫头鹰包 + 钱包 `× 3` → "Three free pulls to start" ③ SessionCard，C# 卡带代码、答案已翻 → "Real C# interview questions" ④ 评分四键 → "Rate it. It comes back on time." ⑤ Home（**修完 F1/F6 之后**）→ "One button a day" ⑥ Library New/Learning/Mastered → "Your collection is your curriculum" ⑦ AWS 包（**换封面之后**）→ "154 AWS SAA-C03 scenarios" ⑧ 结束页：一句话 + 两套卡组张数。**永远不截付费墙** |
| **15 秒 reel** | 母版 1080×1920 60fps；导 1:1 和 16:9（手机居中放在羊皮纸底上）；真机录屏关麦开音效，或 `xcrun simctl io booted recordVideo` | 脚本见 2.8；仪式各阶段时长在 `DrawCeremonyScreen.tsx:112-121`（设备上 ×2.5）。**Legendary 必须真抽出来**：`drawCommit.ts` 每次抽卡有 seed 可 `replayDraw`，或用下面的 Demo seed 把非 Legendary 全标记为已拥有 |
| **Demo seed（Debug 菜单，仅 `__DEV__`）** | `DebugMenuScreen.tsx` 现在只能清空，不能给 | 加两个动作：钱包 30/5（`saveRewardWalletState`）；某卡组 "只剩 Legendary"（`drawStateStore` 里 owned = 所有 Difficulty<3 的 uid）。你的 AWS 演示计划里 "08:50 看钱包不够就去刷 C#" 就是为了这个 |
| **社交分享卡模板** | 1080×1350、1080×1080、1200×630（OG）；羊皮纸底，左三分之一猫头鹰包 + 紫色光晕，右侧一张真卡：稀有度徽章（用 `colors.rarity*`）、卡组名、题目（≤220 字符，从 Library 原样复制）、C# 加 3–4 行代码；底栏 "DeveloperCards · free on iOS · pulls are earned by studying" | 展示卡候选见 3.4 |
| **README 顶部 / 一页 landing** | README 现在第一行是 `# RecallSmith` + 技术栈表 + 文件计数政策，HN 读者点进去看到的是工程文档。最快：README 顶部加产品段（一句话 + reel GIF + 3 张截图 + 数字表 + App Store 徽章 + "Android? 留邮箱"）；稍好：`/site` 静态页走 GitHub Pages | 商店 marketing URL 和 App 内 Support 指向它 |
| **GIF（≤8 MB）** | 从 reel 剪 8–10s：靠近 → 撕 → 掉卡 → 翻两张 → Legendary 闪；600px 宽 20fps，gifski / ffmpeg palettegen | README、Reddit 评论、HN 回帖里唯一能动的东西 |
| **品牌三选一** | 根目录 `logo.png` 是退役的 "R + 闪电"；App 图标是青色 "D"；卡包上是金色衬线 "DeveloperCards" | 定一个（建议：卡包的金色 wordmark + 青色 D 做图标，或按包的紫金重做图标），导 1024 / 512 / 192 PNG + SVG；README 改标题为 `# DeveloperCards`，注明代码库和 bundle id 沿用旧名 |
| **Press kit 文件夹** | `/press`：facts.md（一句话 / 50 词 / 150 词 / 数字表 / "不是什么"）、logo、icon、pack art、8 张截图、reel 三个比例 + GIF、社交卡、联系方式 | 有人说 "把你的东西发我" 时能直接给 |
| **活动演示套件** | A5 羊皮纸底 QR（指你的域名，不指裸商店链接）；一部 dev build 演示机（Demo seed 30/5，勿扰模式）+ 一部干净安装的正式版机（诚实的 3 抽开局）；早上飞行模式验一次离线 | 60 秒话术：这是面试题卡组 → 你有 3 抽 → Open 1，掉卡翻牌 → 点进去读题翻答案评分 → "清完今天的卡就再给一抽，买不到" |
| **App Preview 视频（可选）** | 从 reel 剪 15–30s，1080×1920，前 3 秒必须是撕包（海报帧从视频里选） | listing 公开且截图换完之后再做 |

### 3.4 内容：覆盖缺口和展示卡片

> 来源：agent 用 curl 拉了线上 manifest 和两个卡组的 deck.json（81 + 154），逐张分桶；C# 的 6 类事故我用同样方式复核过 [核]。

**AWS SAA-C03 按考试域**（考试权重 → 理想张数 vs 实际）

| 域 | 权重 | 理想 | 实际 | 明显缺口 |
|---|---|---|---|---|
| Design Secure Architectures | 30% | ~46 | 42 | Network Firewall、Security Hub、Directory Service / AD Connector、Client VPN、S3 Access Points、KMS grants、NAT instance vs NAT gateway、egress-only IGW / IPv6 |
| Design Resilient Architectures | 26% | ~40 | 42 | **Amazon MQ**（最常见干扰项）、AWS Batch、MSK vs Kinesis、S3 Event Notifications、按 SQS 深度扩缩、Gateway Load Balancer、EFS 跨 AZ 挂载点 |
| Design High-Performing Architectures | 24% | ~37 | 40 | Kinesis Data Analytics / Flink、Lake Formation、QuickSight、EC2 hibernation、AMI 跨区复制、ML 服务选型（Rekognition / Comprehend / Textract）、S3 Intelligent-Tiering |
| Design Cost-Optimized Architectures | 20% | ~31 | **21** | **最薄**：Organizations 合并账单、cost allocation tags、Cost Anomaly Detection、Intelligent-Tiering vs IA vs One Zone-IA 对比、DynamoDB reserved capacity |

按服务：S3 16、EC2/EBS/EFS/FSx 21、RDS/Aurora 14、**DynamoDB 只有 6**（重点考的服务：缺事务 / 条件写、PITR、热分区、一致性模型）、Lambda/API GW 13、VPC 14、IAM/KMS 18、ELB/ASG 7、CloudFront/Route 53 8、SQS/SNS/EventBridge 10、监控 6、迁移 6、分析/缓存/成本 15。

AWS 质量标记：7 张没有 realWorldUsage；9 张 usage 是你自己项目的自述（"DeveloperCards keeps immutable content builds…"），陌生人读着别扭；3 张 NAT vs endpoint 结论重复；8 张题干超 260 字符一屏放不下；几张难度标签值得复看（GSI vs LSI、envelope encryption 标了 d3）；4 张的事实点 agent 不确定，截图前先核：Lambda "Managed Instances 90 分钟"、Trusted Advisor "Developer 计划停售"、DynamoDB global tables 强一致 "无 TTL / 事务"、SQS "1 MiB 配额"。

**C# 按主题**

| 主题 | 张数 | 问题 |
|---|---|---|
| OOP / 接口 / 继承 / 构造函数 | **38** | 近半张卡；三张 interface vs abstract、四张 overloading、十一张构造函数 |
| 语言基础（loop、string、method、ref/out） | 11 | 入门题，和 "interview prep" 定位冲突 |
| 内存 / GC / 装箱 / 字符串 | 8 | 装箱 ×3、StringBuilder ×3 近重复；缺 struct vs class、Span<T>、GC 代际、IDisposable |
| 泛型 / 集合 | 7 | 两张 ArrayList / Hashtable 是 2026 年没人问的；缺协变逆变、IReadOnlyList |
| 异常 | 5 | `c-051` 答非所问；缺 exception filters、AggregateException |
| LINQ | 4 | `c-007` 和 `c-063` 是同一题（d1 和 d3） |
| ASP.NET Core | 3 | 缺中间件顺序、minimal API、模型校验、JWT、IHttpClientFactory、Options |
| **async / await** | **2** | 缺 ConfigureAwait、ValueTask、CancellationToken、WhenAll、死锁 |
| EF Core | 2 | 缺 AsNoTracking、change tracker、迁移、并发令牌 |
| DI | 2 | 缺 keyed services、IServiceScopeFactory、captive dependency 之外的坑 |
| 测试 | 2 | 缺 mocking、WebApplicationFactory、Testcontainers |
| 现代 C#（records、pattern matching、NRT） | 1 | 几乎为零；primary constructor 在 `c-005` / `c-008` 里用了但没讲 |
| **线程 / 并发** | **0** | 面试必问，一张没有 |
| 占位垃圾 | 1 | `c-081` |

近重复簇（抽到两张会让人觉得"就这？"）：`c-007+c-063`、`c-013+c-045+c-046`、`c-041+c-042+c-043`、`c-004+c-027+c-028`、`c-016+c-017+c-018`、`c-020+c-021`、`c-071+c-074`、`c-058+c-059`、`c-064+c-067`。难度错标：`c-023` / `c-025` / `c-077` / `c-079` / `c-059` 是 d3 但是常识题。80/81 张总长超 900 字符、34 张超 2500——解释本身 150–450 字符没问题，是代码 + usage 把卡撑爆了（`c-068` 5,614 字符，代码里贴了控制台输出）。

**可以直接拿去做截图 / 分享卡 / 推文的 10 张**

| 卡组 | uid | 稀有度 | 题目 | 为什么 |
|---|---|---|---|---|
| AWS | `aws-ec2-imdsv2` | LEG | A web app on EC2 has an SSRF bug. Why can an attacker use it to steal the instance role's credentials, and which setting closes the hole? | 像事故复盘；答案一个词（IMDSv2） |
| AWS | `aws-lambda-retries-and-destinations` | LEG | Why does the same code seem to retry twice when triggered by S3, never through API Gateway, and endlessly from Kinesis? | 一句话三方对比，做投票推文 |
| AWS | `aws-vpc-peering-vs-transit-gateway` | RAR | You peer A–B and B–C, then A cannot reach C. Why? | SAA 最著名的坑，一屏放得下 |
| AWS | `aws-s3-lifecycle-rules-minimums` | RAR | Lifecycle moves to Standard-IA at day 7, then Deep Archive at day 20. Which step does S3 reject? | "找 bug" 型广告素材 |
| AWS | `aws-iam-policy-evaluation-explicit-deny` | RAR | Role has AdministratorAccess but an SCP denies s3:DeleteBucket. Can they delete? | 反直觉，能停住滑动 |
| AWS | `aws-route53-alias-vs-cname` | COM | Bare domain → ALB. Why does CNAME fail? | 人人踩过 |
| AWS | `aws-sqs-long-polling` | COM | Millions of empty ReceiveMessage responses on the bill. What setting fixes it? | 成本痛点 |
| C# | `c-055` | RAR | What is the difference between "throw ex" and "throw"? | 最经典的 .NET 面试坑，代码有 ❌/✅ |
| C# | `c-071` | RAR | What is Private constructor? What is the use? | HOP 卡 / Auckland Transport 例子，NZ 观众会心一笑 |
| C# | `c-001` | LEG | You see .Result on a Task in a controller. What can go wrong? | 全卡组最好的钩子——**但先修它错位的 usage** |

**下一步内容（按对推广的帮助排序）**

0. 先修 3.1 第 1 条（不是新内容，是止血）。
1. **"First 10 cards" 新手卡组**：全 Common、一屏一张、不放代码墙：什么是 pull、Rare / Legendary 是什么意思、一张 C# 一张 AWS 预告、为什么抽数要靠学。让第一次开包在 reel 和商店预览里一定干净。
2. **C# async & 并发**（~20 张）：ConfigureAwait、ValueTask、CancellationToken、WhenAll + AggregateException、IAsyncEnumerable、SemaphoreSlim / lock / Channels、ConcurrentDictionary、BackgroundService、死锁。现在 2 张 async、0 张线程，这是搜索量最大的缺口。
3. **现代 C# 12/13**（~15 张）：records + with、NRT、required / init、primary constructors、collection expressions、模式匹配、`field` 关键字、Span<T>。
4. **ASP.NET Core + EF Core**（~25 张）。
5. **AWS 成本优化补齐**（~10 张）把 14% 补到 20% 权重。
6. **AWS "干扰项" 包**（~15 张）：Amazon MQ vs SQS、AWS Batch、MSK vs Kinesis、S3 Event Notifications、NAT instance vs gateway……考试爱拿来当错误选项的服务。
7. **C# 去重 + 重新定难度**：合并上面那些簇；11 张入门题拆成单独的免费 "C# Fundamentals" 卡组，主卡组才对得起 "interview prep"。
8. **"SAA-C03 考场陷阱" 迷你卡组**（~20 张极短 Common）：zone-apex CNAME、peering 不传递、Multi-AZ standby 不提供读……天然适合做一条 thread 和"免费样品"。
9. 给中文用户：在现有卡上加 zh-CN 术语注释字段 / "双语提示" 开关，而不是翻译 235 张。
10. 第一个付费卡组候选：AWS DVA-C02 或 ".NET senior: system design in C#"，让订阅有东西可解锁。

### 3.5 文案 × 渠道类型（渠道你定，这里只说每类渠道会惩罚什么）

| 渠道类型 | 用哪块 | 格式 | 千万别 |
|---|---|---|---|
| 语言类 subreddit（r/csharp、r/dotnet） | 2.6 第二篇 + C# 社交卡 | 当作 "show and discuss"，以技术角度开头（均匀抽取如何保证无重复、7 档间隔阶梯），链接放评论；发帖当天重读 sidebar，不确定就先私信 mod | "download my app"、只有链接的帖子、一周内多发；准备好回答 "why not Anki" |
| 认证类社区（r/AWSCertifications、云学习 Discord） | 2.6 第三篇 + AWS 社交卡 | 第一行就声明"非官方、非模拟考、不保过" | 任何暗示通过率的话 |
| Show HN / dev.to / LinkedIn 长文 | 2.6 第一篇 + GIF | HN 标题以 "Show HN:" 开头，正文讲机制和取舍，主动请人挑经济系统的毛病 | 营销腔、感叹号、"revolutionize" |
| X / Bluesky / Mastodon | 2.4 的 8 条轮着发 + reel | 一条一个钩子；thread opener 那条接 3–5 条把数字讲完 | 一条塞三个卖点 |
| 即刻 / V2EX / 掘金 / 微信群 | 2.5 + 2.7 | 每条都写明"内容是英文" | 把 gacha 包装成"氪金" |
| 学生 / 活动（Summer of Tech 类） | 3.3 活动套件 | 60 秒话术 + QR 到你的域名 | QR 直指裸商店链接（印了就改不了） |
| 新闻信 / 播客 / KOL | Press kit | 一次给齐，别让人来回要 | — |

### 3.6 批评者补的（agent 认为三条扫描都漏了的）

- **P0 用 OTA 而不是等审核**：3.1 第 3、5 条和 Me/Help 文案全是 JS，`eas update --channel production` 当天生效；binary（1.5.1）留给 Sentry、store-review、view-shot、expo-audio。另外先 `eas update:list` 确认 `4a8c85d`（短包按实收扣款，2026-08-22 提交，晚于 build 15）是不是已经在用户手里，否则 2.3 里 "only charged for cards you receive" 那条先别写。
- **P1 隐私标签和政策对不上**：`PrivacyInfo.xcprivacy` 声明不收集任何数据，但登录用户会发邮箱（Cognito）、设备 id、复习事件和收藏状态到后端和 Snowflake，购买走 RevenueCat。App Store Connect 的隐私标签要报 Email / User ID / Device ID / Purchase History / Product Interaction；Notion 政策页要点名 Cognito、RevenueCat、Snowflake、CloudFront，写最低年龄（listing 是 4+ 但有注册）和 NZ Privacy Act 联系方式。开发者社区会把标签和政策并排比。
- **P1 Premium 要先做决定**：付费墙和 Settings 都在卖 "premium tracks"，manifest 里一个都没有。要么 remote flag 藏掉，要么先出一个（3.4 第 10 条）。发帖前定，因为付费墙离 Home 一跳。
- **P1 公开仓库**：`github.com/ChuanQiao1128/recallsmith` 是 MIT 公开仓库，`README` 标题是 `# RecallSmith`，仓库里有简历要点、AWS 演示计划、这份文档、1.5.0 preflight（一份公开的"可能被拒审的弱点清单"）、以及猫头鹰卡包美术——**MIT 意味着任何人都可以拿走那张包图**。每个 Show HN 读者都会点进来。要么整理（内部文档挪走、加 LICENSE-ASSETS 把美术和音效排除、加卡片报错 issue 模板、说明卡片内容不在仓库里也不在 MIT 之下），要么转私有只留 landing。
- **P1 先注册域名**：没有 marketing URL、没有 scheme、Support / Privacy 在 Notion、bundle 是 `com.timeawake.recallsmith`。注册 `developercards.<tld>`，配 `support@` / `hello@`（别在 "Report a card" 里放个人 Gmail）、`/privacy` `/terms` 跳 Notion、`/app` `/aws` `/csharp` 各自带 `ct=` 跳商店——纸质 QR 印到域名上以后才能改指向。
- **P1 想清楚第 2–7 天**：3 个启动抽之后收入是每天 1 抽（新卡组的路线常常只有 3 张），reel 和截图里卖的 10 秒仪式每天只发生一次，而且是 Open 1；Open 10 至少 7 天后才可能。要么素材老实展示 Open 1 并说 "one new card a day"，要么加第一周规则（例如 5 个现有里程碑各给 1 抽）。同时匿名用户现在不发任何事件，D1 / D7 只能看 App Store Connect——要么给所有用户加 first-open / first-clear / first-draw 事件，要么把这个限制写进计划里认了。
- **P2 写一页 "How pulls and odds work"**：因为不卖随机物品，Apple 3.1.1 掉率披露、比利时 / 荷兰的 loot box 立场、NZ Gambling Act 今天都碰不到；付费卡组一旦走同一个随机抽取就不一定了。把"未拥有池均匀抽取、10 Common 后保底 Rare+、抽数只能赚、付费不改概率"写进 Help / FAQ / press kit，年龄分级问卷里 "simulated gambling" 继续答 No 并记下理由。
- **P2 无障碍 / 深色模式**：`userInterfaceStyle: light`（开发者群体最常见的抱怨）；136 处 `numberOfLines={1}` 没有字体缩放策略（Dynamic Type XL 会截断 "Open library"）；只有 26 个 accessibilityLabel。四个主 tab 用 XL 字体和 VoiceOver 各过一遍，FAQ 里写好 "dark mode?" 的答案。
- **P2 本地化决定写下来**：App 和卡组保持 en-US，但 App Store 可以加 zh-Hans listing（只改描述和关键词，不动 binary）；每条中文帖写明"App 和卡片是英文"。
- **P2 发布周运维**：Lambda 5xx / Cognito 注册失败的 CloudWatch 告警、AWS Budgets、确认内容 CDN 只读公开 + cache header；一页 "API 挂了怎么答"（离线优先，学习和抽卡照常，同步稍后补上）。
- **P2 公开 changelog**：删掉假的 AI / Cloud tile 之后，"接下来做什么" 需要一个诚实的地方（GitHub Releases 或 docs 页）；商店的 What's New 现在还在描述日历 App。

---

## 4. 附：这两轮是怎么跑的

- 第 1 轮（21 个 agent）：1 个从代码 + 线上 manifest 提取"可宣传事实表"（41 条可用、23 条不可说）；3 个视角独立评审首页各出 12 / 12 / 11 条；合并去重成 25 条；前 16 条每条一个"反方"对照代码复核，0 条被推翻，10 条改了更安全的修法。
- 第 2 轮（16 个 agent）：5 个角度写文案 → 3 个评委 → 合并 → 2 个事实核查（10 处改动）；并行 3 条路线图扫描 + 1 个批评者。
- 我自己另外核过的：iTunes lookup（商店页面是旧产品）、两个 deck.json（c-081 / "Gemini said" / usage 错位）、`cloud.png`（占位图）、`reminders.ts`（Home 刷新时请求通知权限）、`LibraryScreen.tsx:105`（未安装时抛错）。
- 没核的：3.2 里麦克风权限（证据来自过期的 `ios/` 目录）、AWS 卡 4 处事实点、F17–F25。
