# 支柱三:云(AWS + Azure 对照)

> **卡片是"素材",不是"成品"。**
> 录入 Anki/RecallSmith 时,鼓励你用自己的话重写 A 面。重写这个动作本身就是学习:
> 你能不能不看原文把推理链条讲回来,就是这张卡该不该留的唯一标准。
> A 面写不出来的,说明 `### 概念讲解` 那段你还没读透,回去再读一遍再录。

---

## 这份材料怎么定位你

你的独特位置:**两朵云都真跑过生产**。

- AWS 侧:recallsmith 的三个 Lambda(`src_C/Public`、`src_C/Vpc`、`src_C/Worker`),
  RDS PostgreSQL,SQS(`PUBLISH_JOB_QUEUE_URL`),S3 内容分发,API Gateway。
  再加上 Dovetale 实习那三个月的 Node.js Lambda:S3 触发的 ML 视频流水线、SQS 到 SageMaker、DLQ 重处理与失败恢复。
- Azure 侧:Reply In My Voice 的 Azure Functions + Service Bus + Azure SQL(EF Core、Stripe 幂等计费、
  transactional outbox、health-gated CI/CD)。

大部分 intermediate 候选人只会一朵云,而且是"用过控制台"级别。
你的答题优势不是"我会 AWS",而是**"我能说出两朵云在同一个问题上的设计取舍不一样在哪"**。
面试官听到这个,会立刻把你从"背文档的"挪到"真做过的"那一栏。

所以全文用对照法组织:先给一句话 mental model,再讲两边怎么解,再讲什么时候坏。
每模块开头一张 AWS ↔ Azure 对照小表,那张表就是你面试时脑子里该有的索引。

**诚实标注:** 第 7 模块的 IaC(Terraform/Bicep)是你的真实 gap。文里会写清"概念要懂、实操要承认",
面试时照实说比编强,转行者被抓到编造是致命的,承认 gap 并说出你怎么补反而加分。

---

## 1. 身份与权限(IAM ↔ Entra / Managed Identity)

| 概念 | AWS | Azure |
| --- | --- | --- |
| 身份目录 | IAM(账号内) | Microsoft Entra ID(前 Azure AD,租户级) |
| 服务自带身份 | IAM Role + 信任策略(trust policy) | Managed Identity(system-assigned / user-assigned) |
| 权限描述 | Policy(JSON:Effect/Action/Resource/Condition) | RBAC 角色分配(role definition + scope) |
| 授权模型 | 默认拒绝,显式 Allow,显式 Deny 一票否决 | 默认拒绝,Allow 累加,Deny assignment 优先 |
| 生效范围 | 附在 identity 上或 resource policy 上 | 分配在 scope 上(订阅 / 资源组 / 单资源),向下继承 |
| 密钥托管 | Secrets Manager / SSM Parameter Store | Key Vault |
| 临时凭证 | STS AssumeRole,短期 token | Managed identity 换 token(VM 上走 IMDS,App Service / Functions 走注入的 `IDENTITY_ENDPOINT`),自动轮转 |

### 概念讲解

**Mental model:** 权限不是"给某个人一把钥匙",而是"给某个**运行中的东西**一个身份,再声明这个身份在哪些资源上能做哪些动作"。
钥匙(access key)是你要消灭的东西,身份(role / managed identity)是你要留下的东西。

这一点你在 AWS 侧其实已经做对了,只是可能没用这套词讲过:
recallsmith 的 Worker Lambda 从没在代码里出现 AWS access key,它读 S3、收 SQS,靠的是执行角色(execution role)。
Lambda 运行时把角色换来的临时凭证注入到环境里,SDK 自动捡起来。

Azure 侧的等价物是 **managed identity + Key Vault**:Function App 打开 managed identity 之后,
运行时会注入一个 `IDENTITY_ENDPOINT` 和一个 header 密钥,SDK(`DefaultAzureCredential`)用它换一个 Entra token,
过期自动换新,应用里同样不需要出现任何长期密钥。
**诚实提醒:如果你的 Reply In My Voice 目前是把连接串和 Stripe key 放在应用设置(app settings)里,
面试时就照实说"目前走应用设置,我知道标准做法是 managed identity 加 Key Vault,理由是 X"**,
这比含糊地暗示自己配过 Key Vault 安全得多,而且理由讲得出来一样加分。
**两边解的是同一个问题:让凭证不落盘、不进 Git、能自动轮转、能被审计到"是哪个服务干的"。**

**为什么 AWS 要有"信任策略"这个东西。**
IAM Role 有两半:一半是"这个角色能干什么"(permission policy),另一半是"谁能变成这个角色"(trust policy)。
新手常常只看前半,然后遇到 `AssumeRole` 被拒绝一头雾水。
Azure 没有这个二分,因为 managed identity 天然绑死在一个资源上,不存在"谁能扮演它"的问题:
它就是那台机器/那个 Function App。**代价是灵活性:AWS 的跨账号 assume role 在 Azure 侧要靠多租户应用注册去凑,笨得多。**

**Policy 的求值顺序(AWS,必须能背):**
1. 默认拒绝。
2. 有显式 `Deny` -> 拒绝,后面不用看了。
3. 有显式 `Allow` 且没有 Deny -> 允许。
所以 AWS 里"加个 Allow"永远解决不了被 Deny 挡住的问题,SCP(组织级)或 boundary 里的一条 Deny 能让你在自己账号里怎么加权限都没用。
Azure 的对应物是 deny assignment(常见于 Blueprint/managed app),同样优先于 role assignment。

**最小权限的实操思维方式,不是背口号:**
- 先按**资源**收窄,不是按动作。`s3:GetObject` on `arn:aws:s3:::my-bucket/public/*` 远好于 `s3:*` on `*`。
  recallsmith 的 Worker 只需要往内容桶的特定前缀写,不需要 `s3:DeleteBucket`。
- 再按**条件**收窄:`Condition` 里加 `aws:SourceVpce`、`aws:SecureTransport`、`StringEquals` 到具体的 queue ARN。
- Azure 侧对应:选内置角色时优先选窄的(`Storage Blob Data Reader` 而不是 `Contributor`),
  并且把 scope 钉到具体资源而不是订阅。**一个高频错误:给了 `Contributor` 以为能读 Blob 数据,其实读不了。**
  这是 Azure 的一个真实坑:control plane 权限(管理资源)和 data plane 权限(读写数据)是分开的,
  `Contributor` 能删掉整个 storage account,却没有 `Storage Blob Data Reader` 的读数据权限。

**什么时候坏 / 常见误解:**
- **误解一:"我给 Lambda 加了 policy 就能访问 S3 了"。** 如果桶上还有 bucket policy 显式 Deny,或者桶在别的账号,
  跨账号访问要**两边都 Allow**(身份侧 + 资源侧)。
- **误解二:"权限报错就是 policy 写错了"。** VPC 里的 Lambda 访问 S3,权限对但没有 VPC endpoint / NAT,
  报的是超时不是 AccessDenied,但很多人第一反应去改 policy。见第 6 模块。
- **误解三:"Key Vault 里存了就安全了"。** 谁能读 Key Vault 才是关键。如果 Function 的 managed identity 有 `Key Vault Secrets User`,
  但你同时把订阅级 `Owner` 发给了半个团队,那 secret 等于公开的。
- **轮转的边界:** 临时凭证会过期。这在预签名 URL 上会直接咬你,见第 3 模块那张 d3 卡。

### 卡片素材(手动录入用)

- **Q:** 为什么"在代码里读环境变量拿 AWS access key"这种做法在 Lambda 上不但不必要,而且是降级?
  **A:** 因为 Lambda 已经有执行角色,运行时会注入自动轮转的临时凭证,SDK 默认就能捡到。
  手写长期 key 等于:凭证会进 Git 或进环境变量快照、不会自动过期、泄露后无法快速失效、
  审计日志里看到的是那把 key 而不是"哪个函数"。用角色是把凭证生命周期交给平台管。
  **难度:** d1
  **EN:** "The function already has an execution role, so the SDK picks up rotating temporary credentials; hard-coded keys are strictly worse."

- **Q:** AWS 里同时存在 Allow 和 Deny 时结果是什么?这对"我加个 policy 就能修好"这种直觉有什么影响?
  **A:** 显式 Deny 永远赢,求值顺序是"默认拒绝 -> 有 Deny 就拒 -> 否则看 Allow"。
  所以如果组织 SCP 或 permission boundary 里有一条 Deny,你在账号里加多少 Allow 都没用,
  排查方向应该是往上找 Deny 来源(SCP、boundary、resource policy),而不是继续堆权限。
  **难度:** d1
  **EN:** "An explicit Deny always wins, so if a boundary or SCP denies it, adding more Allow statements changes nothing."

- **Q:** IAM Role 的 trust policy 和 permission policy 分别回答什么问题?为什么 Azure managed identity 没有这个二分?
  **A:** trust policy 答"谁可以扮演这个角色",permission policy 答"扮演之后能干什么"。
  Azure managed identity 天生绑定在某个资源上(那个 Function App 就是它),不存在"被谁扮演"的问题,
  所以只需要 RBAC 角色分配这一半。代价是跨账号/跨租户委派没有 AWS 的 AssumeRole 那么直接。
  **难度:** d2
  **EN:** "A role has two halves: who may assume it, and what it can do once assumed."

- **Q:** Azure 里给了 `Contributor` 却读不到 Blob 内容,为什么?
  **A:** 因为 Azure 把 control plane 和 data plane 权限分开了。`Contributor` 是管理面权限(能创建、能删除整个 storage account),
  但读写 blob 数据需要数据面角色,比如 `Storage Blob Data Reader` / `Data Contributor`。
  这也是个安全性论点:一个能删库的身份,不一定能看库里的内容。
  **难度:** d2
  **EN:** "Azure separates control-plane from data-plane permissions: Contributor can delete the account but still cannot read the blobs."

- **Q:** 最小权限落地时,先收窄"动作"还是先收窄"资源"?为什么?
  **A:** 先收窄资源。`s3:*` on 一个具体前缀,通常比 `s3:GetObject` on `*` 危害小得多,
  因为爆炸半径是由"能碰到哪些东西"决定的,不是由"能做哪几个动词"决定的。
  收完资源再收动作,最后用 Condition(来源 VPC endpoint、要求 TLS、限定具体 queue ARN)封边。
  **难度:** d1
  **EN:** "Scope by resource first: blast radius is defined by what it can touch, not by how many verbs it has."

- **Q:** 跨账号访问 S3 桶时,只在读方的 IAM role 上加 Allow 够不够?
  **A:** 不够。跨账号需要两边都放行:读方身份的 policy 要 Allow,桶的 resource policy(bucket policy)也要 Allow 那个 principal。
  同账号内只需要身份侧 Allow(因为资源默认信任同账号 IAM),这正是很多人"同账号能跑、跨账号报 AccessDenied"的原因。
  **难度:** d3
  **EN:** "Cross-account access needs both sides to allow it: the caller's identity policy and the bucket's resource policy."

- **Q:** Key Vault / Secrets Manager 相比"把连接串塞进应用配置"具体多买到了什么?
  **A:** 买到四件事:secret 不进代码仓库和构建产物;访问是有身份、有审计日志的;
  可以轮转而不用重新部署应用;可以按环境用不同的访问策略。
  它没买到的是:如果读 secret 的身份权限过宽,或者你把 secret 读出来后打进日志,那还是漏。
  **难度:** d1
  **EN:** "A vault buys you rotation, auditability and no secrets in the repo; it does not save you if the identity reading it is over-privileged."

- **Q:** 面试官问"你怎么做 secrets management",你怎么用两朵云的经历答出深度?
  **A:** 先说模式而不是产品:身份优先,secret 次之。我的 AWS 侧 Lambda 就是这样,用执行角色直接拿 S3 和 SQS 的权限,
  代码里没有任何 access key;只有真正的第三方密钥(支付、AI provider key)才需要一个 secret 存储。
  Azure 侧的等价做法是 managed identity 加 Key Vault,让应用连 secret 都不用自己保管。
  然后补一句边界:secret 轮转后应用要能不重启地拿到新值,否则轮转只是纸面上的。
  自己还没落地的那一半照实说,别把"知道该怎么做"讲成"我做过"。
  **难度:** d1
  **EN:** "Identity first, secrets second: most access should need no secret at all, and what remains lives in a vault behind a managed identity."

---

## 2. 计算光谱(EC2/App Service ↔ Lambda/Functions)

| 概念 | AWS | Azure |
| --- | --- | --- |
| 常驻虚机 | EC2 | Virtual Machines |
| 托管应用平台 | Elastic Beanstalk / App Runner / ECS | App Service |
| 容器编排 | ECS / EKS / Fargate | AKS / Container Apps |
| 函数 | Lambda | Azure Functions |
| 单实例并发 | **1 个请求 / 实例**(强制) | **多请求 / 实例**(host 级并发) |
| 冷启动缓解 | Provisioned Concurrency、SnapStart | Premium 计划 always-ready 实例、预热 |
| 计费单位 | GB-秒 + 请求数 | GB-秒 + 执行次数(含免费额度) |
| 超时上限 | Lambda 最长 15 分钟 | Consumption 默认 5 分钟(可调,有上限);Premium 可长跑 |

### 概念讲解

**Mental model:** 计算是一条光谱,不是二选一。
一头是"我租一台机器,它一直在,空转也花钱,但我什么都能控制"(EC2 / VM);
另一头是"我交一个函数,平台在有请求时才给我 CPU,没请求就不花钱,但我几乎控制不了机器"(Lambda / Functions)。
中间是 App Service / ECS / Container Apps:常驻或半常驻,给你进程模型但不给你运维机器。
**选型问题永远是同一个:我的流量形状是什么,以及我需要多少控制权。**

recallsmith 三个 Lambda 就是典型的尖峰型流量:用户不是 24 小时在复习,发布任务也是偶发的。
常驻一台 EC2 跑 API 意味着 90% 的时间在为空转付钱。这是 serverless 在这个场景对的原因,不是因为 serverless 时髦。

**冷启动到底是什么。**
冷启动 = 平台要为你新建一个执行环境:下载代码包、启动运行时(.NET 8 的 CLR)、跑你的静态构造/启动路径、再执行 handler。
之后这个环境会被复用一段时间(热实例),所以第二次调用只花 handler 的时间。

你在 recallsmith 里其实已经动过这一层:`src_C/Vpc/SnapStartHooks.cs` 注册了
`SnapshotRestore.RegisterBeforeSnapshot` 和 `RegisterAfterRestore`。
SnapStart 的原理是:平台在你发布版本时**预先初始化一次并给内存拍快照**,之后冷启动是"从快照恢复"而不是"从零初始化"。
但快照带来一个必须自己处理的问题:**快照里的东西会被复制到很多个实例上**。
数据库连接、HTTP client、随机种子、缓存的时间戳,这些在快照里都是陈旧或不该共享的。
所以你的 hook 里做的正是正确的事:`Pg.Reset()`、`Publish.Reset()`、`OutboxPublisher.Reset()` 等一串重置,
把有状态的资源在拍快照前和恢复后都清掉。**这是一道很好的面试素材:能讲清"为什么 SnapStart 需要 hook"的人不多。**

Azure 侧对应的不是快照,而是"保留热实例":Premium 计划的 always-ready instances 让你为常驻的一小撮实例付钱,
其余按需扩。思路不同(AWS 让冷启动变快,Azure 让冷启动变少),但目标一样。

**并发模型是两朵云最大的隐性差异,也是你 MaxPoolSize 那题的答案来源。**
- **Lambda:一个执行环境同一时刻只处理一个请求。** 要并发 100,就有 100 个执行环境。
- **Azure Functions:一个实例(host)可以同时处理多个调用。** 触发器有各自的并发上限配置(比如 Service Bus 的 `maxConcurrentCalls`)。

**为什么你的 `PG_MAX` 默认 1 是对的。**
看 `src_C/Vpc/Db/Pg.cs`:`MaxPoolSize = max`,而 `max` 在没有 `PG_MAX` 环境变量时默认取 1。
推理链条是这样的:

1. 一个 Lambda 执行环境同一时刻只跑一个请求,所以它**同时最多需要一条数据库连接**。
2. 把 MaxPoolSize 设成 10,不会让单个请求变快(它也只用一条),
   只会让这个实例在流量抖动后**留着最多 10 条空闲连接**。
3. Lambda 并发是横向扩的:峰值 50 个并发就是 50 个实例。
   MaxPoolSize=10 时最坏情况是 500 条连接打向 RDS;MaxPoolSize=1 时是 50 条。
4. RDS PostgreSQL 的 `max_connections` 是按实例规格来的,小规格可能就一两百。
   **连接耗尽的表现不是"慢",是新连接直接被拒,整个 API 一起挂。**
5. 所以在"每实例并发=1"的模型下,池大小 1 是**信息论上正确**的:池的作用退化为"跨调用复用同一条连接",
   这正是你还开着 `Pooling = true` 和 `ConnectionIdleLifetime` 的原因,复用有价值,多余的槽位没有。

**反过来,这条结论在 Azure Functions 上就不成立**:那里一个实例并发处理多个调用,池大小 1 会让调用互相排队,
把并发变成串行。同一个"正确"在两朵云上是不同的数字,这就是对照法的价值。

**这个问题真正的行业解是 RDS Proxy(AWS)或连接池中间件**:
它在 Lambda 和数据库之间维护一个共享池,把 N 个短命实例的连接需求收敛成少量长连接。
面试时你说完 MaxPoolSize=1,补一句"规模再上去就该上 RDS Proxy",档次立刻不一样。

**什么时候坏 / 常见误解:**
- **误解:"serverless 没有服务器,所以不用想扩容"。** 你仍然要想下游:数据库连接数、
  第三方 API 的速率限制、SQS 消费的并发。**serverless 把扩容问题从"我的机器"推给了"我依赖的东西"。**
- **误解:"冷启动是 serverless 的致命伤"。** 对于异步/队列驱动的负载(比如你的 Worker Lambda)冷启动几乎无所谓,
  它只对同步的、面向用户的 p99 有意义。分清同步和异步再谈冷启动,是成熟度的信号。
- **超时边界:** Lambda 最长 15 分钟。你的发布任务如果会长过这个,正确解不是调大超时,是拆成多条消息或改用 Step Functions / 容器任务。
- **静态状态的坑:** 执行环境会被复用,所以静态字段会跨请求存活。这既是好事(连接复用、配置缓存),
  也是 bug 源(把上一个用户的上下文缓存进静态变量)。SnapStart 把这个坑放大了一个量级。

### 卡片素材(手动录入用)

- **Q:** 为什么 recallsmith 的 Lambda 里 `MaxPoolSize` 默认设成 1 是对的,而不是"太小了"?
  **A:** 因为一个 Lambda 执行环境同一时刻只处理一个请求,所以它同时最多需要一条连接。
  池开大不会让单请求变快,只会在扩到 N 个实例时把连接数放大 N 倍打向 RDS,
  而 RDS 的 max_connections 一耗尽就是整站拒连接。池仍然开着(Pooling=true)是为了跨调用复用同一条连接。
  **难度:** d2
  **EN:** "One Lambda instance serves one request at a time, so a pool size of one is exactly right; anything larger just multiplies idle connections against the database."

- **Q:** 同样是 MaxPoolSize=1,为什么放到 Azure Functions 上就是个 bug?
  **A:** 因为 Azure Functions 的一个实例可以并发处理多个调用(host 级并发,触发器有 maxConcurrentCalls 之类的配置),
  池只有 1 条连接会让并发调用互相排队,把并发退化成串行。
  这说明"正确的池大小"不是常识数字,而是从"单实例并发度"推出来的。
  **难度:** d3
  **EN:** "On Azure Functions a single instance handles many concurrent invocations, so a pool of one serialises them."

- **Q:** 冷启动具体包含哪几步?为什么它对队列 Worker 的影响远小于对用户 API 的影响?
  **A:** 冷启动 = 新建执行环境:拉代码、起运行时、跑初始化路径、再执行 handler,之后实例被复用。
  队列 Worker 是异步的,用户不在等它,多花几百毫秒没人感知;
  同步 API 的冷启动直接进 p99 延迟,用户看得见。所以谈冷启动前先分清同步还是异步。
  **难度:** d1
  **EN:** "Cold start only hurts where a user is waiting; for a queue worker it is invisible."

- **Q:** SnapStart 为什么必须提供 before-snapshot / after-restore 钩子?不写会出什么事?
  **A:** 因为 SnapStart 是把初始化后的内存拍成快照,再把同一份快照复制到很多实例上。
  快照里的数据库连接、HTTP client、随机数种子、缓存的时间戳会被跨实例共享或已经失效。
  所以要在拍快照前重置有状态资源、恢复后重新建立,recallsmith 的 SnapStartHooks 里那串 Reset() 就是干这个的。
  不写的表现是诡异的:连接失效、多个实例拿到同样的"随机"值。
  **难度:** d3
  **EN:** "SnapStart clones one initialised memory image across instances, so anything stateful, connections and seeds, must be reset around the snapshot."

- **Q:** AWS 和 Azure 缓解冷启动的思路差在哪?
  **A:** AWS 偏"让冷启动变快":SnapStart 从快照恢复,Provisioned Concurrency 预先建好执行环境。
  Azure 偏"让冷启动变少":Premium 计划的 always-ready 实例常驻一小批,超出部分再弹。
  两者都要为"不被使用的容量"付钱,所以都是把 serverless 的成本模型往常驻方向拉回一点。
  **难度:** d1
  **EN:** "AWS makes cold starts faster, Azure keeps a few instances always ready; both trade some pay-per-use back for latency."

- **Q:** 什么情况下你会主动放弃 Lambda 改用容器或常驻实例?
  **A:** 三种:单次工作超过 15 分钟上限;流量足够平稳到常驻更便宜(serverless 的溢价在高稳定负载下会翻过来);
  需要 Lambda 给不了的控制权(长连接、WebSocket 服务端、特殊运行时、GPU、需要本地大缓存)。
  反过来,尖峰型、偶发型、事件驱动型仍然是 serverless 的主场。
  **难度:** d1
  **EN:** "I move off Lambda when the work exceeds the timeout, when traffic is flat enough that always-on is cheaper, or when I need control Lambda cannot give."

- **Q:** Lambda 的静态字段(比如缓存的连接、配置)会跨请求存活吗?这带来什么好处和什么 bug?
  **A:** 会。执行环境被复用,所以静态状态在同一实例的多次调用间存活。
  好处是连接复用、配置只解析一次,这正是 Pg 里缓存 DataSource 的原因。
  bug 是把请求级/用户级上下文缓存进静态变量,下一个用户会读到上一个人的数据。
  规则:静态里只放"对所有请求都一样"的东西。
  **难度:** d1
  **EN:** "Execution environments are reused, so static state survives between invocations: great for connections, dangerous for anything user-scoped."

- **Q:** "serverless 不用考虑扩容"错在哪?
  **A:** 错在它只把"我的机器"这一层的扩容外包了,没有外包下游。
  你的函数能瞬间扩到几百并发,但数据库连接数、第三方 API 的 rate limit、下游服务的容量不会跟着扩。
  实际结果常常是:函数扩得越顺,下游挂得越快。所以 serverless 架构里必须显式给并发设上限(reserved concurrency 之类)。
  **难度:** d1
  **EN:** "Serverless outsources scaling of my compute, not of my dependencies; the database is usually the thing that breaks first."

---

## 3. 存储(S3 ↔ Blob Storage)

| 概念 | AWS | Azure |
| --- | --- | --- |
| 对象存储 | S3(bucket / key) | Blob Storage(account / container / blob) |
| 一致性 | 强一致(read-after-write,2020 年底起) | 强一致 |
| 临时访问 URL | Presigned URL(用签名者的凭证签) | SAS token(account key SAS / user delegation SAS) |
| 分层 | Standard / IA / Glacier | Hot / Cool / Cold / Archive |
| 生命周期 | Lifecycle policy | Lifecycle management policy |
| 静态网站 | S3 website endpoint 或 S3 + CloudFront(OAC) | Static website($web 容器)或 Static Web Apps + Front Door |
| 版本管理 | Versioning | Blob versioning / snapshots |
| 事件通知 | S3 Event Notification -> Lambda/SQS/SNS | Event Grid -> Function |

### 概念讲解

**Mental model:** 对象存储不是文件系统,是一个**巨大的、只能整体读写的 key-value 字典**,
value 可以很大(GB 级),key 长得像路径但目录是假的。
"假目录"这件事有实际后果:没有"重命名文件夹"这个原子操作,改前缀等于把每个对象复制一遍再删。

recallsmith 用 S3 做内容分发:Worker 生成的 manifest 和牌组内容写进 S3,客户端去拉。
这是对象存储最正统的用法:**写少读多、内容不可变、体积不适合塞进数据库。**

**一致性:一个必须更新的旧知识。**
2020 年 12 月之前,S3 的覆盖写和删除是最终一致的,所以老文章会告诉你"写完立刻读可能读到旧的"。
**现在 S3 对所有对象操作提供强的 read-after-write 一致性,Azure Blob 一直是强一致的。**
面试时说错这个会显得知识陈旧,但反过来,知道"曾经不是,现在是"比只知道现状更能证明你读过东西。

**注意边界:强一致说的是对象本身,不包括**:
- **List 操作**在某些情况下仍可能有延迟感知(尤其配合版本管理时);
- **CDN 缓存**:CloudFront 或 Front Door 缓存了旧版本,S3 强一致救不了你,要靠 invalidation 或改 key。
  这对你的内容分发直接相关:**内容更新用新 key(内容寻址 / 版本号)通常比 invalidate 缓存更可靠也更便宜。**

**预签名 URL / SAS:为什么需要,以及它到底是什么。**
问题:客户端要下载一个私有对象,你不想给客户端 AWS 凭证,也不想让流量绕经你的 Lambda(贵、慢、有 6MB 响应上限)。
解法:服务端用自己的凭证**签一个带过期时间的 URL**,客户端直接对着 S3 用。
你的 `src_C/Vpc/Runtime/PremiumDeckUrl.cs` 里的 `GetPreSignedURL` 就是这条路:
Lambda 校验完用户的 premium 状态,再签一个短期 URL 给他,内容字节从不经过 Lambda。

**关键性质,也是最容易答错的地方:**
- 预签名 URL **不是新凭证,是对签名者已有权限的一次转授**。如果签名的角色没有 `s3:GetObject`,签出来的 URL 也是废的。
- **URL 的有效期受签名者凭证有效期约束。** Lambda 用的是角色换来的临时凭证,
  一旦这套临时凭证过期,用它签出的 URL 也随之失效,哪怕你把 expiry 设成 7 天。
  这是个很好的 d3 题:很多人以为设 7 天就是 7 天。
- **预签名 URL 一旦发出就无法单独撤销**(除非改权限/删对象/换 key)。
  Azure 的 SAS 在这点上更好一点:配合 **stored access policy** 的 SAS 可以通过改策略来集中撤销,
  **user delegation SAS**(用 Entra 身份签,而不是 account key 签)还能被身份层面吊销,并且不需要到处散布 account key。
  **"永远优先 user delegation SAS 而不是 account key SAS"是 Azure 侧一个很值钱的观点。**

**静态托管:** S3 直接开 website endpoint 简单但只有 HTTP、没有现代 TLS 和自定义域的完整能力,
生产做法是 S3(私有)+ CloudFront + OAC(Origin Access Control),让只有 CDN 能读桶。
Azure 侧对应是 Static Website 特性或 Static Web Apps,前面挂 Front Door。
共同的原则:**桶永远私有,公开的是 CDN。**

**什么时候坏 / 常见误解:**
- **误解:"S3 慢是因为网络"。** 大量小对象的 List 和逐个 GET 才是慢的主因,
  合并成更少更大的对象(比如你的 manifest 思路)几乎总是更快更便宜。
- **误解:"公开桶最省事"。** 公开桶是数据泄露头号来源。私有 + 预签名 / CDN 是默认答案。
- **误解:"对象存储可以当数据库用"。** 没有事务、没有条件更新的传统印象要小心措辞:
  S3 现在支持条件写(If-None-Match)之类的原语,但它仍然不是支持多对象事务的数据库。
  需要"读改写并保证不丢更新"的场景,放数据库里。
- **成本坑:** 跨区域/出网流量费、频繁 List、以及把 IA/Archive 层的对象反复取回(有取回费和最短存储期)。

### 卡片素材(手动录入用)

- **Q:** 预签名 URL 到底给了客户端什么?如果签名的角色本身没有读权限,会发生什么?
  **A:** 它给的是"签名者权限的一次限时转授",不是一套新凭证。
  签名者没有 s3:GetObject,签出来的 URL 用起来照样是 AccessDenied。
  正确的心智:URL 里带的是"某个有权限的身份在某时刻同意了这次访问"的签名,不是权限本身。
  **难度:** d1
  **EN:** "A presigned URL delegates the signer's existing permission for a limited time; it does not create new permission."

- **Q:** 在 Lambda 里签一个有效期 7 天的 S3 预签名 URL,实际能用 7 天吗?
  **A:** 通常不能。Lambda 用的是执行角色换来的临时凭证,预签名 URL 的实际有效期不会超过签名凭证的有效期,
  临时凭证一过期 URL 就失效。要长有效期得用长期凭证签,而那又带来密钥管理问题,
  所以更实际的做法是发短期 URL,并让客户端在需要时回来重新申请。
  **难度:** d3
  **EN:** "A presigned URL cannot outlive the credentials that signed it, so temporary role credentials cap the real expiry."

- **Q:** 为什么内容更新时"写到新 key"通常比"覆盖旧 key 再让 CDN 失效"更好?
  **A:** 因为 S3/Blob 的强一致救不了 CDN 边缘缓存,invalidation 有延迟、有成本、还可能漏。
  写新 key(内容哈希或版本号)让新旧版本共存,客户端拿到新 manifest 就自然指向新内容,
  回滚也只是把 manifest 指回去,而且旧客户端不会读到半新半旧的混合状态。
  **难度:** d2
  **EN:** "Immutable keys make cache invalidation unnecessary and rollback trivial; you just point the manifest somewhere else."

- **Q:** S3 现在的一致性模型是什么?为什么这条知识值得特意更新?
  **A:** 现在是强的 read-after-write 一致性,覆盖写和删除之后也能立刻读到新状态(2020 年底起,Azure Blob 一直如此)。
  值得更新是因为大量教程和面试题还停留在"最终一致,写完可能读到旧值",
  按旧知识设计会引入不必要的重试和 sleep,而按旧知识答题会暴露知识陈旧。
  **难度:** d1
  **EN:** "S3 has been strongly read-after-write consistent since late 2020; a lot of advice about eventual consistency is simply out of date."

- **Q:** Azure 的 user delegation SAS 比 account key SAS 好在哪?
  **A:** user delegation SAS 用 Entra 身份签发,不需要把 storage account key 散布出去,
  权限可以随身份一起被吊销,审计上也能追到具体身份。
  account key SAS 用的是账户主密钥,一旦泄露等于整个存储账户失守,而唯一的止损手段是轮转主密钥,影响面极大。
  **难度:** d2
  **EN:** "A user delegation SAS is signed by an Entra identity, so it can be revoked with that identity instead of rotating the account key."

- **Q:** 生产上做静态站点托管,为什么桶应该保持私有?
  **A:** 因为公开桶是数据泄露的头号来源,而且公开桶没有 CDN 的缓存、TLS、WAF 和访问日志。
  标准做法是桶私有 + CDN(CloudFront 配 OAC / Front Door)读取,公开的只有 CDN 端点。
  这样权限边界只有一条,而不是"每个对象的 ACL 都可能被人手滑改公开"。
  **难度:** d1
  **EN:** "Keep the bucket private and let only the CDN read it; a public bucket is one misconfigured object away from a leak."

- **Q:** 对象存储里为什么没有"重命名文件夹"这个便宜操作?
  **A:** 因为目录是假的,key 只是带斜杠的字符串,不存在真正的树结构。
  改前缀等于把每个对象复制到新 key 再删旧的,成本随对象数线性增长,而且过程不是原子的。
  设计时的推论:key 的命名方案要一次想好,把会变的东西(版本、租户)放在能容忍的位置。
  **难度:** d1
  **EN:** "Folders are an illusion, so renaming a prefix means copying every object; design your key scheme up front."

- **Q:** 什么内容该进对象存储,什么该进数据库?判断标准是什么?
  **A:** 判断标准是访问模式,不是大小。需要查询、连接、事务、按字段过滤的进数据库;
  整体读写、不可变、体积大、按 key 直取的进对象存储。
  recallsmith 的做法就是这个划分:进度事件和合并状态在 Postgres 里(要查询要合并),
  牌组内容和 manifest 在 S3 上(整块取、不查询、走 CDN)。
  **难度:** d1
  **EN:** "Query it, join it, transact on it: database. Fetch it whole by key: object storage."

---

## 4. 队列与消息(SQS ↔ Service Bus)

| 概念 | AWS | Azure |
| --- | --- | --- |
| 基础队列 | SQS Standard(至少一次,尽力有序) | Service Bus Queue(至少一次;PeekLock) |
| 有序 / 去重 | SQS FIFO(message group 内有序,5 分钟去重窗口) | Sessions(会话内有序)+ duplicate detection(可配窗口) |
| 消息"锁" | Visibility Timeout(默认 30 秒,最长 12 小时) | Lock duration(最长 5 分钟,可续锁 RenewLock) |
| 失败隔离 | DLQ(需配 redrive policy + maxReceiveCount) | 内建 dead-letter 子队列(MaxDeliveryCount 默认 10) |
| 发布订阅 | SNS(+ SQS fan-out)/ EventBridge | Service Bus Topic + Subscription / Event Grid |
| 部分失败 | Lambda 的 ReportBatchItemFailures | 逐条 Complete / Abandon |
| 投递语义 | 至少一次(FIFO 在窗口内可近似恰好一次处理) | 至少一次(可选去重逼近一次) |

### 概念讲解

**Mental model:** 队列不是"把消息安全送到",而是**"把生产者和消费者在时间上解耦,并接受重复"**。
你交出的是"消息只处理一次"这个幻觉,换来的是"消费者挂了不丢消息、慢了不拖垮生产者"。
**所有队列的核心难点都在同一句话上:至少一次投递意味着幂等是消费者的责任。**

recallsmith 的形状很标准:`src_C/Vpc/Authoring/Publish.cs` 校验完之后往 `PUBLISH_JOB_QUEUE_URL` 发一条消息,
`src_C/Worker/WorkerFunction.cs` 以 `SQSEvent` 接收,`foreach (var record in sqsEvent.Records)` 逐条处理。
Reply In My Voice 侧是 Service Bus 承担同样角色。

**Visibility timeout / lock:队列最容易讲错的机制。**
消息被消费者取走后**并没有从队列删除**,只是变成"对其他消费者不可见"一段时间(SQS 的 visibility timeout / Service Bus 的 lock)。
- 消费者成功处理 -> 显式删除(SQS DeleteMessage / Service Bus Complete)-> 消息真正消失。
- 消费者崩了或超时没删 -> 可见性到期 -> **消息重新出现,被另一个消费者拿到。**

这就是"至少一次"的机械原因:**队列没法区分"消费者死了"和"消费者还在慢慢做"。**
它只能等到超时就重发。所以:

- **可见性超时必须大于最坏情况的处理时间。** 处理要 60 秒但超时是 30 秒,消息会在你还没做完时被第二个 worker 拿走,
  两个 worker 同时处理同一条,做完还各删一次。这是最经典的"神秘重复"根因。
  用 Lambda 消费 SQS 时,经验法则是**把队列的可见性超时设成函数超时的 6 倍左右**。
- Service Bus 的锁最长 5 分钟,但可以 **RenewLock 续锁**,长任务能主动延长,这是它比 SQS 好用的地方。

**DLQ:失败不能永远重试。**
一条"毒消息"(格式坏、引用了已删除的资源)会被无限重投,占住吞吐、刷爆日志、还可能反复触发副作用。
- SQS:配 redrive policy,`maxReceiveCount` 到了就自动挪进 DLQ。**注意 SQS 的 DLQ 不是自动有的,要显式配。**
- Service Bus:dead-letter 是内建子队列,`MaxDeliveryCount` 默认 10,还会把死信原因写在属性里。

**DLQ 的正确心智:它不是垃圾桶,是待人工/自动介入的收件箱。** 没有人看的 DLQ 等于静默丢消息。
所以 DLQ 深度必须配告警,这是可观测性那一模块的引子。

**为什么幂等是消费者的责任,以及你已经怎么解的。**
生产者能做的很有限:它不知道消息有没有到、有没有被处理;网络超时后它只能重发(否则可能丢)。
中间件也做不到真正的"恰好一次":要么它在投递前删(可能丢),要么投递后等确认(可能重)。
**所以唯一能真正终结重复的地方,是消费者在写入自己状态时做去重。**

你在 recallsmith 里做的正是教科书答案,而且做在了正确的层:
`src_C/Vpc/Runtime/ProgressEvents.cs` 里进度事件按 `event_id` 插入,并且 `on conflict (event_id) do nothing`。
这句话的力量在于:**去重不是靠"我记得处理过",而是靠数据库的唯一约束在并发下也成立。**
两个 worker 同时处理同一条消息,第二个的插入被约束挡掉,而不是靠一个可能读到过期值的 `if (exists)` 检查。
这是 "check-then-act" 和 "让约束替你判断" 的分野,面试里能说清这个区别的人很少。

**再往上一层是 transactional outbox。**
问题:你要"写数据库"和"发消息"两件事同时成立,但它们是两个系统,没有跨系统事务。
先写库后发消息 -> 发消息失败,状态改了但下游不知道;
先发消息后写库 -> 库写失败,下游收到了不存在的事情。
outbox 的解法:**把"要发的消息"作为一行写进同一个数据库事务**。事务提交了,消息就一定在表里;
再由一个发布器(你的 `src_C/Vpc/Analytics/OutboxPublisher.cs`)去扫 `status = 'pending'` 的行发出去,发成功标 `'sent'`。
注意它还处理了发布器自己崩掉的情况:被标成 `'processing'` 但超过 15 分钟没进展的行会被重新捡起来。
**代价是:outbox 保证的是"至少一次发出",不是"恰好一次",所以下游仍然必须幂等。**
这就闭环了:outbox 解决"发不发得出去",event_id 唯一约束解决"发多了怎么办",两者缺一不可。

**什么时候坏 / 常见误解:**
- **误解:"用 FIFO 队列就没有重复了"。** FIFO 的去重窗口是 5 分钟,超出窗口的重发照样重复;
  而且 FIFO 吞吐低、按 message group 串行,拿它当幂等的替代品是错的。
- **误解:"消息顺序应该由队列保证"。** Standard SQS 是尽力有序。
  更稳的设计是让消费者对乱序免疫(比如你的 per-column LWW 合并:按事件时间取最新,乱序到达也收敛到同一结果)。
  **这是个非常强的面试论点:与其要求基础设施保证顺序,不如让状态合并可交换。**
- **误解:"重试就是加个 retry"。** 无上限重试会把毒消息变成放大器,必须配 DLQ + 指数退避。
- **批处理陷阱:** Lambda 一次拿一批 SQS 消息,如果 handler 整体抛异常,**整批**都会重投,包括已经成功的那几条。
  正解是开启 `ReportBatchItemFailures`(事件源映射上打开 partial batch response,handler 返回失败的 messageId 列表)。
  **对着你自己的代码说这件事更有说服力:** `src_C/Worker/WorkerFunction.cs` 现在是
  `foreach (var record in sqsEvent.Records)` 逐条处理、handler 返回 `Task` 不返回失败清单,
  所以业务级失败被你 catch 住(消息正常删除),而系统级异常会穿出循环让**整批**重投。
  这不是 bug(你的处理本来就要求幂等),但它是一个你应该主动讲出来的已知边界:
  "我知道现在是全批重试,靠 jobId 幂等兜住;规模上去我会换成 partial batch response。"

### 卡片素材(手动录入用)

- **Q:** 为什么队列做不到"恰好一次投递",这个责任最终必须落到哪里?
  **A:** 因为中间件只有两个选择:投递前删(消费者崩了就丢)或投递后等确认(确认丢了就重投),
  它无法区分"消费者死了"和"消费者还在慢慢做"。所以只能保证至少一次。
  真正终结重复的地方是消费者写自己状态时的去重,recallsmith 用的是按 event_id 的唯一约束 + on conflict do nothing。
  **难度:** d1
  **EN:** "The broker cannot tell a slow consumer from a dead one, so it must redeliver; exactly-once has to be achieved by the consumer's writes."

- **Q:** 处理一条消息要 60 秒,而队列的可见性超时是 30 秒,会发生什么?
  **A:** 消息会在你还没处理完时重新变为可见,被第二个消费者取走,于是同一条被并发处理两次,
  两个消费者做完后还各自删除一次。表现是"神秘的重复副作用 + 吞吐莫名下降"。
  规则:可见性超时必须大于最坏处理时间;Lambda 消费 SQS 时通常设成函数超时的 6 倍左右。
  **难度:** d1
  **EN:** "The message becomes visible again mid-processing and a second consumer picks it up, so you get concurrent duplicate work."

- **Q:** `on conflict (event_id) do nothing` 比先 `SELECT` 查有没有处理过好在哪?
  **A:** 好在并发下仍然正确。先查后插是 check-then-act,两个并发消费者可能同时查到"不存在"然后都插入。
  唯一约束把判断交给数据库,在同一个原子操作里完成,第二个插入必然失败或被忽略。
  幂等要建立在约束上,不要建立在应用层的记忆上。
  **难度:** d1
  **EN:** "A unique constraint decides atomically under concurrency; a select-then-insert check has a race window between the two statements."

- **Q:** transactional outbox 解决的到底是哪个问题?它没解决什么?
  **A:** 解决"改数据库"和"发消息"没有跨系统事务的问题:把待发消息作为一行写进同一个事务,
  事务提交则消息必然存在,再由发布器异步发出。
  它没解决重复:发布器可能发出后崩在标记之前,所以是至少一次,消费者仍然必须幂等。
  **难度:** d1
  **EN:** "The outbox makes the state change and the intent to publish atomic; it still only guarantees at-least-once delivery downstream."

- **Q:** outbox 发布器把行标成 `processing` 之后自己崩了,这行会永远卡住吗?怎么设计才不会?
  **A:** 不该永远卡住。做法是给 `processing` 加一个租约超时:扫描时不仅取 `pending`,
  也取 `processing` 且 `updated_at` 早于某个阈值(recallsmith 用的是 15 分钟)的行,重新认领。
  本质上是"锁必须能过期",和队列的可见性超时是同一个思想。
  **难度:** d2
  **EN:** "Claims must expire: the publisher also re-picks rows stuck in processing past a lease timeout, exactly like a visibility timeout."

- **Q:** Lambda 批量消费 SQS 时,批里一条失败会怎样?怎么避免把成功的也重跑?
  **A:** 默认整批被认为失败,整批消息重新可见,包括已经成功处理的那几条,于是幂等性被反复考验。
  解法是启用 partial batch response(ReportBatchItemFailures),handler 只返回失败的 messageId,
  其余会被正常删除。这是很多人踩过但说不清的坑。
  **难度:** d3
  **EN:** "Without partial batch responses the whole batch is retried, including the messages that already succeeded."

- **Q:** DLQ 在 SQS 和 Service Bus 上的默认行为差在哪?
  **A:** SQS 的 DLQ 不是自动的,要显式配 redrive policy 和 maxReceiveCount,不配就是无限重投。
  Service Bus 的 dead-letter 是内建子队列,MaxDeliveryCount 默认 10,还会记录死信原因。
  共同点:DLQ 是待处理收件箱不是垃圾桶,没有告警的 DLQ 等于静默丢消息。
  **难度:** d1
  **EN:** "SQS needs an explicit redrive policy, Service Bus dead-letters by default; either way an unmonitored DLQ is silent data loss."

- **Q:** 与其要求队列保证消息顺序,更稳的设计是什么?举你自己的例子。
  **A:** 让消费者对乱序免疫,即让状态合并是可交换的。
  recallsmith 的 per-column LWW 合并就是这个思路:每列按事件时间取最新,并用 event_id 做最后的确定性 tiebreak,
  所以同一批事件无论以什么顺序到达,收敛结果都相同。
  这比上 FIFO 队列便宜得多(FIFO 吞吐低、按 group 串行),也比"要求上游有序"现实。
  **难度:** d2
  **EN:** "Rather than demanding ordered delivery, I make the merge commutative so any arrival order converges to the same state."

- **Q:** "用 FIFO 队列就不用做幂等了"错在哪?
  **A:** 错在 FIFO 的去重是有窗口的(SQS 是 5 分钟),窗口外的重发照样重复;
  而且它只在同一个 message group 内有序,吞吐显著低于 Standard。
  FIFO 降低重复概率,不消灭重复,把它当幂等的替代品是在用一个更贵的队列换一个假的保证。
  **难度:** d1
  **EN:** "FIFO deduplication has a time window and a throughput cost; it reduces duplicates, it does not remove the need for idempotency."

- **Q:** Service Bus 的 lock 相比 SQS 的可见性超时,多给了什么能力?
  **A:** 多了主动续锁(RenewLock)。Service Bus 的锁最长 5 分钟,但消费者可以在处理中续期,
  长任务不必一开始就把超时设得很大。SQS 侧的对应手段是调用 ChangeMessageVisibility 手动延长,
  思路一样但在 Lambda 事件源模式下不那么自然,所以更常见的做法是把超时一次设够。
  **难度:** d2
  **EN:** "Service Bus lets a consumer renew the lock while working, so long jobs do not need a huge fixed timeout."

---

## 5. 数据库托管(RDS ↔ Azure SQL,DynamoDB ↔ Cosmos DB)

| 概念 | AWS | Azure |
| --- | --- | --- |
| 关系型托管 | RDS(PostgreSQL/MySQL/…)、Aurora | Azure SQL Database、Azure Database for PostgreSQL |
| 高可用 | Multi-AZ 同步备机,故障切换换 DNS | 内建高可用副本,切换对连接串透明 |
| 只读扩展 | Read replica(异步,有延迟) | 只读副本 / geo-replication |
| 计费模型 | 实例规格 + 存储;Aurora Serverless v2 按 ACU | DTU 或 vCore;Serverless 层可自动暂停 |
| 连接压力解法 | RDS Proxy | 内建连接治理 + 应用侧池化 |
| NoSQL | DynamoDB(分区键 + 排序键) | Cosmos DB(分区键,多 API) |
| 一致性选项 | 默认最终一致读,可要求强一致读 | 五档一致性:strong / bounded staleness / session / consistent prefix / eventual |
| 容量单位 | RCU / WCU 或按需 | RU/s(预置或 serverless) |

### 概念讲解

**Mental model:** 托管数据库买的不是"数据库",是**"别人替你做备份、打补丁、故障切换"**。
你交出的是对机器和某些参数的控制权。所以选型的第一问不是性能,是**"我愿意放弃多少控制权来换多少运维时间"**。

**关系型:RDS ↔ Azure SQL,差别在心智模型的边界在哪。**
- RDS 更像"托管的一台 Postgres",你还看得见实例规格、参数组、`max_connections`。
  这也是为什么第 2 模块那个连接数推理在 RDS 上如此重要:**连接数上限是实例规格的函数,而且是硬墙。**
- Azure SQL 更抽象一层,你面对的是数据库或弹性池,不是"一台机器"。
  它的 DTU 模型把 CPU/IO/内存打包成一个数字,好处是简单,坏处是遇到瓶颈时更难归因,
  所以 vCore 模型在需要推理性能时更合适。
- **Multi-AZ 不是读扩展。** 这是高频误解:Multi-AZ 的备机是同步复制、平时不接流量,
  它买的是"主挂了自动切",不是"多一份读能力"。要读扩展得用 read replica,而 replica 是异步的,
  **会有复制延迟,所以"写完立刻从 replica 读"可能读不到自己刚写的东西**。
  这是分布式系统里 read-your-writes 问题的具体形态。

**为什么 serverless 计算 + 传统关系库是天然张力。**
Lambda 横向扩到几百实例,每个都想要连接;关系库的连接是重量级资源(每条连接在 Postgres 里是一个进程,占内存)。
这就是第 2 模块 `PG_MAX=1` 的由来,也是 RDS Proxy 存在的理由:
**Proxy 用少量长连接面对数据库,用大量短连接面对 Lambda,并且能在事务边界上复用连接(connection multiplexing)。**
Azure 侧的对应更多是应用层和 Azure SQL 自身的连接治理,加上 Functions 那边"一实例多并发"本身就降低了实例数。

**NoSQL:DynamoDB ↔ Cosmos,概念级要点。**
不要背 API,要抓住三个决定一切的概念:
1. **分区键决定一切。** 数据按分区键哈希分片,所以**查询必须带分区键才快**,
   不带就是全表扫描(DynamoDB 的 Scan),成本和延迟都会爆。
   设计 NoSQL 表是"先想清楚查询模式,再设计 key",和关系库"先建模再想查询"的顺序**是反的**。
2. **热分区是主要失败模式。** 分区键选得不均匀(比如用日期做分区键,今天所有流量打同一个分区),
   会在总容量还很富余时被单分区限流。
3. **容量是显式的。** DynamoDB 的 RCU/WCU 或按需,Cosmos 的 RU/s。
   每次操作消耗多少 RU 是可以算出来的,超了就被 throttle(429),客户端要退避重试。
   **这跟关系库"慢一点但不会拒绝你"的直觉完全不同。**

**Cosmos 最值得记的是它的五档一致性**,因为它把通常被藏起来的取舍摆到了配置项上:
strong(最强、最贵、跨区受限)、bounded staleness(限定落后多少)、
session(同一会话内 read-your-writes,默认且最实用)、consistent prefix(不乱序)、eventual(最便宜)。
DynamoDB 的对应更简单:读默认最终一致,可以按请求要求强一致读(更贵)。
**面试价值:能说出"session 一致性在多数应用里是甜点,因为用户只在乎看到自己写的东西"这句话,比背五个名字强。**

**什么时候选 NoSQL:** 访问模式固定且已知、需要极高吞吐和可预测的个位数毫秒延迟、数据天然按 key 分片。
**什么时候不选:** 查询模式会变、需要 ad-hoc 查询和 join、需要跨实体事务和强约束。
recallsmith 用 PostgreSQL 是对的选择,因为它有 6-CTE 的原子摄入、跨表的合并逻辑、keyset 分页,
这些全都是关系库的强项。**面试时被问"为什么不用 DynamoDB",这就是标准答案的骨架。**

**什么时候坏 / 常见误解:**
- **误解:"托管数据库就不用管备份了"。** 备份存在不等于恢复演练过。没试过恢复的备份是薛定谔的备份。
- **误解:"加个 read replica 就能解决慢"。** 如果慢是因为缺索引或 N+1 查询,replica 只是把同样的烂查询跑两份。
- **误解:"NoSQL 更快"。** NoSQL 在**它擅长的访问模式上**更快且更可预测。用错访问模式的 DynamoDB 比 Postgres 慢也贵。
- **跨区读写延迟:** 数据库和计算不在同一区/同一 VPC 时,每次查询多几十毫秒,在 N+1 场景下会被放大成秒级。

### 卡片素材(手动录入用)

- **Q:** Multi-AZ 和 read replica 分别买到了什么?把 Multi-AZ 当读扩展会怎样?
  **A:** Multi-AZ 是同步备机,买的是主库故障时的自动切换(高可用),备机平时不接读流量。
  read replica 是异步副本,买的是读吞吐,代价是复制延迟。
  把 Multi-AZ 当读扩展的结果是根本用不上:它不对外提供读端点,而且真去读也拿不到扩展能力。
  **难度:** d1
  **EN:** "Multi-AZ buys failover, read replicas buy read throughput; they solve different problems."

- **Q:** 写完立刻从 read replica 读,可能读不到,这个问题的名字和常见解法是什么?
  **A:** 这是 read-your-writes(读己之写)问题,根因是副本异步复制有延迟。
  常见解法:写后的一小段时间内把读也发到主库;或按会话粘住主库;
  或让 UI 用刚提交的本地值先渲染。Cosmos 直接把这个做成了 session 一致性级别。
  **难度:** d2
  **EN:** "That is the read-your-writes problem: route reads to the primary right after a write, or use session consistency."

- **Q:** 设计 DynamoDB/Cosmos 的表和设计关系表,顺序上最大的区别是什么?
  **A:** 顺序是反的。关系库先建模实体,查询后来再靠索引和 join 支持;
  NoSQL 必须先列清访问模式,再据此设计分区键和排序键,因为不带分区键的查询等于全表扫描。
  推论:访问模式还会变的系统,选 NoSQL 风险很高。
  **难度:** d1
  **EN:** "In NoSQL you design the keys from the access patterns; in a relational database you model entities first and add indexes later."

- **Q:** 什么是热分区?为什么它会在总容量充足时把你限流?
  **A:** 热分区是分区键分布不均导致流量集中到少数分区,比如用当天日期做分区键。
  容量是按分区分配的,单分区达到上限就会被 throttle(429),哪怕表级容量还有大量富余。
  解法是把高基数、分布均匀的东西放进分区键,或加随机后缀打散再在读取时聚合。
  **难度:** d2
  **EN:** "A hot partition throttles you at the partition limit even when table-level capacity is idle, because capacity is allocated per partition."

- **Q:** 面试官问"recallsmith 为什么用 PostgreSQL 而不是 DynamoDB",怎么答才显得是判断而不是习惯?
  **A:** 因为工作负载的核心是跨表的原子写和可变的查询:
  一次摄入要在单个事务里做多步写(6 个 CTE 串起来),要按 event_id 做唯一约束去重,
  要做 per-column 的合并和 keyset 分页。这些依赖事务、约束和灵活查询,是关系库的强项。
  如果访问模式固定成纯 key 查、且需要极高吞吐,那时 DynamoDB 才更合适。
  **难度:** d1
  **EN:** "The workload needs multi-step atomic writes, unique constraints and flexible queries, which is exactly what a relational engine is for."

- **Q:** Cosmos 的 session 一致性为什么在实际应用里往往是甜点?
  **A:** 因为用户真正在意的是"我看到我自己刚写的东西",而不是"全球所有副本此刻完全一致"。
  session 一致性保证同一会话内 read-your-writes,成本远低于 strong,
  而 eventual 又会让用户看到自己刚提交的内容消失,体验上无法接受。
  **难度:** d2
  **EN:** "Users care about seeing their own writes, not about global agreement, which is exactly what session consistency provides cheaply."

- **Q:** RDS Proxy 解决的是什么问题?没有它的时候你靠什么顶?
  **A:** 解决 serverless 计算的连接放大:大量短命 Lambda 实例各自开连接,打爆 RDS 的 max_connections。
  Proxy 用少量长连接面对数据库、大量短连接面对函数,并在事务边界复用连接。
  没有它的时候靠把每实例池大小压到 1(recallsmith 的 PG_MAX 默认值)+ 控制函数并发上限,
  这能顶到中等规模,再往上就该上 Proxy。
  **难度:** d2
  **EN:** "RDS Proxy absorbs connection storms from short-lived functions; until you have it, a pool size of one plus a concurrency cap is the stopgap."

- **Q:** "托管数据库自动备份了所以数据安全"错在哪?
  **A:** 错在备份的价值等于恢复的成功率,而不是备份任务的成功率。
  没有演练过恢复,你不知道 RTO 是多少、不知道恢复出来的数据完不完整、
  也不知道恢复流程需要哪些权限和人。另外自动备份保护不了"应用把数据写坏"这类逻辑错误,
  那需要时间点恢复和对写路径的约束。
  **难度:** d1
  **EN:** "An untested backup is a hypothesis; what matters is a rehearsed restore, not a green backup job."

---

## 6. 网络基础(VPC / 子网 / 安全组)

| 概念 | AWS | Azure |
| --- | --- | --- |
| 私有网络 | VPC | Virtual Network(VNet) |
| 网段划分 | Subnet(绑定单个 AZ) | Subnet(区域内) |
| 出网(私有子网) | NAT Gateway(按小时 + 按 GB 计费) | NAT Gateway / Azure Firewall |
| 实例级防火墙 | Security Group(**有状态,只有 allow**) | Network Security Group(**有状态,有 allow 和 deny**) |
| 子网级防火墙 | Network ACL(**无状态**,有 allow 和 deny) | NSG 可绑子网或网卡 |
| 不出网访问云服务 | VPC Endpoint(Gateway 用于 S3/DynamoDB,Interface 用于其余) | Private Endpoint / Service Endpoint |
| 函数进私网 | Lambda VPC 配置(创建 ENI) | Functions VNet integration(Premium / Flex Consumption) |

### 概念讲解

**Mental model:** VPC 是你在云上划的一块私有地址空间,里面的东西默认能互相说话,
和外面说话必须经过你显式开的门(网关、endpoint、防火墙规则)。
**"公有子网"和"私有子网"的唯一区别是路由表里有没有指向 Internet Gateway 的默认路由**,
不是什么勾选框。这个定义能背下来,面试里能省你半分钟的支吾。

**你的 `RecallSmith.Lambda.Vpc` 这个名字就是从这来的。**
项目分成 Public / Vpc / Worker,其中 Vpc 那个之所以叫 Vpc,是因为它需要连 RDS,
而 RDS 在私有子网里,所以这个 Lambda 必须被配置到 VPC 内。
**Lambda 进 VPC 的机制:** 平台在你指定的子网里创建弹性网卡(ENI),
函数的出向流量就从这块网卡走,于是能看见私有子网里的 RDS。
**一个值得知道的更新:** 2019 年之后 Lambda 用的是 Hyperplane ENI,
网卡按"子网 + 安全组的组合"创建并被同一组合下的所有执行环境**共享**,
不再是"每个并发执行一块网卡"。所以 ENI 的数量跟着**配置组合数**走,不是跟着并发数线性走,
冷启动时那段"等 ENI 创建好"的几十秒延迟也随之消失了。
知道这条能让你不去背 2018 年的旧结论,但子网留足地址仍然必要(见下面那张 d3 卡)。

**进了 VPC 之后立刻会咬你的事:函数失去了默认的公网出口。**
- 之前 Lambda 在 AWS 管理的网络里,访问公网 API 是理所当然的;
- 进了私有子网之后,访问 S3、SQS、Stripe、任何外部 HTTPS,都需要一条出网路径。
- 路径有两种:**NAT Gateway**(能上公网,但按小时 + 按处理的 GB 收费,是账单上常见的意外)
  或 **VPC Endpoint**(流量不出 AWS 网络直达服务,S3 和 DynamoDB 有便宜的 Gateway endpoint,
  其余服务用 Interface endpoint,按小时计费但省 NAT 的流量费)。
- **这就是那个经典误诊:权限都对,但调用 S3/SQS 卡住直到超时。**
  症状是超时不是 AccessDenied,这个区别本身就是诊断线索:
  **AccessDenied = 权限问题,超时 = 网络路径问题。**

**Security Group vs NACL,以及 Azure NSG 的差异。**
- **Security Group 是有状态的**:你允许了出向请求,回程流量自动被允许,不用写反向规则。
  它**只有 allow 规则**,没有 deny(默认全拒,你只能往上加放行)。
- **Network ACL 是无状态的**:出去和回来要分别放行,而且它有 deny 规则,作用在子网层。
  实际工作中 90% 的时间你在改 SG,NACL 用于粗粒度的黑名单。
- **Azure NSG 是有状态的,但同时有 allow 和 deny,并且可以绑在子网或网卡上**,
  等于把 AWS 的两层合成了一层。规则按优先级数字求值,先匹配先生效。
  **说得出"SG 无 deny,NSG 有 deny 且按优先级"这句,就证明你两边都真配过。**

**跨 AZ 的常识:** AWS 的子网绑定单个可用区,所以要高可用就得在多个 AZ 各放一个子网。
Lambda 配 VPC 时也要给多个子网,否则一个 AZ 出问题函数就没地方起 ENI。

**什么时候坏 / 常见误解:**
- **误解:"把 Lambda 放进 VPC 更安全"。** 只有在它需要访问私有资源时才该进 VPC。
  不必要地进 VPC 会带来 ENI 管理、出网成本、以及更复杂的故障模式,是净负债。
- **误解:"安全组能拦截出网到某个 IP"。** SG 只能 allow,做黑名单要靠 NACL 或防火墙。
- **成本坑:** NAT Gateway 是很多小团队账单上最贵的"没人记得开过的东西"。
  只是为了让 Lambda 访问 S3 而开 NAT,不如配一个 S3 Gateway endpoint(便宜得多)。
- **地址空间坑:** VPC 的 CIDR 定了很难改,子网切太小以后加实例会没 IP,
  Lambda 的 ENI 也会吃 IP,所以给 Lambda 用的子网别切太窄。

### 卡片素材(手动录入用)

- **Q:** "公有子网"和"私有子网"的技术区别到底是什么?
  **A:** 唯一区别是路由表:公有子网的路由表有一条默认路由指向 Internet Gateway,私有子网没有。
  没有别的开关。私有子网里的东西要上网,得把默认路由指向 NAT Gateway,或者干脆用 VPC endpoint 直达云服务。
  **难度:** d1
  **EN:** "A subnet is public only because its route table points the default route at an internet gateway."

- **Q:** recallsmith 的 Vpc Lambda 为什么必须放进 VPC?这带来的第一个副作用是什么?
  **A:** 因为它要连 RDS,而 RDS 在私有子网里,只有在 VPC 内(平台为函数创建 ENI)才看得见。
  第一个副作用是它失去了默认的公网出口:此后访问 S3、SQS 或任何外部 API 都需要显式的出网路径,
  要么 NAT Gateway,要么 VPC endpoint。
  **难度:** d1
  **EN:** "It needs to reach RDS in a private subnet, and the moment it joins the VPC it loses its default route to the internet."

- **Q:** 调用 S3 时报超时和报 AccessDenied,分别指向什么问题?
  **A:** AccessDenied 是权限问题:请求到了 S3,S3 拒绝了。超时是网络路径问题:请求根本没到,
  典型是 VPC 内的 Lambda 没有 NAT 也没有 S3 endpoint。
  这个区分能省掉大量瞎改 IAM policy 的时间,是最实用的云端诊断分流规则之一。
  **难度:** d1
  **EN:** "AccessDenied means the request arrived and was refused; a timeout means it never got there, so look at routing, not IAM."

- **Q:** Security Group 和 Network ACL 的三个关键区别是什么?
  **A:** 一,SG 有状态(允许出向就自动允许回程),NACL 无状态(两个方向都要写)。
  二,SG 只有 allow,NACL 有 allow 和 deny。三,SG 作用在实例/网卡,NACL 作用在子网。
  日常绝大多数配置在 SG 上,NACL 用于粗粒度封禁。
  **难度:** d1
  **EN:** "Security groups are stateful and allow-only at the instance level; NACLs are stateless with deny rules at the subnet level."

- **Q:** Azure 的 NSG 和 AWS 的 Security Group 差在哪?
  **A:** NSG 是有状态的(这点像 SG),但它同时支持 allow 和 deny 规则,按优先级数字求值,先匹配先生效,
  而且可以绑定在子网或网卡上。等于把 AWS 里 SG 和 NACL 分开的两层合成了一层,
  少了一个概念,代价是规则优先级要自己管好。
  **难度:** d2
  **EN:** "An NSG is stateful like a security group but adds deny rules and priority ordering, and can attach at subnet or NIC level."

- **Q:** 只是为了让 VPC 内的 Lambda 访问 S3,就开一个 NAT Gateway,问题在哪?
  **A:** 贵且没必要。NAT Gateway 按小时收费再叠加按 GB 的处理费,是小团队账单上最常见的意外支出。
  S3 和 DynamoDB 有 Gateway VPC endpoint,流量不出 AWS 网络,成本低得多。
  其他服务可以用 Interface endpoint。原则:先问"这条流量真的需要走公网吗"。
  **难度:** d1
  **EN:** "Use an S3 gateway endpoint instead: a NAT gateway charges by the hour and by the gigabyte for traffic that never needed the public internet."

- **Q:** "把函数放进 VPC 更安全"这句话什么时候是错的?
  **A:** 当函数不需要访问任何私有资源时就是错的。进 VPC 会引入 ENI、出网成本、多 AZ 子网规划和更复杂的故障模式,
  却没换来任何实际隔离(函数本来就不可被外部直接访问)。
  只有"需要连私有子网里的数据库或内网服务"才是进 VPC 的正当理由。
  **难度:** d1
  **EN:** "Join the VPC only when you need to reach something private; otherwise it is pure operational cost with no security gain."

- **Q:** 为什么给 Lambda 用的子网不该切得太小?现在的 ENI 模型让这件事变轻了多少?
  **A:** 因为每块 ENI 占一个私有 IP,而 IP 耗尽的表现是函数扩不上去(创建 ENI 失败),
  排查时很容易被误判成并发限制。
  自 Hyperplane ENI 之后,网卡按"子网 + 安全组组合"共享,数量跟配置组合数走而不是跟并发数走,
  所以这个风险比旧文章描述的小得多;但子网里还有 RDS、其他服务和未来的函数配置在抢 IP,
  而子网 CIDR 定下来后很难扩,所以仍然要一开始就留足,VPC 整体 CIDR 同理。
  **难度:** d3
  **EN:** "Lambda ENIs are shared per subnet-and-security-group combination now, so IP exhaustion is rarer than it used to be, but a subnet you cannot resize is still a bad place to be tight."

---

## 7. 可观测与部署(CloudWatch ↔ App Insights,IaC)

| 概念 | AWS | Azure |
| --- | --- | --- |
| 日志 | CloudWatch Logs(+ Logs Insights 查询) | Application Insights / Log Analytics(KQL 查询) |
| 指标 | CloudWatch Metrics | Azure Monitor Metrics |
| 告警 | CloudWatch Alarms(-> SNS) | Azure Monitor Alerts(-> Action Group) |
| 分布式追踪 | X-Ray | App Insights 内建端到端事务追踪 |
| 仪表盘 | CloudWatch Dashboards | Azure Monitor Workbooks |
| IaC(官方) | CloudFormation / CDK / SAM | ARM / Bicep |
| IaC(跨云) | Terraform | Terraform |
| CI/CD | CodePipeline / GitHub Actions | Azure DevOps / GitHub Actions |

### 概念讲解

**Mental model:** 可观测性回答三个层次的问题,层次不能混:
1. **发生了什么(logs):** 一条一条的事实。你的 `src_C/Shared/RecallSmith.Lambda.Common/Log.cs` 属于这层。
2. **有多少 / 多快(metrics):** 聚合后的数字,便宜、可长期保留、适合做告警。
3. **这一次请求经过了哪些系统(traces):** 一次调用在 API Gateway -> Lambda -> RDS -> SQS -> Worker 的完整路径。

**为什么不能只有日志:** 日志回答不了"p99 是多少"这类问题,除非你把它们聚合,而聚合日志既贵又慢。
**为什么不能只有指标:** 指标告诉你"错误率涨到 5%",但告诉不了你是哪个用户、哪条消息、哪一行代码。
**两者的接缝就是 trace:** 有 correlation id / trace id 时,你能从"指标异常"直接跳到"这几条具体日志"。

**Azure 在这块的产品化程度更高。** App Insights 把请求、依赖调用、异常、追踪放进同一个模型,
自动记录出向 HTTP 和数据库依赖的耗时,查询用 KQL。
AWS 侧更"零件化":Logs、Metrics、X-Ray 是三个东西,要自己接起来
(比如用结构化日志 + EMF 把指标嵌进日志,或显式加 X-Ray SDK)。
**这不是谁更好,是取舍:AWS 给你更细的控制和更明确的成本归属,Azure 给你更快的开箱体验。**
面试里这么说,比"我觉得 Azure 更好用"专业得多。

**日志的实操要点(能直接讲成经验):**
- **结构化优于自由文本。** `{"jobId": "...", "stage": "manifest", "ms": 412}` 可以被查询和聚合,
  `"processing manifest for job xyz took 412ms"` 只能被 grep。
  你的 Worker 里 `LogWithJobId` 这种带 jobId 的写法方向就是对的:**关键是有一个能把一次任务的所有日志串起来的 id。**
- **相关性 id 必须跨越队列边界。** 请求进来时生成一个 id,写进 SQS 消息体,
  Worker 处理时继续带着它。否则消息一进队列,链路就断了,这是异步系统最常见的可观测性断点。
- **日志有成本。** 每 GB 摄入和存储都要钱,debug 级别全开跑一个月的账单能吓人。
  采样和分级是必修课。
- **不要记 secret 和 PII。** 把整个请求体打进日志是最常见的合规事故。

**告警设计:告警要绑到"用户能感知的东西"上。**
CPU 80% 不一定是问题,**队列积压持续增长、DLQ 深度大于 0、p99 延迟超过 SLO、错误率突变**才是问题。
你的系统里有两个天然的一级告警:**DLQ 里出现消息**,以及 **outbox 表里 pending 行数持续上涨**
(后者意味着发布器挂了或下游拒收,而且它是静默失败,不告警根本没人知道)。
**这两个告警能在面试里直接讲,因为它们来自你自己的架构,不是背来的最佳实践。**

**部署与 IaC:诚实版。**
概念上你必须能讲清楚:
- **IaC 是把基础设施写成代码,用版本控制管理,靠工具让实际状态收敛到声明的状态。**
  价值在于可重现(新环境一条命令拉起)、可审查(改动走 PR)、可回滚、消除"点控制台点出来的雪花服务器"。
- **声明式 vs 命令式:** Terraform / CloudFormation / Bicep 是声明式,你写目标状态,工具算 diff(`terraform plan`)。
  脚本(bash + CLI)是命令式,重跑不一定安全。**幂等性是 IaC 的核心卖点。**
- **state 的概念:** Terraform 有一个 state 文件记录"我管过哪些资源",这是它能算 diff 的原因,
  也是它最大的坑(state 丢了/漂移了/被两个人同时改)。CloudFormation 和 Bicep 把这份状态托管在云端,少一个坑但少一点灵活。
- **drift(漂移):** 有人去控制台手改了,实际状态和代码不一致。下次 apply 时可能被改回去,也可能冲突。
  规则:**上了 IaC 就不要再手改**,否则两边都不可信。

**你的 gap,以及怎么诚实地说。**
你没有用 Terraform 或 Bicep 管过生产环境。**面试时不要含糊其辞地暗示自己用过。**
可以这么说:"我的基础设施是手工加脚本建起来的,我知道这在团队协作和多环境上不可持续,
IaC 的概念我清楚(声明式、state、plan/apply、drift),但我没有在生产里维护过 Terraform 代码库,
这是我进团队后想优先补的地方。"
**这句话的效果远好于装懂:面试官几乎一定会追问细节,而装懂在第二个问题就会崩。**
而且你有一个真实的可迁移经验:health-gated CI/CD(Reply In My Voice 里部署要通过健康检查才放行),
这说明你理解"部署不是把文件传上去,是在保证系统仍然健康的前提下换掉运行中的东西"。

**什么时候坏 / 常见误解:**
- **误解:"加了日志就是可观测"。** 没有 correlation id、没有结构化字段的日志,在分布式系统里几乎不可用。
- **误解:"告警越多越好"。** 告警疲劳会让真告警被忽略。每条告警都应该对应一个"有人要立刻做点什么"的动作,
  否则它属于 dashboard,不属于 pager。
- **部署盲点:** 蓝绿 / 金丝雀部署要有自动回滚条件,而回滚条件必须来自指标。
  没有指标的"金丝雀"只是先坏一部分用户。

### 卡片素材(手动录入用)

- **Q:** 日志、指标、追踪各自回答什么问题?为什么只有日志不够?
  **A:** 日志回答"发生了什么"(离散事实),指标回答"有多少/多快"(可聚合、可告警、便宜),
  追踪回答"这一次请求经过了哪些系统"。
  只有日志时,像 p99 延迟、错误率这类问题要靠事后聚合大量文本,又慢又贵,
  而且跨服务的因果关系完全丢失。三者是互补的,不是三选一。
  **难度:** d1
  **EN:** "Logs tell you what happened, metrics tell you how much and how fast, traces tell you where the request went."

- **Q:** 异步系统里最常见的可观测性断点在哪?怎么修?
  **A:** 断在队列边界:请求侧生成的 correlation id 没有随消息传下去,
  于是 Worker 的日志和触发它的那次 API 调用无法关联,排查时只能靠时间戳猜。
  修法是把 correlation id 写进消息体或消息属性,消费端继续带着它记日志,
  让一次业务操作在跨进程后仍然有同一个 id。
  **难度:** d1
  **EN:** "Correlation breaks at the queue boundary unless you carry the trace id inside the message itself."

- **Q:** 结构化日志比自由文本日志强在哪?举一个你系统里的例子。
  **A:** 强在可查询和可聚合:带字段的日志能按 jobId 过滤、按 stage 分组、按耗时排序,
  自由文本只能 grep。Worker 里按 jobId 打日志的方向就是这个,
  再往前一步是把 stage 和耗时也做成字段,而不是拼进句子里。
  **难度:** d1
  **EN:** "Structured logs can be queried and aggregated by field; prose logs can only be grepped."

- **Q:** 你的架构里有哪两个"静默失败"必须配告警?为什么它们特别危险?
  **A:** 一是 DLQ 里出现消息,二是 outbox 表里 pending 行数持续上涨。
  危险在于两者都不会报错给用户:API 返回 200,数据库事务也提交了,
  只是下游的事情永远没发生。没有告警时,发现方式往往是几天后用户投诉数据不对。
  **难度:** d2
  **EN:** "Messages landing in the DLQ and a growing outbox backlog are both silent: the API returned 200 and nothing downstream ever happened."

- **Q:** 什么样的指标适合当告警,什么样的不适合?
  **A:** 适合的是用户能感知的东西:错误率、p99 延迟、队列积压、DLQ 深度、成功率跌破 SLO。
  不适合的是资源使用率本身:CPU 80% 可能完全健康。
  判据是"这条告警响了,有人要立刻做什么吗",没有动作的告警属于仪表盘,不属于 pager,
  否则告警疲劳会让真正的告警被忽略。
  **难度:** d1
  **EN:** "Alert on symptoms users feel, not on resource utilisation; if nobody must act, it belongs on a dashboard."

- **Q:** IaC 的核心卖点是什么?声明式和写部署脚本的本质区别在哪?
  **A:** 核心卖点是可重现 + 可审查 + 幂等:环境从代码拉起,改动走 PR,重复执行结果一致。
  声明式(Terraform/CloudFormation/Bicep)是你写目标状态,工具计算差异再收敛;
  命令式脚本是你写步骤,重跑不一定安全(可能重复创建或报错)。
  幂等性正是"能放心重跑"的那一半价值。
  **难度:** d1
  **EN:** "You declare the desired state and the tool converges to it, which is why re-running is safe."

- **Q:** Terraform 的 state 是什么?为什么它既是关键机制又是主要坑?
  **A:** state 记录"Terraform 管过哪些真实资源以及它们的属性",是它能算出 plan 差异的依据。
  坑在于它是一份必须被保护的真相:丢了就认不出已有资源,
  两个人同时 apply 会冲突(所以要远程后端加锁),
  有人手改了云上资源就会 drift,下次 apply 可能把改动抹掉。
  CloudFormation 和 Bicep 把这份状态托管在云端,少一个坑但也少一点灵活。
  **难度:** d2
  **EN:** "State is Terraform's record of what it manages; lose it or let it drift and plan output stops telling the truth."

- **Q:** 被问到 Terraform 实操经验时你怎么答?(这是你的真实 gap)
  **A:** 照实说,并展示概念深度和迁移路径:
  我的基础设施是手工加脚本建的,我清楚这在多环境和团队协作下不可持续;
  IaC 的概念我明白(声明式收敛、state、plan/apply、drift、上了 IaC 就不该手改),
  但我没维护过生产的 Terraform 代码库,这是我想优先补的。
  同时给出相邻的真实经验:我做过 health-gated 的 CI/CD,部署要通过健康检查才放行。
  **难度:** d0
  **EN:** "I have not maintained Terraform in production; I understand the model and I would want that to be one of the first things I pick up."

- **Q:** "部署 = 把新代码放上去"哪里不完整?
  **A:** 不完整在于它忽略了"换掉运行中的东西时系统要保持健康"。
  完整的部署包含:健康检查通过才放流量(health gating)、可回滚(旧版本还在)、
  向前兼容的数据库变更(先加列再用,不是同时改)、以及能判断"这次发布是不是坏了"的指标。
  没有回滚条件的金丝雀发布,只是先弄坏一部分用户。
  **难度:** d1
  **EN:** "Deployment is replacing something that is running, so it needs health gates, a rollback path and metrics that decide whether the new version is bad."

---

## 8. 成本思维(按用付费 vs 常驻)

| 成本维度 | AWS | Azure |
| --- | --- | --- |
| 函数计费 | 请求数 + GB-秒(内存档同时决定 CPU) | 执行次数 + GB-秒(有月度免费额度) |
| 常驻计算 | EC2 按小时(Reserved / Savings Plan 可打折) | VM / App Service 按小时(Reserved 可打折) |
| 保留容量溢价 | Provisioned Concurrency 常驻付费 | Premium always-ready 实例常驻付费 |
| 队列 | SQS 按请求数(长轮询显著降低请求数) | Service Bus 按层级 + 操作数 |
| 存储 | S3 按存储 + 请求 + 出网流量 | Blob 按存储 + 操作 + 出网流量 |
| 常见意外账单 | NAT Gateway、跨区流量、CloudWatch 日志摄入 | 出网流量、Log Analytics 摄入、闲置的 Premium 计划 |
| ML 工作负载 | SageMaker 常驻资源(Studio 实例 / 实时 endpoint)vs 按任务的 Processing / 批处理作业 | ML 托管 endpoint vs 按任务作业 |

### 概念讲解

**Mental model:** 云成本 = **单价 × 用量 × 时间**,而 serverless 和常驻的区别只在最后一项:
**常驻是"按你租了多久付钱",serverless 是"按你真的用了多少付钱"。**
所以问题永远退化成一个:**我的负载有多少比例的时间在空转?**

- **空转比例高(尖峰、偶发、夜里没人用)** -> serverless 赢,而且常常赢一个数量级。
- **空转比例低(常年高负载、稳定流量)** -> 常驻赢,因为 serverless 的单价更贵,是在为弹性付溢价。
- 中间地带:用常驻扛基线 + serverless 扛尖峰,或者用 Savings Plan / Reserved 给基线打折。

**你有一个真实的、可以直接讲的战绩:Dovetale 实习期间把常驻的 SageMaker Studio 改成按任务的 Processing job。**
它的结构正是上面这条推理的最干净的实例:一个常驻的 Studio 实例只要不显式关掉就一直按实例小时计费,
**不管上面有没有在跑活都在烧钱**。而那些工作本身是批量的、可以容忍延迟的、每天只跑几次,
所以常驻实例的绝大部分小时都在为零工作量付费。
改成按任务拉起的 Processing job(跑完即销毁)之后,成本从"按日历算"变成"按工作量算"。
**讲这件事时把名词说准:是 Studio 实例改成 Processing job,不是"关掉一个推理 endpoint"**,
面试官如果自己用过 SageMaker,名词说错会立刻掉一档。

**讲这件事时要说清三层,才显得是工程判断而不是省钱小技巧:**
1. **触发点是什么:** 是看账单发现的,还是看利用率指标发现的(利用率是更专业的答案)。
2. **取舍是什么:** 按任务的作业有启动延迟(要拉起环境、装镜像、加载模型),
   所以只有在**能容忍这段延迟**的场景才成立。要求即时响应的在线推理就不能这么改。
   **能主动说出这个代价,比只说省了多少钱可信得多。**
3. **边界在哪:** 如果调用频率上升到某个阈值,常驻反而更便宜,
   因为反复的冷启动和模型加载会吃掉节省。**任何成本优化都有一个流量拐点,能指出拐点存在就是成熟度。**

**其他值得内化的成本直觉:**
- **Lambda 的内存档同时决定 CPU。** 所以把内存从 512MB 调到 1024MB,
  可能让执行时间减半,**总成本持平甚至下降,同时延迟改善**。
  "调大内存反而更便宜"是一个反直觉但常见的结论,值得实测。
- **SQS 按请求数计费,长轮询(long polling)能把空轮询的请求数砍掉一大截。**
  短轮询在低流量队列上会产生大量"什么都没拿到"的付费请求。
- **出网流量(egress)是最容易被忽略的一项。** 云内同区通常便宜,跨区和出公网贵。
  内容分发走 CDN 不只是为了快,也是为了让出网从对象存储的价格换成 CDN 的价格。
- **日志是有成本的服务。** CloudWatch Logs / Log Analytics 按摄入量收费,
  debug 日志全开是账单上常见的隐形项。
- **忘了关的东西:** NAT Gateway、闲置的 Premium 计划、跑完没删的测试实例、
  以及没配生命周期策略的存储桶(旧对象永远躺在 Standard 层)。
- **免费额度会骗人:** 很多服务有慷慨的免费层,让你在开发期完全无感,
  然后在流量上来时突然阶跃。做架构决策时按满负载估算,不要按免费额度估算。

**成本和架构是同一件事的两面。** 面试里能把成本讲成设计推理(而不是"我会看 Cost Explorer"),
是 intermediate 和 junior 的一条清晰分界。

### 卡片素材(手动录入用)

- **Q:** 判断某个负载该用 serverless 还是常驻,最核心的那个指标是什么?
  **A:** 空转比例,也就是"有多少时间没有请求但机器还在跑"。
  空转高(尖峰、偶发、夜间无流量)serverless 赢,因为你只为真实工作付费;
  空转低(常年高负载)常驻赢,因为 serverless 的单价包含弹性溢价。
  任何成本讨论不先问这个,都是在比单价,而单价本身不可比。
  **难度:** d1
  **EN:** "The question is what fraction of the time the workload is idle; that single number decides serverless versus always-on."

- **Q:** 把常驻的 SageMaker Studio 实例改成按任务的 Processing job,省钱的机制是什么?代价是什么?
  **A:** 机制是把计费从"按日历小时"变成"按工作量":常驻实例只要没关就按实例小时计费,
  而实际工作是批量、低频的,于是绝大部分小时都在为零工作量付费;按任务拉起的 job 跑完即销毁。
  代价是每次都要付启动开销(拉起环境、装镜像、加载模型),所以只适用于能容忍这段延迟的批量场景,
  要求即时响应的在线推理不能这么改。
  **难度:** d1
  **EN:** "An always-on instance bills by the clock, a per-task job bills by the work; the trade is startup latency, so it only fits batch-tolerant work."

- **Q:** 这类成本优化在什么情况下会反过来变贵?
  **A:** 当调用频率高到反复的启动开销(拉环境、加载模型)超过常驻的空转成本时。
  每一次按任务运行都要重新付一次冷启动的时间成本,频率一高就变成主要开销。
  所以存在一个流量拐点,过了拐点常驻更便宜。能指出拐点存在,说明这是判断而不是口号。
  **难度:** d3
  **EN:** "Past a certain request rate the repeated startup cost exceeds the idle cost, so always-on becomes cheaper again."

- **Q:** 为什么把 Lambda 的内存从 512MB 调到 1024MB 有可能让账单变小?
  **A:** 因为 Lambda 的内存档同时决定分配的 CPU,计费单位是 GB-秒:
  内存翻倍单价翻倍,但如果执行时间因为 CPU 变多而减半,GB-秒总量持平,而延迟明显改善。
  如果时间下降超过一半,总成本还会下降。所以内存不是"够用就行",是一个需要实测的性能/成本旋钮。
  **难度:** d2
  **EN:** "Memory also buys CPU, and billing is GB-seconds, so doubling memory can halve the duration and leave the bill flat or lower."

- **Q:** SQS 的短轮询在低流量队列上为什么费钱?
  **A:** 因为 SQS 按请求数计费,短轮询会不停发出"看看有没有消息"的请求,
  在空队列上绝大多数返回空但一样计费。长轮询让请求最多等待一段时间再返回,
  把大量空请求合并成少量有意义的请求,在低流量队列上差别很明显。
  **难度:** d1
  **EN:** "Short polling pays for a stream of empty receives; long polling collapses them into far fewer billable requests."

- **Q:** 云账单上最常见的三类"没人记得开过"的支出是什么?
  **A:** 一是 NAT Gateway(按小时加按 GB,常常只为让私有子网里的函数访问 S3,而那本该用 endpoint);
  二是日志摄入(CloudWatch Logs / Log Analytics 按量计费,debug 全开会很贵);
  三是闲置的常驻容量(忘关的测试实例、闲置的 Premium 计划、没配生命周期的存储)。
  共同点是它们都不产生错误,所以没有任何信号提醒你。
  **难度:** d1
  **EN:** "NAT gateways, log ingestion and forgotten always-on capacity: none of them fail, so nothing tells you they are there."

- **Q:** 为什么内容分发走 CDN 不只是性能决策,也是成本决策?
  **A:** 因为对象存储的出网流量单价通常高于 CDN 的分发单价,而且 CDN 命中后根本不回源,
  同一份内容被下载一万次可能只从源站取一次。
  再加上边缘缓存降低了延迟和源站的请求数,性能和成本是同一个改动的两个收益。
  **难度:** d1
  **EN:** "A cache hit costs less than an origin fetch and is faster, so the CDN improves latency and egress cost at the same time."

- **Q:** 用免费额度来估算成本会犯什么错?
  **A:** 会把"开发期完全免费"误当成"这个架构很便宜",然后在流量上来时遇到成本阶跃。
  免费额度是固定量,不随规模缩放,所以正确做法是按预期满负载估算单价 × 用量,
  把免费额度当成折扣而不是当成结论。
  **难度:** d1
  **EN:** "Free tiers are a fixed grant, not a scaling property; estimate at expected load and treat the free tier as a discount."

---

## 复习顺序建议

1. **先啃第 4 模块(队列)**,因为那是你最强的地方,能最快建立"我确实懂"的信心,
   而且 event_id 幂等 + outbox 这一组是你面试里的招牌答案。
2. **再啃第 2 模块(计算)**,`MaxPoolSize=1` 那条推理链是你最容易被追问、也最容易答漂亮的题。
3. **第 1、6 模块(权限、网络)**是转行者最常见的洞,而且面试官很爱用它们分辨"真部署过还是只写过代码"。
4. **第 3、5 模块(存储、数据库)**你有实感,主要是补术语的准确性(强一致、read-your-writes、热分区)。
5. **第 7、8 模块(可观测、成本)**放最后,因为它们最依赖前面的具体系统,
   而且第 7 里有你需要练习怎么说的那个 gap(IaC)。

录卡时的一个提醒:**A 面用自己的话重写。**
如果你发现自己只能照抄,那说明这张卡对应的 `### 概念讲解` 还没读透,
回去把"为什么"和"什么时候坏"那两段再看一遍,再来重写。
