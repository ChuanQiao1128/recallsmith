import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppShell from './AppShell';
import Dashboard from '../pages/Dashboard/Dashboard';
import AllDecks from '../pages/Decks/AllDecks';
import DeckDetail from '../pages/Decks/DeckDetail';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'decks', element: <AllDecks /> },
      { path: 'decks/:deckId/*', element: <DeckDetail /> },
    ],
  },
]);