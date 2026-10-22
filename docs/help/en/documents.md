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
| Document menu | Hover over the card and click **⋯** (**Actions**) in its corner, or right-click the card. Click outside the menu or press `Esc` to close it. |
| Rename | **Rename** in the document menu; `Enter` saves, `Esc` cancels. In an open document, you can change the name directly in the top bar. |
| Duplicate | **Duplicate** in the document menu. |
| Move to trash | **Move to trash** in the document menu. The document leaves the list and can be restored — right away too, with **Restore** in the notice in the middle of the header (it closes with its cross or by itself after a few seconds). |
| Import project | The **Import project** button opens a `.webcad.json` file as a new document. |
| Folder on this computer | Documents as files of a folder, saved by themselves (Chrome, Edge), see [below](#folder). |
| Language | The **RU \| EN** switch on the right of the header; the choice is kept in the browser and the page reloads. Until you choose, WebCAD takes the language from the browser's languages (Russian or English; any other gives English). |

The thumbnail updates while the document is open and when you return to the document list.

Each document has its own address of the form `#/doc/<id>`, which you can bookmark in this browser.

## Trash and recovery {#trash}

1. Click **Trash** on the left of the Documents page.
2. Find the document and click **Restore** to return it to **Documents**.

**Delete permanently** removes one trashed document; **Empty trash** removes all of them. These actions require a second button click. **Restore** and **Delete permanently** are also in the menu you get by right-clicking the card; after **Delete permanently** in the menu, confirm with the button on the card. Once permanently deleted, a document can only be recovered from a previously saved project file.

## Document tabs {#tabs}

A document consists of tabs, which are shown in the bottom bar:

- **Part Studio**: 3D modeling with sketches, features, and parts;
- **Drawing**: sheets with part views, see [Drawings](drawings).
- **Assembly**: instances of Part Studio parts put together into a product, see [Assembly](assembly).

The **+** button to the left of the tabs adds a new **Part Studio**, **Drawing** or **Assembly** tab. Double-click a tab to rename it. Right-click a tab to open the **Rename** / **Delete** menu (you cannot delete the last tab).

## Saving and undo {#saving}

- All changes are saved automatically; the status is shown next to the document name: **Saved** or **Saving…**. The last edits are written also when you go straight back to the document list, open another document, switch to another browser tab, or close the page. With edits not saved yet, the browser asks whether to close the page.
- If the browser does not let a document be written (out of space, storage not available), a red **Not saved** appears instead of **Saved**, with the reason in its tooltip. The edits stay in the open tab — do not close it. WebCAD tries to save again by itself (in 2 s, then less often); a click on **Not saved** tries at once. To free space, empty the [trash](#trash) or delete documents you do not need.
- If a panel or dialog fails to draw, a card "This part of the interface failed" takes its place, with **Close and try again** and **Copy details**; the model and the rest of the editor keep working. If the whole app fails, a "Something went wrong" page offers **Reload the page**: the documents are already saved.
- If the geometry kernel (OpenCascade) fails — say, it runs out of memory — or does not answer for more than 3 minutes, it restarts by itself and the model is rebuilt; a notification says so. If the kernel fails on a model again and again, undo the last change (`Ctrl+Z`).
- **Undo** (`Ctrl+Z`) and **Redo** (`Ctrl+Y` or `Ctrl+Shift+Z`) work for the whole document. While a feature dialog is open, document undo is unavailable; a sketch has its own undo history.
- If you reload the page in the middle of editing a sketch or feature, the unfinished work is restored.
- The undo history lives while the document is open. To come back to a state of the document later, make a [version](versions); the autosaves of the [history](versions#history) are made by themselves.

## Project files {#project-files}

You can save the whole document (all tabs, feature history, settings, [versions](versions#file), its card's picture) to a file and open it in another browser or on another computer:

1. In the open document, click **Export** at the top right, choose the **WebCAD project** tab at the top of the dialog, and click **Export**. A `<name>.webcad.json` file downloads.
2. On the **Documents** page, click **Import project** and select that file.

> **Tip.** Project files are an easy way to make a backup: documents are stored only in this browser, see [Offline use and storage](offline). To have the files kept up to date by themselves, work in a [folder on your computer](#folder).

Exporting geometry to STEP, STL, and other formats is described in [Import and export](import-export).

## Folder on this computer {#folder}

In Chrome and Edge, WebCAD can work right in a folder on your computer: its documents are project files `*.webcad.json` that are saved automatically. Such a folder is easy to copy, back up, keep in Git or in a cloud folder (Dropbox, Google Drive and the like).

1. On the documents page, click **Folder on this computer** at the left, then **Choose folder…**, and let the browser view and edit the files in it.
2. The cards show the WebCAD files of the folder with pictures of their models: a project file keeps its card's picture, so it shows even before the document has been opened in this browser. Click a card to open the document.
3. **New document in the folder** creates a document as a file of the folder right away. A document of the browser goes into a folder with **Save to the folder «…»** in its card menu (one item per folder).

You can add several folders: they are listed at the left under **Folders on this computer**, and **Add folder…** adds one more. **Remove folder from the list** on a folder's page turns it off — the files and the documents stay, but are no longer linked.

How it works:

- a document opened from the folder is linked to its file: every autosave writes the file too (the file name is shown next to **Saved**), and its card in **Documents** has a folder icon;
- **Rename** in a file's card menu (**⋯** or a right click) renames both the file and the document in it. Renaming a linked document in the editor or in **Documents** renames its file too (a file name that differs from the document's stays until the document is renamed);
- the file is the main copy. Opened from the folder, the document is read from the file — unless the browser has newer changes that could not be written; those are written to the file;
- if another program changes the open document's file (an editor, git, a cloud folder's sync, WebCAD in another tab), the document is read again from the file within a few seconds or when you come back to the window, with the message "The file was changed by another program: the document is read again". While a sketch or a feature dialog is open the document is not read again; if your changes get written first, the other program's file is not lost: it is kept beside as "… (changed outside)";
- a file with the same document under another name (a copy) opens as a separate document;
- the folders are remembered. After the browser restarts it asks for permission again (such a folder has a lock icon at the left): click **Allow access** on the folder page or **Allow writing to the folder** in the open document — the changes made meanwhile are written to the file.

> **Limitation.** Deleting or trashing a document in the browser does not touch its file. New files added to the folder by other programs appear after **Refresh** (it reads the list of files again). Folders are not available in Firefox and Safari — use project **Export** and **Import project**.
