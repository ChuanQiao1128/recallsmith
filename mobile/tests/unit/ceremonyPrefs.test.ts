// Example-based tests for ceremonyPrefs.ts against a Map-backed AsyncStorage mock with a
// switchable mode. The mock is declared before the imports (vi.mock is hoisted); the module
// under test is only ever loaded through the dynamic loadPrefs() below, so the factory's
// reference to module-scope variables is safe — the factory first runs during that import,
// after the variables are initialised. Never add a static import of ceremonyPrefs here.
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
  return await import('../../src/features/gacha/draw/ceremonyPrefs');
}

const KEY = 'recallsmith:ceremony:completed:v1';

describe('ceremonyPrefs', () => {
  beforeEach(() => {
    store.clear();
    mode = 'ok';
    getItem.mockClear();
    setItem.mockClear();
    (globalThis as any).__DEV__ = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).__DEV__ = true;
  });

  it('reads 0 when nothing is stored and re-reads storage on every call', async () => {
    const { readCeremoniesCompleted } = await loadPrefs();
    expect(await readCeremoniesCompleted()).toBe(0);
    expect(await readCeremoniesCompleted()).toBe(0);
    expect(getItem).toHaveBeenCalledTimes(2);
    store.set(KEY, '2');
    expect(await readCeremoniesCompleted()).toBe(2);
  });

  it('parses a stored integer and fails closed on garbage', async () => {
    const cases: Array<[string, number]> = [
      ['3', 3], ['0', 0], ['abc', 0], ['-1', 0], ['2.5', 0], ['1e3', 1000],
    ];
    for (const [raw, expected] of cases) {
      store.clear();
      store.set(KEY, raw);
      const { readCeremoniesCompleted } = await loadPrefs();
      expect(await readCeremoniesCompleted()).toBe(expected);
    }
  });

  it('resolves 0 when the read throws and retries on the next call', async () => {
    const { readCeremoniesCompleted } = await loadPrefs();
    mode = 'throw';
    expect(await readCeremoniesCompleted()).toBe(0);
    mode = 'ok';
    store.set(KEY, '4');
    expect(await readCeremoniesCompleted()).toBe(4);
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('resolves 0 within the timeout when the read hangs', async () => {
    vi.useFakeTimers();
    const { readCeremoniesCompleted, CEREMONY_PREFS_READ_TIMEOUT_MS } = await loadPrefs();
    mode = 'hang';
    const p = readCeremoniesCompleted();
    await vi.advanceTimersByTimeAsync(CEREMONY_PREFS_READ_TIMEOUT_MS);
    expect(await p).toBe(0);
    mode = 'ok';
    store.set(KEY, '2');
    expect(await readCeremoniesCompleted()).toBe(2);
  });

  it('markCeremonyCompleted increments, persists and returns the new count', async () => {
    store.set(KEY, '2');
    const { markCeremonyCompleted, readCeremoniesCompleted } = await loadPrefs();
    expect(await markCeremonyCompleted()).toBe(3);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(KEY, '3');
    expect(store.get(KEY)).toBe('3');
    expect(await readCeremoniesCompleted()).toBe(3);
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(await markCeremonyCompleted()).toBe(4);
    expect(store.get(KEY)).toBe('4');
  });

  it('resolves the incremented count when the write fails and never pins it', async () => {
    store.set(KEY, '2');
    const { markCeremonyCompleted, readCeremoniesCompleted } = await loadPrefs();
    mode = 'write-throw';
    expect(await markCeremonyCompleted()).toBe(3);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(store.get(KEY)).toBe('2');
    expect(await readCeremoniesCompleted()).toBe(2);
    expect(await markCeremonyCompleted()).toBe(3);
  });

  it('dev overrides are inert outside __DEV__', async () => {
    (globalThis as any).__DEV__ = false;
    const { setCeremonyDevOverride, getCeremonyDevOverrides, effectiveCeremoniesCompleted } = await loadPrefs();
    setCeremonyDevOverride('forceRepeat', true);
    expect(getCeremonyDevOverrides()).toEqual({ forceRepeat: false, forceFallback: false });
    expect(effectiveCeremoniesCompleted(0)).toBe(0);
  });

  it('forceRepeat lifts a first ceremony to a repeat in __DEV__', async () => {
    const { setCeremonyDevOverride, getCeremonyDevOverrides, effectiveCeremoniesCompleted } = await loadPrefs();
    setCeremonyDevOverride('forceRepeat', true);
    expect(effectiveCeremoniesCompleted(0)).toBe(1);
    expect(effectiveCeremoniesCompleted(5)).toBe(5);
    expect(effectiveCeremoniesCompleted(NaN)).toBe(1);
    expect(effectiveCeremoniesCompleted(-2)).toBe(1);
    setCeremonyDevOverride('forceFallback', true);
    const snapshot = getCeremonyDevOverrides();
    expect(snapshot).toEqual({ forceRepeat: true, forceFallback: true });
    snapshot.forceRepeat = false;
    expect(getCeremonyDevOverrides()).toEqual({ forceRepeat: true, forceFallback: true });
    setCeremonyDevOverride('forceRepeat', false);
    expect(effectiveCeremoniesCompleted(0)).toBe(0);
    expect(effectiveCeremoniesCompleted(NaN)).toBe(0);
  });

  it('exports the device-global key and the read budget', async () => {
    const { CEREMONY_PREFS_KEY, CEREMONY_PREFS_READ_TIMEOUT_MS } = await loadPrefs();
    expect(CEREMONY_PREFS_KEY).toBe('recallsmith:ceremony:completed:v1');
    expect(CEREMONY_PREFS_READ_TIMEOUT_MS).toBe(250);
    expect(CEREMONY_PREFS_KEY.startsWith('devcards:u:')).toBe(false);
  });
});
