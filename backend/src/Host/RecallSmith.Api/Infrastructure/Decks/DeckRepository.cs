using System;
using System.Collections.Generic;
using Microsoft.Extensions.Configuration;
using Npgsql;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Decks;

public class DeckRepository : IDeckRepository
{
    private readonly string _connectionString;

    public DeckRepository(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DecksDb")
                           ?? throw new InvalidOperationException("Connection string 'DecksDb' is not configured.");
    }

    // 映射一行记录到 Deck 对象
    private Deck MapDeck(NpgsqlDataReader reader)
    {
        return new Deck
        {
            Id = reader.GetInt32(reader.GetOrdinal("id")),
            Title = reader.GetString(reader.GetOrdinal("title")),
            Author = reader.GetString(reader.GetOrdinal("author")),
            IsDeleted = reader.GetInt32(reader.GetOrdinal("is_deleted")),
            Version = reader.GetInt32(reader.GetOrdinal("version")),
            CreatedAt = reader.GetInt64(reader.GetOrdinal("created_at")),
            UpdatedAt = reader.GetInt64(reader.GetOrdinal("updated_at"))
        };
    }

    // 列表查询：搜索 + 排序 + 分页
    public List<Deck> GetDecks(string? title, bool sortCreatedAtAsc, int page, int pageSize)
    {
        List<Deck> deckList = new List<Deck>();

        bool hasKeyword = !string.IsNullOrWhiteSpace(title);
        string? keyword = hasKeyword ? title!.Trim() : null;

        int limit = pageSize;
        int offset = (page - 1) * pageSize;

        string sql = @"
            SELECT id, title, author, is_deleted, version, created_at, updated_at
            FROM decks
            WHERE is_deleted = 0
        ";

        if (hasKeyword)
        {
            sql += " AND title ILIKE @keyword";
        }

        sql += sortCreatedAtAsc ? " ORDER BY created_at ASC" : " ORDER BY created_at DESC";
        sql += " LIMIT @limit OFFSET @offset";

        using (var conn = new NpgsqlConnection(_connectionString))
        {
            conn.Open();

            using (var cmd = new NpgsqlCommand(sql, conn))
            {
                if (hasKeyword)
                {
                    cmd.Parameters.AddWithValue("keyword", $"%{keyword}%");
                }

                cmd.Parameters.AddWithValue("limit", limit);
                cmd.Parameters.AddWithValue("offset", offset);

                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        var deck = MapDeck(reader);
                        deckList.Add(deck);
                    }
                }
            }
        }

        return deckList;
    }

    // 按 id 查询单条
    public Deck? GetDeckById(int id)
    {
        Deck? deck = null;

        string sql = @"
            SELECT id, title, author, is_deleted, version, created_at, updated_at
            FROM decks
            WHERE id = @id AND is_deleted = 0
            LIMIT 1
        ";

        using (var conn = new NpgsqlConnection(_connectionString))
        {
            conn.Open();

            using (var cmd = new NpgsqlCommand(sql, conn))
            {
                cmd.Parameters.AddWithValue("id", id);

                using (var reader = cmd.ExecuteReader())
                {
                    if (reader.Read())
                    {
                        deck = MapDeck(reader);
                    }
                }
            }
        }

        return deck;
    }

    // 检查未软删的 title 是否存在（忽略大小写），可排除某个 id
    public bool ExistsActiveTitle(string title, int? excludeId)
    {
        string sql = @"
            SELECT 1
            FROM decks
            WHERE is_deleted = 0
              AND LOWER(title) = LOWER(@title)
        ";

        if (excludeId.HasValue)
        {
            sql += " AND id <> @excludeId";
        }

        sql += " LIMIT 1";

        using (var conn = new NpgsqlConnection(_connectionString))
        {
            conn.Open();

            using (var cmd = new NpgsqlCommand(sql, conn))
            {
                cmd.Parameters.AddWithValue("title", title);
                if (excludeId.HasValue)
                {
                    cmd.Parameters.AddWithValue("excludeId", excludeId.Value);
                }

                var exists = cmd.ExecuteScalar();
                return exists != null;
            }
        }
    }

    // 插入新 Deck，version 从 1 开始
    public Deck? InsertDeck(string title, string author, long createdAt, long updatedAt)
    {
        string sql = @"
            INSERT INTO decks (title, author, is_deleted, version, created_at, updated_at)
            VALUES (@title, @author, 0, 1, @created_at, @updated_at)
            RETURNING id, title, author, is_deleted, version, created_at, updated_at;
        ";

        Deck? deck = null;

        using (var conn = new NpgsqlConnection(_connectionString))
        {
            conn.Open();

            using (var cmd = new NpgsqlCommand(sql, conn))
            {
                cmd.Parameters.AddWithValue("title", title);
                cmd.Parameters.AddWithValue("author", author);
                cmd.Parameters.AddWithValue("created_at", createdAt);
                cmd.Parameters.AddWithValue("updated_at", updatedAt);

                using (var reader = cmd.ExecuteReader())
                {
                    if (reader.Read())
                    {
                        deck = MapDeck(reader);
                    }
                }
            }
        }

        return deck;
    }

    // 软删：存在返回 true；不存在返回 false；已软删不重复更新
    public bool SoftDeleteDeck(int id, long updatedAt)
    {
        int? isDeleted = null;

        using (var conn = new NpgsqlConnection(_connectionString))
        {
            conn.Open();

            string selectSql = @"
                SELECT is_deleted
                FROM decks
                WHERE id = @id
                LIMIT 1
            ";

            using (var selectCmd = new NpgsqlCommand(selectSql, conn))
            {
                selectCmd.Parameters.AddWithValue("id", id);

                using (var reader = selectCmd.ExecuteReader())
                {
                    if (reader.Read())
                    {
                        isDeleted = reader.GetInt32(reader.GetOrdinal("is_deleted"));
                    }
                }
            }

            if (isDeleted is null)
            {
                // 不存在
                return false;
            }

            if (isDeleted == 0)
            {
                string updateSql = @"
                    UPDATE decks
                    SET is_deleted = 1,
                        updated_at = @updated_at
                    WHERE id = @id
                ";

                using (var updateCmd = new NpgsqlCommand(updateSql, conn))
                {
                    updateCmd.Parameters.AddWithValue("id", id);
                    updateCmd.Parameters.AddWithValue("updated_at", updatedAt);
                    updateCmd.ExecuteNonQuery();
                }
            }

            return true;
        }
    }

    // 带 expectedVersion 的乐观并发更新
    public Deck? UpdateDeck(
        int id,
        int expectedVersion,
        string? newTitle,
        string? newAuthor,
        long updatedAt,
        out bool versionConflict)
    {
        versionConflict = false;

        bool hasTitle = !string.IsNullOrWhiteSpace(newTitle);
        bool hasAuthor = !string.IsNullOrWhiteSpace(newAuthor);

        if (!hasTitle && !hasAuthor)
        {
            // 理论上不会走到这里，Controller 已经校验过
            return null;
        }

        // 1) 根据要改的字段构造 UPDATE 语句
        string sql;

        if (hasTitle && hasAuthor)
        {
            sql = @"
                UPDATE decks
                SET title = @title,
                    author = @author,
                    version = version + 1,
                    updated_at = @updated_at
                WHERE id = @id
                  AND is_deleted = 0
                  AND version = @expected_version
                RETURNING id, title, author, is_deleted, version, created_at, updated_at;
            ";
        }
        else if (hasTitle)
        {
            sql = @"
                UPDATE decks
                SET title = @title,
                    version = version + 1,
                    updated_at = @updated_at
                WHERE id = @id
                  AND is_deleted = 0
                  AND version = @expected_version
                RETURNING id, title, author, is_deleted, version, created_at, updated_at;
            ";
        }
        else // 只改 author
        {
            sql = @"
                UPDATE decks
                SET author = @author,
                    version = version + 1,
                    updated_at = @updated_at
                WHERE id = @id
                  AND is_deleted = 0
                  AND version = @expected_version
                RETURNING id, title, author, is_deleted, version, created_at, updated_at;
            ";
        }

        using (var conn = new NpgsqlConnection(_connectionString))
        {
            conn.Open();

            Deck? updated = null;

            // 2) 尝试带 version 条件的 UPDATE
            using (var cmd = new NpgsqlCommand(sql, conn))
            {
                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("expected_version", expectedVersion);
                cmd.Parameters.AddWithValue("updated_at", updatedAt);

                if (hasTitle)
                {
                    cmd.Parameters.AddWithValue("title", newTitle!);
                }
                if (hasAuthor)
                {
                    cmd.Parameters.AddWithValue("author", newAuthor!);
                }

                using (var reader = cmd.ExecuteReader())
                {
                    if (reader.Read())
                    {
                        updated = MapDeck(reader);
                    }
                }
            }

            // 2.1 如果更新成功，直接返回
            if (updated != null)
            {
                return updated;
            }

            // 3) 没有更新到行：要区分是 NotFound 还是 VersionConflict
            string checkSql = @"
                SELECT is_deleted
                FROM decks
                WHERE id = @id
                LIMIT 1
            ";

            using (var checkCmd = new NpgsqlCommand(checkSql, conn))
            {
                checkCmd.Parameters.AddWithValue("id", id);

                using (var reader = checkCmd.ExecuteReader())
                {
                    if (!reader.Read())
                    {
                        // 根本没有这条 id
                        versionConflict = false;
                        return null;
                    }

                    int isDeleted = reader.GetInt32(reader.GetOrdinal("is_deleted"));

                    if (isDeleted != 0)
                    {
                        // 已软删，我们视为 NotFound
                        versionConflict = false;
                        return null;
                    }

                    // 有这条记录、未删，但 version 不匹配 → 版本冲突
                    versionConflict = true;
                    return null;
                }
            }
        }
    }
}