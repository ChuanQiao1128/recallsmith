# Web 控制台系统设计（面试背诵版，2026-10-05）

> 基线：main `e1e6ad0`。每一条都按代码、SQL 迁移和 Terraform 核对过：3 个 agent 读代码，3 个 agent 复核事实，成稿后再由 2 个 agent 独立复核全文（26 处更正已改入）。
> 用法：每节先背 **"一句话"**，再按 **前端 → 后端 → 数据库** 复述，最后背英文句子。代码出处统一放在文末的表里。
> 每节的详细讲解（概念、步骤、原因、追问）见配套文档 `docs/console-system-design-explained-2026-10-05.md`。

## 0. 总览

**控制台是什么：** 一个只给内部编辑用的管理后台，没有外部用户。编辑在这里写卡、批量导入、审核 AI 草稿，然后把卡组发布到手机端。发布之后，还在这里处理学习者的反馈、看学习数据。

**角色只有两个：**
- `super_admin`：管全站。
- `editor`：只能操作被授权的卡组。

**一张图：**

```
浏览器（React SPA，放在 S3 + CloudFront）
   │  Bearer JWT（Cognito 登录，授权码 + PKCE）
   ▼
API Gateway HTTP API ── JWT authorizer 先验 token、按路由限流
   │
   ▼
core-vpc（一个 .NET 10 Lambda，VPC 内）── 手写路由，再验角色和卡组权限
   │                     │
   ▼                     ▼
PostgreSQL 17（RDS）    SQS ──► worker Lambda ──► S3 不可变构建 + manifest ──► CloudFront ──► 手机 App
```

**业务顺序（背这条主线）：**
1. 登录
2. 权限
3. 编辑卡组和卡片
4. 批量导入
5. 审核 AI 草稿
6. 发布前检查
7. 发布
8. 回滚和清理
9. 发布后：反馈和数据
10. 管理和审计

另外还有两节横切内容：11 前端工程，12 后端与数据库。

### 60 秒英文总述（整段背）

> "The admin console is a React single-page app on S3 and CloudFront. Editors sign in through Cognito with the authorization code flow and PKCE. Every request goes through API Gateway, which validates the JWT, to one .NET Lambda that reads the role from the token's Cognito groups and checks per-deck permissions in PostgreSQL. Editors write cards with optimistic concurrency, bulk-import Markdown idempotently by a stable ID, and approve or reject AI-drafted cards. Publishing is asynchronous: the API writes a pending job and queues it in SQS; a worker builds an immutable deck file on S3, flips a live-build pointer in one SQL statement and rebuilds the manifest the phone reads through the CDN. A rollback just moves the pointer back, with an audit record in the same transaction. After publishing, the console handles learner reports and shows usage, and the riskiest admin actions, such as permission changes, rollbacks, migrations and webhook changes, are written to an append-only audit table."

---

## 1. 登录

**一句话：** 控制台是静态网页，存不了密钥，所以用 Cognito 托管登录，走授权码 + PKCE 流程；每次发请求前检查 token，快过期就先刷新。

- **前端：**
  1. 点 Sign in 时生成 verifier 和 state，连同登录后要回的地址一起存进 sessionStorage；再用 verifier 算出 challenge（S256），放进 URL，跳转到 Cognito 登录页。
  2. Cognito 回调 `/auth/callback`，前端先核对 state，再用 code + verifier 换取 token。
  3. 登录后跳回原来的页面。跳转地址在写入和读取时各检查一次，防止被跳到外部网站（open redirect）。
  4. 所有 API 请求共用一个 axios 实例，超时 15 秒（Cognito 换 token 和读 CDN 清单用的是 fetch）。
  5. 每次发请求前检查 token：剩不到 60 秒或已经过期，就先用 refresh token 换新的，没有后台定时器。多个请求同时到期，只发一次刷新请求（single-flight）。收到 401 就清掉 token、回登录页。
- **后端（Cognito 和网关）：**
  - 控制台有自己的用户池：强制 TOTP MFA，账号只能由管理员创建。
  - access token 有效 1 小时，refresh token 30 天。
- **数据库：** 不涉及。密码交给 Cognito 保管，我们不存。
- **English：** "It's a static SPA, so it signs in with the authorization code flow plus PKCE. Before each request it refreshes the token if less than a minute is left, and concurrent requests share one refresh."

## 2. 权限：三层把关

**一句话：** 前端只负责按角色隐藏按钮，真正的把关在网关和后端：网关先验 token，后端再验角色和卡组权限。

- **前端：** 从 token 的 `cognito:groups` 读出角色。不是 super_admin 就隐藏新建卡组、发布、删除、回滚、Webhooks、Admin 这些入口。**隐藏不等于禁止。**
- **后端：**
  - **网关**：3 个 JWT authorizer，按受众区分：console、agent、mobile。受众不对的 token 在网关就被拒绝，不会唤醒 Lambda。
  - **core-vpc**：
    - token 必须来自控制台用户池和控制台 client，才承认管理员角色。
    - 每条路由再调用对应的检查：`RequireAdmin`、`RequireSuperAdmin`，或者卡组级的 `RequireDeckRead` / `RequireDeckWrite`。
  - **AI agent 的 token**：只能访问 6 条路由。打到其余控制台路由时，网关的 console authorizer 直接拒绝（401）；core-vpc 里还有一份同样的白名单兜底，漏进来的请求返回 403 `AGENT_CLIENT_FORBIDDEN`。
- **数据库：** `admin_deck_permissions` 表记录每个账号（Cognito sub）对每个卡组的 `can_read` / `can_write`，唯一键是 (admin_sub, deck_id)。super_admin 不查这张表，直接放行。
- **English：** "Authorization happens in layers: the UI hides buttons, API Gateway validates the JWT audience, and the Lambda reads the role from the token's Cognito groups and checks per-deck read and write permissions in PostgreSQL."

## 3. 编辑卡组和卡片

**一句话：** 两个人同时改同一张卡时，后保存的人不会悄悄覆盖前一个人，而是收到冲突提示。这叫乐观并发：用版本号判断，不加锁。

- **前端：**
  - 卡组和卡片的读写用 React Query 缓存，每次写入后只让受影响的缓存失效。卡组列表页是例外，用 useEffect 直接请求。
  - 编辑页有"未保存修改"守卫，编辑到一半离开会被拦下。
  - 冲突时显示 "Retry with latest version"：只取回最新的版本号，**保留你的输入**，再保存一次就覆盖。也就是明确的后写者胜。
- **后端：**
  - 保存卡片必须带 `expectedVersion`。更新语句是 `where id = ? and version = ?`，同时把 version 加 1。一行都没更新到，就返回 **409 VERSION_CONFLICT**。
  - editor 改卡组时，受限字段会被后端忽略，比如定价层级、上架状态、排序。
  - 删除卡组（软删除）、删除卡片，都只有 super_admin 能做。
- **数据库：**
  - `decks`：slug 唯一；`is_deleted` 用于软删除；`live_build_id` 指向线上正在用的构建。
  - `cards`：两个唯一键，(deck_id, stable_uid) 和 (deck_id, order_in_deck)；`version` 是乐观锁。
  - `stable_uid` 是手机端记录学习进度用的稳定 ID。编辑页里它是只读的，后端也不让 editor 改；但数据库没有强制，super_admin 直接调 API 仍然能改。
- **注意：** 只有卡片有乐观锁；`decks.version` 只是普通字段。
- **English：** "Card edits use optimistic concurrency: each save carries the version it read, and a stale version gets a 409 instead of silently overwriting someone."

## 4. 批量导入 Markdown

**一句话：** 导入按 stable_uid 对账，先预览再执行，只新增和更新、从不删除；中途失败重试也不会重复写。

- **前端：**
  1. 解析 Markdown，和服务器上已有的卡按 stable_uid 对账。
  2. 预览分四类：新建、更新、不变、冲突。有冲突时，"应用"按钮点不了。
  3. 按"最多 500 张卡、最多 900,000 字符"切批提交。超时、网络错误、429、5xx 按 1 / 2 / 4 秒退避重试。
- **后端：**
  1. 每批一个事务，先锁住卡组行。
  2. 用 `on conflict (deck_id, stable_uid) do update ... where 内容 is distinct from 旧内容` 做 upsert。内容没变，就不加版本号。
  3. 遇到 uid 属于已删除的卡（SOFT_DELETED_UID）或排序号冲突（ORDER_CONFLICT），整批返回 409，一张都不写。
- **数据库：** 写 `cards`。导入记录还会写进自动化账本；导入失败会产生一个 webhook 事件。
- **为什么不删：** 学习进度是按 stable_uid 记的，删了卡，用户的进度就对不上了。
- **为什么能安全重试：** 已经落库的批次重发一次，结果全部是"不变"，不会重复写。
- **English：** "Markdown import is idempotent: it's keyed by a stable ID, previewed as create, update, unchanged or conflict, never deletes, and a retried batch simply comes back unchanged."

## 5. 审核 AI 草稿

**一句话：** AI 只能提交草稿。生产上自动化是 dry_run，所以每张草稿都由人接受、修改后接受或拒绝；接受时，写卡、关草稿、记审核事件在同一个事务里完成。

- **前端：** `/review` 审核队列。可以直接接受、修改后接受，或者选一个原因拒绝。审核用时会记进账本。
- **后端：**
  - 本地 AI agent 通过 MCP 工具调用 `POST /api/v1/authoring/drafts` 提交草稿（详见 `system-design-interview-2026-10-05.md` 的 AI1 节）。
  - 代码里有 live 模式下的自动接受（用同一个接受事务），但必须先通过评测门槛，现在没有开。
  - 接受草稿时在一个事务里依次执行：
    1. `SELECT ... FOR UPDATE` 锁住这条草稿；
    2. 插入一张正式的卡；
    3. 把草稿标为 accepted；
    4. 写一条审核事件。
  - 接受和拒绝需要卡组的写权限。
- **数据库：**
  - `ai_drafts`：状态 pending / accepted / rejected。唯一键 (deck_id, client_draft_key) 让重复提交只算一次。
  - `ai_review_events`：只能追加，记录每一步是谁、做了什么。
- **English：** "The AI agent can only submit drafts. In production, where automation runs in dry-run mode, a person accepts, edits or rejects each one, and accepting inserts the card, closes the draft and logs a review event in one transaction."

## 6. 发布前检查

**一句话：** 发布前可以先打开预览页，在浏览器里用模仿手机端的规则检查一遍（可选，不拦发布）；真正拦发布的是服务器上的选择题格式门禁。AI 质检门禁也在服务器上，但生产上是关着的。

- **前端：** 预览页在浏览器里拼一个近似的 `deck.json`（版本号显示为 0.0.0），用控制台自己写的、模仿手机端的规则检查：缺 slug、uid 重复、排序号重复等。这一步可选，不写任何数据，也不在发布按钮的流程里。
- **后端：**
  - **选择题格式门禁**：不合格返回 400 `MCQ_PUBLISH_GATE`。
  - **AI 质检门禁**：只有 `AI_QA_ENABLED` 和 `AI_QA_REQUIRED` 两个开关都打开时才会拦截发布。生产上两个都是 0。
  - 质检运行的方式：按每 5 张卡一块发到 SQS，由 VPC 外的 Python Lambda 调用模型，再通过 HMAC 签名回调把结果写回。
- **数据库：**
  - `ai_qa_runs`：部分唯一索引保证每个卡组同时只有一个进行中的质检。
  - `ai_qa_items`：按卡片内容的哈希记录审过的版本，卡片一改就要重审。
  - `ai_qa_findings`：问题分 blocker / major / minor。
- **English：** "Before publishing, an editor can preview the export in the browser and check it against rules modelled on the app's. On the server, an MCQ format gate blocks bad decks, and an AI QA gate exists but is switched off in production."

## 7. 发布（异步）

**一句话：** 点发布只写一条任务、发一条队列消息；worker 生成一个不会再改的卡组文件，再用一条 SQL 把"线上版本"指针切过去，最后重建清单。

- **前端：** 点 Publish → 确认弹窗（里面有质检状态预览）→ 拿到 jobId。super_admin 打开卡组列表后，页面就轮询整个发布任务列表：有任务在跑时按 2 / 2 / 5 / 5 / 5 秒、之后每 10 秒查一次；空闲时前 10 次 30 秒一次，之后 120 秒一次；标签页隐藏时暂停。
- **后端（core-vpc）：**
  1. 检查写权限，过上面的门禁。
  2. 这个卡组有进行中的任务、并且 15 分钟内还有更新，就**直接返回原来的 jobId**，不重复创建。
  3. 否则写一行 PENDING 任务，再发 SQS 消息。**SQS 发送失败，立刻把这一行标成 FAILED**，不留没人处理的孤儿任务。
  4. 如果进行中的任务已经超过 15 分钟没动静，插入会被部分唯一索引挡住，返回 409 `PUBLISH_IN_PROGRESS`，要先清理卡住的任务再发布。
- **后端（worker Lambda）：**
  1. 用条件 UPDATE 抢任务：只有 PENDING 或超时的 PROCESSING 能被抢，所以重复投递的消息只有一个能抢到。FAILED 是终态，不会再被抢。
  2. 把 `deck.json` 写到 `builds/{buildId}/`。buildId 每次都不同，缓存头设为一年、不可变。
  3. 用**一条 SQL** 同时完成三件事：任务标 SUCCESS、移动 `decks.live_build_id`、更新卡片总数。同一个事务里还会写入 webhook 待投递行。
  4. 重建 `manifest.json`（缓存 60 秒）。手机用 ETag 检查它有没有变。
- **数据库：** `deck_publishes` 既是任务表，也是构建历史，状态 PENDING → PROCESSING → SUCCESS / FAILED。部分唯一索引 `uq_deck_publishes_active` 保证**每个卡组同时最多一个进行中的发布**。
- **为什么异步：**
  - 构建耗时不受控：大卡组要生成 `deck.json`、分块包和增量补丁，worker 最长允许跑 615 秒，而 API Gateway 30 秒就超时。目前实测最慢一次只有 4.6 秒。
  - 异步还顺带拿到了 SQS 的重试和死信队列。
  - 构建文件从不覆盖，所以 CDN 不用刷新缓存，回滚也只是移动指针。
- **English：** "Publishing is asynchronous. The API writes a pending job and queues it in SQS. A worker claims it with a conditional update, writes an immutable build to S3, then flips the live-build pointer in one SQL statement and rebuilds the manifest. A partial unique index allows only one active publish per deck."

## 8. 回滚和清理

**一句话：** 回滚不需要重新构建，只要把指针移回以前某个成功的构建；移动指针和写审计在同一个事务里完成。

- **前端：** 只有 super_admin 能看到构建面板。回滚前要手动输入卡组的 slug 确认，防止手滑。
- **后端：**
  - 只接受这个卡组以前的 **SUCCESS** 构建。
  - 在一个事务里更新 `live_build_id` 并写审计（`deck.rollback`，记录改前和改后），提交后重建清单。
  - 卡住的任务由 reaper 标成 FAILED：PENDING 超过 10 分钟，或 PROCESSING 超过 30 分钟没有进展。目前是 super_admin 在控制台**手动点按钮**触发，也会写审计。
- **数据库：** `deck_publishes`、`decks.live_build_id`、`admin_audit`。
- **English：** "Because builds are never overwritten, a rollback just moves the pointer back to an earlier successful build, in one transaction with an audit record."

## 9. 发布后：学习者反馈和数据

**一句话：** 学习者在 App 里举报有问题的卡，编辑在控制台处理；控制台还能看学习数据、管理对外 webhook、查看自动化做了什么。

- **学习者举报**（`/reports`）：
  - App 有两个入口：登录用户可以附备注；未登录用户只能选结构化的原因，不能写备注。两个入口写进同一张 `card_reports` 表。
  - 防刷规则：
    - 每个登录用户每天最多 5 条，匿名举报全站每天最多 100 条：这两个上限由代码在 advisory lock 下计数；
    - 同一用户对同一张卡只能有 1 条未处理的举报（部分唯一索引）；
    - 匿名举报对同一张卡、同一原因，每天最多 1 条（部分唯一索引）。
  - 编辑按状态和卡组筛选，跳到卡片编辑器修改，再选一个处理结果关闭：fixed / wont_fix / duplicate / invalid。页面从不显示举报人是谁。
- **学习数据**（`/usage`）：
  - 数据来自 App 同步上来的复习事件。automation tick 每天把它汇总进 `analytics_daily`，每次重算最近 8 天，保证 D7 留存有足够时间成熟。
  - 指标：DAU / WAU / MAU，以及 D1 / D7 留存。
  - 按卡组的数字在请求时实时计算。
  - 匿名漏斗表 `anon_funnel_events` 不含任何用户或设备 ID，保留 400 天。
- **对外 webhook**（`/admin/webhooks`，只有 super_admin 能用）：
  - `deck.published` 在发布成功的同一个事务里写待投递行（事务性 outbox），提交后再发 SQS。其他事件在业务提交后尽力先写 `webhook_deliveries`、再发 SQS；发送失败的行可以手动重扫补发。
  - VPC 外的 Python dispatcher 用 HMAC 签名后投递出去。
  - 订阅地址必须是 https，并且拦截内网和本机地址（SSRF 防护）。
  - 签名密钥只放在 SSM 里，页面只显示参数名。
- **自动化与账本**（`/automation`、`/ledger`）：
  - 生产是 `dry_run` 模式：系统照常做决策，但只记录"本来会怎么做"，不会真的自动接受或发布。
  - 账本按"件数 × 基线分钟数 − 实际分钟数"（不低于 0）算出省了多少人工时间。带 `dedupe_key` 的事件靠唯一约束只记一次；导入事件故意不带键，每次导入各记一条。
- **English：** "After publishing, learners can report a card from the app, signed in or anonymously. Daily caps are counted in code under an advisory lock, and partial unique indexes allow one open report per learner and card. Editors resolve reports in the console, and webhooks go out through SQS and a signing dispatcher."

## 10. 管理和审计

**一句话：** 账号权限和数据库迁移只有 super_admin 能做；14 种关键管理操作会和业务在同一个事务里写进一张只能追加的审计表。

- **权限管理**（`/admin/users`）：
  - 按 Cognito sub 给账号分配卡组的读写权限。
  - 账号本身的创建和删除不在控制台里做，由 owner 在 MFA 会话下用 AWS CLI 操作。原来负责建号的那个 Lambda 已于 10-04 下线。
- **数据库迁移**：
  - 迁移不在部署时自动跑，要在控制台点按钮触发。共 46 个 SQL 文件，原则上只做加法。
  - 执行前依次检查：
    1. 调用者是 super_admin；
    2. 迁移密钥正确（常量时间比较）；
    3. 拿到 `pg_advisory_lock`，保证同一时间只有一个迁移在跑。
  - 每个文件和它的版本记录在同一个事务里提交。
  - 标了 destructive 的迁移会停下，必须显式确认版本号才执行。控制台按钮不带这个确认，所以它跑不了破坏性迁移。
- **审计**：
  - `admin_audit` 记录谁、做了什么、对什么、改前改后，以及 traceId。
  - 它和业务修改在**同一个事务**里写入：业务回滚，审计也一起回滚；业务提交了，审计就一定在。
  - 触发器禁止 UPDATE、DELETE 和 TRUNCATE，所以这张表只能追加。
  - 共审计 14 种操作，包括权限变更、回滚、清理卡住的任务、数据库迁移、webhook 订阅变更。
  - **不写这张表的**：删除卡组、删除卡片、发布、处理举报。发布记在 `deck_publishes`，草稿审核记在 `ai_review_events`。
- **English：** "Only super admins manage deck permissions and run migrations. Migrations take an advisory lock and stop before anything destructive unless you confirm its exact version. Fourteen kinds of admin action, such as permission changes, rollbacks, migrations and webhook changes, are written in the same transaction to an append-only audit table protected by triggers."

---

## 11. 横切：前端工程

**一句话：** 控制台加载快，编辑不会丢，失败的写请求不会被自动重放，安全策略在测试里真正跑过。

- **技术栈：** React 19、TypeScript 5.9、Vite 7、Tailwind、React Query 5、react-router 7（数据路由）、axios、Sentry。测试用 Vitest、Playwright 和 axe 无障碍检查。
- **代码拆分：** 共 18 个页面，除登录页和回调页外，16 个按需加载。代码块加载失败时，提示用户刷新页面。
- **数据请求：**
  - 没有 Redux 这类全局 store。
  - React Query 的默认值：数据 30 秒内算新鲜。读不自动重试，因为服务器拒绝了就是答案；写也不自动重试，因为写请求可能已经落库，重放会重复写入。
  - 轮询是手写的，标签页隐藏时暂停。
- **性能预算写成测试：** CI 真实跑一次生产构建，计算首屏要下载的 JS + CSS 字节数，超过 377,000 B 就失败。今天实测是 370,892 B。
- **安全：**
  - 由 CloudFront 下发严格的 CSP：`script-src 'self'`，不允许内联脚本。
  - Playwright 在生产同款的响应头下跑测试，出现任何 CSP 违规就失败。
- **部署：**
  - 带哈希的资源缓存一年，`index.html` 不缓存、最后上传。
  - 上传完刷新 CloudFront，再读回线上的 `index.html` 核对哈希。
- **English：** "The console is a React 19 SPA with sixteen lazy-loaded pages. CI fails if the first-load bundle goes over a byte budget, and Playwright runs against the production security headers, so any CSP violation fails the build."

## 12. 横切：后端与数据库

**一句话：** 一个 .NET Lambda 处理全部控制台 API，数据放在不对公网开放的 PostgreSQL；慢查询和挂起的事务都有服务端超时。

- **后端：**
  - core-vpc 是一个 .NET 10 arm64 Lambda，512 MB。路由是手写的：按路径后缀逐条匹配，没有用 ASP.NET 框架。
  - 请求体超过 1 MiB 直接拒绝。
  - 统一返回 `{success, data, error, traceId, version}` 信封，前端按其中四个字段读成 `ApiResult`，不向页面抛异常。
- **数据库：**
  - RDS PostgreSQL 17，单 AZ，不对公网开放，加密存储，自动备份保留 14 天。
  - 每个 Lambda 容器只开 1 条连接。
  - 每条连接都设了服务端超时：`statement_timeout` 20 秒，`idle_in_transaction_session_timeout` 60 秒（worker 两项都是 600 秒）。
- **慢任务和出网：**
  - 慢的工作走 SQS 队列：发布、AI 质检、webhook、邮件。
  - VPC 没有 NAT。需要上外网的工作交给 VPC 外的 Python Lambda，结果通过 HMAC 签名的内部接口报回 core。
- **English：** "The backend is one .NET 10 Lambda with a hand-written router in front of a private PostgreSQL instance. Every API connection gets a 20-second statement timeout and a 60-second idle-in-transaction timeout, the publish worker gets 600 seconds, and anything slow runs through SQS."

### 数据库表速查

| 表 | 作用 | 关键约束 |
|---|---|---|
| `decks` | 卡组目录 | slug 唯一；`live_build_id` 指向线上构建；`is_deleted` 软删除 |
| `cards` | 卡片 | (deck_id, stable_uid) 唯一；(deck_id, order_in_deck) 唯一；`version` 乐观锁 |
| `admin_deck_permissions` | 账号对卡组的读写权限 | (admin_sub, deck_id) 唯一 |
| `deck_publishes` | 发布任务 + 构建历史 | 部分唯一索引：每卡组最多一个 PENDING / PROCESSING |
| `deck_build_patches` | 两个构建之间的增量补丁 | (slug, from, to) 唯一 |
| `ai_drafts` / `ai_review_events` | AI 草稿和审核记录 | (deck_id, client_draft_key) 唯一；审核事件只能追加 |
| `ai_qa_runs` / `_items` / `_findings` | AI 质检 | 每卡组最多一个进行中的质检 |
| `card_reports` | 学习者举报 | 每人每卡最多一条未处理举报；匿名举报每卡每原因每天最多一条 |
| `webhook_subscriptions` / `webhook_deliveries` | 对外 webhook（outbox） | 订阅只做软删除 |
| `automation_events` / `automation_baselines` | 自动化账本 | `dedupe_key` 唯一 |
| `analytics_daily` / `anon_funnel_events` | 学习数据、匿名漏斗 | 漏斗表不含任何身份 ID |
| `admin_audit` | 管理审计 | 触发器禁止改和删 |
| `schema_migrations` | 已执行的迁移 | 版本号是主键 |
| `card_embeddings` | 卡片向量（找语义重复的卡） | pgvector，384 维 |

---

## 常见追问（每题两三句）

1. **两个编辑同时改一张卡会怎样？**
   后保存的人收到 409。页面取回最新版本号、保留他的输入，他可以选择覆盖。这是明确的后写者胜，不是悄悄覆盖。
2. **SQS 消息重复投递，会重复发布吗？**
   不会。worker 用条件 UPDATE 抢任务，只有一个能抢到；FAILED 是终态。同一卡组还有部分唯一索引，限制最多一个进行中的任务。
3. **用户狂点发布按钮会怎样？**
   15 分钟内有进行中的任务，就返回原来的 jobId，不会新建任务。
4. **为什么前端隐藏了按钮，后端还要再检查？**
   前端只是方便使用，任何人都可以直接调 API。真正的规则必须在服务端。
5. **为什么不用 Next.js 或 SSR？**
   这是登录后才能用的内部后台，不需要 SEO。静态 SPA 放在 S3 + CloudFront 上几乎没有运维成本，也没有服务器可以被攻击。
6. **审计日志怎么保证不被改？**
   它和业务写在同一个事务里，数据库触发器禁止 UPDATE、DELETE 和 TRUNCATE。要坦白：删除卡组这类操作目前没有写进这张表。

## 诚实的边界（被追问时主动说）

- **token 放在 sessionStorage**：JS 能读到，XSS 风险靠严格的 CSP 来降低。登出不撤销 refresh token。
- **发布权限前后端不一致**：前端只给 super_admin 显示发布按钮，但后端只要求"卡组写权限"。有写权限的 editor 直接调 API 也能发布。
- **导入不检查版本**：可能覆盖同时进行的单卡编辑。这是已知、已接受的取舍。
- **"不可变构建"靠约定**：每次的 buildId 都不同，加上缓存头，而不是 S3 本身禁止覆盖。
- **审计没有覆盖全部操作**：删除卡组、删除卡片、发布不写审计表。
- **几个功能只在前端或手动**：回滚的 slug 确认只在前端做；清理卡住的任务目前要手动点；控制台没有查看审计日志的页面。
- **规模**：数据库单 AZ，流量很小，以上都不能当容量证明。

## 只需要背的数字

- 2 个角色，3 个 JWT authorizer，agent 只能访问 6 条路由
- 导入每批 500 张、900,000 字符，重试间隔 1 / 2 / 4 秒
- 发布 15 分钟内复用任务，清单缓存 60 秒
- 18 个页面，16 个按需加载；首屏预算 377 kB
- 46 个迁移文件，审计 14 种操作
- 数据库超时 20 秒 / 60 秒

## 不用背的

- 轮询间隔的具体阶梯
- 每个表的全部列、各种错误码的名字
- 自动化相关的 16 张表（034 迁移 13 张，加 028 的 3 张账本表）、14 种审计操作的完整名单

---

## 证据（main `e1e6ad0`）

| 说法 | 文件 |
|---|---|
| 技术栈、18 个页面、16 个懒加载、数据路由 | `frontend/package.json`、`frontend/src/App.tsx`、`frontend/src/main.tsx` |
| PKCE、state、跳转地址检查 | `frontend/src/auth/cognito.ts`、`frontend/src/auth/safeRedirect.ts`、`frontend/src/pages/AuthCallbackPage.tsx` |
| 15 秒超时、提前 60 秒刷新、single-flight、401 跳回登录 | `frontend/src/api/http.ts` |
| React Query 默认值、按键失效 | `frontend/src/api/queryClient.ts`、`frontend/src/hooks/useDecks.ts`、`frontend/src/hooks/useCards.ts` |
| 控制台用户池 MFA、token 有效期、两个组 | `infra/modules/identity/cognito.tf` |
| 3 个 JWT authorizer、路由与限流 | `infra/modules/api/gateway.tf` |
| 控制台绑定、RequireAdmin / SuperAdmin / DeckRead / DeckWrite | `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs`、`src_C/Vpc/Authoring/Helpers.cs` |
| agent 只能访问 6 条路由 | `src_C/Vpc/AgentClientPolicy.cs`、`infra/scripts/check-agent-routes.py` |
| 手写路由、1 MiB 上限 | `src_C/Vpc/VpcFunction.cs` |
| 乐观并发 409 VERSION_CONFLICT、冲突恢复 | `src_C/Vpc/Authoring/Cards.cs`、`frontend/src/pages/EditCardPage.tsx` |
| editor 受限字段、卡组软删除 | `src_C/Vpc/Authoring/Decks.cs` |
| 导入对账、500 / 900,000、重试、事务 upsert、409 整批不写 | `frontend/src/lib/deckImport.ts`、`frontend/src/lib/deckImportRunner.ts`、`src_C/Vpc/Authoring/CardsImport.cs` |
| 草稿接受事务、ai_drafts 唯一键 | `src_C/Vpc/Review/Drafts.cs`、`src_C/Vpc/Db/Migrations/030_ai_review_queue.sql` |
| 浏览器内预览校验 | `frontend/src/pages/DeckPreviewPage.tsx` |
| MCQ 门禁、AI 质检门禁、15 分钟复用、发送失败标 FAILED | `src_C/Vpc/Authoring/Publish.cs`、`src_C/Vpc/Qa/QaGate.cs`、`src_C/env/prod.env.json`；质检表 `src_C/Vpc/Db/Migrations/031_ai_qa.sql` |
| 每卡组最多一个进行中的发布 | `src_C/Vpc/Db/Migrations/021_decks_live_build_id.sql` |
| worker 抢任务、一条 SQL 切指针、重建清单 | `src_C/Worker/Repositories/JobRepository.cs`、`src_C/Worker/WorkerFunction.cs`、`src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs` |
| 构建缓存一年、清单 60 秒 | `src_C/Worker/S3/S3DeckUploader.cs`（构建）、`src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs`（清单） |
| 发布轮询阶梯 | `frontend/src/lib/publishJobsPolling.ts` |
| 回滚、reaper | `src_C/Vpc/Authoring/DeckRollback.cs`、`src_C/Vpc/Authoring/PublishReaper.cs`、`frontend/src/components/console/DeckBuildsPanel.tsx` |
| 举报两个入口、限额、匿名唯一索引 | `src_C/Vpc/Reports/CardReports.cs`、`src_C/Vpc/Reports/AnonymousCardReports.cs`、`src_C/Vpc/Db/Migrations/037_card_reports.sql`、`046_card_reports_anonymous.sql` |
| 学习数据汇总、匿名漏斗 | `src_C/Vpc/Analytics/UsageAnalytics.cs`、`src_C/Vpc/Analytics/AnonFunnel.cs`、`src_C/Vpc/Db/Migrations/040_usage_analytics.sql`、`043_anon_funnel_events.sql` |
| webhook outbox、签名投递、SSRF 检查 | `src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs`、`src_C/Vpc/Integrations/WebhookSubscriptions.cs`、`src_C/Vpc/Integrations/WebhookDeliveries.cs`、`services/webhook-dispatcher/` |
| 自动化 dry_run、账本 | `src_C/Vpc/Automation/AutomationMode.cs`、`src_C/Vpc/Automation/AutoPublisher.cs`、`src_C/Shared/RecallSmith.Lambda.Db/AutomationLedger.cs`、`src_C/Vpc/Ledger/LedgerRoutes.cs`、`src_C/env/prod.env.json` |
| 权限 bulk、迁移闸门 | `src_C/Vpc/Authoring/Permissions.cs`、`src_C/Vpc/Db/Migrate.cs`、`src_C/Vpc/Db/DbSafety.cs` |
| 审计表、触发器、同事务写入 | `src_C/Vpc/Authoring/AdminAudit.cs`、`src_C/Vpc/Db/Migrations/023_admin_audit.sql` |
| 首屏预算 377,000 B | `frontend/tests/bundleFirstLoad.test.ts` |
| CSP 与 Playwright 检查 | `infra/modules/edge/security_headers.json`、`frontend/tests/e2e/cspGuard.ts` |
| 控制台部署 | `frontend/deploy.sh` |
| RDS 配置、连接超时 | `infra/modules/data/rds.tf`、`src_C/Shared/RecallSmith.Lambda.Db/PgSessionTimeouts.cs` |
