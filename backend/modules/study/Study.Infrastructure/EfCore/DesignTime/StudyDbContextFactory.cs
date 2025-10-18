using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Study.Infrastructure.EfCore;

public sealed class StudyDbContextFactory : IDesignTimeDbContextFactory<StudyDbContext>
{
    public StudyDbContext CreateDbContext(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("ConnectionStrings__Postgres")
                 ?? "Host=localhost;Port=5432;Database=recallsmith_dev;Username=postgres;Password=postgres";

        var options = new DbContextOptionsBuilder<StudyDbContext>()
            .UseNpgsql(cs)
            .Options;

        return new StudyDbContext(options);
    }
}
