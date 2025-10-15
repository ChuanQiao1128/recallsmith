import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes, Navigate } from 'react-router-dom';
import DeckCreate from './pages/DeckCreate';
import CardCreate from './pages/CardCreate';
import Publish from './pages/Publish';
import './App.css';

const qc = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <div className="nav">
          <Link to="/deck">Create Deck</Link>
          <Link to="/card">Create Card</Link>
          <Link to="/publish">Publish</Link>
        </div>
        <Routes>
          <Route path="/" element={<Navigate to="/deck" replace />} />
          <Route path="/deck" element={<DeckCreate />} />
          <Route path="/card" element={<CardCreate />} />
          <Route path="/publish" element={<Publish />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}