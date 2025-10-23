using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Authoring.Infrastructure.EfCore;

/// <summary>
/// 设计时（dotnet-ef）创建 DbContext 的工厂，避免 CLI 因无法构建 WebHost 而失败。
/// 优先读取环境变量 ConnectionStrings__AuthoringDb，否则退回到当前目录下的 ./data/authoring.db。
/// </summary>
public sealed class AuthoringDbContextFactory : IDesignTimeDbContextFactory<AuthoringDbContext>
{
    public AuthoringDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AuthoringDbContext>();

        // 优先用环境变量（推荐设为绝对路径），否则使用 ./data/authoring.db
        var conn = Environment.GetEnvironmentVariable("ConnectionStrings__AuthoringDb")
                  ?? "Data Source=./data/authoring.db";

        options.UseSqlite(conn);
        return new AuthoringDbContext(options.Options);
    }
}