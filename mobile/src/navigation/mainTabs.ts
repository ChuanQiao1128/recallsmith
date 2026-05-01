export type MainTabKey = 'home' | 'draw' | 'review' | 'library' | 'me';

export const MAIN_TABS: Array<{ key: MainTabKey; label: string; icon: string; route: string }> = [
  { key: 'home', label: 'Home', icon: '⌂', route: 'Home' },
  { key: 'draw', label: 'Draw', icon: '✦', route: 'Draw' },
  { key: 'review', label: 'Review', icon: '↺', route: 'Challenge' },
  { key: 'library', label: 'Library', icon: '▥', route: 'Library' },
  { key: 'me', label: 'Me', icon: '◎', route: 'More' },
];

export function getMainTabForRouteName(routeName?: string | null): MainTabKey | null {
  if (!routeName) return null;
  const match = MAIN_TABS.find((tab) => tab.route === routeName);
  return match?.key ?? null;
}

export function shouldShowMainTabBar(routeName?: string | null) {
  return getMainTabForRouteName(routeName) !== null;
}
