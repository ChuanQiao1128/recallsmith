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
        new Deck { Id = 1, Title  = "Deck 1", Author = "Chuan 1" },
        new Deck { Id = 2, Title  = "Deck 2", Author = "Chuan 2" },
        new Deck { Id = 3, Title  = "Deck 3", Author = "Chuan 3" }
    };

    // 2 Get /api/authoring/decks
    //       /api/authoring/decks?id=1
    [HttpGet]
    public ActionResult<object> Get([FromQuery] int? id)
    {
        if (id is null)
        {
            return Ok(_decks);
        }

        // if id exists;
        Deck? deck = null;
        foreach (var d in _decks)
        {
            if (d.Id == id.Value)
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
        //3. create new deck
        int newId = _decks.Any() ? _decks.Max(d => d.Id) + 1 : 1;

        var newDeck = new Deck
        {
            Id = newId,
            Title = deck.Title,
            Author = deck.Author
        };

        //4. Add newDeck to Database
        _decks.Add(newDeck);

        //5. Return 201 Created
        string location = $"api/authoring/decks?id={newDeck.Id}";
        return Created(location, newDeck);
    }
}