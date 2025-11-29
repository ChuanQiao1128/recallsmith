// backend/src/Host/RecallSmith.Api/Application/Publishing/DeckPublishingService.cs
using System;
using System.Collections.Generic;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Infrastructure.Cards;
using RecallSmith.Api.Infrastructure.Catalog;
using RecallSmith.Api.Infrastructure.Decks;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Publishing
{
    public class DeckPublishingService : IDeckPublishingService
    {
        private readonly IDeckRepository _deckRepository;
        private readonly ICardRepository _cardRepository;
        private readonly ICatalogDeckRepository _catalogDeckRepository;

        private readonly ICatalogCardRepository _catalogCardRepository;

        private readonly ILogger<DeckPublishingService> _logger;

        private const int DefaultFreeCardCount = 50;

        public DeckPublishingService(
            IDeckRepository deckRepository,
            ICardRepository cardRepository,
            ICatalogDeckRepository catalogDeckRepository,
            ICatalogCardRepository catalogCardRepository,
            ILogger<DeckPublishingService> logger)
        {
            _deckRepository = deckRepository;
            _cardRepository = cardRepository;
            _catalogDeckRepository = catalogDeckRepository;
            _catalogCardRepository = catalogCardRepository;
            _logger = logger;
        }

        private static long NowEpochMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        public CatalogDeck PublishDeck(int deckId, string version, bool forceOverwrite)
        {
            if (deckId <= 0)
            {
                throw new ArgumentException("deckId must be greater than 0.", nameof(deckId));
            }

            if (string.IsNullOrWhiteSpace(version))
            {
                throw new ArgumentException("version is required.", nameof(version));
            }

            string normalizedVersion = version.Trim();

            // 1. 从 Authoring 读取 Deck
            Deck? deck = _deckRepository.GetDeckById(deckId);
            if (deck == null || deck.IsDeleted != 0)
            {
                throw new KeyNotFoundException($"Deck with id {deckId} not found or deleted.");
            }

            string slug = deck.Slug;
            string title = deck.Title;
            string? description = deck.Description;
            string locale = deck.Locale;
            short deckType = deck.DeckType;

            // 2. 统计卡片（只算未软删）
            List<Card> cards = _cardRepository.GetCardsByDeckId(deckId);
            int totalCards = cards.Count;

            // 3. 根据收费策略决定 Starter / free_card_count
            bool isFreeStarter = deckType == 1;
            int freeCardCount;

            if (isFreeStarter)
            {
                freeCardCount = totalCards;
            }
            else
            {
                freeCardCount = totalCards <= DefaultFreeCardCount
                    ? totalCards
                    : DefaultFreeCardCount;
            }

            // 4. 检查 slug+version 是否已存在
            bool exists = _catalogDeckRepository.ExistsSlugAndVersion(slug, normalizedVersion);
            if (exists && !forceOverwrite)
            {
                throw new InvalidOperationException(
                    $"Catalog deck '{slug}' with version '{normalizedVersion}' already exists.");
            }

            // 这里先不支持覆盖，避免一下子掉进复杂逻辑
            if (exists && forceOverwrite)
            {
                throw new InvalidOperationException(
                    $"forceOverwrite=true is not supported yet. Please use a new version, e.g. 'v2'.");
            }

            long now = NowEpochMs();

            CatalogDeck? insertedDeck = _catalogDeckRepository.InsertDeck(
                slug,
                normalizedVersion,
                title,
                description,
                locale,
                isFreeStarter,
                totalCards,
                freeCardCount,
                deckType,
                deck.Id,
                now,
                now,
                now);

            if (insertedDeck == null)
            {
                throw new InvalidOperationException("Failed to insert catalog_decks record.");
            }

            // 6. 插入 catalog_cards（把 authoring 的 cards 拷贝过来）
            if (cards.Count > 0)
            {
                _catalogCardRepository.InsertCardsForDeck(
                    slug,
                    normalizedVersion,
                    cards,
                    now,
                    now);
            }

            return insertedDeck;
        }
    }
}