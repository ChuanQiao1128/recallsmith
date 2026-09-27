using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc;

/// <summary>
/// Least authority for the local authoring agent's token (R18 X02, ai-agent-6). A token minted for an agent app
/// client (<see cref="AuthContext.IsAgentClient"/>, the <c>console-dev</c> client the MCP server signs in with)
/// carries the owner's groups, and it sits on disk where the agent's own tools can read it. core-vpc therefore
/// lets it reach only what the MCP tools need: deck list and read, card similarity, draft submit and the status of
/// a draft it submitted. Accept/reject, publish, QA runs and finding resolution, webhooks, ledger writes, admin/db
/// and every other route answer 403 <c>AGENT_CLIENT_FORBIDDEN</c>. The console's own client is unaffected.
/// </summary>
public static class AgentClientPolicy
{
  public const string ErrorCode = "AGENT_CLIENT_FORBIDDEN";

  // Suffix-matched exactly as VpcFunction matches these routes, so the policy and the router agree on stage-prefixed paths.
  private static readonly (string Method, string Suffix)[] AllowedSuffixes =
  [
    ("GET", "/health"),
    ("GET", "/api/v1/admin/decks"),
    ("GET", "/api/v1/authoring/decks"),
    ("POST", "/api/v1/authoring/cards/similar"),
    ("POST", "/api/v1/authoring/drafts"),
  ];

  // Template routes, matched with RouteMatcher as the router does. Drafts.HandleGetDraft further limits an agent
  // client to drafts submitted by its own subject.
  private static readonly (string Method, string Template)[] AllowedTemplates =
  [
    ("GET", "/api/v1/authoring/drafts/:draftId"),
  ];

  /// <summary>True when an agent-client token may call <paramref name="method"/> on <paramref name="path"/> (trailing slash trimmed).</summary>
  public static bool Allows(string method, string path)
  {
    foreach (var (m, suffix) in AllowedSuffixes)
    {
      if (method.Equals(m, StringComparison.OrdinalIgnoreCase) && path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) return true;
    }
    foreach (var (m, template) in AllowedTemplates)
    {
      if (method.Equals(m, StringComparison.OrdinalIgnoreCase) && RouteMatcher.Match(template, path) is not null) return true;
    }
    return false;
  }

  /// <summary>
  /// Null when the request may proceed: the token is not an agent client's, or the route is on the allowlist.
  /// Otherwise the 403 envelope, logged with the request's coordinates only (never a claim value).
  /// </summary>
  public static APIGatewayProxyResponse? Deny(AuthContext auth, LambdaRequest req, string path, Res res)
  {
    if (!auth.IsAgentClient || Allows(req.Method, path)) return null;

    Log.Event("warn", new { tag = "auth", reason = "agent_client_forbidden", traceId = req.TraceId, method = req.Method, path = req.Path });
    return Authoring.Helpers.ErrorEnvelope(res, 403, ErrorCode,
      "The local authoring agent's token may only list and read decks, find similar cards, submit drafts and read its own drafts");
  }
}
