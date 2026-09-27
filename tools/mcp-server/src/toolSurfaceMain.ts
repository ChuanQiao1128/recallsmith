// Build step (N4): prints the canonical JSON of the tool surface; scripts/build.mjs writes it to dist/tool-surface.json.

import { listToolSurface } from './toolSurface';
import { canonicalJson } from './toolSurfaceHash';

process.stdout.write(`${canonicalJson(await listToolSurface())}\n`);
