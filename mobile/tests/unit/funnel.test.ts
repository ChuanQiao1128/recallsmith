import { afterEach, describe, expect, it, vi } from 'vitest';

import { setTraceHeaderProvider } from '../../src/api/apiClient';

import {
  FUNNEL_BATCH_MAX,
  FUNNEL_EVENTS,
  FUNNEL_EVENTS_PATH,
  FUNNEL_FLUSH_DEBOUNCE_MS,
  FUNNEL_QUEUE_MAX,
  FUNNEL_STATE_KEY,
  configureFunnel,
  createAppFunnelDeps,
  createFunnel,
  createFunnelXhrPost,
  detectExistingInstall,
  recordFunnelEvent,
  startAppFunnel,
  type AppFunnelInputs,
  type FunnelXhr,
  funnelAddDays,
  funnelLocalDay,
  parseFunnelState,
  type FunnelBatch,
  type FunnelDeps,
  type FunnelState,
} from '../../src/telemetry/funnel';

// Local-time noon, so the local calendar day is unambiguous in every test timezone.
const DAY0 = new Date(2026, 9, 2, 12, 0, 0).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function memoryStorage(initial?: FunnelState) {
  const map = new Map<string, string>();
  if (initial) map.set(FUNNEL_STATE_KEY, JSON.stringify(initial));
  return {
    map,
    getItem: vi.fn(async (key: string) => map.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
  };
}

function setup(over: Partial<FunnelDeps> = {}, initial?: FunnelState) {
  const storage = memoryStorage(initial);
  let clock = DAY0;
  const posts: Array<{ path: string; body: FunnelBatch }> = [];
  const post = vi.fn(async (path: string, body: FunnelBatch) => {
    posts.push({ path, body: JSON.parse(JSON.stringify(body)) });
    return { success: true };
  });
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  const deps: Partial<FunnelDeps> = {
    storage,
    post,
    isProductionChannel: () => true,
    isRemoteEnabled: () => true,
    isShareEnabled: () => true,
    getEnv: () => ({ platform: 'ios', appVersion: '1.9.0' }),
    now: () => clock,
    setTimer: (run, ms) => {
      timers.push({ run, ms, cleared: false });
      return timers.length - 1;
    },
    clearTimer: (handle) => {
      timers[handle as number].cleared = true;
    },
    ...over,
  };
  const funnel = createFunnel(deps);
  const state = (): FunnelState => parseFunnelState(storage.map.get(FUNNEL_STATE_KEY) ?? null);
  return {
    funnel,
    storage,
    post,
    posts,
    state,
    timers,
    /** Runs every pending debounce timer, then waits for the flush it started. */
    fireTimers: async () => {
      for (const t of timers) {
        if (t.cleared) continue;
        t.cleared = true;
        t.run();
      }
      await funnel.flush();
    },
    setNow: (ms: number) => {
      clock = ms;
    },
  };
}

function sentEvents(posts: Array<{ body: FunnelBatch }>): string[] {
  return posts.flatMap((p) => p.body.events.map((e) => e.event));
}

describe('funnel day helpers', () => {
  it('formats the local date and adds calendar days across month ends', () => {
    expect(funnelLocalDay(DAY0)).toBe('2026-10-02');
    expect(funnelAddDays('2026-10-02', 1)).toBe('2026-10-03');
    expect(funnelAddDays('2026-10-30', 7)).toBe('2026-11-06');
    expect(funnelAddDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('funnel recording', () => {
  it('records first_open once, with the cohort day, and posts only the batch fields', async () => {
    const t = setup();
    await t.funnel.start();
    await t.funnel.start();
    await t.funnel.record('first_open');

    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].path).toBe(FUNNEL_EVENTS_PATH);
    expect(t.posts[0].body).toEqual({
      platform: 'ios',
      appVersion: '1.9.0',
      events: [{ event: 'first_open', cohortDay: '2026-10-02', eventDay: '2026-10-02' }],
    });
    expect(t.state()).toEqual({ cohortDay: '2026-10-02', sent: { first_open: true }, queue: [] });
  });

  it('records each event at most once per install, with the deck slug when given', async () => {
    const t = setup();
    await t.funnel.start();
    t.setNow(DAY0 + 2 * DAY_MS);
    await t.funnel.record('goal_chosen', 'aws-saa-c03');
    await t.funnel.record('goal_chosen', 'csharp-basics');
    await t.funnel.record('starter_started', 'aws-saa-c03');
    await t.funnel.flush();

    expect(sentEvents(t.posts)).toEqual(['first_open', 'goal_chosen', 'starter_started']);
    const goal = t.posts[1].body.events[0];
    expect(goal).toEqual({ event: 'goal_chosen', cohortDay: '2026-10-02', eventDay: '2026-10-04', deckSlug: 'aws-saa-c03' });
  });

  it('keeps the cohort day of the first open for later events', async () => {
    const t = setup();
    await t.funnel.start();
    t.setNow(DAY0 + 30 * DAY_MS);
    await t.funnel.record('signup_completed');
    await t.funnel.flush();
    expect(t.posts[1].body.events[0]).toEqual({
      event: 'signup_completed',
      cohortDay: '2026-10-02',
      eventDay: '2026-11-01',
    });
  });

  it('ignores an unknown event and a malformed deck slug', async () => {
    const t = setup();
    await t.funnel.record('bogus' as never);
    expect(t.posts).toHaveLength(0);
    await t.funnel.record('goal_chosen', 'Not A Slug!');
    await t.funnel.flush();
    expect(t.posts[0].body.events[0]).not.toHaveProperty('deckSlug');
  });

  it('marks an install that finished onboarding before the funnel shipped as done: nothing is ever sent', async () => {
    const t = setup();
    await t.funnel.start({ existingInstall: true });
    await t.funnel.record('signup_started');
    t.setNow(DAY0 + DAY_MS);
    await t.funnel.onForeground();
    await t.funnel.flush();
    expect(t.post).not.toHaveBeenCalled();
    expect(Object.keys(t.state().sent).sort()).toEqual([...FUNNEL_EVENTS].sort());
  });

  it('treats an install with funnel state as a known install on later launches', async () => {
    const t = setup();
    await t.funnel.start();
    await t.funnel.start({ existingInstall: true });
    await t.funnel.record('signup_started');
    await t.funnel.flush();
    expect(sentEvents(t.posts)).toEqual(['first_open', 'signup_started']);
  });
});

describe('funnel returns on day 1 and day 7', () => {
  it('records returned_day_1 only on cohortDay + 1 and returned_day_7 only on cohortDay + 7', async () => {
    const t = setup();
    await t.funnel.start();
    await t.funnel.onForeground(); // same day: nothing
    t.setNow(DAY0 + DAY_MS);
    await t.funnel.onForeground();
    await t.funnel.onForeground();
    t.setNow(DAY0 + 3 * DAY_MS);
    await t.funnel.onForeground();
    t.setNow(DAY0 + 7 * DAY_MS);
    await t.funnel.onForeground();
    t.setNow(DAY0 + 8 * DAY_MS);
    await t.funnel.onForeground();

    expect(sentEvents(t.posts)).toEqual(['first_open', 'returned_day_1', 'returned_day_7']);
    expect(t.posts[1].body.events[0]).toEqual({ event: 'returned_day_1', cohortDay: '2026-10-02', eventDay: '2026-10-03' });
    expect(t.posts[2].body.events[0]).toEqual({ event: 'returned_day_7', cohortDay: '2026-10-02', eventDay: '2026-10-09' });
  });

  it('a cold start on day 1 counts as a return (start runs the foreground check)', async () => {
    const t = setup();
    await t.funnel.start();
    t.setNow(DAY0 + DAY_MS);
    await t.funnel.start();
    expect(sentEvents(t.posts)).toEqual(['first_open', 'returned_day_1']);
  });

  it('records nothing on foreground before a first open', async () => {
    const t = setup();
    await t.funnel.onForeground();
    expect(t.state()).toEqual({ cohortDay: null, sent: {}, queue: [] });
  });
});

describe('funnel send gates', () => {
  it.each([
    ['not the production channel', { isProductionChannel: () => false }],
    ['the remote flag is off', { isRemoteEnabled: () => false }],
    ['the remote flag gate throws', { isRemoteEnabled: () => { throw new Error('x'); } }],
  ])('keeps events queued and sends nothing when %s', async (_label, over) => {
    const t = setup(over as Partial<FunnelDeps>);
    await t.funnel.start();
    await t.funnel.record('goal_chosen', 'aws-saa-c03');
    expect(t.post).not.toHaveBeenCalled();
    expect(t.state().queue.map((e) => e.event)).toEqual(['first_open', 'goal_chosen']);
  });

  it('sends the queued events on a later flush once the remote flag turns on', async () => {
    let flag = false;
    const t = setup({ isRemoteEnabled: () => flag });
    await t.funnel.start();
    expect(t.post).not.toHaveBeenCalled();
    flag = true;
    await t.funnel.flush();
    expect(sentEvents(t.posts)).toEqual(['first_open']);
    expect(t.state().queue).toEqual([]);
  });

  it('queues nothing while the Settings toggle is off, and drops what was queued', async () => {
    let share = true;
    let flag = false;
    const t = setup({ isShareEnabled: async () => share, isRemoteEnabled: () => flag });
    await t.funnel.start();
    expect(t.state().queue).toHaveLength(1);

    share = false;
    await t.funnel.record('goal_chosen', 'aws-saa-c03');
    flag = true;
    await t.funnel.flush();
    expect(t.post).not.toHaveBeenCalled();
    expect(t.state().queue).toEqual([]);
    // Still once per install: turning the toggle back on does not replay the moment.
    expect(t.state().sent.goal_chosen).toBe(true);

    share = true;
    await t.funnel.record('goal_chosen', 'aws-saa-c03');
    expect(t.post).not.toHaveBeenCalled();
  });

  it('clearQueue drops everything queued', async () => {
    const t = setup({ isRemoteEnabled: () => false });
    await t.funnel.start();
    await t.funnel.clearQueue();
    expect(t.state().queue).toEqual([]);
  });

  it('does not send with a platform or app version the server would reject', async () => {
    const t = setup({ getEnv: () => ({ platform: 'ios', appVersion: '1.9.0 (42)' }) });
    await t.funnel.start();
    expect(t.post).not.toHaveBeenCalled();
    const u = setup({ getEnv: () => ({ platform: 'web', appVersion: '1.9.0' }) });
    await u.funnel.start();
    expect(u.post).not.toHaveBeenCalled();
  });

  it('is a no-op without storage (not configured yet)', async () => {
    const funnel = createFunnel({});
    await expect(funnel.record('first_open')).resolves.toBeUndefined();
    await expect(funnel.start()).resolves.toBeUndefined();
  });
});

describe('funnel payload and queue', () => {
  it('never carries an identifier field', async () => {
    const t = setup();
    await t.funnel.start();
    await t.funnel.record('goal_chosen', 'aws-saa-c03');
    await t.funnel.record('signup_completed');
    await t.funnel.flush();
    const allowedBatch = ['appVersion', 'events', 'platform'];
    const allowedEvent = ['cohortDay', 'deckSlug', 'event', 'eventDay'];
    for (const { body } of t.posts) {
      expect(Object.keys(body).sort()).toEqual(allowedBatch);
      for (const e of body.events) {
        for (const key of Object.keys(e)) expect(allowedEvent).toContain(key);
      }
      expect(JSON.stringify(body)).not.toMatch(/user|device|install|sub|token|email|"id"/i);
    }
    expect(Object.keys(t.state()).sort()).toEqual(['cohortDay', 'queue', 'sent']);
  });

  it('caps the stored queue at FUNNEL_QUEUE_MAX and sends one batch of at most FUNNEL_BATCH_MAX per flush', async () => {
    const queue = Array.from({ length: FUNNEL_QUEUE_MAX + 10 }, () => ({
      event: 'first_open' as const,
      cohortDay: '2026-10-02',
      eventDay: '2026-10-02',
    }));
    expect(parseFunnelState(JSON.stringify({ cohortDay: '2026-10-02', sent: {}, queue })).queue).toHaveLength(
      FUNNEL_QUEUE_MAX,
    );

    const t = setup({}, { cohortDay: '2026-10-02', sent: {}, queue });
    await t.funnel.flush();
    expect(t.posts.map((p) => p.body.events.length)).toEqual([FUNNEL_BATCH_MAX]);
    await t.funnel.flush();
    await t.funnel.flush();
    expect(t.posts.map((p) => p.body.events.length)).toEqual([FUNNEL_BATCH_MAX, FUNNEL_BATCH_MAX, 10]);
    expect(t.state().queue).toEqual([]);
  });

  it('does not queue past FUNNEL_QUEUE_MAX', async () => {
    const queue = Array.from({ length: FUNNEL_QUEUE_MAX }, () => ({
      event: 'first_open' as const,
      cohortDay: '2026-10-02',
      eventDay: '2026-10-02',
    }));
    const t = setup({ isRemoteEnabled: () => false }, { cohortDay: '2026-10-02', sent: { first_open: true }, queue });
    await t.funnel.record('goal_chosen', 'aws-saa-c03');
    expect(t.state().queue).toHaveLength(FUNNEL_QUEUE_MAX);
    expect(t.state().queue.some((e) => e.event === 'goal_chosen')).toBe(false);
    expect(t.state().sent.goal_chosen).toBe(true);
  });

  it('keeps a failed batch queued for the next foreground and never throws', async () => {
    let fail = true;
    const t = setup({
      post: vi.fn(async () => {
        if (fail) throw Object.assign(new Error('offline'), { kind: 'offline' });
        return {};
      }),
    });
    await expect(t.funnel.start()).resolves.toBeUndefined();
    expect(t.state().queue.map((e) => e.event)).toEqual(['first_open']);
    fail = false;
    await t.funnel.onForeground();
    expect(t.state().queue).toEqual([]);
  });

  it('retries a 429 but drops a batch the server rejects as invalid', async () => {
    let status = 429;
    const t = setup({ post: vi.fn(async () => { throw Object.assign(new Error('x'), { status }); }) });
    await t.funnel.start();
    expect(t.state().queue).toHaveLength(1);
    status = 400;
    await t.funnel.flush();
    expect(t.state().queue).toEqual([]);
  });

  it('survives storage failures without throwing', async () => {
    const t = setup({
      storage: {
        getItem: async () => {
          throw new Error('disk');
        },
        setItem: async () => {
          throw new Error('disk');
        },
      },
    });
    await expect(t.funnel.start()).resolves.toBeUndefined();
    await expect(t.funnel.record('goal_chosen')).resolves.toBeUndefined();
    await expect(t.funnel.flush()).resolves.toBeUndefined();
  });

  it('serialises concurrent records so none is lost', async () => {
    const t = setup({ isRemoteEnabled: () => false });
    await Promise.all([
      t.funnel.start(),
      t.funnel.record('goal_chosen', 'aws-saa-c03'),
      t.funnel.record('starter_started', 'aws-saa-c03'),
      t.funnel.record('signup_started'),
    ]);
    expect(t.state().queue.map((e) => e.event)).toEqual(['first_open', 'goal_chosen', 'starter_started', 'signup_started']);
  });

  it('parses corrupt state as empty', () => {
    expect(parseFunnelState('not json')).toEqual({ cohortDay: null, sent: {}, queue: [] });
    expect(parseFunnelState(JSON.stringify({ cohortDay: 'x', sent: { nope: true, first_open: 1 }, queue: [{}] }))).toEqual({
      cohortDay: null,
      sent: {},
      queue: [],
    });
  });
});

describe('funnel batching (one POST per flush, not per event)', () => {
  it('a record does not post by itself; one debounced flush sends every queued event in ONE POST', async () => {
    const t = setup();
    await t.funnel.start(); // launch flush: first_open
    expect(t.posts).toHaveLength(1);

    await t.funnel.record('goal_chosen', 'aws-saa-c03');
    await t.funnel.record('starter_started', 'aws-saa-c03');
    await t.funnel.record('starter_completed', 'aws-saa-c03');
    await t.funnel.record('first_pack_opened', 'aws-saa-c03');
    expect(t.posts).toHaveLength(1);

    // Each record restarts the debounce: only the last timer is live.
    const live = t.timers.filter((x) => !x.cleared);
    expect(live).toHaveLength(1);
    expect(live[0].ms).toBe(FUNNEL_FLUSH_DEBOUNCE_MS);

    await t.fireTimers();
    expect(t.posts).toHaveLength(2);
    expect(t.posts[1].body.events.map((e) => e.event)).toEqual([
      'goal_chosen',
      'starter_started',
      'starter_completed',
      'first_pack_opened',
    ]);
    expect(t.state().queue).toEqual([]);
  });

  it('a repeated (no-op) record schedules nothing', async () => {
    const t = setup();
    await t.funnel.start();
    await t.funnel.record('first_open');
    expect(t.timers).toHaveLength(0);
  });

  it('a foreground flush cancels the pending debounce', async () => {
    const t = setup();
    await t.funnel.start();
    await t.funnel.record('goal_chosen', 'aws-saa-c03');
    await t.funnel.onForeground();
    expect(t.timers.every((x) => x.cleared)).toBe(true);
    expect(sentEvents(t.posts)).toEqual(['first_open', 'goal_chosen']);
  });
});

describe('funnel rejections: only validation drops a batch', () => {
  it.each([401, 403, 404, 408, 429, 500, 502, 503])('keeps the queue on HTTP %i', async (status) => {
    const t = setup({ post: vi.fn(async () => { throw Object.assign(new Error('x'), { status }); }) });
    await t.funnel.start();
    await t.funnel.flush();
    expect(t.state().queue.map((e) => e.event)).toEqual(['first_open']);
  });

  it.each([
    ['a network failure', { kind: 'offline' }],
    ['a timeout', { kind: 'timeout' }],
    ['an error without a status', {}],
  ])('keeps the queue on %s', async (_label, extra) => {
    const t = setup({ post: vi.fn(async () => { throw Object.assign(new Error('x'), extra); }) });
    await t.funnel.start();
    expect(t.state().queue).toHaveLength(1);
  });

  it.each([400, 413, 422])('drops the batch on HTTP %i', async (status) => {
    const t = setup({ post: vi.fn(async () => { throw Object.assign(new Error('x'), { status }); }) });
    await t.funnel.start();
    expect(t.state().queue).toEqual([]);
  });

  it('a 401 batch is sent on the next foreground once the route answers', async () => {
    let status: number | null = 401;
    const post = vi.fn(async () => {
      if (status !== null) throw Object.assign(new Error('x'), { status });
      return null;
    });
    const t = setup({ post });
    await t.funnel.start();
    status = null;
    await t.funnel.onForeground();
    expect(t.state().queue).toEqual([]);
    expect(post).toHaveBeenCalledTimes(2);
  });
});

type FakeXhr = FunnelXhr & {
  method?: string;
  url?: string;
  headers: Record<string, string>;
  body?: string;
};

function fakeXhrFactory(answer: (xhr: FakeXhr) => number | 'network' | 'timeout') {
  const made: FakeXhr[] = [];
  const createXhr = (): FunnelXhr => {
    let status = 0;
    const xhr: FakeXhr = {
      headers: {},
      timeout: 0,
      get status() {
        return status;
      },
      onload: null,
      onerror: null,
      ontimeout: null,
      open(method, url) {
        xhr.method = method;
        xhr.url = url;
      },
      setRequestHeader(name, value) {
        xhr.headers[name] = value;
      },
      send(body) {
        xhr.body = body;
        const result = answer(xhr);
        queueMicrotask(() => {
          if (result === 'network') (xhr.onerror as (() => void) | null)?.();
          else if (result === 'timeout') (xhr.ontimeout as (() => void) | null)?.();
          else {
            status = result;
            (xhr.onload as (() => void) | null)?.();
          }
        });
      },
    };
    made.push(xhr);
    return xhr;
  };
  return { made, createXhr };
}

const BATCH: FunnelBatch = {
  platform: 'ios',
  appVersion: '1.9.0',
  events: [{ event: 'first_open', cohortDay: '2026-10-02', eventDay: '2026-10-02' }],
};

describe('funnel POST (createFunnelXhrPost): no token, no trace header', () => {
  afterEach(() => setTraceHeaderProvider(null));

  it('sends exactly content-type, flagged as Sentry-own so no sentry-trace/baggage is added', async () => {
    // Even with the apiClient trace provider installed (Sentry active), the funnel POST does not
    // pick it up: it never goes through apiClient.
    setTraceHeaderProvider(() => '1-0123abcd-0123456789abcdef01234567');
    const x = fakeXhrFactory(() => 202);
    const post = createFunnelXhrPost({ createXhr: x.createXhr, getBases: () => ['https://api.example.test/'] });

    await post(FUNNEL_EVENTS_PATH, BATCH);

    expect(x.made).toHaveLength(1);
    const req = x.made[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.example.test/api/v1/public/events');
    expect(req.headers).toEqual({ 'content-type': 'application/json' });
    const names = Object.keys(req.headers).map((n) => n.toLowerCase());
    for (const banned of ['authorization', 'x-dc-trace-id', 'sentry-trace', 'baggage', 'traceparent']) {
      expect(names).not.toContain(banned);
    }
    expect(req.__sentry_own_request__).toBe(true);
    expect(JSON.parse(req.body ?? '')).toEqual(BATCH);
    expect(req.timeout).toBeGreaterThan(0);
  });

  it('rejects with the HTTP status so the funnel can classify it', async () => {
    const x = fakeXhrFactory(() => 404);
    const post = createFunnelXhrPost({ createXhr: x.createXhr, getBases: () => ['https://a.test'] });
    await expect(post(FUNNEL_EVENTS_PATH, BATCH)).rejects.toMatchObject({ status: 404 });
    expect(x.made).toHaveLength(1); // a status answers for the route: no fallback
  });

  it('moves to the fallback base only after a network failure', async () => {
    const x = fakeXhrFactory((xhr) => (xhr.url?.startsWith('https://a.test') ? 'network' : 202));
    const post = createFunnelXhrPost({ createXhr: x.createXhr, getBases: () => ['https://a.test', null, 'https://b.test'] });
    await post(FUNNEL_EVENTS_PATH, BATCH);
    expect(x.made.map((r) => r.url)).toEqual([
      'https://a.test/api/v1/public/events',
      'https://b.test/api/v1/public/events',
    ]);
    for (const r of x.made) expect(r.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('rejects with a transient kind on network failure and timeout', async () => {
    const offline = createFunnelXhrPost({ createXhr: fakeXhrFactory(() => 'network').createXhr, getBases: () => ['https://a.test'] });
    await expect(offline(FUNNEL_EVENTS_PATH, BATCH)).rejects.toMatchObject({ kind: 'offline' });
    const slow = createFunnelXhrPost({ createXhr: fakeXhrFactory(() => 'timeout').createXhr, getBases: () => ['https://a.test'] });
    await expect(slow(FUNNEL_EVENTS_PATH, BATCH)).rejects.toMatchObject({ kind: 'timeout' });
  });
});

function memoryAsyncStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: vi.fn(async (key: string) => map.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    getAllKeys: vi.fn(async () => [...map.keys()]),
  };
}

function appInputs(over: Partial<AppFunnelInputs> = {}) {
  const x = fakeXhrFactory(() => 202);
  const listeners: Array<() => void> = [];
  let flag = true;
  const inputs: AppFunnelInputs = {
    storage: memoryAsyncStorage(),
    createXhr: x.createXhr,
    getApiBases: () => ['https://api.example.test', null],
    isDevBuild: false,
    getUpdatesChannel: () => 'production',
    getAnonFunnelFlag: () => ({ enabled: flag }),
    subscribeFeatureFlags: (listener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    privacyPrefsLoaded: Promise.resolve(),
    getShareUsageCounts: () => true,
    getOnboardingStage: async () => 'welcome',
    getPlatform: () => 'ios',
    getAppVersion: () => '1.9.0',
    now: () => DAY0,
    ...over,
  };
  return {
    inputs,
    xhrs: x.made,
    listeners,
    setFlag: (v: boolean) => {
      flag = v;
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
}

function storedState(inputs: AppFunnelInputs): FunnelState {
  return parseFunnelState((inputs.storage as ReturnType<typeof memoryAsyncStorage>).map.get(FUNNEL_STATE_KEY) ?? null);
}

describe('existing-install detection', () => {
  it.each([
    ['onboarding done', 'done', {}, true],
    ['signed-out study progress', 'welcome', { 'devcards:u:anon:deck-progress:aws-saa-c03': '[]' }, true],
    ['signed-in study progress', 'audience', { 'devcards:u:abc:deck-progress:aws-saa-c03': '[]' }, true],
    ['legacy unscoped progress', 'starter', { 'deck-progress:aws-saa-c03:1': '[]' }, true],
    ['a brand-new install (OTA in its first session)', 'welcome', { 'recallsmith:onboarding:stage:v1': 'welcome' }, false],
    ['mid-onboarding with no progress', 'audience', {}, false],
  ] as const)('%s → existing=%s', async (_label, stage, entries, expected) => {
    const storage = memoryAsyncStorage(entries);
    await expect(detectExistingInstall({ storage, getOnboardingStage: async () => stage })).resolves.toBe(expected);
  });

  it('a storage failure counts as new (never throws)', async () => {
    const storage = { ...memoryAsyncStorage(), getAllKeys: async () => { throw new Error('disk'); } };
    await expect(detectExistingInstall({ storage, getOnboardingStage: async () => { throw new Error('x'); } })).resolves.toBe(false);
  });
});

describe('App funnel wiring (createAppFunnelDeps + startAppFunnel)', () => {
  afterEach(() => configureFunnel({}));

  function install(over: Partial<AppFunnelInputs> = {}) {
    const app = appInputs(over);
    configureFunnel(createAppFunnelDeps(app.inputs));
    return app;
  }

  it('a new install posts first_open with content-type only and no token or trace header', async () => {
    const app = install();
    startAppFunnel(app.inputs);
    await settle();
    expect(app.xhrs).toHaveLength(1);
    expect(app.xhrs[0].headers).toEqual({ 'content-type': 'application/json' });
    expect(app.xhrs[0].__sentry_own_request__).toBe(true);
    expect(JSON.parse(app.xhrs[0].body ?? '').events.map((e: { event: string }) => e.event)).toEqual(['first_open']);
  });

  it('stage done seeds an existing install: no first_open and no later first-run step', async () => {
    const app = install({ getOnboardingStage: async () => 'done' });
    startAppFunnel(app.inputs);
    await settle();
    recordFunnelEvent('first_pack_opened', 'aws-saa-c03');
    await settle();
    expect(app.xhrs).toHaveLength(0);
    expect(storedState(app.inputs).queue).toEqual([]);
    expect(Object.keys(storedState(app.inputs).sent).sort()).toEqual([...FUNNEL_EVENTS].sort());
  });

  it('study progress with onboarding not done also seeds an existing install', async () => {
    const app = install({
      storage: memoryAsyncStorage({ 'devcards:u:anon:deck-progress:aws-saa-c03': '[]' }),
      getOnboardingStage: async () => 'audience',
    });
    startAppFunnel(app.inputs);
    await settle();
    expect(app.xhrs).toHaveLength(0);
    expect(storedState(app.inputs).sent.first_open).toBe(true);
  });

  it('a flag flip sends what is already queued', async () => {
    const app = install();
    app.setFlag(false);
    startAppFunnel(app.inputs);
    await settle();
    expect(app.xhrs).toHaveLength(0);
    expect(app.listeners).toHaveLength(1);
    app.setFlag(true);
    app.listeners[0]();
    await settle();
    expect(app.xhrs).toHaveLength(1);
  });

  it('returns the flag unsubscribe', () => {
    const app = install();
    const off = startAppFunnel(app.inputs);
    off();
    expect(app.listeners).toHaveLength(0);
  });

  it.each([
    ['a dev build', { isDevBuild: true }],
    ['a preview channel', { getUpdatesChannel: () => 'preview' }],
    ['the flag missing', { getAnonFunnelFlag: () => undefined }],
    ['Share anonymous usage counts off', { getShareUsageCounts: () => false }],
  ])('sends nothing with %s', async (_label, over) => {
    const app = install(over as Partial<AppFunnelInputs>);
    startAppFunnel(app.inputs);
    await settle();
    expect(app.xhrs).toHaveLength(0);
  });

  it('waits for the stored privacy choice before deciding', async () => {
    let release: () => void = () => {};
    const loaded = new Promise<void>((r) => {
      release = r;
    });
    let share = true;
    const app = install({ privacyPrefsLoaded: loaded, getShareUsageCounts: () => share });
    startAppFunnel(app.inputs);
    await settle();
    share = false; // the stored value (off) lands before the load resolves
    release();
    await settle();
    expect(app.xhrs).toHaveLength(0);
    expect(storedState(app.inputs).queue).toEqual([]);
  });
});
