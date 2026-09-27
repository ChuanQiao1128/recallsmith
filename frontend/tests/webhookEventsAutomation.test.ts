// The four automation events of A00 §13 become subscribable (A17). Pure: the
// rules module has no I/O.

import { describe, expect, it } from 'vitest';

import { WEBHOOK_EVENTS, webhookFormProblems } from '../src/lib/webhookRules';

const EIGHT = [
  'deck.published',
  'import.failed',
  'card.flagged',
  'review.queued',
  'draft.auto_accepted',
  'automation.batch_completed',
  'automation.exception',
  'source.changed',
];

const GOOD = { name: 'n8n', url: 'https://hooks.example.com/dc' };

describe('webhook automation events', () => {
  it('offers the four automation events after the original four', () => {
    expect([...WEBHOOK_EVENTS]).toEqual(EIGHT);
  });

  it('accepts all eight events and rejects a ninth', () => {
    expect(webhookFormProblems({ ...GOOD, events: EIGHT })).toEqual([]);
    expect(webhookFormProblems({ ...GOOD, events: [...EIGHT, 'source.changed'] })).toEqual(['Choose at most 8 events.']);
    expect(webhookFormProblems({ ...GOOD, events: ['deck.deleted'] })).toEqual(['Unknown event: deck.deleted.']);
  });
});
