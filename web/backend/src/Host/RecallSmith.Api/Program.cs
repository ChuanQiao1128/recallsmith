using Serilog;

var builder = WebApplication.CreateBuilder(args);

// Serilog（控制台）——生产再做分环境
builder.Host.UseSerilog((ctx, cfg) =>
    cfg.ReadFrom.Configuration(ctx.Configuration)
       .Enrich.FromLogContext()
       .WriteTo.Console());

// 基础服务
builder.Services.AddControllers();           // 会扫描引用程序集中的 Controller（Catalog.Api）
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHealthChecks();

var app = builder.Build();

app.MapHealthChecks("/health");
app.MapControllers();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.Run();