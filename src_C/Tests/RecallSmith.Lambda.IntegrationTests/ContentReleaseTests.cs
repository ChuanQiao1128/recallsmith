using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Worker.Repositories;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class ContentReleaseTests(PostgresFixture db)
{
  private static readonly AuthContext Admin=new(new Dictionary<string,JsonElement>(),"release-test","release-test",["super_admin"],true,false,true);
  private static LambdaRequest Request(string method,string path,object? body=null,long? id=null)=>new(JsonSerializer.SerializeToElement(new{
    rawPath=path,requestContext=new{http=new{method},requestId=Guid.NewGuid().ToString()},headers=new{},queryStringParameters=new{deckId=id?.ToString()},body=body is null?null:JsonSerializer.Serialize(body),isBase64Encoded=false}));
  private static JsonElement Data(APIGatewayProxyResponse r)
  {Assert.True(r.StatusCode==200,r.Body);return JsonDocument.Parse(r.Body).RootElement.GetProperty("data").Clone();}
  private async Task<long> Deck()
  {
    // Each test uses a scratch database so the one protected slug never collides with another test.
    var cs=await db.CreateScratchDatabaseAsync("release_"+Guid.NewGuid().ToString("N"));
    await using var c=new NpgsqlConnection(cs);await c.OpenAsync();await PostgresFixture.ApplyMigrationsAsync(c,int.MaxValue);
    var builder=new NpgsqlConnectionStringBuilder(cs);
    Environment.SetEnvironmentVariable("PGDATABASE",builder.Database);Pg.Reset();
    return Convert.ToInt64(await DbUtil.ExecuteScalarAsync(c,null,"insert into decks(slug,title,author,translation_locales) values($1,'AWS','test',array['zh-CN']) returning id",[ContentRelease.DeckSlug]));
  }
  private async Task Restore()=>await Task.Run(()=>{Environment.SetEnvironmentVariable("PGDATABASE",new NpgsqlConnectionStringBuilder(db.ConnectionString).Database);Pg.Reset();});
  private static object Card(string question="English question",string zh="中文问题",string? help=null)=>new{stableUid="aws-1",orderInDeck=1,difficulty=2,question,explanation="English explanation",frontHelp=help is null?(object?)null:new[]{new{term="term",definition=help}},translations=new Dictionary<string,object>{{"zh-CN",new{v=1,question=zh,explanation="中文解释"}}}};
  private static async Task<APIGatewayProxyResponse> Import(long id,string expected,string key="import",object? card=null)=>await CardsImport.HandleCardsImport(Request("POST","/api/v1/authoring/cards/import",new{deckId=id,releaseId="release-test",idempotencyKey=key,expectedEditingSnapshot=expected,cards=new[]{card??Card()}}),new Res("test"),Admin);
  private static async Task<JsonElement> Snapshot(long id)=>Data(await ContentRelease.Handle(Request("GET","/api/v1/authoring/release/snapshot",id:id),new Res("test"),Admin));
  private static object Receipt(long id,JsonElement snap,string key="review",string? verdict=null)=>new{
    deckId=id,releaseId="release-test",actionId=key,expectedEditingSnapshot=snap.GetProperty("editingSnapshot").GetString(),policy=ContentRelease.Policy,policyHash=ContentRelease.PolicyHash,reviewSchema=ContentRelease.ReviewSchema,schemaHash=ContentRelease.ReviewSchemaHash,
    runId="run",batchAuthorizationRef="user request",authorizationScope="aws-saa-fundamentals:full-deck-bilingual-release",model="codex",evidenceRef="evidence.json",reportRef="report.json",evidenceHash=new string('a',64),reportHash=new string('b',64),promptHash=new string('c',64),corpusHash=new string('d',64),mainSHA=new string('e',40),evidenceVersion="1",reportVersion="1",promptVersion="1",corpusVersion="1",expiresAt=DateTimeOffset.UtcNow.AddHours(1),
    cards=snap.GetProperty("cards").EnumerateArray().Select(c=>new{stableUid=c.GetProperty("stableUid").GetString(),cardContentHash=c.GetProperty("cardContentHash").GetString(),schema=c.GetProperty("schema").GetString(),revision=c.GetProperty("revision").GetInt32(),orderInDeck=1,verdict=verdict??"PASS",blockers=Array.Empty<string>(),unknowns=Array.Empty<string>()}).ToArray()};
  private static async Task<string> Review(long id,JsonElement snap)
  {var r=await ContentRelease.Handle(Request("POST","/api/v1/authoring/release/review",Receipt(id,snap)),new Res("test"),Admin);return Data(r).GetProperty("receiptId").GetString()!;}
  private static async Task<JsonElement> Publish(long id,JsonElement snap,string receipt,string action="publish",string? live=null)
  {
    Vpc.Authoring.Publish.TestEnqueueSeam=new("test-queue","test-bucket",_=>Task.CompletedTask);
    return Data(await AuthoringPublish(new{deckId=id,releaseId="release-test",actionId=action,expectedEditingSnapshot=snap.GetProperty("editingSnapshot").GetString(),expectedLive=live,receiptId=receipt}));
  }
  private static Task<APIGatewayProxyResponse> AuthoringPublish(object body)=>Vpc.Authoring.Publish.HandleAuthoringPublish(Request("POST","/api/v1/authoring/publish",body),new Res("test"),Admin);
  private static async Task<NpgsqlConnection> Open(){var c=await Pg.OpenConnectionOrNullAsync();Assert.NotNull(c);return c!;}

  [Fact]
  public async Task Import_Cas_Replay_Revision_And_DeletedUid()
  {
    try{
      var id=await Deck();var s=await Snapshot(id);var expected=s.GetProperty("editingSnapshot").GetString()!;
      var first=await Import(id,expected);Data(first);var replay=await Import(id,expected);Assert.Equal(first.Body,replay.Body);
      Assert.Equal(409,(await Import(id,expected,"other")).StatusCode);
      Assert.Equal(409,(await Import(id,expected,card:Card("Changed"))).StatusCode);
      var current=await Snapshot(id);Data(await Import(id,current.GetProperty("editingSnapshot").GetString()!,"change",Card("Changed")));
      await using var c=await Open();Assert.Equal(2,Convert.ToInt32(await DbUtil.ExecuteScalarAsync(c,null,"select revision from cards where deck_id=$1",[id])));
      var s2=await Snapshot(id);Data(await Import(id,s2.GetProperty("editingSnapshot").GetString()!,"unchanged",Card("Changed")));
      Assert.Equal(2,Convert.ToInt32(await DbUtil.ExecuteScalarAsync(c,null,"select revision from cards where deck_id=$1",[id])));
      await DbUtil.ExecuteAsync(c,null,"update cards set is_deleted=1 where deck_id=$1",[id]);
      var s3=await Snapshot(id);Assert.Equal(409,(await Import(id,s3.GetProperty("editingSnapshot").GetString()!,"revive")).StatusCode);
    }finally{await Restore();}
  }

  [Fact]
  public async Task Receipt_Publish_Gate_ClosedFlags_And_FinalCommitStaleness()
  {
    try{
      var id=await Deck();var initial=await Snapshot(id);Data(await Import(id,initial.GetProperty("editingSnapshot").GetString()!));var s=await Snapshot(id);
      Environment.SetEnvironmentVariable("AI_QA_ENABLED","false");Environment.SetEnvironmentVariable("AI_QA_REQUIRED","false");
      var bad=await ContentRelease.Handle(Request("POST","/api/v1/authoring/release/review",Receipt(id,s,"bad","UNKNOWN")),new Res("test"),Admin);Assert.Equal(400,bad.StatusCode);
      Vpc.Authoring.Publish.TestEnqueueSeam=new("test-queue","test-bucket",_=>Task.CompletedTask);
      await using var c=await Open();var start=await Vpc.Authoring.Publish.StartPublishAsync(c,id,"automation",null,false,null,false);Assert.Equal("CODEX_REVIEW_REQUIRED",start.Code);
      var receipt=await Review(id,s);var job=await Publish(id,s,receipt);var jobId=job.GetProperty("jobId").GetString()!;
      var repo=new JobRepository();Assert.True(await repo.TryAcquireJobAsync(jobId));await ContentReleaseFence.ValidateJob(c,jobId);
      await DbUtil.ExecuteAsync(c,null,"update cards set translations=jsonb_set(translations,'{zh-CN,explanation}','\"变更\"') where deck_id=$1",[id]);
      await Assert.ThrowsAsync<InvalidOperationException>(()=>ContentReleaseFence.ValidateJob(c,jobId));
      await Assert.ThrowsAsync<PostgresException>(()=>repo.CompleteJobAsync(jobId,1));
      Assert.Null(await DbUtil.ExecuteScalarAsync(c,null,"select live_build_id from decks where id=$1",[id]));
    }finally{Vpc.Authoring.Publish.TestEnqueueSeam=null;await Restore();}
  }

  [Fact]
  public async Task Success_Revocation_And_SupersededWorker_Fenced()
  {
    try{
      var id=await Deck();var initial=await Snapshot(id);Data(await Import(id,initial.GetProperty("editingSnapshot").GetString()!));var s=await Snapshot(id);var receipt=await Review(id,s);
      var job=await Publish(id,s,receipt);var repo=new JobRepository();var jid=job.GetProperty("jobId").GetString()!;
      Assert.True(await repo.TryAcquireJobAsync(jid));
      await using(var uploaded=await Open())await DbUtil.ExecuteAsync(uploaded,null,"update deck_publishes set content_sha256=$2,content_bytes=100 where job_id=$1",[jid,new string('a',64)]);
      await repo.CompleteJobAsync(jid,1);
      await using var c=await Open();Assert.Equal(job.GetProperty("buildId").GetString(),await DbUtil.ExecuteScalarAsync(c,null,"select live_build_id from decks where id=$1",[id]));
      var later=await Publish(id,s,receipt,"later",job.GetProperty("buildId").GetString());var lateId=later.GetProperty("jobId").GetString()!;Assert.True(await repo.TryAcquireJobAsync(lateId));
      Data(await ContentRelease.Handle(Request("POST","/api/v1/authoring/release/review/revoke",new{deckId=id,releaseId="release-test",actionId="revoke",receiptId=receipt,reason="source invalid"}),new Res("test"),Admin));
      await Assert.ThrowsAsync<InvalidOperationException>(()=>ContentReleaseFence.ValidateJob(c,lateId));
      await repo.CompleteJobAsync(lateId,1);Assert.Equal(job.GetProperty("buildId").GetString(),await DbUtil.ExecuteScalarAsync(c,null,"select live_build_id from decks where id=$1",[id]));
      var noReceipt=await AuthoringPublish(new{deckId=id,releaseId="release-test",actionId="revoked",expectedEditingSnapshot=s.GetProperty("editingSnapshot").GetString(),expectedLive=job.GetProperty("buildId").GetString(),receiptId=receipt});Assert.Equal(409,noReceipt.StatusCode);
    }finally{Vpc.Authoring.Publish.TestEnqueueSeam=null;await Restore();}
  }

  [Theory]
  [InlineData("english")]
  [InlineData("chinese")]
  [InlineData("help")]
  [InlineData("order")]
  [InlineData("metadata")]
  public async Task Review_Binds_Every_Content_Dimension(string dimension)
  {
    try{
      var id=await Deck();var initial=await Snapshot(id);Data(await Import(id,initial.GetProperty("editingSnapshot").GetString()!));var snap=await Snapshot(id);var receipt=await Review(id,snap);
      var job=await Publish(id,snap,receipt);var jid=job.GetProperty("jobId").GetString()!;var repo=new JobRepository();Assert.True(await repo.TryAcquireJobAsync(jid));
      await using var c=await Open();
      var set=dimension switch{"english"=>"explanation='changed'","chinese"=>"translations=jsonb_set(translations,'{zh-CN,explanation}','\"变更\"')","help"=>"front_help='[{\"term\":\"S3\",\"definition\":\"storage\"}]'::jsonb","order"=>"order_in_deck=2",_=>"topic='new-topic'"};
      await DbUtil.ExecuteAsync(c,null,$"update cards set {set} where deck_id=$1",[id]);
      await Assert.ThrowsAsync<InvalidOperationException>(()=>ContentReleaseFence.ValidateJob(c,jid));
      await Assert.ThrowsAsync<PostgresException>(()=>repo.CompleteJobAsync(jid,1));
      Assert.Null(await DbUtil.ExecuteScalarAsync(c,null,"select live_build_id from decks where id=$1",[id]));
    }finally{Vpc.Authoring.Publish.TestEnqueueSeam=null;await Restore();}
  }

  [Theory]
  [InlineData("hash")]
  [InlineData("schema")]
  [InlineData("policy")]
  [InlineData("policyHash")]
  [InlineData("scope")]
  [InlineData("missing")]
  [InlineData("duplicate")]
  [InlineData("expired")]
  [InlineData("evidence")]
  [InlineData("blocker")]
  public async Task Receipt_Rejects_Invalid_Evidence(string fault)
  {
    try{
      var id=await Deck();var initial=await Snapshot(id);Data(await Import(id,initial.GetProperty("editingSnapshot").GetString()!));var snap=await Snapshot(id);
      var body=System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize(Receipt(id,snap)))!;
      switch(fault){
        case "hash":body["cards"]![0]!["cardContentHash"]=new string('0',64);break;
        case "schema":body["cards"]![0]!["schema"]="wrong";break;
        case "policy":body["policy"]="wrong";break;
        case "policyHash":body["policyHash"]=new string('0',64);break;
        case "scope":body["authorizationScope"]="other-deck";break;
        case "missing":body["cards"]=new System.Text.Json.Nodes.JsonArray();break;
        case "duplicate":body["cards"]!.AsArray().Add(body["cards"]![0]!.DeepClone());break;
        case "expired":body["expiresAt"]=DateTimeOffset.UtcNow.AddMinutes(-1);break;
        case "evidence":body.AsObject().Remove("evidenceHash");break;
        case "blocker":body["cards"]![0]!["blockers"]=new System.Text.Json.Nodes.JsonArray("incorrect answer");break;
      }
      var response=await ContentRelease.Handle(Request("POST","/api/v1/authoring/release/review",body),new Res("test"),Admin);Assert.Equal(400,response.StatusCode);
      await using var c=await Open();Assert.Equal(0L,await DbUtil.ExecuteScalarAsync(c,null,"select count(*) from content_review_receipts",[]));
    }finally{await Restore();}
  }

  [Fact]
  public async Task Receipt_Replay_Immutable_And_Source_Invalidation()
  {
    try{
      var id=await Deck();var initial=await Snapshot(id);Data(await Import(id,initial.GetProperty("editingSnapshot").GetString()!));var snap=await Snapshot(id);var body=Receipt(id,snap);
      var first=await ContentRelease.Handle(Request("POST","/api/v1/authoring/release/review",body),new Res("test"),Admin);var receipt=Data(first).GetProperty("receiptId").GetString()!;
      Assert.Equal(first.Body,(await ContentRelease.Handle(Request("POST","/api/v1/authoring/release/review",body),new Res("test"),Admin)).Body);
      var altered=System.Text.Json.Nodes.JsonNode.Parse(JsonSerializer.Serialize(body))!;altered["evidenceRef"]="different";
      Assert.Equal(409,(await ContentRelease.Handle(Request("POST","/api/v1/authoring/release/review",altered),new Res("test"),Admin)).StatusCode);
      var job=await Publish(id,snap,receipt);var repo=new JobRepository();var jid=job.GetProperty("jobId").GetString()!;Assert.True(await repo.TryAcquireJobAsync(jid));
      await using var c=await Open();
      await Assert.ThrowsAsync<PostgresException>(()=>DbUtil.ExecuteAsync(c,null,"update content_review_receipts set policy='aws-codex-bilingual-v1' where id=$1",[receipt]));
      var target=await DbUtil.ExecuteScalarAsync(c,null,"insert into source_watch_targets(kind,url,deck_id,check_interval_minutes) values('page','https://docs.aws.amazon.com/test',$1,60) returning id",[id]);
      await DbUtil.ExecuteAsync(c,null,"insert into source_watch_events(target_id,watch_run_id,kind) values($1,$2,'gone')",[target,Guid.NewGuid()]);
      Assert.Equal(1L,await DbUtil.ExecuteScalarAsync(c,null,"select count(*) from content_review_revocations where receipt_id=$1",[receipt]));
      await Assert.ThrowsAsync<InvalidOperationException>(()=>ContentReleaseFence.ValidateJob(c,jid));
      await repo.CompleteJobAsync(jid,1);Assert.Null(await DbUtil.ExecuteScalarAsync(c,null,"select live_build_id from decks where id=$1",[id]));
    }finally{Vpc.Authoring.Publish.TestEnqueueSeam=null;await Restore();}
  }

  [Fact]
  public async Task Rollback_Cas_Is_Idempotent_And_Cannot_Overwrite_A_Later_Live_Build()
  {
    try{
      var id=await Deck();var initial=await Snapshot(id);Data(await Import(id,initial.GetProperty("editingSnapshot").GetString()!));var snap=await Snapshot(id);var receipt=await Review(id,snap);
      var repo=new JobRepository();await using var c=await Open();
      async Task<JsonElement> Build(string action,string? live)
      {
        var job=await Publish(id,snap,receipt,action,live);var jid=job.GetProperty("jobId").GetString()!;Assert.True(await repo.TryAcquireJobAsync(jid));
        await DbUtil.ExecuteAsync(c,null,"update deck_publishes set content_sha256=$2,content_bytes=100 where job_id=$1",[jid,new string('a',64)]);
        await repo.CompleteJobAsync(jid,1);return job;
      }
      var original=await Build("original",null);var originalBuild=original.GetProperty("buildId").GetString()!;
      var failed=await Build("failed",originalBuild);var failedBuild=failed.GetProperty("buildId").GetString()!;
      var rollback=new{releaseId="release-test",actionId="rollback",buildId=originalBuild,expectedCurrent=failedBuild,expectedRestoreHash=new string('a',64)};
      var rolled=await ContentRelease.Rollback(c,id,JsonSerializer.SerializeToElement(rollback),Admin,new Res("test"),_=>Task.FromResult(new ManifestBuildResult(1,0,"manifest.json","test",0)));
      Data(rolled);Assert.Equal(originalBuild,await DbUtil.ExecuteScalarAsync(c,null,"select live_build_id from decks where id=$1",[id]));
      Assert.Equal(rolled.Body,(await ContentRelease.Rollback(c,id,JsonSerializer.SerializeToElement(rollback),Admin,new Res("test"),_=>throw new Exception("must replay"))).Body);
      await repo.CompleteJobAsync(failed.GetProperty("jobId").GetString()!,1);Assert.Equal(originalBuild,await DbUtil.ExecuteScalarAsync(c,null,"select live_build_id from decks where id=$1",[id]));
      var inFlight=await Publish(id,snap,receipt,"in-flight",originalBuild);
      var confirmation=JsonSerializer.SerializeToElement(new{releaseId="release-test",actionId="already-restored-confirmation",buildId=originalBuild,expectedCurrent=failedBuild,expectedRestoreHash=new string('a',64)});
      Data(await ContentRelease.Rollback(c,id,confirmation,Admin,new Res("test"),_=>Task.FromResult(new ManifestBuildResult(1,0,"manifest.json","test",0))));
      Assert.Equal("PENDING",await DbUtil.ExecuteScalarAsync(c,null,"select status from deck_publishes where job_id=$1",[inFlight.GetProperty("jobId").GetString()]));
      var later=await Build("later",originalBuild);var laterBuild=later.GetProperty("buildId").GetString();
      var stale=JsonSerializer.SerializeToElement(new{releaseId="release-test",actionId="rollback-again",buildId=originalBuild,expectedCurrent=failedBuild,expectedRestoreHash=new string('a',64)});
      Assert.Equal(409,(await ContentRelease.Rollback(c,id,stale,Admin,new Res("test"),_=>throw new Exception("must refuse"))).StatusCode);
      Assert.Equal(laterBuild,await DbUtil.ExecuteScalarAsync(c,null,"select live_build_id from decks where id=$1",[id]));
    }finally{Vpc.Authoring.Publish.TestEnqueueSeam=null;await Restore();}
  }


  private static async Task AwaitDatabaseLock(NpgsqlConnection observer)
  {
    // Observe the server's lock wait as a barrier; no delay guesses or sleeps manufacture the race.
    for(var i=0;i<300;i++)
      if(await DbUtil.ExecuteScalarAsync(observer,null,"select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock')",[]) is true)return;
    Assert.Fail("Expected the competing transaction to wait on the deck lock");
  }

  [Theory]
  [InlineData("put")]
  [InlineData("insert")]
  [InlineData("soft-delete")]
  public async Task Import_After_Concurrent_Ordinary_Write_Rejects_Stale_Snapshot(string write)
  {
    try{
      var id=await Deck();var initial=await Snapshot(id);Data(await Import(id,initial.GetProperty("editingSnapshot").GetString()!));var snap=await Snapshot(id);
      await using var writer=await Open();await using var observer=await Open();await using var tx=await writer.BeginTransactionAsync();
      var sql=write switch{"put"=>"update cards set explanation='ordinary edit' where deck_id=$1","insert"=>"insert into cards(deck_id,stable_uid,question,order_in_deck) values($1,'new-target','new',2)",_=>"update cards set is_deleted=1 where deck_id=$1"};
      await DbUtil.ExecuteAsync(writer,tx,sql,[id]);
      var import=Import(id,snap.GetProperty("editingSnapshot").GetString()!,"concurrent");
      await AwaitDatabaseLock(observer);await tx.CommitAsync();Assert.Equal(409,(await import).StatusCode);
      Assert.Equal(0L,await DbUtil.ExecuteScalarAsync(observer,null,"select count(*) from content_release_actions where action_id='concurrent'",[]));
    }finally{await Restore();}
  }

  [Fact]
  public async Task Source_Invalidation_And_Final_Commit_Serialize_On_Deck()
  {
    try{
      var id=await Deck();var initial=await Snapshot(id);Data(await Import(id,initial.GetProperty("editingSnapshot").GetString()!));var snap=await Snapshot(id);var receipt=await Review(id,snap);var job=await Publish(id,snap,receipt);var jid=job.GetProperty("jobId").GetString()!;
      var repo=new JobRepository();Assert.True(await repo.TryAcquireJobAsync(jid));
      await using var source=await Open();await using var observer=await Open();
      var target=await DbUtil.ExecuteScalarAsync(source,null,"insert into source_watch_targets(kind,url,deck_id,check_interval_minutes) values('page','https://docs.aws.amazon.com/race',$1,60) returning id",[id]);
      await using var tx=await source.BeginTransactionAsync();await DbUtil.ExecuteAsync(source,tx,"insert into source_watch_events(target_id,watch_run_id,kind) values($1,$2,'gone')",[target,Guid.NewGuid()]);
      var complete=repo.CompleteJobAsync(jid,1);await AwaitDatabaseLock(observer);await tx.CommitAsync();await complete;
      Assert.Null(await DbUtil.ExecuteScalarAsync(observer,null,"select live_build_id from decks where id=$1",[id]));
      Assert.Equal("FAILED",await DbUtil.ExecuteScalarAsync(observer,null,"select status from deck_publishes where job_id=$1",[jid]));
      Assert.Equal(400,(await ContentRelease.Handle(Request("POST","/api/v1/authoring/release/review",Receipt(id,snap,"after-gone")),new Res("test"),Admin)).StatusCode);
    }finally{Vpc.Authoring.Publish.TestEnqueueSeam=null;await Restore();}
  }


  private sealed class ReleaseUploader(Func<Task> uploaded) : RecallSmith.Lambda.Worker.S3.IS3DeckUploader
  {
    public async Task<RecallSmith.Lambda.Worker.S3.S3UploadResult> UploadAsync(string key,RecallSmith.Lambda.Worker.S3.DeckExportData data)
    {await uploaded();return new(){Sha256=new string('a',64),Bytes=100};}
    public Task<RecallSmith.Lambda.Worker.S3.S3UploadResult> UploadJsonAsync(string key,string json,string cache)=>throw new Exception("Unexpected artifact upload");
    public Task<string> DownloadJsonAsync(string key)=>throw new Exception("Unexpected download");
  }
  private sealed class NoArtifacts : RecallSmith.Lambda.Worker.Services.IContentArtifactsGenerator
  {public Task GenerateAsync(JobInfo job,RecallSmith.Lambda.Worker.S3.DeckExportData deck,RecallSmith.Lambda.Worker.S3.S3UploadResult upload)=>Task.CompletedTask;}

  [Theory]
  [InlineData("revoke")]
  [InlineData("supersede")]
  public async Task RealProcessor_Upload_Then_Revocation_Cannot_Commit_Live(string cancel)
  {
    try{
      var id=await Deck();var initial=await Snapshot(id);Data(await Import(id,initial.GetProperty("editingSnapshot").GetString()!));var snap=await Snapshot(id);var receipt=await Review(id,snap);var job=await Publish(id,snap,receipt);
      var processor=new RecallSmith.Lambda.Worker.Services.PublishJobProcessor(new JobRepository(),new ReleaseUploader(async()=>{
        if(cancel=="supersede") await Publish(id,snap,receipt,"supersede-during-upload");
        else Data(await ContentRelease.Handle(Request("POST","/api/v1/authoring/release/review/revoke",new{deckId=id,releaseId="release-test",actionId="revoke-during-upload",receiptId=receipt,reason="source retracted"}),new Res("test"),Admin));
      }),new NoArtifacts());
      await Assert.ThrowsAsync<RecallSmith.Lambda.Worker.BusinessException>(()=>processor.ProcessAsync(job.GetProperty("jobId").GetString()!));
      await using var c=await Open();Assert.Null(await DbUtil.ExecuteScalarAsync(c,null,"select live_build_id from decks where id=$1",[id]));
      Assert.Equal("FAILED",await DbUtil.ExecuteScalarAsync(c,null,"select status from deck_publishes where job_id=$1",[job.GetProperty("jobId").GetString()]));
    }finally{Vpc.Authoring.Publish.TestEnqueueSeam=null;await Restore();}
  }

  [Fact]
  public async Task Revocation_And_Final_Commit_Serialize_On_Deck()
  {
    try{
      var id=await Deck();var initial=await Snapshot(id);Data(await Import(id,initial.GetProperty("editingSnapshot").GetString()!));var snap=await Snapshot(id);var receipt=await Review(id,snap);var job=await Publish(id,snap,receipt);var jid=job.GetProperty("jobId").GetString()!;
      var repo=new JobRepository();Assert.True(await repo.TryAcquireJobAsync(jid));
      await using var revoker=await Open();await using var observer=await Open();
      await using var tx=await revoker.BeginTransactionAsync();
      await DbUtil.ExecuteAsync(revoker,tx,"insert into content_review_revocations(receipt_id,reason,actor_sub) values($1,'revoked','test')",[receipt]);
      var complete=repo.CompleteJobAsync(jid,1);await AwaitDatabaseLock(observer);await tx.CommitAsync();
      await Assert.ThrowsAsync<PostgresException>(()=>complete);
      Assert.Null(await DbUtil.ExecuteScalarAsync(observer,null,"select live_build_id from decks where id=$1",[id]));
    }finally{Vpc.Authoring.Publish.TestEnqueueSeam=null;await Restore();}
  }

}
