// Example-based tests for feedbackPrefs.ts against a Map-backed AsyncStorage mock with a
// switchable mode (the ceremonyPrefs.test.ts / mcqCoachPrefs.test.ts harness). The mock is
// declared before the imports (vi.mock is hoisted); the module under test is only ever loaded
// through the dynamic loadModule() below so each test gets a fresh in-memory value. Never add a
// static import of feedbackPrefs here.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let mode: 'ok' | 'throw' | 'write-throw' = 'ok';
const getItem = vi.fn(async (key: string) => {
  if (mode === 'throw') throw new Error('storage down');
  return store.get(key) ?? null;
});
const setItem = vi.fn(async (key: string, value: string) => {
  if (mode === 'throw' || mode === 'write-throw') throw new Error('storage down');
  store.set(key, value);
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem, setItem } }));

async function loadModule() {
  vi.resetModules();
  return await import('../../src/features/gacha/settings/feedbackPrefs');
}

const KEY = 'recallsmith:feedback-prefs:v1';

describe('feedbackPrefs', () => {
  beforeEach(() => {
    store.clear();
    mode = 'ok';
    getItem.mockClear();
    setItem.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to sound effects and haptics on', async () => {
    const mod = await loadModule();
    // The synchronous getter starts at the defaults before any load.
    expect(mod.getFeedbackPrefsSync()).toEqual({ soundEffects: true, haptics: true });
    // Nothing stored → load returns the defaults and keeps memory at the defaults.
    expect(await mod.loadFeedbackPrefs()).toEqual({ soundEffects: true, haptics: true });
    expect(getItem).toHaveBeenCalledWith(KEY);
    expect(mod.DEFAULT_FEEDBACK_PREFS).toEqual({ soundEffects: true, haptics: true });
  });

  it('persists a toggled preference and reads it back', async () => {
    const first = await loadModule();
    const saved = await first.setFeedbackPref('soundEffects', false);
    expect(saved).toEqual({ soundEffects: false, haptics: true });
    // Memory reflects the change immediately, and storage holds the JSON.
    expect(first.getFeedbackPrefsSync()).toEqual({ soundEffects: false, haptics: true });
    expect(setItem).toHaveBeenCalledWith(KEY, JSON.stringify({ soundEffects: false, haptics: true }));
    expect(JSON.parse(store.get(KEY) as string)).toEqual({ soundEffects: false, haptics: true });

    // A fresh module load reads the stored choice back.
    const second = await loadModule();
    expect(second.getFeedbackPrefsSync()).toEqual({ soundEffects: true, haptics: true }); // defaults before load
    expect(await second.loadFeedbackPrefs()).toEqual({ soundEffects: false, haptics: true });
    expect(second.getFeedbackPrefsSync()).toEqual({ soundEffects: false, haptics: true });
  });

  it('falls back to defaults on unreadable storage', async () => {
    const mod = await loadModule();
    mode = 'throw';
    // A read error leaves the in-memory value (the defaults) untouched.
    expect(await mod.loadFeedbackPrefs()).toEqual({ soundEffects: true, haptics: true });
    expect(mod.getFeedbackPrefsSync()).toEqual({ soundEffects: true, haptics: true });

    // Garbage / partial JSON coerces missing or non-boolean fields to the default.
    mode = 'ok';
    store.set(KEY, 'not json');
    expect(await mod.loadFeedbackPrefs()).toEqual({ soundEffects: true, haptics: true });
    store.set(KEY, JSON.stringify({ soundEffects: false, haptics: 'nope' }));
    expect(await mod.loadFeedbackPrefs()).toEqual({ soundEffects: false, haptics: true });

    // A write that throws is swallowed but memory still holds the new value.
    mode = 'write-throw';
    const saved = await mod.setFeedbackPref('haptics', false);
    expect(saved).toEqual({ soundEffects: false, haptics: false });
    expect(mod.getFeedbackPrefsSync()).toEqual({ soundEffects: false, haptics: false });
  });
});
