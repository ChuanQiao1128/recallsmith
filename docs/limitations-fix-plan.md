# 四项已知限制的修复计划(2026-08)

> 修复对象 = deepening-plan.md 与设计评审里**诚实标注过的四条限制**:
> A. stage↔interval 有损反推(服务端不存 stage)
> B. 游戏化状态不上云 + 未按 userSub 分区(换手机丢、换账号串)
> C. pity 按抽卡动作计数而非按张(十连玩家 10 倍成本)
> D. 未登录时的离线复习被静默丢弃
>
> 每条限制此前都被写进了注释/文档,现在逐条兑现。叙事上这是"把免责声明变成断言"
> 的一波:仿真器 syncedState() 上方那段 "stage is deliberately absent" 注释,
> 就是本次要**删掉并替换成断言**的东西。
>
> 基线(HEAD=03e1b39,已验证):mobile 66 files / 352 tests 全绿 + tsc 干净;src_C 86 全绿。
> 现有 migration 到 012;下一号 013(Fix A)、014(Fix B2)。

## 范围纪律

- **只修这四条**。设计评审 Tier 1 里的其它项(CTA 裁决、leech 负反馈、90 天上界 clamp、
  白名单扩字段)**不在本波**,不要顺手做。
- 服务端 C# 改动:编译 + 纯函数测试验证(Docker 仍未开,Testcontainers 后补)。
- 绝不 commit/push;不碰 " 2." 文件;注释英文、写"为什么"、禁 em-dash;改动最小化。

---

## Fix A · stage 上云 + schedulerVersion(2-3 晚)

**事实底座(已核实)**:客户端事件的 `progressAfter` 是完整 CardProgress
(ReviewScreen.tsx:526 / SessionCardScreen.tsx:412 发 `nextState.updatedOne`),
**stage 一直在 wire 上**;服务端 ProgressEvents.cs:112-125 只读了
`progressAfter.nextReviewAt` 和 `progressAfter.lastSeenRevision`,stage 读完即丢。
所以这不是协议变更,是**让服务端别再扔掉已经收到的东西**。

1. **Migration 013**(`src_C/Vpc/Db/Migrations/013_srs_stage_scheduler_version.sql`):
   - `user_progress` 加 `srs_stage smallint null` + `last_scheduler_version text null`
   - `user_progress_events` 加 `scheduler_version text null`
   - **列名必须是 `srs_stage`,绝不能叫 `review_stage`**——009 已把该名给了 text 型分析标签
     (progressSync.ts:631 在往那发字符串),撞名会静默写错列。
   - 全部 nullable = 向后兼容,无需回填(null = legacy 行,客户端可反推)。
2. **信封**:progressSync.ts 事件加 `schedulerVersion: 'ladder-v1'`(字符串;语义变更就换名,
   不递增数字)。服务端只存不解释——调度权赌注不变。
3. **摄入**(ProgressEvents.cs):解析 `progressAfter.stage`(int, clamp 0..6, 非法置 null)与
   `schedulerVersion`。合并算子:**srs_stage 与 last_scheduler_version 加入 due_at/last_rating
   已有的同一条 LWW 谓词分支**(`excluded.last_reviewed_at >= ...`)。
   **绝不用 greatest**——一旦未来 again 有降级语义,单调合并会让降级永久不可传播。
   这四列构成"原子裁决组":同一个谓词一次决定,杜绝 stage 来自设备 A、due_at 来自设备 B 的缝合态。
4. **ProgressGet.cs**:返回 `srsStage`(可空)。
5. **客户端 pull 合并**(progressSync.ts mergeRemoteIntoLocalProgress):在**接受远端 due_at 的
   同一个分支里**同时接受远端 stage(原子组在客户端的镜像);远端 stage 为 null(legacy 行)时
   保持现状:沿用 inferStageFromIntervalMs 的保守向下取整。model.ts 注释更新:反推从"唯一手段"
   降级为"legacy 行的回退"。
6. **仿真器**(multiDeviceSync.sim.test.ts):FakeServer 合并规则加 srs_stage(同 LWW 组);
   **删掉 syncedState() 上方那段 "stage is deliberately absent" 免责注释,把 stage 加进断言集合**。
   这是本波的叙事闭环:限制先被写下,后被兑现,免责注释变成断言。
7. **ProgressMerge.cs 规格**:加 SrsStage 进 LWW 组;代数律测试(结合/交换应仍过,
   幂等契约测试不变)。
8. 验收:全量 vitest + dotnet test 绿;新增"两设备不同复习次数,pull 后 stage 收敛一致"的
   仿真断言;C# 编译级验证,Testcontainers 后补(followup 注明)。

**为什么是 LWW 而不是 greatest**:stage 的语义是"最后一次复习后卡在第几级",不是"历史最高级"。
用 due_at 的谓词裁决,stage 永远与产生它的那次复习同源。

---

## Fix B1 · 游戏化状态按 userSub 分区(1 晚;B2 的硬前置)

**事实底座**:`drawStateStore.ts` 的 `devcards:draw-state:` / `devcards:draw-history:` 与
`rewardWallet.ts` 的 `recallsmith:reward-wallet:v1` / `recallsmith:reward-session:` /
`recallsmith:wallet-seeded:v1` 全是全局 key,无 userSub。对照 review/storage.ts:24
的 `USER_SCOPE_PREFIX = 'devcards:u:'`——复习进度早分区了,游戏化没有。
**今天就是 bug**:同一台手机换账号,B 账号继承 A 账号的图鉴/保底/钱包。

1. storage.ts 的 `getUserScopePrefix()` 是**模块私有**(storage.ts:64):导出它
   (或导出一个等价的 `getUserScopedKey(base)` 助手),不要在 gacha 侧重写一份。
2. 三类 key 的迁移策略**不一样**,这是本条的核心:
   - `draw-state` / `draw-history` / `reward-wallet`:分区 + **旧全局 key 一次性只读迁移**
     (照抄 drawStateStore.ts:96-97 已有的 legacy 读取模式)——老用户不能丢图鉴。
   - **`reward-session:`(sessionId 去重键):只分区,绝不做旧 key 回退**。回退的语义正好是
     "我已经付过款了",会让 B 账号误认 A 账号的 session 已结算而吞掉结算。
   - `wallet-seeded:v1`:分区;若旧全局标志存在,迁移给**当前登录用户**(同一人不重复领),
     此后新账号各自领 starter grant(per-user 语义,正确)。
3. 时序:gacha 状态的读取都发生在登录态确定之后吗?检查 App 启动与 user_changed 路径——
   如需要,复用 setActiveUserSubForStorage 的失效机制,在 user 切换时让 gacha 内存缓存失效。
4. 测试:两账号交替读写互不可见;去重键跨账号不回退;seeded 标志迁移一次性。

---

## Fix B2 · 游戏化状态上云(2-3 晚;依赖 B1)

**最小可行同步**,按数据的天然形状选算子——这正是"per-column 按语义选算子"的第三次应用:

1. **Migration 014**(`014_draw_state_sync.sql`):
   - `user_draw_owned(user_sub, deck_slug, stable_uid, created_at, primary key(user_sub, deck_slug, stable_uid))`
     ——owned 天然是 **grow-only set**,`ON CONFLICT DO NOTHING` 即幂等,最容易做对的一个。
   - `user_draw_meta(user_sub, deck_slug, pity_draws, pity_threshold, updated_at_ms, primary key(user_sub, deck_slug))`
     ——LWW 快照。
   - `user_wallet(user_sub, available_pulls, reserve_pulls, updated_at_ms, primary key(user_sub))`
     ——LWW 快照。
2. **服务端**:Vpc 新文件 `Runtime/DrawStateSync.cs`,一个端点
   `POST /api/v1/draw-state/sync`(路由挂 VpcFunction.cs):请求 = 本地新增 owned 列表 +
   pity/wallet 快照(带 updated_at_ms);处理 = owned 逐行 upsert(DO NOTHING)、
   meta/wallet 按 `updated_at_ms` LWW(**复用 eventTime 的教训:clamp 到服务端 now+5min**);
   响应 = 合并后的权威全量(该用户该 deck 的 owned 全集 + meta + wallet)。
   单往返,无分页(owned 每 deck 上限 = 卡组大小,几百量级,可接受;注释说明这个前提)。
3. **客户端**:新文件 `mobile/src/sync/drawStateSync.ts`:push 本地状态 → 应用服务端响应
   (owned = union 后整体替换;pity/wallet = 采纳服务端裁决结果)。触发时机挂进 progressSync
   现有的 scheduleProgressSync 触发点(app_start / manual / token_set / user_changed),
   **不新建触发体系**。离线不可用时静默跳过(下次触发重试)——游戏化同步失败绝不能
   阻塞复习同步。
4. **已知取舍写进注释**:两台离线设备各自消费 pull 后,钱包 LWW 只保留一台的结果
   (金额小、可接受;真正的修法是钱包事件化,列为 followup)。sessionId 去重记录**不上云**:
   session 本身是设备本地生成的,跨设备重复结算按构造不可能——注释说明这个论证。
5. 测试:客户端合并逻辑单测(union/LWW/clamp);服务端编译 + ProgressMerge 式纯函数规格
   (如便于,加 `DrawStateMerge.cs` 三行为算子的小规格 + xunit);Testcontainers 后补。

---

## Fix C · pity 改按张计数(1-2 晚)

**事实底座**:poolSelection.ts:132 `draws: Math.min(pityNext.draws + 1, threshold)`——
一次 `selectDrawCards` 无论抽几张只 +1。文案已改成 "draws" 兜住诚实,但机制本身
(十连玩家 10 倍成本)现在**裁决为修掉**:玩家的心智模型是"张",保底就该按张。

1. **计数语义**:pity 计数 = "自上一张 RAR+ 以来连续揭出的 COM 张数"。
   - 本次抽出序列里含 RAR+(自然或保底):计数重置为**该序列最后一张 RAR+ 之后的 COM 张数**。
   - 不含:`draws = min(draws + cardsDrawn, threshold)`(保留 cap 不变量)。
2. **保底触发升级为"抽内触发"**:若 `draws + drawCount` 会在本次抽内越过 threshold,
   且前 `threshold - draws` 张无自然 RAR+,则在越界位置注入保底卡(沿用现有 forced 注入路径)。
   玩家面向的承诺变为一条干净的不变量:**只要池中还有未拥有的 RAR+,
   连续揭出的 COM 永远不会超过 threshold 张**。
3. **性质测试更新**(poolSelection.properties.test.ts):
   - 原 P5(域封闭)改为:`pityNext.draws ∈ [0, threshold]` 且等于输出序列尾部 COM run 长度
     (池中有 RAR+ 时)。
   - 保底承诺改为上面那条 run-length 不变量:任意 pull 序列、任意 seed,
     COM 连续 run ≤ threshold。
   - 纯 COM 池:计数 cap 在 threshold(不变量保留)。
4. **文案**:pity.ts 两个 label 回到按张措辞("X/10 cards until guaranteed RAR+")——
   机制修对之后,原来的"张"直觉就是对的了。
5. **模拟脚本**:pity-simulation.ts 重跑,注释里的期望数字更新
   (单抽与十连的每张成本应当持平——这本身就是修复生效的证明,把前后对比写进注释)。

---

## Fix D · 未登录的离线复习不再丢(1-2 晚)

**事实底座**:recordReviewEvent 拿不到 accessToken 就 `return null`,事件根本不产生
(progressSync.ts:577 附近的 known-limitation 注释就是本条要兑现的)。

1. **pending 分区**:常量 `PENDING_SUB = '__pending__'`。无 token 时事件照常生成
   (UUID、progressAfter 齐全),入队到 `devcards:u:__pending__:sync:progressQueue:v1`,
   **走同一个 withQueueLock 串行器**(它按 userSub 参数化吗?检查——若锁是全局单链,
   直接复用;若按 sub 分链,给 pending 一条)。上限沿用 3000。
2. **收养(adoption)**:登录/token_set/user_changed 拿到真实 sub 时:
   读 pending 队列 → 按 eventId 去重后追加进该用户队列(保序)→ 清空 pending → 触发 sync。
   顺序必须是 **copy 后 clear**:崩在中间产生的重复由两层兜底
   (收养时 eventId 去重 + 服务端 event_id 主键),注释写明这个论证。
3. **合并策略写成注释**(这是当初标注 known-limitation 的原因,现在把决策写下):
   "本设备下一个登录的账号收养全部 pending 事件。依据:个人设备上,登录前复习的人
   与随后登录的人是同一人。共享设备场景存在错收风险,接受并记录;
   事件是 UUID 幂等事实,错收不会破坏服务端不变量,只会把复习记到收养者名下。"
4. **进度投影**:匿名期的本地进度留在其原 scope 不迁移;收养只搬事件(事实)。
   用户的投影经由 push→server 合并→pull 回流对齐——正好是"事实先于投影、
   投影可从事实重建"的活演示,注释点明。
5. progressSync.ts:577 的 known-limitation 注释**删除**,替换为指向 pending 分区实现的说明。
6. 测试:未登录评分 → 事件持久化于 pending;登录 → 收养且只收养一次(重复调用幂等);
   收养后 push 正常;两次崩溃注入(copy 后 clear 前)不产生服务端可见的重复。

---

## 执行顺序与并行

```
Phase 1: Fix A(动 progressSync.ts + 服务端,先做)
Phase 2: Fix B1 ∥ Fix C ∥ Fix D(三者文件不相交:
         B1=drawStateStore/rewardWallet,C=poolSelection/pity/脚本,D=progressSync 队列段
         ——D 与 A 都动 progressSync.ts,故 D 必须在 A 之后,与 B1/C 并行没冲突)
Phase 3: Fix B2(依赖 B1;服务端+客户端新文件)
Phase 4: 终验(全量回归、diff 越界审查、四条限制逐条核销、commit 切分草稿)
```

## 完成定义

四条限制的原始"免责文本"全部退役:
- 仿真器 "stage is deliberately absent" 注释 → 删除,stage 进断言
- deepening-plan.md §6 里"游戏化状态不上云"与"多设备合并仅限复习进度"的措辞 → 由终验 agent
  更新为已修复(注明 wallet LWW 的残余取舍)
- pity "这是产品决策留给用户定" → 已裁决:按张
- progressSync "未登录复习被丢弃" 注释 → 删除,替换为 pending 分区说明
