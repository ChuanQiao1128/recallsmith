using RecallSmith.Api.Application.Decks;
using RecallSmith.Api.Infrastructure.Decks;

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
    app.UseDeveloperExceptionPage();
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.Run();