// The embedded viewer (#/embed, WebCAD Embed Protocol v1): a page inside another site's iframe that only shows a
// model sent to it. Nothing is saved or read from the browser's storage there, nothing is edited.

let on = false;

/** The page's address is the embedded viewer's: `#/embed?parentOrigin=…&channel=…`. */
export const isEmbedHash = (hash: string) => /^#\/embed\/?(?:\?|$)/.test(hash);

/** This page is the embedded viewer (set once at start, before anything else runs). */
export function enterEmbedMode() {
  on = true;
}

export function embedMode(): boolean {
  return on;
}

/** The browser's storage is not opened in the viewer: its documents, versions and folders stay as they are. */
export const storageBlocked = () => new Error('The browser storage is not used by the embedded viewer');
