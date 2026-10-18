# Documents and tabs

## Documents page {#documents-page}

```figure
image: ../images/documents-page.png
alt: The Documents page with Create, Import project and a document card
caption: The buttons on the left create a document or open a project file. Click a card to open an existing document.
width: 690
```

The **Documents** page opens when you start WebCAD and when you click the ◆ logo in the editor. It shows all documents in this browser with a thumbnail, name, and modification date.

| Action | How |
|---|---|
| Create a document | The **Create** button (or **New document** if there are no documents yet). The new document opens immediately. |
| Open | Click the document card. |
| Rename | Hover over the card and click **Rename**; `Enter` saves, `Esc` cancels. In an open document, you can change the name directly in the top bar. |
| Duplicate | The **Duplicate** button on the card. |
| Move to trash | The trash icon on the card (**Move to trash**). The document leaves the list and can be restored. |
| Import project | The **Import project** button opens a `.webcad.json` file as a new document. |
| Folder on this computer | Documents as files of a folder, saved by themselves (Chrome, Edge), see [below](#folder). |

The thumbnail updates while the document is open and when you return to the document list.

Each document has its own address of the form `#/doc/<id>`, which you can bookmark in this browser.

## Trash and recovery {#trash}

1. Click **Trash** on the left of the Documents page.
2. Find the document and click **Restore** to return it to **Documents**.

**Delete permanently** removes one trashed document; **Empty trash** removes all of them. These actions require a second button click. Once permanently deleted, a document can only be recovered from a previously saved project file.

## Document tabs {#tabs}

A document consists of tabs, which are shown in the bottom bar:

- **Part Studio**: 3D modeling with sketches, features, and parts;
- **Drawing**: sheets with part views, see [Drawings](drawings).
- **Assembly**: instances of Part Studio parts put together into a product, see [Assembly](assembly).

The **+** button to the left of the tabs adds a new **Part Studio**, **Drawing** or **Assembly** tab. Double-click a tab to rename it. Right-click a tab to open the **Rename** / **Delete** menu (you cannot delete the last tab).

## Saving and undo {#saving}

- All changes are saved automatically; the status is shown next to the document name: **Saved** or **Saving…**.
- **Undo** (`Ctrl+Z`) and **Redo** (`Ctrl+Y` or `Ctrl+Shift+Z`) work for the whole document. While a feature dialog is open, document undo is unavailable; a sketch has its own undo history.
- If you reload the page in the middle of editing a sketch or feature, the unfinished work is restored.

## Project files {#project-files}

You can save the whole document (all tabs, feature history, settings) to a file and open it in another browser or on another computer:

1. In the open document, open **Settings** → **Export project**. A `<name>.webcad.json` file downloads.
2. On the **Documents** page, click **Import project** and select that file.

> **Tip.** Project files are an easy way to make a backup: documents are stored only in this browser, see [Offline use and storage](offline). To have the files kept up to date by themselves, work in a [folder on your computer](#folder).

Exporting geometry to STEP, STL, and other formats is described in [Import and export](import-export).

## Folder on this computer {#folder}

In Chrome and Edge, WebCAD can work right in a folder on your computer: its documents are project files `*.webcad.json` that are saved automatically. Such a folder is easy to copy, back up, keep in Git or in a cloud folder (Dropbox, Google Drive and the like).

1. On the documents page, click **Folder on this computer** at the left, then **Choose folder…**, and let the browser view and edit the files in it.
2. The cards show the WebCAD files of the folder. Click a card to open the document.
3. **New document in the folder** creates a document as a file of the folder right away. A document of the browser goes into the folder with the folder icon on its card (**Save to the folder**).

How it works:

- a document opened from the folder is linked to its file: every autosave writes the file too (the file name is shown next to **Saved**), and its card in **Documents** has a folder icon;
- the file is the main copy. Opened from the folder, the document is read from the file — unless the browser has newer changes that could not be written; those are written to the file;
- a file with the same document under another name (a copy) opens as a separate document;
- the folder is remembered. After the browser restarts it asks for permission again: click **Allow access** on the folder page or **Allow writing to the folder** in the open document — the changes made meanwhile are written to the file;
- **Another folder…** chooses a new folder, **Forget folder** turns it off. The files and the documents stay, but are no longer linked.

> **Limitation.** Renaming, deleting or trashing a document in the browser does not change its file. Changes made to a file by other programs are seen the next time the document is opened from the folder (**Refresh** reads the list of files again). Folders are not available in Firefox and Safari — use **Export project** and **Import project**.
