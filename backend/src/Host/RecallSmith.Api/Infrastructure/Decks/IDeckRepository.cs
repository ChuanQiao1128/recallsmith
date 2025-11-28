// backend/src/Host/RecallSmith.Api/Infrastructure/Decks/IDeckRepository.cs
using System.Collections.Generic;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Decks
{
    public interface IDeckRepository
    {
        List<Deck> GetDecks(string? title, bool sortCreatedAtAsc, int page, int pageSize);

        Deck? GetDeckById(int id);

        bool ExistsActiveTitle(string title, int? excludeId);

        bool ExistsSlug(string slug, int? excludeId);

        Deck? InsertDeck(
            string slug,
            string title,
            string author,
            string? description,
            string locale,
            short deckType,
            long createdAt,
            long updatedAt);

        bool SoftDeleteDeck(int id, long updatedAt);

        Deck? UpdateDeck(
            int id,
            int expectedVersion,
            string? newTitle,
            string? newAuthor,
            string? newDescription,
            string? newLocale,
            long updatedAt,
            out bool versionConflict);
    }
}