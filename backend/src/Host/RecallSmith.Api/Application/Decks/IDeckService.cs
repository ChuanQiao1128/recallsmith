using System.Collections.Generic;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Decks;

public interface IDeckService
{
    List<Deck> GetDecks(string? title, string? sortbyCreatedAt, int? currentPage);

    Deck? GetDeckById(int id);

    bool TitleExists(string title, int? excludeId);

    Deck CreateDeck(string title, string author);

    bool SoftDeleteDeck(int id);

    Deck? UpdateDeck(
        int id,
        int expectedVersion,
        string? newTitle,
        string? newAuthor,
        out bool versionConflict);
}