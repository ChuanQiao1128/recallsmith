// studyPrefs.ts against a Map-backed AsyncStorage mock (the feedbackPrefs.test.ts harness).
// The module is only loaded through loadModule() so each test gets a fresh in-memory value.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let mode: 'ok' | 'throw' = 'ok';
const getItem = vi.fn(async (key: string) => {
  if (mode === 'throw') throw new Error('storage down');
  return store.get(key) ?? null;
});
const setItem = vi.fn(async (key: string, value: string) => {
  if (mode === 'throw') throw new Error('storage down');
  store.set(key, value);
});
const getAllKeys = vi.fn(async () => {
  if (mode === 'throw') throw new Error('storage down');
  return [...store.keys()];
});
const multiGet = vi.fn(async (keys: readonly string[]) => keys.map((key) => [key, store.get(key) ?? null] as const));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem, setItem, getAllKeys, multiGet } }));

// The probe must not depend on who is signed in right now (F02 x-deploy-1), so it never asks the
// scoped storage module; the mock throws to prove it.
vi.mock('../../src/review/storage', () => ({
  loadAllProgress: async () => {
    throw new Error('the learned-card probe must scan the device, not the current scope');
  },
}));

const LEARNED_ROW = { stableUid: 'a', stage: 2, nextReviewAt: 5, lastReviewedAt: 1_700_000_000_000 };
const NEW_ROW = { stableUid: 'b', stage: 0, nextReviewAt: 0 };

async function loadModule() {
  vi.resetModules();
  return await import('../../src/features/gacha/study/studyPrefs');
}

const KEY = 'recallsmith:study-prefs:v1';

describe('studyPrefs', () => {
  beforeEach(() => {
    store.clear();
    mode = 'ok';
    getItem.mockClear();
    setItem.mockClear();
  });

  it('defaults a new learner (no learned card) to two buttons and stores that default', async () => {
    store.set('devcards:u:anon:deck-progress:csharp', JSON.stringify([NEW_ROW]));
    const mod = await loadModule();
    expect(mod.getStudyPrefsSync()).toEqual({ fourButtons: false });
    expect(await mod.loadStudyPrefs()).toEqual({ fourButtons: false });
    expect(JSON.parse(store.get(KEY) as string)).toEqual({ fourButtons: false });
  });

  it('gives an existing learner (any learned card) four buttons and stores it so they keep them', async () => {
    store.set('devcards:u:anon:deck-progress:dotnet', JSON.stringify([]));
    store.set('devcards:u:anon:deck-progress:csharp', JSON.stringify([NEW_ROW, LEARNED_ROW]));
    const mod = await loadModule();
    expect(await mod.loadStudyPrefs()).toEqual({ fourButtons: true });
    expect(mod.getStudyPrefsSync()).toEqual({ fourButtons: true });
    expect(JSON.parse(store.get(KEY) as string)).toEqual({ fourButtons: true });
  });

  it('decides the default once: a stored value wins over the learned-card probe', async () => {
    store.set(KEY, JSON.stringify({ fourButtons: false }));
    const probe = vi.fn(async () => true);
    const mod = await loadModule();
    expect(await mod.loadStudyPrefs(probe)).toEqual({ fourButtons: false });
    expect(probe).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('treats a malformed stored value as absent', async () => {
    store.set(KEY, '{not json');
    const mod = await loadModule();
    expect(await mod.loadStudyPrefs(async () => true)).toEqual({ fourButtons: true });
    store.set(KEY, JSON.stringify({ fourButtons: 'yes' }));
    expect(await mod.loadStudyPrefs(async () => false)).toEqual({ fourButtons: false });
  });

  it('persists the Settings toggle and reads it back on a fresh load', async () => {
    const first = await loadModule();
    expect(await first.setStudyPrefs({ fourButtons: true })).toEqual({ fourButtons: true });
    expect(first.getStudyPrefsSync()).toEqual({ fourButtons: true });
    expect(setItem).toHaveBeenCalledWith(KEY, JSON.stringify({ fourButtons: true }));

    const second = await loadModule();
    expect(second.getStudyPrefsSync()).toEqual({ fourButtons: false });
    expect(await second.loadStudyPrefs(async () => false)).toEqual({ fourButtons: true });
  });

  it('keeps the in-memory value and stores nothing when storage or the probe fails', async () => {
    const mod = await loadModule();
    expect(await mod.loadStudyPrefs(async () => {
      throw new Error('probe down');
    })).toEqual({ fourButtons: false });
    expect(store.has(KEY)).toBe(false);

    await mod.setStudyPrefs({ fourButtons: true });
    mode = 'throw';
    expect(await mod.loadStudyPrefs()).toEqual({ fourButtons: true });
    expect(await mod.setStudyPrefs({ fourButtons: false })).toEqual({ fourButtons: false });
    expect(mod.getStudyPrefsSync()).toEqual({ fourButtons: false });
  });

  // F02 x-deploy-1: the default is decided once and stored device-wide, so it must see every
  // learned card on the device, not only the ones in the scope of whoever is signed in.
  it('keeps four buttons for a user who upgrades while signed out (progress under their own sub)', async () => {
    store.set('devcards:u:anon:deck-progress:csharp', JSON.stringify([NEW_ROW]));
    store.set('devcards:u:0f9c-sub:deck-progress:csharp', JSON.stringify([LEARNED_ROW]));
    const mod = await loadModule();
    expect(await mod.loadStudyPrefs()).toEqual({ fourButtons: true });
    expect(JSON.parse(store.get(KEY) as string)).toEqual({ fourButtons: true });
  });

  it('counts progress still held only in legacy versioned or unscoped keys', async () => {
    for (const key of [
      'devcards:u:0f9c-sub:deck-progress:csharp:12',
      'deck-progress:dotnet',
      'deck-progress:dotnet:3',
    ]) {
      store.clear();
      store.set(key, JSON.stringify([NEW_ROW, LEARNED_ROW]));
      const mod = await loadModule();
      expect(await mod.loadStudyPrefs()).toEqual({ fourButtons: true });
    }
  });

  it('ignores other keys and unreadable progress when deciding', async () => {
    store.set('devcards:u:anon:deck-daily-stats:csharp', JSON.stringify([LEARNED_ROW]));
    store.set('devcards:u:anon:deck-progress:csharp', '{not json');
    store.set('devcards:u:anon:deck-progress:dotnet', JSON.stringify({ rows: [LEARNED_ROW] }));
    const mod = await loadModule();
    expect(await mod.hasAnyLearnedCard()).toBe(false);
    expect(await mod.loadStudyPrefs()).toEqual({ fourButtons: false });
  });
});
