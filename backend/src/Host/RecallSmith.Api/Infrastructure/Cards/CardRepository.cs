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
    }
}