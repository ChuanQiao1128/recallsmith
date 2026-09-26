// mobile/src/auth/leaveAuthFlow.ts
//
// Leaving the auth funnel is subtle: the user may have arrived at SignIn from
// Home, or bounced SignIn -> SignUp -> ConfirmSignUp -> ForgotPassword, and we
// want to land back on whatever screen opened the funnel (not stack a fresh
// Home on top of it). We walk down past every auth route and popTo the first
// non-auth route below; if the funnel is the whole stack, reset to Home.
//
// react-navigation 7 semantics (routers/StackRouter): popTo(name, params)
// removes every route above the nearest matching `name` and replaces its
// params. This helper is idempotent — a signed-in effect and a success path
// may both fire in one transition, so a no-op once we've already left is
// required.

export const AUTH_ROUTE_NAMES = ['SignIn', 'SignUp', 'ConfirmSignUp', 'ForgotPassword'] as const;

export type LeaveAuthNavigation = {
  getState(): { routes: ReadonlyArray<{ name: string; params?: object }> } | undefined;
  popTo(name: string, params?: object): void;
  reset(state: { index: number; routes: Array<{ name: string }> }): void;
};

function isAuthRoute(name: string): boolean {
  return (AUTH_ROUTE_NAMES as ReadonlyArray<string>).includes(name);
}

export function leaveAuthFlow(navigation: LeaveAuthNavigation): void {
  const routes = navigation.getState?.()?.routes ?? [];

  // Empty stack (or no state yet): nothing above to unwind, land on Home.
  if (routes.length === 0) {
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    return;
  }

  const top = routes[routes.length - 1];
  // Idempotent: if we're no longer on an auth screen, someone already left.
  if (!isAuthRoute(top.name)) return;

  // Walk down past the contiguous run of auth routes at the top of the stack
  // to find the screen that opened the funnel.
  let i = routes.length - 1;
  while (i >= 0 && isAuthRoute(routes[i].name)) i--;

  if (i >= 0) {
    const target = routes[i];
    navigation.popTo(target.name, target.params);
    return;
  }

  // The whole stack is auth routes: no origin to return to, so reset to Home.
  navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
}
