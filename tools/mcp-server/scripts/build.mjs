// Two-bundle build (contract §8.4):
//   src/deckLib.ts -> dist/deckLib.js  the console's importer rules, self-contained
//   src/index.ts   -> dist/index.js    the server; npm packages and ./deckLib stay external
// so dist/index.js loads the rules from dist/deckLib.js at runtime and never needs
// frontend/node_modules.

import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning' };

await build({
  ...common,
  entryPoints: [resolve(root, 'src/deckLib.ts')],
  outfile: resolve(root, 'dist/deckLib.js'),
});

/** Every import of ./deckLib (from any src/ depth) becomes the sibling dist/deckLib.js. */
const deckLibExternal = {
  name: 'deckLib-external',
  setup(b) {
    b.onResolve({ filter: /(^|\/)deckLib(\.ts|\.js)?$/ }, () => ({ path: './deckLib.js', external: true }));
  },
};

await build({
  ...common,
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(root, 'dist/index.js'),
  packages: 'external',
  plugins: [deckLibExternal],
  banner: { js: '#!/usr/bin/env node' },
});
