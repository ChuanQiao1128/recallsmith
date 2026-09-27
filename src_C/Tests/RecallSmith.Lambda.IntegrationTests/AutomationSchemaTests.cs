using System.Globalization;
using Npgsql;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Migration 034 (R18A A01, contract A00 §7) against a real Postgres: scratch databases migrated to 033, then the text
/// of 034 applied the way <c>Migrate.ApplyOne</c> does (through <see cref="DbUtil.ExecuteAsync"/>). Covers
/// idempotency, every table and named index, every CHECK, the append-only decision log, the widened webhook-event
/// CHECK, the two feed seeds with and without their decks, and the three ledger baselines.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationSchemaTests
{
  private readonly PostgresFixture _db;
  public AutomationSchemaTests(PostgresFixture db) => _db = db;

  private static readonly string[] Tables =
  [
    "automation_runners", "source_watch_targets", "source_watch_events", "authoring_queue_items", "source_watch_feed_items",
    "automation_runs", "automation_eval_gates", "automation_draft_decisions", "automation_draft_findings",
    "automation_decision_events", "automation_publishes", "automation_notifications", "automation_qa_spend",
  ];

  private static readonly string[] Indexes =
  [
    "idx_source_watch_targets_due", "idx_source_watch_events_target", "idx_source_watch_events_recheck",
    "idx_authoring_queue_items_due", "idx_authoring_queue_items_status", "idx_automation_runs_started", "idx_automation_runs_open",
    "uq_automation_decisions_qa_job", "idx_automation_decisions_run", "idx_automation_decisions_state", "idx_automation_decisions_deck",
    "idx_automation_decisions_card", "idx_automation_decisions_created", "idx_automation_draft_findings_draft",
    "idx_automation_decision_events_draft", "uq_automation_publishes_open", "idx_automation_publishes_deck",
    "idx_automation_publishes_run", "idx_automation_notifications_created", "idx_automation_notifications_retry",
    "idx_automation_qa_spend_spent",
  ];

  private static readonly string[] EightEvents =
  [
    "deck.published", "import.failed", "card.flagged", "review.queued",
    "draft.auto_accepted", "automation.batch_completed", "automation.exception", "source.changed",
  ];

  private const string AwsFeedUrl = "https://aws.amazon.com/about-aws/whats-new/recent/feed/";
  private const string ReleaseNotesUrl = "https://platform.claude.com/docs/en/release-notes/overview";

  // ---------------------------------------------------------------- helpers

  private static Task<string> Migration034TextAsync() =>
    File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "034_automation.sql"));

  /// <summary>A scratch database at 033; <paramref name="before"/> runs there before 034 is applied once.</summary>
  private async Task<NpgsqlConnection> Scratch034Async(string name, Func<NpgsqlConnection, Task>? before = null) =>
    await OpenAt034Async(await _db.CreateScratchDatabaseAsync(name), before);

  private static async Task<NpgsqlConnection> OpenAt034Async(string scratch, Func<NpgsqlConnection, Task>? before)
  {
    var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 33);
    if (before is not null) await before(conn);
    await DbUtil.ExecuteAsync(conn, null, await Migration034TextAsync(), []);
    return conn;
  }

  private static async Task<long> CountAsync(NpgsqlConnection conn, string sql) =>
    Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, sql, []), CultureInfo.InvariantCulture);

  private static async Task<long> InsertIdAsync(NpgsqlConnection conn, string sql) =>
    Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, sql, []), CultureInfo.InvariantCulture);

  private static Task InsertDeckAsync(NpgsqlConnection conn, string slug) =>
    DbUtil.ExecuteAsync(conn, null, $"insert into decks (slug, title, author) values ('{slug}', 'deck {slug}', 'tests')", []);

  /// <summary>Parent rows of the CHECK theory, created once per test run in one scratch database.</summary>
  private sealed record ChecksDb(string ConnectionString, long DeckId, long DraftId, long FreeDraftId, long TargetId, long QueueItemId, string RunId);

  private static readonly SemaphoreSlim ChecksLock = new(1, 1);
  private static ChecksDb? _checks;

  private async Task<ChecksDb> ChecksDbAsync()
  {
    await ChecksLock.WaitAsync();
    try
    {
      if (_checks is not null) return _checks;
      var scratch = await _db.CreateScratchDatabaseAsync("a01_034_checks");
      await using var conn = await OpenAt034Async(scratch, null);
      var deck = await InsertIdAsync(conn, "insert into decks (slug, title, author) values ('it-a01-checks', 'checks', 'tests') returning id");
      const string draftSql =
        "insert into ai_drafts (deck_id, batch_id, client_draft_key, stable_uid, card, submitted_by_sub) " +
        "values ({0}, gen_random_uuid(), '{1}', '{1}', '{{}}'::jsonb, 'it-a01') returning id";
      var draft = await InsertIdAsync(conn, string.Format(CultureInfo.InvariantCulture, draftSql, deck, "it-a01-d1"));
      var freeDraft = await InsertIdAsync(conn, string.Format(CultureInfo.InvariantCulture, draftSql, deck, "it-a01-d2"));
      var target = await InsertIdAsync(conn,
        "insert into source_watch_targets (kind, url, check_interval_minutes) values ('page', 'https://example.com/it-a01-parent', 60) returning id");
      var queue = await InsertIdAsync(conn,
        "insert into authoring_queue_items (kind, url, dedupe_key, created_by) values ('manual', 'https://example.com/it-a01-q', 'it-a01-parent', 'it') returning id");
      const string runId = "00000000-0000-0000-0000-00000000a001";
      await DbUtil.ExecuteAsync(conn, null,
        $"insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub) values ('{runId}', {queue}, 'it-runner', 'it')", []);
      await DbUtil.ExecuteAsync(conn, null,
        $"insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state) values ({draft}, '{runId}', {deck}, 'dry_run', 'qa_pending')", []);
      _checks = new ChecksDb(scratch, deck, draft, freeDraft, target, queue, runId);
      return _checks;
    }
    finally
    {
      ChecksLock.Release();
    }
  }

  private static string Fill(string sql, ChecksDb p) => sql
    .Replace("{deck}", p.DeckId.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
    .Replace("{draft}", p.DraftId.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
    .Replace("{freeDraft}", p.FreeDraftId.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
    .Replace("{target}", p.TargetId.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
    .Replace("{queue}", p.QueueItemId.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
    .Replace("{run}", p.RunId, StringComparison.Ordinal);

  // ---------------------------------------------------------------- idempotency and objects

  [Fact]
  public async Task Migration034_RunsTwice_IsIdempotent()
  {
    await using var conn = await Scratch034Async("a01_034_idem", c => InsertDeckAsync(c, "aws-saa-c03"));

    const string fingerprintSql =
      "select (select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname = any($1))" +
      " + (select count(*) from pg_indexes where tablename = any($1))" +
      " + (select count(*) from pg_trigger where not tgisinternal and tgrelid = 'automation_decision_events'::regclass)" +
      " + (select count(*) from pg_constraint where conname = 'ck_webhook_subscriptions_events')";
    async Task<long> FingerprintAsync() =>
      Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, fingerprintSql, [Tables]), CultureInfo.InvariantCulture);

    // An edited baseline and a deactivated seed survive a re-run: every seed is `on conflict do nothing`.
    await DbUtil.ExecuteAsync(conn, null,
      "update automation_baselines set baseline_minutes_per_unit = 4.25, baseline_source = 'measured' where automation = 'auto_accept'", []);
    await DbUtil.ExecuteAsync(conn, null, $"update source_watch_targets set active = false where url = '{AwsFeedUrl}'", []);

    var baselines = await CountAsync(conn, "select count(*) from automation_baselines");
    var targets = await CountAsync(conn, "select count(*) from source_watch_targets");
    var fingerprint = await FingerprintAsync();

    var sql = await Migration034TextAsync();
    await DbUtil.ExecuteAsync(conn, null, sql, []);
    await DbUtil.ExecuteAsync(conn, null, sql, []);

    Assert.Equal(9L, baselines);
    Assert.Equal(2L, targets);
    Assert.Equal(baselines, await CountAsync(conn, "select count(*) from automation_baselines"));
    Assert.Equal(targets, await CountAsync(conn, "select count(*) from source_watch_targets"));
    Assert.Equal(fingerprint, await FingerprintAsync());

    var accept = (await DbUtil.QueryAsync(conn, null,
      "select baseline_minutes_per_unit, baseline_source from automation_baselines where automation = 'auto_accept'", [])).Single();
    Assert.Equal(4.25m, (decimal)accept["baseline_minutes_per_unit"]!);
    Assert.Equal("measured", (string)accept["baseline_source"]!);
    Assert.False((bool)(await DbUtil.ExecuteScalarAsync(conn, null, $"select active from source_watch_targets where url = '{AwsFeedUrl}'", []))!);
  }

  [Fact]
  public async Task Migration034_CreatesTheAutomationTables()
  {
    await using var conn = await Scratch034Async("a01_034_tables");

    foreach (var table in Tables)
    {
      Assert.True((bool)(await DbUtil.ExecuteScalarAsync(conn, null, $"select to_regclass('public.{table}') is not null", []))!, table);
    }

    var indexes = (await DbUtil.QueryAsync(conn, null, "select indexname from pg_indexes where schemaname = 'public'", []))
      .Select(r => (string)r["indexname"]!).ToHashSet(StringComparer.Ordinal);
    foreach (var index in Indexes) Assert.Contains(index, indexes);

    // The two partial unique indexes are unique and partial.
    foreach (var index in new[] { "uq_automation_publishes_open", "uq_automation_decisions_qa_job" })
    {
      var def = (string)(await DbUtil.ExecuteScalarAsync(conn, null, $"select indexdef from pg_indexes where indexname = '{index}'", []))!;
      Assert.StartsWith("CREATE UNIQUE INDEX", def, StringComparison.Ordinal);
      Assert.Contains(" WHERE ", def, StringComparison.Ordinal);
    }

    var triggers = (await DbUtil.QueryAsync(conn, null,
      "select tgname from pg_trigger where not tgisinternal and tgrelid = 'automation_decision_events'::regclass order by tgname", []))
      .Select(r => (string)r["tgname"]!).ToArray();
    Assert.Equal(new[] { "trg_automation_decision_events_no_truncate", "trg_automation_decision_events_no_update" }, triggers);
    Assert.Equal(1L, await CountAsync(conn, "select count(*) from pg_proc where proname = 'automation_decision_events_append_only'"));

    // The migration writes no eval gate: a fresh database is never live.
    Assert.Equal(0L, await CountAsync(conn, "select count(*) from automation_eval_gates"));
  }

  // ---------------------------------------------------------------- CHECKs

  [Theory]
  [InlineData("ck_automation_runners_id", "insert into automation_runners (runner_id, owner_sub) values ('Bad_Runner', 'it')")]
  [InlineData("ck_automation_runners_id", "insert into automation_runners (runner_id, owner_sub) values ('-runner', 'it')")]
  [InlineData("ck_automation_runners_state", "insert into automation_runners (runner_id, owner_sub, state) values ('it-state', 'it', 'sleeping')")]
  [InlineData("ck_automation_runners_outcome", "insert into automation_runners (runner_id, owner_sub, last_run_outcome) values ('it-outcome', 'it', 'ok')")]
  [InlineData("ck_automation_runners_text", "insert into automation_runners (runner_id, owner_sub, host) values ('it-text', 'it', repeat('h', 65))")]
  [InlineData("ck_automation_runners_text", "insert into automation_runners (runner_id, owner_sub, last_error) values ('it-text2', 'it', repeat('e', 501))")]
  [InlineData("ck_source_watch_targets_kind", "insert into source_watch_targets (kind, url, check_interval_minutes) values ('rss', 'https://example.com/t-kind', 60)")]
  [InlineData("ck_source_watch_targets_format", "insert into source_watch_targets (kind, url, check_interval_minutes) values ('feed', 'https://example.com/t-f1', 60)")]
  [InlineData("ck_source_watch_targets_format", "insert into source_watch_targets (kind, url, feed_format, check_interval_minutes) values ('page', 'https://example.com/t-f2', 'rss', 60)")]
  [InlineData("ck_source_watch_targets_format", "insert into source_watch_targets (kind, url, feed_format, check_interval_minutes) values ('feed', 'https://example.com/t-f3', 'json', 60)")]
  [InlineData("ck_source_watch_targets_url", "insert into source_watch_targets (kind, url, check_interval_minutes) values ('page', 'http://example.com/t-url', 60)")]
  [InlineData("ck_source_watch_targets_interval", "insert into source_watch_targets (kind, url, check_interval_minutes) values ('page', 'https://example.com/t-i1', 59)")]
  [InlineData("ck_source_watch_targets_interval", "insert into source_watch_targets (kind, url, check_interval_minutes) values ('page', 'https://example.com/t-i2', 43201)")]
  [InlineData("ck_source_watch_targets_status", "insert into source_watch_targets (kind, url, check_interval_minutes, last_status) values ('page', 'https://example.com/t-s', 60, 'ok')")]
  [InlineData("ck_source_watch_targets_pattern", "insert into source_watch_targets (kind, url, feed_format, check_interval_minutes, item_title_pattern) values ('feed', 'https://example.com/t-p', 'rss', 60, repeat('x', 1001))")]
  [InlineData("ck_source_watch_events_kind", "insert into source_watch_events (target_id, watch_run_id, kind) values ({target}, gen_random_uuid(), 'moved')")]
  [InlineData("ck_source_watch_events_recheck", "insert into source_watch_events (target_id, watch_run_id, kind, recheck_state) values ({target}, gen_random_uuid(), 'changed', 'pending')")]
  [InlineData("ck_authoring_queue_items_kind", "insert into authoring_queue_items (kind, url, dedupe_key, created_by) values ('rss', 'https://example.com/q-kind', 'it-q-kind', 'it')")]
  [InlineData("ck_authoring_queue_items_status", "insert into authoring_queue_items (kind, url, dedupe_key, created_by, status) values ('manual', 'https://example.com/q-st', 'it-q-st', 'it', 'running')")]
  [InlineData("ck_authoring_queue_items_url", "insert into authoring_queue_items (kind, url, dedupe_key, created_by) values ('manual', 'ftp://example.com/q', 'it-q-url', 'it')")]
  [InlineData("ck_authoring_queue_items_text", "insert into authoring_queue_items (kind, url, dedupe_key, created_by, title) values ('manual', 'https://example.com/q-t', 'it-q-t', 'it', repeat('t', 301))")]
  [InlineData("ck_authoring_queue_items_text", "insert into authoring_queue_items (kind, url, dedupe_key, created_by, note) values ('manual', 'https://example.com/q-n', 'it-q-n', 'it', repeat('n', 501))")]
  [InlineData("ck_authoring_queue_items_claim", "insert into authoring_queue_items (kind, url, dedupe_key, created_by, status) values ('manual', 'https://example.com/q-c1', 'it-q-c1', 'it', 'claimed')")]
  [InlineData("ck_authoring_queue_items_claim", "insert into authoring_queue_items (kind, url, dedupe_key, created_by, lease_expires_at) values ('manual', 'https://example.com/q-c2', 'it-q-c2', 'it', now())")]
  [InlineData("ck_automation_runs_status", "insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, status) values (gen_random_uuid(), {queue}, 'it-runner', 'it', 'paused')")]
  [InlineData("ck_automation_runs_outcome", "insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, outcome) values (gen_random_uuid(), {queue}, 'it-runner', 'it', 'success')")]
  [InlineData("ck_automation_runs_text", "insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, summary) values (gen_random_uuid(), {queue}, 'it-runner', 'it', repeat('s', 2001))")]
  [InlineData("ck_automation_eval_gates_sha", "insert into automation_eval_gates (reviewer_provider, reviewer_model, prompt_version, passed, metrics, report_sha256, report, created_by_sub) values ('test-provider', 'test-model', 'test-v1', false, '{}', repeat('A', 64), '{}', 'it')")]
  [InlineData("ck_automation_decisions_mode", "insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state) values ({freeDraft}, '{run}', {deck}, 'off', 'qa_pending')")]
  [InlineData("ck_automation_decisions_state", "insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state) values ({freeDraft}, '{run}', {deck}, 'dry_run', 'accepted')")]
  [InlineData("ck_automation_decisions_reason", "insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state, reason) values ({freeDraft}, '{run}', {deck}, 'dry_run', 'human', 'NOT_A_REASON')")]
  [InlineData("ck_automation_decisions_qa_status", "insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state, qa_status) values ({freeDraft}, '{run}', {deck}, 'dry_run', 'qa_queued', 'pending')")]
  [InlineData("ck_automation_decisions_human", "insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state, human_action) values ({freeDraft}, '{run}', {deck}, 'dry_run', 'human', 'approved')")]
  [InlineData("ck_automation_decisions_accepted", "insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state) values ({freeDraft}, '{run}', {deck}, 'live', 'auto_accepted')")]
  [InlineData("ck_automation_decisions_accepted", "insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state, accepted_content_sha256) values ({freeDraft}, '{run}', {deck}, 'live', 'human', repeat('a', 64))")]
  [InlineData("ck_automation_decisions_detail", "insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state, reason_detail) values ({freeDraft}, '{run}', {deck}, 'dry_run', 'human', repeat('d', 301))")]
  [InlineData("ck_automation_draft_findings_severity", "insert into automation_draft_findings (draft_id, qa_job_id, severity, category, message) values ({draft}, gen_random_uuid(), 'critical', 'other', 'm')")]
  [InlineData("ck_automation_draft_findings_category", "insert into automation_draft_findings (draft_id, qa_job_id, severity, category, message) values ({draft}, gen_random_uuid(), 'minor', 'style', 'm')")]
  [InlineData("ck_automation_draft_findings_message", "insert into automation_draft_findings (draft_id, qa_job_id, severity, category, message) values ({draft}, gen_random_uuid(), 'minor', 'other', '')")]
  [InlineData("ck_automation_draft_findings_message", "insert into automation_draft_findings (draft_id, qa_job_id, severity, category, message) values ({draft}, gen_random_uuid(), 'minor', 'other', repeat('m', 1001))")]
  [InlineData("ck_automation_draft_findings_fix", "insert into automation_draft_findings (draft_id, qa_job_id, severity, category, message, suggested_fix) values ({draft}, gen_random_uuid(), 'minor', 'other', 'm', repeat('f', 2001))")]
  [InlineData("ck_automation_publishes_mode", "insert into automation_publishes (deck_id, mode, state) values ({deck}, 'off', 'human')")]
  [InlineData("ck_automation_publishes_state", "insert into automation_publishes (deck_id, mode, state) values ({deck}, 'live', 'done')")]
  [InlineData("ck_automation_publishes_reason", "insert into automation_publishes (deck_id, mode, state, reason) values ({deck}, 'live', 'human', 'NOT_A_REASON')")]
  [InlineData("ck_automation_publishes_detail", "insert into automation_publishes (deck_id, mode, state, reason_detail) values ({deck}, 'live', 'human', repeat('d', 301))")]
  [InlineData("ck_automation_notifications_kind", "insert into automation_notifications (notification_id, kind, subject, body_text, mode) values (gen_random_uuid(), 'digest', 's', 'b', 'live')")]
  [InlineData("ck_automation_notifications_mode", "insert into automation_notifications (notification_id, kind, subject, body_text, mode) values (gen_random_uuid(), 'test', 's', 'b', 'on')")]
  [InlineData("ck_automation_notifications_status", "insert into automation_notifications (notification_id, kind, subject, body_text, mode, status) values (gen_random_uuid(), 'test', 's', 'b', 'live', 'bounced')")]
  [InlineData("ck_automation_notifications_text", "insert into automation_notifications (notification_id, kind, subject, body_text, mode) values (gen_random_uuid(), 'test', '', 'b', 'live')")]
  [InlineData("ck_automation_notifications_text", "insert into automation_notifications (notification_id, kind, subject, body_text, mode, error) values (gen_random_uuid(), 'test', 's', 'b', 'live', repeat('e', 501))")]
  [InlineData("ck_webhook_subscriptions_events", "insert into webhook_subscriptions (name, url, events) values ('it-a01', 'https://example.com/hook', array['deck.deleted'])")]
  public async Task Migration034_Checks_RejectInvalidRows(string constraint, string sql)
  {
    var p = await ChecksDbAsync();
    await using var conn = new NpgsqlConnection(p.ConnectionString);
    await conn.OpenAsync();
    await using var cmd = new NpgsqlCommand(Fill(sql, p), conn);

    var ex = await Assert.ThrowsAsync<PostgresException>(() => cmd.ExecuteNonQueryAsync());
    Assert.Equal("23514", ex.SqlState);
    Assert.Equal(constraint, ex.ConstraintName);
  }

  [Fact]
  public async Task DecisionEvents_AreAppendOnly()
  {
    var p = await ChecksDbAsync();
    await using var conn = new NpgsqlConnection(p.ConnectionString);
    await conn.OpenAsync();
    var id = await InsertIdAsync(conn,
      $"insert into automation_decision_events (draft_id, from_state, to_state, actor, mode) values ({p.DraftId}, null, 'qa_pending', 'automation', 'dry_run') returning id");

    foreach (var sql in new[]
    {
      $"update automation_decision_events set to_state = 'human' where id = {id}",
      $"delete from automation_decision_events where id = {id}",
      "truncate automation_decision_events",
    })
    {
      await using var cmd = new NpgsqlCommand(sql, conn);
      var ex = await Assert.ThrowsAsync<PostgresException>(() => cmd.ExecuteNonQueryAsync());
      Assert.Contains("append-only", ex.MessageText, StringComparison.Ordinal);
    }

    Assert.Equal("qa_pending", (string)(await DbUtil.ExecuteScalarAsync(conn, null, $"select to_state from automation_decision_events where id = {id}", []))!);
  }

  [Fact]
  public async Task WebhookEventsCheck_AcceptsTheEightNames_RejectsDeckDeleted()
  {
    await using var conn = await Scratch034Async("a01_034_webhooks");
    const string insert = "insert into webhook_subscriptions (name, url, events) values ('it-a01', 'https://example.com/hook', $1)";

    await DbUtil.ExecuteAsync(conn, null, insert, [EightEvents]);
    foreach (var name in EightEvents) await DbUtil.ExecuteAsync(conn, null, insert, [new[] { name }]);
    Assert.Equal(9L, await CountAsync(conn, "select count(*) from webhook_subscriptions"));

    foreach (var events in new[]
    {
      new[] { "deck.deleted" },
      new[] { "deck.published", "deck.deleted" },
      Array.Empty<string>(),
      EightEvents.Append("deck.published").ToArray(),
    })
    {
      var ex = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteAsync(conn, null, insert, [events]));
      Assert.Equal("23514", ex.SqlState);
      Assert.Equal("ck_webhook_subscriptions_events", ex.ConstraintName);
    }
  }

  // ---------------------------------------------------------------- seeds

  [Fact]
  public async Task Seed_WithDecks_LinksTheDecks_AwsFeedStaysInactive()
  {
    var decks = new Dictionary<string, long>();
    await using var conn = await Scratch034Async("a01_034_seed_decks", async c =>
    {
      foreach (var slug in new[] { "aws-saa-c03", "claude-ccdv-f" })
      {
        decks[slug] = await InsertIdAsync(c, $"insert into decks (slug, title, author) values ('{slug}', 'deck {slug}', 'tests') returning id");
      }
    });

    var rows = (await DbUtil.QueryAsync(conn, null,
      "select url, kind, feed_format, deck_id, item_title_pattern, active, check_interval_minutes, created_by from source_watch_targets order by id", []));
    Assert.Equal(2, rows.Count);

    var aws = rows.Single(r => (string)r["url"]! == AwsFeedUrl);
    Assert.Equal("feed", (string)aws["kind"]!);
    Assert.Equal("rss", (string)aws["feed_format"]!);
    Assert.Equal(decks["aws-saa-c03"], Convert.ToInt64(aws["deck_id"], CultureInfo.InvariantCulture));
    // R18B automation-5: seeded inactive even with its deck, until its relevance is measured in dry run.
    Assert.False((bool)aws["active"]!);
    Assert.Equal(120, Convert.ToInt32(aws["check_interval_minutes"], CultureInfo.InvariantCulture));
    Assert.Equal("migration:034", (string)aws["created_by"]!);
    var pattern = (string)aws["item_title_pattern"]!;
    Assert.StartsWith("\\m(S3|EC2|", pattern, StringComparison.Ordinal);
    Assert.EndsWith("|Savings Plans|Spot)\\M", pattern, StringComparison.Ordinal);

    // The pattern is a working ARE: word-bounded and case-insensitive under ~*.
    Assert.True((bool)(await DbUtil.ExecuteScalarAsync(conn, null,
      $"select 'Amazon s3 adds a feature' ~* item_title_pattern from source_watch_targets where url = '{AwsFeedUrl}'", []))!);
    Assert.False((bool)(await DbUtil.ExecuteScalarAsync(conn, null,
      $"select 'Amazon S30 preview' ~* item_title_pattern from source_watch_targets where url = '{AwsFeedUrl}'", []))!);

    var notes = rows.Single(r => (string)r["url"]! == ReleaseNotesUrl);
    Assert.Equal("feed", (string)notes["kind"]!);
    Assert.Equal("html-headings", (string)notes["feed_format"]!);
    Assert.Equal(decks["claude-ccdv-f"], Convert.ToInt64(notes["deck_id"], CultureInfo.InvariantCulture));
    Assert.Null(notes["item_title_pattern"]);
    Assert.True((bool)notes["active"]!);
    Assert.Equal(360, Convert.ToInt32(notes["check_interval_minutes"], CultureInfo.InvariantCulture));
    Assert.Equal("migration:034", (string)notes["created_by"]!);
  }

  [Fact]
  public async Task Seed_WithoutDecks_CreatesInactiveFeedTargets()
  {
    // A soft-deleted deck counts as missing.
    await using var conn = await Scratch034Async("a01_034_seed_nodecks", c =>
      DbUtil.ExecuteAsync(c, null, "insert into decks (slug, title, author, is_deleted) values ('aws-saa-c03', 'gone', 'tests', 1)", []));

    var rows = await DbUtil.QueryAsync(conn, null,
      "select url, deck_id, active, check_interval_minutes from source_watch_targets order by id", []);
    Assert.Equal(new[] { AwsFeedUrl, ReleaseNotesUrl }, rows.Select(r => (string)r["url"]!).ToArray());
    Assert.All(rows, r => Assert.Null(r["deck_id"]));
    Assert.All(rows, r => Assert.False((bool)r["active"]!));
    Assert.Equal(new[] { 120, 360 }, rows.Select(r => Convert.ToInt32(r["check_interval_minutes"], CultureInfo.InvariantCulture)).ToArray());
  }

  [Fact]
  public async Task Baselines_SeedsTheThreeAutomationBaselines()
  {
    await using var conn = await Scratch034Async("a01_034_baselines");

    var rows = (await DbUtil.QueryAsync(conn, null,
      "select automation, unit, baseline_minutes_per_unit, baseline_source, note from automation_baselines " +
      "where automation in ('auto_accept', 'auto_publish', 'source_watch') order by automation collate \"C\"", []));
    Assert.Equal(new[] { "auto_accept", "auto_publish", "source_watch" }, rows.Select(r => (string)r["automation"]!).ToArray());
    Assert.All(rows, r => Assert.Equal("default", (string)r["baseline_source"]!));
    Assert.All(rows, r => Assert.False(string.IsNullOrWhiteSpace((string?)r["note"])));

    var minutes = rows.ToDictionary(r => (string)r["automation"]!, r => (decimal)r["baseline_minutes_per_unit"]!);
    Assert.Equal(3.00m, minutes["auto_accept"]);
    Assert.Equal(5.00m, minutes["auto_publish"]);
    Assert.Equal(0.50m, minutes["source_watch"]);

    var units = rows.ToDictionary(r => (string)r["automation"]!, r => (string)r["unit"]!);
    Assert.Equal("auto-accepted card", units["auto_accept"]);
    Assert.Equal("auto-published build", units["auto_publish"]);
    Assert.Equal("detected change", units["source_watch"]);

    // Every baseline name is a ledger automation, so the ledger routes accept the new three.
    var all = (await DbUtil.QueryAsync(conn, null, "select automation from automation_baselines", []))
      .Select(r => (string)r["automation"]!).OrderBy(a => a, StringComparer.Ordinal);
    Assert.Equal(AutomationLedger.Automations.OrderBy(a => a, StringComparer.Ordinal), all);
  }
}
