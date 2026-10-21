import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import App from './App';
import { installAgentApi } from './agent/browser';
import { ErrorBoundary } from './ui/ErrorBoundary';

// window.webcad for agents (and the dev-server bridge used by `npm run agent`); help tabs stay out of it
if (!location.hash.startsWith('#/help')) installAgentApi();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* an error while drawing: a page that says so instead of a white one */}
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Offline support: the service worker (generated at build time) precaches the whole app. Its script is never taken
// from the HTTP cache, so a new version is found on the next visit.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('Service worker registration failed', e));
  });
} else if ('serviceWorker' in navigator) {
  // the development server: a service worker left by a build served at this address earlier would keep serving
  // its old files (and cannot update: here sw.js is the page) — remove it with its caches
  void navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (!regs.length) return;
    await Promise.all(regs.map((r) => r.unregister()));
    for (const k of await caches.keys()) if (k.startsWith('webcad-')) await caches.delete(k);
    if (navigator.serviceWorker.controller) location.reload();
  });
}
