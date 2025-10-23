namespace Authoring.Core.Contracts.Deck;

public sealed class DeckQuery
{
    public string? Q { get; set; }

    /// <summary>slug/title/createdAt/updatedAt；默认：null（不排序）</summary>
    public string? SortBy { get; set; }

    /// <summary>asc/desc；仅当 SortBy 指定时有效；默认 desc</summary>
    public string? SortDir { get; set; }

    /// <summary>页码（1-based；null 表示不分页=全量）</summary>
    public int? Page { get; set; }

    /// <summary>每页大小（null 表示不分页=全量）</summary>
    public int? PageSize { get; set; }

    public void Normalize()
    {
        SortBy = NormalizeSortKey(SortBy);
        if (SortBy is null)
        {
            // 明确：默认不排序
            SortDir = null;
        }
        else
        {
            SortDir = (SortDir ?? "desc").Trim().ToLowerInvariant();
            if (SortDir != "asc" && SortDir != "desc") SortDir = "desc";
        }

        if (Page.HasValue && Page.Value < 1) Page = 1;

        if (PageSize.HasValue)
        {
            if (PageSize.Value <= 0) PageSize = 20;
            if (PageSize.Value > 100) PageSize = 100;

            // 只给了 PageSize 没给 Page，则默认第一页
            if (!Page.HasValue) Page = 1;
        }
    }

    private static string? NormalizeSortKey(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var letters = raw.Where(char.IsLetter).ToArray();
        return new string(letters).ToLowerInvariant(); // created-at / created_at -> createdat
    }
}