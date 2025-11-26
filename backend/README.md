# RecallSmith Backend – Authoring API（P0 写侧）

## 1. 模块定位

Authoring API 是 RecallSmith 的「写侧」服务，当前只给管理员使用，用来维护题库 Deck：

- 创建 / 编辑 / 软删 Deck；
- 搜索（按 title 模糊匹配）、分页、按创建时间排序；
- 保证未软删 Deck 的 title 唯一（忽略大小写）；
- 使用 `version + expectedVersion` 做乐观并发控制，避免编辑冲突；
- 所有响应使用统一的 `ApiResult<T>` 包装，并附带 `traceId`，方便排查问题。

后续会在此基础上增加：

- Card（题目卡片）模型；
- Publish 到 Catalog（读侧）；
- AWS RDS / S3 / Cognito 集成等。

---

## 2. 技术栈

- .NET 8 Web API
- PostgreSQL（本地开发，可平滑迁移到 AWS RDS）
- Npgsql（手写 SQL）
- 分层结构：
  - `Controllers`：HTTP 路由、参数解析、状态码、ApiResult 封装；
  - `Application/*`：业务逻辑（Service）；
  - `Infrastructure/*`：数据库访问（Repository）、中间件等；
- 统一响应体：`ApiResult<T>`；
- 全局异常处理：`ApiExceptionMiddleware`，将未处理异常统一转为 `ApiResult` + 500。

---

## 3. 数据模型 – decks 表

```sql
CREATE TABLE decks (
    id          SERIAL PRIMARY KEY,
    title       TEXT    NOT NULL,
    author      TEXT    NOT NULL,
    is_deleted  INTEGER NOT NULL DEFAULT 0,  -- 0=未删除，1=软删
    version     INTEGER NOT NULL DEFAULT 1,  -- 乐观并发版本，从 1 开始
    created_at  BIGINT  NOT NULL,           -- epoch 毫秒（UTC）
    updated_at  BIGINT  NOT NULL
);

-- 未删除的 title 唯一，忽略大小写
CREATE UNIQUE INDEX decks_title_ci_unique_not_deleted
    ON decks (LOWER(title))
    WHERE is_deleted = 0;

-- 常见查询：where is_deleted=0 order by created_at
CREATE INDEX decks_is_deleted_created_at_idx
    ON decks (is_deleted, created_at DESC);
```

设计说明：
• id：数据库自增主键，前端不传，由服务端生成；
• is_deleted：软删标记，删除时不物理删除，只标记为 1；列表 / 查询默认只看 is_deleted = 0；
• version：乐观并发控制，每次成功更新 version = version + 1；
• created_at / updated_at：统一使用 UTC epoch 毫秒，避免时区问题；
• decks_title_ci_unique_not_deleted：部分唯一索引，保证「未软删」的标题唯一（忽略大小写），软删之后可以重用标题

## 4. API 概览

约定：所有参数都通过 QueryString 传递，不使用 Body。
返回统一使用 ApiResult<T>。

4.1 GET /api/authoring/decks – 列表查询

功能：搜索 + 排序 + 分页。

Query 参数：
• title（可选）：按标题模糊搜索（不区分大小写）；
• sortbyCreatedAt（可选）：asc / desc，默认为 asc；
• currentPage（可选）：页码，从 1 开始，默认 1。

示例：
GET /api/authoring/decks?title=java&sortbyCreatedAt=desc&currentPage=2

返回示例：
{
"success": true,
"data": [
{
"id": 3,
"title": "Java Interview Questions",
"author": "Kevin Smith",
"isDeleted": 0,
"version": 1,
"createdAt": 1710001200,
"updatedAt": 0
}
// ...
],
"error": null,
"traceId": "..."
}

说明：
• 只返回 is_deleted = 0 的 Deck；
• 搜索使用 PostgreSQL 的 ILIKE '%keyword%'；
• 分页使用 LIMIT/OFFSET，每页固定 10 条（在 Service 层配置）。

4.2 GET /api/authoring/decks?id={id} – 查询单条

功能：按 id 查询单个 Deck（只返回未软删的）。

示例：
GET /api/authoring/decks?id=21

成功时返回：
{
"success": true,
"data": {
"id": 21,
"title": "How to Know the expectedVersion",
"author": "Qiao",
"isDeleted": 0,
"version": 4,
"createdAt": 1764118696530,
"updatedAt": 1764121275533
},
"error": null,
"traceId": "..."
}

如果不存在或已软删：
• HTTP 404；
• error.code = "NotFound"。

4.3 POST /api/authoring/decks?title=…&author=… – 创建 Deck

功能：创建新的 Deck。

Query 参数：
• title（必填）；
• author（必填）。

示例：
POST /api/authoring/decks?title=My%20New%20Deck&author=Qiao

规则：
• title 和 author 必须为非空、非空白字符串；
• title 在未软删 Deck 中必须唯一（忽略大小写）；
• 冲突时返回 HTTP 409，error.code = "Conflict"。

成功时：
• HTTP 201 Created；
• Location 头：api/authoring/decks?id={newId}；
• Body 为 ApiResult<Deck>，version 初始为 1。
4.4 PUT /api/authoring/decks?id=…&title=…&author=…&expectedVersion=…

功能：更新 Deck（部分字段 + 乐观并发）。

Query 参数：
• id（必填）：要更新的 Deck 主键；
• title（可选）：新标题；
• author（可选）：新作者；
• expectedVersion（必填）：前端最后一次看到的 version。

规则：
• 至少提供 title 或 author 其中一个；
• 如果修改 title：
• 仍需保证未软删 Deck 中标题唯一（忽略大小写）；
• 否则返回 409，error.code = "Conflict"。
• 乐观并发：
• SQL 中要求 version = @expectedVersion；
• 更新成功时，version = version + 1；
• 当前版本不匹配时，返回 409，error.code = "VersionConflict"。

示例：
PUT /api/authoring/decks?id=21&title=New%20Title&expectedVersion=4
可能结果：
• 成功：200，返回新的 Deck（version 已经自增）；
• 版本冲突：409，error.code = "VersionConflict"；
• id 不存在或已软删：404，error.code = "NotFound"。

4.5 DELETE /api/authoring/decks?id=…

功能：软删除 Deck。

Query 参数：
• id（必填）：要软删的 Deck 主键。

行为：
• 如果 id 不存在 → 404 + error.code = "NotFound"；
• 如果存在但已软删 → 幂等行为，仍然返回 success；
• 如果存在且未软删 → 将 is_deleted 设为 1，并更新 updated_at。

成功时返回示例：
{
"success": true,
"data": null,
"error": null,
"traceId": "..."
}

## 5. 错误与全局异常处理

5.1 业务错误 – ApiResult

所有业务错误都通过 ApiResult<T> 返回：
• success = false；
• 常见 error.code：
• "BadRequest"：参数错误（例如缺少必填参数、expectedVersion 无效等）；
• "NotFound"：资源不存在或已软删；
• "Conflict"：业务冲突（例如标题重复）；
• "VersionConflict"：乐观并发版本冲突；
• "ServerError"：未处理异常（由全局中间件生成）。
• traceId：每个请求唯一，便于日志定位。

5.2 全局异常中间件 – ApiExceptionMiddleware
• 路径：Infrastructure/Errors/ApiExceptionMiddleware.cs；
• 在 Program.cs 中通过：

    app.UseMiddleware<ApiExceptionMiddleware>();
    进行注册；

    •	捕获所有未处理的异常：
    •	使用 ILogger 记录错误日志（包含异常堆栈和 traceId）；
    •	返回 HTTP 500 + ApiResult<object>，error.code = "ServerError"；
    •	避免将内部异常信息直接暴露给前端。

示例错误响应（服务器内部错误）：
{
"success": false,
"data": null,
"error": {
"code": "ServerError",
"message": "Unexpected server error. Please contact support with traceId."
},
"traceId": "0HNHCHIM6LMSH:0000000C"
}

## 6. 运行与配置

6.1 PostgreSQL 连接字符串

在 appsettings.Development.json 中配置 PostgreSQL 连接：
{
"ConnectionStrings": {
"DecksDb": "Host=localhost;Port=5432;Database=recallsmith;Username=;Password="
}
}
部署到 AWS RDS 时，仅需将 DecksDb 的值替换为 RDS 提供的连接信息。

6.2 启动 API

在 backend/ 目录下执行：
dotnet run --project src/Host/RecallSmith.Api/RecallSmith.Api.csproj
启动成功后，控制台会输出实际监听端口，例如：
Now listening on: http://localhost:5071
在浏览器中访问 Swagger：
http://localhost:5071/swagger
即可在线测试各个接口。

## 7. Authoring vs Catalog（写侧 vs 读侧）简要说明

当前实现的是 Authoring（写侧）：
• 面向管理后台（Web Console）；
• 功能：创建 / 编辑 / 软删 / 管理题库 Deck；
• 数据结构可以灵活演进，支持频繁修改；
• 使用 version 字段控制并发修改，保证写入稳定性。

未来计划的 Catalog（读侧）：
• 面向移动端 App（最终用户）；
• 只读、强调稳定性；
• 数据来源：从 Authoring 通过“发布（Publish）”固化而来，可以是：
• 独立的 catalog_decks / catalog_cards 表（单独的读库）；
• 写入 S3 的静态 JSON 文件，由 App 下载缓存；
• 可按语言 / 区域拆分不同 Catalog 实例：
• 例如 api-global 只允许 en-US；
• api-cn 只允许 zh-CN。

简单理解：
• Web 管理后台 = 使用 Authoring API，能读能写；
• 手机 App = 使用 Catalog API，只读已发布内容。

当前 ReadMe 主要覆盖了 P0 阶段的 Authoring 写侧能力，后续阶段会在此基础上继续扩展 Card、Catalog、发布流程以及 AWS 相关集成。
