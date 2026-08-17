import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Test-only JSX settings. The production build reads vite.config.ts, which
  // this file does not extend, so nothing here can reach dist/. tests/ is
  // outside tsconfig.app.json's include, so esbuild would otherwise have no
  // jsx setting to pick up for a .tsx test file.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    // Only tests/ is discovered on purpose. .tsx is admitted for the wiring
    // tests, which mount a page; .ts stays the extension for the pure layer.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // node stays the default because the pure layer is the majority and does
    // not need a DOM: a jsdom document costs real milliseconds per file to
    // build and tear down, and it hides accidental DOM dependencies in code
    // that is supposed to be portable.
    //
    // The DOM is opted into per file with a `@vitest-environment jsdom`
    // docblock rather than an environmentMatchGlobs entry. Two reasons: the
    // glob form was removed in Vitest 4, and the docblock keeps the
    // declaration in the file that needs it, so renaming or moving a test
    // cannot silently change the environment it runs under.
    environment: 'node',
    // No globals: every test imports describe/it/expect explicitly, so a test
    // file that is run outside vitest fails loudly instead of silently.
    globals: false,
    // A run that discovers nothing is a broken config, not a pass.
    passWithNoTests: false,
  },
});
