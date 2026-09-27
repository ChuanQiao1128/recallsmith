// src/lib/automationSurfaces.ts
//
// The automation on the console pages people already use (A00 §16.3): the
// badge and panel of a routed draft in the review queue, and the origin label
// of the AI QA runs the automation starts. Pure, so the pages only wire it.
import type { DraftAutomation } from '../types/draft';
import { decisionReasonLabel, decisionStateLabel, decisionStateTone, type BadgeTone } from './automationRules';

/** The requestedBySub of every QA run the automation starts (A00 §5.6, §9.6). */
export const AUTOMATION_REQUESTED_BY = 'automation';

/**
 * The origin label of a QA run, or null for a run a person started. The QA
 * mirror of an auto-accepted card is one card, scope `cards`, already `done`
 * (A00 §5.6); every other automation run is a source re-check (A00 §9.6).
 */
export function automationQaRunLabel(run: {
  requestedBySub?: string | null;
  scope: string;
  cardCount: number;
  status: string;
}): string | null {
  if (run.requestedBySub !== AUTOMATION_REQUESTED_BY) return null;
  if (run.scope === 'cards' && run.cardCount === 1 && run.status === 'done') return 'Automation — auto-accepted draft';
  return 'Automation — source re-check';
}

export function draftAutomationBadgeText(a: DraftAutomation): string {
  let text = `Automation: ${decisionStateLabel(a.state)}`;
  if (a.reason) text += ` · ${decisionReasonLabel(a.reason)}`;
  if (a.mode === 'dry_run') text += ' (dry run)';
  return text;
}

export function draftAutomationTone(a: DraftAutomation): BadgeTone {
  return decisionStateTone(a.state);
}

export function automationDraftHref(draftId: number): string {
  return `/automation?draftId=${draftId}`;
}
