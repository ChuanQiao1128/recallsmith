// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { queryClient } from './api/queryClient';
import { installErrorReporting } from './lib/reportError';
import { initConsoleSentry } from './lib/sentry';
import './index.css';

// Before createRoot, so a failure while the tree is first mounting is already
// being listened for. Sentry is decided first, so the listeners know whether to
// attach: with Sentry active its own global handlers own a throw outside a
// component and a promise nobody awaited; without it the two listeners cover
// them. The third entry point, a component throwing during render, is reported
// by ChunkErrorBoundary.
initConsoleSentry();
installErrorReporting();

// A data router rather than the plain BrowserRouter this file used to mount:
// useBlocker (the unsaved-changes guard on the card and deck editors) only works
// under createBrowserRouter/RouterProvider. The single splat route hands the
// whole path to App, so App's descendant Routes — the lazy pages,
// ChunkErrorBoundary and ConfirmDialogProvider — is unchanged; the router type
// is the only thing that moved.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);