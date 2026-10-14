// 2026-10-14 three decks: the app shows aws-saa-fundamentals, aws-saa-c03 and claude-ccdv-f, in that
// order, and never csharp-basics, even on a device that still has it installed, active, as its goal
// or in a cached manifest. activeDeck, starterOffline, visibleManifest and domainProgressDeck are
// real here; storage, the repository and the deck cache are stand-ins.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  store: new Map<string, string>(),
  manifest: [] as Array<{ slug: string; title?: string; availability?: string; order?: number }>,
  installed: new Map<string, { Slug: string; Title: string; Version: string; Cards: unknown[] }>(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => (fixtures.store.has(key) ? fixtures.store.get(key)! : null)),
    setItem: vi.fn(async (key: string, value: string) => {
      fixtures.store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      fixtures.store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...fixtures.store.keys()]),
  },
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => fixtures.manifest.map((entry) => ({ ...entry }))),
  checkManifestForUpdates: vi.fn(async () => ({})),
}));

vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: vi.fn(async (slug: string) => fixtures.installed.get(slug) ?? null),
  installDeckAndInvalidate: vi.fn(async () => false),
}));

import {
  DECK_ORDER,
  FIRST_DECK_SLUG,
  HIDDEN_DECK_SLUGS,
  compareByDeckOrder,
  deckOrderRank,
  isHiddenDeck,
  sortByDeckOrder,
  visibleDeckSlug,
  withoutHiddenDecks,
} from '../../src/content/hiddenDecks';
import { getActiveDeckSlugSync, loadActiveDeckSlug, setActiveDeckSlug } from '../../src/content/activeDeck';
import { STARTER_PACKS } from '../../src/content/starter';
import { ensureStarterDeckInstalled, hasStarterPack, listInstalledDeckEntries } from '../../src/content/starterOffline';
import { listVisibleManifestDecks } from '../../src/content/visibleManifest';
import { resolveDomainProgressSlug } from '../../src/features/domains/domainProgressDeck';

const ACTIVE_DECK_KEY = 'active-deck-slug';
const META_PREFIX = 'devcards:content:deckmeta:v2:anon:';
const THREE = ['aws-saa-fundamentals', 'aws-saa-c03', 'claude-ccdv-f'];

function install(slug: string) {
  fixtures.store.set(`${META_PREFIX}${slug}`, JSON.stringify({ slug, buildId: 'b1' }));
  fixtures.installed.set(slug, { Slug: slug, Title: slug, Version: 'b1', Cards: [{ StableUid: `${slug}-1` }] });
}

describe('hidden decks policy', () => {
  it('hides exactly csharp-basics and orders the decks fundamentals, SAA-C03, Claude', () => {
    expect(HIDDEN_DECK_SLUGS).toEqual(['csharp-basics']);
    expect(DECK_ORDER).toEqual(THREE);
    // The first deck is where a learner whose deck is hidden lands; no ordered deck is hidden.
    expect(FIRST_DECK_SLUG).toBe('aws-saa-fundamentals');
    for (const slug of DECK_ORDER) expect(isHiddenDeck(slug)).toBe(false);
    expect(deckOrderRank('aws-saa-fundamentals')).toBe(0);
    expect(deckOrderRank('claude-ccdv-f')).toBe(2);
    expect(deckOrderRank('zeta-deck')).toBe(3);
    expect(isHiddenDeck('csharp-basics')).toBe(true);
    expect(isHiddenDeck(' csharp-basics ')).toBe(true);
    for (const slug of THREE) expect(isHiddenDeck(slug)).toBe(false);
    expect(isHiddenDeck(null)).toBe(false);
  });

  it('reads a hidden or empty slug as no deck', () => {
    expect(visibleDeckSlug('csharp-basics')).toBeNull();
    expect(visibleDeckSlug('')).toBeNull();
    expect(visibleDeckSlug(undefined)).toBeNull();
    expect(visibleDeckSlug('aws-saa-c03')).toBe('aws-saa-c03');
  });

  it('drops hidden entries and keeps the order of the rest', () => {
    const list = [{ slug: 'claude-ccdv-f' }, { slug: 'csharp-basics' }, { slug: 'aws-saa-c03' }];
    expect(withoutHiddenDecks(list).map((d) => d.slug)).toEqual(['claude-ccdv-f', 'aws-saa-c03']);
  });

  it('sorts the three decks first in the owner order, then any other deck by slug (not alphabetically overall)', () => {
    const slugs = ['zeta-deck', 'claude-ccdv-f', 'aws-saa-c03', 'alpha-deck', 'aws-saa-fundamentals'];
    expect(slugs.map((slug) => ({ slug })).sort(compareByDeckOrder).map((d) => d.slug)).toEqual([
      'aws-saa-fundamentals',
      'aws-saa-c03',
      'claude-ccdv-f',
      'alpha-deck',
      'zeta-deck',
    ]);
  });

  it('orders a manifest list by the owner order, keeping the manifest order of any other deck', () => {
    const list = ['zeta-deck', 'claude-ccdv-f', 'alpha-deck', 'aws-saa-c03', 'aws-saa-fundamentals'].map((slug) => ({ slug }));
    expect(sortByDeckOrder(list).map((d) => d.slug)).toEqual([
      'aws-saa-fundamentals',
      'aws-saa-c03',
      'claude-ccdv-f',
      'zeta-deck',
      'alpha-deck',
    ]);
    // A copy: the input keeps its order.
    expect(list.map((d) => d.slug)).toEqual(['zeta-deck', 'claude-ccdv-f', 'alpha-deck', 'aws-saa-c03', 'aws-saa-fundamentals']);
  });

  it('ships no starter pack for a hidden deck, so an offline first run can never install one', async () => {
    for (const slug of HIDDEN_DECK_SLUGS) {
      expect(Object.keys(STARTER_PACKS)).not.toContain(slug);
      expect(hasStarterPack(slug)).toBe(false);
      expect(await ensureStarterDeckInstalled(slug)).toBe('unavailable');
    }
    // Fundamentals has no pack either (accepted): its offline first run waits for the network.
    expect(hasStarterPack('aws-saa-fundamentals')).toBe(false);
  });
});

describe('a device that still has csharp-basics', () => {
  beforeEach(async () => {
    fixtures.store.clear();
    fixtures.installed.clear();
    fixtures.manifest = [];
    // activeDeck keeps the slug in memory; clear it, then the storage write it made.
    await setActiveDeckSlug(null);
  });

  it('reads a stored csharp-basics active deck as none, and keeps the stored value', async () => {
    fixtures.store.set(ACTIVE_DECK_KEY, 'csharp-basics');
    expect(await loadActiveDeckSlug()).toBeNull();
    expect(getActiveDeckSlugSync()).toBeNull();
    expect(fixtures.store.get(ACTIVE_DECK_KEY)).toBe('csharp-basics');

    await setActiveDeckSlug('csharp-basics');
    expect(await loadActiveDeckSlug()).toBeNull();

    await setActiveDeckSlug('claude-ccdv-f');
    expect(await loadActiveDeckSlug()).toBe('claude-ccdv-f');
    expect(getActiveDeckSlugSync()).toBe('claude-ccdv-f');
  });

  it('lists the manifest without csharp-basics, in the owner order (a cached manifest can still name it)', async () => {
    fixtures.manifest = [
      { slug: 'csharp-basics', availability: 'live' },
      { slug: 'aws-saa-fundamentals', availability: 'live' },
      { slug: 'aws-saa-c03', availability: 'live' },
      { slug: 'claude-ccdv-f', availability: 'live' },
    ];
    expect((await listVisibleManifestDecks()).map((d) => d.slug)).toEqual(THREE);

    // The owner order holds whatever order the server lists the decks in.
    fixtures.manifest = [{ slug: 'claude-ccdv-f' }, { slug: 'csharp-basics' }, { slug: 'aws-saa-c03' }];
    expect((await listVisibleManifestDecks({ preferRemote: true })).map((d) => d.slug)).toEqual([
      'aws-saa-c03',
      'claude-ccdv-f',
    ]);
  });

  it("orders today's live manifest (SAA-C03 listed ahead of fundamentals, both at 1000) fundamentals, SAA-C03, Claude", async () => {
    // The shape of manifest.json before the console sets manifest_order 10/20/30 and drops csharp-basics.
    fixtures.manifest = [
      { slug: 'csharp-basics', order: 1 },
      { slug: 'aws-saa-c03', order: 1000 },
      { slug: 'aws-saa-fundamentals', order: 1000 },
      { slug: 'claude-ccdv-f', order: 1100 },
    ];
    expect((await listVisibleManifestDecks()).map((d) => d.slug)).toEqual(THREE);
    // And after it, with a deck the app does not name yet: that deck goes after the three.
    fixtures.manifest = [
      { slug: 'new-deck', order: 5 },
      { slug: 'aws-saa-fundamentals', order: 10 },
      { slug: 'aws-saa-c03', order: 20 },
      { slug: 'claude-ccdv-f', order: 30 },
    ];
    expect((await listVisibleManifestDecks()).map((d) => d.slug)).toEqual([...THREE, 'new-deck']);
  });

  it('leaves csharp-basics off the offline shelf and orders the installed decks fundamentals, SAA-C03, Claude', async () => {
    for (const slug of ['csharp-basics', 'claude-ccdv-f', 'aws-saa-c03', 'aws-saa-fundamentals']) install(slug);
    expect((await listInstalledDeckEntries()).map((e) => e.slug)).toEqual(THREE);
    // Hidden, not deleted.
    expect(fixtures.store.has(`${META_PREFIX}csharp-basics`)).toBe(true);
  });

  it('opens More › Progress by domain on the first visible installed deck, not an active csharp-basics', async () => {
    for (const slug of ['csharp-basics', 'claude-ccdv-f', 'aws-saa-fundamentals']) install(slug);
    fixtures.store.set(ACTIVE_DECK_KEY, 'csharp-basics');
    expect(await resolveDomainProgressSlug()).toBe('aws-saa-fundamentals');

    // With only csharp-basics installed there is nothing to show: the row stays hidden.
    fixtures.installed.clear();
    fixtures.store.clear();
    await setActiveDeckSlug(null);
    install('csharp-basics');
    fixtures.store.set(ACTIVE_DECK_KEY, 'csharp-basics');
    expect(await resolveDomainProgressSlug()).toBeNull();
  });
});
