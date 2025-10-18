using Microsoft.EntityFrameworkCore;

namespace Catalog.Infrastructure.EfCore;

public class CatalogDbContext : DbContext
{
    public const string Schema = "catalog";

    public CatalogDbContext(DbContextOptions<CatalogDbContext> options) : base(options) { }

    public DbSet<DeckRecord> Decks => Set<DeckRecord>();
    public DbSet<CardRecord> Cards => Set<CardRecord>();
    public DbSet<DeckVersionRecord> DeckVersions => Set<DeckVersionRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);

        modelBuilder.Entity<DeckRecord>(b =>
        {
            b.ToTable("decks");
            b.HasKey(x => x.Id);
            b.Property(x => x.Slug).HasMaxLength(64).IsRequired();
            b.Property(x => x.Title).HasMaxLength(200).IsRequired();
            b.HasIndex(x => x.Slug).IsUnique();
            b.Property(x => x.CreatedAt).HasDefaultValueSql("now() at time zone 'utc'");
            b.UseXminAsConcurrencyToken(); // Postgres 并发控制
        });

        modelBuilder.Entity<CardRecord>(b =>
        {
            b.ToTable("cards");
            b.HasKey(x => x.Id);
            b.Property(x => x.StableUid).HasMaxLength(128).IsRequired();
            b.Property(x => x.FrontMd).IsRequired();
            b.Property(x => x.BackMd).IsRequired();
            b.Property(x => x.KeyPoint).HasMaxLength(512).IsRequired();
            b.Property(x => x.Tags).HasColumnType("text[]");
            b.Property(x => x.Difficulty).HasMaxLength(32);
            b.Property(x => x.CreatedAt).HasDefaultValueSql("now() at time zone 'utc'");
            b.HasIndex(x => new { x.DeckId, x.StableUid }).IsUnique();
            b.UseXminAsConcurrencyToken();
        });

        modelBuilder.Entity<DeckVersionRecord>(b =>
        {
            b.ToTable("deck_versions");
            b.HasKey(x => x.Id);
            b.Property(x => x.Version).HasMaxLength(32).IsRequired();
            b.Property(x => x.PublishedAt).HasDefaultValueSql("now() at time zone 'utc'");
            b.HasIndex(x => new { x.DeckId, x.Version }).IsUnique();
            b.UseXminAsConcurrencyToken();
        });
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var e in ChangeTracker.Entries<IHasAudit>())
        {
            if (e.State == EntityState.Added) e.Entity.CreatedAt = now;
            e.Entity.UpdatedAt = now;
        }
        return base.SaveChangesAsync(cancellationToken);
    }
}

public interface IHasAudit
{
    DateTimeOffset CreatedAt { get; set; }
    DateTimeOffset UpdatedAt { get; set; }
}

public class DeckRecord : IHasAudit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Slug { get; set; } = default!;
    public string Title { get; set; } = default!;
    public string? Locale { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public ICollection<CardRecord> Cards { get; set; } = new List<CardRecord>();
    public ICollection<DeckVersionRecord> Versions { get; set; } = new List<DeckVersionRecord>();
}

public class CardRecord : IHasAudit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DeckId { get; set; }
    public string StableUid { get; set; } = default!;
    public string FrontMd { get; set; } = default!;
    public string BackMd { get; set; } = default!;
    public string KeyPoint { get; set; } = default!;
    public string? Difficulty { get; set; }
    public string[]? Tags { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public DeckRecord? Deck { get; set; }
}

public class DeckVersionRecord : IHasAudit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid DeckId { get; set; }
    public string Version { get; set; } = default!;
    public string? Changelog { get; set; }
    public int TotalCards { get; set; }
    public DateTimeOffset PublishedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public DeckRecord? Deck { get; set; }
}
