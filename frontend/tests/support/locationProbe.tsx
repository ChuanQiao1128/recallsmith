// tests/support/locationProbe.tsx
//
// One component, and nothing else, on purpose.
//
// react-refresh/only-export-components is an ERROR in this repo's eslint
// config, and it fires on a module that defines a component alongside ordinary
// helpers — exporting the component is not required, defining it is enough. So
// the probe lives here, where the file's only export IS a component, and
// routerProbe.tsx next door exports only lowercase helpers, the same shape
// tests/support/queryTestClient.tsx already uses.
//
// NOT collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

import { useLocation } from 'react-router-dom';

/**
 * Renders the current path + query as text, so a navigation is assertable.
 *
 * Copied from the version proven in deckPaginationRowActions.test.tsx. It works
 * because the pages under test are mounted as a direct child of MemoryRouter
 * with no <Routes> around them: navigate() then updates history without
 * unmounting anything, so a probe rendered as a sibling survives the navigation
 * and can still be read afterwards.
 */
export function LocationProbe() {
  const location = useLocation();
  return <span data-testid="loc">{`${location.pathname}${location.search}`}</span>;
}
