using System;
using System.Threading;
using System.Threading.Tasks;

namespace Study.Application;

public interface IStudyApplyService
{
    Task<ApplyDeckResult> ApplyDeckAsync(ApplyDeckCmd cmd, CancellationToken ct = default);
}