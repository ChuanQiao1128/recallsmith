using Contracts.Study.User;

namespace Study.Application;

public interface IStudyUserService
{
    Task<ApplyDeckResponse> ApplyDeckAsync(Guid catalogDeckId, ApplyDeckRequest req, CancellationToken ct);
}
