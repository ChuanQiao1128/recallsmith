// src/features/automation/DecisionTable.tsx
//
// One table of automatic decisions (A00 §16.2 `Decision`), shared by the
// Decisions tab and a run's decisions on the Runs tab. Each row's Details opens
// the decision drawer through the page's search parameters. A `human` decision
// keeps its state after the person decides (A00 §5.3), so the Person column and
// the state badge tell a handled one from an open one (K7).
import type { AutomationDecision } from '../../api/automation';
import { TD_CLASS, TH_CLASS } from '../../components/console/consoleStyles';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  MODE_LABELS,
  codeLabel,
  decisionBadge,
  decisionReasonDetailText,
  decisionReasonLabel,
  formatTimestamp,
  humanActionLabel,
  orDash,
} from '../../lib/automationRules';
import { formatUsd } from '../../lib/qaReview';

const QUESTION_MAX = 120;

function clip(text: string): string {
  return text.length > QUESTION_MAX ? `${text.slice(0, QUESTION_MAX - 1)}…` : text;
}

export function DecisionTable({
  items,
  onOpenDecision,
}: {
  items: AutomationDecision[];
  onOpenDecision: (draftId: number) => void;
}) {
  if (items.length === 0) return <p className="text-sm text-slate-600">No automatic decision matches.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className={TH_CLASS}>Draft</th>
            <th className={TH_CLASS}>Deck</th>
            <th className={TH_CLASS}>Stable uid</th>
            <th className={TH_CLASS}>Question</th>
            <th className={TH_CLASS}>Mode</th>
            <th className={TH_CLASS}>State</th>
            <th className={TH_CLASS}>Reason</th>
            <th className={TH_CLASS}>Person</th>
            <th className={TH_CLASS}>AI QA reviewer</th>
            <th className={TH_CLASS}>B/M/m</th>
            <th className={TH_CLASS}>Cost</th>
            <th className={TH_CLASS}>Created</th>
            <th className={TH_CLASS}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map(d => {
            const badge = decisionBadge(d);
            const detail = decisionReasonDetailText(d.reason, d.reasonDetail);
            return (
              <tr key={d.draftId} className="border-t border-slate-100 align-top">
                <td className={TD_CLASS}>{d.draftId}</td>
                <td className={TD_CLASS}>{orDash(d.deckSlug)}</td>
                <td className={`${TD_CLASS} font-mono`}>{orDash(d.stableUid)}</td>
                <td className={TD_CLASS}>{clip(d.question)}</td>
                <td className={TD_CLASS}>{codeLabel(MODE_LABELS, d.mode)}</td>
                <td className={TD_CLASS}>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                  {d.mode === 'dry_run' ? <span className="text-xs text-slate-500"> (dry run)</span> : null}
                </td>
                <td className={TD_CLASS}>
                  {d.reason ? decisionReasonLabel(d.reason) : '—'}
                  {detail ? <div className="text-xs text-slate-500">{detail}</div> : null}
                </td>
                <td className={TD_CLASS}>
                  {d.humanAction ? humanActionLabel(d.humanAction) : '—'}
                  {d.humanReason ? <div className="text-xs text-slate-500">{d.humanReason}</div> : null}
                </td>
                <td className={TD_CLASS}>
                  {d.qa ? `${orDash(d.qa.provider)} · ${orDash(d.qa.model)} · ${orDash(d.qa.promptVersion)}` : '—'}
                </td>
                <td className={TD_CLASS}>{d.qa ? `${d.qa.blocker}/${d.qa.major}/${d.qa.minor}` : '—'}</td>
                <td className={TD_CLASS}>{d.qa ? formatUsd(d.qa.estimatedCostUsd) : '—'}</td>
                <td className={TD_CLASS}>{formatTimestamp(d.createdAt)}</td>
                <td className={TD_CLASS}>
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label={`Details of draft ${d.draftId}`}
                    onClick={() => onOpenDecision(d.draftId)}
                  >
                    Details
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
