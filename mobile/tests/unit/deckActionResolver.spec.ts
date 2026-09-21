import { beforeEach, describe, expect, it, vi } from 'vitest';

const setActiveDeckSlugMock = vi.fn(async (_slug: string) => {});
const loadActiveDeckSlugMock = vi.fn(async () => null);
const checkManifestForUpdatesMock = vi.fn(async (_premium: boolean) => ({}));
const listManifestDecksMock = vi.fn(async () => []);
const resolveDeckBySlugMock = vi.fn(async (_slug: string) => null);
const installDeckFromUrlMock = vi.fn(
  async (
    _slug: string,
    _url: string,
    _remoteVersion: string | null,
    _remoteSha256: string | null,
  ) => true,
);

vi.mock('../../src/content/activeDeck', () => ({
  setActiveDeckSlug: (slug: string) => setActiveDeckSlugMock(slug),
  loadActiveDeckSlug: () => loadActiveDeckSlugMock(),
}));

vi.mock('../../src/content/deckRepository', () => ({
  checkManifestForUpdates: (premium: boolean) => checkManifestForUpdatesMock(premium),
  listManifestDecks: () => listManifestDecksMock(),
  resolveDeckBySlug: (slug: string) => resolveDeckBySlugMock(slug),
  installDeckFromUrl: (
    slug: string,
    url: string,
    remoteVersion: string | null,
    remoteSha256: string | null,
  ) => installDeckFromUrlMock(slug, url, remoteVersion, remoteSha256),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
}));

vi.mock('../../src/sync/progressSync', () => ({
  applyCachedRemoteProgress: vi.fn(async () => {}),
}));

vi.mock('../../src/notifications/reminders', () => ({
  syncDailyReminders: vi.fn(async () => {}),
}));

import {
  autoApplyFreeDeckUpdates,
  executeDeckAction,
  hasAutoUpdateBeenAttempted,
  loadDeckUpdates,
  resetAutoUpdateAttemptsForTests,
  resolveDeckAction,
  selectAutoUpdateCandidates,
} from '../../src/features/gacha/home/deckActionResolver';

function makeDeck(overrides: Record<string, any> = {}) {
  return {
    slug: 'csharp',
    title: 'C# Interview',
    locale: 'en-US',
    version: '1',
    deckType: 1,
    totalCards: 20,
    localCards: 20,
    studyCards: 20,
    canStudy: true,
    dueToday: 2,
    plannedToday: 2,
    newToday: 1,
    masteredApprox: 5,
    percent: 0.25,
    ...overrides,
  };
}

describe('deckActionResolver', () => {
  beforeEach(() => {
    setActiveDeckSlugMock.mockClear();
    loadActiveDeckSlugMock.mockClear();
    checkManifestForUpdatesMock.mockClear();
    listManifestDecksMock.mockClear();
    resolveDeckBySlugMock.mockClear();
    installDeckFromUrlMock.mockClear();
  });

  it('resolves open action for study-ready deck', async () => {
    const action = await resolveDeckAction({
      deck: makeDeck(),
      premium: true,
      signedIn: true,
      updates: {},
    });

    expect(action.kind).toBe('open');
  });

  it('resolves install action for free deck needing install', async () => {
    const action = await resolveDeckAction({
      deck: makeDeck({ canStudy: false }),
      premium: false,
      signedIn: false,
      updates: {
        csharp: {
          slug: 'csharp',
          installedVersion: null,
          remoteVersion: '2',
          hasUpdate: true,
          remoteUrl: 'https://example.com/deck.json',
          remoteSha256: null,
        },
      },
    });

    expect(action.kind).toBe('install');
  });

  it('resolves update action for installed deck with update', async () => {
    const action = await resolveDeckAction({
      deck: makeDeck(),
      premium: false,
      signedIn: false,
      updates: {
        csharp: {
          slug: 'csharp',
          installedVersion: '1',
          remoteVersion: '2',
          hasUpdate: true,
          remoteUrl: 'https://example.com/deck-v2.json',
          remoteSha256: 'abc',
        },
      },
    });

    expect(action.kind).toBe('update');
  });

  it('resolves trial-start for signed-in non-premium premium deck', async () => {
    const action = await resolveDeckAction({
      deck: makeDeck({ deckType: 2, canStudy: false }),
      premium: false,
      signedIn: true,
      updates: {
        csharp: {
          slug: 'csharp',
          installedVersion: null,
          remoteVersion: 'preview-1',
          hasUpdate: true,
          remoteUrl: 'https://example.com/preview.json',
          remoteSha256: null,
        },
      },
    });

    expect(action.kind).toBe('trial-start');
  });

  it('resolves paywall for signed-out non-premium premium deck', async () => {
    const action = await resolveDeckAction({
      deck: makeDeck({ deckType: 2, canStudy: false }),
      premium: false,
      signedIn: false,
      updates: {
        csharp: {
          slug: 'csharp',
          installedVersion: null,
          remoteVersion: 'preview-1',
          hasUpdate: true,
          remoteUrl: 'https://example.com/preview.json',
          remoteSha256: null,
        },
      },
    });

    expect(action.kind).toBe('paywall');
  });

  it('executes install/update actions via installDeckFromUrl and sets active slug', async () => {
    await executeDeckAction({
      kind: 'install',
      slug: 'csharp',
      remoteUrl: 'https://example.com/deck.json',
      remoteVersion: '2',
      remoteSha256: null,
    });

    expect(installDeckFromUrlMock).toHaveBeenCalledWith(
      'csharp',
      'https://example.com/deck.json',
      '2',
      null,
    );
    expect(setActiveDeckSlugMock).toHaveBeenCalledWith('csharp');
  });

  it('loads update map through checkManifestForUpdates', async () => {
    checkManifestForUpdatesMock.mockResolvedValueOnce({ csharp: { slug: 'csharp' } });
    const updates = await loadDeckUpdates(true);
    expect(checkManifestForUpdatesMock).toHaveBeenCalledWith(true);
    expect(updates).toEqual({ csharp: { slug: 'csharp' } });
  });
});

describe('free-deck auto-update', () => {
  beforeEach(() => {
    setActiveDeckSlugMock.mockClear();
    installDeckFromUrlMock.mockReset();
    installDeckFromUrlMock.mockResolvedValue(true);
    resetAutoUpdateAttemptsForTests();
  });

  const STALE = {
    csharp: {
      slug: 'csharp',
      installedVersion: '20260816',
      remoteVersion: '20260921',
      hasUpdate: true,
      remoteUrl: 'https://example.com/csharp/20260921/deck.json',
      remoteSha256: 'sha-abc',
    },
  };

  it('selects an installed, live, free deck whose manifest build differs from the installed one', () => {
    const candidates = selectAutoUpdateCandidates({
      deckSummaries: [makeDeck() as any],
      updates: STALE,
    });

    expect(candidates).toEqual([
      {
        slug: 'csharp',
        remoteUrl: 'https://example.com/csharp/20260921/deck.json',
        remoteVersion: '20260921',
        remoteSha256: 'sha-abc',
      },
    ]);
  });

  it.each([
    ['not installed yet (that is the Install flow)', { canStudy: false, localCards: 0 }, STALE],
    ['premium by deckType', { deckType: 2 }, STALE],
    ['premium by tier', { tier: 'premium' }, STALE],
    ['coming soon', { availability: 'coming' }, STALE],
    ['already on the manifest build', {}, { csharp: { ...STALE.csharp, installedVersion: '20260921', hasUpdate: false } }],
    ['same build even if hasUpdate is set', {}, { csharp: { ...STALE.csharp, installedVersion: '20260921' } }],
    ['no url to install from', {}, { csharp: { ...STALE.csharp, remoteUrl: null } }],
    ['no remote version', {}, { csharp: { ...STALE.csharp, remoteVersion: null } }],
    ['no update entry at all', {}, {}],
  ])('skips a deck that is %s', (_label, overrides, updates) => {
    expect(
      selectAutoUpdateCandidates({ deckSummaries: [makeDeck(overrides) as any], updates: updates as any }),
    ).toEqual([]);
  });

  it('runs the idempotent installer once per slug per session and never moves the active deck', async () => {
    const first = autoApplyFreeDeckUpdates({ deckSummaries: [makeDeck() as any], updates: STALE });
    expect(first.map((run) => run.slug)).toEqual(['csharp']);
    expect(hasAutoUpdateBeenAttempted('csharp')).toBe(true);
    await expect(first[0].done).resolves.toBe(true);

    expect(installDeckFromUrlMock).toHaveBeenCalledTimes(1);
    expect(installDeckFromUrlMock).toHaveBeenCalledWith(
      'csharp',
      'https://example.com/csharp/20260921/deck.json',
      '20260921',
      'sha-abc',
    );
    expect(setActiveDeckSlugMock).not.toHaveBeenCalled();

    // The next Home load in the same session sees the same stale manifest
    // (say the download failed) and must not start a second attempt.
    const second = autoApplyFreeDeckUpdates({ deckSummaries: [makeDeck() as any], updates: STALE });
    expect(second).toEqual([]);
    expect(installDeckFromUrlMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failed or throwing install as false so Home can fall back to the chip', async () => {
    installDeckFromUrlMock.mockResolvedValueOnce(false);
    const failed = autoApplyFreeDeckUpdates({ deckSummaries: [makeDeck() as any], updates: STALE });
    await expect(failed[0].done).resolves.toBe(false);

    resetAutoUpdateAttemptsForTests();
    installDeckFromUrlMock.mockRejectedValueOnce(new Error('offline'));
    const threw = autoApplyFreeDeckUpdates({ deckSummaries: [makeDeck() as any], updates: STALE });
    await expect(threw[0].done).resolves.toBe(false);
    expect(hasAutoUpdateBeenAttempted('csharp')).toBe(true);
  });

  it('starts one run per stale free deck and leaves the others alone', async () => {
    const runs = autoApplyFreeDeckUpdates({
      deckSummaries: [
        makeDeck({ slug: 'csharp' }) as any,
        makeDeck({ slug: 'aws' }) as any,
        makeDeck({ slug: 'pro', deckType: 2 }) as any,
      ],
      updates: {
        ...STALE,
        aws: { ...STALE.csharp, slug: 'aws', remoteUrl: 'https://example.com/aws.json' },
        pro: { ...STALE.csharp, slug: 'pro', remoteUrl: 'https://example.com/pro-preview.json' },
      },
    });

    expect(runs.map((run) => run.slug)).toEqual(['csharp', 'aws']);
    await Promise.all(runs.map((run) => run.done));
    expect(installDeckFromUrlMock.mock.calls.map((call) => call[0])).toEqual(['csharp', 'aws']);
  });
});
