using Authoring.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Authoring.Infrastructure.EfCore;

public class AuthoringDbContext(DbContextOptions<AuthoringDbContext> options) : DbContext(options)
{
    public DbSet<DeckEntity> Decks => Set<DeckEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AuthoringDbContext).Assembly);
    }
}