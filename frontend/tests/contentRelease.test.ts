import { describe, expect, it } from 'vitest';
import { assertReleaseSnapshot, assertReplayAllowed, canonicalReleaseCard, parseReleaseBundle, parseReleaseSession, prepareReleaseAction, verifyReleaseReadback } from '../src/lib/contentRelease';
import { releaseFixture } from './support/contentReleaseFixtures';
import { ok } from './support/apiResult';

describe('immutable AWS Basics bundle contract', () => {
  it('accepts the documented synthetic 337-card bilingual/help contract without inventing review fields', () => {
    const { bundle } = releaseFixture();
    expect(parseReleaseBundle(JSON.stringify(bundle))).toEqual(bundle);
  });
  it.each(['cards', 'review', 'source', 'frontHelp', 'translations', 'hash', 'uid', 'scope', 'sha', 'extra', 'blocker', 'expiry'])('rejects malformed %s evidence before writes', (field) => {
    const { bundle } = releaseFixture();
    const raw = bundle as unknown as Record<string, unknown>;
    if (field === 'cards') bundle.cards.pop();
    if (field === 'review') bundle.review.cards.pop();
    if (field === 'source') bundle.cards[0].source.url = 'http://example.com';
    if (field === 'frontHelp') delete (bundle.cards[0] as Partial<typeof bundle.cards[0]>).frontHelp;
    if (field === 'translations') bundle.cards[0].translations = {};
    if (field === 'hash') bundle.review.cards[0].cardContentHash = 'bad';
    if (field === 'uid') bundle.cards[0].stableUid = bundle.cards[1].stableUid;
    if (field === 'scope') raw.review = { ...bundle.review, authorizationScope: 'other-scope' };
    if (field === 'sha') bundle.review.mainSHA = 'not-a-main-sha';
    if (field === 'extra') raw.humanPerCardReview = true;
    if (field === 'blocker') raw.review = { ...bundle.review, cards: [{ ...bundle.review.cards[0], blockers: ['unresolved'] }, ...bundle.review.cards.slice(1)] };
    if (field === 'expiry') bundle.review.expiresAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    expect(() => parseReleaseBundle(JSON.stringify(bundle))).toThrow();
  });
});

describe('exact readback, snapshot and provenance gates', () => {
  it('accepts complete matching server identities and local model PASS bindings', () => {
    const { session, snapshot, cards } = releaseFixture();
    expect(() => verifyReleaseReadback(session, snapshot, cards)).not.toThrow();
  });
  it.each(['question', 'zh', 'help', 'zhHelp', 'source', 'difficulty', 'order', 'uid', 'version', 'revision', 'hash', 'schema', 'stale', 'live', 'missing'])('blocks mismatching %s readback', field => {
    const { session, snapshot, cards } = releaseFixture();
    if (field === 'question') cards[0].question += ' changed';
    if (field === 'zh') cards[0].translations!['zh-CN']!.explanation += ' changed';
    if (field === 'help') cards[0].frontHelp![0].definition += ' changed';
    if (field === 'zhHelp') cards[0].translations!['zh-CN']!.frontHelp![0].definition += ' changed';
    if (field === 'source') cards[0].source!.quote += ' changed';
    if (field === 'difficulty') cards[0].difficulty = 1;
    if (field === 'order') cards[0].orderInDeck = 9999;
    if (field === 'uid') cards[0].stableUid = 'unexpected';
    if (field === 'version') delete (cards[0] as Partial<typeof cards[0]>).version;
    if (field === 'revision') cards[0].revision = null;
    if (field === 'hash') snapshot.cards[0].cardContentHash = '0'.repeat(64);
    if (field === 'schema') snapshot.cards[0].schema = 'legacy-v1';
    if (field === 'stale') cards[0].translationStatus!['zh-CN'] = 'stale';
    if (field === 'live') snapshot.deck.live_build_id = 'concurrent-live';
    if (field === 'missing') cards.pop();
    expect(() => verifyReleaseReadback(session, snapshot, cards)).toThrow();
  });
  it('preserves code whitespace, unlike the general markdown reconciler', () => {
    const { cards } = releaseFixture();
    expect(canonicalReleaseCard({ ...cards[0], codeSnippet: '  code' })).not.toBe(canonicalReleaseCard({ ...cards[0], codeSnippet: 'code' }));
  });
  it('refuses a snapshot that cannot supply a complete active-card backup', () => {
    const { snapshot } = releaseFixture(); snapshot.backup.pop();
    expect(() => assertReleaseSnapshot(snapshot)).toThrow(/backup/);
  });
  it('takes policy/schema from the current snapshot, preserves expectedLive, and never claims human review', () => {
    const { session, snapshot } = releaseFixture();
    session.actions.import = { ...prepareReleaseAction(session, 'import', 'import'), outcome: 'confirmed' };
    session.verifiedSnapshot = snapshot;
    const review = prepareReleaseAction(session, 'review', 'review');
    const body = JSON.parse(review.payload);
    expect(body).toMatchObject({ expectedLive: 'original-live', reviewedBy: 'codex', humanPerCardReview: false, policyHash: snapshot.policyHash, schemaHash: snapshot.schemaHash, cards: session.bundle.review.cards });
    session.actions.review = { ...review, outcome: 'confirmed', result: ok({ receiptId: 'receipt' }) };
    expect(JSON.parse(prepareReleaseAction(session, 'publish', 'publish').payload)).toMatchObject({ receiptId: 'receipt', expectedLive: 'original-live' });
    session.verifiedSnapshot = { ...snapshot, editingSnapshot: '0'.repeat(64) };
    expect(() => prepareReleaseAction(session, 'publish', 'publish')).toThrow(/changed after/);
  });
});

describe('uncertain outcomes preserve the original logical action', () => {
  it('requires query before identical-key replay, rejects second logical action and restores exact bytes', () => {
    const { session } = releaseFixture();
    const action = prepareReleaseAction(session, 'import', 'import');
    session.actions.import = action;
    expect(() => assertReplayAllowed(action)).toThrow(/Query/);
    expect(() => prepareReleaseAction(session, 'import', 'new-key')).toThrow(/frozen/);
    action.queried = true;
    expect(() => assertReplayAllowed(action)).not.toThrow();
    const restored = parseReleaseSession(JSON.stringify(session));
    expect(restored.actions.import?.payload).toBe(action.payload);
    expect(restored.actions.import?.actionId).toBe('import');
    restored.baseline.deck.live_build_id = 'new-baseline';
    expect(() => parseReleaseSession(JSON.stringify(restored))).toThrow(/original live/);
  });
});
