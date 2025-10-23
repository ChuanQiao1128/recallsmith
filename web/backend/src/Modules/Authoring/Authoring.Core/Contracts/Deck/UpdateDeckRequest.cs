namespace Authoring.Core.Contracts.Deck;

public sealed class UpdateDeckRequest
{
    public string Title { get; set; } = null!;
    public string? Locale { get; set; }

    // ✅ 新增：乐观并发的期望版本
    public long ExpectedVersion { get; set; }
}