// backend/src/Host/RecallSmith.Api/Infrastructure/Catalog/CatalogCardRepository.cs
using System;
using System.Collections.Generic;
using Microsoft.Extensions.Configuration;
using Npgsql;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Catalog
{
    public class CatalogCardRepository : ICatalogCardRepository
    {
        private readonly string _connectionString;

        public CatalogCardRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("CatalogDb")
                               ?? throw new InvalidOperationException("Connection string 'CatalogDb' is not configured.");
        }

        private CatalogCard MapCatalogCard(NpgsqlDataReader reader)
        {
            int idxId = reader.GetOrdinal("id");
            int idxSlug = reader.GetOrdinal("deck_slug");
            int idxVersion = reader.GetOrdinal("deck_version");
            int idxStableUid = reader.GetOrdinal("stable_uid");
            int idxQuestion = reader.GetOrdinal("question");
            int idxExpl = reader.GetOrdinal("explanation");
            int idxSnippet = reader.GetOrdinal("code_snippet");
            int idxLang = reader.GetOrdinal("code_language");
            int idxDiff = reader.GetOrdinal("difficulty");
            int idxOrder = reader.GetOrdinal("order_in_deck");
            int idxCreated = reader.GetOrdinal("created_at");
            int idxUpdated = reader.GetOrdinal("updated_at");

            string? explanation = null;
            if (!reader.IsDBNull(idxExpl))
            {
                explanation = reader.GetString(idxExpl);
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

            return new RecallSmith.Api.Models.CatalogCard
            {
                Id = reader.GetInt32(idxId),
                DeckSlug = reader.GetString(idxSlug),
                DeckVersion = reader.GetString(idxVersion),
                StableUid = reader.GetString(idxStableUid),
                Question = reader.GetString(idxQuestion),
                Explanation = explanation,
                CodeSnippet = snippet,
                CodeLanguage = lang,
                Difficulty = reader.GetInt16(idxDiff),
                OrderInDeck = reader.GetInt32(idxOrder),
                CreatedAt = reader.GetInt64(idxCreated),
                UpdatedAt = reader.GetInt64(idxUpdated)
            };
        }

        public List<CatalogCard> GetCards(string deckSlug, string deckVersion, int page, int pageSize)
        {
            List<CatalogCard> list = new List<CatalogCard>();

            if (page <= 0) page = 1;
            if (pageSize <= 0) pageSize = 50;

            int limit = pageSize;
            int offset = (page - 1) * pageSize;

            string sql = @"
                SELECT id, deck_slug, deck_version,
                       stable_uid,
                       question, explanation, code_snippet, code_language,
                       difficulty, order_in_deck,
                       created_at, updated_at
                FROM catalog_cards
                WHERE deck_slug = @deck_slug
                  AND deck_version = @deck_version
                ORDER BY order_in_deck ASC, id ASC
                LIMIT @limit OFFSET @offset;
            ";

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("deck_slug", deckSlug);
                    cmd.Parameters.AddWithValue("deck_version", deckVersion);
                    cmd.Parameters.AddWithValue("limit", limit);
                    cmd.Parameters.AddWithValue("offset", offset);

                    using (var reader = cmd.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            CatalogCard card = MapCatalogCard(reader);
                            list.Add(card);
                        }
                    }
                }
            }

            return list;
        }

        public void InsertCardsForDeck(
            string deckSlug,
            string deckVersion,
            IReadOnlyList<Card> sourceCards,
            long createdAt,
            long updatedAt)
        {
            if (sourceCards == null || sourceCards.Count == 0)
            {
                return;
            }

            const string sql = @"
                INSERT INTO catalog_cards (
                    deck_slug,
                    deck_version,
                    stable_uid,
                    question,
                    explanation,
                    code_snippet,
                    code_language,
                    difficulty,
                    order_in_deck,
                    created_at,
                    updated_at
                )
                VALUES (
                    @deck_slug,
                    @deck_version,
                    @stable_uid,
                    @question,
                    @explanation,
                    @code_snippet,
                    @code_language,
                    @difficulty,
                    @order_in_deck,
                    @created_at,
                    @updated_at
                );
            ";

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                foreach (var card in sourceCards)
                {
                    using (var cmd = new NpgsqlCommand(sql, conn))
                    {
                        cmd.Parameters.AddWithValue("deck_slug", deckSlug);
                        cmd.Parameters.AddWithValue("deck_version", deckVersion);
                        cmd.Parameters.AddWithValue("stable_uid", card.StableUid);
                        cmd.Parameters.AddWithValue("question", card.Question);

                        if (card.Explanation == null)
                        {
                            cmd.Parameters.AddWithValue("explanation", DBNull.Value);
                        }
                        else
                        {
                            cmd.Parameters.AddWithValue("explanation", card.Explanation);
                        }

                        if (card.CodeSnippet == null)
                        {
                            cmd.Parameters.AddWithValue("code_snippet", DBNull.Value);
                        }
                        else
                        {
                            cmd.Parameters.AddWithValue("code_snippet", card.CodeSnippet);
                        }

                        if (card.CodeLanguage == null)
                        {
                            cmd.Parameters.AddWithValue("code_language", DBNull.Value);
                        }
                        else
                        {
                            cmd.Parameters.AddWithValue("code_language", card.CodeLanguage);
                        }

                        cmd.Parameters.AddWithValue("difficulty", card.Difficulty);
                        cmd.Parameters.AddWithValue("order_in_deck", card.OrderInDeck);
                        cmd.Parameters.AddWithValue("created_at", createdAt);
                        cmd.Parameters.AddWithValue("updated_at", updatedAt);

                        cmd.ExecuteNonQuery();
                    }
                }
            }
        }
    }
}