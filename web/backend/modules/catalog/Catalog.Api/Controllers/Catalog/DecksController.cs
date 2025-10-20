using Microsoft.AspNetCore.Mvc;
using Catalog.Application;

namespace Catalog.Api.Controllers.Catalog;

[ApiController]
[Route("api/catalog/decks")]
public class DecksController : ControllerBase
{
    private readonly ICatalogQueryService _queries;

    public DecksController(ICatalogQueryService queries)
        => _queries = queries;

    // GET /api/catalog/decks?q=&page=1&pageSize=20
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? q,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        var items = await _queries.ListDecksAsync(q, page, pageSize, ct);
        return Ok(items);
    }

    // GET /api/catalog/decks/{id}
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var deck = await _queries.GetDeckAsync(id, ct);
        return deck is null ? NotFound() : Ok(deck);
    }

    // GET /api/catalog/decks/{id}/cards
    [HttpGet("{id:guid}/cards")]
    public async Task<IActionResult> ListCards(Guid id, CancellationToken ct)
    {
        var cards = await _queries.ListDeckCardsAsync(id, ct);
        return Ok(cards);
    }
}
