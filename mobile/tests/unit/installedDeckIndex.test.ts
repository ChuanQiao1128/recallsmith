import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The installed deck reader: one parse of the installed raw deck file serves both the card
 * sources (cardSource.getCardSource) and the card translations (getDeckTranslations). AsyncStorage,
 * the file system and the Amplify session are in-memory fakes, as in cardSource.test.ts; the
 * modules are re-imported per case so the reader's cache starts empty.
 */

const store = new Map<string, string>();
const files = new Map<string, string>();
let readGate: Promise<void> | null = null;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  },
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: vi.fn(async (uri: string) => {
    if (readGate) await readGate;
    const found = files.get(uri);
    if (found == null) throw new Error('ENOENT');
    return found;
  }),
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(async () => ({ userSub: 'user-1' })),
}));

import * as FileSystem from 'expo-file-system/legacy';

async function loadModules() {
  vi.resetModules();
  const index = await import('../../src/content/installedDeckIndex');
  const cardSource = await import('../../src/content/cardSource');
  return { ...index, getCardSource: cardSource.getCardSource };
}

function install(slug: string, buildId: string, deckJson: unknown) {
  const fileUri = `file:///docs/devcards-decks-v2/user-1/${slug}.json`;
  files.set(fileUri, typeof deckJson === 'string' ? deckJson : JSON.stringify(deckJson));
  store.set(
    `devcards:content:deckmeta:v2:user-1:${slug}`,
    JSON.stringify({ slug, buildId, installedAtMs: 1, fileUri, cardCount: 3 }),
  );
  return fileUri;
}

const ZH_ENTRY = {
  v: 1,
  question: '哪种存储类别适合很少读取的数据？',
  explanation: '低频访问类别的存储费用更低。',
};

const DECK = {
  slug: 'aws-saa-c03',
  title: 'AWS SAA-C03',
  locale: 'en-US',
  cards: [
    {
      stableUid: 'translated',
      question: 'Which storage class fits rarely read data?',
      source: { url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html', quote: 'Infrequent access.' },
      translations: { 'zh-CN': ZH_ENTRY },
    },
    { stableUid: 'english-only', question: 'Role or user?' },
    // An entry carrying a correct mark is not a translation; the card stays English.
    { stableUid: 'marked', question: 'Q', translations: { 'zh-CN': { ...ZH_ENTRY, correct: true } } },
    { stableUid: 'other-locale', question: 'Q', translations: { 'zh-TW': ZH_ENTRY } },
  ],
};

beforeEach(() => {
  store.clear();
  files.clear();
  readGate = null;
  vi.mocked(FileSystem.readAsStringAsync).mockClear();
});

describe('installedDeckIndex', () => {
  it('builds sources and translations from one read of the installed file', async () => {
    install('aws-saa-c03', 'build-1', DECK);
    const { getInstalledDeckIndex, getDeckTranslations, getCardSource } = await loadModules();
    const read = vi.mocked(FileSystem.readAsStringAsync);

    const translations = await getDeckTranslations('aws-saa-c03');
    expect([...(translations?.keys() ?? [])]).toEqual(['translated']);
    expect(translations?.get('translated')?.['zh-CN']).toEqual({
      v: 1,
      question: '哪种存储类别适合很少读取的数据？',
      explanation: '低频访问类别的存储费用更低。',
      realWorldUsage: null,
      mcq: null,
    });
    expect((await getCardSource('aws-saa-c03', 'translated'))?.quote).toBe('Infrequent access.');
    expect((await getInstalledDeckIndex('aws-saa-c03'))?.sources.size).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('shares one read between callers that ask at the same moment', async () => {
    install('aws-saa-c03', 'build-1', DECK);
    const { getDeckTranslations, getCardSource } = await loadModules();
    let open!: () => void;
    readGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const both = Promise.all([getDeckTranslations('aws-saa-c03'), getCardSource('aws-saa-c03', 'translated')]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    open();
    const [translations, source] = await both;
    expect(translations?.has('translated')).toBe(true);
    expect(source?.url).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
    expect(vi.mocked(FileSystem.readAsStringAsync)).toHaveBeenCalledTimes(1);
  });

  it('is null for a deck without translations, a missing install or a corrupt file, and retries a failed read', async () => {
    install('claude-ccdv-f', 'build-1', { cards: [{ stableUid: 'c1', question: 'Q' }] });
    const corrupt = install('corrupt', 'build-1', '{"cards": [');
    const { getDeckTranslations, getInstalledDeckIndex } = await loadModules();

    expect((await getDeckTranslations('claude-ccdv-f'))?.size).toBe(0);
    expect(await getDeckTranslations('not-installed')).toBeNull();
    expect(await getDeckTranslations('  ')).toBeNull();
    expect(await getInstalledDeckIndex('corrupt')).toBeNull();

    // The failed parse is not cached: the next call reads the (now valid) file again.
    files.set(corrupt, JSON.stringify(DECK));
    expect((await getDeckTranslations('corrupt'))?.has('translated')).toBe(true);
  });

  it('re-reads when the installed build changes', async () => {
    install('aws-saa-c03', 'build-1', DECK);
    const { getDeckTranslations } = await loadModules();
    expect((await getDeckTranslations('aws-saa-c03'))?.has('translated')).toBe(true);
    install('aws-saa-c03', 'build-2', { ...DECK, cards: [{ stableUid: 'english-only', question: 'Q' }] });
    expect((await getDeckTranslations('aws-saa-c03'))?.has('translated')).toBe(false);
    expect(vi.mocked(FileSystem.readAsStringAsync)).toHaveBeenCalledTimes(2);
  });
});
