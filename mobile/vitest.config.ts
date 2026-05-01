import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
      'tests/integration/**/*.test.tsx',
    ],
    environment: 'node',
    globals: true,
    passWithNoTests: false,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
