using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Catalog.Application;
using Contracts.Catalog.Admin;

namespace Catalog.Infrastructure
{
    /// <summary>
    /// 简单内存假数据，方便前端联调与演示
    /// </summary>
    public sealed class MockCatalogQueryService : ICatalogQueryService
    {
        public Task<(IReadOnlyList<DeckListItemDto> Items, int Total)> ListDecksAsync(
            string? q, int page, int pageSize, CancellationToken ct)
        {
            var all = new List<DeckListItemDto>
            {
                new DeckListItemDto(
                    Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
                    "js-core",
                    "JavaScript Core",
                    "en-US",
                    "1.0.0",
                    DateTimeOffset.UtcNow
                ),
                new DeckListItemDto(
                    Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
                    "dotnet-async",
                    ".NET Async",
                    "en-NZ",
                    "1.0.0",
                    DateTimeOffset.UtcNow.AddMinutes(-10)
                )
            };

            if (!string.IsNullOrWhiteSpace(q))
            {
                all = all.FindAll(d =>
                    d.Slug.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                    d.Title.Contains(q, StringComparison.OrdinalIgnoreCase));
            }

            // 朴素分页
            page = page <= 0 ? 1 : page;
            pageSize = pageSize is <= 0 or > 100 ? 20 : pageSize;
            var start = (page - 1) * pageSize;
            var items = start >= all.Count ? new List<DeckListItemDto>() : all.GetRange(start, Math.Min(pageSize, all.Count - start));

            return Task.FromResult(((IReadOnlyList<DeckListItemDto>)items, all.Count));
        }

        public Task<DeckDetailDto?> GetDeckAsync(Guid deckId, CancellationToken ct)
        {
            var deck = new DeckDetailDto(
                deckId,
                deckId.ToString().StartsWith("a") ? "js-core" : "dotnet-async",
                deckId.ToString().StartsWith("a") ? "JavaScript Core" : ".NET Async",
                "en-US",
                "1.0.0",
                1,
                DateTimeOffset.UtcNow.AddDays(-1),
                DateTimeOffset.UtcNow
            );
            return Task.FromResult<DeckDetailDto?>(deck);
        }

        public Task<IReadOnlyList<CardDto>> ListDeckCardsAsync(Guid deckId, CancellationToken ct)
        {
            var cards = new List<CardDto>
            {
                new CardDto(
                    Guid.NewGuid(),
                    "js.eventloop.micro-vs-macro.v1",
                    "Explain microtasks vs macrotasks and their execution order.",
                    "## KeyPoint\nMicrotasks run before macrotasks within the same event loop turn.",
                    "Microtasks run before macrotasks within the same turn.",
                    new List<string> { "JavaScript", "event-loop" },
                    "intermediate",
                    DateTimeOffset.UtcNow.AddDays(-1),
                    DateTimeOffset.UtcNow
                )
            };
            return Task.FromResult((IReadOnlyList<CardDto>)cards);
        }
    }
}
