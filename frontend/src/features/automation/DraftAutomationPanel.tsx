// src/features/automation/DraftAutomationPanel.tsx
//
// The automatic decision on a draft, in the review queue's detail (A00 §16.3):
// the state and reason, the draft-QA findings and a link to the Automation
// page. Presentational: the draft detail already carries the block (§5.10).
import { Link } from 'react-router-dom';

import { CARD_CLASS, H2_CLASS } from '../../components/console/consoleStyles';
import { Badge } from '../../components/ui/Badge';
import { decisionReasonLabel } from '../../lib/automationRules';
import { automationDraftHref, draftAutomationBadgeText, draftAutomationTone } from '../../lib/automationSurfaces';
import { QA_CATEGORY_LABELS, qaItemErrorLabel } from '../../lib/qaReview';
import type { DraftAutomation } from '../../types/draft';

const HUMAN_ACTION_LABELS: Record<string, string> = {
  accepted: 'accepted',
  edited_accepted: 'edited and accepted',
  rejected: 'rejected',
};

export function DraftAutomationPanel({ draftId, automation }: { draftId: number; automation: DraftAutomation }) {
  const detail = automation.reasonDetail
    ? automation.reason === 'QA_ERROR'
      ? qaItemErrorLabel(automation.reasonDetail)
      : automation.reasonDetail
    : null;
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
          A person {HUMAN_ACTION_LABELS[automation.humanAction] ?? automation.humanAction} this draft.
        </p>
      ) : null}
      <Link to={automationDraftHref(draftId)} className="text-sm text-indigo-700 underline">
        Open in Automation
      </Link>
    </section>
  );
}
