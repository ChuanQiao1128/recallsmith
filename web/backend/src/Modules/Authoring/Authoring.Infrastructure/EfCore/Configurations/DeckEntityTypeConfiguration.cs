using Authoring.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Authoring.Infrastructure.EfCore.Configurations;

/// <summary>
/// Entity type configuration for DeckEntity
/// </summary>
public sealed class DeckEntityTypeConfiguration : IEntityTypeConfiguration<DeckEntity>
{
    public void Configure(EntityTypeBuilder<DeckEntity> builder)
    {
        builder.ToTable("authoring_decks");

        builder.HasKey(x => x.DeckId);
        builder.Property(x => x.DeckId).ValueGeneratedNever();

        builder.Property(x => x.Slug)
            .IsRequired()
            .HasMaxLength(200);
        builder.HasIndex(x => x.Slug).IsUnique();

        builder.Property(x => x.Title)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(x => x.Locale).HasMaxLength(20);

        // 已有：把 DateTimeOffset 映射成 epoch ms
        builder.Property(x => x.CreatedAt)
            .HasConversion(v => v.ToUnixTimeMilliseconds(),
                           v => DateTimeOffset.FromUnixTimeMilliseconds(v));
        builder.Property(x => x.UpdatedAt)
            .HasConversion(v => v.ToUnixTimeMilliseconds(),
                           v => DateTimeOffset.FromUnixTimeMilliseconds(v));

        builder.Property(x => x.IsDeleted).IsRequired();

        // ✅ 新增：并发令牌
        builder.Property(x => x.Version)
            .IsRequired()
            .IsConcurrencyToken(); // 让 EF 在 WHERE 子句带上原始版本
    }
}