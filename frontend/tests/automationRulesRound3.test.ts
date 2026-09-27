// The pure rules behind the D07 console fixes (R18A fix round 3): the blind
// shadow agreement (M3), the eval-gate recording of failed reports (M4), live
// quality (M2) and the hidden dry-run verdict on the Automation page.

import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_ERROR_MESSAGES,
  EVAL_GATE_FAILED_CONFIRM,
  automationErrorMessage,
  decisionDecidable,
  decisionVerdictHidden,
  evalGateRecordErrorMessage,
  evalGateRecordedFailedText,
  evalGateReportFailed,
  evalGateReportProblem,
  liveOverrideRateText,
  newestGateId,
  shadowAgreementText,
  shadowThresholdText,
  shadowTotalsText,
} from '../src/lib/automationRules';

describe('the shadow agreement is the blind pair with the server rate (frontend-console-22, automation-21, M3)', () => {
  it('renders blind 10/10 next to all 40/50 as the blind figure', () => {
    const shadow = { humanDecided: 50, agreementRate: 1, blindDecided: 10, blindAccepted: 10 };
    expect(shadowAgreementText(shadow)).toBe('10 of 10 would-accept drafts decided blind were accepted unedited (100.0%).');
    expect(shadowTotalsText(shadow)).toBe('50 decided in all, 40 of them after seeing the verdict.');
    // E05 frontend-console-34: the floor names both halves of the runbook criterion.
    expect(shadowThresholdText(shadow)).toBe('≥ 100 blind decisions (10) and ≥ 95.0% agreement (100.0%)');
  });

  it("uses the server's rate as sent, never a ratio of its own", () => {
    // The audit's example: 10 decided / 8 accepted overall, 4 blind / 1 accepted.
    const shadow = { humanDecided: 10, agreementRate: 0.25, blindDecided: 4, blindAccepted: 1 };
    expect(shadowAgreementText(shadow)).toBe('1 of 4 would-accept drafts decided blind were accepted unedited (25.0%).');
    // An inconsistent null rate is shown as missing, not recomputed.
    expect(shadowAgreementText({ ...shadow, agreementRate: null })).toBe(
      '1 of 4 would-accept drafts decided blind were accepted unedited (rate not reported).',
    );
  });

  it('says there is no blind decision yet, and does not fall back to the non-blind counts', () => {
    const shadow = { humanDecided: 12, agreementRate: null, blindDecided: 0, blindAccepted: 0 };
    expect(shadowAgreementText(shadow)).toBe('No blind decision yet.');
    expect(shadowTotalsText(shadow)).toBe('12 decided in all, 12 of them after seeing the verdict.');
    expect(shadowThresholdText(shadow)).toBe('≥ 100 blind decisions (0) and ≥ 95.0% agreement (no rate yet)');
  });

  it('tolerates an older server without the blind counts', () => {
    const shadow = { humanDecided: 8, agreementRate: 0.875, blindDecided: null, blindAccepted: null };
    expect(shadowAgreementText(shadow)).toBe(
      'This server does not report blind decisions yet, so the shadow agreement cannot be read here.',
    );
    expect(shadowTotalsText(shadow)).toBe('8 decided in all.');
    expect(shadowThresholdText(shadow)).toBeNull();
  });
});

describe('live quality (M2)', () => {
  it('formats the override rate, a dash when nothing was auto-accepted', () => {
    expect(liveOverrideRateText(null)).toBe('—');
    expect(liveOverrideRateText(0)).toBe('0.0%');
    expect(liveOverrideRateText(0.0625)).toBe('6.3%');
  });
});

describe('the eval-gate card records failed reports (frontend-console-23, M4)', () => {
  it('lets a failed report through the shape check and flags it for the confirm', () => {
    const failed = '{"v":1,"kind":"automation-gate","passed":false}';
    expect(evalGateReportProblem(failed)).toBeNull();
    expect(evalGateReportFailed(failed)).toBe(true);
    expect(evalGateReportFailed('{"v":1,"kind":"automation-gate","passed":true}')).toBe(false);
    expect(evalGateReportFailed('{ not json')).toBe(false);
    expect(EVAL_GATE_FAILED_CONFIRM).toBe(
      'This report failed. Recording it makes it the newest evaluation, which blocks live mode.',
    );
  });

  it('names the gate a failed report became', () => {
    expect(evalGateRecordedFailedText(7)).toBe('Recorded as gate #7 (failed): live mode now runs as a dry run.');
    expect(evalGateRecordedFailedText(null)).toBe(
      'Recorded as the newest gate (failed): live mode now runs as a dry run.',
    );
    expect(newestGateId([{ gateId: 3 }, { gateId: 9 }, { gateId: 4 }])).toBe(9);
    expect(newestGateId([])).toBeNull();
  });

  it('maps EVAL_GATE_REVOKED by context and EVAL_GATE_STALE everywhere', () => {
    expect(evalGateRecordErrorMessage('EVAL_GATE_REVOKED', 'x')).toBe(
      'This report belongs to a revoked eval gate; run the evaluation again.',
    );
    // On a revoke the same code still means the gate is already revoked.
    expect(automationErrorMessage('EVAL_GATE_REVOKED', 'x')).toBe('That eval gate is already revoked.');
    expect(AUTOMATION_ERROR_MESSAGES.EVAL_GATE_STALE).toBeDefined();
    expect(evalGateRecordErrorMessage('EVAL_GATE_STALE', 'x')).toBe(
      'A newer evaluation is already recorded; this report is older and cannot replace it.',
    );
    expect(evalGateRecordErrorMessage('EVAL_GATE_INVALID', 'reviewer missing')).toBe(
      'The server could not read this gate report. reviewer missing',
    );
    expect(evalGateRecordErrorMessage(undefined, 'Network error.')).toBe('Network error.');
  });
});

describe('the hidden dry-run verdict and the Decide link (frontend-console-25, -27)', () => {
  it('hides every pending undecided dry-run verdict, a routed one too (E05 frontend-console-30)', () => {
    const d = { mode: 'dry_run', state: 'would_accept', humanAction: null };
    expect(decisionVerdictHidden(d)).toBe(true);
    expect(decisionVerdictHidden({ ...d, state: 'qa_pending' })).toBe(true);
    expect(decisionVerdictHidden({ ...d, state: 'qa_queued' })).toBe(true);
    // Round 3 kept a routed row visible, which told a hidden row was a would-accept by elimination.
    expect(decisionVerdictHidden({ ...d, state: 'human' })).toBe(true);
    expect(decisionVerdictHidden({ ...d, state: 'human', humanAction: 'rejected' })).toBe(false);
    expect(decisionVerdictHidden({ ...d, state: 'auto_accepted' })).toBe(false);
    expect(decisionVerdictHidden({ ...d, humanAction: 'accepted' })).toBe(false);
    expect(decisionVerdictHidden({ ...d, mode: 'live' })).toBe(false);
    expect(decisionVerdictHidden({ ...d, state: 'superseded' })).toBe(false);
  });

  it('offers Decide only on an open routed decision', () => {
    expect(decisionDecidable({ state: 'human', humanAction: null })).toBe(true);
    expect(decisionDecidable({ state: 'human', humanAction: 'rejected' })).toBe(false);
    expect(decisionDecidable({ state: 'would_accept', humanAction: null })).toBe(false);
  });
});
