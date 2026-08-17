import { afterEach, describe, expect, it, vi } from 'vitest';

// The environment is node, so there is no real User Timing implementation and
// no wall clock to fight: the stub below is a deterministic clock plus the
// three methods journey.ts touches. It also lets a test assert that the
// disabled build calls nothing at all, which is the point of the gate.
function installPerformanceStub() {
  const marks = new Map<string, number>();
  const measures: { name: string; duration: number; startTime: number }[] = [];
  const calls: string[] = [];
  let now = 0;

  const api = {
    mark(name: string) {
      calls.push(`mark:${name}`);
      marks.set(name, now);
    },
    measure(name: string, startMark: string) {
      calls.push(`measure:${name}`);
      const startTime = marks.get(startMark);
      // Matches the browser: measuring from a mark that was never set throws.
      if (startTime === undefined) throw new SyntaxError(`missing mark ${startMark}`);
      const entry = { name, duration: now - startTime, startTime };
      measures.push(entry);
      return entry;
    },
    clearMarks(name: string) {
      marks.delete(name);
    },
  };

  vi.stubGlobal('performance', api);

  return {
    calls,
    measures,
    advance(ms: number) {
      now += ms;
    },
  };
}

type JourneyModule = typeof import('../src/perf/journey');

// journey.ts reads the gate once at module load, so every test that cares about
// the gate needs its own fresh module instance.
async function loadJourney(): Promise<JourneyModule> {
  vi.resetModules();
  return import('../src/perf/journey');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('journey timing', () => {
  it('turns a start/end pair into one measure', async () => {
    const perf = installPerformanceStub();
    const { markStart, markEnd, getJourneys } = await loadJourney();

    markStart('publish');
    perf.advance(120);
    markEnd('publish');

    expect(perf.measures).toEqual([{ name: 'publish', duration: 120, startTime: 0 }]);
    expect(getJourneys()).toEqual([{ name: 'publish', duration: 120, startTime: 0 }]);
  });

  it('records nothing when markEnd has no matching markStart', async () => {
    const perf = installPerformanceStub();
    const { markEnd, getJourneys } = await loadJourney();

    markEnd('publish');

    expect(perf.measures).toEqual([]);
    expect(getJourneys()).toEqual([]);
  });

  it('is a no-op when the gate is closed', async () => {
    vi.stubEnv('DEV', false);
    const perf = installPerformanceStub();
    const { markStart, markEnd, getJourneys, isPerfEnabled } = await loadJourney();

    expect(isPerfEnabled()).toBe(false);

    markStart('publish');
    perf.advance(50);
    markEnd('publish');

    // Not just an empty result: the User Timing API is never touched.
    expect(perf.calls).toEqual([]);
    expect(getJourneys()).toEqual([]);
  });

  it('returns journeys oldest first and keeps only the newest ones', async () => {
    const perf = installPerformanceStub();
    const { markStart, markEnd, getJourneys, clearJourneys } = await loadJourney();
    clearJourneys();

    for (let i = 0; i < 60; i += 1) {
      markStart(`j${i}`);
      perf.advance(1);
      markEnd(`j${i}`);
    }

    const all = getJourneys();
    expect(all).toHaveLength(50);
    expect(all[0].name).toBe('j10');
    expect(all[all.length - 1].name).toBe('j59');

    const recent = getJourneys(3);
    expect(recent.map(j => j.name)).toEqual(['j57', 'j58', 'j59']);
    expect(getJourneys(0)).toEqual([]);
  });
});
