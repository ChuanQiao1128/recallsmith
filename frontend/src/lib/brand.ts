// src/lib/brand.ts
//
// The one place the console names itself. Everything visible that used to carry
// the old product name reads from here instead, so the product has a single
// brand and a single default deck author rather than a scatter of string
// literals that drift apart.
//
// NO IMPORTS. App.tsx and LoginPage are eager (first-load) modules and pull
// this in, so anything imported here would join the first-load closure that
// tests/bundleFirstLoad.test.ts budgets. Keep it to plain constants and a pure
// function.

export const CONSOLE_NAME = 'DeveloperCards Console';
export const DEFAULT_DECK_AUTHOR = 'DeveloperCards';

// Each known route's own short label. The document title is this label followed
// by the console name, so a tab reads "Decks · DeveloperCards Console" rather
// than the same static string on every page.
const ROUTE_TITLES: Record<string, string> = {
  '/login': 'Sign in',
  '/auth/callback': 'Signing in',
  '/': 'Decks',
  '/decks/new': 'New deck',
  '/decks/edit': 'Edit deck',
  '/decks/preview': 'Deck preview',
  '/decks/cards': 'Cards',
  '/decks/cards/new': 'New card',
  '/decks/cards/edit': 'Edit card',
  '/decks/cards/import': 'Import cards',
  '/admin/users': 'Users & permissions',
  '/content-intelligence': 'Content intelligence',
};

/**
 * The document title for a pathname. A known path returns
 * `${label} · ${CONSOLE_NAME}`; anything else returns the console name alone.
 * One trailing slash is stripped first (except for `/` itself) so that
 * `/decks/new/` and `/decks/new` name the same page.
 */
export function documentTitleFor(pathname: string): string {
  const path = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const label = ROUTE_TITLES[path];
  return label ? `${label} · ${CONSOLE_NAME}` : CONSOLE_NAME;
}
