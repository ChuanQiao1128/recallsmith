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
 *
 * F31 (2026-09-27): +55.6 kB raw for react-router's data router
 * (createBrowserRouter/RouterProvider), required by useBlocker for the
 * unsaved-changes guard; measured 310,441 -> 366,033. Raised to measured+10k,
 * rounded up to the next 1,000.
 */
const FIRST_LOAD_BUDGET_BYTES = 377_000;

/**
 * The login page's real download, static closure plus the module-scope prefetch.
 * The headroom is deliberately small so a new dependency on the deck-list path
 * has to be noticed and argued for rather than absorbed.
 *
 * Raised once, from 400,000 (against a measurement of 383,911 when written), to
 * 418,000 against a measurement of 401,822. The +17,911 B that moved it is
 * accounted for below rather than absorbed. Three builds of this same closure,
 * one machine, one script, the same walk the assertions here perform:
 *
 *   old deps + old src   entry 279,304  http 37,687  eager 388,115
 *   new deps + old src   entry 280,298  http 49,136  eager 400,558
 *   new deps + new src   entry 281,002  http 49,667  eager 401,822
 *
 *   +12,443 B  dependency upgrades, which is 91% of the growth and none of it
 *              this repo's code: axios 1.13.6 -> 1.19.0 puts +11,449 B into the
 *              http chunk, react-router-dom 7.13.1 -> 7.18.2 puts +994 B into
 *              the entry. Both are security upgrades — the audit step in CI
 *              fails on the versions that were here before — so the choice was
 *              which number to move, not whether to grow.
 *    +1,264 B  the token-refresh work: +704 B in the entry (safeRedirect.ts,
 *              plus refreshTokens() reaching the eager LoginPage chunk through
 *              cognito.ts), +531 B in the http chunk (the refresh singleton and
 *              the redirect latch), +29 B in authoring (dropping the
 *              expectedVersion default).
 *    +4,178 B  headroom, kept at what it was before (400,000 - 383,911 = 16,089
 *              B, now 418,000 - 401,822 = 16,178 B) so this gate is exactly as
 *              tight as the person who set it intended.
 *
 * The first-load budget below was NOT moved: that closure went 308,582 ->
 * 310,280 against a 320,000 cap and still fits.
 *
 * F31 (2026-09-27): +55.6 kB raw for react-router's data router
 * (createBrowserRouter/RouterProvider), required by useBlocker for the
 * unsaved-changes guard; measured 418,085 -> 473,677. Raised to measured+10k,
 * rounded up to the next 1,000.
 */
const EAGER_BUDGET_BYTES = 484_000;

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
  /**
   * What an anonymous visitor to /login actually downloads.
   *
   * The closure above follows static edges only, which is the right definition
   * of "first load" and the wrong definition of "what the browser fetches".
   * App.tsx kicks off `import('./pages/DeckListPage')` at module scope so the
   * console's front door is warm by the time React mounts, and that request
   * fires on the login page too, for someone who has not signed in and may
   * never do so. Measured in a real browser against this build: the login page
   * pulls six extra chunks, axios among them.
   *
   * Reported separately rather than folded into closureBytes because the two
   * answer different questions and both are worth keeping honest. Nothing here
   * argues the prefetch is wrong — everyone who reaches this login page is
   * about to sign in — only that the smaller number must not be quoted as if
   * it were the whole story.
   */
  eagerClosure: string[];
  eagerBytes: number;
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
  const walk = (from: Iterable<string>): Set<string> => {
    const seen = new Set<string>(from);
    const queue = [...seen].filter(file => file.endsWith('.js'));
    while (queue.length > 0) {
      const file = queue.pop() as string;
      for (const spec of staticEdges(readFileSync(file, 'utf8'))) {
        const resolved = join(file, '..', spec);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          if (resolved.endsWith('.js')) queue.push(resolved);
        }
      }
    }
    return seen;
  };

  const closure = walk(seeds);
  const files = [...closure];

  // The module-scope prefetch, resolved the same way the browser would: the
  // deck-list chunk plus everything it statically pulls in behind it.
  const prefetched = listFiles(dir).filter(file => /\/DeckListPage-[^/]*\.js$/.test(file));
  const eager = walk([...closure, ...prefetched]);
  return {
    dir,
    closure: files,
    closureBytes: files.reduce((sum, file) => sum + statSync(file).size, 0),
    eagerClosure: [...eager],
    eagerBytes: [...eager].reduce((sum, file) => sum + statSync(file).size, 0),
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

describe('what the login page actually downloads', () => {
  it('is only a real number while App still prefetches at module scope', () => {
    // The eager closure is assembled by finding the deck-list chunk by name and
    // walking it, which describes the browser's behaviour only for as long as
    // something actually requests that chunk on load. Delete the prefetch and
    // the two assertions below would keep reporting 384 kB for a login page
    // that fetches 306 kB — a measurement that outlived its premise. So the
    // premise is asserted rather than assumed.
    const app = readFileSync(join(FRONTEND, 'src', 'App.tsx'), 'utf8');
    expect(app).toMatch(/const loadDeckList\s*=\s*\(\)\s*=>\s*import\(['"]\.\/pages\/DeckListPage['"]\)/);
    expect(app).toMatch(/void loadDeckList\(\)/);
  });

  it('costs more than the first-load closure, and the gap is the prefetch', () => {
    // Verified in a real browser on this build, not inferred: loading /login
    // while signed out fetched the entry and stylesheet, then DeckListPage,
    // authoring, http, ErrorBanner, sessionUser and ConsoleShell.
    expect(built.eagerBytes).toBeGreaterThan(built.closureBytes);

    const extra = built.eagerClosure.filter(file => !built.closure.includes(file));
    expect(extra.length).toBeGreaterThan(0);
  });

  it('stays under its own budget, so the prefetch chain cannot grow unnoticed', () => {
    const report = built.eagerClosure
      .map(file => `${statSync(file).size}\t${file.slice(built.dir.length + 1)}`)
      .sort()
      .join('\n');

    // The first-load budget guards the split; this one guards the decision to
    // warm the front door. Without it, anything new that DeckListPage imports
    // lands on the login page silently, and the number quoted in the docs keeps
    // saying 305 kB while the browser fetches more every release.
    expect(
      built.eagerBytes,
      `eager (login page) closure was ${built.eagerBytes} B, budget ${EAGER_BUDGET_BYTES} B\n${report}`,
    ).toBeLessThanOrEqual(EAGER_BUDGET_BYTES);
  });

  it('still keeps the expensive editor dependency out of it', () => {
    // highlight.js rides with CardForm, which is two navigations away. If it
    // ever reaches the prefetch chain the login page doubles and this says so.
    const hits = built.eagerClosure.filter(
      file => file.endsWith('.js') && readFileSync(file, 'utf8').includes('Illegal lexeme'),
    );
    expect(hits).toEqual([]);
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
