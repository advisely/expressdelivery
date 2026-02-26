import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ThemeProvider } from './components/ThemeContext'
import { ipcInvoke } from './lib/ipc'
import './lib/i18n'
import './index.css'

// Global error handlers — send renderer crashes to main process log file
window.addEventListener('error', (event) => {
  try { ipcInvoke('log:error', `[WINDOW ERROR] ${event.message} at ${event.filename}:${event.lineno}`).catch(() => {}); } catch { /* preload unavailable */ }
});
window.addEventListener('unhandledrejection', (event) => {
  try {
    const msg = event.reason instanceof Error ? event.reason.message : String(event.reason);
    ipcInvoke('log:error', `[WINDOW REJECTION] ${msg}`).catch(() => {});
  } catch { /* preload unavailable */ }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
