// backend/src/Host/RecallSmith.Api/Application/Decks/IDeckService.cs
using System.Collections.Generic;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Decks
{
    public interface IDeckService
    {
        List<Deck> GetDecks(string? title, bool sortCreatedAtAsc, int page, int pageSize);

        Deck? GetDeckById(int id);

        Deck CreateDeck(
            string? slug,
            string title,
            string author,
            string? description,
            string? locale,
            short? deckType);

        bool SoftDeleteDeck(int id);

        Deck? UpdateDeck(
            int id,
            int expectedVersion,
            string? title,
            string? author,
            string? description,
            string? locale,
            out bool versionConflict);
    }
}