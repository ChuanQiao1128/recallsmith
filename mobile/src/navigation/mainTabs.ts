export type MainTabKey = 'home' | 'draw' | 'review' | 'library' | 'me';

export const MAIN_TABS: Array<{ key: MainTabKey; label: string; icon: string; route: string }> = [
  { key: 'home', label: 'Home', icon: '⌂', route: 'Home' },
  { key: 'draw', label: 'Draw', icon: '✦', route: 'Draw' },
  // Review tab now goes straight into a study session (was Challenge,
  // which showed a route preview + Begin button). Aligns with the
  // Home CTA flow which also bypasses Challenge — both paths to "I
  // want to study now" land in SessionCard in one tap.
  { key: 'review', label: 'Review', icon: '↺', route: 'SessionCard' },
  { key: 'library', label: 'Library', icon: '▥', route: 'Library' },
  { key: 'me', label: 'Me', icon: '◎', route: 'More' },
];

export function getMainTabForRouteName(routeName?: string | null): MainTabKey | null {
  if (!routeName) return null;
  const match = MAIN_TABS.find((tab) => tab.route === routeName);
  if (match) return match.key;
  // Treat the legacy Challenge route preview as the Review tab too —
  // any deep-link / direct entry into Challenge still highlights Review.
  if (routeName === 'Challenge') return 'review';
  return null;
}

export function shouldShowMainTabBar(routeName?: string | null) {
  // Tab bar is also visible on the legacy Challenge route preview.
  if (routeName === 'Challenge') return true;
  return getMainTabForRouteName(routeName) !== null;
}
