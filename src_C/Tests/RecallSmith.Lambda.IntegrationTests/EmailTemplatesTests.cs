using System.Text.RegularExpressions;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The pure email renderer (R18A A04, contract A00 §12.2, §12.4, §12.5): the subject prefix and dry-run marker, the
/// dry-run first line, the footer on every email, the eleven exception subjects, golden texts of the batch summary,
/// the weekly digest and the source-changed email, and the line/body limits. No database; synthetic data only.
/// </summary>
public class EmailTemplatesTests
{
  private const string Console = "https://console.developercards.app";
  private const string FooterSentence = "Sent by developercards-notifier to the owner alert address; replies are not read.";

  internal static BatchSummaryData Batch() => new(
    Guid.Parse("3f2a9c1e-0000-4000-8000-000000000001"), 12, "aws-saa-c03", "feed_item", "https://aws.amazon.com/about-aws/whats-new/2026/09/synthetic-item/",
    "Synthetic launch",
    [
      new BatchDraft("aws-s3-synthetic-01", "Which storage class suits synthetic archives?", "would_accept", null, null, 12),
      new BatchDraft("aws-s3-synthetic-02", "Which synthetic queue buffers bursts?", "would_accept", null, null, 12),
      new BatchDraft("aws-s3-synthetic-03", "Which synthetic flag is ambiguous?", "human", "QA_FLAGGED", null, 12),
    ],
    0.0012m, [new BatchPublish(12, "aws-saa-c03", "would_publish", null, null, null, null)], "owner-mac", 184000, "done");

  /// <summary><see cref="Batch"/> with every draft decided (R18E N6): a dry-run summary then states its counts.</summary>
  internal static BatchSummaryData DecidedBatch() => Batch() with { Drafts = [.. Batch().Drafts.Select(d => d with { Decided = true })] };

  internal static WeeklyDigestData Digest() => new(new DateOnly(2026, 9, 21), new DateOnly(2026, 9, 27), 3.5m, 210m, 14, 42, 2,
    [new DigestAutomation("auto_accept", 6, 6, 0, 18m), new DigestAutomation("source_watch", 8, 36, 1, 18m)],
    new Dictionary<string, long> { ["would_accept"] = 6, ["human"] = 2 }, new Dictionary<string, long> { ["QA_FLAGGED"] = 2 },
    6, 4, 3, 1, 0, new Dictionary<string, long> { ["would_publish"] = 2 }, 36, 2, 1, 9, 0,
    [new DigestRunner("owner-mac", new DateTimeOffset(2026, 9, 27, 22, 5, 0, TimeSpan.Zero), new DateTimeOffset(2026, 10, 20, 0, 0, 0, TimeSpan.Zero))],
    1.25m, 0.40m, 2, 0, ShadowBlindDecided: 3, ShadowBlindAccepted: 2, Live: new DigestLive(25, 1, 1, 0.08m));

  internal static SourceChangedData Source() => new(77, 5, "https://docs.aws.amazon.com/AmazonS3/latest/userguide/synthetic-page.html", "changed", "done",
    [new SourceDeck(12, "aws-saa-c03", [Guid.Parse("aaaaaaaa-0000-4000-8000-000000000002")], 3, [new SourceFlaggedCard(901, "aws-s3-synthetic-07", "major")])],
    [902], [31]);

  /// <summary>The subkind, its facts and the expected subject after prefix and marker (A00 §12.4).</summary>
  public static IEnumerable<object[]> ExceptionCases()
  {
    yield return ["runner_stalled", new Dictionary<string, string> { ["runnerId"] = "owner-mac", ["since"] = "2026-09-26T08:00:00.000Z", ["loginExpiresAt"] = "2026-10-20T00:00:00.000Z", ["lastRunId"] = "none", ["lastRunAt"] = "never", ["queued"] = "4" },
      "Action needed: authoring runner owner-mac silent since 2026-09-26T08:00:00.000Z"];
    yield return ["runner_login_expiring", new Dictionary<string, string> { ["runnerId"] = "owner-mac", ["days"] = "3", ["loginExpiresAt"] = "2026-10-01T00:00:00.000Z" },
      "Action needed: runner login expires in 3 day(s)"];
    yield return ["runner_run_failed", new Dictionary<string, string> { ["runId"] = "3f2a9c1e-0000-4000-8000-000000000001", ["itemId"] = "7", ["url"] = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/a-very-long-synthetic-page-name-that-goes-on-and-on.html?x=1", ["error"] = "exit 1" },
      "Action needed: authoring run failed for docs.aws.amazon.com/AmazonS3/latest/userguide/a-very-long-synthetic-page-name-…"];
    yield return ["queue_item_failed", new Dictionary<string, string> { ["itemId"] = "7", ["url"] = "https://docs.example.com/x", ["lastError"] = "exit 1" },
      "Action needed: queue item 7 failed 3 times"];
    yield return ["qa_provider_error", new Dictionary<string, string> { ["code"] = "PROVIDER_ACCESS_DENIED", ["draftId"] = "41", ["runId"] = "3f2a9c1e-0000-4000-8000-000000000001" },
      "Action needed: AI QA reviewer error PROVIDER_ACCESS_DENIED"];
    yield return ["ai_qa_daily_cap", new Dictionary<string, string> { ["waiting"] = "5" }, "AI QA daily cap reached; 5 draft(s) waiting"];
    yield return ["publish_blocked", new Dictionary<string, string> { ["publishId"] = "9", ["deckId"] = "12", ["deckSlug"] = "aws-saa-c03", ["reason"] = "DECK_HAS_HUMAN_CHANGES", ["reasonDetail"] = "deck settings changed", ["runId"] = "3f2a9c1e-0000-4000-8000-000000000001" },
      "Action needed: publish aws-saa-c03 (DECK_HAS_HUMAN_CHANGES)"];
    yield return ["publish_failed", new Dictionary<string, string> { ["jobId"] = "job-1", ["deckId"] = "12", ["deckSlug"] = "aws-saa-c03", ["error"] = "AI_QA_STALE" },
      "Action needed: auto-publish of aws-saa-c03 failed"];
    yield return ["eval_gate_missing", new Dictionary<string, string>(), "AUTOMATION_MODE=live is blocked: no passed eval gate"];
    yield return ["watch_failing", new Dictionary<string, string> { ["targetId"] = "5", ["eventId"] = "77", ["url"] = "https://docs.example.com/feed", ["errorCode"] = "HTTP_500" },
      "Source watch failing: https://docs.example.com/feed"];
    yield return ["source_gone", new Dictionary<string, string> { ["targetId"] = "5", ["eventId"] = "78", ["url"] = "https://docs.example.com/gone", ["citingCards"] = "2" },
      "Cited source gone: https://docs.example.com/gone"];
    yield return ["runner_unavailable", new Dictionary<string, string> { ["runnerId"] = "owner-mac", ["runId"] = "3f2a9c1e-0000-4000-8000-000000000001", ["itemId"] = "7", ["error"] = "RUNNER_UNAVAILABLE: claude reported a usage limit" },
      "Action needed: authoring runner owner-mac cannot run"];
    yield return ["live_override_high", new Dictionary<string, string> { ["autoAccepted30d"] = "40", ["deletedByPerson"] = "2", ["editedByPerson"] = "1", ["overrideRate"] = "0.0750" },
      "Action needed: people overrode 0.0750 of auto-accepted cards"];
    yield return ["queue_item_failed", new Dictionary<string, string> { ["itemId"] = "8", ["url"] = "https://docs.example.com/login", ["lastError"] = "AGENT_BLOCKED: the page needs a login" },
      "Action needed: agent blocked on queue item 8"];
    yield return ["agent_note", new Dictionary<string, string> { ["runId"] = "3f2a9c1e-0000-4000-8000-000000000001", ["itemId"] = "7", ["url"] = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/synthetic-page.html", ["notes"] = "Card aws-s3-synthetic-07 looks outdated." },
      "Action needed: agent note on docs.aws.amazon.com/AmazonS3/latest/userguide/synthetic-page.html"];
  }

  [Fact]
  public void BatchSummary_AgentNotes_AreOneCappedDetailsLine()
  {
    // R18B K3 (automation-3): the agent's notes reach the owner in the batch summary's DETAILS.
    Assert.DoesNotContain("Agent notes:", EmailTemplates.BatchSummary("live", Batch(), Console).BodyText);
    Assert.DoesNotContain("Agent notes:", EmailTemplates.BatchSummary("live", Batch() with { AgentNotes = " \n " }, Console).BodyText);

    var body = EmailTemplates.BatchSummary("live", Batch() with { AgentNotes = "Card aws-s3-synthetic-07:\n\tthe limit\r\nchanged." }, Console).BodyText;
    var lines = body.Split('\n');
    Assert.Contains("Agent notes: Card aws-s3-synthetic-07: the limit changed.", lines);
    Assert.True(Array.IndexOf(lines, "DETAILS") < Array.IndexOf(lines, "Agent notes: Card aws-s3-synthetic-07: the limit changed."));

    var longNotes = new string('n', 2000);
    var capped = EmailTemplates.BatchSummary("live", Batch() with { AgentNotes = longNotes }, Console).BodyText.Split('\n')
      .Single(l => l.StartsWith("Agent notes: ", StringComparison.Ordinal));
    Assert.Equal("Agent notes: ".Length + EmailTemplates.MaxAgentNotesLength, capped.Length);
    Assert.EndsWith("…", capped);
  }

  [Fact]
  public void Subject_DryRun_CarriesTheMarker()
  {
    Assert.Equal("[DeveloperCards] (dry run) Test email", EmailTemplates.Subject("dry_run", "Test email"));
    Assert.Equal("[DeveloperCards] (dry run) Test email", EmailTemplates.Test("dry_run", Console).Subject);
    Assert.StartsWith("[DeveloperCards] (dry run) Batch 3f2a9c1e", EmailTemplates.BatchSummary("dry_run", Batch(), Console).Subject);
    Assert.Equal("Test email", EmailTemplates.Test("dry_run", Console).Summary);
  }

  [Fact]
  public void Body_DryRun_StartsWithTheDryRunLine()
  {
    const string line = "DRY RUN — AUTOMATION_MODE=dry_run: nothing was accepted or published. \"Auto-accepted\" below reads \"would be accepted\".";
    Assert.Equal(line, EmailTemplates.DryRunLine);
    foreach (var email in AllEmails("dry_run"))
    {
      Assert.StartsWith(line + "\n", email.BodyText);
    }
  }

  [Fact]
  public void Body_Live_HasNoMarker()
  {
    foreach (var mode in new[] { "live", "off" })
    {
      foreach (var email in AllEmails(mode))
      {
        Assert.StartsWith("[DeveloperCards] ", email.Subject);
        Assert.DoesNotContain("(dry run)", email.Subject);
        Assert.DoesNotContain("DRY RUN", email.BodyText);
      }
    }
  }

  [Fact]
  public void Footer_IsOnEveryEmail()
  {
    Assert.Equal($"Console: {Console}/automation\nMode: live. {FooterSentence}", EmailTemplates.Footer("live", $"{Console}/automation"));
    foreach (var mode in new[] { "off", "dry_run", "live" })
    {
      foreach (var email in AllEmails(mode))
      {
        var lines = email.BodyText.TrimEnd('\n').Split('\n');
        Assert.StartsWith($"Console: {Console}/automation", lines[^2]);
        Assert.Equal($"Mode: {mode}. {FooterSentence}", lines[^1]);
        Assert.Contains("NEEDS YOU", lines);
        Assert.Contains("DONE AUTOMATICALLY", lines);
        Assert.Contains("DETAILS", lines);
        Assert.DoesNotMatch(new Regex("@(?!example\\.com)"), email.BodyText + email.Subject);
      }
    }
    Assert.EndsWith("?runId=3f2a9c1e-0000-4000-8000-000000000001", EmailTemplates.BatchSummary("live", Batch(), Console).BodyText.TrimEnd('\n').Split('\n')[^2]);
  }

  [Theory]
  [MemberData(nameof(ExceptionCases))]
  public void Exception_Subjects_MatchTheContract(string subkind, Dictionary<string, string> facts, string subject)
  {
    Assert.Contains(subkind, EmailTemplates.ExceptionSubkinds);
    var live = EmailTemplates.Exception("live", subkind, facts, Console);
    Assert.Equal("[DeveloperCards] " + subject, live.Subject);
    Assert.Equal(subject, live.Summary);
    var dry = EmailTemplates.Exception("dry_run", subkind, facts, Console);
    Assert.Equal("[DeveloperCards] (dry run) " + subject, dry.Subject);
    foreach (var value in facts.Values) Assert.Contains(value, live.BodyText);
    if (subkind == "runner_login_expiring") Assert.Contains("node tools/mcp-server/dist/index.js login", live.BodyText);
    if (facts.ContainsKey("runId")) Assert.Contains($"Console: {Console}/automation?runId={facts["runId"]}", live.BodyText);
  }

  [Fact]
  public void BatchSummary_DryRun_ListsNoDraftOfTheRun()
  {
    // R18C automation-4 hid the would_accept drafts; R18D (automation-4 again) hides every draft of a dry run: listing
    // the human-routed ones by uid gave the would_accept ones away by elimination. Every draft waits for a person anyway.
    var dry = EmailTemplates.BatchSummary("dry_run", Batch(), Console).BodyText;
    foreach (var hidden in new[]
    {
      "aws-s3-synthetic-01", "aws-s3-synthetic-02", "aws-s3-synthetic-03", "Which storage class suits synthetic archives?",
      "Which synthetic queue buffers bursts?", "Which synthetic flag is ambiguous?",
    })
    {
      Assert.DoesNotContain(hidden, dry);
    }
    Assert.Contains("- 3 draft(s) of this run wait for your decision in the review queue", dry);
    // R18E N6: nor are the per-state counts shown while a draft is undecided (updated from the R18D assertion that
    // pinned them: on a one-draft or single-verdict run they state each verdict).
    Assert.DoesNotContain("Drafts by state", dry);

    // Live lists what it accepted and what needs a person, as before.
    var live = Batch() with
    {
      Drafts =
      [
        new BatchDraft("aws-s3-synthetic-01", "Which storage class suits synthetic archives?", "auto_accepted", null, null, 12),
        new BatchDraft("aws-s3-synthetic-03", "Which synthetic flag is ambiguous?", "human", "QA_FLAGGED", null, 12),
      ],
    };
    var liveBody = EmailTemplates.BatchSummary("live", live, Console).BodyText;
    Assert.Contains("- aws-s3-synthetic-01 — Which storage class suits synthetic archives?", liveBody);
    Assert.Contains("- aws-s3-synthetic-03 — AI QA found a blocker or major issue (QA_FLAGGED)", liveBody);
    Assert.DoesNotContain("hidden", liveBody);
  }

  [Fact]
  public void BatchSummary_GoldenText()
  {
    // R18E N6 (automation-4): a dry run with an undecided draft is state-free (updated from the R18D golden text, which
    // gave the per-state counts and the publish outcome in the subject, summary and DETAILS).
    var email = EmailTemplates.BatchSummary("dry_run", Batch(), Console);
    Assert.Equal("[DeveloperCards] (dry run) Batch 3f2a9c1e aws-saa-c03: 3 draft(s) wait for you", email.Subject);
    Assert.Equal("""
DRY RUN — AUTOMATION_MODE=dry_run: nothing was accepted or published. "Auto-accepted" below reads "would be accepted".
Run 3f2a9c1e on aws-saa-c03 submitted 3 draft(s); 3 wait for your decision, and their verdicts and the publish outcome stay hidden until you decide.

NEEDS YOU
- 3 draft(s) of this run wait for your decision in the review queue; verdicts stay hidden until you decide (the shadow agreement counts blind decisions only) — https://console.developercards.app/review?deckId=12

DONE AUTOMATICALLY
- nothing

DETAILS
Source: feed_item https://aws.amazon.com/about-aws/whats-new/2026/09/synthetic-item/ (Synthetic launch)
Draft QA spend: $0.0012
Publish: hidden until every draft of this run is decided
Runner: owner-mac, duration 184 s, outcome done

Console: https://console.developercards.app/automation?runId=3f2a9c1e-0000-4000-8000-000000000001
Mode: dry_run. Sent by developercards-notifier to the owner alert address; replies are not read.
""" + "\n", email.BodyText);

    var live = Batch() with
    {
      Drafts = [new BatchDraft("aws-s3-synthetic-01", "Q?", "auto_accepted", null, null, 12)],
      Publishes = [new BatchPublish(12, "aws-saa-c03", "human", "DECK_HAS_HUMAN_CHANGES", "deck settings changed", null, null)],
    };
    Assert.Equal("[DeveloperCards] Batch 3f2a9c1e aws-saa-c03: 1 auto-accepted, 0 need you, publish needs you",
      EmailTemplates.BatchSummary("live", live, Console).Subject);
    // R18E N6: a dry run states counts and the publish outcome only once every draft is decided.
    Assert.Equal("[DeveloperCards] (dry run) Batch 3f2a9c1e aws-saa-c03: 0 auto-accepted, 0 need you, publish would need you",
      EmailTemplates.BatchSummary("dry_run", live with { Drafts = [.. live.Drafts.Select(d => d with { Decided = true })] }, Console).Subject);
  }

  [Fact]
  public void BatchSummary_DryRun_NoVerdictLeaksWhileADraftIsUndecided()
  {
    // N6: neither the subject nor the body of a dry run with an undecided draft names a verdict, a state count, a
    // reason or the publish outcome, for a one-draft run and for a single-verdict run alike.
    var one = Batch() with { Drafts = [new BatchDraft("aws-s3-synthetic-01", "Q?", "would_accept", null, null, 12)] };
    var allHuman = Batch() with
    {
      Drafts = [new BatchDraft("a-1", "Q1?", "human", "QA_FLAGGED", null, 12), new BatchDraft("a-2", "Q2?", "human", "QA_FLAGGED", null, 12)],
      Publishes = [],
    };
    var partly = Batch() with
    {
      Drafts = [.. Batch().Drafts.Select((d, i) => d with { Decided = i > 0 })],
    };
    foreach (var data in new[] { Batch(), one, allHuman, partly })
    {
      var email = EmailTemplates.BatchSummary("dry_run", data, Console);
      foreach (var text in new[] { email.Subject, email.BodyText })
      {
        foreach (var leak in new[] { "would_accept", "auto-accepted", "need you", "would publish", "would_publish", "QA_FLAGGED", "human 1", "human 2" })
        {
          Assert.DoesNotContain(leak, text);
        }
      }
    }
    Assert.Equal("[DeveloperCards] (dry run) Batch 3f2a9c1e aws-saa-c03: 1 draft(s) wait for you", EmailTemplates.BatchSummary("dry_run", one, Console).Subject);
    Assert.Equal("[DeveloperCards] (dry run) Batch 3f2a9c1e aws-saa-c03: 1 draft(s) wait for you",
      EmailTemplates.BatchSummary("dry_run", partly, Console).Subject);
  }

  [Fact]
  public void BatchSummary_DryRun_AllDecided_ShowsTheCounts()
  {
    // N6: once every draft of the run is decided the verdicts are no longer blind, and the counts come back.
    var decided = Batch() with { Drafts = [.. Batch().Drafts.Select(d => d with { Decided = true })] };
    var email = EmailTemplates.BatchSummary("dry_run", decided, Console);
    Assert.Equal("[DeveloperCards] (dry run) Batch 3f2a9c1e aws-saa-c03: 2 auto-accepted, 1 need you, would publish", email.Subject);
    Assert.Contains("\nDrafts by state: human 1, would_accept 2\n", email.BodyText);
    Assert.Contains("\nRouted to you by reason: QA_FLAGGED 1\n", email.BodyText);
    Assert.Contains("\nPublish aws-saa-c03: would_publish\n", email.BodyText);
    Assert.Contains("\nNEEDS YOU\n- nothing\n", email.BodyText);
  }

  [Fact]
  public void WeeklyDigest_DryRun_CountsOnlyTheWaitingDrafts()
  {
    // N6: in dry_run the digest names how many drafts wait, not how many of them a person was routed.
    var data = Digest() with { BlindPendingDrafts = 5, BlindPendingRuns = 2 };
    var body = EmailTemplates.WeeklyDigest("dry_run", data, Console).BodyText;
    Assert.Contains("- 5 draft(s) wait for your decision — https://console.developercards.app/review\n", body);
    Assert.DoesNotContain("routed to you", body);
    Assert.Contains("Not counted above: 2 run(s) with a draft still waiting for your decision (shown once all are decided)", body);
    Assert.Contains("- 2 draft(s) routed to you are still pending", EmailTemplates.WeeklyDigest("live", data, Console).BodyText);
  }

  [Fact]
  public void WeeklyDigest_GoldenText()
  {
    var email = EmailTemplates.WeeklyDigest("live", Digest(), Console);
    Assert.Equal("[DeveloperCards] Weekly automation digest 2026-09-21–2026-09-27: 3.5 h saved", email.Subject);
    Assert.Equal("""
From 2026-09-21 to 2026-09-27 the automations saved 3.5 h over 42 unit(s) of work.

NEEDS YOU
- 2 draft(s) routed to you are still pending — https://console.developercards.app/review
- people overrode 0.0800 of 25 auto-accepted card(s) in 30 days — https://console.developercards.app/automation?tab=decisions

DONE AUTOMATICALLY
- 0 card(s) auto-accepted, 6 would be accepted
- 0 build(s) auto-published, 2 would be published
- 36 source check(s), 2 change(s) found

DETAILS
Ledger 2026-09-21–2026-09-27: 14 run(s), 42 unit(s), 210 min saved, 2 defect(s) caught
Ledger auto_accept: 6 run(s), 6 unit(s), 0 failure(s), 18 min saved
Ledger source_watch: 8 run(s), 36 unit(s), 1 failure(s), 18 min saved
Decisions by state: human 2, would_accept 6
Decisions by reason: QA_FLAGGED 2
Dry-run agreement: 6 would-accept, 4 decided by a human (3 accepted, 1 edited, 0 rejected); decided blind 3, accepted unedited 2, agreement 0.6667
Live quality (30 days): 25 auto-accepted, 1 deleted by a person, 1 edited by a person, override rate 0.0800; 0 updated after a source change (not counted)
Publishes by state: would_publish 2
Source watch: 36 check(s), 2 change(s), 1 failure(s)
Emails: 9 sent, 0 failed
Runner owner-mac: last heartbeat 2026-09-27T22:05Z, login expires 2026-10-20T00:00Z
AI QA spend: $1.2500 human runs, $0.4000 automation

Console: https://console.developercards.app/automation
Mode: live. Sent by developercards-notifier to the owner alert address; replies are not read.
""" + "\n", email.BodyText);
  }

  [Fact]
  public void SourceChanged_GoldenText()
  {
    var email = EmailTemplates.SourceChanged("dry_run", Source(), Console);
    Assert.Equal("[DeveloperCards] (dry run) Source changed: docs.aws.amazon.com/AmazonS3/latest/userguide/synthetic-page.html — 3 card(s) re-checked, 1 flagged", email.Subject);
    Assert.Equal("""
DRY RUN — AUTOMATION_MODE=dry_run: nothing was accepted or published. "Auto-accepted" below reads "would be accepted".
The cited source https://docs.aws.amazon.com/AmazonS3/latest/userguide/synthetic-page.html changed; 3 card(s) were re-checked and 1 flagged.

NEEDS YOU
- aws-s3-synthetic-07 — open major finding — https://console.developercards.app/decks/qa?deckId=12&runId=aaaaaaaa-0000-4000-8000-000000000002
- card 902 — its quote is no longer on the page — https://console.developercards.app/automation?tab=watch&targetId=5

DONE AUTOMATICALLY
- re-check run aaaaaaaa-0000-4000-8000-000000000002 of aws-saa-c03 (3 card(s)) — https://console.developercards.app/decks/qa?deckId=12&runId=aaaaaaaa-0000-4000-8000-000000000002
- queue item 31 added for the authoring runner

DETAILS
Source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/synthetic-page.html
Change: changed, event 77, re-check done
Deck aws-saa-c03: 3 card(s) re-checked, 1 flagged — https://console.developercards.app/decks/qa?deckId=12&runId=aaaaaaaa-0000-4000-8000-000000000002
Cards whose quote vanished: 902
Queue items: 31

Console: https://console.developercards.app/automation?tab=watch&targetId=5
Mode: dry_run. Sent by developercards-notifier to the owner alert address; replies are not read.
""" + "\n", email.BodyText);
  }

  [Fact]
  public void Lines_AreAtMost998Characters_AndBodyAtMost100000()
  {
    var longText = new string('x', 5000);
    var drafts = Enumerable.Range(0, 3000)
      .Select(i => new BatchDraft($"uid-{i}-{longText}", longText, i % 2 == 0 ? "auto_accepted" : "human", "QA_FLAGGED", longText, 12)).ToList();
    var huge = Batch() with { Drafts = drafts, SourceTitle = longText, SourceUrl = "https://docs.example.com/" + longText };
    var emails = new List<RenderedEmail>
    {
      EmailTemplates.BatchSummary("live", huge, Console),
      EmailTemplates.BatchSummary("dry_run", huge, Console),
      EmailTemplates.Exception("live", "runner_run_failed", new Dictionary<string, string> { ["url"] = "https://docs.example.com/" + longText, ["error"] = longText + "\nsecond line" }, Console),
      EmailTemplates.Exception("live", "watch_failing", new Dictionary<string, string> { ["url"] = "https://docs.example.com/" + longText }, Console),
    };
    foreach (var email in emails)
    {
      Assert.True(email.BodyText.Length <= EmailTemplates.MaxBodyLength, $"body is {email.BodyText.Length} characters");
      Assert.All(email.BodyText.Split('\n'), line => Assert.True(line.Length <= EmailTemplates.MaxLineLength, $"line is {line.Length} characters"));
      Assert.True(email.Subject.Length <= 200);
      Assert.True(email.Summary.Length <= 300);
      Assert.DoesNotContain('\r', email.BodyText);
      Assert.EndsWith(FooterSentence + "\n", email.BodyText);
    }
    Assert.Matches(new Regex(@"^… and \d+ more$", RegexOptions.Multiline), emails[0].BodyText);
  }

  private static IEnumerable<RenderedEmail> AllEmails(string mode)
  {
    foreach (var c in ExceptionCases()) yield return EmailTemplates.Exception(mode, (string)c[0], (Dictionary<string, string>)c[1], Console);
    yield return EmailTemplates.BatchSummary(mode, Batch(), Console);
    yield return EmailTemplates.WeeklyDigest(mode, Digest(), Console);
    yield return EmailTemplates.SourceChanged(mode, Source(), Console);
    yield return EmailTemplates.Test(mode, Console);
  }
}
