// tests/support/adminFixtures.ts
//
// The smallest cast of users and decks the AdminUsersPage cases need, plus the
// stub of last resort.
//
// Everything is a factory rather than a shared const. Five files mount that
// page and two of them tick permission boxes, so a shared object literal is one
// accidental mutation away from a case that only passes in a particular file
// order. Fresh objects per call cost nothing and remove the question.
//
// Deliberately NOT here: anything only one file needs. A fixture module that
// grows to cover every case becomes a second implementation you have to read
// before you can read a test.
//
// NOT collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

import type { AdminUser, DeckSummary } from '../../src/api/admin';

/** alice's Cognito sub. The bulk-permissions endpoint is keyed on exactly this. */
export const ALICE_SUB = 'alice-sub-0001';

/**
 * A user whose permissions can be saved: she has a `sub`, and she arrives with
 * read+write on deck 1 so that "the draft starts from what the server said" is
 * observable rather than assumed.
 */
export function alice(): AdminUser {
  return {
    username: 'alice_editor',
    sub: ALICE_SUB,
    email: 'alice@example.invalid',
    enabled: true,
    status: 'CONFIRMED',
    groups: ['editor'],
    deckPermissions: [
      {
        deckId: 1,
        deckSlug: 'd-one',
        deckTitle: 'Deck One',
        locale: 'en',
        canRead: true,
        canWrite: true,
      },
    ],
  };
}

/**
 * A user with no `sub`.
 *
 * Cognito users created outside this console can arrive without one, and the
 * save path refuses them rather than POSTing `adminSub: undefined` — which the
 * server would either reject or, much worse, resolve against some other row.
 */
export function bob(): AdminUser {
  return {
    username: 'bob_editor',
    email: 'bob@example.invalid',
    enabled: true,
    status: 'CONFIRMED',
    groups: ['editor'],
    deckPermissions: [],
  };
}

/**
 * Three decks, not two.
 *
 * The permission payload is built from the whole deck list and then filtered
 * down to the ticked ones. With two decks, "sent every deck" and "sent the two
 * that were ticked" are the same array, and the case that matters most —
 * filtering the table must not revoke anything — cannot tell them apart.
 *
 * The slugs are chosen so that no slug/title/locale is a substring of another
 * deck's: searching "d-one" matches exactly one row, and "Deck One" lowercased
 * does not contain "d-one".
 */
export function decks(): DeckSummary[] {
  return [
    { id: 1, slug: 'd-one', title: 'Deck One', locale: 'en' },
    { id: 2, slug: 'd-two', title: 'Deck Two', locale: 'en' },
    { id: 3, slug: 'd-three', title: 'Deck Three', locale: 'zh' },
  ];
}

/**
 * The default implementation for every api function a case does not stub.
 *
 * The alternative — leaving `vi.fn()` returning undefined — is the quiet
 * failure this exists to prevent. The page would read `.success` off undefined
 * and throw somewhere unrelated, or await undefined and carry on as though the
 * call had succeeded. Naming the function in the message means the stack is not
 * needed to work out which stub is missing.
 */
export function unstubbed(name: string): () => never {
  return () => {
    throw new Error(`${name} was not stubbed`);
  };
}
