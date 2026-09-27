// @vitest-environment jsdom
//
// D07 (R18A fix round 3): the review queue's side of the blind shadow
// agreement. Each accept or reject of a draft with an automatic decision sends
// verdictShown (automation-4, D01 contract); a draft routed to a person for AI
// QA blocker or major findings shows those findings before the card lands
// (frontend-console-26), since G04 frontend-console-38 (P4) in a confirm step
// after Accept rather than in the panel; and after a blinded decision the
// outcome tells the verdict that was hidden. Mocks as in reviewBlindShadow.test.tsx, so nothing
// leaves the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ok } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { draft, draftSummary, qaDraftCard } from './support/draftFixtures';
import { qaStatus } from './support/qaFixtures';
import { renderAt } from './support/routerProbe';
import {
  BLINDED_AUTOMATION_TEXT,
  automationQaFindingsShown,
  revealedVerdict,
  verdictShownFor,
} from '../src/lib/automationSurfaces';
import { clearVerdictSeen, markVerdictSeen, verdictSeenElsewhere } from '../src/lib/automationVerdictSeen';
import type { Deck } from '../src/types/deck';
import type { DraftAutomation } from '../src/types/draft';

const api = vi.hoisted(() => ({
  listDrafts: vi.fn(),
  fetchDraft: vi.fn(),
  acceptDraft: vi.fn(),
  rejectDraft: vi.fn(),
}));
const authoring = vi.hoisted(() => ({ fetchDecks: vi.fn(), fetchDeckById: vi.fn() }));
const qaApi = vi.hoisted(() => ({ fetchQaStatus: vi.fn() }));

vi.mock('../src/api/qa', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/qa')>();
  return { ...actual, ...qaApi };
});
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

const QA = {
  status: 'done',
  errorCode: null,
  provider: 'bedrock-converse',
  model: 'global.openai.gpt-5.5',
  promptVersion: 'qa-v4-auto',
  blocker: 0,
  major: 0,
  minor: 1,
  findings: [{ severity: 'minor', category: 'clarity', message: 'Wordy stem.', suggestedFix: null }],
};

const WOULD_ACCEPT: DraftAutomation = {
  state: 'would_accept',
  reason: null,
  mode: 'dry_run',
  runId: '0f6c2d9e-4b1a-4c55-9a53-5f2d8f7e1a10',
  reasonDetail: null,
  qa: QA,
  acceptedCardId: null,
  humanAction: null,
};

const QA_FLAGGED: DraftAutomation = {
  ...WOULD_ACCEPT,
  state: 'human',
  reason: 'QA_FLAGGED',
  qa: {
    ...QA,
    blocker: 1,
    major: 1,
    minor: 0,
    findings: [
      { severity: 'blocker', category: 'factual_error', message: 'Glacier Instant Retrieval is not the cheapest.', suggestedFix: 'Say Deep Archive.' },
      { severity: 'major', category: 'ambiguity', message: 'Two options fit.', suggestedFix: null },
    ],
  },
};

beforeEach(() => {
  signInAsSuperAdmin();
  clearVerdictSeen();
  authoring.fetchDecks.mockResolvedValue(ok([DECK]));
  authoring.fetchDeckById.mockResolvedValue(ok(DECK));
  qaApi.fetchQaStatus.mockResolvedValue(ok(qaStatus({ enabled: false })));
  api.acceptDraft.mockResolvedValue(ok({ draftId: 41, cardId: 900, stableUid: 'sample-qa-topic-02', action: 'accepted' }));
  api.rejectDraft.mockResolvedValue(ok({ draftId: 41, action: 'rejected' }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const fn of [...Object.values(api), ...Object.values(authoring), ...Object.values(qaApi)]) fn.mockReset();
  clearVerdictSeen();
  signOut();
});

async function openReviewWith(automation: DraftAutomation) {
  api.listDrafts.mockResolvedValue(
    ok({ items: [draftSummary({ automation: { state: automation.state, reason: automation.reason, mode: automation.mode } })], nextCursor: null }),
  );
  api.fetchDraft.mockResolvedValue(ok(draft(qaDraftCard(), { automation })));
  renderAt(<ReviewQueuePage />, ['/review?deckId=7']);
  await screen.findByRole('region', { name: 'Draft card' });
  await screen.findByTestId('review-automation');
}

async function reject() {
  await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
  await userEvent.selectOptions(screen.getByLabelText('Reason'), 'incorrect');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));
}

describe('verdictShown on accept and reject (automation-4)', () => {
  it('sends false for a blinded would-accept draft', async () => {
    await openReviewWith(WOULD_ACCEPT);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.acceptDraft).toHaveBeenCalledTimes(1));
    expect(api.acceptDraft.mock.calls[0][1]).toMatchObject({ verdictShown: false });
  });

  it('sends true when the verdict was revealed on the Automation page first (frontend-console-25)', async () => {
    markVerdictSeen(41);
    await openReviewWith(WOULD_ACCEPT);
    await reject();
    await waitFor(() => expect(api.rejectDraft).toHaveBeenCalledTimes(1));
    expect(api.rejectDraft.mock.calls[0][1]).toMatchObject({ reason: 'incorrect', verdictShown: true });
  });

  it('sends true when another tab of the browser revealed the verdict (E05 frontend-console-32)', async () => {
    // Written by the Automation page in another tab: the shared localStorage entry.
    window.localStorage.setItem('dc.automation.verdictSeen.v1', JSON.stringify([41]));
    await openReviewWith(WOULD_ACCEPT);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.acceptDraft).toHaveBeenCalledTimes(1));
    expect(api.acceptDraft.mock.calls[0][1]).toMatchObject({ verdictShown: true });
  });

  it('sends true in live mode, where the verdict always shows', async () => {
    await openReviewWith({ ...WOULD_ACCEPT, state: 'human', reason: 'EXISTING_CARD', mode: 'live' });
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.acceptDraft).toHaveBeenCalledTimes(1));
    expect(api.acceptDraft.mock.calls[0][1]).toMatchObject({ verdictShown: true });
  });

  it('decides the pure rule', () => {
    expect(verdictShownFor(null, 'pending', false)).toBe(false);
    expect(verdictShownFor(WOULD_ACCEPT, 'pending', false)).toBe(false);
    expect(verdictShownFor(WOULD_ACCEPT, 'pending', true)).toBe(true);
    expect(verdictShownFor({ ...WOULD_ACCEPT, mode: 'live' }, 'pending', false)).toBe(true);
    // G04 frontend-console-38: the flagged panel no longer shows findings before the decision, so a
    // flagged draft is as blind as any other until its findings step records the verdict as seen.
    expect(verdictShownFor(QA_FLAGGED, 'pending', false)).toBe(false);
    expect(verdictShownFor(QA_FLAGGED, 'pending', true)).toBe(true);
    expect(verdictShownFor({ ...WOULD_ACCEPT, state: 'human', reason: 'EXISTING_CARD' }, 'pending', false)).toBe(false);
  });
});

/** The automation panel's text and markup, without React's per-render ids. */
function panelMarkup(): string {
  return screen.getByTestId('review-automation').outerHTML.replace(/ id="[^"]*"/g, '');
}

describe('a QA-flagged draft shows its findings to the person deciding (frontend-console-26, G04 frontend-console-38)', () => {
  it('renders a flagged draft and a would-accept draft with the identical neutral panel before the decision', async () => {
    await openReviewWith(QA_FLAGGED);
    const flagged = panelMarkup();
    cleanup();
    await openReviewWith(WOULD_ACCEPT);
    const wouldAccept = panelMarkup();

    expect(flagged).toBe(wouldAccept);
    const panel = screen.getByTestId('review-automation');
    expect(within(panel).getByText(BLINDED_AUTOMATION_TEXT)).toBeTruthy();
    expect(panel.textContent).not.toContain('hidden for every dry-run draft');
    expect(within(panel).queryByRole('link', { name: 'Open in Automation' })).toBeNull();
  });

  it('keeps the flagged findings out of the page until Accept is clicked', async () => {
    await openReviewWith(QA_FLAGGED);
    expect(screen.queryByText('Glacier Instant Retrieval is not the cheapest.')).toBeNull();
    expect(screen.queryByText(/routed to you/)).toBeNull();
    expect(screen.queryByTestId('review-qa-findings-step')).toBeNull();
  });

  it('shows the blocker and major findings in a step after Accept, before the request', async () => {
    await openReviewWith(QA_FLAGGED);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));

    const step = await screen.findByRole('dialog', { name: 'AI QA found a blocker or major issue' });
    expect(within(step).getByText('Glacier Instant Retrieval is not the cheapest.')).toBeTruthy();
    expect(within(step).getByText('Two options fit.')).toBeTruthy();
    expect(document.activeElement).toBe(within(step).getByRole('button', { name: 'Back' }));
    expect(api.acceptDraft).not.toHaveBeenCalled();

    await userEvent.click(within(step).getByRole('button', { name: 'Accept anyway' }));
    await waitFor(() => expect(api.acceptDraft).toHaveBeenCalledTimes(1));
    expect(api.acceptDraft.mock.calls[0][1]).toMatchObject({ verdictShown: true });
    expect(screen.queryByTestId('review-qa-findings-step')).toBeNull();
  });

  it('records the verdict as seen when the person backs out, so a later reject is not blind', async () => {
    await openReviewWith(QA_FLAGGED);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    const step = await screen.findByRole('dialog', { name: 'AI QA found a blocker or major issue' });
    await userEvent.click(within(step).getByRole('button', { name: 'Back' }));

    expect(screen.queryByTestId('review-qa-findings-step')).toBeNull();
    expect(api.acceptDraft).not.toHaveBeenCalled();
    expect(verdictSeenElsewhere(41)).toBe(true);

    await reject();
    await waitFor(() => expect(api.rejectDraft).toHaveBeenCalledTimes(1));
    expect(api.rejectDraft.mock.calls[0][1]).toMatchObject({ verdictShown: true });
  });

  it('goes back on Escape', async () => {
    await openReviewWith(QA_FLAGGED);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await screen.findByTestId('review-qa-findings-step');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('review-qa-findings-step')).toBeNull());
    expect(api.acceptDraft).not.toHaveBeenCalled();
  });

  it('shows the step for Accept with edits too, and backing out keeps the form open', async () => {
    await openReviewWith(QA_FLAGGED);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept with edits' }));

    const step = await screen.findByRole('dialog', { name: 'AI QA found a blocker or major issue' });
    await userEvent.click(within(step).getByRole('button', { name: 'Back' }));
    expect(api.acceptDraft).not.toHaveBeenCalled();
    expect(await screen.findByText(/went back to the draft after reading the AI QA findings/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Accept with edits' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'AI QA found a blocker or major issue' })).getByRole('button', {
        name: 'Accept anyway',
      }),
    );
    await waitFor(() => expect(api.acceptDraft).toHaveBeenCalledTimes(1));
    expect(api.acceptDraft.mock.calls[0][1]).toMatchObject({ verdictShown: true });
  });

  it('never shows the step for a would-accept draft, whose accept stays blind', async () => {
    await openReviewWith(WOULD_ACCEPT);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.acceptDraft).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('review-qa-findings-step')).toBeNull();
    expect(api.acceptDraft.mock.calls[0][1]).toMatchObject({ verdictShown: false });
    expect(verdictSeenElsewhere(41)).toBe(false);
  });

  it('rejects a flagged draft without a step, blind', async () => {
    await openReviewWith(QA_FLAGGED);
    await reject();
    await waitFor(() => expect(api.rejectDraft).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('review-qa-findings-step')).toBeNull();
    expect(api.rejectDraft.mock.calls[0][1]).toMatchObject({ verdictShown: false });
  });

  it('keeps a would-accept draft and a flagged draft without serious findings blinded', () => {
    expect(automationQaFindingsShown(QA_FLAGGED, 'pending')).toBe(true);
    expect(automationQaFindingsShown(WOULD_ACCEPT, 'pending')).toBe(false);
    expect(automationQaFindingsShown({ ...QA_FLAGGED, qa: QA }, 'pending')).toBe(false);
    expect(automationQaFindingsShown(QA_FLAGGED, 'accepted')).toBe(false);
    expect(automationQaFindingsShown({ ...QA_FLAGGED, mode: 'live' }, 'pending')).toBe(false);
  });

  it('warns after accepting a blinded QA-flagged draft and names what the automation found', async () => {
    await openReviewWith(QA_FLAGGED);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept anyway' }));

    const verdict = await screen.findByTestId('review-outcome-verdict');
    expect(verdict.textContent).toContain(
      'The automation had routed this draft to you: AI QA found a blocker or major issue (AI QA: 1 blocker, 1 major, 0 minor).',
    );
    expect(within(verdict).getByRole('link', { name: 'Open in Automation' }).getAttribute('href')).toBe(
      '/automation?draftId=41',
    );
    expect(screen.getByTestId('review-outcome').innerHTML).toContain('bg-amber');
  });

  it('tells the hidden would-accept verdict after a reject, without a warning', async () => {
    await openReviewWith(WOULD_ACCEPT);
    await reject();
    const verdict = await screen.findByTestId('review-outcome-verdict');
    expect(verdict.textContent).toContain('The automation would have accepted this draft (AI QA: 0 blocker, 0 major, 1 minor).');
    expect(revealedVerdict(WOULD_ACCEPT, 'rejected').warn).toBe(false);
    expect(revealedVerdict(QA_FLAGGED, 'accepted').warn).toBe(true);
    expect(revealedVerdict(QA_FLAGGED, 'rejected').warn).toBe(false);
  });
});
