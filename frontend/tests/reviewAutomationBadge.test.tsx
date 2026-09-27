// @vitest-environment jsdom
//
// The automation on the review queue (A00 §16.3, A17): the badge of a routed
// draft in the list, the automation panel in the detail and the normalisation
// of the §5.10 block. src/api/drafts, the two src/api/authoring reads and
// fetchQaStatus are mocked as in reviewQueuePage.test.tsx, so nothing leaves
// the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';

import { ok } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { draft, draftSummary, qaDraftCard } from './support/draftFixtures';
import { qaStatus } from './support/qaFixtures';
import { renderAt } from './support/routerProbe';
import { draftAutomationBadgeText } from '../src/lib/automationSurfaces';
import type { Deck } from '../src/types/deck';
import type { DraftAutomation } from '../src/types/draft';

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
const { normalizeDraft, normalizeDraftSummary } = await import('../src/api/drafts');

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

// Live: a pending dry-run draft is blind until the person decides (C07
// frontend-console-14, reviewBlindShadow.test.tsx), so the visible verdict is a live one.
const LIST_AUTOMATION: DraftAutomation = { state: 'human', reason: 'QA_FLAGGED', mode: 'live' };

const DETAIL_AUTOMATION: DraftAutomation = {
  state: 'human',
  reason: 'QA_FLAGGED',
  mode: 'live',
  runId: '0f6c2d9e-4b1a-4c55-9a53-5f2d8f7e1a10',
  reasonDetail: null,
  qa: {
    status: 'done',
    errorCode: null,
    provider: 'bedrock',
    model: 'reviewer-model',
    promptVersion: 'qa-v3',
    blocker: 0,
    major: 1,
    minor: 0,
    findings: [
      {
        severity: 'major',
        category: 'incorrect_answer',
        message: 'The answer names the wrong storage class for 7-year retention.',
        suggestedFix: 'Name S3 Glacier Deep Archive for the long-term tier.',
      },
    ],
  },
  acceptedCardId: null,
  humanAction: null,
};

beforeEach(() => {
  signInAsSuperAdmin();
  authoring.fetchDecks.mockResolvedValue(ok([DECK]));
  authoring.fetchDeckById.mockResolvedValue(ok(DECK));
  api.listDrafts.mockResolvedValue(ok({ items: [draftSummary()], nextCursor: null }));
  api.fetchDraft.mockResolvedValue(ok(draft(qaDraftCard())));
  qaApi.fetchQaStatus.mockResolvedValue(ok(qaStatus({ enabled: false })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const fn of [...Object.values(api), ...Object.values(authoring), ...Object.values(qaApi)]) fn.mockReset();
  signOut();
});

async function openReview() {
  renderAt(<ReviewQueuePage />, ['/review?deckId=7']);
  await screen.findByRole('region', { name: 'Draft card' });
}

describe('review queue automation', () => {
  it('shows the automation state and reason on a draft in the list', async () => {
    api.listDrafts.mockResolvedValue(ok({ items: [draftSummary({ automation: LIST_AUTOMATION })], nextCursor: null }));
    await openReview();

    const text = draftAutomationBadgeText(LIST_AUTOMATION);
    expect(text).toBe('Automation: Needs you · AI QA found a blocker or major issue');
    expect(draftAutomationBadgeText({ ...LIST_AUTOMATION, mode: 'dry_run' })).toBe(
      'Automation: Needs you · AI QA found a blocker or major issue (dry run)',
    );
    const drafts = screen.getByRole('region', { name: 'Drafts' });
    expect(within(drafts).getByText(text)).toBeTruthy();
  });

  it('shows the draft QA findings and links the Automation page in the detail', async () => {
    api.fetchDraft.mockResolvedValue(ok(draft(qaDraftCard(), { automation: DETAIL_AUTOMATION })));
    await openReview();

    const panel = await screen.findByTestId('review-automation');
    expect(within(panel).getByRole('heading', { name: 'Automation' })).toBeTruthy();
    expect(within(panel).getByText('The answer names the wrong storage class for 7-year retention.')).toBeTruthy();
    expect(
      within(panel).getByText('Suggested fix: Name S3 Glacier Deep Archive for the long-term tier.'),
    ).toBeTruthy();
    expect(within(panel).getByText('Findings: 0 blocker, 1 major, 0 minor')).toBeTruthy();
    expect(within(panel).getByText('Reviewer: bedrock · reviewer-model · qa-v3')).toBeTruthy();
    const link = within(panel).getByRole('link', { name: 'Open in Automation' });
    expect(link.getAttribute('href')).toBe('/automation?draftId=41');
    expect(panel.getAttribute('role')).toBeNull();
  });

  it('shows nothing extra for a draft without an automation block', async () => {
    await openReview();

    expect(screen.queryByTestId('review-automation')).toBeNull();
    const drafts = screen.getByRole('region', { name: 'Drafts' });
    expect(within(drafts).queryByText(/^Automation:/)).toBeNull();
  });

  it('normalises the automation block of GET drafts and GET drafts/:draftId', () => {
    const summary = normalizeDraftSummary({
      draftId: 41,
      automation: { state: 'would_accept', reason: null, mode: 'dry_run' },
    });
    expect(summary?.automation).toEqual({ state: 'would_accept', reason: null, mode: 'dry_run' });

    const detail = normalizeDraft({
      draftId: '41',
      card: qaDraftCard(),
      automation: {
        runId: '0f6c2d9e-4b1a-4c55-9a53-5f2d8f7e1a10',
        state: 'auto_accepted',
        reason: null,
        reasonDetail: null,
        mode: 'live',
        qa: {
          status: 'done',
          errorCode: null,
          provider: 'bedrock',
          model: 'reviewer-model',
          promptVersion: 'qa-v3',
          blocker: '0',
          major: '0',
          minor: '2',
          findings: [
            { severity: 'minor', category: 'clarity', message: 'Wordy stem.', suggestedFix: null },
            { severity: 'minor', category: 'clarity' },
          ],
        },
        acceptedCardId: '902',
        humanAction: null,
      },
    });
    expect(detail?.automation).toEqual({
      runId: '0f6c2d9e-4b1a-4c55-9a53-5f2d8f7e1a10',
      state: 'auto_accepted',
      reason: null,
      reasonDetail: null,
      mode: 'live',
      qa: {
        status: 'done',
        errorCode: null,
        provider: 'bedrock',
        model: 'reviewer-model',
        promptVersion: 'qa-v3',
        blocker: 0,
        major: 0,
        minor: 2,
        findings: [{ severity: 'minor', category: 'clarity', message: 'Wordy stem.', suggestedFix: null }],
      },
      acceptedCardId: 902,
      humanAction: null,
    });

    expect(normalizeDraftSummary({ draftId: 41, automation: { reason: 'QA_FLAGGED', mode: 'live' } })?.automation).toBeNull();
    expect(normalizeDraftSummary({ draftId: 41 })?.automation).toBeNull();
  });

  it('links the Automation page from the review queue header', async () => {
    await openReview();

    const nav = screen.getByRole('navigation', { name: 'Console sections' });
    const link = within(nav).getByRole('link', { name: 'Automation' });
    expect(link.getAttribute('href')).toBe('/automation');
  });
});
