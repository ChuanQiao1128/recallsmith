// @vitest-environment jsdom
//
// The pure rules behind the E05 console fixes (R18A fix round 4, N1 and N5):
// the blind rule on every row, the per-run split, AUTHOR_NOT_GATED, the full
// go-live floor, and the reveal record shared by every tab of the browser.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DECISION_REASONS,
  SHADOW_AGREEMENT_TARGET,
  SHADOW_BLIND_DECISIONS_TARGET,
  decisionFiltersFrom,
  decisionListShowsVerdict,
  decisionReasonLabel,
  runSplitShown,
  shadowFloorMet,
  shadowThresholdText,
} from '../src/lib/automationRules';

const STORAGE_KEY = 'dc.automation.verdictSeen.v1';

describe('AUTHOR_NOT_GATED (frontend-console-31, N1)', () => {
  it('is a decision reason in contract order, with the email template wording', () => {
    expect(DECISION_REASONS[DECISION_REASONS.length - 1]).toBe('AUTHOR_NOT_GATED');
    expect(decisionReasonLabel('AUTHOR_NOT_GATED')).toBe('Author configuration differs from the eval gate');
  });

  it('survives a URL filter', () => {
    expect(decisionFiltersFrom(new URLSearchParams('reason=AUTHOR_NOT_GATED')).reason).toBe('AUTHOR_NOT_GATED');
  });
});

describe('the verdict a list filter shows (frontend-console-30)', () => {
  it('is shown by any state or reason filter, not by a deck filter or none', () => {
    expect(decisionListShowsVerdict({ state: 'would_accept', reason: '' })).toBe(true);
    expect(decisionListShowsVerdict({ state: 'human', reason: '' })).toBe(true);
    expect(decisionListShowsVerdict({ state: '', reason: 'QA_FLAGGED' })).toBe(true);
    expect(decisionListShowsVerdict({ state: '', reason: '' })).toBe(false);
  });
});

describe("a run's state split (frontend-console-30, N5)", () => {
  const pending = { qaPending: 0, qaQueued: 1, wouldAccept: 1, human: 1 };
  const decided = [
    { mode: 'dry_run', state: 'would_accept', humanAction: 'accepted' },
    { mode: 'dry_run', state: 'human', humanAction: 'rejected' },
  ];

  it('is hidden in dry run, off and an unknown mode while a draft may be pending', () => {
    for (const mode of ['dry_run', 'off', null]) expect(runSplitShown(pending, mode, null), String(mode)).toBe(false);
  });

  it('shows in live mode', () => {
    expect(runSplitShown(pending, 'live', null)).toBe(true);
  });

  it('shows when the counts alone prove nothing is pending', () => {
    expect(runSplitShown({ qaPending: 0, qaQueued: 0, wouldAccept: 0, human: 0 }, 'dry_run', null)).toBe(true);
  });

  it("shows once every one of the run's decisions is loaded and decided", () => {
    expect(runSplitShown(pending, 'dry_run', { items: decided, complete: true })).toBe(true);
    expect(runSplitShown(pending, 'dry_run', { items: decided, complete: false })).toBe(false);
    const open = [...decided, { mode: 'dry_run', state: 'human', humanAction: null }];
    expect(runSplitShown(pending, 'dry_run', { items: open, complete: true })).toBe(false);
  });
});

describe('the go-live floor has both halves (frontend-console-34)', () => {
  it('names the count and the rate against their thresholds', () => {
    expect(SHADOW_BLIND_DECISIONS_TARGET).toBe(100);
    expect(SHADOW_AGREEMENT_TARGET).toBe(0.95);
    const shadow = { humanDecided: 40, agreementRate: 0.8, blindDecided: 37, blindAccepted: 30 };
    expect(shadowThresholdText(shadow)).toBe('≥ 100 blind decisions (37) and ≥ 95.0% agreement (80.0%)');
  });

  it('is met only when both halves pass', () => {
    const base = { humanDecided: 100, blindAccepted: 0 };
    expect(shadowFloorMet({ ...base, blindDecided: 100, agreementRate: 0.8 })).toBe(false);
    expect(shadowFloorMet({ ...base, blindDecided: 99, agreementRate: 1 })).toBe(false);
    expect(shadowFloorMet({ ...base, blindDecided: 100, agreementRate: 0.95 })).toBe(true);
    expect(shadowFloorMet({ ...base, blindDecided: 0, agreementRate: null })).toBe(false);
    expect(shadowFloorMet({ ...base, blindDecided: null, agreementRate: null })).toBeNull();
  });
});

describe('the reveal record is shared across tabs (frontend-console-32, N5)', () => {
  async function freshModule() {
    vi.resetModules();
    return import('../src/lib/automationVerdictSeen');
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('a reveal written by one module instance is read by a fresh one', async () => {
    const tabA = await freshModule();
    tabA.markVerdictSeen(51);
    const tabB = await freshModule();
    expect(tabB.wasVerdictSeen(51)).toBe(true);
    expect(tabB.verdictSeenElsewhere(51)).toBe(true);
    expect(tabB.wasVerdictSeen(52)).toBe(false);
  });

  it('a reveal another tab writes after this one loaded still counts', async () => {
    const tabA = await freshModule();
    expect(tabA.wasVerdictSeen(51)).toBe(false);
    // Another tab of the origin writes the shared entry.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([51]));
    expect(tabA.wasVerdictSeen(51)).toBe(true);
    // And a reveal here keeps the other tab's.
    tabA.markVerdictSeen(52);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([51, 52]);
  });

  it("carries round 3's per-tab entry over", async () => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([7]));
    const tab = await freshModule();
    expect(tab.wasVerdictSeen(7)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([7]);
  });

  it('ignores a damaged entry', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    const tab = await freshModule();
    expect(tab.wasVerdictSeen(51)).toBe(false);
    expect(tab.verdictSeenElsewhere(51)).toBe(false);
  });

  it('falls back to "shown" when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const tab = await freshModule();
    // The page still blinds from memory...
    expect(tab.wasVerdictSeen(51)).toBe(false);
    tab.markVerdictSeen(51);
    expect(tab.wasVerdictSeen(51)).toBe(true);
    // ...but a decision never claims to be blind: another tab may have shown the verdict.
    expect(tab.verdictSeenElsewhere(52)).toBe(true);
  });
});
