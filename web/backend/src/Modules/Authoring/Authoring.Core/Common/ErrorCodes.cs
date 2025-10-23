namespace Authoring.Core.Common;

public static class ErrorCodes
{
    public static class Common
    {
        public const string Validation = "Common.Validation";
        public const string Unexpected = "Common.Unexpected";

        public const string ConcurrencyConflict = "Common.ConcurrencyConflict";
    }

    public static class Deck
    {
        public const string NotFound = "Deck.NotFound";
        public const string SlugExists = "Deck.SlugExists";
    }
}