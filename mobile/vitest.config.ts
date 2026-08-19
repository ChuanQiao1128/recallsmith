import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Both suffixes are included on purpose. The repo grew a .spec.ts(x)
    // convention alongside .test.ts(x), but the include list only ever listed
    // .test, so ~1.6k lines of tests silently never ran. Test discovery is
    // config-driven: "a test exists" and "a test runs" are different claims.
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/unit/**/*.spec.ts',
      'tests/unit/**/*.spec.tsx',
      'tests/integration/**/*.test.ts',
      'tests/integration/**/*.test.tsx',
      'tests/integration/**/*.spec.ts',
      'tests/integration/**/*.spec.tsx',
    ],
    // iCloud renames a sync-conflict loser to "name 2.test.ts", which the
    // include globs above happily collect -- a stale duplicate suite running
    // against current code, failing locally while CI (a clean checkout) stays
    // green. No legitimate test file here has a space in its name. Spread the
    // defaults first: `exclude` REPLACES them, and losing node_modules from the
    // list is a far worse day than the one this entry prevents.
    exclude: [...configDefaults.exclude, '**/* *'],
    environment: 'node',
    globals: true,
    // Defines __DEV__, which expo-modules-core reads at module scope. See the
    // file for why this is a setup file rather than a `define` entry.
    setupFiles: ['./tests/setup/globals.ts'],
    passWithNoTests: false,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
