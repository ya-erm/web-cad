import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import App from './App';
import EmbedApp from './embed/EmbedApp';
import { enterEmbedMode, isEmbedHash } from './embed/mode';
import { disposeKernel } from './kernel/client';
import { installAgentApi } from './agent/browser';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { initInstall } from './pwa';

// The embedded viewer (#/embed, in another site's iframe): it only shows the model sent to it — no agent API, no
// installing, no service worker, nothing of this browser's storage (embed/mode.ts)
const embed = isEmbedHash(location.hash);
if (embed) enterEmbedMode();
else {
  // window.webcad for agents (and the dev-server bridge used by `npm run agent`); help tabs stay out of it
  if (!location.hash.startsWith('#/help')) installAgentApi();
  // the browser's offer to install the app (Settings → Install app)
  initInstall();
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    {/* an error while drawing: a page that says so instead of a white one */}
    <ErrorBoundary scope="app">{embed ? <EmbedApp /> : <App />}</ErrorBoundary>
  </StrictMode>,
);

if (embed) {
  // the frame closed: its graphics (WebGL) and the geometry kernel's worker go at once, with the model's buffers
  window.addEventListener('pagehide', (e) => {
    if (e.persisted) return;
    root.unmount();
    disposeKernel();
  });
}

// Offline support: the service worker (generated at build time) precaches the whole app. Its script is never taken
// from the HTTP cache, so a new version is found on the next visit.
if (embed) {
  /* the viewer works online inside its site: no service worker of its own */
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
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
