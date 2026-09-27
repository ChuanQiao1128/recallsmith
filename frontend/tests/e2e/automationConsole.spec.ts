// Browser smoke and accessibility scan of the Automation console (/automation).
//
// B07 frontend-console-5: authoringConsole.spec.ts scans the four HITL pages
// with axe but never /automation. This spec opens each tab of the built
// bundle with the automation API stubbed at the network layer (page.route(),
// the same boundary authoringConsole.spec.ts draws and explains) and runs an
// axe WCAG 2 A/AA scan of the settled page. It also opens a decision from the
// table and checks that focus moved to it (frontend-console-4).
//
// C07 frontend-console-21: the scans above see sparse states only, so a
// second, dense stub fills every panel that can hold more (a current gate with
// metrics and history, a failing runner, a blocked live mode, the open backlog
// with its publishes, unconfirmed email, a decision with findings and events,
// a watched feed with a title pattern) and the dense pages are scanned too:
// the Overview, ?draftId=41, and ?tab=watch&targetId=3 with the editor open.
// The dense Overview is scanned in live mode as well (F04 frontend-console-35):
// a dry run keeps the backlog's routed count blind, so only the live page shows
// it. The publish decks waiting for a person are live rows and show in both
// (G04 frontend-console-41). The Runs tab is scanned with ?runId= too, the
// dry-run batch email's link, whose highlighted row carries the hidden-split
// notes (G04 frontend-console-42).
//
// Nothing here leaves the machine: every /api/v1/ call is answered from memory
// and anything unrecognised is recorded and fails the test.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const TOKEN_KEY = 'devcards:tokens';

function ok<T>(data: T): string {
  return JSON.stringify({ success: true, data, error: null, traceId: 'e2e' });
}

function fakeJwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${segment({ alg: 'none', typ: 'JWT' })}.${segment(claims)}.signature-not-verified-by-the-client`;
}

function superAdminSession(): string {
  const token = fakeJwt({
    sub: 'e2e-admin-sub',
    email: 'e2e-admin@example.invalid',
    'cognito:username': 'e2e-admin',
    'cognito:groups': ['super_admin'],
  });
  return JSON.stringify({
    accessToken: token,
    idToken: token,
    tokenType: 'Bearer',
    expiresIn: 24 * 60 * 60,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });
}

const RUN_ID = '3f2a9c1e-0b4d-4c8e-9a71-5d6e7f809a1b';
const NOTIFICATION_ID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

const DECK = {
  id: 7,
  slug: 'aws-saa-c03',
  title: 'AWS SAA-C03',
  author: 'Playwright',
  locale: 'en',
  deckType: 0,
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const STATUS = {
  serverTime: '2026-09-28T12:00:00Z',
  mode: { configured: 'dry_run', effective: 'dry_run', liveBlockedReason: null, autoPublish: true },
  evalGate: null,
  runners: [
    {
      runnerId: 'owner-mac',
      host: 'mac-mini',
      state: 'idle',
      lastHeartbeatAt: '2026-09-28T11:45:00Z',
      stale: false,
      loginExpiresInDays: 12,
      lastRunOutcome: 'done',
      lastError: null,
    },
  ],
  queue: { queued: 1, due: 1, claimed: 0, failed: 0, doneLast7d: 3 },
  decisions24h: { byState: { would_accept: 2, human: 1 }, byReason: { QA_FLAGGED: 1 } },
  shadow: { wouldAccept: 4, humanDecided: 2, humanAccepted: 2, humanEditedAccepted: 0, humanRejected: 0, agreementRate: 1 },
  publishes7d: { byState: { would_publish: 1 } },
  spend: { todayUsd: 0.5, automationTodayUsd: 0.2, reservedUsd: 0, dailyCapUsd: 10 },
  watch: { targets: 1, active: 1, failing: 0, lastCheckedAt: '2026-09-28T10:00:00Z', changes7d: 0 },
  notifications: { sent24h: 1, failed24h: 0, queued: 0, lastSentAt: '2026-09-28T11:05:00Z' },
  backlog: { humanPending: 1, oldestHumanPendingAt: '2026-09-27T12:00:00Z', humanPublishes: 0 },
};

const DECISION = {
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
  qa: null,
  acceptedCardId: null,
  humanAction: null,
  humanReason: null,
  createdAt: '2026-09-28T11:10:00Z',
};

const RUN = {
  runId: RUN_ID,
  kind: 'manual',
  url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html',
  deckId: 7,
  deckSlug: 'aws-saa-c03',
  runnerId: 'owner-mac',
  status: 'completed',
  outcome: 'nothing_new',
  startedAt: '2026-09-28T11:00:00Z',
  counts: { submitted: 0 },
  publishes: [],
  summary: 'Card s3-versioning-02 looks wrong: it says 1000 versions.',
};

const QUEUE_ITEM = {
  itemId: 12,
  kind: 'manual',
  url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html',
  deckId: 7,
  deckSlug: 'aws-saa-c03',
  status: 'queued',
  attempts: 0,
  createdBy: 'owner:owner-sub',
  createdAt: '2026-09-28T10:59:00Z',
};

const WATCH_TARGET = {
  targetId: 3,
  kind: 'feed',
  url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/',
  feedFormat: 'rss',
  deckId: 7,
  deckSlug: 'aws-saa-c03',
  active: true,
  checkIntervalMinutes: 120,
  lastStatus: 'unchanged',
  consecutiveFailures: 0,
  citingCards: 0,
  createdBy: 'migration:034',
  createdAt: '2026-09-27T00:00:00Z',
};

const NOTIFICATION = {
  notificationId: NOTIFICATION_ID,
  kind: 'batch_summary',
  subject: '[DeveloperCards] (dry run) Batch 3f2a9c1e aws-saa-c03',
  mode: 'dry_run',
  status: 'sent',
  attempts: 1,
  createdAt: '2026-09-28T11:30:00Z',
  sentAt: '2026-09-28T11:30:05Z',
};

const GATE = {
  gateId: 4,
  reviewer: { provider: 'openai-mantle', model: 'openai.gpt-5.5', promptVersion: 'qa-v4-auto' },
  passed: true,
  metrics: { autoAcceptPrecision: 0.98, autoAcceptPrecisionCiLower: 0.95, seededRecall: 0.93, wouldAcceptCards: 212 },
  reportSha256: 'a'.repeat(64),
  createdBySub: 'owner-sub',
  createdAt: '2026-09-27T09:00:00Z',
  revokedAt: null,
  revokedBySub: null,
};

const DENSE_STATUS = {
  ...STATUS,
  mode: { configured: 'live', effective: 'dry_run', liveBlockedReason: 'EVAL_GATE_MISSING', autoPublish: true },
  runners: [
    ...STATUS.runners,
    {
      runnerId: 'owner-mac-2',
      host: 'mac-studio',
      state: 'error',
      lastHeartbeatAt: '2026-09-27T11:45:00Z',
      stale: true,
      loginExpiresInDays: 2,
      lastRunOutcome: 'failed',
      lastError: 'AGENT_BLOCKED: the source page needs a login',
    },
  ],
  notifications: { sent24h: 4, failed24h: 1, queued: 2, unconfirmed: 2, lastSentAt: '2026-09-28T11:05:00Z' },
  backlog: {
    humanPending: 3,
    oldestHumanPendingAt: '2026-09-20T12:00:00Z',
    humanPublishes: 2,
    humanPublishItems: [
      { deckId: 7, deckSlug: 'aws-saa-c03', reason: 'DECK_NEVER_PUBLISHED', since: '2026-09-27T12:00:00Z' },
      { deckId: 9, deckSlug: 'aws-dva-c02', reason: 'AI_QA_BLOCKED', since: '2026-09-28T08:00:00Z' },
    ],
  },
};

const DENSE_DETAIL = {
  ...DECISION,
  card: {
    stableUid: 's3-versioning-01',
    difficulty: 2,
    topic: 'S3',
    question: DECISION.question,
    explanation: 'S3 Versioning keeps every version of every object in a bucket.',
    source: {
      url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html',
      quote: 'Versioning in Amazon S3 is a means of keeping multiple variants of an object in the same bucket.',
    },
  },
  findings: [
    { severity: 'major', category: 'weak_distractor', message: 'Option C is obviously wrong.', suggestedFix: 'Use Object Lock.' },
    { severity: 'minor', category: 'clarity', message: 'Wordy stem.', suggestedFix: null },
  ],
  events: [
    { fromState: null, toState: 'qa_pending', reason: null, actor: 'automation', mode: 'dry_run', createdAt: '2026-09-28T11:10:00Z' },
    { fromState: 'qa_pending', toState: 'qa_queued', reason: null, actor: 'automation', mode: 'dry_run', createdAt: '2026-09-28T11:11:00Z' },
    { fromState: 'qa_queued', toState: 'human', reason: 'QA_FLAGGED', actor: 'automation', mode: 'dry_run', createdAt: '2026-09-28T11:15:00Z' },
  ],
};

const DENSE_WATCH_TARGET = { ...WATCH_TARGET, itemTitlePattern: '\\m(S3|EC2)\\M' };

async function stubAutomationApi(page: Page, dense = false, status?: unknown): Promise<{ unexpected: string[] }> {
  const unexpected: string[] = [];
  await page.route('**/api/v1/**', (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const body = (payload: string) => route.fulfill({ status: 200, contentType: 'application/json', body: payload });

    if (path === '/api/v1/admin/automation/status') return body(ok(status ?? (dense ? DENSE_STATUS : STATUS)));
    if (path === '/api/v1/admin/automation/eval-gate') {
      return body(
        ok(
          dense
            ? { current: GATE, history: [GATE, { ...GATE, gateId: 3, revokedAt: '2026-09-26T09:00:00Z' }] }
            : { current: null, history: [] },
        ),
      );
    }
    if (path === '/api/v1/admin/automation/runs') return body(ok({ items: [RUN], nextCursor: null }));
    if (path === '/api/v1/admin/automation/decisions') return body(ok({ items: [DECISION], nextCursor: null }));
    if (path === '/api/v1/admin/automation/decisions/41') {
      return body(ok(dense ? DENSE_DETAIL : { ...DECISION, card: null, findings: [], events: [] }));
    }
    if (path === '/api/v1/admin/automation/queue') return body(ok({ items: [QUEUE_ITEM], nextCursor: null }));
    if (path === '/api/v1/admin/automation/watch') {
      return body(ok({ items: [dense ? DENSE_WATCH_TARGET : WATCH_TARGET], recentEvents: [], nextCursor: null }));
    }
    if (path === '/api/v1/admin/automation/notifications') {
      return body(ok({ items: [NOTIFICATION], nextCursor: null }));
    }
    if (path === '/api/v1/authoring/decks') return body(ok([DECK]));

    unexpected.push(`${path}${url.search}`);
    return body(ok(null));
  });
  return { unexpected };
}

async function signIn(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      sessionStorage.setItem(key, value);
    },
    [TOKEN_KEY, superAdminSession()],
  );
}

const TABS = ['overview', 'runs', 'decisions', 'queue', 'watch', 'email'] as const;

for (const tab of TABS) {
  test(`the Automation ${tab} tab has no axe WCAG 2 A/AA violation`, async ({ page }) => {
    const api = await stubAutomationApi(page);
    await signIn(page);

    await page.goto(`/automation?tab=${tab}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Automation', exact: true })).toBeVisible();
    await expect(page.getByTestId('automation-mode-banner')).toBeVisible();
    await expect(page.getByText(/^Loading/)).toHaveCount(0);
    // The header links the page on screen as the current section (frontend-console-12).
    await expect(
      page.getByRole('navigation', { name: 'Console sections' }).getByRole('link', { name: 'Automation', exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      scan.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`),
      `${tab}: axe violations`,
    ).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });
}

test('Details moves focus to the opened decision', async ({ page }) => {
  const api = await stubAutomationApi(page);
  await signIn(page);

  await page.goto('/automation?tab=decisions');
  await page.getByRole('button', { name: 'Details of draft 41' }).click();
  const heading = page.getByRole('heading', { name: 'Draft 41', exact: true });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations.map(v => v.id)).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

async function expectNoAxeViolation(page: Page, what: string): Promise<void> {
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    scan.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`),
    `${what}: axe violations`,
  ).toEqual([]);
}

test('the dense Overview (gate metrics, failing runner, backlog, unconfirmed email) has no axe violation', async ({
  page,
}) => {
  const api = await stubAutomationApi(page, true);
  await signIn(page);

  await page.goto('/automation');
  await expect(page.getByTestId('automation-gate-current')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke gate' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Publishes waiting for you' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByTestId('automation-publishes-blind')).toBeVisible();
  await expect(page.getByTestId('automation-email-unconfirmed')).toContainText('2');
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
  await expectNoAxeViolation(page, 'dense overview');
  expect(api.unexpected).toEqual([]);
});

test('the dry-run run the batch email links, highlighted with its hidden-split notes, has no axe violation', async ({
  page,
}) => {
  const api = await stubAutomationApi(page);
  // A run with drafts that may still be pending (a later route wins over the stub's): its split is hidden
  // while the draft listed for it (DECISION, pending in dry run) is undecided.
  await page.route(url => url.pathname === '/api/v1/admin/automation/runs', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: ok({ items: [{ ...RUN, counts: { submitted: 2, wouldAccept: 1, human: 1 } }], nextCursor: null }),
    }),
  );
  await signIn(page);

  await page.goto(`/automation?tab=runs&runId=${RUN_ID}`);
  const counts = page.getByTestId(`automation-run-counts-${RUN_ID}`);
  await expect(counts).toContainText('split hidden until every draft is decided');
  await expect(page.getByTestId(`automation-run-publishes-${RUN_ID}`)).toHaveText('hidden until every draft is decided');
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
  await expectNoAxeViolation(page, 'highlighted dry-run run');
  expect(api.unexpected).toEqual([]);
});

test('the dense live Overview (routed count, publish decks, split by reason) has no axe violation', async ({ page }) => {
  const api = await stubAutomationApi(page, true, {
    ...DENSE_STATUS,
    mode: { configured: 'live', effective: 'live', liveBlockedReason: null, autoPublish: true },
  });
  await signIn(page);

  await page.goto('/automation');
  await expect(page.getByTestId('automation-backlog-human-pending')).toHaveText('3');
  await expect(page.getByRole('list', { name: 'Publishes waiting for you' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
  await expectNoAxeViolation(page, 'dense live overview');
  expect(api.unexpected).toEqual([]);
});

test('a decision with findings and events has no axe violation', async ({ page }) => {
  const api = await stubAutomationApi(page, true);
  await signIn(page);

  await page.goto('/automation?draftId=41');
  const detail = page.getByRole('region', { name: 'Decision detail' });
  // A pending dry-run draft keeps its verdict blind (N5): findings and events appear only after
  // the person chooses to reveal them, which marks the decision as not blind.
  await expect(detail.getByRole('table', { name: 'AI QA findings' })).toHaveCount(0);
  await expectNoAxeViolation(page, 'blind decision detail');
  await detail.getByRole('button', { name: 'Reveal verdict' }).click();
  await expect(detail.getByRole('table', { name: 'AI QA findings' }).getByRole('row')).toHaveCount(3);
  await expect(detail.getByRole('table', { name: 'Events' }).getByRole('row')).toHaveCount(4);
  await expectNoAxeViolation(page, 'dense decision detail');
  expect(api.unexpected).toEqual([]);
});

test('the linked watch row with a title pattern and its open editor has no axe violation', async ({ page }) => {
  const api = await stubAutomationApi(page, true);
  await signIn(page);

  await page.goto('/automation?tab=watch&targetId=3');
  const row = page.getByTestId('automation-watch-target-3');
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(row).toBeInViewport();
  await expect(row.getByText('\\m(S3|EC2)\\M')).toBeVisible();
  await expectNoAxeViolation(page, 'linked watch row');

  await page.getByRole('button', { name: 'Edit target 3' }).click();
  await expect(row.getByLabel('Title pattern (PostgreSQL regex)')).toBeFocused();
  await expectNoAxeViolation(page, 'watch editor');
  expect(api.unexpected).toEqual([]);
});
