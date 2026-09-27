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

export type ConsoleSection =
  | 'decks'
  | 'review'
  | 'qa'
  | 'contentIntelligence'
  | 'ledger'
  | 'automation'
  | 'webhooks'
  | 'adminUsers';

// The Automation page (A00 §16.1). Deliberately NOT in CONSOLE_NAV: the landing
// page's link set, the order of the seven links and the keys of CONSOLE_NAV are
// pinned by tests that stay byte-identical, so the pages of the automation area
// pass this to ConsoleShell's own optional prop instead.
export const AUTOMATION_HREF = '/automation';

/** The console section a path belongs to; the deck list and its card/deck pages are Decks. */
export function consoleSectionFor(pathname: string): ConsoleSection | null {
  if (pathname === '/review') return 'review';
  if (pathname === '/decks/qa') return 'qa';
  if (pathname === '/content-intelligence') return 'contentIntelligence';
  if (pathname === '/ledger') return 'ledger';
  if (pathname === '/automation') return 'automation';
  if (pathname === '/admin/webhooks') return 'webhooks';
  if (pathname === '/admin/users') return 'adminUsers';
  if (pathname === '/' || pathname.startsWith('/decks')) return 'decks';
  return null;
}
