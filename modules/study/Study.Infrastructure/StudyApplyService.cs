using System;
using System.Threading;
using System.Threading.Tasks;
using Dapper;
using Npgsql;
using Microsoft.Extensions.Logging;
using Study.Application;

namespace Study.Infrastructure;

public sealed class StudyApplyService : IStudyApplyService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<StudyApplyService> _logger;

    public StudyApplyService(NpgsqlDataSource dataSource, ILogger<StudyApplyService> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    public async Task<ApplyDeckResult> ApplyDeckAsync(ApplyDeckCmd cmd, CancellationToken ct = default)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        // 1) 取模板 deck 元信息
        var meta = await conn.QuerySingleOrDefaultAsync<(string Title, string? LatestVersion)>(new CommandDefinition(
            "select title, latest_version from catalog_decks where id=@deck and is_deleted=false",
            new { deck = cmd.CatalogDeckId }, transaction: tx, cancellationToken: ct));
        if (meta == default) throw new InvalidOperationException("Catalog deck not found");

        var version = cmd.TargetVersion ?? meta.LatestVersion;
        if (string.IsNullOrWhiteSpace(version))
            throw new InvalidOperationException("Target version is required (latest_version is null)");

        // 2) 确保用户 deck 存在
        var userDeckId = await conn.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            "select id from decks where user_id=@u and template_id=@d and is_deleted=false",
            new { u = cmd.UserId, d = cmd.CatalogDeckId }, transaction: tx, cancellationToken: ct));

        if (!userDeckId.HasValue)
        {
            userDeckId = await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(@"
insert into decks (user_id, title, template_id, template_version, active, is_deleted, created_at, updated_at)
values (@u, @title, @d, null, true, false, now(), now())
returning id;",
                new { u = cmd.UserId, title = meta.Title, d = cmd.CatalogDeckId }, transaction: tx, cancellationToken: ct));
        }

        // 3) 更新已有卡文本（不动调度）
        var updated = await conn.ExecuteAsync(new CommandDefinition(@"
update cards c
set front_md = s.front_md,
    back_md  = s.back_md,
    key_point= s.key_point,
    tags     = s.tags,
    difficulty = s.difficulty,
    origin_template_version = @v,
    updated_at = now()
from (
  select stable_uid, front_md, back_md, key_point, tags, difficulty
  from catalog_cards
  where deck_id = @d and version = @v and is_deleted=false
) s
where c.user_id=@u
  and c.deck_id=@ud
  and c.is_deleted=false
  and c.stable_uid = s.stable_uid
  and (
    c.origin_template_version is distinct from @v
    or c.front_md  is distinct from s.front_md
    or c.back_md   is distinct from s.back_md
    or c.key_point is distinct from s.key_point
    or c.tags      is distinct from s.tags
    or c.difficulty is distinct from s.difficulty
  );",
    new { u = cmd.UserId, ud = userDeckId.Value, d = cmd.CatalogDeckId, v = version },
    transaction: tx, cancellationToken: ct));
        // 4) 插入新卡 + 初始化调度（due_at 设为 now，今天可复习）
        var added = await conn.ExecuteAsync(new CommandDefinition(@"
with s as (
  select stable_uid, front_md, back_md, key_point, tags, difficulty
  from catalog_cards
  where deck_id = @d and version = @v and is_deleted=false
),
missing as (
  select s.*
  from s
  left join cards c
    on c.user_id=@u and c.deck_id=@ud and c.is_deleted=false and c.stable_uid=s.stable_uid
  where c.id is null
),
ins as (
  insert into cards (id, user_id, deck_id, stable_uid, front_md, back_md, key_point, tags, difficulty, source, origin_template_version, created_at, updated_at)
  select gen_random_uuid(), @u, @ud, m.stable_uid, m.front_md, m.back_md, m.key_point, m.tags, m.difficulty, 'catalog', @v, now(), now()
  from missing m
  returning id
)
insert into scheduling (card_id, state, ease, interval_days, due_at, reps, lapses, created_at, updated_at)
select id, 'new', 2.5, 0, now(), 0, 0, now(), now() from ins;",
            new { u = cmd.UserId, ud = userDeckId.Value, d = cmd.CatalogDeckId, v = version },
            transaction: tx, cancellationToken: ct));

        // 5) 标记用户 deck 当前版本
        await conn.ExecuteAsync(new CommandDefinition(
            "update decks set template_version=@v, updated_at=now() where id=@ud",
            new { v = version, ud = userDeckId.Value }, transaction: tx, cancellationToken: ct));

        await tx.CommitAsync(ct);

        _logger.LogInformation("ApplyDeck user={UserId} deck={DeckId} version={Version} added={Added} updated={Updated}",
            cmd.UserId, userDeckId.Value, version, added, updated);

        return new ApplyDeckResult(userDeckId.Value, version, added, updated);
    }
}