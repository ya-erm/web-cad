// Installing WebCAD as an app (PWA): the browser's install offer (Chrome, Edge — `beforeinstallprompt`) kept for the
// Settings menu, and whether this page already runs as the installed app. Safari and Firefox make no such offer: there
// the menu points to the help's steps for them.

import { useSyncExternalStore } from 'react';

/** Chrome's and Edge's install offer (not in the DOM's types). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * `installed` — this page is the installed app (or was installed from it just now); `available` — the browser offers
 * to install it; `manual` — no offer: the browser installs from its own menu (or not at all), or the app is already
 * installed and opened in a tab.
 */
export type InstallState = 'installed' | 'available' | 'manual';

/** The window's parts the install state needs (a stand-in in tests). */
type InstallWindow = Pick<Window, 'addEventListener' | 'matchMedia'> & { navigator: Navigator & { standalone?: boolean } };

let win: InstallWindow | null = null;
let offer: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** In the app's own window: standalone (or with its title bar's controls overlaid), or iOS's home screen app. */
function standalone(w: InstallWindow): boolean {
  return w.navigator.standalone === true || ['standalone', 'window-controls-overlay'].some((m) => w.matchMedia(`(display-mode: ${m})`).matches);
}

/** Listen for the browser's install offer and the installation (once, before the first render: the offer comes early). */
export function initInstall(w: InstallWindow = window) {
  win = w;
  offer = null;
  installed = false;
  // (not cancelled: on phones the browser's own install bar still shows; the offer can be made later all the same)
  w.addEventListener('beforeinstallprompt', (e) => {
    offer = e as InstallPromptEvent;
    notify();
  });
  w.addEventListener('appinstalled', () => {
    offer = null;
    installed = true;
    notify();
  });
  w.matchMedia('(display-mode: standalone)').addEventListener?.('change', notify);
}

export function installState(): InstallState {
  if (installed || (win && standalone(win))) return 'installed';
  return offer ? 'available' : 'manual';
}

/** Show the browser's install dialog: what the user chose there (an offer is good for one dialog). */
export async function installApp(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = offer;
  if (!e) return 'unavailable';
  offer = null;
  notify();
  await e.prompt();
  return (await e.userChoice).outcome;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, installState);
}
