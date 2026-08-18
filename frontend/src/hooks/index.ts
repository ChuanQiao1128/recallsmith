// Nothing in src/ imports this barrel — pages import the concrete files — so it
// is not a convenience import and adding a hook here wires it to nothing. It is
// the hook inventory that tests/hookWiring.test.ts reads off disk: that ratchet
// fails a hook listed here with no caller, and separately asserts no hook under
// src/hooks/ is missing from the list. Both halves are needed, so the rule is:
// every hook in this folder appears here, and every hook here has a caller.

export { useDeck, useCreateDeck, useUpdateDeck, useDeleteDeck, usePublishDeck } from './useDecks';
export { useCards, useCreateCard, useUpdateCard, useDeleteCard } from './useCards';
