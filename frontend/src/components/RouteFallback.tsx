// src/components/RouteFallback.tsx
//
// What fills the screen while a lazily-loaded route chunk is in flight.
//
// The markup is copied character for character from the loading screen
// DeckListPage.tsx already shows while its first fetch is outstanding — same
// full-height centring, same slate palette, same "Loading console…" with a real
// U+2026 ellipsis rather than three periods. That sameness is the whole point:
// a route transition and a data fetch should not look like two different
// products, and a blank screen for the duration of a chunk download reads as a
// broken app rather than a busy one.
//
// This deliberately does NOT go back and make DeckListPage and DeckEditPage
// render this component instead of their own copies. The same four-class
// combination appears in those two files at four points; consolidating them is
// a separate change to files that are out of scope for this step, and doing it
// here would mean editing pages this step promised not to touch.

export function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="text-slate-600 text-lg">Loading console…</div>
    </div>
  );
}
