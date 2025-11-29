// backend/src/Host/RecallSmith.Api/Application/Cards/CardService.cs
using System;
using System.Collections.Generic;
using System.Text;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Infrastructure.Cards;
using RecallSmith.Api.Infrastructure.Decks;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Cards
{
    public class CardService : ICardService
    {
        private readonly ICardRepository _cardRepository;
        private readonly IDeckRepository _deckRepository;
        private readonly ILogger<CardService> _logger;

        public CardService(
            ICardRepository cardRepository,
            IDeckRepository deckRepository,
            ILogger<CardService> logger)
        {
            _cardRepository = cardRepository;
            _deckRepository = deckRepository;
            _logger = logger;
        }

        private static long NowEpochMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        public List<Card> GetCardsByDeckId(int deckId)
        {
            if (deckId <= 0)
            {
                throw new ArgumentException("deckId must be greater than 0.", nameof(deckId));
            }

            Deck? deck = _deckRepository.GetDeckById(deckId);
            if (deck == null || deck.IsDeleted != 0)
            {
                throw new KeyNotFoundException($"Deck with id {deckId} not found.");
            }

            return _cardRepository.GetCardsByDeckId(deckId);
        }

        public Card CreateCard(
            int deckId,
            string question,
            string? explanation,
            string? codeSnippet,
            string? codeLanguage,
            short? difficulty,
            int? orderInDeck,
            string? stableUid)
        {
            if (deckId <= 0)
            {
                throw new ArgumentException("deckId must be greater than 0.", nameof(deckId));
            }

            if (string.IsNullOrWhiteSpace(question))
            {
                throw new ArgumentException("Question is required.", nameof(question));
            }

            Deck? deck = _deckRepository.GetDeckById(deckId);
            if (deck == null || deck.IsDeleted != 0)
            {
                throw new KeyNotFoundException($"Deck with id {deckId} not found.");
            }

            string trimmedQuestion = question.Trim();

            // 难度：默认 2（中等）
            short finalDifficulty = difficulty ?? (short)2;
            if (finalDifficulty < 1 || finalDifficulty > 3)
            {
                throw new ArgumentException("difficulty must be 1 (easy), 2 (medium), or 3 (hard).", nameof(difficulty));
            }

            int finalOrder = orderInDeck ?? 0;

            // 处理 explanation / snippet / language：空字符串视为 null
            string? finalExplanation = explanation;
            if (finalExplanation != null && finalExplanation.Trim().Length == 0)
            {
                finalExplanation = null;
            }

            string? finalSnippet = codeSnippet;
            if (finalSnippet != null && finalSnippet.Trim().Length == 0)
            {
                finalSnippet = null;
            }

            string? finalLanguage = codeLanguage;
            if (finalLanguage != null && finalLanguage.Trim().Length == 0)
            {
                finalLanguage = null;
            }

            // stableUid：如果没给，就自动生成一个在该 deck 内唯一的
            string finalStableUid;
            if (!string.IsNullOrWhiteSpace(stableUid))
            {
                finalStableUid = stableUid!.Trim();

                if (_cardRepository.ExistsStableUid(deckId, finalStableUid, excludeId: null))
                {
                    throw new InvalidOperationException(
                        $"stableUid '{finalStableUid}' already exists in deck {deckId}.");
                }
            }
            else
            {
                finalStableUid = GenerateStableUid(deckId, trimmedQuestion);
            }

            long now = NowEpochMs();

            Card? card = _cardRepository.InsertCard(
                deckId,
                finalStableUid,
                trimmedQuestion,
                finalExplanation,
                finalSnippet,
                finalLanguage,
                finalDifficulty,
                finalOrder,
                now,
                now);

            if (card == null)
            {
                throw new InvalidOperationException("Failed to create card.");
            }

            return card;
        }

        public bool SoftDeleteCard(int id)
        {
            if (id <= 0)
            {
                return false;
            }

            long now = NowEpochMs();
            return _cardRepository.SoftDeleteCard(id, now);
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
            out bool versionConflict)
        {
            if (id <= 0)
            {
                throw new ArgumentException("id must be greater than 0.", nameof(id));
            }

            if (expectedVersion <= 0)
            {
                throw new ArgumentException("expectedVersion must be greater than 0.", nameof(expectedVersion));
            }

            string? newQuestion = question?.Trim();
            string? newExplanation = explanation;   // 允许 null / 空串：空串会当作 null
            string? newSnippet = codeSnippet;
            string? newLanguage = codeLanguage;
            short? newDifficulty = difficulty;
            int? newOrder = orderInDeck;

            bool hasQuestion = !string.IsNullOrWhiteSpace(newQuestion);
            bool hasExplanation = newExplanation != null;
            bool hasSnippet = newSnippet != null;
            bool hasLanguage = newLanguage != null;
            bool hasDifficulty = newDifficulty.HasValue;
            bool hasOrder = newOrder.HasValue;

            if (!hasQuestion && !hasExplanation && !hasSnippet && !hasLanguage && !hasDifficulty && !hasOrder)
            {
                throw new ArgumentException(
                    "At least one of question, explanation, codeSnippet, codeLanguage, difficulty, or orderInDeck must be provided.");
            }

            if (hasQuestion && string.IsNullOrWhiteSpace(newQuestion))
            {
                throw new ArgumentException("Question cannot be empty.", nameof(question));
            }

            if (hasDifficulty)
            {
                if (newDifficulty!.Value < 1 || newDifficulty.Value > 3)
                {
                    throw new ArgumentException("difficulty must be 1, 2, or 3.", nameof(difficulty));
                }
            }

            if (hasOrder && newOrder!.Value < 0)
            {
                throw new ArgumentException("orderInDeck cannot be negative.", nameof(orderInDeck));
            }

            // 处理 explanation/snippet/language 空串为 null
            if (hasExplanation && newExplanation != null && newExplanation.Trim().Length == 0)
            {
                newExplanation = null;
            }
            if (hasSnippet && newSnippet != null && newSnippet.Trim().Length == 0)
            {
                newSnippet = null;
            }
            if (hasLanguage && newLanguage != null && newLanguage.Trim().Length == 0)
            {
                newLanguage = null;
            }

            long now = NowEpochMs();

            Card? updated = _cardRepository.UpdateCard(
                id,
                expectedVersion,
                hasQuestion ? newQuestion : null,
                hasExplanation ? newExplanation : null,
                hasSnippet ? newSnippet : null,
                hasLanguage ? newLanguage : null,
                hasDifficulty ? newDifficulty : null,
                hasOrder ? newOrder : null,
                now,
                out versionConflict);

            return updated;
        }

        /// <summary>
        /// 根据问题内容和 deckId 生成一个稳定 UID，并保证在该 deck 内唯一。
        /// </summary>
        private string GenerateStableUid(int deckId, string question)
        {
            // 基于 question 做一个简单的 slug
            string lower = question.ToLowerInvariant();
            StringBuilder sb = new StringBuilder();
            int maxLen = 40;

            for (int i = 0; i < lower.Length && sb.Length < maxLen; i++)
            {
                char c = lower[i];
                if (char.IsLetterOrDigit(c))
                {
                    sb.Append(c);
                }
                else
                {
                    sb.Append('-');
                }
            }

            string baseUid = sb.ToString();

            while (baseUid.Contains("--"))
            {
                baseUid = baseUid.Replace("--", "-");
            }

            baseUid = baseUid.Trim('-');

            if (baseUid.Length == 0)
            {
                baseUid = "card";
            }

            string candidate = baseUid;
            int suffix = 2;

            while (_cardRepository.ExistsStableUid(deckId, candidate, excludeId: null))
            {
                candidate = baseUid + "-" + suffix.ToString();
                suffix++;
            }

            return candidate;
        }
    }
}