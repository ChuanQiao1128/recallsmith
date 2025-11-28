// backend/src/Host/RecallSmith.Api/Application/Decks/DeckService.cs
using System;
using System.Collections.Generic;
using System.Text;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Infrastructure.Decks;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Decks
{
    public class DeckService : IDeckService
    {
        private readonly IDeckRepository _repository;
        private readonly ILogger<DeckService> _logger;

        public DeckService(IDeckRepository repository, ILogger<DeckService> logger)
        {
            _repository = repository;
            _logger = logger;
        }

        private static long NowEpochMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        public List<Deck> GetDecks(string? title, bool sortCreatedAtAsc, int page, int pageSize)
        {
            if (page <= 0)
            {
                page = 1;
            }
            if (pageSize <= 0)
            {
                pageSize = 10;
            }

            return _repository.GetDecks(title, sortCreatedAtAsc, page, pageSize);
        }

        public Deck? GetDeckById(int id)
        {
            if (id <= 0)
            {
                return null;
            }

            return _repository.GetDeckById(id);
        }

        public Deck CreateDeck(
            string? slug,
            string title,
            string author,
            string? description,
            string? locale,
            short? deckType)
        {
            if (string.IsNullOrWhiteSpace(title))
            {
                throw new ArgumentException("Title is required.", nameof(title));
            }

            if (string.IsNullOrWhiteSpace(author))
            {
                throw new ArgumentException("Author is required.", nameof(author));
            }

            string trimmedTitle = title.Trim();
            string trimmedAuthor = author.Trim();

            // 默认 en-US
            string finalLocale = string.IsNullOrWhiteSpace(locale)
                ? "en-US"
                : locale!.Trim();

            // deckType: 默认 2 (= Paid)
            short finalDeckType = deckType.HasValue ? deckType.Value : (short)2;
            if (finalDeckType != 1 && finalDeckType != 2)
            {
                throw new ArgumentException("deckType must be 1 (Starter) or 2 (Paid).", nameof(deckType));
            }

            // 标题唯一性检查（未软删）
            if (_repository.ExistsActiveTitle(trimmedTitle, excludeId: null))
            {
                throw new InvalidOperationException($"Deck with title '{trimmedTitle}' already exists.");
            }

            // 处理 slug
            string finalSlug;
            if (!string.IsNullOrWhiteSpace(slug))
            {
                finalSlug = slug!.Trim().ToLowerInvariant();
                if (_repository.ExistsSlug(finalSlug, excludeId: null))
                {
                    throw new InvalidOperationException($"Slug '{finalSlug}' already exists.");
                }
            }
            else
            {
                finalSlug = GenerateUniqueSlugFromTitle(trimmedTitle);
            }

            string? finalDescription = description?.Trim();
            if (finalDescription != null && finalDescription.Length == 0)
            {
                finalDescription = null;
            }

            long now = NowEpochMs();

            Deck? deck = _repository.InsertDeck(
                finalSlug,
                trimmedTitle,
                trimmedAuthor,
                finalDescription,
                finalLocale,
                finalDeckType,
                now,
                now);

            if (deck == null)
            {
                throw new InvalidOperationException("Failed to create deck.");
            }

            return deck;
        }

        public bool SoftDeleteDeck(int id)
        {
            if (id <= 0)
            {
                return false;
            }

            long now = NowEpochMs();
            return _repository.SoftDeleteDeck(id, now);
        }

        public Deck? UpdateDeck(
            int id,
            int expectedVersion,
            string? title,
            string? author,
            string? description,
            string? locale,
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

            string? newTitle = title?.Trim();
            string? newAuthor = author?.Trim();
            string? newDescription = description; // 描述允许 null 或空字符串
            string? newLocale = locale?.Trim();

            bool hasTitle = !string.IsNullOrWhiteSpace(newTitle);
            bool hasAuthor = !string.IsNullOrWhiteSpace(newAuthor);
            bool hasDescription = newDescription != null;
            bool hasLocale = !string.IsNullOrWhiteSpace(newLocale);

            if (!hasTitle && !hasAuthor && !hasDescription && !hasLocale)
            {
                throw new ArgumentException("At least one of title, author, description, or locale must be provided.");
            }

            if (hasTitle)
            {
                if (_repository.ExistsActiveTitle(newTitle!, excludeId: id))
                {
                    throw new InvalidOperationException($"Deck with title '{newTitle}' already exists.");
                }
            }

            if (hasLocale && string.IsNullOrWhiteSpace(newLocale))
            {
                throw new ArgumentException("Locale cannot be empty.", nameof(locale));
            }

            // 允许 description 为空字符串：这里不做额外校验

            long now = NowEpochMs();

            Deck? updated = _repository.UpdateDeck(
                id,
                expectedVersion,
                hasTitle ? newTitle : null,
                hasAuthor ? newAuthor : null,
                hasDescription ? newDescription : null,
                hasLocale ? newLocale : null,
                now,
                out versionConflict);

            return updated;
        }

        /// <summary>
        /// 根据 title 生成 slug，并保证在数据库中唯一。
        /// </summary>
        private string GenerateUniqueSlugFromTitle(string title)
        {
            // 1. 基于 title 生成一个基础 slug
            string lower = title.ToLowerInvariant();

            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < lower.Length; i++)
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

            string slug = sb.ToString();

            // 压缩重复的 '-'
            while (slug.Contains("--"))
            {
                slug = slug.Replace("--", "-");
            }

            slug = slug.Trim('-');
            if (slug.Length == 0)
            {
                slug = "deck";
            }

            // 2. 检查数据库中是否已存在，若存在加 -2, -3...
            string candidate = slug;
            int suffix = 2;

            while (_repository.ExistsSlug(candidate, excludeId: null))
            {
                candidate = slug + "-" + suffix.ToString();
                suffix++;
            }

            return candidate;
        }
    }
}