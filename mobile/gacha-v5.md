# RecallSmith Mobile · 抽卡学习系统设计 · v5.3（Design 交付版 · 7 用户 30 天模拟 + 双池过渡）

> **本文定位**：v5 是从 `gacha-v4.md`（5500 行产品 PRD）中**抽出给 Claude Design 画图用**的清洁版。不再分 v1/v2/v3/v4 层叠和 override，只保留最终规则 + 画图需要的 storyboard。
>
> **v5.3 对 v5.2 的变化**：
> 1. **§6e 新增 · 7 用户 30 天模拟**——A-G 7 种用户画像 · 覆盖标准 / 速通 / 胆怯 / 周末 / 推送 / 囤积 / 流失 7 类月周期节奏
> 2. **Day-15 双池上线事件**——C#/.NET → C#/.NET + AWS SAA · 7 用户分化反应（3 立即双池 · 2 只学原池 · 1 忽略 · 1 已流失）
> 3. **§13 新增 · 多池设计含义 + 问题清单 + 优化方案**——从月模拟挖出 **18 条问题** 按 P0/P1/P2 分级 · 6 个 Design 组件决议 · 给 PM 下一轮 PRD
>
> **v5.2 遗留关键决议保留**：Library 3 列 · Plan 卡 · Day-1 Daily Dose · 降级机制 · Backlog Mode · 断 streak UX
>
> **核心交付**：
> - §6 · **Day-1 Journey 12 屏**（User A 小张 · 首次体验）
> - §6b · **Day-2 Journey 7 屏**（User A 小张 · 常态复盘）
> - §6c · **Day-3 → Day-7 Journey 7 屏**（User A 小张 · 中周期节奏）
> - §6d · **User B Journey 6 屏**（User B 小王 · 7 天极端用例）
> - §6e · **7 用户 30 天模拟 + 双池上线 6 屏**（v5.3 新增 · Pool Launch Modal · Multi-pool Plan 卡 · Library Pool Switcher · Nothing-to-Learn 空态 · Churn Re-engagement · Month Summary）
>
> **日期**：2026-04-22 · **签收**：产品经理 Chuan Qiao
>
> **配套文件**：
> - `gacha-v4.md`（完整 PRD，含所有决议过程和 override 层，FE/PM 参考）
> - `design-review-round2.md`（第二轮评审纪要）
> - `uploads/C#/.NET 115 High-Frequency.pdf`（题库，卡面内容源）

---

## 目录

- §1 产品一页介绍（Claude Design 上下文）
- §2 视觉设计系统（色 / 字体 / 间距 / 主题）
- §3 组件库速查（Button / Badge / Card / Bar / **Plan 卡** v5.1）
- §4 卡面规范（Tag + Keyword + Stars 三段式）
- §5 Day-1 Daily Dose 机制
- §6 **User A · Day-1 Journey 12 屏 Storyboard**（核心交付）
- §6b **User A · Day-2 Journey 7 屏 Storyboard**（常态流程）
- §6c **User A · Day-3 → Day-7 Journey 7 屏**（v5.2 · 中周期节奏 + 设计反思）
- §6d **User B · 7 天极端用例 Journey 6 屏**（v5.2 · 漏复习 / 断 streak / 降级 / Leech）
- §6e **7 用户 30 天模拟 + 双池上线事件 6 屏**（v5.3 新增 · A-G 月路径 + Pool Launch）
- §7 Journey 转场动画表（含 Day-2）
- §8 数据一致性校验表（Day-1 + Day-2）
- §9 交付 Checklist（PM 逐张对）
- §10 变体（Variant · 3 张附加）
- §11 修订日志（v5.0 → v5.3）
- §12 设计反思清单（v5.2 · User A 中周期 + User B 极端用例产品缺口）
- §13 多池设计含义 + 18 条问题 + 优化方案（v5.3 新增 · 7 用户月模拟挖出）

---

## 1. 产品一页介绍

**产品名**：RecallSmith Mobile

**一句话定位**：把"面试题 / 考证知识点"做成**抽卡学习**——用 FSRS 决定今天学什么，用抽卡制造期待，用关卡包装每日流程。

**与其他 SRS 工具的差异**：每个用户有自己的遗忘曲线拟合、自己的卡难度估计、每日 30 秒能量校准。

**v1 内容**：`C#/.NET 115 High-Frequency`（1 个池，115 张卡），后续加 AWS 证书池。

**用户画像 · 小张**：
- 工作 2 年的 .NET 后端，复习 C# 基础顺便备考 AWS SAA
- iPhone 15，浅色主题，未开 Reduce Motion
- 场景：午休 12:30，13 分钟走完 Day-1 流程

**三个核心循环**：
1. **抽卡**（Draw）：10 连抽开箱仪式，保底 1 张 RAR+
2. **学习**（Level）：Q → A → IRL 线性披露 + 4 档自评（Again/Hard/Good/Easy）
3. **复盘**（Settlement → Library）：心智账本 + 图鉴进度

---

## 2. 视觉设计系统

### 2.1 主题 / 色

**主题 A · Parchment Gold**（所有"日常页" = Home / Daily Dose / Level / Settlement / Library / Home 回首）：

| Token | 值 | 用途 |
|----|----|----|
| `bg.parchment` | `#FAF3E0` | 底色 |
| `bg.parchmentDeep` | `#F3E8C8` | 卡片底 |
| `ink.primary` | `#2A2218` | 正文 |
| `ink.secondary` | `#5A4B38` | 次要文字 |
| `accent.gold` | `#C8883A` | 主 CTA + 金色边框（LEG） |
| `accent.amber` | `#E8B85A` | 金光特效 / 奖励 |
| `state.warn` | `#C8883A` | 琥珀警告（替代红色） |
| `state.ok` | `#7E9D5E` | 完成绿 |

**主题 B · Cosmic Ceremony**（仅 Draw 仪式 Screen 02-04 用）：

| Token | 值 | 用途 |
|----|----|----|
| `bg.cosmic` | `#0B1030` | 深蓝宇宙底 |
| `bg.cosmicDeep` | `#070A1F` | 更深处 |
| `ink.onCosmic` | `#F5ECC4` | 宇宙上的米色文字 |
| `glow.gold` | `#E8B85A` | 粒子 / LEG 暗示 |

**代码块 · VS Code Dark+**（仅 Level A 面展开的 C# 代码块）：
- 底 `#1E1E1E` · 注释 `#6A9955` · 关键字 `#569CD6` · 字符串 `#CE9178` · 标识符 `#9CDCFE`

### 2.2 稀有度色

| 稀有度 | Icon | 边框色 | 边框粗细 | 语义 |
|----|----|----|----|----|
| ⚡ LEG | `⚡` | `#C8883A`（金） | 4pt | 传说 · Advanced-Mid |
| 🔷 RAR | `🔷` | `#6E4C9F`（紫） | 3pt | 精英 · Applied |
| ⚪ COM | `⚪` | `#8C7A5B`（灰金） | 2pt | 普通 · Fundamental |

### 2.3 14 类 Tag 色条（卡面顶部 2pt 细色条）

| Tag 短标 | 色 |
|----|----|
| `ASYNC / AWAIT` | `#7CB5D9` 天蓝 |
| `ASP.NET CORE` | `#6E4C9F` 深紫 |
| `TESTING` | `#7EC9A8` 薄荷 |
| `OOP` | `#C8883A` 琥珀 |
| `SOLID / PATTERNS` | `#9D4B4B` 赭石 |
| `EF CORE` | `#4A7BA6` 深海蓝 |
| `LINQ` | `#B5965D` 金褐 |
| `ERRORS / LOGGING` | `#A7503B` 橙红 |
| `PERFORMANCE` | `#D9A541` 金 |
| `DEVOPS` | `#5C7C3E` 橄榄 |
| `MESSAGING` | `#8B5A9F` 紫罗兰 |
| `SECURITY` | `#AA3636` 砖红 |
| `CLOUD` | `#5F8DC9` 云蓝 |
| `DOCKER` | `#3F8BB5` 青 |

### 2.4 字体

| 用途 | 字体 | 字重 / 字号 |
|----|----|----|
| Topic Keyword（卡面主角） | JetBrains Mono | Bold 28-32pt |
| Primary Tag（卡面顶部） | JetBrains Mono | Medium 11pt · letter-spacing +0.12em · 全大写 |
| Level Q 题干（英文原题） | SF Pro / Inter | Regular 17pt |
| Level A 正文 | SF Pro / Inter | Regular 15pt |
| 按钮 CTA | SF Pro / Inter | Semibold 15pt |
| Header / 池名 | SF Pro / Inter | Medium 13pt |
| 代码块 | JetBrains Mono | Regular 13pt |

### 2.5 间距 / 圆角

- 屏幕 safe margin：32pt（1170×2532 尺寸下）
- 卡片圆角：16pt
- 按钮圆角：12pt
- 行距：正文 1.5×，标题 1.2×

---

## 3. 组件库速查

### 3.1 Button

| 类型 | 示例 | 样式 |
|----|----|----|
| Primary（金色填色） | `[ 开始今日挑战 → ]` | 背 `#C8883A`，字 `#FAF3E0`，圆角 12pt，高 52pt |
| Secondary（outline） | `[ 全部收入明日 ]` | 背透明，边 `#2A2218` 1.5pt，字 `#2A2218` |
| Rating（Level 底部） | `[ Hard ² ]` | 4 档 outline，按压填色（Again 红琥珀 / Hard 琥珀 / Good 薄荷 / Easy 金） |

### 3.2 Badge

| Badge | 用例 | 视觉 |
|----|----|----|
| NEW | 新抽到 | 琥珀底 + 白字 · 右上角 |
| 💎 Mastered | Library 里精通（5 连 Good+） | 金框内 ◆ 金字 · 右上角 |
| 🎓 Learned | Library 里已学会 | 紫字 + `N/5` 进度 |
| 🪙 Drawn | 抽到但未学 | 灰字 + `0/5` |

### 3.3 Card（卡片正面 · 见 §4）

### 3.4 GradeMixBar（Settlement 用）

水平 4 色条，总和 = 过关数：

```
[Again] ■ 0   [Hard] ■■ 1   [Good] ■■■■ 2   [Easy] □ 0
```

色：Again `#A7503B` / Hard `#C8883A` / Good `#7E9D5E` / Easy `#D9A541`

### 3.5 ProgressBar

- 高 4pt · 圆角 2pt · 底 `#F3E8C8` · 填色 `#7E9D5E` 或 `#C8883A`

### 3.6 Tab Nav（底部 5-tab）

`Home · Draw · Review · Library · Me` · 当前激活图标 `#C8883A`，其余 `#5A4B38`

### 3.7 Plan 卡（v5.1 新增 · Home 必显）

**用途**：把"今日路线"从孤立状态升级为"周视角 + 池进度 + 里程碑"，让用户在 Home 第一屏就能看到"我现在在哪 / 接下来往哪走"。

**位置**：Home 页今日路线卡之上（Screen 06/12）；零卡态 Home（Screen 01）仅显示里程碑预告行。

**常态布局**（已开始学习后）：

```
╔━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╗
║  📋 MY PLAN · C#/.NET            ║  ← 小标（黑色 11pt + 池名）
║                                    ║
║  Pool progress                    ║
║  ━━━━▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  10/115 ║  ← 细进度条 3pt + 文字
║  8.7% · next milestone 20%        ║
║                                    ║
║  This week (Mon–Sun)              ║
║  ▂ ▂ ▂ ▂ ▂ █ ▂                   ║  ← 7 根柱，今日高亮
║  M T W T F ★S S                   ║
║                                    ║
║  🎯 Goal: 20% (Bronze) in 8 days  ║  ← 里程碑
║  ≈ 3 cards/day · keep it up       ║
║                                    ║
║  [ View full plan ▸ ]             ║  ← 点击跳 Plan 详情（v2 交付）
╚━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╝
```

**零卡态变体**（Screen 01 · 用户还没抽卡）：折叠成一行"Plan preview"小字：

```
📋 115 题 · ~25 天完成 · 每天 3-5 张 · 抽完首 10 连解锁你的节奏
```

**样式 tokens**：
- 底色：`#F3E8C8`（比页面略深半阶）
- 圆角：16pt
- 进度条填色：`#7E9D5E`（绿）
- 里程碑 icon：`🎯` 金色
- Goal 文案行：小字 13pt `#5A4B38`
- View full plan：link 样式 `#C8883A`

**行为**：
- 点击卡片整体 → 跳 Plan 详情页（v2 交付，本轮无需画）
- 点击"This week"柱 → 跳到那一天的 Settlement 回顾（v2）
- 用户 collected >= 20% 时 → `🎯 Goal` 自动升级为下一档 Silver (40%)

---

## 4. 卡面规范（v4.3 · 极简三段式）

### 4.1 卡正面字段（硬规则）

卡正面**只显示 3 段核心 + 1 组边角**，其余一律下沉到 Level 页：

| 段 | 字段 | 位置 | 字型 |
|----|----|----|----|
| ① | **Primary Tag** | 顶部小标，全大写，左侧 2pt 色条（见 §2.3） | JetBrains Mono Medium / 11pt |
| ② | **Topic Keyword** | 正中央，视觉主角 | JetBrains Mono Bold / 28-32pt |
| ③ | **Stars** | 正中央下方 | 金色 ⭐ emoji / 20pt |
| 右上角 | NEW / 💎 / 🎓 / 🪙 | 状态驱动 | 12pt |
| 左下角 | 池名 `C#/.NET` | 恒定显示 | 10pt |
| 右下角 | Rarity Icon ⚪/🔷/⚡ | 与边框色一致 | 14pt |
| 整卡 | 稀有度边框（见 §2.2） | 4pt LEG / 3pt RAR / 2pt COM | — |

### 4.2 卡正面 · 严禁出现（画错就重做）

- ❌ **Q Snippet / 题干任何一句**（哪怕斜体引号 2 行也不行）
- ❌ **A / Answer / 答案关键词**
- ❌ **Code 片段 / `<T>` / `{}` / `=>` 装饰**（包括 v4.2 版本里的"5% 透明度代码符号飘散"也全部去掉）
- ❌ **IRL / Real World Usage 文字**
- ❌ **Audience Badge（JR / MID / BOTH）**——下沉到 Level Q 面 Header
- ❌ **最后复习时间文字**——下沉到 CardDetailScreen

### 4.3 星级规则（Difficulty → Stars · 3/4/5 三档）

| Difficulty | Level | 星级 | 稀有度 |
|----|----|----|----|
| 1 | Fundamental | ⭐⭐⭐ | ⚪ COM |
| 2 | Applied | ⭐⭐⭐⭐ | 🔷 RAR |
| 3 | Advanced-Mid | ⭐⭐⭐⭐⭐ | ⚡ LEG |

**关键**：3 星起步（不出现 1 星 / 2 星），与 gacha 玩家心智一致；稀有度与星级强绑定，不会出现矛盾组合（例如 `⚡ LEG + ⭐⭐⭐`）。

### 4.4 卡面 ASCII 最终参考（画图严格对齐）

**Stage D 抽到 · LEG 5 星 · Q1 `Task.Result Deadlock`**：

```
╔━━━━━━━━━━━━━━━━━━━━━━━━━━╗ ← 金色边框 4pt
║  ⚡ LEG              NEW ║
║                          ║
║ ── ASYNC / AWAIT ──      ║ ← 蓝色 2pt 色条
║                          ║
║                          ║
║     Task.Result          ║ ← JetBrains Mono Bold 32pt
║     Deadlock             ║
║                          ║
║                          ║
║     ⭐⭐⭐⭐⭐            ║ ← 金色 emoji 20pt
║                          ║
║                          ║
║  C#/.NET             ⚡ ║
╚━━━━━━━━━━━━━━━━━━━━━━━━━━╝
```

**Stage D · RAR 4 星 · Q6 `N+1 Query`**：

```
╔━━━━━━━━━━━━━━━━━━━━━━━━━━╗ ← 紫色边框 3pt
║  🔷 RAR              NEW ║
║                          ║
║ ── EF CORE ──            ║ ← 深海蓝 2pt 色条
║                          ║
║                          ║
║     N+1 Query            ║
║                          ║
║                          ║
║     ⭐⭐⭐⭐              ║
║                          ║
║                          ║
║  C#/.NET             🔷 ║
╚━━━━━━━━━━━━━━━━━━━━━━━━━━╝
```

**Stage D · COM 3 星 · Q9 `yield return`**：

```
╔━━━━━━━━━━━━━━━━━━━━━━━━━━╗ ← 灰金边框 2pt
║  ⚪ COM              NEW ║
║                          ║
║ ── PERFORMANCE ──        ║ ← 金色 2pt 色条
║                          ║
║                          ║
║     yield return         ║
║                          ║
║                          ║
║     ⭐⭐⭐                ║
║                          ║
║                          ║
║  C#/.NET             ⚪ ║
╚━━━━━━━━━━━━━━━━━━━━━━━━━━╝
```

**Library 精通态 · RAR · `1/5` 进度**：

```
╔━━━━━━━━━━━━━━━━━━━━━━━━━━╗
║  🔷 RAR       🎓 1/5    ║ ← 精通徽章替换 NEW
║                          ║
║ ── EF CORE ──            ║
║                          ║
║     N+1 Query            ║
║                          ║
║     ⭐⭐⭐⭐              ║
║                          ║
║  C#/.NET             🔷 ║
╚━━━━━━━━━━━━━━━━━━━━━━━━━━╝
```

**Library 未抽态 · LEG 位**：

```
╔━━━━━━━━━━━━━━━━━━━━━━━━━━╗ ← 金边框淡化 30% 透明
║                          ║
║                          ║
║         ⟨ ? ⟩            ║
║                          ║
║   [雾化灰度整卡]         ║
║                          ║
║   From C#/.NET pool      ║
║                          ║
╚━━━━━━━━━━━━━━━━━━━━━━━━━━╝
```

### 4.5 卡背面（Draw 仪式中所有卡背面一致）

- 底色：紫色 `#6E4C9F`（C#/.NET 池主色）
- 正中央：`C#` 徽章大字（JetBrains Mono Bold 48pt）
- 装饰：尖括号 `<` / 花括号 `{}` / 分号 `;` 低透明度（10%）飘散
- 四角：微金色 `⚡` 提示（至少 1 张 LEG 保底预告）

---

## 5. Day-1 Daily Dose 机制

### 5.1 问题背景

原设计 Day-1 强制"抽 10 张 + 学 10 张"。用户访谈反馈："一次学 10 张压力很大"。但完全废除 10 连抽又失去 gacha 仪式感。

### 5.2 最终方案

Day-1 流程：`免费 10 连抽 → Draw Stage D 翻出 10 张 → Daily Dose 选择器（1/3/5/All）→ 路线激活 N 关 → 学完 → Settlement 送 +N free single pulls`

**四档剂量**：

| 档 | 图标 | 名字 | 学 N 张 | 时长 | 默认 |
|----|----|----|----|----|----|
| 1 | ☕ | Just a taste | 1 | ~2 min | — |
| 3 | 📖 | Cozy | 3 | ~8 min | ✅ 默认（小张选这个） |
| 5 | 🚀 | Focus | 5 | ~13 min | — |
| All | 🔥 | Full send | 10 | ~25 min | — |

**完关奖励**：Day-1 每过 1 关送 `+1 free single pull`，累计上限 5，可当日用或存到明日。

**Day 2+ 常态**：不再显示 Daily Dose（FSRS 自动决定今天学几张），Power User 可在 Settings 永久开启。

---

## 6. User A Journey · 12 屏 Storyboard（核心交付）

> **本节是 Claude Design 的画图依据**。每张图严格按以下字段画，数据在 12 屏之间必须连续。

### 6.1 虚拟用户锁定

- **姓名**：小张（Xiao Zhang）
- **身份**：工作 2 年的 .NET 后端
- **设备**：iPhone 15，浅色主题
- **场景**：午休 12:30，13 分钟走完 Day-1

### 6.2 数据锁（12 屏必须一致）

- **池**：`C#/.NET`（v1 唯一池）
- **10 张抽卡结果**：
  - 1 ⚡ LEG：`Task.Result Deadlock` (Q1)
  - 3 🔷 RAR：`N+1 Query` (Q6) · `DI Lifetimes` (Q2) · `JWT Auth` (Q43)
  - 6 ⚪ COM：`yield return` (Q9) · `IEnumerable vs IQueryable` (Q7) · `Dictionary vs List` (Q25) · `Delegate vs Event` (Q17) · `record vs class` (Q48) · `Interface vs Abstract` (Q4)
- **Daily Dose 选择**：3（Cozy 默认档）
- **今日 3 关**：
  - Stage 1 Boss = `Task.Result Deadlock` ⚡ 5 星
  - Stage 2 = `N+1 Query` 🔷 4 星
  - Stage 3 = `yield return` ⚪ 3 星
- **剩余 7 张**：进明日队列
- **评分结果**：Stage 1 Hard · Stage 2 Good · Stage 3 Good
- **时长**：12:30 开抽 → 12:43 收工（13 min，内含 ~8 min 学习）
- **Day-1 奖励**：完 3 关 → `+3 free single pulls`

### 6.3 屏幕尺寸与标注

- 每屏 **1170 × 2532**（iPhone 15 Pro 尺寸）
- safe margin 32pt
- 每屏旁边附一条文字注记："用户此时动作 · 情绪 · 期待"

---

### Screen 01 · Cold Start · 零卡态 Home（v5.1 · 补 Plan preview）

**场景**：App Store 刚下载完，首次启动
**情绪**：好奇 + 轻度警惕

**关键元素**：
- Header：中文欢迎语 `欢迎来到 RecallSmith · 先抽卡收集你的第一批卡 ↓`（中文 UI chrome 允许）
- **免费礼包大按钮**（视觉唯一重心）：金色填色 · 文案 `🎁 新人礼包 · 免费 10 连 [立即抽卡 →]`
- **Plan preview 微条**（v5.1 新增 · 礼包按钮下方 1 行）：
  - `📋 115 题 · ~25 天完成 · 3-5 张/天 · 抽完首 10 连解锁你的节奏`
  - 样式：底 `#F3E8C8` · 圆角 12pt · 12pt 小字 · 左图标 `📋` 金色
- 路线卡虚态（灰色淡化）：`── 关 0 / 0 ── · ──── 0 分钟 ──── · 抽卡后解锁你的第一条路线`
- 池选择器：`○ C#/.NET · 已激活` / `○ AWS 证书 · 即将上线（灰）`
- 重学区空态：`还没有需要重学的卡 ☕`
- 底部 5-tab nav：`Home · Draw · Review · Library · Me` · Home active

**Plan preview 的作用**：零卡态用户看到金色 CTA 后紧跟一条"量化节奏"信息，让用户对"抽卡之后的长期任务"有心理预期，减少"这是个游戏吧？" 的误判。

---

### Screen 02 · 免费抽卡 CTA 确认弹层

**场景**：点了金色大按钮
**情绪**：期待 + 确认成本

**关键元素**：
- 底部 Sheet（60% 屏高 · 羊皮纸底）
- Sheet Header：`🎁 新人礼包`
- 池名提示：`从 C#/.NET 池抽 10 张`
- 概率表：`⚡ LEG 3% · 🔷 RAR 17% · ⚪ COM 80%`
- 保底提示：`第 10 抽保底至少 1 张 🔷 RAR+`
- 次按钮（outline）：`[ 再看看 ]`
- 主按钮（金色填色）：`[ 开始抽卡 ]`

---

### Screen 03 · Draw 仪式过场（Cosmic 主题）

**场景**：色温从羊皮纸过渡到宇宙深蓝，抽卡动画进行中
**情绪**：兴奋

**关键元素**（切到 **Cosmic 主题 · `#0B1030` 底**）：
- Header 顶部（终端感等宽字）：`> recall.draw(n=10) · seed #2847a · C#/.NET`
- 中心：10 张卡背堆叠，紫色底 + `C#` 大字徽章 + 尖括号/花括号装饰
- 背景粒子效果（≤ 40 颗金色粒子向中心汇聚）
- 至少 4 颗粒子呈金色（LEG 暗示）
- 进度文字：`抽取中...`

---

### Screen 04 · Draw Stage D · 10 张结果（关键屏）

**场景**：翻开 10 张卡
**情绪**：惊喜 → 判断

**关键元素**（仍 Cosmic 底 · 但卡是羊皮纸色）：
- Header：`1⚡ 3🔷 6⚪ · C#/.NET · Pity hit ⚡`
- **英雄位**（顶部大卡，占 55% 屏高，**严格按 §4.4 LEG 5 星 ASCII**）：
  - 金色边框 4pt
  - ⚡ LEG + NEW
  - Primary Tag：`── ASYNC / AWAIT ──`（蓝色 2pt 色条）
  - Topic Keyword：`Task.Result Deadlock`
  - 5 星：`⭐⭐⭐⭐⭐`
  - 左下 `C#/.NET` · 右下 ⚡
  - **无 Q Snippet · 无 Audience Badge · 无代码装饰**
- **2×5 grid（9 张小卡）**：
  - 第 1 行（3 张 RAR 4 星，紫边 3pt）：`N+1 Query` / `DI Lifetimes` / `JWT Auth`（Tag: `EF CORE` / `ASP.NET CORE` / `ASP.NET CORE`）
  - 第 2-3 行（6 张 COM 3 星，灰边 2pt）：`yield return` / `IEnumerable vs IQueryable` / `Dictionary vs List` / `Delegate vs Event` / `record vs class` / `Interface vs Abstract`（Tag: `PERFORMANCE` / `LINQ` / `LINQ` / `OOP` / `OOP` / `OOP`）
  - 每张小卡只显示：稀有度 icon + NEW · Tag 短标 · Topic Keyword · Stars · 池名 · rarity icon
- 底部 CTA：
  - **主按钮（金色填色）**：`[ Collect All for Tomorrow / 全部收入明日 ]`
  - **次按钮（outline）**：`[ Pick Today's Dose → / 选今日剂量 → ]`
- 微文案："10 cards collected. How much to learn today?"

---

### Screen 05 · Daily Dose Selector（v4.2 新增关键屏）

**场景**：点了"选今日剂量" → 色温从宇宙过渡回羊皮纸 → 选择器 pop in
**情绪**：被赋权

**关键元素**（**Parchment 主题**）：
- Header：大字 `How much to learn today?` + 小副行 `你想今天学几张？`
- **中央 4 档水平 segmented 选择器**（高 120pt）：

```
┌────────┬────────┬────────┬────────┐
│   1    │   3    │   5    │  All   │
│   ☕   │   📖   │   🚀   │   🔥   │
│  Just  │  Cozy  │ Focus  │  Full  │
│ a taste│ (rec)  │        │  send  │
│  ~2m   │  ~8m   │  ~13m  │  ~25m  │
└────────┴────────┴────────┴────────┘
```

- 默认 "3" 档填充紫色 `#6E4C9F` + 白字；其他 3 档 outline
- 选中信息卡（选择器下方）：
  - `Selected: 3 cards · ~8 min · 1 Boss`
  - `Remaining 7 cards → Tomorrow's queue`
  - 下方 3 张缩略（按 §4.4 精简卡，但只显示 Tag + Keyword + Stars + 标签）：
    - `Task.Result Deadlock ⚡ ⭐⭐⭐⭐⭐ (Boss)`
    - `N+1 Query 🔷 ⭐⭐⭐⭐`
    - `yield return ⚪ ⭐⭐⭐`
- 底部 CTA：
  - 主按钮（金色填色）：`[ Start Today's Challenge → / 开始今日挑战 → ]`
  - 次按钮（outline）：`[ Collect all for tomorrow / 全部收入明日 ]`

---

### Screen 06 · Home · 3 关路线已激活（v5.1 · 新增 Plan 卡）

**场景**：回到 Home，看见今日挑战
**情绪**：期待（"就 3 关"）

**关键元素**（Parchment 主题 · Default 密度）：
- Header：`📖 常规模式 · C#/.NET · route #8f2c`
- Greeting 大字（v5.1）：`Good afternoon, 小张` + 小字 `12:32 · 3 关等你`
- **📋 MY PLAN 卡**（v5.1 新增 · 按 §3.7 规范 · 位于路线卡之上）：
  - Header：`📋 MY PLAN · C#/.NET`
  - Pool progress 行：进度条 + `10/115 · 8.7% · next milestone 20%`（薄荷绿填色）
  - This week 柱图（7 根 M-S）：今日高亮（Saturday 示例 · 琥珀色填充）
  - Goal 行：`🎯 Goal: 20% (Bronze) in 8 days · ≈ 3 cards/day · keep it up`
  - 底部链接：`[ View full plan ▸ ]`（link 样式 · 点击跳 v2 详情页）
- 今日路线卡（激活态 · 金色边框 · 位于 Plan 卡下方）：
  - 大字：`3 关 / ~8 分钟 · 1 Boss · 2 regular`
  - Progress bar `0/3`（底 `#F3E8C8` · 填色 `#7E9D5E`）
  - 下方小字：`Boss: Task.Result Deadlock ⚡`
  - 右上角微标：`+5 free pulls earnable 🎁`
- 主 CTA（金色填色）：`[ 开始今日挑战 → ]`
- 次 CTA（outline）：`[ 10 连抽 · 保底 0/10 ]`
- 卡包概况 pill：`C#/.NET · Day 1 · 10 cards`
- 重学区空态：`No cards to relearn ☕`
- 底部 5-tab nav：Home active

**Plan 卡 vs 路线卡的分工**：Plan 卡是"长期视角"（周 + 池 + 里程碑），路线卡是"当下任务"（3 关 / 8 分钟 / Boss 是谁）。两者互补：Plan 让用户看到 `我在哪`，路线让用户看到 `今天做什么`。不要把 Plan 的"周柱图"和老版单独的"周柱图"重复——v5.1 里周柱图**只在 Plan 卡内**。

---

### Screen 07 · Stage 1/3 · Boss Q 面（首次题干显现）

**场景**：点开始 → Level Q 面
**情绪**：专注 + 警觉

**关键元素**（Parchment 主题 · Boss 琥珀色条纹暗示）：
- Header：`Stage 1/3 · Boss ⚔ · C#/.NET` · 右上琥珀色"Boss"徽带
- 上半屏：
  - 稀有度徽章（左上小卡版）：⚡ LEG · Stage `○○○○○`（未评）
  - 小字 Meta：`Q1 · ASYNC / AWAIT · Audience: MID`（Audience 在这里出现，不在卡面）
  - **英文 Q 题干（大字，首次揭晓）**：
    ```
    "You see .Result on a Task in a controller.
     What can go wrong, and how do you fix it?"
    ```
  - 小字引导：`Think first. Tap to reveal.`
- 中部：折叠按钮（outline）：`[ Show Answer ↓ ]` · `[ How it shows up in real code ↓ ]`
- 底部 4 档评分（**全 outline 灰色，未激活**）：
  - `[ Again ¹ ]` `[ Hard ² ]` `[ Good ³ ]` `[ Easy ⁴ ]`（快捷键角标）
- Boss 微提示：`Boss stage · Mastering earns +2 progress`

---

### Screen 08 · Stage 1/3 · A + IRL 展开 + C# 代码块（线性披露）

**场景**：点 `Show Answer` → A 面展开 → 再点 IRL → 代码块 + 现实场景
**情绪**：恍然大悟

**关键元素**：
- Q 区收起为 1 行小字：`"What can go wrong with .Result?" ↑`
- **A 面（展开）**：
  - 英文正文（关键词高亮薄荷绿 `#7EC9A8`）：
    > `Calling .Result` **blocks** `the calling thread. In ASP.NET sync context, this can cause a` **deadlock** `because the awaited continuation tries to resume on the same captured context.`
  - **VS Code Dark+ 代码块**（圆角 12pt · 底 `#1E1E1E`）：
    ```csharp
    // ❌ Bad — blocks thread, risks deadlock
    public IActionResult Get()
    {
        var user = _svc.GetUserAsync().Result;   // ← deadlock risk
        return Ok(user);
    }

    // ✅ Good — async all the way
    public async Task<IActionResult> Get()
    {
        var user = await _svc.GetUserAsync();
        return Ok(user);
    }
    ```
- **IRL 面（展开 · 灰蓝卡片 `#D9E4F0`）**：
  - Header：`🌍 How it shows up in real code`
  - 正文：`Legacy ASP.NET controllers calling .Result or .Wait() on async methods. Symptoms: slow endpoints, thread pool exhaustion, mysterious hangs under load.`
- 底部 4 档评分（**已激活 outline，按压填色**）
- 小张点 `[ Hard ² ]`（首次见 Boss，偏难）→ 按钮琥珀填色 → progress 条到 Stage `●○○○○`

---

### Screen 09 · Stage 2/3 · N+1 Query · 常规关完整屏（v5.1 重写）

> **v5.0 合屏方案已废除**。原设计把 Stage 2 和 Stage 3 两关塞在一张 artboard（上下各占半屏），结果读图困惑、信息残缺。v5.1 改为**单关完整屏 = Stage 2 的 N+1 Query**（RAR 4 星 · 非 Boss 代表）。Stage 3 `yield return` 的存在通过 Screen 10 Settlement 的 GradeMixBar 和 Mental Ledger 表达——Design 不用再画单独的 Stage 3 artboard。

**场景**：打过 Boss 后进入 Stage 2 · 用户流畅推进非 Boss 常规关
**情绪**：轻松节奏（`比 Boss 好打`）

**关键元素**（Parchment 主题 · 无 Boss 琥珀条纹 · 与 Screen 07-08 布局一致但信息密度略降）：
- Header：`Stage 2/3 · 🔷 RAR · EF CORE · C#/.NET`（右上角无 Boss 徽带）
- 稀有度徽章（左上小卡版）：🔷 RAR · Stage `○○○○○`（未评）
- 小字 Meta：`Q6 · EF CORE · Audience: BOTH`
- **英文 Q 题干**（中字 · 17pt · 比 Boss 题干略小，体现"非 Boss 节奏快"）：
  ```
  "How do you spot and fix N+1 in EF Core?"
  ```
- **A 面已展开**（默认展开，不用再点——节奏优化：非 Boss 关跳过折叠步骤）：
  - 英文正文 + 关键词高亮：
    > `Use` **.Include()** `or` **projection** `to avoid lazy loading per row.`
  - VS Code Dark+ 代码块（**小号 · 仅 3 行 · 相对 Screen 08 Boss 代码块更紧凑**）：
    ```csharp
    // ✅ Eager loading with .Include()
    context.Orders
        .Include(o => o.Items)
        .ToList();
    ```
- **IRL 面已展开**（灰蓝卡片）：
  - Header：`🌍 How it shows up in real code`
  - 正文：`EF Core entity with lazy loading + enumerating related collections in a loop. Shows up as endpoint latency spikes proportional to row count.`
- 底部 4 档评分按钮（**已激活 outline**）：`[ Again ¹ ]` `[ Hard ² ]` `[ Good ³ ]` `[ Easy ⁴ ]`
- 小张点 `[ Good ³ ]` → 薄荷色 `#7E9D5E` 填色 → progress `●○○○○`
- **右上角奖励 toast（关 1 已发，关 2 刚发）**：
  - `🎁 +1 free pull`（关 1 完 · 上方，2s 前出现）
  - `🎁 +1 free pull`（关 2 刚完 · 下方，0s，正在淡入）
  - toast 下方累计小字：`2 free pulls earned · 1 stage to go`

**为什么非 Boss 关默认展开 A/IRL**：Boss 关需要"思考 → 揭晓"的仪式（Screen 07 → 08），非 Boss 关已经看过题目背景，线性披露变成"徒增点击"，故默认一屏到底。

**转场提示**：用户点 Good → 按钮填色 300ms → 0.3s 后自动推进到 Stage 3（yield return 关，本轮**不画 artboard**）→ 打完 Stage 3 → Screen 10 Settlement。

---

### Screen 10 · Settlement 收工页（v4.3 · 3 关版）

**场景**：3 关全打完
**情绪**：成就感 + 温和 + 小意外（"还送免费抽？"）

**关键元素**：
- Header（等宽字终端感）：`session #2847 · closed · Today's wrap-up`
- 大字反馈：`3/3 cleared · 8m 14s · Right on pace 🎉`
- 三大数字行（横排 3 列）：
  - `100% clear rate`
  - `Learned 3 cards`
  - `+1 Mastered`
- **GradeMixBar**（水平 4 色条 · 总和严格 = 3）：
  - `Again 0 · Hard 1 · Good 2 · Easy 0`（块宽按数比例）
  - 色：Again 橙红 `#A7503B` · Hard 琥珀 `#C8883A` · Good 薄荷 `#7E9D5E` · Easy 金 `#D9A541`
- **心智账本**（英文 + icon · 4 行）：
  - `🎓 Learned: N+1 Query · yield return  +2`
  - `💎 Mastered: Task.Result Deadlock  +1`（金色边框放大）
  - `🪙 Newly drawn: From today's pull  +10 (3 learned + 7 tomorrow)`
  - `🌫 Faded: 0 cards`
- **Day-1 奖励 banner**（金色背景 · 显眼）：
  - `🎁 You earned 3 free single-pulls! Use now or keep for tomorrow?`
  - 两按钮：`[ Pull Now ]`（outline）· `[ Save for tomorrow ]`（金色填色主按钮）
- 明日预告：`Tomorrow · 7 cards in queue · ~15 min · mix of RAR & COM`
- 底部 CTA 行：`[ Home ]` · `[ Draw again ]`

---

### Screen 11 · Library 图鉴 · 10 / 115 collected（v5.2 回退 · 3 列缩小卡 · 对齐行业惯例）

> **v5.1 的 2 列布局首轮落地后，PM 反馈："其他卡牌游戏（原神/FGO/明日方舟）图鉴都不是 2 列，2 列显得没卡"**。v5.2 回退到 **3 列 + 16pt gutter + 32pt safe margin**，**卡片缩小**到合适尺寸即可（非强拉大）。信息密度提高 50%，每屏可见 9 张卡而不是 4 张，更接近用户对"图鉴"的心智模型。

**场景**：小张点底部 Library tab 看收藏
**情绪**：收藏癖满足 · 一眼能看到"这一页有多空"

**关键元素**（Parchment 主题）：
- Header：`Library · C#/.NET ▾ · 10 / 115 collected · 8.7%`
- 进度条 8.7%（薄荷填色 4pt 高 · 圆角 2pt）
- **过滤 chips 单行 5 个**（全英文 · 互斥单选 · 高 36pt · 横向 pill）：
  - `[ All ]` 选中态（紫色填色 `#6E4C9F` + 白字）
  - `[ ⚪ COM ]` `[ 🔷 RAR ]` `[ ⚡ LEG ]` `[ 🌫 Unpulled ]`（outline · 边 `#5A4B38` 1.5pt · 字 `#2A2218`）
- 右侧小控件：`Sort: Rarity ▾` · `View: Grid ▾`（12pt 小字 · 下拉图标）
- **3 列卡片网格（v5.2）**：
  - **栅格规格**：3 列 · **gutter 16pt** · 每卡宽度 ~346pt · 高 ~260pt
  - 两边 safe margin 32pt：`32 + 346 × 3 + 16 × 2 = 32 + 1038 + 32 = 1102pt`（iPhone 15 Pro 1170pt 宽下居中留 34pt 环绕）
  - **卡片之间 16pt 纵向间距** · 每行卡片下方留 16pt 白
  - 每张卡严格按 §4.4（Tag + Keyword + Stars + 左下池名 + 右下 rarity icon + 精通徽章），但为 3 列做以下**缩小适配**：
    - Tag 色条仍 2pt 高 · 字号从 11pt → **10pt**（仍可读）
    - Keyword 字号从 28-32pt → **18-22pt**（Bold JetBrains Mono），允许 2 行（超长如 `IEnumerable vs IQueryable` 换行为 `IEnumerable vs` / `IQueryable`）
    - 星级 emoji 从 14pt → **10pt**（5 连总宽 ~55pt，3 列窄卡仍能一行放下）
    - 池名从 13pt → **10pt**（C#/.NET 仍完整可读）
    - 精通徽章（🎓/💎/🪙）从 16pt → **12pt**，贴卡片右上 8pt 内边
- **第 1 屏可见内容（滚动前 · 3 行 × 3 列 = 9 张）**：
  - **第 1 行（左→右）**：
    - 左：`⚡ LEG · 💎 1/5 · ASYNC/AWAIT · Task.Result Deadlock · ⭐⭐⭐⭐⭐ · ⚡`（金框 4pt · 💎）
    - 中：`🔷 RAR · 🎓 1/5 · EF CORE · N+1 Query · ⭐⭐⭐⭐ · 🔷`（紫框 · 🎓）
    - 右：`🔷 RAR · 🎓 1/5 · ASP.NET CORE · DI Lifetimes · ⭐⭐⭐⭐ · 🔷`
  - **第 2 行**：
    - 左：`🔷 RAR · 🪙 0/5 · ASP.NET CORE · JWT Auth · ⭐⭐⭐⭐`（🪙 = drawn but not learned · 灰色徽）
    - 中：`⚪ COM · 🎓 1/5 · PERFORMANCE · yield return · ⭐⭐⭐`
    - 右：`⚪ COM · 🪙 0/5 · LINQ · IEnumerable vs IQueryable · ⭐⭐⭐`（keyword 2 行换）
  - **第 3 行**：
    - 左：`⚪ COM · 🪙 0/5 · LINQ · Dictionary vs List · ⭐⭐⭐`
    - 中：`⚪ COM · 🪙 0/5 · OOP · Delegate vs Event · ⭐⭐⭐`
    - 右：`⚪ COM · 🪙 0/5 · OOP · record vs class · ⭐⭐⭐`
- **滚动后可见**（约 35 行雾化卡 · ⟨ ? ⟩ · From C#/.NET pool）
- 底部 5-tab：Library active
- 可选浮动按钮（右下）：`[ Sort / Filter ]` 快捷

**为什么从 2 列回到 3 列**：
1. **行业惯例**：原神 / FGO / 明日方舟 / 火影忍者手游 图鉴均 3-4 列缩略网格 · 用户打开图鉴本能期待"看到很多格子"
2. **8.7% 收集率显眼**：3 列 9 张可见里只有 9 张实卡，视觉上大量雾化位更能激励"想填满"
3. **卡片缩小 ≠ 难读**：Keyword 18-22pt + JetBrains Mono Bold 仍然是可辨识主角字；Stars 10pt 5 连 55pt 宽度在 346pt 卡宽上仍占 16%
4. **仪式感依然够**：仪式感在 Screen 04（Draw Result）和点击卡片的 Detail 页做足即可，图鉴就是"看收藏数"的地方

---

### Screen 12 · Home 回首 · Day 1 完成（v5.1 · Plan 卡 + 明日预告合并）

**场景**：小张点 `Save for tomorrow` → 回 Home → Day 1 闭环
**情绪**：充实 + 期待明天

**关键元素**（Parchment 主题 · Day-1 完成态）：
- Header：`📖 常规模式 · C#/.NET · Day 1 ✓`
- 大字问候：`Well done, see you tomorrow` + 小字 `明日 7 关等你 · 12:43 · 13 min total`
- **📋 MY PLAN 卡**（v5.1 · 完成态 · 与 Screen 06 同规范但数字更新）：
  - Pool progress：`10/115 · 8.7% · +8.7% today 🔥`（今日增量显眼）
  - This week 柱图：今日柱顶加绿色 `✓` 标记 · 下方 `3 cards learned today`
  - Goal：`🎯 Goal: 20% (Bronze) in 8 days · on track`
  - 底部链接：`[ View full plan ▸ ]`
- 今日路线卡（**完成态**）：
  - 绿色 check：`3 / 3 · 8m 14s ✓ DONE`
  - 小字：`NEXT UP · DI Lifetimes · JWT Auth · IEnumerable · Dictionary · +3 more`
- **奖励回顾条**（金色底）：`🎁 3 free pulls earned · saved for tomorrow`
- 池 pill：`C#/.NET · Pity 0/10 · Collected 10/115`
- 重学区空态：`No cards to relearn ☕`
- 次 CTA（outline）：`[ Draw again ]`
- 底部 5-tab：Home active

**v5.1 合并说明**：v5.0 里重复的"周柱图"和"明日预告卡"已经被 Plan 卡和路线卡的完成态吸收。UI 不再出现两个地方都画 "This week" 的冗余。

**情绪终点**：温和、不焦虑、明天还想来。

---

## 6b. User A · Day-2 Journey · 7 屏 Storyboard（v5.1 新增 · 常态流程）

> **目的**：Day-1 Journey（§6）只覆盖"首次抽卡 + Daily Dose + 3 关小剂量"的新用户初体验。Day-2 才是这款产品的**真实常态**——没有首抽仪式、没有 Daily Dose 选择器、FSRS 自动决定今天学几张、用户可能中途用掉 Day-1 存下的 free pull。
>
> **为什么要让 Design 画 Day-2**：Day-2 的 UX 和 Day-1 差很多。如果只画 Day-1，Claude Design 很容易把"新人特供 UI"误当成常态 UI 做进组件库（例如把 Daily Dose 当成每日必出现）。Day-2 Journey 的 7 屏就是用来锚定"常态长什么样"。

### 6b.1 Day-2 人物设定与场景

- **用户**：同一个小张（不换人 · 数据从 Day-1 延续）
- **时间**：Day-1 后第二天 · 中午 12:40
- **手头状态**（Day-1 收工遗留）：
  - 昨日"明日队列" = 7 张 drawn-not-learned：`DI Lifetimes` 🔷 · `JWT Auth` 🔷 · `IEnumerable vs IQueryable` ⚪ · `Dictionary vs List` ⚪ · `Delegate vs Event` ⚪ · `record vs class` ⚪ · `Interface vs Abstract` ⚪
  - 存货：`3 free single pulls` 🎁 saved from Day-1
  - 昨日 Boss `Task.Result Deadlock` 评 Hard → FSRS 计划 Day-3 回流（今日**不出现**）
  - 昨日 `N+1 Query` / `yield return` 评 Good → FSRS 计划 Day-4 回流
  - 图鉴状态：10 / 115 collected · 3 🎓 Learned (Day-1 学的) + 7 🪙 Drawn
- **Day-2 要完成**：7 张 queued 新卡 + 中途花 1 个 free pull 体验"奖励消费" + Day 2 结束总结

### 6b.2 Day-2 数据锁

- **Day-2 队列**：7 张（Day-1 明日队列里全部）
- **Day-2 时长**：~15 分钟（12:40 开始 → 12:55 收工）
- **中途 free pull**：小张打完 Stage 4 后花掉 1 个 → 抽出 Q26 `AsNoTracking` ⚡ LEG 5 星（彩蛋：意外抽到第 2 张 LEG · 用户心情额外好）
- **剩余 free pulls**：3 → 2（用了 1 个）
- **Day-2 结束图鉴**：10 + 7 + 1 = **18 / 115 collected · 15.7%**
- **FSRS 回流预告**：Day-3 将出现 `Task.Result Deadlock` 复习关（from Day-1 Hard），另外 Day-2 的 7 张根据评分决定下次时间

### 6b.3 Day-2 编号约定

Day-2 屏幕编号为 **D2-01 ~ D2-07**（与 Day-1 的 01-12 区分），共 **7 张 artboard**。

Claude Design 命名约定：`02-day2-01-home-morning.png` ~ `02-day2-07-home-closing.png`。

---

#### D2-01 · Home · Day-2 Morning · 7 张 queue ready

**场景**：小张 Day-2 中午再次打开 App
**情绪**：熟悉感 + 小意外（"昨天那 3 个免费抽还在！"）

**关键元素**（Parchment 主题 · Default 密度）：
- Header：`📖 常规模式 · C#/.NET · Day 2`
- Greeting：`Good afternoon, 小张` + 小字 `12:40 · 昨天收尾得不错 ☀️`
- **📋 MY PLAN 卡**（v5.1 · Day-2 状态）：
  - Pool progress：`10/115 · 8.7% · still on track`
  - This week 柱图：昨日柱顶 ✓ · 今日柱虚态（待填）· 其他 5 根灰态
  - Goal：`🎯 Goal: 20% (Bronze) in 7 days`
  - `[ View full plan ▸ ]`
- **今日路线卡**（激活态 · FSRS 已自动排程 · 金色边框）：
  - 大字：`7 关 / ~15 分钟 · 0 Boss · 7 regular`
  - 小字：`From yesterday's queue · 2 RAR + 5 COM`
  - Progress `0/7`
- **Day-1 奖励回顾 pill**（显眼 · 金色底）：`🎁 3 free single pulls available · use anytime`
- 主 CTA（金色填色）：`[ 开始今日学习 → ]`
- 次 CTA（outline）：`[ Use 1 free pull 🎁 ]`（这是 Day-1 奖励的入口）
- 三级 CTA（小链接）：`[ 10 连抽 · 保底 0/10 ]`
- 卡包概况 pill：`C#/.NET · Day 2 · 10 cards`
- 重学区空态（Day-2 无回流，昨日 Hard 还在 FSRS 未来）：`No cards to relearn ☕`
- 底部 5-tab：Home active

**关键差异 vs Day-1**：
1. **没有 Daily Dose 选择器**——FSRS 直接排 7 关，不让用户选剂量
2. **Plan 卡显示了 "昨日 ✓"**——连续性视觉
3. **新增"Use 1 free pull"次按钮**——Day-1 奖励的消费入口
4. **路线卡上有 `0 Boss`**——显式说明今天没 Boss，降低压力感

---

#### D2-02 · Stage 1/7 · DI Lifetimes Q 面（RAR · 无 Boss 仪式）

**场景**：小张点 `开始今日学习` → Stage 1 开启 · 第一关是 `DI Lifetimes` RAR
**情绪**：专注（`昨天抽到的，今天认识一下`）

**关键元素**（Parchment 主题 · **无 Boss 琥珀条纹**）：
- Header：`Stage 1/7 · 🔷 RAR · ASP.NET CORE · C#/.NET`
- 稀有度徽章：🔷 RAR · Stage `○○○○○`
- 小字 Meta：`Q2 · ASP.NET CORE · Audience: BOTH`
- **英文 Q 题干**：
  ```
  "Explain the difference between AddSingleton,
   AddScoped, and AddTransient in ASP.NET Core DI.
   When would you pick each?"
  ```
- 小字引导：`Think first. Tap to reveal.`
- 折叠按钮：`[ Show Answer ↓ ]` · `[ How it shows up in real code ↓ ]`
- 底部 4 档评分（**全 outline 灰色**）：`[ Again ¹ ]` `[ Hard ² ]` `[ Good ³ ]` `[ Easy ⁴ ]`
- **Day-2 新增小标**（右上角）：`day 2 · streak 🔥 2`（连续学习天数 · 红色 emoji）

**关键差异 vs Screen 07（Day-1 Boss）**：无 Boss 琥珀徽带 · 无 `Boss stage · +2 progress` 微提示 · 多出 `streak 🔥 2` 连续激励。

---

#### D2-03 · Stage 1/7 · A + IRL 展开（快节奏非 Boss 关）

**场景**：点 Show Answer → 答案 + 代码块 + IRL 铺开
**情绪**：恍然大悟（`Scoped 就是每个请求一个`）

**关键元素**：
- Q 区收起为 1 行小字：`"DI lifetimes difference?" ↑`
- **A 面**（英文）：
  > `Singleton = one instance for the app. Scoped = one per HTTP request. Transient = new every time. Pick Singleton for stateless services, Scoped for DbContext, Transient for lightweight work.`
  - 关键词高亮：`Singleton` / `Scoped` / `Transient`（紫色粗体）
- **VS Code Dark+ 代码块**：
  ```csharp
  services.AddSingleton<IConfigCache, ConfigCache>();
  services.AddScoped<AppDbContext>();          // per-request
  services.AddTransient<IEmailSender, SmtpSender>();
  ```
- **IRL 面**（灰蓝卡片）：
  - Header：`🌍 How it shows up in real code`
  - 正文：`Injecting DbContext as Singleton is a classic bug — it's not thread-safe and will blow up under concurrent requests. Scoped is the correct default.`
- 底部 4 档评分（**已激活**）：小张点 `[ Good ³ ]` 薄荷填色
- **无 `+1 free pull` toast**（Day-2 不送，Day-1 福利已结束）

---

#### D2-04 · Mid-session · 用掉 1 个 Free Pull（彩蛋关键屏）

**场景**：打完 Stage 4（已完成 4/7）时，小张决定点右上角 `🎁 Use 1 free pull`（从 Home 带下来的 Day-1 存货）
**情绪**：惊喜（抽到第 2 张 LEG）

**关键元素**（Parchment 主题 · 小型抽卡仪式 · 不切 Cosmic 主题以免中断学习流）：
- 屏幕上半：保持 Stage 4 刚结束的"Well done" 祝贺态（小字 `Stage 4/7 cleared · Good ✓`）
- **中部 Modal / 浮层**（70% 屏高 · 羊皮纸深色底 `#F3E8C8` · 圆角 24pt）：
  - Header：`🎁 Free Pull Unlocked`
  - 小字：`Drawing 1 card from C#/.NET pool...`
  - 中央卡翻转动画停帧：正面揭晓一张 **LEG 5 星 Q26 `AsNoTracking`**
    - 按 §4.4 LEG 卡面规范：⚡ LEG NEW · `── EF CORE ──` · `AsNoTracking` · ⭐⭐⭐⭐⭐ · C#/.NET · ⚡
    - 金色边框 · 粒子稀疏金光环绕
  - 下方小字：`🎉 Lucky! Your 2nd LEG in 2 days.`
  - 两个按钮：
    - 主（金色填色）：`[ Add to Library / 加入图鉴 ]`（默认：收入图鉴，标 🪙 drawn-not-learned）
    - 次（outline）：`[ Learn now →]`（可选：马上插入到今日路线第 5 关）
  - 底部小字：`2 free pulls remaining · use anytime`
- 屏幕下半：Stage 5/7 未开始（`DI Lifetimes` 的回扣 · `Up next: Interface vs Abstract`）

**情绪 UX 设计**：
1. 不切 Cosmic 主题，避免学习心流中断
2. 抽到第 2 张 LEG 是"幸运彩蛋"——说明 free pull 的惊喜价值
3. 给用户两个出口：学（快速插入今日路线）或藏（图鉴 + 明日再说）
4. 小张在本 Journey 中选 `Add to Library`（保持 7 关节奏不变）

---

#### D2-05 · Settlement · Day-2 收工（常态版 · 无 Day-1 bonus）

**场景**：7 关全打完
**情绪**：稳定成就感（`昨天是新手剂量，今天是正式流程`）

**关键元素**：
- Header：`session #2903 · closed · Day 2 wrap-up`
- 大字反馈：`7 / 7 cleared · 14m 52s · Steady progress ✨`
- 三大数字：
  - `100% clear rate`
  - `Learned 7 cards`
  - `+0 Mastered · 7 in progress`（Day-2 的卡都是 1/5 Learned · 没卡到 Mastered 5/5 · 显式说明）
- **GradeMixBar**（总和 = 7）：
  - `Again 0 · Hard 1 · Good 5 · Easy 1`
  - 色比例：Hard 1/7 · Good 5/7 · Easy 1/7
- **心智账本**（英文）：
  - 🎓 Learned: `DI Lifetimes · JWT Auth · IEnumerable · Dictionary · Delegate · record · Interface` **+7**
  - 💎 Mastered: `None` **+0**
  - 🪙 Newly drawn: `AsNoTracking (from free pull) · +1 LEG` **+1**（金色边框微放大）
  - 🌫 Faded: `0 cards`
- **Day-1 奖励使用汇总**（v5.1 新增 · 取代 Day-1 banner · 中性温和色）：
  - `🎁 Used 1 of 3 free pulls · 2 remaining`
- **FSRS 回流预告 banner**（v5.1 新增 · 琥珀色）：
  - `⏰ Tomorrow · Task.Result Deadlock ⚡ returns for review (from Day-1 Hard)`
  - 小字：`Plus 0-2 more cards based on how you rated today`
- 底部 CTA 行：`[ Home ]` · `[ Draw again ]` · `[ Library ]`

**关键差异 vs Day-1 Settlement**：
1. **无 "You earned N free pulls!" 大 banner**（Day-1 福利不续）
2. **新增 FSRS 回流预告 banner**——让用户知道"昨天 Hard 的会回来"
3. **Mental Ledger 中包含 free pull 使用痕迹**（AsNoTracking +1 LEG）
4. **不再有 "Day-1 bonus"**，情绪收益靠 "streak 🔥 2" 和 "14m 52s steady"

---

#### D2-06 · Library · 18 / 115 collected（Day-2 状态 · 3 列布局 v5.2）

**场景**：点底部 Library tab 看收藏变化
**情绪**：进步感（`一天涨 8 张`）

**关键元素**（Parchment 主题 · 严格按 §11 Library v5.2 布局 · 3 列 + 16pt gutter · 缩小卡）：
- Header：`Library · C#/.NET ▾ · 18 / 115 collected · 15.7%`
- Progress bar 15.7%（薄荷填色 · 比 Day-1 的 8.7% 显著增长）
- 进度条上方小条：`+8 today 🔥 (7 learned + 1 LEG drawn)`
- **过滤 chips 单行 5 个**：`[ All ]` 选中（紫）· `[ ⚪ COM ]` `[ 🔷 RAR ]` `[ ⚡ LEG ]` `[ 🌫 Unpulled ]`
- **3 列卡片网格**（按 §4.4 + §11 v5.2）：
  - **第 1 行（AsNoTracking 🆕 亮点 + Day-1 Boss）**：
    - 左：`⚡ LEG · 🆕 NEW · EF CORE · AsNoTracking · ⭐⭐⭐⭐⭐ · ⚡`（金框 4pt · 🆕 红色小徽 · free pull 抽到未学）
    - 中：`⚡ LEG · 💎 1/5 · ASYNC/AWAIT · Task.Result Deadlock · ⭐⭐⭐⭐⭐ · ⚡`（金框 · 💎 Mastered）
    - 右：`🔷 RAR · 🎓 1/5 · EF CORE · N+1 Query · ⭐⭐⭐⭐ · 🔷`
  - **第 2 行（Day-1 已学 2 张 + Day-2 RAR 2 张）**：
    - 左：`⚪ COM · 🎓 1/5 · PERFORMANCE · yield return · ⭐⭐⭐`
    - 中：`🔷 RAR · 🎓 1/5 · ASP.NET CORE · DI Lifetimes · ⭐⭐⭐⭐`
    - 右：`🔷 RAR · 🎓 1/5 · ASP.NET CORE · JWT Auth · ⭐⭐⭐⭐`
  - **第 3 行（Day-2 新学 COM 3 张）**：
    - 左：`⚪ COM · 🎓 1/5 · LINQ · IEnumerable vs IQueryable · ⭐⭐⭐`
    - 中：`⚪ COM · 🎓 1/5 · LINQ · Dictionary vs List · ⭐⭐⭐`
    - 右：`⚪ COM · 🎓 1/5 · OOP · Delegate vs Event · ⭐⭐⭐`
  - **第 4 行（Day-2 新学 COM 2 张 + 首个雾化位）**：
    - 左：`⚪ COM · 🎓 1/5 · OOP · record vs class · ⭐⭐⭐`
    - 中：`⚪ COM · 🎓 1/5 · OOP · Interface vs Abstract · ⭐⭐⭐`
    - 右：⟨ ? ⟩ 雾化卡 · `From C#/.NET pool`（首个未抽位）
  - **第 5+ 行（滚动可见）**：大量雾化卡填充至总 115 位
- 底部 5-tab：Library active

**关键高亮**（3 列布局下仍然成立）：
1. `AsNoTracking` 🆕 NEW 徽章在第 1 行最左位——强化"free pull 带来的彩蛋"
2. `Task.Result Deadlock` 💎 Mastered 紧邻其右——昨日 Boss 代表稳稳在首行
3. 其他 9 张全 🎓 Learned · 1/5 进度（全是第 1 次学会）
4. 第 1 屏看到 11 张实卡 + 1 张雾化 = 比 2 列看到的 4 张多近 3 倍的"信息密度"

---

#### D2-07 · Home · Day-2 闭环 + Day-3 预告

**场景**：小张回到 Home · Day-2 收尾
**情绪**：规律感（`每天来一次挺舒服的`）

**关键元素**（Parchment 主题 · Day-2 完成态）：
- Header：`📖 常规模式 · C#/.NET · Day 2 ✓`
- Greeting 大字：`See you tomorrow, 小张` + 小字 `14m 52s total · streak 🔥 2 days`
- **📋 MY PLAN 卡**（v5.1 · Day-2 完成态）：
  - Pool progress：`18/115 · 15.7% · +7% today 📈`
  - This week 柱图：昨天 ✓ + 今天 ✓（两根绿色）· 周内进度可见
  - Goal：`🎯 Goal: 20% (Bronze) in 6 days · ahead of schedule 🎉`（进度提速）
  - `[ View full plan ▸ ]`
- 今日路线卡（**完成态**）：
  - 绿色 check：`7 / 7 · 14m 52s ✓ DONE`
  - 小字：`Tomorrow's plan · 1 review + 0-2 new · Task.Result Deadlock ⚡ returns`
- **FSRS 回流预告 banner**（琥珀色 · 与 Settlement 同文案）：
  - `⏰ Tomorrow · 1 card to review: Task.Result Deadlock ⚡ (Day-1 Hard rated)`
- **奖励回顾 pill**：`🎁 2 free pulls remaining · use anytime`
- 池 pill：`C#/.NET · Pity 0/10 · Collected 18/115`
- 重学区空态：`No cards to relearn ☕`（Day-3 才会有）
- 次 CTA（outline）：`[ Draw again · 10 连抽 ]`
- 底部 5-tab：Home active

**情绪终点**：规律、期待（Day-3 有 Task.Result 回归）、福利未来得及用完的小爽感。

---

### 6b.4 Day-2 转场节奏表（供 FE 参考）

| 从 → 到 | 动画 | 时长 | 情绪 |
|----|----|----|----|
| D2-01 → D2-02 | 路线卡 → Stage 1 zoom in | 300ms | 进入学习 |
| D2-02 → D2-03 | A/IRL accordion + 代码块展开 | 350ms | 揭晓 |
| D2-03 → D2-04 | Stage 1-4 节奏快进（每关 ~15s）→ 点 `Use free pull` → Modal 升起 | 各关 250ms · Modal 400ms | 流畅 + 惊喜 |
| D2-04 → Stage 5-7 | Modal 关闭 → 回到学习流 · 快进到 Stage 7 | 300ms | 回归节奏 |
| Stage 7 完 → D2-05 | 7/7 金光 + Settlement 上滑 | 500ms | 成就 |
| D2-05 → D2-06 | 底部 tab Home → Library | 180ms | 切换 |
| D2-05 → D2-07 | `Home` 按钮 → 路线淡出 → Home Day-2 完成态 | 400ms | 闭环 |

### 6b.5 Day-2 数据一致性校验表

| 字段 | D2-01 | D2-02 | D2-03 | D2-04 | D2-05 | D2-06 | D2-07 |
|----|----|----|----|----|----|----|----|
| 池名 | C#/.NET | C#/.NET | C#/.NET | C#/.NET | C#/.NET | C#/.NET | C#/.NET |
| Streak | 🔥 1 (Day-1) | 🔥 2 | 🔥 2 | 🔥 2 | 🔥 2 | — | 🔥 2 |
| 图鉴 | 10/115 | 10/115 | 10/115 | 11/115（AsNoTracking 刚入袋） | 18/115 | 18/115 | 18/115 |
| Free pulls | 3 available | 3 | 3 | 3 → 2 | 2 remaining | — | 2 remaining |
| 队列 | 7 待学 | 1/7 | 1/7 | 4/7 (free pull 前) | 7/7 ✓ | — | 7/7 ✓ |
| 时间 | 12:40 开 | 12:41 | 12:42 | 12:48 (mid) | 12:55 收 | — | 12:55 |
| FSRS 回流预告 | — | — | — | — | Day-3 Task.Result | — | Day-3 Task.Result |
| 新 LEG | — | — | — | AsNoTracking 揭晓 | 账本 +1 LEG | Library 第 1 位 NEW | — |

---

## 6c. User A · Day-3 → Day-7 Journey · 7 屏（v5.2 新增 · 中周期节奏 + 设计反思）

> **目的**：§6 覆盖 Day-1 首次体验，§6b 覆盖 Day-2 常态，但一个完整的 **7 天模拟** 才能暴露：
> - FSRS 回流高峰什么时候到 · 每天学的量是否起伏太大
> - Free pull 攒到第几天会被花掉 / 过期 / 积压
> - 用户在周中（Day-4/5）是否会感到疲劳
> - Bronze 里程碑（20%）大概 Day-N 达成 · 是否在 Plan 卡上出现"达成仪式"
> - streak 🔥 到 Day-7 是否有里程碑奖励
> - Library 3 列布局在收集数增长到 30+ 时是否仍然舒服
>
> **画面数**：Day-3 到 Day-7 每天挑 1-2 张代表性画面 · 合计 **7 屏**（D3-01 Home · D3-02 Stage-Mastered · D4-01 DrawAgain-Bronze · D5-01 Leech · D5-02 Library 28/115 · D6-01 Chill · D7-01 WeekSummary）
>
> **本节不是让 Design 全部重画 · 只标出新增/变化的关键元素** · Claude Design 可在 22 张基础上追加 7 张 = 与 §6d 的 6 张合并后总 35 张 artboard

### 6c.1 Day-3 到 Day-7 数字脚本（PM 先锁定）

| 日期 | 起始 Collected | 学习队列 | 新抽 | 结束 Collected | streak | Free Pull | 里程碑 |
|----|----|----|----|----|----|----|----|
| Day-3 | 18/115 | **3 张回流**（Task.Result Day-1 Hard · N+1 Day-2 Good · DI Lifetimes Day-2 Good） | 0 | 18/115 | 🔥 3 | 2 | — |
| Day-4 | 18/115 | **5 张回流** + 用户决定 Draw Again（**花 1 次 free pull** · 10 连抽得 8 COM + 1 RAR + 1 RAR 保底） | +10 | 28/115（**24.3%**） | 🔥 4 | 1 | — |
| Day-5 | 28/115 | **8 张回流**（Day-4 新抽里 3 张已学 + Day-1/2/3 老卡回流 5 张）· **1 张 Leech 警报**（Task.Result 连续 2 次 Hard） | 0 | 28/115 | 🔥 5 | 1 | — |
| Day-6 | 28/115 | **6 张回流** · 用户时间紧，只用 Chill 模式学 2 张 | 0 | 28/115（4 张 deferred 到 Day-7） | 🔥 6 | 1 | — |
| Day-7 | 28/115 | **10 张回流**（Day-6 deferred 4 + 今日正常 6）· 用户冲刺 · Draw Again 花掉最后 1 次 free pull | +10 | 38/115（**33.0%**） | 🔥 7 | 0 | **🏆 Bronze (20%) Day-4 解锁 · 已展示** |

**关键数字**：
- Bronze 里程碑（20%）在 Day-4 的 Draw Again 之后瞬间达成（18 → 28 = 24.3%）——触发 Screen D4-Bronze 仪式
- Day-7 = 33.0%，距离 Silver（50%）还有 19 张（≈ 7-10 天）
- Free pull 3 → 2 → 1 → 0 的消费节奏：Day-2（被动抽到 AsNoTracking）· Day-4（主动 Draw Again）· Day-7（冲 streak 奖励）
- Leech 警报：FSRS 算法在某张卡**连续 2 次 Hard** 或 **累计 3 次 Again** 时标记（Task.Result Day-1 Hard → Day-3 又 Hard = Day-5 进入 Leech 预警）

### 6c.2 D3-Home · Day-3 首页（3 张回流 · FSRS 节奏初现）

**场景**：小张 Day-3 午休 12:35 打开 app · streak 🔥 3 延续中
**情绪**：熟练感开始形成 · 期待今天学什么

**关键元素**（Parchment 主题 · 与 D2-01 同规范）：
- Header：`📖 常规模式 · C#/.NET · Day 3`
- 大字问候：`Welcome back, 小张` + 小字 `streak 🔥 3 days · 3 cards to review today`
- **📋 MY PLAN 卡**（v5.1 · Day-3 中间态）：
  - Pool progress：`18/115 · 15.7% · 0 new today · review 3`
  - This week：M✓ T✓ **W（今日柱在涨）** T F S S（两根绿色 + 一根黄色进行中）
  - Goal：`🎯 Bronze (20%) in 5 days · need 5 cards`
  - `[ View full plan ▸ ]`
- 今日路线卡（**review-only · 无 new**）：
  - 标题：`Today · 3 review cards`
  - 3 个小缩略卡：`Task.Result Deadlock ⚡ (Day-1 Hard)` + `N+1 Query 🔷` + `DI Lifetimes 🔷`
  - 副文：`~4-6 min · no new cards today (Daily Dose 已是 Day-1 专属)`
- **奖励回顾 pill**：`🎁 2 free pulls · use anytime to draw new cards`
- 池 pill：`C#/.NET · Pity 0/10 · Collected 18/115`
- 主 CTA：`[ Start · 3 cards ]` 金色填色
- 次 CTA（outline）：`[ Draw again · 10 pulls ]`（花一次 free pull）
- 底部 5-tab：Home active

**🧠 设计反思 #1**：Day-3 **没有新卡、只有复盘**——如果用户期待"每天抽新卡"，这里会不会感到失望？
- 选项 A：坚持 SRS 原则，review-only 就 review-only（当前设计）
- 选项 B：每日保底送 1 张雾化卡位供抽（削弱保底感）
- 选项 C：Day-N 自动弹"Draw again 建议"（当前用 outline CTA 已实现，但不够醒目）

### 6c.3 D3-Stage-Mastered · Task.Result 回流 · 第 2 次答对 → 🎓 升 Mastered 💎

**场景**：第 3 关 Task.Result Deadlock 回流 · 小张这次评 Good（Day-1 评 Hard · Day-3 评 Good）· 进度 1/5 → 2/5 · 但因为这是 LEG 高阶卡，**2/5 已经触发 Mastered 💎 预览**
**情绪**：成就感 · "这张我搞定了"

**关键元素**（Parchment 主题 · Settlement 前的单关完成态）：
- 关卡 Header：`Stage 3/3 · Task.Result Deadlock · ⚡ LEG · Day-3 Review`
- Q → A → IRL 三面（与 §6 Screen 07/08 同结构，此处展示的是**评分后**结果）
- 评分条：4 档 `Again (0) · Hard (1) · Good (2) · Easy (3)` · Good 高亮
- **升级提示 banner**（琥珀金色）：
  - `🎓 → 💎 Mastered preview!`
  - 小字：`This card now shows as 💎 in Library. Next review in 6-8 days.`
- **卡片 thumbnail 升级动画**（供 FE 参考）：
  - 旧态：左下 🎓 1/5 → 新态：左下 💎 2/5 · 卡框金光脉冲 400ms
- 下一关按钮：`[ Finish ]`（因为这是 Day-3 最后一关）
- 底部 CTA 隐藏（全屏沉浸）

**🧠 设计反思 #2**：LEG 卡 **2/5 就 Mastered** 而 RAR/COM 卡要 **5/5** 才 Mastered · 这个不对称规则用户是否一看就懂？
- 当前依赖 Settlement 上的 legend（未在 v5.2 明确写）· 需要 PM 决议：
  - 选项 A：每张卡第一次升 💎 时 onboarding 弹一次解释卡（1 次性 Modal）
  - 选项 B：Library tap 卡片详情页里有"Mastery rule: LEG 2/5 · RAR 4/5 · COM 5/5"说明行
  - 选项 C：改为统一 5/5（简化但弱化 LEG 的"难得"感）

### 6c.4 D4-DrawAgain-Bronze · Day-4 主动抽 10 连 · 命中 Bronze 里程碑仪式

**场景**：Day-4 小张心血来潮（`今天要解锁 Bronze`）· 点路线卡上方 `[ Draw again · 10 pulls ]` · 花 1 次 free pull · 10 连抽得 8 COM + 2 RAR · 新收集 10 张 → **从 18/115 跳到 28/115 · 跨过 20% Bronze 门槛**
**情绪**：仪式触发 · 第一次成就解锁

**关键元素**（Cosmic 仪式主题 + Parchment 收尾）：
- 抽卡过场按 §6 Screen 03-04 标准流程（不重复描述）
- **新增的 Bronze 仪式插屏**（抽卡 Result 后、回 Home 前 · **Cosmic → 金光特写 → Parchment**）：
  - 全屏金色粒子背景（同 LEG 特效复用）
  - 大字 Gold Serif：`🏆 Bronze Achievement`
  - 中号字：`20% of C#/.NET · 28/115 collected`
  - 下方奖励条：`🎁 +3 bonus free pulls · Unlocked a new card frame color`
  - 底部 CTA：`[ Continue ]` 金色填色
  - 持续 1200ms（自动跳转）或点 `[ Continue ]` 提前退出
- 跳转后回到 Home · Plan 卡顶部新增 Bronze 徽章 🥉 · Goal 行改：`🎯 Next: Silver (50%) in ~14 days`
- 路线卡展示今日路线（5 张回流） · 小张开始学习

**🧠 设计反思 #3**：里程碑仪式是否触发**过于随意**？
- 当前设计：**Draw Again 跨过门槛 = 立即弹仪式** · 风险：用户可能是为了"凑 20%"刻意多抽，仪式感被稀释
- 备选：仅在 **Mastered 数量达成** 时触发（Bronze = 20 张 Mastered 而不是 28 张 Collected）· 更贴近 SRS 原则
- 或者两者并行：20% Collected = 🥉 Bronze · 20% Mastered = 🥇 Gold · 需要 PM 决议
- **关键数值**：Day-4 的"+3 bonus free pulls" + Day-2 剩的 2 free pull → 共 **5 free pulls** · 下一张花哪？Plan 卡是否应该提示"你可以再抽 10 次"？

### 6c.5 D5-WeekendLong · Day-5 周末长会话 · 8 张回流 + 1 张 Leech 警报

**场景**：Day-5 是周六 · 小张早上 10:00 用 app · 时间充裕 · Plan 卡提示"周末可以多学"· FSRS 今天排了 8 张回流 · 其中 `Task.Result Deadlock` 再次 Hard · **触发 Leech 警报**
**情绪**：持久战开始 · 有一张卡让他烦

**关键元素**（Parchment 主题 · Stage 3/8 · Task.Result 第 3 次出现）：
- Header：`Stage 3/8 · Task.Result Deadlock · ⚡ LEG · Day-5 Review (3rd time)`
- Q / A / IRL 展示同之前
- 评分后点 `Hard` · 屏幕底部弹 **Leech 警报条**（琥珀色 · 不红 · 非错误）：
  - `⚠️ Leech detected: Hard ×2 in a row`
  - 小字：`This card seems tough. Want to:`
  - 3 个选项按钮（outline · 12pt）：
    - `[ Pause 3 days ]`（暂停复习 3 天 · FSRS 把它移到后 3 天之后）
    - `[ Reset to Fundamental ]`（**重置回初学卡** · 从 🎓 降回 🪙 · 5/5 进度归 0 · 需要二次确认）
    - `[ Keep trying ]`（默认 · 下次 Day-7 再来）
- 关卡数字更新：Stage 3/8 · 进度条跳到 4/8
- 下方路线缩略：剩余 5 关

**🧠 设计反思 #4**（核心）：**Leech 警报的触发条件 + 选项设计**——这是 SRS 产品的死亡区，传统 Anki 用户不会自己管理 Leech
- 触发阈值决议：当前"连续 2 次 Hard"——是否过早？Anki 默认是 8 次 Again
- "Reset to Fundamental" 即 **卡片进度丢回初学卡**——这是用户 B 用例的关键路径（见 §6d）· 需要：
  1. 二次确认 Modal：`Are you sure? This clears all progress (🎓 → 🪙 · Mastery resets).`
  2. Library 里该卡徽章要能显现"曾经被重置"的标记（例如 ⟳ 或淡出一半）——避免用户日后困惑
- "Pause 3 days" 不能无限续——设 max 2 次 · 第 3 次强制二选一

### 6c.6 D5-Library · Day-5 结束 · Library 28/115 · 3 列布局实战检验

**场景**：Day-5 结束 · 小张点 Library · 现在有 28 张实卡 + 1 张 Task.Result 💎（但 Leech 标记 ⚠️ 小徽）
**情绪**：收集癖强化 · "快赶上 30 张了"

**关键元素**（Parchment 主题 · 3 列 + 16pt gutter · 10 行可见实卡 · 全部按 v5.2 规范）：
- Header：`Library · C#/.NET ▾ · 28 / 115 collected · 24.3%` + Bronze 🥉 徽章
- 进度条 24.3%（过了 Bronze 20% 门槛的金色标记留在进度条上）
- 过滤 chips + 新增一个 `[ ⚠️ Leech ]` outline chip（数量为 1）
- **3 列卡片网格第 1 屏（9 张）** · 按 Rarity 倒序默认排：
  - 第 1 行：2 张 LEG（Task.Result Deadlock 💎 带 ⚠️ · AsNoTracking 🎓 1/5）+ 1 张 RAR（N+1 Query 🎓 2/5）
  - 第 2 行：3 张 RAR（DI Lifetimes 🎓 2/5 · JWT Auth 🎓 1/5 · 新抽 Middleware Pipeline 🎓 1/5）
  - 第 3 行：3 张 COM（yield return 🎓 2/5 · IEnumerable vs IQueryable 🎓 1/5 · Dictionary vs List 🎓 1/5）
- 滚动后第 4-10 行：剩余 19 张 COM + 大量雾化位
- 底部 5-tab：Library active

**🧠 设计反思 #5**：当收集数到 28 张，Library 3 列布局第一屏看起来**开始像样**（9 张实卡 vs 115 总数）——设计方向验证成功
- 如果仍然是 2 列，第一屏 4 张，**28/115 的视觉反馈远不如 3 列**
- PM 决议确认：v5.2 回退 3 列 = 正确

### 6c.7 D6-ChillMode · Day-6 · 时间紧只学 2 张 · Defer 4 张到 Day-7

**场景**：Day-6 是周日晚上 · 小张只有 3 分钟 · FSRS 排了 6 张回流 · 点 Home 上的 **密度选择器**（在 Plan 卡下方）· 选 Chill（1 张）· 但想着"都到这了"学了 2 张就停
**情绪**：疲惫但不想断 streak

**关键元素**（Parchment 主题 · Chill 模式 · D2-01 变体）：
- Header：`📖 常规模式 · C#/.NET · Day 6`
- 问候：`Quick session? · streak 🔥 6 → 🔥 7 incoming tomorrow`
- **密度选择器**（新增 · 按 §10 Home 变体规范从"Variant"提为主流程组件 · 可在 Settlement 后再调整）：
  - `[ Chill · 1-2 ]` `[ Normal · 3-5 ]`（默认） `[ Intense · 6+ ]` 三段式
  - 当前选中：Chill（紫色填色）
- Plan 卡简化态：进度不变 · 提示 `4 cards deferred to tomorrow · no penalty`
- 今日路线卡：`2 / 6 cards · 6 total (4 will defer)`
- 主 CTA：`[ Start · 2 cards ]`
- 学完 2 关后直接到简化 Settlement：`2 reviewed · 4 tomorrow · streak 🔥 6 saved`
- 无 Mental Ledger（太短 · 跳过）
- FSRS 回流预告 banner：`⏰ Tomorrow · 10 cards return (6 scheduled + 4 deferred)`

**🧠 设计反思 #6**（核心）：**Defer 机制的风险**——用户每天 Chill 模式 Defer · 积压会炸
- 当前设计：允许无限 Defer · 今天 Defer 4 + 明天正常 6 + 后天正常 6 + 后天 Defer 3 = Day-8 有 19 张要学
- 风险：用户看到 19 张弹窗"10 cards to review" 直接 bounce
- 备选机制：
  - **Defer 上限**：单日 Defer 最多 3 张（超了强制至少学 2 张）
  - **Defer Debt 提示**：Plan 卡变红（琥珀）· 显示"🔸 You have 7 cards deferred · try to catch up tomorrow"
  - **自动 Chill 升级**：Defer Debt > 10 时，Chill 模式自动强制至少 3 张（防止用户钻空子）
- v5.2 暂定：Defer 上限 3/天 · 累计 Debt 展示在 Plan 卡 · PM 下一轮决议具体数字

### 6c.8 D7-Bronze-WeekSummary · Day-7 · 完成 10 关 + 命中 🔥 7-day Streak 奖励 + 周总结

**场景**：Day-7 小张冲刺 · 完成 10 关回流 · 再花最后 1 次 free pull 抽 10 连（增 10 COM · 6 张已在 Library 的重复 → Dup pity 机制触发 · 实际只新增 4 张 → 32/115）
等等回去核对算术：Day-7 起始 28 · 学 10 张回流（大部分已在 Library 内 · 推进进度，不增加 Collected）· Draw 10 中假设 4 张新（因为 115 池已抽 28 · 剩 87 · 10 连重复率按池覆盖 28/115 ≈ 24% · 所以 10 连里大概 2-3 张重复）→ 实际新增约 7-8 张 → **36-37/115 ≈ 32%**
**简化为**：Day-7 结束 Collected = **37/115 · 32.2%**
**情绪**：一周第一次循环完整落幕

**关键元素**（Parchment 主题 · 特殊"周总结"页 · Settlement 之后触发 · 自动弹出）：
- 全屏顶部：金色大字 `🏆 Week 1 Complete`
- 副标：`streak 🔥 7 days unlocked · Earned the 7-Day Badge`
- **周数据摘要卡**（大卡 · Plan 卡变体 · 更丰富）：
  - Pool progress：`37/115 · 32.2% · +27 this week 📈`
  - Mastered：`2 cards 💎 · 24 cards 🎓 · 11 cards 🪙 (drawn not yet learned)`
  - Total time：`1h 48m across 7 days · avg 15m/day`
  - Streak：`🔥 7-day streak · Best session: Day-5 weekend (18 min · 8 cards)`
  - Milestones：
    - `🥉 Bronze (20%) ✓ achieved Day-4`
    - `🥈 Silver (50%) · ~30% progress`
- **奖励栏**（金色底）：
  - `🎁 7-day Streak: +5 bonus free pulls`
  - `🎨 New card frame color unlocked: "Bronze Shimmer"`（LEG 金边保留，COM/RAR 可切换）
  - `🎁 Bronze milestone: +3 bonus free pulls (Day-4 已发)`
- 底部 CTA：`[ Continue to Week 2 ]` 金色填色
- 次 CTA：`[ Share my progress ]`（outline · 社交外链 · v1 可灰态）
- 次 CTA：`[ View full plan ▸ ]`

**🧠 设计反思 #7**（核心）：**周总结页 = 留存关键**——第一次走完 7 天的用户这里要感受到"完整闭环"
- 是否需要**独立 artboard**？v5.2 定 → 是，`D7-WeekSummary` 作为第 8 张 §6c 画面
- 是否需要"分享进度"？v1 不需要具体功能，但 CTA 占位预留给 v2
- streak 🔥 7 之后的**第 2 周激励**：是否在 Day-8 开头弹"Week 2 begins"？——v5.2 暂不做，避免过度仪式化
- Bronze Shimmer 等外观奖励：是**第一次把外观解锁带入 PRD**——PM 下一轮决议是否做

### 6c.9 §6c 数据连续性校验表

| 字段 | Day-3 | Day-4 | Day-5 | Day-6 | Day-7 |
|----|----|----|----|----|----|
| Collected | 18/115 | 28/115（Draw 新增 10） | 28/115 | 28/115（4 defer） | 37/115（Draw 新增 +7 有效）|
| % | 15.7 | **24.3** 🥉 Bronze | 24.3 | 24.3 | **32.2** |
| Mastered | 0 | 0 | 1（Task.Result） | 1 | 2 |
| 今日学习 | 3 回流 | 5 回流 + 0 new (新抽待 D5) | 8 回流 | 2 学 + 4 defer | 10 回流 + 10 new |
| streak | 🔥 3 | 🔥 4 | 🔥 5 | 🔥 6 | **🔥 7** 奖励 |
| Free Pull | 2 | 1（花 1）+ 3 Bronze 奖励 = 4 | 4 | 4 | 0（花 4 抽 40 连？ **不** · 见下） |
| 里程碑 | — | 🥉 Bronze | — | — | 🏆 Week 1 Complete |
| Leech | — | — | Task.Result 预警 | — | — |

**Free Pull 修正**：Day-7 开头 4 张 free pull · 用户花 1 次 Draw 10 连（剩 3）· Week 1 Complete 奖励 +5 → 共 **8 free pulls** 进入 Day-8。v5.2 脚本简化为 "Day-7 花 1 张 free pull 维持节奏感"。

### 6c.10 §6c 画图交付

**本节新增 artboard 编号**：D3-01 Home · D3-02 Stage-Mastered · D4-01 DrawAgain-Bronze 仪式 · D5-01 Leech 警报 · D5-02 Library 28/115 · D6-01 Chill 模式 · D7-01 WeekSummary

合计 **7 张** 追加 · 加 §6 的 12 + §6b 的 7 + §10 的 3 = **29 张**（若含 §6d 的 User B 8 张则总 37 张 · 具体见 §11）

---

## 6d. User B · 7 天极端用例 Journey · 6 屏（v5.2 新增 · 漏复习 / 断 streak / 卡片降级）

> **目的**：User A 是"标准乖用户"——每天都来、每次都认真评分。但真实用户会：
> - Day-2 完全忘了 app 的存在（不打开）
> - 连续几天只开 2 秒就退出
> - 把同一张卡评 Again 5 次（结果：卡片降级回 🪙 或进 Leech）
> - 在 Day-5 回来时一次性看到 15 张积压卡，直接 bounce
> - 周中断 streak 后，要不要复燃提示？什么时候问用户"要不要放弃这卡"？
>
> **User B 画像 · 小王**：
> - 工作 5 年后端 · 本身会一些 C# 但想系统复习
> - 使用动机比小张低（只是"朋友推荐试试"）
> - 生活忙 · 没形成每日习惯
>
> **为什么 Design 要画 User B**：暴露**所有非标准路径** UI 状态 · Claude Design 只画 Day-1 / Day-2 常态，极端用例产品就会在真实上线后碎。

### 6d.1 User B 7 天数字脚本

| 日期 | 开 app? | 做了什么 | 积压队列 | Collected | streak | Leech | 核心情绪 |
|----|----|----|----|----|----|----|----|
| Day-1 | ✅ 12 分钟 | 完整流程（与 §6 同），但 Daily Dose 选 **1 张**（Chill 首次） · 抽 10 连得 0 LEG + 2 RAR + 8 COM · Q4 Interface vs Abstract 评 Again · 学完 1 关 | 0 | 10/115 | 🔥 1 | — | 好奇但谨慎 |
| Day-2 | ❌ 完全没开 | — | 0 | 10/115 | 🔥 0（**断了**）| — | — |
| Day-3 | ✅ 打开 10 秒 | 看到 `Welcome back · streak broken` 失落横幅 · 2 张积压回流 · 退出 | 2 | 10/115 | 🔥 0 | — | 焦虑 + 回避 |
| Day-4 | ❌ 没开 | — | 3（+1 回流） | 10/115 | 🔥 0 | — | — |
| Day-5 | ✅ 18 分钟 | 强迫自己回来 · 看到 `5 cards backlog` · 一口气学完（3 张 Again + 2 张 Hard · 很糟糕） · 其中 Interface vs Abstract **累计 3 次 Again** → 触发 **降级 · 🎓 → 🪙（回初学卡）** | 5 → 0 | 10/115 | 🔥 1（重开） | 1 | 挫败 + 犹豫 |
| Day-6 | ✅ 6 分钟 | 2 张积压 + 1 张重置后的 Interface vs Abstract（从初学卡重新回来，像首次遇到）· 全 Good | 3 → 0 | 10/115 | 🔥 2 | 0 | 缓和 |
| Day-7 | ✅ 8 分钟 | 3 张回流 · 全 Good · 没抽新 · Plan 卡显示"距 Bronze 还差 13 张"但情绪平稳 | 0 | 10/115 | 🔥 3 | 0 | 略积极 |

**7 天净结果**：User B 仅收集 10 张（与 User A 的 37 张对比）· 学会 10 张（累计 3-4 次 Again/Hard，信心打折）· 没命中 Bronze · streak 断过一次

### 6d.2 UB-D1 · Day-1 首日 Chill 选 1 张 · 首次 Again 体验

**场景**：小王在 Daily Dose 选 1 张（最小档）· 学 `Interface vs Abstract` 评 Again
**情绪**：怕学多 · 怕记不住

**关键元素**（Parchment 主题 · 与 §6 Screen 05 同规范但选 1）：
- Daily Dose 选择器：`1` 选中（紫填 · `Starter · 1 minute`）· `3` `5` `All` outline
- 选中后缩略：`1 · Interface vs Abstract ⚪`
- 主 CTA：`[ Start · 1 card ]`

**评分 Again 后的 Settlement**：
- GradeMixBar：`Again (1) · Hard (0) · Good (0) · Easy (0)`
- 文案：`1 reviewed · 0 learned · 1 will return tomorrow 🔁`
- FSRS 预告：`⏰ Tomorrow · Interface vs Abstract returns (you rated Again)`
- Day-1 奖励：**1 free pull**（不是 3 · 因为只学 1 关）
- 情绪处理：不显示失败感 · 底部温和文案：`First time seeing it is the hardest. It'll come back tomorrow.`

**🧠 设计反思 #8**：Chill 首日只学 1 张 · **Day-1 奖励是否应该也只给 1 free pull**？
- 当前设计：Day-1 奖励 = 完成关卡数（1/3/5/All → 1/3/5/10 free pull）
- 风险：鼓励用户选 All · 但用户自己选 1 的意图就是"我想慢"· 奖励缩水有"惩罚慢用户"嫌疑
- 备选：**Day-1 奖励固定 3 free pulls**（不论选几）· 鼓励新手建立心智账本不焦虑
- v5.2 暂定：**跟关卡数** · 但明确让 Design 把 Settlement 文案写温和（如本例"First time seeing it is the hardest"）

### 6d.3 UB-D2 · Day-2 没开（无 artboard · 静默设计反思）

**Design 不画** · 但产品需要决议：
- **推送通知**：Day-2 用户没开 · 下午 6:00 发推送：`🔔 2 cards waiting · Your streak is alive · 2 minutes`
- **推送文案 A/B**：
  - 激励版：`Day 2 is when habits form. 3 min to keep streak 🔥 1.`
  - 软版：`Hi 小王, 2 cards ready whenever you are.`
- v5.2 推送文案由 PM+Content 决议 · Design 不需要画

### 6d.4 UB-D3-Home · 断 streak 后首页（失落感处理）

**场景**：Day-3 中午 11:47 小王打开 app · streak 断了 · 界面该怎么接住他？
**情绪**：愧疚 · 可能直接 bounce · 心理阈值高

**关键元素**（Parchment 主题 · Day-3 特殊态 · 与 D2-01 有差异）：
- Header：`📖 C#/.NET · Day 3`（**去掉 `常规模式` 标签避免压力**）
- **顶部橙黄色软横幅**（不用红！不用琥珀警告！· 柔和 `#E8B85A` 10% 不透明度底）：
  - 大字：`Welcome back, 小王`
  - 副字：`Your streak reset to 🔥 0 · No pressure · Let's rebuild together`
  - 右侧小插画（简单 · 可选）：一根刚点燃的蜡烛 · 不要火焰图
- **📋 MY PLAN 卡**（状态降级为"rebuilding"模式）：
  - Pool progress：`10/115 · 8.7%`（不显示"0 new"让他觉得失败）
  - This week 柱图：Day-1 ✓ · Day-2 灰柱（**不显示 × 或 skipped 字样**）· Day-3 今日活跃进行中
  - Goal 行：`🎯 Take it one card at a time`（**去掉"还需 X 天达成 Bronze"**的倒计时 · 不给压力）
  - 底部：`[ View full plan ▸ ]`
- 今日路线卡（**review-only · 2 张**）：
  - 标题：`Today · 2 review cards · no rush`
  - 缩略：`Task.Result Deadlock ⚡ (first seen Day-1)` + `DI Lifetimes 🔷`
  - 副文：`~3 min · 2 cards total`
- 池 pill：`C#/.NET · Pity 0/10 · Collected 10/115`
- 重学区：空
- 主 CTA：`[ Start · 2 cards ]` 金色填色
- 次 CTA：`[ Save for tonight ]` outline（直接退出 · 预约晚上推送）
- 底部 5-tab：Home active

**🧠 设计反思 #9**（核心）：**断 streak 后的 UX = 决定留存的分水岭**
- **不要大写 "STREAK LOST"**——这是失败者感受的传统设计错误
- 核心原则：**rebuild · 不焦虑**
- streak 🔥 0 的展示：只在上次 streak 文案里提一次，后续页面不再强调
- Goal 行去 deadline 是关键——连续错过会把 Plan 卡变成"债主"
- 若用户 Day-3 选 `Save for tonight` 退出 → 晚上 9:00 发温和推送：`🔔 Still time tonight · 2 cards · 3 minutes`

### 6d.5 UB-D5-Backlog · Day-5 积压 5 张 · Backlog Warning

**场景**：Day-5 下午小王回到 app · 积压 5 张（Day-3 未完的 2 + Day-4 漏的 1 + 今日新回流 2 · 简化模型）· 首页弹"Backlog Mode"提示
**情绪**：压力大 · 想逃

**关键元素**（Parchment 主题 · Home 变态 · 含 Backlog banner）：
- Header：`📖 C#/.NET · Day 5`
- 大字：`5 cards backlog · let's clear them`
- **Backlog 提示卡**（橙黄软色 · 非红）：
  - `⚠️ 5 cards waiting: 2 from Day-3 · 1 from Day-4 · 2 today`
  - 小字：`Split them? Learn 3 now, skip 2 to tomorrow (no penalty)`
  - 3 个选项按钮：
    - `[ All 5 · ~8 min ]`（紫填选中 · 默认）
    - `[ Split · 3 now + 2 tomorrow ]`（outline）
    - `[ Snooze · all tomorrow ]`（outline · 灰态 · 但可点 · 会弹二次确认）
- Plan 卡依然显示 `10/115 · 8.7% · streak 🔥 1 rebuilding`
- 主 CTA：`[ Start · 5 cards ]`
- 底部 5-tab：Home active

**🧠 设计反思 #10**（核心）：**Backlog 处理机制**——必须给"分批清"的逃生通道
- "Split" 是第二次 Defer（Day-6 会再变 Backlog · 但已给用户控制感）
- "Snooze all" 必须限制：连续 Snooze 2 天后**强制至少学 2 张**才能继续 Snooze · 否则用户永远不学，堆到 Day-30 积压 20 张直接删 app
- 二次确认文案：`Snoozing means 5 cards → 7+ cards tomorrow. Sure?`
- Backlog warning 不会在用户选 `Split` / `Snooze` 后消失 · 下次打开还在 · 直到 backlog 清零

### 6d.6 UB-D5-Demote · Interface vs Abstract 降级 → 🪙（回初学卡）

**场景**：小王在 Stage 4/5（Interface vs Abstract · 第 3 次看）又评 Again · 累计 **3 次 Again** · 触发 **降级机制**
**情绪**：挫败 · "是不是我笨"

**关键元素**（Parchment 主题 · 单关评分后 · 降级通告页）：
- 关卡 Header：`Stage 4/5 · Interface vs Abstract · ⚪ COM · Day-5 Review (3rd time)`
- 评分 `Again` 后 · 全屏中心升起**降级 Modal**：
  - 顶部图标：🪙 → 🎓 反向箭头（柔和 · 不是红色警告图）
  - 大字：`Let's start this one over`
  - 中号字：`Interface vs Abstract has been reset to "not yet learned" (🎓 → 🪙)`
  - 副字：`You'll see it fresh tomorrow like a new card. No rush, no streak penalty.`
  - **进度变化**：`Mastery: 1/5 → 0/5` · 小横条从 20% 回到 0
  - **Library 标记变化**：`Library will show ⚠️ reset badge (small corner mark)`
  - 按钮：`[ OK · Continue ]` 金色填色（单按钮 · 强制用户接受）
- 关闭 Modal 后回到关卡进度 · Stage 4/5 改为 Stage 4/5 ✓（视为完成 · 但不算 mastery）

**🧠 设计反思 #11**（核心 · 与 §6c.5 Leech 呼应）：**降级机制的产品语义**
- 降级 = **从 🎓 Learned 回 🪙 Drawn-but-not-learned** · 用户理解度：中等 · 需要在 Library 卡徽章上体现
- 关键 UX 原则：**不让用户觉得"白学了"**——副字 "You'll see it fresh tomorrow" 是核心
- 文案严禁：`Demoted / Failed / Lost progress` · 这些会让用户打负面标签
- **"重置回初学卡"** 本质上是数据层：`Card.state = InReview → New · Card.reps = 0 · Card.lapses += 1`
- Design 工作：只需要画这一张 Modal · FE 实现时触发条件交后端

### 6d.7 UB-D5-Library-Reset · 降级后的 Library 状态

**场景**：Day-5 结束 · 小王进 Library 看收藏（带着一丝希望 · "我是不是还有进步"）
**情绪**：既沮丧又好奇

**关键元素**（Parchment 主题 · 3 列布局 · 10 张实卡）：
- Header：`Library · C#/.NET ▾ · 10 / 115 collected · 8.7%`（**Collected 数量没变**——被降级的卡还在图鉴里）
- 进度条 8.7%（无变化）
- 过滤 chips：`[ All ]` 选中 · 额外 outline chip `[ ⚠️ Reset (1) ]` 出现（新加 chip）
- **3 列网格 · 10 张实卡 + 2 张雾化（第 4 行补空）**：
  - 第 1 行：3 张 LEG/RAR（Task.Result 🎓 · DI Lifetimes 🎓 · N+1 Query 🎓）
  - 第 2 行：3 张 RAR（JWT Auth 🎓 · Middleware Pipeline 🎓 · AsNoTracking 🪙）
  - 第 3 行：3 张 COM：
    - 左：`⚪ COM · 🪙 0/5 · OOP · Interface vs Abstract · ⭐⭐⭐ · **⟳ 重置徽章**` · 卡框边缘带浅灰虚线感（传达"不是全新·是重置"）
    - 中：`⚪ COM · 🎓 1/5 · LINQ · IEnumerable vs IQueryable · ⭐⭐⭐`
    - 右：`⚪ COM · 🎓 1/5 · PERFORMANCE · yield return · ⭐⭐⭐`
  - 第 4 行：`⚪ COM · 🎓 1/5 · LINQ · Dictionary vs List · ⭐⭐⭐` + 2 张雾化位
- 底部 5-tab：Library active

**⟳ 重置徽章规范**（v5.2 新增 · §3 组件追加）：
- 位置：卡片左下角（池名位置上方 8pt） · **不覆盖 rarity 边框**
- 图标：`⟳` 反向箭头（SF Symbols 或 emoji · 13pt）
- 颜色：`#8C7A5B`（中性灰金色 · 不红不橙 · 不报警）
- accessibilityLabel：`"Previously reset to fundamental · progress 0/5"`

### 6d.8 UB-D7-GentleReturn · Day-7 温和回归首页

**场景**：Day-7 下午小王稳住节奏 · 过去 3 天都来 · streak 🔥 3
**情绪**：回稳 · 微小成就感

**关键元素**（Parchment 主题 · Home Day-7 · 与 User A D7 差异大）：
- Header：`📖 常规模式 · C#/.NET · Day 7`（**恢复"常规模式"标签** · 表明已不在断 streak 态）
- 大字：`streak 🔥 3 rebuilt · nice work`
- **📋 MY PLAN 卡**（User B 专属 · goal 重新校准）：
  - Pool progress：`10/115 · 8.7%`（7 天零增长）
  - This week 柱图：D1✓ D2灰 D3✓（2 张） D4灰 D5✓（3张评分差） D6✓ D7进行中
  - Goal：`🎯 Steady pace beats perfect · keep showing up`
  - `[ View full plan ▸ ]`
- 今日路线卡：`Today · 3 review cards · ~5 min`
- 池 pill：`C#/.NET · Pity 0/10 · Collected 10/115`
- 重学区：`1 card reset earlier · Interface vs Abstract will reappear soon` · 右侧 outline `[ View ]`
- 主 CTA：`[ Start · 3 cards ]`
- 次 CTA：`[ Draw again · 10 pulls ]` outline
- 底部 5-tab：Home active

**⚠️ Plan 卡的重要差异**（vs User A D7-WeekSummary）：
- User A Day-7：Week 1 Complete 金光仪式 · Bronze 达成 · +5 streak reward
- User B Day-7：**不触发周总结仪式**（条件：一周内 ≥ 6 天活跃才触发）· Plan 卡就是温和汇报
- 理由：**"勉强完成的一周"给仪式会失真** · 真实成就感要等用户 Week 2 真的 6/7 活跃再给

**🧠 设计反思 #12**（核心）：**周总结仪式的触发条件**
- 建议：活跃天数 ≥ 6/7 = 触发仪式 · 否则 Home 只是 Plan 卡温和汇报（本画面）
- 4/7 或更少：Plan 卡甚至可以弹一个 "Let's aim for 5 days next week" 的软目标引导
- v5.2 PM 暂定：**≥ 6/7 活跃触发**周总结仪式 · 否则 plain Home 收尾

### 6d.9 §6d 画图交付

**本节新增 artboard 编号**：UB-D1-01 Daily Dose Chill 首次 Again · UB-D3-01 断 streak 首页 · UB-D5-01 Backlog Mode · UB-D5-02 降级 Modal · UB-D5-03 Library 含 ⟳ · UB-D7-01 温和回归首页

合计 **6 张** 追加（UB-D2 / UB-D4 / UB-D6 无 artboard · 静默反思）· 加前面的 29 = **35 张** artboard 总交付

### 6d.10 User B 数据连续性校验表

| 字段 | D1 | D2 | D3 | D4 | D5 | D6 | D7 |
|----|----|----|----|----|----|----|----|
| 开 app | ✅ 12m | ❌ | ✅ 10s | ❌ | ✅ 18m | ✅ 6m | ✅ 8m |
| Collected | 10/115 | — | 10/115 | — | 10/115 | 10/115 | 10/115 |
| streak | 🔥 1 | 🔥 0（断） | 🔥 0 | 🔥 0 | 🔥 1（重开） | 🔥 2 | 🔥 3 |
| 积压 backlog | 0 | 1 | 2（退出未学） | 3 | 5 → 0（清） | 3 → 0 | 3 → 0 |
| Leech / Reset | 0 | — | — | — | **Interface vs Abstract reset** 1 | 0 | 0 |
| Free Pull | 1（Chill 1 关） | 1 | 1 | 1 | 1 | 1 | 1 |
| 情绪锚点 | 好奇 | — | 愧疚 | — | 挫败 | 缓和 | 微成就 |

---

## 6e. 7 用户 30 天模拟 + 双池上线事件（v5.3 新增）

> **目的**：§6 / §6b / §6c / §6d 把 User A + User B 两个极端打满 7 天，但 **真实留存曲线是一个月** 才看得清。v5.3 引入 **A-G 共 7 位用户** · 模拟 30 天 · 并在 **Day-15 加入 AWS SAA 第二池** · 暴露多池 UX 所有盲点。
>
> **不要求 Design 画 30 × 7 = 210 张 artboard** · 只画 6 张关键**多池新场景画面**：
> - **E1** · Pool Launch Modal（Day-15 首次打开）
> - **E2** · Multi-pool Plan 卡（Home · 两池并排）
> - **E3** · Library 顶部 Pool Switcher（从 `C#/.NET` 切到 `AWS SAA`）
> - **E4** · Pool Picker Sheet v2（选池 + "learning in both" 开关）
> - **E5** · "Nothing to Learn" 空态（User C 老李 Day-10 全学完的 UI）
> - **E6** · Month 30 · Summary 页（带双池进度 + streak 月章）
>
> 另含 1 张可选：**E7** · Churn Re-engagement 推送 Landing（User B Day-21 重新打开的唤回首页）

### 6e.1 用户花名册 + 月末预测

| # | 用户 | 画像 | 行为标签 | 池策略 | Day-30 预测 | 备注 |
|----|----|----|----|----|----|----|
| A | **小张** | 2 年 .NET · 备考 AWS | 标准用户（已建 §6c） | Day-15 → 双池 | C# 63/115（55%）· AWS 14/60（23%）· streak 🔥 30 · Silver 🥈 | 最接近目标画像 |
| B | **小王** | 5 年后端 · 兴趣低 | 漏复习 · 已建 §6d | **只 C#** · Day-16 拒绝 AWS | C# 12/115（10.4%）· Day-21 流失 · 需要 Day-24 Re-engagement 推送 | Churn 样本 |
| C | **老李** | 10 年资深 · "复习一下" | **速通型**（Easy 占 70%） | Day-10 C# 全抽完 · Day-15 立即切 AWS | C# 115/115（83 Mastered）· AWS 45/60 | "Nothing to Learn" 空态触发 |
| D | **小陈** | 应届生 · 胆怯 | **只敢 Fundamental 卡**（Junior Audience） | 一直 **只 C#** | C# 38/115（33%）· 但 5 张 Leech · Master 仅 15 张 | Audience Filter 缺口 |
| E | **小林** | 外企 PM · 周末型 | **Weekend Warrior**（周末 30 卡 binge） | Day-15 → 双池（周末起） | C# 28/115（24%）· AWS 12/60 · streak 反复 🔥 2 → 🔥 0 | streak 救济缺口 |
| F | **小刘** | 地铁通勤 · 短会话 | **推送驱动**（日 3 次 × 3-5 min） | Day-15 → 双池 · Day-22 禁用 AWS 推送 | C# 42/115（37%）· AWS 10/60 · 推送疲劳 | 多池推送频次 |
| G | **小赵** | 技术经理 · 囤积 | **囤奖励**（Free Pull 30+ 不花） | Day-15 → 双池（立即 Draw 10 连） | C# 80/115（70%）· AWS 33/60（55%）· Day-28 Gold 🥇 触发 | Free Pull 过期缺口 |

### 6e.2 Day-15 双池上线事件时间轴（全员共同）

**Day-14 夜 21:00**（推送）
- 文案：`🎉 New pool tomorrow · AWS Solutions Architect (60 cards) · tap to preview`
- 点击 → 进入**预览页**（静态 scrollable · 显示 AWS pool 的 14 tag 色条 + 5 张雾化示例卡）
- 不可立即开抽（Day-15 0:00 才解锁）

**Day-15 00:00 +**（首次打开）
- **E1 · Pool Launch Modal** 弹层（见 §6e.3）
- 3 选项：`[ Explore AWS now ]` / `[ Try both pools ]`（推荐）/ `[ Stay with C# ]`
- 选择后 **落位到对应 Home**

**Day-15 之后**（每次打开）
- Home 顶部多一个 **Pool 切换 pill**：`C# · AWS`（如果选了双池）
- Library 顶部 segmented：`C#/.NET | AWS SAA`
- Plan 卡变为 **E2 · 双池版**（两池并排进度条）
- Settings 里新增 `Notifications · per-pool` 开关

### 6e.3 E1 · Pool Launch Modal · Day-15 首次打开全屏（Design 画面）

**场景**：任何用户 Day-15 首次打开 app · 全屏 Modal · 不可 dismiss outside（必须选一个）
**情绪**：好奇 + 轻微选择焦虑

**关键元素**（Parchment 主题 · 特殊首次态 · 顶部金光粒子 800ms 欢迎动画）：
- 顶部图标：双池交叠图标（C# 紫卡 + AWS 橙卡 · 叠放 · 金光边）
- 大字 Gold Serif：`A new pool is here`
- 中字：`AWS Solutions Architect · 60 cards`
- 副字 13pt：`Cloud architecture · IAM · VPC · EC2 · S3 · DynamoDB · 更多`
- 三段式预览（3 张示例 RAR/COM/LEG 雾化卡 · 带橙色 Tag 色条）
- **3 个 CTA**（纵向排列 · 48pt 高）：
  - `[ Explore AWS now ]` 金色填色（点 → 落位 AWS Home · 自动激活 AWS 池）
  - `[ Try both pools ]` 紫色填色 · 下方 12pt 副字 `Recommended · keep C# progress`（点 → 双池模式）
  - `[ Stay with C# only ]` outline · 下方副字 `You can switch anytime`
- 底部脚注 11pt：`Your C#/.NET progress is safe. Pool Picker is in the top-left menu.`

**关键 UX 决议**：
- **不** 设"暂不选择" option（强制 Day-15 明确表态 · 避免沉默流失）
- **不** 把"Try both pools"设为默认选中项（避免过载犹豫用户）· 而是用**视觉次重**区分（金 > 紫 > outline）
- Day-15 之前的 Daily Dose 是 Day-1 专属 · **AWS 激活后 Day-1 也会有自己的 Daily Dose**（详见 §13 决议 #12）

**7 用户在 E1 的选择分布**：

| 用户 | 选择 | 原因 |
|----|----|----|
| A 小张 | Try both | 备考 AWS · 主 motivation 就在这 |
| B 小王 | Stay with C# only | 已经有 5 张积压 · 不敢再添负担 |
| C 老李 | Try both | 其实想点 Explore AWS · 但怕弄丢 C# 进度 · 保险起见选双 |
| D 小陈 | Stay with C# only | "C# 都没学明白 · AWS 太远" |
| E 小林 | Try both | 周末型用户 · 时间自认为够双池 |
| F 小刘 | Try both | 推送来什么学什么 · 多一个池 = 多的通勤内容 |
| G 小赵 | Explore AWS now | 速通型 · 急于抽新卡 |

### 6e.4 E2 · Multi-pool Plan 卡（Home · 两池并排）

**场景**：Day-15 之后 · 选了双池的用户（A / C / E / F / G）的 Home Plan 卡
**情绪**：进度感倍增 + 信息密度注意力

**关键元素**（Parchment 主题 · Plan 卡从 §3.7 单池版扩展）：
- Header：`📋 MY PLAN · 2 pools active`
- **双池分段**（同卡内上下 2 行 · 中间 8pt 浅线分隔）：
  - 行 1 · C#/.NET：`▓▓▓▓▓▓▒▒▒▒▒▒▒▒ 37/115 · 32%` · Tag 小色条 · streak 🔥 7
  - 行 2 · AWS SAA：`▓▒▒▒▒▒▒▒▒▒▒▒▒▒  2/60  · 3%` · Tag 小色条 · NEW 🆕
- 共享区（两池下方）：
  - This week 柱图（**两种颜色堆叠**：C# 紫 + AWS 橙 · 每根柱子可见分拆）
  - Goal：`🎯 C# Silver 50% in 12d · AWS Bronze 20% in 20d`（**两个目标并列**，不堆叠在一起）
  - 底部链接：`[ Switch pool ▸ ]` · `[ View full plan ▸ ]`
- **重要视觉层级**：
  - 当前"今日学习哪个池"的那一行 **背景微高亮**（`#F3E8C8` 填色）
  - 未活跃池 行 **正常背景**

**7 用户在 E2 卡的具体差异**：

| 用户 | Plan 卡状态 |
|----|----|
| A Day-20 | C# 50% near 🥈 + AWS 8% · "Silver tomorrow" 高亮 |
| C Day-15 晚 | C# 100% · AWS 5% · C# 行显示"All collected · 58 mastered" · AWS 行高亮 |
| E Day-16 Mon | 两池进度静止 · streak 🔥 1 fade (break incoming Wed) |
| G Day-28 | C# 70% + 🥇 Gold 徽章 · AWS 55% · "🏆 Gold achieved" 小字 |

### 6e.5 E3 · Library 顶部 Pool Switcher（Design 画面）

**场景**：Day-15 之后点底部 Library tab · 顶部新增 segmented Pool Switcher
**情绪**：清晰切换 · 收藏分池

**关键元素**（Parchment 主题 · 在 §11 Library 基础上新增顶部组件）：
- **最顶部新增 segmented**（紧挨 Header 下方 · 48pt 高 · 紫色底 outline 未选 · 紫色填色 选中）：
  - `[ C#/.NET · 37 ]` 选中（紫填）· `[ AWS SAA · 2 ]`（outline · 橙色 NEW 🆕 小徽）
- 下方 Header 按当前池展示：`Library · C#/.NET ▾ · 37 / 115 collected · 32.2%`
- **点右侧 Pool Switcher** → 切到 AWS → Header 改为 `Library · AWS SAA · 2 / 60 collected · 3.3%`
- 3 列卡片网格 + 过滤 chips 不变
- **切换动画**：180ms 水平滑过（两池视作左右 2 个 page · 可 swipe 切换）

**UX 决议 · 为什么顶部 segmented 不是下拉菜单**：
- 下拉菜单隐藏第二池 · 用户容易忘记 AWS 存在
- Segmented 展示两个 chip 永远可见 · **带 Count**（37 / 2）加深心智
- Future-proof：v2 加第三池可能要改 horizontal scroll chip list · 但 v1 两池够用

### 6e.6 各用户 30 天数字脚本

以下表格每 5 天一列 · 简明呈现。详细每日脚本在 v6 PRD 展开。

#### 6e.6.1 User A · 小张 · 标准用户 · 双池 · Day-8 → Day-30

（Day 1-7 已在 §6 + §6b + §6c 完成 · 此处仅 8-30）

| 字段 | D8-10 | D11-14 | **D15 池开** | D16-19 | D20-22 | D23-26 | D27-30 |
|----|----|----|----|----|----|----|----|
| C# Collected | 40-44 | 48-52 | 52 | 53-56 | 57-60 🥈 | 60-62 | 62-63 |
| AWS Collected | 0 | 0 | 2（首抽） | 5-8 | 9-11 | 12-13 | 14 |
| streak | 🔥 8-10 | 🔥 11-14 | 🔥 15 | 🔥 16-19 | 🔥 20-22 | 🔥 23-26 | 🔥 27-30 🏅 |
| Free Pull | 6 | 3 | 3（E1 选 Try both 无消耗） | 1-2 | 3-4 | 2 | 0 |
| 里程碑 | — | — | — | — | **🥈 Silver C# 50%** Day-22 | — | **🏅 30-day streak** Day-30 |

**关键事件**：
- D15 在 E1 选 `Try both` → Home 切到 E2 双池 Plan 卡
- D16 AWS 首次打开触发**AWS 池的 Daily Dose**（✅ 新决议 §13 #12）· 小张选 3 张 Chill
- D22 C# Silver 🥈 仪式触发（同 Bronze 仪式风格 · 银光主题）
- D30 Month Summary 页 · 🏅 30-day streak badge

**🧠 发现的问题**：
- **问题 A1**：Day-16 AWS 首次 Daily Dose · 用户期待类似 Day-1 的仪式？或简化？（§13 #12）
- **问题 A2**：D22 Silver 仪式和 D15 Pool Launch 仪式若隔太近（7 天）会仪式疲劳 → 需要 **仪式冷却期** 机制
- **问题 A3**：双池后 streak 是 global · 但用户可能某天只学 C# 不学 AWS · streak 是否要求"两池都学"？**决议：只要学任一池就续 streak**（见 §13 #1）

#### 6e.6.2 User B · 小王 · 漏复习 + 流失 · 只 C# · Day-8 → Day-30

| 字段 | D8-10 | D11-14 | D15 | D16-20 | **D21 churn** | D22-26 | **D27 唤回推送** | D28-30 |
|----|----|----|----|----|----|----|----|----|
| 开 app | 3/3 天（短） | 2/4 天 | ❌ 忽略 | 2/5 天 | ❌ | ❌ 全部 | ✅ 重开 5min | 2/3 天（试图回来） |
| C# Collected | 10-12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 |
| AWS | — | — | — | — | — | — | — | — |
| streak | 🔥 3-0 反复 | 🔥 0 | — | 🔥 0-2 | 🔥 0 | 🔥 0 | 🔥 0 | 🔥 1-2 |
| 累计 Leech | 1 | 2 | — | 2 | — | — | 2 | 2 |
| 推送响应率 | 60% | 30% | 0%（忽略 Pool Launch 推送） | 25% | 0% | 0% | **100%**（看到"Welcome back · 17 cards waiting · start from scratch?"） | 60% |

**关键事件**：
- D14 小王收到"新池 AWS 预告"推送 · 打开看了一眼就退（觉得压力更大）
- **D15 首次打开后直接选 `Stay with C# only`** · Pool Launch Modal 闭合
- D16-20 小王打开 2 次 · 每次 3 分钟 · 全 Again · 积压堆到 8 张
- **D21 开始完全不开**（流失）
- **D24 推送 1**：`2 cards waiting · streak broken · 2 min rebuild`（忽略）
- **D27 推送 2（唤回型）**：`Hi 小王, your 12 cards are still here. Want a fresh start? 3 min.`（**E7 画面**——见 §6e.10）
- D28 点开 · 直接进入**"Fresh Start Mode"**（见 §13 #10）

**🧠 发现的问题**：
- **问题 B1**：Day-15 Pool Launch 对漏复习用户是**更大压力**——当前 Modal 对 B 不够友好 · 需在 E1 增加"Light mode / No new pool for me" 路径？
- **问题 B2**：D21 流失后 · 当前设计没有明确的"沉默期推送升级"规则——推送频次过高会卸载 app · 过低会永久流失（§13 #11）
- **问题 B3**：D28 打开时看到 12 张卡中 **7-8 张已过 FSRS 最晚节点** · 算法应该把这些卡视作"几乎遗忘"还是"按原计划"？当前 FSRS 的处理不明（§13 #15）

#### 6e.6.3 User C · 老李 · 速通型 · Day-1 → Day-30

| 字段 | D1-3 | D4-6 | D7-9 | **D10 空态** | D11-14 | **D15 切 AWS** | D16-22 | D23-30 |
|----|----|----|----|----|----|----|----|----|
| C# Collected | 35 | 78 | 105 | **115（全抽完）** | 115 | 115 | 115 | 115 |
| C# Mastered | 15 | 42 | 55 | 58 | 65 | 68 | 72 | 83 |
| 每日新抽 | 10-20 | 10-30 | 10 | **0（池空）** | 0 | AWS 10 | AWS 10-20 | AWS 5-10 |
| AWS Collected | — | — | — | — | — | 9 | 35 | 45 |
| streak | 🔥 3 | 🔥 6 | 🔥 9 | 🔥 10 | 🔥 14 | 🔥 15 | 🔥 22 | 🔥 30 🏅 |
| Free Pull | 5-20 囤 | 20-30 囤 | 30 | 30 | **25**（花 5 仍有剩） | 25 | 10-15 | 0-5 |

**关键事件**：
- D10 **全抽完 C# 115 张 · 触发 "Nothing to Learn" 空态**（E5 画面）
  - Home 显示：`🎉 All 115 C# cards collected · 58 mastered · come back tomorrow for reviews`
  - 下方提示：`💤 No new cards to draw · pity reset · want to wait for next pool?`
  - CTA：`[ Review my mastered cards ]` · `[ Save free pulls for next pool ]`
- D15 Pool Launch · 老李在 E1 选 `Try both` · AWS 首天立即 10 连（花 1 free pull）
- D22 AWS 第二次 pity 命中 · 心智账本高亮
- D30 Month Summary 页 · 显示 "All C# collected 🏆" + AWS 75% · streak 🔥 30

**🧠 发现的问题**：
- **问题 C1（核心）**：D10 开始 C# 池空 · 5 天没有新内容 · 如果没有 Day-15 pool launch · 用户会流失——产品需要**"空池 SLA"**：每 7-10 天至少一个新内容事件（新池 / 新卡 / 活动）（§13 #5）
- **问题 C2**：Free Pull 囤到 30 张 · 无消耗压力——当前无过期机制——**建议 60 天过期**（§13 #7）
- **问题 C3**：老李 Mastered 58/115 · 但已全抽完 · **Mastery 进度** 比 Collection 进度更应该成为主 KPI——Plan 卡需要加 Mastery 副进度条（§13 #3）

#### 6e.6.4 User D · 小陈 · 胆怯新手 · 只 C# · Day-1 → Day-30

| 字段 | D1-3 | D4-7 | D8-14 | **D15 跳过** | D16-22 | D23-30 |
|----|----|----|----|----|----|----|
| C# Collected | 13 | 21 | 28 | 28 | 33 | 38 |
| C# Mastered | 3 | 7 | 10 | 11 | 13 | 15 |
| Leech 数 | 1 | 2 | 4 | 4 | 5 | **5 累计** |
| 拒绝卡数 | 1（Advanced Q1） | 2 | 3 | 3 | 4 | **5** |
| streak | 🔥 3 | 🔥 5（D5 断） | 🔥 3 反复 | 🔥 2 | 🔥 6 | 🔥 8（D30 之前断一次） |
| Again 占比 | 40% | 35% | 30% | 28% | 25% | 22% |

**关键事件**：
- D1 Daily Dose 选 3 · **其中 1 张是 DI Lifetimes（MID Audience）** · 小陈评 Again → 从此躲避 RAR 卡
- D5 小陈打开后看到 3 张 RAR 待学 · 直接关 app（回避） · streak 断
- D14 小陈有 5 张 Leech · 全部是 RAR+ · 自己说"我不该学这些"
- **D15 Pool Launch · 小陈选 `Stay with C# only`**（Modal 关闭 · 后续不再弹）
- D20 小陈**发现 Settings 里可以关闭 "Applied" Level 卡** → 但这是 **v1 没做的功能**（问题 D1）
- D30 Month Summary · 小陈进度低但情绪稳

**🧠 发现的问题**：
- **问题 D1（核心）**：**Audience / Level 筛选器缺失**——小陈需要"只学 Junior + Fundamental 卡"的开关 · 当前 v1 无此能力（§13 #6）
- **问题 D2**：5 张 Leech 堆积 · FSRS 会反复重排 · 当前无"永久 bury"机制——**建议 Leech 3 次后 Modal 问"是否 bury 1 周"**（§13 #4）
- **问题 D3**：Collection % 33% · 但 Mastery 只有 15 张 · **Plan 卡 milestone 应该以 Mastery 算**（§13 #3 呼应 User C）

#### 6e.6.5 User E · 小林 · 周末型 · Day-1 → Day-30（跳 5 工作日）

| 字段 | 周 1 Mon-Fri | **周 1 Sat-Sun** | 周 2 Mon-Fri | **周 2 Sat-Sun D13-14** | **D15 Sun** | 周 3 Mon-Fri | **周 3 Sat-Sun** | 周 4 Mon-Sun D22-28 | 周 5 D29-30 |
|----|----|----|----|----|----|----|----|----|----|
| 开 app | Mon ✓ 只 D1 | Sat Sun 各 1h | 全跳 | 周末 binge 40 张 | 周末 second day · 看到 Pool Launch | 全跳 | 周末 binge | 周末 only | 周末 only |
| C# Collected | 10 | 20 | 20 | 24 | 24 | 24 | 27 | 28 | 28 |
| AWS | — | — | — | — | 池上线 E1 选 Try both · 5 张 | 5 | 8 | 11 | 12 |
| streak | 🔥 1 | 🔥 2 → 🔥 0 Mon | 🔥 0 | 🔥 2 → 🔥 0 Mon | 🔥 2 | 🔥 0 | 🔥 2 | 🔥 2 max | 🔥 2 |
| 单会话时长 | — | 60-90 min | — | 90-120 min | 30 min | — | 90 min | 90 min | 60 min |

**关键事件**：
- 小林永远在周末做 30-40 张卡 binge · 工作日因打工累不开 app
- streak 永远在 🔥 2 → 🔥 0 反复
- D13-14 周末 binge 后 streak 断 → D14 晚上收到 `Day 14 · Tomorrow AWS launches` 推送（看到但没点）
- **D15 Sun 周日 E1 选 Try both** · 首次 AWS Daily Dose 选 3 张 · 情绪"试一下也好"
- D15-30 双池 · 但每周仅周末 2 天活跃 · AWS 只到 12 张
- **小林月底 streak 从未达到 🔥 5**

**🧠 发现的问题**：
- **问题 E1（核心）**：**Weekend-only 用户对 streak 系统是"永远的外人"**——streak 每周断 → 情绪受挫——需要**"Weekend streak" 替代方案**：每周 2 天活跃算 1 个 "Week streak 🔥 Wk 1-4"（§13 #2）
- **问题 E2**：Binge 用户单次学 30-40 张 · 会经历 30-40 次 Stage Q → A → IRL 循环——**是否应该给 binge 用户"批量评分" UX**？（例如学 5 张后一次性评分 5 张 · 节省动画时间）（§13 #8）
- **问题 E3**：周末用户工作日推送**全被静音的可能性高**——需要"按用户活跃模式自动调整推送频次"（§13 #11 呼应）

#### 6e.6.6 User F · 小刘 · 推送驱动 · 双池 · Day-1 → Day-30

| 字段 | D1-5 | D6-10 | D11-14 | **D15 AWS** | D16-21 | **D22 关 AWS 推送** | D23-30 |
|----|----|----|----|----|----|----|----|
| 日均开 app | 3 次 | 3 次 | 3 次 | 3 次 | **5 次** 🫠 | 4 次 | 3 次 |
| 单次时长 | 3-5 min | 3-5 min | 3-5 min | 3-5 min | 3-5 min | 3-5 min | 3-5 min |
| C# Collected | 13 | 22 | 30 | 32 | 36 | 40 | 42 |
| AWS | — | — | — | 2 | 5 | 7 | 10 |
| 推送数量 | 3/天 | 3/天 | 3/天 | **6/天**（双池）| **6/天 感到烦** | **3/天**（关 AWS 推送）| 3/天 |
| 推送响应率 | 75% | 70% | 68% | 60% | **45%** ↓ | 70% ↑ | 72% |

**关键事件**：
- D1-14 小刘标准推送节奏 · 每天 12:00 / 18:00 / 21:00 开
- **D15 Pool Launch Modal 在 12:00 通勤时弹** · 小刘选 Try both（觉得"又一个推送源"）
- **D16-21 双池推送叠加** → 日均 6 条推送 → 疲劳
- **D22 小刘去 Settings 关掉 AWS 推送** · 但**不知道怎么找**（问题 F1）
- D23-30 C# 继续 · AWS 只在 Library 看 · 很少主动学

**🧠 发现的问题**：
- **问题 F1（核心）**：**Settings 找不到 per-pool 推送开关**——v1 PRD 说要做 · 但位置不明——**Pool Picker Sheet 底部直接给每个池一个 🔔 开关**（§13 #11）
- **问题 F2**：双池推送疲劳 · 响应率从 75% 降到 45% · 需要**"合并推送"机制**——`3 C# + 2 AWS · 5 cards total today`（§13 #13）
- **问题 F3**：短会话用户每次 3-5 min 学 3 张 · **Daily Dose 默认 3 的设计恰好适配**——但 Daily Dose 只 Day-1 出现 · Day-2 之后 FSRS 排的可能多于 3 张 · **建议短会话用户在 Settings 有"最多每次 3 张"上限**（§13 #9）

#### 6e.6.7 User G · 小赵 · 囤积奖励型 · 双池 · Day-1 → Day-30

| 字段 | D1-5 | D6-10 | D11-14 | **D15 AWS** | D16-22 | **D28 🥇 Gold** | D29-30 |
|----|----|----|----|----|----|----|----|
| C# Collected | 30 | 60 | 78 | 80 | 80 | 80 | 80 |
| C# Mastered | 10 | 25 | 38 | 40 | 50 | **58 (50% Mastered = Gold)** | 60 |
| AWS Collected | — | — | — | 15（首日 10 连 + free pull） | 25 | 30 | 33 |
| Free Pull 存量 | 8 | 15 | 22 | **28** 囤到顶 | 20 | 12 | 10 |
| streak | 🔥 5 | 🔥 10 | 🔥 14 | 🔥 15 | 🔥 22 | 🔥 28 | 🔥 30 🏅 |

**关键事件**：
- D1 选 All（Daily Dose 满档）· Day-1 bonus 10 free pull 到账
- D2-14 每天至少学 5-8 张 · 从不花 free pull · 囤到 28 张
- **D15 AWS 上线** · 小赵**立即用 1 张 free pull 开 10 连** · 得 2 张 RAR + 1 张 LEG + 7 张 COM
- D16-22 双池并进 · free pull 缓慢消耗（每周花 1-2 张）
- **D28 C# Mastered 58/115 = 50% 触发 🥇 Gold 仪式**（**首次出现 · 需画 E6 变体**）
  - 仪式：Cosmic 金光 → 金色纹章 → 奖励 +10 free pull
- D30 Month Summary 页 · 双池双金

**🧠 发现的问题**：
- **问题 G1（核心）**：**Free Pull 无过期 · 小赵囤到 28 张** · 虽然 Day-15 花了 1 张 · 但**心智账本上永远觉得"不用也不丢"**——建议**60 天过期**（§13 #7）· 或者**上限 30 张**（超了不再发放）
- **问题 G2**：🥇 Gold 仪式**首次出现 · 产品没画过**——v5.3 明确要求 Design 画 E6 Month Summary 时在首图区 Banner 承载 Gold 徽章（§13 #16）
- **问题 G3**：囤积型用户在月模拟**贡献高但反馈少**——产品需要**"感谢深度用户"的微情绪设计**（月章 · Mastery Hall · Leaderboard 排名）（§13 #18）

### 6e.7 E4 · Pool Picker Sheet v2（Design 画面）

**场景**：Day-15 之后 · 用户点 Home 顶部的 `Switch pool ▸` 链接 · 或点 PoolPickerSheet · 进入池选择面板
**情绪**：切换明确感 · 多池掌控

**关键元素**（Parchment 主题 · 底部 Sheet 从屏幕下 60% 弹起）：
- Sheet 顶部 drag handle
- 标题：`Pool Picker · Active pools`
- 3 段池卡（**每个池 1 个横长卡** · 高 96pt）：
  - **C#/.NET**（紫色左边框 · 带 `🔷 Active` chip）
    - 右上 🔔 开关 · Active 态
    - 进度小条：`37/115 · 32% · streak 🔥 7`
    - 下行：`Learning in this pool ☑` 复选框
  - **AWS SAA**（橙色左边框 · 带 `🆕 NEW` chip）
    - 右上 🔔 开关（可单独关闭推送）
    - 进度小条：`2/60 · 3.3% · just started`
    - 下行：`Learning in this pool ☑` 复选框
  - **New pool pack · Coming soon**（灰态 · 12pt 副字 `Data Structures · Q2 2026`）
- **关键控件**：
  - 每个池的 `Learning in this pool` 复选框 = 是否放入 FSRS 学习队列 · 取消后只保留 Library 入口
  - 每个池的 🔔 开关 = 独立推送控制（**解决 User F 的 F1 问题**）
- 底部：`[ Apply ]` 金色 CTA + `[ Cancel ]` outline
- 提示条（底部 11pt）：`Paused pools keep their progress safe.`

**关键决议**：
- 允许 **单池暂停**（= 不学 · 只保留 Library 进度）——给用户"休息一个池"的权力
- 允许 **双池学习**（= 两池都进 FSRS 队列 · 合并调度）
- **不允许** 双池**全暂停**（至少保留一个 active）· 否则 app 进入"空态"

### 6e.8 E5 · "Nothing to Learn" 空态（User C 老李 Day-10 画面）

**场景**：User C Day-10 · 已抽完 115 张 C# 卡 · 今日无新卡可抽 · 今日无回流队列（FSRS 今天没排任何卡）· 打开 app
**情绪**：空虚 + "我是不是太快了"

**关键元素**（Parchment 主题 · Home 特殊空态 · **在 Pool Launch Day-15 之前**）：
- Header：`📖 常规模式 · C#/.NET · Day 10`
- 大字：`All caught up 🎉`
- 中字：`You've collected all 115 cards · 58 mastered (50%)`
- 副字：`No cards to review today. FSRS will schedule the next one in 2 days.`
- **📋 MY PLAN 卡**（特殊态）：
  - Pool progress：`115/115 · 100% collected 🏆`
  - Mastery sub-bar（**v5.3 新增 · 呼应问题 C3**）：`Mastered 58/115 · 50%` · 薄荷绿填色
  - This week 柱图：7 天都满 · 今日独柱高 `+0 今日`
  - Goal：`🎯 Next milestone: Master 80/115 (Gold 70%)`
- **特殊空态 4 选项**（非急迫 · 探索式）：
  - `[ Browse my Library ]` outline（去 Library 回味）
  - `[ Redraw for fun ]` outline 灰态 · 副字 `⚠️ Will cost a free pull · no new cards expected`（重抽已抽卡——心智账本上是浪费 · 提示用户）
  - `[ Sneak peek · next pool ]` 紫色填色（**v5.3 新增 · 预告 Day-15 AWS**）· 带 "🔒 in 5 days"
  - `[ Save free pulls for AWS ]` 金色填色（推荐 · 节约奖励）
- 底部 5-tab：Home active
- 底部特殊 banner（琥珀金色）：`💡 Keep returning daily to maintain streak even without new cards`

**关键 UX 决议**：
- **"Redraw for fun"** 明确标注会消耗 free pull 且无新卡——避免用户误操作后抱怨
- **"Sneak peek · next pool"** 的 5 天倒计时 chip——创造**期待感**而不是**空虚感**
- **streak 保护机制**：即使没学卡 · 只要"打开 app + 滑动 Plan 卡 3 秒" 算"mindful minute" · 续 streak（**v5.3 新增决议 §13 #14**）

### 6e.9 E6 · Month 30 · Summary 页（带双池进度 + 月章）

**场景**：Day-30 用户完成当日学习后 · Settlement 之后自动弹出月总结
**情绪**：仪式 · 里程碑 · 继续下个月的动力

**关键元素**（Parchment 主题 + 顶部金光渐变 · 从 Cosmic 主题溶解过来）：
- 顶部 600ms 金光渐进
- 大字：`🏅 30-day streak unlocked`（User A / C / G 看到）或 `📅 Month 1 · your journey`（User B / D / E / F 看到 · 不同活跃度分化）
- **核心卡 · 双池进度总览**：
  - 第 1 行 · C#/.NET：`▓▓▓▓▓▓▒▒▒▒▒▒▒▒ 63/115 · 55% · Mastered 32`
  - 第 2 行 · AWS SAA：`▓▓▒▒▒▒▒▒▒▒▒▒▒▒ 14/60 · 23% · Mastered 4`
  - 共享：`Total 77 cards across 2 pools · 36 mastered`
- **日历热力图**（7 × 5 方格 · 30 天活跃热度 · 深绿 > 浅绿 > 灰）：
  - 可视化用户 30 天活跃模式
  - 每天的方块 tap 可看当日 snapshot
- **奖励栏**（按活跃度分等级）：
  - 🏅 30-day streak badge（A/C/G 解锁 · 金色）
  - 🏆 Silver/Gold 里程碑（A 🥈 · G 🥇 · C 双金）
  - 📦 Month 1 Framed card collection（按用户 Mastered 数发放）
- **下月目标 CTA**：
  - `[ Continue to Month 2 ]` 金色 · 带当前进度锚定下个 milestone
  - `[ Share my progress ]` outline（v1 灰态）
  - `[ Review my journey ]` outline（链接到详细日志 · v2）
- 底部 pill：`Pool Launch 还可能在 Day-45 / Day-75 推出新池`（tease next event）

**各用户 E6 页面差异**：

| 用户 | Header 大字 | 奖励 | 情绪 |
|----|----|----|----|
| A 小张 | 🏅 30-day streak unlocked | Silver 🥈 + 30-day + 32 mastered | 自豪 |
| B 小王 | 📅 Month 1 · welcome back |（无）+ 温和文案 `Every comeback counts` | 羞愧但被接住 |
| C 老李 | 🏆 C# Mastery + 30-day | 双 milestone + 30-day | 专业完成感 |
| D 小陈 | 📅 Month 1 · steady pace | 15 mastered + 5 Bronze-ish | 缓慢进步感 |
| E 小林 | 📅 Month 1 · Weekend Warrior | 🏅 Week streak ×4（替代方案 · 周活跃) | 被承认的独特节奏 |
| F 小刘 | 📅 Month 1 · Commuter Dedication | 42 cards + 推送 70% 响应率 | 通勤学习自豪 |
| G 小赵 | 🥇 Gold + 30-day + double pool | Gold 🥇 + 30-day + AWS 45% | 顶级用户 |

### 6e.10 E7 · Churn Re-engagement Landing（可选 · User B Day-27）

**场景**：User B 连续 6 天未开 app · Day-27 收到 "Fresh Start" 推送点击进入
**情绪**：犹豫 · "还要不要继续"

**关键元素**（Parchment 主题 · 特殊简化 Home · 低压感）：
- 大横幅（60% 屏高 · 温和绿色调 `#7E9D5E` 10% 底）：
  - 大字：`Welcome back, 小王`
  - 副字：`Your 12 cards are still here. Take your time.`
  - 插画（简单温和 · 阳光下的书桌）
- **3 选项 CTA**（纵向 · 48pt 高）：
  - `[ Fresh Start · reset FSRS schedule ]` 紫色填色
    - 副字：`Pretend it's Day 1 again · Your collection stays but review schedule resets`
  - `[ Try 1 card only · 30 seconds ]` 金色填色（主推）
    - 副字：`No pressure · see how it feels`
  - `[ Pause pool · keep progress safe ]` outline
    - 副字：`Come back whenever · no notifications for 7 days`
- **完全不显示**：
  - streak 0 ❌
  - Backlog warning ❌
  - Plan 卡 ❌（太高压）
  - milestone deadline ❌
- 底部 11pt：`We believe small comebacks beat perfect streaks.`

**关键决议**：
- **Fresh Start** = 后端调用 FSRS "reset all intervals to New state"（但保留 Collected 和 Mastered 不丢）· 相当于"忘了复习 debt 吧 · 从头开始" · 强大功能 · 仅限沉默 ≥ 7 天用户可用
- **1 card only** · 是沉默用户的**最低阈值回归路径** · 避免 "今天要学 10 张" 的吓退
- **Pause pool · 7 天无推送** · 用户主动退出的路径 · 不是流失 · 是**协商的暂停**

**数据层**：
- 后端增加用户状态：`Active · Dormant · Paused · Churned`
- Dormant ≥ 3 天 · 触发温和推送
- Dormant ≥ 7 天 · 触发 E7 Fresh Start 推送
- Dormant ≥ 14 天 · 触发"极简回归"邮件 or 最后推送
- 明确标记 Churned ≥ 30 天 · 停止推送

### 6e.11 §6e 画图交付汇总

**本节新增 artboard 编号**：
- E1 · Pool Launch Modal · Day-15 首次打开（Design 必画）
- E2 · Multi-pool Plan 卡 · Home 双池版（Design 必画）
- E3 · Library 顶部 Pool Switcher（Design 必画）
- E4 · Pool Picker Sheet v2（Design 必画）
- E5 · Nothing-to-Learn 空态（Design 必画 · User C Day-10）
- E6 · Month 30 Summary 页（Design 必画）
- E7 · Churn Re-engagement Landing（Design 可选 · User B Day-27）

合计 **6 必画 + 1 可选 = 6-7 张** · 加之前的 35 = **41-42 张 artboard 总交付**

### 6e.12 月模拟数字总表（7 用户 × 关键维度）

| 维度 | A 小张 | B 小王 | C 老李 | D 小陈 | E 小林 | F 小刘 | G 小赵 |
|----|----|----|----|----|----|----|----|
| Day-30 C# Collected | 63/115 | 12/115 | 115/115 | 38/115 | 28/115 | 42/115 | 80/115 |
| Day-30 AWS Collected | 14/60 | — | 45/60 | — | 12/60 | 10/60 | 33/60 |
| Day-30 C# Mastered | 32 | 5 | 83 | 15 | 18 | 22 | 58 🥇 |
| Day-30 streak | 🔥 30 | 🔥 2 | 🔥 30 | 🔥 8 | 🔥 2 | 🔥 30 | 🔥 30 |
| 里程碑达成 | 🥈 Silver | — | 🏆 全收集 | — | Week streak 4× | — | 🥇 Gold |
| 累计 Free Pull 消费 | 11/15 | 0/3 | 25/55 | 2/8 | 4/10 | 8/18 | 32/40 |
| Free Pull 月末存量 | 4 | 3 | 30 | 6 | 6 | 10 | 8 |
| Leech / Reset 事件 | 1 | 2 | 0 | 5 | 0 | 1 | 0 |
| 月推送响应率 | 80% | 15% | 90% | 70% | 40% | 60% | 95% |
| **留存状态** | ✅ 活跃 | 🟠 唤回中 | ✅ 顶级 | ✅ 稳定 | 🟡 周末型 | ✅ 通勤型 | ✅ 顶级 |

**粗分：3 顶级（A · C · G）· 2 稳定（D · F）· 1 周末型（E）· 1 流失风险（B）**

留存率预估：**6/7 = 85.7%**（若 v5.3 的优化全部实现 · 若不实现预计降至 60%）

---

## 7. Journey 转场动画表（供 FE 参考）

| 从 → 到 | 动画 | 时长 | 情绪 |
|----|----|----|----|
| 01 → 02 | 底部 Sheet 升起 | 250ms | 确认 |
| 02 → 03 | 色温过场（Parchment → Cosmic） | 600ms | 期待升温 |
| 03 → 04 | 粒子汇聚 + 卡堆翻转 | 800ms | 高潮 |
| 04 → 05 | 色温过场（Cosmic → Parchment）+ Daily Dose pop in | 500ms | 软着陆 + 赋权 |
| 05 → 06 | 选中档位脉冲 + 路线卡从虚态 fade-in 到激活 | 400ms | 被选中感 |
| 06 → 07 | Stage 1 zoom in + Boss 琥珀色条闪现 | 350ms | 警觉 |
| 07 → 08 | A 面 accordion + 代码块逐行展开 | 350ms | 揭晓 |
| 08 → 09 | 评分 Hard 填色 + `+1 free pull 🎁` toast → Stage 2/3 合屏快进 | 600ms | 流畅 |
| 09 → 10 | 3/3 金光 + 路线 → Settlement 上滑 | 500ms | 成就 |
| 10 → 11 | 底部 tab 切换 Home → Library | 180ms | 切换 |
| 10 → 12 | `Save for tomorrow` → 路线淡出 → Home 完成态 fade in | 400ms | 闭环 |

---

## 8. 数据一致性校验表（Design 自查）

| 字段 | 01 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 12 |
|----|----|----|----|----|----|----|----|----|----|----|
| 池名 | C#/.NET | C#/.NET | C#/.NET | C#/.NET | C#/.NET | C#/.NET | C#/.NET | C#/.NET | C#/.NET | C#/.NET |
| LEG 卡 | — | Task.Result Deadlock (Q1) ⭐⭐⭐⭐⭐ | Boss 缩略 | Boss 提示 | 当前 | 当前 | — | 💎 Mastered +1 | 💎 金框 1/5 | — |
| 抽卡数 | 0 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10/115 | 10/115 |
| Daily Dose | — | — | 选 3 | 3 关锁定 | — | — | — | — | — | — |
| 路线 | 虚态 | — | 3 关预告 | 0/3 激活 | 1/3 Boss | 1/3 | 2/3 → 3/3 | 3/3 ✓ | — | 3/3 ✓ |
| 评分 | — | — | — | — | 未评 | Hard | Good · Good | Again 0 · Hard 1 · Good 2 · Easy 0 | — | — |
| 时间 | — | — | 12:30 | 12:32 | 12:34 | 12:36 | 12:38-42 | 12:43 | — | 12:43 |
| 保底 | — | 命中 ⚡ | 0/10 重置 | 0/10 | — | — | — | — | 0/10 | Pity 0/10 |
| Day-1 奖励 | — | — | — | +5 earnable 🎁 | — | — | toast +1 ×3 | +3 banner | — | 🎁 3 saved |
| 卡面语言 | — | 全英 | 全英 | 全英 | Q 英文原题 | A+IRL+代码全英 | 全英 | 全英 | 全英 | 全英 |

---

## 9. 交付 Checklist（PM 会逐张对 · 硬红线）

### 9.1 数据连续性

- [ ] 抽到的 10 张卡 = Library 新增 10 张 = Screen 11 的 `10/115`
- [ ] Boss = `Task.Result Deadlock` ⚡ 贯穿 Screen 04/07/08/10/11
- [ ] Daily Dose 选 3 → 路线 3 关 → Settlement 3/3 clear → +3 free pulls 一致

### 9.2 卡面规范（v4.3 硬红线）

- [ ] 任何卡面**都不显示 Q Snippet**（题干一句都不行）
- [ ] 任何卡面**都不显示 Audience Badge**（JR/MID/BOTH 只能在 Level Q Header 出现）
- [ ] 任何卡面**都不显示代码装饰**（`<T>` / `{}` / `=>` 飘散全部删）
- [ ] Difficulty 1 = ⭐⭐⭐ · Difficulty 2 = ⭐⭐⭐⭐ · Difficulty 3 = ⭐⭐⭐⭐⭐（没有 1-2 星出现）
- [ ] LEG 金边 4pt · RAR 紫边 3pt · COM 灰金边 2pt
- [ ] Topic Keyword 全部英文（`Task.Result Deadlock` 而不是"死锁"）
- [ ] Primary Tag 全大写 + 左侧 2pt 色条（14 类色严格对照 §2.3）

### 9.3 页面硬约束

- [ ] Screen 01：金色填色 CTA 为**唯一视觉重心**，路线卡必须灰度虚态
- [ ] Screen 04：10 张全用 v4.3 精简卡面（Tag + Keyword + Stars）
- [ ] Screen 05：4 档 segmented 默认 3 紫色填色；下方 3 张缩略卡
- [ ] Screen 07：Q 面 Header 带 `Audience: MID`（这是卡面 Audience 唯一允许位置）
- [ ] Screen 08：VS Code Dark+ 代码块 + 双 C# 示例（`// ❌ Bad` / `// ✅ Good`）
- [ ] Screen 09：**合屏快进**（两关在一屏）+ 右上角 3 个 `+1 free pull 🎁` toast 堆叠
- [ ] Screen 10：GradeMixBar 总和 = 3（一致不矛盾）· Day-1 奖励 banner 必须出现
- [ ] Screen 11：过滤 chips 5 个英文（`All` / `⚪ COM` / `🔷 RAR` / `⚡ LEG` / `🌫 Unpulled`）· **3 列 + 16pt gutter** 缩小卡网格（v5.2 回退）
- [ ] 所有红色提示：琥珀色 `#C8883A`
- [ ] 所有 emoji chip：附 pseudo-accessibilityLabel 注释
- [ ] 所有数字：`N/Total` 格式 + 单位
- [ ] Draw/Settlement/Library Header：显示池名 `C#/.NET`

### 9.4 a11y 三铁律

- [ ] 减动效模式（Reduce Motion on）：粒子过场缩短 50%，色温过场换淡入淡出
- [ ] 色盲模式：稀有度除了颜色还要用图标区分（⚪/🔷/⚡ 本来就有，勿替换为纯色块）
- [ ] 字符膨胀 150%：Screen 05 segmented 档位不换行、Screen 10 GradeMixBar 不挤

### 9.5 卡背

- [ ] C#/.NET 池统一使用紫色底 + `C#` 大字徽章 + 尖括号/花括号低透明度装饰

### 9.6 v5.1 新增 checklist（Design 返稿评审必对）

- [ ] **Plan 卡出现在 Screen 06 · 12 · D2-01 · D2-07**（按 §3.7 规范）· Screen 01 是"Plan preview 单行微条"不是完整卡
- [ ] Plan 卡内含 Pool progress（进度条 + `N/115` + `%` + milestone）· This week 7 根柱图 · Goal 行 · `View full plan ▸` 链接
- [ ] **Library（Screen 11 · D2-06）回退 3 列 + 16pt gutter + 缩小卡片**（v5.2 决议 · 对齐行业惯例 · Keyword 18-22pt + 星级 10pt + Tag 色条 10pt + 精通徽章 12pt）
- [ ] Screen 09 **不再是合屏**——改为 Stage 2 · N+1 Query 单关完整屏（Parchment 主题 · 非 Boss · A/IRL 默认展开 · Good 评分 · `+1 free pull` toast 累计 2 个）
- [ ] Screen 12 · D2-07 上不再同时出现**单独的"周柱图"和 Plan 卡内的 "This week"**——只在 Plan 卡内画一次
- [ ] **Day-2 7 屏**严格按 §6b 画，与 Day-1 12 屏合计 19 张 artboard（+ §10 的 3 张 variant = 22 张）
- [ ] Day-2 所有页面**无 Daily Dose 选择器**（那是 Day-1 专属）
- [ ] Day-2 顶部带 `streak 🔥 2` 小标
- [ ] D2-04 Free Pull Modal 抽到 `AsNoTracking` ⚡ LEG 5 星（Q26 · EF CORE）· 页面**不切 Cosmic 主题**（保持 Parchment 学习流）
- [ ] D2-05 Settlement **无"You earned N free pulls!" 大 banner**（Day-1 专属福利已结束）；改为 FSRS 回流预告 banner（琥珀色 · `Tomorrow · Task.Result Deadlock ⚡ returns`）
- [ ] D2-06 Library 第 1 行左位 = AsNoTracking 🆕 NEW（Day-2 彩蛋位）· 右位 = Task.Result Deadlock 💎（Day-1 Boss Mastered）

### 9.7 Day-1 → Day-2 数据连续性（PM 跨天 diff）

- [ ] Day-1 Screen 12 显示 `Collected 10/115` · Day-2 D2-01 显示 `Collected 10/115`（跨天起始值一致）
- [ ] Day-1 `3 free pulls earned` → Day-2 D2-01 显示 `3 free pulls available` · D2-04 后变 `2 remaining` · D2-05/07 持续 `2 remaining`
- [ ] Day-1 Hard 的 Task.Result Deadlock 在 Day-2 **不出现**于学习队列（FSRS 计划 Day-3）· 但 D2-05/07 都要显示"Tomorrow returns"预告
- [ ] Day-2 结束 = `18/115 collected`（10 起始 + 7 learned + 1 free pull drawn）

---

## 10. 变体（Variant · 3 张附加）

除 12 屏 Journey 外，另交付 3 张：

13. **Home · Intense 密度模式**（同 Screen 12 数据但切 Intense 密度：单屏展示更多路线卡 + 重学区 + 周柱图 + 复习池 + 目标进度）
14. **Home · Chill 密度模式**（同 Screen 12 数据但切 Chill 密度：单屏只展示今日路线卡 + 主 CTA，其他折叠）
15. **PoolPickerSheet**（切池底部 sheet，Screen 06 状态触发，显示 `C#/.NET (active)` + `AWS (coming soon · 灰)` + `New pool pack` 购买入口灰态）

---

## 附录：题库字段对照（Claude Design 无需画，仅供 Q1/Q6/Q9 原题参考）

| Q# | 题库 Tags | Level | Audience | Difficulty | 稀有度 | 星级 | Topic Keyword |
|----|----|----|----|----|----|----|----|
| Q1 | Async/Await & Concurrency | Advanced-Mid | Intermediate | 3 | ⚡ LEG | ⭐⭐⭐⭐⭐ | `Task.Result Deadlock` |
| Q2 | ASP.NET Core & Web API | Applied | Both | 2 | 🔷 RAR | ⭐⭐⭐⭐ | `DI Lifetimes` |
| Q4 | OOP Fundamentals | Fundamental | Junior | 1 | ⚪ COM | ⭐⭐⭐ | `Interface vs Abstract` |
| Q6 | EF Core & Database | Applied | Both | 2 | 🔷 RAR | ⭐⭐⭐⭐ | `N+1 Query` |
| Q7 | LINQ & Collections | Fundamental | Junior | 1 | ⚪ COM | ⭐⭐⭐ | `IEnumerable vs IQueryable` |
| Q9 | Performance & Best Practices | Fundamental | Junior | 1 | ⚪ COM | ⭐⭐⭐ | `yield return` |
| Q17 | OOP Fundamentals | Fundamental | Junior | 1 | ⚪ COM | ⭐⭐⭐ | `Delegate vs Event` |
| Q25 | LINQ & Collections | Fundamental | Junior | 1 | ⚪ COM | ⭐⭐⭐ | `Dictionary vs List` |
| Q43 | ASP.NET Core & Web API | Applied | Both | 2 | 🔷 RAR | ⭐⭐⭐⭐ | `JWT Auth` |
| Q48 | OOP Fundamentals | Fundamental | Junior | 1 | ⚪ COM | ⭐⭐⭐ | `record vs class` |

Q1 完整题干（Screen 07 引用）：
> "You see .Result on a Task in a controller. What can go wrong, and how do you fix it?"

Q6 完整题干（Screen 09 引用）：
> "How do you spot and fix N+1 in EF Core?"

Q9 完整题干（Screen 09 引用）：
> "Why use yield return for a million-row CSV?"

---

---

## 11. 修订日志

| 版本 | 日期 | 核心变化 | artboard 数 |
|----|----|----|----|
| **v5.0** | 2026-04-22 | Design 交付版首稿：12 屏 Day-1 Journey + 3 张 variant | 15 |
| **v5.1** | 2026-04-22 | **首轮返稿评审优化**：(1) Screen 09 废除合屏，改 Stage 2 单关完整屏；(2) Screen 11 Library 3 列 → 2 列 + 24pt gutter；(3) Home 新增 Plan 卡（§3.7）· 覆盖 Screen 01/06/12；(4) §6b 新增 **Day-2 Journey 7 屏**（常态流程 · 无 Daily Dose · Free Pull 消费彩蛋 · FSRS 回流预告） | 22 |
| **v5.2** | 2026-04-22 | **7 天路径 + 极端用例扩展**：(1) **Library 回退 3 列 + 16pt gutter + 缩小卡片**（Screen 11 / D2-06 对齐行业惯例）；(2) §6c 新增 User A · Day-3 → Day-7 Journey **7 屏**（Task.Result 升级 💎 · Bronze 里程碑仪式 · 周末长会话 · Leech 警报 · Chill Defer · Week 1 Complete）；(3) §6d 新增 User B · 7 天极端用例 **6 屏**（Chill 1 关 Again · 断 streak 首页 · Backlog Mode · 降级 Modal · Library ⟳ 徽章 · 温和回归）；(4) §12 新增 **设计反思清单 12 条**——暴露中长期 UX + 极端用例暴露的产品缺口 | **35**（+13） |
| **v5.3** | 2026-04-22 | **7 用户 30 天模拟 + 双池过渡**：(1) §6e 新增 **A-G 7 用户月画像**（标准 / 流失 / 速通 / 胆怯 / 周末 / 推送 / 囤积）· 30 天数字脚本 + 关键事件 + UX 问题挖掘；(2) **Day-15 双池上线事件**（C#/.NET → + AWS SAA · 不同用户分化反应）；(3) §6e 新增 **6 张多池关键 artboard**（E1 Pool Launch Modal · E2 Multi-pool Plan 卡 · E3 Library Pool Switcher · E4 Pool Picker Sheet v2 · E5 Nothing-to-Learn 空态 · E6 Month Summary）+ 1 张可选（E7 Fresh Start 唤回）；(4) §13 新增 **多池 7 大决议 + 18 条问题清单 + v6 PRD 落地建议**——从月模拟里挖出的所有产品缺口按 P0/P1/P2 分级 | **41-42**（+6-7） |

**v5.3 签收**：产品经理 Chuan Qiao · 2026-04-22

**本轮 41-42 张 artboard 交付清单**：

- **Day-1 Journey（§6）** × 12 张：Screen 01 ~ 12
- **Day-2 Journey（§6b）** × 7 张：D2-01 ~ D2-07
- **Day-3 → Day-7 Journey（§6c · v5.2）** × 7 张：D3-01 Home · D3-02 Stage Mastered · D4-01 Bronze 仪式 · D5-01 Leech 警报 · D5-02 Library 28/115 · D6-01 Chill 模式 · D7-01 WeekSummary
- **User B Journey（§6d · v5.2）** × 6 张：UB-D1-01 Chill 1 关 · UB-D3-01 断 streak 首页 · UB-D5-01 Backlog Mode · UB-D5-02 降级 Modal · UB-D5-03 Library ⟳ · UB-D7-01 温和回归
- **多池上线 + 月模拟关键画面（§6e · v5.3）** × 6 必画 + 1 可选 = **6-7 张**：
  - E1 · Pool Launch Modal（Day-15 首次打开 · 必画）
  - E2 · Multi-pool Plan 卡（Home 双池 · 必画）
  - E3 · Library 顶部 Pool Switcher（必画）
  - E4 · Pool Picker Sheet v2（必画）
  - E5 · Nothing-to-Learn 空态（User C Day-10 · 必画）
  - E6 · Month 30 Summary 页（必画）
  - E7 · Fresh Start Churn Re-engagement（User B Day-27 · 可选）
- **Variant（§10）** × 3 张：Home Intense · Home Chill · PoolPickerSheet（注：E4 可能替代此 PoolPickerSheet）

**交付动作**：把本文（`gacha-v5.md`）复制给 Claude Design，按 §6 + §6b + §6c + §6d + §6e + §10 合计 **41-42 张 artboard** 输出。

**下一步**：
1. Claude Design 输出 41-42 张 PNG（或 Figma 链接），按 `01-day1-screen-XX.png` / `02-day2-dXX.png` / `03-day3-7-XX.png` / `04-userb-XX.png` / `05-multipool-EX.png` / `06-variant-XX.png` 分组命名
2. PM 按 §9 checklist（含 v5.1 / v5.2 / v5.3 新增条目）逐张验收
3. §12（12 条）+ §13（18 条）共 30 条反思/问题 · 进入 PM 下一轮 v6 PRD 决议
4. §13.4 的 **5 个关键决议**（Weekend streak · Free Pull 过期 · Audience Filter 位置 · Fresh Start 阈值 · Gold/Diamond 触发指标）必须 PM 老板签字
5. 通过后交 FE 按 §7（Day-1 转场）+ §6b.4（Day-2 转场）+ §6c/§6d/§6e 新增交互 + Design System tokens 切图工程化
6. 内容团队按附录规则为 115 C# 题 + 60 AWS 题补全 `Topic Keyword` 字段（双池上线前必须完成）
7. 后端按 §13.3 P0 8 条（streak · Mastery · 空池 SLA · Audience Filter · Fresh Start API · 推送分级 · Gold/Diamond · Weekend streak）实施

---

## 12. 设计反思清单（v5.2 新增 · 12 条产品缺口 · PM 下一轮决议）

> 本节汇总 §6c（User A 中周期）+ §6d（User B 极端用例）暴露的**产品设计缺口**。每条按严重度 🔴 P0 必修 · 🟠 P1 应修 · 🟡 P2 可推迟 标注。

| # | 严重度 | 缺口 | 出处 | 当前 v5.2 方案 | 推荐决议方向 |
|----|----|----|----|----|----|
| 1 | 🟡 P2 | Day-3 无新卡 review-only 体验可能乏味 | §6c.2 | 坚持 SRS 原则 · outline `[ Draw again ]` CTA | 暂不强改 · 观察 Day-30 留存数据再决议 |
| 2 | 🟠 P1 | LEG 2/5 Mastered · RAR/COM 5/5 Mastered 的**不对称规则**用户不懂 | §6c.3 | 依赖 Library 详情页说明 | **加一次性 Onboarding Modal**（首次升 💎 时触发）|
| 3 | 🔴 P0 | Bronze/Silver 里程碑触发条件模糊（Collected % vs Mastered %） | §6c.4 | Collected % 触发 | **PM 决议**：Bronze = Collected 20% · Gold = Mastered 20% 双轨 |
| 4 | 🔴 P0 | Leech 警报触发阈值 + 3 个选项（Pause / Reset / Keep）UX 首次出现 | §6c.5 | 连续 2 Hard 触发 | **阈值改"连续 3 Hard 或累计 5 Again"**（避免过早打扰）· 3 选项保留 |
| 5 | 🔴 P0 | **Defer 上限 + Defer Debt 展示**——Chill 模式无限 defer 会堆积到不可收拾 | §6c.7 | 默认无限 Defer | **Defer 上限 3/天** · Debt > 10 张时 Plan 卡琥珀色警告 · Debt > 20 张强制至少学 3 张 |
| 6 | 🟠 P1 | 周总结仪式（🏆 Week 1 Complete）触发条件 | §6c.8 · §6d.8 | v5.2 暂定 ≥ 6/7 活跃触发 | 保持 ≥ 6/7 · 4/7 及以下只 Plan 卡温和汇报 |
| 7 | 🟡 P2 | Bronze Shimmer 等**外观解锁**首次引入 PRD | §6c.8 | v5.2 提出 · 未决议 | v2 再做 · v1 仅按 rarity 发框 |
| 8 | 🟠 P1 | Chill Daily Dose 首日奖励是否随关卡数 | §6d.2 | 跟关卡数（1/3/5/10） | 保持跟关卡 · 但 Settlement 文案温和（已在 §6d.2 写入） |
| 9 | 🟠 P1 | **推送通知文案 A/B** · 断 streak 当天 / 积压提醒 | §6d.3 · §6d.5 | 未决议 | Content + PM 下轮定义 · Design 不画推送 |
| 10 | 🔴 P0 | **断 streak 首页 UX 不能失败感化**（不大写 STREAK LOST · 用 rebuild 语气 · 去 Goal deadline） | §6d.4 | 已在 §6d.4 明确规范 · artboard UB-D3-01 | FE 严格按规范实现 |
| 11 | 🔴 P0 | **Backlog Mode（5 张积压）的 Split / Snooze / All 三选项 + Snooze 二次确认** | §6d.5 | 已在 §6d.5 明确 · artboard UB-D5-01 | FE 严格按规范实现 · Snooze 连续 2 天后强制至少学 2 张 |
| 12 | 🔴 P0 | **卡片降级回 🪙（Reset to Fundamental）的全链路**——Modal · Library ⟳ 徽章 · 进度归 0 | §6c.5 · §6d.6 · §6d.7 | 已在 §6d.6/7 明确 · artboard UB-D5-02 + UB-D5-03 | FE 严格按规范 · 后端：`Card.state: InReview → New` · `Card.reps = 0` · `Card.lapses += 1` · Library 显示 ⟳ 标记 |

### 12.1 P0 汇总

所有 🔴 P0 必修 = **6 条**：#3（里程碑双轨）· #4（Leech 阈值）· #5（Defer 上限）· #10（断 streak UX）· #11（Backlog Mode）· #12（降级机制全链路）

**PM 本轮必须决议的 6 条**——建议在 v6 PRD 里把这 6 条写成硬规范。其余 🟠 P1 / 🟡 P2 可在 v1 上线后按数据决议。

### 12.2 组件库增量（v5.2 新增 · 供 §3 追加）

v5.2 新增 3 个组件（待补到 §3）：

- **⟳ 重置徽章**（Library 卡片左下角 · 13pt · `#8C7A5B` 中性灰金色）· 规格见 §6d.7
- **Backlog 提示卡**（橙黄软色 `#E8B85A` 10% 底 · 3 选项按钮 Split/Snooze/All）· 规格见 §6d.5
- **里程碑仪式插屏**（Cosmic → 金光特写 → Parchment · 1200ms 自动跳转）· 规格见 §6c.4

### 12.3 §6c/§6d 映射到 §9 Checklist 增补

- [ ] §6c D3-02：Task.Result 二次 Good · **💎 升级提示 banner 金光脉冲** 400ms
- [ ] §6c D4-01：Bronze 仪式插屏 Cosmic 主题 · 自动 1200ms 跳转 · 次 CTA `[ Continue ]`
- [ ] §6c D5-01：Leech 警报 3 选项（Pause / Reset / Keep）· Reset 二次确认 Modal
- [ ] §6c D6-01：Chill 模式 Defer · Settlement 简化 · FSRS 预告次日 N+defer 张
- [ ] §6c D7-01：WeekSummary 金色顶 + 奖励栏 4 条 + 次 CTA `Share my progress` 灰态（v1 预留）
- [ ] §6d UB-D3-01：橙黄软横幅（**不用红**）· `streak reset to 🔥 0` + `Goal: Take it one card at a time`（去 deadline）
- [ ] §6d UB-D5-01：Backlog Mode · 3 选项 · Snooze 二次确认文案 `Snoozing means 5 → 7+ cards tomorrow. Sure?`
- [ ] §6d UB-D5-02：降级 Modal · 单按钮强制接受 · 文案 `Let's start this one over` + `You'll see it fresh tomorrow`
- [ ] §6d UB-D5-03：Library ⟳ 徽章在 Interface vs Abstract 卡片左下 · 卡框虚线感
- [ ] §6d UB-D7-01：恢复 `常规模式` 标签 · Plan 卡 goal 行改"Steady pace beats perfect"

---

## 13. 多池设计含义 + 18 条问题 + 优化方案（v5.3 新增 · 7 用户月模拟产出）

> §6e 的 7 用户 30 天模拟暴露了 18 条产品/设计缺口 · 按严重度 🔴 P0 必修 · 🟠 P1 应修 · 🟡 P2 可推迟 分级。
>
> 本节分 3 部分：
> - **§13.1 多池设计 7 大决议**（必须在 Day-15 上线前完成 · 含 Design System 增量）
> - **§13.2 18 条问题清单**（从 A-G 用户路径挖出）
> - **§13.3 v6 PRD 落地建议**（按优先级分批实施）

### 13.1 多池设计 7 大决议

| # | 决议项 | 当前（v1 单池 PRD） | v5.3 决议（v1.1 双池） | 影响 |
|----|----|----|----|----|
| 1 | **streak 作用域** | 单池 | **Global**（跨池累计 · 学任一池续 streak） | UI：Home 只显示 1 个 🔥 N · 不按池分 |
| 2 | **Free Pull 作用域** | 单池 | **Global**（任意池通用）| 数据层：`user.free_pulls` 不再按池分 · Draw 时选池消费 |
| 3 | **Pity 作用域** | 单池（10 连 per pool） | **Per-pool**（保留）· C# pity 不影响 AWS pity | 符合抽卡机制 · 不变 |
| 4 | **Library 切换** | 无（单池） | **顶部 Segmented Pool Switcher**（§6e.5 E3） | 新增组件 · 每池独立 Collection % |
| 5 | **Plan 卡展示** | 单池进度条 | **双池上下堆叠 · 共享 streak + This week 柱图** | §6e.4 E2 画面 |
| 6 | **Daily Dose 触发** | Day-1 单池 | **每个池首次激活时各触发 1 次**（AWS Day-1 也有 Daily Dose） | §13.2 问题 #12 |
| 7 | **推送频次** | 3/天（单池） | **合并推送**：每天 1 条 `N cards across 2 pools` | §6e.6.6 F 用户 · §13.2 问题 #13 |

**Design System 增量（§3 组件库追加）**：

- **Pool Switcher · segmented**（顶部 · 48pt 高 · 两池 pill · 带 Count · 选中紫填 · 未选 outline）· 规格见 §6e.5 E3
- **Multi-pool Plan 卡**（§3.7 扩展 · 两池上下堆叠 · 共享 streak + This week）· 规格见 §6e.4 E2
- **Pool Launch Modal · 全屏**（Day-15 弹 · 三段式预览 + 3 CTA）· 规格见 §6e.3 E1
- **Pool Picker Sheet v2**（底部 Sheet · 每池独立 🔔 开关 + "Learning in this pool" 复选框）· 规格见 §6e.7 E4
- **Nothing-to-Learn 空态 Home**（User C Day-10）· 规格见 §6e.8 E5
- **Fresh Start 唤回 Landing**（User B Day-27）· 规格见 §6e.10 E7
- **Month Summary 页**（Day-30 特殊页 · 双池 + 热力图 + 奖励栏）· 规格见 §6e.9 E6
- **Mastery 副进度条**（Plan 卡内 · Collection 主条下方 · 薄荷绿色 · 文字 `Mastered N/Total`）· 呼应问题 #3

### 13.2 18 条问题清单（按严重度 + 出处 + 当前 v5.3 方案 + 决议方向）

| # | 严重度 | 问题 | 出处 | v5.3 方案 | 推荐决议（v6 PRD）|
|----|----|----|----|----|----|
| 1 | 🔴 P0 | **streak 作用域**未明确（单池 vs global） | §6e.6.1 A3 | Global（学任一池续 streak） | 锁定：Global · 新用户激活 AWS 后不额外 reset |
| 2 | 🔴 P0 | **Weekend-only 用户**永远断 streak | §6e.6.5 E1 | 未定 | **新增 Week streak** 🔥 Wk N（每周 ≥ 2 天算）· 与 Daily streak 🔥 并存 |
| 3 | 🔴 P0 | **Mastery 进度**未在 Plan 卡/Milestone 中独立展示 | §6e.6.3 C3 · §6e.6.4 D3 | 仅 Collection % | Plan 卡加 **Mastery 副进度条** · Milestone 双轨（Collection% + Mastery%） |
| 4 | 🟠 P1 | **Leech 永久 bury** 机制缺失 | §6e.6.4 D2 | 仅 "Reset to Fundamental" | 增加 "Bury 7 days" 选项（§6c.5 Leech 3 选项扩展到 4 选项） |
| 5 | 🔴 P0 | **空池 SLA**——单池用户 10 天后内容枯竭 | §6e.6.3 C1 | 无机制 | 每 7-10 天必须有"新内容事件"（新池 / 新卡 / 活动 / 复盘精选） |
| 6 | 🔴 P0 | **Audience / Level 筛选器**缺失（Junior-only track） | §6e.6.4 D1 | Daily Dose 不支持按 Audience 筛 | Settings 加 `Learn only Junior/Both` · Daily Dose 在 Day-1 + Daily 都尊重此设置 |
| 7 | 🟠 P1 | **Free Pull 无过期**——囤积风险 | §6e.6.7 G1 | 无过期 | **60 天过期** · 或 **上限 30 张**（超了不再发放） |
| 8 | 🟡 P2 | **Binge 用户批量评分**缺失 | §6e.6.5 E2 | 单张评分 | v2 加 "Quick-rate 5 in a row" 模式 |
| 9 | 🟠 P1 | **短会话用户上限**（每次最多 N 张） | §6e.6.6 F3 | 无 | Settings 加 `Max per session: 3 / 5 / 10 / unlimited` |
| 10 | 🔴 P0 | **Fresh Start 功能**（沉默 ≥ 7 天用户重置 FSRS schedule） | §6e.6.2 B 路径 · §6e.10 E7 | 无 | 新增 `POST /user/fresh-start` · 保留 Collection/Mastery · 清 review schedule |
| 11 | 🔴 P0 | **推送频次分级**（按用户活跃度 / 池数） | §6e.6.5 E3 · §6e.6.6 F1 | 固定 3/天 | 新推送决策树：Active 3/天 · Dormant 1/天 · Paused 0 · 双池合并推送 |
| 12 | 🟠 P1 | **AWS 池首次激活的 Daily Dose** 是否触发 | §6e.6.1 A1 | 未定 | **触发**（每个池首次激活 = 各自 Day-1 · 有 Daily Dose + Day-1 bonus free pull） |
| 13 | 🟠 P1 | **合并推送** UI | §6e.6.6 F2 | 无 | `🔔 3 C# + 2 AWS · 5 cards total · 2 min` 单推送 |
| 14 | 🟡 P2 | **Mindful minute** streak 保护 | §6e.8 E5 | 未定 | 空池日只要打开 app + 滑 Plan 卡 3 秒算"活跃" · 续 streak |
| 15 | 🟠 P1 | **FSRS 长期未复习卡片**的算法处理 | §6e.6.2 B3 | 按原计划 | Dormant ≥ 7 天的卡片 · 下次出现时 state 降到 Learning（难度增加） |
| 16 | 🔴 P0 | **Gold / Diamond 里程碑**仪式首次出现 | §6e.6.7 G2 · §6e.9 E6 | 未定 | 按 Mastery%：🥉 20% · 🥈 50% · 🥇 80% · 💎 100% |
| 17 | 🟡 P2 | **仪式冷却期** | §6e.6.1 A2 | 无 | 同主题仪式 ≥ 5 天才能再触发（防止仪式疲劳） |
| 18 | 🟡 P2 | **深度用户微情绪设计**（Leaderboard / Mastery Hall） | §6e.6.7 G3 | 无 | v2 加 "Hall of Mastery"（所有 💎 Mastered 卡的特殊展览页） |

### 13.3 v6 PRD 落地建议（分批实施）

**🔴 P0 必须在 Day-15 双池上线前完成**（共 8 条）：

| # | 工作量预估 | 涉及模块 |
|----|----|----|
| 1 streak global | 后端 2d + FE 1d | User model · Home Plan 卡 |
| 3 Mastery 副进度条 | Design 1d + FE 2d | §3.7 Plan 卡 · Milestone 双轨逻辑 |
| 5 空池 SLA | PM 0.5d 制定 · Content 长期 | 内容生产节奏 |
| 6 Audience Filter | 后端 2d + FE 2d + Design 1d | Settings · Daily Dose · FSRS scheduler |
| 10 Fresh Start | 后端 3d + FE 2d + Design 1d（E7）| User state machine · FSRS reset API |
| 11 推送分级 | 后端 3d · 定义状态机 | Push service · 用户状态 Active/Dormant/Paused |
| 16 Gold/Diamond 仪式 | Design 2d + FE 1d | 复用 Bronze/Silver 仪式组件 · 换金/钻色 |

**2 · Weekend streak** 的 Week 🔥 Wk N 因为影响 streak 语义基础 · 建议在双池上线时一起更新 · 否则等 1 个月数据后（用户量增后再定是否加）。

**🟠 P1 应在双池上线后 2 周内完成**（共 6 条）：

问题 4（Leech bury）· 7（Free Pull 过期）· 9（Session 上限）· 12（AWS Daily Dose）· 13（合并推送）· 15（FSRS 长期未复习处理）

**🟡 P2 可推迟到 v1.2 / v2**（共 4 条）：

问题 8（批量评分）· 14（Mindful minute streak）· 17（仪式冷却）· 18（深度用户页）

### 13.4 §13 留给 PM 的关键决议模板（需要 PM 老板签字）

> 以下 5 项是 v5.3 提出但 PM 未拍板的 · 请在复审时逐条表态。

- [ ] **决议 A · Weekend streak 替代方案 Wk N**：是否引入周 streak？（影响 E 用户等"周末型"用户情绪）
- [ ] **决议 B · Free Pull 过期 / 上限**：选 60 天过期 · 还是上限 30 张 · 还是 30 天过期 + 上限 50 张 · 还是不动？（影响 G 用户等囤积型用户）
- [ ] **决议 C · Audience Filter** Settings 开关位置：放 Settings · 放 Pool Picker · 还是 Library 顶部 chip？（影响 D 用户等胆怯型用户）
- [ ] **决议 D · Fresh Start 解锁阈值**：沉默 ≥ 7 天（推荐）· ≥ 14 天 · 还是用户主动请求？（影响 B 用户等流失用户）
- [ ] **决议 E · Gold / Diamond 触发指标**：按 Collection % · 按 Mastery % · 还是双轨并列？（影响 G 用户等顶级用户 · 呼应问题 #3 Plan 卡改造）

### 13.5 §13 到 §9 Checklist 的落地（PM 逐张对）

- [ ] E1 · Pool Launch Modal · Day-15 **强制表态**（无"暂不选择"）· 3 CTA 视觉层级：金 > 紫 > outline
- [ ] E2 · Multi-pool Plan 卡 · 两池上下堆叠 · Mastery 副进度条 · 共享 streak + This week 双色柱图
- [ ] E3 · Library 顶部 Pool Switcher · segmented 带 Count · 180ms 水平滑过切换
- [ ] E4 · Pool Picker Sheet v2 · 每池独立 🔔 开关 · "Learning in this pool" 复选框 · 至少 1 池 active
- [ ] E5 · Nothing-to-Learn 空态 · 4 选项（Browse / Redraw 灰态 / Sneak peek next pool / Save for AWS）· 底部 banner 鼓励保 streak
- [ ] E6 · Month Summary · 双池进度 + 30 天热力图 + 按活跃度分级奖励（A/C/G 有 🏅 30-day · B/D/E/F 有温和文案）
- [ ] E7（可选）· Fresh Start Landing · 绿色调 · 3 CTA · 不显示 streak/Plan/Backlog · 底部 `small comebacks beat perfect streaks`

### 13.6 小结 · v5.3 交付 41-42 张 artboard 总盘

| 批次 | 数量 | 出处 |
|----|----|----|
| Day-1 Journey | 12 | §6 |
| Day-2 Journey | 7 | §6b |
| Day-3 → Day-7 | 7 | §6c |
| User B 极端用例 | 6 | §6d |
| 多池 + 月模拟关键画面 | **6（必）+ 1（可选）** | §6e |
| Variant | 3 | §10 |
| **合计** | **41-42** | — |

**留存预测**：
- 如 §13 的 P0 8 条全部实施 → 月留存率 **~85.7%**（6/7 用户活跃）· 高于行业 SRS 产品均值 40-50%
- 如 P0 仅实施一半 → 月留存率降至 **~60%**（User B 流失 · User E 不满 · User F 推送疲劳）
- 如 P0 不实施 → 月留存率 **< 40%**（双池上线反而加速流失）

**v5.3 签收**：产品经理 Chuan Qiao · 2026-04-22
