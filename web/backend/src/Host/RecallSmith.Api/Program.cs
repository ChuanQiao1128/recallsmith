using RecallSmith.Api.Config;
using RecallSmith.Api.Filters;
using Authoring.Infrastructure;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// Serilog
builder.Host.UseSerilog((ctx, cfg) =>
    cfg.ReadFrom.Configuration(ctx.Configuration)
       .Enrich.FromLogContext()
       .WriteTo.Console());

// 基础能力
builder.Services.AddHealthChecks();
builder.Services.AddCustomControllers();
builder.Services.AddCustomSwagger();

// 业务模块
builder.Services.AddAuthoringModule(builder.Configuration);

var app = builder.Build();

app.UseSerilogRequestLogging();

app.UseRouting();
app.UseAuthorization();

app.UseCustomSwagger(app.Environment);

app.MapHealthChecks("/health");
app.MapControllers();

app.Run();