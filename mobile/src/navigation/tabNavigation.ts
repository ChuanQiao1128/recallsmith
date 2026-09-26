// Single choke point for tab-bar and "home" navigation on the shared native
// stack. React Navigation 7's StackRouter NAVIGATE only reuses an existing
// route when it is the current one or `payload.pop` is set; without pop every
// tab tap / "Back to Home" pushes another copy of Home/Draw/Library/More and
// the stack grows for the whole session (MSHELL-01, MACCT-19). Passing
// { pop: true } pops back to the existing route instead of stacking a new one.
export type TabNavigator = { navigate: (...args: any[]) => void };

export function navigateToTab(navigation: TabNavigator, route: string, params?: object): void {
  navigation.navigate(route, params, { pop: true });
}

export function goHome(navigation: TabNavigator): void {
  navigateToTab(navigation, 'Home');
}
