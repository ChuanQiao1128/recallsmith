using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static partial class ContentRelease
{
  public static async Task<APIGatewayProxyResponse> Rollback(NpgsqlConnection conn,long id,JsonElement body,AuthContext auth,Res res,DeckRollback.ManifestRebuildFn rebuild)
  {
    if(auth.IsAgentClient)return Helpers.ErrorEnvelope(res,403,"AGENT_CLIENT_FORBIDDEN","Use the normal Console session");
    try
    {
      var release=Required(body,"releaseId");var action=Required(body,"actionId");var target=Required(body,"buildId");
      var expected=Required(body,"expectedCurrent");var targetHash=HashField(body,"expectedRestoreHash");var hash=PayloadHash(body);
      APIGatewayProxyResponse result;
      await using(var tx=await conn.BeginTransactionAsync())
      {
        await Lock(conn,tx,id);
        var replay=await Replay(conn,tx,id,release,action,hash);if(replay is not null)return replay;
        var current=await DbUtil.ExecuteScalarAsync(conn,tx,"select live_build_id from decks where id=$1",[id]) as string;
        var restore=await DbUtil.ExecuteScalarAsync(conn,tx,"select 1 from deck_publishes where deck_id=$1 and build_id=$2 and status='SUCCESS' and content_sha256=$3",[id,target,targetHash]);
        if(restore is null)return res.BadRequest("RESTORE_BUILD_INVALID","Restore target must be a same-deck SUCCESS build with the saved content hash");
        if(current!=target && current!=expected)return Helpers.ErrorEnvelope(res,409,"LIVE_BUILD_CONFLICT","Another build is live; rollback cannot overwrite it");
        var failed=await DbUtil.ExecuteScalarAsync(conn,tx,"select p.release_generation from deck_publishes p join content_review_receipts r on r.id=p.release_receipt_id where p.deck_id=$1 and p.build_id=$2 and r.release_id=$3",[id,expected,release]);
        if(failed is null)return res.BadRequest("FAILED_BUILD_SCOPE","expectedCurrent must name this release's attempted build");
        var currentGeneration = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn,tx,"select release_generation from decks where id=$1",[id]));
        var failedGeneration = Convert.ToInt64(failed);
        if(current!=target && await DbUtil.ExecuteScalarAsync(conn,tx,"select exists(select 1 from deck_publishes where deck_id=$1 and release_generation>$2 and status in('PENDING','PROCESSING'))",[id,failedGeneration]) is true)
          return Helpers.ErrorEnvelope(res,409,"RELEASE_GENERATION_CONFLICT","A later publish is in progress");
        if(current!=target || currentGeneration==failedGeneration)
        {
          await DbUtil.ExecuteAsync(conn,tx,"select set_config('recallsmith.rollback_deck',$1,true)",[id.ToString(System.Globalization.CultureInfo.InvariantCulture)]);
          await DbUtil.ExecuteAsync(conn,tx,"update decks set release_generation=release_generation+1,live_build_id=$2 where id=$1",[id,target]);
          await DbUtil.ExecuteAsync(conn,tx,"update deck_publishes set status='FAILED',error_message='RELEASE_ROLLED_BACK',updated_at=now() where deck_id=$1 and status in('PENDING','PROCESSING')",[id]);
        }
        result=res.Ok(new{deckId=id,liveBuildId=target,previousBuildId=current,rollbackCommitted=true,alreadyRestored=current==target,editingDatabaseRestored=false,manifestVerified=false});
        await Save(conn,tx,id,release,action,"rollback",hash,result);await tx.CommitAsync();
      }
      await rebuild(conn);return result;
    }
    catch(ValidationError e){return Helpers.ErrorEnvelope(res,e.Message.StartsWith("IDEMPOTENCY_CONFLICT")?409:400,"RELEASE_VALIDATION",e.Message);}
  }
}
