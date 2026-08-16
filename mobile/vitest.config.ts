import { defineConfig } from 'vitest/config';

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
