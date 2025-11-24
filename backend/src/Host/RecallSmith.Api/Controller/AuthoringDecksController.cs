using Microsoft.AspNetCore.Mvc;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Controllers;

[ApiController]
[Route("api/authoring/decks")]
public class AuthoringDecksController : ControllerBase
{
    // 1 List simulate Database 
    private static readonly List<Deck> _decks = new()
    {
        new Deck { Id = 1, Title  = "Deck 1", Author = "Chuan 1", IsDeleted=0,CreatedAt=0,UpdatedAt=0},
        new Deck { Id = 2, Title  = "Deck 2", Author = "Chuan 2", IsDeleted=0,CreatedAt=0,UpdatedAt=0},
        new Deck { Id = 3, Title  = "Java", Author = "Chuan 3" ,IsDeleted=1,CreatedAt=0,UpdatedAt=0}
    };

    // 1.5 Get the current EpochMs
    private static long NowEpochMs()
    {
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    // 2 Get /api/authoring/decks
    //       /api/authoring/decks?id=1
    [HttpGet]
    public ActionResult<object> Get([FromQuery] int? id)
    {
        // show the list 
        if (id is null)
        {
            // just show all IsDeleted = 0 
            List<Deck> deckList = new List<Deck>();
            foreach (var eachDeck in _decks)
            {
                if (eachDeck.IsDeleted == 0)
                {
                    deckList.Add(eachDeck);
                }
            }

            return Ok(deckList);
        }

        // if id exists;
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

    // 3 Post new Deck 
    // POST /api/authoring/decks
    [HttpPost]
    public ActionResult Post([FromBody] Deck deck)
    {
        //1. deck is not null
        if (deck is null)
        {
            return BadRequest();
        }
        //2. deck.title and author is not null
        if (string.IsNullOrWhiteSpace(deck.Title))
        {
            return BadRequest("Title is required.");
        }
        if (string.IsNullOrWhiteSpace(deck.Author))
        {
            return BadRequest("Author is required.");
        }

        //2.5 Before creating, need to check whehther there is the same title of deck
        foreach (Deck existing in _decks)
        {
            if (existing.IsDeleted == 0 && existing.Title == deck.Title)
            {
                return Conflict($"Deck with the title '{deck.Title}' already exists.");
            }
        }
        //3. create new deck
        // newId is the maximum ID + 1
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

        //4. Add newDeck to Database
        _decks.Add(newDeck);

        //5. Return 201 Created
        string location = $"api/authoring/decks?id={newDeck.Id}";
        return Created(location, newDeck);
    }

    //4. Delete Deck
    // DELETE /api/authoring/decks?id=1
    [HttpDelete]
    public ActionResult Delete([FromQuery] int id)
    {
        //1. Find the deck
        Deck? deck = null;
        foreach (var d in _decks)
        {
            if (d.Id == id && d.IsDeleted == 0)
            {
                deck = d;
                break;
            }
        }

        //2. If not found, return 404
        if (deck is null)
        {
            return NotFound();
        }

        // 3. 有这条记录：
        //    - 如果还没软删，就软删 + 更新 UpdatedAt
        //    - 如果已经软删了，就什么也不做（幂等）

        if (deck.IsDeleted == 0)
        {
            deck.IsDeleted = 1;
            deck.UpdatedAt = NowEpochMs();
        }


        //4. Return 204 No Content
        return NoContent();
    }

    //5 Update the Deck
    [HttpPut]
    public ActionResult Update([FromQuery] int id, [FromQuery] string? title, [FromQuery] string? author)
    {
        //1 Judge request
        if (id <= 0)
        {
            return Conflict("id should be greater than 0");
        }
        string newTitle = title?.Trim();
        string newAuthor = author?.Trim();
        bool hasTitle = !string.IsNullOrWhiteSpace(newTitle);
        bool hasAuthor = !string.IsNullOrWhiteSpace(newAuthor);
        if (!hasTitle && !hasAuthor)
        {
            return BadRequest("At least one of title or author must be provided.");
        }

        //2 find the deck based on id
        Deck? target = null;
        foreach (var deck in _decks)
        {
            if (deck.Id == id)
            {
                target = deck;
                break;
            }
        }
        if (target is null | target.IsDeleted == 1)
        {
            return NotFound();
        }

        //3 update the title, but before that should check whether it exists or not
        for (var i = 0; i < _decks.Count; i++)
        {
            if (_decks[i].Title == newTitle)
            {
                return Conflict($"Deck with the title '{newTitle}' already exists.");
            }
        }
        if (hasTitle)
        {
            //4.1 if title is empty or space
            if (newTitle.Length == 0)
            {
                return BadRequest("Title cannot be empty!");
            }

            //4.2 check the title doest not exist 
            foreach (var other in _decks)
            {
                if (other.Id == target.Id)
                {
                    continue;
                }
                if (other.Title == newTitle && other.IsDeleted == 0)
                {
                    return Conflict($"Deck with the title '{newTitle}' already exists.");
                }
            }

            target.Title = newTitle;
        }

        //4 update the author
        if (hasAuthor)
        {
            if (newAuthor.Length == 0)
            {
                return BadRequest("Author cannot be empty!");
            }
            target.Author = newAuthor;
        }

        //5 update the UpdatedAt time
        target.UpdatedAt = NowEpochMs();

        //6 return the update object 
        return Ok(target);
    }
}