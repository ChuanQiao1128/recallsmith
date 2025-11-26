using System;
using System.Collections.Generic;
using RecallSmith.Api.Infrastructure.Decks;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Decks;

public class DeckService : IDeckService
{
    private readonly IDeckRepository _repository;
    private const int PageSize = 10;

    public DeckService(IDeckRepository repository)
    {
        _repository = repository;
    }

    private static long NowEpochMs()
    {
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    public List<Deck> GetDecks(string? title, string? sortbyCreatedAt, int? currentPage)
    {
        bool sortAsc = true; // 默认 asc
        if (!string.IsNullOrWhiteSpace(sortbyCreatedAt))
        {
            string normalized = sortbyCreatedAt.Trim().ToLowerInvariant();
            if (normalized == "desc")
            {
                sortAsc = false;
            }
        }

        int page = (currentPage is null || currentPage <= 0) ? 1 : currentPage.Value;
        return _repository.GetDecks(title, sortAsc, page, PageSize);
    }

    public Deck? GetDeckById(int id)
    {
        return _repository.GetDeckById(id);
    }

    public bool TitleExists(string title, int? excludeId)
    {
        return _repository.ExistsActiveTitle(title, excludeId);
    }

    public Deck CreateDeck(string title, string author)
    {
        long now = NowEpochMs();
        var deck = _repository.InsertDeck(title, author, now, now);
        if (deck == null)
        {
            throw new Exception("Failed to insert deck.");
        }
        return deck;
    }

    public bool SoftDeleteDeck(int id)
    {
        long now = NowEpochMs();
        return _repository.SoftDeleteDeck(id, now);
    }

    public Deck? UpdateDeck(
    int id,
    int expectedVersion,
    string? newTitle,
    string? newAuthor,
    out bool versionConflict)
    {
        long now = NowEpochMs();
        return _repository.UpdateDeck(id, expectedVersion, newTitle, newAuthor, now, out versionConflict);
    }
}