using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>
/// POST /api/v1/authoring/cards/import — atomic, idempotent bulk upsert of a whole deck file
/// by (deck_id, stable_uid), up to <see cref="MaxCards"/> cards per call (CBE-02).
///
/// The whole file lands in one transaction: either every card is written or nothing is. Because
/// migration 022 makes uq_cards_deck_order DEFERRABLE INITIALLY IMMEDIATE, the handler runs
/// `set constraints uq_cards_deck_order deferred` so it can renumber freely (mid-deck inserts,
/// swaps) without each intermediate step colliding; the constraint is re-checked with
/// `set constraints uq_cards_deck_order immediate` right before commit. Re-sending the same
/// payload changes nothing and bumps no version.
///
/// On a database that has not run 022 the deferral fails with SQLSTATE 42809, which this handler
/// maps to 503 MIGRATION_REQUIRED on this route alone. Deploy order is migrate, then code.
/// </summary>
public static class CardsImport
{
  public const int MaxCards = 500;
  public const int MaxOrderInDeck = 100_000_000;

  private sealed record ImportCard(
    int Index,
    string StableUid,
    string Question,
    string? Explanation,
    string? CodeSnippet,
    string? CodeLanguage,
    string? RealWorldUsage,
    long Difficulty,
    int OrderInDeck,
    string? Topic,
    string? Mcq);

  public static async Task<APIGatewayProxyResponse> HandleCardsImport(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    long deckId;
    List<ImportCard> cards;

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = doc.RootElement;

      if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("deckId", out var deckIdEl))
      {
        return res.BadRequest("VALIDATION_ERROR", "deckId is required");
      }
      deckId = Helpers.RequireInteger(deckIdEl, "deckId");

      if (!body.TryGetProperty("cards", out var cardsEl) || cardsEl.ValueKind != JsonValueKind.Array)
      {
        return res.BadRequest("VALIDATION_ERROR", "cards must be an array of 1..500 cards");
      }
      var count = cardsEl.GetArrayLength();
      if (count < 1 || count > MaxCards)
      {
        return res.BadRequest("VALIDATION_ERROR", "cards must be an array of 1..500 cards");
      }

      var denyDeck = await Helpers.RequireDeckWrite(conn, auth.UserSub, deckId, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      cards = new List<ImportCard>(count);
      var i = 0;
      foreach (var cardEl in cardsEl.EnumerateArray())
      {
        var uid = string.Empty;
        try
        {
          if (cardEl.ValueKind != JsonValueKind.Object)
          {
            throw new ValidationError("card must be an object", "card");
          }

          if (!cardEl.TryGetProperty("stableUid", out var uidEl) || uidEl.ValueKind == JsonValueKind.Null)
          {
            throw new ValidationError("stableUid is required", "stableUid");
          }
          uid = uidEl.ToString().Trim();
          if (uid.Length == 0) throw new ValidationError("stableUid is required", "stableUid");

          if (!cardEl.TryGetProperty("question", out var questionEl) || questionEl.ValueKind == JsonValueKind.Null)
          {
            throw new ValidationError("question is required", "question");
          }
          var question = questionEl.ToString().Trim();
          if (question.Length == 0) throw new ValidationError("question is required", "question");

          cardEl.TryGetProperty("orderInDeck", out var orderEl);
          var orderLong = Helpers.RequireInteger(orderEl, "orderInDeck");
          if (orderLong < 1 || orderLong > MaxOrderInDeck)
          {
            throw new ValidationError($"orderInDeck must be an integer in 1..{MaxOrderInDeck}", "orderInDeck");
          }
          var orderInDeck = (int)orderLong;

          var explanation = cardEl.TryGetProperty("explanation", out var exEl) && exEl.ValueKind != JsonValueKind.Null ? exEl.ToString().Trim() : null;
          var codeSnippet = cardEl.TryGetProperty("codeSnippet", out var csEl) && csEl.ValueKind != JsonValueKind.Null ? csEl.ToString() : null;
          var codeLanguage = cardEl.TryGetProperty("codeLanguage", out var clEl) && clEl.ValueKind != JsonValueKind.Null ? clEl.ToString().Trim() : null;
          var realWorldUsage = cardEl.TryGetProperty("realWorldUsage", out var rwEl) && rwEl.ValueKind != JsonValueKind.Null ? rwEl.ToString().Trim() : null;

          var difficultyInt = cardEl.TryGetProperty("difficulty", out var difEl) ? Helpers.ParseOptionalInteger(difEl, "difficulty") : null;
          var difficulty = difficultyInt ?? 2;

          var topic = Helpers.ParseOptionalTopic(cardEl);

          var mcq = cardEl.TryGetProperty("mcq", out var mcqEl) && mcqEl.ValueKind != JsonValueKind.Null
            ? McqValidation.Canonicalize(mcqEl, question)
            : null;
          if (mcq is not null)
          {
            if (string.IsNullOrWhiteSpace(explanation)) throw new McqValidationError("MCQ_EXPLANATION_REQUIRED", "explanation is required for an MCQ card");
            if (!McqValidation.IsMcqDifficulty(difficulty)) throw new McqValidationError("MCQ_DIFFICULTY_RANGE", "difficulty must be 1..3 for an MCQ card");
          }

          cards.Add(new ImportCard(i, uid, question, explanation, codeSnippet, codeLanguage, realWorldUsage, difficulty, orderInDeck, topic, mcq));
        }
        catch (McqValidationError ex)
        {
          return res.BadRequest(ex.Code, $"cards[{i}] ({uid}): {ex.Message}");
        }
        catch (ValidationError ex)
        {
          return res.BadRequest("VALIDATION_ERROR", $"cards[{i}] ({uid}): {ex.Message}");
        }

        i++;
      }

      var seenUids = new HashSet<string>(StringComparer.Ordinal);
      var seenOrders = new HashSet<int>();
      foreach (var c in cards)
      {
        if (!seenUids.Add(c.StableUid)) return res.BadRequest("VALIDATION_ERROR", $"duplicate stableUid in cards: {c.StableUid}");
        if (!seenOrders.Add(c.OrderInDeck)) return res.BadRequest("VALIDATION_ERROR", $"duplicate orderInDeck in cards: {c.OrderInDeck}");
      }
    }
    catch (McqValidationError ex)
    {
      return res.BadRequest(ex.Code, ex.Message);
    }
    catch (Exception ex) when (ex is ValidationError)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }

    var uids = cards.Select(c => c.StableUid).ToArray();
    var orders = cards.Select(c => c.OrderInDeck).ToArray();
    var maxOrder = orders.Max();

    var created = 0;
    var updated = 0;
    var unchangedUids = new List<string>();
    var actions = new Dictionary<string, string>(StringComparer.Ordinal);
    var ids = new Dictionary<string, long>(StringComparer.Ordinal);
    var parked = 0;

    try
    {
      await using var tx = await conn.BeginTransactionAsync();

      await DbUtil.ExecuteAsync(conn, tx, "set constraints uq_cards_deck_order deferred", []);

      var deckRows = await DbUtil.QueryAsync(conn, tx,
        "select id from decks where id = $1 and is_deleted = 0 for update", [deckId]);
      if (deckRows.Count == 0) return Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", $"Deck {deckId} not found");

      // A soft-deleted card in this deck whose stable_uid is in the payload cannot be revived by an
      // upsert (that would collide on uq_cards_deck_uid and silently resurrect a deleted card), so
      // the whole import is refused.
      var softDeletedRows = await DbUtil.QueryAsync(conn, tx,
        """select stable_uid as "stableUid" from cards where deck_id = $1 and is_deleted = 1 and stable_uid = any($2)""",
        [deckId, uids]);
      if (softDeletedRows.Count > 0)
      {
        var list = string.Join(", ", softDeletedRows.Take(10).Select(r => (string)r["stableUid"]!));
        return Helpers.ErrorEnvelope(res, 409, "SOFT_DELETED_UID", $"stableUid belongs to a deleted card in this deck: {list}");
      }

      // Park soft-deleted cards outside the payload that sit on an order the payload needs: move them
      // past the highest order so the live payload can take those slots. This is the only row outside
      // the payload the import ever touches.
      const string parkSql = """
        with blockers as (
          select id, row_number() over (order by order_in_deck, id) as rn
          from cards
          where deck_id = $1 and is_deleted = 1 and order_in_deck = any($2) and not (stable_uid = any($3))
        ), base as (
          select greatest(coalesce(max(order_in_deck), 0), $4::int) as b from cards where deck_id = $1
        )
        update cards c
        set order_in_deck = base.b + blockers.rn, updated_at = now()
        from blockers, base
        where c.id = blockers.id
        """;
      parked = await DbUtil.ExecuteAsync(conn, tx, parkSql, [deckId, orders, uids, maxOrder]);

      // A live card outside the payload holding an order the payload needs is a real conflict: nothing
      // is written and the caller resolves it.
      var holderRows = await DbUtil.QueryAsync(conn, tx,
        """select stable_uid as "stableUid", order_in_deck as "orderInDeck" from cards where deck_id = $1 and order_in_deck = any($2) and not (stable_uid = any($3))""",
        [deckId, orders, uids]);
      if (holderRows.Count > 0)
      {
        var pairs = string.Join("; ", holderRows.Take(10).Select(r =>
          $"orderInDeck {Convert.ToInt32(r["orderInDeck"], CultureInfo.InvariantCulture)} is held by card {(string)r["stableUid"]!}"));
        return Helpers.ErrorEnvelope(res, 409, "ORDER_CONFLICT",
          $"{pairs}, which is not in this import; nothing was written. Retry after resolving the conflict.");
      }

      const string upsertSql = """
        insert into cards (
          deck_id, stable_uid, question, explanation, code_snippet, code_language,
          real_world_usage, difficulty, order_in_deck, topic, mcq
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        on conflict (deck_id, stable_uid) do update set
          question = excluded.question,
          explanation = excluded.explanation,
          code_snippet = excluded.code_snippet,
          code_language = excluded.code_language,
          real_world_usage = excluded.real_world_usage,
          difficulty = excluded.difficulty,
          order_in_deck = excluded.order_in_deck,
          topic = excluded.topic,
          mcq = excluded.mcq,
          version = cards.version + 1,
          updated_at = now()
        where (cards.question, cards.explanation, cards.code_snippet, cards.code_language, cards.real_world_usage,
               cards.difficulty, cards.order_in_deck, cards.topic, cards.mcq)
          is distinct from
              (excluded.question, excluded.explanation, excluded.code_snippet, excluded.code_language, excluded.real_world_usage,
               excluded.difficulty, excluded.order_in_deck, excluded.topic, excluded.mcq)
        returning id, (xmax = 0) as inserted
        """;

      foreach (var c in cards)
      {
        var rows = await DbUtil.QueryAsync(conn, tx, upsertSql, new object?[]
        {
          deckId, c.StableUid, c.Question, c.Explanation, c.CodeSnippet, c.CodeLanguage,
          c.RealWorldUsage, c.Difficulty, c.OrderInDeck, c.Topic, c.Mcq,
        });

        if (rows.Count == 0)
        {
          actions[c.StableUid] = "unchanged";
          unchangedUids.Add(c.StableUid);
          continue;
        }

        ids[c.StableUid] = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
        var inserted = Convert.ToBoolean(rows[0]["inserted"]);
        if (inserted)
        {
          created++;
          actions[c.StableUid] = "created";
        }
        else
        {
          updated++;
          actions[c.StableUid] = "updated";
        }
      }

      if (unchangedUids.Count > 0)
      {
        var idRows = await DbUtil.QueryAsync(conn, tx,
          """select id, stable_uid as "stableUid" from cards where deck_id = $1 and stable_uid = any($2)""",
          [deckId, unchangedUids.ToArray()]);
        foreach (var r in idRows)
        {
          ids[(string)r["stableUid"]!] = Convert.ToInt64(r["id"], CultureInfo.InvariantCulture);
        }
      }

      await DbUtil.ExecuteAsync(conn, tx, "set constraints uq_cards_deck_order immediate", []);
      await tx.CommitAsync();
    }
    catch (PostgresException pg) when (pg is { SqlState: "42809" })
    {
      return Helpers.ErrorEnvelope(res, 503, "MIGRATION_REQUIRED", "cards.uq_cards_deck_order is not deferrable yet; run migration 022 first");
    }
    catch (PostgresException pg) when (pg is { SqlState: "23505", ConstraintName: "uq_cards_deck_order" })
    {
      return Helpers.ErrorEnvelope(res, 409, "ORDER_CONFLICT",
        "Another write changed card order in this deck during the import; nothing was written. Retry.");
    }
    catch (McqValidationError ex)
    {
      return res.BadRequest(ex.Code, ex.Message);
    }
    catch (Exception ex) when (ex is ValidationError)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (Exception ex)
    {
      return Helpers.HandlePgError(ex, res) ?? res.Error500(ex);
    }

    var unchanged = unchangedUids.Count;
    Log.Event("info", new { tag = "cards-import", deckId, received = cards.Count, created, updated, unchanged, parked });

    var results = cards.Select(c => new
    {
      stableUid = c.StableUid,
      id = ids.TryGetValue(c.StableUid, out var id) ? (long?)id : null,
      action = actions[c.StableUid],
    }).ToArray();

    return res.Ok(new { deckId, created, updated, unchanged, cards = results });
  }
}
