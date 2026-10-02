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
// Recording is local and always cheap; a record does not send by itself. Sending happens in the
// background (fire-and-forget, never throws) at launch, on foreground, when the remote flag flips
// and FUNNEL_FLUSH_DEBOUNCE_MS after the last record. A flush sends ONE POST with at most
// FUNNEL_BATCH_MAX events; at most FUNNEL_QUEUE_MAX are queued. Only a validation rejection
// (400/413/422) drops a batch; anything else (401/403/404/408/429/5xx, network, timeout) keeps it
// queued for the next flush. Sending happens only when ALL hold:
//   - the production update channel (the Sentry rule: not a dev build, channel 'production');
//   - the remote flag features.anonFunnel.enabled === true (default false in code);
//   - Settings › Privacy "Share anonymous usage counts" is on (default on).
// With the Settings toggle off nothing is queued and the queue is dropped.
//
// The POST (createFunnelXhrPost) does not go through apiClient: it sets only content-type, so it
// carries no Authorization, no x-dc-trace-id and, because the XHR is flagged as Sentry's own
// request, no sentry-trace/baggage either. A shared trace id would let a batch be joined to the
// signed-in requests around it in the server logs (contract §3).
//
// IMPORTANT: like clientErrorReporter.ts this module imports nothing at runtime. Storage, the
// POST, the gates, the clock and the build facts are injected from App.tsx (createAppFunnelDeps,
// startAppFunnel), so screens and tests can import it without pulling AsyncStorage, apiClient
// or expo modules.

export const FUNNEL_STATE_KEY = 'recallsmith:funnel:v1';
export const FUNNEL_EVENTS_PATH = '/api/v1/public/events';
export const FUNNEL_BATCH_MAX = 20;
export const FUNNEL_QUEUE_MAX = 50;
/** A record schedules one flush this long after the LAST record, so a first run sends 1–2 POSTs. */
export const FUNNEL_FLUSH_DEBOUNCE_MS = 60_000;
export const FUNNEL_POST_TIMEOUT_MS = 12_000;

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
  /** Timer for the debounced flush after a record (default: global setTimeout/clearTimeout). */
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export type Funnel = {
  /** Records `event` once per install (later calls are no-ops); a send follows after the debounce. */
  record(event: FunnelEvent, deckSlug?: string | null): Promise<void>;
  /**
   * App launch: records first_open. An install that already had study progress or a finished
   * onboarding when this module first ran (`existingInstall`) is not a new install: every event
   * is marked done and nothing is ever queued for it.
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

/**
 * Only a validation rejection (400/413/422) will not get better on retry: the batch is dropped.
 * 401/403/404 come from routing or auth (the route not applied yet, a wrong base), not from the
 * payload, and every event is already marked sent, so dropping them would lose the step for good.
 */
const PERMANENT_STATUSES = new Set([400, 413, 422]);

function isPermanentRejection(error: unknown): boolean {
  const status = isRecord(error) ? error.status : undefined;
  return typeof status === 'number' && PERMANENT_STATUSES.has(status);
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

    // One POST per flush; anything past FUNNEL_BATCH_MAX waits for the next flush.
    const events = state.queue.slice(0, FUNNEL_BATCH_MAX);
    try {
      await deps.post(FUNNEL_EVENTS_PATH, { platform, appVersion, events });
    } catch (error) {
      if (!isPermanentRejection(error)) return; // stays queued; the next flush retries
    }
    state.queue = state.queue.slice(events.length);
    await save(state);
  }

  let timer: unknown = null;

  function cancelTimer(): void {
    if (timer === null) return;
    const handle = timer;
    timer = null;
    try {
      (deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(handle);
    } catch {
      // never throw
    }
  }

  function flush(): Promise<void> {
    cancelTimer();
    return serial(flushLocked, undefined);
  }

  /** (Re)starts the debounce: one flush FUNNEL_FLUSH_DEBOUNCE_MS after the last record. */
  function scheduleFlush(): void {
    cancelTimer();
    try {
      timer = (deps.setTimer ?? setTimeout)(() => {
        timer = null;
        void flush();
      }, FUNNEL_FLUSH_DEBOUNCE_MS);
    } catch {
      timer = null;
    }
  }

  function record(event: FunnelEvent, deckSlug?: string | null): Promise<void> {
    if (!EVENT_SET.has(event)) return Promise.resolve();
    return serial(async () => {
      const state = await load();
      if (!state) return;
      if (await recordInto(state, event, deckSlug)) {
        await save(state);
        scheduleFlush();
      }
    }, undefined);
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

// ---- The POST: a plain XHR with content-type only (no apiClient, no token, no trace) ----

/** The slice of XMLHttpRequest the funnel POST uses. */
export type FunnelXhr = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: string): void;
  timeout: number;
  readonly status: number;
  // `ev: never` so a real XMLHttpRequest (whose handlers take a ProgressEvent) fits this slice.
  onload: ((ev: never) => unknown) | null;
  onerror: ((ev: never) => unknown) | null;
  ontimeout: ((ev: never) => unknown) | null;
  /** Sentry's XHR instrumentation skips a request with this flag: no span, no sentry-trace/baggage. */
  __sentry_own_request__?: boolean;
};

/** The only request header the funnel POST ever sets. */
export const FUNNEL_REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'application/json',
});

function sendOnce(createXhr: () => FunnelXhr, url: string, payload: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = createXhr();
    xhr.__sentry_own_request__ = true;
    xhr.onload = () => {
      const status = xhr.status;
      if (status >= 200 && status < 300) resolve();
      else reject(Object.assign(new Error(`HTTP ${status}`), { status }));
    };
    xhr.onerror = () => reject(Object.assign(new Error('Network request failed'), { kind: 'offline' }));
    xhr.ontimeout = () => reject(Object.assign(new Error('Request timed out'), { kind: 'timeout' }));
    xhr.open('POST', url);
    xhr.timeout = timeoutMs;
    for (const [name, value] of Object.entries(FUNNEL_REQUEST_HEADERS)) xhr.setRequestHeader(name, value);
    xhr.send(payload);
  });
}

/**
 * The injected `post`: tries each API base in order, moving on only after a network failure (an
 * HTTP status answers for the route). It never sends Authorization, x-dc-trace-id, sentry-trace
 * or baggage, so a batch shares no key with any other request.
 */
export function createFunnelXhrPost(opts: {
  createXhr: () => FunnelXhr;
  getBases: () => ReadonlyArray<string | null | undefined>;
  timeoutMs?: number;
}): FunnelDeps['post'] {
  return async (path, body) => {
    const bases: string[] = [];
    for (const raw of opts.getBases()) {
      const base = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
      if (base && !bases.includes(base)) bases.push(base);
    }
    if (bases.length === 0) throw Object.assign(new Error('No API base'), { kind: 'offline' });
    const payload = JSON.stringify(body);
    let lastError: unknown = null;
    for (const base of bases) {
      try {
        await sendOnce(opts.createXhr, `${base}${path}`, payload, opts.timeoutMs ?? FUNNEL_POST_TIMEOUT_MS);
        return null;
      } catch (error) {
        lastError = error;
        if (!(isRecord(error) && error.kind === 'offline')) throw error;
      }
    }
    throw lastError;
  };
}

// ---- App wiring (App.tsx passes the real modules; tests pass fakes) ----

export type AppFunnelInputs = {
  storage: FunnelStorage & { getAllKeys?: () => Promise<readonly string[]> };
  createXhr: () => FunnelXhr;
  getApiBases: () => ReadonlyArray<string | null | undefined>;
  isDevBuild: boolean;
  /** expo-updates `channel`. */
  getUpdatesChannel: () => unknown;
  /** getFeatureFlags().anonFunnel */
  getAnonFunnelFlag: () => { enabled?: unknown } | null | undefined;
  subscribeFeatureFlags: (listener: () => void) => () => void;
  /** Resolves once the stored Settings › Privacy choice is in memory. */
  privacyPrefsLoaded: Promise<unknown>;
  getShareUsageCounts: () => boolean;
  getOnboardingStage: () => Promise<string>;
  getPlatform: () => string | null;
  getAppVersion: () => string | null;
  now?: () => number;
};

/** Device-wide study progress: any deck-progress row, signed in or not (review/storage.ts keys). */
const PROGRESS_KEY_RE = /(^|:)deck-progress:/;

/**
 * True when this install already had study progress or a finished onboarding when the funnel
 * first ran on it: an install that updated into the funnel, not a new one. A brand-new install
 * that gets this code by OTA early in its first session (no progress, onboarding not done) is new.
 */
export async function detectExistingInstall(
  inputs: Pick<AppFunnelInputs, 'storage' | 'getOnboardingStage'>,
): Promise<boolean> {
  let stage = '';
  try {
    stage = await inputs.getOnboardingStage();
  } catch {
    stage = '';
  }
  if (stage === 'done') return true;
  try {
    const keys = inputs.storage.getAllKeys ? await inputs.storage.getAllKeys() : [];
    return keys.some((key) => PROGRESS_KEY_RE.test(key));
  } catch {
    return false;
  }
}

export function createAppFunnelDeps(inputs: AppFunnelInputs): Partial<FunnelDeps> {
  return {
    storage: inputs.storage,
    post: createFunnelXhrPost({ createXhr: inputs.createXhr, getBases: inputs.getApiBases }),
    isProductionChannel: () => {
      if (inputs.isDevBuild) return false;
      return String(inputs.getUpdatesChannel() ?? '').trim().toLowerCase() === 'production';
    },
    isRemoteEnabled: () => inputs.getAnonFunnelFlag()?.enabled === true,
    isShareEnabled: async () => {
      await inputs.privacyPrefsLoaded;
      return inputs.getShareUsageCounts();
    },
    getEnv: () => ({ platform: inputs.getPlatform(), appVersion: inputs.getAppVersion() }),
    now: inputs.now ?? (() => Date.now()),
  };
}

/**
 * App mount: first_open (or the existing-install seed), then the day-1/day-7 check and a send.
 * A remote flag change (the config fetch lands after launch) sends what is already queued.
 * Returns the flag unsubscribe.
 */
export function startAppFunnel(inputs: Pick<AppFunnelInputs, 'storage' | 'getOnboardingStage' | 'subscribeFeatureFlags'>): () => void {
  fireAndForget(() => detectExistingInstall(inputs).then((existingInstall) => funnel.start({ existingInstall })));
  try {
    return inputs.subscribeFeatureFlags(() => flushFunnel());
  } catch {
    return () => {};
  }
}
