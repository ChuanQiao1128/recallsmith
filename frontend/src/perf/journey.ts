// src/perf/journey.ts
//
// Timing for whole user journeys (publish, import preview), on top of the
// User Timing API.
//
// Why performance.mark/measure and not Date.now():
//  - performance's clock is monotonic. Date.now() follows the system wall
//    clock, so an NTP correction or a manual clock change in the middle of a
//    journey produces a negative or wildly inflated duration, and those are
//    exactly the samples that look like the regressions we are hunting.
//  - resolution: performance.now() is sub-millisecond, Date.now() is whole
//    milliseconds and often coarsened further, which is too blunt for the
//    render-side half of a journey.
//  - marks and measures are emitted into the DevTools performance timeline,
//    so a slow journey can be read directly against paint, layout, long tasks
//    and network in the same trace, with no extra plumbing on our side.
//
// Gated: outside DEV (or an explicit ?perf=1) every entry point returns after
// one boolean read, so production carries no measurement cost.

export interface Journey {
  name: string;
  duration: number;
  startTime: number;
}

// Enough history for a debugging session; the overlay shows a slice of it.
const MAX_JOURNEYS = 50;

function detectEnabled(): boolean {
  // ?perf=1 wins so a production build can be measured on demand without a
  // rebuild; the check is guarded because this module also loads under node.
  try {
    if (typeof location !== 'undefined' && location.search.includes('perf=1')) return true;
  } catch {
    /* no location: not a browser host, fall through to the build-time flag */
  }
  return import.meta.env.DEV === true;
}

const enabled = detectEnabled();

export function isPerfEnabled(): boolean {
  return enabled;
}

const journeys: Journey[] = [];

// One namespace for our marks so they are obvious in a DevTools trace and can
// never collide with a mark set by a library.
function startMarkName(name: string): string {
  return `journey:${name}:start`;
}

export function markStart(name: string): void {
  if (!enabled) return;
  try {
    performance.mark(startMarkName(name));
  } catch {
    /* User Timing unavailable: measurement is best effort, never fatal */
  }
}

export function markEnd(name: string): void {
  if (!enabled) return;
  const start = startMarkName(name);
  try {
    // Throws when the start mark is missing, which is the normal outcome for a
    // journey the user abandoned; nothing is recorded and that is correct.
    const entry = performance.measure(name, start) as PerformanceMeasure | undefined;
    if (entry) {
      journeys.push({ name: entry.name, duration: entry.duration, startTime: entry.startTime });
      if (journeys.length > MAX_JOURNEYS) journeys.shift();
    }
    performance.clearMarks(start);
  } catch {
    /* unmatched markEnd, or no User Timing support */
  }
}

/** Most recent journeys, oldest first, newest last. */
export function getJourneys(limit = MAX_JOURNEYS): Journey[] {
  if (limit <= 0) return [];
  return journeys.slice(-limit);
}

export function clearJourneys(): void {
  journeys.length = 0;
}
