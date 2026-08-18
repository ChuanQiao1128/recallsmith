// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { queryClient } from './api/queryClient';
import { installErrorReporting } from './lib/reportError';
import './index.css';

// Before createRoot, so a failure while the tree is first mounting is already
// being listened for. The two listeners it attaches cover what React cannot: a
// throw outside a component and a promise nobody awaited. The third entry point,
// a component throwing during render, is reported by ChunkErrorBoundary.
installErrorReporting();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);