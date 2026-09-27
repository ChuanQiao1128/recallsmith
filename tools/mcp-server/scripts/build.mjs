// `npm run build`: the two bundles and dist/tool-surface.json (see buildLib.mjs).

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMcpServer } from './buildLib.mjs';

await buildMcpServer({ root: resolve(dirname(fileURLToPath(import.meta.url)), '..') });
