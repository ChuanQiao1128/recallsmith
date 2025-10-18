using Catalog.Api;
using Serilog;
using HealthChecks.NpgSql;
using Microsoft.AspNetCore.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using Infrastructure.Core;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCatalogModule(builder.Configuration);

// Serilog
builder.Host.UseSerilog((ctx, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext());

// JSON 命名策略
builder.Services.Configure<JsonOptions>(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

// Swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Health Checks (Postgres)
var pgConn = builder.Configuration.GetConnectionString("Postgres")
             ?? throw new InvalidOperationException("Postgres connection string not found");
builder.Services.AddHealthChecks().AddNpgSql(pgConn, name: "postgres");

// 若你在 Infrastructure.Core 里有 AddPostgres 扩展（NpgsqlDataSource 等），保留这一行
builder.Services.AddPostgres(pgConn);

// CORS
builder.Services.AddCors(o =>
{
    o.AddPolicy("AdminDev", p => p
        .WithOrigins("http://localhost:5173", "http://localhost:3000")
        .AllowAnyHeader()
        .AllowAnyMethod());
});

// Controllers（我们自行做错误处理，先关闭默认的 400 自动返回）
builder.Services.AddControllers().ConfigureApiBehaviorOptions(o =>
{
    o.SuppressModelStateInvalidFilter = true;
});

// === 注册模块（Controller 版本）===
// TODO: Add module registrations when modules are implemented

var app = builder.Build();

app.UseSerilogRequestLogging();
app.UseCors("AdminDev");

app.UseSwagger();
app.UseSwaggerUI();

app.MapHealthChecks("/health");

// 统一异常处理（移除不存在的 ToStatusCode 扩展，改回 switch）
app.UseExceptionHandler(appErr =>
{
    appErr.Run(async ctx =>
    {
        ctx.Response.ContentType = "application/json";
        var feat = ctx.Features.Get<IExceptionHandlerPathFeature>();
        var ex = feat?.Error;

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
        var payload = new
        {
            error = new
            {
                code = (ex as SharedKernel.AppException)?.Code.ToString() ?? "Unexpected",
                message = ex?.Message
            }
        };
        await ctx.Response.WriteAsJsonAsync(payload);
    });
});

// 使用 Controller 路由（Minimal API 已移除）
app.MapControllers();

app.Run();
