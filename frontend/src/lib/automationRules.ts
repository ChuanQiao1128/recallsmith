// src/lib/automationRules.ts
//
// The Automation page's decisions as pure data (contract A00 §16.1): the state
// and reason codes of §5.2, §5.9, §6.6 and the column enumerations of §7, their
// labels, the mode banner (§3.2), the deep-link resolution of §12.2 and §13,
// and the checks the forms run before a request. AutomationPage and the tabs in
// src/features/automation/ wire these to state and to the DOM.
//
// Every label lookup falls back to the raw code: the server may add a code
// before the console learns its label, and an unknown code must still show.

export const AUTOMATION_MODES = ['off', 'dry_run', 'live'] as const;

export const DECISION_STATES = [
  'qa_pending',
  'qa_queued',
  'would_accept',
  'auto_accepted',
  'human',
  'superseded',
] as const;

/** A00 §5.9, in contract order. HUMAN_ACTION is event-only: it has a label but is not a decision reason. */
export const DECISION_REASONS = [
  'RUN_NOT_RUNNING',
  'DECK_MISMATCH',
  'DECK_NOT_ALLOWED',
  'EXISTING_CARD',
  'LIKELY_DUPLICATE',
  'UNGROUNDED',
  'SOURCE_HOST_NOT_ALLOWED',
  'QA_UNAVAILABLE',
  'AI_QA_DAILY_CAP',
  'ENQUEUE_RETRY',
  'ENQUEUE_FAILED',
  'QA_TIMEOUT',
  'QA_ERROR',
  'QA_HASH_MISMATCH',
  'QA_FLAGGED',
  'REVIEWER_NOT_GATED',
  'MODE_OFF',
  'DECK_DELETED',
  'DECIDED_BY_HUMAN',
] as const;

export const PUBLISH_STATES = ['waiting', 'publishing', 'published', 'would_publish', 'human'] as const;

/** A00 §6.6, in contract order. */
export const PUBLISH_REASONS = [
  'DECK_DELETED',
  'AUTO_PUBLISH_DISABLED',
  'DECK_NEVER_PUBLISHED',
  'PUBLISH_IN_PROGRESS',
  'PUBLISH_WAIT_TIMEOUT',
  'DECK_HAS_HUMAN_CHANGES',
  'MCQ_PUBLISH_GATE',
  'AI_QA_REQUIRED',
  'AI_QA_BLOCKED',
  'AI_QA_STALE',
  'CONFIG_ERROR',
  'SERVER_NOT_READY_AI_QA',
  'PUBLISH_FAILED',
] as const;

export const QUEUE_ITEM_STATUSES = ['queued', 'claimed', 'done', 'failed', 'skipped'] as const;
export const QUEUE_ITEM_KINDS = ['feed_item', 'source_changed', 'manual'] as const;
export const FEED_FORMATS = ['rss', 'atom', 'html-headings'] as const;
export const WATCH_STATUSES = [
  'baseline',
  'unchanged',
  'changed',
  'not_modified',
  'failed',
  'gone',
  'unsupported',
  'robots_disallowed',
] as const;
export const WATCH_EVENT_KINDS = [
  'baseline',
  'changed',
  'gone',
  'failing',
  'recovered',
  'feed_items',
  'unsupported',
] as const;
export const RECHECK_STATES = ['not_needed', 'waiting', 'started', 'done', 'unavailable'] as const;
export const NOTIFICATION_KINDS = ['exception', 'batch_summary', 'weekly_digest', 'source_changed', 'test'] as const;
export const NOTIFICATION_STATUSES = ['queued', 'sent', 'failed', 'enqueue_failed'] as const;
export const RUNNER_STATES = ['idle', 'running', 'error', 'login_expired'] as const;
export const RUN_STATUSES = ['running', 'completed', 'failed', 'abandoned'] as const;
export const RUN_OUTCOMES = ['done', 'nothing_new', 'failed'] as const;

export const DECISION_STATE_LABELS: Record<string, string> = {
  qa_pending: 'Waiting for AI QA',
  qa_queued: 'In AI QA',
  would_accept: 'Would be accepted',
  auto_accepted: 'Auto-accepted',
  human: 'Needs you',
  superseded: 'Decided by a person',
};

export const PUBLISH_STATE_LABELS: Record<string, string> = {
  waiting: 'Waiting',
  publishing: 'Publishing',
  published: 'Published',
  would_publish: 'Would publish',
  human: 'Needs you',
};

export const DECISION_REASON_LABELS: Record<string, string> = {
  RUN_NOT_RUNNING: 'The run was not running',
  DECK_MISMATCH: 'Drafted for another deck than the run',
  DECK_NOT_ALLOWED: 'Deck not in AUTOMATION_DECK_SLUGS',
  EXISTING_CARD: 'Changes an existing card',
  LIKELY_DUPLICATE: 'Too similar to an existing card',
  UNGROUNDED: 'Quote not grounded in the source',
  SOURCE_HOST_NOT_ALLOWED: 'Source host not allowed',
  QA_UNAVAILABLE: 'AI QA is off or not configured',
  AI_QA_DAILY_CAP: 'AI QA daily cap reached',
  ENQUEUE_RETRY: 'AI QA enqueue will be retried',
  ENQUEUE_FAILED: 'AI QA could not be enqueued',
  QA_TIMEOUT: 'AI QA timed out',
  QA_ERROR: 'AI QA returned an error',
  QA_HASH_MISMATCH: 'Reviewed content differs from the card',
  QA_FLAGGED: 'AI QA found a blocker or major issue',
  REVIEWER_NOT_GATED: 'Reviewer differs from the eval gate',
  MODE_OFF: 'Automation was off',
  DECK_DELETED: 'Deck deleted',
  DECIDED_BY_HUMAN: 'A person decided first',
  HUMAN_ACTION: 'A person decided',
};

export const PUBLISH_REASON_LABELS: Record<string, string> = {
  DECK_DELETED: 'Deck deleted',
  AUTO_PUBLISH_DISABLED: 'Auto-publish disabled',
  DECK_NEVER_PUBLISHED: 'The first publish of a deck is always a person',
  PUBLISH_IN_PROGRESS: 'Another publish is running',
  PUBLISH_WAIT_TIMEOUT: 'Waited too long for another publish',
  DECK_HAS_HUMAN_CHANGES: 'Deck has changes made by a person',
  MCQ_PUBLISH_GATE: 'MCQ publish gate refused',
  AI_QA_REQUIRED: 'AI QA review required',
  AI_QA_BLOCKED: 'AI QA blocker open',
  AI_QA_STALE: 'Cards changed after the check',
  CONFIG_ERROR: 'Server configuration error',
  SERVER_NOT_READY_AI_QA: 'AI QA migration not run',
  PUBLISH_FAILED: 'Publish build failed',
};

export const LIVE_BLOCKED_REASON_LABELS: Record<string, string> = {
  EVAL_GATE_MISSING: 'AUTOMATION_MODE=live is blocked: no passed eval gate, so it runs as a dry run',
  SERVER_NOT_READY_AUTOMATION: 'The server has not run migration 034',
};

export const AUTOMATION_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'Runs' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'queue', label: 'Queue' },
  { id: 'watch', label: 'Watch' },
  { id: 'email', label: 'Email log' },
] as const;

export type AutomationTab = (typeof AUTOMATION_TABS)[number]['id'];

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** The map's own entry for `key`, never an inherited property such as `constructor`. */
function own(map: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

export function decisionStateLabel(state: string): string {
  return own(DECISION_STATE_LABELS, state) ?? state;
}

export function decisionReasonLabel(code: string): string {
  return own(DECISION_REASON_LABELS, code) ?? code;
}

export function publishStateLabel(state: string): string {
  return own(PUBLISH_STATE_LABELS, state) ?? state;
}

export function publishReasonLabel(code: string): string {
  return own(PUBLISH_REASON_LABELS, code) ?? code;
}

export function decisionStateTone(state: string): BadgeTone {
  if (state === 'auto_accepted') return 'success';
  if (state === 'would_accept') return 'info';
  if (state === 'human') return 'warning';
  return 'neutral';
}

/** The page's one operational sentence: the mode has no switch (A00 §3.1). */
export const MODE_CHANGE_HINT = 'Change AUTOMATION_MODE in src_C/env/prod.env.json and deploy';

export type ModeBanner = { tone: 'neutral' | 'info' | 'success' | 'warning'; title: string; lines: string[] };

export function modeBanner(mode: {
  configured: string;
  effective: string;
  liveBlockedReason: string | null;
  autoPublish: boolean;
}): ModeBanner {
  let tone: ModeBanner['tone'];
  let title: string;
  if (mode.effective === 'live') {
    tone = 'success';
    title = 'Live: new cards that pass every check are accepted and published automatically';
  } else if (mode.effective === 'dry_run') {
    tone = 'info';
    title = 'Dry run: every decision is recorded, nothing is accepted or published';
  } else {
    tone = 'neutral';
    title = 'Automation is off';
  }
  const lines: string[] = [];
  if (mode.liveBlockedReason !== null) {
    tone = 'warning';
    lines.push(own(LIVE_BLOCKED_REASON_LABELS, mode.liveBlockedReason) ?? mode.liveBlockedReason);
  }
  if (mode.autoPublish === false) lines.push('Auto-publish is disabled (AUTOMATION_AUTO_PUBLISH)');
  lines.push(`Configured: ${mode.configured} · Effective: ${mode.effective}`);
  lines.push(MODE_CHANGE_HINT);
  return { tone, title, lines };
}

/** A positive integer id of at most 15 digits, or null. */
export function parsePositiveId(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,14}$/.test(raw)) return null;
  return Number(raw);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AutomationView = { tab: AutomationTab; runId: string | null; draftId: number | null; targetId: number | null };

function isAutomationTab(value: string | null): value is AutomationTab {
  return value !== null && AUTOMATION_TABS.some(t => t.id === value);
}

/**
 * The view a URL names. These are the deep links of A00 §12.2 and §13:
 * `?runId=`, `?draftId=` and `?tab=watch&targetId=`.
 */
export function resolveAutomationView(params: URLSearchParams): AutomationView {
  const draftId = parsePositiveId(params.get('draftId'));
  const targetId = parsePositiveId(params.get('targetId'));
  const rawRun = params.get('runId');
  const runId = rawRun !== null && UUID_RE.test(rawRun) ? rawRun : null;
  const rawTab = params.get('tab');
  const tab: AutomationTab = isAutomationTab(rawTab)
    ? rawTab
    : draftId !== null
      ? 'decisions'
      : runId !== null
        ? 'runs'
        : targetId !== null
          ? 'watch'
          : 'overview';
  return { tab, runId, draftId, targetId };
}

/** The server default of AUTOMATION_LOGIN_WARN_DAYS (A00 §3.3). */
export const LOGIN_WARN_DAYS = 5;

export function loginExpiryWarning(days: number | null, warnDays = LOGIN_WARN_DAYS): boolean {
  return days !== null && days <= warnDays;
}

export function formatAge(iso: string | null, nowMs: number): string {
  if (iso === null) return '—';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '—';
  const minutes = Math.floor((nowMs - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function shadowAgreementText(shadow: {
  humanDecided: number;
  humanAccepted: number;
  agreementRate: number | null;
}): string {
  if (shadow.humanDecided === 0) return 'No person has decided a would-accept draft yet.';
  const rate = shadow.agreementRate ?? shadow.humanAccepted / shadow.humanDecided;
  const pct = (rate * 100).toFixed(1);
  return `${shadow.humanAccepted} of ${shadow.humanDecided} would-accept drafts were accepted unedited by a person (${pct}%).`;
}

export type DecisionStateBar = { state: string; label: string; count: number; width: number };

export function decisionStateBars(byState: Record<string, number>, width: number): DecisionStateBar[] {
  const counts = DECISION_STATES.map(state => byState[state] ?? 0);
  const max = Math.max(0, ...counts);
  return DECISION_STATES.map((state, i) => ({
    state,
    label: decisionStateLabel(state),
    count: counts[i],
    width: max === 0 ? 0 : (counts[i] / max) * width,
  }));
}

function urlProblem(url: string): string | null {
  const value = url.trim();
  if (value === '') return 'Enter a URL.';
  if (!value.startsWith('https://')) return 'The URL must start with https://.';
  if (value.length > 2048) return 'The URL must be at most 2048 characters.';
  try {
    new URL(value);
  } catch {
    return 'The URL is not valid.';
  }
  return null;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function queueItemProblems(input: {
  url: string;
  deckId: number | null;
  title: string;
  note: string;
}): string[] {
  const problems: string[] = [];
  const url = urlProblem(input.url);
  if (url) problems.push(url);
  if (!isPositiveInteger(input.deckId)) problems.push('Choose a deck.');
  if (input.title.length > 300) problems.push('The title must be at most 300 characters.');
  if (input.note.length > 500) problems.push('The note must be at most 500 characters.');
  return problems;
}

/**
 * The feed form's checks. The title pattern is a PostgreSQL ARE (A00 §7 note),
 * so it is only length-checked here: the server answers WATCH_PATTERN_INVALID.
 */
export function watchTargetProblems(input: {
  url: string;
  feedFormat: string;
  deckId: number | null;
  itemTitlePattern: string;
  checkIntervalMinutes: number;
}): string[] {
  const problems: string[] = [];
  const url = urlProblem(input.url);
  if (url) problems.push(url);
  if (!(FEED_FORMATS as readonly string[]).includes(input.feedFormat)) problems.push('Choose a feed format.');
  if (!isPositiveInteger(input.deckId)) problems.push('Choose a deck.');
  if (input.itemTitlePattern.length > 1000) problems.push('The title pattern must be at most 1000 characters.');
  const interval = input.checkIntervalMinutes;
  if (!Number.isInteger(interval) || interval < 60 || interval > 43200) {
    problems.push('The check interval must be a whole number of minutes from 60 to 43200.');
  }
  return problems;
}

/** A first look at a pasted gate report; the server recomputes everything (A00 §15.4 step 4). */
export function evalGateReportProblem(text: string): string | null {
  if (text.trim() === '') return 'Paste the gate report JSON.';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'The report is not valid JSON.';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'This is not an automation-gate report.';
  const report = parsed as Record<string, unknown>;
  if (report.kind !== 'automation-gate' || report.v !== 1) return 'This is not an automation-gate report.';
  if (report.passed !== true) return 'Only a passed gate report can be recorded.';
  return null;
}

export const AUTOMATION_ERROR_MESSAGES: Record<string, string> = {
  SERVER_NOT_READY_AUTOMATION: 'The server has not run the automation database migration (034).',
  EVAL_GATE_FAILED: 'The server recomputed the report and it does not pass the gate.',
  EVAL_GATE_INVALID: 'The server could not read this gate report.',
  EVAL_GATE_NOT_FOUND: 'That eval gate no longer exists.',
  EVAL_GATE_REVOKED: 'That eval gate is already revoked.',
  QUEUE_ITEM_EXISTS: 'That URL is already queued or being drafted for this deck.',
  QUEUE_ITEM_NOT_FOUND: 'That queue item no longer exists.',
  QUEUE_ITEM_NOT_QUEUED: 'Only a queued item can be skipped.',
  DECK_NOT_FOUND: 'That deck does not exist.',
  WATCH_PATTERN_INVALID: 'PostgreSQL rejected the title pattern.',
  WATCH_TARGET_EXISTS: 'That URL is already watched.',
  WATCH_TARGET_NOT_FOUND: 'That watch target no longer exists.',
  NOTIFY_NOT_CONFIGURED: 'Email is not configured on the server (AUTOMATION_NOTIFY_QUEUE_URL is empty).',
  NOTIFICATION_NOT_FOUND: 'That email is not in the log.',
  DRAFT_DECISION_NOT_FOUND: 'No automatic decision exists for that draft.',
};

export function automationErrorMessage(code: string | undefined, serverMessage: string): string {
  const mapped = code === undefined ? undefined : own(AUTOMATION_ERROR_MESSAGES, code);
  if (mapped === undefined) return serverMessage;
  if (code === 'EVAL_GATE_FAILED' || code === 'EVAL_GATE_INVALID') return `${mapped} ${serverMessage}`;
  return mapped;
}
