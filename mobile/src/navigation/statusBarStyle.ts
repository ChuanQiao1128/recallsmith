// The Me tab (More), Help and Debug screens render on the dark "cosmic"
// background, so their status bar text must be light to stay readable
// (MSHELL-07). Every other route uses the light parchment background and needs
// dark status-bar text. Pure module — no react-native import — so it can be
// unit-tested without a native mock.
export const COSMIC_ROUTE_NAMES: ReadonlySet<string> = new Set(['More', 'HelpFAQ', 'DebugMenu']);

export function statusBarStyleForRoute(routeName: string | undefined): 'light' | 'dark' {
  if (routeName !== undefined && COSMIC_ROUTE_NAMES.has(routeName)) return 'light';
  return 'dark';
}
