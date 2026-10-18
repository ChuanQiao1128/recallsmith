// cardLangPrefs.ts against a Map-backed AsyncStorage mock with a switchable mode (the
// feedbackPrefs.test.ts harness). The module is only ever loaded through loadModule(), so each test
// gets a fresh in-memory value. Never add a static import of cardLangPrefs here.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let mode: 'ok' | 'throw' | 'write-throw' = 'ok';
let readGate: Promise<void> | null = null;
// The value is taken before the (optional) gate, so a gated read returns what was stored when it began.
const getItem = vi.fn(async (key: string) => {
  const value = store.get(key) ?? null;
  if (readGate) await readGate;
  if (mode === 'throw') throw new Error('storage down');
  return value;
});
const setItem = vi.fn(async (key: string, value: string) => {
  if (mode === 'throw' || mode === 'write-throw') throw new Error('storage down');
  store.set(key, value);
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem, setItem } }));

async function loadModule() {
  vi.resetModules();
  return await import('../../src/features/gacha/study/cardLangPrefs');
}

const KEY = 'recallsmith:card-lang:v1';

describe('cardLangPrefs', () => {
  beforeEach(() => {
    store.clear();
    mode = 'ok';
    readGate = null;
    getItem.mockClear();
    setItem.mockClear();
  });

  it('defaults to English, before and after a load of an empty store', async () => {
    const mod = await loadModule();
    expect(mod.CARD_LANG_KEY).toBe(KEY);
    expect(mod.getCardLangSync()).toBe('en');
    expect(await mod.loadCardLangPref()).toBe('en');
    expect(getItem).toHaveBeenCalledWith(KEY);
  });

  it('remembers the choice across launches', async () => {
    const first = await loadModule();
    expect(await first.setCardLangPref('zh-CN')).toBe('zh-CN');
    expect(first.getCardLangSync()).toBe('zh-CN');
    expect(store.get(KEY)).toBe('zh-CN');

    const second = await loadModule();
    expect(second.getCardLangSync()).toBe('en');
    expect(await second.loadCardLangPref()).toBe('zh-CN');
    expect(second.getCardLangSync()).toBe('zh-CN');

    await second.setCardLangPref('en');
    expect(store.get(KEY)).toBe('en');
  });

  it('reads anything else as English', async () => {
    for (const raw of ['zh-TW', 'zh', '"zh-CN"', '', 'EN']) {
      store.set(KEY, raw);
      const mod = await loadModule();
      expect(await mod.loadCardLangPref()).toBe('en');
    }
  });

  it('tells subscribers about a change, once', async () => {
    const mod = await loadModule();
    const listener = vi.fn();
    const unsubscribe = mod.subscribeCardLang(listener);
    await mod.setCardLangPref('zh-CN');
    await mod.setCardLangPref('zh-CN');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await mod.setCardLangPref('en');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the in-memory value when storage fails', async () => {
    const mod = await loadModule();
    mode = 'write-throw';
    expect(await mod.setCardLangPref('zh-CN')).toBe('zh-CN');
    expect(mod.getCardLangSync()).toBe('zh-CN');
    mode = 'throw';
    expect(await mod.loadCardLangPref()).toBe('zh-CN');
  });

  it('a load that started before a tap does not undo it', async () => {
    store.set(KEY, 'en');
    const mod = await loadModule();
    let open!: () => void;
    readGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const loading = mod.loadCardLangPref();
    await mod.setCardLangPref('zh-CN');
    readGate = null;
    open();
    await loading;
    expect(mod.getCardLangSync()).toBe('zh-CN');
  });
});
