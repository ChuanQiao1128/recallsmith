// tests/support/qaFixtures.ts
//
// AI QA wire records for the J16 tests. Card text comes from
// content/decks/aws-saa-c03.md (§0.7); run and finding values follow the
// ai_qa_runs / findings shapes of R18 contract §7.3.
//
// Not collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

import type { Card } from '../../src/types/card';
import type { Deck } from '../../src/types/deck';
import type { QaFinding, QaItem, QaRun, QaStatus } from '../../src/api/qa';

export const QA_DECK_ID = 7;

export const qaDeck: Deck = {
  id: QA_DECK_ID,
  slug: 'aws-saa-c03',
  title: 'AWS Solutions Architect Associate',
  author: 'DeveloperCards',
  locale: 'en',
  deckType: 2,
  version: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-27T00:00:00Z',
};

function card(id: number, stableUid: string, question: string, orderInDeck: number): Card {
  return {
    id,
    deckId: QA_DECK_ID,
    stableUid,
    question,
    difficulty: 1,
    orderInDeck,
    version: 1,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
  };
}

export const qaCards: Card[] = [
  card(
    101,
    'aws-s3-storage-classes',
    'An application writes logs to S3 that are read often for 30 days and almost never afterwards, but must be kept for 7 years. Which storage classes and mechanism fit?',
    1,
  ),
  card(
    102,
    'aws-s3-cloudfront-oac',
    'You serve a static site from S3 through CloudFront. Why keep the bucket private and use Origin Access Control instead of making the bucket public?',
    2,
  ),
  card(103, 'aws-iam-roles-vs-users', 'When should a workload use an IAM role rather than an IAM user?', 3),
];

export function qaRun(overrides: Partial<QaRun> = {}): QaRun {
  return {
    runId: 'run-1',
    deckId: QA_DECK_ID,
    scope: 'changed',
    status: 'done',
    effectiveStatus: 'done',
    provider: 'bedrock',
    model: 'anthropic.claude-opus-5',
    promptVersion: 'qa-v1',
    cardCount: 3,
    chunkCount: 1,
    cardsDone: 3,
    errorCount: 0,
    blockerCount: 0,
    majorCount: 0,
    minorCount: 0,
    inputTokens: 9000,
    outputTokens: 3600,
    cacheReadTokens: 0,
    estimatedCostUsd: 0.135,
    errorCode: null,
    createdAt: '2026-09-27T09:00:00Z',
    updatedAt: '2026-09-27T09:01:00Z',
    finishedAt: '2026-09-27T09:01:00Z',
    ...overrides,
  };
}

export function qaItem(cardId: number, stableUid: string, overrides: Partial<QaItem> = {}): QaItem {
  return {
    cardId,
    stableUid,
    contentSha256: 'sha-' + cardId,
    status: 'done',
    errorCode: null,
    latencyMs: 1200,
    estimatedCostUsd: 0.045,
    ...overrides,
  };
}

export function qaFinding(overrides: Partial<QaFinding> = {}): QaFinding {
  return {
    findingId: 501,
    runId: 'run-1',
    cardId: 101,
    severity: 'blocker',
    category: 'incorrect_answer',
    message: 'Deep Archive is not a lifecycle target for 30-day reads.',
    suggestedFix: 'Say Glacier Flexible Retrieval for the retention period.',
    resolution: 'open',
    resolvedAt: null,
    resolutionNote: null,
    createdAt: '2026-09-27T09:01:00Z',
    ...overrides,
  };
}

export function qaStatus(overrides: Partial<QaStatus> = {}): QaStatus {
  return {
    enabled: true,
    required: false,
    changedCards: 3,
    reviewedCurrent: 1,
    missing: [],
    openBlockers: [],
    wouldBlock: false,
    maxCards: null,
    dailyUsdCap: null,
    spentTodayUsd: null,
    reservedTodayUsd: null,
    ...overrides,
  };
}
