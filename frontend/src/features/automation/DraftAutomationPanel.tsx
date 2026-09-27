// src/features/automation/DraftAutomationPanel.tsx
//
// The automatic decision on a draft, in the review queue's detail (A00 §16.3):
// the state and reason, the draft-QA findings and a link to the Automation
// page. Presentational: the draft detail already carries the block (§5.10).
//
// Blinded (any dry-run draft nobody has decided yet, whatever its state), it
// shows one neutral line: the verdict, the reason, the QA counts and findings,
// and the link to the decision stay hidden until the person decides, so the
// dry-run shadow agreement measures an unanchored decision (B07 automation-4,
// C07 frontend-console-14). The mode and severities read as words (-11).
//
// One exception (D07 frontend-console-26): a draft the automation routed to a
// person because AI QA found a blocker or major issue shows those findings
// while blinded, since they are the reason a person is involved. The link to
// the decision stays hidden.
import { Link } from 'react-router-dom';

import { CARD_CLASS, H2_CLASS } from '../../components/console/consoleStyles';
import { Badge } from '../../components/ui/Badge';
import {
  FINDING_SEVERITY_LABELS,
  MODE_LABELS,
  codeLabel,
  decisionReasonDetailText,
  decisionReasonLabel,
  findingSeverityTone,
  humanActionLabel,
} from '../../lib/automationRules';
import { automationDraftHref, draftAutomationBadgeText, draftAutomationTone } from '../../lib/automationSurfaces';
import { QA_CATEGORY_LABELS } from '../../lib/qaReview';
import type { DraftAutomation } from '../../types/draft';

function FindingList({ findings }: { findings: NonNullable<DraftAutomation['qa']>['findings'] }) {
  return (
    <ul className="space-y-2">
      {findings.map((f, i) => (
        <li key={i} className="border-t border-slate-100 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={findingSeverityTone(f.severity)}>{codeLabel(FINDING_SEVERITY_LABELS, f.severity)}</Badge>
            <span className="text-xs text-slate-600">{QA_CATEGORY_LABELS[f.category] ?? f.category}</span>
          </div>
          <p>{f.message}</p>
          {f.suggestedFix ? <p className="text-xs text-slate-600">Suggested fix: {f.suggestedFix}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function DraftAutomationPanel({
  draftId,
  automation,
  blinded = false,
  qaFindingsShown = false,
}: {
  draftId: number;
  automation: DraftAutomation;
  blinded?: boolean;
  /** Blinded, but routed to a person for AI QA blocker or major findings: those findings show. */
  qaFindingsShown?: boolean;
}) {
  const flaggedQa = blinded && qaFindingsShown ? (automation.qa ?? null) : null;
  if (flaggedQa) {
    return (
      <section className={`${CARD_CLASS} space-y-2`} aria-label="Automation" data-testid="review-automation">
        <h2 className={H2_CLASS}>Automation</h2>
        <div>
          <Badge tone="warning">Automation: routed to you · {decisionReasonLabel('QA_FLAGGED')} (dry run)</Badge>
        </div>
        <div className="space-y-1 text-sm text-slate-700" data-testid="review-automation-qa-flagged">
          <p className="text-xs text-slate-600">
            Reviewer: {[flaggedQa.provider, flaggedQa.model, flaggedQa.promptVersion].map(v => v ?? '—').join(' · ')}
          </p>
          <p className="text-xs text-slate-600">
            Findings: {flaggedQa.blocker} blocker, {flaggedQa.major} major, {flaggedQa.minor} minor
          </p>
          {flaggedQa.findings.length > 0 ? <FindingList findings={flaggedQa.findings} /> : null}
        </div>
      </section>
    );
  }

  if (blinded) {
    return (
      <section className={`${CARD_CLASS} space-y-2`} aria-label="Automation" data-testid="review-automation">
        <h2 className={H2_CLASS}>Automation</h2>
        <div>
          <Badge tone={draftAutomationTone(automation, true)}>{draftAutomationBadgeText(automation, true)}</Badge>
        </div>
        <p className="text-xs text-slate-600">
          Dry run: decide this draft on its own merits. The automation&apos;s verdict, its reason and its AI QA
          findings are hidden for every dry-run draft until you accept or reject it.
        </p>
      </section>
    );
  }

  const detail = decisionReasonDetailText(automation.reason, automation.reasonDetail ?? null);
  const qa = automation.qa ?? null;

  return (
    <section className={`${CARD_CLASS} space-y-2`} aria-label="Automation" data-testid="review-automation">
      <h2 className={H2_CLASS}>Automation</h2>
      <div>
        <Badge tone={draftAutomationTone(automation)}>{draftAutomationBadgeText(automation)}</Badge>
      </div>
      {automation.reason ? (
        <p className="text-sm text-slate-700">
          {decisionReasonLabel(automation.reason)}
          {detail ? <span className="text-xs text-slate-500"> · {detail}</span> : null}
        </p>
      ) : null}
      <p className="text-xs text-slate-600">
        Mode: {codeLabel(MODE_LABELS, automation.mode)}
        {automation.acceptedCardId ? <> · Accepted as card {automation.acceptedCardId}</> : null}
      </p>
      {qa ? (
        <div className="space-y-1 text-sm text-slate-700">
          <p className="text-xs text-slate-600">
            Reviewer: {[qa.provider, qa.model, qa.promptVersion].map(v => v ?? '—').join(' · ')}
          </p>
          <p className="text-xs text-slate-600">
            Findings: {qa.blocker} blocker, {qa.major} major, {qa.minor} minor
          </p>
          {qa.findings.length > 0 ? <FindingList findings={qa.findings} /> : null}
        </div>
      ) : null}
      {automation.humanAction ? (
        <p className="text-xs text-slate-600">
          A person {humanActionLabel(automation.humanAction).toLowerCase()} this draft.
        </p>
      ) : null}
      <Link to={automationDraftHref(draftId)} className="text-sm text-indigo-700 underline">
        Open in Automation
      </Link>
    </section>
  );
}
