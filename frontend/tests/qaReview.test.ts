// The AI QA page's pure rules (src/lib/qaReview.ts) and the deck list's gate
// helpers (src/lib/qaGate.ts).

import { describe, expect, it } from 'vitest';

import {
  QA_CATEGORIES,
  QA_CATEGORY_LABELS,
  QA_ITEM_ERROR_LABELS,
  QA_START_ERROR_MESSAGES,
  QA_EST_USD_PER_CARD_DEFAULT,
  QA_DAILY_USD_CAP,
  QA_MAX_CARDS,
  cardPasses,
  cardVerdict,
  estimateQaCostUsd,
  formatUsd,
  groupFindingsByCard,
  isQaRunActive,
  qaCardsToReview,
  qaCapRemainingUsd,
  qaItemErrorLabel,
  qaLimits,
  qaStartErrorMessage,
} from '../src/lib/qaReview';
import { QA_PUBLISH_GATE_CODES, isQaPublishGateCode, qaPageHref } from '../src/lib/qaGate';
import { qaCards, qaFinding, qaItem } from './support/qaFixtures';

describe('qaReview', () => {
  it("estimates cost at the server's per-card reservation, the reported rate first (frontend-console-23)", () => {
    // The server reserves AI_QA_EST_USD_PER_CARD (default $0.05) per card against
    // the daily cap; this used to price $0.045 and so under-warned near the cap.
    expect(QA_EST_USD_PER_CARD_DEFAULT).toBe(0.05);
    expect(estimateQaCostUsd(1)).toBeCloseTo(0.05, 10);
    expect(estimateQaCostUsd(10)).toBeCloseTo(0.5, 10);
    expect(estimateQaCostUsd(0)).toBe(0);
    expect(estimateQaCostUsd(10, 0.08)).toBeCloseTo(0.8, 10);
    expect(estimateQaCostUsd(10, null)).toBeCloseTo(0.5, 10);
    // The finding's example: cap $10, $2 spent, 170 cards: $8.50 is over the $8 left.
    const limits = qaLimits({ maxCards: 200, dailyUsdCap: 10, spentTodayUsd: 2 });
    expect(estimateQaCostUsd(170, limits.estUsdPerCard)).toBeGreaterThan(qaCapRemainingUsd(limits));
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
    expect(groups[0].verdict).toBe('flagged');
    expect(groups[2]).toMatchObject({ cardId: 999, itemStatus: null, question: null, passes: true, verdict: 'passed' });
    // An errored item was never reviewed, so it must not read as passed
    // (frontend-console-1; this assertion used to expect passes: true).
    expect(groups[3]).toMatchObject({
      itemStatus: 'error',
      itemErrorCode: 'PROVIDER_TIMEOUT',
      passes: false,
      verdict: 'not_reviewed',
      findings: [],
    });
  });

  it('gives a three-state verdict from the item status, never Passed for an unreviewed card', () => {
    const items = [
      qaItem(101, 'aws-s3-storage-classes', { status: 'queued' }),
      qaItem(102, 'aws-s3-cloudfront-oac', { status: 'refused', errorCode: 'REFUSAL' }),
      qaItem(103, 'aws-iam-roles-vs-users', { status: 'skipped' }),
      qaItem(104, 'x-done'),
      qaItem(105, 'x-done-minor'),
    ];
    const findings = [qaFinding({ findingId: 1, cardId: 105, severity: 'minor' })];
    const byId = new Map(groupFindingsByCard(findings, items, qaCards).map(g => [g.cardId, g]));
    expect(byId.get(101)).toMatchObject({ verdict: 'pending', passes: false });
    expect(byId.get(102)).toMatchObject({ verdict: 'not_reviewed', passes: false });
    expect(byId.get(103)).toMatchObject({ verdict: 'not_reviewed', passes: false });
    expect(byId.get(104)).toMatchObject({ verdict: 'passed', passes: true });
    expect(byId.get(105)).toMatchObject({ verdict: 'passed', passes: true });

    expect(cardVerdict('queued', [])).toBe('pending');
    expect(cardVerdict('error', [])).toBe('not_reviewed');
    expect(cardVerdict('done', [{ severity: 'major' }])).toBe('flagged');
    expect(cardVerdict('queued', [{ severity: 'blocker' }])).toBe('flagged');
    expect(cardVerdict(null, [{ severity: 'minor' }])).toBe('passed');
  });

  it('uses the server run limits when the status carries them, else the labelled defaults', () => {
    expect(qaLimits(null)).toEqual({
      maxCards: QA_MAX_CARDS,
      dailyUsdCap: QA_DAILY_USD_CAP,
      spentTodayUsd: null,
      reservedTodayUsd: null,
      estUsdPerCard: null,
      fromServer: false,
    });
    const limits = qaLimits({ maxCards: 50, dailyUsdCap: 2, spentTodayUsd: 1.5 });
    expect(limits).toEqual({
      maxCards: 50,
      dailyUsdCap: 2,
      spentTodayUsd: 1.5,
      reservedTodayUsd: null,
      estUsdPerCard: null,
      fromServer: true,
    });
    expect(qaLimits({ maxCards: 50, dailyUsdCap: 2, spentTodayUsd: 0, estUsdPerCard: 0.07 }).estUsdPerCard).toBe(0.07);
    expect(qaCapRemainingUsd(limits)).toBeCloseTo(0.5, 10);
    expect(qaCapRemainingUsd(qaLimits({ maxCards: 50, dailyUsdCap: 2, spentTodayUsd: 9 }))).toBe(0);
    expect(qaStartErrorMessage('AI_QA_TOO_MANY_CARDS', 'x', limits)).toBe(
      'Too many cards for one run (the limit is 50). Narrow the scope.',
    );
    // frontend-console-12: without server limits the page knows only its
    // fallback, so the server's message (which names the real cap) is shown.
    expect(
      qaStartErrorMessage('AI_QA_TOO_MANY_CARDS', '150 cards exceed the per-run cap of 100', qaLimits(null)),
    ).toBe('150 cards exceed the per-run cap of 100');
    expect(qaStartErrorMessage('AI_QA_TOO_MANY_CARDS', '', qaLimits(null))).toBe(
      QA_START_ERROR_MESSAGES.AI_QA_TOO_MANY_CARDS,
    );
    // frontend-console-23: the server's cap refusal names spent, reserved and the
    // estimate; it is kept (this used to be replaced by "try again after
    // midnight"), with the narrower-scope way out added.
    expect(
      qaStartErrorMessage(
        'AI_QA_DAILY_CAP',
        'Daily AI QA cap $10.00 would be exceeded: spent $2.00, reserved $0.00, this run $8.50.',
        limits,
      ),
    ).toBe(
      'Daily AI QA cap $10.00 would be exceeded: spent $2.00, reserved $0.00, this run $8.50. Narrow the scope, or try again after midnight UTC.',
    );
    expect(qaStartErrorMessage('AI_QA_DAILY_CAP', '', limits)).toBe(QA_START_ERROR_MESSAGES.AI_QA_DAILY_CAP);
    expect(QA_START_ERROR_MESSAGES.AI_QA_DAILY_CAP).toContain('Narrow the scope');
    expect(qaStartErrorMessage('SOMETHING_NEW', 'Server text.', limits)).toBe('Server text.');
  });

  it('subtracts spend reserved by running runs from what is left of the cap (frontend-console-12)', () => {
    const limits = qaLimits({ maxCards: 100, dailyUsdCap: 10, spentTodayUsd: 4, reservedTodayUsd: 3.5 });
    expect(limits.reservedTodayUsd).toBe(3.5);
    expect(qaCapRemainingUsd(limits)).toBeCloseTo(2.5, 10);
    expect(qaCapRemainingUsd(qaLimits({ maxCards: 100, dailyUsdCap: 10, spentTodayUsd: 8, reservedTodayUsd: 5 }))).toBe(0);
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
