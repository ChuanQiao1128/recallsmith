// src/features/automation/DraftAutomationPanel.tsx
//
// The automatic decision on a draft, in the review queue's detail (A00 §16.3):
// the state and reason, the draft-QA findings and a link to the Automation
// page. Presentational: the draft detail already carries the block (§5.10).
//
// Blinded (a dry-run would-accept draft nobody has decided yet), it shows only
// that the automation decided: the verdict, the QA counts and findings, and the
// link to the decision stay hidden until the person decides, so the dry-run
// shadow agreement measures an unanchored decision (B07 automation-4).
import { Link } from 'react-router-dom';

import { CARD_CLASS, H2_CLASS } from '../../components/console/consoleStyles';
import { Badge } from '../../components/ui/Badge';
import { decisionReasonDetailText, decisionReasonLabel, humanActionLabel } from '../../lib/automationRules';
import { automationDraftHref, draftAutomationBadgeText, draftAutomationTone } from '../../lib/automationSurfaces';
import { QA_CATEGORY_LABELS } from '../../lib/qaReview';
import type { DraftAutomation } from '../../types/draft';

export function DraftAutomationPanel({
  draftId,
  automation,
  blinded = false,
}: {
  draftId: number;
  automation: DraftAutomation;
  blinded?: boolean;
}) {
  if (blinded) {
    return (
      <section className={`${CARD_CLASS} space-y-2`} aria-label="Automation" data-testid="review-automation">
        <h2 className={H2_CLASS}>Automation</h2>
        <div>
          <Badge tone={draftAutomationTone(automation, true)}>{draftAutomationBadgeText(automation, true)}</Badge>
        </div>
        <p className="text-xs text-slate-600">
          Dry run: decide this draft on its own merits. The automation&apos;s verdict and its AI QA findings show
          after you accept or reject it.
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
        Mode: {automation.mode || '—'}
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
          {qa.findings.length > 0 ? (
            <ul className="space-y-2">
              {qa.findings.map((f, i) => (
                <li key={i} className="border-t border-slate-100 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={f.severity === 'minor' ? 'warning' : 'danger'}>{f.severity}</Badge>
                    <span className="text-xs text-slate-600">{QA_CATEGORY_LABELS[f.category] ?? f.category}</span>
                  </div>
                  <p>{f.message}</p>
                  {f.suggestedFix ? <p className="text-xs text-slate-600">Suggested fix: {f.suggestedFix}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
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
