1.  分层
    API (Controllers, DTO)
    -> Application (用例服务、校验、组合)
    -> Infrastructure (EF Core 仓储、Dapper/SQL、对象存储)
    -> Database (SQLite/Postgres)
    -> Object Storage (LocalDir/S3)

        •	API：HTTP 控制器、模型绑定（这里遵循“query 传标识、body 传内容”的约定；也允许纯 query 可用的场景）。
        •	Application：接口定义与业务用例（创建/更新/发布/查询），聚合验证，控制事务边界。
        •	Infrastructure：EF Core 上下文、仓储实现、S3 上传器、本地发布目录写入器。
        •	Contracts：API DTO/契约隔离（便于前后端协作与演进）。
        •	SharedKernel：通用异常（AppException）、返回模型、分页、Guard、验证基础等。

2.  项目结构（建议）
    web/
    backend/
    building-blocks/
    SharedKernel/
    Contracts/
    modules/
    catalog/
    Catalog.Domain/
    Catalog.Application/
    Catalog.Infrastructure/
    Catalog.Api/
    publishing/
    Publisher.Core/
    Publisher.Cli/ # 可选：命令行手动发布
    host/
    Admin.Api/ # 汇聚模块 + 健康检查 + 鉴权 + 配置
    docs/
    backend/
    01-overview.md
    02-architecture.md
    03-domain-and-data-model.md
    04-api-spec.md
    05-publishing-spec.md
    06-security-observability.md
    07-dev-setup-and-migration.md
    08-deployment-and-s3.md
    09-test-strategy.md
    10-future-work.md
