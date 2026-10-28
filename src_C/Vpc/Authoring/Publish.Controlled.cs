using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static partial class Publish
{
  private static async Task<APIGatewayProxyResponse> StartControlledAsync(NpgsqlConnection conn,long deckId,JsonElement body,AuthContext auth,string? note,Res res)
  {
    if(auth.IsAgentClient)return Helpers.ErrorEnvelope(res,403,"AGENT_CLIENT_FORBIDDEN","Use the normal authorized Console session");
    var release=ContentRelease.Required(body,"releaseId");var action=ContentRelease.Required(body,"actionId");
    var receipt=ContentRelease.Required(body,"receiptId");var expected=ContentRelease.Required(body,"expectedEditingSnapshot");
    if(!body.TryGetProperty("expectedLive",out var liveEl)||liveEl.ValueKind is not(JsonValueKind.String or JsonValueKind.Null))return res.BadRequest("EXPECTED_LIVE_REQUIRED","expectedLive must be the current live build or null");
    var expectedLive=liveEl.ValueKind==JsonValueKind.Null?null:liveEl.GetString();
    var hash=ContentRelease.PayloadHash(body);
    APIGatewayProxyResponse result;
    await using(var tx=await conn.BeginTransactionAsync())
    {
      await ContentRelease.Lock(conn,tx,deckId);
      var replay=await ContentRelease.Replay(conn,tx,deckId,release,action,hash);
      if(replay is not null)result=replay;
      else
      {
        var job=Guid.NewGuid().ToString();var build=MakeBuildId();
        var decks=await DbUtil.QueryAsync(conn,tx,"select slug,tier,deck_type,live_build_id from decks where id=$1 and is_deleted=0",[deckId]);
        if(decks.Count==0)return res.BadRequest("DECK_NOT_FOUND","Deck not found");
        var d=decks[0];var slug=(string)d["slug"]!;
        if((d["live_build_id"] as string)!=expectedLive)return Helpers.ErrorEnvelope(res,409,"LIVE_BUILD_CONFLICT","Live build changed");
        if(expected!=await ContentRelease.EditingSnapshot(conn,tx,deckId))return Helpers.ErrorEnvelope(res,409,"EDITING_SNAPSHOT_CONFLICT","Editing content changed");
        var receipts=await DbUtil.QueryAsync(conn,tx,"select publish_snapshot from content_review_receipts r where id=$1 and deck_id=$2 and release_id=$3 and editing_snapshot=$4 and expires_at>clock_timestamp() and not exists(select 1 from content_review_revocations where receipt_id=r.id)",[receipt,deckId,release,expected]);
        if(receipts.Count!=1)return Helpers.ErrorEnvelope(res,409,"CODEX_REVIEW_REQUIRED","A current unrevoked Codex receipt is required");
        var snapshot=(string)receipts[0]["publish_snapshot"]!;
        // Replacing an attempt revokes its generation, including workers already uploading.
        await DbUtil.ExecuteAsync(conn,tx,"update decks set release_generation=release_generation+1 where id=$1",[deckId]);
        await DbUtil.ExecuteAsync(conn,tx,"update deck_publishes set status='FAILED',error_message='RELEASE_SUPERSEDED',updated_at=now() where deck_id=$1 and status in('PENDING','PROCESSING')",[deckId]);
        var tier=InferTier(Convert.ToInt64(d["deck_type"]),d["tier"]);
        if(string.IsNullOrWhiteSpace(tier=="premium"?PremiumBucket:TestEnqueueSeam?.ContentBucket??ContentBucket))return Helpers.ConfigError(res,"Missing content bucket");
        var key=$"{(tier=="premium"?PremiumPrefix:ContentPrefix)}/decks/{slug}/builds/{build}/deck.json";
        await DbUtil.ExecuteAsync(conn,tx,"""
          insert into deck_publishes(job_id,build_id,s3_key,deck_id,deck_slug,status,published_by_admin_sub,note,qa_snapshot_sha256,
            release_generation,release_receipt_id,release_editing_snapshot,release_expected_live,card_ids)
          select $1,$2,$3,id,slug,'PENDING',$5,$6,$7,release_generation,$8,$9,$10,
            (select array_agg(c.id order by c.id) from cards c where c.deck_id=$4 and c.is_deleted=0) from decks where id=$4
          """,[job,build,key,deckId,auth.UserSub,note,snapshot,receipt,expected,expectedLive]);
        result=res.Ok(new{outcome="committed",jobId=job,buildId=build,releaseId=release,snapshotSha256=snapshot,manifestVerified=false});
        await ContentRelease.Save(conn,tx,deckId,release,action,"publish",hash,result);
      }
      await tx.CommitAsync();
    }
    using var committed=JsonDocument.Parse(result.Body);
    var data=committed.RootElement.GetProperty("data");var jobId=data.GetProperty("jobId").GetString()!;
    APIGatewayProxyResponse Outcome(string outcome)=>res.Ok(new{outcome,jobId,buildId=data.GetProperty("buildId").GetString(),releaseId=release,snapshotSha256=data.GetProperty("snapshotSha256").GetString(),manifestVerified=false});
    var status=(string?)await DbUtil.ExecuteScalarAsync(conn,null,"select status from deck_publishes where deck_id=$1 and job_id=$2",[deckId,jobId]);
    if(status is null)return Helpers.ErrorEnvelope(res,409,"RELEASE_JOB_NOT_FOUND","Committed publish job is missing; query the release action");
    if(status!="PENDING")return Outcome(status.ToLowerInvariant());
    // Retrying a committed PENDING job may duplicate SQS delivery; worker acquisition/generation fences make that safe.
    try
    {
      var message=new SendMessageRequest{QueueUrl=TestEnqueueSeam?.QueueUrl??PublishJobQueueUrl,MessageBody=JsonSerializer.Serialize(new{jobId,deckId,adminSub=auth.UserSub,note})};
      if(TestEnqueueSeam is not null)await TestEnqueueSeam.Send(message);else await SQS().SendMessageAsync(message);
    }
    catch(Exception ex)
    {
      Log.Event("warn",new{tag="controlled-publish",jobId,reason="send_response_uncertain",error=ex.Message});
      return res.ServiceUnavailable("PUBLISH_DISPATCH_UNCONFIRMED","Publish job committed; delivery is unconfirmed. Query the release action, then retry the identical publish action to deliver the same job.",1);
    }
    return Outcome("queued");
  }
}
