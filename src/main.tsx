import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import App from './App';
import { installAgentApi } from './agent/browser';

// window.webcad for agents (and the dev-server bridge used by `npm run agent`); help tabs stay out of it
if (!location.hash.startsWith('#/help')) installAgentApi();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support: the service worker (generated at build time) precaches the whole app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker registration failed', e));
  });
}
