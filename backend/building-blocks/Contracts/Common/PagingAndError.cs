namespace Contracts.Common;

public record PagedRequest(string? Query, int Page = 1, int PageSize = 20);
public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);
public record ErrorEnvelope(ErrorBody error);
public record ErrorBody(string Code, string Message, string? TraceId);
