// src/pages/UsagePage.tsx
//
// Learner usage (R20 contract §7, V10): daily, weekly and monthly active
// learners for the latest complete UTC day, a 30-day table (reviews, new users,
// cards learned, D1/D7 retention), per-deck activity, the number of accounts
// left out of every figure, and when the server last computed them. All of it
// comes from GET …/analytics/usage; the page computes nothing but the
// sparkline's geometry. A figure the server has not computed is "—".
//
// The Freshness section (#freshness, linked from the Automation overview) lists
// detected source changes followed to their publish, from GET
// …/automation/freshness, with the medians the server computed.
//
// The "Funnel (anonymous installs)" section (R24 contract §3.5), between By
// deck and Freshness, reads GET …/analytics/funnel?days=90: counts per event
// overall (with the conversion from first open and a plain SVG bar each), per
// cohort week (the last 12) and per deck (converted from goal chosen). The
// conversions come from src/lib/funnelView.ts.
//
// A server without the analytics migration answers 503 NOT_READY; that is an
// owner step, not an error, so it gets a neutral callout. Every other funnel
// error (a 404 included) shows the server message, and so does a response in
// a shape the client does not know (BAD_RESPONSE), so a mismatch never reads
// as "no install counted yet".
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  FUNNEL_DAYS,
  FUNNEL_DECK_EVENTS,
  FUNNEL_EVENTS,
  USAGE_DAYS,
  fetchFreshness,
  fetchFunnel,
  fetchUsage,
  latestUsageDay,
  type FreshnessReport,
  type FunnelReport,
  type UsageReport,
} from '../api/usage';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { consoleNav } from '../components/console/consoleNav';
import { CARD_CLASS, H1_CLASS, H2_CLASS, TD_CLASS, TH_CLASS } from '../components/console/consoleStyles';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { formatTimestamp } from '../lib/automationRules';
import { CONSOLE_NAME } from '../lib/brand';
import {
  FUNNEL_RECENT_WEEKS,
  FUNNEL_STEP_LABELS,
  barWidth,
  deckFunnelSteps,
  formatConversion,
  formatStep,
  isFunnelEmpty,
  overallFunnelSteps,
  recentCohortWeeks,
} from '../lib/funnelView';
import {
  FRESHNESS_SECTION_ID,
  formatCount,
  formatMinutes,
  formatRetention,
  sparklinePoints,
} from '../lib/usageView';
import type { ApiError } from '../types/api';

type LoadError = { code: string; message: string; httpStatus?: number };
type UsageState = { forNonce: number | null; error: LoadError | null; data: UsageReport | null };
type FreshnessState = { forNonce: number | null; error: LoadError | null; data: FreshnessReport | null };
type FunnelState = { forNonce: number | null; error: LoadError | null; data: FunnelReport | null };

const SPARK_WIDTH = 240;
const SPARK_HEIGHT = 40;
const FUNNEL_BAR_WIDTH = 200;
const FUNNEL_BAR_HEIGHT = 12;

const FRESHNESS_KIND_LABELS: Record<string, string> = { page: 'Page change', feed: 'Release notes' };

function toLoadError(error: ApiError | null, fallback: string): LoadError {
  return { code: error?.code ?? 'UNKNOWN', message: error?.message ?? fallback, httpStatus: error?.httpStatus };
}

function isNotReady(error: LoadError | null): boolean {
  return error?.code === 'NOT_READY';
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-2xl font-semibold text-slate-900" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function Sparkline({ values }: { values: Array<number | null> }) {
  const points = sparklinePoints(values, SPARK_WIDTH, SPARK_HEIGHT);
  if (points === '') return null;
  return (
    <svg
      role="img"
      aria-label={`Daily active learners over the last ${values.length} days`}
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      className="overflow-visible"
      data-testid="usage-sparkline"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-indigo-600" />
    </svg>
  );
}

function FunnelBar({ fraction }: { fraction: number }) {
  return (
    <svg
      aria-hidden="true"
      width={FUNNEL_BAR_WIDTH}
      height={FUNNEL_BAR_HEIGHT}
      viewBox={`0 0 ${FUNNEL_BAR_WIDTH} ${FUNNEL_BAR_HEIGHT}`}
      data-testid="funnel-bar"
    >
      <rect x={0} y={0} width={FUNNEL_BAR_WIDTH} height={FUNNEL_BAR_HEIGHT} className="fill-slate-100" />
      <rect
        data-bar=""
        x={0}
        y={0}
        width={barWidth(fraction, FUNNEL_BAR_WIDTH)}
        height={FUNNEL_BAR_HEIGHT}
        className="fill-indigo-500"
      />
    </svg>
  );
}

function FunnelBody({ report }: { report: FunnelReport }) {
  if (isFunnelEmpty(report)) {
    return <p className="mt-2 text-sm text-slate-500">No anonymous install has been counted yet.</p>;
  }
  const steps = overallFunnelSteps(report.overall);
  const weeks = recentCohortWeeks(report.weeks);
  return (
    <>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-sm" aria-label="Funnel steps" data-testid="funnel-steps-table">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={TH_CLASS}>Step</th>
              <th scope="col" className={TH_CLASS}>Installs</th>
              <th scope="col" className={TH_CLASS}>From first open</th>
              <th scope="col" className={TH_CLASS}>
                <span className="sr-only">Bar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {steps.map(step => (
              <tr key={step.event} className="border-t border-slate-100">
                <td className={TD_CLASS}>{step.label}</td>
                <td className={TD_CLASS}>{formatCount(step.count)}</td>
                <td className={TD_CLASS}>{formatConversion(step.conversion)}</td>
                <td className={TD_CLASS}>
                  <FunnelBar fraction={step.fraction} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-4 text-sm font-semibold text-slate-800">Cohort weeks (last {FUNNEL_RECENT_WEEKS})</h3>
      <p className="text-xs text-slate-500">
        Installs grouped by the week (from Monday) of their first open; each step shows its count and the share of
        that week&apos;s first opens.
      </p>
      {weeks.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No cohort week in this window.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm" aria-label="Funnel by cohort week" data-testid="funnel-weeks-table">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={TH_CLASS}>Week</th>
                {FUNNEL_EVENTS.map(event => (
                  <th key={event} scope="col" className={TH_CLASS}>
                    {FUNNEL_STEP_LABELS[event]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map(week => (
                <tr key={week.weekStart} className="border-t border-slate-100">
                  <td className={`${TD_CLASS} font-mono whitespace-nowrap`}>{week.weekStart}</td>
                  {overallFunnelSteps(week.counts).map(step => (
                    <td key={step.event} className={`${TD_CLASS} whitespace-nowrap`}>
                      {formatStep(step)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mt-4 text-sm font-semibold text-slate-800">By deck</h3>
      <p className="text-xs text-slate-500">
        First open carries no deck, so each deck&apos;s steps show the share of its goal chosen count.
      </p>
      {report.decks.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No deck was chosen in this window.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm" aria-label="Funnel by deck" data-testid="funnel-decks-table">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={TH_CLASS}>Deck</th>
                {FUNNEL_DECK_EVENTS.map(event => (
                  <th key={event} scope="col" className={TH_CLASS}>
                    {FUNNEL_STEP_LABELS[event]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.decks.map(deck => (
                <tr key={deck.deckSlug} className="border-t border-slate-100">
                  <td className={`${TD_CLASS} font-mono`}>{deck.deckSlug}</td>
                  {deckFunnelSteps(deck.counts).map(step => (
                    <td key={step.event} className={`${TD_CLASS} whitespace-nowrap`}>
                      {formatStep(step)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function UsagePage() {
  const { hash } = useLocation();
  const [nonce, setNonce] = useState(0);
  const [usage, setUsage] = useState<UsageState>({ forNonce: null, error: null, data: null });
  const [freshness, setFreshness] = useState<FreshnessState>({ forNonce: null, error: null, data: null });
  const [funnel, setFunnel] = useState<FunnelState>({ forNonce: null, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetchUsage(USAGE_DAYS);
      if (cancelled) return;
      setUsage(
        res.success && res.data
          ? { forNonce: nonce, error: null, data: res.data }
          : { forNonce: nonce, error: toLoadError(res.error, 'Failed to load usage.'), data: null },
      );
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetchFreshness(USAGE_DAYS);
      if (cancelled) return;
      setFreshness(
        res.success && res.data
          ? { forNonce: nonce, error: null, data: res.data }
          : { forNonce: nonce, error: toLoadError(res.error, 'Failed to load freshness.'), data: null },
      );
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetchFunnel(FUNNEL_DAYS);
      if (cancelled) return;
      setFunnel(
        res.success && res.data
          ? { forNonce: nonce, error: null, data: res.data }
          : { forNonce: nonce, error: toLoadError(res.error, 'Failed to load the funnel.'), data: null },
      );
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const usageLoading = usage.forNonce !== nonce;
  const funnelLoading = funnel.forNonce !== nonce;
  const freshnessLoading = freshness.forNonce !== nonce;
  const freshnessLoaded = !freshnessLoading;

  // The Automation overview links /usage#freshness: bring the section into view once it has content.
  useEffect(() => {
    if (!freshnessLoaded || hash !== `#${FRESHNESS_SECTION_ID}`) return;
    document.getElementById(FRESHNESS_SECTION_ID)?.scrollIntoView?.({ block: 'start' });
  }, [freshnessLoaded, hash]);

  const report = usage.data;
  const latest = report ? latestUsageDay(report.days) : null;
  const daysNewestFirst = report ? [...report.days].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)) : [];
  const dauOldestFirst = [...daysNewestFirst].reverse().map(d => d.dau);

  return (
    <ConsoleShell title={CONSOLE_NAME} subtitle="Usage" {...consoleNav()}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={H1_CLASS}>Usage</h1>
          <p className="text-sm text-slate-600">
            How many learners studied, day by day, over the last {USAGE_DAYS} complete UTC days.
          </p>
        </div>
        <Button variant="outline" size="xs" loading={usageLoading || freshnessLoading || funnelLoading} onClick={() => setNonce(n => n + 1)}>
          Refresh
        </Button>
      </div>

      {usageLoading ? (
        <p className="text-sm text-slate-500">Loading usage…</p>
      ) : isNotReady(usage.error) ? (
        <div data-testid="usage-not-ready">
          <Callout tone="info" title="Usage analytics are not set up yet">
            The server has not run the analytics database migration. The daily figures appear after the migration and
            the next automation tick.
          </Callout>
        </div>
      ) : usage.error ? (
        <Callout tone="danger" role="alert" title="Could not load usage">
          {usage.error.message}
        </Callout>
      ) : report ? (
        <>
          <section className={CARD_CLASS} aria-label="Headline">
            <h2 className={H2_CLASS}>
              {latest ? `Latest complete day: ${latest.day}` : 'No complete day computed yet'}
            </h2>
            <div className="mt-2 flex flex-wrap items-end gap-6">
              <dl className="grid grid-cols-3 gap-6">
                <Stat label="DAU" value={formatCount(latest?.dau)} testId="usage-dau" />
                <Stat label="WAU" value={formatCount(latest?.wau)} testId="usage-wau" />
                <Stat label="MAU" value={formatCount(latest?.mau)} testId="usage-mau" />
              </dl>
              <Sparkline values={dauOldestFirst} />
            </div>
            <p className="mt-3 text-xs text-slate-500" data-testid="usage-meta">
              Excluded accounts: {report.excludedSubsCount} · Last computed: {formatTimestamp(report.lastComputedAt)}
            </p>
          </section>

          <section className={CARD_CLASS} aria-label="Daily usage">
            <h2 className={H2_CLASS}>Daily</h2>
            {daysNewestFirst.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No day has been computed yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-sm" aria-label="Usage by day" data-testid="usage-days-table">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className={TH_CLASS}>Day</th>
                      <th scope="col" className={TH_CLASS}>DAU</th>
                      <th scope="col" className={TH_CLASS}>Reviews</th>
                      <th scope="col" className={TH_CLASS}>New users</th>
                      <th scope="col" className={TH_CLASS}>Cards learned</th>
                      <th scope="col" className={TH_CLASS}>D1</th>
                      <th scope="col" className={TH_CLASS}>D7</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daysNewestFirst.map(d => (
                      <tr key={d.day} className="border-t border-slate-100">
                        <td className={`${TD_CLASS} font-mono whitespace-nowrap`}>{d.day}</td>
                        <td className={TD_CLASS}>{formatCount(d.dau)}</td>
                        <td className={TD_CLASS}>{formatCount(d.reviews)}</td>
                        <td className={TD_CLASS}>{formatCount(d.newUsers)}</td>
                        <td className={TD_CLASS}>{formatCount(d.cardsLearned)}</td>
                        <td className={TD_CLASS}>{formatRetention(d.d1Retention)}</td>
                        <td className={TD_CLASS}>{formatRetention(d.d7Retention)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={CARD_CLASS} aria-label="Usage by deck">
            <h2 className={H2_CLASS}>By deck (30 days)</h2>
            {report.decks.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No deck has activity in this window.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-sm" aria-label="Usage by deck" data-testid="usage-decks-table">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className={TH_CLASS}>Deck</th>
                      <th scope="col" className={TH_CLASS}>Active learners</th>
                      <th scope="col" className={TH_CLASS}>Reviews</th>
                      <th scope="col" className={TH_CLASS}>New learners</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.decks.map(d => (
                      <tr key={d.deckSlug} className="border-t border-slate-100">
                        <td className={`${TD_CLASS} font-mono`}>{d.deckSlug}</td>
                        <td className={TD_CLASS}>{formatCount(d.activeUsers30d)}</td>
                        <td className={TD_CLASS}>{formatCount(d.reviews30d)}</td>
                        <td className={TD_CLASS}>{formatCount(d.newLearners30d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      <section className={CARD_CLASS} aria-labelledby="usage-funnel-heading">
        <h2 id="usage-funnel-heading" className={H2_CLASS}>
          Funnel (anonymous installs)
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          How far app installs got over the last {FUNNEL_DAYS} days, from anonymous counts with no user or device id.
        </p>
        {funnelLoading ? (
          <p className="mt-2 text-sm text-slate-500">Loading the funnel…</p>
        ) : isNotReady(funnel.error) ? (
          <div className="mt-2" data-testid="funnel-not-ready">
            <Callout tone="info">
              The anonymous funnel is not set up on the server yet (run the database migration).
            </Callout>
          </div>
        ) : funnel.error ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert" title="Could not load the funnel">
              {funnel.error.message}
            </Callout>
          </div>
        ) : funnel.data ? (
          <FunnelBody report={funnel.data} />
        ) : null}
      </section>

      <section id={FRESHNESS_SECTION_ID} className={CARD_CLASS} aria-labelledby="usage-freshness-heading">
        <h2 id="usage-freshness-heading" className={H2_CLASS}>
          Freshness
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Detected source changes and release notes, followed through the queue, the draft, the decision and the
          publish.
        </p>
        {freshnessLoading ? (
          <p className="mt-2 text-sm text-slate-500">Loading freshness…</p>
        ) : isNotReady(freshness.error) ? (
          <div className="mt-2" data-testid="freshness-not-ready">
            <Callout tone="info">Freshness is not available on the server yet (run the database migration).</Callout>
          </div>
        ) : freshness.error ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert" title="Could not load freshness">
              {freshness.error.message}
            </Callout>
          </div>
        ) : freshness.data ? (
          <>
            <dl className="mt-2 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Median to draft" value={formatMinutes(freshness.data.medians.minutesToDraft)} />
              <Stat label="Median to decision" value={formatMinutes(freshness.data.medians.minutesToDecision)} />
              <Stat
                label="Median to publish"
                value={formatMinutes(freshness.data.medians.minutesToPublish)}
                testId="freshness-median-publish"
              />
              <Stat label="Changes measured (n)" value={String(freshness.data.n)} />
            </dl>
            {freshness.data.items.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No source change in this window.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-sm" aria-label="Freshness list" data-testid="freshness-table">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className={TH_CLASS}>Kind</th>
                      <th scope="col" className={TH_CLASS}>Title</th>
                      <th scope="col" className={TH_CLASS}>Detected</th>
                      <th scope="col" className={TH_CLASS}>Queued</th>
                      <th scope="col" className={TH_CLASS}>Drafted</th>
                      <th scope="col" className={TH_CLASS}>Decided</th>
                      <th scope="col" className={TH_CLASS}>Published</th>
                    </tr>
                  </thead>
                  <tbody>
                    {freshness.data.items.map(item => (
                      <tr key={`${item.kind}-${item.refId}`} className="border-t border-slate-100 align-top">
                        <td className={TD_CLASS}>{FRESHNESS_KIND_LABELS[item.kind] ?? item.kind}</td>
                        <td className={TD_CLASS}>{item.title ?? item.refId}</td>
                        <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(item.detectedAt)}</td>
                        <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(item.queuedAt)}</td>
                        <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(item.draftedAt)}</td>
                        <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(item.decidedAt)}</td>
                        <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTimestamp(item.publishedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </section>
    </ConsoleShell>
  );
}
