// backend/src/Host/RecallSmith.Api/Infrastructure/Cards/CardRepository.cs
using System;
using System.Collections.Generic;
using Microsoft.Extensions.Configuration;
using Npgsql;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Cards
{
    public class CardRepository : ICardRepository
    {
        private readonly string _connectionString;

        public CardRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DecksDb")
                               ?? throw new InvalidOperationException("Connection string 'DecksDb' is not configured.");
        }

        private Card MapCard(NpgsqlDataReader reader)
        {
            int idxId = reader.GetOrdinal("id");
            int idxDeckId = reader.GetOrdinal("deck_id");
            int idxStableUid = reader.GetOrdinal("stable_uid");
            int idxQuestion = reader.GetOrdinal("question");
            int idxExplanation = reader.GetOrdinal("explanation");
            int idxSnippet = reader.GetOrdinal("code_snippet");
            int idxLang = reader.GetOrdinal("code_language");
            int idxDifficulty = reader.GetOrdinal("difficulty");
            int idxOrder = reader.GetOrdinal("order_in_deck");
            int idxIsDeleted = reader.GetOrdinal("is_deleted");
            int idxVersion = reader.GetOrdinal("version");
            int idxCreatedAt = reader.GetOrdinal("created_at");
            int idxUpdatedAt = reader.GetOrdinal("updated_at");

            string? explanation = null;
            if (!reader.IsDBNull(idxExplanation))
            {
                explanation = reader.GetString(idxExplanation);
            }

            string? snippet = null;
            if (!reader.IsDBNull(idxSnippet))
            {
                snippet = reader.GetString(idxSnippet);
            }

            string? lang = null;
            if (!reader.IsDBNull(idxLang))
            {
                lang = reader.GetString(idxLang);
            }

            return new Card
            {
                Id = reader.GetInt32(idxId),
                DeckId = reader.GetInt32(idxDeckId),
                StableUid = reader.GetString(idxStableUid),
                Question = reader.GetString(idxQuestion),
                Explanation = explanation,
                CodeSnippet = snippet,
                CodeLanguage = lang,
                Difficulty = reader.GetInt16(idxDifficulty),
                OrderInDeck = reader.GetInt32(idxOrder),
                IsDeleted = reader.GetInt32(idxIsDeleted),
                Version = reader.GetInt32(idxVersion),
                CreatedAt = reader.GetInt64(idxCreatedAt),
                UpdatedAt = reader.GetInt64(idxUpdatedAt)
            };
        }

        public List<Card> GetCardsByDeckId(int deckId)
        {
            List<Card> cards = new List<Card>();

            string sql = @"
                SELECT id, deck_id, stable_uid,
                       question, explanation, code_snippet, code_language,
                       difficulty, order_in_deck,
                       is_deleted, version, created_at, updated_at
                FROM cards
                WHERE deck_id = @deck_id
                  AND is_deleted = 0
                ORDER BY order_in_deck ASC, created_at ASC;
            ";

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("deck_id", deckId);

                    using (var reader = cmd.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            Card card = MapCard(reader);
                            cards.Add(card);
                        }
                    }
                }
            }

            return cards;
        }

        public Card? GetCardById(int id)
        {
            Card? card = null;

            string sql = @"
                SELECT id, deck_id, stable_uid,
                       question, explanation, code_snippet, code_language,
                       difficulty, order_in_deck,
                       is_deleted, version, created_at, updated_at
                FROM cards
                WHERE id = @id
                  AND is_deleted = 0
                LIMIT 1;
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
                            card = MapCard(reader);
                        }
                    }
                }
            }

            return card;
        }

        public bool ExistsStableUid(int deckId, string stableUid, int? excludeId)
        {
            string sql = @"
                SELECT 1
                FROM cards
                WHERE deck_id = @deck_id
                  AND stable_uid = @stable_uid
            ";

            if (excludeId.HasValue)
            {
                sql += " AND id <> @exclude_id";
            }

            sql += " LIMIT 1";

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("deck_id", deckId);
                    cmd.Parameters.AddWithValue("stable_uid", stableUid);

                    if (excludeId.HasValue)
                    {
                        cmd.Parameters.AddWithValue("exclude_id", excludeId.Value);
                    }

                    object? result = cmd.ExecuteScalar();
                    return result != null;
                }
            }
        }

        public Card? InsertCard(
            int deckId,
            string stableUid,
            string question,
            string? explanation,
            string? codeSnippet,
            string? codeLanguage,
            short difficulty,
            int orderInDeck,
            long createdAt,
            long updatedAt)
        {
            const string sql = @"
                INSERT INTO cards (
                    deck_id, stable_uid,
                    question, explanation, code_snippet, code_language,
                    difficulty, order_in_deck,
                    is_deleted, version, created_at, updated_at
                )
                VALUES (
                    @deck_id, @stable_uid,
                    @question, @explanation, @code_snippet, @code_language,
                    @difficulty, @order_in_deck,
                    0, 1, @created_at, @updated_at
                )
                RETURNING id, deck_id, stable_uid,
                          question, explanation, code_snippet, code_language,
                          difficulty, order_in_deck,
                          is_deleted, version, created_at, updated_at;
            ";

            Card? card = null;

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("deck_id", deckId);
                    cmd.Parameters.AddWithValue("stable_uid", stableUid);
                    cmd.Parameters.AddWithValue("question", question);

                    if (explanation == null)
                    {
                        cmd.Parameters.AddWithValue("explanation", DBNull.Value);
                    }
                    else
                    {
                        cmd.Parameters.AddWithValue("explanation", explanation);
                    }

                    if (codeSnippet == null)
                    {
                        cmd.Parameters.AddWithValue("code_snippet", DBNull.Value);
                    }
                    else
                    {
                        cmd.Parameters.AddWithValue("code_snippet", codeSnippet);
                    }

                    if (codeLanguage == null)
                    {
                        cmd.Parameters.AddWithValue("code_language", DBNull.Value);
                    }
                    else
                    {
                        cmd.Parameters.AddWithValue("code_language", codeLanguage);
                    }

                    cmd.Parameters.AddWithValue("difficulty", difficulty);
                    cmd.Parameters.AddWithValue("order_in_deck", orderInDeck);
                    cmd.Parameters.AddWithValue("created_at", createdAt);
                    cmd.Parameters.AddWithValue("updated_at", updatedAt);

                    using (var reader = cmd.ExecuteReader())
                    {
                        if (reader.Read())
                        {
                            card = MapCard(reader);
                        }
                    }
                }
            }

            return card;
        }

        public bool SoftDeleteCard(int id, long updatedAt)
        {
            int? isDeleted = null;

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                const string selectSql = @"
                    SELECT is_deleted
                    FROM cards
                    WHERE id = @id
                    LIMIT 1;
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
                    const string updateSql = @"
                        UPDATE cards
                        SET is_deleted = 1,
                            updated_at = @updated_at,
                            version    = version + 1
                        WHERE id = @id;
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

        public Card? UpdateCard(
            int id,
            int expectedVersion,
            string? question,
            string? explanation,
            string? codeSnippet,
            string? codeLanguage,
            short? difficulty,
            int? orderInDeck,
            long updatedAt,
            out bool versionConflict)
        {
            versionConflict = false;

            bool hasQuestion = !string.IsNullOrWhiteSpace(question);
            bool hasExplanation = explanation != null;
            bool hasSnippet = codeSnippet != null;
            bool hasLanguage = codeLanguage != null;
            bool hasDifficulty = difficulty.HasValue;
            bool hasOrder = orderInDeck.HasValue;

            if (!hasQuestion && !hasExplanation && !hasSnippet && !hasLanguage && !hasDifficulty && !hasOrder)
            {
                // 上层应该已经校验，这里只是兜底
                return null;
            }

            // 构造 SET 子句
            List<string> setParts = new List<string>();

            if (hasQuestion)
            {
                setParts.Add("question = @question");
            }
            if (hasExplanation)
            {
                setParts.Add("explanation = @explanation");
            }
            if (hasSnippet)
            {
                setParts.Add("code_snippet = @code_snippet");
            }
            if (hasLanguage)
            {
                setParts.Add("code_language = @code_language");
            }
            if (hasDifficulty)
            {
                setParts.Add("difficulty = @difficulty");
            }
            if (hasOrder)
            {
                setParts.Add("order_in_deck = @order_in_deck");
            }

            setParts.Add("version = version + 1");
            setParts.Add("updated_at = @updated_at");

            string setClause = string.Join(", ", setParts);

            string sql = $@"
                UPDATE cards
                SET {setClause}
                WHERE id = @id
                  AND is_deleted = 0
                  AND version = @expected_version
                RETURNING id, deck_id, stable_uid,
                          question, explanation, code_snippet, code_language,
                          difficulty, order_in_deck,
                          is_deleted, version, created_at, updated_at;
            ";

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                Card? updated = null;

                using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("id", id);
                    cmd.Parameters.AddWithValue("expected_version", expectedVersion);
                    cmd.Parameters.AddWithValue("updated_at", updatedAt);

                    if (hasQuestion)
                    {
                        cmd.Parameters.AddWithValue("question", question!.Trim());
                    }

                    if (hasExplanation)
                    {
                        if (explanation == null)
                        {
                            cmd.Parameters.AddWithValue("explanation", DBNull.Value);
                        }
                        else
                        {
                            cmd.Parameters.AddWithValue("explanation", explanation);
                        }
                    }

                    if (hasSnippet)
                    {
                        if (codeSnippet == null)
                        {
                            cmd.Parameters.AddWithValue("code_snippet", DBNull.Value);
                        }
                        else
                        {
                            cmd.Parameters.AddWithValue("code_snippet", codeSnippet);
                        }
                    }

                    if (hasLanguage)
                    {
                        if (codeLanguage == null)
                        {
                            cmd.Parameters.AddWithValue("code_language", DBNull.Value);
                        }
                        else
                        {
                            cmd.Parameters.AddWithValue("code_language", codeLanguage);
                        }
                    }

                    if (hasDifficulty)
                    {
                        cmd.Parameters.AddWithValue("difficulty", difficulty!.Value);
                    }

                    if (hasOrder)
                    {
                        cmd.Parameters.AddWithValue("order_in_deck", orderInDeck!.Value);
                    }

                    using (var reader = cmd.ExecuteReader())
                    {
                        if (reader.Read())
                        {
                            updated = MapCard(reader);
                        }
                    }
                }

                if (updated != null)
                {
                    return updated;
                }

                // 没更新到任何行：要区分 NotFound vs VersionConflict
                const string checkSql = @"
                    SELECT is_deleted
                    FROM cards
                    WHERE id = @id
                    LIMIT 1;
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
                            return null; // 软删视为不存在
                        }

                        // 记录存在且未删，但 version 条件不匹配 -> 冲突
                        versionConflict = true;
                        return null;
                    }
                }
            }
        }
    }
}