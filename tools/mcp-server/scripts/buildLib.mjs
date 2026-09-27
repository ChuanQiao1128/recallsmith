// Two-bundle build (contract §8.4):
//   src/deckLib.ts -> dist/deckLib.js  the console's importer rules, self-contained
//   src/index.ts   -> dist/index.js    the server; npm packages and ./deckLib stay external
// so dist/index.js loads the rules from dist/deckLib.js at runtime and never needs
// frontend/node_modules. It then writes dist/tool-surface.json (N4): the canonical JSON of the
// tool surface the server lists (names, descriptions, input schemas, version, lint/grounding
// limits), which the author-runner hashes into the gated authorConfigId.
//
// ai-agent-28: the surface file must never describe another bundle than the one next to it. The
// build deletes it before anything else, so a failed step leaves no surface (the runner then
// refuses with author_config_error), records the SHA-256 of the dist/index.js it was listed from
// as `bundleSha256` (the runner refuses a surface whose bundleSha256 differs from its bundle),
// and writes it through a temporary file and a rename, so it is never half written.

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning' };

/** Every import of ./deckLib (from any src/ depth) becomes the sibling dist/deckLib.js. */
const deckLibExternal = {
  name: 'deckLib-external',
  setup(b) {
    b.onResolve({ filter: /(^|\/)deckLib(\.ts|\.js)?$/ }, () => ({ path: './deckLib.js', external: true }));
  },
};

/** Runs the built surface script with node and returns what it prints. */
export function runSurfaceScript(script, root) {
  return execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
}

export async function buildMcpServer({ root, outDir = resolve(root, 'dist'), listSurface = runSurfaceScript }) {
  const surfaceFile = resolve(outDir, 'tool-surface.json');
  rmSync(surfaceFile, { force: true });

  await build({
    ...common,
    entryPoints: [resolve(root, 'src/deckLib.ts')],
    outfile: resolve(outDir, 'deckLib.js'),
  });

  const bundle = resolve(outDir, 'index.js');
  await build({
    ...common,
    entryPoints: [resolve(root, 'src/index.ts')],
    outfile: bundle,
    packages: 'external',
    plugins: [deckLibExternal],
    banner: { js: '#!/usr/bin/env node' },
  });

  // The tool surface, listed by the built server code itself; the helper bundle is removed again.
  const surfaceScript = resolve(outDir, 'tool-surface.build.mjs');
  let surface;
  try {
    await build({
      ...common,
      entryPoints: [resolve(root, 'src/toolSurfaceMain.ts')],
      outfile: surfaceScript,
      packages: 'external',
      plugins: [deckLibExternal],
    });
    surface = JSON.parse(await listSurface(surfaceScript, root));
  } finally {
    rmSync(surfaceScript, { force: true });
  }
  const bundleSha256 = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  const tmp = `${surfaceFile}.tmp`;
  // bundleSha256 sorts first, so the file stays canonical JSON.
  writeFileSync(tmp, `${JSON.stringify({ bundleSha256, ...surface })}\n`);
  renameSync(tmp, surfaceFile);
}
