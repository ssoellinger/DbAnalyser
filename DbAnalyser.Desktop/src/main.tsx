import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

// Forward uncaught errors to electron-log via IPC
window.onerror = (message, source, lineno, colno, error) => {
  window.electronAPI?.log.error('Uncaught error:', String(message), `at ${source}:${lineno}:${colno}`, error?.stack ?? '');
};

window.onunhandledrejection = (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  window.electronAPI?.log.error('Unhandled promise rejection:', reason);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
