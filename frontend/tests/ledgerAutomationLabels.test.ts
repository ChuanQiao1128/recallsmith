// The three ledger automations of release 1.8A (A00 §14, A17): their labels
// and their place after the six seeded ones. Pure: ledgerView has no I/O.

import { describe, expect, it } from 'vitest';

import { LEDGER_AUTOMATIONS, LEDGER_AUTOMATION_LABELS, orderedLedgerAutomations } from '../src/lib/ledgerView';

const SEEDED = [
  'publish_pipeline',
  'bulk_import',
  'ai_draft_review',
  'ai_qa_review',
  'webhook_notification',
  'publish_gate',
];

describe('ledger automation labels', () => {
  it('labels the three automation types added by release 1.8A', () => {
    expect(LEDGER_AUTOMATION_LABELS.auto_accept).toBe('Auto-accept');
    expect(LEDGER_AUTOMATION_LABELS.auto_publish).toBe('Auto-publish');
    expect(LEDGER_AUTOMATION_LABELS.source_watch).toBe('Source watch');
  });

  it('orders unknown automations after the six seeded ones', () => {
    expect(orderedLedgerAutomations([])).toEqual(SEEDED);
    expect(
      orderedLedgerAutomations(['source_watch', 'bulk_import', '', 'auto_accept', 'source_watch', 'auto_publish']),
    ).toEqual([...SEEDED, 'source_watch', 'auto_accept', 'auto_publish']);
  });

  it('keeps the six seeded automations unchanged', () => {
    expect([...LEDGER_AUTOMATIONS]).toEqual(SEEDED);
    const before = [...LEDGER_AUTOMATIONS];
    orderedLedgerAutomations(['auto_accept']);
    expect([...LEDGER_AUTOMATIONS]).toEqual(before);
  });
});
