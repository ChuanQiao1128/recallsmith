using System.Globalization;
using System.Text;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>One rendered email. <see cref="Summary"/> is the subject without prefix or dry-run marker, at most 300 characters.</summary>
public sealed record RenderedEmail(string Subject, string BodyText, string Summary);

/// <summary>One draft of a run as the batch summary lists it.</summary>
public sealed record BatchDraft(string StableUid, string Question, string State, string? Reason, string? ReasonDetail, long DeckId);

/// <summary>One auto-publish attempt a run touched.</summary>
public sealed record BatchPublish(long DeckId, string DeckSlug, string State, string? Reason, string? ReasonDetail, string? JobId, string? BuildId);

/// <summary>What the batch summary of one finalised run shows (A00 §12.5).</summary>
public sealed record BatchSummaryData(Guid RunId, long? DeckId, string DeckSlug, string SourceKind, string SourceUrl, string? SourceTitle,
  IReadOnlyList<BatchDraft> Drafts, decimal QaSpendUsd, IReadOnlyList<BatchPublish> Publishes, string RunnerId, int? DurationMs, string? Outcome);

/// <summary>One per-automation row of the digest, from the ledger computation.</summary>
public sealed record DigestAutomation(string Automation, long Runs, long Units, long Failures, decimal MinutesSaved);

/// <summary>A runner as the digest reports it.</summary>
public sealed record DigestRunner(string RunnerId, DateTimeOffset LastHeartbeatAt, DateTimeOffset? LoginExpiresAt);

/// <summary>What the weekly digest shows (A00 §12.5); <see cref="From"/>..<see cref="To"/> are inclusive UTC days.</summary>
public sealed record WeeklyDigestData(DateOnly From, DateOnly To, decimal HoursSaved, decimal MinutesSaved, long LedgerRuns, long LedgerUnits,
  long DefectsCaught, IReadOnlyList<DigestAutomation> Automations,
  IReadOnlyDictionary<string, long> DecisionsByState, IReadOnlyDictionary<string, long> DecisionsByReason,
  long ShadowWouldAccept, long ShadowHumanDecided, long ShadowHumanAccepted, long ShadowHumanEditedAccepted, long ShadowHumanRejected,
  IReadOnlyDictionary<string, long> PublishesByState, long WatchChecks, long WatchChanges, long WatchFailures,
  long EmailsSent, long EmailsFailed, IReadOnlyList<DigestRunner> Runners, decimal HumanQaSpendUsd, decimal AutomationQaSpendUsd,
  long HumanDraftsPending, long HumanPublishes);

/// <summary>A card a source re-check flagged with an open blocker/major finding.</summary>
public sealed record SourceFlaggedCard(long CardId, string StableUid, string Severity);

/// <summary>One deck a source change touched: its re-check run(s) and what they found.</summary>
public sealed record SourceDeck(long DeckId, string DeckSlug, IReadOnlyList<Guid> RunIds, int CardsRechecked,
  IReadOnlyList<SourceFlaggedCard> Flagged);

/// <summary>What the source-changed email shows (A00 §12.5, §12.6 step 8).</summary>
public sealed record SourceChangedData(long EventId, long TargetId, string Url, string Change, string RecheckState,
  IReadOnlyList<SourceDeck> Decks, IReadOnlyList<long> MissingQuoteCardIds, IReadOnlyList<long> QueueItemIds);

/// <summary>
/// Every automation email, rendered by pure functions (R18A A04, contract A00 §12.2, §12.4, §12.5): no I/O, no clock,
/// no recipient. Subject = <see cref="SubjectPrefix"/> + (<see cref="DryRunMarker"/> in <c>dry_run</c> only) + the
/// §12.4 subject; body = (<see cref="DryRunLine"/> in <c>dry_run</c> only), a one-sentence summary, a blank line, the
/// <c>NEEDS YOU</c>, <c>DONE AUTOMATICALLY</c> and <c>DETAILS</c> sections and the <see cref="Footer"/>. Plain text,
/// every line at most <see cref="MaxLineLength"/> characters, the body at most <see cref="MaxBodyLength"/>: long lists
/// end with a <c>… and &lt;n&gt; more</c> line.
/// </summary>
public static class EmailTemplates
{
  public const string SubjectPrefix = "[DeveloperCards] ";
  public const string DryRunMarker = "(dry run) ";
  public const string DryRunLine = "DRY RUN — AUTOMATION_MODE=dry_run: nothing was accepted or published. \"Auto-accepted\" below reads \"would be accepted\".";
  public const string FooterSentence = "Sent by developercards-notifier to the owner alert address; replies are not read.";
  public const int MaxLineLength = 998, MaxBodyLength = 100_000;
  public const int MaxSubjectLength = 200, MaxSummaryLength = 300, MaxQuestionLength = 120, MaxPathLength = 60;

  public const string NeedsYouHeading = "NEEDS YOU", DoneHeading = "DONE AUTOMATICALLY", DetailsHeading = "DETAILS";
  private const string NoneLine = "- nothing";
  private const int InitialListLimit = 500;

  /// <summary>The eleven exception subkinds of A00 §12.4, in table order.</summary>
  public static readonly IReadOnlyList<string> ExceptionSubkinds =
  [
    "runner_stalled", "runner_login_expiring", "runner_run_failed", "queue_item_failed", "qa_provider_error", "ai_qa_daily_cap",
    "publish_blocked", "publish_failed", "eval_gate_missing", "watch_failing", "source_gone",
  ];

  // ---------------------------------------------------------------------------------------------
  // shared parts
  // ---------------------------------------------------------------------------------------------

  /// <summary>The full subject: prefix, the dry-run marker in <c>dry_run</c> only, then <paramref name="subject"/> (capped at 200).</summary>
  public static string Subject(string mode, string subject)
  {
    var full = SubjectPrefix + (mode == AutomationMode.DryRun ? DryRunMarker : string.Empty) + OneLine(subject);
    return Cap(full, MaxSubjectLength);
  }

  /// <summary>The two footer lines every email ends with.</summary>
  public static string Footer(string mode, string consoleUrl) =>
    $"Console: {consoleUrl}\nMode: {mode}. {FooterSentence}";

  /// <summary><c>&lt;consoleBaseUrl&gt;/automation</c> plus an optional query (<c>runId=…</c>, <c>draftId=…</c>).</summary>
  public static string AutomationUrl(string consoleBaseUrl, string? query = null) =>
    $"{consoleBaseUrl.TrimEnd('/')}/automation" + (string.IsNullOrEmpty(query) ? string.Empty : "?" + query);

  /// <summary><c>host + path</c> of <paramref name="url"/> with the path capped at 60 characters (the raw text when it is no absolute URL).</summary>
  public static string HostPath(string? url)
  {
    if (string.IsNullOrWhiteSpace(url)) return "(unknown source)";
    if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri)) return Cap(OneLine(url.Trim()), MaxPathLength);
    return uri.Host + Cap(uri.AbsolutePath, MaxPathLength);
  }

  /// <summary>A human label for a decision or publish reason code, ending in the code itself.</summary>
  public static string ReasonLabel(string? reason) => reason is null ? "no reason" : ReasonLabels.TryGetValue(reason, out var label)
    ? $"{label} ({reason})"
    : reason;

  private static readonly Dictionary<string, string> ReasonLabels = new(StringComparer.Ordinal)
  {
    ["RUN_NOT_RUNNING"] = "run was not running",
    ["DECK_MISMATCH"] = "draft is for another deck than the run",
    ["DECK_NOT_ALLOWED"] = "deck is not enabled for automation",
    ["EXISTING_CARD"] = "a card with this id already exists",
    ["LIKELY_DUPLICATE"] = "likely duplicate of an existing card",
    ["UNGROUNDED"] = "quote not found in the source",
    ["SOURCE_HOST_NOT_ALLOWED"] = "source host is not on the allowlist",
    ["QA_UNAVAILABLE"] = "AI QA is not enabled",
    ["AI_QA_DAILY_CAP"] = "AI QA daily cap reached",
    ["ENQUEUE_RETRY"] = "AI QA enqueue is being retried",
    ["ENQUEUE_FAILED"] = "AI QA enqueue failed",
    ["QA_TIMEOUT"] = "AI QA did not answer in time",
    ["QA_ERROR"] = "AI QA reviewer error",
    ["QA_HASH_MISMATCH"] = "reviewed content differs from the draft",
    ["QA_FLAGGED"] = "AI QA found a blocker or major issue",
    ["REVIEWER_NOT_GATED"] = "reviewer differs from the eval gate",
    ["MODE_OFF"] = "automation was switched off",
    ["DECK_DELETED"] = "deck is deleted",
    ["DECIDED_BY_HUMAN"] = "a human decided first",
    ["AUTO_PUBLISH_DISABLED"] = "auto-publish is disabled",
    ["DECK_NEVER_PUBLISHED"] = "the first publish of a deck is always manual",
    ["PUBLISH_IN_PROGRESS"] = "another publish is in progress",
    ["PUBLISH_WAIT_TIMEOUT"] = "another publish did not finish in time",
    ["DECK_HAS_HUMAN_CHANGES"] = "the deck has changes a human made",
    ["MCQ_PUBLISH_GATE"] = "MCQ publish gate refused a card",
    ["AI_QA_REQUIRED"] = "AI QA publish gate needs a review",
    ["AI_QA_BLOCKED"] = "AI QA publish gate found an open blocker",
    ["AI_QA_STALE"] = "cards changed while the publish was checked",
    ["CONFIG_ERROR"] = "publish configuration is missing",
    ["SERVER_NOT_READY_AI_QA"] = "AI QA tables are not migrated",
    ["PUBLISH_FAILED"] = "the publish job failed",
  };

  // ---------------------------------------------------------------------------------------------
  // exception alerts (A00 §12.4)
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// The exception alert of <paramref name="subkind"/> (one of <see cref="ExceptionSubkinds"/>); <paramref name="facts"/>
  /// carries the keys the §12.4 row names (a missing key renders as <c>unknown</c>). An unknown subkind still renders
  /// a generic alert, so a new caller never loses an email.
  /// </summary>
  public static RenderedEmail Exception(string mode, string subkind, IReadOnlyDictionary<string, string> facts, string consoleBaseUrl)
  {
    string F(string key) => facts.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v) ? OneLine(v) : "unknown";

    string subject, summary;
    string[] factKeys;
    var needs = new List<string>();
    var done = new List<string>();
    var query = facts.TryGetValue("runId", out var rid) && !string.IsNullOrWhiteSpace(rid) ? $"runId={rid.Trim()}"
      : facts.TryGetValue("draftId", out var did) && !string.IsNullOrWhiteSpace(did) ? $"draftId={did.Trim()}"
      : null;
    var console = AutomationUrl(consoleBaseUrl, query);

    switch (subkind)
    {
      case "runner_stalled":
        subject = $"Action needed: authoring runner {F("runnerId")} silent since {F("since")}";
        summary = $"The local authoring runner {F("runnerId")} has not sent a heartbeat since {F("since")}; {F("queued")} queue item(s) are waiting.";
        needs.Add($"- runner {F("runnerId")} — wake the Mac or check the launchd job — {console}");
        factKeys = ["runnerId", "since", "loginExpiresAt", "lastRunId", "lastRunAt", "queued"];
        break;
      case "runner_login_expiring":
        subject = $"Action needed: runner login expires in {F("days")} day(s)";
        summary = $"The login of runner {F("runnerId")} expires in {F("days")} day(s), at {F("loginExpiresAt")}.";
        needs.Add($"- runner {F("runnerId")} — run: node tools/mcp-server/dist/index.js login — {console}");
        factKeys = ["runnerId", "days", "loginExpiresAt"];
        break;
      case "runner_run_failed":
        subject = $"Action needed: authoring run failed for {HostPath(facts.GetValueOrDefault("url"))}";
        summary = $"Authoring run {F("runId")} for queue item {F("itemId")} failed.";
        needs.Add($"- {F("url")} — {F("error")} — {console}");
        factKeys = ["runId", "itemId", "url", "error"];
        break;
      case "queue_item_failed":
        subject = $"Action needed: queue item {F("itemId")} failed 3 times";
        summary = $"Queue item {F("itemId")} failed 3 times and will not be retried.";
        needs.Add($"- {F("url")} — {F("lastError")} — {AutomationUrl(consoleBaseUrl, "tab=queue")}");
        factKeys = ["itemId", "url", "lastError"];
        break;
      case "qa_provider_error":
        subject = $"Action needed: AI QA reviewer error {F("code")}";
        summary = $"The AI QA reviewer answered {F("code")}; drafts it could not review go to the review queue.";
        needs.Add($"- reviewer {F("code")} — check the Bedrock model access of developercards-ai-qa — {console}");
        factKeys = ["code", "draftId", "runId"];
        break;
      case "ai_qa_daily_cap":
        subject = $"AI QA daily cap reached; {F("waiting")} draft(s) waiting";
        summary = $"The AI QA daily cap is reached; {F("waiting")} draft(s) wait for tomorrow's budget.";
        needs.Add($"- raise AI_QA_DAILY_USD_CAP only if the spend is expected — {console}");
        factKeys = ["waiting"];
        break;
      case "publish_blocked":
        subject = $"Action needed: publish {F("deckSlug")} ({F("reason")})";
        summary = $"Auto-publish of {F("deckSlug")} needs a human: {ReasonLabel(facts.GetValueOrDefault("reason"))}.";
        needs.Add($"- {F("deckSlug")} — {ReasonLabel(facts.GetValueOrDefault("reason"))} — publish from the console after checking the deck — {console}");
        done.Add("- the auto-accepted cards stay in the deck, QA-passed and unpublished");
        factKeys = ["publishId", "deckId", "deckSlug", "reason", "reasonDetail", "runId"];
        break;
      case "publish_failed":
        subject = $"Action needed: auto-publish of {F("deckSlug")} failed";
        summary = $"The auto-publish job {F("jobId")} of {F("deckSlug")} failed.";
        needs.Add($"- {F("deckSlug")} — {F("error")} — {console}");
        factKeys = ["jobId", "deckId", "deckSlug", "error"];
        break;
      case "eval_gate_missing":
        subject = "AUTOMATION_MODE=live is blocked: no passed eval gate";
        summary = "AUTOMATION_MODE is live but no passed eval gate exists, so the automation runs as a dry run.";
        needs.Add($"- record a passed eval gate, or set AUTOMATION_MODE back to dry_run — {console}");
        factKeys = [];
        break;
      case "watch_failing":
        subject = $"Source watch failing: {F("url")}";
        summary = $"The source watch of {F("url")} failed 3 times in a row.";
        needs.Add($"- {F("url")} — {F("errorCode")} — {AutomationUrl(consoleBaseUrl, $"tab=watch&targetId={F("targetId")}")}");
        factKeys = ["targetId", "eventId", "url", "errorCode"];
        break;
      case "source_gone":
        subject = $"Cited source gone: {F("url")}";
        summary = $"The cited source {F("url")} is gone; {F("citingCards")} card(s) cite it.";
        needs.Add($"- {F("url")} — find a new source for {F("citingCards")} card(s) — {AutomationUrl(consoleBaseUrl, $"tab=watch&targetId={F("targetId")}")}");
        factKeys = ["targetId", "eventId", "url", "citingCards"];
        break;
      default:
        subject = $"Action needed: automation exception {OneLine(subkind)}";
        summary = $"The automation raised the exception {OneLine(subkind)}.";
        needs.Add($"- {OneLine(subkind)} — {console}");
        factKeys = facts.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray();
        break;
    }

    var details = new List<string> { $"Exception: {OneLine(subkind)}" };
    details.AddRange(factKeys.Select(k => $"{k}: {F(k)}"));
    return Render(mode, subject, summary, needs, done, details, console);
  }

  // ---------------------------------------------------------------------------------------------
  // batch summary, digest, source changed, test (A00 §12.4–§12.5)
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// The one email per finalised run. <c>&lt;a&gt;</c> counts <c>auto_accepted</c> drafts (<c>would_accept</c> in
  /// <c>dry_run</c>), <c>&lt;h&gt;</c> the <c>human</c> ones; <c>&lt;publish&gt;</c> sums up the run's publishes.
  /// </summary>
  public static RenderedEmail BatchSummary(string mode, BatchSummaryData data, string consoleBaseUrl)
  {
    var dry = mode == AutomationMode.DryRun;
    var acceptedState = dry ? DraftDecisions.WouldAccept : DraftDecisions.AutoAccepted;
    var accepted = data.Drafts.Where(d => d.State == acceptedState).ToList();
    var human = data.Drafts.Where(d => d.State == DraftDecisions.Human).ToList();
    var publish = PublishLabel(data.Publishes, dry);
    var runShort = data.RunId.ToString("D")[..8];
    var subject = $"Batch {runShort} {data.DeckSlug}: {accepted.Count} auto-accepted, {human.Count} need you, {publish}";
    var summary = $"Run {runShort} on {data.DeckSlug} submitted {data.Drafts.Count} draft(s): {accepted.Count} auto-accepted, " +
      $"{human.Count} need you; publish: {publish}.";

    var console = AutomationUrl(consoleBaseUrl, $"runId={data.RunId:D}");
    var needs = human.Select(d =>
      $"- {d.StableUid} — {ReasonLabel(d.Reason)} — {consoleBaseUrl.TrimEnd('/')}/review?deckId={d.DeckId.ToString(CultureInfo.InvariantCulture)}").ToList();
    needs.AddRange(data.Publishes.Where(p => p.State == "human").Select(p =>
      $"- publish {p.DeckSlug} — {ReasonLabel(p.Reason)} — {console}"));
    var done = accepted.Select(d => $"- {d.StableUid} — {Cap(OneLine(d.Question), MaxQuestionLength)}").ToList();
    done.AddRange(data.Publishes.Where(p => p.State is "published" or "would_publish" or "publishing").Select(p =>
      $"- publish {p.DeckSlug} — {p.State}" + (p.BuildId is null ? string.Empty : $", build {p.BuildId}")));

    var details = new List<string>
    {
      $"Source: {data.SourceKind} {data.SourceUrl}" + (string.IsNullOrWhiteSpace(data.SourceTitle) ? string.Empty : $" ({OneLine(data.SourceTitle)})"),
    };
    details.AddRange(data.Drafts.Select(d =>
      $"Draft {d.StableUid}: {d.State}" + (d.Reason is null ? string.Empty : $", {ReasonLabel(d.Reason)}") +
      (string.IsNullOrWhiteSpace(d.ReasonDetail) ? string.Empty : $" ({OneLine(d.ReasonDetail)})") +
      $" — {Cap(OneLine(d.Question), MaxQuestionLength)}" +
      (d.State == DraftDecisions.Human ? $" — {consoleBaseUrl.TrimEnd('/')}/review?deckId={d.DeckId.ToString(CultureInfo.InvariantCulture)}" : string.Empty)));
    details.Add($"Draft QA spend: {Usd(data.QaSpendUsd)}");
    if (data.Publishes.Count == 0) details.Add("Publish: none");
    details.AddRange(data.Publishes.Select(p =>
      $"Publish {p.DeckSlug}: {p.State}" + (p.Reason is null ? string.Empty : $", {ReasonLabel(p.Reason)}") +
      (string.IsNullOrWhiteSpace(p.ReasonDetail) ? string.Empty : $" ({OneLine(p.ReasonDetail)})") +
      (p.BuildId is null ? string.Empty : $", build {p.BuildId}")));
    details.Add($"Runner: {data.RunnerId}, duration " +
      (data.DurationMs is { } ms ? $"{(ms / 1000m).ToString("0.#", CultureInfo.InvariantCulture)} s" : "unknown") +
      $", outcome {data.Outcome ?? "unknown"}");
    return Render(mode, subject, summary, needs, done, details, console);
  }

  /// <summary>The <c>&lt;publish&gt;</c> part of the batch subject.</summary>
  internal static string PublishLabel(IReadOnlyList<BatchPublish> publishes, bool dryRun)
  {
    if (publishes.Count == 0) return "no publish";
    if (publishes.Any(p => p.State == "human")) return dryRun ? "publish would need you" : "publish needs you";
    if (dryRun || publishes.All(p => p.State == "would_publish")) return "would publish";
    if (publishes.All(p => p.State == "published")) return "published";
    if (publishes.Any(p => p.State == "publishing")) return "publishing";
    return "publish waiting";
  }

  /// <summary>The Monday digest: the week's ledger numbers and the automation's own counts.</summary>
  public static RenderedEmail WeeklyDigest(string mode, WeeklyDigestData data, string consoleBaseUrl)
  {
    var from = Day(data.From);
    var to = Day(data.To);
    var hours = data.HoursSaved.ToString("0.##", CultureInfo.InvariantCulture);
    var subject = $"Weekly automation digest {from}–{to}: {hours} h saved";
    var summary = $"From {from} to {to} the automations saved {hours} h over {data.LedgerUnits} unit(s) of work.";
    var console = AutomationUrl(consoleBaseUrl);

    var needs = new List<string>();
    if (data.HumanDraftsPending > 0)
    {
      needs.Add($"- {data.HumanDraftsPending} draft(s) routed to you are still pending — {consoleBaseUrl.TrimEnd('/')}/review");
    }
    if (data.HumanPublishes > 0) needs.Add($"- {data.HumanPublishes} publish(es) need you — {AutomationUrl(consoleBaseUrl, "tab=runs")}");
    if (data.EmailsFailed > 0) needs.Add($"- {data.EmailsFailed} email(s) failed — {AutomationUrl(consoleBaseUrl, "tab=email")}");

    var done = new List<string>
    {
      $"- {Count(data.DecisionsByState, DraftDecisions.AutoAccepted)} card(s) auto-accepted, {Count(data.DecisionsByState, DraftDecisions.WouldAccept)} would be accepted",
      $"- {Count(data.PublishesByState, "published")} build(s) auto-published, {Count(data.PublishesByState, "would_publish")} would be published",
      $"- {data.WatchChecks} source check(s), {data.WatchChanges} change(s) found",
    };

    var details = new List<string>
    {
      $"Ledger {from}–{to}: {data.LedgerRuns} run(s), {data.LedgerUnits} unit(s), {data.MinutesSaved.ToString("0.##", CultureInfo.InvariantCulture)} min saved, {data.DefectsCaught} defect(s) caught",
    };
    details.AddRange(data.Automations.Select(a =>
      $"Ledger {a.Automation}: {a.Runs} run(s), {a.Units} unit(s), {a.Failures} failure(s), {a.MinutesSaved.ToString("0.##", CultureInfo.InvariantCulture)} min saved"));
    details.Add("Decisions by state: " + Pairs(data.DecisionsByState));
    details.Add("Decisions by reason: " + Pairs(data.DecisionsByReason));
    var agreement = data.ShadowHumanDecided == 0
      ? "n/a"
      : ((decimal)data.ShadowHumanAccepted / data.ShadowHumanDecided).ToString("0.00", CultureInfo.InvariantCulture);
    details.Add($"Dry-run agreement: {data.ShadowWouldAccept} would-accept, {data.ShadowHumanDecided} decided by a human " +
      $"({data.ShadowHumanAccepted} accepted, {data.ShadowHumanEditedAccepted} edited, {data.ShadowHumanRejected} rejected), agreement {agreement}");
    details.Add("Publishes by state: " + Pairs(data.PublishesByState));
    details.Add($"Source watch: {data.WatchChecks} check(s), {data.WatchChanges} change(s), {data.WatchFailures} failure(s)");
    details.Add($"Emails: {data.EmailsSent} sent, {data.EmailsFailed} failed");
    if (data.Runners.Count == 0) details.Add("Runners: none registered");
    details.AddRange(data.Runners.Select(r =>
      $"Runner {r.RunnerId}: last heartbeat {Timestamp(r.LastHeartbeatAt)}, login expires {(r.LoginExpiresAt is { } l ? Timestamp(l) : "unknown")}"));
    details.Add($"AI QA spend: {Usd(data.HumanQaSpendUsd)} human runs, {Usd(data.AutomationQaSpendUsd)} automation");
    return Render(mode, subject, summary, needs, done, details, console);
  }

  /// <summary>The email of one changed or gone source once its re-checks are done (or unavailable).</summary>
  public static RenderedEmail SourceChanged(string mode, SourceChangedData data, string consoleBaseUrl)
  {
    var rechecked = data.Decks.Sum(d => d.CardsRechecked);
    var flagged = data.Decks.SelectMany(d => d.Flagged.Select(f => f.CardId)).Distinct().Count();
    var subject = $"Source changed: {HostPath(data.Url)} — {rechecked} card(s) re-checked, {flagged} flagged";
    var summary = $"The cited source {data.Url} {(data.Change == "gone" ? "is gone" : "changed")}; {rechecked} card(s) were re-checked and {flagged} flagged.";
    var console = AutomationUrl(consoleBaseUrl, $"tab=watch&targetId={data.TargetId.ToString(CultureInfo.InvariantCulture)}");
    var baseUrl = consoleBaseUrl.TrimEnd('/');

    string RecheckLink(SourceDeck d) => d.RunIds.Count == 0
      ? $"{baseUrl}/decks/qa?deckId={d.DeckId.ToString(CultureInfo.InvariantCulture)}"
      : $"{baseUrl}/decks/qa?deckId={d.DeckId.ToString(CultureInfo.InvariantCulture)}&runId={d.RunIds[0]:D}";

    var needs = new List<string>();
    foreach (var d in data.Decks)
    {
      needs.AddRange(d.Flagged.Select(f => $"- {f.StableUid} — open {f.Severity} finding — {RecheckLink(d)}"));
    }
    needs.AddRange(data.MissingQuoteCardIds.Select(id =>
      $"- card {id.ToString(CultureInfo.InvariantCulture)} — its quote is no longer on the page — {console}"));

    var done = data.Decks.SelectMany(d => d.RunIds.Select(r =>
      $"- re-check run {r:D} of {d.DeckSlug} ({d.CardsRechecked} card(s)) — {baseUrl}/decks/qa?deckId={d.DeckId.ToString(CultureInfo.InvariantCulture)}&runId={r:D}")).ToList();
    done.AddRange(data.QueueItemIds.Select(q => $"- queue item {q.ToString(CultureInfo.InvariantCulture)} added for the authoring runner"));

    var details = new List<string>
    {
      $"Source: {data.Url}",
      $"Change: {data.Change}, event {data.EventId.ToString(CultureInfo.InvariantCulture)}, re-check {data.RecheckState}",
    };
    details.AddRange(data.Decks.Select(d =>
      $"Deck {d.DeckSlug}: {d.CardsRechecked} card(s) re-checked, {d.Flagged.Count} flagged — {RecheckLink(d)}"));
    details.Add("Cards whose quote vanished: " + (data.MissingQuoteCardIds.Count == 0
      ? "none"
      : string.Join(", ", data.MissingQuoteCardIds.Select(i => i.ToString(CultureInfo.InvariantCulture)))));
    details.Add("Queue items: " + (data.QueueItemIds.Count == 0
      ? "none"
      : string.Join(", ", data.QueueItemIds.Select(i => i.ToString(CultureInfo.InvariantCulture)))));
    return Render(mode, subject, summary, needs, done, details, console);
  }

  /// <summary>The super_admin's test email (sent in every mode).</summary>
  public static RenderedEmail Test(string mode, string consoleBaseUrl) => Render(mode, "Test email",
    "This is a test email from the DeveloperCards automation; the notifier path works.",
    [], [], [$"Mode at send: {mode}"], AutomationUrl(consoleBaseUrl, "tab=email"));

  // ---------------------------------------------------------------------------------------------
  // layout
  // ---------------------------------------------------------------------------------------------

  private static RenderedEmail Render(string mode, string subject, string summary, IReadOnlyList<string> needs, IReadOnlyList<string> done,
    IReadOnlyList<string> details, string consoleUrl)
  {
    var subjectLine = OneLine(subject);
    var footer = Footer(mode, consoleUrl);
    string body;
    var limit = InitialListLimit;
    while (true)
    {
      body = Layout(mode, summary, needs, done, details, footer, limit);
      if (body.Length <= MaxBodyLength || limit == 0) break;
      limit /= 2;
    }
    if (body.Length > MaxBodyLength)
    {
      // Only the unlisted lines are left; keep the head and the footer.
      var head = body[..(MaxBodyLength - footer.Length - 20)];
      body = head[..head.LastIndexOf('\n')] + "\n… truncated\n\n" + footer;
    }
    return new RenderedEmail(Subject(mode, subjectLine), body, Cap(subjectLine, MaxSummaryLength));
  }

  private static string Layout(string mode, string summary, IReadOnlyList<string> needs, IReadOnlyList<string> done,
    IReadOnlyList<string> details, string footer, int limit)
  {
    var sb = new StringBuilder();
    void Line(string text) => sb.Append(Cap(OneLine(text), MaxLineLength)).Append('\n');
    void List(IReadOnlyList<string> items)
    {
      if (items.Count == 0) { Line(NoneLine); return; }
      foreach (var item in items.Take(limit)) Line(item);
      if (items.Count > limit) Line($"… and {(items.Count - limit).ToString(CultureInfo.InvariantCulture)} more");
    }

    if (mode == AutomationMode.DryRun) Line(DryRunLine);
    Line(summary);
    sb.Append('\n');
    Line(NeedsYouHeading);
    List(needs);
    sb.Append('\n');
    Line(DoneHeading);
    List(done);
    sb.Append('\n');
    Line(DetailsHeading);
    if (details.Count == 0) Line(NoneLine);
    foreach (var item in details.Take(limit)) Line(item);
    if (details.Count > limit) Line($"… and {(details.Count - limit).ToString(CultureInfo.InvariantCulture)} more");
    sb.Append('\n');
    foreach (var footerLine in footer.Split('\n')) Line(footerLine);
    return sb.ToString();
  }

  /// <summary>Line breaks and tabs become spaces, so user text never breaks the layout.</summary>
  internal static string OneLine(string text) => text.Replace("\r\n", " ").Replace('\n', ' ').Replace('\r', ' ').Replace('\t', ' ');

  internal static string Cap(string text, int max) => text.Length <= max ? text : text[..(max - 1)] + "…";

  private static long Count(IReadOnlyDictionary<string, long> counts, string key) => counts.TryGetValue(key, out var n) ? n : 0;

  private static string Pairs(IReadOnlyDictionary<string, long> counts) => counts.Count == 0
    ? "none"
    : string.Join(", ", counts.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => $"{kv.Key} {kv.Value.ToString(CultureInfo.InvariantCulture)}"));

  private static string Usd(decimal usd) => "$" + usd.ToString("0.0000", CultureInfo.InvariantCulture);

  private static string Day(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

  private static string Timestamp(DateTimeOffset value) => value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm'Z'", CultureInfo.InvariantCulture);
}
