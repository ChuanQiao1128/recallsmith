import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * K03 — cardSource reads `cards[].source` from the installed raw deck file,
 * found through the per-user meta key the frozen deck repository writes.
 * AsyncStorage, the file system and the Amplify session are in-memory fakes;
 * the module is re-imported per case so its deck cache starts empty.
 */

const store = new Map<string, string>();
const files = new Map<string, string>();
let sessionFixture: unknown = { userSub: 'user-1' };
let sessionFails = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: vi.fn(async (uri: string) => {
    const found = files.get(uri);
    if (found == null) throw new Error('ENOENT');
    return found;
  }),
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(async () => {
    if (sessionFails) throw new Error('no session');
    return sessionFixture;
  }),
}));

import * as FileSystem from 'expo-file-system/legacy';

async function loadModule() {
  vi.resetModules();
  return await import('../../src/content/cardSource');
}

const S3_URL = 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html';
const OAC_URL = 'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html';

function metaKey(userKey: string, slug: string) {
  return `devcards:content:deckmeta:v2:${userKey}:${slug}`;
}

function install(userKey: string, slug: string, buildId: string, deckJson: unknown) {
  const fileUri = `file:///docs/devcards-decks-v2/${userKey}/${slug}.json`;
  files.set(fileUri, JSON.stringify(deckJson));
  store.set(
    metaKey(userKey, slug),
    JSON.stringify({ slug, buildId, installedAtMs: 1, fileUri, cardCount: 3 }),
  );
  return fileUri;
}

const FLAT_DECK = {
  slug: 'aws-saa-c03',
  title: 'AWS SAA-C03',
  locale: 'en-US',
  deckType: 2,
  version: '3',
  totalCards: 3,
  cards: [
    {
      stableUid: 'aws-s3-storage-classes',
      question: 'Which storage class fits rarely read data?',
      source: { url: S3_URL, quote: '  Infrequent access classes cost less to store.  ' },
    },
    {
      stableUid: 'aws-s3-cloudfront-oac',
      question: 'How does CloudFront reach a private bucket?',
      source: { url: OAC_URL, quote: null },
    },
    { stableUid: 'aws-iam-roles-vs-users', question: 'Role or user?' },
  ],
};

beforeEach(() => {
  store.clear();
  files.clear();
  sessionFixture = { userSub: 'user-1' };
  sessionFails = false;
  vi.mocked(FileSystem.readAsStringAsync).mockClear();
});

describe('cardSource', () => {
  it('parses a valid source and turns an empty quote into null', async () => {
    const { parseCardSource } = await loadModule();
    expect(parseCardSource({ url: `  ${S3_URL}  `, quote: '  Short quote.\nSecond line.  ' })).toEqual({
      url: S3_URL,
      quote: 'Short quote.\nSecond line.',
    });
    expect(parseCardSource({ url: S3_URL, quote: '   ' })).toEqual({ url: S3_URL, quote: null });
    expect(parseCardSource({ url: S3_URL, quote: '' })).toEqual({ url: S3_URL, quote: null });
    expect(parseCardSource({ url: S3_URL, quote: null })).toEqual({ url: S3_URL, quote: null });
    expect(parseCardSource({ url: S3_URL })).toEqual({ url: S3_URL, quote: null });
    expect(parseCardSource({ url: S3_URL, quote: 'q', extra: 1 })).toEqual({ url: S3_URL, quote: 'q' });
  });

  it('rejects a non-https, over-long or malformed source', async () => {
    const { parseCardSource, CARD_SOURCE_URL_MAX_LENGTH, CARD_SOURCE_QUOTE_MAX_LENGTH } = await loadModule();
    expect(parseCardSource(null)).toBeNull();
    expect(parseCardSource(undefined)).toBeNull();
    expect(parseCardSource('https://docs.aws.amazon.com/')).toBeNull();
    expect(parseCardSource([S3_URL])).toBeNull();
    expect(parseCardSource({})).toBeNull();
    expect(parseCardSource({ url: 42 })).toBeNull();
    expect(parseCardSource({ url: 'http://docs.aws.amazon.com/s3' })).toBeNull();
    expect(parseCardSource({ url: 'javascript:alert(1)' })).toBeNull();
    expect(parseCardSource({ url: 'https://' })).toBeNull();
    expect(parseCardSource({ url: 'https://docs.aws.amazon.com/a b' })).toBeNull();
    expect(parseCardSource({ url: 'HTTPS://docs.aws.amazon.com/' })).toBeNull();

    const base = 'https://docs.aws.amazon.com/';
    const atLimit = base + 'a'.repeat(CARD_SOURCE_URL_MAX_LENGTH - base.length);
    expect(parseCardSource({ url: atLimit })).toEqual({ url: atLimit, quote: null });
    expect(parseCardSource({ url: atLimit + 'a' })).toBeNull();

    const longQuote = 'q'.repeat(CARD_SOURCE_QUOTE_MAX_LENGTH);
    expect(parseCardSource({ url: S3_URL, quote: `  ${longQuote}  ` })).toEqual({ url: S3_URL, quote: longQuote });
    expect(parseCardSource({ url: S3_URL, quote: longQuote + 'q' })).toBeNull();
    expect(parseCardSource({ url: S3_URL, quote: 7 })).toBeNull();
    expect(parseCardSource({ url: S3_URL, quote: { text: 'x' } })).toBeNull();
  });

  it('labels the host without a leading www', async () => {
    const { sourceHostLabel } = await loadModule();
    expect(sourceHostLabel(S3_URL)).toBe('docs.aws.amazon.com');
    expect(sourceHostLabel('https://www.example.com/page')).toBe('example.com');
    expect(sourceHostLabel('https://WWW.Example.COM')).toBe('example.com');
    expect(sourceHostLabel('https://www.www.example.com/')).toBe('www.example.com');
    expect(sourceHostLabel('https://user:pw@docs.aws.amazon.com:8443/x?y#z')).toBe('docs.aws.amazon.com');
    expect(sourceHostLabel('https://example.com?q=1')).toBe('example.com');
    expect(sourceHostLabel('https://')).toBe('');
    expect(sourceHostLabel('not a url')).toBe('');
    expect(sourceHostLabel('')).toBe('');
  });

  it('reads the source from the installed flat deck file of the signed-in user', async () => {
    sessionFixture = { tokens: { idToken: { payload: { sub: 'abc|123' } } } };
    // sanitised the way the repository does it: '|' → '_'
    install('abc_123', 'aws-saa-c03', 'build-1', FLAT_DECK);
    // Another user's install of the same deck must not be read.
    install('someone-else', 'aws-saa-c03', 'build-9', {
      cards: [{ stableUid: 'aws-iam-roles-vs-users', source: { url: 'https://example.com/other' } }],
    });
    const { getCardSource } = await loadModule();

    expect(await getCardSource('aws-saa-c03', 'aws-s3-storage-classes')).toEqual({
      url: S3_URL,
      quote: 'Infrequent access classes cost less to store.',
    });
    expect(await getCardSource(' aws-saa-c03 ', 'aws-s3-cloudfront-oac')).toEqual({ url: OAC_URL, quote: null });
    expect(await getCardSource('aws-saa-c03', 'aws-iam-roles-vs-users')).toBeNull();
  });

  it('reads a v1 deck file too', async () => {
    install('user-1', 'aws-saa-c03', 'build-v1', {
      buildId: 'build-v1',
      deck: { slug: 'aws-saa-c03', title: 'AWS SAA-C03' },
      cards: [
        { stableUid: 'aws-lambda-cold-start-init', source: { url: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html', quote: 'Init runs once per environment.' } },
      ],
    });
    const { getCardSource } = await loadModule();
    expect(await getCardSource('aws-saa-c03', 'aws-lambda-cold-start-init')).toEqual({
      url: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html',
      quote: 'Init runs once per environment.',
    });
  });

  it('returns null for a legacy card, a missing meta key or an unreadable file', async () => {
    const { getCardSource } = await loadModule();

    // Legacy deck: no card carries a source; invalid sources are skipped.
    install('user-1', 'legacy', 'b1', {
      cards: [
        { stableUid: 'aws-s3-storage-classes', question: 'q' },
        { stableUid: 'aws-iam-roles-vs-users', source: { url: 'http://docs.aws.amazon.com/iam' } },
        { stable_uid: 'aws-s3-cloudfront-oac', source: { url: OAC_URL } },
      ],
    });
    expect(await getCardSource('legacy', 'aws-s3-storage-classes')).toBeNull();
    expect(await getCardSource('legacy', 'aws-iam-roles-vs-users')).toBeNull();
    expect(await getCardSource('legacy', 'aws-s3-cloudfront-oac')).toBeNull();

    // No meta for the deck at all.
    expect(await getCardSource('not-installed', 'aws-s3-storage-classes')).toBeNull();

    // Meta without buildId / fileUri, or not JSON.
    store.set(metaKey('user-1', 'no-build'), JSON.stringify({ slug: 'no-build', fileUri: 'file:///x.json' }));
    expect(await getCardSource('no-build', 'aws-s3-storage-classes')).toBeNull();
    store.set(metaKey('user-1', 'bad-meta'), '{not json');
    expect(await getCardSource('bad-meta', 'aws-s3-storage-classes')).toBeNull();

    // Meta pointing at a missing file, or at a corrupt one.
    store.set(metaKey('user-1', 'gone'), JSON.stringify({ slug: 'gone', buildId: 'b', fileUri: 'file:///missing.json' }));
    expect(await getCardSource('gone', 'aws-s3-storage-classes')).toBeNull();
    const corruptUri = install('user-1', 'corrupt', 'b', {});
    files.set(corruptUri, '{"cards": [');
    expect(await getCardSource('corrupt', 'aws-s3-storage-classes')).toBeNull();

    // No session: the anon user key, which has nothing installed here.
    install('user-1', 'aws-saa-c03', 'build-1', FLAT_DECK);
    sessionFails = true;
    expect(await getCardSource('aws-saa-c03', 'aws-s3-storage-classes')).toBeNull();
    sessionFails = false;
    sessionFixture = null;
    expect(await getCardSource('aws-saa-c03', 'aws-s3-storage-classes')).toBeNull();
  });

  it('re-reads the file only when the build changes', async () => {
    const fileUri = install('user-1', 'aws-saa-c03', 'build-1', FLAT_DECK);
    const { getCardSource } = await loadModule();
    const read = vi.mocked(FileSystem.readAsStringAsync);

    expect((await getCardSource('aws-saa-c03', 'aws-s3-storage-classes'))?.url).toBe(S3_URL);
    expect((await getCardSource('aws-saa-c03', 'aws-s3-cloudfront-oac'))?.url).toBe(OAC_URL);
    expect(read).toHaveBeenCalledTimes(1);

    // A new build lands in the same file: the cache key changes, so it re-reads.
    install('user-1', 'aws-saa-c03', 'build-2', {
      ...FLAT_DECK,
      cards: [{ stableUid: 'aws-s3-storage-classes', source: { url: OAC_URL, quote: 'Moved.' } }],
    });
    expect(fileUri).toBe('file:///docs/devcards-decks-v2/user-1/aws-saa-c03.json');
    expect(await getCardSource('aws-saa-c03', 'aws-s3-storage-classes')).toEqual({ url: OAC_URL, quote: 'Moved.' });
    expect(await getCardSource('aws-saa-c03', 'aws-s3-cloudfront-oac')).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps at most four decks cached and drops the oldest', async () => {
    for (const slug of ['d1', 'd2', 'd3', 'd4', 'd5']) {
      install('user-1', slug, 'b', { cards: [{ stableUid: 'u', source: { url: `https://docs.aws.amazon.com/${slug}` } }] });
    }
    const { getCardSource } = await loadModule();
    const read = vi.mocked(FileSystem.readAsStringAsync);

    for (const slug of ['d1', 'd2', 'd3', 'd4', 'd5']) await getCardSource(slug, 'u');
    expect(read).toHaveBeenCalledTimes(5);
    await getCardSource('d5', 'u');
    await getCardSource('d2', 'u');
    expect(read).toHaveBeenCalledTimes(5);
    expect((await getCardSource('d1', 'u'))?.url).toBe('https://docs.aws.amazon.com/d1');
    expect(read).toHaveBeenCalledTimes(6);
  });
});
