using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Runtime;

/// <summary>
/// POST /api/v1/draw-state/sync: one round trip that carries the whole
/// gamification state up and the merged, authoritative state back down.
///
/// Shape, and why it is not the review-sync shape: reviews are an append-only
/// event log because a review is a fact that happened at a time. A collection,
/// a pity counter and a wallet balance are STATE, and the state is small: one
/// deck's owned set is bounded by the deck size (hundreds), and there is one
/// wallet per user. So this endpoint takes a full snapshot and answers with a
/// full snapshot, with no cursor, no pagination and no event ids to reconcile.
/// The bound is the premise: if decks ever grow to tens of thousands of cards,
/// this has to become a delta protocol, and the request caps below are where
/// that would first be noticed.
///
/// Merge operators live in the SQL (see the migration 014 comments and
/// DrawStateMerge.cs for the executable spec): owned is a grow-only set union,
/// pity and wallet are last-writer-wins on a client updated_at_ms that is
/// clamped to server now + 5 minutes.
/// </summary>
public static class DrawStateSync
{
  private const int MaxDecksPerRequest = 100;
  private const int MaxOwnedPerDeck = 5000;
  private const int MaxOwnedPerRequest = 20000;

  // Response ceiling. A user past this many owned cards across all decks gets a
  // truncated page, and that is safe for exactly one reason: the client applies
  // the response as a UNION with what it already has, never as a replacement,
  // so a short answer delays convergence instead of deleting a collection.
  private const int MaxOwnedRowsInResponse = 20000;

  private const long ClientClockSlackMs = 5 * 60 * 1000;

  private sealed record DeckInput(string DeckSlug, List<string> Owned, PitySnapshot? Pity);

  public static async Task<APIGatewayProxyResponse> HandleDrawStateSync(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");

      var body = doc.RootElement;
      var userSub = auth.UserSub!;
      var email = GetClaimString(auth.Claims, "email") ?? GetClaimString(auth.Claims, "cognito:email");

      var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

      // Same lesson the review ingest learned about eventTimeMs, applied to the
      // only clock this endpoint has: an unclamped client timestamp fed into a
      // last-writer-wins comparison is permanent poison. A handset whose clock
      // says 2030 would win every merge for this user until 2030 actually
      // arrives, and nothing the user does could undo it. Clamp rather than
      // reject: the pull or the reveal really did happen, and dropping it would
      // cost real progress. (Mirrors ProgressEvents.cs eventTimeUpperBoundMs.)
      var clientClockCeilingMs = nowMs + ClientClockSlackMs;

      var decks = new List<DeckInput>();
      var deckIndex = new Dictionary<string, int>(StringComparer.Ordinal);
      var totalOwned = 0;

      if (body.TryGetProperty("decks", out var decksEl) && decksEl.ValueKind == JsonValueKind.Array)
      {
        var deckEls = decksEl.EnumerateArray().ToList();
        if (deckEls.Count > MaxDecksPerRequest)
        {
          throw new ValidationError($"decks too many (max {MaxDecksPerRequest})", "decks");
        }

        for (var i = 0; i < deckEls.Count; i++)
        {
          var d = deckEls[i];
          if (d.ValueKind != JsonValueKind.Object) throw new ValidationError($"decks[{i}] must be an object", $"decks[{i}]");

          var deckSlug = RequireString(d, "deckSlug", $"decks[{i}].deckSlug");

          var owned = new List<string>();
          if (d.TryGetProperty("owned", out var ownedEl) && ownedEl.ValueKind == JsonValueKind.Array)
          {
            foreach (var u in ownedEl.EnumerateArray())
            {
              var uid = u.ValueKind == JsonValueKind.String ? (u.GetString() ?? string.Empty).Trim() : string.Empty;
              if (uid.Length == 0) continue;
              owned.Add(uid);
            }
          }

          if (owned.Count > MaxOwnedPerDeck)
          {
            throw new ValidationError($"decks[{i}].owned too many (max {MaxOwnedPerDeck})", $"decks[{i}].owned");
          }

          totalOwned += owned.Count;
          if (totalOwned > MaxOwnedPerRequest)
          {
            throw new ValidationError($"owned too many across decks (max {MaxOwnedPerRequest})", "decks");
          }

          PitySnapshot? pity = null;
          if (d.TryGetProperty("pity", out var pityEl) && pityEl.ValueKind == JsonValueKind.Object)
          {
            var draws = Math.Max(0, OptionalInt(pityEl.TryGetProperty("draws", out var pd) ? pd : (JsonElement?)null) ?? 0);
            var threshold = Math.Max(0, OptionalInt(pityEl.TryGetProperty("threshold", out var pt) ? pt : (JsonElement?)null) ?? 0);
            // Missing or non-positive stamp defaults to 0, NOT to now(). Zero is
            // the client's way of saying "I never watched this value change, so I
            // cannot vouch for when it happened" (see UNKNOWN_STAMP_MS in
            // mobile/src/sync/drawStateSync.ts). Substituting now() here would
            // convert that admission into the strongest possible claim and let a
            // fresh install overwrite the account's real state, which is the
            // exact bug this whole change exists to prevent.
            var ts = OptionalMs(pityEl.TryGetProperty("updatedAtMs", out var pu) ? pu : (JsonElement?)null) ?? 0;
            if (ts > clientClockCeilingMs) ts = clientClockCeilingMs;
            pity = new PitySnapshot(draws, threshold, ts);
          }

          // Deck slugs are deduped rather than trusted to be distinct. The app
          // derives them from storage keys so they always are, but a repeated
          // slug would make the meta upsert touch one row twice in a single
          // statement, and Postgres answers that with an error ("ON CONFLICT DO
          // UPDATE command cannot affect row a second time") that would fail the
          // whole sync. Merging with the same operators used downstream keeps the
          // request-level fold and the row-level fold the same function.
          if (deckIndex.TryGetValue(deckSlug, out var existingAt))
          {
            var existing = decks[existingAt];
            existing.Owned.AddRange(owned);
            decks[existingAt] = existing with
            {
              Pity = existing.Pity is { } ep
                ? (pity is { } np ? DrawStateMerge.MergePity(ep, np) : ep)
                : pity,
            };
          }
          else
          {
            deckIndex[deckSlug] = decks.Count;
            decks.Add(new DeckInput(deckSlug, owned, pity));
          }
        }
      }

      WalletSnapshot? wallet = null;
      if (body.TryGetProperty("wallet", out var walletEl) && walletEl.ValueKind == JsonValueKind.Object)
      {
        var available = Math.Max(0, OptionalInt(walletEl.TryGetProperty("availablePulls", out var wa) ? wa : (JsonElement?)null) ?? 0);
        var reserve = Math.Max(0, OptionalInt(walletEl.TryGetProperty("reservePulls", out var wr) ? wr : (JsonElement?)null) ?? 0);
        // Defaults to 0 for the same reason as the pity stamp above.
        var ts = OptionalMs(walletEl.TryGetProperty("updatedAtMs", out var wu) ? wu : (JsonElement?)null) ?? 0;
        if (ts > clientClockCeilingMs) ts = clientClockCeilingMs;
        wallet = new WalletSnapshot(available, reserve, ts);
      }

      await using var tx = await conn.BeginTransactionAsync();
      try
      {
        // user_draw_* all reference users(user_sub), and a fresh install can
        // reach this endpoint before it ever pushes a review, so the parent row
        // is created here rather than assumed.
        const string upsertUser = """
          insert into users (user_sub, email, last_seen_at)
          values ($1, $2, now())
          on conflict (user_sub)
          do update set
            email = coalesce(excluded.email, users.email),
            last_seen_at = now()
          """;
        await DbUtil.ExecuteAsync(conn, tx, upsertUser, [userSub, email]);

        // Owned rows go up as two parallel arrays rather than a VALUES list:
        // one statement with 3 parameters regardless of card count, so a big
        // collection cannot walk into Npgsql's per-statement parameter ceiling.
        var ownedSlugs = new List<string>();
        var ownedUids = new List<string>();
        foreach (var deck in decks)
        {
          foreach (var uid in deck.Owned)
          {
            ownedSlugs.Add(deck.DeckSlug);
            ownedUids.Add(uid);
          }
        }

        if (ownedUids.Count > 0)
        {
          // The whole merge for the collection, and it is one clause: a revealed
          // card is revealed forever, so union is the operator and DO NOTHING is
          // union. Retries, duplicate rows inside one request and a device
          // re-pushing its entire set all land on the same state.
          const string insertOwned = """
            insert into user_draw_owned (user_sub, deck_slug, stable_uid)
            select $1, d.slug, d.uid
            from unnest($2::text[], $3::text[]) as d(slug, uid)
            on conflict (user_sub, deck_slug, stable_uid) do nothing
            """;
          await DbUtil.ExecuteAsync(conn, tx, insertOwned, [userSub, ownedSlugs.ToArray(), ownedUids.ToArray()]);
        }

        var metaSlugs = new List<string>();
        var metaDraws = new List<int>();
        var metaThresholds = new List<int>();
        var metaStamps = new List<long>();
        foreach (var deck in decks)
        {
          if (deck.Pity is not { } p) continue;
          metaSlugs.Add(deck.DeckSlug);
          metaDraws.Add(p.Draws);
          metaThresholds.Add(p.Threshold);
          metaStamps.Add(p.UpdatedAtMs);
        }

        if (metaSlugs.Count > 0)
        {
          // draws, threshold and updated_at_ms are decided by ONE predicate, the
          // same rule 013 applied to (due_at, srs_stage): a threshold taken from
          // device A next to a count taken from device B describes a pity state
          // that no device was ever in.
          //
          // The predicate is a ROW comparison, not a bare timestamp comparison,
          // and that is what makes this merge order independent. Stamps tie for
          // a real reason here: a client that has never observed a change to a
          // value sends 0 ("I cannot vouch for when this happened"), so every
          // first sync of every device ties with every other. With a plain
          // `>=` the last such device to arrive would win, and a fresh install
          // pushing an empty pity counter would wipe a device that had played
          // for months offline. Lexicographic (stamp, draws, threshold) breaks
          // that tie by content instead of by arrival, and resolves it toward
          // the counter that is further along. It is exactly
          // DrawStateMerge.ComparePity, which is what lets that spec's
          // commutativity test speak for this SQL.
          const string upsertMeta = """
            insert into user_draw_meta (user_sub, deck_slug, pity_draws, pity_threshold, updated_at_ms)
            select $1, m.slug, m.draws, m.threshold, m.ts
            from unnest($2::text[], $3::int[], $4::int[], $5::bigint[]) as m(slug, draws, threshold, ts)
            on conflict (user_sub, deck_slug) do update set
              pity_draws = case
                when (excluded.updated_at_ms, excluded.pity_draws, excluded.pity_threshold)
                     >= (user_draw_meta.updated_at_ms, user_draw_meta.pity_draws, user_draw_meta.pity_threshold)
                  then excluded.pity_draws
                else user_draw_meta.pity_draws
              end,
              pity_threshold = case
                when (excluded.updated_at_ms, excluded.pity_draws, excluded.pity_threshold)
                     >= (user_draw_meta.updated_at_ms, user_draw_meta.pity_draws, user_draw_meta.pity_threshold)
                  then excluded.pity_threshold
                else user_draw_meta.pity_threshold
              end,
              updated_at_ms = case
                when (excluded.updated_at_ms, excluded.pity_draws, excluded.pity_threshold)
                     >= (user_draw_meta.updated_at_ms, user_draw_meta.pity_draws, user_draw_meta.pity_threshold)
                  then excluded.updated_at_ms
                else user_draw_meta.updated_at_ms
              end
            """;
          await DbUtil.ExecuteAsync(conn, tx, upsertMeta, [
            userSub,
            metaSlugs.ToArray(),
            metaDraws.ToArray(),
            metaThresholds.ToArray(),
            metaStamps.ToArray(),
          ]);
        }

        if (wallet is { } w)
        {
          // Last-writer-wins on a balance, with the loss named in
          // 014_draw_state_sync.sql: two devices that both spend offline keep one
          // result. Accepted because pull counts are small and refundable; the
          // real fix is a wallet event log, and it is a separate change.
          //
          // Same lexicographic row comparison as the pity merge above, and here
          // the tie rule has teeth: an unknown-stamp push (0) from a fresh
          // install must never be able to zero a balance that a long-offline
          // device just uploaded under the same unknown stamp. Ordering ties by
          // (available, reserve) resolves them toward the larger balance, which
          // is both deterministic and the forgiving direction. Matches
          // DrawStateMerge.CompareWallet.
          const string upsertWallet = """
            insert into user_wallet (user_sub, available_pulls, reserve_pulls, updated_at_ms)
            values ($1, $2, $3, $4)
            on conflict (user_sub) do update set
              available_pulls = case
                when (excluded.updated_at_ms, excluded.available_pulls, excluded.reserve_pulls)
                     >= (user_wallet.updated_at_ms, user_wallet.available_pulls, user_wallet.reserve_pulls)
                  then excluded.available_pulls
                else user_wallet.available_pulls
              end,
              reserve_pulls = case
                when (excluded.updated_at_ms, excluded.available_pulls, excluded.reserve_pulls)
                     >= (user_wallet.updated_at_ms, user_wallet.available_pulls, user_wallet.reserve_pulls)
                  then excluded.reserve_pulls
                else user_wallet.reserve_pulls
              end,
              updated_at_ms = case
                when (excluded.updated_at_ms, excluded.available_pulls, excluded.reserve_pulls)
                     >= (user_wallet.updated_at_ms, user_wallet.available_pulls, user_wallet.reserve_pulls)
                  then excluded.updated_at_ms
                else user_wallet.updated_at_ms
              end
            """;
          await DbUtil.ExecuteAsync(conn, tx, upsertWallet, [userSub, w.AvailablePulls, w.ReservePulls, w.UpdatedAtMs]);
        }

        // Read back inside the same transaction, so the answer is the state the
        // write just produced and not a state some concurrent device left behind
        // between commit and select.
        const string selectOwned = """
          select deck_slug as "deckSlug", stable_uid as "stableUid"
          from user_draw_owned
          where user_sub = $1
          order by deck_slug asc, stable_uid asc
          limit $2
          """;
        var ownedRows = await DbUtil.QueryAsync(conn, tx, selectOwned, [userSub, MaxOwnedRowsInResponse + 1]);

        var ownedTruncated = ownedRows.Count > MaxOwnedRowsInResponse;
        if (ownedTruncated) ownedRows.RemoveRange(MaxOwnedRowsInResponse, ownedRows.Count - MaxOwnedRowsInResponse);

        const string selectMeta = """
          select deck_slug as "deckSlug", pity_draws as "draws", pity_threshold as "threshold", updated_at_ms as "updatedAtMs"
          from user_draw_meta
          where user_sub = $1
          order by deck_slug asc
          """;
        var metaRows = await DbUtil.QueryAsync(conn, tx, selectMeta, [userSub]);

        const string selectWallet = """
          select available_pulls as "availablePulls", reserve_pulls as "reservePulls", updated_at_ms as "updatedAtMs"
          from user_wallet
          where user_sub = $1
          """;
        var walletRows = await DbUtil.QueryAsync(conn, tx, selectWallet, [userSub]);

        await tx.CommitAsync();

        var ownedByDeck = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var row in ownedRows)
        {
          var slug = AsString(row, "deckSlug");
          var uid = AsString(row, "stableUid");
          if (slug.Length == 0 || uid.Length == 0) continue;
          if (!ownedByDeck.TryGetValue(slug, out var list))
          {
            list = [];
            ownedByDeck[slug] = list;
          }
          list.Add(uid);
        }

        var metaByDeck = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var row in metaRows)
        {
          var slug = AsString(row, "deckSlug");
          if (slug.Length == 0) continue;
          metaByDeck[slug] = new
          {
            draws = AsInt(row, "draws"),
            threshold = AsInt(row, "threshold"),
            updatedAtMs = AsLong(row, "updatedAtMs"),
          };
        }

        var slugs = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var slug in ownedByDeck.Keys) slugs.Add(slug);
        foreach (var slug in metaByDeck.Keys) slugs.Add(slug);

        var deckPayload = slugs.Select(slug => new
        {
          deckSlug = slug,
          owned = ownedByDeck.TryGetValue(slug, out var list) ? list : [],
          pity = metaByDeck.TryGetValue(slug, out var m) ? m : null,
        }).ToList();

        object? walletPayload = null;
        if (walletRows.Count > 0)
        {
          walletPayload = new
          {
            availablePulls = AsInt(walletRows[0], "availablePulls"),
            reservePulls = AsInt(walletRows[0], "reservePulls"),
            updatedAtMs = AsLong(walletRows[0], "updatedAtMs"),
          };
        }

        return res.Ok(new
        {
          serverTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
          decks = deckPayload,
          wallet = walletPayload,
          ownedTruncated,
        });
      }
      catch
      {
        try { await tx.RollbackAsync(); } catch { /* ignore */ }
        throw;
      }
    }
    catch (Exception ex) when (ex is ValidationError)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (Exception ex)
    {
      return res.Error500(ex);
    }
  }

  private static string RequireString(JsonElement obj, string prop, string fieldName)
  {
    if (!obj.TryGetProperty(prop, out var el) || el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined)
    {
      throw new ValidationError($"{fieldName} is required", fieldName);
    }

    var s = el.ToString().Trim();
    if (s.Length == 0) throw new ValidationError($"{fieldName} is required", fieldName);
    return s;
  }

  private static int? OptionalInt(JsonElement? v)
  {
    if (v is null) return null;
    var el = v.Value;
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return null;

    if (el.ValueKind == JsonValueKind.Number)
    {
      if (el.TryGetInt32(out var n)) return n;
      return null;
    }

    var s = el.ToString().Trim();
    return int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : null;
  }

  private static long? OptionalMs(JsonElement? v)
  {
    if (v is null) return null;
    var el = v.Value;
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return null;

    if (el.ValueKind == JsonValueKind.Number)
    {
      if (el.TryGetInt64(out var n) && n > 0) return n;
      if (el.TryGetDouble(out var d) && d > 0) return (long)Math.Floor(d);
      return null;
    }

    var s = el.ToString().Trim();
    if (long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var ms) && ms > 0) return ms;
    return null;
  }

  private static string AsString(IReadOnlyDictionary<string, object?> row, string key)
  {
    if (!row.TryGetValue(key, out var v) || v is null) return string.Empty;
    return Convert.ToString(v, CultureInfo.InvariantCulture) ?? string.Empty;
  }

  private static int AsInt(IReadOnlyDictionary<string, object?> row, string key)
  {
    if (!row.TryGetValue(key, out var v) || v is null) return 0;
    return Convert.ToInt32(v, CultureInfo.InvariantCulture);
  }

  private static long AsLong(IReadOnlyDictionary<string, object?> row, string key)
  {
    if (!row.TryGetValue(key, out var v) || v is null) return 0;
    return Convert.ToInt64(v, CultureInfo.InvariantCulture);
  }

  private static string? GetClaimString(IReadOnlyDictionary<string, JsonElement> claims, string key)
  {
    if (!claims.TryGetValue(key, out var el)) return null;
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return null;
    return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
  }
}
