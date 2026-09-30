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
// A server without the analytics migration answers 503 NOT_READY; that is an
// owner step, not an error, so it gets a neutral callout.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  USAGE_DAYS,
  fetchFreshness,
  fetchUsage,
  latestUsageDay,
  type FreshnessReport,
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
  FRESHNESS_SECTION_ID,
  formatCount,
  formatMinutes,
  formatRetention,
  sparklinePoints,
} from '../lib/usageView';
import type { ApiError } from '../types/api';

type LoadError = { code: string; message: string };
type UsageState = { forNonce: number | null; error: LoadError | null; data: UsageReport | null };
type FreshnessState = { forNonce: number | null; error: LoadError | null; data: FreshnessReport | null };

const SPARK_WIDTH = 240;
const SPARK_HEIGHT = 40;

const FRESHNESS_KIND_LABELS: Record<string, string> = { page: 'Page change', feed: 'Release notes' };

function toLoadError(error: ApiError | null, fallback: string): LoadError {
  return { code: error?.code ?? 'UNKNOWN', message: error?.message ?? fallback };
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

export function UsagePage() {
  const { hash } = useLocation();
  const [nonce, setNonce] = useState(0);
  const [usage, setUsage] = useState<UsageState>({ forNonce: null, error: null, data: null });
  const [freshness, setFreshness] = useState<FreshnessState>({ forNonce: null, error: null, data: null });

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

  const usageLoading = usage.forNonce !== nonce;
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
        <Button variant="outline" size="xs" loading={usageLoading || freshnessLoading} onClick={() => setNonce(n => n + 1)}>
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
