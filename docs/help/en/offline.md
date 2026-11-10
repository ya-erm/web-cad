# Offline use and storage

WebCAD works without a server and without an account: the geometry kernel (OpenCascade) runs right in the browser, and documents are stored in the browser's local database.

## Offline mode {#offline}

- The first time you open the built app (for example, after `npm run build` and `npm run serve`, or from a web server), a Service Worker saves the whole app to the browser cache, together with the geometry kernel (WASM, about 23 MB) and this help.
- After that, WebCAD opens and works without a network. You can [install it as an app](#install): it opens in its own window.
- App updates are downloaded when the network is available again: while online the page comes from the server, so a new version opens on a plain page reload (no cache clearing needed).

> **Note.** In development mode (`npm run dev`), the Service Worker is not used — only the built version works offline.

## Installing the app {#install}

The installed WebCAD opens in its own window without an address bar, starts from the desktop, the Start menu, the Dock or Launchpad, and works without a network.

- **Chrome and Edge.** Open **Settings** (on the documents page or in the editor), choose **App → Install app…**, and confirm in the browser's dialog. The same command is in the address bar (the install icon) and in the browser menu.
- **Safari on a Mac.** Choose **File → Add to Dock**.
- **Safari on iPhone and iPad.** Tap **Share → Add to Home Screen**.
- **Firefox** on a computer does not install sites as apps.

If Settings shows **How to install the app** instead of **Install app…**, the browser does not offer the installation: it installs sites from its own menu (Safari), cannot do it (Firefox), or the app is already installed. In that case, open it with the icon in the address bar. In the installed app's window, Settings says **Installed as an app**.

> **Note.** In Chrome and Edge, the app and the site at the same address share one storage, so the documents are the same. An app installed from Safari keeps its data apart from Safari: move documents into it with **Export** to a `.webcad.json` file and **Import project**.

## Where documents are stored {#storage}

- Documents, their thumbnails and unsaved edits are stored in this browser's **IndexedDB**, separately for each site address. They are never sent over the network.
- Interface settings (language, rotation mode, showing constraints and expressions) are stored in the browser's local storage.
- WebCAD asks the browser to make the storage persistent so that data is not deleted when space runs low.

> **Warning.** Documents are not synced between browsers, profiles and computers. If you clear the site data in the browser, the documents are deleted. Different addresses (for example, `localhost:5173` and `localhost:4173`) are different storages.

## Backups and transfer {#backup}

- **Export** on the **WebCAD project** tab saves the whole document to a `.webcad.json` file.
- **Import project** on the documents page opens such a file in any browser.
- In Chrome and Edge, documents can live in a [folder on your computer](documents#folder): their `.webcad.json` files are updated on every save.
- To use the geometry in other programs, save it as STEP — see [Import and export](import-export).

See also [Documents and tabs](documents).
