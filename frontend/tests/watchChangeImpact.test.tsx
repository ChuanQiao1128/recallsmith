// @vitest-environment jsdom
//
// R20 V10: change impact on the Automation Watch tab (contract §6). An event
// may list its affected cards (question linked to the editor, "Quote missing"
// badge) and carry "Needs review"; "Recent release notes" lists feed items with
// the cards they may touch. Every field is optional: a server that predates
// them sends none and the tab is exactly what it was. The page-level half mocks
// fetchWatch; the normaliser half replaces the http adapter, so nothing here
// can leave the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { ok } from './support/apiResult';
import { watchEventFixture, watchPageFixture } from './support/automationFixtures';
import type { WatchPage } from '../src/api/automation';

const automation = vi.hoisted(() => ({ fetchWatch: vi.fn() }));

vi.mock('../src/api/automation', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/automation')>();
  return { ...actual, ...automation };
});

const { WatchTab } = await import('../src/features/automation/WatchTab');
const automationActual = await vi.importActual<typeof import('../src/api/automation')>('../src/api/automation');
const { http } = await import('../src/api/http');

const CHANGED = watchEventFixture({
  eventId: 21,
  kind: 'changed',
  url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html',
  affectedCards: [
    {
      cardId: 1203,
      deckId: 7,
      deckSlug: 'aws-saa-c03',
      stableUid: 'aws-saa-c03-0042',
      question: 'Which S3 storage class suits infrequent access?',
      quoteMissing: true,
    },
    {
      cardId: 1204,
      deckId: 7,
      deckSlug: 'aws-saa-c03',
      stableUid: 'aws-saa-c03-0043',
      question: 'What is S3 Glacier Instant Retrieval?',
      quoteMissing: false,
    },
  ],
  needsHumanReview: true,
});

async function mount(page: WatchPage) {
  automation.fetchWatch.mockResolvedValue(ok(page));
  render(
    <MemoryRouter initialEntries={['/automation?tab=watch']}>
      <WatchTab superAdmin={false} targetId={null} announce={() => {}} />
    </MemoryRouter>,
  );
  await screen.findByRole('region', { name: 'Recent watch events' });
  await screen.findAllByText(/feed\/$/);
}

const originalAdapter = http.defaults.adapter;

beforeEach(() => {
  automation.fetchWatch.mockReset();
});

afterEach(() => {
  cleanup();
  http.defaults.adapter = originalAdapter;
});

describe('change impact on the Watch tab', () => {
  it('lists each affected card with its editor link and the Quote missing badge', async () => {
    await mount(watchPageFixture({ recentEvents: [CHANGED, watchEventFixture()] }));
    const list = screen.getByTestId('automation-watch-affected-21');
    expect(within(list).getByText('Affected cards (2)')).toBeTruthy();
    const link = within(list).getByRole('link', {
      name: 'Open in editor: Which S3 storage class suits infrequent access?',
    });
    expect(link.getAttribute('href')).toBe('/decks/cards/edit?deckId=7&cardId=1203');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Quote missing')).toBeTruthy();
    expect(within(items[1]).queryByText('Quote missing')).toBeNull();
    // Only the event that has affected cards gets a list.
    expect(screen.queryByTestId('automation-watch-affected-9')).toBeNull();
  });

  it('marks an event that needs a person with a Needs review badge', async () => {
    await mount(watchPageFixture({ recentEvents: [CHANGED, watchEventFixture({ needsHumanReview: false })] }));
    const events = screen.getByRole('region', { name: 'Recent watch events' });
    expect(within(events).getAllByText('Needs review')).toHaveLength(1);
  });

  it('lists recent release notes with the cards they may touch', async () => {
    await mount(
      watchPageFixture({
        recentFeedItems: [
          {
            id: 88,
            title: 'Amazon S3 adds a storage class',
            url: 'https://aws.amazon.com/about-aws/whats-new/2026/09/s3-class/',
            firstSeenAt: '2026-09-29T08:00:00Z',
            possiblyAffectedCards: [
              { cardId: 1203, deckId: 7, deckSlug: 'aws-saa-c03', stableUid: 'aws-saa-c03-0042', question: 'Which S3 storage class suits infrequent access?', rank: 0.4 },
            ],
          },
          { id: 89, title: 'EC2 news', url: '', firstSeenAt: null, possiblyAffectedCards: [] },
        ],
      }),
    );
    const section = screen.getByRole('region', { name: 'Recent release notes' });
    const first = within(section).getByTestId('automation-watch-feed-item-88');
    expect(within(first).getByRole('link', { name: 'Amazon S3 adds a storage class' }).getAttribute('href')).toBe(
      'https://aws.amazon.com/about-aws/whats-new/2026/09/s3-class/',
    );
    expect(first.textContent).toContain('First seen 2026-09-29 08:00 UTC');
    expect(
      within(first)
        .getByRole('link', { name: 'Open in editor: Which S3 storage class suits infrequent access?' })
        .getAttribute('href'),
    ).toBe('/decks/cards/edit?deckId=7&cardId=1203');
    expect(within(section).getByTestId('automation-watch-feed-item-89').textContent).toContain(
      'No card matched this item.',
    );
  });

  it('is the current tab when the server sends none of the fields', async () => {
    await mount(watchPageFixture());
    expect(screen.queryByText(/^Affected cards/)).toBeNull();
    expect(screen.queryByText('Needs review')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Recent release notes' })).toBeNull();
    const events = screen.getByRole('region', { name: 'Recent watch events' });
    // One header row and one event row: no extra row per event.
    expect(within(events).getAllByRole('row')).toHaveLength(2);
  });
});

describe('the watch normaliser', () => {
  function serve(data: unknown) {
    http.defaults.adapter = async (config: InternalAxiosRequestConfig) =>
      ({ data, status: 200, statusText: 'OK', headers: {}, config }) as AxiosResponse;
  }

  const base = { eventId: 5, targetId: 3, url: 'https://x.example.com/a', kind: 'changed', recheckRunIds: [], queueItemIds: [] };

  it('reads the impact keys from the event, falling back to details, and keeps them absent otherwise', async () => {
    serve(
      ok({
        items: [],
        recentEvents: [
          {
            ...base,
            affectedCards: [
              { cardId: '11', deckId: 7, deckSlug: 'aws-saa-c03', stableUid: 'u-11', question: 'Q?', quoteMissing: true },
              { cardId: null, question: 'no id' },
            ],
            needsHumanReview: true,
          },
          {
            ...base,
            eventId: 6,
            details: { affectedCards: [{ cardId: 12, deckId: null, stableUid: 'u-12', question: 'R?' }], needsHumanReview: false },
          },
          { ...base, eventId: 7, details: { diff: 'x' } },
        ],
        recentFeedItems: [
          {
            id: '40',
            title: 'T',
            url: 'https://x.example.com/n',
            firstSeenAt: '2026-09-29T08:00:00Z',
            possiblyAffectedCards: [1, 2, 3, 4, 5, 6].map(n => ({ cardId: n, deckId: 7, stableUid: `u-${n}`, question: `Q${n}`, rank: '0.1' })),
          },
          { title: 'no id' },
        ],
        nextCursor: null,
      }),
    );
    const res = await automationActual.fetchWatch();
    const [top, fromDetails, none] = res.data?.recentEvents ?? [];
    expect(top.affectedCards).toEqual([
      { cardId: 11, deckId: 7, deckSlug: 'aws-saa-c03', stableUid: 'u-11', question: 'Q?', quoteMissing: true },
    ]);
    expect(top.needsHumanReview).toBe(true);
    expect(fromDetails.affectedCards).toEqual([
      { cardId: 12, deckId: null, deckSlug: null, stableUid: 'u-12', question: 'R?', quoteMissing: false },
    ]);
    expect(fromDetails.needsHumanReview).toBe(false);
    expect('affectedCards' in none).toBe(false);
    expect('needsHumanReview' in none).toBe(false);

    const feed = res.data?.recentFeedItems ?? [];
    expect(feed).toHaveLength(1);
    expect(feed[0].id).toBe(40);
    // The contract's top 5.
    expect(feed[0].possiblyAffectedCards.map(c => c.cardId)).toEqual([1, 2, 3, 4, 5]);
    expect(feed[0].possiblyAffectedCards[0].rank).toBe(0.1);
  });

  it('leaves recentFeedItems out on an older server', async () => {
    serve(ok({ items: [], recentEvents: [], nextCursor: null }));
    const res = await automationActual.fetchWatch();
    expect(res.data && 'recentFeedItems' in res.data).toBe(false);
  });

  it('has no editor link for a card whose deck is unknown', () => {
    expect(automationActual.watchCardEditorHref({ deckId: null, cardId: 3 })).toBeNull();
    expect(automationActual.watchCardEditorHref({ deckId: 7, cardId: 3 })).toBe('/decks/cards/edit?deckId=7&cardId=3');
  });
});
