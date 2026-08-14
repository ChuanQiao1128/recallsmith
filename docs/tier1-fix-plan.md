# Tier 1 修复计划(2026-08,设计评审后续)

> 来源 = 设计评审(五路批判 + 对抗验证)的 Tier 1 清单。原表 5 项,
> **#4(游戏化分区)已在 limitations 波完成**(commit ea4ce3e),本波做剩余 4 项:
> #0 白名单(硬前置)→ #1 调度器负反馈 → #2 主 CTA 归学习 + 保底接线 → #3 同步层四条静默丢失。
>
> 基线(HEAD=bc33498,已验证):mobile 69 files / 384 tests 全绿 + tsc 干净;src_C 95 全绿。
> migration 下一号:015。

## 范围纪律

- 只做本文四项。学习设计的机制二/三(掌握度品相、boss 选卡)、Tier 2 全部不碰。
- 绝不 commit/push;不碰 " 2." 文件;注释英文写"为什么"、禁 em-dash;改动最小化;
  C# 编译级验证,Testcontainers 留 followup。

---

## #0 · normalizeProgressEntry 白名单(30 分钟,并入 #1 的 agent,先做)

`mobile/src/review/storage.ts` 的 normalizeProgressEntry 是字段白名单,末行硬编码
`return { stableUid, stage, lastReviewedAt, nextReviewAt, lastSeenRevision }`——
任何新字段在下一次 loadDeckProgress 被无声抹掉。

1. 按现有 normalizeNumber 模式补 `lapses` / `hardStreak` / `revisionDemotedAt`
   (三个都是可选非负数)进白名单与 return。
2. 函数上方加注释:"This function is the AsyncStorage schema. Adding a field to
   CardProgress without adding it here creates a field that exists only in memory."

**为什么先做**:不做,#1 的 hardStreak 每次读盘归零(`>=3` 永不触发),#3 的
revisionDemotedAt 活不过它唯一要活过的那个窗口。这是"功能存在 vs 功能生效"的元实例。

## #1 · 调度器负反馈(2-3 晚)

`mobile/src/review/model.ts`:stage 目前是只升不降的棘轮(again/hard 都是
`Math.max(0, currentStage)`)。后果:stage 6 连续 hard 永远 42 天;用户最不会的卡
复习频率反而最低。

1. CardProgress 加 `lapses?: number`、`hardStreak?: number`(#0 已入白名单)。
2. again:`stage = max(0, stage - 2)`、`lapses + 1`、hardStreak 归零、仍 +10min。
   选 −2 不选归零:一次手滑不该让 stage 6 退回原点;stage ≤ 2 自然饱和到 0。
3. hard:`hardStreak + 1`;满 3 次 → `stage - 1` 且 streak 归零;未满 → stage 不变,
   间隔仍 0.7×。阈值 3 沿用 levelFlow.ts:63 已写对(但从未生效)的判据。
4. good/easy:hardStreak 归零。
5. **性质测试必须有意识地重写**:scheduler.properties.test.ts 的 P4 现在断言的是
   "again → stage 不变"——**旧性质把 bug 写成了规格**。重写为新语义并在注释里点明:
   "The previous property asserted the ratchet. A test proves the code matches
   itself, not that it matches the need." 单调性(good/easy)与 round-trip
   "永不高估"性质应仍成立,验证之。foldProgress 一致性测试不受影响。
6. **仿真器加一条断言**:设备 A 触发降级后,设备 B pull 之后 stage 收敛到降级值——
   这正是 Fix A 选 LWW 不选 greatest 的原因,现在有了第一个真实受益场景,测试点名这一点。
7. levelFlow 的 leech 文案("dropped back to new-card status")仍在 mock 链路里且与
   −2 语义不符——不改(mock 链路不在本波),followup 记录。

## #2 · 主 CTA 归学习 + 标签欺骗 + 保底接线(1 晚)

`mobile/src/features/gacha/selectors/homeSelectors.ts`:六个分支只要 `drawReady`
就让抽卡抢主按钮;`drawLabel` 会显示 "Open ${deckTitle}" 但点进去是抽卡屏。

1. **纯 kind 白名单**:只有 `today_full_clear` 与 `nothing_to_learn` 两个 kind 允许
   draw 占主按钮;其余分支的 `if (drawReady)` 直接删,走学习。不穿线新布尔参数——
   kind 本身已编码答案。wallet-full 的 nudge 保留为次级文案,不夺主位。
2. **标签诚实**:draw CTA 文案不得含 deck 标题;改为如实的 "Open reward draw" /
   "N pulls ready" 类措辞(读现有 drawState 文案风格对齐)。
3. **保底可见**:DrawScreen 渲染 buildPityProgressLabelV9(现在零调用方);
   若 pityTriggered 已传进 Ceremony/Result 的 params,补一个最小可见标记
   (如结果页一行 "Guarantee")。不做新动效。
4. 测试:homeSelectors 用例更新 + 新增 "due>0 且钱包有 pull → 主 CTA 是学习";
   标签断言;pity label 渲染断言。

**为什么**:主按钮每天对用户说的那句话,就是 App 对"你今天为什么来"的官方回答;
标签欺骗一次,用户此后每次点击都要犹豫。保底的全部产品价值 100% 依赖可见性,
成本已付,一分收益没收。

## #3 · 同步层四条静默丢失(2-3 晚;必须在 #1 之后跑,同文件 storage.ts)

四条都是"所有层报成功、日志一行没有":

1. **永久流放(可达性 bug)**:`ProgressEvents.cs` 对 nextReviewAt 只有下界。
   加 `if (nextReviewAtMs > eventTimeMs + 90d) nextReviewAtMs = eventTimeMs + 90d;`
   (90 = 最大阶梯 60 天留余量,注释与 model.ts INTERVALS_DAYS 互指);
   客户端 mergeRemoteIntoLocalProgress 同样 clamp(防旧服务端)。
   **必须配 migration 015 一次性 UPDATE 回填**越界行(due_at 拉回
   last_reviewed_at + 90d)——只改摄入路径,已中招的行永远留在 2030 年。
   注释写清让了什么:"The invariant guards a physically impossible value, not the
   current algorithm's range: it survives ladder changes."
2. **不确定终态**:`distinct on ... order by event_time desc` 在并列时由执行计划决定
   (我们自己的 clamp 把并列从罕见变成系统性)。补 `, event_id desc` 末位 tiebreak;
   TS FakeServer 镜像同款;注释说明真 SQL 的不确定性只能 Testcontainers 验证。
3. **revision 降级被撤销**:storage.ts 的 revision 检查把过期卡拉回 now,但下一次
   pull 的 Case A/B 会用远端未来 due_at 覆盖回去——内容更新的重学永远不来。
   修:降级时写 `revisionDemotedAt = now`(#0 已入白名单);merge 侧当本地
   revisionDemotedAt 晚于远端 lastReviewedAt 时保留本地 nextReviewAt
   (本地意图赢,直到真实复习发生);真实复习后清除该字段。测试覆盖
   "降级 → pull → 卡仍然 due"。
4. **队列丢弃无消费者**:enqueue 超 3000 静默丢最旧。加持久化 droppedCount
   (按分区,含 __pending__),暴露进 getProgressSyncDebugState;若存在真实(非 mock)
   Settings 屏可低成本挂一行则挂,否则 debug state + followup。测试:越界丢弃计数递增。

## 执行顺序

```
Phase 1: #0+#1(一个 agent,model.ts/storage.ts/性质测试/仿真)∥ #2(homeSelectors/DrawScreen)
Phase 2: #3(ProgressEvents.cs + migration 015 + storage.ts revision 段 + progressSync merge)
Phase 3: 终验(全量回归、越界审查、性质重写核对、commit 草稿)
```
