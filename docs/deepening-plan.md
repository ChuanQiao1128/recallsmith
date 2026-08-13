# DeveloperCards 深挖计划(2026-08)

> 主线一句话:**不新写功能,把已有代码里"已经在做但没被说清楚的不变量"逼出来**——
> 写下来 → 修掉违反它的代码 → 用测试证明它成立 → 讲出来。
>
> 本计划基于 2026-08-11 对全仓的三路盘点(正确性/同步、游戏化设计、测试与代码质量),
> 所有文件行号以当日 HEAD 为准。实测:mobile 269 tests + src_C 83 tests = 352 全绿。

---

## 0. 为什么是这个计划,而不是"继续做功能"

**这个项目的运气在于:你已经无意识地把编程里最硬的几个基础概念全都做过一遍了**——
原子性(6 个 CTE 的单条摄入 SQL)、幂等(event_id 主键去重)、单调合并(greatest)、
纯函数与确定性(seed 显式传参的抽卡)、协议兼容(微秒 keyset 游标)。
但它们散落在代码里,没有名字、没有测试背书、有几处自相矛盾。

同时盘点发现了 **5 个真 bug、9 个从没被执行过的测试文件(1659 行)、5 个未裁决的设计矛盾**。
每一个都恰好是一堂可迁移的概念课。

所以计划的取向是:
1. **不变量驱动,不是功能驱动**——深度来自"我守护什么",不来自"我做了多少"。
2. **每个 bug 修复 = 一个概念的实证**——学习目标和工程收益合一,没有为学而学。
3. **每晚一个时间盒**——求职冲刺期,任何一晚中断,已完成的部分独立成立。
4. **一切可被外人验证**——面试官 clone 下来跑 CI 就能复现每个数字。

---

## 1. 已确认的资产(不要动,面试主讲)

| 资产 | 位置 | 为什么值钱 |
|---|---|---|
| 6-CTE 原子摄入 | `src_C/Vpc/Runtime/ProgressEvents.cs:245-396` | 事件插入、outbox、聚合 upsert 的数据源是同一个 `RETURNING`——"事件写了但 outbox 漏了"物理上不可能。同批同卡先在 SQL 内折叠,绕开 `ON CONFLICT cannot affect row a second time` |
| 微秒 keyset 游标 | `src_C/Vpc/Pagination/KeysetCursors.cs` + `ProgressGet.cs` | 事务内 `now()` 恒定→整批同时间戳→毫秒游标翻页活锁;修复论证了 float64 误差 <0.5µs;旧游标降级"宁可重发不可跳过";客户端 400 自愈 |
| 抽样偏置的推翻与锁定 | `poolSelection.ts:31-37` + `poolSelection.test.ts` | "复习过的卡 3× 权重"→图鉴从 #001 连亮一块→回退均匀抽样→1000-seed 统计测试锁死(注释里算了 stdev 论证阈值)。**把 UI 直觉不适翻译成可执行统计断言** |
| autopilot 脚本 | `mobile/scripts/run-screen-quality-autopilot.sh` | 确定性 gate(typecheck/测试/≥800行拒绝/禁 hex 色值/禁损失感词)+ draft-2020-12 schema 约束的 critic + 路径白名单修复 agent。比简历写的还多三个 gate |
| "为什么"型注释文化 | `constants.ts:2-7`、`rewardResolver.ts:11-17` 等 | 记录被真机反馈推翻的数字(20 张惩罚感→5 张)。这是"设计热爱"的直接证据 |

**面试故事的修正(重要)**:不要再讲"合并设计约束了调度算法"的版本。真实设计是——
**调度权完全在客户端**(`review/model.ts`,95 行固定阶梯 `[1,2,4,8,15,30,60]`,无 SM-2 无 ease factor);
**服务端刻意不重算调度,只守一行不变量**(`nextReviewAt >= eventTime`,ProgressEvents.cs:108);
**合并按列选算子**:计数=去重后加法、时间戳/revision/status=greatest 单调、due_at/rating=按事件时间 LWW。
简历措辞用:*per-column deterministic merge (additive counters + monotonic greatest + timestamp-ordered LWW)*。

---

## 2. 三条不变量(第一晚之前先写进 README)

- **A(同步)**:同一组复习事件,无论到达顺序、重复几次,服务端终态逐字节相同。
- **B(抽卡)**:一次抽卡的 owned 入库与 pity 推进**同生同死**;记录 seed 后任何一次抽卡可精确重放。
- **C(经济)**:同一 sessionId 至多结算一次;钱包余额 = 初始 + Σ结算 − Σ消费,任何并发交错下成立。

---

## 3. 修复计划(按晚排,每晚独立成立)

### Night 1 · 让"352 个测试"变成任何人 clone 都能跑出来的数字

**做**:
1. `mobile/vitest.config.ts` include 加 `tests/**/*.spec.ts(x)` 两组 glob——
   **9 个 .spec 文件共 1659 行测试从没被执行过**(其中 `deckActionResolver.spec.ts`、
   `homeSelectors.spec.ts` 对应的模块目前实际零覆盖)。跑一遍,修掉挂的。
2. 删掉被 .test 版取代的旧副本(`home-cta-target.spec.tsx`、`home-primary-cta.spec.tsx`)、
   一行 wrapper `draw-ownership-cycle.test.tsx`、`src_C/Tests/.../UnitTest1.cs` 空模板。
3. 新建 `.github/workflows/ci.yml`:mobile vitest + src_C dotnet test,README 挂徽章。

**为什么**:测试发现是**配置驱动**的,"写了测试"和"测试在跑"隔着一个 glob。
这个仓库把同一个认知错误犯了三次:1659 行死测试、outbox publisher 没有任何 cron 触发器、
manifest rebuild 发到一个没有订阅者的 SQS 队列(`ManifestService.cs:34` 的生产者没有消费者)。
**"任何自动化没有一个可被观察的成功信号,它就等于不存在"**——这句话值一段面试回答。

**产出**:绿色 CI 徽章;诚实的测试总数;一段自省型面试故事(仓库里那个一行 wrapper
证明过去的你发现过这个坑但只修了 1 个)。

### Night 2 · 抽卡原子性 + seed 可复现(不变量 B)

**做**(全部在 `mobile/src/features/gacha/draw/`):
1. `drawCommit.ts:48-51` 的 `markCardsOwned` 与 `savePityState` 是两次独立 AsyncStorage 写,
   中间被杀=撕裂。合并进单 key(如 `devcards:draw-state:{slug}`)一次 `setItem`,
   带旧双 key 一次性迁移。补"第一次写就 throw"的崩溃注入测试。
2. `drawCommit.ts:43` 的 `seed: Date.now()` 从不持久化——**可测试但不可复现**。
   抽卡记录 `{drawId, seed, ownedBefore, pityBefore, drawnUids}` 进环形缓冲(50 条),
   加 `replayDraw(drawId)`:重放并断言与当时结果一致。
3. `rewardWallet.ts:161-215`:dedupe key 和钱包写在同一个 `Promise.all` 里——
   **幂等机制自身不幂等**。改成 dedupe 先落盘再改钱包(崩溃方向=宁可少发,
   奖励可补、信任不可补),注释写明"我选了错哪一边"。

**为什么**:三个概念一次学透——
**原子性不是 API,是把状态重新分组的设计手法**(AsyncStorage 没有 BEGIN,收敛成一次
setItem 就是自己造事务边界;代价是耦合与写放大,这是真实取舍不是免费午餐);
**幂等的顺序法则**(去重记录必须先于副作用持久化;崩溃面前只有"少做一次"和"多做一次"
两个方向,必须显式选边);**可测性 ≠ 可复现性**(seed 是参数让你能测,seed 被持久化才让你
能复现线上投诉)。
而且这是全仓最好的**自带对照组**:同一个作者,同一个"一次操作要么全生效"的不变量,
后端用 6-CTE 做到教科书级,客户端是两次裸写——"我在后端设防、在客户端默认不需要,
这个默认本身就是 bug"。

### Night 3 · 同步队列的三个破绽(不变量 A 的客户端半边)

**做**(全部在 `mobile/src/sync/progressSync.ts` 与两个 screen):
1. `enqueueProgressEvent`/`removeProgressEventsById`(`:346-370`)是无互斥的
   read-modify-write:sync 出队与打分入队交错 → **复习事件永久丢失且用户无感**
   (本地进度已写好,只有换设备才发现)。修:20 行 promise-chain 串行器,
   配 2 个交错注入测试(修之前红、修之后绿)。
2. `ReviewScreen.tsx:509→512`(及 `SessionCardScreen.tsx:396/398`)写序颠倒:
   进度先落盘、事件后入队,中间被杀=服务端永远不知道这次复习。
   而 `progressSync.ts:38` 的设计注释写的是正确顺序——**代码违反了自己的注释**。
   修:先写事件再写进度(intent 先于 projection),或 `multiSet` 原子双写。
3. 顺手记录:`recordReviewEvent` 未登录时 `return null` 直接不入队(`:550`)——
   离线未登录的复习永久静默丢失。本期不修,写进 README 的 Known limitations。
4. 删掉孤儿文件 `mobile/src/sync/progressQueue.ts`(整个文件零外部调用者,
   是重构残留;讽刺的是死掉的这份有 eventId 去重,活着的那份没有)。

**为什么**:**单线程 JS 照样有并发 bug**——竞态不需要多线程,只需要两次 await 之间
状态被别人改了;**事实与缓存的分层**(事件是事实、进度是投影;事实丢了永远没了,
缓存丢了可重建——所以唯一正确的写序是先事实后缓存)。

### Night 4 · 调度器性质测试 + foldProgress(10 行)

**做**(`mobile/src/review/model.ts`,95 行纯函数,全仓最适合入门 property test 的地方):
1. `npm i -D fast-check`。5 条调度不变量:未来性、域封闭(stage 恒在 [0,6],
   喂 NaN/Infinity/-5 验 clamp)、单调性、again 语义(+10min 且 stage 不变)、
   **round-trip:`inferStageFromIntervalMs(next - last) === stage`**。
2. round-trip **必挂两处**(这是预言,验证它):hard 在 stage 4 时 15×0.7=10.5 天
   最近邻落错桶;again 的 10 分钟反推恒为 stage 0。这就把
   "换新设备卡片等级会掉"从体感升级成**机器可证的真 bug**(model.ts:62 的注释
   本来就是这个生产事故的补丁)。修法三选一并写下理由:服务端存 stage(3 行+一条
   migration)/反推不确定时拒绝/接受有损但把损失方向固定成"宁可低估多复习"。
3. `foldProgress` 10 行:`scheduleNextReview` 已经是 `(State, Event) -> State`,
   补一个 `events.sort(by at).reduce(...)`,再写一条一致性断言:
   **projection == fold(log)**。

**为什么**:**离散↔连续的有损转换**是所有编解码/序列化共有的问题,
`decode(encode(x)) === x` 必须显式验证而不是默认成立;
**事件溯源不是 Kafka,是一个 reduce**——"我的项目早就是事件溯源的了,
我只是没写下那个 fold";**可重放性是纯函数的红利兑现**(时间是参数不是 `Date.now()`,
所以才能重放)。

### Night 5 · 抽卡 property test + 保底的真实数学

**做**(`poolSelection.ts`,106 行纯函数):
1. fast-check 6 条性质:绝不重复、绝不发已拥有、数量守恒
   `=== min(drawCount, missing.length)`、同 seed 确定性、pity 状态机域封闭
   (`draws` 要么 0 要么 +1 且 ≤ threshold)、保底承诺(达阈值且池中有 RAR+ 时必出)。
   生成器**故意允许重复 StableUid**——生成器就是你对输入契约的可执行假设。
   预言:**纯 COM 卡池下 pity 计数无界增长**(保底逻辑只在找到 LEG/RAR 时归零),
   fast-check 会自动 shrink 出最小反例。
2. `mobile/scripts/pity-simulation.ts`(30 行,10 万次模拟):现状一次
   `selectDrawCards` 调用无论抽几张 `draws` 只 +1,而文案写 `"${n}/10"`暗示按张——
   **十连玩家要 100 张才保底,是单抽玩家的 10 倍**。先算出两种玩法的期望与分布,
   **再决定改机制还是改文案**,结论写进注释。

**为什么**:**性质测试是把测试从举例升级成规格说明**——例子断言"输入 A 得 B",
性质断言"对所有输入这句话成立",逼你先想清楚不变量;
**概率直觉必须靠计算校准**——threshold=10 在两种玩法下含义差 10 倍,只有算过才知道;
shrinking 教会你"最小复现是机器可求的"。

### Night 6-7 · 多设备同步仿真器 + 合并的代数性质(不变量 A 的完整证明)

**做**:
1. 150 行纯内存仿真器(不碰 AsyncStorage 不碰网络):
   `FakeServer` 用 TS 精确复刻 6-CTE 的合并规则;N 台 `FakeDevice` 调**真实的**
   `scheduleNextReview` 与 `mergeRemoteIntoLocalProgress`;seeded RNG 随机交错
   review/push/pull/断网。断言:收敛性(全设备终态一致)、顺序无关性(shuffle K 个
   排列终态不变)、时间戳单调。200 个 seed,<2s。
   预言:服务端全过;**客户端挂**——`mergeRemoteIntoLocalProgress:811` 的严格大于
   在 `updatedAt` 相等时依赖到达顺序,破坏交换律。修:比较键改成
   `(updatedAt, stableUid)` 元组稳定 tiebreaker。
2. `src_C/Vpc/Runtime/ProgressMerge.cs`(40 行纯函数,**SQL 一行不改**,身份是
   可执行规格):xunit 写三条代数律——结合律、交换律、幂等律。
   预言:**幂等律挂**,因为 `review_count` 用加法,加法不幂等;生产上整体幂等是因为
   event_id 去重在上游挡掉了重复。把"**加法的幂等性由去重表提供,不是合并函数**"
   写成显式契约测试——将来谁绕过去重直接写,这条测试就叫。
3. 服务端一行修复:`least(eventTimeMs, now + 5min)` 上界 clamp
   (`ProgressEvents.cs:95` 目前无上界)。一台时钟 2030 年的设备一次同步就用
   `greatest()` 永久毁掉该用户的合并——**单调的东西不可撤销**,这就是它的代价。

**为什么**:**可交换+可结合+幂等 = 半格 = 冲突在数学上不存在**,这是 CRDT 的全部
数学基础,而你的 SQL 已经凭直觉按语义给三类字段选对了三种算子——仿真把"凭直觉"
变成"我能证明"。更值钱的一课:**能说出"我的哪条性质由哪一层保证"**
(幂等由去重层、收敛由算子代数、单调由 greatest)才算真的理解一个系统。

### Night 8(可选)· Testcontainers 真 Postgres 对抗测试

**做**:`IntegrationTestBase.cs` 目前是 **0 字节空文件**,而 .csproj 里
Testcontainers.PostgreSql 3.10.0 早就装好了——把它填成 40 行(起容器、跑 12 个
migration、`Pg.Reset()`),然后直接调 `ProgressEvents.HandleProgressEvents`
(public static,伪造 API Gateway JSON 即可,真端到端)。
六个对抗用例:重放 ×10、乱序、跨批重复、时钟回拨、同批同卡多事件、outbox 一致性。
顺手 3 行 SQL 修 outbox `processing` 黑洞(claim 条件加
`or (status='processing' and updated_at < now() - interval '15 minutes')`——
照抄你自己 `JobRepository.cs:24` 的死工回收;同一个人在两处做了不一致的决定,
这个对比本身就是面试素材)。

**为什么**:简历上最硬的一句"复习摄入是一个原子事务"目前是**零测试背书的声称**;
做完它就有了。且"脚手架躺在那从没被用过"是一句诚实的好故事。

---

## 4. 设计裁决(1-2 晚,主要是做决定、写注释,几乎不写码)

五个矛盾,各给一个**明确裁决**并按你已有的注释文化写进代码:

| # | 矛盾 | 裁决建议 | 动作 |
|---|---|---|---|
| 1 | `homeSelectors.ts:279-395` 只要有 pull 主 CTA 就变"去抽卡";而 `drawState.ts:71` 文案自称"follow-up reward, not today's main task" | **学习优先**(与自己的文案一致) | 有 due 卡时 CTA=学习,抽卡降次级入口;注释记录裁决 |
| 2 | pity 机制存在、有测试,但 `buildPityProgressLabel` 零调用方、`pityTriggered` 传进仪式屏从未渲染 | **可见化** | 一行 UI 接进 DrawScreen;不可见的保底不产生情绪价值 |
| 3 | 稀有度=难度(`cardRarity.ts` 15 行):用最盛大的仪式庆祝最难的知识点;而 boss 节点按 index 分配不认稀有度 | **不改机制,改叙事+对齐** | 写成 ADR("最难的知识值得最盛大的庆祝"是产品价值观);`sessionRoles.ts` 让 boss 优先选 LEG,两层自洽 |
| 4 | 抽卡对学习没有门禁(`pickNextCard` 无 unlockedSet;图鉴 Missing 是 SRS 状态的马甲) | **裁决为刻意设计** | 写下"知识不该锁在抽卡后面;图鉴=收集荣誉,学习=永远自由"——这句价值观本身就是面试亮点 |
| 5 | 两条平行链路:真链路旁边有 mock 链路(`SettlementScreen.tsx:22-31` **伪造 ratings**;两套发奖公式矛盾;38/71 屏吃 mock) | **砍/藏** | mock 屏从导航摘除(不删文件);App 面积小一半,完成度翻倍 |

**为什么**:设计能力的证据不是"做了多少机制",是**每个张力有过裁决、且能讲出为什么**。
你已经有一次教科书级的裁决(抽样偏置),这一晚是把剩下五个补齐。

---

## 5. 讲述层(1 晚)

1. **README 重写**:三条不变量开头 → 三个故事(6-CTE / 微秒游标 / 抽样偏置的推翻)
   → CI 徽章 → Known limitations(未登录不入队、游戏化状态不上云、outbox 手动触发)。
2. **简历 bullet 更新**(做完 Night 1-7 才诚实成立):
   - "242 tests" → CI 徽章上的真实数字 + "gated in CI on every push (TS + C#)"
   - "多设备确定性合并" → "per-column deterministic merge (additive counters +
     monotonic greatest + timestamp-ordered LWW), verified by a 200-seed multi-device
     simulation asserting convergence and order-independence"
   - 新增一条:"property-tested the SRS scheduler's stage↔interval round-trip,
     which surfaced and fixed a real cross-device regression"
3. **自举卡组 "Lessons from building this app"**:Night 1-7 修的每个 bug 写成一张卡
   ("两个 async 函数都做 read-modify-write 会怎样?"/"为什么 greatest() 毁掉后无法
   恢复?"/"去重标记该在副作用之前还是之后?")。App 教概念,做 App 的过程本身成为
   内容——"帮到其他人"的初衷直接落地,而且是独一无二的作品集记忆点。

---

## 6. 明确不做的事(求职期纪律)

- ❌ 不换 SM-2/FSRS——固定阶梯 + `inferStageFromIntervalMs` 的有损反推是**更好的故事**
- ❌ 不做游戏化状态上云(owned/pity/wallet 换机即丢)——README roadmap 诚实标注;
  简历措辞把"多设备合并"**限定在复习进度**
- ❌ 不实现 docs/gacha-system-design.md 的经济系统(双券/每日签到/premium pity)——
  该文档与实现已是两个产品,在文档头部标注 superseded
- ❌ 不重构架构、不清理全部 any、不补 frontend(零测试)的测试
- ❌ mock 屏只摘导航,不重写数据层

**为什么**:你的目标是两周内让这个项目**可讲、可证、可信**,不是让它完美。
每一条"不做"都换回一晚睡眠或一晚上面的 Night。

---

## 7. 每晚产出的面试资产速查

| 晚 | 概念 | 一句话面试资产 |
|---|---|---|
| 1 | 测试发现是配置驱动的 | "我发现 1659 行测试从没跑过——同一个错误我在仓库里犯了三次,教训是:没有可观测成功信号的自动化等于不存在" |
| 2 | 原子性=设计手法;幂等顺序法则;可测≠可复现 | "后端我用一条 SQL 保证原子,客户端同一个概念我写了两次裸写——AsyncStorage 没有 BEGIN,我就默认不需要,这个默认就是 bug" |
| 3 | 单线程也有竞态;事实先于缓存 | "我的注释写了正确的写入顺序,代码违反了它;修复的测试先红后绿" |
| 4 | 有损转换与 round-trip;状态=事件的 fold | "我给调度器写了条 round-trip 性质,它挂了两次——'换设备等级掉'从用户投诉变成机器可证的 bug" |
| 5 | 性质测试=规格;概率靠计算不靠直觉 | "fast-check shrink 出一个我没想到的反例:纯普通卡池里保底计数无界增长" |
| 6-7 | 半格;哪条性质由哪层保证 | "结合律交换律过了,幂等律挂了——因为加法的幂等是由上游去重表提供的,我把这个跨层契约写成了测试" |
| 8 | 信任边界;单调不可撤销 | "服务端信任客户端时钟,而 greatest 没有回退路径——一行 clamp 的教训" |
