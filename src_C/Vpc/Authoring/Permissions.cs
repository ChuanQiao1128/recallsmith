using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class Permissions
{
  public static async Task<APIGatewayProxyResponse> HandleAuthoringPermissions(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    // BULK
    if (req.Path.EndsWith("/bulk", StringComparison.Ordinal))
    {
      if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

      try
      {
        using var doc = Validation.ParseJsonBody(req);
        if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
        var body = doc.RootElement;

        var adminSub = body.TryGetProperty("adminSub", out var a) ? a.ToString() : null;
        if (string.IsNullOrWhiteSpace(adminSub)) return res.BadRequest("VALIDATION_ERROR", "adminSub is required");

        if (!body.TryGetProperty("permissions", out var permsEl) || permsEl.ValueKind != JsonValueKind.Array)
        {
          return res.BadRequest("VALIDATION_ERROR", "permissions must be an array");
        }

        var mode = body.TryGetProperty("mode", out var m) ? m.ToString() : null;
        var replace = mode is null ? true : !string.Equals(mode.Trim(), "merge", StringComparison.OrdinalIgnoreCase);

        var rows = new List<(long DeckId, bool CanRead, bool CanWrite)>();
        foreach (var p in permsEl.EnumerateArray())
        {
          if (p.ValueKind != JsonValueKind.Object) continue;
          if (!p.TryGetProperty("deckId", out var deckIdEl)) throw new ValidationError("deckId is required", "deckId");
          var deckId = Validation.RequireInteger(deckIdEl.ToString(), "deckId");

          var canWrite = p.TryGetProperty("canWrite", out var cw) && Helpers.ParseBoolean(cw, false);
          var canRead = canWrite || (p.TryGetProperty("canRead", out var cr) && Helpers.ParseBoolean(cr, false));
          if (canRead || canWrite) rows.Add((deckId, canRead, canWrite));
        }

        var action = replace ? "permissions.replace" : "permissions.merge";
        var target = $"admin:{adminSub.Trim()}";
        AdminAuditEntry? auditEntry = null;
        var persisted = false;

        await using var tx = await conn.BeginTransactionAsync();
        try
        {
          // Audit the state before the mutation so a mis-click leaves a record of what was revoked.
          var before = await ReadAdminPermsAsync(conn, tx, adminSub.Trim());

          if (replace)
          {
            await DbUtil.ExecuteAsync(conn, tx, "delete from admin_deck_permissions where admin_sub = $1", [adminSub.Trim()]);
          }

          if (rows.Count > 0)
          {
            var values = new List<string>();
            var parameters = new List<object?>();
            var idx = 1;
            static string P(ref int i) => "$" + i++;

            foreach (var r in rows)
            {
              values.Add($"({P(ref idx)}, {P(ref idx)}, {P(ref idx)}, {P(ref idx)})");
              parameters.Add(adminSub.Trim());
              parameters.Add(r.DeckId);
              parameters.Add(r.CanRead ? 1 : 0);
              parameters.Add(r.CanWrite ? 1 : 0);
            }

            var sql = $"""
              insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write)
              values {string.Join(", ", values)}
              on conflict (admin_sub, deck_id)
              do update set
                can_read = excluded.can_read,
                can_write = excluded.can_write,
                updated_at = now()
              """;

            await DbUtil.ExecuteAsync(conn, tx, sql, parameters);
          }

          var after = await ReadAdminPermsAsync(conn, tx, adminSub.Trim());
          auditEntry = AdminAudit.Entry(auth, res, action, target, before, after);
          persisted = await AdminAudit.RecordAsync(conn, tx, auditEntry);

          await tx.CommitAsync();
        }
        catch
        {
          try { await tx.RollbackAsync(); } catch { /* ignore */ }
          throw;
        }

        // A failing statement (e.g. 23503 on an unknown deck) rolls back the audit row with everything else.
        AdminAudit.Emit(auditEntry, persisted);
        return res.Ok(new { saved = rows.Count, replace });
      }
      catch (Exception ex) when (ex is ValidationError)
      {
        return res.BadRequest("VALIDATION_ERROR", ex.Message);
      }
      catch (Exception ex)
      {
        var handled = Helpers.HandlePgError(ex, res);
        if (handled is not null) return handled;
        return res.Error500(ex);
      }
    }

    // NORMAL
    if (req.Method == "GET")
    {
      try
      {
        var adminSub = req.Query.TryGetValue("adminSub", out var a) ? a : null;

        var sql = """
          select
            p.admin_sub as "adminSub",
            p.deck_id   as "deckId",
            p.can_read  as "canRead",
            p.can_write as "canWrite",
            d.slug      as "deckSlug",
            d.title     as "deckTitle",
            d.locale    as "locale",
            p.created_at as "createdAt",
            p.updated_at as "updatedAt"
          from admin_deck_permissions p
          left join decks d on d.id = p.deck_id
          """;

        var parameters = new List<object?>();
        if (!string.IsNullOrWhiteSpace(adminSub))
        {
          parameters.Add(adminSub);
          sql += " where p.admin_sub = $1";
        }
        sql += " order by p.admin_sub asc, d.created_at asc, p.deck_id asc";

        var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);

        var items = rows.Select(x => new
        {
          adminSub = Convert.ToString(x["adminSub"], CultureInfo.InvariantCulture),
          deckId = Convert.ToInt64(x["deckId"], CultureInfo.InvariantCulture),
          deckSlug = x.TryGetValue("deckSlug", out var ds) ? ds : null,
          deckTitle = x.TryGetValue("deckTitle", out var dt) ? dt : null,
          locale = x.TryGetValue("locale", out var lo) ? lo : null,
          canRead = Convert.ToInt32(x["canRead"], CultureInfo.InvariantCulture) == 1,
          canWrite = Convert.ToInt32(x["canWrite"], CultureInfo.InvariantCulture) == 1,
          createdAt = ToMs(x.TryGetValue("createdAt", out var ca) ? ca : null),
          updatedAt = ToMs(x.TryGetValue("updatedAt", out var ua) ? ua : null),
        }).ToList();

        return res.Ok(items);
      }
      catch (Exception ex) when (ex is ValidationError)
      {
        return res.BadRequest("VALIDATION_ERROR", ex.Message);
      }
      catch (Exception ex)
      {
        var handled = Helpers.HandlePgError(ex, res);
        if (handled is not null) return handled;
        return res.Error500(ex);
      }
    }

    if (req.Method == "PUT")
    {
      try
      {
        using var doc = Validation.ParseJsonBody(req);
        if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
        var body = doc.RootElement;

        var adminSub = body.TryGetProperty("adminSub", out var a) ? a.ToString() : null;
        if (string.IsNullOrWhiteSpace(adminSub)) return res.BadRequest("VALIDATION_ERROR", "adminSub is required");

        if (!body.TryGetProperty("deckId", out var deckIdEl)) return res.BadRequest("VALIDATION_ERROR", "deckId is required");
        var deckIdInt = Validation.RequireInteger(deckIdEl.ToString(), "deckId");

        var canWrite = body.TryGetProperty("canWrite", out var cw) && Helpers.ParseBoolean(cw, false);
        var canRead = canWrite || (body.TryGetProperty("canRead", out var cr) && Helpers.ParseBoolean(cr, false));

        const string sql = """
          insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write)
          values ($1, $2, $3, $4)
          on conflict (admin_sub, deck_id)
          do update set
            can_read = excluded.can_read,
            can_write = excluded.can_write,
            updated_at = now()
          returning admin_sub as "adminSub", deck_id as "deckId", can_read as "canRead", can_write as "canWrite"
          """;

        AdminAuditEntry auditEntry;
        bool persisted;
        object after;

        await using var tx = await conn.BeginTransactionAsync();
        try
        {
          var beforeRows = await DbUtil.QueryAsync(conn, tx,
            "select admin_sub as \"adminSub\", deck_id as \"deckId\", can_read as \"canRead\", can_write as \"canWrite\" from admin_deck_permissions where admin_sub = $1 and deck_id = $2",
            [adminSub.Trim(), deckIdInt]);
          object? before = beforeRows.Count > 0 ? MapPermRow(beforeRows[0]) : null;

          var rows = await DbUtil.QueryAsync(conn, tx, sql,
          [
            adminSub.Trim(),
            deckIdInt,
            canRead ? 1 : 0,
            canWrite ? 1 : 0,
          ]);

          after = MapPermRow(rows[0]);
          auditEntry = AdminAudit.Entry(auth, res, "permissions.upsert", $"admin:{adminSub.Trim()}", before, after);
          persisted = await AdminAudit.RecordAsync(conn, tx, auditEntry);

          await tx.CommitAsync();
        }
        catch
        {
          try { await tx.RollbackAsync(); } catch { /* ignore */ }
          throw;
        }

        AdminAudit.Emit(auditEntry, persisted);
        return res.Ok(after);
      }
      catch (Exception ex) when (ex is ValidationError)
      {
        return res.BadRequest("VALIDATION_ERROR", ex.Message);
      }
      catch (Exception ex)
      {
        var handled = Helpers.HandlePgError(ex, res);
        if (handled is not null) return handled;
        return res.Error500(ex);
      }
    }

    if (req.Method == "DELETE")
    {
      try
      {
        var adminSub = req.Query.TryGetValue("adminSub", out var a) ? a : null;
        if (string.IsNullOrWhiteSpace(adminSub)) return res.BadRequest("VALIDATION_ERROR", "adminSub is required");

        var deckIdInt = Validation.RequireInteger(req.Query.TryGetValue("deckId", out var d) ? d : null, "deckId");

        AdminAuditEntry auditEntry;
        bool persisted;

        await using var tx = await conn.BeginTransactionAsync();
        try
        {
          var beforeRows = await DbUtil.QueryAsync(conn, tx,
            "select admin_sub as \"adminSub\", deck_id as \"deckId\", can_read as \"canRead\", can_write as \"canWrite\" from admin_deck_permissions where admin_sub = $1 and deck_id = $2",
            [adminSub, deckIdInt]);
          object? before = beforeRows.Count > 0 ? MapPermRow(beforeRows[0]) : null;

          await DbUtil.ExecuteAsync(conn, tx, "delete from admin_deck_permissions where admin_sub = $1 and deck_id = $2", [adminSub, deckIdInt]);

          auditEntry = AdminAudit.Entry(auth, res, "permissions.delete", $"admin:{adminSub}", before, null);
          persisted = await AdminAudit.RecordAsync(conn, tx, auditEntry);

          await tx.CommitAsync();
        }
        catch
        {
          try { await tx.RollbackAsync(); } catch { /* ignore */ }
          throw;
        }

        AdminAudit.Emit(auditEntry, persisted);
        return res.Ok(new { deleted = true });
      }
      catch (Exception ex) when (ex is ValidationError)
      {
        return res.BadRequest("VALIDATION_ERROR", ex.Message);
      }
      catch (Exception ex)
      {
        var handled = Helpers.HandlePgError(ex, res);
        if (handled is not null) return handled;
        return res.Error500(ex);
      }
    }

    return res.MethodNotAllowed("Method not allowed");
  }

  /// <summary>All of one admin's permission rows, ordered by deck, as an audit-friendly shape.</summary>
  private static async Task<List<object>> ReadAdminPermsAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string adminSub)
  {
    var rows = await DbUtil.QueryAsync(conn, tx,
      "select deck_id as \"deckId\", can_read as \"canRead\", can_write as \"canWrite\" from admin_deck_permissions where admin_sub = $1 order by deck_id",
      [adminSub]);
    return rows.Select(r => (object)new
    {
      deckId = Convert.ToInt64(r["deckId"], CultureInfo.InvariantCulture),
      canRead = Convert.ToInt32(r["canRead"], CultureInfo.InvariantCulture) == 1,
      canWrite = Convert.ToInt32(r["canWrite"], CultureInfo.InvariantCulture) == 1,
    }).ToList();
  }

  private static object MapPermRow(Dictionary<string, object?> r) => new
  {
    adminSub = Convert.ToString(r["adminSub"], CultureInfo.InvariantCulture),
    deckId = Convert.ToInt64(r["deckId"], CultureInfo.InvariantCulture),
    canRead = Convert.ToInt32(r["canRead"], CultureInfo.InvariantCulture) == 1,
    canWrite = Convert.ToInt32(r["canWrite"], CultureInfo.InvariantCulture) == 1,
  };

  private static long? ToMs(object? v)
  {
    return v switch
    {
      null => null,
      DateTime dt => new DateTimeOffset(dt).ToUnixTimeMilliseconds(),
      DateTimeOffset dto => dto.ToUnixTimeMilliseconds(),
      _ => null,
    };
  }
}

