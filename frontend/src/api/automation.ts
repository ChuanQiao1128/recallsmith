// src/api/automation.ts
// Automation console API (contract A00 §8.6, §15.4, §16.2), served under
// /api/v1/admin/automation/. Every call returns an ApiResult and never throws,
// like src/api/ledger.ts. Postgres bigint and numeric columns may arrive as
// numeric strings, so every numeric field is coerced here.
//
// Every object is built field by field from what the contract names, never by
// spreading the raw payload: nothing the contract does not list reaches the
// page. The notification shape has no recipient, and neither does anything here.
import type { ApiResult } from '../types/api';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';

export type Page<T> = { items: T[]; nextCursor: string | null };

export type AutomationMode = {
  configured: string;
  effective: string;
  liveBlockedReason: string | null;
  autoPublish: boolean;
};

export type AutomationRunner = {
  runnerId: string;
  host: string | null;
  runnerVersion: string | null;
  claudeVersion: string | null;
  state: string;
  lastHeartbeatAt: string | null;
  stale: boolean;
  loginExpiresAt: string | null;
  loginExpiresInDays: number | null;
  lastRunId: string | null;
  lastRunAt: string | null;
  lastRunOutcome: string | null;
  lastError: string | null;
};

export type EvalGateReviewer = { provider: string; model: string; promptVersion: string };

export type EvalGate = {
  gateId: number;
  reviewer: EvalGateReviewer;
  passed: boolean;
  metrics: Record<string, unknown>;
  reportSha256: string;
  createdBySub: string;
  createdAt: string;
  revokedAt: string | null;
  revokedBySub: string | null;
};

export type EvalGateState = { current: EvalGate | null; history: EvalGate[] };

export type AutomationStatus = {
  serverTime: string;
  mode: AutomationMode;
  evalGate: EvalGate | null;
  runners: AutomationRunner[];
  queue: { queued: number; due: number; claimed: number; failed: number; doneLast7d: number };
  decisions24h: { byState: Record<string, number>; byReason: Record<string, number> };
  shadow: {
    wouldAccept: number;
    humanDecided: number;
    humanAccepted: number;
    humanEditedAccepted: number;
    humanRejected: number;
    agreementRate: number | null;
  };
  publishes7d: { byState: Record<string, number> };
  spend: { todayUsd: number; automationTodayUsd: number; reservedUsd: number; dailyCapUsd: number };
  watch: { targets: number; active: number; failing: number; lastCheckedAt: string | null; changes7d: number };
  notifications: { sent24h: number; failed24h: number; queued: number; lastSentAt: string | null };
  /** K7: the open exceptions. Null when the server predates the field. */
  backlog: AutomationBacklog | null;
};

/** K7 (R18B): what still needs a person, whenever it was routed. */
export type AutomationBacklog = {
  /** Decisions in state 'human' with no human_action whose draft is still pending. */
  humanPending: number;
  oldestHumanPendingAt: string | null;
  /** Automation publishes routed to a person and not yet resolved. */
  humanPublishes: number;
};

export type AutomationPublish = {
  publishId: number;
  deckId: number | null;
  deckSlug: string | null;
  mode: string;
  state: string;
  reason: string | null;
  reasonDetail: string | null;
  jobId: string | null;
  buildId: string | null;
  updatedAt: string | null;
};

export type AutomationRunCounts = {
  submitted: number;
  qaPending: number;
  qaQueued: number;
  wouldAccept: number;
  autoAccepted: number;
  human: number;
  superseded: number;
};

export type AutomationRun = {
  runId: string;
  queueItemId: number | null;
  kind: string;
  url: string;
  title: string | null;
  deckId: number | null;
  deckSlug: string | null;
  runnerId: string;
  status: string;
  outcome: string | null;
  startedAt: string;
  completedAt: string | null;
  finalizedAt: string | null;
  counts: AutomationRunCounts;
  publishes: AutomationPublish[];
  summaryNotificationId: string | null;
  error: string | null;
  /** K3: the runner's final-message notes (plain text, at most 2000 chars); null when none or on an older server. */
  summary: string | null;
};

export type DecisionQa = {
  jobId: string | null;
  status: string | null;
  errorCode: string | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  blocker: number;
  major: number;
  minor: number;
  estimatedCostUsd: number;
  attempts: number;
};

export type AutomationDecision = {
  draftId: number;
  runId: string;
  deckId: number;
  deckSlug: string | null;
  stableUid: string | null;
  question: string;
  mode: string;
  state: string;
  reason: string | null;
  reasonDetail: string | null;
  qa: DecisionQa | null;
  acceptedCardId: number | null;
  humanAction: string | null;
  humanReason: string | null;
  createdAt: string;
  updatedAt: string | null;
  decidedAt: string | null;
};

export type DecisionCard = {
  stableUid: string;
  difficulty: number;
  topic: string | null;
  question: string;
  explanation: string;
  source: { url: string; quote: string } | null;
};

export type DecisionFinding = { severity: string; category: string; message: string; suggestedFix: string | null };

export type DecisionEvent = {
  fromState: string | null;
  toState: string;
  reason: string | null;
  actor: string;
  mode: string;
  details: unknown;
  createdAt: string;
};

export type AutomationDecisionDetail = AutomationDecision & {
  card: DecisionCard | null;
  findings: DecisionFinding[];
  events: DecisionEvent[];
};

export type QueueItem = {
  itemId: number;
  kind: string;
  url: string;
  title: string | null;
  sectionHint: string | null;
  note: string | null;
  deckId: number | null;
  deckSlug: string | null;
  status: string;
  attempts: number;
  notBefore: string | null;
  claimedByRunner: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  lastRunId: string | null;
  lastError: string | null;
  sourceTargetId: number | null;
  sourceEventId: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
  finishedAt: string | null;
};

export type WatchTarget = {
  targetId: number;
  kind: string;
  url: string;
  feedFormat: string | null;
  deckId: number | null;
  deckSlug: string | null;
  itemTitlePattern: string | null;
  active: boolean;
  checkIntervalMinutes: number;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  lastStatus: string | null;
  lastHttpStatus: number | null;
  consecutiveFailures: number;
  citingCards: number;
  createdBy: string;
  createdAt: string;
};

export type WatchEvent = {
  eventId: number;
  targetId: number;
  url: string;
  kind: string;
  oldSha256: string | null;
  newSha256: string | null;
  details: unknown;
  recheckState: string;
  recheckRunIds: string[];
  queueItemIds: number[];
  notificationId: string | null;
  createdAt: string;
};

export type WatchPage = { items: WatchTarget[]; recentEvents: WatchEvent[]; nextCursor: string | null };

export type AutomationNotification = {
  notificationId: string;
  kind: string;
  subkind: string | null;
  subject: string;
  mode: string;
  status: string;
  attempts: number;
  sesMessageId: string | null;
  errorCode: string | null;
  error: string | null;
  runId: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type AutomationNotificationDetail = AutomationNotification & { bodyText: string };

export type TestNotificationResult = { notificationId: string; status: string };

type Raw = Record<string, unknown>;

function toNumber(value: unknown): number;
function toNumber(value: unknown, nullable: true): number | null;
function toNumber(value: unknown, nullable = false): number | null {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return nullable ? null : 0;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function toNullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function isRecord(value: unknown): value is Raw {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Raw {
  return isRecord(value) ? value : {};
}

function normalizeCounts(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(asRecord(value))) out[key] = toNumber(n);
  return out;
}

function nextCursorOf(raw: Raw): string | null {
  return typeof raw.nextCursor === 'string' && raw.nextCursor !== '' ? raw.nextCursor : null;
}

/** A positive id, or null when the payload lacks one. */
function idOf(value: unknown): number | null {
  const n = toNumber(value, true);
  return n !== null && n > 0 ? n : null;
}

function normalizeRunner(value: unknown): AutomationRunner {
  const raw = asRecord(value);
  return {
    runnerId: toText(raw.runnerId),
    host: toNullableText(raw.host),
    runnerVersion: toNullableText(raw.runnerVersion),
    claudeVersion: toNullableText(raw.claudeVersion),
    state: toText(raw.state),
    lastHeartbeatAt: toNullableText(raw.lastHeartbeatAt),
    stale: raw.stale === true,
    loginExpiresAt: toNullableText(raw.loginExpiresAt),
    loginExpiresInDays: toNumber(raw.loginExpiresInDays, true),
    lastRunId: toNullableText(raw.lastRunId),
    lastRunAt: toNullableText(raw.lastRunAt),
    lastRunOutcome: toNullableText(raw.lastRunOutcome),
    lastError: toNullableText(raw.lastError),
  };
}

function normalizeEvalGate(value: unknown): EvalGate | null {
  if (!isRecord(value)) return null;
  const gateId = idOf(value.gateId);
  if (gateId === null) return null;
  const reviewer = asRecord(value.reviewer);
  return {
    gateId,
    reviewer: {
      provider: toText(reviewer.provider),
      model: toText(reviewer.model),
      promptVersion: toText(reviewer.promptVersion),
    },
    passed: value.passed === true,
    metrics: { ...asRecord(value.metrics) },
    reportSha256: toText(value.reportSha256),
    createdBySub: toText(value.createdBySub),
    createdAt: toText(value.createdAt),
    revokedAt: toNullableText(value.revokedAt),
    revokedBySub: toNullableText(value.revokedBySub),
  };
}

function normalizeStatus(data: unknown): AutomationStatus | null {
  if (!isRecord(data) || !isRecord(data.mode) || !Array.isArray(data.runners)) return null;
  const mode = data.mode;
  const queue = asRecord(data.queue);
  const decisions = asRecord(data.decisions24h);
  const shadow = asRecord(data.shadow);
  const spend = asRecord(data.spend);
  const watch = asRecord(data.watch);
  const notifications = asRecord(data.notifications);
  return {
    serverTime: toText(data.serverTime),
    mode: {
      configured: toText(mode.configured),
      effective: toText(mode.effective),
      liveBlockedReason: toNullableText(mode.liveBlockedReason),
      autoPublish: mode.autoPublish !== false,
    },
    evalGate: normalizeEvalGate(data.evalGate),
    runners: data.runners.map(normalizeRunner),
    queue: {
      queued: toNumber(queue.queued),
      due: toNumber(queue.due),
      claimed: toNumber(queue.claimed),
      failed: toNumber(queue.failed),
      doneLast7d: toNumber(queue.doneLast7d),
    },
    decisions24h: { byState: normalizeCounts(decisions.byState), byReason: normalizeCounts(decisions.byReason) },
    shadow: {
      wouldAccept: toNumber(shadow.wouldAccept),
      humanDecided: toNumber(shadow.humanDecided),
      humanAccepted: toNumber(shadow.humanAccepted),
      humanEditedAccepted: toNumber(shadow.humanEditedAccepted),
      humanRejected: toNumber(shadow.humanRejected),
      agreementRate: toNumber(shadow.agreementRate, true),
    },
    publishes7d: { byState: normalizeCounts(asRecord(data.publishes7d).byState) },
    spend: {
      todayUsd: toNumber(spend.todayUsd),
      automationTodayUsd: toNumber(spend.automationTodayUsd),
      reservedUsd: toNumber(spend.reservedUsd),
      dailyCapUsd: toNumber(spend.dailyCapUsd),
    },
    watch: {
      targets: toNumber(watch.targets),
      active: toNumber(watch.active),
      failing: toNumber(watch.failing),
      lastCheckedAt: toNullableText(watch.lastCheckedAt),
      changes7d: toNumber(watch.changes7d),
    },
    notifications: {
      sent24h: toNumber(notifications.sent24h),
      failed24h: toNumber(notifications.failed24h),
      queued: toNumber(notifications.queued),
      lastSentAt: toNullableText(notifications.lastSentAt),
    },
    backlog: normalizeBacklog(data.backlog),
  };
}

function normalizeBacklog(value: unknown): AutomationBacklog | null {
  if (!isRecord(value)) return null;
  return {
    humanPending: toNumber(value.humanPending),
    oldestHumanPendingAt: toNullableText(value.oldestHumanPendingAt),
    humanPublishes: toNumber(value.humanPublishes),
  };
}

/** K3 caps the notes at 2000 characters; the console never shows more, whatever arrives. */
export const RUN_SUMMARY_MAX = 2000;

function normalizeSummary(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  return text.length > RUN_SUMMARY_MAX ? text.slice(0, RUN_SUMMARY_MAX) : text;
}

function normalizePublish(value: unknown): AutomationPublish {
  const raw = asRecord(value);
  return {
    publishId: toNumber(raw.publishId),
    deckId: toNumber(raw.deckId, true),
    deckSlug: toNullableText(raw.deckSlug),
    mode: toText(raw.mode),
    state: toText(raw.state),
    reason: toNullableText(raw.reason),
    reasonDetail: toNullableText(raw.reasonDetail),
    jobId: toNullableText(raw.jobId),
    buildId: toNullableText(raw.buildId),
    updatedAt: toNullableText(raw.updatedAt),
  };
}

function normalizeRun(value: unknown): AutomationRun {
  const raw = asRecord(value);
  const counts = asRecord(raw.counts);
  return {
    runId: toText(raw.runId),
    queueItemId: toNumber(raw.queueItemId, true),
    kind: toText(raw.kind),
    url: toText(raw.url),
    title: toNullableText(raw.title),
    deckId: toNumber(raw.deckId, true),
    deckSlug: toNullableText(raw.deckSlug),
    runnerId: toText(raw.runnerId),
    status: toText(raw.status),
    outcome: toNullableText(raw.outcome),
    startedAt: toText(raw.startedAt),
    completedAt: toNullableText(raw.completedAt),
    finalizedAt: toNullableText(raw.finalizedAt),
    counts: {
      submitted: toNumber(counts.submitted),
      qaPending: toNumber(counts.qaPending),
      qaQueued: toNumber(counts.qaQueued),
      wouldAccept: toNumber(counts.wouldAccept),
      autoAccepted: toNumber(counts.autoAccepted),
      human: toNumber(counts.human),
      superseded: toNumber(counts.superseded),
    },
    publishes: Array.isArray(raw.publishes) ? raw.publishes.map(normalizePublish) : [],
    summaryNotificationId: toNullableText(raw.summaryNotificationId),
    error: toNullableText(raw.error),
    summary: normalizeSummary(raw.summary),
  };
}

function normalizeQa(value: unknown): DecisionQa | null {
  if (!isRecord(value)) return null;
  return {
    jobId: toNullableText(value.jobId),
    status: toNullableText(value.status),
    errorCode: toNullableText(value.errorCode),
    provider: toNullableText(value.provider),
    model: toNullableText(value.model),
    promptVersion: toNullableText(value.promptVersion),
    blocker: toNumber(value.blocker),
    major: toNumber(value.major),
    minor: toNumber(value.minor),
    estimatedCostUsd: toNumber(value.estimatedCostUsd),
    attempts: toNumber(value.attempts),
  };
}

function normalizeDecision(value: unknown): AutomationDecision {
  const raw = asRecord(value);
  return {
    draftId: toNumber(raw.draftId),
    runId: toText(raw.runId),
    deckId: toNumber(raw.deckId),
    deckSlug: toNullableText(raw.deckSlug),
    stableUid: toNullableText(raw.stableUid),
    question: toText(raw.question),
    mode: toText(raw.mode),
    state: toText(raw.state),
    reason: toNullableText(raw.reason),
    reasonDetail: toNullableText(raw.reasonDetail),
    qa: normalizeQa(raw.qa),
    acceptedCardId: toNumber(raw.acceptedCardId, true),
    humanAction: toNullableText(raw.humanAction),
    humanReason: toNullableText(raw.humanReason),
    createdAt: toText(raw.createdAt),
    updatedAt: toNullableText(raw.updatedAt),
    decidedAt: toNullableText(raw.decidedAt),
  };
}

function normalizeCard(value: unknown): DecisionCard | null {
  if (!isRecord(value)) return null;
  const source = isRecord(value.source) ? { url: toText(value.source.url), quote: toText(value.source.quote) } : null;
  return {
    stableUid: toText(value.stableUid),
    difficulty: toNumber(value.difficulty),
    topic: toNullableText(value.topic),
    question: toText(value.question),
    explanation: toText(value.explanation),
    source,
  };
}

function normalizeFinding(value: unknown): DecisionFinding {
  const raw = asRecord(value);
  return {
    severity: toText(raw.severity),
    category: toText(raw.category),
    message: toText(raw.message),
    suggestedFix: toNullableText(raw.suggestedFix),
  };
}

function normalizeDecisionEvent(value: unknown): DecisionEvent {
  const raw = asRecord(value);
  return {
    fromState: toNullableText(raw.fromState),
    toState: toText(raw.toState),
    reason: toNullableText(raw.reason),
    actor: toText(raw.actor),
    mode: toText(raw.mode),
    details: raw.details ?? null,
    createdAt: toText(raw.createdAt),
  };
}

function normalizeDecisionDetail(data: unknown): AutomationDecisionDetail | null {
  if (!isRecord(data) || idOf(data.draftId) === null) return null;
  return {
    ...normalizeDecision(data),
    card: normalizeCard(data.card),
    findings: Array.isArray(data.findings) ? data.findings.map(normalizeFinding) : [],
    events: Array.isArray(data.events) ? data.events.map(normalizeDecisionEvent) : [],
  };
}

function normalizeQueueItem(value: unknown): QueueItem {
  const raw = asRecord(value);
  return {
    itemId: toNumber(raw.itemId),
    kind: toText(raw.kind),
    url: toText(raw.url),
    title: toNullableText(raw.title),
    sectionHint: toNullableText(raw.sectionHint),
    note: toNullableText(raw.note),
    deckId: toNumber(raw.deckId, true),
    deckSlug: toNullableText(raw.deckSlug),
    status: toText(raw.status),
    attempts: toNumber(raw.attempts),
    notBefore: toNullableText(raw.notBefore),
    claimedByRunner: toNullableText(raw.claimedByRunner),
    claimedAt: toNullableText(raw.claimedAt),
    leaseExpiresAt: toNullableText(raw.leaseExpiresAt),
    lastRunId: toNullableText(raw.lastRunId),
    lastError: toNullableText(raw.lastError),
    sourceTargetId: toNumber(raw.sourceTargetId, true),
    sourceEventId: toNumber(raw.sourceEventId, true),
    createdBy: toText(raw.createdBy),
    createdAt: toText(raw.createdAt),
    updatedAt: toNullableText(raw.updatedAt),
    finishedAt: toNullableText(raw.finishedAt),
  };
}

function normalizeWatchTarget(value: unknown): WatchTarget {
  const raw = asRecord(value);
  return {
    targetId: toNumber(raw.targetId),
    kind: toText(raw.kind),
    url: toText(raw.url),
    feedFormat: toNullableText(raw.feedFormat),
    deckId: toNumber(raw.deckId, true),
    deckSlug: toNullableText(raw.deckSlug),
    itemTitlePattern: toNullableText(raw.itemTitlePattern),
    active: raw.active === true,
    checkIntervalMinutes: toNumber(raw.checkIntervalMinutes),
    lastCheckedAt: toNullableText(raw.lastCheckedAt),
    lastChangedAt: toNullableText(raw.lastChangedAt),
    lastStatus: toNullableText(raw.lastStatus),
    lastHttpStatus: toNumber(raw.lastHttpStatus, true),
    consecutiveFailures: toNumber(raw.consecutiveFailures),
    citingCards: toNumber(raw.citingCards),
    createdBy: toText(raw.createdBy),
    createdAt: toText(raw.createdAt),
  };
}

function normalizeWatchEvent(value: unknown): WatchEvent {
  const raw = asRecord(value);
  return {
    eventId: toNumber(raw.eventId),
    targetId: toNumber(raw.targetId),
    url: toText(raw.url),
    kind: toText(raw.kind),
    oldSha256: toNullableText(raw.oldSha256),
    newSha256: toNullableText(raw.newSha256),
    details: raw.details ?? null,
    recheckState: toText(raw.recheckState),
    recheckRunIds: Array.isArray(raw.recheckRunIds) ? raw.recheckRunIds.map(toText) : [],
    queueItemIds: Array.isArray(raw.queueItemIds) ? raw.queueItemIds.map(v => toNumber(v)) : [],
    notificationId: toNullableText(raw.notificationId),
    createdAt: toText(raw.createdAt),
  };
}

function normalizeNotification(value: unknown): AutomationNotification {
  const raw = asRecord(value);
  return {
    notificationId: toText(raw.notificationId),
    kind: toText(raw.kind),
    subkind: toNullableText(raw.subkind),
    subject: toText(raw.subject),
    mode: toText(raw.mode),
    status: toText(raw.status),
    attempts: toNumber(raw.attempts),
    sesMessageId: toNullableText(raw.sesMessageId),
    errorCode: toNullableText(raw.errorCode),
    error: toNullableText(raw.error),
    runId: toNullableText(raw.runId),
    createdAt: toText(raw.createdAt),
    sentAt: toNullableText(raw.sentAt),
  };
}

/** Only the keys whose value is set, so an unset filter never reaches the query string. */
function setKeys<T extends Record<string, unknown>>(params: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(params) as Array<keyof T>) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

/** Re-shapes a success through `normalize`; a failure passes through unchanged. */
function mapSuccess<T>(res: ApiResult<unknown>, normalize: (data: unknown) => T | null): ApiResult<T> {
  if (!res.success) return { ...res, data: null };
  const data = normalize(res.data);
  if (data === null) return failResult<T>('The server sent an unexpected automation response.', 'BAD_RESPONSE');
  return { ...res, data };
}

function pageOf<T>(normalize: (value: unknown) => T): (data: unknown) => Page<T> | null {
  return data => {
    if (!isRecord(data) || !Array.isArray(data.items)) return null;
    return { items: data.items.map(normalize), nextCursor: nextCursorOf(data) };
  };
}

function itemOf<T>(key: string, normalize: (value: unknown) => T): (data: unknown) => T | null {
  return data => (isRecord(data) && idOf(data[key]) !== null ? normalize(data) : null);
}

export async function fetchAutomationStatus(): Promise<ApiResult<AutomationStatus>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/status');
    return mapSuccess(resp.data, normalizeStatus);
  } catch (err) {
    return apiResultFromError<AutomationStatus>(err);
  }
}

export async function listAutomationRuns(
  params: { status?: string; deckId?: number; limit?: number; cursor?: string | null } = {},
): Promise<ApiResult<Page<AutomationRun>>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/runs', { params: setKeys(params) });
    return mapSuccess(resp.data, pageOf(normalizeRun));
  } catch (err) {
    return apiResultFromError<Page<AutomationRun>>(err);
  }
}

export async function listAutomationDecisions(
  params: {
    runId?: string;
    deckId?: number;
    state?: string;
    reason?: string;
    limit?: number;
    cursor?: string | null;
  } = {},
): Promise<ApiResult<Page<AutomationDecision>>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/decisions', {
      params: setKeys(params),
    });
    return mapSuccess(resp.data, pageOf(normalizeDecision));
  } catch (err) {
    return apiResultFromError<Page<AutomationDecision>>(err);
  }
}

export async function fetchAutomationDecision(draftId: number): Promise<ApiResult<AutomationDecisionDetail>> {
  try {
    const resp = await http.get<ApiResult<unknown>>(`/api/v1/admin/automation/decisions/${draftId}`);
    return mapSuccess(resp.data, normalizeDecisionDetail);
  } catch (err) {
    return apiResultFromError<AutomationDecisionDetail>(err);
  }
}

export async function fetchEvalGate(): Promise<ApiResult<EvalGateState>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/eval-gate');
    return mapSuccess(resp.data, data => {
      if (!isRecord(data) || !Array.isArray(data.history)) return null;
      return {
        current: normalizeEvalGate(data.current),
        history: data.history.map(normalizeEvalGate).filter((g): g is EvalGate => g !== null),
      };
    });
  } catch (err) {
    return apiResultFromError<EvalGateState>(err);
  }
}

/**
 * Sends the pasted report text unchanged: the server hashes the raw body bytes
 * (A00 §15.4 step 4), so parsing and re-serialising it here would change the hash.
 * The identity transformRequest matters: axios's default transform JSON-parses a
 * string body with a JSON content type and sends it trimmed, which drops the
 * trailing newline dc-evals writes (B07 frontend-console-3).
 */
export async function recordEvalGate(reportText: string): Promise<ApiResult<EvalGate>> {
  try {
    const resp = await http.post<ApiResult<unknown>>('/api/v1/admin/automation/eval-gate', reportText, {
      headers: { 'Content-Type': 'application/json' },
      transformRequest: [(data: unknown) => data],
    });
    return mapSuccess(resp.data, normalizeEvalGate);
  } catch (err) {
    return apiResultFromError<EvalGate>(err);
  }
}

export async function revokeEvalGate(gateId: number): Promise<ApiResult<EvalGate>> {
  try {
    const resp = await http.post<ApiResult<unknown>>(`/api/v1/admin/automation/eval-gate/${gateId}/revoke`, {});
    return mapSuccess(resp.data, normalizeEvalGate);
  } catch (err) {
    return apiResultFromError<EvalGate>(err);
  }
}

export async function listQueueItems(
  params: { status?: string; limit?: number; cursor?: string | null } = {},
): Promise<ApiResult<Page<QueueItem>>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/queue', { params: setKeys(params) });
    return mapSuccess(resp.data, pageOf(normalizeQueueItem));
  } catch (err) {
    return apiResultFromError<Page<QueueItem>>(err);
  }
}

export async function addQueueItem(input: {
  url: string;
  deckId: number;
  title?: string;
  note?: string;
}): Promise<ApiResult<QueueItem>> {
  const body: { url: string; deckId: number; title?: string; note?: string } = { url: input.url, deckId: input.deckId };
  if (input.title) body.title = input.title;
  if (input.note) body.note = input.note;
  try {
    const resp = await http.post<ApiResult<unknown>>('/api/v1/admin/automation/queue', body);
    return mapSuccess(resp.data, itemOf('itemId', normalizeQueueItem));
  } catch (err) {
    return apiResultFromError<QueueItem>(err);
  }
}

export async function skipQueueItem(itemId: number): Promise<ApiResult<QueueItem>> {
  try {
    const resp = await http.post<ApiResult<unknown>>(`/api/v1/admin/automation/queue/${itemId}/skip`, {});
    return mapSuccess(resp.data, itemOf('itemId', normalizeQueueItem));
  } catch (err) {
    return apiResultFromError<QueueItem>(err);
  }
}

export async function fetchWatch(
  params: { kind?: string; active?: boolean; limit?: number; cursor?: string | null } = {},
): Promise<ApiResult<WatchPage>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/watch', { params: setKeys(params) });
    return mapSuccess(resp.data, data => {
      if (!isRecord(data) || !Array.isArray(data.items)) return null;
      return {
        items: data.items.map(normalizeWatchTarget),
        recentEvents: Array.isArray(data.recentEvents) ? data.recentEvents.map(normalizeWatchEvent) : [],
        nextCursor: nextCursorOf(data),
      };
    });
  } catch (err) {
    return apiResultFromError<WatchPage>(err);
  }
}

export async function addWatchTarget(input: {
  url: string;
  feedFormat: string;
  deckId: number;
  itemTitlePattern?: string | null;
  checkIntervalMinutes?: number;
}): Promise<ApiResult<WatchTarget>> {
  const body: {
    url: string;
    kind: 'feed';
    feedFormat: string;
    deckId: number;
    itemTitlePattern?: string | null;
    checkIntervalMinutes?: number;
  } = { url: input.url, kind: 'feed', feedFormat: input.feedFormat, deckId: input.deckId };
  if (input.itemTitlePattern !== undefined) body.itemTitlePattern = input.itemTitlePattern;
  if (input.checkIntervalMinutes !== undefined) body.checkIntervalMinutes = input.checkIntervalMinutes;
  try {
    const resp = await http.post<ApiResult<unknown>>('/api/v1/admin/automation/watch/targets', body);
    return mapSuccess(resp.data, itemOf('targetId', normalizeWatchTarget));
  } catch (err) {
    return apiResultFromError<WatchTarget>(err);
  }
}

export async function updateWatchTarget(
  targetId: number,
  patch: { active?: boolean; deckId?: number | null; itemTitlePattern?: string | null; checkIntervalMinutes?: number },
): Promise<ApiResult<WatchTarget>> {
  try {
    const resp = await http.put<ApiResult<unknown>>(`/api/v1/admin/automation/watch/targets/${targetId}`, patch);
    return mapSuccess(resp.data, itemOf('targetId', normalizeWatchTarget));
  } catch (err) {
    return apiResultFromError<WatchTarget>(err);
  }
}

export async function listNotifications(
  params: { kind?: string; status?: string; limit?: number; cursor?: string | null } = {},
): Promise<ApiResult<Page<AutomationNotification>>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/notifications', {
      params: setKeys(params),
    });
    return mapSuccess(resp.data, pageOf(normalizeNotification));
  } catch (err) {
    return apiResultFromError<Page<AutomationNotification>>(err);
  }
}

export async function fetchNotification(notificationId: string): Promise<ApiResult<AutomationNotificationDetail>> {
  try {
    const resp = await http.get<ApiResult<unknown>>(
      `/api/v1/admin/automation/notifications/${encodeURIComponent(notificationId)}`,
    );
    return mapSuccess(resp.data, data => {
      if (!isRecord(data) || typeof data.notificationId !== 'string' || data.notificationId === '') return null;
      return { ...normalizeNotification(data), bodyText: toText(data.bodyText) };
    });
  } catch (err) {
    return apiResultFromError<AutomationNotificationDetail>(err);
  }
}

export async function sendTestNotification(): Promise<ApiResult<TestNotificationResult>> {
  try {
    const resp = await http.post<ApiResult<unknown>>('/api/v1/admin/automation/notifications/test', {});
    return mapSuccess(resp.data, data => {
      if (!isRecord(data) || typeof data.notificationId !== 'string' || data.notificationId === '') return null;
      return { notificationId: data.notificationId, status: toText(data.status) };
    });
  } catch (err) {
    return apiResultFromError<TestNotificationResult>(err);
  }
}
