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

    private Deck MapDeck(NpgsqlDataReader reader)
    {
        return new Deck
        {
            Id = reader.GetInt32(reader.GetOrdinal("id")),
            Title = reader.GetString(reader.GetOrdinal("title")),
            Author = reader.GetString(reader.GetOrdinal("author")),
            IsDeleted = reader.GetInt32(reader.GetOrdinal("is_deleted")),
            CreatedAt = reader.GetInt64(reader.GetOrdinal("created_at")),
            UpdatedAt = reader.GetInt64(reader.GetOrdinal("updated_at"))
        };
    }

    public List<Deck> GetDecks(string? title, bool sortCreatedAtAsc, int page, int pageSize)
    {
        List<Deck> deckList = new List<Deck>();

        bool hasKeyword = !string.IsNullOrWhiteSpace(title);
        string? keyword = hasKeyword ? title!.Trim() : null;

        int limit = pageSize;
        int offset = (page - 1) * pageSize;

        string sql = @"
            SELECT id, title, author, is_deleted, created_at, updated_at
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

    public Deck? GetDeckById(int id)
    {
        Deck? deck = null;

        string sql = @"
            SELECT id, title, author, is_deleted, created_at, updated_at
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

    public Deck? InsertDeck(string title, string author, long createdAt, long updatedAt)
    {
        string sql = @"
            INSERT INTO decks (title, author, is_deleted, created_at, updated_at)
            VALUES (@title, @author, 0, @created_at, @updated_at)
            RETURNING id, title, author, is_deleted, created_at, updated_at;
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

    public bool SoftDeleteDeck(int id, long updatedAt)
    {
        // 1) 先看是否存在
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

            // 存在：如果未软删，则执行软删；已软删就不动
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

    public Deck? UpdateDeck(int id, string? newTitle, string? newAuthor, long updatedAt)
    {
        // 构造 UPDATE 语句：根据有没有 title/author 决定 set 哪些列
        string sql;

        if (!string.IsNullOrWhiteSpace(newTitle) && !string.IsNullOrWhiteSpace(newAuthor))
        {
            sql = @"
                UPDATE decks
                SET title = @title,
                    author = @author,
                    updated_at = @updated_at
                WHERE id = @id AND is_deleted = 0
                RETURNING id, title, author, is_deleted, created_at, updated_at;
            ";
        }
        else if (!string.IsNullOrWhiteSpace(newTitle))
        {
            sql = @"
                UPDATE decks
                SET title = @title,
                    updated_at = @updated_at
                WHERE id = @id AND is_deleted = 0
                RETURNING id, title, author, is_deleted, created_at, updated_at;
            ";
        }
        else if (!string.IsNullOrWhiteSpace(newAuthor))
        {
            sql = @"
                UPDATE decks
                SET author = @author,
                    updated_at = @updated_at
                WHERE id = @id AND is_deleted = 0
                RETURNING id, title, author, is_deleted, created_at, updated_at;
            ";
        }
        else
        {
            // 这里理论上不会走到，因为控制器已经保证至少有一个字段
            return null;
        }

        Deck? updated = null;

        using (var conn = new NpgsqlConnection(_connectionString))
        {
            conn.Open();

            using (var cmd = new NpgsqlCommand(sql, conn))
            {
                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("updated_at", updatedAt);

                if (!string.IsNullOrWhiteSpace(newTitle))
                {
                    cmd.Parameters.AddWithValue("title", newTitle!);
                }
                if (!string.IsNullOrWhiteSpace(newAuthor))
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
        }

        return updated;
    }
}