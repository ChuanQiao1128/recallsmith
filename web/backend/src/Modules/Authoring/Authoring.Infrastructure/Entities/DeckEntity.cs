namespace Authoring.Infrastructure.Entities;

public sealed class DeckEntity
{
    public Guid DeckId { get; set; }
    public string Slug { get; set; } = null!;
    public string Title { get; set; } = null!;
    public string? Locale { get; set; }

    // 统一存 UTC；我们已经把映射改成 epoch ms（INTEGER），排序无坑
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public bool IsDeleted { get; set; }

    // ✅ 新增：并发版本号
    public long Version { get; set; }
}