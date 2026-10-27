import { createHash } from 'node:crypto';
vi.hoisted(() => { process.env.EXPO_PUBLIC_CONTENT_BASE_URL = 'https://cdn.test'; });
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckExport } from '../../src/types/deckExport';
const store = new Map<string, string>();
const files = new Map<string, string>();
let onRead: ((key: string) => Promise<void>) | null = null;
let onWrite: ((key: string, after: boolean) => Promise<void>) | null = null;
const writes: string[] = [];
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => { const raw = store.get(key) ?? null; await onRead?.(key); return raw; }),
  setItem: vi.fn(async (key: string, value: string) => { writes.push(key); await onWrite?.(key, false); store.set(key, value); await onWrite?.(key, true); }),
  removeItem: vi.fn(async (key: string) => { store.delete(key); }), getAllKeys: vi.fn(async () => [...store.keys()]),
  multiGet: vi.fn(async (keys: string[]) => keys.map(key => [key, store.get(key) ?? null])),
  multiRemove: vi.fn(async (keys: string[]) => keys.forEach(key => store.delete(key))),
} }));
const apiJson = vi.fn();
vi.mock('../../src/api/apiClient', () => ({ apiJson: (...args: unknown[]) => apiJson(...args) }));
vi.mock('../../src/content/deckCache', () => ({ getCachedDeck: vi.fn(async () => deck) }));

import { acquireDraw } from '../../src/features/gacha/draw/acquireDraw';
import { flushDrawHistory } from '../../src/features/gacha/draw/drawCommit';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { loadDeckWallet } from '../../src/features/gacha/rewards/deckWallet';
import { setActiveUserSubForStorage } from '../../src/review/storage';
import { syncDrawStateNow } from '../../src/sync/drawStateSync';
const slug = 'aws-saa-fundamentals'; const scope = 'devcards:u:user-a:';
const stateKey = `${scope}devcards:draw-state:${slug}`; const walletKey = `${scope}recallsmith:deck-wallets:v1`;
const progressKey = `${scope}deck-progress:${slug}`; const historyKey = `${scope}devcards:draw-history:${slug}`;
const pity = { draws: 10, threshold: 10 }; let deck: DeckExport;
function seed(owned: string[] = [], pulls = 10) {
  store.set(stateKey, JSON.stringify({ owned, pity }));
  store.set(walletKey, JSON.stringify({ migratedAtMs: 1, decks: { [slug]: { availablePulls: pulls, reservePulls: 0 } }, bootstrappedAtMs: { [slug]: 1 } }));
  store.set('recallsmith:onboarding:stage:v1', 'done');
}
function barrier() {
  let entered!: () => void; let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  return { reached, release, block: async () => { entered(); await wait; } };
}
const uids = (r: Awaited<ReturnType<typeof acquireDraw>>) => r.result?.cards.map(c => c.stableUid) ?? [];
const learned = (stableUid: string) => ({ stableUid, stage: 2, lastReviewedAt: 1700000000000, nextReviewAt: 1700086400000 });
const remote = (owned: string[]) => ({ success: true, data: { decks: [{ deckSlug: slug, owned }], wallet: null } });
beforeEach(async () => {
  await flushDrawHistory(); store.clear(); files.clear(); writes.length = 0; onRead = null; onWrite = null;
  invalidateDrawStateCache(); setActiveUserSubForStorage('user-a'); apiJson.mockReset();
  deck = { Slug: slug, Title: 'AWS', Locale: 'en', Version: 'course-1', DeckType: 1, IsFreeStarter: true, TotalCards: 12, FreeCardCount: 12,
    Cards: Array.from({ length: 12 }, (_, i) => ({ StableUid: `c${i + 1}`, OrderInDeck: i + 1, Question: `Q${i + 1}`, Difficulty: i === 11 ? 3 : 1, Revision: 1 })).reverse() };
  seed();
});
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: vi.fn(async (uri: string) => {
    if (!files.has(uri)) throw new Error('ENOENT');
    return files.get(uri)!;
  }),
  writeAsStringAsync: vi.fn(async () => {}),
  deleteAsync: vi.fn(async (uri: string) => { files.delete(uri); }),
  moveAsync: vi.fn(async () => {}),
  getInfoAsync: vi.fn(async (uri: string) => ({ exists: files.has(uri), isDirectory: false, uri })),
  makeDirectoryAsync: vi.fn(async () => {}),
  readDirectoryAsync: vi.fn(async () => []),
  downloadAsync: vi.fn(async () => ({ status: 404 })),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_alg: string, text: string) =>
    createHash('sha256').update(text, 'utf8').digest('hex'),
  ),
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(async () => ({ userSub: 'user-a' })),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  getIsPremiumUser: vi.fn(async () => false),
}));


import * as FileSystem from 'expo-file-system/legacy';
import { listManifestDecks, resolveDeckBySlug } from '../../src/content/deckRepository';

async function retireActualDeck() {
  const manifest = { schemaVersion: 2, generatedAtMs: 1, prefix: 'content', decks: [{ slug,
    title: 'AWS', locale: 'en-US', deckType: 1, tier: 'free', availability: 'retired',
    retiredAtMs: 1700000000000, downloadMode: 'public', totalCards: 12, version: 'course-1',
    buildId: 'course-1', path: 'decks/aws/builds/course-1/deck.json', sha256: null, patches: null }] };
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(manifest),
    json: async () => manifest, headers: { get: () => null } })) as unknown as typeof fetch;
  await listManifestDecks({ preferRemote: true });
}
it('rejects a fresh opening with the retained screen deck after actual retirement', async () => {
  seed(['c1'], 10); seedActive();
  const screenDeck = deck;
  await retireActualDeck();
  expect(store.has(stateKey)).toBe(false);
  await expect(acquireDraw(slug, 1, { deck: screenDeck })).rejects.toThrow();
  expect(store.has(stateKey)).toBe(false);
  expect((await loadDeckWallet(slug)).availablePulls).toBe(10);
});
it('does not restore retired ownership or pulls in a newly started sync', async () => {
  seed(['c1'], 10); await retireActualDeck();
  apiJson.mockResolvedValue({ success: true, data: { decks: [{ deckSlug: slug, owned: ['c1','c3'], pulls: { availablePulls: 50, reservePulls: 0, updatedAtMs: 100 } }] } });
  const result = await syncDrawStateNow('token');
  expect(result.ran).toBe(true); expect(result.appliedOwned).toBe(0);
  expect(store.has(stateKey)).toBe(false);
  expect((await loadDeckWallet(slug)).availablePulls).toBe(10);
});

const manifestKey = 'devcards:content:manifest:v2';
const metaKey = `devcards:content:deckmeta:v2:user-a:${slug}`;
function seedActive(version = 'course-1') {
  store.set(manifestKey, JSON.stringify({ decks: [{ slug, availability: 'live', tier: 'free', version }] }));
  store.set(metaKey, JSON.stringify({ buildId: version, fileUri: 'file:///docs/aws.json' }));
  files.set('file:///docs/aws.json', JSON.stringify({ slug, title: 'AWS', locale: 'en', deckType: 1, version,
    cards: deck.Cards.map(c => ({ stableUid: c.StableUid, orderInDeck: c.OrderInDeck, question: c.Question })) }));
}
it('retirement remains effective after all modules restart', async () => {
  seedActive(); await retireActualDeck();
  await flushDrawHistory(); vi.resetModules();
  const storage = await import('../../src/review/storage'); storage.setActiveUserSubForStorage('user-a');
  const acquisition = await import('../../src/features/gacha/draw/acquireDraw');
  const sync = await import('../../src/sync/drawStateSync');
  await expect(acquisition.acquireDraw(slug, 1, { deck })).rejects.toThrow();
  apiJson.mockResolvedValue(remote(['c1']));
  expect((await sync.syncDrawStateNow('token')).ran).toBe(true);
  expect(store.has(stateKey)).toBe(false);
  expect(JSON.parse(store.get(walletKey)!).decks[slug].availablePulls).toBe(10);
});
it('keeps an installed active snapshot drawable offline without rereading the deck file', async () => {
  seedActive(); const snapshot = await resolveDeckBySlug(slug);
  expect(snapshot?.Slug).toBe(slug);
  const reads = vi.mocked(FileSystem.readAsStringAsync).mock.calls.length;
  globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  expect(uids(await acquireDraw(slug, 1, { deck: snapshot }))).toEqual(['c1']);
  expect(uids(await acquireDraw(slug, 1, { deck: snapshot }))).toEqual(['c2']);
  expect(vi.mocked(FileSystem.readAsStringAsync).mock.calls.length).toBe(reads);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('requires the installed reinstated build and rejects the retained retired build', async () => {
  seedActive(); const retained = deck; await retireActualDeck();
  // A live manifest alone cannot revive the removed install.
  store.set(manifestKey, JSON.stringify({ decks: [{ slug, availability: 'live', version: 'course-2' }] }));
  await expect(acquireDraw(slug, 1, { deck: retained })).rejects.toThrow();
  seedActive('course-2');
  await expect(acquireDraw(slug, 1, { deck: retained })).rejects.toThrow();
  const installed = await resolveDeckBySlug(slug);
  expect(uids(await acquireDraw(slug, 1, { deck: installed }))).toEqual(['c1']);
  apiJson.mockResolvedValue(remote(['c3']));
  expect((await syncDrawStateNow('token')).appliedOwned).toBe(1);
});
it.each(['missing-manifest', 'corrupt-manifest', 'manifest-io', 'missing-entry', 'coming', 'missing-meta', 'corrupt-meta', 'meta-io'])('%s cannot authorize a draw', async mode => {
  seedActive();
  if (mode === 'missing-manifest') store.delete(manifestKey);
  if (mode === 'corrupt-manifest') store.set(manifestKey, '{');
  if (mode === 'missing-entry') store.set(manifestKey, '{"decks":[]}');
  if (mode === 'coming') store.set(manifestKey, JSON.stringify({ decks: [{ slug, availability: 'coming' }] }));
  if (mode === 'missing-meta') store.delete(metaKey);
  if (mode === 'corrupt-meta') store.set(metaKey, '{');
  if (mode.endsWith('-io')) onRead = async key => { if (key === (mode === 'meta-io' ? metaKey : manifestKey)) throw Error('IO'); };
  const beforeState = store.get(stateKey); const beforeWallet = store.get(walletKey); writes.length = 0;
  await expect(acquireDraw(slug, 1, { deck })).rejects.toThrow();
  expect(store.get(stateKey)).toBe(beforeState); expect(store.get(walletKey)).toBe(beforeWallet);
  expect(writes).toEqual([]);
});
it.each(['missing', 'corrupt', 'io'])('unknown manifest (%s) skips sync deck writes', async mode => {
  seedActive();
  if (mode === 'missing') store.delete(manifestKey);
  if (mode === 'corrupt') store.set(manifestKey, '{');
  if (mode === 'io') onRead = async key => { if (key === manifestKey) throw Error('IO'); };
  const beforeState = store.get(stateKey); const beforeWallet = store.get(walletKey);
  apiJson.mockResolvedValue({ success: true, data: { decks: [{ deckSlug: slug, owned: ['c3'], pulls: { availablePulls: 40, reservePulls: 0, updatedAtMs: 10 } }] } });
  expect((await syncDrawStateNow('token')).appliedOwned).toBe(0);
  expect(store.get(stateKey)).toBe(beforeState); expect(store.get(walletKey)).toBe(beforeWallet);
});
it('skips the retired row while still restoring another active deck', async () => {
  await retireActualDeck();
  const manifest = JSON.parse(store.get(manifestKey)!); manifest.decks.push({ slug: 'other', availability: 'live' });
  store.set(manifestKey, JSON.stringify(manifest));
  apiJson.mockResolvedValue({ success: true, data: { decks: [{ deckSlug: slug, owned: ['c1'] }, { deckSlug: 'other', owned: ['o1'] }] } });
  expect((await syncDrawStateNow('token')).appliedOwned).toBe(1);
  expect(store.has(stateKey)).toBe(false);
  expect(JSON.parse(store.get(`${scope}devcards:draw-state:other`)!).owned).toEqual(['o1']);
});
it('does not use another account install or mutate either account after a switch during eligibility', async () => {
  seedActive(); let once = true;
  onRead = async key => { if (key === metaKey && once) { once = false; setActiveUserSubForStorage('user-b'); } };
  const beforeState = store.get(stateKey); const beforeWallet = store.get(walletKey);
  await expect(acquireDraw(slug, 1, { deck })).rejects.toThrow();
  expect(store.get(stateKey)).toBe(beforeState); expect(store.get(walletKey)).toBe(beforeWallet);
  expect(store.has(`devcards:u:user-b:devcards:draw-state:${slug}`)).toBe(false);
  onRead = null;
  await expect(acquireDraw(slug, 1, { deck })).rejects.toThrow();
});
it('does not erase retained progress, history or another deck on a rejected draw or sync', async () => {
  await retireActualDeck();
  const protectedKeys = [progressKey, historyKey, `${scope}devcards:draw-state:other`];
  protectedKeys.forEach(key => store.set(key, 'retained recovery data'));
  await expect(acquireDraw(slug, 1, { deck })).rejects.toThrow();
  apiJson.mockResolvedValue(remote(['c1'])); await syncDrawStateNow('token');
  protectedKeys.forEach(key => expect(store.get(key)).toBe('retained recovery data'));
});
