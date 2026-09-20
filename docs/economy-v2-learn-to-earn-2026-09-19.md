# 经济规则修正案 v2：学一张赚一抽（2026-09-19）

> 状态：**已签字（2026-09-21）**——owner 以聊天指令「开始 Wave C」授权，由 Claude 代为勾选并随 Wave C 的 setup commit 提交；实现见 `docs/delivery/r16-issues/C00-contracts.md`。签字前不得写任何经济相关代码——否则会出现第二套没有文档的经济。
> 修正对象：`docs/gacha-acquisition-learning-loop-plan.md` 裁决 6 与不变量 4；`mobile/gacha-v7.md` §2.2。
> 实现归属：`docs/delivery-wave-1.6-plan-2026-09-19.md` Wave C 的 C01（奖励 + 账本）、C02（拆额度 + 预估提示）、C04（总复习）。

---

## 1. 被修正的原文（逐字引用）

`docs/gacha-acquisition-learning-loop-plan.md`：

> 裁决 6：当前奖励政策保持"真实 full clear 得 1 抽"；本轮不借修 bug 改成分档奖励。
> 不变量 4：当前奖励规则唯一：full clear +1；minimumGoal 不改变抽数。

`mobile/gacha-v7.md` §2.2：

> v6.1 §2 "唯一规则真表"继续有效，v7 不引入新规则、不修改阈值。

这两处当时的目的是**防止在修 bug 的同时偷偷改经济**。本修正案是一次有文档、有测试、有日期的显式变更，不是那种情况。

## 2. 新规则（唯一规则真表 v2）

| # | 规则 | 数值 | 说明 |
|---|---|---|---|
| R1 | **每学会一张新卡 +1 抽** | 1:1 | "学会" = 该卡**第一次**得到 `hard` / `good` / `easy` 评分。第一次评 `again` 不付；10 分钟重发后评到 `hard` 以上才付。每张卡**只付一次**，跨会话、跨天、跨设备都不重复（见 R5 账本） |
| R2 | **清空当天到期卡 +1** | 每天 1 次 | 当天所有到期卡（`isDueTodayBucket`）都已评分后触发一次；替代原来的"full clear +1"。按本地日历日去重 |
| R3 | 饥饿保底 | 1 抽/天 | 不变（`economyFloor.ts`：0 未学新卡 + 0 到期 + 0 抽时发） |
| R4 | 钱包上限 | **60 + 5 备用** | 从 30 提到 60：一天学 30 张的人不该被上限静默吞掉抽数；备用 5 不变 |
| R5 | 账本 | 按卡组 × 用户分区 | `newCardPullPaidUids:<slug>`（AsyncStorage，用户分区键同 `drawStateStore`）；付款前先查、付款后写；登录时 anon 分区并入用户分区（与 Wave A 的 A08 同一机制） |
| R6 | 不设每日新卡上限 | — | 拆掉 `sessionBuilder.ts:41` 的 1–2 张新卡额度；修 limit 公式（1 张新卡时 limit = 1）。**不拦截**任何数量的新卡 |
| R7 | 复习债预估（提示，不拦截） | 20 张起，每 10 张一次 | 当天第 20、30、40… 张新卡学完时显示一行"照这个节奏明天约有 N 张复习"，N 由当前进度按阶梯推算；没有确认框 |
| R8 | 总复习模式不给抽 | 0 | 考前总复习（Wave C 的 C04）只重排期、不付 R1；只有它顺带清空了当天到期卡时才触发 R2 |
| R9 | 评分只决定"何时付"，不决定"付不付" | — | 一张新卡最终一定会付一次（除非永远评 again）；正确率永远不进钱包，只进排期 |
| R10 | 对所有卡组生效 | C# 与 AWS 同一规则 | 卡组类型不改变经济 |

不变的：抽数不卖；稀有度 = 难度；卡池 = 未拥有；保底 Rare+ 10 张；一张 hard/good/easy 保连续天数；Mastered = stage ≥ 4；每场路线仍是 5 张一段（一天可以跑多段）。

## 3. 不变量重写

原不变量 4 改为：

> 4'. 奖励规则唯一：每张新卡在其首次 hard/good/easy 评分时付 1 抽且仅付一次（账本去重）；清空当天到期卡按本地日付 1 抽且仅付一次；minimumGoal 与正确率不改变抽数。

其余不变量（1、2、3、5、6、7、8）不变；5 中的 `reward = available增量 + reserve增量` 对 R1 每次付款和 R2 各自成立。

## 4. 为什么

- 吞吐：现规则稳态每天约 1 张新卡，154 张要 5 个月；备考的人需要每天 6–10 张。
- 自限：抽数永远等于学过的新卡数，不会通胀；卡池抽空自然停；刷 Easy 只伤刷的人自己。
- 公平：学得快的人不被拦；学得慢的人每天 1 张也一样有抽。
- 真实风险只有复习债（第一天学 60 张、第四天面对 120 张复习），用 R7 的预估提示让它可见，而不是用上限拦人。

## 5. 对现有测试与文案的影响（实现时的检查清单）

- `mobile/tests/unit/rewards.test.ts`：钉着 full clear = 1，重写为 R1/R2/R5 的性质测试（每 uid 只付一次；again 首见不付；重发 hard+ 才付；清空到期每天一次）。
- `SessionSummaryScreen` / `RewardSummaryCard`：奖励文案从 "+1 free pull" 改成 "+N pulls · N new cards learned" 与 "+1 · cleared today's due"。
- Home 的 `Clear today's route to unlock pulls` 一类 locked 文案（`homeSelectors.ts:227` 等）改为 "Learn a new card to earn a pull"。
- 上架文案（`docs/home-review-and-launch-copy-2026-09-17.md`）里所有 "1 pull per full clear" / "earn a pull by finishing today's review" 改为 "每学会一张新卡赚一抽"；红线表加一条"不能说 full clear +1"。
- Content Intelligence 不受影响（评分语义不变）。

## 6. 签字

- [x] 我同意用第 2 节的规则表替换裁决 6 与不变量 4，并在 `gacha-acquisition-learning-loop-plan.md` 与 `gacha-v7.md` 各加一行指向本文件。
- [x] 总复习模式不给抽（R8）。
- [x] 允许对冻结文件做以下例外：`src/content/deckRepository.ts` 两个 mapper 各加一行（`Topic`，之后 `Mcq`）；`src/sync/progressSync.ts` 加 `clientFeatures` / `updateId` 两个可选字段（Wave C 的 C14）。除此之外冻结继续有效。
