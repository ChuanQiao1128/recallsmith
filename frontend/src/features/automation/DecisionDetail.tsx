// src/features/automation/DecisionDetail.tsx
//
// One automatic decision in full (A00 §16.2 GET …/decisions/:draftId): the
// card, the draft-QA findings and the event timeline. A draft a person may
// still decide (routed to a person, or a dry-run would-accept) links to the
// review queue, where the person decides.
//
// Opened from the page (a Details click), the heading takes focus and scrolls
// into view, so the owner sees the detail open wherever the row was (B07
// frontend-console-4); a deep link leaves focus where the browser put it.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { fetchAutomationDecision, type AutomationDecisionDetail } from '../../api/automation';
import { CARD_CLASS, H2_CLASS, TD_CLASS, TH_CLASS } from '../../components/console/consoleStyles';
import { Badge } from '../../components/ui/Badge';
import { Callout } from '../../components/ui/Callout';
import {
  MODE_LABELS,
  automationErrorMessage,
  codeLabel,
  decisionAwaitsPerson,
  decisionBadge,
  decisionReasonDetailText,
  decisionReasonLabel,
  decisionStateLabel,
  formatTimestamp,
  humanActionLabel,
  orDash,
} from '../../lib/automationRules';
import { QA_CATEGORY_LABELS } from '../../lib/qaReview';

type DetailState = { forDraft: number | null; error: string | null; data: AutomationDecisionDetail | null };

export function DecisionDetail({
  draftId,
  focusOnOpen,
  closeSearch,
}: {
  draftId: number;
  focusOnOpen: boolean;
  closeSearch: string;
}) {
  const [detail, setDetail] = useState<DetailState>({ forDraft: null, error: null, data: null });
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusOnOpen) return;
    const heading = headingRef.current;
    if (!heading) return;
    heading.focus();
    heading.scrollIntoView?.({ block: 'start' });
  }, [draftId, focusOnOpen]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetchAutomationDecision(draftId);
      if (cancelled) return;
      if (!res.success || !res.data) {
        setDetail({
          forDraft: draftId,
          error: automationErrorMessage(res.error?.code, res.error?.message ?? 'Failed to load the decision.'),
          data: null,
        });
        return;
      }
      setDetail({ forDraft: draftId, error: null, data: res.data });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const loading = detail.forDraft !== draftId;
  const d = loading ? null : detail.data;
  const badge = d ? decisionBadge(d) : null;
  const reasonDetail = d ? decisionReasonDetailText(d.reason, d.reasonDetail) : null;

  return (
    <section className={CARD_CLASS} aria-label="Decision detail">
      <div className="flex items-center justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className={`${H2_CLASS} focus:outline-none`}>
          Draft {draftId}
        </h2>
        <Link to={{ search: closeSearch }} className="text-sm text-indigo-700 underline">
          Close
        </Link>
      </div>

      {loading ? <p className="text-sm text-slate-600 mt-2">Loading the decision…</p> : null}
      {!loading && detail.error ? (
        <div className="mt-2">
          <Callout tone="danger" role="alert">
            {detail.error}
          </Callout>
        </div>
      ) : null}

      {d ? (
        <div className="mt-2 space-y-4 text-sm text-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
            {d.mode === 'dry_run' ? <span className="text-xs text-slate-500">(dry run)</span> : null}
            {d.reason ? <span>{decisionReasonLabel(d.reason)}</span> : null}
            {reasonDetail ? <span className="text-xs text-slate-500">{reasonDetail}</span> : null}
            {decisionAwaitsPerson(d) ? (
              <Link
                to={`/review?deckId=${d.deckId}&draftId=${d.draftId}`}
                className="text-sm text-indigo-700 underline"
              >
                Decide in review queue
              </Link>
            ) : null}
          </div>
          {d.humanAction ? (
            <p>
              <span className="text-xs text-slate-500">Person: </span>
              {humanActionLabel(d.humanAction)}
              {d.humanReason ? <span className="text-xs text-slate-500"> · {d.humanReason}</span> : null}
            </p>
          ) : null}

          {d.card ? (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-slate-600 uppercase">Card</h3>
              <p className="font-medium text-slate-900">{d.card.question}</p>
              <p>
                <span className="text-xs text-slate-500">Answer: </span>
                {d.card.explanation}
              </p>
              {d.card.source ? (
                <div>
                  <a href={d.card.source.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                    {d.card.source.url}
                  </a>
                  {d.card.source.quote ? (
                    <blockquote className="border-l-2 border-slate-300 pl-2 mt-1 text-slate-600">
                      {d.card.source.quote}
                    </blockquote>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <p>{d.question}</p>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="text-left text-xs text-slate-500 mb-1">AI QA findings</caption>
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH_CLASS}>Severity</th>
                  <th className={TH_CLASS}>Category</th>
                  <th className={TH_CLASS}>Message</th>
                  <th className={TH_CLASS}>Suggested fix</th>
                </tr>
              </thead>
              <tbody>
                {d.findings.length === 0 ? (
                  <tr className="border-t border-slate-100">
                    <td className={TD_CLASS} colSpan={4}>
                      No finding.
                    </td>
                  </tr>
                ) : (
                  d.findings.map((f, i) => (
                    <tr key={i} className="border-t border-slate-100 align-top">
                      <td className={TD_CLASS}>{f.severity}</td>
                      <td className={TD_CLASS}>{QA_CATEGORY_LABELS[f.category] ?? f.category}</td>
                      <td className={TD_CLASS}>{f.message}</td>
                      <td className={TD_CLASS}>{orDash(f.suggestedFix)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="text-left text-xs text-slate-500 mb-1">Events</caption>
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH_CLASS}>From</th>
                  <th className={TH_CLASS}>To</th>
                  <th className={TH_CLASS}>Reason</th>
                  <th className={TH_CLASS}>Actor</th>
                  <th className={TH_CLASS}>Mode</th>
                  <th className={TH_CLASS}>Time</th>
                </tr>
              </thead>
              <tbody>
                {d.events.map((e, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className={TD_CLASS}>{e.fromState ? decisionStateLabel(e.fromState) : '—'}</td>
                    <td className={TD_CLASS}>{decisionStateLabel(e.toState)}</td>
                    <td className={TD_CLASS}>{e.reason ? decisionReasonLabel(e.reason) : '—'}</td>
                    <td className={TD_CLASS}>{e.actor}</td>
                    <td className={TD_CLASS}>{codeLabel(MODE_LABELS, e.mode)}</td>
                    <td className={TD_CLASS}>{formatTimestamp(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
