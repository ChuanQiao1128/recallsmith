using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class Decks
{
  private static string NormalizeAvailability(JsonElement el)
  {
    var s = el.ValueKind == JsonValueKind.Null ? string.Empty : el.ToString();
    s = s.Trim().ToLowerInvariant();
    if (s is "live" or "coming" or "retired") return s;
    throw new ValidationError("availability must be one of: live | coming | retired", "availability");
  }

  private static string? NormalizeTier(JsonElement el)
  {
    if (el.ValueKind == JsonValueKind.Null) return null;
    var s = el.ToString().Trim().ToLowerInvariant();
    if (s.Length == 0) return null;
    if (s is "free" or "premium") return s;
    throw new ValidationError("tier must be one of: free | premium (or null)", "tier");
  }

  /// <summary>The PUT RETURNING aliases the manifest reads (ManifestBuilder decksSql). A change to any of them rebuilds manifest.json.</summary>
  internal static readonly string[] ManifestColumns =
    ["slug", "title", "locale", "deckType", "version", "isDeleted", "tier", "availability", "eta", "manifestOrder", "totalCards", "previewCards", "retiredAtMs"];

  public const string NoteNoManifestChange = "NO_MANIFEST_CHANGE";
  public const string NoteRepublishRequired = "REPUBLISH_REQUIRED";
  public const string NoteRebuildFailed = "REBUILD_FAILED";

  /// <summary>True when any manifest column differs between the before and after rows (a missing key counts as null).</summary>
  internal static bool ManifestFieldsChanged(IReadOnlyDictionary<string, object?> before, IReadOnlyDictionary<string, object?> after)
  {
    foreach (var key in ManifestColumns)
    {
      var beforeValue = before.TryGetValue(key, out var b) ? b : null;
      var afterValue = after.TryGetValue(key, out var a) ? a : null;
      if (!Equals(beforeValue, afterValue)) return true;
    }
    return false;
  }

  /// <summary>
  /// True when a slug or tier change would point live phones at S3 objects that only exist after the next
  /// publish. False when the deck has no live build (nothing is published yet, so a rebuild is safe).
  /// </summary>
  internal static bool DeliveryChanged(IReadOnlyDictionary<string, object?> before, IReadOnlyDictionary<string, object?> after)
  {
    var liveBuildId = before.TryGetValue("liveBuildId", out var lb) ? Convert.ToString(lb, CultureInfo.InvariantCulture) : null;
    if (string.IsNullOrEmpty(liveBuildId)) return false;

    var beforeSlug = before.TryGetValue("slug", out var bs) ? Convert.ToString(bs, CultureInfo.InvariantCulture) : null;
    var afterSlug = after.TryGetValue("slug", out var @as) ? Convert.ToString(@as, CultureInfo.InvariantCulture) : null;
    if (!string.Equals(beforeSlug, afterSlug, StringComparison.Ordinal)) return true;

    var beforeTier = before.TryGetValue("tier", out var bt) ? Convert.ToString(bt, CultureInfo.InvariantCulture) : null;
    var afterTier = after.TryGetValue("tier", out var at) ? Convert.ToString(at, CultureInfo.InvariantCulture) : null;
    return !string.Equals(beforeTier, afterTier, StringComparison.OrdinalIgnoreCase);
  }

  /// <summary>
  /// Rebuilds manifest.json in-process and never throws: a rebuild failure is caught and reported as
  /// REBUILD_FAILED while the DB write still stands.
  /// </summary>
  private static async Task<(bool Rebuilt, string? Note)> TryRebuildAsync(NpgsqlConnection conn, long deckId, string trigger, DeckRollback.ManifestRebuildFn rebuild)
  {
    try
    {
      var r = await rebuild(conn);
      Log.Event("info", new { tag = "manifest-rebuild", reason = "deck_edit", trigger, deckId, deckCount = r.DeckCount, generatedAtMs = r.GeneratedAtMs });
      return (true, null);
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "manifest-rebuild", reason = "deck_edit_rebuild_failed", trigger, deckId, error = ex.Message });
      return (false, NoteRebuildFailed);
    }
  }

  /// <summary>Default rebuild: reads CONTENT_BUCKET at call time so tests can unset it.</summary>
  private static Task<ManifestBuildResult> DefaultManifestRebuildAsync(NpgsqlConnection conn)
  {
    var bucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
    if (string.IsNullOrEmpty(bucket)) throw new InvalidOperationException("Missing env CONTENT_BUCKET");
    return ManifestBuilder.RebuildAsync(
      conn,
      ManifestBuilder.S3(),
      bucket,
      ManifestBuilder.NormalizePrefix(Environment.GetEnvironmentVariable("CONTENT_PREFIX"), "content"),
      ManifestBuilder.NormalizePrefix(Environment.GetEnvironmentVariable("PREMIUM_PREFIX"), "premium"));
  }

  /// True when the deck has a SUCCESS publish or one in flight: its slug is then the key of builds,
  /// patches and every device's progress, and must not change (CBE-13).
  public static async Task<bool> IsSlugLockedAsync(NpgsqlConnection conn, long deckId)
  {
    const string sql = "select exists(select 1 from deck_publishes where deck_id = $1 and status in ('SUCCESS','PENDING','PROCESSING'))";
    var result = await DbUtil.ExecuteScalarAsync(conn, null, sql, [deckId]);
    return Convert.ToBoolean(result, CultureInfo.InvariantCulture);
  }

  public static Task<APIGatewayProxyResponse> HandleAuthoringDecks(LambdaRequest req, Res res, AuthContext auth) =>
    HandleAuthoringDecks(req, res, auth, DefaultManifestRebuildAsync);

  public static async Task<APIGatewayProxyResponse> HandleAuthoringDecks(LambdaRequest req, Res res, AuthContext auth, DeckRollback.ManifestRebuildFn rebuild)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    var isSuperAdmin = auth.IsSuperAdmin;
    var adminSub = auth.UserSub;

    if (req.Method == "GET")
    {
      try
      {
        var slug = req.Query.TryGetValue("slug", out var s) ? s : null;
        var includeDeleted = isSuperAdmin && Validation.ParseBoolean(req.Query.TryGetValue("includeDeleted", out var id) ? id : null, false);
        var idInt = Validation.ParseOptionalInteger(req.Query.TryGetValue("id", out var rid) ? rid : null, "id");

        var sql = """
          select
            d.id,
            d.slug,
            d.title,
            d.author,
            d.description,
            d.locale,
            d.deck_type  as "deckType",
            d.version,

            d.tier,
            d.availability,
            d.eta,
            d.manifest_order as "manifestOrder",
            d.total_cards as "totalCards",
            d.preview_cards as "previewCards",
            d.retired_at_ms as "retiredAtMs",
            d.live_build_id as "liveBuildId",

            d.is_deleted as "isDeleted",
            d.created_at as "createdAt",
            d.updated_at as "updatedAt"
          from decks d
          """;

        var parameters = new List<object?>();
        var where = new List<string>();

        if (!isSuperAdmin)
        {
          if (string.IsNullOrEmpty(adminSub)) return res.Forbidden("Requires authenticated admin user");
          parameters.Add(adminSub);
          sql += $" join admin_deck_permissions p on p.deck_id = d.id and p.admin_sub = ${parameters.Count} and p.can_read = 1";
        }

        if (idInt is not null)
        {
          parameters.Add(idInt.Value);
          where.Add($"d.id = ${parameters.Count}");
        }

        if (!string.IsNullOrWhiteSpace(slug))
        {
          parameters.Add(slug.Trim());
          where.Add($"d.slug = ${parameters.Count}");
        }

        if (!includeDeleted) where.Add("d.is_deleted = 0");

        if (where.Count > 0) sql += " where " + string.Join(" and ", where);
        sql += " order by d.created_at desc";

        var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);
        return res.Ok(rows);
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

    if (req.Method == "POST")
    {
      if (!isSuperAdmin) return res.Forbidden("Creating decks requires super_admin");

      try
      {
        using var doc = Validation.ParseJsonBody(req);
        if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
        var body = doc.RootElement;

        var slug = body.TryGetProperty("slug", out var sl) ? sl.ToString() : null;
        var title = body.TryGetProperty("title", out var ti) ? ti.ToString() : null;
        var author = body.TryGetProperty("author", out var au) ? au.ToString() : null;
        var description = body.TryGetProperty("description", out var de) && de.ValueKind != JsonValueKind.Null ? de.ToString().Trim() : null;
        var locale = body.TryGetProperty("locale", out var lo) && lo.ValueKind != JsonValueKind.Null ? lo.ToString().Trim() : null;

        if (string.IsNullOrWhiteSpace(slug) || string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(author))
        {
          return res.BadRequest("VALIDATION_ERROR", "slug, title, author are required");
        }

        slug = Validation.RequireSlug(slug);

        var deckTypeInt = body.TryGetProperty("deckType", out var dt) ? Helpers.ParseOptionalInteger(dt, "deckType") : null;
        var versionInt = body.TryGetProperty("version", out var ve) ? Helpers.ParseOptionalInteger(ve, "version") : null;

        const string sql = """
          insert into decks (slug, title, author, description, locale, deck_type, version)
          values ($1, $2, $3, $4, coalesce($5,'en-US'), coalesce($6,1), coalesce($7,1))
          returning
            id, slug, title, author, description, locale,
            deck_type as "deckType",
            version,

            tier, availability, eta,
            manifest_order as "manifestOrder",
            total_cards as "totalCards",
            preview_cards as "previewCards",
            retired_at_ms as "retiredAtMs",

            is_deleted as "isDeleted",
            created_at as "createdAt", updated_at as "updatedAt";
          """;

        var parameters = new object?[]
        {
          slug.Trim(),
          title.Trim(),
          author.Trim(),
          description,
          locale,
          deckTypeInt,
          versionInt,
        };

        var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);
        return res.Ok(rows.Count > 0 ? rows[0] : null);
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

        if (!body.TryGetProperty("id", out var idEl)) return res.BadRequest("VALIDATION_ERROR", "id is required");
        var idInt = Helpers.RequireInteger(idEl, "id");

        var deckWriteDeny = await Helpers.RequireDeckWrite(conn, adminSub, idInt, isSuperAdmin, res);
        if (deckWriteDeny is not null) return deckWriteDeny;

        var beforeRows = await DbUtil.QueryAsync(conn, null, """
          select
            slug, title, locale,
            deck_type as "deckType",
            version,
            is_deleted as "isDeleted",
            tier, availability, eta,
            manifest_order as "manifestOrder",
            total_cards as "totalCards",
            preview_cards as "previewCards",
            retired_at_ms as "retiredAtMs",
            live_build_id as "liveBuildId"
          from decks
          where id = $1
          """, [idInt]);
        var before = beforeRows.Count > 0 ? beforeRows[0] : null;

        // CBE-13: a super_admin may not rename a deck once it has a SUCCESS or in-flight publish;
        // the slug is the key of builds, patches and every device's progress. Only an actual change
        // (compared after Trim, ordinal) trips the lock, so an unchanged slug on a full-form resave
        // and a JSON-null slug keep today's paths. Editors never reach here: slug is filtered for them.
        if (isSuperAdmin
            && before is not null
            && body.TryGetProperty("slug", out var slugEl)
            && slugEl.ValueKind == JsonValueKind.String)
        {
          var currentSlug = Convert.ToString(before["slug"], CultureInfo.InvariantCulture);
          var newSlug = slugEl.GetString()!.Trim();
          if (!string.Equals(newSlug, currentSlug, StringComparison.Ordinal) && await IsSlugLockedAsync(conn, idInt))
          {
            return Helpers.ErrorEnvelope(res, 409, "SLUG_LOCKED", "The slug cannot change after the deck has been published; create a new deck instead.");
          }
        }

        var spec = new List<Helpers.UpdateField>
        {
          new("slug", "slug", v => v.ValueKind == JsonValueKind.Null ? null : Validation.RequireSlug(v.ToString())),
          new("title", "title", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim()),
          new("author", "author", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim()),
          new("description", "description", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim()),
          new("locale", "locale", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim()),
          new("deckType", "deck_type", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(v, "deckType")),
          new("version", "version", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(v, "version")),
          new("isDeleted", "is_deleted", v => Helpers.ParseBoolean(v, false) ? 1 : 0),

          new("tier", "tier", NormalizeTier),
          new("availability", "availability", NormalizeAvailability),
          new("eta", "eta", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim()),
          new("manifestOrder", "manifest_order", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(v, "manifestOrder")),
          new("totalCards", "total_cards", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(v, "totalCards")),
          new("previewCards", "preview_cards", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(v, "previewCards")),
          new("retiredAtMs", "retired_at_ms", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(v, "retiredAtMs")),
        };

        var fullSpec = spec;
        if (!isSuperAdmin)
        {
          // editors: restrict dangerous fields
          spec = spec.Where(f =>
              f.BodyKey is not ("isDeleted" or "slug" or "tier" or "availability" or "eta" or "manifestOrder" or "totalCards" or "previewCards" or "retiredAtMs"))
            .ToList();
        }
        var ignoredFields = Helpers.IgnoredFields(body, fullSpec, spec);

        var (fields, parameters) = Helpers.BuildUpdateSet(body, spec);
        if (fields.Count == 1)
        {
          return ignoredFields.Count > 0
            ? res.BadRequest("VALIDATION_ERROR", $"No fields to update (ignored for your role: {string.Join(", ", ignoredFields)})")
            : res.BadRequest("VALIDATION_ERROR", "No fields to update");
        }

        var sql = $"""
          update decks
          set {string.Join(", ", fields)}
          where id = ${parameters.Count + 1}
          returning
            id, slug, title, author, description, locale,
            deck_type as "deckType",
            version,

            tier, availability, eta,
            manifest_order as "manifestOrder",
            total_cards as "totalCards",
            preview_cards as "previewCards",
            retired_at_ms as "retiredAtMs",

            is_deleted as "isDeleted",
            created_at as "createdAt",
            updated_at as "updatedAt";
          """;

        parameters.Add(idInt);
        var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);
        if (rows.Count == 0) return res.NotFound("Deck not found");
        var after = rows[0];
        bool rebuilt;
        string? note;
        if (before is null || !ManifestFieldsChanged(before, after))
        {
          (rebuilt, note) = (false, NoteNoManifestChange);
        }
        else if (DeliveryChanged(before, after))
        {
          Log.Event("warn", new { tag = "manifest-rebuild", reason = "republish_required", deckId = idInt });
          (rebuilt, note) = (false, NoteRepublishRequired);
        }
        else
        {
          (rebuilt, note) = await TryRebuildAsync(conn, idInt, "deck_put", rebuild);
        }
        after["manifestRebuilt"] = rebuilt;
        after["manifestNote"] = note;
        if (ignoredFields.Count > 0) after["ignoredFields"] = ignoredFields;
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
      if (!isSuperAdmin) return res.Forbidden("DELETE requires super_admin");

      try
      {
        var idInt = Validation.RequireInteger(req.Query.TryGetValue("id", out var id) ? id : null, "id");
        var rows = await DbUtil.QueryAsync(
          conn,
          null,
          "update decks set is_deleted = 1, updated_at = now() where id = $1 returning id;",
          [idInt]);

        if (rows.Count == 0) return res.NotFound("Deck not found");
        var (manifestRebuilt, manifestNote) = await TryRebuildAsync(conn, idInt, "deck_delete", rebuild);
        return res.Ok(new { id = idInt, manifestRebuilt, manifestNote });
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
}

