using Microsoft.EntityFrameworkCore;

namespace Study.Infrastructure.EfCore;

public class StudyDbContext : DbContext
{
    public const string Schema = "study";

    public StudyDbContext(DbContextOptions<StudyDbContext> options) : base(options) { }

    public DbSet<UserDeckRecord> UserDecks => Set<UserDeckRecord>();
    public DbSet<UserCardRecord> UserCards => Set<UserCardRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);

        modelBuilder.Entity<UserDeckRecord>(b =>
        {
            b.ToTable("user_decks");
            b.HasKey(x => x.Id);
            b.HasIndex(x => new { x.UserId, x.CatalogDeckId }).IsUnique();
            b.Property(x => x.Version).HasMaxLength(32).IsRequired();
            b.Property(x => x.AppliedAt).HasDefaultValueSql("now() at time zone 'utc'");
            b.Property<uint>("xmin").HasColumnType("xid").ValueGeneratedOnAddOrUpdate().IsConcurrencyToken();
        });

        modelBuilder.Entity<UserCardRecord>(b =>
        {
            b.ToTable("user_cards");
            b.HasKey(x => x.Id);
            b.HasIndex(x => new { x.UserDeckId, x.SourceCardId }).IsUnique();
            b.Property(x => x.ContentHash).HasMaxLength(128).IsRequired();
            b.Property<uint>("xmin").HasColumnType("xid").ValueGeneratedOnAddOrUpdate().IsConcurrencyToken();
        });
    }
}

public class UserDeckRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid CatalogDeckId { get; set; }
    public string Version { get; set; } = default!;
    public DateTimeOffset AppliedAt { get; set; }
}

public class UserCardRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserDeckId { get; set; }
    public Guid SourceCardId { get; set; }
    public string StableUid { get; set; } = default!;
    public string ContentHash { get; set; } = default!;
}
