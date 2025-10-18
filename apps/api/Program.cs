using Serilog;
using HealthChecks.NpgSql;
using Microsoft.AspNetCore.Http.Json;
using Catalog.Api;
using Study.Api;
using Infrastructure.Core;
using System.Text.Json;
var builder = WebApplication.CreateBuilder(args);

// Serilog
builder.Host.UseSerilog((ctx, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext());

// Services
// builder.Services.Configure<JsonOptions>(o => { o.SerializerOptions.PropertyNamingPolicy = null; });
builder.Services.Configure<JsonOptions>(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    // 反序列化默认大小写不敏感，前端传 camelCase/ PascalCase 都能绑上；若要显式：
    // o.SerializerOptions.PropertyNameCaseInsensitive = true;
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();


// Health checks (Postgres)
var pgConn = builder.Configuration.GetConnectionString("Postgres");
builder.Services.AddHealthChecks()
    .AddNpgSql(pgConn ?? throw new InvalidOperationException("Postgres connection string not found"), name: "postgres");
builder.Services.AddPostgres(pgConn);

// === Route groups (v1) ===
var adminGroup = "/api/admin/v1";
var catalogGroup = "/api/catalog/v1";
var userGroup = "/api/user/v1";

// Compose module endpoints (from modules' *.Api assemblies)
builder.Services.AddCatalogModule(builder.Configuration);
builder.Services.AddStudyModule(builder.Configuration);
builder.Services.AddCors(o =>
{
    o.AddPolicy("AdminDev", p =>
        p.WithOrigins("http://localhost:5173", "http://localhost:3000")
         .AllowAnyHeader()
         .AllowAnyMethod());
});
var app = builder.Build();

app.UseSerilogRequestLogging();
app.UseCors("AdminDev");

app.UseSwagger();
app.UseSwaggerUI();

// Liveness/Readiness
app.MapHealthChecks("/health");
// exception Json
app.UseExceptionHandler(appErr =>
{
    appErr.Run(async ctx =>
    {
        ctx.Response.ContentType = "application/json";
        // 默认 500；如果是 AppException，映射到具体状态码
        var feat = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerPathFeature>();
        var ex = feat?.Error;

        // 新增：把参数/绑定错误映射为 400
        if (ex is BadHttpRequestException badReq)
        {
            ctx.Response.StatusCode = badReq.StatusCode; // 通常是 400
            await ctx.Response.WriteAsJsonAsync(new { error = new { code = "BadRequest", message = ex.Message } });
            return;
        }

        int status = ex is SharedKernel.AppException aex
            ? aex.Code switch
            {
                SharedKernel.ErrorCode.Validation => StatusCodes.Status422UnprocessableEntity,
                SharedKernel.ErrorCode.NotFound => StatusCodes.Status404NotFound,
                SharedKernel.ErrorCode.Conflict => StatusCodes.Status409Conflict,
                _ => StatusCodes.Status500InternalServerError
            }
            : StatusCodes.Status500InternalServerError;

        ctx.Response.StatusCode = status;
        var payload = new { error = new { code = (ex as SharedKernel.AppException)?.Code.ToString() ?? "Unexpected", message = ex?.Message } };
        await ctx.Response.WriteAsJsonAsync(payload);
    });
});
// --- Ping endpoints (placeholders) ---
app.MapGet($"{adminGroup}/ping", () => Results.Ok(new { area = "admin", status = "ok" }));
app.MapGet($"{catalogGroup}/ping", () => Results.Ok(new { area = "catalog", status = "ok" }));
app.MapGet($"{userGroup}/ping", () => Results.Ok(new { area = "user", status = "ok" }));

// Module-specific endpoints register here
app.MapCatalogAdminEndpoints(adminGroup);
app.MapCatalogAdminQueryEndpoints(adminGroup);   // <- 加上这一行
app.MapCatalogPublicEndpoints(catalogGroup);
app.MapStudyUserEndpoints(userGroup);

app.Run();
