namespace Study.Application;

public record ApplyDeckCmd(Guid UserId, Guid CatalogDeckId, string? TargetVersion);
public record ApplyDeckResult(Guid UserDeckId, string Version, int Added, int Updated);

public interface IStudyUserService
{
    Task<ApplyDeckResult> ApplyDeckAsync(ApplyDeckCmd cmd, CancellationToken ct);
}