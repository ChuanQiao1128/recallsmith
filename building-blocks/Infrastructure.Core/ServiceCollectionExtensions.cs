using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Infrastructure.Core;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddPostgres(this IServiceCollection services, string? connString)
    {
        if (string.IsNullOrWhiteSpace(connString))
            throw new InvalidOperationException("Missing Postgres connection string");
        var dataSource = new NpgsqlDataSourceBuilder(connString).Build();
        services.AddSingleton(dataSource);
        return services;
    }
}