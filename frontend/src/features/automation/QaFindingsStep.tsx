// src/features/automation/QaFindingsStep.tsx
//
// The review queue's confirm step for a blinded draft the automation routed to
// a person because AI QA found a blocker or major issue (G04
// frontend-console-38, P4). It opens after the person clicks Accept or Accept
// with edits and before the request, so the findings reach a person before the
// card lands (owner decision 4) without telling the draft apart in the pending
// list. The page records the verdict as seen when it opens this step.
//
// A modal dialog: focus opens on Back, the safe choice, Tab stays inside, and
// Escape or a press on the overlay goes back, like ui/ConfirmDialog.
import { useEffect, useId, useRef } from 'react';

import { Button } from '../../components/ui/Button';
import type { DraftAutomation } from '../../types/draft';
import { FindingList } from './DraftAutomationPanel';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function QaFindingsStep({
  qa,
  onAcceptAnyway,
  onBack,
}: {
  qa: NonNullable<DraftAutomation['qa']>;
  onAcceptAnyway: () => void;
  onBack: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  const serious = qa.findings.filter(f => f.severity === 'blocker' || f.severity === 'major');

  useEffect(() => {
    const trigger = document.activeElement;
    backRef.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onBack();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onBack();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="bg-white rounded-xl border border-slate-200 shadow-lg max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-3 focus:outline-none"
        onKeyDown={onPanelKeyDown}
        data-testid="review-qa-findings-step"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          AI QA found a blocker or major issue
        </h2>
        <p id={bodyId} className="text-sm text-slate-700">
          The automation routed this draft to you because AI QA found {qa.blocker} blocker and {qa.major} major{' '}
          {qa.blocker + qa.major === 1 ? 'issue' : 'issues'}. Read them before the card is created. Your decision now
          counts as not blind in the dry-run shadow agreement.
        </p>
        <p className="text-xs text-slate-600">
          Reviewer: {[qa.provider, qa.model, qa.promptVersion].map(v => v ?? '—').join(' · ')}
        </p>
        {serious.length > 0 ? <FindingList findings={serious} /> : null}
        <div className="flex gap-3 justify-end pt-2">
          <Button ref={backRef} variant="secondary" size="md" onClick={onBack}>
            Back
          </Button>
          <Button variant="primary" size="md" onClick={onAcceptAnyway}>
            Accept anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
