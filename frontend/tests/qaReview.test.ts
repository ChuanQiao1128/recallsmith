// The AI QA page's pure rules (src/lib/qaReview.ts) and the deck list's gate
// helpers (src/lib/qaGate.ts).

import { describe, expect, it } from 'vitest';

import {
  QA_CATEGORIES,
  QA_CATEGORY_LABELS,
  QA_ITEM_ERROR_LABELS,
  QA_START_ERROR_MESSAGES,
  cardPasses,
  estimateQaCostUsd,
  formatUsd,
  groupFindingsByCard,
  isQaRunActive,
  qaCardsToReview,
  qaItemErrorLabel,
} from '../src/lib/qaReview';
import { QA_PUBLISH_GATE_CODES, isQaPublishGateCode, qaPageHref } from '../src/lib/qaGate';
import { qaCards, qaFinding, qaItem } from './support/qaFixtures';

describe('qaReview', () => {
  it('estimates cost from the per-card token budget and the list prices', () => {
    expect(estimateQaCostUsd(1)).toBeCloseTo(0.045, 10);
    expect(estimateQaCostUsd(10)).toBeCloseTo(0.45, 10);
    expect(estimateQaCostUsd(0)).toBe(0);
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.004)).toBe('<$0.01');
    expect(formatUsd(0.045)).toBe('$0.04');
    expect(formatUsd(0.45)).toBe('$0.45');
    expect(formatUsd(12.5)).toBe('$12.50');
  });

  it('groups findings by card with blockers first', () => {
    const items = [
      qaItem(101, 'aws-s3-storage-classes'),
      qaItem(102, 'aws-s3-cloudfront-oac'),
      qaItem(103, 'aws-iam-roles-vs-users', { status: 'error', errorCode: 'PROVIDER_TIMEOUT' }),
    ];
    const findings = [
      qaFinding({ findingId: 3, cardId: 101, severity: 'minor', category: 'weak_distractor' }),
      qaFinding({ findingId: 2, cardId: 102, severity: 'blocker' }),
      qaFinding({ findingId: 1, cardId: 101, severity: 'major', category: 'ambiguous_stem' }),
      // A finding whose item is missing still gets a group.
      qaFinding({ findingId: 9, cardId: 999, severity: 'minor', category: 'other' }),
    ];

    const groups = groupFindingsByCard(findings, items, qaCards);
    expect(groups.map(g => g.cardId)).toEqual([102, 101, 999, 103]);
    expect(groups[1].findings.map(f => f.findingId)).toEqual([1, 3]);
    expect(groups[0]).toMatchObject({ stableUid: 'aws-s3-cloudfront-oac', passes: false, itemStatus: 'done' });
    expect(groups[0].question).toContain('CloudFront');
    expect(groups[2]).toMatchObject({ cardId: 999, itemStatus: null, question: null, passes: true });
    expect(groups[3]).toMatchObject({ itemStatus: 'error', itemErrorCode: 'PROVIDER_TIMEOUT', passes: true, findings: [] });
  });

  it('passes a card with only minor findings', () => {
    expect(cardPasses([])).toBe(true);
    expect(cardPasses([{ severity: 'minor' }, { severity: 'minor' }])).toBe(true);
    expect(cardPasses([{ severity: 'minor' }, { severity: 'major' }])).toBe(false);
    expect(cardPasses([{ severity: 'blocker' }])).toBe(false);
  });

  it('treats queued and running as active and done and failed as terminal', () => {
    expect(isQaRunActive({ effectiveStatus: 'queued' })).toBe(true);
    expect(isQaRunActive({ effectiveStatus: 'running' })).toBe(true);
    expect(isQaRunActive({ effectiveStatus: 'done' })).toBe(false);
    expect(isQaRunActive({ effectiveStatus: 'failed' })).toBe(false);
  });

  it('counts only unreviewed changed cards', () => {
    expect(qaCardsToReview({ changedCards: 5, reviewedCurrent: 2 })).toBe(3);
    expect(qaCardsToReview({ changedCards: 2, reviewedCurrent: 2 })).toBe(0);
    expect(qaCardsToReview({ changedCards: 1, reviewedCurrent: 4 })).toBe(0);
  });

  it('recognises exactly the two publish gate codes', () => {
    expect([...QA_PUBLISH_GATE_CODES]).toEqual(['AI_QA_REQUIRED', 'AI_QA_BLOCKED']);
    expect(isQaPublishGateCode('AI_QA_REQUIRED')).toBe(true);
    expect(isQaPublishGateCode('AI_QA_BLOCKED')).toBe(true);
    expect(isQaPublishGateCode('AI_QA_DISABLED')).toBe(false);
    expect(isQaPublishGateCode('BUILD_LOCKED')).toBe(false);
    expect(isQaPublishGateCode(null)).toBe(false);
    expect(isQaPublishGateCode(undefined)).toBe(false);
  });

  it('builds the QA page link with an optional run id', () => {
    expect(qaPageHref(7)).toBe('/decks/qa?deckId=7');
    expect(qaPageHref(7, null)).toBe('/decks/qa?deckId=7');
    expect(qaPageHref(7, 'a b/c')).toBe('/decks/qa?deckId=7&runId=a%20b%2Fc');
  });

  it('has a plain message for every start refusal code', () => {
    expect(Object.keys(QA_START_ERROR_MESSAGES).sort()).toEqual(
      [
        'AI_QA_DISABLED',
        'CONFIG_ERROR',
        'AI_QA_RUN_IN_PROGRESS',
        'AI_QA_NOTHING_TO_REVIEW',
        'AI_QA_TOO_MANY_CARDS',
        'AI_QA_DAILY_CAP',
        'DECK_NOT_FOUND',
      ].sort(),
    );
    for (const message of Object.values(QA_START_ERROR_MESSAGES)) {
      expect(message).toMatch(/^[A-Z].*\.$/);
    }
    expect(QA_CATEGORIES).toHaveLength(9);
    for (const category of QA_CATEGORIES) expect(QA_CATEGORY_LABELS[category]).toBeTruthy();
    expect(Object.keys(QA_ITEM_ERROR_LABELS)).toHaveLength(10);
    expect(qaItemErrorLabel('REFUSAL')).toBe('The model declined to review this card.');
    expect(qaItemErrorLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
