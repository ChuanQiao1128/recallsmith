// Example-based tests for mcqCoachPrefs.ts against a Map-backed AsyncStorage mock with a
// switchable mode (the ceremonyPrefs.test.ts harness). The mock is declared before the imports
// (vi.mock is hoisted); the module under test is only ever loaded through the dynamic loadPrefs()
// below, so the factory's reference to module-scope variables is safe. Never add a static import
// of mcqCoachPrefs here.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let mode: 'ok' | 'throw' | 'hang' | 'write-throw' = 'ok';
const getItem = vi.fn(async (key: string) => {
  if (mode === 'throw') throw new Error('storage down');
  if (mode === 'hang') return new Promise<string | null>(() => {});
  return store.get(key) ?? null;
});
const setItem = vi.fn(async (key: string, value: string) => {
  if (mode === 'throw' || mode === 'write-throw') throw new Error('storage down');
  store.set(key, value);
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem, setItem } }));

async function loadPrefs() {
  vi.resetModules();
  return await import('../../src/features/gacha/mcq/mcqCoachPrefs');
}

const KEY = 'recallsmith:mcq:coach-seen:v1';

describe('mcqCoachPrefs', () => {
  beforeEach(() => {
    store.clear();
    mode = 'ok';
    getItem.mockClear();
    setItem.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads not seen when nothing is stored', async () => {
    const { readMcqCoachSeen } = await loadPrefs();
    expect(await readMcqCoachSeen()).toBe(false);
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalledWith(KEY);
    // No memo: a second read hits storage again.
    expect(await readMcqCoachSeen()).toBe(false);
    expect(getItem).toHaveBeenCalledTimes(2);
  });

  it('reads seen on garbage, error or a slow read', async () => {
    for (const raw of ['abc', '', '0', '1']) {
      store.clear();
      store.set(KEY, raw);
      const { readMcqCoachSeen } = await loadPrefs();
      expect(await readMcqCoachSeen()).toBe(true);
    }

    store.clear();
    const throwing = await loadPrefs();
    mode = 'throw';
    expect(await throwing.readMcqCoachSeen()).toBe(true);
    expect(setItem).not.toHaveBeenCalled();

    vi.useFakeTimers();
    const hanging = await loadPrefs();
    mode = 'hang';
    const p = hanging.readMcqCoachSeen();
    await vi.advanceTimersByTimeAsync(hanging.MCQ_COACH_READ_TIMEOUT_MS);
    expect(await p).toBe(true);
    vi.useRealTimers();

    mode = 'ok';
    store.clear();
    const clean = await loadPrefs();
    expect(await clean.readMcqCoachSeen()).toBe(false);
  });

  it('marks and re-reads seen', async () => {
    const { markMcqCoachSeen, readMcqCoachSeen } = await loadPrefs();
    await markMcqCoachSeen();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(KEY, '1');
    expect(store.get(KEY)).toBe('1');
    expect(await readMcqCoachSeen()).toBe(true);

    mode = 'write-throw';
    await expect(markMcqCoachSeen()).resolves.toBeUndefined();
  });

  it('exports the device-global key and the read budget', async () => {
    const { MCQ_COACH_SEEN_KEY, MCQ_COACH_READ_TIMEOUT_MS } = await loadPrefs();
    expect(MCQ_COACH_SEEN_KEY).toBe(KEY);
    expect(MCQ_COACH_READ_TIMEOUT_MS).toBe(250);
    expect(KEY.startsWith('devcards:u:')).toBe(false);
  });
});
