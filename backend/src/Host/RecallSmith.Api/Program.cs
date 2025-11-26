using RecallSmith.Api.Application.Decks;
using RecallSmith.Api.Infrastructure.Decks;
using RecallSmith.Api.Infrastructure.Errors;

var builder = WebApplication.CreateBuilder(args);

// 注册 MVC Controller
builder.Services.AddControllers();

// Swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ⭐ 注册 Repository 和 Service（关键）
builder.Services.AddScoped<IDeckRepository, DeckRepository>();
builder.Services.AddScoped<IDeckService, DeckService>();

var app = builder.Build();

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