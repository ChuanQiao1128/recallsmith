# 支柱一:C# 后端

> **这份文档是 `docs/csharp-deck-design.md` 的内容展开版。**
> 那份文档定义了卡组格式、难度经济和 13 张示例卡;这份补上它缺的那一层:**概念讲解**。
> 模块沿用同一张地图,但重排为**学习序**(先建地基,再往上盖),不是写卡序。
>
> **卡片是"素材",不是"成品"。**
> 录入控制台时,请**用你自己的话重写 A**。改写本身就是学习:
> 你能把一段答案压缩成自己的句子,说明你真的理解了;压不动的地方,就是这个概念还没通,
> 回到上面的「概念讲解」再读一遍。原文只是保证事实准确的底稿,不是要你背的标准答案。
>
> **定位声明:** 这份材料假设读者已经用生产代码做过这些事(三个 AWS Lambda + PostgreSQL + SQS worker,
> 一个 Azure 付费 SaaS,四个 React/React Native 前端)。所以这里不教"怎么用",只教
> **"它叫什么、为什么这样设计、什么时候会坏、别人常常误解在哪"**。
> 目标深度是"能在面试里讲清楚",不是"能跑起来"。
>
> **难度诚实:** d0-1 = 常识必会;d2 = 懂原理;d3-4 = 答对它说明你真的懂这个子系统。
> 全文档约 70% d0-1 / 22% d2 / 8% d3-4。

---

## 1. 类型系统与内存

### 概念讲解

**Mental model:** 一个变量是一张纸条。**值类型**的纸条上直接写着数据本身;**引用类型**的纸条上写的是"数据在哪"(一个地址)。
C# 里几乎所有别扭的地方(赋值语义、参数传递、装箱、相等性、null),都是这两张纸条的差别在不同场景下的投影。

**为什么要有这个区分。** 数据有两种,一种是"值",一种是"有身份的东西"。
`(3, 4)` 这个坐标、`19.99 NZD` 这个金额、一个时间戳,它们没有身份:两个内容相同的坐标就是同一个坐标,复制一份不损失任何东西。
而"用户 Leo"这个对象有身份:你改了他的邮箱,所有持有他的地方都该看到改动,复制一份反而是 bug。
`struct` 服务前者,`class` 服务后者。**语义先行,性能是副产品。**

**关于"struct 在栈上"这个流行误解。** 更准确的说法是:**struct 的存储位置跟着它的宿主走**。
局部变量的 struct 在栈上,但一个 class 的 struct 字段在堆上(躺在那个对象里面),
一个 `List<Point>` 里的所有 Point 在堆上的一整块数组里(这正是 struct 的性能优势:连续内存、无指针追逐、无 GC 对象头开销)。
面试里说"struct 是值类型,通常栈分配但不总是"比说"struct 在栈上"高一个档次。

**装箱(boxing)是什么。** 把值类型塞进一个只认引用的洞里(`object`、非泛型集合、接口变量),
运行时必须在堆上分配一个盒子,把值**拷贝**进去,然后给你盒子的引用。
代价是一次堆分配 + 一次拷贝 + 后续的 GC 压力。拆箱(unboxing)是反向拷贝,还要做类型检查。
泛型(`List<int>` 而非 `ArrayList`)存在的头号理由就是消灭装箱。
陷阱形状:`Dictionary<string, object>` 里塞 int(你的 `DbUtil.QueryAsync` 返回的
`Dictionary<string, object?>` 就是这个形状,每个数值列都装箱一次。这是 ADO.NET 弱类型读取的固有代价,
不是 bug,但你要能说出这个代价存在,以及它换来了什么:一套代码处理任意结果集形状)。

**string 为什么不可变。** `string` 是引用类型,但被设计成**值语义**:
`s.ToUpper()` 不改 s,而是造一个新 string。不可变带来三件事:
(1) 天生线程安全,可以随便跨线程共享而不加锁;
(2) 可以安全地做 interning(编译期字面量共享同一份实例);
(3) 哈希值可以缓存,做 Dictionary 的 key 非常快。
代价是循环里拼字符串会造出 O(n²) 的垃圾,所以有 `StringBuilder`。
面试常问的一句话:"`string` 是引用类型,但表现得像值类型",然后你要能解释 `==` 被重载成了内容比较。

**record 解决什么。** record 是"我要一个有值语义的引用类型"这个需求的语言级答案:
编译器自动生成基于**所有字段**的 `Equals`/`GetHashCode`、一个可读的 `ToString`、
以及 `with` 表达式(非破坏性复制)。两个 record 相等的条件是:**运行时类型相同(EqualityContract)且所有字段相等**。
你的 `ProgressEvents.cs` 里的 `private sealed record NormalizedEvent(...)` 正是教科书用法:
一个纯数据载体,从 JSON 解析出来后只被读、不被改,不需要身份,只需要"内容是什么"。
用 record 而不是 class 在这里传达的信息是:**这个类型没有行为,不要给它加行为**。

**Nullable reference types 的边界(容易踩)。** `string?` vs `string` 是**编译期**的静态分析,
运行时没有任何强制。一个来自 JSON 反序列化、反射、或旧库的 null 照样能钻进你标为非空的字段。
所以它的价值是"把 null 的意图写进签名并让编译器帮你查",不是"消灭 NullReferenceException"。
这一点答不出来,面试官会认为你只是打开了编译器开关。

**什么时候会坏 / 常见误解速查:**
- 误解"struct 一定更快":大 struct 到处按值传参,每次调用整体拷贝,比传引用慢。
- 可变 struct 是经典陷阱:从集合或属性里取出的 struct 是**副本**,你改它等于改了个临时值,原地数据纹丝不动。所以 struct 应该不可变。
- 误解"`==` 对所有类型都比较内容":对没重载 `==` 的自定义 class,`==` 是引用比较。
- 误解"record 是不可变的":`record` 的**位置参数**默认生成 `init` 属性(初始化后不可改),但你可以手写 `set` 属性,record 并不强制不可变。它保证的是**值相等性**,不是不可变性。

### 卡片素材(手动录入用)

**cs-type-001**
- Q: 把一个 struct 赋值给新变量并改新变量的字段,原变量变吗?class 呢?这个差别的根源是什么?
- A: struct 不变,class 会变。根源是变量里存的东西不同:值类型变量存数据本身,赋值就是整体拷贝出两份独立数据;引用类型变量存的是地址,赋值拷贝的是地址,两个变量指向同一个堆对象。后面的装箱、参数传递、相等性语义,全都长在这个分界上。
- 难度: d0
- EN: Assigning a struct copies the whole value, assigning a class copies the reference, so both variables still see the same object.

**cs-type-002**
- Q: "struct 分配在栈上"这句话哪里不准确?
- A: 不准确在"总是"。struct 的存储位置跟着它的宿主走:局部变量的 struct 在栈上,但一个 class 的 struct 字段随那个对象躺在堆上,`List<Point>` 里的 Point 也全在堆上的连续数组里。准确的说法是 struct 是值类型,内联存储在它所属的位置,没有独立的对象头和引用跳转。
- 难度: d2
- EN: Structs are stored inline wherever they live, so a struct field of a heap object is on the heap, not the stack.

**cs-type-003**
- Q: 装箱具体发生了什么?举一个你日常代码里天天发生装箱的例子。
- A: 装箱是把值类型放进只接受引用的位置(object、接口、非泛型集合)时,运行时在堆上分配一个盒子、把值拷贝进去、返回盒子的引用。代价是一次堆分配加一次拷贝,之后还要 GC 回收。日常例子:ADO.NET 读结果集时把每个列值读成 `object`,数值列每读一个就装箱一次,这是弱类型读取换来通用性的固有代价。
- 难度: d1
- EN: Boxing allocates a heap wrapper and copies the value in, which is why generic collections exist: to keep value types unboxed.

**cs-type-004**
- Q: 为什么可变 struct 被认为是设计错误?给一个具体会坑人的场景。
- A: 因为从属性、数组以外的集合或方法返回值里拿到的 struct 是副本,你修改它改的是那个临时副本,原数据完全没变,而编译器往往不会报错。这类 bug 静默且难查。规则是 struct 一律设计成不可变(只读字段或 init 属性),需要"改"就造一个新值。
- 难度: d1
- EN: Mutating a struct returned from a property or method mutates a copy, so the change silently disappears; structs should be immutable.

**cs-type-005**
- Q: string 不可变换来了哪三个好处?代价是什么?
- A: 换来线程安全(可以无锁共享)、可以 interning 复用字面量实例、哈希值可缓存所以适合做字典 key。代价是任何"修改"都要新建对象,循环里拼接会产生 O(n²) 级别的垃圾,所以有 StringBuilder。它是引用类型但重载了 `==` 做内容比较,表现得像值类型。
- 难度: d1
- EN: Immutability makes strings thread-safe, internable and cheap to hash, at the cost of allocating on every modification.

**cs-type-006**
- Q: 两个 record 实例什么时候相等?这和普通 class 的默认行为差在哪?
- A: 当运行时类型相同(编译器生成的 EqualityContract 一致)且所有字段逐个相等时,record 相等。普通 class 的默认 `Equals` 是引用相等,只有同一个对象才等于自己。record 让编译器帮你生成基于值的 Equals、GetHashCode、ToString 和 `with` 表达式,适合纯数据载体。
- 难度: d1
- EN: Records compare by type plus all fields, whereas a plain class compares by reference unless you override Equals.

**cs-type-007**
- Q: record 保证不可变吗?
- A: 不保证。record 的位置参数默认生成 `init` 属性,初始化之后不能改,但你完全可以在 record 里手写带 `set` 的属性或可变字段。record 语言层面保证的是**值相等性语义**和 `with` 复制,不可变只是它的默认倾向。把两者混为一谈是常见的面试失分点。
- 难度: d1
- EN: Records give you value equality by default, not enforced immutability: you can still declare mutable members.

**cs-type-008**
- Q: 你的 `ProgressEvents.cs` 里用 `private sealed record NormalizedEvent(...)` 承载解析后的事件,为什么这里 record 比 class 合适?
- A: 因为它是一个纯数据载体:从 JSON 解析出来后只被读取和转成 SQL 参数,没有行为、没有身份,只需要"内容是什么"。record 用一行声明表达了这个意图,并顺带给出值相等和 ToString,便于测试断言和日志。用 class 就要手写一堆样板,而且给了后来者往里加方法的空间。
- 难度: d1
- EN: It is a pure data carrier with no identity or behaviour, which is exactly the shape records exist for.

**cs-type-009**
- Q: 打开了 nullable reference types(`string?`),运行时还会有 NullReferenceException 吗?为什么?
- A: 会。它完全是编译期的静态分析,IL 里没有任何运行时检查。JSON 反序列化、反射、旧的第三方库、跨程序集边界都能把 null 塞进你标为非空的引用。它的真实价值是把"这里允许为 null 吗"写进签名让编译器帮你查,不是消灭 NRE,所以外部输入边界仍然要显式校验。
- 难度: d1
- EN: Nullable annotations are compile-time only, so values crossing deserialization or reflection boundaries can still be null at runtime.

**cs-type-010**
- Q: 什么时候你会真的选 struct 而不是 class?说判断标准和一个反例。
- A: 满足全部条件时才选:小(经验值 16 字节左右)、不可变、语义上是"一个值"而不是"一个有身份的东西"、且会被大量创建。典型收益是放进数组或 List 后内存连续、无对象头、无 GC 追踪。反例:一个大 struct 被到处按值传参,每次调用整体拷贝反而更慢;或者它被塞进 object 或接口导致装箱,不但没省下分配,还多了拷贝。
- 难度: d2
- EN: I default to classes and reach for a struct only for small, immutable, value-like types allocated in bulk.

---

## 2. async/await 与并发

### 概念讲解

**Mental model:** `async/await` 不是"开线程",而是**把一个方法切成若干段,把"下一段代码"登记成回调**。
编译器把你的 async 方法重写成一个**状态机**:每个 `await` 是一个状态编号,方法执行到 await 处如果结果还没到,
就把当前状态存起来、**把线程还给调用方**,并向那个 Task 注册"完成时请继续跑第 N 段"。
所以 async 的核心收益是:**等待 I/O 时不占着线程**。一台服务器的线程池是有限的,
async 让 100 个并发请求不需要 100 个线程,只需要少数几个线程加 100 个"待续的状态机"。

**为什么不是"更快"。** 单个请求的耗时不会因为 async 变短,可能还略长(状态机的开销)。
变的是**吞吐量和抗压能力**。这是面试里区分"用过"和"懂"的第一个问题。

**await 一个已完成的 Task 会怎样。** 不切线程,同步继续往下跑。
机制上,`await` 先问 awaiter 的 `IsCompleted`;为 true 就直接取结果继续执行,连回调都不注册。
这是为什么带缓存的 async 方法在命中缓存时几乎零开销,也是 `ValueTask` 存在的理由:
一个大概率同步完成的方法,每次还去堆上分配一个 Task 对象太浪费。
`ValueTask` 的代价是使用约束严格:**只能 await 一次,不能存起来重复 await,不能并发 await**。

**async void 为什么危险。** `async Task` 的异常被捕获进返回的 Task,调用方 await 时重新抛出;
`async void` 没有 Task 可挂,异常直接被抛到当时的 SynchronizationContext(没有上下文就是线程池),
通常等于进程崩溃,而且调用方**无法等待它完成、无法组合、无法在测试里断言**。
唯一合理场景是签名被框架逼成 void 的事件处理器,那时内部必须自己 try/catch 全包。

**经典死锁。** 同步代码里 `task.Result` 或 `task.Wait()`,而 task 内部 `await` 后要回到原来的
SynchronizationContext(旧 ASP.NET、WPF、WinForms 都有这么一个"一次只准一个线程进入"的上下文)。
`.Result` 正阻塞着那个上下文线程,而续段需要那个线程才能跑,互等成环。
两种解法:治本是**全链路 async**;治标是库代码里 `ConfigureAwait(false)` 不回原上下文。
**ASP.NET Core 没有 SynchronizationContext,所以这个死锁在你的世界里不存在了**,
但 `.Result` 阻塞线程池线程的代价还在(高并发下会引发线程池饥饿:请求排队等待线程池缓慢增长线程)。
面试时把这两层分开讲,是加分项。

**CancellationToken 是协作式的,不是抢占式的。** 没人能从外面杀死一个正在跑的方法。
Token 只是一个共享的布尔标志加回调列表:上游 `Cancel()` 把它置位,
下游代码必须自己去 `ThrowIfCancellationRequested()` 或把 token 传给支持它的 API(Npgsql、HttpClient、Task.Delay)才会真的停。
**一个不往下传 token 的方法,让整条取消链在它这里断掉**,这是 code review 里最常见的 async 缺陷。
取消抛出的是 `OperationCanceledException`,它是**正常控制流**,不该被当成错误记成 error 日志。

**Task.WhenAll 的异常语义(高频细节)。** `await Task.WhenAll(...)` 只重新抛出**第一个**异常,
但返回的那个 Task 的 `.Exception` 里装着全部异常的 `AggregateException`。
所以要拿全所有失败,得先把 Task 存下来、await 它、在 catch 里读 `task.Exception.InnerExceptions`。
另外 WhenAll 会等所有任务跑完(不管有没有失败),不会因为一个失败就取消其余。

**并行 vs 并发。** `Task.Run` 是"把工作扔到线程池线程上跑",服务于 **CPU 密集**;
async I/O 服务于**等待**。在服务端把 I/O 方法包进 `Task.Run` 是纯粹的负收益:
你没省下任何等待,反而多占了一个线程池线程加一次调度。

**共享状态的三级工具。** `Interlocked`(单个数值的原子增减/交换,最快),
`lock`(临界区,注意锁对象要私有且不可为 string 或 this,锁内绝不 await),
并发集合(`ConcurrentDictionary` 等,注意它的 `GetOrAdd` 的工厂委托**可能被调用多次**,只有一个结果会被采纳)。
更重要的是先问:**这个状态真的需要共享吗**。你的 Lambda 每次调用处理一批事件,
真正的并发协调不在进程内,而在数据库那一层(见模块 6)。

**Lambda 语境下的额外事实(你的场景).** 你的 handler 是 `async Task<APIGatewayProxyResponse>`,
Lambda 运行时会 await 它,所以 async 是正确的;但 Lambda 的计费按**墙钟时间**,
一个纯等待 I/O 的请求,async 并不省钱(单次调用只处理一个请求),
它省的是**同一进程内并发发起多个 I/O 时的等待重叠**。这个诚实的区分,比笼统说"async 更快"有说服力得多。

### 卡片素材(手动录入用)

**cs-async-001**
- Q: async/await 让单个请求变快了吗?它真正改善的是什么?
- A: 没有变快,单请求耗时可能因为状态机开销略微变长。它改善的是吞吐和抗压:等待 I/O 时线程被还回线程池,于是少数线程就能支撑大量并发的在途请求,而不是每个在途请求占住一个线程。把"更快"和"更能扛"分开说,是这道题的关键。
- 难度: d1
- EN: Async does not make one request faster, it frees the thread while waiting on I/O so far fewer threads can serve far more concurrent requests.

**cs-async-002**
- Q: 编译器把一个 async 方法变成了什么?说出"await 处发生了什么"的机制。
- A: 变成一个状态机:每个 await 对应一个状态编号。执行到 await 时先问 awaiter 的 IsCompleted,已完成就直接取结果同步继续;未完成就保存当前状态、把线程还给调用方、向那个 Task 注册续段,完成时再从保存的状态恢复执行。方法的局部变量成了状态机的字段,所以它们能跨 await 存活。
- 难度: d2
- EN: The compiler rewrites the method into a state machine that saves its locals, returns the thread, and resumes at the recorded state when the awaited task completes.

**cs-async-003**
- Q: await 一个已经完成的 Task,会切线程吗?为什么这件事重要?
- A: 不会,它同步继续往下执行,连回调都不注册,因为 awaiter 的 IsCompleted 已经是 true。重要是因为它解释了带缓存的 async 方法在命中缓存时几乎零开销,也解释了 ValueTask 存在的理由:大概率同步完成的方法不值得每次在堆上分配一个 Task。
- 难度: d2
- EN: Awaiting an already-completed task continues synchronously on the same thread, which is why cache hits in async methods are nearly free.

**cs-async-004**
- Q: ValueTask 什么时候值得用?它的使用约束是什么?
- A: 当一个高频调用的方法大概率同步完成(缓存命中、缓冲区里已有数据)时值得用,省掉每次的 Task 堆分配。约束很硬:一个 ValueTask 只能被 await 一次,不能存起来重复 await,不能并发 await,也不该在 await 之前访问 .Result。违反这些是未定义行为。默认还是用 Task,ValueTask 是测出来的优化。
- 难度: d3
- EN: ValueTask avoids an allocation when the method usually completes synchronously, but it must be awaited exactly once and never stored or awaited twice.

**cs-async-005**
- Q: async void 和 async Task 的区别是什么?为什么事件处理器之外几乎禁用 async void?
- A: async Task 把异常捕获进返回的 Task,调用方 await 时能拿到;async void 没有 Task 可挂,异常直接抛到当时的同步上下文或线程池,通常直接崩进程。而且调用方无法等待它完成、无法组合、无法在测试里断言。只有签名被框架逼成 void 的事件处理器才用,内部要自己 try/catch 全包。
- 难度: d1
- EN: async void exceptions cannot be observed by the caller and escape to the context, so I only use it for event handlers that must return void.

**cs-async-006**
- Q: 旧 ASP.NET 里 `task.Result` 导致的死锁是怎么形成的?为什么 ASP.NET Core 里这个死锁消失了,但 `.Result` 仍然不该写?
- A: 旧同步上下文一次只允许一个线程进入,`.Result` 阻塞住上下文线程,而 task 内部 await 的续段需要回到同一个上下文才能继续,互等成环。ASP.NET Core 没有 SynchronizationContext,续段可以在任意线程池线程上跑,死锁消失。但 `.Result` 仍然把一个线程池线程钉在那里空等,高并发下会造成线程池饥饿:请求排队等线程池缓慢新增线程,表现为延迟突然抬升。
- 难度: d3
- EN: The blocked context thread was also the thread the continuation needed; ASP.NET Core has no such context, but blocking still starves the thread pool.

**cs-async-007**
- Q: ConfigureAwait(false) 在 ASP.NET Core 应用代码里还有意义吗?
- A: 基本没有捕获上下文方面的意义,因为 ASP.NET Core 没有 SynchronizationContext,续段本来就回不到"原上下文"。它仍然是**类库**代码的正确默认:你的库可能被 WPF、WinForms 或旧 ASP.NET 调用,那些环境里它是必需的。所以规则是库里加,应用里不必到处加。
- 难度: d1
- EN: In ASP.NET Core there is no synchronization context to capture, so ConfigureAwait(false) matters for libraries that might run elsewhere, not for app code.

**cs-async-008**
- Q: 一个方法收到 CancellationToken 但没往下传给它调用的 I/O,会发生什么?
- A: 取消链在它这里断掉:上游 Cancel 之后,这个方法正在等的那次数据库查询或 HTTP 请求仍然会跑完,超时不生效,请求继续消耗连接和时间。取消是协作式的,没人能从外面抢占式地杀掉正在跑的代码,token 只是一个共享标志加回调列表,必须由代码自己检查或交给支持它的 API。
- 难度: d1
- EN: Cancellation is cooperative, so a method that swallows the token silently makes the whole chain uncancellable.

**cs-async-009**
- Q: 取消触发时抛出的 OperationCanceledException 应该被记成 error 日志吗?
- A: 不该。取消是**预期的正常控制流**(客户端断开、上游超时、请求被取代),把它记成 error 会污染告警,让真实故障淹没在噪音里。正确做法是单独 catch OperationCanceledException,记 info 或 debug 并快速返回,把 error 级别留给真正没预料到的失败。
- 难度: d1
- EN: Cancellation is expected control flow, so I catch OperationCanceledException separately and log it at info level rather than as an error.

**cs-async-010**
- Q: `await Task.WhenAll(a, b, c)`,其中 b 和 c 都抛了异常,你的 catch 块能拿到几个异常?怎么拿全?
- A: 只拿到一个(第一个),因为 await 会把 AggregateException 解包成其中第一个异常重新抛出。要拿全部,先把 `var all = Task.WhenAll(...)` 存下来,await 它,在 catch 里读 `all.Exception.InnerExceptions`。另外 WhenAll 会等所有任务都结束才返回,不会因为一个失败就取消其余任务。
- 难度: d3
- EN: Awaiting WhenAll rethrows only the first exception, so I keep the task and read its AggregateException to see all failures.

**cs-async-011**
- Q: 在服务端把一个 async I/O 方法包进 `Task.Run` 再 await,是好主意吗?
- A: 不是,是纯负收益。你没有省下任何等待时间,反而多占一个线程池线程和一次调度,让线程池更容易饥饿。Task.Run 的正确用途是把**CPU 密集**的同步工作挪出当前线程(在 UI 应用里是挪出 UI 线程);服务端本来就不在 UI 线程上,包一层只是搬运工作。
- 难度: d1
- EN: Task.Run offloads CPU-bound work; wrapping async I/O in it just burns an extra pool thread without saving any waiting.

**cs-async-012**
- Q: `lock` 块里能写 `await` 吗?为什么?需要异步互斥时用什么?
- A: 不能,编译器直接报错。`lock`(Monitor)是线程亲和的:必须由获取锁的那个线程释放,而 await 之后续段可能跑在别的线程上,锁就永远放不掉。需要异步互斥时用 `SemaphoreSlim(1,1)` 配 `WaitAsync`,它不绑定线程。另外锁对象必须是私有的专用对象,不要锁 this 或 string(字符串可能被 interning 共享,变成跨模块的意外全局锁)。
- 难度: d1
- EN: Monitor is thread-affine so you cannot await inside a lock; use SemaphoreSlim with WaitAsync for asynchronous mutual exclusion.

---

## 3. GC 与资源管理

### 概念讲解

**Mental model:** GC 管的是**内存**,`Dispose` 管的是**内存以外的一切**(文件句柄、socket、数据库连接、锁、非托管指针)。
两者时机完全不同:GC 什么时候跑由运行时决定,你说了不算;Dispose 是你说了算的**确定性释放**。
把这两件事混起来,就会写出"等 GC 去关数据库连接"这种把连接池耗干的代码。

**分代回收为什么有效。** 基于一个经验规律(generational hypothesis):**绝大多数对象要么很快死,要么活很久**。
于是把堆分成 gen0/gen1/gen2:新对象在 gen0,gen0 满了就只扫 gen0(很快),活下来的晋升 gen1,再活下来晋升 gen2。
gen0 回收频繁但极便宜(扫的区域小,而且大多数对象已死,回收成本正比于**存活**对象数而非死亡对象数);
gen2 回收(full GC)昂贵但罕见。这解释了一个反直觉的结论:
**大量短命的小对象其实很便宜**,真正贵的是"活得半长不长"的对象(不停晋升到 gen2 又很快死掉,制造频繁 full GC)。

**LOH(Large Object Heap)。** 大于等于 85,000 字节的对象直接进 LOH,LOH 随 gen2 一起回收,
而且**默认不压缩**(压缩大对象的拷贝成本太高)。后果是碎片化:总空闲内存够,却分配不出一块连续的大数组。
典型触发:反复分配大 byte[] 或大 string(比如一次性把整个 S3 对象读进内存)。
对策是复用缓冲区(`ArrayPool<T>`)或流式处理。你的 Worker 做 S3 内容分发和分块规划(`ChunkPlanner`),
这正是"为什么要分块而不是一把梭"的一条真实理由。

**IDisposable 的语义。** `using` 只是 `try/finally` 里调 `Dispose()` 的语法糖,
保证**离开作用域时确定性释放**。C# 8 之后可以写 `using var x = ...`(作用域结束时释放),
异步资源用 `await using`(走 `IAsyncDisposable.DisposeAsync`)。
你的 `await using var conn = await Pg.OpenConnectionOrNullAsync()` 正是这个:
Npgsql 连接的 Dispose 不是"关闭 TCP",而是**把连接还回连接池**,所以漏掉它的后果是池被占满、后续请求排队超时。
注意 `await using` 用在这里是对的:释放动作本身可能有 I/O(比如回滚未提交的事务)。

**Finalizer(析构器)几乎总是错的选择。** 有 finalizer 的对象在分配时会被登记到终结队列,
第一次 GC 时不会被回收,而是被推给终结线程调用 Finalize,**至少多活一代**。
所以 finalizer 让对象更久地占内存、增加 GC 压力、执行时机不确定、顺序不确定、还可能在进程退出时根本不跑。
它唯一的正当用途是"持有原始非托管句柄时的最后保险",而这件事 `SafeHandle` 已经替你做好了。
现代 C# 里:**实现 IDisposable,不写 finalizer**。

**内存泄漏在托管语言里长什么样。** GC 不会回收"仍被引用"的对象,所以泄漏 = **意外的长命引用**。
常见形状(面试里能报出三种就够了):
1. **static 集合只进不出**:缓存没有淘汰策略,活到进程结束。
2. **事件订阅没退订**:发布者持有订阅者的引用,订阅者永远死不掉。这是长命对象抓住短命对象的经典形状。
3. **未释放的 Timer / CancellationTokenSource 注册 / 后台任务**:回调持有闭包,闭包捕获了整棵对象图。
4. **闭包意外捕获**:lambda 捕获了 `this`,导致一个小回调把整个大对象钉住。
5. **HttpClient 用反了**:每次 new 一个再 Dispose,会耗尽 socket(TIME_WAIT 堆积);
   而全局单例又不感知 DNS 变化。正解是 `IHttpClientFactory`(或长命 HttpClient 配 `PooledConnectionLifetime`)。

**Lambda 语境下的特殊之处(你的场景)。** Lambda 容器会被复用,**static 字段跨调用存活**。
这带来一个双面性:好处是可以缓存连接池和昂贵的初始化(这也是 `SnapStartHooks` 的思路:提前预热,快照恢复);
风险是任何一次调用往 static 里塞的东西会泄给下一次调用,包括**上一个用户的数据**。
"static 缓存在 Lambda 里是跨请求共享状态"这句话,和 ASP.NET Core 的 Singleton 生命周期是同一件事的两种说法(见模块 7)。

### 卡片素材(手动录入用)

**cs-gc-001**
- Q: `using` 到底保证了什么?它和 GC 是什么关系?
- A: 保证离开作用域时确定性地调用 Dispose,释放**非内存**资源(文件句柄、socket、数据库连接、锁)。它就是 try/finally 的语法糖,和 GC 无关:GC 只管托管内存,而且时机由运行时决定。混淆两者的典型事故是等 GC 去关数据库连接,结果连接池被耗干,请求全在等连接。
- 难度: d0
- EN: using guarantees deterministic disposal of non-memory resources; the GC only reclaims memory, and on its own schedule.

**cs-gc-002**
- Q: 分代 GC 为什么能变快?为什么"大量短命小对象"其实不贵?
- A: 因为绝大多数对象要么很快死要么活很久,所以把堆分代,平时只扫最年轻的 gen0,存活的才晋升。回收成本正比于**存活**对象数而不是死亡对象数,所以一批立刻全死的短命对象几乎是免费的:GC 只需把区域整体划走。真正贵的是活得半长不长、不断晋升到 gen2 又很快死掉的对象,它们制造频繁的 full GC。
- 难度: d2
- EN: Collection cost scales with surviving objects, not dead ones, so short-lived garbage in gen0 is close to free.

**cs-gc-003**
- Q: 一个 100KB 的 byte[] 分配在哪?反复这样分配会出现什么问题?
- A: 分配在 LOH(大对象堆,门槛是 85,000 字节),而 LOH 跟随 gen2 一起回收,且默认不压缩。反复分配大数组会造成碎片:空闲总量够却拿不出一块连续空间,伴随昂贵的 full GC。对策是复用缓冲(ArrayPool)或改成流式、分块处理,而不是一次把大内容整体读进内存。
- 难度: d2
- EN: Objects at or above 85,000 bytes go to the large object heap, which is collected with gen2 and not compacted by default, so repeated large allocations fragment it.

**cs-gc-004**
- Q: 为什么现代 C# 里几乎不该写 finalizer?
- A: 因为有 finalizer 的对象在第一次 GC 时不会被回收,而是被推进终结队列等终结线程处理,至少多活一代,占更久内存、加重 GC 压力。执行时机和顺序都不确定,进程退出时甚至可能不执行。它唯一正当的用途是给原始非托管句柄兜底,而 SafeHandle 已经把这件事做好了。规则是:实现 IDisposable,不写 finalizer。
- 难度: d1
- EN: A finalizer promotes the object at least one generation and runs at an unpredictable time, so I implement IDisposable and let SafeHandle cover unmanaged handles.

**cs-gc-005**
- Q: 托管语言里"内存泄漏"具体是什么?说出三种典型形状。
- A: 是**意外的长命引用**:GC 只回收不可达的对象,所以只要有引用链把它挂着,它就永远不走。三种典型形状:static 集合只进不出的缓存;事件订阅没退订,发布者一直持有订阅者;Timer、后台任务或 token 注册没释放,回调闭包钉住整棵对象图。共同点都是"长命的东西抓住了短命的东西"。
- 难度: d1
- EN: In a GC language a leak is an unintended long-lived reference, typically a static cache, an unsubscribed event, or a timer callback holding a closure.

**cs-gc-006**
- Q: 每次请求 `new HttpClient()` 然后 Dispose,错在哪?正确做法是什么?
- A: 错在耗尽 socket:Dispose 之后底层连接进入 TIME_WAIT 状态并不立刻可用,高频请求会把可用端口耗光,表现为 SocketException 而不是内存问题。但直接改成永久静态单例又会看不到 DNS 变化。正解是 IHttpClientFactory 管理 handler 池并定期轮换,或者长命 HttpClient 配 PooledConnectionLifetime。
- 难度: d1
- EN: Creating and disposing HttpClient per request exhausts sockets through TIME_WAIT, so I use IHttpClientFactory or a long-lived client with a bounded connection lifetime.

**cs-gc-007**
- Q: 你的代码写 `await using var conn = await Pg.OpenConnectionOrNullAsync()`,这里 Dispose 实际释放了什么?为什么用 `await using` 而不是 `using`?
- A: Npgsql 连接的 Dispose 不是关闭 TCP,而是**把连接还回连接池**,所以漏掉它的后果是池被占满、后续请求排队直到超时。用 await using 是因为释放本身可能触发 I/O(比如回滚未提交的事务、发送清理消息),同步 Dispose 会把这段 I/O 变成阻塞调用。
- 难度: d1
- EN: Disposing an Npgsql connection returns it to the pool rather than closing the socket, and await using keeps that cleanup non-blocking.

**cs-gc-008**
- Q: Lambda 容器会被复用,`static` 字段跨调用存活。这带来什么好处和什么风险?
- A: 好处是昂贵的初始化(连接池、配置、序列化器)只做一次,后续调用直接复用,这也是 SnapStart 预热思路的基础。风险是任何写进 static 的请求级数据会泄给下一次调用,可能跨到**另一个用户**。规则和 ASP.NET Core 的 Singleton 完全一样:进程级的状态必须是无状态的或线程安全且不含用户数据的。
- 难度: d1
- EN: Static state in Lambda survives across invocations, which is great for pooled resources and dangerous for anything request-scoped.

**cs-gc-009**
- Q: `GC.Collect()` 什么时候该手动调?
- A: 生产代码里基本永远不该。运行时对分配速率和存活率的观测远比你准,手动触发通常强制一次 full GC,把本可以廉价死在 gen0 的对象提前晋升,反而更慢。合理的例外只有测量场景(基准测试前建立干净基线)和某些一次性的大规模释放之后的进程空闲期。答"性能不好就调一下"是明确的减分。
- 难度: d1
- EN: I do not call GC.Collect in production: forcing a full collection usually promotes objects that would have died cheaply in gen0.

---

## 4. 集合与 LINQ

### 概念讲解

**Mental model:** 一个 LINQ 查询变量不是"结果",而是**一张怎么算的配方**。
`var q = items.Where(x => x.Ok)` 这一行什么都没做,只是造了一个对象记住了"要在 items 上做 Where"。
真正开始算,是在有人**枚举**它的时候(foreach、ToList、Count、First、Any)。这叫**延迟执行(deferred execution)**。

**为什么这样设计。** 因为它让你能把过滤条件组合起来再一次性执行,中间不产生临时集合;
也让"数据源"可以是无限的(`Enumerable.Range` 之上再 `Take(10)`),
更关键的是它让 `IQueryable` 有机会把整条链**翻译成 SQL**,而不是把整表拉到内存再过滤。

**它什么时候坏(第一大坑):多次枚举。**
同一个查询变量被枚举两次,就完整执行两次。对内存集合是浪费 CPU,对 EF Core 是**两条 SQL**,
对读文件的迭代器可能是"第二次读到空"。修法是需要复用就 `ToList()` 物化一次。
反向的代价也真实:**过早 ToList 会把过滤搬到内存里做**,把本可以下推到数据库的 WHERE 丢掉,变成全表拉取。
所以规则是:**在 IQueryable 上把能推给数据库的都推完,最后物化一次**。

**它什么时候坏(第二大坑):闭包捕获的变量在执行时才求值。**
延迟执行意味着 lambda 引用的外部变量,是在**枚举那一刻**读取的,不是定义那一刻。
在循环里构建查询、循环变量被捕获,是经典事故(C# 5 之后 foreach 的循环变量每轮独立,`for` 的循环变量仍然共享)。

**IEnumerable vs IQueryable(必考)。**
- `IEnumerable<T>`:操作参数是 `Func<T, bool>`,**已编译的委托**,只能在内存里跑。
- `IQueryable<T>`:操作参数是 `Expression<Func<T, bool>>`,**表达式树**,即一份可被读取和翻译的数据结构。
  EF Core 的 provider 遍历这棵树,生成 SQL。
致命细节:**一旦你在链条中间把 IQueryable 当 IEnumerable 用**
(比如赋给 `IEnumerable<T>` 变量、或调用了 provider 翻译不了的方法),
后续所有操作就在客户端执行,数据库那边等于 `SELECT *`。
EF Core 3.0 之后这种情况会**抛异常**而不是静默降级(这是一次刻意的破坏性变更,因为静默降级坑死了太多人),
能说出这个演变史是很硬的加分。

**流式 vs 缓冲操作符。** `Where`/`Select`/`Take` 是流式的:一次处理一个元素,内存 O(1)。
`OrderBy`/`GroupBy`/`Reverse`/`ToList` 必须**先把全部数据读进来**才能给出第一个元素。
所以 `.OrderBy(...).First()` 在内存 LINQ 上仍然要排全部(实际实现有优化但语义上要全读),
把 `OrderBy` 放在 `Where` 之前是常见的性能错误:先过滤再排序,排的数据量小得多。

**Dictionary 内部(问得比想象中多)。**
两个数组:`buckets`(存"链表头的索引")和 `entries`(存 hashCode、next、key、value)。
查找流程:算 `key.GetHashCode()`,对桶数取模定位桶,顺着 `next` 链比较 `hashCode` 再比较 `Equals`。
平均 O(1),最坏 O(n)(所有 key 哈希到同一个桶)。装满时扩容到下一个质数并**全部重新哈希**。
由此推出三条实践结论:
1. **key 一旦放进字典就不能再改变它的哈希相关字段**,否则它会永远待在错误的桶里,连自己都找不到自己。这是 key 必须不可变的根本原因。
2. **`Equals` 和 `GetHashCode` 必须一致**:相等的对象必须有相同哈希。只重写一个是经典 bug。
3. 已知容量时传 `new Dictionary<K,V>(capacity)`,省掉多次扩容和重哈希。
另外 `Dictionary` 的枚举顺序是**未定义的实现细节**,依赖它是 bug;要有序用 `SortedDictionary` 或显式排序。
你的 `DbUtil.QueryAsync` 里 `new Dictionary<string, object?>(StringComparer.Ordinal)` 显式指定了序数比较器,
这是对的:列名比较不该受当前区域文化影响(土耳其语的 i 问题是这类 bug 的经典案例)。

**其他集合的选型直觉。**
`List<T>` 尾部追加均摊 O(1)(满了翻倍复制),中间插入 O(n),按索引访问 O(1)。
`HashSet<T>` 用于存在性判断,把"在列表里找一遍"的 O(n) 降到 O(1)(你的 `ProgressEvents.cs` 里
用 `HashSet<string>(StringComparer.Ordinal)` 给 eventId 去重,就是这个用法,而且去重是**正确性**需求不是性能需求:
重复的 eventId 会让 join 侧扇出多行)。
`ConcurrentDictionary` 用于多线程,但注意 `GetOrAdd` 的工厂委托可能被并发调用多次。

### 卡片素材(手动录入用)

**cs-linq-001**
- Q: 一个 IEnumerable 查询变量被 foreach 两次,数据库被查了几次?为什么?怎么修,修过头的代价是什么?
- A: 查了两次。LINQ 是延迟执行的,查询变量存的是"怎么算"而不是结果,每次枚举都完整重跑一遍,对 EF 就是两条 SQL。修法是需要复用结果就 ToList 物化一次。修过头的代价同样真实:过早 ToList 会把后续过滤搬到内存,丢掉本可以下推数据库的 WHERE,变成把整表拉回来再筛。
- 难度: d1
- EN: A LINQ query is a description, not a result, so every enumeration re-executes it; I materialize once when I need to reuse.

**cs-linq-002**
- Q: IEnumerable 和 IQueryable 的技术差别是什么?这个差别为什么决定了"过滤在哪里发生"?
- A: IEnumerable 的操作接收 Func,也就是已编译的委托,只能在内存里执行;IQueryable 接收 Expression,也就是可被读取的表达式树,provider 可以遍历它并翻译成 SQL。所以同一句 Where,在 IQueryable 上变成数据库的 WHERE 子句,在 IEnumerable 上变成把数据拉回来再逐个判断。
- 难度: d2
- EN: IEnumerable takes compiled delegates and filters in memory, IQueryable takes expression trees a provider can translate into SQL.

**cs-linq-003**
- Q: 把一个 IQueryable 赋值给 `IEnumerable<T>` 变量后再 Where,会发生什么?EF Core 在这件事上做过什么变更?
- A: 从赋值那一刻起后续操作都在客户端执行,数据库端相当于把过滤前的全部行拉回内存。EF Core 3.0 起对无法翻译的表达式**直接抛异常**,而不再静默降级为客户端求值,因为静默降级在生产上表现为"开发环境很快、上线后全表扫描"。这个破坏性变更本身就是答案的一部分。
- 难度: d3
- EN: It collapses to client-side evaluation; EF Core 3.0 made untranslatable queries throw instead of silently degrading, precisely because the silent version was a production trap.

**cs-linq-004**
- Q: `.OrderBy(x => x.Name).Where(x => x.Active)` 和 `.Where(...).OrderBy(...)` 有区别吗?
- A: 结果相同,代价不同。OrderBy 是缓冲操作符,必须读完全部数据才能给出第一个元素,所以先排序意味着对全量数据排序,再丢掉大部分。先 Where 再 OrderBy 只对幸存的行排序。在 IQueryable 上数据库优化器通常会帮你重排,但在内存 LINQ 上这个顺序是实打实的性能差别,也是可读性上的正确写法。
- 难度: d1
- EN: Ordering is a buffering operator, so filtering first means sorting far fewer rows.

**cs-linq-005**
- Q: 哪些 LINQ 操作符是流式的,哪些必须先读完全部数据?这个区分有什么实际后果?
- A: Where、Select、Take、Skip 是流式的,一次处理一个元素,内存占用与数据量无关;OrderBy、GroupBy、Reverse、ToList 是缓冲的,必须把数据全部读进内存才能给出第一个元素。(Count 是另一类:它也要遍历完整个序列才有结果,但只累加一个计数,不占内存,所以它耗的是时间不是内存。)后果是:流式链可以跑在无限序列或超大文件上,而链条里一旦出现缓冲操作符,内存就跟数据量成正比,这是处理大结果集时 OOM 的常见来源。
- 难度: d2
- EN: Streaming operators like Where and Select process one element at a time, while OrderBy and GroupBy must buffer the whole sequence first.

**cs-linq-006**
- Q: `yield return` 的方法被调用时,方法体立刻执行了吗?
- A: 没有。编译器把这个方法改写成一个迭代器状态机,调用它只是返回状态机对象,方法体的第一行要等到第一次 MoveNext(也就是 foreach 的第一轮)才跑。实际后果是:写在方法开头的参数校验也被推迟到枚举时才抛异常,调用点看起来一切正常。所以惯用法是把校验放在一个普通方法里,再让它调用私有的 iterator 方法。
- 难度: d1
- EN: An iterator method body does not run until the first MoveNext, which is why argument validation belongs in a non-iterator wrapper.

**cs-linq-007**
- Q: Dictionary 的查找为什么是 O(1)?什么时候退化成 O(n)?
- A: 因为它用 key 的哈希值对桶数取模直接定位到桶,再在桶内的短链上比较。退化发生在大量 key 哈希到同一个桶时(哈希函数差,或被人为构造碰撞攻击),此时桶内链变长,查找退化成线性扫描。所以 GetHashCode 的分布质量直接决定字典性能,而不只是正确性。
- 难度: d1
- EN: A dictionary hashes the key straight to a bucket, so lookup is O(1) until poor hash distribution turns a bucket into a long chain.

**cs-linq-008**
- Q: 把一个对象作为 Dictionary 的 key 放进去之后,修改了它参与 GetHashCode 的字段,会发生什么?
- A: 这个条目实际上丢失了:它仍然待在按旧哈希算出的桶里,而你现在用新哈希去找,会落到另一个桶,查不到;甚至用同一个对象引用也查不到自己。它还会占着位置直到字典被清空。这就是"字典 key 必须不可变"这条规则的机制层原因,也是为什么 record 和 string 特别适合做 key。
- 难度: d1
- EN: The entry becomes unreachable because it still sits in the bucket for its old hash, which is why dictionary keys must be immutable.

**cs-linq-009**
- Q: 只重写 Equals 不重写 GetHashCode,会出什么问题?
- A: 会在哈希容器里出现"两个相等的对象却互相找不到"的诡异行为:Dictionary 和 HashSet 先用哈希定位桶,哈希不同就根本不会走到 Equals 那一步,于是同一个逻辑 key 可以被插入两次。契约是单向的:相等必须蕴含哈希相同,哈希相同不要求相等。C# 的 record 自动生成这一对,是它适合做 key 和做值对象的原因之一。
- 难度: d0
- EN: Hash containers locate the bucket by hash first, so equal objects with different hash codes never even reach Equals and end up duplicated.

**cs-linq-010**
- Q: 你的 `DbUtil.QueryAsync` 用 `new Dictionary<string, object?>(StringComparer.Ordinal)` 而不是默认比较器,为什么这是对的?
- A: 因为列名是协议标识符,不是人类语言文本,比较必须是逐字节的序数比较,不能受当前区域文化影响。默认的字符串比较在某些区域(经典例子是土耳其语的 i 和 ı)会给出不同结果,导致同一段代码在不同区域设置的机器上行为不一致。显式写 Ordinal 顺带也更快,因为不需要走文化敏感的比较逻辑。
- 难度: d1
- EN: Column names are protocol identifiers, so they must compare ordinally rather than with culture-sensitive rules that vary by locale.

---

## 5. 异常与错误设计

### 概念讲解

**Mental model:** 异常是**给"我处理不了、也不该由我决定怎么办"的情况准备的逃生通道**。
它的独特能力不是"报错",而是**跳过中间所有层直接把控制权交给有能力决策的那一层**,并且沿途携带发生现场的证据(栈)。
一旦你把它用在"可预期的正常分支"上(比如"用户名已存在"),你就在用一台起重机搬一个杯子:又慢又吵。

**throw vs throw ex(必考,而且答错就出局)。**
`throw;` 重新抛出当前异常并**保留原始栈**;
`throw ex;` 把栈的起点重置到当前这一行,**原始出错位置永久丢失**,线上排障时你只能看到 catch 所在的那一行。
`throw ex;` 几乎总是 bug。要加上下文就 `throw new XxxException("context", ex)`,用 InnerException 挂住原始异常。

**exception filter(`when`)的隐藏价值。**
`catch (SqlException e) when (e.Number == 40501)` 不只是语法糖:
**filter 在栈展开之前求值**。也就是说 filter 返回 false 时,栈根本没有被展开,
调试器和崩溃转储看到的是**原始现场**,而不是"已经被 catch 又 rethrow 过一遍"的残骸。
这是 `when` 比"catch 进来判断一下不对就 throw;"严格更优的技术理由。

**异常 vs 返回值,边界在哪。** 判据是**调用方能不能预期并例行处理**:
"版本冲突了,请重试"是**预期内的业务结果**,应该走返回值/结果类型
(你的 Cards.cs 返回 `VERSION_CONFLICT` 就是这个选择,而不是抛异常);
"数据库连不上"是**没预期到的**,应该抛。
另一条现实判据是性能:异常在 .NET 上的成本主要在抛出时捕获栈和展开,
在热路径上用异常做控制流会明显拖慢(所以有 `TryParse` 而不是 catch `FormatException`)。

**catch 什么、不 catch 什么。**
只 catch 你**真的知道怎么处理**的异常。`catch (Exception)` 只应该出现在两个地方:
(1) 进程/请求的最外层边界(把未知异常转成 500 并记日志,防止崩进程);
(2) 你要加上下文再重新抛出的地方。
永远不要写空 catch(吞掉异常等于把故障延后到一个完全无关的地方再爆炸)。
你的 Lambda handler 里的顶层 try/catch 就是边界 (1) 的正当实例:
把 `ValidationError` 映射成 400,其他未知异常映射成 500 并记录。

**自定义异常的门槛。** 只有当调用方需要**用类型来区分处理策略**时,才值得新建异常类型。
"我想给它起个好名字"不是理由。你的 `BusinessException`(Worker 里)是合理的,
而且它的语义要说准:catch 到 `BusinessException` 时你把 job 标成 FAILED 然后**正常返回**,
消息被 SQS 删除、不再重投(因为重投也没用);其他异常**原样抛出**,让 SQS 在可见性超时后重投,
重投到 `maxReceiveCount` 之后才进 DLQ。
所以这个类型承载的判断是"这次失败可不可重试",而 SQS 的重试行为完全由"handler 有没有抛出"决定,
类型是唯一能把这个判断写进代码的地方。

**finally 的边界。** `finally` 在正常返回、异常、以及 return 语句之后都会执行,
但**不会**在 `StackOverflowException`、`Environment.FailFast`、进程被杀时执行。
所以"关键清理放 finally 就万无一失"是过度信任;真正关键的一致性要靠**外部**保证
(数据库事务、幂等重放、outbox),不靠进程内的 finally。这条正好接上模块 6 和你的 outbox 设计。

**日志与异常的分工。** 一个异常应该**只被完整记录一次**,记在它被真正处理的那一层。
每层都 catch-log-rethrow 会产生同一个故障的 N 份日志,把根因埋在噪音里。
中间层要么加上下文重新抛出(不记日志),要么什么都不做。

### 卡片素材(手动录入用)

**cs-ex-001**
- Q: catch 块里 `throw;` 和 `throw ex;` 的区别是什么?哪个是 bug?
- A: `throw;` 保留原始调用栈并重新抛出同一个异常;`throw ex;` 把栈起点重置到当前行,原始出错位置永久丢失,线上你只能看到 catch 所在的行。`throw ex;` 几乎总是 bug。需要补充上下文时用 `throw new XxxException("context", ex)`,让原异常挂在 InnerException 上。
- 难度: d0
- EN: throw preserves the original stack trace while throw ex resets it, destroying exactly the information you need in production.

**cs-ex-002**
- Q: `catch (X e) when (cond)` 比 "catch 进来判断,不对就 throw;" 好在哪?给技术理由,不要说"更好看"。
- A: 因为 exception filter 在**栈展开之前**求值。filter 返回 false 时栈从未被展开,调试器和崩溃转储看到的是原始现场;而先 catch 再 rethrow 已经展开过一次,现场信息已经受损。这在只能靠一份 dump 排查的生产故障里是实质差别,不是风格问题。
- 难度: d3
- EN: Exception filters are evaluated before the stack unwinds, so a non-matching filter leaves the original crash site intact for the debugger.

**cs-ex-003**
- Q: "版本冲突,请重试"这种情况该抛异常还是返回错误码?判据是什么?
- A: 返回错误码。判据是调用方能不能**预期并例行处理**:乐观并发冲突是这个设计的正常输出,调用方本来就要处理重试,把它做成返回值让这条路径显式可见、可测、也不付出抛异常的成本。反过来"数据库连不上"没人能例行处理,应该抛。我的 Cards.cs 里冲突返回 VERSION_CONFLICT 就是这个判断。
- 难度: d1
- EN: Expected outcomes the caller must routinely handle belong in the return value; exceptions are for situations the caller cannot anticipate.

**cs-ex-004**
- Q: `catch (Exception)` 什么时候是合理的?
- A: 只有两处:一是进程或请求的最外层边界,把未知异常转成 500 并记录一次,防止一个 bug 崩掉整个进程;二是你要补充上下文再重新抛出的地方。除此之外都应该 catch 具体类型。绝对不能写空 catch,吞掉异常等于把故障延后到一个完全无关的位置再爆炸,排查成本翻好几倍。
- 难度: d1
- EN: A blanket catch belongs only at a process or request boundary, or where I add context and rethrow; anything else should catch a specific type.

**cs-ex-005**
- Q: 为什么在热路径上用异常做控制流是坏主意?为什么有 `TryParse`?
- A: 因为抛出的成本主要在捕获栈帧和展开栈,比一次普通的条件判断贵好几个数量级,而且它把可预期的分支藏进了不可见的跳转里,读代码的人看不出这条路径存在。TryParse 存在就是为了让"输入可能不合法"这个**预期内**的情况走返回值,而不是每次失败都付一次异常的价钱。
- 难度: d1
- EN: Throwing costs stack capture and unwinding, and it hides an expected branch, which is exactly why the Try-pattern exists.

**cs-ex-006**
- Q: 什么时候值得定义一个自定义异常类型?
- A: 只有当调用方需要**用类型来选择不同处理策略**时。"想起个好名字"不是理由,那只会增加类型数量。举个正当例子:我的 Worker 里有 BusinessException,catch 到它就把 job 标成 FAILED 然后正常返回,消息被删除不再重投;其他异常原样抛出,让 SQS 重投,重投够次数才进 DLQ。SQS 的重试行为完全由"handler 有没有抛出"决定,所以"这次失败可不可重试"这个判断只能由类型来承载。
- 难度: d1
- EN: A custom exception earns its place only when callers need the type to choose a different handling strategy.

**cs-ex-007**
- Q: 每一层都 catch、记日志、再 rethrow,有什么问题?
- A: 同一个故障会产生 N 份日志,根因被自己的回声淹没,告警去重也会失效。规则是一个异常**只被完整记录一次**,记在真正处理它的那一层(通常是最外层边界)。中间层要么原样让它穿过去,要么包一层补充上下文再抛,但不记日志。
- 难度: d1
- EN: Log-and-rethrow at every layer multiplies one failure into many log entries; an exception should be logged once, where it is actually handled.

**cs-ex-008**
- Q: 把关键清理放进 `finally` 就万无一失吗?
- A: 不是。finally 在正常返回、return 和异常路径上都会跑,但在 StackOverflowException、Environment.FailFast、进程被 OOM killer 或云平台杀掉时都不会跑。所以进程内的 finally 只能保证"这次执行的清理",跨进程的一致性必须靠外部机制:数据库事务、幂等的重放、outbox。这也是我在摄入路径上用 outbox 而不是"发完消息再在 finally 里补偿"的理由。
- 难度: d2
- EN: finally does not run on stack overflow, FailFast, or a killed process, so cross-process consistency must come from transactions and idempotent replay, not from finally.

---

## 6. 数据访问(Npgsql / ADO.NET)

### 概念讲解

**Mental model:** 数据库是**你的进程之外的、被所有实例共享的、唯一能仲裁并发的地方**。
凡是需要"全世界只发生一次"或"两个人不能同时改坏"的事,答案都在这一层,而不在 C# 里加锁。
你的三个 Lambda 是无状态、可随时并发多份的,这个事实把几乎所有正确性问题都推给了 PostgreSQL。

**参数化不是"转义得更好",是走了另一条通道。**
参数化查询把 SQL 文本和数据分成两条路送到数据库:SQL 先被解析成执行计划,
参数**永远只作为数据绑定进去,不参与语法解析**。所以注入在结构上不可能发生,不是"被过滤掉了"。
字符串拼接加转义是在**猜数据库的解析规则**:编码、方言、多字节字符、注释语法的边角情况永远追不完。
附赠好处是执行计划可复用(相同 SQL 文本不同参数)。
你的 `DbUtil.CreateCommand` 全程走 `$1/$2` 占位符,再由 `SqlUtil.ToNpgsql` 把它们转成 Npgsql 的 `@p1/@p2`,
参数按位置绑定。这个"保持 Node 风格 SQL 写法、在边界处翻译占位符"的设计,
面试里可以作为"跨语言迁移时如何保留可对照性"的具体例子来讲。
**注意边界:参数化只能参数化"值",不能参数化表名、列名、ORDER BY 方向。**
那些必须用白名单校验,这是参数化最常被忽略的边界。

**事务的边界与隔离级别。**
事务给你 ACID,但**"原子"只保证一起提交或一起回滚,不保证语句之间没有竞态**。
PostgreSQL 默认是 Read Committed:同一个事务里两次相同的查询,可能看到别人已提交的新数据(不可重复读)。
要防这个得 Repeatable Read,**注意 Postgres 的 Repeatable Read 是快照隔离,比 SQL 标准要求的更强,顺带把幻读也挡掉了**;
它挡不住的是写偏斜(两个事务改的不是同一行,却一起破坏了跨行不变式),那才需要 Serializable
(代价是提交时可能抛 `40001 serialization_failure`,调用方必须写重试循环)。
**面试里的高价值动作是把"我需要什么保证"和"我付什么代价"配对说出来,而不是背四个隔离级别的名字。**

**为什么"单条语句"强于"事务里的多条语句"(你的 6-CTE)。**
这是你手上最硬的例子:你的进度摄入是一条 SQL 里的多个 CTE(插事件 → 从 `ins` 的 RETURNING 里写 outbox
→ 聚合 → `distinct on` 取每张卡的最后一次 → upsert 合并)。
事务保证的是"一起提交",但语句之间仍然存在可见性和竞态需要讨论;
而在**单条语句**里,outbox 的数据源直接是事件插入的 `RETURNING`,
"事件写了但 outbox 漏了"在**物理上不可能**,连隔离级别都不用讨论。
这叫把正确性从"运行时约定"收紧成"结构性事实"。
额外收益:同一批里重复的同一张卡先在 CTE 里折叠好,绕开了
`ON CONFLICT DO UPDATE cannot affect row a second time` 这个 Postgres 硬错误。

**幂等的实现形状。** 网络会重传,客户端会离线重放,SQS 是 at-least-once,所以**同一个事件到达两次是常态而非异常**。
你的做法是给事件一个客户端生成的 `event_id`(UUID)做主键,
插入时 `on conflict (event_id) do nothing`:第二次到达什么都不做,`RETURNING` 不返回行,
于是后续所有 CTE(outbox、聚合、合并)自然全部空转。
**关键洞察:幂等不是在应用层"先查再写"(那是竞态),而是把它压成数据库的一个唯一约束。**
第二个细节值得讲:批内也可能重复同一个 event_id,所以 join 侧的 VALUES 列表必须先去重
(你用 `HashSet<string>` 做的),否则一行事件会被扇出成多行,`distinct on` 就在两个值之间随机挑一个。

**transactional outbox 解决什么。** "写数据库"和"发消息给下游"是两个系统,没有跨系统的原子提交。
先写库再发消息:发消息失败就丢事件;先发消息再写库:库写失败就发了个不存在的事件。
outbox 的解法是**把消息也写进同一个数据库**(同一条语句里),然后由一个独立的投递者读 outbox 发出去。
这样"要么都发生要么都不发生"由数据库保证,而投递环节退化成一个**可重试的、at-least-once 的**问题,
下游用幂等消费来兜(所以 outbox 表也带 `event_id` 唯一约束)。

**乐观并发(你的 Cards.cs)。**
`update ... set version = version + 1 where id = $1 and version = $2`:不加锁,
写入时校验"我读到的版本还是最新的";受影响行数为 0 说明有人先改了,返回 `VERSION_CONFLICT` 让调用方重试或提示。
好处是无锁等待、无死锁、读多写少时吞吐高;代价是冲突方要处理重试。
不够用的场景:冲突率高(热点行反复重试比排队还贵,该改悲观锁 `SELECT ... FOR UPDATE`),
或者不变量跨多行多表(需要事务加合适隔离级别)。
**注意受影响行数为 0 有两种原因:版本不匹配,或者行根本不存在。**
你的代码在冲突后回查一次 `select version from cards where id = $1` 来区分这两种情况,
这个细节值得在面试里说,因为它显示你想过"404 和 409 是不同的答案"。

**连接池与 Lambda。** Npgsql 默认开启连接池,`Dispose` 是**还回池**而不是断开 TCP。
建立一个 Postgres 连接是昂贵的(TCP + TLS + 认证 + 后端进程 fork),所以池是必需的。
Lambda 的特殊性在于:**每个并发执行环境有自己的池**,横向扩展 100 个并发实例就是 100 份池,
很容易撞上 Postgres 的 `max_connections`。这是 RDS Proxy 存在的理由(在 Lambda 和数据库之间再放一层共享池)。
面试里能主动指出"serverless 与连接池天然冲突",是很有分量的一句。

**N+1 查询。** 循环里对每行再查一次,1 次查询变成 N+1 次。
在 ORM 里表现为懒加载导航属性;在手写 SQL 里表现为"先查 id 列表再逐个查详情"。
解法是 join、`WHERE id = ANY($1)` 批量查、或 ORM 的 `Include`。
这是 code review 里最常被抓的数据访问问题,面试也常考。

### 卡片素材(手动录入用)

**cs-db-001**
- Q: 参数化查询防注入的原理是什么?为什么"仔细转义"不够?
- A: 参数化把 SQL 文本和数据走两条通道送到数据库:SQL 先编译成执行计划,参数永远只作为数据绑定,不参与语法解析,所以注入在结构上不可能,而不是"被过滤掉"。转义是在猜数据库的解析规则,编码、方言、多字节字符、注释语法的边角永远追不完。附赠好处是执行计划可复用。我的 DbUtil 全程 `$1/$2` 占位符走的就是这条路。
- 难度: d1
- EN: Parameterized queries separate code from data at the protocol level, so injection is structurally impossible rather than filtered out.

**cs-db-002**
- Q: 参数化能防住所有注入吗?哪里是它的边界?
- A: 防不住需要动态拼**标识符**的地方:表名、列名、ORDER BY 的列和方向、LIMIT 之外的结构性片段都不能作为参数绑定,因为它们是语法而不是数据。那些必须用白名单映射(比如把用户传的 sort=name 映射到你自己写死的列名常量),绝不能拼用户输入。这是参数化最常被忽略的边界,也是"我用了参数化所以安全"这句话失效的地方。
- 难度: d2
- EN: Parameters bind values, not identifiers, so dynamic column or sort order must go through a server-side whitelist.

**cs-db-003**
- Q: 你的进度摄入是一条 SQL 里的 6 个 CTE(插事件、写 outbox、聚合、取最后一次、upsert)。为什么这比"四条语句包在一个事务里"更强?
- A: 事务保证一起提交,但语句之间仍然有可见性和竞态需要讨论。单条语句里 outbox 的数据源直接是事件插入的 RETURNING,"事件写了但 outbox 漏了"在物理上不可能,连隔离级别都不用讨论。边界从事务边界收紧到语句边界,是把正确性从运行时约定变成结构性事实。同批里重复的同一张卡先在 CTE 里折叠,还顺带绕开了 ON CONFLICT 不能二次影响同一行的错误。
- 难度: d3
- EN: Sourcing the outbox insert from the event insert's RETURNING makes divergence physically impossible, which is tighter than any transactional guarantee.

**cs-db-004**
- Q: 客户端重传导致同一个事件到达两次,你怎么保证只生效一次?为什么不是"先查再写"?
- A: 给事件一个客户端生成的 UUID 做主键,插入时 `on conflict (event_id) do nothing`。第二次到达什么都不做,RETURNING 不返回行,后面依赖它的所有 CTE 自然全部空转。不用"先查再写"是因为那是竞态:两个并发请求可能同时查到"不存在"然后都写入。幂等应该被压成数据库的一个唯一约束,让唯一索引替你仲裁。
- 难度: d1
- EN: Idempotency belongs in a unique constraint the database enforces, not in a check-then-insert that two concurrent requests can both pass.

**cs-db-005**
- Q: transactional outbox 解决的到底是什么问题?为什么不能"写完库再发消息"?
- A: 解决的是"写数据库"和"发消息"分属两个系统、没有跨系统原子提交这件事。先写库再发消息,发失败就丢事件;先发消息再写库,库失败就发了个不存在的事件。outbox 把消息也写进同一个数据库(在我这里是同一条语句),原子性由数据库保证,投递退化成一个可重试的 at-least-once 问题,下游靠幂等消费兜住,所以 outbox 行同样带 event_id 唯一约束。
- 难度: d1
- EN: There is no atomic commit across a database and a broker, so the outbox writes the message into the same transaction and lets an independent publisher retry delivery.

**cs-db-006**
- Q: `update ... set version = version + 1 where id = $1 and version = $2` 这个模式叫什么?比悲观锁好在哪?什么时候不够用?
- A: 乐观并发控制:不加锁,写入时校验"我读到的版本还是最新的",受影响行数为 0 说明有人先改了,返回冲突让调用方重试。好处是无锁等待、无死锁、读多写少时吞吐高;代价是冲突方要重试。不够用的场景是冲突率高(热点行反复重试比排队还贵,该用 SELECT FOR UPDATE),或不变量跨多行多表(需要事务加合适隔离级别)。
- 难度: d1
- EN: Optimistic concurrency validates the version at write time and turns conflicts into retries, which beats locking when contention is low.

**cs-db-007**
- Q: 乐观并发的 UPDATE 返回受影响行数 0,你能直接回 409 吗?
- A: 不能,0 行有两个原因:版本不匹配(真冲突,409),或者这一行根本不存在(应该是 404)。直接回 409 会让"删掉的资源"看起来像"有人抢先改了",客户端会去做无意义的重试。我的 Cards.cs 在冲突后回查一次 `select version from cards where id = $1` 来区分这两种情况,再决定返回 404 还是 409。
- 难度: d2
- EN: Zero affected rows means either a version conflict or a missing row, so I re-read the row to decide between 409 and 404.

**cs-db-008**
- Q: PostgreSQL 默认的 Read Committed 隔离级别下,同一个事务里两次相同的查询可能得到不同结果吗?
- A: 可能。Read Committed 只保证读到已提交的数据,不保证同一事务内的可重复读:别人在两次查询之间提交了改动,你第二次就会看到。要防这个需要 Repeatable Read,而 Postgres 的 Repeatable Read 是快照隔离,顺带把幻读也挡了;它挡不住写偏斜,那要 Serializable,代价是提交时可能抛 40001 序列化失败,调用方必须写重试循环。选隔离级别的正确姿势是把"我需要什么保证"和"我付什么代价"配对说清楚。
- 难度: d1
- EN: Read Committed only guarantees committed reads, so the same query can return different rows within one transaction unless I raise the isolation level.

**cs-db-009**
- Q: Npgsql 的连接 Dispose 到底做了什么?为什么 serverless 和连接池天然冲突?
- A: Dispose 是把连接**还回池**,不是断开 TCP,因为建连接很贵(TCP、TLS、认证、后端进程创建)。冲突在于每个 Lambda 执行环境有自己独立的池,横向扩到 100 个并发实例就是 100 份池,很容易撞上 Postgres 的 max_connections,而且这些池大部分时间是闲的。这正是 RDS Proxy 这类中间层存在的理由:在函数和数据库之间再放一个共享池。
- 难度: d2
- EN: Disposing returns the connection to a per-process pool, and since every serverless instance has its own pool, scale-out multiplies pools until the database runs out of connections.

**cs-db-010**
- Q: N+1 查询问题长什么样?在手写 SQL(不用 ORM)的代码里它还会出现吗?
- A: 会。它的本质是"先取一个列表,再对每个元素单独查一次",1 次变成 N+1 次往返,延迟随数据量线性增长。ORM 里它藏在懒加载的导航属性后面,手写 SQL 里它就明摆着是一个循环里的 await 查询。解法是 join 一次取回,或者用 `where id = any($1)` 批量取,再在内存里按 key 组装。
- 难度: d0
- EN: N+1 is fetching a list then querying once per row; the fix is a join or a single batched `where id = any(...)`.

---

## 7. ASP.NET Core 基础

### 概念讲解

> **诚实说明:你的后端是三个 AWS Lambda,不是 ASP.NET Core 应用。**
> 你手写了等价物:`Common/RouteMatcher.cs` 是路由,`Common/Auth.cs` 是认证,
> `Common/Validation.cs` 是模型校验,`Common/Res.cs` 是结果封装,
> `Pg.OpenConnectionOrNullAsync()` 加 `await using` 是手工管理的"请求作用域资源"。
> 所以这一节你的处境很特殊:**概念你天天在实现,但框架的名字和默认行为你没被迫学过**。
> NZ 的 intermediate .NET 岗位面试几乎必考 DI 生命周期和中间件顺序,
> 这是整份文档里你最需要"补讲解"而不是"补经验"的一节。
> 好消息是:你手写过一遍等价物的人,理解这些概念比只用过框架的人更快,前提是把名字对上。

**Mental model 一:中间件管道是一叠洋葱皮。**
每个中间件拿到 `HttpContext` 和一个"下一环"的委托 `next`。
它可以在 `await next()` **之前**做事(看到的是请求进来的样子)、
在**之后**做事(看到的是响应出去的样子)、
或者**根本不调用 next**(短路,直接返回,比如认证失败、静态文件命中、响应缓存命中)。
所以顺序不是配置,是**代码执行顺序**:`app.Use...` 的注册顺序就是请求穿过的顺序,响应则反向穿回来。

**为什么顺序会咬人。** 几条硬规则背后都有机制:
- **异常处理中间件必须最先注册**,因为它只能捕获它 `await next()` 之后抛出的异常,注册在它之前的中间件抛的它看不见。
- **`UseRouting` 必须在 `UseAuthorization` 之前**,因为授权要知道"匹配到的是哪个 endpoint、它上面有什么 `[Authorize]` 特性",而这个信息是 routing 填进 HttpContext 的。
- **`UseAuthentication` 在 `UseAuthorization` 之前**:先弄清"你是谁"(建立 `User` 主体),才能判断"你能不能"。
- **`UseCors` 要在会短路的中间件之前**,否则被短路掉的响应(比如 401)不带 CORS 头,浏览器看到的是一个莫名其妙的 CORS 错误而不是 401,排查方向会被带偏一整天。
- **静态文件通常放前面**,让它短路掉,不必走后面的认证和路由。
`Use` 可以调用 next,`Run` 是终结点(不调 next),`Map` 按路径分叉出一条子管道。

**Mental model 二:DI 生命周期是"这个对象活多久"。**
- **Transient**:每次要都新建一个。最安全,但如果对象昂贵(持有连接)就浪费。
- **Scoped**:每个请求(每个 scope)一个。这是 `DbContext`、当前用户上下文、工作单元的默认答案。
- **Singleton**:整个进程一个,所有请求共享。适合无状态的、线程安全的、初始化昂贵的东西(配置、缓存、HttpClient 工厂)。

**captive dependency(被俘获的依赖),必考。**
把一个依赖 Scoped 服务的类注册成 Singleton,会发生什么?
Singleton 只被构造一次,它构造时拿到的那个 Scoped 实例(比如某个请求的 `DbContext`)被**永久持有**。
于是本该每请求一份的状态被跨请求共享:并发下 DbContext 不是线程安全的会崩、
可能读到别的用户的数据、连接永远不释放。
**规则一句话:一个服务的生命周期不能长于它依赖的服务。**
ASP.NET Core 在 Development 环境默认开启 scope validation,能在启动时抓住一部分这类错误。
如果 Singleton 确实需要用 Scoped 服务,正确做法是注入 `IServiceScopeFactory`,
在需要时 `CreateScope()` 自己开一个短作用域再取,用完释放。

**桥回你的世界(这段能让你在面试里显得比别人透彻)。**
Lambda 里 `static` 字段跨调用存活 = **事实上的 Singleton**;
每次调用里 `await using var conn = ...` 打开的连接 = **事实上的 Scoped**;
每次调用里 `new` 出来的临时对象 = **Transient**。
"把连接缓存进 static 复用"这个诱人的优化,和 captive dependency 是**同一个 bug**:
把一个请求级的资源提升成了进程级的共享状态。你已经在 Lambda 里面对过这个权衡,
面试时把两边对上讲,比背定义有说服力得多。

**模型绑定与校验。** ASP.NET Core 会按来源(路由、查询串、表单、body)把请求数据填进 action 参数,
`[ApiController]` 特性会让模型校验失败自动返回 400 ProblemDetails,不需要手写 `if (!ModelState.IsValid)`。
这和你 `Validation.ParseJsonBody` 加手写 `RequireString`/`ValidationError` 再映射成 400 是同一件事,
只是框架帮你做了。**要能说出的边界**:自动 400 只覆盖"形状"校验(必填、类型、范围),
业务规则校验(比如"这个 deckSlug 你有权访问吗")仍然要你自己写,而且属于业务层不属于绑定层。

**配置分层。** `IConfiguration` 是分层覆盖的:appsettings.json → appsettings.{Environment}.json →
环境变量 → 命令行参数,**后面的覆盖前面的**。
`IOptions<T>` 把配置绑定成强类型;要在运行时感知配置变化用 `IOptionsMonitor<T>`,
`IOptionsSnapshot<T>` 是 scoped 的(每请求重新读一次)。
Secrets 不进 appsettings.json:开发用 user-secrets,生产用环境变量或密钥服务
(你的 Lambda 读 `PGHOST/PGDATABASE/PGUSER/PGPASSWORD` 环境变量,就是这条规则的实践)。

**中间件 vs 过滤器 vs endpoint。** 中间件对**所有**请求生效、不知道 MVC 的概念;
过滤器(filter)只在 MVC/API 管道里生效,能拿到 action、参数、模型状态。
所以"记录所有请求的耗时"用中间件,"给某个 controller 加统一的审计"用过滤器。

### 卡片素材(手动录入用)

**cs-asp-001**
- Q: 把一个依赖 Scoped 服务的类注册成 Singleton,会发生什么?这个问题叫什么名字?
- A: 叫 captive dependency。Singleton 只构造一次,它构造时拿到的那个 Scoped 实例(比如某个请求的 DbContext)被永久持有,于是本该每请求一份的状态被跨请求共享:并发访问不线程安全的对象会崩、可能读到别的用户的数据、连接永不释放。规则是一个服务的生命周期不能长于它依赖的服务。Development 环境的 scope validation 能在启动时抓住一部分。
- 难度: d1
- EN: A singleton capturing a scoped service extends that instance's lifetime across every request, which is the captive dependency problem.

**cs-asp-002**
- Q: 一个 Singleton 确实需要用到 Scoped 服务(比如后台任务要写库),正确做法是什么?
- A: 注入 `IServiceScopeFactory`,在每次需要时 `using var scope = factory.CreateScope()`,从 `scope.ServiceProvider` 取那个 Scoped 服务,用完随作用域一起释放。关键是**不要把 Scoped 服务放进 Singleton 的构造函数**,而是每次工作时开一个短作用域,让它的生命周期重新变得比 Singleton 短。
- 难度: d2
- EN: Inject IServiceScopeFactory and create a short-lived scope per unit of work, instead of capturing a scoped service in the singleton's constructor.

**cs-asp-003**
- Q: Transient、Scoped、Singleton 各自适合什么?给每个一个具体例子和一个反例。
- A: Transient 每次新建,适合轻量无状态的策略或帮助类,反例是持有昂贵连接的对象(白白重建)。Scoped 每请求一个,适合 DbContext、工作单元、当前用户上下文,反例是被 Singleton 捕获。Singleton 整个进程一个,适合无状态且线程安全、初始化昂贵的东西(配置、内存缓存、HttpClient 工厂),反例是任何持有请求级数据的对象。
- 难度: d1
- EN: Transient for cheap stateless helpers, scoped for per-request units of work like DbContext, singleton for thread-safe expensive stateless services.

**cs-asp-004**
- Q: ASP.NET Core 的中间件顺序为什么是"代码顺序"而不是"配置"?一个中间件有哪三种选择?
- A: 因为每个中间件拿到的是 HttpContext 加一个代表"下一环"的委托,注册顺序就是请求穿过它们的顺序,响应再反向穿回来,这本质上就是嵌套的函数调用。三种选择:在 `await next()` 之前做事(看到进来的请求)、之后做事(看到出去的响应)、或者根本不调用 next 直接短路返回(认证失败、静态文件命中、缓存命中)。
- 难度: d1
- EN: Middleware is a nested chain of delegates, so registration order is execution order: act before next, after next, or short-circuit by not calling it.

**cs-asp-005**
- Q: 异常处理中间件为什么必须注册在最前面?
- A: 因为它只能捕获它 `await next()` 之后抛出的异常,也就是**注册在它后面**的中间件和终结点抛的。任何注册在它之前的中间件抛异常,它根本不在调用栈上,拦不到,请求会变成一个没有统一错误格式的裸 500 甚至连接中断。所以它必须是管道最外层的那一圈洋葱皮。
- 难度: d1
- EN: It can only catch what happens inside its own await next, so anything registered before it is outside its try block.

**cs-asp-006**
- Q: `UseRouting` 为什么必须在 `UseAuthorization` 之前?
- A: 因为授权要知道"这个请求匹配到了哪个 endpoint、那个 endpoint 上有什么 `[Authorize]` 或策略特性",而这个匹配结果正是 routing 中间件解析并放进 HttpContext 的。顺序反了,授权中间件拿不到 endpoint 元数据,要么把所有请求当成没有授权要求放行,要么直接报错。同理 UseAuthentication 必须在 UseAuthorization 之前:先确定"你是谁",才能判断"你能不能"。
- 难度: d1
- EN: Authorization reads the endpoint metadata that routing puts into the context, so routing must run first, and authentication before that.

**cs-asp-007**
- Q: CORS 中间件放错位置会产生什么样的、特别难查的症状?
- A: 症状是浏览器报 CORS 错误,而真实原因完全是别的:如果 CORS 注册在会短路的中间件(比如认证)之后,那么一个 401 响应是由前面的中间件直接返回的,不会经过 CORS 中间件,于是缺少 CORS 响应头,浏览器只报"被 CORS 策略阻止",把 401 完全隐藏了。排查方向被带偏一整天。所以 CORS 要放在可能短路的中间件之前。
- 难度: d2
- EN: A short-circuited response that skips the CORS middleware loses its CORS headers, so the browser reports a CORS error and hides the real 401.

**cs-asp-008**
- Q: 把 `Run` 写在管道中间会发生什么?它和 `Use`、`Map` 的位置语义差在哪?
- A: 后面注册的所有中间件会静默失效,一行报错都没有。因为 `Run` 注册的是终结点:它不接收 next,永远短路,请求走到这里就返回了。`Use` 才是可以调用 next 把控制权往下传的中间件,`Map` 是按路径前缀分叉出一条独立的子管道,只有匹配的请求走进去。所以这三个 API 的差别不是写法,是"控制权还给不给下一环"。
- 难度: d1
- EN: Use passes control on with next, Run terminates the pipeline, and Map branches a sub-pipeline by path prefix.

**cs-asp-009**
- Q: `[ApiController]` 帮你自动做了模型校验并返回 400,那还有什么校验是你必须自己写的?
- A: 自动 400 只覆盖**形状**校验:必填、类型能否转换、字符串长度、数值范围这类由绑定和 DataAnnotations 表达的规则。业务规则完全不覆盖:这个用户有没有权访问这个资源、这个状态转换是否合法、引用的外键是否存在。这些属于业务层,而且往往需要查库,不该被塞进绑定层。把两者混为一谈会让"校验通过"给人虚假的安全感。
- 难度: d1
- EN: Automatic 400s cover shape validation only; authorization and business-rule checks still belong in the domain layer.

**cs-asp-010**
- Q: ASP.NET Core 的配置来源是怎么叠加的?数据库密码该放在哪?
- A: 分层覆盖,后注册的覆盖先注册的,默认顺序大致是 appsettings.json,然后 appsettings.{Environment}.json,然后环境变量,最后命令行参数。密码绝不放进 appsettings.json(它会进 git):开发用 user-secrets,生产用环境变量或托管的密钥服务。我的 Lambda 从 PGHOST/PGUSER/PGPASSWORD 这些环境变量读连接信息,就是这条规则在 serverless 下的形式。
- 难度: d1
- EN: Configuration providers layer with later sources overriding earlier ones, and secrets come from environment variables or a secret store, never from appsettings.json.

**cs-asp-011**
- Q: 中间件和过滤器(filter)分别该用在什么场景?
- A: 中间件对**所有**请求生效,并且完全不知道 MVC 的概念(不知道 action、参数、ModelState),适合横切基础设施:请求日志、耗时统计、异常兜底、压缩、CORS。过滤器只在 MVC/API 管道内生效,能访问 action、绑定后的参数和模型状态,适合与业务模型相关的横切:审计某类 controller、统一的资源授权、结果包装。选错的典型症状是在中间件里想拿 action 名字却拿不到。
- 难度: d1
- EN: Middleware is MVC-agnostic and runs for every request, while filters run inside the MVC pipeline and can see the action and its bound arguments.

**cs-asp-012**
- Q: 你的后端是 Lambda,没有 ASP.NET Core 的容器。你在 Lambda 里的哪些做法分别对应 Singleton、Scoped、Transient?
- A: Lambda 容器被复用,所以 static 字段跨调用存活,那就是事实上的 Singleton(连接池、配置、序列化器都在这里);每次调用里 `await using var conn = await Pg.OpenConnectionOrNullAsync()` 打开又释放的连接,是事实上的 Scoped;调用内 new 出来的临时对象是 Transient。由此可以直接推出:把一个连接缓存进 static 复用,和 captive dependency 是同一个 bug,都是把请求级资源提升成了进程级共享状态。
- 难度: d1
- EN: Static fields in a reused Lambda container behave exactly like singletons, and caching a per-request connection there is the same bug as a captive dependency.

---

## 8. 面试高频补充

### 概念讲解

这一节收拢几个**几乎每场 .NET 面试都会问、但平时写代码不会逼你想清楚**的题目。
它们的共同点是:你都用对过,但可能说不出为什么。

**接口 vs 抽象类。** 表面差别(可以实现多个接口,只能继承一个类)是背出来的;
真正的判据是**它们回答不同的问题**:
- **接口回答"你能做什么"(能力/契约)**,不携带实现细节,不携带状态,不参与继承的身份关系。
  它让互不相关的类型能被同样对待(`IDisposable` 就是最好的例子:文件、连接、锁,毫无血缘,但都能被 `using`)。
- **抽象类回答"你是什么"(身份/共享实现)**,可以有字段、构造函数、受保护的成员、
  以及"模板方法"(基类定好骨架,子类只填几个洞)。
C# 8 引入的 default interface methods 让接口能带默认实现,主要目的是**给已发布的接口加成员而不破坏实现者**,
不是"接口现在可以当抽象类用了"(接口依然不能有实例字段,也没有构造函数)。
版本演化上的经典区别:**给抽象类加一个虚方法是安全的(子类自动继承),
给接口加一个成员会破坏所有已有实现者**(除非给默认实现)。
实践默认:**优先接口做依赖注入的契约**(可测、可替换、不锁死继承链),
只有当确实要共享实现和状态时才用抽象类。

**泛型约束是干什么的。** 没有约束时,`T` 只能被当作 `object` 用(编译器不知道它有什么)。
约束的作用是**告诉编译器 T 至少满足什么**,从而解锁调用。
常见几种:`where T : class`(引用类型,可以为 null)、`where T : struct`(值类型,不能为 null)、
`where T : new()`(有无参构造,可以 `new T()`)、`where T : SomeBase`/`ISomething`(可以调用它的成员)、
`where T : notnull`。
一条容易被忽略的实践价值:约束是**API 设计的表达工具**,
`where T : IComparable<T>` 直接在签名上宣布"这个方法需要能比较的类型",错误在编译期就被挡住,而不是运行时。

**`readonly` vs `const`(这题的杀伤力全在"跨程序集"这一点)。**
- `const` 是**编译期常量**:编译器把值**直接内联进每一个使用它的地方**。
  后果是,如果你的库改了一个 public const 的值,**所有引用它的程序集必须重新编译**,
  否则它们还带着旧值继续跑,而且没有任何警告。这是真实的生产事故形状。
  `const` 只能是编译期可求值的基元类型/string/null。
- `readonly` 是**运行时常量**:字段只能在声明处或构造函数里赋值,值在运行时读取,
  所以改了库的值,引用方重新加载新版本 DLL 就生效。任何类型都可以。
实践规则:**跨程序集边界的公开常量用 `static readonly`,`const` 留给真正永不改变的东西**
(数学常数、协议里写死的魔数)。
另一个必须说清的边界:`readonly` 修饰的引用类型字段,**只是引用不可变,对象内容照样可以改**。
`private readonly List<int> _items;` 不能被重新指向另一个 list,但 `_items.Add(1)` 完全合法。
要真正只读得用 `IReadOnlyList<T>` 或 `ImmutableList<T>`。

**`==` vs `Equals`(高频且容易答半对)。**
- `Equals` 是 `object` 上的**虚方法**,运行时按对象的实际类型分派。
- `==` 是**静态的运算符重载**,在**编译期**根据变量的**静态类型**决定调用哪个实现。
这个差别制造了两个经典陷阱:
1. **泛型里的 `==`**:`bool Same<T>(T a, T b) => a == b;` 在没有约束的情况下,
   编译器只知道 T 是 object,于是用引用比较。哪怕你传两个内容相同的 string,结果也可能是 false。
   所以泛型比较要用 `EqualityComparer<T>.Default.Equals(a, b)`。
2. **object 变量装着 string**:`object a = "he" + s; object b = "hell" + t;`(运行时拼出的相同字符串),
   `a == b` 是引用比较(false),`a.Equals(b)` 是内容比较(true)。
   编译期类型是 `object` 就走 object 的 `==`,哪怕运行时里面装的是 string。
默认值也不同:值类型的 `Equals` 默认逐字段比较(但 struct 的默认实现走反射,慢,所以值得手写重写);
引用类型的 `Equals` 默认是引用比较,除非被重写(string、record 都重写了)。
还有 `ReferenceEquals(a, b)`,永远是引用比较,用来绕开所有重载。

**顺带一个常被问到的收尾:值类型能为 null 吗。**
`int` 不能,`int?` 能,因为 `Nullable<T>` 是一个 struct,里面装着 `HasValue` 和 `Value`。
装箱一个 `HasValue == false` 的 `int?`,得到的是**真正的 null 引用**而不是一个装着 false 的盒子,
这是运行时对 `Nullable<T>` 的特殊处理。

### 卡片素材(手动录入用)

**cs-misc-001**
- Q: 接口和抽象类,你按什么判据选?不要答"接口能多实现"。
- A: 按它们回答的问题选:接口回答"你能做什么",是能力契约,不带状态和实现,让毫无血缘的类型能被同样对待(IDisposable 就是这样:文件、连接、锁都能被 using)。抽象类回答"你是什么",可以有字段、构造函数和模板方法,用于共享实现。默认用接口做依赖注入的契约,只有确实要共享状态和实现骨架时才上抽象类。
- 难度: d1
- EN: Interfaces express capability contracts across unrelated types, abstract classes express identity plus shared implementation.

**cs-misc-002**
- Q: 给一个已发布的接口加一个新成员,和给一个已发布的抽象类加一个虚方法,后果一样吗?
- A: 不一样。给抽象类加虚方法是安全的:已有子类自动继承基类实现,什么都不用改。给接口加成员会**破坏所有已有实现者**,它们全部编译失败。C# 8 的默认接口方法正是为了解决这个版本演化问题,让新成员带一个默认实现从而不破坏现有实现者,但接口依然不能有实例字段和构造函数,所以它不等于抽象类。
- 难度: d2
- EN: Adding a virtual member to an abstract class is source-compatible, while adding an interface member breaks every implementer unless it has a default implementation.

**cs-misc-003**
- Q: 泛型方法里不加约束,你能对 `T` 做什么?约束真正解锁了什么?
- A: 几乎只能当 object 用:赋值、传递、调用 object 上的成员。约束是在告诉编译器"T 至少满足什么",从而解锁对应的调用:`where T : new()` 让你能 `new T()`,`where T : IComparable<T>` 让你能调 CompareTo,`where T : struct` 让你知道它不可能为 null。约束还是 API 设计的表达工具:要求写在签名上,错误在编译期就被挡住。
- 难度: d1
- EN: Without constraints T is effectively object; a constraint tells the compiler what T guarantees and unlocks exactly those members.

**cs-misc-004**
- Q: `const` 和 `static readonly` 的区别,在**跨程序集**的场景下会造成什么真实事故?
- A: const 是编译期常量,编译器把值直接内联进每个使用点。所以库里改了一个 public const,所有引用它的程序集必须重新编译,否则它们带着旧值继续运行,而且没有任何警告。static readonly 是运行时读取的,换个新版 DLL 就生效。规则是跨程序集边界的公开常量用 static readonly,const 只留给真正永不改变的东西,比如数学常数或协议里写死的魔数。
- 难度: d2
- EN: const is inlined into every consuming assembly at compile time, so changing it silently leaves stale values behind unless everything is recompiled.

**cs-misc-005**
- Q: `private readonly List<int> _items;` 里的 list 能被修改吗?
- A: 能。readonly 只保证**这个字段不能被重新指向另一个对象**,对象内部的状态完全不受保护,`_items.Add(1)` 合法,`_items.Clear()` 也合法。要真正暴露一个只读集合得用 IReadOnlyList 作为公开类型,或者用 ImmutableList 保证真的不可变。把 readonly 当成"内容不可变"是很常见的误解,也是暴露内部集合导致封装被破坏的根源。
- 难度: d0
- EN: readonly freezes the reference, not the object, so the list contents remain fully mutable.

**cs-misc-006**
- Q: `==` 和 `Equals` 在**分派方式**上有什么本质区别?
- A: Equals 是 object 上的虚方法,按运行时的实际类型分派;`==` 是静态的运算符重载,编译器按变量的**静态类型**在编译期就决定调用哪一个。所以同一对对象,通过不同静态类型的变量比较可能得到不同结果。这个差别不是风格问题,它直接制造了泛型比较和 object 变量比较两个经典陷阱。
- 难度: d2
- EN: Equals is virtual and dispatched at runtime, while == is a static overload resolved at compile time from the declared type.

**cs-misc-007**
- Q: ```object a = string.Concat("he", "llo"); object b = string.Concat("hel", "lo"); Console.WriteLine(a == b); Console.WriteLine(a.Equals(b));``` 输出什么?为什么?
- A: 输出 False 然后 True。两个变量的静态类型是 object,所以 `==` 绑定的是 object 的引用比较,而这两个字符串是运行时拼出来的,不是同一个实例,也不会被自动 interning,所以 False。`a.Equals(b)` 是虚调用,运行时分派到 string 重写的 Equals,做内容比较,所以 True。把变量改成 string 类型,`==` 会绑定到 string 的重载,两个都是 True。
- 难度: d3
- EN: With object-typed variables == binds to reference equality at compile time, while Equals dispatches virtually to string's value comparison.

**cs-misc-008**
- Q: 写一个泛型方法比较两个 `T` 是否相等,直接写 `a == b` 有什么问题?正确写法是什么?
- A: 问题是在没有约束时编译器只知道 T 是 object,`==` 绑定成引用比较,两个内容相同的 string 或两个相等的 record 都会得到 false。正确写法是 `EqualityComparer<T>.Default.Equals(a, b)`,它在运行时选择 T 实现的 IEquatable 或重写的 Equals,值类型还能避免装箱。这也是 List 和 Dictionary 内部使用的机制。
- 难度: d2
- EN: In an unconstrained generic, == falls back to reference equality, so I use EqualityComparer<T>.Default.Equals instead.

**cs-misc-009**
- Q: `int?` 是什么类型?把一个没有值的 `int?` 装箱,得到的是什么?
- A: `int?` 是 `Nullable<int>`,它本身是一个 struct,内部装着 HasValue 和 Value,所以值类型仍然没有 null。装箱一个 HasValue 为 false 的 `int?`,得到的是**真正的 null 引用**,而不是一个装着 false 的盒子:运行时对 Nullable 做了特殊处理,让它装箱后的行为符合直觉。这也是为什么可以把 `int?` 赋给 object 再判 null。
- 难度: d2
- EN: int? is the struct Nullable<int>, and boxing one without a value produces an actual null reference rather than a boxed wrapper.

---

## 附:难度分布核对

| 难度 | 张数 | 占比 | 目标 |
|---|---|---|---|
| d0 | 6 | 8% | |
| d1 | 48 | 60% | d0-d1 合计 ~70% |
| d2 | 19 | 24% | ~22% |
| d3 | 7 | 9% | d3-d4 ~8% |
| **合计** | **80** | | |

7 张 d3 是:ValueTask 的使用约束、`.Result` 死锁的两层解释(旧 ASP.NET 的上下文环 +
ASP.NET Core 的线程池饥饿)、`Task.WhenAll` 的异常聚合、EF Core 3.0 停止静默客户端求值、
exception filter 在栈展开之前求值、你自己的 6-CTE 单语句摄入、
以及 `object` 静态类型下 `==` 的编译期绑定输出题。
判据统一是:**答对它说明你真的懂这个子系统,而不是记住了一句话。**

有意没给 d4:d4 应该留给你**自己代码里独有的、别人问不出来的**决策
(per-column LWW 与 greatest 的算子选择、keyset 游标的微秒余数、90 天上界不变量)。
那些属于 `csharp-deck-design.md` 里的"模块八:你自己的后端",不是通用基础概念,
硬塞进这份基础文档会稀释它们的分量。

## 附:录入与复习节奏

- 一晚一个模块(8-12 张),配当天复习。**改写 A 是录入流程的一部分,不是可选项。**
- 模块 7(ASP.NET Core)建议**最先录**:它是你经验最薄、面试权重最高的一块,
  而且它的每个概念你都能在自己的 Lambda 里找到对应物,录卡时顺手把对应关系写进你的版本。
- 模块 6 的卡里多次出现你自己的代码(6-CTE、event_id 幂等、outbox、version+1)。
  这些卡录完就等于写好了面试里"讲一个你做过的技术决策"的现成答案,建议排第二批。
- 哪张卡复习时觉得"问得不对",第二天就改。你是这副卡组的第一个用户,也是唯一的编辑。
