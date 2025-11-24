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
        Deck deck = null;
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
}