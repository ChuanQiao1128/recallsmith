using Catalog.Application;
using Catalog.Infrastructure;
using Catalog.Infrastructure.EfCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Catalog.Api;

public static class DependencyInjection
{
    public static IServiceCollection AddCatalogModule(this IServiceCollection services, IConfiguration configuration)
    {
        // 连接串：优先 Postgres，其次 Default
        var conn =
            configuration.GetConnectionString("Postgres")
            ?? configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("Missing connection string 'Postgres' or 'Default'.");

        // DbContext（Npgsql）
        services.AddDbContext<CatalogDbContext>(opts => opts.UseNpgsql(conn));

        // 读配置决定是否用 Mock 查询
        var mockQueries = configuration.GetSection("Features").GetValue<bool>("MockQueries");

        services.AddScoped<ICatalogAdminService, CatalogAdminService>();
        if (mockQueries)
            services.AddScoped<ICatalogQueryService, MockCatalogQueryService>();
        else
            services.AddScoped<ICatalogQueryService, CatalogQueryService>();

        return services;
    }
}
