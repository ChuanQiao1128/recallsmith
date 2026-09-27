// src/features/automation/DecisionTable.tsx
//
// One table of automatic decisions (A00 §16.2 `Decision`), shared by the
// Decisions tab and a run's decisions on the Runs tab. Each row's Details opens
// the decision drawer through the page's search parameters. A `human` decision
// keeps its state after the person decides (A00 §5.3), so the Person column and
// the state badge tell a handled one from an open one (K7).
//
// A pending dry-run verdict is hidden behind a Reveal button (D07
// frontend-console-25), and a reveal is recorded so that the later decision in
// the review queue sends verdictShown: true. An open routed row links straight
// to the review queue with Decide (frontend-console-27).
//
// Every pending undecided dry-run row is hidden alike, whatever its state
// (E05 frontend-console-30, N5): state, reason, AI QA reviewer, B/M/m and cost
// are withheld, and each such row gets the same Decide link, so no cell tells
// a routed row from a would-accept one. The Reveal button removes itself, so
// focus moves to the revealed state (frontend-console-33, WCAG 2.4.3).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import type { AutomationDecision } from '../../api/automation';
import { TD_CLASS, TH_CLASS } from '../../components/console/consoleStyles';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  HIDDEN_VERDICT_TEXT,
  MODE_LABELS,
  codeLabel,
  decisionBadge,
  decisionDecidable,
  decisionVerdictHidden,
  decisionReasonDetailText,
  decisionReasonLabel,
  formatTimestamp,
  humanActionLabel,
  orDash,
} from '../../lib/automationRules';
import { markVerdictSeen, wasVerdictSeen } from '../../lib/automationVerdictSeen';
import { formatUsd } from '../../lib/qaReview';

const QUESTION_MAX = 120;

function clip(text: string): string {
  return text.length > QUESTION_MAX ? `${text.slice(0, QUESTION_MAX - 1)}…` : text;
}

export function DecisionTable({
  items,
  onOpenDecision,
  revealAll = false,
}: {
  items: AutomationDecision[];
  onOpenDecision: (draftId: number) => void;
  /** The list itself shows the verdict (filtered by it), so no row hides it. */
  revealAll?: boolean;
}) {
  // Reveals made on this table; earlier ones come from the verdict-seen record.
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set());
  // The row just revealed, whose state cell takes the focus the Reveal button had.
  const [lastRevealed, setLastRevealed] = useState<number | null>(null);
  const revealedStateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lastRevealed !== null) revealedStateRef.current?.focus();
  }, [lastRevealed]);

  if (items.length === 0) return <p className="text-sm text-slate-600">No automatic decision matches.</p>;

  function reveal(draftId: number) {
    markVerdictSeen(draftId);
    setRevealed(prev => new Set(prev).add(draftId));
    setLastRevealed(draftId);
  }
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
            const hidden =
              !revealAll && decisionVerdictHidden(d) && !revealed.has(d.draftId) && !wasVerdictSeen(d.draftId);
            return (
              <tr key={d.draftId} className="border-t border-slate-100 align-top">
                <td className={TD_CLASS}>{d.draftId}</td>
                <td className={TD_CLASS}>{orDash(d.deckSlug)}</td>
                <td className={`${TD_CLASS} font-mono`}>{orDash(d.stableUid)}</td>
                <td className={TD_CLASS}>{clip(d.question)}</td>
                <td className={TD_CLASS}>{codeLabel(MODE_LABELS, d.mode)}</td>
                <td className={TD_CLASS}>
                  {hidden ? (
                    <>
                      <Badge tone="neutral">{HIDDEN_VERDICT_TEXT}</Badge>
                      <div>
                        <Button
                          variant="outline"
                          size="xs"
                          aria-label={`Reveal the verdict of draft ${d.draftId}`}
                          onClick={() => reveal(d.draftId)}
                        >
                          Reveal
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div
                      ref={d.draftId === lastRevealed ? revealedStateRef : undefined}
                      tabIndex={d.draftId === lastRevealed ? -1 : undefined}
                      className="focus:outline-none"
                      data-testid={`automation-decision-state-${d.draftId}`}
                    >
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      {d.mode === 'dry_run' ? <span className="text-xs text-slate-500"> (dry run)</span> : null}
                    </div>
                  )}
                </td>
                <td className={TD_CLASS}>
                  {hidden ? '—' : d.reason ? decisionReasonLabel(d.reason) : '—'}
                  {!hidden && detail ? <div className="text-xs text-slate-500">{detail}</div> : null}
                </td>
                <td className={TD_CLASS}>
                  {d.humanAction ? humanActionLabel(d.humanAction) : '—'}
                  {d.humanReason ? <div className="text-xs text-slate-500">{d.humanReason}</div> : null}
                </td>
                {/* Whether AI QA ran at all tells a routed-before-QA row from the others, so a hidden row shows none of it. */}
                <td className={TD_CLASS}>
                  {d.qa && !hidden ? `${orDash(d.qa.provider)} · ${orDash(d.qa.model)} · ${orDash(d.qa.promptVersion)}` : '—'}
                </td>
                <td className={TD_CLASS}>{d.qa && !hidden ? `${d.qa.blocker}/${d.qa.major}/${d.qa.minor}` : '—'}</td>
                <td className={TD_CLASS}>{d.qa && !hidden ? formatUsd(d.qa.estimatedCostUsd) : '—'}</td>
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
                  {hidden || decisionDecidable(d) ? (
                    <Link
                      to={`/review?deckId=${d.deckId}&draftId=${d.draftId}`}
                      className="ml-2 text-sm text-indigo-700 underline"
                      aria-label={`Decide draft ${d.draftId} in the review queue`}
                    >
                      Decide
                    </Link>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
