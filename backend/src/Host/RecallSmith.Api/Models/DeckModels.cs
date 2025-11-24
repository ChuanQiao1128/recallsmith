namespace RecallSmith.Api.Models;

public class Deck
{
    public int Id { get; set; } // 整型 Id，将来交给数据库自增
    public string Title { get; set; } = null!;

    public string Author { get; set; } = null!;

    public int IsDeleted { get; set; } = 0;

}