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
        new Deck { Id = 1, Title  = "Deck 1", Author = "Chuan 1", IsDeleted=0},
        new Deck { Id = 2, Title  = "Deck 2", Author = "Chuan 2", IsDeleted=0},
        new Deck { Id = 3, Title  = "Java", Author = "Chuan 3" ,IsDeleted=1}
    };

    // 2 Get /api/authoring/decks
    //       /api/authoring/decks?id=1
    [HttpGet]
    public ActionResult<object> Get([FromQuery] int? id)
    {
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
            if (existing.IsDeleted == 0 & existing.Title == deck.Title)
            {
                return Conflict($"Deck with the title '{deck.Title}' already exists.");
            }
        }
        //3. create new deck
        int newId = _decks.Any() ? _decks.Max(d => d.Id) + 1 : 1;

        var newDeck = new Deck
        {
            Id = newId,
            Title = deck.Title,
            Author = deck.Author,
            IsDeleted = 0
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

        //3. 如果已经是软删状态，再删一次也不报错（保持幂等）

        deck.IsDeleted = 1;

        //4. Return 204 No Content
        return NoContent();
    }
}