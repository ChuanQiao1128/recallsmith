# C# 后端基础概念题库设计(csharp-backend-fundamentals)

> 目标:一副让你**真正理解 C# 后端**的卡组——既为 NZ 面试(.NET 岗是你的主战场),
> 也为看懂和改进你自己的 src_C。示例卡全部用 docs/console-import-plan.md 定义的
> 可导入格式书写,导入功能上线后可整段粘贴进控制台。

---

## 一、设计原则(写卡前先读)

1. **考检索,不考识别。** 问题必须让你"从空白中生成答案",不是"看到就想起来"。
   - ❌ "什么是 async/await?"(定义型,背了就忘)
   - ✅ "await 一个已完成的 Task 会切线程吗?为什么?"(必须理解机制才能答)
   问题句式优先:**为什么 / 什么时候会坏 / 两者选哪个、代价是什么 / 这段代码输出什么、为什么**。

2. **难度诚实,因为难度=稀有度。** 移动端映射(cardRarity.ts):d0-1=COM,d2=RAR,d3-4=LEG。
   你的 App 用最盛大的仪式庆祝最难的知识点——所以 **LEG 卡必须配得上金色动画**:
   只有"答对它说明你真的懂这个子系统"的问题才配 d3+。
   目标分布对齐抽卡经济:**约 70% COM / 22% RAR / 8% LEG**(120 张 ≈ 84/26/10)。

3. **每张 A 的最后一行是英文面试句。** 你用中文理解,用英文作答——
   每张卡的答案以一句可直接在面试里说出口的英文收尾(下方示例卡都有)。
   复习时把这句读出声,这是口语肌肉记忆,不是翻译练习。

4. **模块八锚定你自己的代码。** 最硬的概念(原子性、幂等、LWW、keyset 分页)你已经在
   src_C 里亲手写过并用真库测试证明过——这些卡引用你自己的文件,答案是你自己的战绩。
   **这个模块 LEG 浓度最高,这是刻意的:你代码库里的知识就是传说级。**

5. **orderInDeck 按模块分段**(×10 留插缝),warmup 位天然落在 d0-1 卡上,
   boss 位(若已按 rarity 选卡)自然命中模块八。

---

## 二、模块地图(120 张的体量规划)

| # | 模块 | 张数 | 难度重心 | 覆盖要点 |
|---|---|---|---|---|
| 1 | 类型系统与内存 | 18 | d0-2 | 值/引用类型、struct vs class、装箱、string 不可变、record、模式匹配、Nullable |
| 2 | async/await 与并发 | 20 | d1-4 | Task 状态机、async void 的危险、同步上下文与死锁、CancellationToken、lock/Interlocked、Task.WhenAll 异常聚合 |
| 3 | GC 与资源管理 | 14 | d1-3 | 分代回收、IDisposable/using 语义、finalizer 何时错、LOH、内存泄漏的常见形状 |
| 4 | 集合与 LINQ | 16 | d1-3 | 延迟执行的坑、IEnumerable vs IQueryable、Dictionary 内部结构、yield、多次枚举 |
| 5 | 异常与错误设计 | 10 | d0-2 | throw 与 throw ex 的栈差异、异常 vs 返回值、何时该捕获、自定义异常的门槛 |
| 6 | 数据访问(Npgsql/ADO.NET) | 16 | d1-4 | 参数化与注入、事务边界、连接池行为、乐观并发(你 Cards.cs 的 version+1 就是)、ON CONFLICT |
| 7 | ASP.NET Core 基础 | 14 | d1-3 | DI 三种生命周期与误配后果、中间件管道顺序、模型绑定、配置分层(面试必考,即使你的后端是 Lambda) |
| 8 | **你自己的后端(传说模块)** | 12 | d2-4 | 6-CTE 原子摄入、event_id 幂等、LWW vs greatest、keyset 微秒游标、transactional outbox、90 天上界不变量 |

写作顺序建议:**8 → 2 → 6 → 7 → 1 → 4 → 3 → 5**。
先写模块八(素材全在你脑子和 git log 里,写得最快、面试最急用),
再写 async(NZ 面试第一高频),数据访问和 ASP.NET 紧随。

---

## 三、示例卡(可直接导入;每模块至少一张,覆盖全难度)

> ⚠️ **复制时不要带下面这行 ``` 围栏**(以及结尾那行)。围栏只是本文档的显示格式;
> 首行围栏会被导入器大声报错拦住,但**尾行围栏会被静默拼进最后一张卡的答案**——
> 从 `# deck:` 复制到最后一行 `Interview line: ...` 为止。

```markdown
# deck: csharp-backend-fundamentals

## cs-type-001 | d0
Q:
struct 赋值给另一个变量,改新变量的字段,原变量会变吗?class 呢?
A:
struct 是值类型,赋值即整体拷贝,两个变量是两份独立数据,互不影响。
class 是引用类型,赋值拷贝的是引用,两个变量指向同一个对象,改一个另一个跟着变。
这是"值语义 vs 引用语义"的根本分界,后面的装箱、参数传递、record 的相等性全长在这上面。
Interview line: Assigning a struct copies the whole value; assigning a class copies the reference, so both variables see the same object.

## cs-type-002 | d2
Q:
什么时候该用 struct 而不是 class?说出判断标准和一个反例。
A:
适合 struct:小(经验值 16 字节级)、不可变、代表一个"值"(坐标、金额、时间戳)、生命周期短且大量创建。
反例:大 struct 作参数到处传,每次调用整体拷贝,比引用传递更慢;
或 struct 装进 object/接口引发装箱,反而制造 GC 压力。
判断标准是语义先行:它是"一个值"还是"一个有身份的东西"。
Interview line: I default to classes and reach for structs only for small, immutable value-like types that are allocated in bulk.

## cs-async-001 | d1
Q:
async void 和 async Task 的区别是什么?为什么事件处理器之外几乎禁用 async void?
A:
async Task 的异常被捕获进返回的 Task,调用方 await 时能拿到;
async void 没有 Task 可挂,异常直接抛到同步上下文,通常导致进程崩溃,
而且调用方无法等待它完成、无法组合、无法测试。
只有事件处理器签名被迫是 void 时才用,内部要自己 try/catch 全包。
Interview line: async void exceptions can't be observed by the caller, so they escape to the context and can crash the process; I only use it for event handlers.

## cs-async-002 | d3
Q:
一段 ASP.NET 经典死锁:同步方法里 task.Result,task 内部 await 没配 ConfigureAwait(false)。
死锁怎么形成的?两种解法各有什么代价?
A:
旧式同步上下文一次只允许一个线程进入。.Result 阻塞住上下文线程等待 task 完成;
task 里的 await 完成后要回到同一个上下文才能继续,但上下文被 .Result 占着,互等成环。
解法一:全链路 async(治本,但要改完整个调用链);
解法二:库代码 await 后 ConfigureAwait(false),不回原上下文(治标,库该做,但业务代码里易漏且掩盖了混用 sync/async 的真问题)。
ASP.NET Core 无同步上下文,这个死锁消失了,但 .Result 阻塞线程池的代价仍在。
Interview line: The context thread blocks on Result while the continuation needs that same context, a classic deadlock; the real fix is async all the way down.

## cs-gc-001 | d1
Q:
using 语句到底保证了什么?它和 GC 是什么关系?
A:
using 只是 try/finally 里调 Dispose 的语法糖,保证**离开作用域时确定性地释放非托管资源**
(文件句柄、连接、socket)。它和 GC 无关:GC 管的是托管内存,时机不确定;
Dispose 管的是"现在就还"的资源。混淆两者的典型事故:等 GC 去关数据库连接,连接池被耗干。
Interview line: using guarantees deterministic Dispose for unmanaged resources; GC only manages memory, and on its own schedule.

## cs-linq-001 | d2
Q:
一个 IEnumerable 查询变量被 foreach 两次,数据库被查了几次?为什么?怎么修?
A:
LINQ 查询是延迟执行的:查询变量存的是"怎么查"不是"结果"。
每次枚举都重新执行一遍——两次 foreach 就是两次完整查询(对 EF 是两次 SQL)。
修法:需要复用结果就 ToList()/ToArray() 物化一次。
反面代价:过早 ToList 会把过滤搬到内存里做,把 IQueryable 的 SQL 翻译优势丢掉。
Interview line: A LINQ query is a description, not a result; every enumeration re-executes it, so I materialize once when I need to reuse.

## cs-ex-001 | d1
Q:
catch 块里 throw; 和 throw ex; 的区别是什么?哪个是 bug?
A:
throw; 保留原始调用栈,重新抛出同一个异常;
throw ex; 把栈起点重置到当前行,原始出错位置永久丢失——线上排障时你只能看到 catch 所在行。
throw ex; 几乎总是 bug。要包装就用 throw new XxxException("context", ex) 保留 InnerException。
Interview line: throw preserves the original stack trace, throw ex resets it, which destroys exactly the information you need in production.

## cs-db-001 | d2
Q:
SQL 参数化查询防注入的原理是什么?为什么字符串拼接转义不够?
A:
参数化把 SQL 文本和数据走两条通道送到数据库:SQL 先编译成执行计划,参数永远只作为数据绑定,
不参与语法解析——注入在结构上不可能,不是"被过滤掉"。
拼接+转义是在猜数据库的解析规则,编码、方言、多字节字符的边角永远追不完。
附赠:参数化还让执行计划可复用。你 src_C 的 DbUtil 全程 $1/$2 占位符,就是这个。
Interview line: Parameterized queries separate code from data at the protocol level, so injection is structurally impossible rather than filtered out.

## cs-db-002 | d3
Q:
你的 Cards.cs 用 update ... set version = version + 1 where id = $1 and version = $2 实现并发控制。
这叫什么?比悲观锁好在哪?什么时候会不够用?
A:
乐观并发控制:不加锁,写入时校验"我读到的版本还是最新的",受影响行数为 0 说明有人先改了,
返回 VERSION_CONFLICT 让调用方重试或提示用户。
好处:无锁等待、无死锁、读多写少时吞吐高;代价:冲突方要处理重试。
不够用的场景:冲突率高(热点行反复重试比排队还贵)或跨多行/多表的不变量(需要事务+合适隔离级别)。
Interview line: Optimistic concurrency validates the version at write time and turns conflicts into retries, which beats locking when contention is low.

## cs-asp-001 | d2
Q:
把一个依赖 Scoped 服务的类注册成 Singleton,会发生什么?这类问题叫什么?
A:
Singleton 只构造一次,它捕获的那个 Scoped 实例(比如 DbContext)被永久持有——
跨请求共享了本该每请求一份的状态:并发崩溃、数据串号、连接不释放。
这叫 captive dependency(被俘获的依赖)。ASP.NET Core 开发模式下的 scope validation 能抓一部分。
规则:一个服务的生命周期不能长于它依赖的服务。
Interview line: A singleton capturing a scoped service extends its lifetime across requests, which is the captive dependency problem.

## cs-own-001 | d3
Q:
你的进度摄入是一条 SQL 里的 6 个 CTE(插事件、写 outbox、聚合、upsert)。
为什么比"四条语句包在一个事务里"更强?
A:
事务保证原子提交,但语句之间仍有可见性与竞态要讨论;
单条语句里 outbox 的数据源直接是插入事件的 RETURNING——
"事件写了但 outbox 漏了"在物理上不可能,连隔离级别都不用讨论。
边界从"事务边界"收紧到"语句边界",是把正确性从"运行时约定"变成"结构性事实"。
同批同卡先在 CTE 里折叠,还绕开了 ON CONFLICT cannot affect row a second time。
Interview line: Sourcing the outbox insert from the event insert's RETURNING makes divergence physically impossible, tighter than transactional guarantees.

## cs-own-002 | d4
Q:
你的合并 SQL 里 review_count 用加法,时间戳用 greatest,due_at 用 LWW,
而 srs_stage 你选了 LWW 而不是 greatest。为什么这个选择在当时无法被测试区分,后来又变成关键?
A:
当时 stage 只升不降,greatest 和 LWW 对所有可能输入给出相同答案——选择不可证伪。
后来给 again 加了降级(stage-2),第一次出现两者分歧的输入:
greatest 会把用户刚失败掉的等级"救"回去,降级永远无法跨设备传播;LWW 让降级跟着产生它的那次复习走。
教训:**合并算子由字段的语义决定,而语义会变**;单调算子的代价是永远回不去。
仿真器里"demotion converges"那条测试就是为这一天写的。
Interview line: The operator choice was untestable until the semantics changed; once stages could go down, only LWW let a demotion propagate, because monotonic merges cannot be undone.
```

---

## 四、写卡检查清单(每张过一遍,10 秒)

1. 问题能不能"看到就想起答案"?能 → 重写成 为什么/何时坏/怎么选。
2. 答案第一句是不是直接回答?(不要铺垫,复习时前 3 秒定生死)
3. 有没有一个"反例/代价/边界"?(没有取舍的答案是百科,不是理解)
4. 难度诚实吗?(d3+ 自问:答对它是否证明我真的懂这个子系统)
5. 英文面试句能不能脱口而出?(读三遍,拗口就改短)
6. uid 唯一、kebab、带模块前缀(cs-async-/cs-db-/cs-own-...)。

## 五、录入节奏建议

- 每晚一个模块片段(6-10 张),配当天复习——**你自己就是这副卡组的第一个用户**,
  哪张卡复习时觉得"问得不对",第二天就改(这正是控制台 revision 降级重学的用武之地)。
- 模块八写卡的过程 = 面试准备本身:每张 LEG 卡就是一段现成的面试回答。
- 全部 120 张录完≈两周;先录模块 8+2(32 张)就足够开始每日循环。
