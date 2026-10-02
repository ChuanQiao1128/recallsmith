import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// R24-00 §2.2: upgradeStarterDecks runs on app foreground (App.tsx) and on Home focus (covered by
// tests/integration/home-starter-lesson.spec.tsx). App.tsx cannot be mounted under Node (native
// navigation, gesture handler), so its wiring is pinned at the source level.
const APP_SOURCE = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');

describe('starter pack upgrade triggers (R24 §2.2)', () => {
  it('App imports upgradeStarterDecks from the starter module', () => {
    expect(APP_SOURCE).toMatch(/import \{ upgradeStarterDecks \} from '\.\/src\/content\/starterOffline';/);
  });

  it("App calls it inside the AppState 'active' branch", () => {
    const listener = APP_SOURCE.slice(APP_SOURCE.indexOf("AppState.addEventListener('change'"));
    expect(listener.length).toBeGreaterThan(0);
    const activeBranch = listener.slice(listener.indexOf("if (state === 'active') {"));
    const branchBody = activeBranch.slice(0, activeBranch.indexOf('\n      }'));
    expect(branchBody).toContain('void upgradeStarterDecks();');
  });
});
