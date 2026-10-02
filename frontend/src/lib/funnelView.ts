// src/lib/funnelView.ts
//
// Pure display helpers for the Usage page's "Funnel (anonymous installs)"
// section (R24 contract §3.5). The server sends counts only; this turns them
// into steps with the conversion from the first step (first open overall, goal
// chosen per deck) and the bar share for the plain SVG bars. Nothing here
// fetches or renders; a count the server did not send (null) stays null and is
// shown as "—".
import {
  FUNNEL_DECK_EVENTS,
  FUNNEL_EVENTS,
  type FunnelEvent,
  type FunnelReport,
  type FunnelWeek,
} from '../api/usage';
import { formatCount, formatRetention } from './usageView';

/** How many cohort weeks the section lists. */
export const FUNNEL_RECENT_WEEKS = 12;

export const FUNNEL_STEP_LABELS: Record<FunnelEvent, string> = {
  first_open: 'First open',
  goal_chosen: 'Goal chosen',
  starter_started: 'Starter started',
  starter_completed: 'Starter completed',
  first_pack_opened: 'First pack opened',
  returned_day_1: 'Returned day 1',
  returned_day_7: 'Returned day 7',
  signup_started: 'Sign-up started',
  signup_completed: 'Sign-up completed',
};

export type FunnelStep = {
  event: FunnelEvent;
  label: string;
  count: number | null;
  /** The first step, the one the others are converted from. */
  isBase: boolean;
  /** count ÷ the first step's count (0..1); null when either is unknown or the first step is 0. */
  conversion: number | null;
  /** count ÷ the largest count among the steps (0..1), for the bar; 0 when unknown. */
  fraction: number;
};

function known(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Steps for `events` in order, each converted against the first event's count. */
export function funnelSteps<E extends FunnelEvent>(
  counts: Partial<Record<E, number | null>>,
  events: readonly E[],
): FunnelStep[] {
  const base = events.length > 0 ? counts[events[0]] : null;
  const max = Math.max(0, ...events.map(e => counts[e]).filter(known));
  return events.map((event, i) => {
    const count = counts[event] ?? null;
    return {
      event,
      label: FUNNEL_STEP_LABELS[event],
      count,
      isBase: i === 0,
      conversion: known(count) && known(base) && base > 0 ? count / base : null,
      fraction: known(count) && max > 0 ? count / max : 0,
    };
  });
}

/** Every funnel event, converted from first open. */
export function overallFunnelSteps(counts: Partial<Record<FunnelEvent, number | null>>): FunnelStep[] {
  return funnelSteps(counts, FUNNEL_EVENTS);
}

/** The per-deck events, converted from goal chosen (first open carries no deck). */
export function deckFunnelSteps(
  counts: Partial<Record<(typeof FUNNEL_DECK_EVENTS)[number], number | null>>,
): FunnelStep[] {
  return funnelSteps(counts, FUNNEL_DECK_EVENTS);
}

/** The newest `limit` cohort weeks, newest first. */
export function recentCohortWeeks(weeks: FunnelWeek[], limit: number = FUNNEL_RECENT_WEEKS): FunnelWeek[] {
  return [...weeks].sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0)).slice(0, limit);
}

/** A 0..1 conversion as a percentage with one decimal, or "—". */
export function formatConversion(value: number | null | undefined): string {
  return formatRetention(value);
}

/** "900 (75.0%)": the count with its conversion; the first step and an unknown conversion show the count alone. */
export function formatStep(step: FunnelStep): string {
  if (!known(step.count)) return '—';
  if (step.isBase || step.conversion === null) return formatCount(step.count);
  return `${formatCount(step.count)} (${formatConversion(step.conversion)})`;
}

/** A 0..1 share as a bar width inside `width`, clamped, to one decimal. */
export function barWidth(fraction: number, width: number): number {
  if (!Number.isFinite(fraction)) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(clamped * width * 10) / 10;
}

/** True when the server counted nothing at all in the window. */
export function isFunnelEmpty(report: FunnelReport): boolean {
  const all = [
    ...Object.values(report.overall),
    ...report.weeks.flatMap(w => Object.values(w.counts)),
    ...report.decks.flatMap(d => Object.values(d.counts)),
  ];
  return all.every(v => !known(v) || v === 0);
}
