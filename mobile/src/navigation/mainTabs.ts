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
  return null;
}

export function shouldShowMainTabBar(routeName?: string | null) {
  // Hide the bar while a review session is on screen. The Review tab routes to
  // SessionCard, but with pop-navigation a stray tab tap would pop the running
  // SessionCard (its unmount resets the session store), so no bar during a run
  // — exits go through Pause (confirm) and the empty-deck Back control (MCORE-04).
  if (routeName === 'SessionCard') return false;
  return getMainTabForRouteName(routeName) !== null;
}
