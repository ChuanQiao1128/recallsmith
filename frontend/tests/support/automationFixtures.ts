// tests/support/automationFixtures.ts
//
// Builders for the Automation page's data (contract A00 §8.6, §15.4, §16.2),
// typed with src/api/automation.ts so a test cannot hand the page a shape the
// API module never produces. No email address appears here: the contract's
// shapes have no recipient.
//
// NOT collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

import type {
  AutomationDecision,
  AutomationDecisionDetail,
  AutomationNotification,
  AutomationNotificationDetail,
  AutomationRun,
  AutomationStatus,
  EvalGate,
  QueueItem,
  WatchEvent,
  WatchPage,
  WatchTarget,
} from '../../src/api/automation';

export const RUN_ID = '3f2a9c1e-0b4d-4c8e-9a71-5d6e7f809a1b';
export const NOTIFICATION_ID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

export function statusFixture(overrides: Partial<AutomationStatus> = {}): AutomationStatus {
  return {
    serverTime: '2026-09-28T12:00:00Z',
    mode: { configured: 'dry_run', effective: 'dry_run', liveBlockedReason: null, autoPublish: true },
    evalGate: null,
    runners: [
      {
        runnerId: 'owner-mac',
        host: 'mac-mini',
        runnerVersion: '1.0.0',
        claudeVersion: '2.1.0',
        state: 'idle',
        lastHeartbeatAt: '2026-09-28T11:45:00Z',
        stale: false,
        loginExpiresAt: '2026-10-01T12:00:00Z',
        loginExpiresInDays: 3,
        lastRunId: RUN_ID,
        lastRunAt: '2026-09-28T11:00:00Z',
        lastRunOutcome: 'done',
        lastError: null,
      },
    ],
    queue: { queued: 2, due: 1, claimed: 0, failed: 0, doneLast7d: 5 },
    decisions24h: { byState: { would_accept: 3, human: 1 }, byReason: { QA_FLAGGED: 1 } },
    shadow: {
      wouldAccept: 10,
      humanDecided: 8,
      humanAccepted: 7,
      humanEditedAccepted: 1,
      humanRejected: 0,
      agreementRate: 0.875,
    },
    publishes7d: { byState: { would_publish: 2 } },
    spend: { todayUsd: 1.25, automationTodayUsd: 0.5, reservedUsd: 0.1, dailyCapUsd: 10 },
    watch: { targets: 4, active: 3, failing: 1, lastCheckedAt: '2026-09-28T10:00:00Z', changes7d: 2 },
    notifications: { sent24h: 3, failed24h: 0, queued: 0, unconfirmed: 0, lastSentAt: '2026-09-28T11:05:00Z' },
    backlog: {
      humanPending: 2,
      oldestHumanPendingAt: '2026-09-26T12:00:00Z',
      humanPublishes: 1,
      humanPublishItems: [
        { deckId: 7, deckSlug: 'aws-saa-c03', reason: 'DECK_NEVER_PUBLISHED', since: '2026-09-27T12:00:00Z' },
      ],
    },
    ...overrides,
  };
}

export function evalGateFixture(overrides: Partial<EvalGate> = {}): EvalGate {
  return {
    gateId: 4,
    reviewer: { provider: 'bedrock-converse', model: 'global.openai.gpt-5.5', promptVersion: 'qa-v4' },
    passed: true,
    metrics: { autoAcceptPrecision: 0.98, seededRecall: 0.93 },
    reportSha256: 'a'.repeat(64),
    createdBySub: 'owner-sub',
    createdAt: '2026-09-27T09:00:00Z',
    revokedAt: null,
    revokedBySub: null,
    ...overrides,
  };
}

export function runFixture(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    runId: RUN_ID,
    queueItemId: 12,
    kind: 'manual',
    url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html',
    title: 'S3 user guide',
    deckId: 7,
    deckSlug: 'aws-saa-c03',
    runnerId: 'owner-mac',
    status: 'completed',
    outcome: 'done',
    startedAt: '2026-09-28T11:00:00Z',
    completedAt: '2026-09-28T11:20:00Z',
    finalizedAt: '2026-09-28T11:30:00Z',
    counts: { submitted: 3, qaPending: 0, qaQueued: 1, wouldAccept: 1, autoAccepted: 0, human: 1, superseded: 0 },
    publishes: [
      {
        publishId: 2,
        deckId: 7,
        deckSlug: 'aws-saa-c03',
        mode: 'dry_run',
        state: 'would_publish',
        reason: null,
        reasonDetail: null,
        jobId: null,
        buildId: null,
        updatedAt: '2026-09-28T11:30:00Z',
      },
    ],
    summaryNotificationId: NOTIFICATION_ID,
    error: null,
    summary: null,
    ...overrides,
  };
}

export function decisionFixture(overrides: Partial<AutomationDecision> = {}): AutomationDecision {
  return {
    draftId: 41,
    runId: RUN_ID,
    deckId: 7,
    deckSlug: 'aws-saa-c03',
    stableUid: 's3-versioning-01',
    question: 'Which S3 feature keeps every version of an object?',
    mode: 'dry_run',
    state: 'human',
    reason: 'QA_FLAGGED',
    reasonDetail: '1 major finding',
    qa: {
      jobId: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      status: 'done',
      errorCode: null,
      provider: 'bedrock-converse',
      model: 'global.openai.gpt-5.5',
      promptVersion: 'qa-v4',
      blocker: 0,
      major: 1,
      minor: 2,
      estimatedCostUsd: 0.02,
      attempts: 1,
    },
    acceptedCardId: null,
    humanAction: null,
    humanReason: null,
    createdAt: '2026-09-28T11:10:00Z',
    updatedAt: '2026-09-28T11:15:00Z',
    decidedAt: '2026-09-28T11:15:00Z',
    ...overrides,
  };
}

export function decisionDetailFixture(overrides: Partial<AutomationDecisionDetail> = {}): AutomationDecisionDetail {
  return {
    ...decisionFixture(),
    card: {
      stableUid: 's3-versioning-01',
      difficulty: 2,
      topic: 'S3',
      question: 'Which S3 feature keeps every version of an object?',
      explanation: 'S3 Versioning keeps every version of every object in a bucket.',
      source: {
        url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html',
        quote: 'Versioning in Amazon S3 is a means of keeping multiple variants of an object in the same bucket.',
      },
    },
    findings: [
      {
        severity: 'major',
        category: 'weak_distractor',
        message: 'Option C is obviously wrong.',
        suggestedFix: 'Use Object Lock as a distractor.',
      },
    ],
    events: [
      {
        fromState: null,
        toState: 'qa_queued',
        reason: null,
        actor: 'automation',
        mode: 'dry_run',
        details: null,
        createdAt: '2026-09-28T11:10:00Z',
      },
      {
        fromState: 'qa_queued',
        toState: 'human',
        reason: 'QA_FLAGGED',
        actor: 'automation',
        mode: 'dry_run',
        details: null,
        createdAt: '2026-09-28T11:15:00Z',
      },
    ],
    ...overrides,
  };
}

export function queueItemFixture(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    itemId: 12,
    kind: 'manual',
    url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html',
    title: 'S3 user guide',
    sectionHint: null,
    note: null,
    deckId: 7,
    deckSlug: 'aws-saa-c03',
    status: 'queued',
    attempts: 0,
    notBefore: '2026-09-28T11:00:00Z',
    claimedByRunner: null,
    claimedAt: null,
    leaseExpiresAt: null,
    lastRunId: null,
    lastError: null,
    sourceTargetId: null,
    sourceEventId: null,
    createdBy: 'owner:owner-sub',
    createdAt: '2026-09-28T10:59:00Z',
    updatedAt: '2026-09-28T10:59:00Z',
    finishedAt: null,
    ...overrides,
  };
}

export function watchTargetFixture(overrides: Partial<WatchTarget> = {}): WatchTarget {
  return {
    targetId: 3,
    kind: 'feed',
    url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/',
    feedFormat: 'rss',
    deckId: 7,
    deckSlug: 'aws-saa-c03',
    itemTitlePattern: '\\m(S3|EC2)\\M',
    active: true,
    checkIntervalMinutes: 120,
    lastCheckedAt: '2026-09-28T10:00:00Z',
    lastChangedAt: null,
    lastStatus: 'unchanged',
    lastHttpStatus: 200,
    consecutiveFailures: 0,
    citingCards: 0,
    createdBy: 'migration:034',
    createdAt: '2026-09-27T00:00:00Z',
    ...overrides,
  };
}

export function watchEventFixture(overrides: Partial<WatchEvent> = {}): WatchEvent {
  return {
    eventId: 9,
    targetId: 3,
    url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/',
    kind: 'feed_items',
    oldSha256: null,
    newSha256: null,
    details: null,
    recheckState: 'not_needed',
    recheckRunIds: [],
    queueItemIds: [12],
    notificationId: null,
    createdAt: '2026-09-28T10:00:00Z',
    ...overrides,
  };
}

export function watchPageFixture(overrides: Partial<WatchPage> = {}): WatchPage {
  return {
    items: [
      watchTargetFixture({ targetId: 2, url: 'https://platform.claude.com/docs/en/release-notes/overview' }),
      watchTargetFixture(),
    ],
    recentEvents: [watchEventFixture()],
    nextCursor: null,
    ...overrides,
  };
}

export function notificationFixture(overrides: Partial<AutomationNotification> = {}): AutomationNotification {
  return {
    notificationId: NOTIFICATION_ID,
    kind: 'batch_summary',
    subkind: null,
    subject: '[DeveloperCards] (dry run) Batch 3f2a9c1e aws-saa-c03: 1 need you',
    mode: 'dry_run',
    status: 'sent',
    attempts: 1,
    sesMessageId: 'ses-1',
    errorCode: null,
    error: null,
    runId: RUN_ID,
    createdAt: '2026-09-28T11:30:00Z',
    sentAt: '2026-09-28T11:30:05Z',
    ...overrides,
  };
}

export function notificationDetailFixture(
  overrides: Partial<AutomationNotificationDetail> = {},
): AutomationNotificationDetail {
  return {
    ...notificationFixture(),
    bodyText: 'DRY RUN — AUTOMATION_MODE=dry_run: nothing was accepted or published.\n\nNEEDS YOU\n- s3-versioning-01',
    ...overrides,
  };
}
