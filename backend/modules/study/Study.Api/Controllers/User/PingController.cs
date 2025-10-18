using Microsoft.AspNetCore.Mvc;

namespace Study.Api.Controllers.User;

[ApiController]
[Route("api/user/ping")]
public class PingController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(new { area = "user", status = "ok" });
}
