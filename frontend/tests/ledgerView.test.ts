// The Automation Ledger page's pure view rules (src/lib/ledgerView.ts).

import { describe, expect, it } from 'vitest';

import {
  BASELINE_MAX_MINUTES,
  BASELINE_NOTE_MAX_LENGTH,
  DEFAULT_BASELINE_LABEL,
  LEDGER_AUTOMATIONS,
  LEDGER_AUTOMATION_LABELS,
  LEDGER_DEFINITIONS,
  LEDGER_MAX_RANGE_DAYS,
  baselineProblem,
  buildLedgerBars,
  formatHours,
  formatPercent,
  ledgerAxisLabel,
  ledgerLabelEvery,
  ledgerRangeProblem,
} from '../src/lib/ledgerView';

function point(periodStart: string, minutesSaved: number, extra: Partial<{ runs: number; units: number; defectsCaught: number }> = {}) {
  return { periodStart, runs: 1, units: 2, minutesSaved, defectsCaught: 0, ...extra };
}

describe('ledgerView', () => {
  it('sums every automation into one bar per period, oldest first', () => {
    const bars = buildLedgerBars([
      point('2026-09-14', 30, { runs: 2, units: 5, defectsCaught: 1 }),
      point('2026-09-07', 10),
      point('2026-09-14', 15, { runs: 1, units: 3, defectsCaught: 2 }),
    ]);
    expect(bars).toEqual([
      { periodStart: '2026-09-07', runs: 1, units: 2, minutesSaved: 10, defectsCaught: 0 },
      { periodStart: '2026-09-14', runs: 3, units: 8, minutesSaved: 45, defectsCaught: 3 },
    ]);
    expect(buildLedgerBars([])).toEqual([]);
  });

  it('formats minutes as hours with one decimal', () => {
    expect(formatHours(90)).toBe('1.5 h');
    expect(formatHours(0)).toBe('0.0 h');
    expect(formatHours(125)).toBe('2.1 h');
  });

  it('formats a failure rate as a percentage', () => {
    expect(formatPercent(0.125)).toBe('12.5%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(1)).toBe('100.0%');
  });

  it('refuses a reversed or longer-than-366-day range', () => {
    expect(LEDGER_MAX_RANGE_DAYS).toBe(366);
    expect(ledgerRangeProblem('', '')).toBeNull();
    expect(ledgerRangeProblem('2026-01-01', '2026-01-01')).toBeNull();
    expect(ledgerRangeProblem('2025-01-01', '2026-01-02')).toBeNull();
    expect(ledgerRangeProblem('2025-01-01', '2026-01-03')).toEqual(expect.any(String));
    expect(ledgerRangeProblem('2026-09-27', '2026-09-01')).toEqual(expect.any(String));
    expect(ledgerRangeProblem('2026-02-01', '2026-02-30')).toEqual(expect.any(String));
    expect(ledgerRangeProblem('2026-02-30', '2026-03-01')).toEqual(expect.any(String));
    expect(ledgerRangeProblem('2026-09-01', '')).toEqual(expect.any(String));
    expect(ledgerRangeProblem('', '2026-09-01')).toEqual(expect.any(String));
    expect(ledgerRangeProblem('2026-9-1', '2026-09-10')).toEqual(expect.any(String));
  });

  it('bounds a baseline between 0 and 999999.99 minutes with a note of at most 500 characters', () => {
    expect(BASELINE_MAX_MINUTES).toBe(999999.99);
    expect(BASELINE_NOTE_MAX_LENGTH).toBe(500);
    expect(baselineProblem({ baselineMinutesPerUnit: 0 })).toBeNull();
    expect(baselineProblem({ baselineMinutesPerUnit: 999999.99, note: 'x'.repeat(500) })).toBeNull();
    expect(baselineProblem({ baselineMinutesPerUnit: 2.5, note: null })).toBeNull();
    expect(baselineProblem({ baselineMinutesPerUnit: -0.01 })).toEqual(expect.any(String));
    expect(baselineProblem({ baselineMinutesPerUnit: 1000000 })).toEqual(expect.any(String));
    expect(baselineProblem({ baselineMinutesPerUnit: Number.NaN })).toEqual(expect.any(String));
    expect(baselineProblem({ baselineMinutesPerUnit: Number.POSITIVE_INFINITY })).toEqual(expect.any(String));
    expect(baselineProblem({ baselineMinutesPerUnit: 1, note: 'x'.repeat(501) })).toEqual(expect.any(String));
  });

  it('lists the definitions the ledger totals use', () => {
    expect(LEDGER_DEFINITIONS.map(d => d.term)).toEqual([
      'Run',
      'Units',
      'Baseline minutes',
      'Actual minutes',
      'Minutes saved',
      'Live and inferred from history',
      'Defects caught before publish',
      'QA false positives',
      'AI draft quality',
      'Failure rate',
      'Default baselines',
    ]);
    for (const d of LEDGER_DEFINITIONS) expect(d.definition.length).toBeGreaterThan(0);
    const byTerm = Object.fromEntries(LEDGER_DEFINITIONS.map(d => [d.term, d.definition]));
    expect(byTerm['Baseline minutes']).toContain('recomputes history');
    expect(byTerm['Minutes saved']).toContain('Failures save nothing');
    expect(byTerm['Defects caught before publish']).toContain('MCQ gate');
    expect(byTerm['Default baselines']).toContain(DEFAULT_BASELINE_LABEL);
  });

  it('states the rules the server computes, not the first draft (automation-4)', () => {
    const byTerm = Object.fromEntries(LEDGER_DEFINITIONS.map(d => [d.term, d.definition]));
    // LedgerRoutes.cs clamps per (automation, source), not per run.
    expect(byTerm['Minutes saved']).toContain(
      'Per automation and source (live or inferred from history): max(0, Σ units × baseline − Σ actual minutes)',
    );
    expect(byTerm['Minutes saved']).toContain('actual minutes include review time on rejected drafts');
    expect(byTerm['Minutes saved']).not.toContain('over successful and partial runs of max(0, units');
    // Drafts.cs records every reject with defects_caught 0.
    expect(byTerm['Defects caught before publish']).toContain('Exactly one of two things');
    expect(byTerm['Defects caught before publish']).toContain('AI QA blocker or major finding resolved as fixed');
    expect(byTerm['Defects caught before publish']).not.toContain('(b) an AI draft rejected');
    expect(byTerm['Actual minutes']).toContain('every rejected AI draft');
    expect(byTerm['AI draft quality']).toContain('Acceptance rate');
    expect(byTerm['AI draft quality']).toContain('Edited-accept rate');
    expect(byTerm['AI draft quality']).toContain('Defect rate');
    expect(byTerm['Live and inferred from history']).toContain('backfill');
  });

  it('keeps chart axis labels short and spaced so they never overlap (frontend-console-17)', () => {
    expect(ledgerAxisLabel('2026-06-30')).toBe('06-30');
    expect(ledgerAxisLabel('not-a-date')).toBe('not-a-date');
    // A 5-character label at 10 px fits one 40 px slot; a full ISO date does not.
    expect(ledgerLabelEvery(40, 5, 10)).toBe(1);
    expect(ledgerLabelEvery(40, 10, 10)).toBe(2);
    expect(ledgerLabelEvery(20, 5, 10)).toBe(2);
  });

  it('labels every seeded automation', () => {
    expect([...LEDGER_AUTOMATIONS]).toEqual([
      'publish_pipeline',
      'bulk_import',
      'ai_draft_review',
      'ai_qa_review',
      'webhook_notification',
      'publish_gate',
    ]);
    expect(LEDGER_AUTOMATIONS.map(a => LEDGER_AUTOMATION_LABELS[a])).toEqual([
      'Publish pipeline',
      'Bulk import',
      'AI draft review',
      'AI QA review',
      'Webhook notifications',
      'Publish gate',
    ]);
    expect(DEFAULT_BASELINE_LABEL).toBe('default — measure and replace');
  });
});
