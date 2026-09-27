// @vitest-environment jsdom
//
// D07 (R18A fix round 3): the review queue's side of the blind shadow
// agreement. Each accept or reject of a draft with an automatic decision sends
// verdictShown (automation-4, D01 contract); a draft routed to a person for AI
// QA blocker or major findings shows those findings before the decision
// (frontend-console-26); and after a blinded decision the outcome tells the
// verdict that was hidden. Mocks as in reviewBlindShadow.test.tsx, so nothing
// leaves the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
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
import { clearVerdictSeen, markVerdictSeen } from '../src/lib/automationVerdictSeen';
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
    expect(verdictShownFor(QA_FLAGGED, 'pending', false)).toBe(true);
    expect(verdictShownFor({ ...WOULD_ACCEPT, state: 'human', reason: 'EXISTING_CARD' }, 'pending', false)).toBe(false);
  });
});

describe('a QA-flagged draft shows its findings to the person deciding (frontend-console-26)', () => {
  it('shows the blocker and major findings before the decision, without the decision link', async () => {
    await openReviewWith(QA_FLAGGED);
    const panel = screen.getByTestId('review-automation');
    expect(within(panel).getByTestId('review-automation-qa-flagged').textContent).toContain(
      'Findings: 1 blocker, 1 major, 0 minor',
    );
    expect(within(panel).getByText('Glacier Instant Retrieval is not the cheapest.')).toBeTruthy();
    expect(within(panel).getByText('Two options fit.')).toBeTruthy();
    expect(within(panel).getByText(/routed to you · AI QA found a blocker or major issue/)).toBeTruthy();
    expect(within(panel).queryByText(BLINDED_AUTOMATION_TEXT)).toBeNull();
    expect(within(panel).queryByRole('link', { name: 'Open in Automation' })).toBeNull();
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
