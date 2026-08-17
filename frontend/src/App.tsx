import { Suspense, lazy } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { RequireAuth } from './auth/RequireAuth';
import { PerfOverlay } from './perf/PerfOverlay';
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary';
import { ConfirmDialogProvider } from './components/ui/ConfirmDialog';
import { RouteFallback } from './components/RouteFallback';

// Login and the OAuth callback stay eager. They are the only two routes an
// unauthenticated first visit can land on, so deferring them would add a chunk
// round trip to the critical path to save a couple of kilobytes.
import { LoginPage } from './pages/LoginPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';

// Every protected page is loaded on demand. These pages carry the expensive
// dependencies — highlight.js rides in with CardForm, and the import, admin and
// content-intelligence screens are ones most sessions never open — and before
// this split all of them were downloaded before the login screen could paint.
//
// The `.then` remap is required, not stylistic: React.lazy resolves to a module
// whose `default` is the component, and none of these pages has a default
// export. Getting a name wrong here is a runtime-only failure that `tsc
// --noEmit` cannot see in this repo (it checks zero files); `tsc -b --force`
// does catch it.

/**
 * Named so the module can start fetching the deck list immediately, below.
 * Route splitting moves the cost of a page from "first load" to "first visit",
 * and for the one route that is the app's front door that trade is a
 * regression: the user would stare at the fallback every cold start. Kicking the
 * request off at module scope means it is usually finished before React has
 * finished mounting, while keeping DeckListPage in its own chunk so it stays out
 * of the first-load closure.
 *
 * No other route is prefetched. Each one that is added spends part of the
 * saving this split just bought.
 */
const loadDeckList = () => import('./pages/DeckListPage');

const DeckListPage = lazy(() => loadDeckList().then(m => ({ default: m.DeckListPage })));
const NewDeckPage = lazy(() => import('./pages/NewDeckPage').then(m => ({ default: m.NewDeckPage })));
const CardListPage = lazy(() => import('./pages/CardListPage').then(m => ({ default: m.CardListPage })));
const NewCardPage = lazy(() => import('./pages/NewCardPage').then(m => ({ default: m.NewCardPage })));
const EditCardPage = lazy(() => import('./pages/EditCardPage').then(m => ({ default: m.EditCardPage })));
const DeckImportPage = lazy(() => import('./pages/DeckImportPage').then(m => ({ default: m.DeckImportPage })));
const DeckPreviewPage = lazy(() => import('./pages/DeckPreviewPage').then(m => ({ default: m.DeckPreviewPage })));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const DeckEditPage = lazy(() => import('./pages/DeckEditPage').then(m => ({ default: m.DeckEditPage })));
const ContentIntelligencePage = lazy(() =>
  import('./pages/ContentIntelligencePage').then(m => ({ default: m.ContentIntelligencePage })),
);

if (typeof window !== 'undefined') {
  void loadDeckList();
}

function App() {
  // Feeds the boundary its reset signal. Read here rather than inside the
  // boundary so the boundary stays a plain component with no router dependency,
  // which is what lets its tests mount it without one.
  const location = useLocation();

  return (
    <>
      {/* Splitting the routes created a way for navigation to fail that did not
          exist when every page shipped in one chunk: a 404'd or timed-out chunk
          rejects, and without this boundary the whole tree unmounts to a blank
          page. See ChunkErrorBoundary for why its button reloads. */}
      <ChunkErrorBoundary resetKey={location.pathname}>
        {/* Confirmation dialogs for the whole application, mounted here rather
            than in main.tsx and in this exact slot.

            Not main.tsx: the providers there — QueryClient, Auth, Router — are
            the ones that have to exist before App renders at all, and main.tsx
            calls createRoot at module scope, so importing it from a test mounts
            the entire application into #root. A provider that cannot be mounted
            in a test cannot be *proved* to be reached by the pages under it,
            and unreachable-but-present is the failure this repository keeps
            finding. App is an ordinary component; tests/confirmWiring.test.tsx
            mounts it and clicks a real row.

            Inside ChunkErrorBoundary, not outside: a chunk that fails to load
            should replace the whole screen, an open dialog included — a modal
            floating over a crash screen is asking about an action whose page no
            longer exists. Keeping the boundary outermost also means
            tests/appBoundaryWiring.test.ts and chunkErrorBoundary.test.tsx do
            not change by one character.

            Outside Suspense, not inside: a dialog has to survive a route
            suspending underneath it. Inside, React would swap the subtree for
            RouteFallback, unmount the dialog mid-question, and leave the
            awaiting handler with a promise that supersede logic never gets to
            answer.

            One known overlap, named here rather than discovered later: the
            overlay is z-50 and PerfOverlay is also z-50 and comes later in DOM
            order, so it paints on top. Acceptable — PerfOverlay renders null
            outside DEV unless ?perf=1 is set. */}
        <ConfirmDialogProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />

              {/* Protected */}
              <Route element={<RequireAuth><Outlet /></RequireAuth>}>
                <Route path="/" element={<DeckListPage />} />
                <Route path="/decks/new" element={<NewDeckPage />} />

                {/* ✅ Query-param routes */}
                <Route path="/decks/cards" element={<CardListPage />} />
                <Route path="/decks/cards/new" element={<NewCardPage />} />
                <Route path="/decks/cards/edit" element={<EditCardPage />} />
                <Route path="/decks/cards/import" element={<DeckImportPage />} />

                <Route path="/decks/preview" element={<DeckPreviewPage />} />

                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route path="/content-intelligence" element={<ContentIntelligencePage />} />
                <Route path="/decks/edit" element={<DeckEditPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ConfirmDialogProvider>
      </ChunkErrorBoundary>

      {/* Renders null unless DEV or ?perf=1, so production pays one boolean. */}
      <PerfOverlay />
    </>
  );
}

export default App;
