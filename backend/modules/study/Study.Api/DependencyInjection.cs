using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Study.Application;
using Study.Infrastructure;
using Study.Infrastructure.EfCore;

namespace Study.Api;

public static class DependencyInjection
{
    public static IServiceCollection AddStudyModule(this IServiceCollection services, IConfiguration config)
    {
        var cs = config.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException("Postgres connection string not found");

        services.AddDbContext<StudyDbContext>(opt =>
            opt.UseNpgsql(cs, b => b.MigrationsHistoryTable("__EFMigrationsHistory", "study")));

        services.AddScoped<IStudyUserService, StudyUserService>();
        return services;
    }
}
