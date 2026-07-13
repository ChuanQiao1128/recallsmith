import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { RequireAuth } from './auth/RequireAuth';

import { LoginPage } from './pages/LoginPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';

import { DeckListPage } from './pages/DeckListPage';
import { NewDeckPage } from './pages/NewDeckPage';
import { CardListPage } from './pages/CardListPage';
import { NewCardPage } from './pages/NewCardPage';
import { EditCardPage } from './pages/EditCardPage';
import { DeckPreviewPage } from './pages/DeckPreviewPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { DeckEditPage } from './pages/DeckEditPage';
import { ContentIntelligencePage } from './pages/ContentIntelligencePage';

function App() {
  return (
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
        <Route path="/content-intelligence" element={<ContentIntelligencePage />} />
        <Route path="/decks/edit" element={<DeckEditPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
