// mobile/src/telemetry/funnel.ts
//
// Anonymous install funnel (R24 §3.1, §3.4). Records a handful of first-run moments, each at
// most once per install, and posts them as cohort counts to POST /api/v1/public/events.
//
// No identifiers at all: an event is `{ event, cohortDay, eventDay, deckSlug? }` and a batch adds
// only `platform` and `appVersion`. No user, account, device or install id is stored or sent, and
// the injected `post` sends no bearer token. The state lives under one device-global AsyncStorage
// key (not user-scoped): `{ cohortDay, sent, queue }`.
//
// Recording is local and always cheap. Sending happens in the background (fire-and-forget, never
// throws, batches of at most FUNNEL_BATCH_MAX, at most FUNNEL_QUEUE_MAX queued, a failed batch
// stays queued for the next foreground) and only when ALL hold:
//   - the production update channel (the Sentry rule: not a dev build, channel 'production');
//   - the remote flag features.anonFunnel.enabled === true (default false in code);
//   - Settings › Privacy "Share anonymous usage counts" is on (default on).
// With the Settings toggle off nothing is queued and the queue is dropped.
//
// IMPORTANT: like clientErrorReporter.ts this module imports nothing at runtime. Storage, the
// POST, the gates, the clock and the build facts are injected from App.tsx via configureFunnel,
// so screens and tests can import it without pulling AsyncStorage, apiClient or expo modules.

export const FUNNEL_STATE_KEY = 'recallsmith:funnel:v1';
export const FUNNEL_EVENTS_PATH = '/api/v1/public/events';
export const FUNNEL_BATCH_MAX = 20;
export const FUNNEL_QUEUE_MAX = 50;

export const FUNNEL_EVENTS = Object.freeze([
  'first_open',
  'goal_chosen',
  'starter_started',
  'starter_completed',
  'first_pack_opened',
  'returned_day_1',
  'returned_day_7',
  'signup_started',
  'signup_completed',
] as const);

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export type FunnelQueuedEvent = {
  event: FunnelEvent;
  /** Local date of the first open, YYYY-MM-DD. */
  cohortDay: string;
  /** Local date the event happened, YYYY-MM-DD. */
  eventDay: string;
  deckSlug?: string;
};

export type FunnelState = {
  cohortDay: string | null;
  sent: Partial<Record<FunnelEvent, true>>;
  queue: FunnelQueuedEvent[];
};

export type FunnelBatch = {
  platform: string;
  appVersion: string;
  events: FunnelQueuedEvent[];
};

export type FunnelStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type FunnelDeps = {
  storage: FunnelStorage;
  /** POSTs the batch WITHOUT a bearer token. Rejects on a network or HTTP failure. */
  post: (path: string, body: FunnelBatch) => Promise<unknown>;
  isProductionChannel: () => boolean;
  isRemoteEnabled: () => boolean;
  /** Settings › Privacy "Share anonymous usage counts". */
  isShareEnabled: () => boolean | Promise<boolean>;
  getEnv: () => { platform: string | null; appVersion: string | null };
  now: () => number;
};

export type Funnel = {
  /** Records `event` once per install (later calls are no-ops), then tries to send. */
  record(event: FunnelEvent, deckSlug?: string | null): Promise<void>;
  /**
   * App launch: records first_open. An install that already finished onboarding before this
   * module shipped (`existingInstall`) is not a new install: every event is marked done and
   * nothing is ever queued for it.
   */
  start(opts?: { existingInstall?: boolean }): Promise<void>;
  /** App foreground: returned_day_1 / returned_day_7 on cohortDay + 1 / + 7, then a send attempt. */
  onForeground(): Promise<void>;
  flush(): Promise<void>;
  /** Drops everything queued (the Settings toggle was turned off). */
  clearQueue(): Promise<void>;
};

const EVENT_SET = new Set<string>(FUNNEL_EVENTS);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const APP_VERSION_RE = /^\d+\.\d+\.\d+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLATFORMS = new Set(['ios', 'android']);

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar date of `ms`, YYYY-MM-DD. */
export function funnelLocalDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `day` plus `n` calendar days (local calendar, DST-safe). */
export function funnelAddDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(y, m - 1, d + n);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

function emptyState(): FunnelState {
  return { cohortDay: null, sent: {}, queue: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanSlug(slug: unknown): string | undefined {
  if (typeof slug !== 'string') return undefined;
  const s = slug.trim();
  return SLUG_RE.test(s) ? s : undefined;
}

function cleanQueued(value: unknown): FunnelQueuedEvent | null {
  if (!isRecord(value)) return null;
  const { event, cohortDay, eventDay } = value;
  if (typeof event !== 'string' || !EVENT_SET.has(event)) return null;
  if (typeof cohortDay !== 'string' || !DAY_RE.test(cohortDay)) return null;
  if (typeof eventDay !== 'string' || !DAY_RE.test(eventDay)) return null;
  const out: FunnelQueuedEvent = { event: event as FunnelEvent, cohortDay, eventDay };
  const deckSlug = cleanSlug(value.deckSlug);
  if (deckSlug) out.deckSlug = deckSlug;
  return out;
}

/** Keeps only the known fields; anything malformed falls back to an empty part. */
export function parseFunnelState(raw: string | null): FunnelState {
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return emptyState();
    const cohortDay =
      typeof parsed.cohortDay === 'string' && DAY_RE.test(parsed.cohortDay) ? parsed.cohortDay : null;
    const sent: Partial<Record<FunnelEvent, true>> = {};
    if (isRecord(parsed.sent)) {
      for (const [key, value] of Object.entries(parsed.sent)) {
        if (value === true && EVENT_SET.has(key)) sent[key as FunnelEvent] = true;
      }
    }
    const queue = Array.isArray(parsed.queue)
      ? parsed.queue
          .map(cleanQueued)
          .filter((e): e is FunnelQueuedEvent => e !== null)
          .slice(0, FUNNEL_QUEUE_MAX)
      : [];
    return { cohortDay, sent, queue };
  } catch {
    return emptyState();
  }
}

/** A 4xx other than 408/429 will not get better on retry: the batch is dropped. */
function isPermanentRejection(error: unknown): boolean {
  const status = isRecord(error) ? error.status : undefined;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function createFunnel(deps: Partial<FunnelDeps>): Funnel {
  // Every read-modify-write runs on this chain, so concurrent records never lose each other.
  let chain: Promise<unknown> = Promise.resolve();

  function serial<T>(task: () => Promise<T>, fallback: T): Promise<T> {
    const next = chain.then(task, task).catch(() => fallback);
    chain = next;
    return next;
  }

  function now(): number {
    try {
      return (deps.now ?? Date.now)();
    } catch {
      return Date.now();
    }
  }

  async function load(): Promise<FunnelState | null> {
    if (!deps.storage) return null;
    return parseFunnelState(await deps.storage.getItem(FUNNEL_STATE_KEY));
  }

  async function save(state: FunnelState): Promise<void> {
    if (!deps.storage) return;
    await deps.storage.setItem(FUNNEL_STATE_KEY, JSON.stringify(state));
  }

  async function shareEnabled(): Promise<boolean> {
    try {
      return deps.isShareEnabled ? (await deps.isShareEnabled()) !== false : true;
    } catch {
      return false;
    }
  }

  function gate(read: (() => boolean) | undefined): boolean {
    try {
      return read ? read() === true : false;
    } catch {
      return false;
    }
  }

  /** Marks `event` done and, when sharing is on, queues it. Returns true when the state changed. */
  async function recordInto(state: FunnelState, event: FunnelEvent, deckSlug?: string | null): Promise<boolean> {
    if (state.sent[event]) return false;
    const today = funnelLocalDay(now());
    if (!state.cohortDay) state.cohortDay = today;
    state.sent[event] = true;
    if ((await shareEnabled()) && state.queue.length < FUNNEL_QUEUE_MAX) {
      const item: FunnelQueuedEvent = { event, cohortDay: state.cohortDay, eventDay: today };
      const slug = cleanSlug(deckSlug);
      if (slug) item.deckSlug = slug;
      state.queue.push(item);
    }
    return true;
  }

  async function flushLocked(): Promise<void> {
    const state = await load();
    if (!state || state.queue.length === 0) return;
    if (!(await shareEnabled())) {
      state.queue = [];
      await save(state);
      return;
    }
    if (!gate(deps.isProductionChannel) || !gate(deps.isRemoteEnabled) || !deps.post) return;
    const env = deps.getEnv ? deps.getEnv() : null;
    const platform = env?.platform ?? '';
    const appVersion = env?.appVersion ?? '';
    if (!PLATFORMS.has(platform) || !APP_VERSION_RE.test(appVersion)) return;

    while (state.queue.length > 0) {
      const events = state.queue.slice(0, FUNNEL_BATCH_MAX);
      try {
        await deps.post(FUNNEL_EVENTS_PATH, { platform, appVersion, events });
      } catch (error) {
        if (!isPermanentRejection(error)) return; // stays queued; next foreground retries
      }
      state.queue = state.queue.slice(events.length);
      await save(state);
    }
  }

  function flush(): Promise<void> {
    return serial(flushLocked, undefined);
  }

  function record(event: FunnelEvent, deckSlug?: string | null): Promise<void> {
    if (!EVENT_SET.has(event)) return Promise.resolve();
    return serial(async () => {
      const state = await load();
      if (!state) return;
      if (await recordInto(state, event, deckSlug)) await save(state);
    }, undefined).then(flush);
  }

  function start(opts?: { existingInstall?: boolean }): Promise<void> {
    return serial(async () => {
      const state = await load();
      if (!state) return;
      if (state.cohortDay === null && Object.keys(state.sent).length === 0 && opts?.existingInstall) {
        state.cohortDay = funnelLocalDay(now());
        for (const event of FUNNEL_EVENTS) state.sent[event] = true;
        state.queue = [];
        await save(state);
        return;
      }
      if (await recordInto(state, 'first_open')) await save(state);
    }, undefined).then(onForeground);
  }

  function onForeground(): Promise<void> {
    return serial(async () => {
      const state = await load();
      if (!state || !state.cohortDay) return;
      const today = funnelLocalDay(now());
      let changed = false;
      if (today === funnelAddDays(state.cohortDay, 1)) changed = (await recordInto(state, 'returned_day_1')) || changed;
      if (today === funnelAddDays(state.cohortDay, 7)) changed = (await recordInto(state, 'returned_day_7')) || changed;
      if (changed) await save(state);
    }, undefined).then(flush);
  }

  function clearQueue(): Promise<void> {
    return serial(async () => {
      const state = await load();
      if (!state || state.queue.length === 0) return;
      state.queue = [];
      await save(state);
    }, undefined);
  }

  return { record, start, onForeground, flush, clearQueue };
}

let funnel = createFunnel({});

export function configureFunnel(deps: Partial<FunnelDeps>): void {
  funnel = createFunnel(deps);
}

function fireAndForget(run: () => Promise<void>): void {
  try {
    void run().catch(() => {});
  } catch {
    // never throw
  }
}

/** Fire-and-forget; never throws. A no-op until App.tsx has called configureFunnel. */
export function recordFunnelEvent(event: FunnelEvent, deckSlug?: string | null): void {
  fireAndForget(() => funnel.record(event, deckSlug));
}

export function startFunnel(opts?: { existingInstall?: boolean }): void {
  fireAndForget(() => funnel.start(opts));
}

export function funnelOnForeground(): void {
  fireAndForget(() => funnel.onForeground());
}

export function flushFunnel(): void {
  fireAndForget(() => funnel.flush());
}

export function clearFunnelQueue(): void {
  fireAndForget(() => funnel.clearQueue());
}
