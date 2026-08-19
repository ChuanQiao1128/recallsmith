// Run: node scripts/bench-hot-paths.ts        (Node >= 23.6 strips the types)
//
// What this measures and what it does NOT measure
// ===============================================
// Two things live on the rating hot path, and they fail for different reasons,
// so they are measured separately:
//
//   Section A - pure core. scheduleNextReview / selectDrawCards / foldProgress
//   are allocation-light pure functions. They are measured in isolation, with no
//   storage and no I/O, because that is what they are: CPU on the main thread
//   between a tap and a frame.
//
//   Section B - the queue enqueue. recordReviewEvent is the durability step of
//   a rating. Its cost is dominated by JSON.parse/JSON.stringify over the whole
//   pending queue, which is why it is measured against queue DEPTH rather than
//   as a single number.
//
// Honest boundaries, stated up front:
//   * This is a millisecond/microsecond world running on a JIT with a garbage
//     collector, on a laptop, not a tuned microsecond world. Numbers below ~50ns
//     per op are at the resolution limit of the harness itself.
//   * Section B mocks AsyncStorage with an in-memory Map. That deliberately
//     removes the native bridge and the SQLite write, and deliberately KEEPS the
//     real JSON.parse / JSON.stringify cost, because the parse is the waste this
//     benchmark exists to expose. So Section B numbers are a LOWER BOUND on the
//     real device cost, and the before/after DELTA is the honest part: both
//     columns pay the same fake storage.
//   * A desktop V8 on an M-series laptop is faster than Hermes on a mid-range
//     Android. Treat the ratios as transferable and the absolute numbers as
//     "this machine, this runtime".
//
// Method: every measurement is warmed up first, then run as R rounds of K
// iterations. The reported figure is the MEDIAN round (plus p95 across rounds),
// never the best round. Medians because one GC pause in one round should not be
// allowed to become the headline, and p95 because the tail is the part a user
// actually feels.

import { registerHooks } from 'node:module';
import os from 'node:os';

import type { CardProgress, ReviewEvent, ReviewRating } from '../src/review/model';
import type { CardExport } from '../src/types/deckExport';

/**
 * ---------------------------------------------------------------------------
 * Loader: make the app's real modules importable under bare `node`
 * ---------------------------------------------------------------------------
 *
 * The app source imports without file extensions (`./cardRarity`), which plain
 * ESM cannot resolve, and it imports React Native / Expo packages that cannot
 * even be evaluated outside a device runtime. scripts/pity-simulation.ts worked
 * around this by re-implementing the rule it was measuring, which makes the
 * script drift away from the code it claims to measure.
 *
 * Instead: a resolve hook that retries a failed specifier with `.ts`, plus the
 * same stub set the vitest suites already use for the native packages. Every
 * function under measurement is the real one, imported from src/.
 */

/** Bare package specifiers replaced wholesale. Same surface the tests mock. */
const PACKAGE_STUBS: Record<string, string> = {
  '@react-native-async-storage/async-storage': `
    export const __store = new Map();
    const AsyncStorage = {
      getItem: async (k) => (__store.has(k) ? __store.get(k) : null),
      setItem: async (k, v) => { __store.set(k, v); },
      removeItem: async (k) => { __store.delete(k); },
      getAllKeys: async () => [...__store.keys()],
      multiRemove: async (keys) => { for (const k of keys) __store.delete(k); },
    };
    export default AsyncStorage;
  `,
  'expo-crypto': `
    let n = 0;
    // Not a real UUID. randomUUID's own cost is constant and is not what this
    // benchmark is about, and a counter keeps event ids readable when dumping
    // the queue by hand.
    export const randomUUID = () => 'bench-' + (++n);
  `,
  'expo-constants': `export default { expoConfig: { version: 'bench' } };`,
  'react-native': `export const Platform = { OS: 'ios' };`,
};

/**
 * App modules replaced by their import-time-safe stand-ins, matched on the
 * resolved path so the relative specifier does not have to be guessed.
 *
 * These are all import-time dependencies of progressSync that reach for the
 * device (file system, amplify, purchases). None of them is on the enqueue
 * path, so stubbing them changes nothing about what is being measured.
 */
const MODULE_STUBS: Record<string, string> = {
  '/src/api/apiClient.ts': `
    export const apiJson = async () => { throw new Error('bench: network disabled'); };
  `,
  '/src/content/deckRepository.ts': `export const resolveDeckBySlug = async () => null;`,
  '/src/review/storage.ts': `
    export const loadDeckProgress = async () => [];
    export const saveDeckProgress = async () => {};
    export const setActiveUserSubForStorage = () => {};
    export const getUserScopedKey = (k) => k;
  `,
  '/src/sync/drawStateSync.ts': `export const syncDrawStateNow = async () => {};`,
};

const STUB_PREFIX = 'bench-stub:';

registerHooks({
  resolve(specifier: string, context: any, nextResolve: (s: string, c?: any) => any) {
    if (Object.prototype.hasOwnProperty.call(PACKAGE_STUBS, specifier)) {
      return { url: STUB_PREFIX + specifier, shortCircuit: true };
    }

    let resolved: any;
    try {
      resolved = nextResolve(specifier, context);
    } catch (err) {
      // Extensionless relative import: retry the way TypeScript would read it.
      let recovered: any = null;
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        try {
          recovered = nextResolve(specifier + ext, context);
          break;
        } catch {
          // keep trying
        }
      }
      if (!recovered) throw err;
      resolved = recovered;
    }

    const url = String(resolved?.url ?? '');
    // Strip any cache-busting query before matching, so a re-imported module
    // still hits its stub.
    const path = url.split('?')[0];
    for (const suffix of Object.keys(MODULE_STUBS)) {
      if (path.endsWith(suffix)) return { url: STUB_PREFIX + suffix, shortCircuit: true };
    }

    return resolved;
  },

  load(url: string, context: any, nextLoad: (u: string, c?: any) => any) {
    if (url.startsWith(STUB_PREFIX)) {
      const key = url.slice(STUB_PREFIX.length);
      const source = PACKAGE_STUBS[key] ?? MODULE_STUBS[key];
      if (source == null) throw new Error(`bench: no stub source for ${key}`);
      return { format: 'module', shortCircuit: true, source };
    }
    return nextLoad(url, context);
  },
});

/**
 * ---------------------------------------------------------------------------
 * Timing harness
 * ---------------------------------------------------------------------------
 */

type Stat = {
  /** Nanoseconds per operation, median round. */
  medianNs: number;
  /** Nanoseconds per operation, 95th-percentile round. */
  p95Ns: number;
  rounds: number;
  itersPerRound: number;
};

/** Kept alive so V8 cannot delete the work being measured. */
let sink = 0;

function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

function summarize(perOpNs: number[], itersPerRound: number): Stat {
  const sorted = perOpNs.slice().sort((a, b) => a - b);
  return {
    medianNs: percentile(sorted, 0.5),
    p95Ns: percentile(sorted, 0.95),
    rounds: perOpNs.length,
    itersPerRound,
  };
}

function benchSync(fn: (i: number) => void, opts: { warmup: number; iters: number; rounds: number }): Stat {
  for (let i = 0; i < opts.warmup; i += 1) fn(i);

  const perOpNs: number[] = [];
  for (let r = 0; r < opts.rounds; r += 1) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < opts.iters; i += 1) fn(i);
    const end = process.hrtime.bigint();
    perOpNs.push(Number(end - start) / opts.iters);
  }
  return summarize(perOpNs, opts.iters);
}

function fmtNs(ns: number): string {
  if (!Number.isFinite(ns)) return 'n/a';
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(3)} ms`;
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(2)} µs`;
  return `${ns.toFixed(1)} ns`;
}

function fmtOps(ns: number): string {
  if (!Number.isFinite(ns) || ns <= 0) return 'n/a';
  const ops = 1e9 / ns;
  if (ops >= 1e6) return `${(ops / 1e6).toFixed(2)}M/s`;
  if (ops >= 1e3) return `${(ops / 1e3).toFixed(1)}k/s`;
  return `${ops.toFixed(0)}/s`;
}

/**
 * ---------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------
 */

const BASE_MS = Date.UTC(2026, 7, 16, 9, 0, 0);
const RATINGS: ReviewRating[] = ['good', 'hard', 'again', 'easy'];

/**
 * A 200-card pool with the same rarity mix scripts/pity-simulation.ts uses
 * (70% common / 27% rare / 3% legendary), because the guaranteed-pick branch in
 * selectDrawCards only runs when rares exist in the pool.
 */
function makeDeckCards(count: number): CardExport[] {
  const cards: CardExport[] = [];
  for (let i = 0; i < count; i += 1) {
    const pct = (i * 100) / count;
    const difficulty = pct < 3 ? 3 : pct < 30 ? 2 : 1;
    cards.push({
      StableUid: `uid-${String(i).padStart(4, '0')}`,
      Question: `Question ${i}`,
      Explanation: 'An explanation long enough to be representative of real content.',
      CodeSnippet: null,
      Difficulty: difficulty,
      OrderInDeck: i,
    });
  }
  return cards;
}

function makeReviewEvents(count: number, stableUid: string): ReviewEvent[] {
  const events: ReviewEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    events.push({
      stableUid,
      rating: RATINGS[i % RATINGS.length],
      // Deliberately not monotonic: sync and offline flushes deliver events out
      // of order, and the sort inside foldProgress is part of what is measured.
      at: BASE_MS + ((i * 7919) % count) * 60_000,
    });
  }
  return events;
}

/**
 * ---------------------------------------------------------------------------
 * Section A - pure core
 * ---------------------------------------------------------------------------
 */

async function runPureCoreSection(): Promise<string[]> {
  const modelUrl = new URL('../src/review/model.ts', import.meta.url).href;
  const poolUrl = new URL('../src/features/gacha/draw/poolSelection.ts', import.meta.url).href;

  const model = (await import(modelUrl)) as typeof import('../src/review/model');
  const pool = (await import(poolUrl)) as typeof import('../src/features/gacha/draw/poolSelection');

  const now = new Date(BASE_MS);
  let progress: CardProgress = { stableUid: 'uid-0000', stage: 0, nextReviewAt: 0 };

  const scheduleStat = benchSync(
    (i) => {
      // Feeding the result back in is what the app does (rate, store, rate
      // again) and it also stops V8 from proving the call dead.
      progress = model.scheduleNextReview(progress, RATINGS[i & 3], now);
      sink += progress.stage;
    },
    { warmup: 20_000, iters: 50_000, rounds: 15 },
  );

  const deckCards = makeDeckCards(200);
  const ownedSet = new Set<string>();

  const drawOneStat = benchSync(
    (i) => {
      const out = pool.selectDrawCards({
        deckCards,
        ownedSet,
        drawCount: 1,
        pityState: { draws: i % 10, threshold: 10 },
        seed: i * 2654435761,
      });
      sink += out.cards.length;
    },
    { warmup: 2_000, iters: 5_000, rounds: 15 },
  );

  const drawTenStat = benchSync(
    (i) => {
      const out = pool.selectDrawCards({
        deckCards,
        ownedSet,
        drawCount: 10,
        pityState: { draws: i % 10, threshold: 10 },
        seed: i * 2654435761,
      });
      sink += out.cards.length;
    },
    { warmup: 1_000, iters: 2_000, rounds: 15 },
  );

  const events = makeReviewEvents(1_000, 'uid-0000');
  const initial: CardProgress = { stableUid: 'uid-0000', stage: 0, nextReviewAt: 0 };

  const foldStat = benchSync(
    () => {
      const out = model.foldProgress(initial, events);
      sink += out.stage;
    },
    { warmup: 200, iters: 500, rounds: 15 },
  );

  const lines: string[] = [];
  lines.push('### A. Pure core (no storage, no I/O)');
  lines.push('');
  lines.push('| Workload | Median | p95 | Throughput (median) |');
  lines.push('| --- | ---: | ---: | ---: |');
  lines.push(
    `| \`scheduleNextReview\` (one rating) | ${fmtNs(scheduleStat.medianNs)} | ${fmtNs(scheduleStat.p95Ns)} | ${fmtOps(scheduleStat.medianNs)} |`,
  );
  lines.push(
    `| \`selectDrawCards\` (200-card pool, single pull) | ${fmtNs(drawOneStat.medianNs)} | ${fmtNs(drawOneStat.p95Ns)} | ${fmtOps(drawOneStat.medianNs)} |`,
  );
  lines.push(
    `| \`selectDrawCards\` (200-card pool, ten pull) | ${fmtNs(drawTenStat.medianNs)} | ${fmtNs(drawTenStat.p95Ns)} | ${fmtOps(drawTenStat.medianNs)} |`,
  );
  lines.push(
    `| \`foldProgress\` (replay 1000 events) | ${fmtNs(foldStat.medianNs)} | ${fmtNs(foldStat.p95Ns)} | ${fmtOps(foldStat.medianNs)} |`,
  );
  lines.push('');
  lines.push(
    `Rounds: ${scheduleStat.rounds}. Iterations per round: ${scheduleStat.itersPerRound} / ${drawOneStat.itersPerRound} / ${drawTenStat.itersPerRound} / ${foldStat.itersPerRound}.`,
  );
  return lines;
}

/**
 * ---------------------------------------------------------------------------
 * Section B - enqueue cost vs queue depth
 * ---------------------------------------------------------------------------
 *
 * Protocol, and why it is shaped this way:
 *
 * The write-through cache makes enqueue cost depend on whether the queue has
 * already been loaded in THIS process, so a benchmark that reuses one module
 * instance would measure "the queue was already hot" and prove nothing. Each
 * round therefore re-imports progressSync under a fresh URL (cache-busting
 * query), which resets its module-level state exactly the way an app launch
 * does, seeds AsyncStorage with a queue of the target depth, and then:
 *
 *   1. times the FIRST enqueue separately - that is the cold-start cost, which
 *      the optimization moves rather than removes, and hiding it would be
 *      dishonest;
 *   2. runs `warmupOps` untimed enqueues so V8 has tiered up;
 *   3. times `iters` enqueues.
 *
 * Depth drifts upward by one per enqueue, so the seed depth is chosen such that
 * the TIMED window is centred on the target depth. For a cost that is linear in
 * depth (which the read-modify-write path is), the mean over a centred ramp is
 * the cost at the centre, so the reported number is the cost at the stated
 * depth and not at the start of the window. The window is printed in the table
 * rather than left implicit, because at depth 0 it CANNOT be centred (depth
 * only ever grows) and the row would otherwise quietly report the cost at the
 * middle of its own ramp.
 *
 * No access token is set. recordReviewEvent then files events under the
 * signed-out partition, which runs the identical enqueue path, and no sync
 * timer can fire mid-measurement to pollute the numbers.
 */

const PENDING_QUEUE_KEY = 'devcards:u:__pending__:sync:progressQueue:v1';

type EnqueueStat = Stat & {
  coldStartNs: number;
  depth: number;
  /** Inclusive depth range the timed enqueues actually ran at. */
  windowFrom: number;
  windowTo: number;
};

function makeSeedQueueJson(depth: number): string {
  const events: unknown[] = [];
  for (let i = 0; i < depth; i += 1) {
    events.push({
      eventId: `seed-${i}`,
      schemaVersion: 1,
      eventType: 'card_reviewed',
      deckSlug: 'algorithms-101',
      deckVersion: '1.0.3',
      stableUid: `uid-${String(i % 200).padStart(4, '0')}`,
      rating: 1 + (i % 4),
      reviewedAtMs: BASE_MS + i * 1_000,
      progressAfter: {
        stableUid: `uid-${String(i % 200).padStart(4, '0')}`,
        stage: i % 7,
        lastReviewedAt: BASE_MS + i * 1_000,
        nextReviewAt: BASE_MS + i * 1_000 + 86_400_000,
        lapses: i % 3,
        hardStreak: 0,
      },
      lastSeenRevision: null,
      sessionId: `session-${i % 50}`,
      cardRevision: null,
      statedDifficulty: null,
      reviewStage: 'repeat_review',
      reviewCountForCard: i % 12,
      dwellTimeMs: 1_200 + (i % 400),
      offlineQueueDelayMs: 0,
      schedulerVersion: 'ladder-v1',
    });
  }
  return JSON.stringify(events);
}

async function benchEnqueueAtDepth(
  depth: number,
  opts: { warmupOps: number; iters: number; rounds: number },
): Promise<EnqueueStat> {
  const syncUrl = new URL('../src/sync/progressSync.ts', import.meta.url).href;
  const storageUrl = '@react-native-async-storage/async-storage';

  // The stub module is a singleton across re-imports of progressSync, which is
  // what lets the seeded queue survive into the fresh module instance.
  const storage = (await import(storageUrl)) as unknown as { __store: Map<string, string> };

  // Centre the timed window on `depth`: the first timed op happens after the
  // cold-start op and the warmup ops, and the window is `iters` long.
  const seedDepth = Math.max(0, depth - 1 - opts.warmupOps - Math.floor(opts.iters / 2));
  const seedJson = makeSeedQueueJson(seedDepth);

  const perOpNs: number[] = [];
  const coldNs: number[] = [];

  for (let round = 0; round < opts.rounds; round += 1) {
    storage.__store.clear();
    if (seedDepth > 0) storage.__store.set(PENDING_QUEUE_KEY, seedJson);

    const mod = (await import(`${syncUrl}?benchRound=${depth}-${round}`)) as typeof import('../src/sync/progressSync');

    const rate = (n: number) =>
      mod.recordReviewEvent({
        deckSlug: 'algorithms-101',
        stableUid: `uid-${String(n % 200).padStart(4, '0')}`,
        rating: 'good',
        reviewedAtMs: BASE_MS + n * 1_000,
        sessionId: 'bench-session',
        dwellTimeMs: 1_400,
        progressAfter: { stage: 3, nextReviewAt: BASE_MS + 86_400_000 },
      });

    const coldStart = process.hrtime.bigint();
    await rate(0);
    coldNs.push(Number(process.hrtime.bigint() - coldStart));

    for (let i = 0; i < opts.warmupOps; i += 1) await rate(i);

    const start = process.hrtime.bigint();
    for (let i = 0; i < opts.iters; i += 1) await rate(i);
    const end = process.hrtime.bigint();
    perOpNs.push(Number(end - start) / opts.iters);
  }

  storage.__store.clear();

  const stat = summarize(perOpNs, opts.iters);
  const coldSorted = coldNs.slice().sort((a, b) => a - b);
  return {
    ...stat,
    depth,
    coldStartNs: percentile(coldSorted, 0.5),
    // +1 for the cold-start enqueue that ran before the warmup ops.
    windowFrom: seedDepth + 1 + opts.warmupOps + 1,
    windowTo: seedDepth + 1 + opts.warmupOps + opts.iters,
  };
}

async function runEnqueueSection(): Promise<string[]> {
  const configs: Array<{ depth: number; warmupOps: number; iters: number; rounds: number }> = [
    // Depth 0 cannot be centred, so it runs the shortest window the harness can
    // still time reliably and reports that window honestly.
    { depth: 0, warmupOps: 0, iters: 25, rounds: 21 },
    { depth: 1_000, warmupOps: 60, iters: 40, rounds: 21 },
    { depth: 3_000, warmupOps: 60, iters: 40, rounds: 21 },
  ];

  const stats: EnqueueStat[] = [];
  for (const cfg of configs) {
    stats.push(await benchEnqueueAtDepth(cfg.depth, cfg));
  }

  const lines: string[] = [];
  lines.push('### B. `recordReviewEvent` (durable enqueue) vs queue depth');
  lines.push('');
  lines.push('| Nominal depth | Timed window (depths) | Median / enqueue | p95 / enqueue | Cold-start first enqueue |');
  lines.push('| ---: | :--- | ---: | ---: | ---: |');
  for (const s of stats) {
    lines.push(
      `| ${s.depth} | ${s.windowFrom}-${s.windowTo} | ${fmtNs(s.medianNs)} | ${fmtNs(s.p95Ns)} | ${fmtNs(s.coldStartNs)} |`,
    );
  }
  lines.push('');

  // Two-point fit on the 1000/3000 rows rather than "subtract the depth-0 row":
  // the depth-0 row is measured over a window that cannot be centred, so using
  // it as the intercept would bake its own ramp into every other number.
  const a = stats.find((s) => s.depth === 1_000);
  const b = stats.find((s) => s.depth === 3_000);
  if (a && b) {
    const slopeNs = (b.medianNs - a.medianNs) / (b.depth - a.depth);
    const interceptNs = a.medianNs - slopeNs * a.depth;
    lines.push(
      `Two-point fit over the 1000 and 3000 rows: **cost ≈ ${fmtNs(interceptNs)} + ${fmtNs(slopeNs)} × depth**.`,
    );
    lines.push(
      'The slope is the depth-dependent waste (parse + re-serialise of every queued event); the intercept is the fixed cost of the call (uuid, argument normalisation, one storage read for the token, one storage write).',
    );
  }
  lines.push('');
  lines.push(
    `Rounds per depth: ${configs.map((c) => c.rounds).join(' / ')}. Timed enqueues per round: ${configs.map((c) => c.iters).join(' / ')}. Untimed warmup enqueues per round: ${configs.map((c) => c.warmupOps).join(' / ')}.`,
  );
  return lines;
}

/**
 * ---------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------------
 */

function environmentLines(): string[] {
  const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
  return [
    '### Environment',
    '',
    `- Runtime: Node ${process.version} (V8 ${process.versions.v8})`,
    `- Machine: ${cpu}, ${os.cpus().length} logical cores, ${os.platform()} ${os.arch()} ${os.release()}`,
    `- Measured: ${new Date().toISOString()}`,
    '- Storage in Section B is an in-memory Map: real JSON.parse/stringify cost, no native bridge, no disk.',
  ];
}

async function main(): Promise<void> {
  const out: string[] = [];
  out.push('## RecallSmith mobile hot-path benchmark');
  out.push('');
  out.push(...environmentLines());
  out.push('');
  out.push(...(await runPureCoreSection()));
  out.push('');
  out.push(...(await runEnqueueSection()));
  out.push('');

  console.log(out.join('\n'));

  // Referenced so the accumulator cannot be optimised away entirely.
  if (!Number.isFinite(sink)) throw new Error('unreachable');
}

await main();
