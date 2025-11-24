var builder = WebApplication.CreateBuilder(args);

//1 Service /DI
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

//2 App
var app = builder.Build();

//3 Swagger
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

//4 Controllers
app.MapControllers();

//5 Run
app.Run();