// src/components/console/consoleNav.ts
//
// The console's global sections, in one place. Every page spreads
// consoleNav() into ConsoleShell, so the header offers the same destinations
// wherever the user is — including the review queue, the human gate of the
// authoring agent, from the landing page. A page passes only its deck-scoped
// overrides (e.g. reviewHref: `/review?deckId=7`), or `undefined` to leave a
// section out (the deck list omits Decks: it is that page).
//
// Webhooks and Admin Management are listed for everyone; ConsoleShell renders
// them only for a super_admin session.

export type ConsoleNavHrefs = {
  decksHref?: string;
  contentIntelligenceHref?: string;
  reviewHref?: string;
  qaHref?: string;
  ledgerHref?: string;
  webhooksHref?: string;
  adminUsersHref?: string;
};

export const CONSOLE_NAV: Readonly<Required<ConsoleNavHrefs>> = {
  decksHref: '/',
  contentIntelligenceHref: '/content-intelligence',
  reviewHref: '/review',
  qaHref: '/decks/qa',
  ledgerHref: '/ledger',
  webhooksHref: '/admin/webhooks',
  adminUsersHref: '/admin/users',
};

export function consoleNav(overrides: ConsoleNavHrefs = {}): ConsoleNavHrefs {
  return { ...CONSOLE_NAV, ...overrides };
}
