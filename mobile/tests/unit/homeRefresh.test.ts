import { describe, expect, it } from 'vitest';
import { buildReadyHomeVm, createCoalescedRunner } from '../../src/features/gacha/home/homeRefresh';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// A task whose every invocation hands back a manually controllable promise, so
// the test decides exactly when each run settles.
function makeController() {
  let starts = 0;
  const gates: Array<{ resolve: () => void; reject: (reason?: unknown) => void }> = [];
  const task = () => {
    starts += 1;
    return new Promise<void>((resolve, reject) => {
      gates.push({ resolve, reject });
    });
  };
  return {
    task,
    gates,
    get starts() {
      return starts;
    },
  };
}

describe('createCoalescedRunner', () => {
  it('runs one task at a time and folds overlapping calls into one trailing run', async () => {
    const c = makeController();
    const run = createCoalescedRunner(c.task);

    run(); // starts run 1
    run(); // schedules the single trailing run
    run(); // joins the same trailing run
    await tick();
    expect(c.starts).toBe(1); // only one in flight, the extras are folded

    c.gates[0].resolve(); // run 1 settles
    await tick();
    expect(c.starts).toBe(2); // exactly one trailing run, not two

    c.gates[1].resolve();
    await tick();

    // Idle again: a fresh call starts a new run rather than reusing the trailer.
    run();
    await tick();
    expect(c.starts).toBe(3);
    c.gates[2].resolve();
    await tick();
  });

  it('resolves every overlapping caller after the trailing run settles', async () => {
    const c = makeController();
    const run = createCoalescedRunner(c.task);

    const idle = run(); // run 1
    const settled: string[] = [];
    void run().then(() => settled.push('a'));
    void run().then(() => settled.push('b'));
    await tick();
    expect(c.starts).toBe(1);

    c.gates[0].resolve(); // run 1 settles, trailing run starts
    await tick();
    expect(c.starts).toBe(2);
    expect(settled).toEqual([]); // overlapping callers wait for the trailing run

    c.gates[1].resolve(); // trailing run settles
    await tick();
    expect(settled.sort()).toEqual(['a', 'b']);
    await idle; // the idle caller's promise resolved too
  });

  it('keeps working after a task rejects', async () => {
    let calls = 0;
    const ran: number[] = [];
    const run = createCoalescedRunner(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('boom');
      }
      ran.push(calls);
    });

    await expect(run()).resolves.toBeUndefined(); // rejection is swallowed
    expect(calls).toBe(1);

    await run(); // the runner is not wedged by the earlier rejection
    expect(calls).toBe(2);
    expect(ran).toEqual([2]);
  });
});

function makeDeck(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'csharp',
    title: 'C# Interview',
    locale: 'en-US',
    version: '1',
    deckType: 1,
    totalCards: 10,
    localCards: 10,
    studyCards: 10,
    canStudy: true,
    tier: null,
    availability: 'live',
    eta: null,
    downloadMode: null,
    order: 0,
    dueToday: 1,
    plannedToday: 1,
    newToday: 1,
    masteredApprox: 2,
    masteredCount: 1,
    ownedCount: 4,
    percent: 0.4,
    ...overrides,
  } as any;
}

const EMPTY_SESSION = { slug: null, startedAt: null, completedCount: 0, route: [] as any[] };
const STREAK = {
  currentDailyStreak: 0,
  longestDailyStreak: 0,
  weekCompletedDays: 0,
  totalQualifiedSessions: 0,
  lastQualifiedDateKey: null,
  currentWeekKey: null,
};

describe('buildReadyHomeVm', () => {
  it('builds the selected deck view model from cached inputs without I/O', () => {
    const inputs = {
      summary: {
        deckSummaries: [
          makeDeck({ slug: 'csharp', title: 'C# Interview' }),
          makeDeck({ slug: 'aws', title: 'AWS Core', dueToday: 2, newToday: 0 }),
        ],
        updates: {},
        allUpcoming30: [],
        asOfISO: '2026-01-02T00:00:00.000Z',
        totalDueAllDecks: 3,
        totalNewAllDecks: 1,
      },
      wallet: { availablePulls: 0, reservePulls: 0 },
      streak: STREAK,
    };

    const aws = buildReadyHomeVm({
      inputs,
      selectedSlug: 'aws',
      session: EMPTY_SESSION,
      isSignedIn: false,
      premium: false,
      updatingSlugs: [],
    });
    expect(aws.selectedDeckSlug).toBe('aws');

    const csharp = buildReadyHomeVm({
      inputs,
      selectedSlug: 'csharp',
      session: EMPTY_SESSION,
      isSignedIn: false,
      premium: false,
      updatingSlugs: [],
    });
    expect(csharp.selectedDeckSlug).toBe('csharp');

    // Pure: identical inputs produce an identical view model.
    const awsAgain = buildReadyHomeVm({
      inputs,
      selectedSlug: 'aws',
      session: EMPTY_SESSION,
      isSignedIn: false,
      premium: false,
      updatingSlugs: [],
    });
    expect(awsAgain).toEqual(aws);
  });
});
