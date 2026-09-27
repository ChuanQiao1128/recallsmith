using System.Globalization;
using System.Security.Cryptography;
using System.Text;
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
/// repeated report is normal: a <c>done</c> item is never downgraded and its findings are never replaced (a retried
/// chunk's second model sample neither erases nor renumbers what the first one found; backend-design-19). The <c>card.flagged</c> webhook and the ledger row run after commit and are best-effort.
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

  /// <summary>
  /// The route's own HMAC secret (cloud-security-resilience-2): when set, only a report signed with it is
  /// accepted here, so the webhook dispatcher's credential cannot write AI QA results.
  /// </summary>
  public const string CallerSecretEnv = "INTERNAL_SECRET_AI_QA_RESULTS";

  /// <summary>
  /// Items per report whose echoed content hash did not match the item (backend-design-20): the forgery signal for
  /// cloud-security-resilience-2, counted apart from unknown card ids so it can be alarmed on.
  /// </summary>
  public const string HashMismatchMetric = "AiQaHashMismatch";

  /// <summary>
  /// One budget for every post-commit SQS send of a report (backend-design-15). A report carries up to
  /// <see cref="MaxItems"/> flagged cards; the per-call enqueue deadline alone would let a hung SQS endpoint hold
  /// the request far past the 30 s gateway timeout, which the ai-qa Lambda would treat as a failed report and
  /// retry (re-billing the chunk). Internal so a test can shorten it; never changed in production.
  /// </summary>
  internal static TimeSpan AfterCommitBudget = TimeSpan.FromSeconds(8);

  private sealed record ReportFinding(string Severity, string Category, string Message, string? SuggestedFix);

  private sealed record ReportItem(long CardId, string ContentSha256, string Status, string? ErrorCode, List<ReportFinding> Findings,
    int InputTokens, int OutputTokens, int CacheReadTokens, int? LatencyMs, string? RequestId, decimal EstimatedCostUsd);

  private sealed record Report(Guid RunId, int Chunk, string? Provider, string? Model, string? PromptVersion, List<ReportItem> Items);

  private sealed class ItemState
  {
    public required string Status { get; set; }
    public required string ContentSha256 { get; init; }
    public required string StableUid { get; init; }
    public string? RequestId { get; set; }
  }

  private sealed class ReportError(string message) : Exception(message);

  public static async Task<APIGatewayProxyResponse> HandleAiQaResults(LambdaRequest req, Res res)
  {
    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    var v = Auth.VerifyInternalSignature(req, CallerSecretEnv);
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
      int becameDone = 0, errored = 0, kept = 0, ignored = 0, mismatched = 0, statusChanged = 0;
      string? storedPromptVersion;
      var transitions = new List<(long CardId, string Status)>();
      var flagged = new List<(long CardId, string StableUid, List<ReportFinding> Findings)>();

      await using (var tx = await conn.BeginTransactionAsync())
      {
        var runRows = await DbUtil.QueryAsync(conn, tx,
          "select id, deck_id, status, chunk_count, prompt_version from ai_qa_runs where id = $1 for update", [report.RunId]);
        if (runRows.Count == 0) return Authoring.Helpers.ErrorEnvelope(res, 404, "RUN_NOT_FOUND", "AI QA run not found");
        deckId = Convert.ToInt64(runRows[0]["deck_id"], CultureInfo.InvariantCulture);
        storedPromptVersion = runRows[0]["prompt_version"] as string;
        var chunkCount = Convert.ToInt32(runRows[0]["chunk_count"], CultureInfo.InvariantCulture);
        if (report.Chunk >= chunkCount)
        {
          return res.BadRequest("VALIDATION_ERROR", $"chunk must be an integer in 0..{chunkCount - 1}");
        }

        var itemRows = await DbUtil.QueryAsync(conn, tx,
          """
          select i.card_id, i.status, i.content_sha256, i.stable_uid, i.request_id
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
            RequestId = r["request_id"] as string,
          });

        foreach (var item in report.Items)
        {
          if (!items.TryGetValue(item.CardId, out var state))
          {
            ignored++;
            continue;
          }

          // The Lambda echoes the hash core-vpc sent for the item; a report for any other content is not a review
          // of this item and is not applied (cloud-security-resilience-2: a forged report must know the unpublished
          // card's content hash, not just the run id a card.flagged webhook carries).
          if (!string.Equals(item.ContentSha256, state.ContentSha256, StringComparison.Ordinal))
          {
            Log.Event("warn", new { tag = "ai_qa", reason = "hash_echo_mismatch", runId = report.RunId, chunk = report.Chunk, cardId = item.CardId });
            mismatched++;
            continue;
          }

          // A done item is final for the run (backend-design-19): whatever a later report says, its status and its
          // findings stay. A retried chunk redelivered to another container makes a fresh model call, a different
          // sample that may miss a blocker the first one caught; replacing the findings would let the gate's outcome
          // depend on which sample arrived last, orphan the card.flagged webhook already sent and renumber the ids an
          // editor resolves by. An exact replay (the Lambda's POST retry) carries the same findings, so keeping them
          // loses nothing, and findings a human resolved are kept as before.
          var previous = state.Status;
          var keep = previous == "done";
          if (keep)
          {
            kept++;
            if (item.Status == "done" && IsNewAttempt(state, item))
            {
              Log.Event("info", new { tag = "ai_qa", reason = "done_findings_kept", runId = report.RunId, chunk = report.Chunk, cardId = item.CardId,
                reportedFindings = item.Findings.Count });
            }
            // The outcome is kept, but a retried chunk re-reviewed (and re-billed) this card: its usage still
            // counts toward the daily cap (backend-design-6, cloud-security-resilience-3). The attempt's request id
            // is stored with it, so an exact replay of this report (the Lambda's POST retry) is not billed twice.
            if (IsNewAttempt(state, item))
            {
              await DbUtil.ExecuteAsync(conn, tx,
                $"update ai_qa_items set {AccumulateUsageSql}, request_id = $7::text where run_id = $1 and card_id = $2",
                [report.RunId, item.CardId, item.InputTokens, item.OutputTokens, item.CacheReadTokens, item.EstimatedCostUsd, item.RequestId]);
              state.RequestId = item.RequestId;
            }
            continue;
          }

          // Usage accumulates across attempts (a retried chunk re-bills an errored card); an exact replay of the same
          // model call (same request id, e.g. the Lambda's POST retry) replaces rather than adds.
          var usageSql = IsNewAttempt(state, item)
            ? "input_tokens = coalesce(input_tokens, 0) + $6, output_tokens = coalesce(output_tokens, 0) + $7, " +
              "cache_read_tokens = coalesce(cache_read_tokens, 0) + $8, estimated_cost_usd = coalesce(estimated_cost_usd, 0) + $9"
            : "input_tokens = greatest(coalesce(input_tokens, 0), $6), output_tokens = greatest(coalesce(output_tokens, 0), $7), " +
              "cache_read_tokens = greatest(coalesce(cache_read_tokens, 0), $8), estimated_cost_usd = greatest(coalesce(estimated_cost_usd, 0), $9)";
          await DbUtil.ExecuteAsync(conn, tx,
            $"""
            update ai_qa_items
            set status = $3, error_code = $4::text, latency_ms = $5::int, {usageSql}, request_id = $10::text,
              prompt_version = coalesce($11::text, prompt_version), updated_at = now()
            where run_id = $1 and card_id = $2
            """,
            [report.RunId, item.CardId, item.Status, item.ErrorCode, item.LatencyMs, item.InputTokens, item.OutputTokens,
             item.CacheReadTokens, item.EstimatedCostUsd, item.RequestId, report.PromptVersion]);
          state.RequestId = item.RequestId;

          if (item.Status == "done")
          {
            // The item was not done before (a done item is kept above), so it has no findings to replace.
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

          if (previous != item.Status)
          {
            statusChanged++;
            transitions.Add((item.CardId, item.Status));
          }
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
            prompt_version = coalesce($4::text, r.prompt_version),
            status = case when a.queued = 0 and a.reviewed = 0 then 'failed' when a.queued = 0 then 'done'
              when r.status = 'failed' then 'failed' else 'running' end,
            error_code = case when a.queued = 0 and a.reviewed = 0 then 'ALL_ITEMS_FAILED' when a.queued = 0 then null else r.error_code end,
            finished_at = case
              when a.queued = 0 and a.reviewed = 0 then (case when r.status = 'failed' and r.error_code = 'ALL_ITEMS_FAILED' then r.finished_at else now() end)
              when a.queued = 0 then (case when r.status = 'done' then r.finished_at else now() end)
              else r.finished_at end,
            updated_at = now()
          from (
            select
              count(*) filter (where status in ('done','error','refused','skipped')) as cards_done,
              count(*) filter (where status in ('error','refused')) as error_count,
              count(*) filter (where status = 'queued') as queued,
              count(*) filter (where status = 'done') as reviewed,
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

      // core-vpc does not pin a prompt version (backend-design-12): the run records what the Lambda reports. A
      // run whose chunks report different versions (a deploy in the middle of a run) is worth a warning.
      if (storedPromptVersion is not null && report.PromptVersion is not null &&
          !string.Equals(storedPromptVersion, report.PromptVersion, StringComparison.Ordinal))
      {
        Log.Event("warn", new { tag = "ai_qa", reason = "prompt_version_changed", runId = report.RunId, chunk = report.Chunk,
          previous = storedPromptVersion, reported = report.PromptVersion });
      }

      await AfterCommitAsync(conn, report, deckId, flagged, becameDone, errored, kept, ignored, mismatched, transitions);

      Log.Event("info", new { tag = "ai_qa", outcome = "reported", runId = report.RunId, chunk = report.Chunk, runStatus, cardsDone, cardCount, becameDone, kept, ignored, mismatched });
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

  /// <summary>
  /// <c>$3..$6</c> = input, output and cache-read tokens and estimated cost of one more attempt at an item, added
  /// to what earlier attempts already recorded.
  /// </summary>
  private const string AccumulateUsageSql =
    "input_tokens = coalesce(input_tokens, 0) + $3, output_tokens = coalesce(output_tokens, 0) + $4, " +
    "cache_read_tokens = coalesce(cache_read_tokens, 0) + $5, estimated_cost_usd = coalesce(estimated_cost_usd, 0) + $6, updated_at = now()";

  /// <summary>
  /// True when the reported item is a model call not yet billed on this item: its request id differs from the one
  /// stored. A repeat of the same request id (or two reports without one) is a replay of the same call.
  /// </summary>
  private static bool IsNewAttempt(ItemState state, ReportItem item) =>
    !string.Equals(state.RequestId, item.RequestId, StringComparison.Ordinal);

  /// <summary>Best-effort side effects of a committed report (contract §0.8); never throws.</summary>
  private static async Task AfterCommitAsync(NpgsqlConnection conn, Report report, long deckId,
    List<(long CardId, string StableUid, List<ReportFinding> Findings)> flagged,
    int becameDone, int errored, int kept, int ignored, int mismatched, List<(long CardId, string Status)> transitions)
  {
    // Once per report, zero included, so the metric has data points to alarm on.
    RouteMetrics.EmitGauge(HashMismatchMetric, mismatched);

    using var budget = new CancellationTokenSource(AfterCommitBudget);
    try
    {
      if (flagged.Count > 0)
      {
        var deckSlug = Convert.ToString(
          await DbUtil.ExecuteScalarAsync(conn, null, "select slug from decks where id = $1", [deckId]), CultureInfo.InvariantCulture);
        var consoleUrl = $"{ConsoleBaseUrl()}/decks/qa?deckId={deckId.ToString(CultureInfo.InvariantCulture)}&runId={report.RunId}";
        // Every send shares one request-scoped budget. Once it has run out, each remaining card still gets its
        // delivery rows (marked enqueue_failed at once, without waiting on SQS), which the sweep re-sends.
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
          }, ct: budget.Token);
        }
      }
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "ai_qa", reason = "card_flagged_failed", runId = report.RunId, error = ex.Message });
    }

    if (transitions.Count > 0)
    {
      // Keyed by the transitions this report applied, not by the chunk alone: a chunk retried after a
      // retryable provider error reports its remaining cards as newly done and must get its own row, while
      // an exact replay changes nothing and so records nothing. A card becomes done at most once per run
      // (done is never downgraded), so no unit can be counted twice.
      var outcome = errored > 0 ? (becameDone > 0 ? "partial" : "failure") : "success";
      await AutomationLedger.RecordAsync(conn, new AutomationEvent(
        Automation: "ai_qa_review", Units: becameDone, Outcome: outcome, DeckId: deckId, Ref: report.RunId.ToString(),
        DedupeKey: LedgerDedupeKey(report.RunId, report.Chunk, transitions),
        Details: new { chunk = report.Chunk, reported = report.Items.Count, becameDone, errored, kept, ignored, mismatched }));
    }

    if (ignored > 0)
    {
      Log.Event("warn", new { tag = "ai_qa", reason = "unknown_card", runId = report.RunId, chunk = report.Chunk, ignored });
    }
    if (mismatched > 0)
    {
      Log.Event("warn", new { tag = "ai_qa", reason = "hash_echo_mismatch", runId = report.RunId, chunk = report.Chunk, mismatched });
    }
  }

  /// <summary>
  /// <c>qa:&lt;runId&gt;:&lt;chunk&gt;:&lt;hash&gt;</c>, the hash being the first 16 hex digits of SHA-256 over the
  /// sorted <c>cardId:newStatus</c> pairs the report changed.
  /// </summary>
  internal static string LedgerDedupeKey(Guid runId, int chunk, IEnumerable<(long CardId, string Status)> transitions)
  {
    var canonical = string.Join(",", transitions
      .OrderBy(t => t.CardId)
      .ThenBy(t => t.Status, StringComparer.Ordinal)
      .Select(t => $"{t.CardId.ToString(CultureInfo.InvariantCulture)}:{t.Status}"));
    var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)))[..16].ToLowerInvariant();
    return $"qa:{runId}:{chunk.ToString(CultureInfo.InvariantCulture)}:{hash}";
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
