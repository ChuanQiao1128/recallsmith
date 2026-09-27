// The pure rules behind the B07 console fixes (R18A fix round 1): handled vs
// open decisions (K7), the URL filters of the Decisions tab, the labels of the
// machine codes, the field-keyed form checks and the QA-run origin label.

import { describe, expect, it } from 'vitest';

import {
  HUMAN_ACTION_LABELS,
  MODE_LABELS,
  NOTIFICATION_STATUS_LABELS,
  OPEN_EXCEPTIONS_SEARCH,
  QUEUE_ITEM_STATUSES,
  QUEUE_ITEM_STATUS_LABELS,
  RECHECK_STATES,
  RECHECK_STATE_LABELS,
  RUNNER_STATES,
  RUNNER_STATE_LABELS,
  RUN_OUTCOMES,
  RUN_OUTCOME_LABELS,
  RUN_STATUSES,
  RUN_STATUS_LABELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_STATUSES,
  QUEUE_ITEM_KINDS,
  QUEUE_ITEM_KIND_LABELS,
  WATCH_EVENT_KINDS,
  WATCH_EVENT_KIND_LABELS,
  WATCH_STATUSES,
  WATCH_STATUS_LABELS,
  AUTOMATION_MODES,
  codeLabel,
  decisionAwaitsPerson,
  decisionBadge,
  decisionFiltersFrom,
  decisionReasonDetailText,
  isOpenDecision,
  modeBadge,
  queueItemFieldProblems,
  runnerStateTone,
  watchEditProblem,
  watchTargetFieldProblems,
  withDecisionFilters,
} from '../src/lib/automationRules';
import { automationQaRunLabel } from '../src/lib/automationSurfaces';
import { qaItemErrorLabel } from '../src/lib/qaReview';

describe('handled vs open decisions (frontend-console-1, K7)', () => {
  it('labels a human decision a person acted on as handled, and only an open one as needing you', () => {
    expect(decisionBadge({ state: 'human', humanAction: null })).toEqual({ label: 'Needs you', tone: 'warning' });
    expect(decisionBadge({ state: 'human', humanAction: 'accepted' })).toEqual({
      label: 'Handled: accepted',
      tone: 'neutral',
    });
    expect(decisionBadge({ state: 'human', humanAction: 'edited_accepted' }).label).toBe(
      'Handled: edited and accepted',
    );
    expect(decisionBadge({ state: 'human', humanAction: 'rejected' }).label).toBe('Handled: rejected');
    // An unknown action still reads as handled, with its raw code.
    expect(decisionBadge({ state: 'human', humanAction: 'archived' }).label).toBe('Handled: archived');
    // Other states keep their own label whatever the action.
    expect(decisionBadge({ state: 'would_accept', humanAction: 'accepted' }).label).toBe('Would be accepted');
    expect(HUMAN_ACTION_LABELS).toEqual({
      accepted: 'Accepted',
      edited_accepted: 'Edited and accepted',
      rejected: 'Rejected',
    });
    expect(isOpenDecision({ humanAction: null })).toBe(true);
    expect(isOpenDecision({ humanAction: 'rejected' })).toBe(false);
  });

  it('keeps the Decisions filters in the URL and ignores unknown codes', () => {
    const filters = decisionFiltersFrom(new URLSearchParams('tab=decisions&state=human&reason=QA_FLAGGED&deckId=7&open=1'));
    expect(filters).toEqual({ deckId: 7, state: 'human', reason: 'QA_FLAGGED', openOnly: true });
    expect(decisionFiltersFrom(new URLSearchParams('state=bogus&reason=nope&deckId=x&open=yes'))).toEqual({
      deckId: null,
      state: '',
      reason: '',
      openOnly: false,
    });

    const next = withDecisionFilters(new URLSearchParams('tab=decisions&draftId=41&state=human'), {
      deckId: null,
      state: '',
      reason: 'QA_ERROR',
      openOnly: true,
    });
    expect(next.toString()).toBe('tab=decisions&draftId=41&reason=QA_ERROR&open=1');
    expect(decisionFiltersFrom(new URLSearchParams(OPEN_EXCEPTIONS_SEARCH))).toEqual({
      deckId: null,
      state: 'human',
      reason: '',
      openOnly: true,
    });
  });
});

describe('the review link of a decision (frontend-console-6)', () => {
  it('is offered while a person may still decide: routed or would-accept, and undecided', () => {
    expect(decisionAwaitsPerson({ state: 'human', humanAction: null })).toBe(true);
    expect(decisionAwaitsPerson({ state: 'would_accept', humanAction: null })).toBe(true);
    expect(decisionAwaitsPerson({ state: 'would_accept', humanAction: 'accepted' })).toBe(false);
    expect(decisionAwaitsPerson({ state: 'human', humanAction: 'rejected' })).toBe(false);
    expect(decisionAwaitsPerson({ state: 'auto_accepted', humanAction: null })).toBe(false);
    expect(decisionAwaitsPerson({ state: 'qa_queued', humanAction: null })).toBe(false);
  });
});

describe('machine codes read as words (frontend-console-11)', () => {
  it('reads a QA_ERROR detail through the AI QA error labels, like the review panel', () => {
    expect(decisionReasonDetailText('QA_ERROR', 'PROVIDER_ACCESS_DENIED')).toBe(
      qaItemErrorLabel('PROVIDER_ACCESS_DENIED'),
    );
    expect(qaItemErrorLabel('PROVIDER_ACCESS_DENIED')).not.toBe('PROVIDER_ACCESS_DENIED');
    expect(decisionReasonDetailText('QA_FLAGGED', '1 major finding')).toBe('1 major finding');
    expect(decisionReasonDetailText('QA_ERROR', null)).toBeNull();
  });

  it('has a label for every code of every enumeration, and falls back to the raw code', () => {
    const pairs: Array<[readonly string[], Record<string, string>]> = [
      [AUTOMATION_MODES, MODE_LABELS],
      [RUN_STATUSES, RUN_STATUS_LABELS],
      [RUN_OUTCOMES, RUN_OUTCOME_LABELS],
      [QUEUE_ITEM_STATUSES, QUEUE_ITEM_STATUS_LABELS],
      [QUEUE_ITEM_KINDS, QUEUE_ITEM_KIND_LABELS],
      [WATCH_STATUSES, WATCH_STATUS_LABELS],
      [WATCH_EVENT_KINDS, WATCH_EVENT_KIND_LABELS],
      [RECHECK_STATES, RECHECK_STATE_LABELS],
      [NOTIFICATION_KINDS, NOTIFICATION_KIND_LABELS],
      [NOTIFICATION_STATUSES, NOTIFICATION_STATUS_LABELS],
      [RUNNER_STATES, RUNNER_STATE_LABELS],
    ];
    for (const [codes, labels] of pairs) {
      expect(Object.keys(labels).sort()).toEqual([...codes].sort());
      for (const code of codes) expect(codeLabel(labels, code)).not.toBe(code);
    }
    expect(codeLabel(MODE_LABELS, 'dry_run')).toBe('Dry run');
    expect(codeLabel(NOTIFICATION_STATUS_LABELS, 'enqueue_failed')).toBe('Could not be queued');
    expect(codeLabel(RUN_STATUS_LABELS, 'paused')).toBe('paused');
    expect(codeLabel(RUN_STATUS_LABELS, 'constructor')).toBe('constructor');
    expect(codeLabel(RUN_OUTCOME_LABELS, null)).toBe('—');
  });

  it('gives a failing runner a danger tone and each mode its own badge', () => {
    expect(runnerStateTone('error')).toBe('danger');
    expect(runnerStateTone('login_expired')).toBe('danger');
    expect(runnerStateTone('idle')).toBe('neutral');
    expect(modeBadge('off')).toEqual({ text: 'OFF', tone: 'neutral' });
    expect(modeBadge('dry_run')).toEqual({ text: 'DRY RUN', tone: 'warning' });
    expect(modeBadge('live')).toEqual({ text: 'LIVE', tone: 'success' });
    expect(new Set(['off', 'dry_run', 'live'].map(m => modeBadge(m).tone)).size).toBe(3);
  });
});

describe('field-keyed form checks (frontend-console-9)', () => {
  it('names the field each queue problem belongs to', () => {
    expect(queueItemFieldProblems({ url: '', deckId: null, title: 'x'.repeat(301), note: 'x'.repeat(501) })).toEqual([
      { field: 'url', message: 'Enter a URL.' },
      { field: 'deckId', message: 'Choose a deck.' },
      { field: 'title', message: 'The title must be at most 300 characters.' },
      { field: 'note', message: 'The note must be at most 500 characters.' },
    ]);
  });

  it('names the field each watch problem belongs to, in the add form and the inline edit', () => {
    const fields = watchTargetFieldProblems({
      url: 'http://example.com/feed',
      feedFormat: 'json',
      deckId: null,
      itemTitlePattern: 'x'.repeat(1001),
      checkIntervalMinutes: 59,
    }).map(p => p.field);
    expect(fields).toEqual(['url', 'feedFormat', 'deckId', 'itemTitlePattern', 'checkIntervalMinutes']);
    expect(watchEditProblem('x'.repeat(1001), 120)?.field).toBe('itemTitlePattern');
    expect(watchEditProblem('ok', 30)?.field).toBe('checkIntervalMinutes');
    expect(watchEditProblem('ok', 120)).toBeNull();
  });
});

describe('the origin of an automation QA run (frontend-console-7)', () => {
  const base = { requestedBySub: 'automation', scope: 'cards', cardCount: 1, status: 'done' };

  it('calls only a zero-cost one-card run the auto-accept mirror', () => {
    expect(automationQaRunLabel({ ...base, estimatedCostUsd: 0 })).toBe('Automation — auto-accepted draft');
    // A finished re-check of one citing card cost a reviewer call.
    expect(automationQaRunLabel({ ...base, estimatedCostUsd: 0.012 })).toBe('Automation — source re-check');
    expect(automationQaRunLabel({ ...base, requestedBySub: 'owner-sub', estimatedCostUsd: 0 })).toBeNull();
  });
});
