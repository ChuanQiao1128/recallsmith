// src/perf/PerfOverlay.tsx
//
// The read-out for the measurement layer: latest journeys plus LCP/INP/TTFB,
// and a button that copies the whole thing as JSON so a before/after pair can
// be pasted into a plan or an issue.
//
// Renders nothing at all unless the gate is open, so the production tree keeps
// exactly one boolean check for this feature.

import { useEffect, useState } from 'react';

import { getJourneys, isPerfEnabled, type Journey } from './journey';
import { getVitals, startVitals, type Vitals } from './vitals';

const VISIBLE_JOURNEYS = 20;
// Polling instead of a subscription: measurements are written from anywhere in
// the app, and a 1s refresh keeps the overlay decoupled from every call site.
const REFRESH_MS = 1000;

export function PerfOverlay() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [vitals, setVitals] = useState<Vitals>({ lcp: null, inp: null, ttfb: null });
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isPerfEnabled()) return;
    startVitals();
    const tick = () => {
      setJourneys(getJourneys(VISIBLE_JOURNEYS));
      setVitals(getVitals());
    };
    tick();
    const timer = setInterval(tick, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  if (!isPerfEnabled()) return null;

  async function copyJson() {
    const payload = JSON.stringify(
      { capturedAt: new Date().toISOString(), vitals: getVitals(), journeys: getJourneys() },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is permission-gated; the console keeps the data reachable.
      console.log(payload);
    }
  }

  return (
    <div className="fixed bottom-3 right-3 z-50 w-72 rounded-lg border border-slate-700 bg-slate-900/95 text-xs text-slate-200 shadow-xl">
      <div className="flex items-center justify-between gap-2 border-b border-slate-700 px-3 py-2">
        <span className="font-semibold tracking-wide">perf</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copyJson()}
            className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
          >
            {copied ? 'copied' : 'copy JSON'}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(v => !v)}
            className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
          >
            {collapsed ? '+' : '-'}
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <div className="max-h-72 overflow-auto px-3 py-2">
          <div className="mb-2 grid grid-cols-3 gap-2 text-center">
            <Metric label="LCP" value={vitals.lcp} />
            <Metric label="INP p98" value={vitals.inp} />
            <Metric label="TTFB" value={vitals.ttfb} />
          </div>

          {journeys.length === 0 ? (
            <p className="text-slate-400">no journeys recorded yet</p>
          ) : (
            <ul className="space-y-1">
              {journeys
                .slice()
                .reverse()
                .map((j, i) => (
                  <li key={`${j.name}-${j.startTime}-${i}`} className="flex justify-between gap-2 font-mono">
                    <span className="truncate">{j.name}</span>
                    <span>{Math.round(j.duration)}ms</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded bg-slate-800 px-1 py-1">
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
      <div className="font-mono">{value === null ? '-' : `${Math.round(value)}ms`}</div>
    </div>
  );
}
