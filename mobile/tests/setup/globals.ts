// React Native injects __DEV__ as a real global at runtime. Vitest does not, so
// any test whose import graph reaches expo-modules-core fails at module scope
// with "__DEV__ is not defined" before a single assertion runs.
//
// This is easy to trigger by accident: importing a debug helper into a screen is
// enough to pull expo into that screen's graph. Defining the global here keeps
// that accident from being a test-infrastructure failure.
//
// vitest's `define` option does not cover this, because these modules are
// transformed for the node (SSR) pipeline rather than the browser one.
(globalThis as Record<string, unknown>).__DEV__ = true;

export {};
