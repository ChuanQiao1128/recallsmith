// src/App.tsx

import { Routes, Route, Navigate } from 'react-router-dom';
import { DeckListPage } from './pages/DeckListPage';
import { NewDeckPage } from './pages/NewDeckPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<DeckListPage />} />
      <Route path="/decks/new" element={<NewDeckPage />} />
      {/* 兜底路由：找不到就回首页 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;