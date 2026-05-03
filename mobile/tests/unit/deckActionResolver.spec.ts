import { beforeEach, describe, expect, it, vi } from 'vitest';

const setActiveDeckSlugMock = vi.fn(async (_slug: string) => {});
const loadActiveDeckSlugMock = vi.fn(async () => null);
const checkManifestForUpdatesMock = vi.fn(async (_premium: boolean) => ({}));
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
  installDeckFromUrl: (
    slug: string,
    url: string,
    remoteVersion: string | null,
    remoteSha256: string | null,
  ) => installDeckFromUrlMock(slug, url, remoteVersion, remoteSha256),
}));

import {
  executeDeckAction,
  loadDeckUpdates,
  resolveDeckAction,
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
