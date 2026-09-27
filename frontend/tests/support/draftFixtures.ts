// tests/support/draftFixtures.ts
//
// Draft cards for the review-queue tests. The card text is adapted from
// content/decks/FORMAT.md §3.2 and §3.3 (contract §0.7); each quote is a
// sentence of the card's own answer, standing in for the cited passage.
//
// Not collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

import type { Draft, DraftCard, DraftSummary } from '../../src/types/draft';

export const DRAFT_DECK_SLUG = 'aws-saa-c03';

export function qaDraftCard(overrides: Partial<DraftCard> = {}): DraftCard {
  return {
    stableUid: 'sample-qa-topic-02',
    difficulty: 1,
    topic: '4.1 Cost-optimized storage',
    question:
      'Nightly database dumps of about 200 GB each must be kept for 90 days and are restored perhaps twice a year, always within a few hours of the request. Which S3 storage class keeps cost lowest without breaking the restore expectation?',
    explanation:
      'S3 Glacier Flexible Retrieval: it is priced for data read once or twice a year and its standard retrieval finishes in 3 to 5 hours, inside the "few hours" window. Glacier Deep Archive is cheaper per GB but its standard restore takes up to 12 hours, so it fails the requirement; S3 Standard-IA is faster than needed and costs more per GB stored.',
    codeSnippet: null,
    codeLanguage: null,
    realWorldUsage:
      'Pick the coldest class whose restore time still fits the recovery-time objective you actually promised.',
    mcq: null,
    source: {
      url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html',
      quote: 'its standard retrieval finishes in 3 to 5 hours',
    },
    ...overrides,
  };
}

export function mcqDraftCard(overrides: Partial<DraftCard> = {}): DraftCard {
  return {
    stableUid: 'sample-mcq-choose-two-03',
    difficulty: 2,
    topic: '1.3 Data security controls',
    question:
      'A team stores customer exports in an S3 bucket. Security requires that objects are encrypted with a key the team controls and rotates, and that no object can be uploaded unencrypted. Which combination of actions is the MOST secure way to meet both requirements? (Choose two.)',
    explanation:
      'Use a customer managed KMS key with rotation as the bucket default and a bucket policy that denies any PutObject lacking KMS encryption. The key gives the team ownership and rotation; the deny statement makes unencrypted uploads impossible rather than merely unlikely. SSE-S3, Versioning and MFA Delete each solve a different problem and leave one of the two requirements open.',
    codeSnippet: null,
    codeLanguage: null,
    realWorldUsage:
      'Default encryption sets what happens when a client says nothing; only a deny policy turns "should be encrypted" into "cannot be stored otherwise".',
    mcq: {
      v: 1,
      qualifier: 'MOST secure',
      shuffle: true,
      options: [
        {
          key: 'a',
          text: "Create a customer managed KMS key with automatic rotation enabled and set it as the bucket's default encryption key.",
          why: null,
          correct: true,
        },
        {
          key: 'b',
          text: 'Enable SSE-S3 default encryption on the bucket.',
          why: 'SSE-S3 keys are owned and rotated by S3, not by the team, so the "key the team controls" requirement is not met even though objects are encrypted at rest.',
          correct: false,
        },
        {
          key: 'c',
          text: 'Add a bucket policy that denies s3:PutObject unless the request specifies aws:kms server-side encryption.',
          why: null,
          correct: true,
        },
        {
          key: 'd',
          text: 'Enable S3 Versioning so an unencrypted upload can be rolled back.',
          why: 'Versioning keeps prior copies of an object; it neither prevents an unencrypted upload nor encrypts anything, so it addresses recovery rather than the stated control.',
          correct: false,
        },
        {
          key: 'e',
          text: 'Enable MFA Delete on the bucket.',
          why: 'MFA Delete protects object versions from deletion; it has no effect on whether uploads are encrypted or which key is used.',
          correct: false,
        },
      ],
    },
    source: {
      url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html',
      quote: 'the deny statement makes unencrypted uploads impossible rather than merely unlikely',
    },
    ...overrides,
  };
}

export function draftSummary(overrides: Partial<DraftSummary> = {}): DraftSummary {
  return {
    draftId: 41,
    deckId: 7,
    batchId: 'batch-2026-09-27',
    stableUid: 'sample-qa-topic-02',
    question: qaDraftCard().question,
    topic: '4.1 Cost-optimized storage',
    status: 'pending',
    likelyDuplicate: false,
    createdAt: '2026-09-27T09:00:00Z',
    decidedAt: null,
    ...overrides,
  };
}

export function draft(card: DraftCard, overrides: Partial<Draft> = {}): Draft {
  return {
    ...draftSummary({ stableUid: card.stableUid, question: card.question, topic: card.topic ?? null }),
    clientDraftKey: `key-${card.stableUid}`,
    card,
    similar: [],
    agent: { name: 'author-cards', model: 'local', skillVersion: '1.0.0' },
    submittedBySub: 'console-tests-admin-sub',
    decidedBySub: null,
    acceptedCardId: null,
    events: [],
    ...overrides,
  };
}
