using Microsoft.AspNetCore.Mvc;

namespace Catalog.Api.Controllers.Admin;

[ApiController]
[Route("api/admin/ping")]
public class PingController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(new { area = "admin", status = "ok" });
}
