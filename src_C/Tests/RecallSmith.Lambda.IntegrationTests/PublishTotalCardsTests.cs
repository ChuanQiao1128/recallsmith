using System.Globalization;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// A completed publish is the one place decks.total_cards is set from the exported card count, so
/// the manifest's totalCards and deck.json's totalCards agree with the cards that were actually
/// written — no hand-typed console number. CompleteJobAsync with a null count leaves the column
/// alone; ProcessAsync counts the live cards it exports and passes that count through.
/// </summary>
[Collection(PostgresCollection.Name)]
public class PublishTotalCardsTests
{
  private readonly PostgresFixture _db;
  public PublishTotalCardsTests(PostgresFixture db) => _db = db;

  private sealed class CapturingUploader : IS3DeckUploader
  {
    public DeckExportData? Captured;
    public Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data)
    {
      Captured = data;
      return Task.FromResult(new S3UploadResult());
    }
    public Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl) => Task.FromResult(new S3UploadResult());
    public Task<string> DownloadJsonAsync(string s3Key) => Task.FromResult("{}");
  }

  private sealed class NoopArtifacts : IContentArtifactsGenerator
  {
    public Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload) => Task.CompletedTask;
  }

  private async Task<long> SeedDeckAsync(string slug, int totalCards)
  {
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author, total_cards) values ($1,$2,$3,$4) returning id",
      slug, "deck f02", "tests", totalCards);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private Task SeedJobAsync(long deckId, string slug, string buildId, string jobId, string status) =>
    _db.ScalarAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,$6)",
      deckId, slug, buildId, $"content/{buildId}/deck.json", jobId, status);

  [Fact]
  public async Task CompleteJob_WithCount_SetsTotalCardsAndPointer()
  {
    var slug = $"it-f02-{Guid.NewGuid():N}";
    var deckId = await SeedDeckAsync(slug, 0);
    var build = "b-f02-count";
    var jobId = Guid.NewGuid().ToString();
    await SeedJobAsync(deckId, slug, build, jobId, "PROCESSING");

    await new JobRepository().CompleteJobAsync(jobId, 7);

    var status = await _db.ScalarAsync("select status from deck_publishes where job_id = $1", jobId);
    Assert.Equal("SUCCESS", Convert.ToString(status, CultureInfo.InvariantCulture));

    var pointer = await _db.ScalarAsync("select live_build_id from decks where id = $1", deckId);
    Assert.Equal(build, Convert.ToString(pointer, CultureInfo.InvariantCulture));

    var total = await _db.ScalarAsync("select total_cards from decks where id = $1", deckId);
    Assert.Equal(7, Convert.ToInt32(total, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task CompleteJob_WithoutCount_KeepsTotalCards()
  {
    var slug = $"it-f02-{Guid.NewGuid():N}";
    var deckId = await SeedDeckAsync(slug, 42);
    var build = "b-f02-keep";
    var jobId = Guid.NewGuid().ToString();
    await SeedJobAsync(deckId, slug, build, jobId, "PROCESSING");

    await new JobRepository().CompleteJobAsync(jobId);

    var status = await _db.ScalarAsync("select status from deck_publishes where job_id = $1", jobId);
    Assert.Equal("SUCCESS", Convert.ToString(status, CultureInfo.InvariantCulture));

    var total = await _db.ScalarAsync("select total_cards from decks where id = $1", deckId);
    Assert.Equal(42, Convert.ToInt32(total, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task ProcessAsync_SetsTotalCardsFromExportedCards()
  {
    var slug = $"it-f02-{Guid.NewGuid():N}";
    var deckId = await SeedDeckAsync(slug, 0);
    await _db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted) values ($1,$2,$3,$4,0)",
      deckId, "uid-1", "q1", 5);
    await _db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted) values ($1,$2,$3,$4,0)",
      deckId, "uid-2", "q2", 10);
    await _db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted) values ($1,$2,$3,$4,1)",
      deckId, "uid-3", "q3", 20);

    var build = "b-f02-process";
    var jobId = Guid.NewGuid().ToString();
    await SeedJobAsync(deckId, slug, build, jobId, "PENDING");

    var uploader = new CapturingUploader();
    await new PublishJobProcessor(new JobRepository(), uploader, new NoopArtifacts()).ProcessAsync(jobId, 1);

    Assert.NotNull(uploader.Captured);
    Assert.Equal(2, uploader.Captured!.TotalCards);
    Assert.Equal(2, uploader.Captured.Cards.Count);

    var total = await _db.ScalarAsync("select total_cards from decks where id = $1", deckId);
    Assert.Equal(2, Convert.ToInt32(total, CultureInfo.InvariantCulture));

    var status = await _db.ScalarAsync("select status from deck_publishes where job_id = $1", jobId);
    Assert.Equal("SUCCESS", Convert.ToString(status, CultureInfo.InvariantCulture));

    var pointer = await _db.ScalarAsync("select live_build_id from decks where id = $1", deckId);
    Assert.Equal(build, Convert.ToString(pointer, CultureInfo.InvariantCulture));
  }
}
