import { captureReleaseBackupInventory } from '../../src/lib/contentRelease';
import type { Card } from '../../src/types/card';
import { TEST_EDITOR_SUB } from './consoleSession';
import type { ReleaseBundle, ReleaseSession, ReleaseSnapshot } from '../../src/types/contentRelease';

/** Synthetic contract sample only. Hashes do not attest to model review or production content. */
export function releaseFixture(): { bundle: ReleaseBundle; snapshot: ReleaseSnapshot; cards: Card[]; session: ReleaseSession } {
  const bundle: ReleaseBundle = {
    schema: 'aws-basics-release-bundle-v1', deckId: 15, deckSlug: 'aws-saa-fundamentals', releaseId: 'synthetic-release',
    cards: Array.from({ length: 337 }, (_, index) => ({
      stableUid: `aws-synthetic-${index + 1}`, question: 'What is a Region?', explanation: 'A geographic area.',
      codeSnippet: '', codeLanguage: '', realWorldUsage: '', topic: 'Synthetic', difficulty: 2, orderInDeck: index + 1,
      mcq: null, source: { url: 'https://docs.aws.amazon.com/example', quote: 'Synthetic quotation.' },
      frontHelp: [{ term: 'Region', definition: 'A geographic area.' }],
      translations: { 'zh-CN': { v: 1, question: '\u4ec0\u4e48\u662f\u533a\u57df\uff1f', explanation: '\u5730\u7406\u533a\u57df\u3002', frontHelp: [{ term: '\u533a\u57df', definition: '\u5730\u7406\u8303\u56f4\u3002' }] } },
    })),
    review: {
      runId: 'synthetic-run', batchAuthorizationRef: 'synthetic-user-scope-reference', authorizationScope: 'aws-saa-fundamentals:full-deck-bilingual-release', model: 'synthetic-model', mainSHA: 'a'.repeat(40),
      evidenceRef: 'local:synthetic-evidence.json', evidenceHash: 'b'.repeat(64), evidenceVersion: 'v1',
      reportRef: 'local:synthetic-report.json', reportHash: 'c'.repeat(64), reportVersion: 'v1',
      promptHash: 'd'.repeat(64), promptVersion: 'v1', corpusHash: 'e'.repeat(64), corpusVersion: 'v1',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), cards: [],
    },
  };
  bundle.review.cards = bundle.cards.map(card => ({ stableUid: card.stableUid, verdict: 'PASS', cardContentHash: 'f'.repeat(64), schema: 'front-help-v1', revision: 2, orderInDeck: card.orderInDeck, blockers: [], unknowns: [] }));
  const cards: Card[] = bundle.cards.map((card, index) => ({ ...structuredClone(card), id: index + 1, deckId: 15, version: 3, revision: 2, createdAt: '', updatedAt: '', translationStatus: { 'zh-CN': 'ok' } }));
  const snapshot: ReleaseSnapshot = {
    deckId: 15, policy: 'aws-codex-bilingual-v1', policyHash: '1'.repeat(64), reviewSchema: 'codex-release-review-v1', schemaHash: '2'.repeat(64), editingSnapshot: '3'.repeat(64), publishSnapshot: '4'.repeat(64),
    deck: { id: 15, slug: 'aws-saa-fundamentals', title: 'AWS Basics', author: 'synthetic', description: null, locale: 'en-US', deck_type: 1, is_deleted: 0, version: 1, created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z', manifest_order: 10, tier: 'free', availability: 'live', eta: null, retired_at_ms: null, download_mode: 'public', total_cards: 337, preview_cards: null, live_build_id: 'original-live', translation_locales: ['zh-CN'], release_generation: 0 },
    backup: cards.map(card => ({ id: card.id, deck_id: 15, stable_uid: card.stableUid, question: card.question, explanation: card.explanation, code_snippet: card.codeSnippet, code_language: card.codeLanguage, real_world_usage: card.realWorldUsage, difficulty: card.difficulty, order_in_deck: card.orderInDeck, revision: card.revision, is_deleted: 0, version: card.version, created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z', topic: card.topic, mcq: card.mcq, source: structuredClone(card.source), translations: structuredClone(card.translations), translation_basis: { 'zh-CN': '0123456789abcdef' }, front_help: structuredClone(card.frontHelp) })),
    cards: bundle.review.cards.map(({ stableUid, cardContentHash, schema, revision, orderInDeck }) => ({ stableUid, cardContentHash, schema, revision, orderInDeck, version: 3 })),
  };
  return { bundle, cards, snapshot, session: { schema: 'aws-basics-console-session-v1', ownerSubject: TEST_EDITOR_SUB, baseline: structuredClone(snapshot), baselineInventory: captureReleaseBackupInventory(snapshot), bundle, actions: {} } };
}
