using Dapper;
using Npgsql;
using SharedKernel;
using Microsoft.Extensions.Logging;
using Study.Application;

namespace Study.Infrastructure;

public sealed class StudyUserService : IStudyUserService
{
    private readonly NpgsqlDataSource _ds;
    private readonly ILogger<StudyUserService> _log;

    public StudyUserService(NpgsqlDataSource ds, ILogger<StudyUserService> log)
    { _ds = ds; _log = log; }

    public async Task<ApplyDeckResult> ApplyDeckAsync(ApplyDeckCmd cmd, CancellationToken ct)
    {
        await using var conn = await _ds.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        try
        {
            // 0) 解析版本：如果未提供，查 latest_version（为空则 409）
            const string SQL_LATEST = /* sql */ @"
select latest_version from catalog_decks where id=@deckId and is_deleted=false;";
            string? version = cmd.TargetVersion ??
                await conn.ExecuteScalarAsync<string?>(new CommandDefinition(SQL_LATEST,
                    new { deckId = cmd.CatalogDeckId }, tx, cancellationToken: ct));
            if (string.IsNullOrWhiteSpace(version))
                throw AppException.Conflict("Catalog deck has no latest version.");

            // 1) 确保 UserDeck 存在（查或建）
            const string SQL_USERDECK = /* sql */ @"
with upsert_ud as (
  select id from decks
  where user_id=@userId and template_id=@catalogDeckId and is_deleted=false limit 1
)
select coalesce(
  (select id from upsert_ud),
  (insert into decks (user_id, title, template_id, template_version)
   select @userId, d.title, d.id, null from catalog_decks d where d.id=@catalogDeckId returning id)
) as user_deck_id;";
            var userDeckId = await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(SQL_USERDECK,
                new { userId = cmd.UserId, catalogDeckId = cmd.CatalogDeckId }, tx, cancellationToken: ct));

            // 2) 合并（更新文本 + 新增卡 + 初始化 scheduling）
            //    —— 使用我在 Runbook 里提供的 CTE SQL（match/updated/inserted_cards/inserted_sched）
            const string SQL_MERGE = /* sql */ @"
with src as (
  select stable_uid, front_md, back_md, key_point, tags, difficulty
  from catalog_cards
  where deck_id=@catalogDeckId and version=@version and is_deleted=false
),
match as (
  select s.*, c.id as card_id
  from src s
  left join cards c
    on c.user_id=@userId and c.deck_id=@userDeckId
   and c.stable_uid=s.stable_uid and c.is_deleted=false
),
updated as (
  update cards c set
    front_md  = m.front_md,
    back_md   = m.back_md,
    key_point = m.key_point,
    tags      = m.tags,
    difficulty= m.difficulty,
    updated_at= now()
  from match m
  where c.id = m.card_id
  returning c.id
),
inserted_cards as (
  insert into cards
    (user_id, deck_id, stable_uid, front_md, back_md, key_point, tags, difficulty, source, origin_template_version)
  select @userId, @userDeckId, m.stable_uid, m.front_md, m.back_md, m.key_point, m.tags, m.difficulty, 'catalog', @version
  from match m where m.card_id is null
  returning id
),
inserted_sched as (
  insert into scheduling (card_id, state, ease, interval_days, due_at, reps, lapses, last_review_at)
  select id, 'new', 2.5, 0, null, 0, 0, null
  from inserted_cards
  returning card_id
)
select
  (select count(*) from inserted_cards) as added,
  (select count(*) from updated)        as updated;";
            var counts = await conn.QuerySingleAsync<(int added, int updated)>(new CommandDefinition(SQL_MERGE,
                new { userId = cmd.UserId, userDeckId, catalogDeckId = cmd.CatalogDeckId, version }, tx, cancellationToken: ct));

            // 3) 更新用户 deck 的版本
            const string SQL_UPD_VER = /* sql */ @"
update decks set template_version=@version, updated_at=now()
where id=@userDeckId;";
            await conn.ExecuteAsync(new CommandDefinition(SQL_UPD_VER,
                new { userDeckId, version }, tx, cancellationToken: ct));

            await tx.CommitAsync(ct);

            _log.LogInformation("Apply user={User} catalog={Deck} version={Ver} added={Added} updated={Updated}",
                cmd.UserId, cmd.CatalogDeckId, version, counts.added, counts.updated);

            return new ApplyDeckResult(userDeckId, version!, counts.added, counts.updated);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }
}