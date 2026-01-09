import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { GameSessionProvider } from './contexts/GameSessionContext';

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <React.StrictMode>
    <GameSessionProvider>
      <App />
    </GameSessionProvider>
  </React.StrictMode>
);
