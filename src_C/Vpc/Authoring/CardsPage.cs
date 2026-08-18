using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Pagination;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>
/// GET /api/v1/authoring/cards/page — keyset-paginated card list, ordered by
/// (order_in_deck asc, id asc) with an opaque cursor, in the same
/// {items, nextCursor, hasMore} envelope the paged deck list uses.
///
/// Additive on purpose. GET /api/v1/authoring/cards still returns every
/// matching card in one response and is untouched by this file — the console
/// and the mobile app both call it today, and adopting the paged route is a
/// frontend decision, not a backend one. That is also why the projection below
/// is duplicated rather than shared: extracting it would edit the endpoint this
/// change promises not to touch, and a select list is a wire contract, so two
/// copies that drift are two contracts, which is what versioning is for.
///
/// Filters mirror the full endpoint's list filters (deckId, includeDeleted) and
/// its auth model exactly, including the per-deck permission join for
/// non-super-admins: a paged variant that saw more rows than the endpoint it
/// pages would be a privilege escalation wearing a pagination costume. The full
/// endpoint's `id` filter is deliberately absent — paging one row by primary key
/// is a fetch, not a page.
/// </summary>
public static class CardsPage
{
  private const int DefaultLimit = 50;
  private const int MaxLimit = 200;

  public static async Task<APIGatewayProxyResponse> HandleAuthoringCardsPage(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "GET") return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    var isSuperAdmin = auth.IsSuperAdmin;
    var adminSub = auth.UserSub;

    try
    {
      var deckIdInt = Validation.ParseOptionalInteger(req.Query.TryGetValue("deckId", out var did) ? did : null, "deckId");
      var includeDeleted = isSuperAdmin && Validation.ParseBoolean(req.Query.TryGetValue("includeDeleted", out var inc) ? inc : null, false);

      var limitRaw = Validation.ParseOptionalInteger(req.Query.TryGetValue("limit", out var lr) ? lr : null, "limit");
      var limit = (int)Math.Max(1, Math.Min(limitRaw ?? DefaultLimit, MaxLimit));

      var cursorRaw = req.Query.TryGetValue("cursor", out var cr) ? cr : null;
      CardsPageCursor? cursor = null;
      if (!string.IsNullOrWhiteSpace(cursorRaw))
      {
        // A bad cursor fails loudly rather than being ignored: silently starting
        // the walk over from the beginning re-delivers pages the client already
        // has, and it looks like success.
        cursor = CardsPageCursor.TryDecode(cursorRaw);
        if (cursor is null) return res.BadRequest("VALIDATION_ERROR", "cursor is malformed");
      }

      if (deckIdInt is not null)
      {
        var denyDeck = await Helpers.RequireDeckRead(conn, adminSub, deckIdInt.Value, isSuperAdmin, res);
        if (denyDeck is not null) return denyDeck;
      }

      string? permissionAdminSub = null;
      if (!isSuperAdmin)
      {
        if (string.IsNullOrEmpty(adminSub)) return res.Forbidden("Requires authenticated admin user");
        permissionAdminSub = adminSub;
      }

      var (sql, parameters) = BuildPageQuery(deckIdInt, includeDeleted, permissionAdminSub, cursor, limit);
      var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);

      // Same rule as the paged deck list: a full page means "ask again", and the
      // last page of an exactly-divisible walk therefore costs one extra empty
      // request. The alternative (fetch limit + 1 and trim) is a different wire
      // contract for the same envelope, and consistency between the two paged
      // endpoints is worth more than one round trip at the end of a walk.
      var hasMore = rows.Count == limit;
      string? nextCursor = null;
      if (hasMore && rows.Count > 0)
      {
        var last = rows[^1];
        nextCursor = new CardsPageCursor(
          Convert.ToInt32(last["orderInDeck"], CultureInfo.InvariantCulture),
          Convert.ToInt64(last["id"], CultureInfo.InvariantCulture)).Encode();
      }

      return res.Ok(new
      {
        items = rows,
        nextCursor,
        hasMore,
      });
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

  /// <summary>
  /// The page query, built apart from the handler so a test can EXPLAIN the
  /// exact text production runs. A pagination that is correct but scans the
  /// whole table once per page is not an improvement over the unbounded read it
  /// replaced, and only the planner can settle which one this is.
  /// </summary>
  internal static (string Sql, List<object?> Parameters) BuildPageQuery(
    long? deckId,
    bool includeDeleted,
    string? permissionAdminSub,
    CardsPageCursor? cursor,
    int limit)
  {
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
        c.updated_at    as "updatedAt"
      from cards c
      """;

    var parameters = new List<object?>();
    var where = new List<string>();

    if (permissionAdminSub is not null)
    {
      // Cannot fan out: uq_admin_deck_permissions is unique on
      // (admin_sub, deck_id). A join that duplicated a card would break the walk
      // itself, not just the response — a repeated row repeats a cursor.
      parameters.Add(permissionAdminSub);
      sql += $" join admin_deck_permissions p on p.deck_id = c.deck_id and p.admin_sub = ${parameters.Count} and p.can_read = 1";
    }

    if (deckId is not null)
    {
      parameters.Add(deckId.Value);
      where.Add($"c.deck_id = ${parameters.Count}");
    }

    if (!includeDeleted) where.Add("c.is_deleted = 0");

    if (cursor is not null)
    {
      // Sargable keyset row comparison on the full sort tuple. Deck-unscoped it
      // rides idx_cards_order_id (order_in_deck, id) from migration 017, where
      // the whole tuple becomes the index condition. Deck-scoped the planner
      // chooses between that index and uq_cards_deck_order
      // (deck_id, order_in_deck) by deck count — on the latter it extracts
      // `order_in_deck >= $n` from the row comparison as the index condition and
      // incremental-sorts groups of one, since that constraint is exactly what
      // makes order_in_deck unique inside a deck. Both are index ranges; the
      // point is that neither is a scan.
      //
      // The (order_in_deck, id) tuple is compared as a unit, not as
      // `order_in_deck > $n or (order_in_deck = $n and id > $m)`: the row form
      // is what the planner can turn into an index range, and the OR form is
      // what turns a keyset back into a scan.
      parameters.Add(cursor.OrderInDeck);
      var orderIdx = parameters.Count;
      parameters.Add(cursor.Id);
      var idIdx = parameters.Count;
      where.Add($"(c.order_in_deck, c.id) > (${orderIdx}, ${idIdx})");
    }

    if (where.Count > 0) sql += " where " + string.Join(" and ", where);

    parameters.Add(limit);

    // The `, c.id asc` leg is load-bearing whenever the listing is not scoped to
    // one deck, where equal order_in_deck is not an edge case but the norm (every
    // deck has a card at order 1). Drop it and the sort order among a tie group
    // is whatever the plan happens to emit, while the cursor still advances past
    // the row that came out last — so a page boundary landing inside a tie group
    // loses the rest of it.
    sql += $" order by c.order_in_deck asc, c.id asc limit ${parameters.Count}";

    return (sql, parameters);
  }
}
