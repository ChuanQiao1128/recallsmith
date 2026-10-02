// R25 G03: the DebugMenu stack route is registered only where isDebugMenuAvailable()
// holds, so a production-channel build has no DebugMenu route at all. App.tsx passes
// the <Stack.Screen> element in a thunk (a navigator only accepts Screen elements and
// fragments as children, not a wrapper component).
import type React from 'react';

import { isDebugMenuAvailable } from '../config/debugMenu';

export function debugMenuRoute(screen: () => React.ReactElement): React.ReactElement | null {
  return isDebugMenuAvailable() ? screen() : null;
}
