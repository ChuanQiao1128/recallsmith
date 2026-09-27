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
 * and inserted with cost 0 (A00 §5.6); every other automation run is a source
 * re-check (A00 §9.6). A re-check is scope `cards` too and may cover a single
 * citing card, but it calls the reviewer, so its cost is above 0 (B07
 * frontend-console-7). The server does not persist the run's trigger yet.
 */
export function automationQaRunLabel(run: {
  requestedBySub?: string | null;
  scope: string;
  cardCount: number;
  status: string;
  estimatedCostUsd: number;
}): string | null {
  if (run.requestedBySub !== AUTOMATION_REQUESTED_BY) return null;
  if (run.scope === 'cards' && run.cardCount === 1 && run.status === 'done' && run.estimatedCostUsd === 0) {
    return 'Automation — auto-accepted draft';
  }
  return 'Automation — source re-check';
}

/** The badge text of a draft whose automatic verdict is hidden until the person decides. */
export const BLINDED_AUTOMATION_TEXT = 'Automation: dry run — verdict hidden until you decide';

/**
 * Whether the review queue hides the automation's verdict on a draft (B07
 * automation-4, C07 frontend-console-14). The dry-run shadow agreement compares
 * the person's decision with the automation's verdict, so the person must not
 * see it before deciding. Blinding only would_accept drafts gave it away: the
 * hidden badge then meant would_accept one to one. So every dry-run draft that
 * is still pending with no human action is blinded the same way, whatever its
 * state, with one neutral badge and no reason. A dry-run draft is never
 * accepted by the automation, so the person reviews it in full anyway. State,
 * reason and findings show once the draft is decided, and in live mode always.
 */
export function automationBlinded(a: DraftAutomation, draftStatus: string): boolean {
  return a.mode === 'dry_run' && draftStatus === 'pending' && !a.humanAction;
}

/**
 * Whether accepting a blinded draft first shows its AI QA findings (D07
 * frontend-console-26, G04 frontend-console-38, P4). When the automation routed
 * the draft to a person because AI QA found a blocker or major issue, those
 * findings must reach the person before the card lands. They are not shown in
 * the panel before the decision: a panel with findings would tell every panel
 * without them apart as "QA did not flag this", which for a would_accept draft
 * is the verdict itself. So every blinded draft reads the same, and the
 * findings appear in a confirm step after the person clicks Accept or Accept
 * with edits and before the request. Showing that step records the verdict as
 * seen (markVerdictSeen), so the accept, or any later decision, is not counted
 * as blind. A reject needs no step.
 */
export function automationQaFindingsShown(a: DraftAutomation, draftStatus: string): boolean {
  if (!automationBlinded(a, draftStatus)) return false;
  const qa = a.qa ?? null;
  return a.state === 'human' && a.reason === 'QA_FLAGGED' && qa !== null && qa.blocker + qa.major > 0;
}

/**
 * The `verdictShown` of an accept or reject (automation-4, D01 contract): true
 * when the automatic verdict was visible to the person before the decision, in
 * the review queue (not blinded) or recorded as seen (`seenElsewhere`): on the
 * Automation page, or by the review queue's own QA findings step (P4).
 */
export function verdictShownFor(a: DraftAutomation | null | undefined, draftStatus: string, seenElsewhere: boolean): boolean {
  if (!a) return false;
  if (seenElsewhere) return true;
  return !automationBlinded(a, draftStatus);
}

/**
 * The verdict a blinded decision hid, told once the person has decided
 * (D07 frontend-console-26), and whether it should read as a warning: an
 * accept of a draft AI QA found a blocker or major issue in.
 */
export function revealedVerdict(
  a: DraftAutomation,
  decision: 'accepted' | 'rejected',
): { text: string; warn: boolean } {
  const qa = a.qa ?? null;
  const serious = qa ? qa.blocker + qa.major : 0;
  const qaText = qa ? ` (AI QA: ${qa.blocker} blocker, ${qa.major} major, ${qa.minor} minor)` : '';
  let text: string;
  if (a.state === 'would_accept') text = `The automation would have accepted this draft${qaText}.`;
  else if (a.state === 'human') {
    text = `The automation had routed this draft to you: ${a.reason ? decisionReasonLabel(a.reason) : 'it needs a person'}${qaText}.`;
  } else text = `The automation's verdict: ${decisionStateLabel(a.state)}${qaText}.`;
  return { text, warn: decision === 'accepted' && serious > 0 };
}

export function draftAutomationBadgeText(a: DraftAutomation, blinded = false): string {
  if (blinded) return BLINDED_AUTOMATION_TEXT;
  let text = `Automation: ${decisionStateLabel(a.state)}`;
  if (a.reason) text += ` · ${decisionReasonLabel(a.reason)}`;
  if (a.mode === 'dry_run') text += ' (dry run)';
  return text;
}

export function draftAutomationTone(a: DraftAutomation, blinded = false): BadgeTone {
  if (blinded) return 'neutral';
  return decisionStateTone(a.state);
}

export function automationDraftHref(draftId: number): string {
  return `/automation?draftId=${draftId}`;
}
