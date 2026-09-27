// Browser smoke and accessibility scan of the Automation console (/automation).
//
// B07 frontend-console-5: authoringConsole.spec.ts scans the four HITL pages
// with axe but never /automation. This spec opens each tab of the built
// bundle with the automation API stubbed at the network layer (page.route(),
// the same boundary authoringConsole.spec.ts draws and explains) and runs an
// axe WCAG 2 A/AA scan of the settled page. It also opens a decision from the
// table and checks that focus moved to it (frontend-console-4).
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

async function stubAutomationApi(page: Page): Promise<{ unexpected: string[] }> {
  const unexpected: string[] = [];
  await page.route('**/api/v1/**', (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const body = (payload: string) => route.fulfill({ status: 200, contentType: 'application/json', body: payload });

    if (path === '/api/v1/admin/automation/status') return body(ok(STATUS));
    if (path === '/api/v1/admin/automation/eval-gate') return body(ok({ current: null, history: [] }));
    if (path === '/api/v1/admin/automation/runs') return body(ok({ items: [RUN], nextCursor: null }));
    if (path === '/api/v1/admin/automation/decisions') return body(ok({ items: [DECISION], nextCursor: null }));
    if (path === '/api/v1/admin/automation/decisions/41') {
      return body(ok({ ...DECISION, card: null, findings: [], events: [] }));
    }
    if (path === '/api/v1/admin/automation/queue') return body(ok({ items: [QUEUE_ITEM], nextCursor: null }));
    if (path === '/api/v1/admin/automation/watch') {
      return body(ok({ items: [WATCH_TARGET], recentEvents: [], nextCursor: null }));
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
