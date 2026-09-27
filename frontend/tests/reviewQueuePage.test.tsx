// @vitest-environment jsdom
//
// The /review console page (R18 contract §8.3). src/api/drafts and the two
// src/api/authoring reads are mocked, so nothing here can leave the process;
// the session is a real token through tests/support/consoleSession. Date.now
// is faked so reviewMs is an exact, asserted number.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { deferred, ok, refused } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { draft, draftSummary, mcqDraftCard, qaDraftCard } from './support/draftFixtures';
import { renderAt } from './support/routerProbe';
import { ConsoleShell } from '../src/components/console/ConsoleShell';
import { documentTitleFor } from '../src/lib/brand';
import type { ApiResult } from '../src/types/api';
import type { Deck } from '../src/types/deck';
import type { DraftAcceptResult, SimilarCardMatch } from '../src/types/draft';

const api = vi.hoisted(() => ({
  listDrafts: vi.fn(),
  fetchDraft: vi.fn(),
  acceptDraft: vi.fn(),
  rejectDraft: vi.fn(),
}));

const authoring = vi.hoisted(() => ({
  fetchDecks: vi.fn(),
  fetchDeckById: vi.fn(),
}));

vi.mock('../src/api/drafts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/drafts')>();
  return { ...actual, ...api };
});

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...authoring };
});

const { ReviewQueuePage } = await import('../src/pages/ReviewQueuePage');

const DECK: Deck = {
  id: 7,
  slug: 'aws-saa-c03',
  title: 'AWS Solutions Architect Associate',
  author: 'DeveloperCards',
  locale: 'en',
  deckType: 0,
  version: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const MATCH: SimilarCardMatch = {
  cardId: 312,
  deckId: 7,
  deckSlug: 'aws-saa-c03',
  stableUid: 'aws-s3-storage-classes',
  question:
    'An application writes logs to S3 that are read often for 30 days and almost never afterwards, but must be kept for 7 years. Which storage classes and mechanism fit?',
  similarity: 0.874,
  likelyDuplicate: true,
};

let now = 1_000;

beforeEach(() => {
  signInAsSuperAdmin();
  now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  authoring.fetchDecks.mockResolvedValue(ok([DECK]));
  authoring.fetchDeckById.mockResolvedValue(ok(DECK));
  api.listDrafts.mockResolvedValue(ok({ items: [draftSummary()], nextCursor: null }));
  api.fetchDraft.mockResolvedValue(ok(draft(qaDraftCard())));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const fn of [...Object.values(api), ...Object.values(authoring)]) fn.mockReset();
  signOut();
});

async function openReview() {
  renderAt(<ReviewQueuePage />, ['/review?deckId=7']);
  await screen.findByRole('region', { name: 'Draft card' });
}

describe('ReviewQueuePage', () => {
  it('offers a deck picker when no deckId is given', async () => {
    renderAt(<ReviewQueuePage />, ['/review']);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Review queue');
    expect(screen.getByText('Choose a deck to review its AI drafts.')).toBeTruthy();
    const link = await screen.findByRole('link', { name: /AWS Solutions Architect Associate/ });
    expect(link.getAttribute('href')).toBe('/review?deckId=7');
    expect(api.listDrafts).not.toHaveBeenCalled();
  });

  it('shows the draft, its highlighted source quote and similar cards', async () => {
    api.listDrafts.mockResolvedValue(
      ok({ items: [draftSummary({ likelyDuplicate: true })], nextCursor: 'next-page' }),
    );
    api.fetchDraft.mockResolvedValue(ok(draft(qaDraftCard(), { similar: [MATCH] })));
    await openReview();

    expect(api.listDrafts).toHaveBeenCalledWith(expect.objectContaining({ deckId: 7, status: 'pending' }));
    expect(api.fetchDraft).toHaveBeenCalledWith(41);

    const drafts = screen.getByRole('region', { name: 'Drafts' });
    expect(within(drafts).getByText('Likely duplicate')).toBeTruthy();
    expect(within(drafts).getByRole('button', { name: 'Load more' })).toBeTruthy();

    const card = screen.getByRole('region', { name: 'Draft card' });
    expect(within(card).getByText('sample-qa-topic-02')).toBeTruthy();
    expect(within(card).getByText(/author-cards · local · 1\.0\.0/)).toBeTruthy();

    const source = screen.getByRole('region', { name: 'Source' });
    const link = within(source).getByRole('link', { name: 'docs.aws.amazon.com' });
    expect(link.getAttribute('href')).toBe(qaDraftCard().source.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    const quote = screen.getByTestId('review-source-quote');
    expect(quote.tagName).toBe('MARK');
    expect(quote.closest('blockquote')).not.toBeNull();
    expect(quote.textContent).toBe(qaDraftCard().source.quote);

    const similar = screen.getByRole('region', { name: 'Similar cards' });
    expect(within(similar).getByText('87%')).toBeTruthy();
    expect(within(similar).getByText('Likely duplicate')).toBeTruthy();
    expect(within(similar).getByRole('link', { name: 'Open card' }).getAttribute('href')).toBe(
      '/decks/cards/edit?deckId=7&cardId=312',
    );

    expect(within(screen.getByRole('region', { name: 'Lint' })).getByText('No lint issues.')).toBeTruthy();
  });

  it('accepts a draft once and sends reviewMs', async () => {
    const pending = deferred<ApiResult<DraftAcceptResult>>();
    api.acceptDraft.mockReturnValue(pending.promise);
    await openReview();

    now = 43_000;
    const accept = screen.getByRole('button', { name: 'Accept' });
    await userEvent.dblClick(accept);

    expect(api.acceptDraft).toHaveBeenCalledTimes(1);
    expect(api.acceptDraft).toHaveBeenCalledWith(41, { reviewMs: 42_000 });
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);

    pending.resolve(ok({ draftId: 41, cardId: 901, stableUid: 'sample-qa-topic-02', action: 'accepted' }));
    expect(await screen.findByText(/Accepted as card #901/)).toBeTruthy();
    await waitFor(() => expect(api.listDrafts).toHaveBeenCalledTimes(2));
    expect(api.acceptDraft).toHaveBeenCalledTimes(1);
  });

  it('accepts with edits through the card form', async () => {
    const card = mcqDraftCard();
    api.listDrafts.mockResolvedValue(
      ok({ items: [draftSummary({ stableUid: card.stableUid, question: card.question })], nextCursor: null }),
    );
    api.fetchDraft.mockResolvedValue(ok(draft(card)));
    api.acceptDraft.mockResolvedValue(
      ok({ draftId: 41, cardId: 902, stableUid: card.stableUid, action: 'edited_accepted' }),
    );
    await openReview();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const edited =
      'A team keeps customer exports in an S3 bucket. The key must be one the team controls and rotates, and no object may be uploaded unencrypted. Which combination of actions is the MOST secure way to meet both requirements? (Choose two.)';
    fireEvent.change(screen.getByLabelText(/question/i), { target: { value: edited } });
    now = 61_000;
    await userEvent.click(screen.getByRole('button', { name: 'Accept with edits' }));

    await waitFor(() => expect(api.acceptDraft).toHaveBeenCalledTimes(1));
    const [id, body] = api.acceptDraft.mock.calls[0];
    expect(id).toBe(41);
    expect(body.reviewMs).toBe(60_000);
    expect(body.card.question).toBe(edited);
    expect(body.card.mcq).toEqual(card.mcq);
    expect(body.card.source).toEqual(card.source);
    expect(await screen.findByText(/Accepted as card #902/)).toBeTruthy();
  });

  it('keeps Accept disabled while the draft has lint issues', async () => {
    api.fetchDraft.mockResolvedValue(ok(draft(qaDraftCard({ stableUid: 'Bad UID!' }))));
    await openReview();

    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Fix the lint issues with Edit, then Accept with edits.')).toBeTruthy();
    const lint = screen.getByRole('region', { name: 'Lint' });
    expect(within(lint).queryByText('No lint issues.')).toBeNull();
    expect(within(lint).getByText(/^(BAD_UID_FORMAT|BAD_CARD_HEADER): /)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('rejects with a reason and note', async () => {
    api.rejectDraft.mockResolvedValue(ok({ draftId: 41, action: 'rejected' }));
    await openReview();

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const confirm = screen.getByRole('button', { name: 'Confirm reject' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const reasons = within(screen.getByLabelText('Reason')).getAllByRole('option') as HTMLOptionElement[];
    expect(reasons.filter(o => o.value !== '').map(o => o.textContent)).toEqual([
      'Incorrect',
      'Ambiguous',
      'Duplicate',
      'Not supported by the source',
      'Off topic',
      'Low value',
      'Other',
    ]);
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'incorrect');
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'Deep Archive fits too.');
    expect(screen.getByLabelText('Note (optional)').getAttribute('maxlength')).toBe('500');

    now = 9_000;
    await userEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));

    expect(api.rejectDraft).toHaveBeenCalledTimes(1);
    expect(api.rejectDraft).toHaveBeenCalledWith(41, {
      reason: 'incorrect',
      note: 'Deep Archive fits too.',
      reviewMs: 8_000,
    });
    expect((await screen.findByRole('status')).textContent).toBe('Rejected');
  });

  it('explains a draft that was already decided elsewhere', async () => {
    api.acceptDraft.mockResolvedValue(refused('DRAFT_NOT_PENDING', 'Draft 41 is not pending.'));
    await openReview();
    expect(api.listDrafts).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'This draft was already decided, in another tab or by another reviewer. The list has been refreshed.',
    );
    await waitFor(() => expect(api.listDrafts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledTimes(2));
  });

  it('explains a stable uid that is already taken', async () => {
    api.acceptDraft.mockResolvedValue(refused('STABLE_UID_TAKEN', 'stable uid taken'));
    await openReview();

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'A live card already uses this stable uid. Edit the uid, then use Accept with edits.',
    );
  });

  it('explains a server that has not run the review migration', async () => {
    api.listDrafts.mockResolvedValue(refused('SERVER_NOT_READY_REVIEW', 'drafts table missing'));
    renderAt(<ReviewQueuePage />, ['/review?deckId=7']);

    const notReady = await screen.findByTestId('review-not-ready');
    expect(notReady.textContent).toBe('The server has not run the review queue database migration.');
    expect(screen.getByText('The review queue is not set up yet')).toBeTruthy();
    expect(api.fetchDraft).not.toHaveBeenCalled();
  });

  it('names the route Review queue and links it from the shell', () => {
    expect(documentTitleFor('/review')).toBe('Review queue · DeveloperCards Console');

    function shell(href?: string) {
      return render(
        <MemoryRouter>
          <ConsoleShell title="t" reviewHref={href}>
            body
          </ConsoleShell>
        </MemoryRouter>,
      );
    }

    shell('/review?deckId=7');
    const link = screen.getByRole('link', { name: 'Review queue' });
    expect(link.getAttribute('href')).toBe('/review?deckId=7');
    expect(link.querySelector('span')).toBeNull();
    cleanup();

    shell(undefined);
    expect(screen.queryByRole('link', { name: 'Review queue' })).toBeNull();
  });
});
