// @vitest-environment jsdom
//
// B07 automation-4: the dry-run shadow agreement compares a person's decision
// with the automation's would_accept verdict, so the review queue must not
// show that verdict (badge, QA counts, findings) before the person decides.
// A human-routed draft keeps its reason, and a decided draft shows everything.
// Mocks as in reviewAutomationBadge.test.tsx, so nothing leaves the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';

import { ok } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { draft, draftSummary, qaDraftCard } from './support/draftFixtures';
import { qaStatus } from './support/qaFixtures';
import { renderAt } from './support/routerProbe';
import { BLINDED_AUTOMATION_TEXT, automationBlinded } from '../src/lib/automationSurfaces';
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

const WOULD_ACCEPT: DraftAutomation = {
  state: 'would_accept',
  reason: null,
  mode: 'dry_run',
  runId: '0f6c2d9e-4b1a-4c55-9a53-5f2d8f7e1a10',
  reasonDetail: null,
  qa: {
    status: 'done',
    errorCode: null,
    provider: 'bedrock-converse',
    model: 'global.openai.gpt-5.5',
    promptVersion: 'qa-v4-auto',
    blocker: 0,
    major: 0,
    minor: 1,
    findings: [{ severity: 'minor', category: 'clarity', message: 'Wordy stem.', suggestedFix: null }],
  },
  acceptedCardId: null,
  humanAction: null,
};

beforeEach(() => {
  signInAsSuperAdmin();
  authoring.fetchDecks.mockResolvedValue(ok([DECK]));
  authoring.fetchDeckById.mockResolvedValue(ok(DECK));
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

describe('the dry-run shadow review is blind (B07 automation-4)', () => {
  it('hides a pending would-accept verdict in the list and in the detail', async () => {
    api.listDrafts.mockResolvedValue(
      ok({ items: [draftSummary({ automation: { state: 'would_accept', reason: null, mode: 'dry_run' } })], nextCursor: null }),
    );
    api.fetchDraft.mockResolvedValue(ok(draft(qaDraftCard(), { automation: WOULD_ACCEPT })));
    await openReview();

    const drafts = screen.getByRole('region', { name: 'Drafts' });
    expect(within(drafts).getByText(BLINDED_AUTOMATION_TEXT)).toBeTruthy();
    expect(within(drafts).queryByText(/Would be accepted/)).toBeNull();

    const panel = await screen.findByTestId('review-automation');
    expect(within(panel).getByText(BLINDED_AUTOMATION_TEXT)).toBeTruthy();
    expect(panel.textContent).not.toMatch(/Would be accepted|Findings:|Reviewer:|Wordy stem/);
    // The link to the decision would show the verdict one click away.
    expect(within(panel).queryByRole('link', { name: 'Open in Automation' })).toBeNull();
  });

  it('blinds a pending human-routed dry-run draft exactly like a would-accept one (C07 frontend-console-14)', async () => {
    const routed: DraftAutomation = { ...WOULD_ACCEPT, state: 'human', reason: 'QA_FLAGGED' };
    api.listDrafts.mockResolvedValue(
      ok({
        items: [
          draftSummary({ draftId: 41, automation: { state: 'would_accept', reason: null, mode: 'dry_run' } }),
          draftSummary({ draftId: 42, automation: { state: 'human', reason: 'QA_FLAGGED', mode: 'dry_run' } }),
        ],
        nextCursor: null,
      }),
    );
    api.fetchDraft.mockResolvedValue(ok(draft(qaDraftCard(), { automation: routed })));
    await openReview();

    const drafts = screen.getByRole('region', { name: 'Drafts' });
    const badges = within(drafts).getAllByText(/^Automation:/);
    expect(badges).toHaveLength(2);
    expect(badges.map(b => b.textContent)).toEqual([BLINDED_AUTOMATION_TEXT, BLINDED_AUTOMATION_TEXT]);
    expect(badges[0].className).toBe(badges[1].className);
    expect(drafts.textContent).not.toMatch(/Needs you|AI QA found|Would be accepted/);

    const panel = await screen.findByTestId('review-automation');
    expect(within(panel).getByText(BLINDED_AUTOMATION_TEXT)).toBeTruthy();
    expect(panel.textContent).not.toMatch(/Needs you|AI QA found|Findings:|Reviewer:|Wordy stem/);
    expect(within(panel).queryByRole('link', { name: 'Open in Automation' })).toBeNull();
  });

  // C07 frontend-console-14 replaced "keeps the reason of a human-routed draft
  // visible" for dry run: a visible reason on routed drafts made the blinded
  // badge mean would_accept. A live routed draft keeps its reason.
  it('keeps the reason of a live human-routed draft visible', async () => {
    const routed: DraftAutomation = { ...WOULD_ACCEPT, state: 'human', reason: 'QA_FLAGGED', mode: 'live' };
    api.listDrafts.mockResolvedValue(
      ok({ items: [draftSummary({ automation: { state: 'human', reason: 'QA_FLAGGED', mode: 'live' } })], nextCursor: null }),
    );
    api.fetchDraft.mockResolvedValue(ok(draft(qaDraftCard(), { automation: routed })));
    await openReview();

    const panel = await screen.findByTestId('review-automation');
    expect(within(panel).getByText('AI QA found a blocker or major issue')).toBeTruthy();
    expect(within(panel).getByText('Wordy stem.')).toBeTruthy();
    expect(screen.queryByText(BLINDED_AUTOMATION_TEXT)).toBeNull();
  });

  it('reveals the verdict once a person has decided the draft', () => {
    expect(automationBlinded(WOULD_ACCEPT, 'pending')).toBe(true);
    expect(automationBlinded(WOULD_ACCEPT, 'accepted')).toBe(false);
    expect(automationBlinded(WOULD_ACCEPT, 'rejected')).toBe(false);
    expect(automationBlinded({ ...WOULD_ACCEPT, humanAction: 'accepted' }, 'pending')).toBe(false);
    // Live never blinds; in dry run every pending undecided draft is blind, whatever its state (C07).
    expect(automationBlinded({ ...WOULD_ACCEPT, mode: 'live' }, 'pending')).toBe(false);
    expect(automationBlinded({ ...WOULD_ACCEPT, state: 'human', mode: 'live' }, 'pending')).toBe(false);
    expect(automationBlinded({ ...WOULD_ACCEPT, state: 'human' }, 'pending')).toBe(true);
    expect(automationBlinded({ ...WOULD_ACCEPT, state: 'qa_queued' }, 'pending')).toBe(true);
    expect(automationBlinded({ ...WOULD_ACCEPT, state: 'human', humanAction: 'rejected' }, 'pending')).toBe(false);
  });
});
