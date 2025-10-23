using Authoring.Infrastructure.EfCore;
using Authoring.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Authoring.Infrastructure;

public static class DependencyInjection
{
    /// <summary>
    /// 向 Host 注册 Authoring 模块（DbContext + 服务）
    /// </summary>
    public static IServiceCollection AddAuthoringModule(this IServiceCollection services, IConfiguration cfg)
    {
        var conn = cfg.GetConnectionString("AuthoringDb") ?? "Data Source=./data/authoring.db";

        services.AddDbContext<AuthoringDbContext>(options =>
        {
            options.UseSqlite(conn);
        });

        services.AddScoped<AuthoringService>();
        return services;
    }
}