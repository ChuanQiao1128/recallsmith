using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.Vpc.Internal;

/// <summary>
/// POST /api/internal/ai-qa/results (R18 J13, contract §7.7): the ai-qa Lambda reports one chunk's reviews here,
/// HMAC-signed (§4.3). One transaction applies the item transitions, stores findings and recomputes the run's
/// counters from its items and findings. SQS delivers at least once and a chunk may be retried whole, so a
/// repeated report is normal: a <c>done</c> item is never downgraded, and a report never erases a finding a human
/// has resolved. The <c>card.flagged</c> webhook and the ledger row run after commit and are best-effort.
/// </summary>
public static class AiQaResults
{
  public static readonly IReadOnlyList<string> ItemStatuses = ["done", "error", "refused", "skipped"];
  public static readonly IReadOnlyList<string> ErrorCodes = ["PROVIDER_ACCESS_DENIED", "PROVIDER_AUTH", "PROVIDER_RATE_LIMITED",
    "PROVIDER_ERROR", "PROVIDER_TIMEOUT", "SCHEMA_INVALID", "MAX_TOKENS", "REFUSAL", "DISABLED", "CONFIG"];
  public static readonly IReadOnlyList<string> Severities = ["blocker", "major", "minor"];
  public static readonly IReadOnlyList<string> Categories = ["incorrect_answer", "multiple_correct", "answer_leak", "ambiguous_stem",
    "outdated_fact", "qualifier_mismatch", "source_unsupported", "weak_distractor", "other"];
  public const int MaxFindingsPerItem = 10;

  public const int MaxItems = 50;
  public const int MaxLabelLength = 100;
  public const int MaxHashLength = 128;
  public const int MaxRequestIdLength = 200;
  public const int MaxMessageLength = 1000;
  public const int MaxSuggestedFixLength = 2000;
  public const int MaxWebhookFindings = 5;
  // numeric(12,6) holds values below 10^6.
  public const decimal MaxCostUsd = 999_999m;
  public const string DefaultConsoleBaseUrl = "https://console.developercards.app";

  private sealed record ReportFinding(string Severity, string Category, string Message, string? SuggestedFix);

  private sealed record ReportItem(long CardId, string ContentSha256, string Status, string? ErrorCode, List<ReportFinding> Findings,
    int InputTokens, int OutputTokens, int CacheReadTokens, int? LatencyMs, string? RequestId, decimal EstimatedCostUsd);

  private sealed record Report(Guid RunId, int Chunk, string? Provider, string? Model, string? PromptVersion, List<ReportItem> Items);

  private sealed class ItemState
  {
    public required string Status { get; set; }
    public required string ContentSha256 { get; init; }
    public required string StableUid { get; init; }
    public int ResolvedFindings { get; init; }
  }

  private sealed class ReportError(string message) : Exception(message);

  public static async Task<APIGatewayProxyResponse> HandleAiQaResults(LambdaRequest req, Res res)
  {
    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    var v = Auth.VerifyInternalSignature(req);
    if (!v.Ok) return res.Forbidden($"Internal auth failed: {v.Reason}");

    Report report;
    try
    {
      using var doc = Validation.ParseJsonBody(req) ?? throw new ReportError("Body must be JSON");
      report = ParseReport(doc.RootElement);
    }
    catch (ReportError ex)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Authoring.Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      long deckId;
      string runStatus;
      int cardsDone;
      int cardCount;
      int becameDone = 0, errored = 0, kept = 0, ignored = 0, statusChanged = 0;
      var flagged = new List<(long CardId, string StableUid, List<ReportFinding> Findings)>();

      await using (var tx = await conn.BeginTransactionAsync())
      {
        var runRows = await DbUtil.QueryAsync(conn, tx,
          "select id, deck_id, status, chunk_count from ai_qa_runs where id = $1 for update", [report.RunId]);
        if (runRows.Count == 0) return Authoring.Helpers.ErrorEnvelope(res, 404, "RUN_NOT_FOUND", "AI QA run not found");
        deckId = Convert.ToInt64(runRows[0]["deck_id"], CultureInfo.InvariantCulture);
        var chunkCount = Convert.ToInt32(runRows[0]["chunk_count"], CultureInfo.InvariantCulture);
        if (report.Chunk >= chunkCount)
        {
          return res.BadRequest("VALIDATION_ERROR", $"chunk must be an integer in 0..{chunkCount - 1}");
        }

        var itemRows = await DbUtil.QueryAsync(conn, tx,
          """
          select i.card_id, i.status, i.content_sha256, i.stable_uid,
            (select count(*) from ai_qa_findings f where f.run_id = i.run_id and f.card_id = i.card_id and f.resolution <> 'open') as resolved
          from ai_qa_items i
          where i.run_id = $1
          order by i.card_id
          for update of i
          """,
          [report.RunId]);
        var items = itemRows.ToDictionary(
          r => Convert.ToInt64(r["card_id"], CultureInfo.InvariantCulture),
          r => new ItemState
          {
            Status = (string)r["status"]!,
            ContentSha256 = (string)r["content_sha256"]!,
            StableUid = (string)r["stable_uid"]!,
            ResolvedFindings = Convert.ToInt32(r["resolved"], CultureInfo.InvariantCulture),
          });

        foreach (var item in report.Items)
        {
          if (!items.TryGetValue(item.CardId, out var state))
          {
            ignored++;
            continue;
          }

          var previous = state.Status;
          if (previous == "done" && item.Status != "done")
          {
            kept++;
            continue;
          }
          if (previous == "done" && state.ResolvedFindings > 0)
          {
            kept++;
            Log.Event("warn", new { tag = "ai_qa", reason = "resolved_findings_kept", runId = report.RunId, chunk = report.Chunk, cardId = item.CardId });
            continue;
          }

          if (!string.Equals(item.ContentSha256, state.ContentSha256, StringComparison.Ordinal))
          {
            Log.Event("warn", new { tag = "ai_qa", reason = "hash_echo_mismatch", runId = report.RunId, chunk = report.Chunk, cardId = item.CardId });
          }

          await DbUtil.ExecuteAsync(conn, tx,
            """
            update ai_qa_items
            set status = $3, error_code = $4::text, latency_ms = $5::int, input_tokens = $6, output_tokens = $7,
              cache_read_tokens = $8, estimated_cost_usd = $9, request_id = $10::text, updated_at = now()
            where run_id = $1 and card_id = $2
            """,
            [report.RunId, item.CardId, item.Status, item.ErrorCode, item.LatencyMs, item.InputTokens, item.OutputTokens,
             item.CacheReadTokens, item.EstimatedCostUsd, item.RequestId]);

          if (item.Status == "done")
          {
            await DbUtil.ExecuteAsync(conn, tx, "delete from ai_qa_findings where run_id = $1 and card_id = $2", [report.RunId, item.CardId]);
            foreach (var f in item.Findings)
            {
              await DbUtil.ExecuteAsync(conn, tx,
                """
                insert into ai_qa_findings (run_id, card_id, content_sha256, severity, category, message, suggested_fix)
                values ($1, $2, $3, $4, $5, $6, $7::text)
                """,
                [report.RunId, item.CardId, state.ContentSha256, f.Severity, f.Category, f.Message, f.SuggestedFix]);
            }
          }

          if (previous != item.Status) statusChanged++;
          if (item.Status is "error" or "refused") errored++;
          if (previous != "done" && item.Status == "done")
          {
            becameDone++;
            if (item.Findings.Any(f => f.Severity is "blocker" or "major")) flagged.Add((item.CardId, state.StableUid, item.Findings));
          }
          state.Status = item.Status;
        }

        var recomputed = await DbUtil.QueryAsync(conn, tx,
          """
          update ai_qa_runs r
          set cards_done = a.cards_done,
            error_count = a.error_count,
            blocker_count = f.blockers,
            major_count = f.majors,
            minor_count = f.minors,
            input_tokens = a.input_tokens,
            output_tokens = a.output_tokens,
            cache_read_tokens = a.cache_read_tokens,
            estimated_cost_usd = a.cost,
            provider = coalesce(r.provider, $2::text),
            model = coalesce(r.model, $3::text),
            prompt_version = coalesce(r.prompt_version, $4::text),
            status = case when a.queued = 0 then 'done' when r.status = 'failed' then 'failed' else 'running' end,
            error_code = case when a.queued = 0 then null else r.error_code end,
            finished_at = case when a.queued = 0 then (case when r.status = 'done' then r.finished_at else now() end) else r.finished_at end,
            updated_at = now()
          from (
            select
              count(*) filter (where status in ('done','error','refused','skipped')) as cards_done,
              count(*) filter (where status in ('error','refused')) as error_count,
              count(*) filter (where status = 'queued') as queued,
              coalesce(sum(input_tokens), 0) as input_tokens,
              coalesce(sum(output_tokens), 0) as output_tokens,
              coalesce(sum(cache_read_tokens), 0) as cache_read_tokens,
              coalesce(sum(estimated_cost_usd), 0) as cost
            from ai_qa_items where run_id = $1
          ) a, (
            select
              count(*) filter (where severity = 'blocker') as blockers,
              count(*) filter (where severity = 'major') as majors,
              count(*) filter (where severity = 'minor') as minors
            from ai_qa_findings where run_id = $1
          ) f
          where r.id = $1
          returning r.status, r.cards_done, r.card_count
          """,
          [report.RunId, report.Provider, report.Model, report.PromptVersion]);
        runStatus = (string)recomputed[0]["status"]!;
        cardsDone = Convert.ToInt32(recomputed[0]["cards_done"], CultureInfo.InvariantCulture);
        cardCount = Convert.ToInt32(recomputed[0]["card_count"], CultureInfo.InvariantCulture);

        await tx.CommitAsync();
      }

      await AfterCommitAsync(conn, report, deckId, flagged, becameDone, errored, kept, ignored, statusChanged);

      Log.Event("info", new { tag = "ai_qa", outcome = "reported", runId = report.RunId, chunk = report.Chunk, runStatus, cardsDone, cardCount, becameDone, kept, ignored });
      return res.Ok(new { runId = report.RunId, runStatus, cardsDone, cardCount });
    }
    catch (PostgresException pg) when (pg.SqlState == "42P01")
    {
      return QaGate.NotReady(res);
    }
    catch (Exception ex)
    {
      Log.Error("AI QA results handler error:", ex);
      return res.Error500(ex);
    }
  }

  /// <summary>Best-effort side effects of a committed report (contract §0.8); never throws.</summary>
  private static async Task AfterCommitAsync(NpgsqlConnection conn, Report report, long deckId,
    List<(long CardId, string StableUid, List<ReportFinding> Findings)> flagged,
    int becameDone, int errored, int kept, int ignored, int statusChanged)
  {
    try
    {
      if (flagged.Count > 0)
      {
        var deckSlug = Convert.ToString(
          await DbUtil.ExecuteScalarAsync(conn, null, "select slug from decks where id = $1", [deckId]), CultureInfo.InvariantCulture);
        var consoleUrl = $"{ConsoleBaseUrl()}/decks/qa?deckId={deckId.ToString(CultureInfo.InvariantCulture)}&runId={report.RunId}";
        foreach (var (cardId, stableUid, findings) in flagged)
        {
          await WebhookEvents.EnqueueAsync(conn, "card.flagged", new
          {
            deckId,
            deckSlug,
            cardId,
            stableUid,
            runId = report.RunId,
            counts = new
            {
              blocker = findings.Count(f => f.Severity == "blocker"),
              major = findings.Count(f => f.Severity == "major"),
              minor = findings.Count(f => f.Severity == "minor"),
            },
            findings = findings
              .OrderBy(f => SeverityRank(f.Severity))
              .Take(MaxWebhookFindings)
              .Select(f => new { severity = f.Severity, category = f.Category, message = f.Message })
              .ToList(),
            consoleUrl,
          });
        }
      }
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "ai_qa", reason = "card_flagged_failed", runId = report.RunId, error = ex.Message });
    }

    if (statusChanged > 0)
    {
      var outcome = errored > 0 ? (becameDone > 0 ? "partial" : "failure") : "success";
      await AutomationLedger.RecordAsync(conn, new AutomationEvent(
        Automation: "ai_qa_review", Units: becameDone, Outcome: outcome, DeckId: deckId, Ref: report.RunId.ToString(),
        DedupeKey: $"qa:{report.RunId}:{report.Chunk.ToString(CultureInfo.InvariantCulture)}",
        Details: new { chunk = report.Chunk, reported = report.Items.Count, becameDone, errored, kept, ignored }));
    }

    if (ignored > 0)
    {
      Log.Event("warn", new { tag = "ai_qa", reason = "unknown_card", runId = report.RunId, chunk = report.Chunk, ignored });
    }
  }

  private static int SeverityRank(string severity) => severity switch { "blocker" => 0, "major" => 1, _ => 2 };

  private static string ConsoleBaseUrl()
  {
    var raw = Environment.GetEnvironmentVariable("CONSOLE_BASE_URL");
    return string.IsNullOrWhiteSpace(raw) ? DefaultConsoleBaseUrl : raw.Trim().TrimEnd('/');
  }

  // ---------------------------------------------------------------------------------------------
  // body validation (every failure is 400 VALIDATION_ERROR)
  // ---------------------------------------------------------------------------------------------

  private static Report ParseReport(JsonElement body)
  {
    if (body.ValueKind != JsonValueKind.Object) throw new ReportError("Body must be a JSON object");

    if (!body.TryGetProperty("v", out var vEl) || vEl.ValueKind != JsonValueKind.Number || !vEl.TryGetInt32(out var version) || version != 1)
    {
      throw new ReportError("v must be 1");
    }

    if (!body.TryGetProperty("runId", out var runEl) || runEl.ValueKind != JsonValueKind.String || !Guid.TryParse(runEl.GetString(), out var runId))
    {
      throw new ReportError("runId must be a uuid");
    }

    if (!body.TryGetProperty("chunk", out var chunkEl) || chunkEl.ValueKind != JsonValueKind.Number || !chunkEl.TryGetInt32(out var chunk) || chunk < 0)
    {
      throw new ReportError("chunk must be an integer >= 0");
    }

    var provider = OptionalString(body, "provider", MaxLabelLength, "provider");
    var model = OptionalString(body, "model", MaxLabelLength, "model");
    var promptVersion = OptionalString(body, "promptVersion", MaxLabelLength, "promptVersion");

    if (!body.TryGetProperty("items", out var itemsEl) || itemsEl.ValueKind != JsonValueKind.Array || itemsEl.GetArrayLength() > MaxItems)
    {
      throw new ReportError($"items must be an array of 0..{MaxItems}");
    }

    var items = new List<ReportItem>();
    var index = 0;
    foreach (var el in itemsEl.EnumerateArray())
    {
      items.Add(ParseItem(el, index));
      index++;
    }

    return new Report(runId, chunk, provider, model, promptVersion, items);
  }

  private static ReportItem ParseItem(JsonElement el, int index)
  {
    var at = $"items[{index}]";
    if (el.ValueKind != JsonValueKind.Object) throw new ReportError($"{at} must be an object");

    if (!el.TryGetProperty("cardId", out var cardEl) || cardEl.ValueKind != JsonValueKind.Number || !cardEl.TryGetInt64(out var cardId))
    {
      throw new ReportError($"{at}.cardId must be an integer");
    }

    if (!el.TryGetProperty("contentSha256", out var hashEl) || hashEl.ValueKind != JsonValueKind.String || hashEl.GetString()!.Length > MaxHashLength)
    {
      throw new ReportError($"{at}.contentSha256 must be a string (max {MaxHashLength})");
    }

    if (!el.TryGetProperty("status", out var statusEl) || statusEl.ValueKind != JsonValueKind.String || !ItemStatuses.Contains(statusEl.GetString()!))
    {
      throw new ReportError($"{at}.status must be one of {string.Join(", ", ItemStatuses)}");
    }

    string? errorCode = null;
    if (el.TryGetProperty("errorCode", out var codeEl) && codeEl.ValueKind != JsonValueKind.Null)
    {
      if (codeEl.ValueKind != JsonValueKind.String || !ErrorCodes.Contains(codeEl.GetString()!))
      {
        throw new ReportError($"{at}.errorCode must be null or one of {string.Join(", ", ErrorCodes)}");
      }
      errorCode = codeEl.GetString();
    }

    var findings = new List<ReportFinding>();
    if (el.TryGetProperty("findings", out var findingsEl) && findingsEl.ValueKind != JsonValueKind.Null)
    {
      if (findingsEl.ValueKind != JsonValueKind.Array) throw new ReportError($"{at}.findings must be an array");
      var fi = 0;
      foreach (var fEl in findingsEl.EnumerateArray())
      {
        var finding = ParseFinding(fEl, $"{at}.findings[{fi}]", cardId);
        if (findings.Count < MaxFindingsPerItem) findings.Add(finding);
        fi++;
      }
    }

    int inputTokens = 0, outputTokens = 0, cacheReadTokens = 0;
    if (el.TryGetProperty("usage", out var usageEl) && usageEl.ValueKind != JsonValueKind.Null)
    {
      if (usageEl.ValueKind != JsonValueKind.Object) throw new ReportError($"{at}.usage must be an object");
      inputTokens = UsageInt(usageEl, "inputTokens", at);
      outputTokens = UsageInt(usageEl, "outputTokens", at);
      cacheReadTokens = UsageInt(usageEl, "cacheReadInputTokens", at);
    }

    int? latencyMs = null;
    if (el.TryGetProperty("latencyMs", out var latEl) && latEl.ValueKind != JsonValueKind.Null)
    {
      if (latEl.ValueKind != JsonValueKind.Number || !latEl.TryGetInt32(out var lat) || lat < 0) throw new ReportError($"{at}.latencyMs must be an integer >= 0 or null");
      latencyMs = lat;
    }

    var requestId = OptionalString(el, "requestId", MaxRequestIdLength, $"{at}.requestId");

    decimal cost = 0;
    if (el.TryGetProperty("estimatedCostUsd", out var costEl))
    {
      if (costEl.ValueKind != JsonValueKind.Number || !costEl.TryGetDecimal(out cost) || cost < 0 || cost > MaxCostUsd)
      {
        throw new ReportError($"{at}.estimatedCostUsd must be a number in 0..{MaxCostUsd.ToString(CultureInfo.InvariantCulture)}");
      }
    }

    return new ReportItem(cardId, hashEl.GetString()!, statusEl.GetString()!, errorCode, findings,
      inputTokens, outputTokens, cacheReadTokens, latencyMs, requestId, cost);
  }

  private static ReportFinding ParseFinding(JsonElement el, string at, long cardId)
  {
    if (el.ValueKind != JsonValueKind.Object) throw new ReportError($"{at} must be an object");

    if (!el.TryGetProperty("severity", out var sevEl) || sevEl.ValueKind != JsonValueKind.String || !Severities.Contains(sevEl.GetString()!))
    {
      throw new ReportError($"{at}.severity must be one of {string.Join(", ", Severities)}");
    }

    if (!el.TryGetProperty("category", out var catEl) || catEl.ValueKind != JsonValueKind.String || !Categories.Contains(catEl.GetString()!))
    {
      throw new ReportError($"{at}.category must be one of {string.Join(", ", Categories)}");
    }

    if (!el.TryGetProperty("message", out var msgEl) || msgEl.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(msgEl.GetString()))
    {
      throw new ReportError($"{at}.message must be a non-blank string");
    }
    var message = Truncate(msgEl.GetString()!.Trim(), MaxMessageLength);

    string? fix = null;
    if (el.TryGetProperty("suggestedFix", out var fixEl) && fixEl.ValueKind != JsonValueKind.Null)
    {
      if (fixEl.ValueKind != JsonValueKind.String) throw new ReportError($"{at}.suggestedFix must be a string or null");
      var f = fixEl.GetString()!.Trim();
      fix = f.Length == 0 ? null : Truncate(f, MaxSuggestedFixLength);
    }

    if (el.TryGetProperty("cardId", out var cardEl) && cardEl.ValueKind != JsonValueKind.Null)
    {
      if (cardEl.ValueKind != JsonValueKind.Number || !cardEl.TryGetInt64(out var findingCardId) || findingCardId != cardId)
      {
        throw new ReportError($"{at}.cardId must equal the item's cardId");
      }
    }

    return new ReportFinding(sevEl.GetString()!, catEl.GetString()!, message, fix);
  }

  private static int UsageInt(JsonElement usage, string key, string at)
  {
    if (!usage.TryGetProperty(key, out var el) || el.ValueKind == JsonValueKind.Null) return 0;
    if (el.ValueKind != JsonValueKind.Number || !el.TryGetInt32(out var n) || n < 0) throw new ReportError($"{at}.usage.{key} must be an integer >= 0");
    return n;
  }

  private static string? OptionalString(JsonElement obj, string key, int max, string label)
  {
    if (!obj.TryGetProperty(key, out var el) || el.ValueKind == JsonValueKind.Null) return null;
    if (el.ValueKind != JsonValueKind.String || el.GetString()!.Length > max) throw new ReportError($"{label} must be a string (max {max}) or null");
    return el.GetString();
  }

  // Never splits a surrogate pair.
  private static string Truncate(string s, int max)
  {
    if (s.Length <= max) return s;
    var cut = char.IsHighSurrogate(s[max - 1]) ? max - 1 : max;
    return s[..cut];
  }
}
