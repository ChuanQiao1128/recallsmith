using Catalog.Application;
using Catalog.Infrastructure;
using Catalog.Infrastructure.EfCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Catalog.Api;

public static class DependencyInjection
{
    public static IServiceCollection AddCatalogModule(this IServiceCollection services, IConfiguration cfg)
    {
        var cs = cfg.GetConnectionString("Postgres")
                 ?? throw new InvalidOperationException("ConnectionStrings:Postgres missing");

        services.AddDbContext<CatalogDbContext>(opt =>
            opt.UseNpgsql(cs, b => b.MigrationsHistoryTable("__EFMigrationsHistory", CatalogDbContext.Schema)));

        services.AddScoped<ICatalogAdminService, CatalogAdminService>();
        services.AddScoped<ICatalogQueryService, CatalogQueryService>();

        return services;
    }
}
