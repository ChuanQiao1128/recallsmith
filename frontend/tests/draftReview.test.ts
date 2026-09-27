// The pure review-queue rules in src/lib/draftReview.ts. The lint is the
// importer's own rule set (serialise, then parse back), so these cases assert
// importer codes rather than a second copy of the rules.

import { describe, expect, it } from 'vitest';

import {
  DRAFT_NOTE_MAX_LENGTH,
  DRAFT_REJECT_REASONS,
  draftDecisionMessage,
  draftToDeckCardContent,
  draftToFormValues,
  formValuesToDraftCard,
  lintDraftCard,
  REVIEW_MS_CAP,
  reviewClockMs,
  reviewDurationMs,
  setReviewClockVisible,
  startReviewClock,
  sourceHostLabel,
} from '../src/lib/draftReview';
import { DRAFT_DECK_SLUG, mcqDraftCard, qaDraftCard } from './support/draftFixtures';

describe('src/lib/draftReview', () => {
  it('round-trips a draft through the card form values without losing the MCQ block', () => {
    const card = mcqDraftCard();
    const values = draftToFormValues(card);

    expect(values.sourceUrl).toBe(card.source.url);
    expect(values.sourceQuote).toBe(card.source.quote);
    expect(values.codeSnippet).toBe('');
    expect(values.orderInDeck).toBe(10);
    expect(values.revision).toBe(1);

    const back = formValuesToDraftCard(values, card);
    expect(back).toEqual({ ...card, codeSnippet: null, codeLanguage: null });
    expect(back.mcq).toBe(card.mcq);

    const content = draftToDeckCardContent(back);
    expect(content.mcq).toBe(card.mcq);
    expect(content.source).toEqual({ url: card.source.url, quote: card.source.quote });
    expect(lintDraftCard(DRAFT_DECK_SLUG, back).ok).toBe(true);
  });

  it('trims edited values and turns blank optional text into null', () => {
    const card = qaDraftCard();
    const values = { ...draftToFormValues(card), topic: '   ', question: '  Edited?  ', realWorldUsage: ' ' };
    const back = formValuesToDraftCard(values, card);
    expect(back.topic).toBeNull();
    expect(back.question).toBe('Edited?');
    expect(back.realWorldUsage).toBeNull();
    expect(draftToDeckCardContent(back)).not.toHaveProperty('topic');
    expect(draftToDeckCardContent(back)).not.toHaveProperty('mcq');
  });

  it('flags a draft without a supporting quote as SOURCE_REQUIRED', () => {
    const lint = lintDraftCard(DRAFT_DECK_SLUG, qaDraftCard({ source: { url: 'https://docs.aws.amazon.com/s3/', quote: '  ' } }));
    expect(lint.ok).toBe(false);
    expect(lint.issues).toContainEqual({
      code: 'SOURCE_REQUIRED',
      message: 'A draft needs a source URL and a supporting quote.',
    });
  });

  it('reports importer issues for a malformed stable uid', () => {
    const lint = lintDraftCard(DRAFT_DECK_SLUG, qaDraftCard({ stableUid: 'Bad UID!' }));
    expect(lint.ok).toBe(false);
    expect(lint.issues.length).toBeGreaterThan(0);
    expect(lint.issues.some(issue => issue.code === 'BAD_UID_FORMAT' || issue.code === 'BAD_CARD_HEADER')).toBe(true);
  });

  it('reports a non-https source URL through the importer rules', () => {
    const lint = lintDraftCard(
      DRAFT_DECK_SLUG,
      qaDraftCard({ source: { url: 'http://docs.aws.amazon.com/s3/', quote: 'its standard retrieval finishes in 3 to 5 hours' } }),
    );
    expect(lint.ok).toBe(false);
    expect(lint.issues.map(issue => issue.code)).toContain('BAD_SOURCE_URL');
  });

  it('passes a clean sourced draft', () => {
    const lint = lintDraftCard(DRAFT_DECK_SLUG, qaDraftCard());
    expect(lint).toEqual({ ok: true, issues: [], warnings: [] });
  });

  it('measures review time from open to decision and never below zero', () => {
    expect(reviewDurationMs(1_000, 43_500)).toBe(42_500);
    expect(reviewDurationMs(1_000, 1_000.6)).toBe(1);
    expect(reviewDurationMs(5_000, 1_000)).toBe(0);
  });

  it('lists the seven reject reasons and marks the four defect reasons', () => {
    expect(DRAFT_REJECT_REASONS.map(r => r.value)).toEqual([
      'incorrect',
      'ambiguous',
      'duplicate',
      'unsupported_source',
      'off_topic',
      'low_value',
      'other',
    ]);
    expect(DRAFT_REJECT_REASONS.filter(r => r.defect).map(r => r.value)).toEqual([
      'incorrect',
      'ambiguous',
      'duplicate',
      'unsupported_source',
    ]);
    expect(DRAFT_REJECT_REASONS.find(r => r.value === 'unsupported_source')?.label).toBe('Not supported by the source');
    expect(DRAFT_NOTE_MAX_LENGTH).toBe(500);
  });

  it('maps decision conflicts to plain messages', () => {
    expect(draftDecisionMessage('DRAFT_NOT_PENDING', 'x')).toBe(
      'This draft was already decided, in another tab or by another reviewer. The list has been refreshed.',
    );
    expect(draftDecisionMessage('STABLE_UID_TAKEN', 'x')).toBe(
      'A live card already uses this stable uid. Edit the uid, then use Accept with edits.',
    );
    expect(draftDecisionMessage('DRAFT_NOT_FOUND', 'x')).toBe('This draft no longer exists.');
    expect(draftDecisionMessage('VALIDATION_ERROR', 'Question is too long.')).toBe('Question is too long.');
    expect(draftDecisionMessage(undefined, 'Server said no.')).toBe('Server said no.');
  });

  it('labels an https source by its host and refuses anything else', () => {
    expect(sourceHostLabel('https://www.example.com/a/b')).toBe('example.com');
    expect(sourceHostLabel('https://docs.aws.amazon.com/s3/')).toBe('docs.aws.amazon.com');
    expect(sourceHostLabel('http://example.com/')).toBeNull();
    expect(sourceHostLabel('not a url')).toBeNull();
  });

  it('counts review time only across visible stretches and caps it', () => {
    let clock = startReviewClock(1_000, true);
    expect(reviewClockMs(clock, 11_000)).toBe(10_000);
    clock = setReviewClockVisible(clock, false, 11_000);
    expect(reviewClockMs(clock, 3_611_000)).toBe(10_000);
    // A repeated hidden event changes nothing.
    expect(setReviewClockVisible(clock, false, 20_000)).toEqual(clock);
    clock = setReviewClockVisible(clock, true, 3_611_000);
    expect(setReviewClockVisible(clock, true, 3_612_000)).toEqual(clock);
    expect(reviewClockMs(clock, 3_616_000)).toBe(15_000);

    const hiddenAtOpen = startReviewClock(1_000, false);
    expect(reviewClockMs(hiddenAtOpen, 900_000)).toBe(0);

    expect(REVIEW_MS_CAP).toBe(30 * 60_000);
    expect(reviewClockMs(startReviewClock(0, true), 5 * 60 * 60_000)).toBe(REVIEW_MS_CAP);
  });
});
