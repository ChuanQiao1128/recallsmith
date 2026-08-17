using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class ContentIntelligence
{
  public static async Task<APIGatewayProxyResponse> HandleContentIntelligence(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "GET") return res.MethodNotAllowed();

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars");

    var deckSlug = req.Query.TryGetValue("deckSlug", out var ds) ? NullIfBlank(ds) : null;
    var daysRaw = Validation.ParseOptionalInteger(req.Query.TryGetValue("days", out var d) ? d : null, "days");
    var limitRaw = Validation.ParseOptionalInteger(req.Query.TryGetValue("limit", out var l) ? l : null, "limit");
    var days = (int)Math.Max(7, Math.Min(daysRaw ?? 90, 365));
    var limit = (int)Math.Max(1, Math.Min(limitRaw ?? 100, 500));

    if ((days == 30 || days == 90) && await SnapshotAvailableAsync(conn, days))
    {
      const string snapshotSql = """
        select
          s.deck_slug as "deckSlug",
          coalesce(d.title, s.deck_slug) as "deckTitle",
          s.card_stable_uid as "cardStableUid",
          coalesce(c.question, s.card_stable_uid) as "cardQuestion",
          s.card_revision as revision,
          s.stated_difficulty as "statedDifficulty",
          s.review_count as "reviewCount",
          s.unique_user_count as "uniqueUserCount",
          0::int as "firstReviewCount",
          round(s.observed_difficulty_raw::numeric, 3) as "observedDifficultyRaw",
          round(s.expected_difficulty::numeric, 3) as "expectedDifficulty",
          round(s.difficulty_gap::numeric, 3) as "difficultyGap",
          round(s.difficulty_gap_z::numeric, 3) as "difficultyGapZ",
          round(s.easy_rate::numeric, 3) as "easyRate",
          round(s.good_rate::numeric, 3) as "goodRate",
          round(s.hard_rate::numeric, 3) as "hardRate",
          round(s.again_rate::numeric, 3) as "againRate",
          round(s.struggle_rate::numeric, 3) as "struggleRate",
          round(s.failure_rate::numeric, 3) as "failureRate",
          null::numeric as "firstReviewEasyRate",
          round(s.repeat_failure_rate::numeric, 3) as "repeatFailureRate",
          round(s.median_dwell_time_ms::numeric, 0) as "medianDwellTimeMs",
          round(s.expected_dwell_time_ms::numeric, 0) as "expectedDwellTimeMs",
          null::numeric as "dwellTimeGapZ",
          round(s.high_level_user_failure_rate::numeric, 3) as "highLevelUserFailureRate",
          round(s.review_count_to_mastery::numeric, 2) as "reviewCountToMastery",
          round(s.post_card_dropout_rate::numeric, 3) as "postCardDropoutRate",
          s.difficulty_calibration_status as "difficultyCalibrationStatus",
          s.content_quality_status as "contentQualityStatus",
          s.confidence_level as "confidenceLevel",
          round(s.fix_priority_score::numeric, 2) as "fixPriorityScore"
        from content_intelligence_card_snapshot s
        left join decks d
          on d.slug = s.deck_slug
         and d.is_deleted = 0
        left join lateral (
          select c.question
          from cards c
          where c.deck_id = d.id
            and c.stable_uid = s.card_stable_uid
            and c.is_deleted = 0
          order by coalesce(c.revision, 0) desc, c.id desc
          limit 1
        ) c on true
        where s.window_days = $1::int
          and ($3::text is null or s.deck_slug = $3::text)
          and (
            $4::boolean
            or exists (
              select 1
              from admin_deck_permissions p
              where p.deck_id = d.id
                and p.admin_sub = $2
                and p.can_read = 1
            )
          )
        order by "fixPriorityScore" desc nulls last, s.review_count desc
        limit $5::int;
        """;

      try
      {
        var cards = await DbUtil.QueryAsync(conn, null, snapshotSql, [days, auth.UserSub, deckSlug, auth.IsSuperAdmin, limit]);
        return res.Ok(BuildResponse(cards, days, deckSlug));
      }
      catch (Exception ex)
      {
        Log.Error("Content intelligence snapshot error:", ex);
        return res.Error500(ex);
      }
    }

    const string sql = """
      with event_scored as (
        select
          e.event_id,
          e.user_sub,
          e.deck_slug,
          d.title as deck_title,
          e.stable_uid,
          c.question as card_question,
          coalesce(e.card_revision, e.last_seen_revision, c.revision, 1) as revision,
          coalesce(e.stated_difficulty, c.difficulty, 2) as stated_difficulty,
          e.rating,
          e.event_time,
          e.dwell_time_ms,
          e.review_stage,
          row_number() over (
            partition by e.user_sub, e.deck_slug, e.stable_uid
            order by e.event_time asc, e.created_at asc
          ) as user_card_review_number,
          case e.rating
            when 1 then 4.0
            when 2 then 3.0
            when 3 then 1.0
            when 4 then 0.0
            else null
          end as response_score
        from user_progress_events e
        left join decks d on d.slug = e.deck_slug and d.is_deleted = 0
        left join cards c
          on c.deck_id = d.id
         and c.stable_uid = e.stable_uid
         and c.is_deleted = 0
        left join admin_deck_permissions p
          on p.deck_id = d.id
         and p.admin_sub = $3
         and p.can_read = 1
        where e.event_time >= now() - ($1::int * interval '1 day')
          and ($2::text is null or e.deck_slug = $2::text)
          and ($4::boolean or p.id is not null)
          and e.rating is not null
      ),
      user_baseline as (
        select
          user_sub,
          count(*)::int as user_review_count,
          avg(response_score) as user_avg_response_score
        from event_scored
        where response_score is not null
        group by user_sub
      ),
      baseline as (
        select
          deck_slug,
          stated_difficulty,
          avg(response_score) as expected_difficulty,
          nullif(stddev_samp(response_score), 0) as expected_stddev,
          percentile_cont(0.5) within group (order by dwell_time_ms)
            filter (where dwell_time_ms is not null and dwell_time_ms > 0) as expected_dwell_time_ms,
          nullif(stddev_samp(dwell_time_ms::double precision)
            filter (where dwell_time_ms is not null and dwell_time_ms > 0), 0) as expected_dwell_stddev
        from event_scored
        where response_score is not null
        group by deck_slug, stated_difficulty
      ),
      first_success as (
        select
          deck_slug,
          stable_uid,
          revision,
          stated_difficulty,
          avg(first_success_review_number)::double precision as review_count_to_mastery
        from (
          select
            user_sub,
            deck_slug,
            stable_uid,
            revision,
            stated_difficulty,
            min(user_card_review_number) as first_success_review_number
          from event_scored
          where rating in (3, 4)
          group by user_sub, deck_slug, stable_uid, revision, stated_difficulty
        ) s
        group by deck_slug, stable_uid, revision, stated_difficulty
      ),
      card_stats as (
        select
          e.deck_slug,
          max(e.deck_title) as deck_title,
          e.stable_uid,
          max(e.card_question) as card_question,
          e.revision,
          e.stated_difficulty,
          count(*)::int as review_count,
          count(distinct e.user_sub)::int as unique_user_count,
          count(*) filter (where e.user_card_review_number = 1)::int as first_review_count,
          avg(e.response_score) as observed_difficulty_raw,
          avg(case when e.rating = 4 then 1.0 else 0.0 end) as easy_rate,
          avg(case when e.rating = 3 then 1.0 else 0.0 end) as good_rate,
          avg(case when e.rating = 2 then 1.0 else 0.0 end) as hard_rate,
          avg(case when e.rating = 1 then 1.0 else 0.0 end) as again_rate,
          avg(case when e.rating in (1, 2) then 1.0 else 0.0 end) as struggle_rate,
          avg(case when e.rating = 1 then 1.0 else 0.0 end) as failure_rate,
          avg(case when e.user_card_review_number = 1 and e.rating = 4 then 1.0
                   when e.user_card_review_number = 1 then 0.0
                   else null end) as first_review_easy_rate,
          avg(case when e.user_card_review_number > 1 and e.rating = 1 then 1.0
                   when e.user_card_review_number > 1 then 0.0
                   else null end) as repeat_failure_rate,
          percentile_cont(0.5) within group (order by e.dwell_time_ms)
            filter (where e.dwell_time_ms is not null and e.dwell_time_ms > 0) as median_dwell_time_ms,
          avg(case when ub.user_review_count >= 10 and ub.user_avg_response_score <= 1.4 and e.rating = 1 then 1.0
                   when ub.user_review_count >= 10 and ub.user_avg_response_score <= 1.4 then 0.0
                   else null end) as high_level_user_failure_rate
        from event_scored e
        left join user_baseline ub on ub.user_sub = e.user_sub
        where e.response_score is not null
        group by e.deck_slug, e.stable_uid, e.revision, e.stated_difficulty
      ),
      scored as (
        select
          cs.*,
          fs.review_count_to_mastery,
          b.expected_difficulty,
          b.expected_stddev,
          b.expected_dwell_time_ms,
          b.expected_dwell_stddev,
          (cs.observed_difficulty_raw - b.expected_difficulty) as difficulty_gap,
          (cs.observed_difficulty_raw - b.expected_difficulty) / nullif(b.expected_stddev, 0) as difficulty_gap_z,
          (cs.median_dwell_time_ms - b.expected_dwell_time_ms) / nullif(b.expected_dwell_stddev, 0) as dwell_time_gap_z
        from card_stats cs
        left join baseline b
          on b.deck_slug = cs.deck_slug
         and b.stated_difficulty = cs.stated_difficulty
        left join first_success fs
          on fs.deck_slug = cs.deck_slug
         and fs.stable_uid = cs.stable_uid
         and fs.revision = cs.revision
         and fs.stated_difficulty = cs.stated_difficulty
      ),
      labeled as (
        select
          *,
          case
            when review_count < 30 then 'Needs More Data'
            when coalesce(difficulty_gap_z, difficulty_gap, 0) > 1.5 and stated_difficulty < 3 then 'Difficulty Understated'
            when coalesce(difficulty_gap_z, difficulty_gap, 0) < -1.5 then 'Difficulty Overstated'
            else 'Correctly Calibrated'
          end as difficulty_calibration_status,
          case
            when review_count < 30 then 'Needs More Data'
            when coalesce(difficulty_gap_z, 0) > 1.0
              and coalesce(dwell_time_gap_z, 0) > 1.0
              and coalesce(repeat_failure_rate, failure_rate, 0) >= 0.20
              and coalesce(high_level_user_failure_rate, 0) >= 0.15
              then 'Possibly Unclear'
            when stated_difficulty = 3
              and coalesce(struggle_rate, 0) >= 0.35
              and coalesce(failure_rate, 0) < 0.22
              and coalesce(repeat_failure_rate, 0) < 0.22
              then 'Productive Challenge'
            when coalesce(difficulty_gap_z, 0) < -1.0
              and coalesce(first_review_easy_rate, easy_rate, 0) >= 0.45
              then 'Too Shallow'
            else 'Healthy'
          end as content_quality_status,
          case
            when review_count < 30 then 'Low'
            when review_count < 100 then 'Medium'
            else 'High'
          end as confidence_level
        from scored
      )
      select
        deck_slug as "deckSlug",
        coalesce(deck_title, deck_slug) as "deckTitle",
        stable_uid as "cardStableUid",
        coalesce(card_question, stable_uid) as "cardQuestion",
        revision,
        stated_difficulty as "statedDifficulty",
        review_count as "reviewCount",
        unique_user_count as "uniqueUserCount",
        first_review_count as "firstReviewCount",
        round(observed_difficulty_raw::numeric, 3) as "observedDifficultyRaw",
        round(expected_difficulty::numeric, 3) as "expectedDifficulty",
        round(difficulty_gap::numeric, 3) as "difficultyGap",
        round(difficulty_gap_z::numeric, 3) as "difficultyGapZ",
        round(easy_rate::numeric, 3) as "easyRate",
        round(good_rate::numeric, 3) as "goodRate",
        round(hard_rate::numeric, 3) as "hardRate",
        round(again_rate::numeric, 3) as "againRate",
        round(struggle_rate::numeric, 3) as "struggleRate",
        round(failure_rate::numeric, 3) as "failureRate",
        round(first_review_easy_rate::numeric, 3) as "firstReviewEasyRate",
        round(repeat_failure_rate::numeric, 3) as "repeatFailureRate",
        round(median_dwell_time_ms::numeric, 0) as "medianDwellTimeMs",
        round(expected_dwell_time_ms::numeric, 0) as "expectedDwellTimeMs",
        round(dwell_time_gap_z::numeric, 3) as "dwellTimeGapZ",
        round(high_level_user_failure_rate::numeric, 3) as "highLevelUserFailureRate",
        round(review_count_to_mastery::numeric, 2) as "reviewCountToMastery",
        null::numeric as "postCardDropoutRate",
        difficulty_calibration_status as "difficultyCalibrationStatus",
        content_quality_status as "contentQualityStatus",
        confidence_level as "confidenceLevel",
        round(((
          (least(abs(coalesce(difficulty_gap_z, 0)), 3) * 20)
          + (coalesce(failure_rate, 0) * 40)
          + (coalesce(repeat_failure_rate, 0) * 30)
          + (greatest(coalesce(dwell_time_gap_z, 0), 0) * 10)
        ) * ln(greatest(unique_user_count, 1) + 1)
          * case confidence_level when 'High' then 1.0 when 'Medium' then 0.7 else 0.35 end
        )::numeric, 2) as "fixPriorityScore"
      from labeled
      order by "fixPriorityScore" desc nulls last, review_count desc
      limit $5::int;
      """;

    try
    {
      var cards = await DbUtil.QueryAsync(conn, null, sql, [days, deckSlug, auth.UserSub, auth.IsSuperAdmin, limit]);
      return res.Ok(BuildResponse(cards, days, deckSlug));
    }
    catch (Exception ex)
    {
      Log.Error("Content intelligence error:", ex);
      return res.Error500(ex);
    }
  }

  private static string? NullIfBlank(string? value)
  {
    var s = value?.Trim();
    return string.IsNullOrEmpty(s) ? null : s;
  }

  private static async Task<bool> SnapshotAvailableAsync(Npgsql.NpgsqlConnection conn, int windowDays)
  {
    var scalar = await DbUtil.ExecuteScalarAsync(
      conn,
      null,
      "select exists(select 1 from content_intelligence_card_snapshot where window_days = $1 limit 1);",
      [windowDays]);

    return scalar is bool b && b;
  }

  private static object BuildResponse(List<Dictionary<string, object?>> cards, int days, string? deckSlug)
  {
    return new
    {
      generatedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
      windowDays = days,
      deckSlug,
      cards,
      summary = new
      {
        cardCount = cards.Count,
        needsMoreData = CountStatus(cards, "contentQualityStatus", "Needs More Data"),
        possiblyUnclear = CountStatus(cards, "contentQualityStatus", "Possibly Unclear"),
        tooShallow = CountStatus(cards, "contentQualityStatus", "Too Shallow"),
        productiveChallenge = CountStatus(cards, "contentQualityStatus", "Productive Challenge"),
        difficultyUnderstated = CountStatus(cards, "difficultyCalibrationStatus", "Difficulty Understated"),
        difficultyOverstated = CountStatus(cards, "difficultyCalibrationStatus", "Difficulty Overstated"),
      }
    };
  }

  private static int CountStatus(List<Dictionary<string, object?>> rows, string field, string value)
  {
    return rows.Count(row =>
      row.TryGetValue(field, out var v) &&
      string.Equals(Convert.ToString(v, CultureInfo.InvariantCulture), value, StringComparison.Ordinal));
  }
}
