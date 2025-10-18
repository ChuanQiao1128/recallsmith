namespace Contracts.Study.User;

public record ApplyDeckRequest(Guid UserId, string TargetVersion);
public record ApplyDeckResponse(Guid UserDeckId, string Version, int Added, int Updated);
