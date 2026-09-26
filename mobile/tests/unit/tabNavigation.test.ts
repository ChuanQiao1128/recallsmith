import { describe, expect, it, vi } from 'vitest';
import { StackRouter, CommonActions } from '@react-navigation/routers';

import { goHome, navigateToTab } from '../../src/navigation/tabNavigation';

describe('tabNavigation helpers', () => {
  it('navigateToTab passes pop: true so an existing route is reused', () => {
    const navigate = vi.fn();
    navigateToTab({ navigate }, 'Library', { focusSlug: 'csharp' });
    expect(navigate).toHaveBeenCalledWith('Library', { focusSlug: 'csharp' }, { pop: true });
  });

  it('goHome pops back to the Home route already in the stack', () => {
    const navigate = vi.fn();
    goHome({ navigate });
    expect(navigate).toHaveBeenCalledWith('Home', undefined, { pop: true });
  });

  it('tab hops never grow the stack past one copy of each route', () => {
    // Drive the real StackRouter the app uses. NAVIGATE with { pop: true }
    // pops back to an existing route instead of pushing a duplicate, so the
    // stack never accumulates a second copy of any tab route in a session.
    const router = StackRouter({});
    const options = {
      routeNames: ['Home', 'Library', 'Draw', 'More'],
      routeParamList: {},
      routeGetIdList: {},
    } as any;
    let state = router.getInitialState(options);

    const hop = (name: string) => {
      const action = CommonActions.navigate(name, undefined, { pop: true });
      state = router.getStateForAction(state, action, options) ?? state;
      const names = state.routes.map((route) => route.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    };

    for (const name of ['Home', 'Library', 'Draw', 'Library', 'More', 'Home']) {
      hop(name);
    }

    const finalNames = state.routes.map((route) => route.name);
    expect(new Set(finalNames).size).toBe(finalNames.length);
  });
});
