// src/lib/parseDeckId.ts
//
// The one answer to "is this ?deckId= usable", for every page that reads one.
//
// There were three, and they disagreed. CardListPage accepted anything that was
// neither 0 nor NaN; NewCardPage and EditCardPage additionally rejected
// anything <= 0. So `?deckId=-5` was refused by two pages before a request went
// out and forwarded by the third, which is why the deck list can show you the
// server's own "Deck -5 does not exist." while the card form says "Missing or
// invalid deckId." about the identical URL. Two sentences for one situation,
// and neither page is wrong on its own terms — that is what makes a duplicated
// rule expensive rather than merely repetitive.
//
// The semantics kept are CardListPage's, deliberately, and not because it is
// the loosest: it is the only one of the three with a test pinning the negative
// case (tests/cardListPageQueryWiring.test.tsx, "still sends a deckId the
// server is the one to reject"). The reasoning behind that test is that the
// client cannot know which ids exist, so the only ids it is entitled to refuse
// are the ones that are not identifiers at all. 0 is the absent value Number()
// produces for '' and for a missing parameter; NaN is a parameter that is not a
// number. Everything else is a question for the server.
//
// This moves the rule, it does not change it. Rehoming it DOES change what
// NewCardPage and EditCardPage do with a negative id — see the note in each.

/**
 * The deck id in `raw`, or null when there is not one.
 *
 * Returns the number as written, including negatives and fractions: this is a
 * parser, not a validator of deck existence.
 */
export function parseDeckId(raw: string | null | undefined): number | null {
  // Number(null) is 0 and Number('') is 0, so both the missing parameter and
  // the empty one arrive at the same falsy value and are rejected together.
  const id = Number(raw ?? '');
  if (!id || Number.isNaN(id)) return null;
  return id;
}
