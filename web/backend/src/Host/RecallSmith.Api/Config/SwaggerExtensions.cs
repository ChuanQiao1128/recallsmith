using Microsoft.OpenApi.Models;

namespace RecallSmith.Api.Config;

public static class SwaggerExtensions
{
    public static IServiceCollection AddCustomSwagger(this IServiceCollection services)
    {
        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen(c =>
        {
            c.SwaggerDoc("v1", new OpenApiInfo
            {
                Title = "RecallSmith Authoring API",
                Version = "v1",
                Description = "Authoring (Decks) CRUD without versioned routes."
            });
        });
        return services;
    }

    public static void UseCustomSwagger(this IApplicationBuilder app, IWebHostEnvironment env)
    {
        if (env.IsDevelopment())
        {
            app.UseSwagger();
            app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "Authoring API v1"));
        }
    }
}