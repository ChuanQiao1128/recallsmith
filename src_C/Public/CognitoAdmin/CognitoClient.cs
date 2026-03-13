using Amazon;
using Amazon.CognitoIdentityProvider;
using Amazon.CognitoIdentityProvider.Model;
using RecallSmith.Lambda.Common;
using System.Text.Json;

namespace RecallSmith.Lambda.Public.CognitoAdmin;

public static class CognitoClient
{
  private static readonly string ApiVersion = Environment.GetEnvironmentVariable("API_VERSION") ?? "v1";

  private static readonly string? CognitoRegion =
    Environment.GetEnvironmentVariable("COGNITO_REGION") ??
    Environment.GetEnvironmentVariable("AWS_REGION");

  private static readonly string? UserPoolId = Environment.GetEnvironmentVariable("COGNITO_USER_POOL_ID");

  private static readonly string AdminGroupsEnv = Environment.GetEnvironmentVariable("ADMIN_GROUPS") ?? "[\"super_admin\",\"editor\"]";

  private static readonly string DefaultNewAdminGroupsEnv =
    Environment.GetEnvironmentVariable("DEFAULT_NEW_ADMIN_GROUPS") ?? "[\"editor\"]";

  private static readonly bool SuppressInvite =
    string.Equals((Environment.GetEnvironmentVariable("COGNITO_SUPPRESS_INVITE") ?? "true").Trim(), "true",
      StringComparison.OrdinalIgnoreCase);

  private static AmazonCognitoIdentityProviderClient? _client;
  private static Exception? _initError;

  // Used by SnapStart runtime hooks to ensure we don't reuse pre-snapshot network state.
  public static void Reset()
  {
    var c = _client;
    _client = null;
    _initError = null;

    if (c is null) return;
    try { c.Dispose(); } catch { /* best-effort */ }
  }

  private static AmazonCognitoIdentityProviderClient GetClient()
  {
    if (_client is not null) return _client;
    if (_initError is not null) throw _initError;

    if (string.IsNullOrWhiteSpace(CognitoRegion) || string.IsNullOrWhiteSpace(UserPoolId))
    {
      _initError = new InvalidOperationException(
        "Missing env: COGNITO_REGION/AWS_REGION and COGNITO_USER_POOL_ID are required");
      throw _initError;
    }

    _client = new AmazonCognitoIdentityProviderClient(RegionEndpoint.GetBySystemName(CognitoRegion));
    return _client;
  }

  private static string? GetAttr(List<AttributeType>? attrs, string name)
  {
    if (attrs is null) return null;
    var found = attrs.FirstOrDefault(a => a?.Name == name);
    return found?.Value;
  }

  private static async Task<List<UserType>> ListUsersInGroupAll(string groupName)
  {
    var client = GetClient();
    var outList = new List<UserType>();
    string? nextToken = null;

    do
    {
      var resp = await client.ListUsersInGroupAsync(new ListUsersInGroupRequest
      {
        UserPoolId = UserPoolId,
        GroupName = groupName,
        Limit = 60,
        NextToken = nextToken,
      });

      outList.AddRange(resp.Users ?? []);
      nextToken = resp.NextToken;
    } while (!string.IsNullOrEmpty(nextToken));

    return outList;
  }

  public static async Task<List<Dictionary<string, object?>>> ListAdminUsersFromCognito()
  {
    using var groupsDoc = JsonDocumentSafeParse(AdminGroupsEnv);
    var adminGroups = groupsDoc is not null
      ? Validation.ParseGroups(groupsDoc.RootElement)
      : [];

    var usersByUsername = new Dictionary<string, UserType>(StringComparer.Ordinal);
    var groupsByUsername = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

    foreach (var group in adminGroups)
    {
      try
      {
        var users = await ListUsersInGroupAll(group);
        foreach (var u in users)
        {
          var username = string.IsNullOrWhiteSpace(u.Username) ? null : u.Username.Trim();
          if (string.IsNullOrEmpty(username)) continue;

          if (!groupsByUsername.TryGetValue(username, out var set))
          {
            set = new HashSet<string>(StringComparer.Ordinal);
            groupsByUsername[username] = set;
          }
          set.Add(group);

          usersByUsername.TryAdd(username, u);
        }
      }
      catch (Exception ex)
      {
        // group not found etc: don't kill the endpoint
        Log.Warn($"Cognito listUsersInGroup failed: group={group}", ex.GetType().Name, ex.Message);
      }
    }

    var outList = new List<Dictionary<string, object?>>();
    foreach (var (username, u) in usersByUsername)
    {
      var email = GetAttr(u.Attributes, "email");
      var sub = GetAttr(u.Attributes, "sub");
      var enabled = u.Enabled;
      var status = u.UserStatus?.Value;
      long? createdAt = u.UserCreateDate is null ? null : new DateTimeOffset(u.UserCreateDate.Value).ToUnixTimeMilliseconds();

      var groups = groupsByUsername.TryGetValue(username, out var set) ? set.ToList() : [];
      outList.Add(new Dictionary<string, object?>
      {
        ["username"] = username,
        ["sub"] = sub,
        ["email"] = email,
        ["enabled"] = enabled,
        ["status"] = status,
        ["groups"] = groups,
        ["createdAt"] = createdAt,
      });
    }

    outList.Sort((a, b) =>
    {
      var ag = (a.TryGetValue("groups", out var av) ? av as List<string> : null) ?? [];
      var bg = (b.TryGetValue("groups", out var bv) ? bv as List<string> : null) ?? [];
      var asu = ag.Contains("super_admin") ? 0 : 1;
      var bsu = bg.Contains("super_admin") ? 0 : 1;
      if (asu != bsu) return asu.CompareTo(bsu);

      var au = Convert.ToString(a["username"]) ?? string.Empty;
      var bu = Convert.ToString(b["username"]) ?? string.Empty;
      return string.Compare(au, bu, StringComparison.Ordinal);
    });

    return outList;
  }

  public static async Task<Dictionary<string, object?>> CreateEditorUserInCognito(string username, string email, string tempPassword)
  {
    var client = GetClient();

    var safeUsername = username.Trim();
    var safeEmail = email.Trim();
    var safeTemp = tempPassword;

    using var groupsDoc = JsonDocumentSafeParse(DefaultNewAdminGroupsEnv);
    var groups = groupsDoc is not null ? Validation.ParseGroups(groupsDoc.RootElement) : [];
    var effective = groups.Count > 0 ? groups : ["editor"];

    if (effective.Any(g => string.Equals(g, "super_admin", StringComparison.OrdinalIgnoreCase)))
    {
      throw new InvalidOperationException(
        "DEFAULT_NEW_ADMIN_GROUPS must not include super_admin (console only creates editors).");
    }

    var createResp = await client.AdminCreateUserAsync(new AdminCreateUserRequest
    {
      UserPoolId = UserPoolId,
      Username = safeUsername,
      TemporaryPassword = safeTemp,
      MessageAction = SuppressInvite ? MessageActionType.SUPPRESS : null,
      UserAttributes =
      [
        new AttributeType { Name = "email", Value = safeEmail },
        new AttributeType { Name = "email_verified", Value = "true" },
      ],
    });

    foreach (var group in effective)
    {
      await client.AdminAddUserToGroupAsync(new AdminAddUserToGroupRequest
      {
        UserPoolId = UserPoolId,
        Username = safeUsername,
        GroupName = group,
      });
    }

    var createdUser = createResp.User;
    var sub = createdUser is null ? null : GetAttr(createdUser.Attributes, "sub");
    long? createdAt = createdUser?.UserCreateDate is null
      ? null
      : new DateTimeOffset(createdUser.UserCreateDate.Value).ToUnixTimeMilliseconds();
    var enabled = createdUser?.Enabled;
    var status = createdUser?.UserStatus?.Value;

    return new Dictionary<string, object?>
    {
      ["username"] = safeUsername,
      ["sub"] = sub,
      ["email"] = safeEmail,
      ["enabled"] = enabled,
      ["status"] = status,
      ["groups"] = effective,
      ["createdAt"] = createdAt,
    };
  }

  public static async Task<Dictionary<string, object?>> DisableUserInCognito(string username)
  {
    var client = GetClient();
    await client.AdminDisableUserAsync(new AdminDisableUserRequest
    {
      UserPoolId = UserPoolId,
      Username = username.Trim(),
    });
    return new Dictionary<string, object?> { ["disabled"] = true };
  }

  public static async Task<Dictionary<string, object?>> DeleteUserInCognito(string username)
  {
    var client = GetClient();
    await client.AdminDeleteUserAsync(new AdminDeleteUserRequest
    {
      UserPoolId = UserPoolId,
      Username = username.Trim(),
    });
    return new Dictionary<string, object?> { ["deleted"] = true };
  }

  private static JsonDocument? JsonDocumentSafeParse(string raw)
  {
    try
    {
      return JsonDocument.Parse(raw);
    }
    catch
    {
      return null;
    }
  }
}
