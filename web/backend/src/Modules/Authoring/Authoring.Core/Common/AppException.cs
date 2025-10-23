using System.Net;

namespace Authoring.Core.Common;

public class AppException : Exception
{
    public HttpStatusCode Status { get; }
    public string Code { get; }
    public object? Details { get; }

    public AppException(HttpStatusCode status, string code, string message, object? details = null)
        : base(message)
    {
        Status = status;
        Code = code;
        Details = details;
    }
}