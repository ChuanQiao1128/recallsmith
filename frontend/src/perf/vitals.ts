// src/perf/vitals.ts
//
// LCP / INP / TTFB straight from PerformanceObserver. No web-vitals package:
// the three numbers we need are three observers, and a dependency that ships
// to every user in order to serve a DEV-only overlay is a bad trade.
//
// Same gate as journey.ts, so nothing observes in production unless the URL
// explicitly asks with ?perf=1.

import { isPerfEnabled } from './journey';

export interface Vitals {
  /** Largest contentful paint, ms. Last reported candidate wins per spec. */
  lcp: number | null;
  /** p98 of observed event durations, ms. A cheap stand-in for real INP. */
  inp: number | null;
  /** Time to first byte, ms. */
  ttfb: number | null;
}

// Event durations are kept raw so the percentile can be recomputed as more
// interactions arrive; capped because a long session is otherwise unbounded.
const MAX_EVENT_SAMPLES = 250;

let lcp: number | null = null;
let ttfb: number | null = null;
const eventDurations: number[] = [];
let started = false;

function observe(type: string, onEntries: (entries: PerformanceEntryList) => void, durationThreshold?: number): void {
  try {
    const observer = new PerformanceObserver(list => onEntries(list.getEntries()));
    // buffered: entries that fired before this code ran still count, which is
    // the whole point for LCP and navigation. durationThreshold is spelled out
    // on the init object because older DOM typings do not declare it.
    const init: PerformanceObserverInit & { durationThreshold?: number } = { type, buffered: true };
    if (durationThreshold !== undefined) init.durationThreshold = durationThreshold;
    observer.observe(init);
  } catch {
    /* entry type unsupported by this browser: that vital stays null */
  }
}

export function startVitals(): void {
  if (!isPerfEnabled() || started) return;
  started = true;

  observe('largest-contentful-paint', entries => {
    const last = entries[entries.length - 1];
    if (last) lcp = last.startTime;
  });

  // durationThreshold 40ms keeps the stream to interactions a user can feel.
  observe(
    'event',
    entries => {
      for (const entry of entries) {
        eventDurations.push(entry.duration);
      }
      if (eventDurations.length > MAX_EVENT_SAMPLES) {
        eventDurations.splice(0, eventDurations.length - MAX_EVENT_SAMPLES);
      }
    },
    40,
  );

  observe('navigation', entries => {
    const nav = entries[0] as PerformanceNavigationTiming | undefined;
    if (nav) ttfb = nav.responseStart;
  });
}

export function getVitals(): Vitals {
  return { lcp, inp: percentile(eventDurations, 0.98), ttfb };
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}
