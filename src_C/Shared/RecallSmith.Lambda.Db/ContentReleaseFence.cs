using Npgsql;

namespace RecallSmith.Lambda.Db;

/// <summary>Both the worker and the database final-commit trigger fence late or superseded builds.</summary>
public static class ContentReleaseFence
{
  public static async Task ValidateJob(NpgsqlConnection conn,string jobId)
  {
    var rows=await DbUtil.QueryAsync(conn,null,"""
      select d.slug, p.status, to_jsonb(p)->>'release_generation' as generation,
        to_jsonb(d)->>'release_generation' as current_generation from deck_publishes p join decks d on d.id=p.deck_id where p.job_id=$1
      """,[jobId]);
    if(rows.Count==0||rows[0]["slug"] as string!="aws-saa-fundamentals")return;
    var row=rows[0];
    if(row["status"] as string!="PROCESSING" || row["generation"] is null || !Equals(row["generation"],row["current_generation"]))throw new InvalidOperationException("RELEASE_GENERATION_CANCELLED");
    var valid=await DbUtil.ExecuteScalarAsync(conn,null,"""
      select exists(select 1 from deck_publishes p join decks d on d.id=p.deck_id
        join content_review_receipts r on r.id=p.release_receipt_id
        where p.job_id=$1 and d.is_deleted=0 and r.deck_id=d.id and r.expires_at>clock_timestamp()
        and not exists(select 1 from content_review_revocations where receipt_id=r.id)
        and r.editing_snapshot=content_editing_snapshot(d.id) and p.release_editing_snapshot=r.editing_snapshot
        and p.qa_snapshot_sha256=r.publish_snapshot and p.release_expected_live is not distinct from d.live_build_id)
      """,[jobId]);
    if(valid is not true)throw new InvalidOperationException("CODEX_REVIEW_REQUIRED_OR_STALE");
  }
}
