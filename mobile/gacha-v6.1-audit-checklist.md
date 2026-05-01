# RecallSmith Mobile · v6.1 主链路人工验收清单

> 用途：这份文档用于当前实现版本的产品验收，不是再定义新需求。
> 目标：按用户实际操作路径检查当前代码是否已经达到“可用、清晰、可继续打磨”的状态。

---

## 0. 验收范围

本轮验收只覆盖当前已经落地的主链路与次级入口：

主链路：
- Home
- Challenge
- Review
- SessionSummary

次级入口：
- Deck / Library
- Settings（Audience / Fresh Start / Reminders / Premium / Account）

不在本轮验收范围内：
- Week Streak
- Milestone ceremony
- Multi-pool
- 更复杂 push 状态机

---

## 1. 验收方法

每个页面都从 4 个维度检查：

1. 第一眼是否清楚
2. 主 CTA 是否唯一且明确
3. 是否会把用户从主路径带偏
4. 页面是否承担了错误的职责

建议至少用以下 6 个场景人工走一遍：

1. 新用户首开 / 无 deck
2. 有一个 starter deck 且有 due review 的用户
3. 当天 due 很少、fresh card 较多的用户
4. 完成一次 full run 的用户
5. 试用 premium deck 的用户
6. 登录用户在 Settings 中修改 Audience / Fresh Start 的用户

---

## 2. 页面级验收清单

## 2.1 Home

### 通过标准

- [ ] 首屏的核心含义是“今天该不该打、点哪里开始”
- [ ] 首屏存在唯一主 CTA
- [ ] Hero 文案比 Calendar / Deck list 更强
- [ ] TodayPressure 和 RoutePreview 能帮助用户建立今天的预期
- [ ] Momentum 文案不会让用户感觉像被催债式任务系统
- [ ] 用户不需要滚动太久就能开始今天挑战

### 重点观察

- Calendar 是否仍然抢了首屏注意力
- Deck list 是否在视觉上与 Hero 同权
- “Start today’s challenge” 是否真的像首要动作

### 当前实现的主要风险点

- Home 仍然保留了较重的 bootstrap / install / premium 逻辑
- Deck row 点击逻辑仍然复杂，可能在交互上显得偏“管理台”

---

## 2.2 Challenge

### 通过标准

- [ ] 用户能理解“今天这一把”大概包含什么
- [ ] 能看懂 minimum goal 和 full run 的区别
- [ ] RoutePreview 看起来像一段短流程，而不是列表杂项
- [ ] CTA 很清晰：就是开始这一把

### 重点观察

- 文案是否太抽象，不够像真实挑战
- due/new/goal 信息是否已经足够，不需要更多解释
- 页面是否过于骨架化，缺少闭环感

### 当前实现的主要风险点

- Challenge 结构正确，但还偏 MVP 骨架
- 文案目前功能性强，游戏包装感还比较轻

---

## 2.3 Review

### 通过标准

- [ ] Question → 翻面 → 评分路径流畅
- [ ] 顶部进度条与当前 session 状态足够清楚
- [ ] Again / Hard / Good / Easy 的语义直观
- [ ] Explanation / Code / Real Usage 的阅读没有被动画干扰
- [ ] 完成最后一张后，用户理解“这一把结束了”

### 重点观察

- 顶部信息是否过少或过多
- 卡片背面内容是否过长导致评分区难以触达
- 评分按钮是否在视觉上过于像技术测试而不够产品化

### 当前实现的主要风险点

- Review 已经结构化，但视觉层级仍偏工程化
- 卡片阅读区与评分区的节奏还可以继续优化

---

## 2.4 SessionSummary

### 通过标准

- [ ] 用户能明确感受到“这一把收尾了”
- [ ] 奖励文案没有损失感
- [ ] reward 与 progress 是并存的，而不是只剩数字
- [ ] 主 CTA 与次 CTA 的区别清晰
- [ ] 页面不是 dashboard，而是 session 结算

### 重点观察

- 页面是否仍然偏静态汇总而不够“结算”
- 文案是否足够让用户知道下一步做什么
- reward 展示是否还太轻

### 当前实现的主要风险点

- Summary 结构是对的，但奖励反馈仍偏轻
- 还没有真正形成“战利品 + 学习收尾”双层体验

---

## 2.5 Deck / Library

### 通过标准

- [ ] 用户能把它理解为拥有内容 / 次级入口，而不是主链路首页
- [ ] New / Learning / Mastered 状态清楚
- [ ] 页面不会抢走 Home 的角色
- [ ] 模式选择区还保留可用性，但不会破坏主链路设计

### 重点观察

- Deck page 是否仍像“第二个首页”
- Library overview 是否足够像库存页而不是 session 配置页
- trial/login/premium gate 是否让页面职责仍然偏杂

### 当前实现的主要风险点

- DeckScreen 仍兼具 gate + library + launchpad 三重职责
- 从产品纯度上看，它仍是最像“过渡页”的页面之一

---

## 2.6 Settings

### 通过标准

- [ ] Audience 偏好位置合理，文案清晰
- [ ] Fresh Start 的语义是 reset schedule，不是 wipe app
- [ ] Reminders 不喧宾夺主，但功能明确
- [ ] Account / Premium / Content preferences 的分区清晰

### 重点观察

- Content preferences 是否需要更清晰地说明“不影响 due review”
- Fresh Start 是否会让用户误以为清空全部数据
- Dev tools 是否与正式功能视觉上足够区分

### 当前实现的主要风险点

- Settings 信息量较大，需要确认各 section 的优先级是否已经足够清楚

---

## 3. 当前产品体验问题清单

以下问题不是“代码坏了”，而是当前体验层仍有待继续优化的地方。

## P0（下一轮应优先解决）

### P0-1 Home 的 deck list 仍偏强

虽然首屏已经重排，但 Deck list 仍然承载复杂安装/升级/试用逻辑，容易让 Home 后半段像“内容管理入口”，削弱首页作为“今日开打页”的单一心智。

建议：
- 后续把 deck row action 继续下沉为单独 action resolver
- 让 Home 更清楚地区分“开始今天”与“管理内容”

### P0-2 Summary 的奖励体验还偏轻

当前 Summary 已有结构，但更像“完成提示 + 两个按钮”，还没完全达到“战利品 / 进展 / 下一步”三者同时成立的结算感。

建议：
- 强化 reward 区的视觉层级
- 增加更明确的 minimum goal / full run 达成反馈
- 让 reserve / wallet 状态表达更有“收尾感”

### P0-3 Deck / Library 仍是过渡页

DeckScreen 已明显向 Library 收敛，但它仍混合：
- gate
- library
- mode launch

这意味着它现在能用，但产品职责还不够纯。

建议：
- 后续决定是否正式更名/演化为 LibraryScreen
- 再判断 mode launch 是否仍应留在该页

---

## P1（下一轮可同步优化）

### P1-1 Challenge 文案还偏骨架

Challenge 结构正确，但“打一把”的氛围还不够强，目前更像技术正确的准备页。

建议：
- 优化标题、副标题与节点说明
- 让 minimum goal / full run 的语言更成人化、更有完成感

### P1-2 Review 顶部与卡片背面节奏还可优化

Review 已经结构化，但信息密度与滚动节奏还可以进一步校正，尤其在 explanation / code / usage 很长时，用户可能会感觉评分区较远。

建议：
- 继续优化背面内容的节奏与视觉分块
- 必要时考虑更明显的 rating sticky 区域策略

### P1-3 Settings 解释仍可更短更准

Audience / Fresh Start 已接上，但语言还可以更“产品化”，更少解释腔。

建议：
- 压缩长说明
- 强调用户动作结果，而不是系统原理

---

## P2（可后续打磨）

### P2-1 Calendar / Month gate 的视觉整合

这些功能能用，但与新的首页主叙事还没有完全融合。

### P2-2 Summary / Challenge 的品牌化反馈

结构成立后，可以再加更有辨识度的轻量反馈，而不是继续加复杂动画。

### P2-3 Library 的筛选与卡片层级可视化

现在已经有状态映射，但后续还可以在视觉上让 New / Learning / Mastered 区分更强。

---

## 4. 下一步建议

当前最合理的下一步不是再扩高风险功能，而是：

1. 针对 P0/P1 问题做一轮体验修正
2. 优先修正：
   - Home deck list 权重
   - Summary 奖励层级
   - Deck / Library 的页面角色纯度
3. 修正完成后，再决定是否继续进入更复杂的 week streak / milestone / multi-pool

一句话：

结构已经足够稳定，接下来更值得做的是“体验打磨”，而不是再继续扩功能。
