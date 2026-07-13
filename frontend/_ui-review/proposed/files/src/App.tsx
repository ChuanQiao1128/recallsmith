import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { RequireAuth } from './auth/RequireAuth';

// Lazy-load each route. The current build is a single ~448KB JS bundle that
// pulls highlight.js + 5 languages + every page even when the user is just
// signing in. Splitting per route should cut initial bundle 40-60% and let
// LoginPage / AuthCallbackPage load without dragging the editor in.
const LoginPage         = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const AuthCallbackPage  = lazy(() => import('./pages/AuthCallbackPage').then(m => ({ default: m.AuthCallbackPage })));
const DeckListPage      = lazy(() => import('./pages/DeckListPage').then(m => ({ default: m.DeckListPage })));
const NewDeckPage       = lazy(() => import('./pages/NewDeckPage').then(m => ({ default: m.NewDeckPage })));
const CardListPage      = lazy(() => import('./pages/CardListPage').then(m => ({ default: m.CardListPage })));
const NewCardPage       = lazy(() => import('./pages/NewCardPage').then(m => ({ default: m.NewCardPage })));
const EditCardPage      = lazy(() => import('./pages/EditCardPage').then(m => ({ default: m.EditCardPage })));
const DeckPreviewPage   = lazy(() => import('./pages/DeckPreviewPage').then(m => ({ default: m.DeckPreviewPage })));
const AdminUsersPage    = lazy(() => import('./pages/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const DeckEditPage      = lazy(() => import('./pages/DeckEditPage').then(m => ({ default: m.DeckEditPage })));

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-500 text-sm">
      Loading…
    </div>
  );
}

function App() {
  return (
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

          <Route path="/decks/preview" element={<DeckPreviewPage />} />

          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/decks/edit" element={<DeckEditPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
