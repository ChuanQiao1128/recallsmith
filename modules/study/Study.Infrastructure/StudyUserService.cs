using System;
using System.Threading;
using System.Threading.Tasks;
using Contracts.Study.User;
using Study.Application;

namespace Study.Infrastructure;

/// <summary>
/// 面向 User 的用例实现（占位，后续可替换为真实 EF 逻辑）
/// </summary>
public class StudyUserService : IStudyUserService
{
    public Task<ApplyDeckResponse> ApplyDeckAsync(Guid deckId, ApplyDeckRequest request, CancellationToken ct)
    {
        var userDeckId = Guid.NewGuid();
        // 使用“位置参数”，避免命名参数不匹配（CS1739）
        var res = new ApplyDeckResponse(userDeckId, request.TargetVersion, 0, 0);
        return Task.FromResult(res);
    }
}
