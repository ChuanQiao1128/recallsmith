import type { ImportCardInput } from '../api/authoring';
import type { Card } from '../types/card';
import type { ApiResult } from '../types/api';
import type { ReleaseAction, ReleaseBackupInventory, ReleaseBundle, ReleaseKind, ReleaseSession, ReleaseSnapshot } from '../types/contentRelease';
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

function integer(value: unknown, minimum = 1): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum; }
function nullableText(value: unknown) { return value === null || typeof value === 'string'; }
function timestamp(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function hasFields(row: Record<string, unknown>, fields: string[]) {
  requireValue(fields.every(field => Object.hasOwn(row, field)), 'Snapshot backup is missing required recoverable row fields.');
}
export function assertReleaseSnapshot(snapshot: ReleaseSnapshot): void {
  requireValue(snapshot?.deckId === 15 && snapshot.deck?.id === 15 && snapshot.deck.slug === 'aws-saa-fundamentals', 'Snapshot deck does not match AWS Basics.');
  requireValue(snapshot.policy === 'aws-codex-bilingual-v1' && snapshot.reviewSchema === 'codex-release-review-v1', 'Unsupported server release policy or schema.');
  for (const value of [snapshot.editingSnapshot, snapshot.publishSnapshot, snapshot.policyHash, snapshot.schemaHash]) hash(value);
  const deck = object(snapshot.deck);
  hasFields(deck, ['id', 'slug', 'title', 'author', 'description', 'locale', 'deck_type', 'is_deleted', 'version', 'created_at', 'updated_at', 'manifest_order', 'tier', 'availability', 'eta', 'retired_at_ms', 'download_mode', 'total_cards', 'preview_cards', 'live_build_id', 'translation_locales', 'release_generation']);
  requireValue(['title', 'author', 'locale'].every(field => typeof deck[field] === 'string') && ['description', 'eta', 'live_build_id'].every(field => nullableText(deck[field])) && deck.is_deleted === 0 && integer(deck.deck_type) && integer(deck.version) && integer(deck.manifest_order, 0) && integer(deck.total_cards, 0) && integer(deck.release_generation, 0) && (deck.preview_cards === null || integer(deck.preview_cards)) && (deck.retired_at_ms === null || integer(deck.retired_at_ms)) && timestamp(deck.created_at) && timestamp(deck.updated_at) && ['free', 'premium'].includes(String(deck.tier)) && ['live', 'coming', 'retired'].includes(String(deck.availability)) && ['public', 'auth', 'none'].includes(String(deck.download_mode)) && Array.isArray(deck.translation_locales) && deck.translation_locales.every(locale => typeof locale === 'string'), 'Snapshot backup deck fields are invalid.');
  requireValue(Array.isArray(snapshot.backup) && Array.isArray(snapshot.cards), 'Snapshot is missing the complete editing backup.');
  const rows = new Map<string, Record<string, unknown>>(); const ids = new Set<number>(); const orders = new Set<number>();
  for (const raw of snapshot.backup) {
    const row = object(raw);
    hasFields(row, ['id', 'deck_id', 'stable_uid', 'question', 'explanation', 'code_snippet', 'code_language', 'real_world_usage', 'difficulty', 'order_in_deck', 'revision', 'is_deleted', 'version', 'created_at', 'updated_at', 'topic', 'mcq', 'source', 'translations', 'translation_basis', 'front_help']);
    requireValue(integer(row.id) && !ids.has(row.id) && row.deck_id === 15 && typeof row.stable_uid === 'string' && isValidStableUid(row.stable_uid) && !rows.has(row.stable_uid) && typeof row.question === 'string' && ['explanation', 'code_snippet', 'code_language', 'real_world_usage', 'topic'].every(field => nullableText(row[field])) && typeof row.difficulty === 'number' && isValidDifficulty(row.difficulty) && integer(row.order_in_deck) && !orders.has(row.order_in_deck) && integer(row.version) && integer(row.revision) && (row.is_deleted === 0 || row.is_deleted === 1) && timestamp(row.created_at) && timestamp(row.updated_at), 'Snapshot backup card fields are invalid.');
    for (const field of ['mcq', 'source', 'translations', 'translation_basis']) if (row[field] !== null) object(row[field]);
    requireValue(parseFrontHelp(row.front_help) !== undefined, 'Snapshot backup front_help is invalid.');
    rows.set(row.stable_uid, row); ids.add(row.id); orders.add(row.order_in_deck);
  }
  const active = [...rows.values()].filter(row => row.is_deleted === 0); const seen = new Set<string>();
  requireValue(active.length === snapshot.cards.length, 'Snapshot backup active-card coverage is inconsistent.');
  for (const card of snapshot.cards) {
    const row = rows.get(card.stableUid);
    hash(card.cardContentHash);
    requireValue(!seen.has(card.stableUid) && row && row.is_deleted === 0 && integer(card.version) && integer(card.revision) && integer(card.orderInDeck) && ['legacy-v1', 'front-help-v1'].includes(card.schema) && row.version === card.version && row.revision === card.revision && row.order_in_deck === card.orderInDeck, 'Snapshot backup is incomplete or inconsistent.');
    const translations = row.translations as Record<string, Record<string, unknown>> | null;
    const hasHelp = Boolean(parseFrontHelp(row.front_help)?.length) || Object.values(translations ?? {}).some(translation => translation && typeof translation === 'object' && parseFrontHelp(translation.frontHelp)?.length);
    requireValue(card.schema === (hasHelp ? 'front-help-v1' : 'legacy-v1'), 'Snapshot backup schema metadata is inconsistent.');
    seen.add(card.stableUid);
  }
}

export function captureReleaseBackupInventory(snapshot: ReleaseSnapshot): ReleaseBackupInventory {
  assertReleaseSnapshot(snapshot);
  return {
    editingSnapshot: snapshot.editingSnapshot,
    rows: snapshot.backup.map(row => ({ id: row.id as number, stableUid: row.stable_uid as string, orderInDeck: row.order_in_deck as number, version: row.version as number, revision: row.revision as number, isDeleted: row.is_deleted as 0 | 1 })),
  };
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

export function isConfirmedAction(action: ReleaseAction | undefined): boolean {
  return action?.outcome === 'confirmed' && action.reconciled === true;
}
export function assertActionDependencies(session: ReleaseSession, kind: ReleaseKind) {
  // Recovery of any existing action must be reconciled before dependent or replay writes.
  requireValue(Object.values(session.actions).every(action => action.reconciled), 'Query every recovered action before continuing.');
  if (kind !== 'import') requireValue(isConfirmedAction(session.actions.import), 'Confirm import by response or query before continuing.');
  if (kind === 'publish') requireValue(isConfirmedAction(session.actions.review), 'Confirm the review receipt before publishing.');
}
function expectedActionBody(session: ReleaseSession, kind: ReleaseKind): object {
  const { bundle, baseline } = session;
  const common = { deckId: 15, releaseId: bundle.releaseId, expectedLive: baseline.deck.live_build_id };
  if (kind === 'import') {
    requireValue(baseline.cards.every(card => bundle.cards.some(candidate => candidate.stableUid === card.stableUid)), 'Candidate omits an existing live UID.');
    return { ...common, idempotencyKey: kind, expectedEditingSnapshot: baseline.editingSnapshot, cards: bundle.cards };
  }
  const snapshot = session.verifiedSnapshot;
  requireValue(session.actions.import && snapshot, 'Confirm import and verify full readback first.');
  assertOriginalLive(session, snapshot);
  requireValue(snapshot.cards.length === 337 && bundle.review.cards.every(reviewed => snapshot.cards.some(meta => ['stableUid', 'cardContentHash', 'schema', 'revision', 'orderInDeck'].every(field => reviewed[field as keyof typeof reviewed] === meta[field as keyof typeof meta]))), 'Verified snapshot differs from frozen model review bindings.');
  if (kind === 'review') return { ...bundle.review, ...common, actionId: kind, expectedEditingSnapshot: snapshot.editingSnapshot, policy: snapshot.policy, policyHash: snapshot.policyHash, reviewSchema: snapshot.reviewSchema, schemaHash: snapshot.schemaHash, reviewedBy: 'codex', humanPerCardReview: false };
  const review = session.actions.review;
  const receiptId = review?.result?.data?.receiptId;
  requireValue(typeof receiptId === 'string' && receiptId.length > 0, 'Confirm the review receipt before publishing.');
  requireValue(JSON.parse(review!.payload).expectedEditingSnapshot === snapshot.editingSnapshot, 'Editing content changed after the review receipt. Publishing is blocked.');
  return { ...common, actionId: kind, receiptId, expectedEditingSnapshot: snapshot.editingSnapshot };
}
function structurallyEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => structurallyEqual(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>; const b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && structurallyEqual(a[key], b[key]));
}
export function assertFrozenAction(session: ReleaseSession, action: ReleaseAction) {
  requireValue(action.actionId === action.kind, 'Recovery action must use its fixed logical action ID.');
  requireValue(action.payload.length <= (action.kind === 'import' ? 900_000 : 768_000), 'Frozen request exceeds the server payload limit.');
  requireValue(structurallyEqual(object(JSON.parse(action.payload)), expectedActionBody(session, action.kind)), 'Recovery action differs from its frozen bundle, original live baseline, verified snapshot or review receipt.');
}
export function prepareReleaseAction(session: ReleaseSession, kind: ReleaseKind, actionId: string): ReleaseAction {
  requireValue(!session.actions[kind], 'This logical action is already frozen; query it before replay.');
  requireValue(actionId === kind, 'Use the fixed logical action ID.');
  assertReleaseSnapshot(session.baseline);
  assertActionDependencies(session, kind);
  if (kind !== 'import') assertEvidenceFresh(session.bundle);
  const action: ReleaseAction = { kind, actionId, payload: JSON.stringify(expectedActionBody(session, kind)), outcome: 'unknown', queried: false, reconciled: false };
  assertFrozenAction(session, action);
  return action;
}

export function assertReplayAllowed(action: ReleaseAction) {
  requireValue(action.queried && action.reconciled && (action.outcome === 'unknown' || action.kind === 'publish'), 'Query the action before retrying its identical request.');
}

export function decodeCommittedAction(raw: { Body?: string; body?: string; StatusCode?: number; statusCode?: number }): ApiResult<Record<string, unknown>> {
  requireValue((raw.StatusCode ?? raw.statusCode) === 200, 'Action query returned a non-success committed response.');
  const result = JSON.parse(raw.Body ?? raw.body ?? '') as ApiResult<Record<string, unknown>>;
  requireValue(result.success && result.data && typeof result.data === 'object', 'Action query is missing its committed response.');
  return result;
}

export function assertActionResult(session: ReleaseSession, action: ReleaseAction, result: ApiResult<Record<string, unknown>>) {
  requireValue(typeof result.success === 'boolean', 'Invalid journal action response.');
  if (!result.success) { requireValue(action.outcome !== 'confirmed', 'Confirmed action has no committed result.'); return; }
  const data = object(result.data);
  if (data.releaseId !== undefined) requireValue(data.releaseId === session.bundle.releaseId, 'Action result release differs from journal.');
  if (data.deckId !== undefined) requireValue(data.deckId === 15, 'Action result deck differs from journal.');
  const body = object(JSON.parse(action.payload));
  if (action.kind === 'import') {
    hash(data.editingSnapshot);
    if (session.verifiedSnapshot) requireValue(data.editingSnapshot === session.verifiedSnapshot.editingSnapshot, 'Import result differs from verified editing snapshot.');
  } else if (action.kind === 'review') {
    text(data.receiptId);
    requireValue(data.editingSnapshot === body.expectedEditingSnapshot && data.publishSnapshot === session.verifiedSnapshot?.publishSnapshot, 'Review receipt differs from the verified snapshot.');
  } else {
    text(data.jobId); text(data.buildId);
    requireValue(data.outcome === 'committed' && data.manifestVerified === false && data.snapshotSha256 === session.verifiedSnapshot?.publishSnapshot, 'Publish result differs from the verified snapshot.');
  }
}
export function parseReleaseSession(raw: string, ownerSubject?: string): ReleaseSession {
  requireValue(raw.length <= 10_000_000, 'Recovery journal is too large.');
  const session = object(JSON.parse(raw)) as unknown as ReleaseSession;
  requireValue(session.schema === 'aws-basics-console-session-v1', 'Unsupported recovery journal.');
  text(session.ownerSubject, 256);
  if (ownerSubject !== undefined) requireValue(session.ownerSubject === ownerSubject, 'Recovery journal belongs to another signed-in subject.');
  assertReleaseSnapshot(session.baseline);
  requireValue(structurallyEqual(session.baselineInventory, captureReleaseBackupInventory(session.baseline)), 'Recovery backup inventory is missing or differs from the original editing snapshot/all-row capture.');
  session.bundle = parseReleaseBundle(JSON.stringify(session.bundle), Date.now(), false);
  object(session.actions);
  if (session.verifiedSnapshot) assertOriginalLive(session, session.verifiedSnapshot);
  for (const [kind, action] of Object.entries(session.actions)) {
    requireValue(['import', 'review', 'publish'].includes(kind) && action?.kind === kind && typeof action.payload === 'string' && ['confirmed', 'unknown'].includes(action.outcome) && typeof action.queried === 'boolean' && typeof action.reconciled === 'boolean', 'Invalid journal action.');
    assertFrozenAction(session, action);
    requireValue(action.outcome !== 'confirmed' || action.result?.success === true, 'Confirmed journal action is missing its committed result.');
    if (action.result) assertActionResult(session, action, action.result);
  }
  // Stored confirmations and query output are historical evidence until queried in this session.
  for (const action of Object.values(session.actions)) { action.queried = false; action.reconciled = false; }
  return session;
}
