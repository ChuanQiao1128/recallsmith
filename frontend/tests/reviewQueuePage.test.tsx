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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { deferred, ok, refused } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { draft, draftSummary, mcqDraftCard, qaDraftCard } from './support/draftFixtures';
import { locationText, renderAt } from './support/routerProbe';
import { ConsoleShell } from '../src/components/console/ConsoleShell';
import { QueryKeys } from '../src/api/queryClient';
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

  it('invalidates the deck\'s cards and the deck list after an accept', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    api.acceptDraft.mockResolvedValue(
      ok({ draftId: 41, cardId: 901, stableUid: 'sample-qa-topic-02', action: 'accepted' }),
    );
    renderAt(
      <QueryClientProvider client={client}>
        <ReviewQueuePage />
      </QueryClientProvider>,
      ['/review?deckId=7'],
    );
    await screen.findByRole('region', { name: 'Draft card' });
    expect(invalidate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText(/Accepted as card #901/)).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.cards(7) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.decks() });
  });

  it('moves focus to the outcome after a decision instead of dropping it to the body', async () => {
    api.acceptDraft.mockResolvedValue(
      ok({ draftId: 41, cardId: 901, stableUid: 'sample-qa-topic-02', action: 'accepted' }),
    );
    await openReview();
    const accept = screen.getByRole('button', { name: 'Accept' });
    accept.focus();
    await userEvent.click(accept);

    const outcome = await screen.findByTestId('review-outcome');
    await waitFor(() => expect(document.activeElement).toBe(outcome));
    expect(outcome.getAttribute('role')).toBe('status');
    expect(outcome.getAttribute('tabindex')).toBe('-1');
  });

  it('drops a Load more page whose filter changed while it was in flight', async () => {
    const stalePage = deferred<ReturnType<typeof ok>>();
    api.listDrafts.mockImplementation(async (params: { status: string; cursor?: string }) => {
      if (params.cursor) return stalePage.promise;
      if (params.status === 'all') {
        return ok({ items: [draftSummary({ draftId: 50, stableUid: 'all-first-page', status: 'accepted' })], nextCursor: null });
      }
      return ok({ items: [draftSummary()], nextCursor: 'pending-cursor' });
    });
    await openReview();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(api.listDrafts).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', cursor: 'pending-cursor' }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'all');
    const drafts = screen.getByRole('region', { name: 'Drafts' });
    expect(await within(drafts).findByText('all-first-page')).toBeTruthy();

    stalePage.resolve(
      ok({ items: [draftSummary({ draftId: 60, stableUid: 'stale-pending-row' })], nextCursor: 'stale-cursor' }),
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(within(drafts).queryByText('stale-pending-row')).toBeNull();
    expect(within(drafts).getByText('all-first-page')).toBeTruthy();
    expect(within(drafts).queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('counts review time only while the tab is visible', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    api.acceptDraft.mockResolvedValue(
      ok({ draftId: 41, cardId: 901, stableUid: 'sample-qa-topic-02', action: 'accepted' }),
    );
    await openReview();

    now = 11_000; // 10 s visible
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    now = 3_611_000; // an hour in a background tab
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    now = 3_616_000; // 5 s more

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(api.acceptDraft).toHaveBeenCalledWith(41, { reviewMs: 15_000 });
  });

  it('caps review time at 30 minutes', async () => {
    api.acceptDraft.mockResolvedValue(
      ok({ draftId: 41, cardId: 901, stableUid: 'sample-qa-topic-02', action: 'accepted' }),
    );
    await openReview();
    now = 1_000 + 2 * 60 * 60_000;
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(api.acceptDraft).toHaveBeenCalledWith(41, { reviewMs: 30 * 60_000 });
  });

  it('edits a draft without order or revision fields and requires its source', async () => {
    await openReview();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByLabelText('Order in Deck')).toBeNull();
    expect(screen.queryByLabelText('Revision')).toBeNull();
    const quote = screen.getByLabelText('Source quote') as HTMLTextAreaElement;
    expect(quote.required).toBe(true);
    expect(screen.getByText(/^Required\. The https page/)).toBeTruthy();
    expect(screen.queryByText(/Clear both to remove the source/)).toBeNull();

    fireEvent.change(quote, { target: { value: '' } });
    fireEvent.submit(quote.closest('form') as HTMLFormElement);
    expect(await screen.findByText('A draft needs a Source URL and a source quote.')).toBeTruthy();
    expect(api.acceptDraft).not.toHaveBeenCalled();
  });

  it('asks before opening another draft over unsaved edits', async () => {
    api.listDrafts.mockResolvedValue(
      ok({
        items: [draftSummary(), draftSummary({ draftId: 42, stableUid: 'second-draft', question: 'Second question?' })],
        nextCursor: null,
      }),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openReview();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/question/i), { target: { value: 'An edited question?' } });

    const drafts = screen.getByRole('region', { name: 'Drafts' });
    await userEvent.click(within(drafts).getByText('second-draft'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(api.fetchDraft).not.toHaveBeenCalledWith(42);
    expect((screen.getByLabelText(/question/i) as HTMLTextAreaElement).value).toBe('An edited question?');

    confirmSpy.mockReturnValue(true);
    await userEvent.click(within(drafts).getByText('second-draft'));
    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledWith(42));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  it('switches drafts without asking when the edit form is untouched', async () => {
    api.listDrafts.mockResolvedValue(
      ok({ items: [draftSummary(), draftSummary({ draftId: 42, stableUid: 'second-draft' })], nextCursor: null }),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openReview();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Drafts' })).getByText('second-draft'));
    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledWith(42));
    expect(confirmSpy).not.toHaveBeenCalled();
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

  it('guards unsaved edits against header links, reload and the status filter (frontend-console-19)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openReview();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/question/i), { target: { value: 'An edited question?' } });

    // Reload / tab close: the browser's own prompt.
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    // A header link: asked, and declined, so the page stays.
    await userEvent.click(screen.getByRole('link', { name: 'AI QA' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(locationText()).toBe('/review?deckId=7');
    expect((screen.getByLabelText(/question/i) as HTMLTextAreaElement).value).toBe('An edited question?');

    // The status filter, which would swap the auto-selected draft out.
    const listCalls = api.listDrafts.mock.calls.length;
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'accepted');
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('pending');
    expect(api.listDrafts.mock.calls.length).toBe(listCalls);
    expect((screen.getByLabelText(/question/i) as HTMLTextAreaElement).value).toBe('An edited question?');

    confirmSpy.mockReturnValue(true);
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'accepted');
    await waitFor(() =>
      expect(api.listDrafts).toHaveBeenLastCalledWith({ deckId: 7, status: 'accepted', limit: 50 }),
    );
    expect(confirmSpy).toHaveBeenCalledTimes(3);
  });

  it('does not ask again after the edits are accepted (frontend-console-19)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    api.acceptDraft.mockResolvedValue(
      ok({ draftId: 41, cardId: 901, stableUid: 'sample-qa-topic-02', action: 'accepted' }),
    );
    await openReview();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText(/question/i), { target: { value: 'An edited question?' } });
    await userEvent.click(screen.getByRole('button', { name: 'Accept with edits' }));
    expect(await screen.findByText(/Accepted as card #901/)).toBeTruthy();
    await userEvent.click(screen.getByRole('link', { name: 'AI QA' }));
    await waitFor(() => expect(locationText()).toBe('/decks/qa?deckId=7'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('says what the empty list means for each status filter (frontend-console-20)', async () => {
    api.listDrafts.mockResolvedValue(ok({ items: [], nextCursor: null }));
    renderAt(<ReviewQueuePage />, ['/review?deckId=7']);
    expect(await screen.findByText('No drafts waiting for review.')).toBeTruthy();
    for (const [value, text] of [
      ['accepted', 'No accepted drafts.'],
      ['rejected', 'No rejected drafts.'],
      ['all', 'No drafts for this deck yet.'],
    ] as const) {
      await userEvent.selectOptions(screen.getByLabelText('Status'), value);
      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.queryByText('No drafts waiting for review.')).toBeNull();
    }
  });

  it('points to Reject, not Edit, when an MCQ option fails lint (frontend-console-20)', async () => {
    const card = mcqDraftCard();
    const mcq = card.mcq as NonNullable<typeof card.mcq>;
    // Every option marked correct: MCQ_ALL_CORRECT / MCQ_TOO_MANY_CORRECT, which
    // only the read-only options can fix.
    api.fetchDraft.mockResolvedValue(
      ok(draft({ ...card, mcq: { ...mcq, options: mcq.options.map(o => ({ ...o, correct: true, why: null })) } })),
    );
    await openReview();
    const advice = await screen.findByTestId('review-lint-advice');
    expect(advice.textContent).toBe(
      'The options cannot be edited here; reject with reason Incorrect or Ambiguous, or fix the source deck.',
    );
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows where the quote was grounded when the draft carries it, and nothing otherwise', async () => {
    api.fetchDraft.mockResolvedValue(
      ok(
        draft(
          qaDraftCard({
            source: {
              url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html',
              quote: 'its standard retrieval finishes in 3 to 5 hours',
              grounding: { chunkId: 'chunk-12', sourceId: 'src-3', matched: true, quoteChars: 47 },
            },
          }),
        ),
      ),
    );
    await openReview();
    const grounding = await screen.findByTestId('review-grounding');
    expect(grounding.textContent).toContain('Quote found in the source');
    expect(grounding.textContent).toContain('Chunk chunk-12 of source src-3 · 47 characters quoted');
    cleanup();

    api.fetchDraft.mockResolvedValue(
      ok(
        draft(
          qaDraftCard({
            source: {
              url: 'https://example.com/doc',
              quote: 'q',
              grounding: { chunkId: 'chunk-1', sourceId: 'src-1', matched: false, quoteChars: 1 },
            },
          }),
        ),
      ),
    );
    await openReview();
    expect((await screen.findByTestId('review-grounding')).textContent).toContain('Quote not found in the source');
    cleanup();

    api.fetchDraft.mockResolvedValue(ok(draft(qaDraftCard())));
    await openReview();
    expect(screen.queryByTestId('review-grounding')).toBeNull();
  });
});
