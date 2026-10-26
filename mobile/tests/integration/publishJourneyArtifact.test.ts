import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// This suite consumes ONLY the successful producer run's exact objects. Native IO/auth are adapters.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTENT_BASE_URL = 'https://cdn.invalid';
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.invalid';
});
const store = new Map<string, string>();
const files = new Map<string, string>();
const dirs = new Set<string>();
const requests: string[] = [];
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => store.get(key) ?? null,
  setItem: async (key: string, value: string) => { store.set(key, value); },
  removeItem: async (key: string) => { store.delete(key); },
  getAllKeys: async () => [...store.keys()],
  multiRemove: async (keys: string[]) => { for (const key of keys) store.delete(key); },
} }));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///journey/', EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: async (uri: string) => {
    if (!files.has(uri)) throw new Error(`ENOENT ${uri}`);
    return files.get(uri)!;
  },
  writeAsStringAsync: async (uri: string, text: string) => { files.set(uri, text); },
  deleteAsync: async (uri: string) => {
    files.delete(uri);
    for (const key of files.keys()) if (key.startsWith(`${uri.replace(/\/$/, '')}/`)) files.delete(key);
    dirs.delete(uri);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    if (!files.has(from)) throw new Error(`ENOENT ${from}`);
    files.set(to, files.get(from)!);
    files.delete(from);
  },
  getInfoAsync: async (uri: string) => ({ exists: files.has(uri) || dirs.has(uri), isDirectory: dirs.has(uri), uri }),
  makeDirectoryAsync: async (uri: string) => { dirs.add(uri); },
  readDirectoryAsync: async (uri: string) => [...files.keys()].filter(k => k.startsWith(uri)).map(k => k.slice(uri.length)),
  downloadAsync: async (url: string, uri: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download_failed_http_${response.status}`);
    files.set(uri, await response.text());
    return { status: response.status, uri };
  },
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, text: string) => sha(text),
}));
vi.mock('aws-amplify/auth', () => ({ fetchAuthSession: async () => ({ userSub: 'journey-user' }) }));
vi.mock('../../src/premium/premiumStore', () => ({ getIsPremiumUser: async () => false }));

type Artifact = {
  slug: string; buildId: string; jobId: string; question: string; explanation: string; stableUid: string;
  objects: Record<string, string>;
};
let artifact: Artifact;
let corrupt = false;
let packageUnavailable = false;
const artifactPath = process.env.RECALLSMITH_JOURNEY_ARTIFACT;

// Normal mobile suites need no .NET producer. The journey runner requires a fresh handoff before invoking Vitest.
describe.skipIf(!artifactPath)('same-run publish artifact → actual mobile importer (native adapters)', () => {
  beforeEach(() => {
    artifact = JSON.parse(readFileSync(artifactPath!, 'utf8')) as Artifact;
    store.clear(); files.clear(); dirs.clear(); requests.length = 0;
    corrupt = false; packageUnavailable = false;
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      if (parsed.origin !== 'https://cdn.invalid') throw new Error(`Unexpected external request: ${parsed.origin}`);
      const key = parsed.pathname.slice(1);
      requests.push(key);
      let text = artifact.objects[key];
      if (packageUnavailable && key.endsWith('/package.json')) return new Response(null, { status: 404 });
      if (text == null) throw new Error(`Missing producer object: ${key}`);
      if (corrupt && (key.endsWith('/deck.json') || key.includes('/chunks/'))) text += ' ';
      return new Response(text, { status: 200, headers: { 'content-type': 'application/json', etag: sha(text) } });
    }));
  });

  async function install() {
    const repo = await import('../../src/content/deckRepository');
    const update = (await repo.checkManifestForUpdates())[artifact.slug];
    expect(update.hasUpdate).toBe(true);
    expect(update.remoteVersion).toBe(artifact.buildId);
    expect(update.remoteSha256).toMatch(/^[a-f0-9]{64}$/);
    const ok = await repo.installDeckFromUrl(artifact.slug, update.remoteUrl!, update.remoteVersion, update.remoteSha256);
    return { repo, ok };
  }

  async function assertInstalled(repo: Awaited<ReturnType<typeof install>>['repo']) {
    const metaKey = `devcards:content:deckmeta:v2:journey-user:${artifact.slug}`;
    const meta = JSON.parse(store.get(metaKey)!);
    expect(meta.buildId).toBe(artifact.buildId);
    expect(meta.cardCount).toBe(1);
    expect(files.has(meta.fileUri)).toBe(true);
    const deck = await repo.resolveDeckBySlug(artifact.slug);
    expect(deck!.Cards).toHaveLength(1);
    expect(deck!.Cards[0]).toMatchObject({
      StableUid: artifact.stableUid, Question: artifact.question, Explanation: artifact.explanation, Topic: 'Messaging',
    });
  }

  it('downloads the real manifest/package/chunk and installs the edited card', async () => {
    const { repo, ok } = await install();
    expect(ok).toBe(true);
    expect(requests).toContain('content/manifest.json');
    expect(requests.some(k => k.endsWith('/package.json'))).toBe(true);
    expect(requests.some(k => k.includes('/chunks/'))).toBe(true);
    expect(requests.some(k => k.endsWith('/deck.json'))).toBe(false);
    await assertInstalled(repo);
  });

  it('falls back from unavailable package to the exact full deck and checks its hash', async () => {
    packageUnavailable = true;
    const { repo, ok } = await install();
    expect(ok).toBe(true);
    expect(requests.some(k => k.endsWith('/deck.json'))).toBe(true);
    await assertInstalled(repo);
    const meta = JSON.parse(store.get(`devcards:content:deckmeta:v2:journey-user:${artifact.slug}`)!);
    expect(files.get(meta.fileUri)).toBe(artifact.objects[requests.find(k => k.endsWith('/deck.json'))!]);
  });

  it('rejects corrupted chunk and full downloads without persisting an install', async () => {
    corrupt = true;
    const warning = vi.spyOn(console, 'warn');
    try {
      const { ok } = await install();
      expect(ok).toBe(false);
      expect(requests.some(k => k.includes('/chunks/'))).toBe(true);
      expect(requests.some(k => k.endsWith('/deck.json'))).toBe(true);
      expect(warning).toHaveBeenCalledWith('[installDeckFromUrl] fail', expect.objectContaining({ reason: 'sha256_mismatch' }));
      expect([...store.keys()].some(k => k.startsWith('devcards:content:deckmeta:'))).toBe(false);
      expect([...files.keys()].some(k => k.endsWith(`/${artifact.slug}.json`))).toBe(false);
      expect([...files.keys()].some(k => k.includes('.tmp'))).toBe(false);
    } finally {
      warning.mockRestore();
    }
  });
});
