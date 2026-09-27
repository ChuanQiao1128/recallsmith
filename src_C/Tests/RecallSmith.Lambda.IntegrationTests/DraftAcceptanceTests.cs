using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The accept transaction extracted into <see cref="DraftAcceptance"/> (R18A A03, contract A00 §5.5) against the shared
/// Postgres: the human accept route answers exactly as before the extraction, the automation actor is recorded, the
/// four contract codes carry the route's messages, and a draft's QA hash (A00 §9.2 step 1) equals the hash of the card
/// row the accept writes, over generated DraftCards.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DraftAcceptanceTests
{
  private readonly PostgresFixture _db;
  public DraftAcceptanceTests(PostgresFixture db) => _db = db;

  // Canonical valid MCQ (PublishMcqGateTests); its stem needs no qualifier and no choose-N.
  private const string ValidMcq =
    """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";

  private static string[] Keys(JsonElement el) => el.EnumerateObject().Select(p => p.Name).ToArray();

  private async Task<long> PlainDraftAsync(long deckId, string sub, Dictionary<string, object?> card) =>
    (await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub, agent: false), deckId, null, card))[0];

  // ---------------------------------------------------------------- the human route

  [Fact]
  public async Task HumanAccept_ResponsesAreUnchanged()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.Off);
    scope.Set(QaGate.EnabledEnv, "0");
    var sub = AutomationTestKit.Sub("human");
    var human = AutomationTestKit.Ctx(sub, agent: false);
    var deck = await AutomationTestKit.NewDeckAsync(_db, "human");

    // 200 accepted: exactly draftId, cardId, stableUid, action.
    var uid = AutomationTestKit.Uid("h-ok");
    var draftId = await PlainDraftAsync(deck.Id, sub, AutomationTestKit.Card(uid));
    var ok = AutomationTestKit.Data(await AutomationTestKit.AcceptAsync(draftId, human, new { reviewMs = 1500 }));
    Assert.Equal(["draftId", "cardId", "stableUid", "action"], Keys(ok));
    Assert.Equal(draftId, ok.GetProperty("draftId").GetInt64());
    Assert.Equal(uid, ok.GetProperty("stableUid").GetString());
    Assert.Equal("accepted", ok.GetProperty("action").GetString());
    var cardId = ok.GetProperty("cardId").GetInt64();
    var draft = (await _db.QueryAsync("select status, decided_by_sub, accepted_card_id from ai_drafts where id = $1", draftId)).Single();
    Assert.Equal(("accepted", sub, cardId), ((string)draft["status"]!, (string)draft["decided_by_sub"]!, AutomationTestKit.Long(draft["accepted_card_id"])));
    var ev = (await _db.QueryAsync("select action, actor_sub, review_ms, before_card from ai_review_events where draft_id = $1 order by id desc limit 1", draftId)).Single();
    Assert.Equal(("accepted", sub, 1500), ((string)ev["action"]!, (string)ev["actor_sub"]!, Convert.ToInt32(ev["review_ms"], CultureInfo.InvariantCulture)));
    Assert.Null(ev["before_card"]);
    Assert.Equal(1, await AutomationTestKit.CountAsync(_db, "select count(*) from automation_events where dedupe_key = $1", $"draft-accept:{draftId}"));

    // 200 edited_accepted with runQa while AI QA is off: the qa block is unchanged too.
    var editUid = AutomationTestKit.Uid("h-edit");
    var editId = await PlainDraftAsync(deck.Id, sub, AutomationTestKit.Card(editUid));
    var edited = AutomationTestKit.Card(editUid, "An edited synthetic question about lighthouses?", grounded: false);
    var editedData = AutomationTestKit.Data(await AutomationTestKit.AcceptAsync(editId, human, new { card = edited, runQa = true }));
    Assert.Equal(["draftId", "cardId", "stableUid", "action", "qa"], Keys(editedData));
    Assert.Equal("edited_accepted", editedData.GetProperty("action").GetString());
    Assert.Equal(["status", "runId", "code", "message"], Keys(editedData.GetProperty("qa")));
    Assert.Equal("disabled", editedData.GetProperty("qa").GetProperty("status").GetString());
    Assert.Equal("AI_QA_DISABLED", editedData.GetProperty("qa").GetProperty("code").GetString());
    var editEvent = (await _db.QueryAsync("select before_card, after_card from ai_review_events where draft_id = $1 and action = 'edited_accepted'", editId)).Single();
    Assert.NotNull(editEvent["before_card"]);
    Assert.NotNull(editEvent["after_card"]);

    // Dropping only the grounding is not an edit.
    var groundUid = AutomationTestKit.Uid("h-ground");
    var groundId = await PlainDraftAsync(deck.Id, sub, AutomationTestKit.Card(groundUid));
    var sameContent = AutomationTestKit.Data(await AutomationTestKit.AcceptAsync(groundId, human, new { card = AutomationTestKit.Card(groundUid, grounded: false) }));
    Assert.Equal("accepted", sameContent.GetProperty("action").GetString());

    // 404 DRAFT_NOT_FOUND, 409 DRAFT_NOT_PENDING.
    var max = AutomationTestKit.Long(await _db.ScalarAsync("select coalesce(max(id), 0) from ai_drafts"));
    AutomationTestKit.AssertError(await AutomationTestKit.AcceptAsync(max + 1000, human), 404, "DRAFT_NOT_FOUND", "Draft not found");
    AutomationTestKit.AssertError(await AutomationTestKit.AcceptAsync(draftId, human), 409, "DRAFT_NOT_PENDING", $"Draft {draftId} has already been decided");

    // 409 STABLE_UID_TAKEN against a live and against a deleted card.
    var liveUid = AutomationTestKit.Uid("h-live");
    var liveCard = await AutomationTestKit.NewCardAsync(_db, deck.Id, liveUid, "A synthetic live card about harbours");
    var liveDraft = await PlainDraftAsync(deck.Id, sub, AutomationTestKit.Card(liveUid));
    AutomationTestKit.AssertError(await AutomationTestKit.AcceptAsync(liveDraft, human), 409, "STABLE_UID_TAKEN",
      $"stableUid {liveUid} is already used by card {liveCard} in this deck");
    var deletedUid = AutomationTestKit.Uid("h-del");
    var deletedCard = await AutomationTestKit.NewCardAsync(_db, deck.Id, deletedUid, "A synthetic deleted card about canals", isDeleted: 1);
    var deletedDraft = await PlainDraftAsync(deck.Id, sub, AutomationTestKit.Card(deletedUid));
    AutomationTestKit.AssertError(await AutomationTestKit.AcceptAsync(deletedDraft, human), 409, "STABLE_UID_TAKEN",
      $"stableUid {deletedUid} is already used by card {deletedCard} in this deck (deleted)");
    Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", deletedDraft));

    // 404 DECK_NOT_FOUND once the deck is deleted after the submit.
    var gone = await AutomationTestKit.NewDeckAsync(_db, "human-gone");
    var goneDraft = await PlainDraftAsync(gone.Id, sub, AutomationTestKit.Card(AutomationTestKit.Uid("h-gone")));
    await _db.QueryAsync("update decks set is_deleted = 1 where id = $1", gone.Id);
    AutomationTestKit.AssertError(await AutomationTestKit.AcceptAsync(goneDraft, human), 404, "DECK_NOT_FOUND", "Deck not found");
    Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", goneDraft));
  }

  [Fact]
  public async Task AutomationAccept_RecordsAutomationActor()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.Off);
    var sub = AutomationTestKit.Sub("actor");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "actor");
    var uid = AutomationTestKit.Uid("actor");
    var draftId = await PlainDraftAsync(deck.Id, sub, AutomationTestKit.Card(uid));

    DraftAcceptance.Accepted accepted;
    await using (var conn = await _db.OpenAsync())
    await using (var tx = await conn.BeginTransactionAsync())
    {
      accepted = await DraftAcceptance.AcceptInTransactionAsync(conn, tx, draftId, deck.Id, DraftAcceptance.AutomationActor, null, null);
      await tx.CommitAsync();
    }

    Assert.Equal("automation", DraftAcceptance.AutomationActor);
    Assert.Equal(uid, accepted.StableUid);
    Assert.Equal("accepted", accepted.Action);
    var draft = (await _db.QueryAsync("select status, decided_by_sub, accepted_card_id from ai_drafts where id = $1", draftId)).Single();
    Assert.Equal(("accepted", "automation", accepted.CardId), ((string)draft["status"]!, (string)draft["decided_by_sub"]!, AutomationTestKit.Long(draft["accepted_card_id"])));
    var ev = (await _db.QueryAsync("select action, actor_sub, review_ms from ai_review_events where draft_id = $1 order by id desc limit 1", draftId)).Single();
    Assert.Equal(("accepted", "automation"), ((string)ev["action"]!, (string)ev["actor_sub"]!));
    Assert.Null(ev["review_ms"]);
    var card = (await _db.QueryAsync("select stable_uid, revision, source::text as source, order_in_deck from cards where id = $1", accepted.CardId)).Single();
    Assert.Equal(1, Convert.ToInt32(card["revision"], CultureInfo.InvariantCulture));
    Assert.DoesNotContain("grounding", (string)card["source"]!);
    Assert.Equal(10, Convert.ToInt32(card["order_in_deck"], CultureInfo.InvariantCulture));
  }

  [Theory]
  [InlineData("DRAFT_NOT_FOUND")]
  [InlineData("DRAFT_NOT_PENDING")]
  [InlineData("DECK_NOT_FOUND")]
  [InlineData("STABLE_UID_TAKEN")]
  public async Task AcceptInTransaction_ThrowsContractCodes(string code)
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.Off);
    var sub = AutomationTestKit.Sub("codes");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "codes");
    var uid = AutomationTestKit.Uid("codes");
    var draftId = await PlainDraftAsync(deck.Id, sub, AutomationTestKit.Card(uid));
    string expectedMessage;
    switch (code)
    {
      case "DRAFT_NOT_FOUND":
        draftId = AutomationTestKit.Long(await _db.ScalarAsync("select coalesce(max(id), 0) + 1000 from ai_drafts"));
        expectedMessage = "Draft not found";
        break;
      case "DRAFT_NOT_PENDING":
        AutomationTestKit.Data(await AutomationTestKit.RejectAsync(draftId, AutomationTestKit.Ctx(sub, agent: false)));
        expectedMessage = $"Draft {draftId} has already been decided";
        break;
      case "DECK_NOT_FOUND":
        await _db.QueryAsync("update decks set is_deleted = 1 where id = $1", deck.Id);
        expectedMessage = "Deck not found";
        break;
      default:
        var taken = await AutomationTestKit.NewCardAsync(_db, deck.Id, uid, "A synthetic existing card about bridges");
        expectedMessage = $"stableUid {uid} is already used by card {taken} in this deck";
        break;
    }

    await using var conn = await _db.OpenAsync();
    await using var tx = await conn.BeginTransactionAsync();
    var ex = await Assert.ThrowsAsync<DraftAcceptance.DraftAcceptanceException>(() =>
      DraftAcceptance.AcceptInTransactionAsync(conn, tx, draftId, deck.Id, DraftAcceptance.AutomationActor, null, null));
    Assert.Equal(code, ex.Code);
    Assert.Equal(expectedMessage, ex.Message);
    // The transaction is still usable: a refusal is not a database error.
    Assert.Equal(1, Convert.ToInt32(await DbUtil.ExecuteScalarAsync(conn, tx, "select 1", []), CultureInfo.InvariantCulture));
    await tx.RollbackAsync();
  }

  // ---------------------------------------------------------------- draft hash = accepted card hash (A00 §9.2 step 1)

  /// <summary>
  /// 64 generated DraftCards: MCQ and plain, topic null/set, code snippets with leading/trailing whitespace and
  /// newlines, unicode in every text field, grounding present/absent, every difficulty the card kind allows.
  /// </summary>
  public static IEnumerable<object[]> GeneratedCards()
  {
    string?[] topics = [null, "Synthetic topic", "  Tópico ✓ 日本語  ", "4.1 Cost-optimized storage"];
    string?[] snippets = [null, "  let x = 1;\n  ", "\tfn main() {}\n", "print('ü')", "\n\n  SELECT 1;  \n"];
    string?[] languages = [null, "python", " bash ", "SQL"];
    string?[] usages = [null, "  Synthetic usage with trailing space  ", "Utilisation synthétique — ok", "用例"];
    string[] questions = ["Which service buffers a burst", "  Which synthetic queue holds messages? ", "Quelle file d'attente garde les messages ?",
      "どのサービスがバーストを緩衝しますか", "Which emoji queue 🚀 buffers writes"];
    string[] explanations = ["Synthetic explanation.", "  Padded synthetic explanation.  ", "Erklärung mit Umlauten: äöü.", "説明 🚀 with emoji"];
    string[] quotes = ["Synthetic quote.", "  A quote with “curly” quotes  ", "Zitat — synthetisch", "引用テキスト"];

    for (var i = 0; i < 64; i++)
    {
      var mcq = i % 2 == 0;
      var source = new Dictionary<string, object?>
      {
        ["url"] = $"https://docs.aws.amazon.com/synthetic/{i}/guide.html",
        ["quote"] = quotes[i % quotes.Length],
      };
      if (i % 3 != 0) source["grounding"] = new { chunkId = $"chunk-{i}", sourceId = "source-a03", matched = true, quoteChars = 10 + i };
      var card = new Dictionary<string, object?>
      {
        ["stableUid"] = $"hash-{i}",
        ["difficulty"] = mcq ? 1 + i % 3 : i % 5,
        ["topic"] = topics[i % topics.Length],
        ["question"] = questions[i % questions.Length] + (i % 7 == 0 ? string.Empty : $" {i}"),
        ["explanation"] = explanations[i % explanations.Length],
        ["codeSnippet"] = snippets[i % snippets.Length],
        ["codeLanguage"] = languages[(i / 2) % languages.Length],
        ["realWorldUsage"] = usages[(i / 3) % usages.Length],
        ["mcq"] = mcq ? JsonSerializer.Deserialize<JsonElement>(ValidMcq) : null,
        ["source"] = source,
      };
      yield return [JsonSerializer.Serialize(card)];
    }
  }

  [Theory]
  [MemberData(nameof(GeneratedCards))]
  public async Task DraftHash_EqualsAcceptedCardHash(string cardJson)
  {
    DraftCard card;
    using (var doc = JsonDocument.Parse(cardJson)) card = DraftCard.Parse(doc.RootElement);

    // Everything in one transaction that is rolled back: the case leaves nothing behind.
    await using var conn = await _db.OpenAsync();
    await using var tx = await conn.BeginTransactionAsync();
    var deckId = AutomationTestKit.Long(await DbUtil.ExecuteScalarAsync(conn, tx,
      "insert into decks (slug, title, author) values ($1, 'deck a03 hash', 'tests') returning id", [$"it-a03-hash-{Guid.NewGuid():N}"]));
    var draftId = AutomationTestKit.Long(await DbUtil.ExecuteScalarAsync(conn, tx,
      """
      insert into ai_drafts (deck_id, batch_id, client_draft_key, stable_uid, card, "similar", agent, submitted_by_sub)
      values ($1, $2, $3, $4, $5::jsonb, '[]'::jsonb, null, 'it-a03-hash')
      returning id
      """,
      [deckId, Guid.NewGuid(), Guid.NewGuid().ToString("N"), card.StableUid, card.ToJson()]));

    var draftHash = await DraftDecisions.DraftContentHashAsync(conn, tx, card);
    var accepted = await DraftAcceptance.AcceptInTransactionAsync(conn, tx, draftId, deckId, DraftAcceptance.AutomationActor, null, null);
    var row = (await DbUtil.QueryAsync(conn, tx, $"select {CardContentHash.CardColumnsSql} from cards c where c.id = $1", [accepted.CardId])).Single();

    Assert.Equal(CardContentHash.Compute(row), draftHash);
    await tx.RollbackAsync();
  }
}
