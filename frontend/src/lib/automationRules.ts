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
import { qaItemErrorLabel } from './qaReview';

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

/** A00 §5.7 human_action, as the console names it (B07 frontend-console-1). */
export const HUMAN_ACTION_LABELS: Record<string, string> = {
  accepted: 'Accepted',
  edited_accepted: 'Edited and accepted',
  rejected: 'Rejected',
};

export function humanActionLabel(action: string): string {
  return own(HUMAN_ACTION_LABELS, action) ?? action;
}

/**
 * The state badge of a decision. A `human` decision keeps its state after the
 * person decides (A00 §5.3, only human_action is set), so a handled one reads
 * "Handled: …" in a neutral tone and only an open one reads "Needs you" (K7).
 */
export function decisionBadge(d: { state: string; humanAction: string | null }): { label: string; tone: BadgeTone } {
  if (d.state === 'human' && d.humanAction !== null) {
    return { label: `Handled: ${humanActionLabel(d.humanAction).toLowerCase()}`, tone: 'neutral' };
  }
  return { label: decisionStateLabel(d.state), tone: decisionStateTone(d.state) };
}

/** Whether a person may still decide the draft: routed or would-accept, and nobody has decided it. */
export function decisionAwaitsPerson(d: { state: string; humanAction: string | null }): boolean {
  return (d.state === 'human' || d.state === 'would_accept') && d.humanAction === null;
}

/** The decision's reason detail as a person reads it: a QA_ERROR detail is an AI QA error code. */
export function decisionReasonDetailText(reason: string | null, detail: string | null): string | null {
  if (!detail) return null;
  return reason === 'QA_ERROR' ? qaItemErrorLabel(detail) : detail;
}

export const MODE_LABELS: Record<string, string> = { off: 'Off', dry_run: 'Dry run', live: 'Live' };
export const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  abandoned: 'Abandoned',
};
export const RUN_OUTCOME_LABELS: Record<string, string> = {
  done: 'Done',
  nothing_new: 'Nothing new',
  failed: 'Failed',
};
export const QUEUE_ITEM_STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  claimed: 'Claimed',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};
export const QUEUE_ITEM_KIND_LABELS: Record<string, string> = {
  feed_item: 'Feed item',
  source_changed: 'Source changed',
  manual: 'Manual',
};
export const WATCH_STATUS_LABELS: Record<string, string> = {
  baseline: 'Baseline',
  unchanged: 'Unchanged',
  changed: 'Changed',
  not_modified: 'Not modified',
  failed: 'Failed',
  gone: 'Gone',
  unsupported: 'Unsupported',
  robots_disallowed: 'Disallowed by robots.txt',
};
export const WATCH_EVENT_KIND_LABELS: Record<string, string> = {
  baseline: 'Baseline',
  changed: 'Changed',
  gone: 'Gone',
  failing: 'Failing',
  recovered: 'Recovered',
  feed_items: 'New feed items',
  unsupported: 'Unsupported',
};
export const RECHECK_STATE_LABELS: Record<string, string> = {
  not_needed: 'Not needed',
  waiting: 'Waiting',
  started: 'Started',
  done: 'Done',
  unavailable: 'Unavailable',
};
export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  exception: 'Exception',
  batch_summary: 'Batch summary',
  weekly_digest: 'Weekly digest',
  source_changed: 'Source changed',
  test: 'Test',
};
export const NOTIFICATION_STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  sent: 'Sent',
  failed: 'Failed',
  enqueue_failed: 'Could not be queued',
};
export const RUNNER_STATE_LABELS: Record<string, string> = {
  idle: 'Idle',
  running: 'Running',
  error: 'Error',
  login_expired: 'Login expired',
};
/** automation_watch_targets.kind (A00 §7): a feed the owner added, or a page cited by cards. */
export const WATCH_KIND_LABELS: Record<string, string> = { feed: 'Feed', page: 'Cited page' };
export const FEED_FORMAT_LABELS: Record<string, string> = {
  rss: 'RSS',
  atom: 'Atom',
  'html-headings': 'HTML headings',
};
/** The metrics EvalGate.cs stores with a gate (A00 §15.4); an unknown key still shows raw. */
export const EVAL_METRIC_LABELS: Record<string, string> = {
  seededRecall: 'Seeded recall',
  seededRecallCiLower: 'Seeded recall, 95% CI lower bound',
  autoAcceptPrecision: 'Auto-accept precision',
  autoAcceptPrecisionCiLower: 'Auto-accept precision, 95% CI lower bound',
  wouldAcceptCards: 'Would-accept cards',
  defectEscapeRate: 'Defect escape rate',
  controlFalsePositiveRate: 'Control false-positive rate',
  seededReps: 'Seeded repetitions',
  authoredReps: 'Authored repetitions',
};
export const FINDING_SEVERITY_LABELS: Record<string, string> = { blocker: 'Blocker', major: 'Major', minor: 'Minor' };

/** A QA finding's severity badge, the same tones the review queue uses. */
export function findingSeverityTone(severity: string): BadgeTone {
  return severity === 'minor' ? 'warning' : 'danger';
}

/** The label of an enumeration code from one of the maps above; the raw code when unknown. */
export function codeLabel(map: Record<string, string>, code: string | null | undefined): string {
  if (code === null || code === undefined || code === '') return '—';
  return own(map, code) ?? code;
}

export function runnerStateTone(state: string): BadgeTone {
  if (state === 'error' || state === 'login_expired') return 'danger';
  if (state === 'running') return 'info';
  return 'neutral';
}

/** The mode badge in the banner's title row, so off, dry run and live never look alike. */
export function modeBadge(effective: string): { text: string; tone: BadgeTone } {
  if (effective === 'live') return { text: 'LIVE', tone: 'success' };
  if (effective === 'dry_run') return { text: 'DRY RUN', tone: 'warning' };
  if (effective === 'off') return { text: 'OFF', tone: 'neutral' };
  return { text: effective.toUpperCase() || '—', tone: 'neutral' };
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

/** The Decisions tab's filters, kept in the URL so a link can name them (`?tab=decisions&state=human&open=1`). */
export type DecisionFilters = { deckId: number | null; state: string; reason: string; openOnly: boolean };

export const DECISION_FILTER_KEYS = ['deckId', 'state', 'reason', 'open'] as const;

/** The filters a URL names; an unknown state or reason is ignored rather than sent. */
export function decisionFiltersFrom(params: URLSearchParams): DecisionFilters {
  const state = params.get('state') ?? '';
  const reason = params.get('reason') ?? '';
  return {
    deckId: parsePositiveId(params.get('deckId')),
    state: (DECISION_STATES as readonly string[]).includes(state) ? state : '',
    reason: (DECISION_REASONS as readonly string[]).includes(reason) ? reason : '',
    // The console writes open=1; open=true (the API's spelling, L4) reads the same.
    openOnly: params.get('open') === '1' || params.get('open') === 'true',
  };
}

/** `params` with the Decisions filters replaced by `filters`; every other key is kept. */
export function withDecisionFilters(params: URLSearchParams, filters: DecisionFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of DECISION_FILTER_KEYS) next.delete(key);
  if (filters.deckId !== null) next.set('deckId', String(filters.deckId));
  if (filters.state) next.set('state', filters.state);
  if (filters.reason) next.set('reason', filters.reason);
  if (filters.openOnly) next.set('open', '1');
  return next;
}

/**
 * "Open only" keeps the decisions nobody has acted on yet. The server filters
 * with `open=true` (L4: state human, no human action, draft still pending); this
 * check stays as the guard for an older server that ignores the parameter.
 */
export function isOpenDecision(d: { humanAction: string | null }): boolean {
  return d.humanAction === null;
}

/** The note under the list when an older server sent decisions a person already handled. */
export function hiddenDecidedText(count: number): string {
  return `${count} decided by a person ${count === 1 ? 'is' : 'are'} hidden on the loaded pages.`;
}

/** The Decisions tab showing the open exceptions: routed to a person and not yet decided (K7). */
export const OPEN_EXCEPTIONS_SEARCH = '?tab=decisions&state=human&open=1';

/** The Email log filtered to the rows still queued, where an unconfirmed email is (K6, L5). */
export const QUEUED_EMAIL_SEARCH = '?tab=email&status=queued';

/** The Runs tab opened on one run (A00 §12.2). */
export function runSearch(runId: string): string {
  return `?tab=runs&runId=${encodeURIComponent(runId)}`;
}

/** The accessible name of the backlog's link: a bare digit means nothing in a links list. */
export function backlogLinkLabel(count: number): string {
  return `${count} ${count === 1 ? 'draft' : 'drafts'} waiting for you: show open exceptions`;
}

/**
 * The eval gate as K2 and L3 define it: only the newest evaluation counts, and
 * revoking it stops live at once. `current` is the newest row when it passed
 * and is not revoked; otherwise live runs as a dry run, whatever an older row says.
 */
export type EvalGateSummary =
  | { kind: 'none' }
  | { kind: 'effective'; gateId: number }
  | { kind: 'revoked'; gateId: number }
  | { kind: 'failed'; gateId: number };

export function evalGateSummary(state: {
  current: { gateId: number } | null;
  history: Array<{ gateId: number; passed: boolean; revokedAt: string | null }>;
}): EvalGateSummary {
  const newest = newestGate(state.history);
  if (state.current && (!newest || state.current.gateId >= newest.gateId)) {
    return { kind: 'effective', gateId: state.current.gateId };
  }
  if (!newest) return { kind: 'none' };
  if (newest.revokedAt !== null) return { kind: 'revoked', gateId: newest.gateId };
  if (!newest.passed) return { kind: 'failed', gateId: newest.gateId };
  // The server sent no current gate although its newest row passed: trust the server.
  return { kind: 'revoked', gateId: newest.gateId };
}

function newestGate<G extends { gateId: number }>(history: G[]): G | null {
  let newest: G | null = null;
  for (const g of history) if (!newest || g.gateId > newest.gateId) newest = g;
  return newest;
}

export function evalGateSummaryText(summary: EvalGateSummary): string {
  switch (summary.kind) {
    case 'none':
      return 'No eval gate is recorded, so live mode runs as a dry run.';
    case 'effective':
      return `Gate #${summary.gateId} is the newest evaluation and it passed, so live mode may run.`;
    case 'revoked':
      return `The newest eval gate (#${summary.gateId}) is revoked. Only the newest evaluation counts, so live mode runs as a dry run. Record a new report to go live.`;
    case 'failed':
      return `The newest evaluation (#${summary.gateId}) failed, and it blocks live mode: only the newest evaluation counts, so live mode runs as a dry run. Record a new passing report to go live.`;
  }
}

/** One history row's standing under K2: effective, blocking, revoked, or superseded by a newer row. */
export function evalGateRowStatus(
  gate: { gateId: number; passed: boolean; revokedAt: string | null },
  history: Array<{ gateId: number }>,
  currentId: number | null,
): { label: string; tone: BadgeTone } {
  const newest = newestGate(history);
  if (currentId !== null && gate.gateId === currentId) return { label: 'Effective', tone: 'success' };
  if (newest && gate.gateId < newest.gateId) return { label: 'Superseded', tone: 'neutral' };
  if (gate.revokedAt !== null) return { label: `Revoked ${formatTimestamp(gate.revokedAt)}`, tone: 'neutral' };
  if (!gate.passed) return { label: 'Failed: blocks live', tone: 'danger' };
  return { label: 'Not effective', tone: 'neutral' };
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

/** One failed check of a form, with the field it belongs to, so the form can mark that field. */
export type FieldProblem<F extends string> = { field: F; message: string };

export type QueueField = 'url' | 'deckId' | 'title' | 'note';

export function queueItemFieldProblems(input: {
  url: string;
  deckId: number | null;
  title: string;
  note: string;
}): Array<FieldProblem<QueueField>> {
  const problems: Array<FieldProblem<QueueField>> = [];
  const url = urlProblem(input.url);
  if (url) problems.push({ field: 'url', message: url });
  if (!isPositiveInteger(input.deckId)) problems.push({ field: 'deckId', message: 'Choose a deck.' });
  if (input.title.length > 300) problems.push({ field: 'title', message: 'The title must be at most 300 characters.' });
  if (input.note.length > 500) problems.push({ field: 'note', message: 'The note must be at most 500 characters.' });
  return problems;
}

export function queueItemProblems(input: { url: string; deckId: number | null; title: string; note: string }): string[] {
  return queueItemFieldProblems(input).map(p => p.message);
}

/**
 * The feed form's checks. The title pattern is a PostgreSQL ARE (A00 §7 note),
 * so it is only length-checked here: the server answers WATCH_PATTERN_INVALID.
 */
export type WatchField = 'url' | 'feedFormat' | 'deckId' | 'itemTitlePattern' | 'checkIntervalMinutes';

const PATTERN_TOO_LONG = 'The title pattern must be at most 1000 characters.';
const INTERVAL_OUT_OF_RANGE = 'The check interval must be a whole number of minutes from 60 to 43200.';

function intervalInRange(interval: number): boolean {
  return Number.isInteger(interval) && interval >= 60 && interval <= 43200;
}

export function watchTargetFieldProblems(input: {
  url: string;
  feedFormat: string;
  deckId: number | null;
  itemTitlePattern: string;
  checkIntervalMinutes: number;
}): Array<FieldProblem<WatchField>> {
  const problems: Array<FieldProblem<WatchField>> = [];
  const url = urlProblem(input.url);
  if (url) problems.push({ field: 'url', message: url });
  if (!(FEED_FORMATS as readonly string[]).includes(input.feedFormat)) {
    problems.push({ field: 'feedFormat', message: 'Choose a feed format.' });
  }
  if (!isPositiveInteger(input.deckId)) problems.push({ field: 'deckId', message: 'Choose a deck.' });
  if (input.itemTitlePattern.length > 1000) problems.push({ field: 'itemTitlePattern', message: PATTERN_TOO_LONG });
  if (!intervalInRange(input.checkIntervalMinutes)) {
    problems.push({ field: 'checkIntervalMinutes', message: INTERVAL_OUT_OF_RANGE });
  }
  return problems;
}

export function watchTargetProblems(input: {
  url: string;
  feedFormat: string;
  deckId: number | null;
  itemTitlePattern: string;
  checkIntervalMinutes: number;
}): string[] {
  return watchTargetFieldProblems(input).map(p => p.message);
}

/** The checks of a watch target's inline edit (title pattern and interval only). */
export function watchEditProblem(
  pattern: string,
  interval: number,
): FieldProblem<'itemTitlePattern' | 'checkIntervalMinutes'> | null {
  if (pattern.length > 1000) return { field: 'itemTitlePattern', message: PATTERN_TOO_LONG };
  if (!intervalInRange(interval)) return { field: 'checkIntervalMinutes', message: INTERVAL_OUT_OF_RANGE };
  return null;
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

// Display helpers the tabs share. Pure, so a component module never has to
// export anything but its component (react-refresh/only-export-components).

/** An ISO timestamp as `YYYY-MM-DD HH:MM UTC`; '—' for null or unparsable. */
export function formatTimestamp(iso: string | null): string {
  if (iso === null) return '—';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '—';
  return `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** The first 8 characters of a uuid, the way runs and emails are named on screen. */
export function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : '—';
}

/** Host and path of a URL, without the scheme or query; the raw text when it does not parse. */
export function urlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** Text for a nullable cell. */
export function orDash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
