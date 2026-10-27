import type { ImportCardInput } from '../api/authoring';
import type { Card } from '../types/card';
import type { ApiResult } from '../types/api';
import type { ReleaseAction, ReleaseBundle, ReleaseKind, ReleaseSession, ReleaseSnapshot } from '../types/contentRelease';
import { isValidDifficulty, isValidStableUid } from './cardRules';
import { parseFrontHelp, normalizeFrontHelpForCompare } from './frontHelp';
import { normalizeMcqForCompare, validateMcq } from './mcqRules';
import { isValidSourceUrl, normalizeSourceForCompare } from './sourceRules';
import { normalizeTranslationsForCompare, validateTranslation } from './translationRules';

const SHA256 = /^[0-9a-f]{64}$/;
const TEXT_FIELDS = ['question', 'explanation', 'codeSnippet', 'codeLanguage', 'realWorldUsage', 'topic'] as const;
const EVIDENCE_KEYS = ['runId', 'batchAuthorizationRef', 'authorizationScope', 'model', 'mainSHA', 'evidenceRef', 'evidenceHash', 'evidenceVersion', 'reportRef', 'reportHash', 'reportVersion', 'promptHash', 'promptVersion', 'corpusHash', 'corpusVersion', 'expiresAt', 'cards'];
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function object(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  requireValue(Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)), `Expected exactly these fields: ${expected.join(', ')}.`);
}
function text(value: unknown, max = 160): asserts value is string {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Expected nonempty text of at most ${max} characters.`);
}
function hash(value: unknown): asserts value is string { requireValue(typeof value === 'string' && SHA256.test(value), 'Expected a lowercase SHA-256.'); }
export function assertEvidenceFresh(bundle: ReleaseBundle, now = Date.now()) {
  const expiry = Date.parse(bundle.review.expiresAt);
  requireValue(Number.isFinite(expiry) && expiry > now && expiry <= now + 24 * 60 * 60 * 1000, 'Model evidence expiry must be within the next 24 hours.');
}

/** Structural validation only: it does not perform or claim model/human content review. */
export function parseReleaseBundle(raw: string, now = Date.now(), requireFresh = true): ReleaseBundle {
  requireValue(raw.length <= 3_000_000, 'Release bundle is too large.');
  const bundle = object(JSON.parse(raw));
  keys(bundle, ['schema', 'deckId', 'deckSlug', 'releaseId', 'cards', 'review']);
  requireValue(bundle.schema === 'aws-basics-release-bundle-v1' && bundle.deckId === 15 && bundle.deckSlug === 'aws-saa-fundamentals', 'This page accepts only the AWS Basics release bundle v1 for deck 15.');
  text(bundle.releaseId);
  requireValue(Array.isArray(bundle.cards) && bundle.cards.length === 337, 'The frozen release must contain exactly 337 cards.');
  const uids = new Set<string>(); const orders = new Set<number>();
  for (const rawCard of bundle.cards) {
    const card = object(rawCard);
    keys(card, ['stableUid', ...TEXT_FIELDS, 'difficulty', 'orderInDeck', 'mcq', 'source', 'frontHelp', 'translations']);
    requireValue(typeof card.stableUid === 'string' && isValidStableUid(card.stableUid) && !uids.has(card.stableUid), 'Invalid or duplicate stable UID.');
    uids.add(card.stableUid);
    for (const field of TEXT_FIELDS) requireValue(typeof card[field] === 'string' && (field === 'codeSnippet' || card[field] === card[field].trim()), `${card.stableUid}: ${field} must be canonical text.`);
    requireValue(Boolean(card.question) && Boolean(card.explanation), `${card.stableUid}: English question and explanation are required.`);
    requireValue(typeof card.difficulty === 'number' && isValidDifficulty(card.difficulty), 'Invalid difficulty.');
    requireValue(typeof card.orderInDeck === 'number' && Number.isInteger(card.orderInDeck) && card.orderInDeck >= 1 && card.orderInDeck <= 100_000_000 && !orders.has(card.orderInDeck), 'Invalid or duplicate card order.');
    orders.add(card.orderInDeck);
    requireValue(parseFrontHelp(card.frontHelp) !== undefined, `${card.stableUid}: Invalid frontHelp.`);
    const source = object(card.source); keys(source, ['url', 'quote']);
    requireValue(typeof source.url === 'string' && isValidSourceUrl(source.url) && (source.quote === null || typeof source.quote === 'string' && source.quote.length <= 1000), `${card.stableUid}: Invalid source.`);
    const typed = card as unknown as ImportCardInput;
    if (card.mcq !== null) {
      const mcq = object(card.mcq); keys(mcq, ['v', 'qualifier', 'shuffle', 'options']);
      requireValue(mcq.v === 1 && (mcq.qualifier === null || typeof mcq.qualifier === 'string') && typeof mcq.shuffle === 'boolean' && Array.isArray(mcq.options), 'Invalid MCQ shape.');
      for (const rawOption of mcq.options) {
        const option = object(rawOption); keys(option, ['key', 'text', 'why', 'correct']);
        requireValue(typeof option.key === 'string' && typeof option.text === 'string' && (option.why === null || typeof option.why === 'string') && typeof option.correct === 'boolean', 'Invalid MCQ option.');
      }
      requireValue(validateMcq({ ...typed, mcq: typed.mcq! }).length === 0, `${card.stableUid}: MCQ validation failed.`);
    }
    requireValue(object(card.translations)['zh-CN'] !== undefined, `${card.stableUid}: zh-CN translation is required.`);
    const issues = validateTranslation({ translations: card.translations, english: { ...typed, realWorldUsage: typed.realWorldUsage || null }, deckLocale: 'en-US' });
    requireValue(issues.length === 0, `${card.stableUid}: ${issues.map(issue => issue.message).join(' ')}`);
  }
  const review = object(bundle.review); keys(review, EVIDENCE_KEYS);
  for (const field of EVIDENCE_KEYS.filter(key => key !== 'cards')) {
    const max = ['batchAuthorizationRef', 'evidenceRef', 'reportRef'].includes(field) ? 2000 : ['model', 'evidenceVersion', 'reportVersion', 'promptVersion', 'corpusVersion'].includes(field) ? 200 : field === 'authorizationScope' ? 500 : 160;
    text(review[field], max);
  }
  for (const field of ['evidenceHash', 'reportHash', 'promptHash', 'corpusHash']) hash(review[field]);
  requireValue(typeof review.mainSHA === 'string' && /^[0-9a-fA-F]{40}$/.test(review.mainSHA), 'mainSHA must be a 40-character commit SHA.');
  requireValue(review.authorizationScope === 'aws-saa-fundamentals:full-deck-bilingual-release', 'Batch authorization must cover the entire bilingual release.');
  requireValue(Array.isArray(review.cards) && review.cards.length === 337, 'Model review must cover all 337 cards.');
  const seen = new Set<string>();
  for (const rawReview of review.cards) {
    const item = object(rawReview);
    keys(item, ['stableUid', 'verdict', 'cardContentHash', 'schema', 'revision', 'orderInDeck', 'blockers', 'unknowns']);
    requireValue(typeof item.stableUid === 'string' && uids.has(item.stableUid) && !seen.has(item.stableUid), 'Model review UID coverage differs from the candidate.');
    seen.add(item.stableUid); hash(item.cardContentHash);
    requireValue(item.verdict === 'PASS' && ['legacy-v1', 'front-help-v1'].includes(String(item.schema)) && typeof item.revision === 'number' && Number.isSafeInteger(item.revision) && item.revision >= 1, 'Every model review needs PASS, schema and a positive revision.');
    requireValue(Array.isArray(item.blockers) && item.blockers.length === 0 && Array.isArray(item.unknowns) && item.unknowns.length === 0, 'Model review blockers and unknowns must be empty.');
    requireValue(bundle.cards.some((card: ImportCardInput) => card.stableUid === item.stableUid && card.orderInDeck === item.orderInDeck), 'Model review order differs from the candidate.');
  }
  const result = bundle as unknown as ReleaseBundle;
  requireValue(Number.isFinite(Date.parse(result.review.expiresAt)), 'Invalid evidence expiry.');
  if (requireFresh) assertEvidenceFresh(result, now);
  return result;
}

export function assertReleaseSnapshot(snapshot: ReleaseSnapshot): void {
  requireValue(snapshot?.deckId === 15 && snapshot.deck?.id === 15 && snapshot.deck.slug === 'aws-saa-fundamentals', 'Snapshot deck does not match AWS Basics.');
  requireValue(snapshot.policy === 'aws-codex-bilingual-v1' && snapshot.reviewSchema === 'codex-release-review-v1', 'Unsupported server release policy or schema.');
  for (const value of [snapshot.editingSnapshot, snapshot.publishSnapshot, snapshot.policyHash, snapshot.schemaHash]) hash(value);
  requireValue(Object.hasOwn(snapshot.deck, 'live_build_id') && (snapshot.deck.live_build_id === null || typeof snapshot.deck.live_build_id === 'string'), 'Snapshot is missing the live baseline.');
  requireValue(Array.isArray(snapshot.backup) && Array.isArray(snapshot.cards), 'Snapshot is missing the complete editing backup.');
  for (const card of snapshot.cards) requireValue(snapshot.backup.some(row => row.stable_uid === card.stableUid && Number(row.is_deleted) === 0 && Number(row.version) === card.version && Number(row.revision) === card.revision), 'Snapshot backup is incomplete or inconsistent.');
}

export function assertOriginalLive(session: ReleaseSession, snapshot: ReleaseSnapshot) {
  assertReleaseSnapshot(snapshot);
  requireValue(snapshot.deck.live_build_id === session.baseline.deck.live_build_id, 'Live build changed since the initial backup. This release cannot rebase onto it.');
}

/** Mirrors the import reconciler, preserving code whitespace and checking help explicitly. */
export function canonicalReleaseCard(card: ImportCardInput | Card): string {
  return JSON.stringify([
    card.stableUid, card.orderInDeck, card.difficulty,
    ...TEXT_FIELDS.map(field => field === 'codeSnippet' ? card[field] ?? '' : (card[field] ?? '').trim()),
    normalizeMcqForCompare(card.mcq), normalizeSourceForCompare(card.source),
    normalizeFrontHelpForCompare(card.frontHelp), normalizeTranslationsForCompare(card.translations),
  ]);
}

export function verifyReleaseReadback(session: ReleaseSession, snapshot: ReleaseSnapshot, cards: Card[]): void {
  assertOriginalLive(session, snapshot);
  requireValue(cards.length === 337 && snapshot.cards.length === 337 && new Set(cards.map(card => card.stableUid)).size === 337, 'Readback must contain exactly the 337 unique candidate UIDs.');
  const byUid = new Map(cards.map(card => [card.stableUid, card]));
  for (const candidate of session.bundle.cards) {
    const actual = byUid.get(candidate.stableUid);
    const meta = snapshot.cards.find(card => card.stableUid === candidate.stableUid);
    const reviewed = session.bundle.review.cards.find(card => card.stableUid === candidate.stableUid);
    requireValue(actual && actual.deckId === 15 && actual.isDeleted !== 1 && Number.isSafeInteger(actual.version) && actual.version >= 1 && Number.isSafeInteger(actual.revision) && meta && meta.version === actual.version && meta.revision === actual.revision && meta.orderInDeck === actual.orderInDeck, `${candidate.stableUid}: Readback is missing a UID/version/revision or changed during verification.`);
    requireValue(canonicalReleaseCard(candidate) === canonicalReleaseCard(actual) && actual.translations?.['zh-CN'] && actual.translationStatus?.['zh-CN'] === 'ok', `${candidate.stableUid}: Readback content differs, is missing bilingual content/help, or has a stale translation.`);
    requireValue(reviewed && ['cardContentHash', 'schema', 'revision', 'orderInDeck'].every(field => reviewed[field as keyof typeof reviewed] === meta[field as keyof typeof meta]), `${candidate.stableUid}: Local model PASS does not match the server hash/schema/revision/order.`);
  }
}

export function prepareReleaseAction(session: ReleaseSession, kind: ReleaseKind, actionId: string): ReleaseAction {
  requireValue(!session.actions[kind], 'This logical action is already frozen; query it before replay.');
  text(actionId);
  const { bundle, baseline } = session;
  const common = { deckId: 15, releaseId: bundle.releaseId, expectedLive: baseline.deck.live_build_id };
  let body: object;
  if (kind === 'import') {
    assertReleaseSnapshot(baseline);
    requireValue(baseline.cards.every(card => bundle.cards.some(candidate => candidate.stableUid === card.stableUid)), 'Candidate omits an existing live UID.');
    body = { ...common, idempotencyKey: actionId, expectedEditingSnapshot: baseline.editingSnapshot, cards: bundle.cards };
  } else {
    const snapshot = session.verifiedSnapshot;
    requireValue(session.actions.import?.outcome === 'confirmed' && snapshot, 'Confirm import and verify full readback first.');
    assertOriginalLive(session, snapshot);
    assertEvidenceFresh(bundle);
    if (kind === 'review') body = { ...bundle.review, ...common, actionId, expectedEditingSnapshot: snapshot.editingSnapshot, policy: snapshot.policy, policyHash: snapshot.policyHash, reviewSchema: snapshot.reviewSchema, schemaHash: snapshot.schemaHash, reviewedBy: 'codex', humanPerCardReview: false };
    else {
      const receiptId = session.actions.review?.result?.data?.receiptId;
      requireValue(session.actions.review?.outcome === 'confirmed' && typeof receiptId === 'string' && receiptId.length > 0, 'Confirm the review receipt before publishing.');
      requireValue(JSON.parse(session.actions.review.payload).expectedEditingSnapshot === snapshot.editingSnapshot, 'Editing content changed after the review receipt. Publishing is blocked.');
      body = { ...common, actionId, receiptId, expectedEditingSnapshot: snapshot.editingSnapshot };
    }
  }
  const payload = JSON.stringify(body);
  requireValue(payload.length <= (kind === 'import' ? 900_000 : 768_000), 'Frozen request exceeds the server payload limit.');
  return { kind, actionId, payload, outcome: 'unknown', queried: false };
}

export function assertReplayAllowed(action: ReleaseAction) {
  requireValue(action.queried && (action.outcome === 'unknown' || action.kind === 'publish'), 'Query the action before retrying its identical request.');
}

export function decodeCommittedAction(raw: { Body?: string; body?: string; StatusCode?: number; statusCode?: number }): ApiResult<Record<string, unknown>> {
  requireValue((raw.StatusCode ?? raw.statusCode) === 200, 'Action query returned a non-success committed response.');
  const result = JSON.parse(raw.Body ?? raw.body ?? '') as ApiResult<Record<string, unknown>>;
  requireValue(result.success && result.data && typeof result.data === 'object', 'Action query is missing its committed response.');
  return result;
}

export function parseReleaseSession(raw: string): ReleaseSession {
  const session = object(JSON.parse(raw)) as unknown as ReleaseSession;
  requireValue(session.schema === 'aws-basics-console-session-v1', 'Unsupported recovery journal.');
  assertReleaseSnapshot(session.baseline);
  session.bundle = parseReleaseBundle(JSON.stringify(session.bundle), Date.now(), false);
  object(session.actions);
  for (const [kind, action] of Object.entries(session.actions)) {
    requireValue(['import', 'review', 'publish'].includes(kind) && action?.kind === kind && typeof action.payload === 'string' && ['confirmed', 'unknown'].includes(action.outcome) && typeof action.queried === 'boolean', 'Invalid journal action.');
    text(action.actionId);
    const body = object(JSON.parse(action.payload));
    requireValue(body.deckId === 15 && body.releaseId === session.bundle.releaseId && body.expectedLive === session.baseline.deck.live_build_id && body[kind === 'import' ? 'idempotencyKey' : 'actionId'] === action.actionId, 'Recovery action does not match the frozen release or original live baseline.');
    hash(body.expectedEditingSnapshot);
    if (kind === 'import') requireValue(body.expectedEditingSnapshot === session.baseline.editingSnapshot && JSON.stringify(body.cards) === JSON.stringify(session.bundle.cards), 'Recovery import differs from its frozen backup or candidate.');
    action.queried = false;
  }
  if (session.verifiedSnapshot) assertOriginalLive(session, session.verifiedSnapshot);
  return session;
}
