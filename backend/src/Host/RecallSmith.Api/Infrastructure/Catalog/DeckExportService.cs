// Infrastructure/Catalog/DeckExportService.cs
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Npgsql;
using RecallSmith.Api.Application.Catalog;

namespace RecallSmith.Api.Infrastructure.Catalog
{
    public class DeckExportService : IDeckExportService
    {
        private readonly string _connectionString;

        public DeckExportService(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("CatalogDb")
                ?? throw new InvalidOperationException("Connection string 'CatalogDb' is not configured.");
        }

        public DeckExportDto ExportDeck(string slug, string version, out string jsonFilePath)
        {
            if (string.IsNullOrWhiteSpace(slug))
            {
                throw new ArgumentException("slug is required.", nameof(slug));
            }

            if (string.IsNullOrWhiteSpace(version))
            {
                throw new ArgumentException("version is required.", nameof(version));
            }

            slug = slug.Trim();
            version = version.Trim();

            DeckExportDto deckDto;

            using (var conn = new NpgsqlConnection(_connectionString))
            {
                conn.Open();

                // 1) 先查 deck
                int deckId;
                string title;
                string locale;
                int deckType;
                bool isFreeStarter;
                int totalCards;
                int freeCardCount;

                const string deckSql = @"
                    SELECT id, slug, title, locale, version, deck_type, is_free_starter, total_cards, free_card_count
                    FROM catalog_decks
                    WHERE slug = @slug AND version = @version
                    LIMIT 1;
                ";

                using (var cmd = new NpgsqlCommand(deckSql, conn))
                {
                    cmd.Parameters.AddWithValue("slug", slug);
                    cmd.Parameters.AddWithValue("version", version);

                    using (var reader = cmd.ExecuteReader())
                    {
                        if (!reader.Read())
                        {
                            throw new KeyNotFoundException(
                                $"Catalog deck not found for slug='{slug}', version='{version}'.");
                        }

                        deckId = reader.GetInt32(reader.GetOrdinal("id"));
                        title = reader.GetString(reader.GetOrdinal("title"));
                        locale = reader.GetString(reader.GetOrdinal("locale"));
                        deckType = reader.GetInt32(reader.GetOrdinal("deck_type"));
                        isFreeStarter = reader.GetBoolean(reader.GetOrdinal("is_free_starter"));
                        totalCards = reader.GetInt32(reader.GetOrdinal("total_cards"));
                        freeCardCount = reader.GetInt32(reader.GetOrdinal("free_card_count"));
                    }
                }

                // 2) 再查 cards
                const string cardsSql = @"
                    SELECT stable_uid, question, explanation, code_snippet, code_language, difficulty, order_in_deck
                    FROM catalog_cards
                    WHERE deck_slug = @slug
                    AND deck_version = @version
                    ORDER BY order_in_deck ASC, id ASC;
                ";


                var cards = new List<DeckExportCardDto>();

                using (var cmd = new NpgsqlCommand(cardsSql, conn))
                {
                    cmd.Parameters.AddWithValue("slug", slug);
                    cmd.Parameters.AddWithValue("version", version);

                    using (var reader = cmd.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            var card = new DeckExportCardDto
                            {
                                StableUid = reader.GetString(reader.GetOrdinal("stable_uid")),
                                Question = reader.GetString(reader.GetOrdinal("question")),
                                Explanation = reader.IsDBNull(reader.GetOrdinal("explanation"))
                                    ? null
                                    : reader.GetString(reader.GetOrdinal("explanation")),
                                CodeSnippet = reader.IsDBNull(reader.GetOrdinal("code_snippet"))
                                    ? null
                                    : reader.GetString(reader.GetOrdinal("code_snippet")),
                                CodeLanguage = reader.IsDBNull(reader.GetOrdinal("code_language"))
                                    ? null
                                    : reader.GetString(reader.GetOrdinal("code_language")),
                                Difficulty = reader.GetInt16(reader.GetOrdinal("difficulty")),
                                OrderInDeck = reader.GetInt32(reader.GetOrdinal("order_in_deck")),
                            };

                            cards.Add(card);
                        }
                    }
                }

                deckDto = new DeckExportDto
                {
                    Slug = slug,
                    Title = title,
                    Locale = locale,
                    Version = version,
                    DeckType = deckType,
                    IsFreeStarter = isFreeStarter,
                    TotalCards = totalCards,
                    FreeCardCount = freeCardCount,
                    Cards = cards,
                };
            }

            // 3) 写 JSON 到本地目录（给你本地检查 + 以后上传 S3）
            var baseDir = AppContext.BaseDirectory; // bin/Debug/net8.0/ ...
            var exportDir = Path.Combine(baseDir, "exports", "decks", deckDto.Locale, deckDto.Slug);
            Directory.CreateDirectory(exportDir);

            var fileName = $"{deckDto.Version}.json";
            jsonFilePath = Path.Combine(exportDir, fileName);

            var jsonOptions = new JsonSerializerOptions
            {
                WriteIndented = true
            };

            var json = JsonSerializer.Serialize(deckDto, jsonOptions);
            File.WriteAllText(jsonFilePath, json, Encoding.UTF8);

            return deckDto;
        }
    }
}