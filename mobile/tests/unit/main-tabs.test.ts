import { describe, expect, it } from 'vitest';

import { getMainTabForRouteName, shouldShowMainTabBar } from '../../src/navigation/mainTabs';

describe('main tab routing', () => {
  it('maps the five primary routes to the expected tab keys', () => {
    expect(getMainTabForRouteName('Home')).toBe('home');
    expect(getMainTabForRouteName('Draw')).toBe('draw');
    expect(getMainTabForRouteName('Challenge')).toBe('review');
    expect(getMainTabForRouteName('Library')).toBe('library');
    expect(getMainTabForRouteName('More')).toBe('me');
  });

  it('shows the global tab bar only on the five primary routes', () => {
    expect(shouldShowMainTabBar('Home')).toBe(true);
    expect(shouldShowMainTabBar('Draw')).toBe(true);
    expect(shouldShowMainTabBar('Challenge')).toBe(true);
    expect(shouldShowMainTabBar('Library')).toBe(true);
    expect(shouldShowMainTabBar('More')).toBe(true);

    expect(shouldShowMainTabBar('PlanOverview')).toBe(false);
    expect(shouldShowMainTabBar('SessionCard')).toBe(false);
    expect(shouldShowMainTabBar('SettingsMain')).toBe(false);
  });
});
