using Catalog.Application;
using Dapper;
using Npgsql;
using SharedKernel;
using Microsoft.Extensions.Logging;

namespace Catalog.Infrastructure;

public sealed class CatalogAdminService : ICatalogAdminService
{
    private readonly NpgsqlDataSource _ds;
    private readonly ILogger<CatalogAdminService> _log;

    public CatalogAdminService(NpgsqlDataSource ds, ILogger<CatalogAdminService> log)
    { _ds = ds; _log = log; }

    public async Task<CreateDeckResult> CreateDeckAsync(CreateDeckCmd cmd, CancellationToken ct)
    {
        // 验证
        var v = new CreateDeckCmdValidator();
        var vr = v.Validate(cmd);
        if (!vr.IsValid) throw AppException.Validation(vr.ToString());

        const string SQL = /* language=sql */ @"
insert into catalog_decks (slug, title, locale)
values (@slug, @title, coalesce(@locale,'en-US'))
returning id;";

        try
        {
            await using var conn = await _ds.OpenConnectionAsync(ct);
            var id = await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(SQL,
                new { slug = cmd.Slug, title = cmd.Title, locale = cmd.Locale }, cancellationToken: ct));
            _log.LogInformation("CreateDeck slug={Slug} id={DeckId}", cmd.Slug, id);
            return new CreateDeckResult(id);
        }
        catch (PostgresException pg) when (pg.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw AppException.Conflict($"Deck slug '{cmd.Slug}' already exists.");
        }
    }

    public async Task<CreateDraftCardResult> CreateDraftCardAsync(CreateDraftCardCmd cmd, CancellationToken ct)
    {
        var v = new CreateDraftCardCmdValidator();
        var vr = v.Validate(cmd);
        if (!vr.IsValid) throw AppException.Validation(vr.ToString());

        const string SQL_EXISTS = /* sql */ @"select 1 from catalog_decks where id=@deckId and is_deleted=false;";
        const string SQL_INSERT = /* sql */ @"
insert into catalog_cards_draft
(deck_id, stable_uid, front_md, back_md, key_point, tags, difficulty)
values (
  @deckId,
  @stableUid,
  @frontMd,
  @backMd,
  @keyPoint,
  COALESCE(CAST(@tags AS jsonb), '[]'::jsonb),
  @difficulty
)
returning id;";

        await using var conn = await _ds.OpenConnectionAsync(ct);
        var deck = await conn.ExecuteScalarAsync<int?>(new CommandDefinition(SQL_EXISTS, new { deckId = cmd.DeckId }, cancellationToken: ct));
        if (deck is null) throw AppException.NotFound($"Deck {cmd.DeckId} not found.");

        try
        {
            var id = await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(SQL_INSERT, new
            {
                deckId = cmd.DeckId,
                stableUid = cmd.StableUid,
                frontMd = cmd.FrontMd,
                backMd = cmd.BackMd,
                keyPoint = cmd.KeyPoint,
                tags = cmd.Tags is null ? "[]" : System.Text.Json.JsonSerializer.Serialize(cmd.Tags),
                difficulty = cmd.Difficulty
            }, cancellationToken: ct));

            _log.LogInformation("CreateDraftCard deck={DeckId} stable={StableUid} id={CardId}",
                cmd.DeckId, cmd.StableUid, id);
            return new CreateDraftCardResult(id, cmd.StableUid);
        }
        catch (PostgresException pg) when (pg.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw AppException.Conflict($"Draft stable_uid '{cmd.StableUid}' already exists (deck={cmd.DeckId}).");
        }
    }

    public async Task<PublishDeckResult> PublishDeckAsync(PublishDeckCmd cmd, CancellationToken ct)
    {
        var v = new PublishDeckCmdValidator();
        var vr = v.Validate(cmd);
        if (!vr.IsValid) throw AppException.Validation(vr.ToString());

        await using var conn = await _ds.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        try
        {
            // 1) 版本唯一
            const string SQL_VER = /* sql */ @"
insert into catalog_versions (deck_id, version, changelog)
values (@deckId, @version, @changelog)
returning id;";
            var verId = await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(SQL_VER,
                new { deckId = cmd.DeckId, version = cmd.Version, changelog = cmd.Changelog }, tx, cancellationToken: ct));

            // 2) 复制草稿到快照
            const string SQL_COPY = /* sql */ @"
with inserted as (
  insert into catalog_cards
  (deck_id, stable_uid, version, front_md, back_md, key_point, tags, difficulty)
  select d.deck_id, d.stable_uid, @version, d.front_md, d.back_md, d.key_point, d.tags, d.difficulty
  from catalog_cards_draft d
  where d.deck_id=@deckId and d.is_deleted=false
  returning id
)
select count(*)::int as total_cards from inserted;";
            var total = await conn.ExecuteScalarAsync<int>(new CommandDefinition(SQL_COPY,
                new { deckId = cmd.DeckId, version = cmd.Version }, tx, cancellationToken: ct));

            if (total == 0)
                throw AppException.Validation("Draft is empty, refuse to publish.");

            // 3) 更新 deck 元信息
            const string SQL_DECK = /* sql */ @"
update catalog_decks
set latest_version=@version, total_cards=@total, published_at=now()
where id=@deckId;";
            await conn.ExecuteAsync(new CommandDefinition(SQL_DECK,
                new { deckId = cmd.DeckId, version = cmd.Version, total }, tx, cancellationToken: ct));

            await tx.CommitAsync(ct);

            _log.LogInformation("Publish deck={DeckId} version={Version} total={Total}", cmd.DeckId, cmd.Version, total);
            return new PublishDeckResult(cmd.Version, total, DateTimeOffset.UtcNow);
        }
        catch (PostgresException pg) when (pg.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            await tx.RollbackAsync(ct);
            throw AppException.Conflict($"Version '{cmd.Version}' already exists (deck={cmd.DeckId}).");
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }
}