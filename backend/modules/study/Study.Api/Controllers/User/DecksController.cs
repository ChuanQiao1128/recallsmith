using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Contracts.Study.User;
using Study.Application;

namespace Study.Api.Controllers.User;

[ApiController]
[Route("api/user/decks")]
public class DecksController : ControllerBase
{
    private readonly IStudyUserService _service;

    public DecksController(IStudyUserService service) => _service = service;

    // POST /api/user/decks/apply?deckId=...
    [HttpPost("apply")]
    public async Task<ActionResult<ApplyDeckResponse>> Apply(
        [FromQuery] Guid deckId,
        [FromBody] ApplyDeckRequest request,
        CancellationToken ct)
    {
        var res = await _service.ApplyDeckAsync(deckId, request, ct);
        return Ok(res);
    }
}
