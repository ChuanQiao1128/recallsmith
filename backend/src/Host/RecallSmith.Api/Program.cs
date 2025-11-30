using RecallSmith.Api.Application.Cards;
using RecallSmith.Api.Application.Decks;
using RecallSmith.Api.Infrastructure.Cards;
using RecallSmith.Api.Infrastructure.Decks;
using RecallSmith.Api.Infrastructure.Errors;
using RecallSmith.Api.Application.Catalog;
using RecallSmith.Api.Infrastructure.Catalog;
using RecallSmith.Api.Application.Publishing;


var builder = WebApplication.CreateBuilder(args);

// CORS 配置：允许前端本地开发地址
var allowedOrigins = new[] { "http://localhost:5173" };

builder.Services.AddCors(options =>
{
    options.AddPolicy("FrontendDevCors", policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// 注册 MVC Controller
builder.Services.AddControllers();

// Swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ⭐ 注册 Repository 和 Service（关键）
// Authoring - Decks
builder.Services.AddScoped<IDeckRepository, DeckRepository>();
builder.Services.AddScoped<IDeckService, DeckService>();

// Authoring - Cards
builder.Services.AddScoped<ICardRepository, CardRepository>();
builder.Services.AddScoped<ICardService, CardService>();

// Catalog - Decks
builder.Services.AddScoped<ICatalogDeckRepository, CatalogDeckRepository>();
builder.Services.AddScoped<ICatalogDeckService, CatalogDeckService>();

// Catalog - Cards ★ 新增的两行
builder.Services.AddScoped<ICatalogCardRepository, CatalogCardRepository>();
builder.Services.AddScoped<ICatalogCardService, RecallSmith.Api.Application.Catalog.CatalogCardService>();

// Catalog - Export ★ 新增
builder.Services.AddScoped<ICatalogExportService, CatalogExportService>();

// Publishing
builder.Services.AddScoped<IDeckPublishingService, DeckPublishingService>();

var app = builder.Build();

// 使用 CORS（要在映射 endpoints 之前）
app.UseCors("FrontendDevCors");

if (app.Environment.IsDevelopment())
{
    // app.UseDeveloperExceptionPage();  // 不再使用 DeveloperExceptionPage，避免吞掉我们的统一错误格式
    app.UseSwagger();
    app.UseSwaggerUI();
}

// ⭐ 全局异常处理中间件（尽量靠前）
app.UseMiddleware<ApiExceptionMiddleware>();

app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.Run();