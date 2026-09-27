// The Automation page's pure rules (contract A00 §16.1): the codes of §5.9 and
// §6.6 with their labels, the deep links of §12.2 and §13, the mode banner of
// §3.2 and the checks the forms run before a request.

import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_ERROR_MESSAGES,
  AUTOMATION_TABS,
  DECISION_REASONS,
  DECISION_REASON_LABELS,
  DECISION_STATES,
  DECISION_STATE_LABELS,
  LOGIN_WARN_DAYS,
  MODE_CHANGE_HINT,
  PUBLISH_REASONS,
  PUBLISH_REASON_LABELS,
  PUBLISH_STATES,
  PUBLISH_STATE_LABELS,
  automationErrorMessage,
  decisionReasonLabel,
  decisionStateBars,
  decisionStateLabel,
  decisionStateTone,
  evalGateReportProblem,
  formatAge,
  loginExpiryWarning,
  modeBanner,
  parsePositiveId,
  publishReasonLabel,
  publishStateLabel,
  queueItemProblems,
  resolveAutomationView,
  shadowAgreementText,
  watchTargetProblems,
} from '../src/lib/automationRules';

// Copied literally from A00 §5.9 and §6.6.
const CONTRACT_DECISION_REASONS = [
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
];
const CONTRACT_PUBLISH_REASONS = [
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
];

const RUN_ID = '3f2a9c1e-0b4d-4c8e-9a71-5d6e7f809a1b';

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe('automationRules', () => {
  it('labels every decision reason and publish reason code of the contract', () => {
    expect([...DECISION_REASONS]).toEqual(CONTRACT_DECISION_REASONS);
    expect([...PUBLISH_REASONS]).toEqual(CONTRACT_PUBLISH_REASONS);
    expect(DECISION_REASONS).not.toContain('HUMAN_ACTION');

    for (const code of [...CONTRACT_DECISION_REASONS, 'HUMAN_ACTION']) {
      const label = decisionReasonLabel(code);
      expect(label, code).toBe(DECISION_REASON_LABELS[code]);
      expect(label.length, code).toBeGreaterThan(0);
      expect(label, code).not.toBe(code);
    }
    for (const code of CONTRACT_PUBLISH_REASONS) {
      const label = publishReasonLabel(code);
      expect(label, code).toBe(PUBLISH_REASON_LABELS[code]);
      expect(label.length, code).toBeGreaterThan(0);
      expect(label, code).not.toBe(code);
    }
    expect(decisionReasonLabel('QA_FLAGGED')).toBe('AI QA found a blocker or major issue');
    expect(publishReasonLabel('DECK_NEVER_PUBLISHED')).toBe('The first publish of a deck is always a person');
    // A code the server adds later shows as itself.
    expect(decisionReasonLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(publishReasonLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(decisionReasonLabel('constructor')).toBe('constructor');
  });

  it('labels every decision and publish state', () => {
    expect([...DECISION_STATES]).toEqual([
      'qa_pending',
      'qa_queued',
      'would_accept',
      'auto_accepted',
      'human',
      'superseded',
    ]);
    expect([...PUBLISH_STATES]).toEqual(['waiting', 'publishing', 'published', 'would_publish', 'human']);
    for (const state of DECISION_STATES) {
      expect(decisionStateLabel(state)).toBe(DECISION_STATE_LABELS[state]);
      expect(decisionStateLabel(state)).not.toBe(state);
    }
    for (const state of PUBLISH_STATES) {
      expect(publishStateLabel(state)).toBe(PUBLISH_STATE_LABELS[state]);
      expect(publishStateLabel(state)).not.toBe(state);
    }
    expect(decisionStateLabel('human')).toBe('Needs you');
    expect(decisionStateLabel('would_accept')).toBe('Would be accepted');
    expect(publishStateLabel('would_publish')).toBe('Would publish');
    expect(decisionStateLabel('later')).toBe('later');
    expect(publishStateLabel('later')).toBe('later');

    expect(decisionStateTone('auto_accepted')).toBe('success');
    expect(decisionStateTone('would_accept')).toBe('info');
    expect(decisionStateTone('human')).toBe('warning');
    expect(decisionStateTone('qa_queued')).toBe('neutral');
    expect(decisionStateTone('superseded')).toBe('neutral');
  });

  it('resolves the tab from tab, draftId, runId and targetId deep links', () => {
    expect(AUTOMATION_TABS.map(t => t.id)).toEqual(['overview', 'runs', 'decisions', 'queue', 'watch', 'email']);

    expect(resolveAutomationView(params(''))).toEqual({ tab: 'overview', runId: null, draftId: null, targetId: null });
    for (const tab of AUTOMATION_TABS) {
      expect(resolveAutomationView(params(`tab=${tab.id}`)).tab).toBe(tab.id);
    }
    // Deep links without a tab.
    expect(resolveAutomationView(params('draftId=41'))).toEqual({
      tab: 'decisions',
      runId: null,
      draftId: 41,
      targetId: null,
    });
    expect(resolveAutomationView(params(`runId=${RUN_ID}`))).toEqual({
      tab: 'runs',
      runId: RUN_ID,
      draftId: null,
      targetId: null,
    });
    expect(resolveAutomationView(params('targetId=3'))).toEqual({
      tab: 'watch',
      runId: null,
      draftId: null,
      targetId: 3,
    });
    expect(resolveAutomationView(params('tab=watch&targetId=3'))).toEqual({
      tab: 'watch',
      runId: null,
      draftId: null,
      targetId: 3,
    });
    // draftId wins over runId, runId over targetId.
    expect(resolveAutomationView(params(`runId=${RUN_ID}&draftId=5&targetId=3`)).tab).toBe('decisions');
    expect(resolveAutomationView(params(`runId=${RUN_ID}&targetId=3`)).tab).toBe('runs');
    // An explicit tab wins over the inferred one.
    expect(resolveAutomationView(params('tab=email&draftId=41')).tab).toBe('email');
    // The uuid check ignores case.
    expect(resolveAutomationView(params(`runId=${RUN_ID.toUpperCase()}`)).runId).toBe(RUN_ID.toUpperCase());

    // Invalid values are dropped.
    expect(resolveAutomationView(params('tab=mode'))).toEqual({
      tab: 'overview',
      runId: null,
      draftId: null,
      targetId: null,
    });
    expect(resolveAutomationView(params('runId=not-a-uuid'))).toEqual({
      tab: 'overview',
      runId: null,
      draftId: null,
      targetId: null,
    });
    expect(resolveAutomationView(params(`runId=${RUN_ID}x`)).runId).toBeNull();
    for (const bad of ['0', '-1', '01', '1.5', 'abc', '1e3', ' 7', '1234567890123456', '']) {
      expect(resolveAutomationView(params(`draftId=${encodeURIComponent(bad)}`)).draftId, bad).toBeNull();
      expect(resolveAutomationView(params(`targetId=${encodeURIComponent(bad)}`)).targetId, bad).toBeNull();
    }
    expect(resolveAutomationView(params('draftId=abc&targetId=3')).tab).toBe('watch');

    expect(parsePositiveId('123456789012345')).toBe(123456789012345);
    expect(parsePositiveId(null)).toBeNull();
    expect(parsePositiveId(undefined)).toBeNull();
  });

  it('builds the mode banner for off, dry_run, live and a blocked live', () => {
    expect(MODE_CHANGE_HINT).toBe('Change AUTOMATION_MODE in src_C/env/prod.env.json and deploy');

    const off = modeBanner({ configured: 'off', effective: 'off', liveBlockedReason: null, autoPublish: true });
    expect(off).toEqual({
      tone: 'neutral',
      title: 'Automation is off',
      lines: ['Configured: off · Effective: off', MODE_CHANGE_HINT],
    });

    const dry = modeBanner({ configured: 'dry_run', effective: 'dry_run', liveBlockedReason: null, autoPublish: true });
    expect(dry.tone).toBe('info');
    expect(dry.title).toBe('Dry run: every decision is recorded, nothing is accepted or published');
    expect(dry.lines).toEqual(['Configured: dry_run · Effective: dry_run', MODE_CHANGE_HINT]);

    const live = modeBanner({ configured: 'live', effective: 'live', liveBlockedReason: null, autoPublish: true });
    expect(live.tone).toBe('success');
    expect(live.title).toBe('Live: new cards that pass every check are accepted and published automatically');
    expect(live.lines.at(-1)).toBe(MODE_CHANGE_HINT);

    const blocked = modeBanner({
      configured: 'live',
      effective: 'dry_run',
      liveBlockedReason: 'EVAL_GATE_MISSING',
      autoPublish: false,
    });
    expect(blocked.tone).toBe('warning');
    expect(blocked.title).toBe('Dry run: every decision is recorded, nothing is accepted or published');
    expect(blocked.lines).toEqual([
      'AUTOMATION_MODE=live is blocked: no passed eval gate, so it runs as a dry run',
      'Auto-publish is disabled (AUTOMATION_AUTO_PUBLISH)',
      'Configured: live · Effective: dry_run',
      MODE_CHANGE_HINT,
    ]);

    const notReady = modeBanner({
      configured: 'dry_run',
      effective: 'off',
      liveBlockedReason: 'SERVER_NOT_READY_AUTOMATION',
      autoPublish: true,
    });
    expect(notReady.tone).toBe('warning');
    expect(notReady.lines[0]).toBe('The server has not run migration 034');
    expect(notReady.lines.at(-1)).toBe(MODE_CHANGE_HINT);
  });

  it('flags a login that expires within the warning window', () => {
    expect(LOGIN_WARN_DAYS).toBe(5);
    expect(loginExpiryWarning(null)).toBe(false);
    expect(loginExpiryWarning(21.4)).toBe(false);
    expect(loginExpiryWarning(5.1)).toBe(false);
    expect(loginExpiryWarning(5)).toBe(true);
    expect(loginExpiryWarning(0.5)).toBe(true);
    expect(loginExpiryWarning(-1)).toBe(true);
    expect(loginExpiryWarning(8, 10)).toBe(true);

    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(formatAge(null, now)).toBe('—');
    expect(formatAge('not a date', now)).toBe('—');
    expect(formatAge('2026-09-28T11:59:30Z', now)).toBe('just now');
    expect(formatAge('2026-09-28T11:45:00Z', now)).toBe('15 min ago');
    expect(formatAge('2026-09-28T09:00:00Z', now)).toBe('3 h ago');
    expect(formatAge('2026-09-26T13:00:00Z', now)).toBe('47 h ago');
    expect(formatAge('2026-09-23T12:00:00Z', now)).toBe('5 d ago');

    // D07 frontend-console-22 (M3): the blind pair and the server's rate, never the all-decisions pair.
    expect(shadowAgreementText({ humanDecided: 0, agreementRate: null, blindDecided: 0, blindAccepted: 0 })).toBe(
      'No blind decision yet.',
    );
    expect(shadowAgreementText({ humanDecided: 8, agreementRate: 0.875, blindDecided: 8, blindAccepted: 7 })).toBe(
      '7 of 8 would-accept drafts decided blind were accepted unedited (87.5%).',
    );

    const bars = decisionStateBars({ human: 2, would_accept: 4 }, 200);
    expect(bars.map(b => b.state)).toEqual([...DECISION_STATES]);
    expect(bars.find(b => b.state === 'would_accept')).toEqual({
      state: 'would_accept',
      label: 'Would be accepted',
      count: 4,
      width: 200,
    });
    expect(bars.find(b => b.state === 'human')?.width).toBe(100);
    expect(bars.find(b => b.state === 'qa_pending')?.width).toBe(0);
    expect(decisionStateBars({}, 200).every(b => b.width === 0 && b.count === 0)).toBe(true);
  });

  it('validates the queue and watch target forms', () => {
    const queue = { url: 'https://docs.aws.amazon.com/s3/', deckId: 7, title: '', note: '' };
    expect(queueItemProblems(queue)).toEqual([]);
    expect(queueItemProblems({ ...queue, url: '  https://docs.aws.amazon.com/s3/  ' })).toEqual([]);
    expect(queueItemProblems({ ...queue, url: '' })).toHaveLength(1);
    expect(queueItemProblems({ ...queue, url: 'http://docs.aws.amazon.com/' })).toHaveLength(1);
    expect(queueItemProblems({ ...queue, url: `https://example.com/${'a'.repeat(2048)}` })).toHaveLength(1);
    expect(queueItemProblems({ ...queue, url: 'https://' })).toHaveLength(1);
    expect(queueItemProblems({ ...queue, deckId: null })).toHaveLength(1);
    expect(queueItemProblems({ ...queue, deckId: 0 })).toHaveLength(1);
    expect(queueItemProblems({ ...queue, deckId: 1.5 })).toHaveLength(1);
    expect(queueItemProblems({ ...queue, title: 'x'.repeat(300) })).toEqual([]);
    expect(queueItemProblems({ ...queue, title: 'x'.repeat(301) })).toHaveLength(1);
    expect(queueItemProblems({ ...queue, note: 'x'.repeat(501) })).toHaveLength(1);
    expect(queueItemProblems({ url: '', deckId: null, title: 'x'.repeat(301), note: 'x'.repeat(501) })).toHaveLength(4);

    const feed = {
      url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/',
      feedFormat: 'rss',
      deckId: 7,
      itemTitlePattern: '',
      checkIntervalMinutes: 360,
    };
    expect(watchTargetProblems(feed)).toEqual([]);
    for (const format of ['rss', 'atom', 'html-headings']) {
      expect(watchTargetProblems({ ...feed, feedFormat: format })).toEqual([]);
    }
    expect(watchTargetProblems({ ...feed, feedFormat: 'json' })).toHaveLength(1);
    expect(watchTargetProblems({ ...feed, url: 'ftp://example.com/feed' })).toHaveLength(1);
    expect(watchTargetProblems({ ...feed, deckId: null })).toHaveLength(1);
    expect(watchTargetProblems({ ...feed, checkIntervalMinutes: 59 })).toHaveLength(1);
    expect(watchTargetProblems({ ...feed, checkIntervalMinutes: 60 })).toEqual([]);
    expect(watchTargetProblems({ ...feed, checkIntervalMinutes: 43200 })).toEqual([]);
    expect(watchTargetProblems({ ...feed, checkIntervalMinutes: 43201 })).toHaveLength(1);
    expect(watchTargetProblems({ ...feed, checkIntervalMinutes: 90.5 })).toHaveLength(1);
    expect(watchTargetProblems({ ...feed, checkIntervalMinutes: Number.NaN })).toHaveLength(1);
    expect(watchTargetProblems({ ...feed, itemTitlePattern: 'x'.repeat(1001) })).toHaveLength(1);
    // A PostgreSQL ARE is not judged by the JavaScript engine: \m and an unbalanced group pass here.
    expect(watchTargetProblems({ ...feed, itemTitlePattern: '\\m(S3|EC2\\M' })).toEqual([]);
  });

  it('checks a pasted eval gate report before sending it', () => {
    expect(evalGateReportProblem('')).toBe('Paste the gate report JSON.');
    expect(evalGateReportProblem('   \n')).toBe('Paste the gate report JSON.');
    expect(evalGateReportProblem('{ not json')).toBe('The report is not valid JSON.');
    expect(evalGateReportProblem('[1, 2]')).toBe('This is not an automation-gate report.');
    expect(evalGateReportProblem('"automation-gate"')).toBe('This is not an automation-gate report.');
    expect(evalGateReportProblem('null')).toBe('This is not an automation-gate report.');
    expect(evalGateReportProblem('{"v":1,"kind":"ledger","passed":true}')).toBe(
      'This is not an automation-gate report.',
    );
    expect(evalGateReportProblem('{"v":2,"kind":"automation-gate","passed":true}')).toBe(
      'This is not an automation-gate report.',
    );
    // D07 frontend-console-23 (M4): a failed report is a valid report; the card confirms, then records it.
    expect(evalGateReportProblem('{"v":1,"kind":"automation-gate","passed":false}')).toBeNull();
    expect(evalGateReportProblem('{"v":1,"kind":"automation-gate","passed":"true"}')).toBeNull();
    expect(evalGateReportProblem('{"v":1,"kind":"automation-gate","passed":true,"failures":[]}')).toBeNull();
  });

  it('maps the automation error codes and keeps the server message for unknown ones', () => {
    for (const [code, sentence] of Object.entries(AUTOMATION_ERROR_MESSAGES)) {
      if (code === 'EVAL_GATE_FAILED' || code === 'EVAL_GATE_INVALID') continue;
      expect(automationErrorMessage(code, 'server words'), code).toBe(sentence);
    }
    expect(automationErrorMessage('QUEUE_ITEM_EXISTS', 'conflict')).toBe(
      'That URL is already queued or being drafted for this deck.',
    );
    expect(automationErrorMessage('NOTIFY_NOT_CONFIGURED', 'x')).toBe(
      'Email is not configured on the server (AUTOMATION_NOTIFY_QUEUE_URL is empty).',
    );
    expect(automationErrorMessage('EVAL_GATE_FAILED', 'seededRecall 0.81 < 0.90')).toBe(
      // D07 frontend-console-23: L3 wording, the failed report is recorded and now blocks live.
      'The server recomputed the report and it does not pass the gate; it is recorded as the newest evaluation, so live mode runs as a dry run. seededRecall 0.81 < 0.90',
    );
    expect(automationErrorMessage('EVAL_GATE_INVALID', 'reviewer missing')).toBe(
      'The server could not read this gate report. reviewer missing',
    );
    expect(automationErrorMessage('SOMETHING_ELSE', 'The server said no.')).toBe('The server said no.');
    expect(automationErrorMessage(undefined, 'Network error.')).toBe('Network error.');
    expect(automationErrorMessage('toString', 'kept')).toBe('kept');
  });
});
