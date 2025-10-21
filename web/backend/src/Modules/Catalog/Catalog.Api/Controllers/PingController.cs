using Microsoft.AspNetCore.Mvc;

namespace Catalog.Api.Controllers;

[ApiController]
[Route("api/catalog/ping")]
public class PingController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(new { area = "catalog", status = "ok" });
}