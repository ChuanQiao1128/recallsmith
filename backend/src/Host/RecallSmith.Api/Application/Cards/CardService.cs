// backend/src/Host/RecallSmith.Api/Application/Cards/CardService.cs
using System;
using System.Collections.Generic;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Infrastructure.Cards;
using RecallSmith.Api.Infrastructure.Decks;  // ★ 新增
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Cards
{
    public class CardService : ICardService
    {
        private readonly ICardRepository _cardRepository;
        private readonly IDeckRepository _deckRepository;   // ★ 新增
        private readonly ILogger<CardService> _logger;

        public CardService(
            ICardRepository cardRepository,
            IDeckRepository deckRepository,                 // ★ 新增参数
            ILogger<CardService> logger)
        {
            _cardRepository = cardRepository;
            _deckRepository = deckRepository;               // ★ 赋值
            _logger = logger;
        }

        public List<Card> GetCardsByDeckId(int deckId)
        {
            if (deckId <= 0)
            {
                throw new ArgumentException("deckId must be greater than 0.", nameof(deckId));
            }

            // 1. 先确认这个 deck 存在并且未软删
            Deck? deck = _deckRepository.GetDeckById(deckId);
            if (deck == null || deck.IsDeleted != 0)
            {
                // 用 KeyNotFoundException 告诉上层：这个 deck 不存在
                throw new KeyNotFoundException($"Deck with id {deckId} not found.");
            }

            // 2. Deck 存在 → 查卡片（可能是空列表）
            return _cardRepository.GetCardsByDeckId(deckId);
        }
    }
}