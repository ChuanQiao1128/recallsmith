// One-bundle build (A00 §11.1): src/index.ts -> dist/index.js. The MCP server's
// client code (../mcp-server/src/{config.ts,api.ts,auth/tokens.ts}, node: builtins
// only) is imported from src/ and bundled at build time, so the runner has no
// runtime dependency and never needs `npm ci` in tools/mcp-server.

import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(root, 'dist/index.js'),
  banner: { js: '#!/usr/bin/env node' },
});
