import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only tests/ is discovered on purpose. The console app has no component
    // tests yet, so this layer is pure functions and needs no DOM; adding a
    // jsdom environment later is a per-file annotation, not a config rewrite.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // No globals: every test imports describe/it/expect explicitly, so a test
    // file that is run outside vitest fails loudly instead of silently.
    globals: false,
    // A run that discovers nothing is a broken config, not a pass.
    passWithNoTests: false,
  },
});
