using Microsoft.AspNetCore.Mvc;
using System;

namespace RecallSmith.Api.Controllers;

[ApiController]
[Route("api/health")]

public class HealthController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        var now = DateTime.UtcNow;
        var result = new
        {
            status = "ok",
            time = now.ToString("O")
        };
        return Ok(result);
}
}