using Microsoft.AspNetCore.Mvc;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Controllers;

[ApiController]
[Route("api/authoring/decks")]
public class AuthoringDecksController : ControllerBase
{
    // 1. List simulate Database 
    private static readonly List<Deck> _decks = new()
    {
        new Deck { Id = 1, Title  = "Deck 1",       Author = "Chuan 1", IsDeleted = 0, CreatedAt = 1,    UpdatedAt = 0 },
        new Deck { Id = 2, Title  = "Deck 2",       Author = "Chuan 2", IsDeleted = 1, CreatedAt = 22,   UpdatedAt = 0 },
        new Deck { Id = 3, Title  = "Java",         Author = "Chuan 3", IsDeleted = 0, CreatedAt = 333,  UpdatedAt = 0 },
        new Deck { Id = 4, Title  = "JavaScript",   Author = "Chuan 4", IsDeleted = 0, CreatedAt = 4444, UpdatedAt = 0 }
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
            bool sortByCreatedAtDesc = true; // 默认 desc

            if (!string.IsNullOrWhiteSpace(sortbyCreatedAt))
            {
                string normalized = sortbyCreatedAt.Trim().ToLowerInvariant();
                if (normalized == "asc")
                {
                    sortByCreatedAtDesc = false;
                }
                else if (normalized == "desc")
                {
                    sortByCreatedAtDesc = true;
                }
            }

            for (int i = 0; i < deckList.Count - 1; i++)
            {
                for (int j = i + 1; j < deckList.Count; j++)
                {
                    bool doSwap = false;

                    if (sortByCreatedAtDesc)
                    {
                        if (deckList[i].CreatedAt < deckList[j].CreatedAt)
                        {
                            doSwap = true;
                        }
                    }
                    else
                    {
                        if (deckList[i].CreatedAt > deckList[j].CreatedAt)
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