using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class Cards
{
  public static async Task<APIGatewayProxyResponse> HandleAuthoringCards(LambdaRequest req, Res res, AuthContext auth)
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
        var idInt = Validation.ParseOptionalInteger(req.Query.TryGetValue("id", out var id) ? id : null, "id");
        var deckIdInt = Validation.ParseOptionalInteger(req.Query.TryGetValue("deckId", out var did) ? did : null, "deckId");
        var includeDeleted = isSuperAdmin && Validation.ParseBoolean(req.Query.TryGetValue("includeDeleted", out var inc) ? inc : null, false);

        if (deckIdInt is not null)
        {
          var denyDeck = await Helpers.RequireDeckRead(conn, adminSub, deckIdInt.Value, isSuperAdmin, res);
          if (denyDeck is not null) return denyDeck;
        }

        // The migration-047 columns are read through the row's jsonb image: SQL null both for a null cell and for a
        // schema that has not run 047 yet, so the route never fails with 42703 between a code deploy and Migrate.
        var sql = """
          select
            c.id,
            c.deck_id       as "deckId",
            c.stable_uid    as "stableUid",
            c.question,
            c.explanation,
            c.code_snippet  as "codeSnippet",
            c.code_language as "codeLanguage",
            c.real_world_usage as "realWorldUsage",
            c.difficulty,
            c.order_in_deck as "orderInDeck",
            c.revision,
            c.version,
            c.is_deleted    as "isDeleted",
            c.created_at    as "createdAt",
            c.updated_at    as "updatedAt",
            c.topic,
            c.mcq,
            c.source,
            nullif(to_jsonb(c) -> 'translations', 'null'::jsonb) as translations,
            nullif(to_jsonb(c) -> 'translation_basis', 'null'::jsonb) as "translationBasis"
          from cards c
          """;

        var parameters = new List<object?>();
        var where = new List<string>();

        if (!isSuperAdmin)
        {
          if (string.IsNullOrEmpty(adminSub)) return res.Forbidden("Requires authenticated admin user");
          parameters.Add(adminSub);
          sql += $" join admin_deck_permissions p on p.deck_id = c.deck_id and p.admin_sub = ${parameters.Count} and p.can_read = 1";
        }

        if (idInt is not null)
        {
          parameters.Add(idInt.Value);
          where.Add($"c.id = ${parameters.Count}");
        }

        if (deckIdInt is not null)
        {
          parameters.Add(deckIdInt.Value);
          where.Add($"c.deck_id = ${parameters.Count}");
        }

        if (!includeDeleted) where.Add("c.is_deleted = 0");
        if (where.Count > 0) sql += " where " + string.Join(" and ", where);
        sql += " order by c.order_in_deck asc, c.id asc";

        var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);
        foreach (var row in rows)
        {
          TranslationValidation.ShapeRow(row);
          Helpers.JsonbCell(row, "mcq");
          Helpers.JsonbCell(row, "source");
        }
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
      try
      {
        using var doc = Validation.ParseJsonBody(req);
        if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
        var body = doc.RootElement;

        if (!body.TryGetProperty("deckId", out var deckIdEl) ||
            !body.TryGetProperty("stableUid", out var stableUidEl) ||
            !body.TryGetProperty("question", out var questionEl) ||
            !body.TryGetProperty("orderInDeck", out var orderEl))
        {
          return res.BadRequest("VALIDATION_ERROR", "deckId, stableUid, question, orderInDeck are required");
        }

        var deckIdInt = Helpers.RequireInteger(deckIdEl, "deckId");
        var stableUid = stableUidEl.ToString().Trim();
        var question = questionEl.ToString().Trim();
        if (string.IsNullOrEmpty(stableUid) || string.IsNullOrEmpty(question))
        {
          return res.BadRequest("VALIDATION_ERROR", "deckId, stableUid, question, orderInDeck are required");
        }

        var denyDeck = await Helpers.RequireDeckWrite(conn, adminSub, deckIdInt, isSuperAdmin, res);
        if (denyDeck is not null) return denyDeck;

        var orderInDeckInt = Helpers.RequireInteger(orderEl, "orderInDeck");

        var explanation = body.TryGetProperty("explanation", out var exEl) && exEl.ValueKind != JsonValueKind.Null ? exEl.ToString().Trim() : null;
        var codeSnippet = body.TryGetProperty("codeSnippet", out var csEl) && csEl.ValueKind != JsonValueKind.Null ? csEl.ToString() : null;
        var codeLanguage = body.TryGetProperty("codeLanguage", out var clEl) && clEl.ValueKind != JsonValueKind.Null ? clEl.ToString().Trim() : null;
        var realWorldUsage = body.TryGetProperty("realWorldUsage", out var rwEl) && rwEl.ValueKind != JsonValueKind.Null ? rwEl.ToString().Trim() : null;

        var difficultyInt = body.TryGetProperty("difficulty", out var difEl) ? Helpers.ParseOptionalInteger(difEl, "difficulty") : null;
        var revisionInt = body.TryGetProperty("revision", out var revEl) ? Helpers.ParseOptionalInteger(revEl, "revision") : null;
        var versionInt = body.TryGetProperty("version", out var verEl) ? Helpers.ParseOptionalInteger(verEl, "version") : null;
        var topic = Helpers.ParseOptionalTopic(body);
        var source = Helpers.ParseOptionalSource(body);

        var mcq = body.TryGetProperty("mcq", out var mcqEl) && mcqEl.ValueKind != JsonValueKind.Null
          ? McqValidation.Canonicalize(mcqEl, question)
          : null;
        if (mcq is not null)
        {
          if (string.IsNullOrWhiteSpace(explanation)) return res.BadRequest("MCQ_EXPLANATION_REQUIRED", "explanation is required for an MCQ card");
          if (!McqValidation.IsMcqDifficulty(difficultyInt ?? 2)) return res.BadRequest("MCQ_DIFFICULTY_RANGE", "difficulty must be 1..3 for an MCQ card");
        }

        // Translations mirror the English just validated above; the basis records which English that was.
        string? translations = null;
        string? translationBasis = null;
        if (body.TryGetProperty("translations", out var trEl))
        {
          var english = new TranslationValidation.EnglishCard(question, explanation, realWorldUsage, mcq);
          translations = TranslationValidation.Canonicalize(trEl, english, await Helpers.DeckLocaleAsync(conn, deckIdInt));
          translationBasis = TranslationValidation.BasisJson(translations, english);
        }

        // An untranslated card inserts exactly as before migration 047, so this route works on either side of it; a
        // translated one needs the columns.
        var withTranslations = translations is not null;
        if (withTranslations && !await Helpers.ColumnExistsAsync(conn, null, "cards", "translations")) return Helpers.TranslationsNotMigrated(res);

        var sql = $"""
          insert into cards (
            deck_id, stable_uid, question, explanation, code_snippet, code_language,
            real_world_usage, difficulty, order_in_deck, revision, version, topic, mcq, source{(withTranslations ? ", translations, translation_basis" : "")}
          )
          values (
            $1,$2,$3,$4,$5,$6,$7,
            coalesce($8,2),
            $9,
            coalesce($10,1),
            coalesce($11,1),
            $12,
            $13::jsonb,
            $14::jsonb{(withTranslations ? ", $15::jsonb, $16::jsonb" : "")}
          )
          returning
            id,
            deck_id       as "deckId",
            stable_uid    as "stableUid",
            question,
            explanation,
            code_snippet  as "codeSnippet",
            code_language as "codeLanguage",
            real_world_usage as "realWorldUsage",
            difficulty,
            order_in_deck as "orderInDeck",
            revision,
            version,
            is_deleted    as "isDeleted",
            created_at    as "createdAt",
            updated_at    as "updatedAt",
            topic,
            mcq,
            source,
            nullif(to_jsonb(cards) -> 'translations', 'null'::jsonb) as translations,
            nullif(to_jsonb(cards) -> 'translation_basis', 'null'::jsonb) as "translationBasis";
          """;

        var parameters = new List<object?>
        {
          deckIdInt,
          stableUid,
          question,
          explanation,
          codeSnippet,
          codeLanguage,
          realWorldUsage,
          difficultyInt,
          orderInDeckInt,
          revisionInt,
          versionInt,
          topic, mcq, source,
        };
        if (withTranslations)
        {
          parameters.Add(translations);
          parameters.Add(translationBasis);
        }

        var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);
        if (rows.Count > 0)
        {
          TranslationValidation.ShapeRow(rows[0]);
          Helpers.JsonbCell(rows[0], "mcq");
          Helpers.JsonbCell(rows[0], "source");
        }
        return res.Ok(rows.Count > 0 ? rows[0] : null);
      }
      catch (McqValidationError ex)
      {
        return res.BadRequest(ex.Code, ex.Message);
      }
      catch (TranslationValidationError ex)
      {
        return res.BadRequest(ex.Code, ex.Message);
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

        var expectedEl = body.TryGetProperty("expectedVersion", out var evEl) ? evEl
          : body.TryGetProperty("version", out var vEl) ? vEl
          : default;

        if (expectedEl.ValueKind == JsonValueKind.Undefined)
        {
          return res.BadRequest("VALIDATION_ERROR", "expectedVersion is required");
        }

        var expectedVersionInt = Helpers.RequireInteger(expectedEl, "expectedVersion");

        var deckIdFromDb = await Helpers.GetDeckIdByCardId(conn, idInt);
        if (deckIdFromDb is null) return res.NotFound("Card not found");

        var denyDeck = await Helpers.RequireDeckWrite(conn, adminSub, deckIdFromDb.Value, isSuperAdmin, res);
        if (denyDeck is not null) return denyDeck;

        long? nextDeckId = null;
        if (body.TryGetProperty("deckId", out var nextDeckEl) &&
            nextDeckEl.ValueKind != JsonValueKind.Null &&
            !string.IsNullOrWhiteSpace(nextDeckEl.ToString()))
        {
          nextDeckId = Helpers.EnsureInteger(nextDeckEl, "deckId");
        }

        if (!isSuperAdmin && nextDeckId is not null && nextDeckId != deckIdFromDb.Value)
        {
          return res.Forbidden("Moving cards between decks requires super_admin");
        }

        var stored = await DbUtil.QueryAsync(conn, null,
          """
          select question, explanation, real_world_usage as "realWorldUsage", difficulty, mcq,
            nullif(to_jsonb(cards) -> 'translations', 'null'::jsonb) as translations
          from cards where id = $1
          """, [idInt]);
        if (stored.Count == 0) return res.NotFound("Card not found");
        var storedRow = stored[0];
        var effectiveQuestion = body.TryGetProperty("question", out var qEl) && qEl.ValueKind != JsonValueKind.Null
          ? qEl.ToString().Trim()
          : storedRow["question"] as string ?? string.Empty;
        var effectiveExplanation = body.TryGetProperty("explanation", out var exEl)
          ? (exEl.ValueKind == JsonValueKind.Null ? null : exEl.ToString().Trim())
          : storedRow["explanation"] as string;
        long? effectiveDifficulty = body.TryGetProperty("difficulty", out var dEl)
          ? (dEl.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(dEl, "difficulty"))
          : Convert.ToInt64(storedRow["difficulty"], CultureInfo.InvariantCulture);
        string? effectiveMcq;
        if (body.TryGetProperty("mcq", out var mcqEl))
        {
          effectiveMcq = mcqEl.ValueKind == JsonValueKind.Null ? null : McqValidation.Canonicalize(mcqEl, effectiveQuestion);
        }
        else
        {
          var storedMcq = Helpers.JsonbElement(storedRow, "mcq");
          effectiveMcq = storedMcq is null ? null : McqValidation.Canonicalize(storedMcq.Value, effectiveQuestion);
        }
        if (effectiveMcq is not null)
        {
          if (string.IsNullOrWhiteSpace(effectiveExplanation)) return res.BadRequest("MCQ_EXPLANATION_REQUIRED", "explanation is required for an MCQ card");
          if (effectiveDifficulty is not long d || !McqValidation.IsMcqDifficulty(d)) return res.BadRequest("MCQ_DIFFICULTY_RANGE", "difficulty must be 1..3 for an MCQ card");
        }

        // Translations against the effective English, like the mcq above: a body translations block is canonicalised and
        // restamped; without one the stored translations must still mirror the English after this edit (a text-only
        // English change keeps the old basis, so the translation reads as stale until it is restamped).
        var effectiveRealWorldUsage = body.TryGetProperty("realWorldUsage", out var rwEl)
          ? (rwEl.ValueKind == JsonValueKind.Null ? null : rwEl.ToString().Trim())
          : storedRow["realWorldUsage"] as string;
        var english = new TranslationValidation.EnglishCard(effectiveQuestion, effectiveExplanation, effectiveRealWorldUsage, effectiveMcq);
        var effectiveDeckLocale = await Helpers.DeckLocaleAsync(conn, nextDeckId ?? deckIdFromDb.Value);
        string? translations = null;
        string? translationBasis = null;
        var writeTranslations = false;
        if (body.TryGetProperty("translations", out var trEl))
        {
          translations = TranslationValidation.Canonicalize(trEl, english, effectiveDeckLocale);
          translationBasis = TranslationValidation.BasisJson(translations, english);
          // Before migration 047 there is nothing to clear; a translation to store needs the columns.
          writeTranslations = await Helpers.ColumnExistsAsync(conn, null, "cards", "translations");
          if (!writeTranslations && translations is not null) return Helpers.TranslationsNotMigrated(res);
        }
        else if (Helpers.JsonbElement(storedRow, "translations") is { } storedTranslations)
        {
          TranslationValidation.Canonicalize(storedTranslations, english, effectiveDeckLocale);
        }

        var spec = new List<Helpers.UpdateField>
        {
          new("deckId", "deck_id", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(v, "deckId")),
          new("stableUid", "stable_uid", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim()),
          new("question", "question", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim()),
          new("explanation", "explanation", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim()),
          new("codeSnippet", "code_snippet", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString()),
          new("codeLanguage", "code_language", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim()),
          new("realWorldUsage", "real_world_usage", v => v.ValueKind == JsonValueKind.Null ? null : v.ToString().Trim()),
          new("difficulty", "difficulty", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(v, "difficulty")),
          new("orderInDeck", "order_in_deck", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(v, "orderInDeck")),
          new("revision", "revision", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.EnsureInteger(v, "revision")),
          new("topic", "topic", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.NormalizeTopic(v)),
          new("mcq", "mcq", v => v.ValueKind == JsonValueKind.Null ? null : McqValidation.Canonicalize(v, effectiveQuestion), "::jsonb"),
          new("source", "source", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.NormalizeSource(v), "::jsonb"),
          new("isDeleted", "is_deleted", v => Helpers.ParseBoolean(v, false) ? 1 : 0),
        };
        if (writeTranslations)
        {
          // One body key, two columns: a translations block always writes its basis alongside.
          spec.Add(new("translations", "translations", _ => translations, "::jsonb"));
          spec.Add(new("translations", "translation_basis", _ => translationBasis, "::jsonb"));
        }

        var fullSpec = spec;
        if (!isSuperAdmin)
        {
          // editors: restrict moving deck, deleting, and changing stableUid (progress key)
          spec = spec.Where(f => f.BodyKey is not ("deckId" or "isDeleted" or "stableUid")).ToList();
        }
        var ignoredFields = Helpers.IgnoredFields(body, fullSpec, spec);

        var (fields, parameters) = Helpers.BuildUpdateSet(body, spec);
        if (fields.Count == 1)
        {
          return ignoredFields.Count > 0
            ? res.BadRequest("VALIDATION_ERROR", $"No fields to update (ignored for your role: {string.Join(", ", ignoredFields)})")
            : res.BadRequest("VALIDATION_ERROR", "No fields to update");
        }

        // version++ (insert before updated_at)
        var updatedAtIndex = fields.Count - 1;
        fields.Insert(updatedAtIndex, "version = version + 1");

        var sql = $"""
          update cards
          set {string.Join(", ", fields)}
          where id = ${parameters.Count + 1} and version = ${parameters.Count + 2}
          returning
            id,
            deck_id       as "deckId",
            stable_uid    as "stableUid",
            question,
            explanation,
            code_snippet  as "codeSnippet",
            code_language as "codeLanguage",
            real_world_usage as "realWorldUsage",
            difficulty,
            order_in_deck as "orderInDeck",
            revision,
            version,
            is_deleted    as "isDeleted",
            created_at    as "createdAt",
            updated_at    as "updatedAt",
            topic,
            mcq,
            source,
            nullif(to_jsonb(cards) -> 'translations', 'null'::jsonb) as translations,
            nullif(to_jsonb(cards) -> 'translation_basis', 'null'::jsonb) as "translationBasis";
          """;

        parameters.Add(idInt);
        parameters.Add(expectedVersionInt);

        var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);
        if (rows.Count == 0)
        {
          var check = await DbUtil.QueryAsync(conn, null, "select version from cards where id = $1", [idInt]);
          if (check.Count == 0) return res.NotFound("Card not found");
          return Helpers.ErrorEnvelope(res, 409, "VERSION_CONFLICT", "Card has been modified by another user. Please reload and try again.");
        }

        TranslationValidation.ShapeRow(rows[0]);
        Helpers.JsonbCell(rows[0], "mcq");
        Helpers.JsonbCell(rows[0], "source");
        if (ignoredFields.Count > 0) rows[0]["ignoredFields"] = ignoredFields;
        return res.Ok(rows[0]);
      }
      catch (McqValidationError ex)
      {
        return res.BadRequest(ex.Code, ex.Message);
      }
      catch (TranslationValidationError ex)
      {
        return res.BadRequest(ex.Code, ex.Message);
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
          "update cards set is_deleted = 1, updated_at = now() where id = $1 returning id;",
          [idInt]);

        if (rows.Count == 0) return res.NotFound("Card not found");
        return res.Ok(null);
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

