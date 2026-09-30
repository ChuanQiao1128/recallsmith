// src/lib/usageView.ts
//
// Pure display helpers for the Usage page and the Automation overview's
// Freshness tile (R20 V10). Nothing here fetches or renders; a figure the
// server has not computed (null) is always shown as "—".

/** A count with thousands separators, or "—". */
export function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
}

/** A 0..1 share as a percentage with one decimal, or "—". */
export function formatRetention(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

/** Whole minutes ("95 min"), or "—". */
export function formatMinutes(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value).toLocaleString('en-US')} min` : '—';
}

/**
 * The `points` of an SVG polyline drawing `values` left to right inside a
 * width × height box (y grows downwards, the largest value touches the top).
 * A null value is skipped, not drawn as zero. Empty when fewer than two points
 * can be drawn.
 */
export function sparklinePoints(values: Array<number | null>, width: number, height: number): string {
  const known = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (known.length < 2) return '';
  const max = Math.max(...known);
  const min = Math.min(...known);
  const span = max - min;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points: string[] = [];
  values.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const y = span === 0 ? height / 2 : height - ((v - min) / span) * height;
    points.push(`${round1(i * step)},${round1(y)}`);
  });
  return points.join(' ');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The Freshness section's anchor on the Usage page, linked from the Automation overview. */
export const FRESHNESS_SECTION_ID = 'freshness';
export const FRESHNESS_HREF = `/usage#${FRESHNESS_SECTION_ID}`;
