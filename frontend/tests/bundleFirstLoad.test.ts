// What a first-time visitor actually downloads before anything renders.
//
// ---------------------------------------------------------------------------
// WHY THIS MEASURES A CLOSURE AND NOT THE BUILD REPORT
// ---------------------------------------------------------------------------
// Counting chunks, or reading the size vite prints for the entry chunk, can be
// fooled in both directions, and both failure modes were reproduced on this
// repo before this file was written:
//
//   - A naive `manualChunks: id => id.includes('node_modules') ? 'vendor' : …`
//     makes the reporter print an entry of about 17 kB — thirty times smaller
//     than the real baseline — while the browser still downloads ~402 kB,
//     because the vendor chunk is a static dependency of the entry.
//   - Leaking one eager `import` of a page back into App.tsx changes no chunk
//     count at all, prints no warning, and exits 0, while the entry grows.
//
// So the number asserted here is: the entry script, every stylesheet and
// modulepreload the generated index.html lists, plus the transitive closure of
// STATIC import edges out of the entry. Dynamic `import(...)` edges are
// excluded on purpose — that is exactly the boundary route splitting creates.
//
// ---------------------------------------------------------------------------
// WHY THE CONTENT MARKERS ARE ALSO CHECKED, IN BOTH DIRECTIONS
// ---------------------------------------------------------------------------
// A byte budget catches "it got bigger". It does not catch "it got smaller
// overall but a heavy dependency moved back across the boundary", because that
// can still land under the cap. highlight.js and axios are therefore located by
// a string only they emit. Each marker is asserted to exist SOMEWHERE in the
// build first: if a dependency upgrade changes the literal, "not in the first
// load" would start passing vacuously, and a silently-vacuous assertion is
// worse than no assertion.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = fileURLToPath(new URL('..', import.meta.url));

/**
 * Ceiling on what a first-time visitor downloads, in bytes, JS + CSS.
 *
 * Measured, not guessed. The pre-split baseline was 553,688 B in one chunk.
 * After route splitting the measured closure is recorded in the step report;
 * this cap sits a few percent above it, tight enough that the three regressions
 * reproduced during this step (an eager page import, a naive vendor
 * manualChunks, and keeping DeckListPage synchronous) all exceed it.
 */
const FIRST_LOAD_BUDGET_BYTES = 320_000;

/**
 * Floor, so a parser that degenerates to an empty or near-empty set cannot make
 * the budget assertion vacuously true. React alone is far above this.
 */
const FIRST_LOAD_FLOOR_BYTES = 250_000;

interface BuildResult {
  dir: string;
  /** Absolute paths in the first-load closure. */
  closure: string[];
  closureBytes: number;
  entry: string;
  allFiles: string[];
  stderr: string;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/** Static import edges only: `from"./x.js"` and bare `import"./x.js"`. */
function staticEdges(code: string): string[] {
  const found: string[] = [];
  // `import(...)` cannot match either pattern: the first needs `from`, the
  // second needs a quote immediately after `import`, and a dynamic import has
  // an opening paren there instead.
  for (const re of [/from\s*["']([^"']+)["']/g, /(?:^|[;}\s])import\s*["']([^"']+)["']/g]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(code)) !== null) found.push(match[1]);
  }
  return found.filter(spec => spec.startsWith('./') || spec.startsWith('../'));
}

function buildAndMeasure(): BuildResult {
  const dir = mkdtempSync(join(tmpdir(), 'firstload-'));

  // NODE_ENV must be forced. Vitest runs with NODE_ENV=test, a child process
  // inherits it, and vite then resolves React's "development" export condition
  // and skips the production define. Measured on this repo: the inherited-test
  // build produced an 869,986 B entry against 521,135 B for `npm run build` —
  // this test would have been budgeting a bundle nobody ships.
  const result = spawnSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], {
    cwd: FRONTEND,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (result.status !== 0) {
    throw new Error(`vite build failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  }
  // Rollup writes the "also statically imported" notice to stdout, not stderr,
  // so both streams are searched for it.
  const stderr = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;

  const html = readFileSync(join(dir, 'index.html'), 'utf8');

  const assetOf = (href: string): string => join(dir, href.replace(/^\//, ''));

  const entryMatch = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html);
  if (!entryMatch) throw new Error('index.html has no module entry script');
  const entry = assetOf(entryMatch[1]);

  const seeds = new Set<string>([entry]);
  for (const re of [
    /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g,
    /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g,
  ]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) seeds.add(assetOf(match[1]));
  }

  // Transitive closure over static edges, JS only (CSS has no import graph here).
  const closure = new Set<string>(seeds);
  const queue = [...seeds].filter(file => file.endsWith('.js'));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const spec of staticEdges(readFileSync(file, 'utf8'))) {
      const resolved = join(file, '..', spec);
      if (!closure.has(resolved)) {
        closure.add(resolved);
        if (resolved.endsWith('.js')) queue.push(resolved);
      }
    }
  }

  const files = [...closure];
  return {
    dir,
    closure: files,
    closureBytes: files.reduce((sum, file) => sum + statSync(file).size, 0),
    entry,
    allFiles: listFiles(dir),
    stderr,
  };
}

// One build shared by every assertion below; a vite build is seconds, not
// milliseconds, and running it per test would dominate the suite.
let built: BuildResult;

describe('the production build', () => {
  it('builds, and the closure parser finds a non-empty set containing the entry', { timeout: 180_000 }, () => {
    built = buildAndMeasure();

    // Anti-vacuity: every assertion below is meaningless if the closure is
    // empty or has lost the entry chunk.
    expect(built.closure.length).toBeGreaterThan(0);
    expect(built.closure).toContain(built.entry);
    expect(built.closureBytes).toBeGreaterThan(FIRST_LOAD_FLOOR_BYTES);
  });

  it('keeps the first load under budget', () => {
    const report = built.closure
      .map(file => `${statSync(file).size}\t${file.slice(built.dir.length + 1)}`)
      .sort()
      .join('\n');
    expect(
      built.closureBytes,
      `first-load closure was ${built.closureBytes} B, budget ${FIRST_LOAD_BUDGET_BYTES} B\n${report}`,
    ).toBeLessThanOrEqual(FIRST_LOAD_BUDGET_BYTES);
  });

  it('does not statically import anything it also dynamically imports', () => {
    // Rollup emits this as a warning and still exits 0, so it has to be an
    // assertion or it is not a gate. A module on both edges is silently merged
    // back into the importer, undoing the split with no other visible signal.
    expect(built.stderr).not.toMatch(/but also statically imported/);
  });
});

describe('highlight.js', () => {
  it('is present in the build at all, so the marker below is not stale', () => {
    const hits = built.allFiles.filter(
      file => file.endsWith('.js') && readFileSync(file, 'utf8').includes('Illegal lexeme'),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it('is not in the first load', () => {
    const leaked = built.closure.filter(
      file => file.endsWith('.js') && readFileSync(file, 'utf8').includes('Illegal lexeme'),
    );
    expect(leaked.map(file => file.slice(built.dir.length + 1))).toEqual([]);
  });
});

describe('axios', () => {
  it('is present in the build at all, so the marker below is not stale', () => {
    const hits = built.allFiles.filter(
      file => file.endsWith('.js') && readFileSync(file, 'utf8').includes('ERR_BAD_REQUEST'),
    );
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('the shared card rules module', () => {
  it('rides behind the lazy boundary with its two consumers', () => {
    // cardRules.ts is imported by deckImport.ts and CardForm.tsx, both of which
    // sit behind lazy routes. Rollup may hoist it to a shared chunk or inline a
    // copy into each; neither outcome belongs in the first load. The uid regex
    // literal survives minification, so it is a reliable content marker.
    const marker = '[a-z0-9]+(?:[-_][a-z0-9]+)*';
    const leaked = built.closure.filter(
      file => file.endsWith('.js') && readFileSync(file, 'utf8').includes(marker),
    );
    expect(leaked.map(file => file.slice(built.dir.length + 1))).toEqual([]);
  });
});

describe('cleanup', () => {
  it('removes the temporary build directory', () => {
    rmSync(built.dir, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
