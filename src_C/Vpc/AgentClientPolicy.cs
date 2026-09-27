using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc;

/// <summary>
/// Least authority for the local authoring agent's token (R18 X02, ai-agent-6). A token minted for an agent app
/// client (<see cref="AuthContext.IsAgentClient"/>, the <c>console-dev</c> client the MCP server signs in with)
/// carries the owner's groups, and it sits on disk where the agent's own tools can read it. core-vpc therefore
/// lets it reach exactly the endpoints tools/mcp-server/src calls: the deck list, card similarity and draft submit.
/// These are also the only route keys the gateway's agent JWT authorizer is attached to (cross-wave contract, R18
/// Y02); every other route, draft decisions, publish, QA, webhooks, the ledger and admin/db included, answers 403
/// <c>AGENT_CLIENT_FORBIDDEN</c> here as defence in depth. The console's own client is unaffected.
/// </summary>
public static class AgentClientPolicy
{
  public const string ErrorCode = "AGENT_CLIENT_FORBIDDEN";

  // Suffix-matched exactly as VpcFunction matches these routes, so the policy and the router agree on stage-prefixed
  // paths. Keep in step with the MCP server's calls (api.ts listDecks, server.ts find_similar_cards and submit_draft).
  private static readonly (string Method, string Suffix)[] AllowedSuffixes =
  [
    ("GET", "/api/v1/admin/decks"),
    ("POST", "/api/v1/authoring/cards/similar"),
    ("POST", "/api/v1/authoring/drafts"),
  ];

  /// <summary>True when an agent-client token may call <paramref name="method"/> on <paramref name="path"/> (trailing slash trimmed).</summary>
  public static bool Allows(string method, string path)
  {
    foreach (var (m, suffix) in AllowedSuffixes)
    {
      if (method.Equals(m, StringComparison.OrdinalIgnoreCase) && path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) return true;
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
      "The local authoring agent's token may only list decks, find similar cards and submit drafts");
  }
}
