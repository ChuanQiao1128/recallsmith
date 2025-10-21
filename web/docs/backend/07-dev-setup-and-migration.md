本地开发（默认 SQLite）

• 配置：
"AuthoringDb": { "Provider": "sqlite" },
"ConnectionStrings": { "Sqlite": "Data Source=./data/authoring.db" },
"Publishing": { "Mode": "Local", "Local": { "Root": "dist" } },
"Security": { "AdminApiKey": "dev-admin-key" }

• 启动后自动 EnsureCreated()/Migrate()；首次即建表。
• 数据目录：web/backend/host/Admin.Api/data/authoring.db
• 发布目录：web/backend/dist/

切换 RDS for PostgreSQL
• 改配置：
"AuthoringDb": { "Provider": "postgres" },
"ConnectionStrings": { "Postgres": "Host=...;Port=5432;Database=authoring;Username=...;Password=..." },
"Publishing": { "Mode": "S3", "S3": { "Bucket":"your-bucket","Prefix":"recallsmith/","Region":"ap-southeast-2" } }

• 运行 dotnet ef migrations add Initial → dotnet ef database update。
• RDS 安全组开放来自 Admin API 的出站访问。
