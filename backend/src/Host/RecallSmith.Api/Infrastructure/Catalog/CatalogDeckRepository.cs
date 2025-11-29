// backend/src/Host/RecallSmith.Api/Infrastructure/Catalog/CatalogDeckRepository.cs
using System;
using System.Collections.Generic;
using Microsoft.Extensions.Configuration;
using Npgsql;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Catalog
{
    public class CatalogDeckRepository : ICatalogDeckRepository
    {
        private readonly string _connectionString;

        public CatalogDeckRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("CatalogDb")
                               ?? throw new InvalidOperationException("Connection string 'CatalogDb' is not configured.");
        }

        private CatalogDeck MapCatalogDeck(NpgsqlDataReader reader)
        {
            int idxId = reader.GetOrdinal("id");
            int idxSlug = reader.GetOrdinal("slug");
            int idxVersion = reader.GetOrdinal("version");
            int idxTitle = reader.GetOrdinal("title");
            int idxDesc = reader.GetOrdinal("description");
            int idxLocale = reader.GetOrdinal("locale");
            int idxIsFree = reader.GetOrdinal("is_free_starter");
            int idxTotalCards = reader.GetOrdinal("total_cards");
            int idxFreeCards = reader.GetOrdinal("free_card_count");
            int idxDeckType = reader.GetOrdinal("deck_type");
            int idxSourceDeckId = reader.GetOrdinal("source_deck_id");
            int idxCreatedAt = reader.GetOrdinal("created_at");
            int idxUpdatedAt = reader.GetOrdinal("updated_at");
            int idxPublishedAt = reader.GetOrdinal("published_at");

            string? description = null;
            if (!reader.IsDBNull(idxDesc))
            {
                description = reader.GetString(idxDesc);
            }

            int? sourceDeckId = null;
            if (!reader.IsDBNull(idxSourceDeckId))
            {
                sourceDeckId = reader.GetInt32(idxSourceDeckId);
            }

            return new CatalogDeck
            {
                Id = reader.GetInt32(idxId),
                Slug = reader.GetString(idxSlug),
                Version = reader.GetString(idxVersion),
                Title = reader.GetString(idxTitle),
                Description = description,
                Locale = reader.GetString(idxLocale),
                IsFreeStarter = reader.GetBoolean(idxIsFree),
                TotalCards = reader.GetInt32(idxTotalCards),
                FreeCardCount = reader.GetInt32(idxFreeCards),
                DeckType = reader.GetInt16(idxDeckType),
                SourceDeckId = sourceDeckId,
                CreatedAt = reader.GetInt64(idxCreatedAt),
                UpdatedAt = reader.GetInt64(idxUpdatedAt),
                PublishedAt = reader.GetInt64(idxPublishedAt)
            };
        }

        public List<CatalogDeck> GetDecks(string? locale, int page, int pageSize)
        {
            List<CatalogDeck> list = new List<CatalogDeck>();

            if (page <= 0) page = 1;
            if (pageSize <= 0) pageSize = 10;

            int limit = pageSize;
            int offset = (page - 1) * pageSize;

            string sql = @"
                SELECT id, slug, version, title, description, locale,
                       is_free_starter, total_cards, free_card_count,
                       deck_type, source_deck_id,
                       created_at, updated_at, published_at
                FROM catalog_decks
            ";

            bool filterByLocale = !string.IsNullOrWhiteSpace(locale);
            if (filterByLocale)
            {
                sql += " WHERE locale = @locale";
            }

            sql += @"
                ORDER BY is_free_starter DESC, published_at DESC
                LIMIT @limit OFFSET @offset;
            ";

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    if (filterByLocale)
                    {
                        cmd.Parameters.AddWithValue("locale", locale!.Trim());
                    }

                    cmd.Parameters.AddWithValue("limit", limit);
                    cmd.Parameters.AddWithValue("offset", offset);

                    using (var reader = cmd.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            CatalogDeck deck = MapCatalogDeck(reader);
                            list.Add(deck);
                        }
                    }
                }
            }

            return list;
        }

        public CatalogDeck? GetBySlugAndVersion(string slug, string version)
        {
            CatalogDeck? deck = null;

            string sql = @"
                SELECT id, slug, version, title, description, locale,
                       is_free_starter, total_cards, free_card_count,
                       deck_type, source_deck_id,
                       created_at, updated_at, published_at
                FROM catalog_decks
                WHERE slug = @slug
                  AND version = @version
                LIMIT 1;
            ";

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("slug", slug);
                    cmd.Parameters.AddWithValue("version", version);

                    using (var reader = cmd.ExecuteReader())
                    {
                        if (reader.Read())
                        {
                            deck = MapCatalogDeck(reader);
                        }
                    }
                }
            }

            return deck;
        }

        public bool ExistsSlugAndVersion(string slug, string version)
        {
            const string sql = @"
                SELECT 1
                FROM catalog_decks
                WHERE slug = @slug
                  AND version = @version
                LIMIT 1;
            ";

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("slug", slug);
                    cmd.Parameters.AddWithValue("version", version);

                    object? result = cmd.ExecuteScalar();
                    return result != null;
                }
            }
        }

        public CatalogDeck? InsertDeck(
            string slug,
            string version,
            string title,
            string? description,
            string locale,
            bool isFreeStarter,
            int totalCards,
            int freeCardCount,
            short deckType,
            int? sourceDeckId,
            long createdAt,
            long updatedAt,
            long publishedAt)
        {
            const string sql = @"
                INSERT INTO catalog_decks (
                    slug,
                    version,
                    title,
                    description,
                    locale,
                    is_free_starter,
                    total_cards,
                    free_card_count,
                    deck_type,
                    source_deck_id,
                    created_at,
                    updated_at,
                    published_at
                )
                VALUES (
                    @slug,
                    @version,
                    @title,
                    @description,
                    @locale,
                    @is_free_starter,
                    @total_cards,
                    @free_card_count,
                    @deck_type,
                    @source_deck_id,
                    @created_at,
                    @updated_at,
                    @published_at
                )
                RETURNING id, slug, version, title, description, locale,
                          is_free_starter, total_cards, free_card_count,
                          deck_type, source_deck_id,
                          created_at, updated_at, published_at;
            ";

            CatalogDeck? deck = null;

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("slug", slug);
                    cmd.Parameters.AddWithValue("version", version);
                    cmd.Parameters.AddWithValue("title", title);

                    if (description == null)
                    {
                        cmd.Parameters.AddWithValue("description", DBNull.Value);
                    }
                    else
                    {
                        cmd.Parameters.AddWithValue("description", description);
                    }

                    cmd.Parameters.AddWithValue("locale", locale);
                    cmd.Parameters.AddWithValue("is_free_starter", isFreeStarter);
                    cmd.Parameters.AddWithValue("total_cards", totalCards);
                    cmd.Parameters.AddWithValue("free_card_count", freeCardCount);
                    cmd.Parameters.AddWithValue("deck_type", deckType);

                    if (sourceDeckId.HasValue)
                    {
                        cmd.Parameters.AddWithValue("source_deck_id", sourceDeckId.Value);
                    }
                    else
                    {
                        cmd.Parameters.AddWithValue("source_deck_id", DBNull.Value);
                    }

                    cmd.Parameters.AddWithValue("created_at", createdAt);
                    cmd.Parameters.AddWithValue("updated_at", updatedAt);
                    cmd.Parameters.AddWithValue("published_at", publishedAt);

                    using (var reader = cmd.ExecuteReader())
                    {
                        if (reader.Read())
                        {
                            deck = MapCatalogDeck(reader);
                        }
                    }
                }
            }

            return deck;
        }
    }
}