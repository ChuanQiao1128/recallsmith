// src/App.tsx

import { Routes, Route, Navigate } from 'react-router-dom';
import { DeckListPage } from './pages/DeckListPage';
import { NewDeckPage } from './pages/NewDeckPage';
import { CardListPage } from './pages/CardListPage';
import { NewCardPage } from './pages/NewCardPage';
import { EditCardPage } from './pages/EditCardPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<DeckListPage />} />
      <Route path="/decks/new" element={<NewDeckPage />} />
      <Route path="/decks/:deckId/cards" element={<CardListPage />} />
      <Route path="/decks/:deckId/cards/new" element={<NewCardPage />} />
      <Route
        path="/decks/:deckId/cards/:cardId/edit"
        element={<EditCardPage />}
      />
      {/* 匹配不到任何路由时，跳回首页 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;