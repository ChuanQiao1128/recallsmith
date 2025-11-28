// backend/src/Host/RecallSmith.Api/Infrastructure/Decks/DeckRepository.cs
using System;
using System.Collections.Generic;
using Microsoft.Extensions.Configuration;
using Npgsql;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Decks
{
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
            int idxId = reader.GetOrdinal("id");
            int idxSlug = reader.GetOrdinal("slug");
            int idxTitle = reader.GetOrdinal("title");
            int idxAuthor = reader.GetOrdinal("author");
            int idxDesc = reader.GetOrdinal("description");
            int idxLocale = reader.GetOrdinal("locale");
            int idxDeckType = reader.GetOrdinal("deck_type");
            int idxIsDeleted = reader.GetOrdinal("is_deleted");
            int idxVersion = reader.GetOrdinal("version");
            int idxCreatedAt = reader.GetOrdinal("created_at");
            int idxUpdatedAt = reader.GetOrdinal("updated_at");

            string? description = null;
            if (!reader.IsDBNull(idxDesc))
            {
                description = reader.GetString(idxDesc);
            }

            return new Deck
            {
                Id = reader.GetInt32(idxId),
                Slug = reader.GetString(idxSlug),
                Title = reader.GetString(idxTitle),
                Author = reader.GetString(idxAuthor),
                Description = description,
                Locale = reader.GetString(idxLocale),
                DeckType = reader.GetInt16(idxDeckType),
                IsDeleted = reader.GetInt32(idxIsDeleted),
                Version = reader.GetInt32(idxVersion),
                CreatedAt = reader.GetInt64(idxCreatedAt),
                UpdatedAt = reader.GetInt64(idxUpdatedAt)
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
                SELECT id, slug, title, author, description, locale, deck_type,
                       is_deleted, version, created_at, updated_at
                FROM decks
                WHERE is_deleted = 0
            ";

            if (hasKeyword)
            {
                sql += " AND title ILIKE @keyword";
            }

            sql += sortCreatedAtAsc
                ? " ORDER BY created_at ASC"
                : " ORDER BY created_at DESC";

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
                            Deck deck = MapDeck(reader);
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
                SELECT id, slug, title, author, description, locale, deck_type,
                       is_deleted, version, created_at, updated_at
                FROM decks
                WHERE id = @id
                  AND is_deleted = 0
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

                    object? result = cmd.ExecuteScalar();
                    return result != null;
                }
            }
        }

        public bool ExistsSlug(string slug, int? excludeId)
        {
            string sql = @"
                SELECT 1
                FROM decks
                WHERE slug = @slug
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
                    cmd.Parameters.AddWithValue("slug", slug);

                    if (excludeId.HasValue)
                    {
                        cmd.Parameters.AddWithValue("excludeId", excludeId.Value);
                    }

                    object? result = cmd.ExecuteScalar();
                    return result != null;
                }
            }
        }

        public Deck? InsertDeck(
            string slug,
            string title,
            string author,
            string? description,
            string locale,
            short deckType,
            long createdAt,
            long updatedAt)
        {
            const string sql = @"
                INSERT INTO decks (
                    slug, title, author, description, locale, deck_type,
                    is_deleted, version, created_at, updated_at
                )
                VALUES (
                    @slug, @title, @author, @description, @locale, @deck_type,
                    0, 1, @created_at, @updated_at
                )
                RETURNING id, slug, title, author, description, locale, deck_type,
                          is_deleted, version, created_at, updated_at;
            ";

            Deck? deck = null;

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("slug", slug);
                    cmd.Parameters.AddWithValue("title", title);
                    cmd.Parameters.AddWithValue("author", author);

                    if (description == null)
                    {
                        cmd.Parameters.AddWithValue("description", DBNull.Value);
                    }
                    else
                    {
                        cmd.Parameters.AddWithValue("description", description);
                    }

                    cmd.Parameters.AddWithValue("locale", locale);
                    cmd.Parameters.AddWithValue("deck_type", deckType);
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
            int? isDeleted = null;

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                const string selectSql = @"
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
                    return false;
                }

                if (isDeleted == 0)
                {
                    const string updateSql = @"
                        UPDATE decks
                        SET is_deleted = 1,
                            updated_at = @updated_at,
                            version    = version + 1
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

        public Deck? UpdateDeck(
            int id,
            int expectedVersion,
            string? newTitle,
            string? newAuthor,
            string? newDescription,
            string? newLocale,
            long updatedAt,
            out bool versionConflict)
        {
            versionConflict = false;

            bool hasTitle = !string.IsNullOrWhiteSpace(newTitle);
            bool hasAuthor = !string.IsNullOrWhiteSpace(newAuthor);
            bool hasDescription = newDescription != null;           // 描述允许置空
            bool hasLocale = !string.IsNullOrWhiteSpace(newLocale);

            if (!hasTitle && !hasAuthor && !hasDescription && !hasLocale)
            {
                // 理论上不会走到这里，Controller / Service 已经校验
                return null;
            }

            // 构造动态 SET 子句
            List<string> setParts = new List<string>();

            if (hasTitle)
            {
                setParts.Add("title = @title");
            }
            if (hasAuthor)
            {
                setParts.Add("author = @author");
            }
            if (hasDescription)
            {
                setParts.Add("description = @description");
            }
            if (hasLocale)
            {
                setParts.Add("locale = @locale");
            }

            setParts.Add("version = version + 1");
            setParts.Add("updated_at = @updated_at");

            string setClause = string.Join(", ", setParts);

            string sql = $@"
                UPDATE decks
                SET {setClause}
                WHERE id = @id
                  AND is_deleted = 0
                  AND version = @expected_version
                RETURNING id, slug, title, author, description, locale, deck_type,
                          is_deleted, version, created_at, updated_at;
            ";

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                Deck? updated = null;

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
                    if (hasDescription)
                    {
                        if (newDescription == null)
                        {
                            cmd.Parameters.AddWithValue("description", DBNull.Value);
                        }
                        else
                        {
                            cmd.Parameters.AddWithValue("description", newDescription);
                        }
                    }
                    if (hasLocale)
                    {
                        cmd.Parameters.AddWithValue("locale", newLocale!);
                    }

                    using (var reader = cmd.ExecuteReader())
                    {
                        if (reader.Read())
                        {
                            updated = MapDeck(reader);
                        }
                    }
                }

                if (updated != null)
                {
                    return updated;
                }

                // 没更新到任何行，区分 NotFound vs VersionConflict
                const string checkSql = @"
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
                            versionConflict = false;
                            return null; // 不存在
                        }

                        int isDeleted = reader.GetInt32(reader.GetOrdinal("is_deleted"));
                        if (isDeleted != 0)
                        {
                            versionConflict = false;
                            return null; // 软删 -> 当作不存在
                        }

                        // 记录存在、未软删，但 version 不匹配 -> 并发冲突
                        versionConflict = true;
                        return null;
                    }
                }
            }
        }
    }
}