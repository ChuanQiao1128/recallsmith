namespace RecallSmith.Lambda.Worker;

/// <summary>
/// 业务级异常，表示任务应该被标记为 FAILED 而不是重试。
/// </summary>
public class BusinessException : Exception
{
  public BusinessException(string message) : base(message) { }
  public BusinessException(string message, Exception inner) : base(message, inner) { }
}
