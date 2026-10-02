import { describe, expect, it, vi } from 'vitest';

import {
  FUNNEL_BATCH_MAX,
  FUNNEL_EVENTS,
  FUNNEL_EVENTS_PATH,
  FUNNEL_QUEUE_MAX,
  FUNNEL_STATE_KEY,
  createFunnel,
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
  const deps: Partial<FunnelDeps> = {
    storage,
    post,
    isProductionChannel: () => true,
    isRemoteEnabled: () => true,
    isShareEnabled: () => true,
    getEnv: () => ({ platform: 'ios', appVersion: '1.9.0' }),
    now: () => clock,
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
  it('records first_open once, with the cohort day, and posts it without a token or ids', async () => {
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

    expect(sentEvents(t.posts)).toEqual(['first_open', 'goal_chosen', 'starter_started']);
    const goal = t.posts[1].body.events[0];
    expect(goal).toEqual({ event: 'goal_chosen', cohortDay: '2026-10-02', eventDay: '2026-10-04', deckSlug: 'aws-saa-c03' });
  });

  it('keeps the cohort day of the first open for later events', async () => {
    const t = setup();
    await t.funnel.start();
    t.setNow(DAY0 + 30 * DAY_MS);
    await t.funnel.record('signup_completed');
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
    expect(t.posts[0].body.events[0]).not.toHaveProperty('deckSlug');
  });

  it('marks an install that finished onboarding before the funnel shipped as done: nothing is ever sent', async () => {
    const t = setup();
    await t.funnel.start({ existingInstall: true });
    await t.funnel.record('signup_started');
    t.setNow(DAY0 + DAY_MS);
    await t.funnel.onForeground();
    expect(t.post).not.toHaveBeenCalled();
    expect(Object.keys(t.state().sent).sort()).toEqual([...FUNNEL_EVENTS].sort());
  });

  it('treats an install with funnel state as a known install on later launches', async () => {
    const t = setup();
    await t.funnel.start();
    await t.funnel.start({ existingInstall: true });
    await t.funnel.record('signup_started');
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

  it('caps the stored queue at FUNNEL_QUEUE_MAX and sends batches of at most FUNNEL_BATCH_MAX', async () => {
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
