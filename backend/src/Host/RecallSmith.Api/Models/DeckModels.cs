namespace RecallSmith.Api.Models;

public class Deck
{
    public int Id { get; set; } // 整型 Id，将来交给数据库自增
    public string Title { get; set; } = null!;

    public string Author { get; set; } = null!;

    // 0 = 未删除，1 = 已软删
    public int IsDeleted { get; set; }

    public int Version { get; set; }   // ⭐ 新增：用于乐观并发

    public long CreatedAt { get; set; }

    public long UpdatedAt { get; set; }

}