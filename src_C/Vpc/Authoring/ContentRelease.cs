using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>Deterministic server gate. Evidence is the authorized author's assertion, not a proof of semantic correctness.</summary>
public static partial class ContentRelease
{
  public const string DeckSlug = "aws-saa-fundamentals", Policy = "aws-codex-bilingual-v1";
  public const string PolicyDefinition = "aws-codex-bilingual-v1|full-deck|en-US,zh-CN|model:PASS|blockers:0|unknowns:0|humanPerCardReview:false|ttl:24h";
  public const string ReviewSchema = "codex-release-review-v1";
  public static string PolicyHash => Hash(PolicyDefinition);
  public static string ReviewSchemaHash => Hash(ReviewSchema);
  public static async Task<bool> Applies(NpgsqlConnection conn, long deckId, NpgsqlTransaction? tx = null) =>
    await DbUtil.ExecuteScalarAsync(conn, tx, "select slug = $2 from decks where id=$1", [deckId, DeckSlug]) is true;
  public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
  public static string Required(JsonElement b, string key, int max = 160)
  {
    if (!b.TryGetProperty(key, out var e) || e.ValueKind!=JsonValueKind.String || string.IsNullOrWhiteSpace(e.GetString()) || e.GetString()!.Length>max)
      throw new ValidationError($"{key} must be a nonempty string, maximum {max} characters", key);
    return e.GetString()!;
  }
  private static string HashField(JsonElement b,string key)
  {
    var value=Required(b,key,64);
    if(value.Length!=64 || value.Any(c=>!char.IsAsciiHexDigit(c)) || value!=value.ToLowerInvariant()) throw new ValidationError($"{key} must be lowercase SHA-256",key);
    return value;
  }
  public static async Task<string> EditingSnapshot(NpgsqlConnection c,NpgsqlTransaction? tx,long id) =>
    (string)(await DbUtil.ExecuteScalarAsync(c,tx,"select content_editing_snapshot($1)",[id]))!;
  public static async Task Lock(NpgsqlConnection c,NpgsqlTransaction tx,long id)
  {
    await DbUtil.QueryAsync(c,tx,"select id from decks where id=$1 for update",[id]);
    await DbUtil.QueryAsync(c,tx,"select id from cards where deck_id=$1 order by id for update",[id]);
  }
  public static string PayloadHash(JsonElement b)=>Hash(PublishSnapshot.CanonicalJson(b.GetRawText()));
  public static async Task<APIGatewayProxyResponse?> Replay(NpgsqlConnection c,NpgsqlTransaction tx,long deckId,string releaseId,string actionId,string hash)
  {
    var rows=await DbUtil.QueryAsync(c,tx,"select payload_hash,result from content_release_actions where deck_id=$1 and release_id=$2 and action_id=$3",[deckId,releaseId,actionId]);
    if(rows.Count==0)return null;
    if((string)rows[0]["payload_hash"]! != hash)throw new ValidationError("IDEMPOTENCY_CONFLICT: action key was already used for a different payload","actionId");
    return JsonSerializer.Deserialize<APIGatewayProxyResponse>((string)rows[0]["result"]!)!;
  }
  public static Task Save(NpgsqlConnection c,NpgsqlTransaction tx,long deckId,string releaseId,string actionId,string kind,string hash,APIGatewayProxyResponse result)=>
    DbUtil.ExecuteAsync(c,tx,"insert into content_release_actions(deck_id,release_id,action_id,kind,payload_hash,result) values($1,$2,$3,$4,$5,$6::jsonb)",[deckId,releaseId,actionId,kind,hash,JsonSerializer.Serialize(result)]);

  public static async Task<APIGatewayProxyResponse> Handle(LambdaRequest req,Res res,AuthContext auth)
  {
    var deny=Auth.RequireAdmin(auth,res); if(deny is not null)return deny;
    if(auth.IsAgentClient)return Helpers.ErrorEnvelope(res,403,"AGENT_CLIENT_FORBIDDEN","Use the normal authorized Console session");
    try
    {
      if((req.RawBody?.Length??0)>768_000)return res.PayloadTooLarge();
      using var doc=req.Method=="POST"?Validation.ParseJsonBody(req):null;
      var b=doc?.RootElement??default;
      long id=req.Method=="GET"?Validation.RequireInteger(req.Query.GetValueOrDefault("deckId")??"","deckId"):Helpers.RequireInteger(b.GetProperty("deckId"),"deckId");
      await using var conn=await Pg.OpenConnectionOrNullAsync(); if(conn is null)return Helpers.ConfigError(res,"Missing PG configuration");
      deny=await Helpers.RequireDeckWrite(conn,auth.UserSub,id,auth.IsSuperAdmin,res); if(deny is not null)return deny;
      if(!await Applies(conn,id))return res.BadRequest("RELEASE_POLICY_SCOPE","This policy is restricted to aws-saa-fundamentals");
      await using var tx=await conn.BeginTransactionAsync();
      await Lock(conn,tx,id);
      if(req.Method=="GET" && req.Path.EndsWith("/snapshot",StringComparison.OrdinalIgnoreCase))
      {
        var cards=await DbUtil.QueryAsync(conn,tx,$"select {CardContentHash.CardColumnsSql},c.version,c.revision,c.translation_basis as \"translationBasis\",to_jsonb(c) as backup from cards c where deck_id=$1 and is_deleted=0 order by order_in_deck,id",[id]);
        var export=await DbUtil.QueryAsync(conn,tx,Publish.CardsSql,[id]);
        var backup=await DbUtil.QueryAsync(conn,tx,"select to_jsonb(c) as row from cards c where deck_id=$1 order by order_in_deck,id",[id]);
        var deck=(string)(await DbUtil.ExecuteScalarAsync(conn,tx,"select to_jsonb(d) from decks d where id=$1",[id]))!;
        return res.Ok(new{deckId=id,policy=Policy,policyHash=PolicyHash,reviewSchema=ReviewSchema,schemaHash=ReviewSchemaHash,editingSnapshot=await EditingSnapshot(conn,tx,id),publishSnapshot=PublishSnapshot.Digest(export.Select(PublishSnapshot.FromRow)),deck=JsonSerializer.Deserialize<JsonElement>(deck),backup=backup.Select(r=>JsonSerializer.Deserialize<JsonElement>((string)r["row"]!)),cards=cards.Select(r=>new{stableUid=r["stableUid"],orderInDeck=r["orderInDeck"],version=r["version"],revision=r["revision"],cardContentHash=CardContentHash.Compute(r),schema=CardContentHash.Schema(r)})});
      }
      if(req.Method=="GET" && req.Path.EndsWith("/actions",StringComparison.OrdinalIgnoreCase))
      {
        var rows=await DbUtil.QueryAsync(conn,tx,"select kind,result,created_at from content_release_actions where deck_id=$1 and release_id=$2 and action_id=$3",[id,req.Query.GetValueOrDefault("releaseId"),req.Query.GetValueOrDefault("actionId")]);
        if(rows.Count==0)return Helpers.ErrorEnvelope(res,404,"ACTION_NOT_FOUND","Action has not committed");
        var jobs=await DbUtil.QueryAsync(conn,tx,"select job_id,status,build_id,content_sha256,release_generation,error_message from deck_publishes where deck_id=$1 and release_receipt_id in(select id from content_review_receipts where deck_id=$1 and release_id=$2) order by created_at desc",[id,req.Query.GetValueOrDefault("releaseId")]);
        var receipts=await DbUtil.QueryAsync(conn,tx,"select r.id,r.policy,r.editing_snapshot,r.publish_snapshot,r.expires_at,(x.receipt_id is not null) as revoked,x.reason as revocation_reason from content_review_receipts r left join content_review_revocations x on x.receipt_id=r.id where r.deck_id=$1 and r.release_id=$2 order by r.created_at",[id,req.Query.GetValueOrDefault("releaseId")]);
        return res.Ok(new{receipts,action=JsonSerializer.Deserialize<APIGatewayProxyResponse>((string)rows[0]["result"]!),jobs,liveBuildId=await DbUtil.ExecuteScalarAsync(conn,tx,"select live_build_id from decks where id=$1",[id]),manifestVerified=false});
      }
      if(req.Method!="POST" || doc is null)return res.MethodNotAllowed("Method not allowed");
      var releaseId=Required(b,"releaseId"); var actionId=Required(b,"actionId"); var hash=PayloadHash(b);
      var replay=await Replay(conn,tx,id,releaseId,actionId,hash);if(replay is not null)return replay;
      APIGatewayProxyResponse result;
      if(req.Path.EndsWith("/review/revoke",StringComparison.OrdinalIgnoreCase))
      {
        var receipt=Required(b,"receiptId"); var reason=Required(b,"reason",1000);
        var n=await DbUtil.ExecuteAsync(conn,tx,"insert into content_review_revocations(receipt_id,reason,actor_sub) select id,$4,$5 from content_review_receipts where id=$1 and deck_id=$2 and release_id=$3 on conflict do nothing",[receipt,id,releaseId,reason,auth.UserSub]);
        if(n==0 && await DbUtil.ExecuteScalarAsync(conn,tx,"select 1 from content_review_receipts where id=$1 and deck_id=$2 and release_id=$3",[receipt,id,releaseId]) is null)return res.BadRequest("RECEIPT_NOT_FOUND","Receipt does not belong to release/deck");
        await DbUtil.ExecuteAsync(conn,tx,"update decks d set release_generation=release_generation+1 where id=$1 and exists(select 1 from deck_publishes p where p.deck_id=d.id and p.release_receipt_id=$2 and p.release_generation=d.release_generation and p.status in('PENDING','PROCESSING'))",[id,receipt]);
        await DbUtil.ExecuteAsync(conn,tx,"update deck_publishes set status='FAILED',error_message='REVIEW_REVOKED',updated_at=now() where deck_id=$1 and release_receipt_id=$2 and status in('PENDING','PROCESSING')",[id,receipt]);
        result=res.Ok(new{receiptId=receipt,revoked=true,editingDatabaseRestored=false});
      }
      else if(req.Path.EndsWith("/review",StringComparison.OrdinalIgnoreCase))
      {
        var expected=HashField(b,"expectedEditingSnapshot");
        if(expected!=await EditingSnapshot(conn,tx,id))return Helpers.ErrorEnvelope(res,409,"EDITING_SNAPSHOT_CONFLICT","Editing content changed");
        if(Required(b,"policy")!=Policy)return res.BadRequest("REVIEW_POLICY_MISMATCH","Unknown review policy");
        if((b.TryGetProperty("humanPerCardReview",out var human)&&human.ValueKind!=JsonValueKind.False) || (b.TryGetProperty("reviewedBy",out var reviewer)&&reviewer.GetString()!="codex"))return res.BadRequest("REVIEW_PROVENANCE","Review provenance must be Codex with humanPerCardReview=false");
        Required(b,"runId");Required(b,"batchAuthorizationRef",2000);Required(b,"authorizationScope",500);
        if(Required(b,"authorizationScope")!="aws-saa-fundamentals:full-deck-bilingual-release")return res.BadRequest("AUTHORIZATION_SCOPE","Batch authorization must cover this entire bilingual release");
        Required(b,"model",200);Required(b,"evidenceRef",2000);Required(b,"reportRef",2000);
        foreach(var key in new[]{"evidenceHash","reportHash","policyHash","promptHash","schemaHash","corpusHash"})HashField(b,key);
        if (Required(b,"policyHash") != PolicyHash || Required(b,"schemaHash") != ReviewSchemaHash || Required(b,"reviewSchema") != ReviewSchema)
          return res.BadRequest("REVIEW_POLICY_MISMATCH","Policy and review schema hashes must match the server policy");
        foreach(var key in new[]{"evidenceVersion","reportVersion","promptVersion","corpusVersion"})Required(b,key,200);
        var sha=Required(b,"mainSHA",40);if(sha.Length!=40||sha.Any(c=>!char.IsAsciiHexDigit(c)))throw new ValidationError("mainSHA must be a commit SHA","mainSHA");
        if(!b.TryGetProperty("expiresAt",out var expiresEl)||!expiresEl.TryGetDateTimeOffset(out var expires)||expires<=DateTimeOffset.UtcNow||expires>DateTimeOffset.UtcNow.AddHours(24))throw new ValidationError("expiresAt must be within the next 24 hours","expiresAt");
        if(await DbUtil.ExecuteScalarAsync(conn,tx,"""
          select exists(select 1 from source_watch_targets t
            left join lateral(select kind from source_watch_events where target_id=t.id order by id desc limit 1) e on true
            where (t.deck_id=$1 or exists(select 1 from cards c where c.deck_id=$1 and c.is_deleted=0 and
              (c.source->>'url'=t.url or position(t.url in coalesce(c.front_help::text,''))>0)))
            and (t.last_status in('gone','failed','unsupported','robots_disallowed') or e.kind in('gone','failing','unsupported')))
          """,[id]) is true)return res.BadRequest("REVIEW_SOURCE_INVALID","A cited or deck source is currently unavailable; resolve it before registering new evidence");
        var export=await DbUtil.QueryAsync(conn,tx,Publish.CardsSql,[id]);
        if(export.Count==0||Publish.FirstMcqGateFailure(export)is not null||Publish.FirstTranslationGateFailure(export,["zh-CN"],"en-US")is not null)return res.BadRequest("REVIEW_CONTENT_INVALID","Every card must have valid complete current English and zh-CN content");
        if(!b.TryGetProperty("cards",out var items)||items.ValueKind!=JsonValueKind.Array||items.GetArrayLength()!=export.Count)return res.BadRequest("REVIEW_COVERAGE","Review must cover every current live card exactly once");
        var cards=await DbUtil.QueryAsync(conn,tx,$"select {CardContentHash.CardColumnsSql},c.revision from cards c where deck_id=$1 and is_deleted=0 order by order_in_deck,id",[id]);
        var byUid=cards.ToDictionary(r=>(string)r["stableUid"]!);var seen=new HashSet<string>();
        foreach(var item in items.EnumerateArray())
        {
          var uid=Required(item,"stableUid");
          if(!seen.Add(uid)||!byUid.TryGetValue(uid,out var row)||Required(item,"verdict")!="PASS"||Required(item,"cardContentHash")!=CardContentHash.Compute(row)||Required(item,"schema")!=CardContentHash.Schema(row)||Helpers.RequireInteger(item.GetProperty("revision"),"revision")!=Convert.ToInt64(row["revision"])||Helpers.RequireInteger(item.GetProperty("orderInDeck"),"orderInDeck")!=Convert.ToInt64(row["orderInDeck"])||!item.TryGetProperty("blockers",out var blockers)||blockers.ValueKind!=JsonValueKind.Array||blockers.GetArrayLength()!=0||!item.TryGetProperty("unknowns",out var unknowns)||unknowns.ValueKind!=JsonValueKind.Array||unknowns.GetArrayLength()!=0)return res.BadRequest("REVIEW_CARD_MISMATCH","Every current UID/hash/schema/revision/order needs model PASS with empty blockers and unknowns");
        }
        var receipt=Guid.NewGuid().ToString("D"); var publish=PublishSnapshot.Digest(export.Select(PublishSnapshot.FromRow));
        await DbUtil.ExecuteAsync(conn,tx,"insert into content_review_receipts(id,deck_id,release_id,action_id,payload_hash,editing_snapshot,publish_snapshot,policy,evidence,submitted_by,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)",[receipt,id,releaseId,actionId,hash,expected,publish,Policy,b.GetRawText(),auth.UserSub,expires]);
        result=res.Ok(new{receiptId=receipt,releaseId,editingSnapshot=expected,publishSnapshot=publish,reviewedBy="codex",humanPerCardReview=false,expiresAt=expires});
      }
      else return Helpers.ErrorEnvelope(res,404,"NOT_FOUND","Unknown release endpoint");
      await Save(conn,tx,id,releaseId,actionId,req.Path,hash,result);await tx.CommitAsync();return result;
    }
    catch(ValidationError e){return Helpers.ErrorEnvelope(res,e.Message.StartsWith("IDEMPOTENCY_CONFLICT")?409:400,"RELEASE_VALIDATION",e.Message);}
    catch(Exception e) when(e is KeyNotFoundException or InvalidOperationException or FormatException){return res.BadRequest("RELEASE_VALIDATION",e.Message);}
    catch(PostgresException e) when(e.SqlState=="P0001"){return Helpers.ErrorEnvelope(res,409,"RELEASE_CONFLICT",e.MessageText);}
  }
}
