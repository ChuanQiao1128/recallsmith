import { createBrowserRouter, Navigate } from 'react-router-dom'
import AppShell from './AppShell'
import Dashboard from '../pages/Dashboard/Dashboard'
import AllDecks from '../pages/Decks/AllDecks'
import DeckDetail from '../pages/Decks/DeckDetail'
import DraftCards from '../pages/Decks/DraftCards'
import Publish from '../pages/Decks/Publish'
import Settings from '../pages/Decks/Settings'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'decks', element: <AllDecks /> },
      {
        path: 'decks/:deckId',
        element: <DeckDetail />,
        children: [
          { index: true, element: <Navigate to="draft" replace /> },
          { path: 'draft', element: <DraftCards /> },
          { path: 'publish', element: <Publish /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
    ],
  },
])
