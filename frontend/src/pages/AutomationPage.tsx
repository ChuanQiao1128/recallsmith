// src/pages/AutomationPage.tsx
//
// The Automation console (contract A00 §16): what the automation did and the
// exceptions it left for a person. It is read-mostly: every admin sees the
// mode, the runners, the queue, every automatic decision with its reasons, the
// watched sources and the email log; a super_admin also gets the few write
// controls (eval gate, queue, watched feeds, test email).
//
// There is no mode switch. AUTOMATION_MODE changes only by committing
// src_C/env/prod.env.json and deploying (A00 §3.1), and the banner says so.
//
// automationHref is passed explicitly, after {...consoleNav()}, because adding
// it to CONSOLE_NAV would break the byte-identical tests that pin the console's
// seven nav links; the pages of the automation area pass it themselves.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { fetchAutomationStatus, type AutomationStatus } from '../api/automation';
import { isSuperAdmin, readSessionUser } from '../auth/sessionUser';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { AUTOMATION_HREF, consoleNav } from '../components/console/consoleNav';
import { H1_CLASS } from '../components/console/consoleStyles';
import { Callout } from '../components/ui/Callout';
import { DecisionsTab } from '../features/automation/DecisionsTab';
import { EmailTab } from '../features/automation/EmailTab';
import { ModeBannerCallout } from '../features/automation/ModeBannerCallout';
import { OverviewTab } from '../features/automation/OverviewTab';
import { QueueTab } from '../features/automation/QueueTab';
import { RunsTab } from '../features/automation/RunsTab';
import { WatchTab } from '../features/automation/WatchTab';
import {
  AUTOMATION_ERROR_MESSAGES,
  AUTOMATION_TABS,
  automationErrorMessage,
  resolveAutomationView,
} from '../lib/automationRules';
import { CONSOLE_NAME } from '../lib/brand';

type LoadError = { code: string; message: string };
type StatusState = { forNonce: number | null; error: LoadError | null; data: AutomationStatus | null };

const TAB_BASE =
  'text-sm px-3 py-1.5 rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const TAB_CLASS = `${TAB_BASE} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const TAB_ACTIVE_CLASS = `${TAB_BASE} bg-indigo-50 border-indigo-300 text-indigo-700 font-medium`;

export function AutomationPage() {
  const sessionUser = useMemo(() => readSessionUser(), []);
  const superAdmin = isSuperAdmin(sessionUser);

  const [searchParams, setSearchParams] = useSearchParams();
  const view = resolveAutomationView(searchParams);

  // Bumped by the overview's Refresh and by an eval-gate write (the effective mode may change).
  const [statusNonce, setStatusNonce] = useState(0);
  const [status, setStatus] = useState<StatusState>({ forNonce: null, error: null, data: null });
  // The page's one persistent live region (a region mounted with its text is not announced).
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let cancelled = false;
    const nonce = statusNonce;
    async function run() {
      const res = await fetchAutomationStatus();
      if (cancelled) return;
      if (!res.success || !res.data) {
        setStatus({
          forNonce: nonce,
          error: {
            code: res.error?.code ?? 'UNKNOWN',
            message: res.error?.message ?? 'Failed to load the automation status.',
          },
          data: null,
        });
        return;
      }
      setStatus({ forNonce: nonce, error: null, data: res.data });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [statusNonce]);

  // The tabs wait for the first status answer: a server without migration 034
  // gets one request, not one per tab.
  const notReady = !!status.error && status.error.code.startsWith('SERVER_NOT_READY_');
  const statusLoading = status.forNonce !== statusNonce;

  function openDecision(draftId: number) {
    setSearchParams({ tab: 'decisions', draftId: String(draftId) });
  }

  function openRun(runId: string) {
    setSearchParams({ tab: 'runs', runId });
  }

  function reloadStatus() {
    setStatusNonce(n => n + 1);
  }

  return (
    <ConsoleShell title={CONSOLE_NAME} subtitle="Automation" {...consoleNav()} automationHref={AUTOMATION_HREF}>
      <h1 className={H1_CLASS}>Automation</h1>

      <div role="status" aria-live="polite" className="sr-only" data-testid="automation-live">
        {announcement}
      </div>

      {status.forNonce === null ? (
        <p className="text-sm text-slate-600">Loading the automation status…</p>
      ) : notReady ? (
        <div data-testid="automation-not-ready">
          <Callout tone="warning" title="Automation is not available yet">
            {AUTOMATION_ERROR_MESSAGES.SERVER_NOT_READY_AUTOMATION}
          </Callout>
        </div>
      ) : (
        <>
          {status.data ? (
            <ModeBannerCallout mode={status.data.mode} />
          ) : status.error ? (
            <Callout tone="danger" role="alert">
              {automationErrorMessage(status.error.code, status.error.message)}
            </Callout>
          ) : null}

          <nav aria-label="Automation tabs" className="flex flex-wrap gap-2">
            {AUTOMATION_TABS.map(tab =>
              tab.id === view.tab ? (
                <Link key={tab.id} to={{ search: `?tab=${tab.id}` }} className={TAB_ACTIVE_CLASS} aria-current="page">
                  {tab.label}
                </Link>
              ) : (
                <Link key={tab.id} to={{ search: `?tab=${tab.id}` }} className={TAB_CLASS}>
                  {tab.label}
                </Link>
              ),
            )}
          </nav>

          {view.tab === 'overview' ? (
            <OverviewTab
              status={status.data}
              statusLoading={statusLoading}
              superAdmin={superAdmin}
              announce={setAnnouncement}
              onReload={reloadStatus}
            />
          ) : null}
          {view.tab === 'runs' ? (
            <RunsTab runId={view.runId} onOpenRun={openRun} onOpenDecision={openDecision} />
          ) : null}
          {view.tab === 'decisions' ? <DecisionsTab draftId={view.draftId} onOpenDecision={openDecision} /> : null}
          {view.tab === 'queue' ? <QueueTab superAdmin={superAdmin} announce={setAnnouncement} /> : null}
          {view.tab === 'watch' ? (
            <WatchTab superAdmin={superAdmin} targetId={view.targetId} announce={setAnnouncement} />
          ) : null}
          {view.tab === 'email' ? <EmailTab superAdmin={superAdmin} announce={setAnnouncement} /> : null}
        </>
      )}
    </ConsoleShell>
  );
}
