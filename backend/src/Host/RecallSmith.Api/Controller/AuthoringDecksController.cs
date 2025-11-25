using Microsoft.AspNetCore.Mvc;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Controllers;

[ApiController]
[Route("api/authoring/decks")]
public class AuthoringDecksController : ControllerBase
{
    // 1. List simulate Database 
    // 1. List simulate Database 
    private static readonly List<Deck> _decks = new()
{
    new Deck { Id = 1,  Title = "Introduction to C#",              Author = "Alice Johnson",     IsDeleted = 0, CreatedAt = 1710000010, UpdatedAt = 0 },
    new Deck { Id = 2,  Title = "ASP.NET Core Fundamentals",        Author = "Brian Walker",      IsDeleted = 0, CreatedAt = 1710000500, UpdatedAt = 0 },
    new Deck { Id = 3,  Title = "Java Interview Questions",         Author = "Kevin Smith",       IsDeleted = 0, CreatedAt = 1710001200, UpdatedAt = 0 },
    new Deck { Id = 4,  Title = "Advanced JavaScript Techniques",   Author = "Linda Davis",       IsDeleted = 0, CreatedAt = 1710001500, UpdatedAt = 0 },
    new Deck { Id = 5,  Title = "TypeScript Best Practices",        Author = "Michael Brown",     IsDeleted = 0, CreatedAt = 1710001800, UpdatedAt = 0 },
    new Deck { Id = 6,  Title = "React vs Vue: A Comparison",       Author = "Sarah Wilson",      IsDeleted = 0, CreatedAt = 1710002100, UpdatedAt = 0 },
    new Deck { Id = 7,  Title = "SQL Basics for Beginners",         Author = "Tom Harris",        IsDeleted = 0, CreatedAt = 1710002400, UpdatedAt = 0 },
    new Deck { Id = 8,  Title = "PostgreSQL Practical Guide",       Author = "Ivy Thompson",      IsDeleted = 1, CreatedAt = 1710002600, UpdatedAt = 1710003600 },
    new Deck { Id = 9,  Title = "Linux Command Line Essentials",    Author = "Jason Miller",      IsDeleted = 0, CreatedAt = 1710003000, UpdatedAt = 0 },
    new Deck { Id = 10, Title = "Docker for Developers",            Author = "Emily Clark",       IsDeleted = 0, CreatedAt = 1710003300, UpdatedAt = 0 },
    new Deck { Id = 11, Title = "Kubernetes Crash Course",          Author = "Chris Robinson",    IsDeleted = 0, CreatedAt = 1710003600, UpdatedAt = 0 },
    new Deck { Id = 12, Title = "Python Data Analysis",             Author = "Olivia Martinez",   IsDeleted = 0, CreatedAt = 1710003900, UpdatedAt = 0 },
    new Deck { Id = 13, Title = "Machine Learning Basics",          Author = "Daniel Garcia",     IsDeleted = 0, CreatedAt = 1710004200, UpdatedAt = 0 },
    new Deck { Id = 14, Title = "REST API Design Principles",       Author = "Sophia Rodriguez",  IsDeleted = 0, CreatedAt = 1710004500, UpdatedAt = 0 },
    new Deck { Id = 15, Title = "Git and GitHub Workflow",          Author = "Matthew Lee",       IsDeleted = 0, CreatedAt = 1710004800, UpdatedAt = 0 },
    new Deck { Id = 16, Title = "Agile Software Development",       Author = "Chloe Walker",      IsDeleted = 0, CreatedAt = 1710005100, UpdatedAt = 0 },
    new Deck { Id = 17, Title = "Cloud Computing Overview",         Author = "Ethan Hall",        IsDeleted = 0, CreatedAt = 1710005400, UpdatedAt = 0 },
    new Deck { Id = 18, Title = "Cybersecurity Fundamentals",       Author = "Grace Allen",       IsDeleted = 1, CreatedAt = 1710005700, UpdatedAt = 1710006800 },
    new Deck { Id = 19, Title = "DevOps Best Practices",            Author = "Nathan Scott",      IsDeleted = 0, CreatedAt = 1710006000, UpdatedAt = 0 },
    new Deck { Id = 20, Title = "Clean Code Principles",            Author = "Hannah King",       IsDeleted = 0, CreatedAt = 1710006300, UpdatedAt = 0 }
};

    // 10 items on each page 
    private const int PageSize = 10;

    // 1.5 Get the current EpochMs
    private static long NowEpochMs()
    {
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    // GET /api/authoring/decks
    // GET /api/authoring/decks?id=1
    // GET /api/authoring/decks?sortbyCreatedAt=asc or desc
    // GET /api/authoring/decks?title=java
    [HttpGet]
    public ActionResult<object> Get(
        [FromQuery] int? id,
        [FromQuery] string? title,
        [FromQuery] string? sortbyCreatedAt,
        [FromQuery] int? currentPage)
    {
        // ========= 列表 =========
        if (id is null)
        {
            // 1. 过滤未删除 + title 模糊匹配
            List<Deck> deckList = new List<Deck>();

            string? keyword = null;
            if (!string.IsNullOrWhiteSpace(title))
            {
                keyword = title.Trim();
            }
            bool hasKeyword = !string.IsNullOrWhiteSpace(keyword);

            foreach (var eachDeck in _decks)
            {
                if (eachDeck.IsDeleted != 0)
                {
                    continue;
                }

                if (!hasKeyword)
                {
                    deckList.Add(eachDeck);
                }
                else
                {
                    if (eachDeck.Title.Contains(keyword!, StringComparison.OrdinalIgnoreCase))
                    {
                        deckList.Add(eachDeck);
                    }
                }
            }

            // 2. 排序
            bool sortByCreatedAtAsc = true; // 默认 asc

            if (!string.IsNullOrWhiteSpace(sortbyCreatedAt))
            {
                string normalized = sortbyCreatedAt.Trim().ToLowerInvariant();
                if (normalized == "asc")
                {
                    sortByCreatedAtAsc = true;
                }
                else if (normalized == "desc")
                {
                    sortByCreatedAtAsc = false;
                }
            }

            for (int i = 0; i < deckList.Count - 1; i++)
            {
                for (int j = i + 1; j < deckList.Count; j++)
                {
                    bool doSwap = false;

                    if (sortByCreatedAtAsc)
                    {
                        if (deckList[i].CreatedAt > deckList[j].CreatedAt)
                        {
                            doSwap = true;
                        }
                    }
                    else
                    {
                        if (deckList[i].CreatedAt < deckList[j].CreatedAt)
                        {
                            doSwap = true;
                        }
                    }

                    if (doSwap)
                    {
                        Deck temp = deckList[i];
                        deckList[i] = deckList[j];
                        deckList[j] = temp;
                    }
                }
            }

            // 3. 分页
            if (currentPage == null || currentPage <= 0)
            {
                currentPage = 1;
            }

            int startIndex = (currentPage.Value - 1) * PageSize;
            int endIndex = startIndex + PageSize;

            List<Deck> pageList = new List<Deck>();
            for (int i = startIndex; i < endIndex; i++)
            {
                if (i >= deckList.Count)
                {
                    break;
                }
                pageList.Add(deckList[i]);
            }

            return Ok(pageList);
        }

        // ========= 单个 =========
        Deck? deck = null;
        foreach (var d in _decks)
        {
            if (d.Id == id.Value && d.IsDeleted == 0)
            {
                deck = d;
                break;
            }
        }

        if (deck is null)
        {
            return NotFound();
        }

        return Ok(deck);
    }

    // 3. POST /api/authoring/decks
    [HttpPost]
    public ActionResult Post([FromBody] Deck deck)
    {
        if (deck is null)
        {
            return BadRequest();
        }
        if (string.IsNullOrWhiteSpace(deck.Title))
        {
            return BadRequest("Title is required.");
        }
        if (string.IsNullOrWhiteSpace(deck.Author))
        {
            return BadRequest("Author is required.");
        }

        foreach (Deck existing in _decks)
        {
            if (existing.IsDeleted == 0 && existing.Title == deck.Title)
            {
                return Conflict($"Deck with the title '{deck.Title}' already exists.");
            }
        }

        int newId = _decks.Any() ? _decks.Max(d => d.Id) + 1 : 1;
        long now = NowEpochMs();

        var newDeck = new Deck
        {
            Id = newId,
            Title = deck.Title,
            Author = deck.Author,
            IsDeleted = 0,
            CreatedAt = now,
            UpdatedAt = now,
        };

        _decks.Add(newDeck);

        string location = $"api/authoring/decks?id={newDeck.Id}";
        return Created(location, newDeck);
    }

    // 4. DELETE /api/authoring/decks?id=1
    [HttpDelete]
    public ActionResult Delete([FromQuery] int id)
    {
        Deck? deck = null;
        foreach (var d in _decks)
        {
            if (d.Id == id)
            {
                deck = d;
                break;
            }
        }

        if (deck is null)
        {
            return NotFound();
        }

        if (deck.IsDeleted == 0)
        {
            deck.IsDeleted = 1;
            deck.UpdatedAt = NowEpochMs();
        }

        return NoContent();
    }

    // 5. PUT /api/authoring/decks?id=1&title=xxx&author=yyy
    [HttpPut]
    public ActionResult Update([FromQuery] int id, [FromQuery] string? title, [FromQuery] string? author)
    {
        if (id <= 0)
        {
            return BadRequest("id should be greater than 0");
        }

        string? newTitle = title?.Trim();
        string? newAuthor = author?.Trim();

        bool hasTitle = !string.IsNullOrWhiteSpace(newTitle);
        bool hasAuthor = !string.IsNullOrWhiteSpace(newAuthor);

        if (!hasTitle && !hasAuthor)
        {
            return BadRequest("At least one of title or author must be provided.");
        }

        Deck? target = null;
        foreach (var deck in _decks)
        {
            if (deck.Id == id)
            {
                target = deck;
                break;
            }
        }

        if (target is null || target.IsDeleted == 1)
        {
            return NotFound();
        }

        if (hasTitle)
        {
            // 这里 newTitle 一定非 null/空白，其实不用再判 Length == 0
            foreach (var other in _decks)
            {
                if (other.Id == target.Id)
                {
                    continue;
                }

                if (other.IsDeleted == 0 && other.Title == newTitle)
                {
                    return Conflict($"Deck with the title '{newTitle}' already exists.");
                }
            }

            target.Title = newTitle!;
        }

        if (hasAuthor)
        {
            if (newAuthor!.Length == 0)
            {
                return BadRequest("Author cannot be empty!");
            }
            target.Author = newAuthor;
        }

        target.UpdatedAt = NowEpochMs();

        return Ok(target);
    }
}