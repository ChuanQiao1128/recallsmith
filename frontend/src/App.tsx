// src/App.tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';

import { DeckListPage } from './pages/DeckListPage';
import { NewDeckPage } from './pages/NewDeckPage';
import { CardListPage } from './pages/CardListPage';
import { NewCardPage } from './pages/NewCardPage';
import { EditCardPage } from './pages/EditCardPage';
import { DeckPreviewPage } from './pages/DeckPreviewPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { LoginPage } from './pages/LoginPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <DeckListPage />
          </RequireAuth>
        }
      />
      <Route
        path="/decks/new"
        element={
          <RequireAuth>
            <NewDeckPage />
          </RequireAuth>
        }
      />

      {/* ✅ 全部用 query：/decks/cards?deckId=xxx */}
      <Route
        path="/decks/cards"
        element={
          <RequireAuth>
            <CardListPage />
          </RequireAuth>
        }
      />
      <Route
        path="/decks/cards/new"
        element={
          <RequireAuth>
            <NewCardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/decks/cards/edit"
        element={
          <RequireAuth>
            <EditCardPage />
          </RequireAuth>
        }
      />

      <Route
        path="/decks/preview"
        element={
          <RequireAuth>
            <DeckPreviewPage />
          </RequireAuth>
        }
      />

      <Route
        path="/admin/users"
        element={
          <RequireAuth>
            <AdminUsersPage />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}