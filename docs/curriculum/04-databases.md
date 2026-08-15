# 支柱四:数据库(SQL + NoSQL)

> **卡片是"素材"不是"成品"。** 录入时请用自己的话重写 A 面,重写本身就是学习:
> 如果你只能照抄,说明这张卡你还没懂;如果你能换个说法讲一遍,说明它进你脑子了。
> 难度标签是诚实的自评基线,录入后按你自己的实际感受调整。
>
> 本文档的锚点全部指向你自己的代码。出现具体文件名时,建议先把文件打开放在旁边,
> 边读边对。你已经写过这些东西了,这里要做的只是把它们的名字和边界补上。

---

## 1. 关系建模(范式的直觉版)

### 概念讲解

**Mental model:一张表给每个事实分配唯一住址。**

范式化不是学术洁癖,它只在回答一个问题:"这个事实,系统里有几份拷贝?"
一份 = 改它只要改一处,不可能自相矛盾。两份 = 你从此欠下一笔债,
必须有人(某段代码、某个事务、某个定时任务)保证两份始终一致。
重复本身不是罪,**无人负责的重复**才是。

**三个范式的口语版**,一句话就能背下来:
> 每个非键列必须依赖键,依赖**整个**键,且**只**依赖键。

- **1NF**:每格一个值。不要往一列里塞逗号分隔的列表,因为你从此无法索引它、
  无法 JOIN 它、无法约束它。你的 `user_progress_events` 里 `stable_uid` 是单值,
  这就是 1NF。
- **2NF**(依赖整个键):复合主键场景才有意义。假设主键是
  `(user_sub, deck_slug, stable_uid)`,而你往这张表里塞了一列 `deck_title`,
  它只依赖 `deck_slug`,不依赖整个键。结果:同一个牌组的标题在几万行里重复,
  改个标题要 UPDATE 几万行,漏改一行就出现两个真相。
- **3NF**(只依赖键):非键列不能依赖另一个非键列。表里有 `user_sub` 和
  `user_email`,而 email 其实依赖 user,不依赖这一行的主键,这是传递依赖。

**为什么重复是万恶之源:三种异常。**
- **更新异常**:一个事实存了 N 份,改的时候漏掉一份,系统里同时存在两个真相,
  而且没有任何东西告诉你哪个对。
- **插入异常**:想记录一个还没有任何卡片的新牌组,但牌组信息只存在于卡片行里,
  于是你被迫插一行假卡片。
- **删除异常**:删掉最后一张卡,顺手把牌组的存在性也删了。

**什么时候故意反范式:你自己就干了,而且干得对。**

`user_progress_events` 是**不可变事实表**:每一行是"某台设备报告了一次复习"。
`user_progress` 是**派生状态**:`review_count`、`last_rating`、`due_at`、`srs_stage`
理论上全都能从事件表 GROUP BY 算出来。这是标准的反范式。

为什么这样做是对的:移动端同步接口每次拉取都要读进度,如果每次都对一个用户的
全量事件做聚合,成本随使用时长线性增长,一个重度用户三年后会拖垮这个接口。
所以你把聚合结果**物化**了。

反范式的代价不是磁盘,是"必须有人保证两者一致"。你的做法值得在面试里讲:
`Vpc/Runtime/ProgressEvents.cs` 里那条六段 CTE 的 SQL,把**事件插入**和
**状态合并**放在同一条语句、同一个事务里。写入路径只有一条,不存在"事件写进去了
但状态没更新"的中间态。这就是把一致性责任收进了数据库,而不是散在应用代码里。

另一个故意的重复:`analytics_event_outbox.payload` 是一份 jsonb 快照,里面复制了
`deck_slug`、`rating`、`device_id` 等等。这**不是**冗余错误,这是 point-in-time
语义:分析事件必须记录"事件发生当时是什么样",源行后来改了不能倒流回去修改历史。
判断标准:如果这份拷贝的**语义**是"当时的值",它就不是重复,它是一个独立的事实。

**常见误解**
- "范式化 = 慢"。真实原因是 JOIN 多。但在有索引的中等基数上 JOIN 极便宜,
  真正贵的是跨网络的 N+1 和无界扫描。先范式化,遇到实测瓶颈再定点反范式,
  顺序反过来的项目最后都在修数据漂移。
- "反范式 = 加个冗余列就行"。冗余列必须回答三个问题:谁写它、什么时候失效、
  怎么重建。答不上第三个问题的冗余列迟早变成没人敢删的谜团。

**自然键 vs 代理键。** `(user_sub, deck_slug, stable_uid)` 是自然复合键,
好处是幂等 upsert 天然有目标(`on conflict (user_sub, deck_slug, stable_uid)`),
不需要先查 id;坏处是外键很宽、业务改名会波及全表。代理键(bigserial)反过来。
`analytics_event_outbox` 两个都用了:`id bigserial primary key` 给排序和分页用,
`event_id uuid not null unique` 给幂等用。这是个很好的组合,值得讲。

### 卡片素材(手动录入用)

- **Q:** 为什么说"数据重复"本身不是问题,"无人负责的重复"才是?
  **A:** 因为重复的真正成本是维护一致性的责任,不是磁盘。
  一份事实存两处,就必须有明确的机制保证两处同时更新,否则出现更新异常:
  两个值都在,没人知道哪个对。
  你的 `user_progress` 就是 `user_progress_events` 的派生重复,但它有唯一写入路径
  (ProgressEvents.cs 那条六段 CTE),重复因此是受控的。
  **难度:** d1
  **EN:** Duplication is only a problem when nothing owns keeping the copies in sync.

- **Q:** 一句话说完 1NF/2NF/3NF,不许用"函数依赖"这个词。
  **A:** 每个非键列必须依赖键,依赖整个键,且只依赖键。
  依赖键 = 1NF 的每格单值前提;依赖整个键 = 2NF,复合主键下不许有只依赖一半键的列;
  只依赖键 = 3NF,不许有非键列依赖另一个非键列。
  **难度:** d0
  **EN:** Every non-key column depends on the key, the whole key, and nothing but the key.

- **Q:** 你的 `user_progress` 把 `review_count` 存成了一列,而不是每次
  `count(*)` 事件表。这是什么取舍,代价是什么?
  **A:** 这是故意反范式:把聚合结果物化,避免读路径的成本随用户历史线性增长。
  代价是必须保证计数和事件表不漂移。你的做法是让两者在同一条 SQL、同一个事务里更新
  (upsert 段的 `review_count = user_progress.review_count + excluded.review_count`),
  写路径只有一条,所以不存在"事件进了、计数没进"的中间态。
  **难度:** d1
  **EN:** The counter is a materialised rollup, and its correctness rests on having exactly one write path.

- **Q:** 什么时候一份"重复的数据"其实根本不算重复?
  **A:** 当它的语义是"某个时间点的值"而不是"当前值"的时候。
  你的 `analytics_event_outbox.payload` 复制了 deck_slug、rating、device_id,
  但它记录的是事件发生当时的样子,源行后来改了也不该回溯修改历史。
  这不是同一个事实的两份拷贝,这是两个不同的事实。
  **难度:** d1
  **EN:** A point-in-time snapshot is a different fact from the current value, not a duplicate of it.

- **Q:** 主键是 `(user_sub, deck_slug, stable_uid)` 的表里,加一列 `deck_title`
  会出什么事?
  **A:** 违反 2NF:`deck_title` 只依赖 `deck_slug`,不依赖整个主键。
  后果是同一牌组的标题在成千上万行里重复,改标题要 UPDATE 全部行,
  中途失败就留下两个不同的标题,而且没有任何约束能告诉你哪个是对的。
  **难度:** d1
  **EN:** That column depends on only part of the composite key, so it repeats across every row of the deck.

- **Q:** 自然复合键和代理键各自的具体好处是什么?你的代码里怎么两个都用了?
  **A:** 自然键让幂等 upsert 有天然目标,不需要先 SELECT 拿 id;代理键窄、稳定、
  适合排序和外键。`analytics_event_outbox` 同时有 `id bigserial primary key`
  (给顺序消费和分页)和 `event_id uuid unique`(给幂等去重),各司其职。
  **难度:** d1
  **EN:** Natural keys give idempotent upserts a target; surrogate keys give you a cheap, stable ordering.

- **Q:** 面试官说"范式化太慢了我们都反范式",怎么回答才不是背书?
  **A:** 反问代价归谁。范式化的成本是 JOIN,而有索引的中等基数 JOIN 很便宜;
  反范式的成本是一致性责任,而这个责任不会自己消失。
  正确顺序是先范式化,拿到实测瓶颈后定点反范式,并且明确写下:谁写这个冗余、
  什么时候失效、怎么从源数据重建。
  **难度:** d1
  **EN:** Denormalise against a measured bottleneck, and always name who rebuilds the copy.

- **Q:** 把一列存成逗号分隔的字符串(比如 `tags = "a,b,c"`)具体会失去什么?
  **A:** 失去索引、失去约束、失去 JOIN。
  你无法对某个 tag 建索引做等值查找,无法用外键保证 tag 存在,
  查询只能退化成 LIKE '%b%',既不能用索引又会误匹配 "ab"。
  真要存多值,用关联表,或在 Postgres 里用数组/jsonb 配 GIN 索引(至少还能索引)。
  **难度:** d1
  **EN:** A comma-joined column throws away indexing, constraints, and joins all at once.

---

## 2. 索引(B-tree 心智模型与列序)

### 概念讲解

**Mental model:索引是一本按某个顺序排好的目录,每条目录项是(排序键, 行的位置)。**

数据库能用索引,当且仅当**你要的顺序**是索引已经排好的那个顺序,或它的前缀。
所以"为什么这条查询慢"的标准答法不是"没索引",而是:
**没有任何一个已有顺序能同时满足这条查询的过滤和排序,所以只能全扫加排序。**

**B-tree 为什么快。** 它是一棵扇出极宽的平衡树:每个内部节点一个 8KB 页,
能放几百个键,所以三到四层就覆盖上亿行。查一行 = 读三四个页。
叶子层是**按顺序**串起来的双向链表,这就是为什么 B-tree 除了等值查找,
还天然支持范围扫描(`>`、`BETWEEN`)和**免排序的 ORDER BY**。
后面这条经常被忽略:索引最大的价值之一是让 `ORDER BY` 不用排序。

**复合索引列序:等值列在前,范围/排序列在后。**

索引 `(a, b, c)` 排的是元组 `(a, b, c)` 的字典序。所以:
- `WHERE a = ? AND b = ?` 可用(前缀匹配)
- `WHERE a = ? ORDER BY b` 可用(a 固定后,索引内 b 已有序)
- `WHERE b = ?` **不可用**做定位(最左前缀规则)。它并非完全用不上这个索引:
  规划器可能选择把整个索引扫一遍再过滤(索引比表窄,所需列都在索引里时还能是 index-only scan),
  但那是"扫完再筛",不是"一次定位"
- `WHERE a > ? AND b = ?`:a 是范围,一旦范围展开,b 在结果里就不再有序,
  所以 b 只能当过滤条件,不能当定位条件。**这就是"范围列放最后"的原因。**

**锚点:你的 `012_sync_keyset_index.sql`。** 这个迁移是一个教科书级的例子,
面试里可以直接讲:

sync pull 的查询是 keyset 分页:
```
WHERE user_sub = $1
  AND (updated_at, deck_slug, stable_uid) > (to_timestamp(...), $2, $3)
ORDER BY updated_at ASC, deck_slug ASC, stable_uid ASC
```
原来只有 `idx_progress_user_updated(user_sub, updated_at DESC)`。
它**盖不住排序元组的两个 tie-breaker 列**,所以数据库拿到 updated_at 相同的一堆行后
仍然要自己排序,而且行比较 `(a,b,c) > (x,y,z)` 也无法直接转成索引的起始位置。
于是你建了 `idx_progress_user_keyset(user_sub, updated_at, deck_slug, stable_uid)`,
索引顺序和排序元组**逐列对齐**,一次索引定位 + 顺序扫 limit 行就结束。

第二条更精细,注释里已经写出了关键事实:
```
CREATE INDEX idx_decks_updated_at_slug ON decks(updated_at DESC, slug DESC);
```
**方向必须整体一致。** 全同向的索引可以被反向扫描,所以一个 `(DESC, DESC)` 索引
同时服务 `ORDER BY updated_at DESC, slug DESC` 和它的完全反序。
但**混合方向**(比如 `ORDER BY updated_at DESC, slug ASC`)就必须有一个
同样混合方向的索引,反向扫救不了你,因为反向扫会把两列的方向**同时**翻转。

**keyset 分页 vs OFFSET。** `OFFSET 10000 LIMIT 20` 的代价是 O(offset + limit):
数据库必须真的产出并丢弃前一万行。keyset 用"上一页最后一行的排序元组"当起点,
代价永远是 O(limit)。副作用还更好:翻页期间有新数据插入时,OFFSET 会重复或漏掉行,
keyset 不会。你的 `Vpc/Pagination/KeysetCursors.cs` 把整个排序元组编码进游标,
就是这个原因。那里还有一个非常值得讲的细节:Postgres 的 timestamptz 是**微秒**精度,
而游标里的时间戳是毫秒,差一微秒就会导致升序时重发整批同时间戳的行
(批量 >= limit 时甚至活锁)或降序时跳行,所以游标额外带了微秒余数 `f`。
"分页游标必须能精确重建排序键"是个很有分量的面试点。

**covering index / index-only scan。** 如果查询要的所有列都在索引里,
数据库可以只读索引不回表。Postgres 从 11 起支持 `INCLUDE (...)`:
把不需要参与排序、只需要被返回的列挂在叶子上,不进入 B-tree 的排序键。
**Postgres 特有的坑**:它的索引项**不存事务可见性**,所以 index-only scan
还要查 visibility map 确认整页都可见;刚大批量写入、还没 VACUUM 的表上,
index-only scan 会退化成大量回表,EXPLAIN 里表现为 `Heap Fetches` 很大。

**部分索引(partial index)。** 你的
`idx_analytics_outbox_pending on analytics_event_outbox(status, available_at, id) where status = 'pending'`
是个漂亮的用法:outbox 表里绝大多数行最终是 'sent',而认领查询的主分支只关心 pending。
部分索引让索引体积只随**待处理量**增长而不是随总量增长,常驻内存,
并且已发送的行从索引中被物理移除。选择性极差的列(status 只有三个值)
单独建索引几乎无用,但**加上 WHERE 之后**它就变成了一个高价值索引。
**一个诚实的边界值得自己先说出来:** 这个部分索引的谓词是 `status = 'pending'`,
所以它服务不了认领语句里那条"`processing` 且超过 15 分钟可回收"的 OR 分支。
这在当前规模上是可以接受的(卡住的行本来就罕见),但如果 outbox 表长很大、回收分支变热,
就该给它单独一个 `where status = 'processing'` 的部分索引。
**能主动指出"我的索引覆盖了哪一支、没覆盖哪一支"比只说"我建了部分索引"高一个档次。**

**索引的代价。** 每个索引都要在 INSERT/UPDATE/DELETE 时维护,写放大是真的。
Postgres 的 MVCC 让 UPDATE 实际是"写新版本",默认要更新所有索引;
只有当被改的列**都不在任何索引里**且页内有空间时,才能走 HOT update 跳过索引维护。
所以给一张高频更新的表加索引前,先想清楚它是否在被更新的列上。

**`CREATE INDEX` vs `CONCURRENTLY`。** 你自己在 012 的注释里写清楚了:
普通 `CREATE INDEX` 会持有阻塞写入的锁直到建完,而 `CREATE INDEX CONCURRENTLY`
不能在事务块里跑,你的迁移执行器 `Migrate.ApplyOne` 每个文件包在事务里,
所以生产规模下的正确做法是先带外执行 CONCURRENTLY,让迁移里的
`IF NOT EXISTS` 变成 no-op。这个"我知道这条限制,并留了绕过路径"的注释本身
就是很好的面试材料。

**什么时候索引没被用(而且是对的)**
- 表很小:全扫一个 8 页的表比走索引更快。
- 查询要取表的很大比例(比如 40%):随机回表比顺序扫贵,规划器会选 Seq Scan。
- 列上有函数或类型转换:`WHERE lower(email) = ?` 不会用 `email` 的索引,
  需要表达式索引 `CREATE INDEX ON t (lower(email))`。
- 统计信息过期:`ANALYZE` 没跑过,估算行数离谱。

### 卡片素材(手动录入用)

- **Q:** "为什么这条查询慢"的标准诊断思路是什么?(不要答"没建索引")
  **A:** 问:有没有任何一个已存在的顺序,能同时满足这条查询的**过滤**和**排序**?
  没有的话数据库只能全扫加排序。
  所以要看的是 WHERE 的等值列、范围列、ORDER BY 的完整元组三者,
  再对照现有索引的列序和方向是否逐列对齐。
  **难度:** d1
  **EN:** Ask whether any existing ordering satisfies both the filter and the sort; if none does, you pay a scan plus a sort.

- **Q:** 复合索引为什么要"等值列在前,范围列在最后"?
  **A:** 因为索引排的是元组的字典序,一旦某列展开成范围,它后面的列在结果集里就不再有序。
  `(a, b)` 索引上 `a = 1 AND b > 5` 能一次定位并顺序扫;
  `a > 1 AND b = 5` 只能扫遍所有 a > 1 的区间,b 沦为过滤条件而非定位条件。
  **难度:** d1
  **EN:** Once a column is used as a range, everything after it is no longer sorted within the result.

- **Q:** 你的 012 迁移为什么要在已有 `(user_sub, updated_at DESC)` 之外
  再建 `(user_sub, updated_at, deck_slug, stable_uid)`?
  **A:** 因为 sync pull 的排序元组是 `(updated_at, deck_slug, stable_uid)` 三列,
  旧索引一个 tie-breaker 都没覆盖。
  结果是同 updated_at 的行仍需排序,而且行比较 `(a,b,c) > (x,y,z)`
  没法直接转成索引起点。新索引逐列对齐后,一次定位 + 顺序扫 limit 行就完成。
  **难度:** d1
  **EN:** The old index covered neither tie-breaker of the sort tuple, so the keyset bound could not become an index seek.

- **Q:** 一个 `(updated_at DESC, slug DESC)` 的索引能服务
  `ORDER BY updated_at DESC, slug ASC` 吗?
  **A:** 不能。反向扫描会把**两列的方向同时**翻转,所以同向索引只能服务
  自身顺序和它的完全反序。混合方向的排序需要一个同样混合方向的索引。
  你在 012 的注释里正是这么写的:两列都 DESC 是为了让行比较边界和索引顺序一致。
  **难度:** d3
  **EN:** A backward scan flips every column at once, so mixed-direction sorts need a mixed-direction index.

- **Q:** keyset 分页比 `OFFSET n` 好在哪两点?
  **A:** 成本和正确性。OFFSET 的代价是 O(offset + limit),数据库要真的产出并丢弃前 n 行;
  keyset 用上一页最后一行的排序元组当起点,永远是 O(limit)。
  另外翻页期间有插入时,OFFSET 会重复或漏行,keyset 因为锚在具体行上不会。
  **难度:** d1
  **EN:** Keyset paging is O(limit) regardless of depth, and it does not skip or repeat rows when data shifts mid-scroll.

- **Q:** 你的游标为什么要额外带一个"微秒余数"字段?
  **A:** 因为 Postgres 的 timestamptz 是微秒精度,而游标里的时间戳是毫秒。
  重建的边界差一微秒,升序时会重发整批同时间戳的行(批量 >= limit 就活锁),
  降序时会直接跳行。所以 `KeysetCursors.cs` 存了 0..999 的余数,
  用它重建出精确的存储时间戳。
  **难度:** d3
  **EN:** A cursor must reconstruct the sort key exactly; a millisecond cursor over microsecond timestamps either loops or skips.

- **Q:** covering index 在 Postgres 上有什么别处没有的坑?
  **A:** Postgres 的索引项不存事务可见性,所以 index-only scan 还要查 visibility map。
  刚大批量写入、还没 VACUUM 的页不是 all-visible,查询就得回表确认,
  EXPLAIN 里表现为 `Heap Fetches` 很高,"覆盖索引"的收益消失。
  **难度:** d3
  **EN:** Postgres indexes carry no visibility info, so an index-only scan still needs the visibility map to be up to date.

- **Q:** `status` 只有三个取值,给它建索引通常没用,为什么你的 outbox 索引反而很有价值?
  **A:** 因为它是**部分索引**:`where status = 'pending'`。
  索引体积只随待处理量增长而不是总量,能常驻内存,已发送的行被物理移出索引。
  低选择性的列加上一个高选择性的 WHERE,就变成了高价值索引。
  **难度:** d1
  **EN:** A partial index turns a low-selectivity column into a small, hot index that only tracks the rows you query.

- **Q:** 加索引的代价具体是什么?什么情况下代价最小?
  **A:** 每次写入都要维护索引,Postgres 的 MVCC 让 UPDATE 写新版本并更新全部索引。
  唯一的例外是 HOT update:被修改的列**都不在任何索引里**且页内有空位时,
  可以跳过索引维护。所以在高频更新的列上加索引最贵。
  **难度:** d2
  **EN:** Every index is write amplification, except when Postgres can take the HOT path because no indexed column changed.

- **Q:** `WHERE lower(email) = 'a@b.com'` 为什么用不上 `email` 上的索引?怎么修?
  **A:** 索引存的是 `email` 的值的顺序,不是 `lower(email)` 的顺序,两者顺序不同。
  修法是建表达式索引 `CREATE INDEX ON users (lower(email))`,
  或者在写入时就归一化存储。同理,列上有隐式类型转换时也会失效。
  **难度:** d1
  **EN:** An index stores the ordering of the raw column, so wrapping it in a function needs an expression index.

- **Q:** 什么时候数据库不用索引反而是**正确**的?
  **A:** 表很小(全扫几个页比走索引快)、查询命中表的很大比例(随机回表比顺序扫贵)、
  或者统计信息还准确地告诉规划器就该这么选。
  Seq Scan 出现在 EXPLAIN 里不等于有 bug,先看估算行数和实际行数差多少。
  **难度:** d1
  **EN:** A sequential scan is often the right plan for small tables or for queries touching a large fraction of rows.

- **Q:** 为什么你的 012 迁移里写的是普通 `CREATE INDEX` 而不是 `CONCURRENTLY`?
  **A:** 因为迁移执行器 `Migrate.ApplyOne` 把每个文件包在一个事务里,
  而 `CREATE INDEX CONCURRENTLY` 不能在事务块内运行。
  普通 CREATE INDEX 会阻塞该表写入直到建完,所以生产规模下的做法是先带外
  执行 CONCURRENTLY,再让迁移里的 `IF NOT EXISTS` 成为 no-op。
  **难度:** d1
  **EN:** CREATE INDEX CONCURRENTLY cannot run inside a transaction block, which is exactly what a per-file migration runner gives you.

---

## 3. 事务与隔离级别

### 概念讲解

**Mental model:隔离级别决定"你愿意让多少并发泄漏进你的读"。**
级别越高泄漏越少,代价是更多的等待或更多的失败重试。没有免费的隔离。

**三种经典异常,用画面记住:**

- **脏读(dirty read)**:事务 A 把余额改成 0 但**还没提交**,事务 B 读到了这个 0,
  然后 A 回滚。B 基于一个从未存在过的世界做了决定。
- **不可重复读(non-repeatable read)**:B 读了某一行余额 = 100,做了点别的,
  再读同一行变成了 50,因为期间 A 提交了。**同一行,两次读,不同值。**
- **幻读(phantom read)**:B 执行 `SELECT count(*) WHERE deck='x'` 得到 10,
  再执行一次得到 11,因为 A 插入了一行新数据。**同一个范围查询,行集合变了。**
  幻读和不可重复读的区别是:前者是**新行出现**,后者是**已有行变值**。
  这个区别很重要,因为行锁能挡住后者,挡不住前者(还不存在的行没法上锁),
  要挡幻读需要谓词锁或范围锁。

**Postgres 的实际情况(必须记准,面试常问):**

| 级别 | 脏读 | 不可重复读 | 幻读 | 写偏斜 |
|---|---|---|---|---|
| Read Uncommitted | 不可能 | 可能 | 可能 | 可能 |
| **Read Committed(默认)** | 不可能 | 可能 | 可能 | 可能 |
| Repeatable Read | 不可能 | 不可能 | **不可能** | 可能 |
| Serializable | 不可能 | 不可能 | 不可能 | 不可能 |

两条 Postgres 特有的事实:
1. **Read Uncommitted 在 Postgres 里等同于 Read Committed**,因为 MVCC 下压根没有
   "读到未提交版本"这个物理途径。所以 Postgres 里**永远不会有脏读**。
2. **Postgres 的 Repeatable Read 是快照隔离(snapshot isolation)**,比 SQL 标准要求的更强,
   它顺带也消除了幻读。但它**不能**消除写偏斜(write skew)。

**Read Committed 到底意味着什么(这是你每天在用的那个)。**

关键:**快照是每条语句一个,不是每个事务一个。**
所以同一个事务里两条 `SELECT` 之间,别人提交的东西你会看到。
"我开了事务所以我的读是一致的"是错的,在 Read Committed 下你的读只在**单条语句内**一致。

还有一个反直觉但很重要的行为:Read Committed 下的 `UPDATE ... WHERE`
如果撞上被别的事务锁住的行,它会**等待**,对方提交后**重新读取该行的最新版本
并重新评估 WHERE 条件**(Postgres 里叫 EvalPlanQual)。
所以 `UPDATE accounts SET balance = balance - 100 WHERE id = 1 AND balance >= 100`
在 Read Committed 下是安全的,不会基于陈旧快照扣款。
但 `SELECT balance` 之后在应用里判断、再 `UPDATE` 就**没有**这个保护,
因为 SELECT 的快照和 UPDATE 是两条语句。**这是"读改写"经典竞态的根源。**

**写偏斜(write skew):Repeatable Read 挡不住的那个。**
画面:医院要求任何时刻至少一名医生在岗。两名医生同时点"请假",
各自的事务都 `SELECT count(*) FROM doctors WHERE on_call = true` 看到 2,
都判断"还有另一个人在,我可以走",都提交。结果零人在岗。
两个事务**没有改同一行**,所以行锁和快照隔离都不报警,但跨行不变式被破坏了。
**只有 Serializable(或显式加锁 / 物化冲突)能挡住它。**

**Postgres 的 Serializable 是 SSI(Serializable Snapshot Isolation)**:
它不加读锁,而是跟踪事务之间的读写依赖,发现可能破坏可串行化的"危险结构"时,
在提交时抛 `40001 serialization_failure`。**代价是你必须写重试循环。**
没有重试循环的 Serializable 不是"更安全",是"随机报错"。

**你的代码在哪一层:** `ProgressEvents.cs` 的摄入跑在 Postgres 默认的 Read Committed 上,
没有用 Serializable,而这是**对的**,值得能讲清楚为什么:
- 整个"插入事件 + 写 outbox + 聚合 + 合并进 user_progress"是**一条 SQL 语句**。
  单条语句内部天然共享一个快照,不存在语句间的不可重复读。
- 行级冲突交给 `on conflict` 在唯一索引和行锁的层面解决,不依赖隔离级别。
- 幂等靠 `event_id` 的唯一约束,这是**数据库约束**,任何隔离级别下都成立。

**什么时候你会需要 Serializable:** 当正确性依赖**跨行的不变式**,
而这个不变式必须先读后写才能维持时。比如"每个免费用户最多 3 个自定义牌组":
`SELECT count(*)` 然后 `INSERT`,两个并发请求都读到 2,都插入,变成 4。
这正是写偏斜。解法有三个,按成本排序:
1. 把不变式变成一个**数据库约束**(能做到就最好,比如唯一索引);
2. 用**单条语句**做条件插入(`INSERT ... SELECT ... WHERE (SELECT count(*)...) < 3`),
   或对父行加锁(`SELECT ... FOR UPDATE` 锁住 user 行,把跨行冲突物化成行冲突);
3. 用 **Serializable + 重试**。

**常见误解**
- "开了事务就安全了"。事务给的是原子性,隔离性是另一个旋钮,而且默认档位很宽松。
- "隔离级别越高越好"。Serializable 下高冲突负载会大量 40001 重试,吞吐可能崩掉。
- "回滚 = 没发生"。数据回滚了,但你在事务里发出去的 HTTP 请求、扔进队列的消息不会回滚,
  这正是 transactional outbox 存在的理由:把"要发的消息"作为**数据行**写在同一事务里。
- 长事务的隐藏代价:它持有一个旧快照,VACUUM 无法回收比它更新的死元组,表和索引膨胀。
  一个忘了提交的空闲事务能把生产库拖垮,而它什么也没做。

### 卡片素材(手动录入用)

- **Q:** 幻读和不可重复读的区别是什么,为什么这个区别在实现上很重要?
  **A:** 不可重复读是**已有行的值变了**,幻读是**范围查询里出现了新行**。
  区别很重要是因为行锁能锁住已存在的行,但锁不住还不存在的行,
  所以挡幻读需要谓词锁/范围锁或快照隔离,成本高一档。
  **难度:** d1
  **EN:** Non-repeatable reads change existing rows; phantoms add new ones, and you cannot lock a row that does not exist yet.

- **Q:** Postgres 默认的 Read Committed 具体给了你什么保证,又没给什么?
  **A:** 给的是:绝不脏读,且**单条语句内**看到一个一致快照。
  没给的是:事务内两条语句之间的一致性。
  快照是每条语句刷新一次,所以同一事务里两次 SELECT 完全可能不同,
  不可重复读和幻读都可能发生。
  **难度:** d1
  **EN:** Read Committed takes a fresh snapshot per statement, so consistency holds within a statement, not across one.

- **Q:** 为什么 Postgres 里永远不会发生脏读,哪怕你设 Read Uncommitted?
  **A:** 因为 MVCC 下未提交的版本对其他事务在物理上就不可见,没有读到它的途径。
  Postgres 把 Read Uncommitted 直接映射成 Read Committed。
  **难度:** d1
  **EN:** Under MVCC there is no physical path to an uncommitted row version, so Postgres maps Read Uncommitted onto Read Committed.

- **Q:** `UPDATE t SET b = b - 100 WHERE id = 1 AND b >= 100` 在 Read Committed 下
  会不会因为并发扣成负数?为什么?
  **A:** 不会。Read Committed 下 UPDATE 撞上被锁的行会等待,对方提交后
  **重新读最新版本并重新评估 WHERE**,所以 `b >= 100` 是对最新值判断的。
  但如果你先 `SELECT b` 在应用里判断再 UPDATE,保护就没了,那是两条语句两个快照。
  **难度:** d3
  **EN:** Read Committed re-evaluates the WHERE against the freshly committed row version, so a single conditional UPDATE is safe.

- **Q:** 用一个画面说清楚写偏斜,并说明为什么 Repeatable Read 挡不住它。
  **A:** 两名值班医生同时请假,各自读到"在岗 2 人",各自认为"还有别人",各自提交,
  结果零人在岗。两个事务**改的不是同一行**,所以行锁和快照隔离都不报警,
  但被破坏的是**跨行不变式**。挡它需要 Serializable、显式锁,或把不变式物化成一行。
  **难度:** d2
  **EN:** Write skew breaks a cross-row invariant without any two transactions touching the same row.

- **Q:** Postgres 的 Serializable 用什么机制实现,用它之前必须先写什么代码?
  **A:** SSI,基于快照隔离额外跟踪事务间的读写依赖,发现危险结构就在提交时抛
  `40001 serialization_failure`。
  所以必须先写**重试循环**。没有重试的 Serializable 不是更安全,是把并发冲突
  变成了随机的 500。
  **难度:** d1
  **EN:** Postgres Serializable is SSI: it aborts with 40001 at commit, so the retry loop is part of the feature, not optional.

- **Q:** 你的进度摄入跑在默认 Read Committed 上,凭什么它是并发安全的?
  **A:** 因为它不依赖隔离级别来保证正确性。
  整个"插事件 + 写 outbox + 聚合 + 合并"是**一条 SQL**,语句内共享一个快照;
  重复事件靠 `event_id` 的唯一约束加 `on conflict do nothing` 挡掉,那是约束层;
  行级冲突靠 upsert 的行锁解决。这三者在任何隔离级别下都成立。
  **难度:** d2
  **EN:** The ingest gets its safety from a single statement plus a unique constraint, not from the isolation level.

- **Q:** 如果要加一条"免费用户最多 3 个自定义牌组",按成本从低到高有哪几种正确做法?
  **A:** 一,能变成数据库约束就变(唯一索引之类,最省心);
  二,单条语句条件插入,或先 `SELECT ... FOR UPDATE` 锁住父行,把跨行冲突物化成行冲突;
  三,Serializable 加重试。
  直接 `SELECT count(*)` 再 `INSERT` 是写偏斜,并发下必然超额。
  **难度:** d2
  **EN:** Prefer a constraint, then a single conditional statement or a lock on the parent row, and only then serializable plus retry.

- **Q:** 事务回滚了,但你在事务里发出去的东西回滚了吗?这条事实催生了什么模式?
  **A:** 没有。HTTP 调用、队列消息、S3 写入都不受数据库事务控制,
  于是产生"数据没提交但消息发出去了"或反过来的不一致。
  解法是 transactional outbox:把"要发的消息"作为**数据行**写在同一事务里,
  再由独立的消费者异步发布。你的 `analytics_event_outbox` 就是这个。
  **难度:** d1
  **EN:** External side effects do not roll back, which is exactly why the outbox writes the message as a row in the same transaction.

- **Q:** 一个什么都不干、只是忘了提交的空闲事务,为什么能拖垮生产库?
  **A:** 它持有一个旧快照,VACUUM 不能回收任何比这个快照更新的死元组。
  于是表和索引持续膨胀,查询变慢,磁盘涨,而监控上看这个连接毫无活动。
  这就是要给连接设 `idle_in_transaction_session_timeout` 的原因。
  **难度:** d1
  **EN:** An idle-in-transaction session pins an old snapshot and blocks vacuum, so dead tuples accumulate indefinitely.

---

## 4. 并发控制

### 概念讲解

**Mental model:悲观 = 进门先把门锁上;乐观 = 先干完,提交时验票,票过期就重来。**

选哪个取决于**冲突概率**。冲突罕见时,乐观省掉了所有等待,偶尔重试一次;
冲突频繁时,乐观会退化成"大家一起白干再一起重试",这时悲观锁反而吞吐更高。

**Postgres 的行锁基础事实:**
- **读不阻塞写,写不阻塞读**(MVCC 让读走旧版本)。这是 Postgres 和老式
  两阶段锁数据库最大的体感差别。
- **写阻塞写**:两个事务改同一行,后者等前者提交或回滚。
- `SELECT ... FOR UPDATE`:显式给读到的行加排他锁,后续别人改不了也不能 FOR UPDATE。
- `FOR NO KEY UPDATE`:弱一档,不阻塞外键引用检查,更新非键列时用它并发更好。
- `FOR UPDATE NOWAIT`:拿不到锁立刻报错,不等。
- `FOR UPDATE SKIP LOCKED`:**跳过**已被别人锁住的行,继续找下一行。

**锚点:你的 `Vpc/Analytics/OutboxPublisher.cs` 的 ClaimPending。**
这是队列语义的教科书写法,面试里非常能打:
```sql
with claimed as (
  select id from analytics_event_outbox
  where available_at <= now()
    and (status = 'pending'
         or (status = 'processing' and updated_at < now() - interval '15 minutes'))
  order by id limit $1
  for update skip locked
)
update analytics_event_outbox o set status='processing', attempts=attempts+1, ...
from claimed where o.id = claimed.id returning ...
```
两个要点:
1. **`SKIP LOCKED` 把"排队"变成"分工"。** 没有它,N 个并发消费者会全部堵在同一批
   最老的行上串行执行;有了它,每个消费者抢到互不相交的一批,吞吐随消费者数量线性上升。
   这是 Postgres 当作队列用的核心原语。
2. **行锁不是租约。** 你的注释里点破了关键:行锁只在事务内有效,事务一结束锁就没了。
   所以 lambda 在"标记 processing"和"真正发布"之间被杀掉(超时/OOM/部署),
   没有任何锁会帮你把这行放回去,它会永远卡在 processing。
   租约必须**自己实现**:状态列 + 时间戳 + "processing 超过 15 分钟就可重新认领"。
   这条推理("数据库的锁是事务级的,跨请求的占有必须自己做成带过期的状态")
   是个能立刻显出经验的答法。

**`ON CONFLICT` 的准确语义(你天天用,但要讲得准):**
- 它需要一个**唯一索引或唯一约束**来推断冲突目标。`on conflict (event_id)`
  依赖 `event_id uuid not null unique`。没有唯一索引就没有 upsert。
- `DO NOTHING` 时,冲突的行**不会**出现在 `RETURNING` 里。
  你的接口正是利用了这一点:`inserted_event_ids` 只包含**真正新插入**的 event_id,
  剩下的自动归入 `duplicateEventIds`。**幂等的判定来自数据库返回了什么,
  而不是应用先查一遍再决定**,后者在并发下必然有竞态窗口。
- `DO UPDATE` 里可以引用 `excluded`(试图插入但被拒的那一行)和目标表本身。
  你的合并 `review_count = user_progress.review_count + excluded.review_count`
  就是两者相加。
- **硬限制:一条语句里 `ON CONFLICT DO UPDATE` 不能两次影响同一行**,
  否则报 "ON CONFLICT DO UPDATE command cannot affect row a second time"。
  这就是为什么你的 SQL 必须先经过 `agg`(按 `(user_sub, deck_slug, stable_uid)` 聚合)
  和 `last_row`(`distinct on` 取每张卡的最后一次)把同一张卡的多个事件**先在语句内合并成一行**,
  才能进 upsert。这不是风格选择,这是绕开一条硬约束。

**乐观锁的标准形态:`version + 1`。**
```sql
UPDATE t SET data = ?, version = version + 1 WHERE id = ? AND version = ?
```
判据是**受影响行数**:1 = 成功,0 = 别人先改了,你手上的 version 过期,
应用需要重读并重试(或把冲突报给用户)。
`ON CONFLICT DO UPDATE` 和它是两种不同的东西:前者解决"插入还是更新"的分支,
后者解决"我基于的读还新鲜吗"。

**为什么你的合并没有用 version+1(这是一个很好的对比题)。**
`version` 乐观锁要求客户端先读到当前 version 才能写,它是一个**在线的读改写循环**。
但你的场景是**多设备离线同步**:一台设备飞行模式攒了三天的复习记录,
它手上不可能有最新的 version。用 version 的话它每次都会冲突失败,
而失败重试也没有意义,因为它本来就不该"覆盖",它该**合并**。
所以你的比较键是 `last_reviewed_at`(事件的语义时间),规则是
"**事件时间更新的那次复习赢**",而不是"**先到的赢**"。
这让结果和到达顺序无关,也就是可交换、可重放。
这个取舍讲出来非常有说服力:**乐观锁解决"覆盖的正确性",LWW 解决"合并的收敛性",
它们回答的不是同一个问题。**

**数据修改 CTE 的快照语义(d3 级细节,但你的代码依赖它)。**
一条语句里的所有 CTE **共享同一个快照**,且数据修改 CTE 的效果**互相不可见**。
所以你的 `outbox` 段**不能**去 `select ... from analytics_event_outbox` 或重新查事件表,
它必须写 `from ins`,靠 `ins` 的 `RETURNING` 把刚插入的行传递过来。
同样地,CTE 之间没有保证的执行顺序,**唯一可靠的数据流是 RETURNING**。
另外数据修改 CTE **一定会执行一次**,哪怕外层没有引用它的输出。

**死锁。** 两个事务以相反顺序获取两把锁就会死锁。Postgres 会自动检测并杀掉其中一个
(`40P01 deadlock_detected`)。预防手段只有一个真正有效:**约定一个固定的加锁顺序**
(比如永远按主键升序更新)。你的 outbox 认领里 `order by id` 就顺带有这个效果。

**常见误解**
- "加锁就不会丢更新"。锁的范围错了照样丢:锁了 A 行却读改写了 B 行的派生值。
- "SELECT 会阻塞"。Postgres 里普通 SELECT 不加行锁也不被行锁阻塞。
  会阻塞它的是 DDL 那类需要 ACCESS EXCLUSIVE 锁的操作。
- "`ON CONFLICT DO NOTHING` 会返回冲突的行"。不会,这正是你用来区分新旧事件的机制。

### 卡片素材(手动录入用)

- **Q:** 乐观锁和悲观锁怎么选?判据是什么?
  **A:** 判据是冲突概率。冲突罕见时乐观更好,省掉全部等待,偶尔重试;
  冲突频繁时乐观会退化成"大家一起白干再一起重试",此时悲观锁的排队反而吞吐更高。
  另一个判据是能否重试:副作用不可重放的操作不适合乐观。
  **难度:** d1
  **EN:** Pick optimistic when conflicts are rare and the work is cheap to redo; pick pessimistic when contention is high.

- **Q:** `FOR UPDATE SKIP LOCKED` 解决了什么问题?没有它会怎样?
  **A:** 它把"排队"变成"分工"。没有它,N 个并发消费者会全部堵在同一批最老的行上串行;
  有了它,每个消费者跳过被锁的行,抢到互不相交的一批,吞吐随消费者数线性增长。
  这是把 Postgres 当队列用的核心原语,你的 OutboxPublisher 就靠它。
  **难度:** d1
  **EN:** SKIP LOCKED turns queue consumers from a queue into a fan-out, each claiming a disjoint batch.

- **Q:** 你的 outbox 认领为什么除了行锁还要一个"processing 超过 15 分钟可重新认领"的条件?
  **A:** 因为行锁是**事务级**的,事务一结束锁就消失,它不是租约。
  行被翻成 processing 之后 lambda 被超时或 OOM 杀掉,没有任何锁会把它放回来,
  这行就永远卡住、发布不了也重试不到。跨请求的占有必须自己实现成
  "状态列 + 时间戳 + 过期即可重认领"。
  **难度:** d3
  **EN:** Row locks end with the transaction, so any claim that outlives it must be a lease you implement yourself.

- **Q:** `ON CONFLICT (event_id) DO NOTHING` 加 `RETURNING` 为什么能直接给出
  "哪些事件是新的"?
  **A:** 因为 DO NOTHING 时冲突的行不会出现在 RETURNING 里,返回的就是真正插入的那些。
  关键在于这个判定来自**数据库的原子结果**,而不是应用先 SELECT 再决定,
  后者在并发下有竞态窗口,两个请求会同时认为自己是"新的"。
  **难度:** d1
  **EN:** DO NOTHING omits conflicting rows from RETURNING, so the database itself tells you which events were new.

- **Q:** 为什么你的 SQL 必须先 `agg` + `distinct on` 把同一张卡的多个事件压成一行,
  才能进 upsert?
  **A:** 因为 Postgres 硬性禁止一条语句里 `ON CONFLICT DO UPDATE` 两次影响同一行,
  会直接报 "cannot affect row a second time"。
  一个批次里同一张卡有两个事件时,插入侧就会产生两行指向同一个冲突目标。
  所以必须在语句内先合并成每张卡一行。这不是风格,是绕开硬约束。
  **难度:** d3
  **EN:** ON CONFLICT DO UPDATE cannot touch the same row twice in one statement, so the batch must be pre-aggregated per conflict target.

- **Q:** `version + 1` 乐观锁怎么判断失败?
  **A:** 看受影响行数。`UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?`
  返回 1 = 成功,返回 0 = 你读到的 version 已过期,别人先改了。
  应用要么重读重试,要么把冲突暴露给用户。判据是行数,不是异常。
  **难度:** d0
  **EN:** Optimistic locking fails silently by affecting zero rows, so you must check the row count, not catch an exception.

- **Q:** 你的多设备进度合并为什么用 `last_reviewed_at` 比大小,而不是 `version + 1` 乐观锁?
  **A:** 因为 version 乐观锁要求写之前先读到最新 version,是一个在线读改写循环;
  而离线设备攒了三天记录时手上根本没有最新 version,每次都会冲突失败,
  而且它本来就不该"覆盖",它该"合并"。
  用事件时间当比较键的结果与到达顺序无关,因此可交换、可重放。
  **难度:** d2
  **EN:** Version checks answer "is my read still fresh"; LWW answers "which write wins", and offline sync only has the second question.

- **Q:** 一条 SQL 里的 `outbox` CTE 为什么必须 `from ins`,不能自己重新查事件表?
  **A:** 因为同一条语句里所有 CTE 共享一个快照,数据修改 CTE 的写入**互相不可见**。
  重新查事件表看不到 `ins` 刚插入的行。CTE 之间也没有保证的执行顺序,
  **唯一可靠的数据流是 RETURNING**。
  **难度:** d3
  **EN:** All CTEs in one statement share a snapshot, so the only way to pass newly written rows downstream is RETURNING.

- **Q:** 死锁怎么产生,怎么真正预防?
  **A:** 两个事务以相反顺序获取同两把锁。Postgres 会自动检测并杀掉其中一个(40P01)。
  唯一真正有效的预防是**约定固定的加锁顺序**,比如永远按主键升序更新。
  重试能救急,但不解决根因。
  **难度:** d1
  **EN:** Deadlocks come from inconsistent lock ordering; the fix is a global ordering, not a bigger retry budget.

- **Q:** Postgres 里普通 `SELECT` 会被 `UPDATE` 阻塞吗?
  **A:** 不会。MVCC 让读走旧版本,读不阻塞写、写不阻塞读,只有写写会互相阻塞。
  会阻塞 SELECT 的是需要 ACCESS EXCLUSIVE 锁的操作,比如某些 DDL。
  这是 Postgres 和老式两阶段锁数据库最大的体感差别。
  **难度:** d0
  **EN:** Under MVCC readers never block writers and writers never block readers; only writer-writer pairs contend.

- **Q:** `FOR UPDATE` 和 `FOR NO KEY UPDATE` 差在哪,什么时候该用后者?
  **A:** `FOR NO KEY UPDATE` 是弱一档的锁,它不阻塞对该行的外键引用检查。
  当你只更新非键列(不动主键和唯一键)时用它,子表插入不会被你卡住,并发更好。
  普通 `UPDATE` 非键列时 Postgres 自己拿的就是这一档。
  **难度:** d2
  **EN:** FOR NO KEY UPDATE is the weaker lock that still allows foreign-key checks against the row to proceed.

---

## 5. 查询能力(JOIN / 聚合 / CTE / EXPLAIN)

### 概念讲解

**JOIN 的画面感。** 别背定义,记形状:
- **INNER JOIN**:两边都有匹配才出现。结果是交集。
- **LEFT JOIN**:左表全留,右表没匹配的补 NULL。**"我要所有用户,顺便看看他有没有订单。"**
- **RIGHT JOIN**:LEFT 的镜像,实务里几乎总是被改写成 LEFT(读的人不用换脑子)。
- **FULL OUTER JOIN**:两边都全留。典型用途是对账:找出"只在 A 有"和"只在 B 有"的行。
- **CROSS JOIN**:笛卡尔积。故意用的场景是生成日期序列之类的补全。

**LEFT JOIN 最经典的坑:在 WHERE 里过滤右表的列,会把 LEFT 悄悄变回 INNER。**
```sql
-- 想要:所有用户,以及他们 2026 年的订单
SELECT u.*, o.*
FROM users u LEFT JOIN orders o ON o.user_id = u.id
WHERE o.created_at >= '2026-01-01';   -- 错:没订单的用户 o.created_at 是 NULL,被过滤掉了
```
正确写法是把条件放进 `ON`:`LEFT JOIN orders o ON o.user_id = u.id AND o.created_at >= '2026-01-01'`。
记忆点:**`ON` 决定"配不配得上",`WHERE` 决定"留不留下",而 NULL 过不了任何比较。**
唯一例外是 `WHERE o.id IS NULL`,那是故意用来找"没有匹配"的反连接写法。

**聚合与 GROUP BY。**
- `SELECT` 里出现的非聚合列必须在 `GROUP BY` 里(Postgres 有个宽容:
  如果你 GROUP BY 了主键,那些函数依赖于主键的列可以不写)。
- `WHERE` 在分组**前**过滤行,`HAVING` 在分组**后**过滤组。
  能放 WHERE 的条件绝不要放 HAVING,因为 WHERE 能减少参与分组的行数。
- `COUNT(*)` 数行;`COUNT(col)` 数 col 非 NULL 的行。这两个在有 LEFT JOIN 时结果不同,
  是"为什么没订单的用户订单数是 1"这个经典 bug 的根源(应该用 `COUNT(o.id)`)。
- 聚合函数**跳过 NULL**:`AVG(score)` 的分母是非 NULL 的个数,不是行数。
- `SUM` 在零行上返回 NULL 而不是 0,`COUNT` 在零行上返回 0。
  这个不对称每年都会咬人一次,用 `coalesce(sum(x), 0)`。

**`DISTINCT ON`(Postgres 特有,你在用)。**
`distinct on (a, b, c) ... order by a, b, c, event_time desc, event_id desc`
的意思是:按 (a,b,c) 分组,每组取排序后的**第一行**。
两条硬规则:
1. `ORDER BY` 的**前缀必须和 `DISTINCT ON` 的表达式一致**,否则报错或结果无意义。
2. **平局的胜者是未指定的。** 这正是你在 `last_row` 段注释里点明的问题:
   只按 `event_time desc` 排的话,同一毫秒的两个事件让**执行计划**(并行扫描、
   索引选择、行顺序)决定用户最终拿到哪个 rating 和 due_at。
   而且因为时钟钳制会把所有偏移时钟的事件映射到**同一个上界**,
   平局从罕见碰撞变成了系统性事件。加 `event_id desc` 做最后 tiebreak,
   代价是零(已是主键、已唯一、不随计划变化),收益是结果确定。
   **"任何全序都好过没有全序"是个值得记住的原则。**

标准 SQL 里的等价写法是窗口函数:
```sql
SELECT * FROM (
  SELECT *, row_number() OVER (PARTITION BY a,b,c ORDER BY event_time DESC, event_id DESC) rn
  FROM ins
) t WHERE rn = 1;
```
面试时能说出"我用了 Postgres 的 DISTINCT ON,标准 SQL 的等价物是 ROW_NUMBER 窗口函数"
是很好的加分。

**CTE(`WITH`)。**
- 作用是**给中间结果命名**,把一个嵌套三层的子查询拍平成可读的流水线。
  你的六段 CTE(`ins` → `outbox` → `agg` → `last_row` → `merged` → `upsert`)
  正是这个价值:每一段的名字就是它的语义。
- **Postgres 12 起 CTE 默认可以被内联**(即优化器可以把它当子查询融进主查询)。
  12 之前 CTE 是**优化屏障**,一定物化。需要保持屏障时写 `WITH x AS MATERIALIZED (...)`,
  需要强制内联写 `NOT MATERIALIZED`。递归 CTE 和数据修改 CTE 始终物化。
- **数据修改 CTE**(`WITH ins AS (INSERT ... RETURNING ...)`)是 Postgres 的杀手锏:
  它让"插入 + 用插入结果做后续写入"成为**一条语句**,从而天然原子。
  代价是前面讲过的快照语义:各段互相看不见对方的写入,只能靠 RETURNING 传数据。
- 递归 CTE(`WITH RECURSIVE`)用来查树/图:组织架构、评论嵌套、依赖链。

**EXPLAIN 入门。** 读计划的顺序:**从最内层、缩进最深的节点往外读**,
每个节点把行喂给它的父节点。
- `EXPLAIN` 只出估算,`EXPLAIN ANALYZE` **真的执行**这条语句。
  对 INSERT/UPDATE/DELETE 用 ANALYZE 时,包进 `BEGIN; ... ROLLBACK;`。
- 每个节点看四个数:
  `cost=启动代价..总代价`(**任意单位**,只能用来比较,不是毫秒),
  `rows=` 估算行数,`actual time=` 实测,`loops=` 执行次数。
  注意 **`actual time` 是单次循环的平均值**,总耗时要乘以 loops。
- **最有用的一个信号:估算 rows 和 actual rows 差一个数量级以上。**
  这说明统计信息过期(跑 `ANALYZE`)、或者规划器对多列相关性的独立性假设错了
  (可以建 `CREATE STATISTICS`)。计划选错几乎总是因为估算错,不是因为规划器笨。
- 常见节点:
  `Seq Scan`(全扫,小表或高比例命中时是对的);
  `Index Scan`(逐行走索引再回表,适合少量行);
  `Index Only Scan`(不回表,注意 `Heap Fetches`);
  `Bitmap Heap Scan`(索引先攒一堆行位置,按**页**排序后批量读,适合中等数量的行,
  能把随机 IO 变成接近顺序 IO);
  `Nested Loop`(外层每行探测一次内层,内层有索引时最快,外层行数估错时最灾难);
  `Hash Join`(建哈希表,适合大表对大表);
  `Merge Join`(两边都有序时归并)。
- 分辨 `Index Cond` 和 `Filter`:前者是用索引**定位**(只读需要的),
  后者是读出来**再扔掉**(白读了)。`Rows Removed by Filter` 很大 = 索引选得不对。
- `EXPLAIN (ANALYZE, BUFFERS)` 会告诉你读了多少页、多少来自缓存。
  这是判断"慢是因为 IO 还是因为 CPU"的直接证据。

### 卡片素材(手动录入用)

- **Q:** `LEFT JOIN` 之后在 `WHERE` 里过滤右表的列会发生什么?
  **A:** LEFT JOIN 会悄悄退化成 INNER JOIN。
  没匹配的行右表列是 NULL,而 NULL 过不了任何比较,于是被 WHERE 滤掉,
  "左表全留"的语义就没了。
  条件要放进 `ON`,因为 `ON` 决定"配不配得上"(不匹配只是补 NULL),
  `WHERE` 决定"留不留下"(不匹配是整行消失);内连接里两者等价,外连接里完全不同。
  唯一例外是 `WHERE right.id IS NULL`,那是故意的反连接。
  **难度:** d1
  **EN:** ON decides what counts as a match, WHERE decides what survives, so filtering a right-table column in WHERE silently turns a LEFT JOIN into an INNER JOIN.

- **Q:** `COUNT(*)` 和 `COUNT(o.id)` 在 LEFT JOIN 后为什么结果不同?
  **A:** `COUNT(*)` 数行,没有订单的用户也占一行,所以计数是 1;
  `COUNT(o.id)` 只数非 NULL,正确地得到 0。
  这是"为什么零订单用户显示有 1 单"这个经典 bug 的根源。
  **难度:** d1
  **EN:** COUNT(*) counts rows including the NULL-padded ones; COUNT(col) counts non-null values.

- **Q:** `WHERE` 和 `HAVING` 该怎么选?
  **A:** 能放 WHERE 就绝不放 HAVING。WHERE 在分组**前**过滤行,直接减少参与聚合的数据量;
  HAVING 在分组**后**过滤组,只能用来筛聚合结果(比如 `HAVING count(*) > 3`)。
  把行级条件写进 HAVING 是纯粹的浪费。
  **难度:** d0
  **EN:** WHERE filters rows before grouping; HAVING filters groups after, so only aggregate conditions belong there.

- **Q:** `SUM` 和 `COUNT` 在零行上分别返回什么?为什么这个不对称会咬人?
  **A:** `COUNT` 返回 0,`SUM` 返回 **NULL**。
  于是 "总收入" 在没有订单时不是 0 而是 NULL,后续任何算术都变成 NULL,
  前端显示空白而不是零。习惯写 `coalesce(sum(x), 0)`。
  **难度:** d1
  **EN:** SUM over zero rows is NULL, not zero, so wrap it in coalesce whenever the empty case is possible.

- **Q:** `DISTINCT ON` 在平局时返回哪一行?你的代码为什么因此要加 `event_id desc`?
  **A:** 平局时返回哪一行是**未指定**的,由执行计划决定。
  你的 `last_row` 段只按 `event_time desc` 排时,同一毫秒的两个事件会让并行扫描、
  索引选择这些无关因素决定用户最终的 rating 和 due_at。
  更糟的是时钟钳制把所有偏移时钟的事件映射到同一个上界,平局从罕见变成系统性。
  加 `event_id desc` 成本为零而结果确定:任何全序都好过没有全序。
  **难度:** d2
  **EN:** DISTINCT ON returns an unspecified row among ties, so you must supply a total order or let the plan decide your data.

- **Q:** `DISTINCT ON` 的标准 SQL 等价写法是什么?
  **A:** 窗口函数:
  `ROW_NUMBER() OVER (PARTITION BY 分组列 ORDER BY 排序列)` 然后外层 `WHERE rn = 1`。
  DISTINCT ON 更短且通常更快,但只有 Postgres 有;能说出等价物说明你懂它在做什么。
  **难度:** d1
  **EN:** DISTINCT ON is Postgres shorthand for ROW_NUMBER over a partition filtered to rank one.

- **Q:** Postgres 12 前后,CTE 的性能语义有什么变化?
  **A:** 12 之前 CTE 是**优化屏障**,一定被物化,可能导致该下推的过滤条件下不去。
  12 起默认允许内联(当成子查询优化)。
  需要强制物化写 `AS MATERIALIZED`,强制内联写 `AS NOT MATERIALIZED`。
  递归 CTE 和数据修改 CTE 始终物化。
  **难度:** d2
  **EN:** Since Postgres 12 CTEs are inlined by default, so the old "CTE as optimisation fence" advice is stale.

- **Q:** 数据修改 CTE(`WITH x AS (INSERT ... RETURNING ...)`)最大的价值是什么?
  **A:** 它让"插入,然后用插入的结果做后续写入"变成**一条语句**,因此天然原子,
  中间不存在别的事务能插进来的窗口。
  你的六段 CTE 就是靠这个把事件插入、outbox 写入、进度合并绑成一个不可分割的操作。
  **难度:** d1
  **EN:** A data-modifying CTE makes "insert, then write more based on what was inserted" a single atomic statement.

- **Q:** 读 EXPLAIN 时最有诊断价值的一个信号是什么?
  **A:** 估算 `rows` 和 `actual rows` 差一个数量级以上。
  计划选错几乎总是因为**估算错**,不是因为规划器笨。
  差得离谱通常意味着统计信息过期(跑 ANALYZE),或者多列之间存在相关性
  而规划器默认它们独立(用 `CREATE STATISTICS` 告诉它)。
  **难度:** d1
  **EN:** The single most useful signal is estimated rows versus actual rows; bad plans almost always come from bad estimates.

- **Q:** EXPLAIN 里的 `cost=0.29..8.31` 的单位是什么?
  **A:** **任意单位**,不是毫秒。它以"顺序读一个页"为 1.0 做标定,只能用来**互相比较**。
  两个数分别是"返回第一行的启动代价"和"返回全部行的总代价",
  这个区分很重要:带 LIMIT 的查询规划器优化的是启动代价。
  **难度:** d1
  **EN:** Cost is in arbitrary planner units anchored to one sequential page read, useful only for comparison.

- **Q:** EXPLAIN 里的 `Index Cond` 和 `Filter` 有什么本质区别?
  **A:** `Index Cond` 是用索引**定位**,只读出需要的行;`Filter` 是**读出来再扔掉**。
  所以 `Rows Removed by Filter` 很大就说明你的索引没覆盖到这个条件,
  数据库白读了一堆行。这是判断"该不该把某列加进复合索引"的直接依据。
  **难度:** d1
  **EN:** An Index Cond narrows what you read; a Filter throws away what you already read.

- **Q:** EXPLAIN ANALYZE 里 `actual time=0.5..1.2 rows=3 loops=1000` 的总耗时是多少?
  **A:** 大约 1200 毫秒,不是 1.2 毫秒。
  `actual time` 是**单次循环**的平均值,总耗时要乘以 `loops`。
  Nested Loop 内层出现巨大的 loops 值,通常就是这条查询慢的真正原因。
  **难度:** d2
  **EN:** Actual time is per loop, so multiply by loops before you decide a node is cheap.

---

## 6. N+1 与 ORM 的坑

### 概念讲解

**Mental model:一次查询拿回 100 张卡,然后在循环里对每张卡再查一次它的牌组,
就是 1 + 100 = 101 次数据库往返。**

为什么本地测不出来:开发机上数据库在同一台机器,一次往返 0.2 毫秒,
101 次 = 20 毫秒,你根本感觉不到。
上了生产,Lambda 在 VPC 里访问 RDS,一次往返 1 到 2 毫秒,
101 次 = 100 到 200 毫秒,而且这个数字**随结果集线性增长**。
一个"查 1000 条"的管理后台接口就直接超时。

**N+1 的本质是往返次数,不是查询复杂度。** 每条子查询单独看都是"走主键索引的
0.1 毫秒查询",完美。问题在于你付了 100 次网络延迟 + 100 次解析 + 100 次事务开销。
**所以"加索引"治不了 N+1**,索引不改变往返次数。

**为什么 ORM 特别容易掉进去:lazy loading 让属性访问看起来免费。**
```csharp
var cards = db.Cards.Where(c => c.DeckSlug == slug).ToList();
foreach (var c in cards) {
    Console.WriteLine(c.Deck.Title);   // 每次访问 c.Deck 触发一条 SELECT
}
```
`c.Deck.Title` 在语法上和访问一个内存字段一模一样,视觉上没有任何"我要发起 IO"的信号。
更隐蔽的一种:实体在 controller 里被序列化成 JSON 时才触发懒加载,
你在 service 层的代码看起来完全干净,查询是**序列化器**发出去的。

**三种修法:**
1. **Eager load**:`db.Cards.Include(c => c.Deck)`,ORM 生成一个 JOIN,一次拿完。
2. **两次查询 + 内存拼接**:先拿 100 张卡,收集 deck_slug 集合,
   `WHERE slug = ANY(@slugs)` 一次拿回所有牌组,在内存里做字典查找。
   总共 2 次往返。**当关联是"多对一且重复度高"时,这比 JOIN 更好**,
   因为 JOIN 会把牌组的字段重复 100 遍传过网络。
3. **批处理层(DataLoader 模式)**:把同一轮里的所有请求攒起来批量执行。
   GraphQL 场景几乎必备,因为解析器天生是逐字段调用的。

**Include 的反面坑:笛卡尔爆炸。**
一次 `Include` 两个**集合**导航属性(一个 Deck 有 50 张卡和 30 条评论),
单条 JOIN 会产出 50 × 30 = 1500 行,每行都重复 Deck 的所有列。
你为了省往返次数,付出了传输量爆炸。
EF Core 的 `AsSplitQuery()` 就是干这个的:拆成多条查询各自拿,再在客户端拼。
**取舍是明确的:单查询 = 少往返但可能行数相乘;拆分查询 = 多几次往返但传输量线性。**
注意拆分查询失去了单条语句的一致性,除非你显式开事务。

**其他 ORM 常见坑,值得点名:**
- **变更追踪开销**:EF 默认追踪每个实体以便检测修改。只读查询加 `AsNoTracking()`,
  在大结果集上是数倍的差别。
- **`SELECT *` 拉大列**:ORM 默认取全部列,一个存了大 jsonb 或 text 的列会被无谓地
  拉过网络。用投影 `Select(c => new { c.Id, c.Title })`。
- **IN 列表撑爆 plan cache**:参数个数变化的 `IN (@p1, ..., @pN)` 会为每种个数
  生成一个不同的计划。Postgres 里改用 `= ANY(@array)`,一个参数一个计划。
- **迁移生成的索引不是你要的**:ORM 会为外键自动建索引,但它不知道你的
  排序元组和 keyset 边界。你的 `012_sync_keyset_index.sql` 这种索引,
  没有任何 ORM 会替你生成。
- **在循环里 SaveChanges**:每次一个事务一次往返。批量操作应该攒起来一次提交。

**你自己代码里的对照。** recallsmith 用的是手写 SQL + Npgsql,所以没有 lazy loading
意义上的 N+1。但**同一个道理换了个形状仍然存在**:如果摄入接口对 200 个事件
逐条 `INSERT`,那就是 200 次往返。你实际的做法是**一条语句、多组 VALUES、
一次往返**(`values {string.Join(", ", values)}`),外加把整个合并逻辑
用 CTE 留在数据库里做。这是同一条原则的正面案例:
**尽可能让"每次请求的往返次数"是常数,而不是随数据量增长。**
面试里把 N+1 和这个批量摄入放在一起讲,比只背 N+1 的定义强得多。

**怎么发现 N+1:** 打开 SQL 日志,找**同一条 SQL 文本出现 N 次、只有参数不同**。
APM 里的表现是一个 span 下挂着几十上百个几乎一样的 DB span。
这是最容易识别的性能反模式,几乎不需要猜。

**常见误解**
- "加索引能治 N+1"。不能,往返次数不变。
- "用了 ORM 就一定有 N+1"。不一定,配置正确的 eager load 完全没问题;
  反过来手写 SQL 也照样能在循环里发查询。问题在**控制流**,不在工具。
- "一次 JOIN 总是比两次查询快"。多对一且重复度高时,JOIN 的传输冗余可能更贵。

### 卡片素材(手动录入用)

- **Q:** N+1 问题的本质代价是什么?为什么加索引治不了它?
  **A:** 代价是**往返次数**,不是单条查询的复杂度。
  每条子查询单看都是走主键的 0.1 毫秒查询,但你付了 N 次网络延迟、N 次解析和事务开销。
  索引只让每条查询更快,不改变往返次数,所以完全治不了。
  **难度:** d1
  **EN:** N+1 costs round trips, not query complexity, which is why adding an index changes nothing.

- **Q:** 为什么 N+1 在开发机上几乎测不出来?
  **A:** 本地数据库在同一台机器,一次往返 0.2 毫秒,101 次也只有 20 毫秒。
  生产里跨网络一次往返 1 到 2 毫秒,同样的代码变成 100 到 200 毫秒,
  而且随结果集**线性增长**,数据量一大就超时。
  **难度:** d0
  **EN:** Locally a round trip is microseconds, so the cost only becomes visible once the database is across a network.

- **Q:** 为什么 lazy loading 让 N+1 特别难被发现?
  **A:** 因为 `card.Deck.Title` 在语法上和访问内存字段一模一样,没有任何"要发起 IO"的信号。
  更隐蔽的是实体被序列化成 JSON 时才触发,查询是**序列化器**发出去的,
  你的 service 层代码看起来完全干净。
  **难度:** d1
  **EN:** Lazy loading hides IO behind property access, and the queries can even fire inside the serialiser.

- **Q:** 修 N+1 的三种办法各适合什么场景?
  **A:** Eager load(Include/JOIN)适合一对一或小集合;
  两次查询 + 内存字典拼接适合**多对一且重复度高**的关联,避免把父行字段重复 N 遍传输;
  DataLoader 批处理适合 GraphQL 这类天生逐字段调用的场景。
  **难度:** d1
  **EN:** Join for small fan-out, two queries plus an in-memory map for high-duplication many-to-one, batching for per-field resolvers.

- **Q:** 一次 `Include` 两个集合导航属性会出什么问题?怎么修?
  **A:** 笛卡尔爆炸:50 张卡 × 30 条评论 = 1500 行,每行重复父实体的所有列。
  省了往返次数,炸了传输量。
  EF Core 的 `AsSplitQuery()` 拆成多条查询各自拿再拼,代价是多几次往返
  且失去单语句一致性(需要时得显式开事务)。
  **难度:** d1
  **EN:** Including two collections multiplies rows, so split the query and trade round trips for linear transfer.

- **Q:** 怎么在日志里一眼认出 N+1?
  **A:** 找**同一条 SQL 文本重复出现 N 次、只有参数不同**。
  APM 里表现为一个请求 span 下挂着几十上百个几乎相同的 DB span。
  这是最容易识别的性能反模式,基本不需要猜。
  **难度:** d0
  **EN:** Look for the same SQL text repeated with only the parameter changing.

- **Q:** 为什么 `IN (@p1, ..., @pN)` 会撑爆 plan cache,Postgres 里怎么写更好?
  **A:** 参数个数每变一次就是一条不同的 SQL 文本,每种个数生成并缓存一个计划。
  Postgres 里改用 `= ANY(@array)`:参数永远是一个数组,一条 SQL 文本,一个计划。
  **难度:** d2
  **EN:** A variable-length IN list produces a distinct statement per arity; use = ANY(array) to keep one plan.

- **Q:** 你的进度摄入接口一批最多 200 个事件,为什么它不是 N+1?
  **A:** 因为它是**一条语句、多组 VALUES、一次往返**,合并逻辑全部用 CTE 留在数据库里。
  如果改成循环里逐条 INSERT,那就是 200 次往返加 200 次事务开销,
  和 ORM 的 N+1 是同一个病。原则是让每次请求的往返次数是**常数**,不随数据量增长。
  **难度:** d1
  **EN:** One statement with many VALUES rows keeps round trips constant instead of proportional to batch size.

- **Q:** "用了 ORM 就会有 N+1,手写 SQL 就没有"这句话错在哪?
  **A:** 错在把问题归给工具。配置正确 eager load 的 ORM 完全没有 N+1;
  手写 SQL 在循环里发查询照样是 N+1。
  问题出在**控制流**(有没有在循环里发起 IO),不在于查询是谁生成的。
  **难度:** d0
  **EN:** N+1 is a control-flow problem, not an ORM problem; a hand-written query inside a loop is just as bad.

---

## 7. NoSQL 模型(文档 / KV / 宽列)

### 概念讲解

**四大家族,一句话各一个:**
- **KV(Redis, DynamoDB 的基础形态)**:只有"按键取值"。极快,因为它拒绝回答别的问题。
- **文档(MongoDB, DocumentDB)**:值是可以被部分查询和索引的 JSON。
  适合"聚合根整个读整个写"的数据,比如一份订单连着它的所有行项。
- **宽列(Cassandra, HBase)**:行键定位分区,分区内是有序的列族。
  为写入吞吐和线性扩展优化,典型是时间序列。
- **图(Neo4j)**:关系本身是一等公民,适合多跳遍历(朋友的朋友的朋友)。

**DynamoDB 的 mental model:一个巨大的、被切成很多物理分区的哈希表。**
- **Partition key(PK)** 被哈希,哈希值决定这条数据落在哪个物理分区。
- **Sort key(SK)** 决定同一个分区**内部**的顺序。
- 一次 `Query` **必须给定一个确定的 partition key**,然后可以在 sort key 上做
  范围条件(`begins_with`、`between`、`>`)。
- 不给 partition key 就只能 `Scan`,而 Scan 是全表遍历,在生产上基本等同于事故。

**为什么 DynamoDB 没有 JOIN(这是本模块最值得讲清楚的一题)。**
JOIN 要求把分散在不同分区(不同物理机)的数据取来配对。
一旦允许这件事,查询延迟就取决于"最慢的那个分区 + 网络 + 数据倾斜",
**不再有界**。而 DynamoDB 卖的就是"任何数据规模下都是个位数毫秒",
这条承诺和 JOIN 在物理上不兼容。
所以 DynamoDB 的取舍是:**把 JOIN 的工作从读时挪到写时**。
你在写入的时候就把该在一起的数据放进同一个 item collection,
读的时候一次 Query 全部拿回来。

**单表设计(single-table design)的思想。**
不是"把所有东西塞一张表"这种口号,而是三步:
1. **先穷举 access patterns**(比如"按用户拿他的全部牌组"、"按牌组拿它的全部卡片"、
   "按用户拿最近 20 次复习")。**在设计 key 之前**就写下来。
2. **设计 key 让每个 pattern 都变成一次 Query。**
   主键列起通用的名字(`PK`、`SK`),用前缀区分实体类型:
   ```
   PK              SK                    其他属性
   USER#u123       PROFILE               email, plan
   USER#u123       DECK#aws-basics       title, cardCount
   USER#u123       DECK#sql-core         title, cardCount
   DECK#aws-basics CARD#0001             front, back
   ```
   "拿用户 u123 的档案 + 全部牌组" = `Query PK = 'USER#u123'`,**一次读**。
   这就是用**数据布局**代替 JOIN:相关数据物理上就存在一起(item collection)。
3. **需要反向访问时加 GSI。**

**GSI(Global Secondary Index)的准确事实:**
- 它是**另一组 PK/SK 的异步维护的副本**,可以选择投影哪些属性。
- **GSI 只支持最终一致读,没有强一致选项。** 因为它是异步复制的,
  写主表成功后 GSI 可能滞后几毫秒到更久。这是最常考的一条。
- GSI 有**自己的读写容量**,写主表时每个 GSI 都要写一次,所以 GSI 是**写放大**。
- **稀疏索引(sparse index)是个很漂亮的技巧**:只有**含有 GSI key 属性**的 item
  才会进入索引。所以给"待处理"的 item 加一个 `gsi1pk = 'PENDING'` 属性,
  处理完就**删掉这个属性**,该 item 自动从索引中消失。
  这样 GSI 天然只包含待处理项,规模只随积压量增长。
  **这和你 Postgres 里 `where status = 'pending'` 的部分索引是同一个思想的两种实现。**
- **LSI(Local Secondary Index)** 是另一回事:同一个 PK、不同的 SK,
  **只能在建表时创建**,支持强一致读,但会让该分区受 10GB 上限约束。
  实务中大多数场景用 GSI。

**热分区(hot partition)。** partition key 选择性差就会把流量打到少数分区上。
典型错误:用 `status` 或 `date`(所有今天的写入都进同一个分区)当 PK。
修法是加散列后缀(`DATE#2026-08-15#7`,写时随机选后缀,读时并行查全部后缀),
或者换一个高基数的 key。

**DynamoDB 里的并发控制:**
- **条件写(ConditionExpression)** 就是乐观锁:
  `UpdateItem ... ConditionExpression: "version = :expected"`,
  不满足抛 `ConditionalCheckFailedException`。和 SQL 的
  `UPDATE ... WHERE version = ?` 判受影响行数是同一个东西。
- **TransactWriteItems** 提供跨 item 的原子性(最多 100 个 item),
  但成本是普通写的两倍,而且不是长事务,只是一次原子提交。

**和你 Postgres 知识的对应关系(这个类比很好用):**

| DynamoDB | Postgres 类比 |
|---|---|
| partition key | 复合索引的最左列(必须等值) |
| sort key | 复合索引的后续列(可范围、可排序) |
| Query 的 KeyConditionExpression | `Index Cond`(用索引定位) |
| Query 的 FilterExpression | `Filter`(读出来再扔,**照样计费**) |
| GSI | 另一个复合索引,但是**异步维护的独立副本** |
| Scan | `Seq Scan`,只是代价大得多 |

**FilterExpression 照样计费**这一点特别值得记:它在读取**之后**才过滤,
你为被扔掉的数据付了钱。和 EXPLAIN 里 `Rows Removed by Filter` 是完全一样的教训。

**常见误解**
- **"NoSQL 无模式,所以不用建模。"** 恰恰相反。关系库允许你事后加索引救急,
  DynamoDB 的 key 设计错了往往要**重建表并迁移数据**。
  DynamoDB 需要**更多**前期建模,只不过建的是 access pattern 而不是实体关系。
- "NoSQL 比 SQL 快"。DynamoDB 在**它设计的那个访问模式上**快且延迟稳定;
  换一个没预设的查询,它可能根本做不了,或者要全表 Scan,比 Postgres 慢几个数量级。
- "文档数据库不需要事务"。MongoDB 单文档写是原子的,跨文档需要显式多文档事务,
  代价和限制都不小。"我的聚合根就是一个文档"才是它真正的舒适区。

### 卡片素材(手动录入用)

- **Q:** DynamoDB 为什么不提供 JOIN?这背后是什么取舍?
  **A:** 因为 JOIN 要跨物理分区取数配对,延迟就取决于最慢的分区和数据倾斜,**不再有界**。
  而 DynamoDB 承诺的是任何规模下的个位数毫秒,两者物理上不兼容。
  取舍是把 JOIN 的工作**从读时挪到写时**:写入时就把相关数据放进同一个 item collection。
  **难度:** d1
  **EN:** A join needs cross-partition fan-out, which breaks the bounded-latency promise DynamoDB is built to sell.

- **Q:** DynamoDB 的 partition key 和 sort key 各决定什么?
  **A:** partition key 被哈希,决定数据落在**哪个物理分区**;
  sort key 决定**分区内的顺序**,因此支持范围条件和有序读。
  Query 必须给定一个确定的 partition key,不给就只能 Scan。
  **难度:** d0
  **EN:** The partition key picks the machine, the sort key picks the order within it.

- **Q:** 单表设计的第一步是什么?为什么顺序不能反?
  **A:** 第一步是**穷举 access patterns**,在设计 key 之前就写下来。
  因为 key 一旦定了,能高效回答的问题就定死了。
  关系库可以事后加索引救急,DynamoDB 的 key 设计错了往往要重建表并迁移数据。
  **难度:** d1
  **EN:** List every access pattern before you design the key, because in DynamoDB the key is the query plan.

- **Q:** GSI 和 LSI 的三个关键区别是什么?
  **A:** 一,GSI 可以用**完全不同的 PK**,LSI 只能换 SK、PK 必须相同;
  二,GSI **只能最终一致读**,LSI 支持强一致读;
  三,GSI 可以随时创建,LSI 只能建表时创建且会让该分区受 10GB 上限约束。
  **难度:** d1
  **EN:** A GSI can repartition and is eventually consistent; an LSI keeps the partition key, allows strong reads, and is create-time only.

- **Q:** 为什么 GSI 上读不到刚写进去的数据不算 bug?
  **A:** 因为 GSI 是**异步维护的副本**,写主表返回成功后索引可能还没更新,
  而且 GSI 根本不提供强一致读这个选项。
  需要"写完立刻读到"就必须走主表的主键做强一致 GetItem,不能走 GSI。
  **难度:** d1
  **EN:** A GSI is replicated asynchronously and offers no strongly consistent read, so read-after-write must go through the base table.

- **Q:** DynamoDB 的稀疏索引技巧是什么?它和你 Postgres 的哪个索引是同一个思想?
  **A:** 只有**含有 GSI key 属性**的 item 才会进入索引,所以给待处理项加一个
  `gsi1pk = 'PENDING'`,处理完就删掉这个属性,该项自动从索引消失。
  索引规模只随积压量增长。
  这和你 `idx_analytics_outbox_pending ... where status = 'pending'` 的部分索引
  是完全同一个思想的两种实现。
  **难度:** d2
  **EN:** A sparse GSI only indexes items that carry the key attribute, which is DynamoDB's version of a partial index.

- **Q:** DynamoDB 的 FilterExpression 有什么陷阱?
  **A:** 它在**读取之后**才过滤,你要为被扔掉的数据付读容量。
  它减少的是返回给你的数据量,不是读取量。
  这和 Postgres EXPLAIN 里 `Filter` 与 `Index Cond` 的区别是完全一样的教训:
  能进 key condition 的条件绝不要留给 filter。
  **难度:** d1
  **EN:** FilterExpression runs after the read and you still pay for the discarded items, exactly like a Filter node versus an Index Cond.

- **Q:** 热分区是怎么产生的,怎么修?
  **A:** partition key 选择性太低,把流量集中到少数物理分区。
  典型错误是拿 `status` 或 `date` 当 PK,当天所有写入都进同一个分区。
  修法是加散列后缀(写时随机选,读时并行查全部后缀),或者换一个高基数的 key。
  **难度:** d1
  **EN:** A low-cardinality partition key funnels traffic to one node; shard it with a suffix or pick a higher-cardinality key.

- **Q:** DynamoDB 里怎么做乐观锁?
  **A:** 用条件写:`UpdateItem` 带 `ConditionExpression: "version = :expected"`,
  不满足就抛 `ConditionalCheckFailedException`。
  这和 SQL 的 `UPDATE ... WHERE version = ?` 然后检查受影响行数是同一个机制,
  只是失败以异常而不是行数 0 的形式呈现。
  **难度:** d1
  **EN:** DynamoDB does optimistic concurrency with a ConditionExpression, the same idea as a versioned UPDATE ... WHERE.

- **Q:** "NoSQL 无模式所以不用建模"错在哪?
  **A:** 错得刚好相反。DynamoDB 需要**更多**前期建模,只是建的是 access pattern
  而不是实体关系。
  关系库允许你事后加索引救急、写个新 JOIN 就能回答新问题;
  DynamoDB 的 key 设计错了,新问题可能只能靠全表 Scan 或重建表。
  **难度:** d1
  **EN:** Schemaless means no enforced shape, not no modelling; DynamoDB demands more design up front, not less.

- **Q:** 用你熟悉的 Postgres 术语,DynamoDB 的 Query 对应什么?
  **A:** partition key 对应复合索引的**最左列且必须等值**,sort key 对应后续列
  (可范围、可排序),KeyConditionExpression 对应 `Index Cond`,
  FilterExpression 对应 `Filter`,Scan 对应 `Seq Scan`。
  区别在于 Postgres 允许你没索引也能查(慢),DynamoDB 是硬性拒绝。
  **难度:** d1
  **EN:** A DynamoDB Query is a composite-index prefix lookup where the leading column is mandatory and equality-only.

---

## 8. 选型与一致性

### 概念讲解

**CAP 的诚实版(背错的人太多了,讲对就是加分)。**

CAP 说的是:**在网络分区(P)真的发生时**,你只能在
**C(线性一致性)** 和 **A(每个非故障节点都返回响应)** 之间选一个。
三个关键澄清:
1. **不是"三选二"**。分区不发生的时候你 C 和 A 都有。P 不是你能选的,
   它是网络给你的现实。
2. **C 特指线性一致性**(所有人看到同一个全局顺序),不是 ACID 里的 C(一致性约束)。
   这两个 C 完全是两回事,只是撞名。
3. **单机 Postgres 根本不在 CAP 的讨论范围内**,因为单节点没有"分区"可言。
   说"Postgres 是 CP"是口号不是分析。有意义的问法是:
   *你的 Postgres 加了同步副本还是异步副本?异步副本上的读是最终一致的。*

**PACELC 更实用**:分区时(P)在 A 和 C 之间选,**否则(E)** 在
**延迟(L)** 和 **一致性(C)** 之间选。
后半句才是你 99.9% 的时间面对的真实取舍:
跨区同步复制更一致但每次写多几十毫秒,异步复制更快但读副本会看到旧数据。

**最终一致性对用户具体意味着什么。** 不要说抽象的"最终会收敛",说画面:
- **读不到自己刚写的**:用户点了"标记已学",接口返回 200,页面刷新后又变回未学。
  这是 read-your-writes 违例,是最招骂的一种,因为用户确信自己看到了成功。
- **时间倒流**:连续刷新两次,第二次看到的数据比第一次**旧**(打到了不同的副本)。
  这是 monotonic reads 违例。
- **因果错乱**:先看到回复,再看到被回复的原帖。

工程上的修法(按成本):
1. **客户端乐观更新**:本地先应用,不等服务端。移动端几乎必做,
   你的 app 本来就是这个架构:本地队列先记,再异步同步。
2. **写后读主库 / 粘性会话**:用户写完之后的一段时间内,他的读强制走主库。
3. **版本令牌**:客户端带上自己已知的最新版本号,副本落后就等待或转发。

**锚点:你的 per-column LWW 合并,以及它的三个正确性支柱。**

LWW(last write wins)是最简单的合并策略:比时间戳,大的赢。
它的正确性**完全**依赖"时间戳可比且构成全序",而分布式的墙钟不满足这一点。
你的 `ProgressEvents.cs` 里三处设计恰好补上了这三个洞,每一处都能单独讲一分钟:

1. **时钟钳制。** `eventTimeMs` 被限制在 `nowMs + 5 分钟` 以内。
   理由不是洁癖:合并用的是 `greatest(...)`,**单调且没有撤销路径**。
   一台时钟设成 2030 年的设备写进来一次,`last_reviewed_at` 就永远停在未来,
   此后每一次真实复习都会在 LWW 比较中输掉,这个用户的进度**永久损坏**。
   5 分钟吸收正常时钟偏移;超过的**钳制而不是丢弃**,因为那次复习确实发生了,
   丢事件等于丢用户的真实劳动。
   > 这段推理的形状值得记住:**单调合并算子 + 无边界的外部输入 = 不可逆的污染。**

2. **平局的确定性 tiebreak。** `distinct on` 平局时返回哪行是未指定的,
   所以加了 `event_id desc`。而且时钟钳制本身会把所有偏移时钟的事件映射到
   **同一个上界**,把罕见碰撞变成系统性碰撞。任何全序都好过没有全序。

3. **LWW 的粒度必须等于语义原子性的粒度。**
   这是 per-column LWW 最深的一条边界,也是最能显功力的一点。
   `last_rating`、`due_at`、`srs_stage`、`last_scheduler_version` 这四列
   **用同一个谓词**决定胜负,而不是各自取最大。
   因为它们是一个**原子判词**:"最近一次复习之后的状态"。
   如果逐列取最大,stage 可能来自设备 A 而 due_at 来自设备 B,
   拼出来的那对值**描述了一次没有任何人做过的复习**。
   同理,`srs_stage` 不能用 `greatest()`:阶段是"上次复习把卡片留在哪一级",
   不是"历史最高级"。用 greatest 的话,`again` 造成的降级将永远无法传播出去。
   而 `review_count` 用相加、`last_seen_revision` 用 `greatest`、
   `status` 用 `greatest`,因为这三个**本身就是单调量**。
   > **一句话总结:合并算子必须由数据的语义决定,而不是由方便决定。**

对照 `Vpc/Runtime/DrawStateMerge.cs` 里三种数据三种算子的选择,同一条原则:
- `owned`(已解锁的卡)用**集合并**:解锁没有逆操作,并集幂等且与顺序无关,
  **信息不丢**。用户最在意的收藏拿到了唯一不会出错的算子。
- `pity`(保底计数)和 `wallet` 用 **LWW**:它们是"朝向某个承诺的计数器"而不是
  累积事实,两台设备的计数相加会**凭空发明用户没做过的抽卡**。
  代价是接受丢失一侧的更新,这是明确权衡后接受的损失。

集合并是 CRDT(收敛且无损),LWW 收敛但有损。
**"哪些数据配得上无损算子"是个设计决策,不是技术限制。**

**"哪条性质由哪一层保证":这是把整个系统讲清楚的最强框架。**
面试被问"你怎么保证数据不丢/不重"的时候,按层回答而不是按功能回答:

| 性质 | 由哪一层保证 |
|---|---|
| 事件不丢 | 客户端本地队列(离线也先落盘) |
| 事件不重复计数 | `event_id` 的**唯一约束** + `on conflict do nothing`(数据库层,不是应用判断) |
| 插入与合并同时生效 | 单条 SQL 语句 + 事务(六段 CTE) |
| 合并结果与到达顺序无关 | 合并函数本身是幂等/可交换的(`DrawStateMerge.cs` 是它的可执行规格) |
| 分析事件不因外部调用失败而丢 | transactional outbox(事件行和 outbox 行在同一事务里写) |
| 发布的 at-least-once 语义 | outbox 消费者 `for update skip locked` + 15 分钟租约回收 |
| 下游不因重复发布而算错 | 下游必须自己幂等(因为上面这条是 at-least-once,不是 exactly-once) |

最后一行是关键:**outbox 给的是 at-least-once,不是 exactly-once。**
诚实地说出这一点,并说明"所以消费端按 event_id 去重",
比声称自己做到了 exactly-once 可信得多。分布式系统里
exactly-once **投递**不存在,存在的是 at-least-once 投递 + 幂等**处理**。

**选型的现实判据。** 别背对比表,记这几条:
- **默认选 Postgres。** 它同时给你关系模型、JSONB(文档)、全文检索、部分索引、
  数组、range 类型、`SKIP LOCKED` 当队列、逻辑复制。
  在引入第二个数据系统之前,先证明 Postgres 做不到,
  因为多一个数据系统就多一份一致性问题和一份运维负担。
- **需要跨表不变式、需要 ad-hoc 查询(产品经理明天会问新问题)** → 关系库。
- **访问模式完全已知且不变、要求极高吞吐和有界延迟** → DynamoDB。
- **数据本身是短暂的、可重建的**(会话、缓存、排行榜、限流计数)→ Redis。
- **全文检索、复杂聚合分析** → 专用引擎,但先试 Postgres 的 `tsvector` 和
  物化视图,很多项目根本到不了需要 Elasticsearch 的规模。
- **判断标准不是"哪个更强",是"哪个的失败模式我能接受"。**

**常见误解**
- "CAP 三选二"。见上。
- "最终一致性 = 数据会丢"。不是,最终一致性说的是**收敛延迟**,不是丢失。
  会丢的是 LWW 这种**有损合并算子**,那是另一个独立的决策。
- "用了分布式数据库就有高可用"。可用性还取决于你的写路径是否需要多数派、
  客户端超时怎么设、以及故障切换要多久。
- "exactly-once 队列"。营销词。真实机制永远是 at-least-once 投递 + 幂等消费,
  或者 at-most-once + 接受丢失。

### 卡片素材(手动录入用)

- **Q:** CAP 定理的"三选二"说法错在哪?正确的表述是什么?
  **A:** P 不是你能选的,它是网络给你的现实。
  正确表述是:**当分区真的发生时**,你只能在 C(线性一致性)和 A(每个非故障节点都响应)
  之间选一个;分区不发生时两个都有。
  另外这里的 C 是线性一致性,不是 ACID 的 C,只是撞名。
  更实用的是 PACELC:分区时在 A 和 C 之间选,**否则**在延迟和一致性之间选,
  后半句才是你 99.9% 的时间面对的取舍。
  **难度:** d1
  **EN:** You do not choose partition tolerance; CAP forces a consistency-availability choice only during a partition, and PACELC adds the everyday latency-versus-consistency trade-off.

- **Q:** 为什么说"Postgres 是 CP 数据库"这句话没有信息量?
  **A:** 因为单节点根本没有"分区"可言,CAP 的前提不成立。
  有意义的问法是复制拓扑:同步副本还是异步副本?
  异步副本上的读是**最终一致**的,这才是真正影响用户的那个事实。
  **难度:** d2
  **EN:** CAP applies to replicated systems; for a single node the question is meaningless, so ask about the replication mode instead.

- **Q:** 最终一致性最招用户骂的那种表现是什么?怎么修?
  **A:** 读不到自己刚写的:点了"标记已学",接口返回 200,刷新后又变回未学。
  用户确信自己看到了成功,所以这比慢更让人愤怒。
  修法按成本递增:客户端乐观更新、写后一段时间内的读强制走主库(粘性会话)、
  客户端携带版本令牌让落后的副本等待或转发。
  **难度:** d1
  **EN:** The worst symptom is failing read-your-writes; fix it with optimistic UI, sticky reads to the primary, or a version token.

- **Q:** LWW 合并的正确性依赖什么前提?这个前提在分布式系统里为什么不成立?
  **A:** 依赖时间戳可比且构成**全序**。分布式的墙钟不满足:设备时钟会偏移、会被用户改、
  会因为夏令时或 NTP 跳变。
  所以裸用 LWW 必须额外解决三件事:钟的上界、平局的确定性、以及哪些列该一起决定胜负。
  **难度:** d1
  **EN:** LWW assumes a total order on timestamps, which wall clocks across devices do not provide.

- **Q:** 你的 `eventTimeMs` 为什么要钳制在 `now + 5 分钟`?不钳制会怎样?
  **A:** 因为合并用 `greatest(...)`,**单调且没有撤销路径**。
  一台时钟设成 2030 年的设备写进来一次,`last_reviewed_at` 就永远停在未来,
  此后每次真实复习都会在 LWW 比较中输掉,这个用户的进度永久损坏。
  超界**钳制而非丢弃**,因为那次复习确实发生了,丢事件等于丢用户的真实劳动。
  **难度:** d2
  **EN:** A monotonic merge operator has no undo, so one future-dated write from a skewed clock poisons that row forever.

- **Q:** 为什么 `last_rating`、`due_at`、`srs_stage` 必须用**同一个**谓词决定胜负,
  而不能逐列取最大?
  **A:** 因为它们是一个原子判词:"最近一次复习之后的状态"。
  逐列取最大会让 stage 来自设备 A、due_at 来自设备 B,
  拼出来的那一对值描述了一次**没有任何人做过的复习**。
  原则是:**LWW 的粒度必须等于语义原子性的粒度。**
  **难度:** d3
  **EN:** Per-column merge must respect semantic atomicity, or you synthesise a state that no real event ever produced.

- **Q:** `srs_stage` 为什么不能用 `greatest()` 合并,而 `review_count` 可以用相加?
  **A:** 因为语义不同。stage 是"上次复习把卡片留在哪一级",不是"历史最高级";
  用 greatest 的话,`again` 造成的降级将永远无法传播出去,卡片再也降不回来。
  而 review_count 本身就是可累加的计数,status 和 last_seen_revision 本身就是单调量。
  **合并算子必须由数据语义决定,不是由方便决定。**
  **难度:** d2
  **EN:** The merge operator has to follow the meaning of the column: a ladder position is not a maximum.

- **Q:** 你的抽卡状态里,`owned` 用集合并而 `pity`/`wallet` 用 LWW,理由分别是什么?
  **A:** `owned` 没有逆操作(解锁了就永远解锁),所以并集幂等、与顺序无关、**信息不丢**,
  用户最在意的收藏拿到了唯一不会出错的算子。
  `pity` 和 `wallet` 是"朝向某个承诺的计数器"而不是累积事实,
  两台设备相加会**凭空发明用户没做过的抽卡**,所以接受 LWW 的有损。
  **难度:** d2
  **EN:** Set union is lossless and fits a monotonic collection; counters toward a promise must not be summed across devices.

- **Q:** transactional outbox 给的是 exactly-once 吗?
  **A:** 不是,是 **at-least-once**。
  消费者可能在发布成功后、标记 sent 之前崩溃,重启后会重发同一条。
  所以下游必须按 `event_id` 自己幂等。
  分布式系统里 exactly-once **投递**不存在,存在的是 at-least-once 投递 + 幂等**处理**。
  **难度:** d1
  **EN:** An outbox gives at-least-once delivery, so the consumer side must be idempotent on the event id.

- **Q:** 被问"你怎么保证数据不丢不重"时,按什么框架回答最有说服力?
  **A:** 按**层**回答,不按功能回答:不丢靠客户端本地队列;不重复计数靠 `event_id`
  的唯一约束加 `on conflict do nothing`(数据库层,不是应用先查再判);
  插入与合并同时生效靠单条 SQL 加事务;
  与到达顺序无关靠合并函数本身幂等可交换;
  分析事件不丢靠 transactional outbox。
  每条性质都能指到具体机制,而不是"我们做了重试"。
  **难度:** d1
  **EN:** Name which layer guarantees which property, so every claim points at a concrete mechanism rather than at "we retry".

- **Q:** 引入第二个数据存储之前应该先问自己什么?
  **A:** 先证明 Postgres 做不到。
  它同时给你关系模型、JSONB、全文检索、部分索引、数组、`SKIP LOCKED` 当队列、逻辑复制。
  多一个数据系统就多一份跨系统一致性问题和一份运维负担,
  判断标准不是"哪个更强",是"哪个的失败模式我能接受"。
  **难度:** d1
  **EN:** Adding a second datastore adds a consistency problem, so first prove Postgres cannot do the job.

- **Q:** "最终一致性 = 数据会丢",这句话错在哪?
  **A:** 最终一致性说的是**收敛延迟**:副本暂时不同,但最终会一致。
  真正会丢的是**有损的合并算子**(比如 LWW 丢掉输的一方),
  那是一个独立的设计决策,和一致性模型不是同一件事。
  用集合并这类 CRDT 就能既最终一致又不丢。
  **难度:** d1
  **EN:** Eventual consistency describes convergence delay; loss comes from choosing a lossy merge operator, which is a separate decision.
