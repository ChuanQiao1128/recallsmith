using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class Helpers
{
  public static APIGatewayProxyResponse? HandlePgError(Exception ex, Res res)
  {
    if (ex is not PostgresException pg) return null;

    switch (pg.SqlState)
    {
      case "23505": // unique_violation
      {
        var constraint = pg.ConstraintName ?? string.Empty;
        var detail = pg.Detail ?? string.Empty;
        var message = "Duplicate value violates unique constraint.";

        switch (constraint)
        {
          case "uq_cards_deck_uid":
            message = "Another card in this deck already uses this Stable UID.";
            break;
          case "uq_cards_deck_order":
            message = "Order in deck must be unique within this deck.";
            break;
          case "decks_slug_key":
            message = "Slug is already used by another deck.";
            break;
          case "uq_admin_deck_permissions":
            message = "Duplicate permission entry for this admin and deck.";
            break;
          default:
            if (detail.Contains("(slug)", StringComparison.Ordinal)) message = "Slug is already used by another deck.";
            break;
        }

        return MapUniqueViolation409(ex, res) ?? ErrorEnvelope(res, 409, "UNIQUE_VIOLATION", message);
      }

      case "23514": // check_violation
      {
        var message = pg.ConstraintName == "ck_cards_order_in_deck_positive"
          ? "orderInDeck must be a positive integer."
          : $"Value violates check constraint {pg.ConstraintName}.";
        return res.BadRequest("VALIDATION_ERROR", message);
      }

      case "23503": // foreign_key_violation
        return res.BadRequest("VALIDATION_ERROR", $"Referenced row does not exist ({pg.ConstraintName}).");

      case "23502": // not_null_violation
        return res.BadRequest("VALIDATION_ERROR", $"{pg.ColumnName ?? "A required field"} must not be null.");

      case "22P02": // invalid_text_representation
        return res.BadRequest("VALIDATION_ERROR", "Invalid value format.");

      default:
        return null;
    }
  }

  /// <summary>
  /// The wave's five-key envelope built directly through <see cref="Res.Raw"/> (Res.cs is E07's file):
  /// { success, data, error{code,message}, traceId, version }. Used for the 404/409 codes Res does not
  /// have a fixed helper for.
  /// </summary>
  public static APIGatewayProxyResponse ErrorEnvelope(Res res, int statusCode, string code, string message) =>
    res.Raw(statusCode, new { success = false, data = (object?)null, error = new { code, message }, traceId = res.TraceId, version = "v1" });

  /// <summary>503 CONFIG_ERROR: the server is missing configuration (PG env, bucket, queue). Not the caller's fault.</summary>
  public static APIGatewayProxyResponse ConfigError(Res res, string message) => ErrorEnvelope(res, 503, "CONFIG_ERROR", message);

  /// <summary>Body keys present in <paramref name="body"/> that <paramref name="fullSpec"/> knows but
  /// <paramref name="allowedSpec"/> dropped for the caller's role, in fullSpec order.</summary>
  public static List<string> IgnoredFields(JsonElement body, IReadOnlyList<UpdateField> fullSpec, IReadOnlyList<UpdateField> allowedSpec)
  {
    var allowed = new HashSet<string>(allowedSpec.Select(f => f.BodyKey), StringComparer.Ordinal);
    var ignored = new List<string>();
    foreach (var f in fullSpec)
    {
      if (allowed.Contains(f.BodyKey)) continue;
      if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty(f.BodyKey, out _)) ignored.Add(f.BodyKey);
    }
    return ignored;
  }

  /// <summary>
  /// Maps a 23505 on the migration-021 partial unique index (uq_deck_publishes_active) to
  /// 409 PUBLISH_IN_PROGRESS. Any other exception (or a 23505 on a different constraint) → null.
  /// </summary>
  public static APIGatewayProxyResponse? MapUniqueViolation409(Exception ex, Res res)
  {
    if (ex is not PostgresException { SqlState: "23505", ConstraintName: "uq_deck_publishes_active" }) return null;
    return ErrorEnvelope(res, 409, "PUBLISH_IN_PROGRESS",
      "A publish for this deck is still PENDING or PROCESSING. Wait for the worker, or run POST /api/v1/admin/publish/reap and retry.");
  }

  public sealed record UpdateField(string BodyKey, string ColumnName, Func<JsonElement, object?> Transform, string Cast = "");

  public static (List<string> Fields, List<object?> Parameters) BuildUpdateSet(JsonElement body, IReadOnlyList<UpdateField> spec)
  {
    var fields = new List<string>();
    var parameters = new List<object?>();
    var idx = 1;

    foreach (var f in spec)
    {
      if (!body.TryGetProperty(f.BodyKey, out var el)) continue;
      var value = f.Transform(el);
      fields.Add($"{f.ColumnName} = ${idx++}{f.Cast}");
      parameters.Add(value);
    }

    fields.Add("updated_at = now()");
    return (fields, parameters);
  }

  public static bool ParseBoolean(JsonElement el, bool defaultValue = false)
  {
    return el.ValueKind switch
    {
      JsonValueKind.True => true,
      JsonValueKind.False => false,
      JsonValueKind.String => Validation.ParseBoolean(el.GetString(), defaultValue),
      JsonValueKind.Number => Validation.ParseBoolean(el.ToString(), defaultValue),
      _ => defaultValue,
    };
  }

  public static long? ParseOptionalInteger(JsonElement el, string fieldName)
  {
    if (el.ValueKind == JsonValueKind.Null) return null;
    var s = el.ToString();
    return Validation.ParseOptionalInteger(s, fieldName);
  }

  public static long RequireInteger(JsonElement el, string fieldName)
  {
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined)
    {
      throw new ValidationError($"{fieldName} is required", fieldName);
    }
    return Validation.RequireInteger(el.ToString(), fieldName);
  }

  public static long EnsureInteger(JsonElement el, string fieldName)
  {
    if (el.ValueKind == JsonValueKind.Null) throw new ValidationError($"{fieldName} must be an integer", fieldName);
    return Validation.EnsureInteger(el.ToString(), fieldName);
  }

  /// <summary>Upper bound on cards.topic in UTF-16 code units; the console's TOPIC_MAX_LENGTH (C06) is the same 80.</summary>
  public const int TopicMaxLength = 80;

  /// <summary>
  /// POST body → cards.topic. absent / JSON null / blank → null; string → Trim();
  /// > 80 chars → ValidationError("topic too long (max 80)");
  /// any other ValueKind → ValidationError("topic must be a string").
  /// </summary>
  public static string? ParseOptionalTopic(JsonElement body)
  {
    return body.TryGetProperty("topic", out var el) ? NormalizeTopic(el) : null;
  }

  /// <summary>Same rules for one element (the PUT spec transform).</summary>
  public static string? NormalizeTopic(JsonElement el)
  {
    switch (el.ValueKind)
    {
      case JsonValueKind.Undefined:
      case JsonValueKind.Null:
        return null;
      case JsonValueKind.String:
        var s = (el.GetString() ?? string.Empty).Trim();
        if (s.Length == 0) return null;
        if (s.Length > TopicMaxLength) throw new ValidationError("topic too long (max 80)", "topic");
        return s;
      default:
        throw new ValidationError("topic must be a string", "topic");
    }
  }

  private static async Task<bool> DeckPerm(NpgsqlConnection conn, string adminSub, long deckId, string column)
  {
    var sql = $"""
      select 1 as ok
      from admin_deck_permissions
      where admin_sub = $1 and deck_id = $2 and {column} = 1
      limit 1
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, [adminSub, deckId]);
    return rows.Count > 0;
  }

  public static async Task<APIGatewayProxyResponse?> RequireDeckRead(
    NpgsqlConnection conn,
    string? adminSub,
    long deckId,
    bool isSuperAdmin,
    Res res)
  {
    if (isSuperAdmin) return null;
    if (string.IsNullOrEmpty(adminSub)) return res.Forbidden("Requires authenticated admin user");
    var ok = await DeckPerm(conn, adminSub, deckId, "can_read");
    if (!ok) return res.Forbidden("No permission for this deck (read)");
    return null;
  }

  public static async Task<APIGatewayProxyResponse?> RequireDeckWrite(
    NpgsqlConnection conn,
    string? adminSub,
    long deckId,
    bool isSuperAdmin,
    Res res)
  {
    if (isSuperAdmin) return null;
    if (string.IsNullOrEmpty(adminSub)) return res.Forbidden("Requires authenticated admin user");
    var ok = await DeckPerm(conn, adminSub, deckId, "can_write");
    if (!ok) return res.Forbidden("No permission for this deck (write)");
    return null;
  }

  public static async Task<long?> GetDeckIdByCardId(NpgsqlConnection conn, long cardId)
  {
    var rows = await DbUtil.QueryAsync(conn, null, "select deck_id as \"deckId\" from cards where id = $1", [cardId]);
    if (rows.Count == 0) return null;
    return Convert.ToInt64(rows[0]["deckId"], CultureInfo.InvariantCulture);
  }

  /// <summary>
  /// A jsonb column arrives from DbUtil.QueryAsync as a .NET string in PG text form (DbUtil.cs:24 GetValue;
  /// parameters bind via AddWithValue, :63-68). Returns an OWN copy via JsonSerializer.Deserialize&lt;JsonElement&gt;(s),
  /// not a RootElement off a disposed document. null / absent → null; an already-converted JsonElement is returned as is.
  /// </summary>
  public static JsonElement? JsonbElement(IReadOnlyDictionary<string, object?> row, string key)
  {
    if (!row.TryGetValue(key, out var v)) return null;
    if (v is JsonElement je) return je;
    if (v is string s) return JsonSerializer.Deserialize<JsonElement>(s);
    return null;
  }

  /// <summary>
  /// In place: row[key] = JsonbElement(row, key) when the key is present (a null cell stays null, so the wire
  /// carries "mcq": null for a Q/A card). Absent key → no-op.
  /// </summary>
  public static void JsonbCell(Dictionary<string, object?> row, string key)
  {
    if (!row.ContainsKey(key)) return;
    row[key] = JsonbElement(row, key);
  }
}
