# Documents and tabs

Click the **WebCAD** logo in the Documents page top bar to reload the page.

## Documents page {#documents-page}

```figure
image: ../images/documents-page.png
alt: The Documents page with Create, Import project and a document card
caption: The buttons on the left create a document or open a project file. Click a card to open an existing document.
width: 690
```

The **Documents** page opens when you start WebCAD and when you click the ◆ logo in the editor. It shows all documents in this browser with a thumbnail, name, and modification date.

### Opening a model

The panel at the top centre of the graphics area shows the Part Studio and operation currently being built. Its short headline changes every four seconds. The progress bar counts completed operations, not remaining time: some operations take much longer than others. Detailed progress is shown only in this panel, keeping the bottom status bar compact.

After a successful build, WebCAD keeps a 3D preview in this browser. When you reopen the same unchanged model, the preview appears while the editable geometry is rebuilt. You can rotate and zoom it; editing, measurements and export become available after the build finishes. On the first opening of an assembly, completed source parts appear progressively, starting with smaller Part Studios.

Previews are optional local cache data, separate from the project file. If a preview is missing or the document has changed, WebCAD builds the model normally.

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

Drag the right edge of the folder sidebar with a mouse or touch to change its width. Its tooltip follows the pointer and stays hidden while dragging. The size is remembered in this browser independently of the editor panel. Double-click restores the default width. Focus the edge with `Tab`: `←` / `→` resize, `Shift` increases the step, `Home` / `End` select the minimum / maximum, and `Enter` resets. `Esc` cancels an active drag. Narrowing the window temporarily limits the panel to leave room for documents.

## Account {#account}

**Sign in with Yandex** in the top bar of the Documents page and editor opens
Yandex ID. After you grant access, WebCAD shows your avatar, or the first
letter of your name while the image loads or when no avatar is available. A round
placeholder appears while the account is being checked. Your name and email appear
in the account menu, opened by clicking your avatar. **Sign out** ends the current session in this browser.

Signing in is optional. Documents are saved on this device. After sign-in, enabled
**Automatic cloud sync** uploads library documents and their folders in the background. You can disable it in settings, including before signing in. Signing out pauses sync and keeps local documents.
If the account service is unavailable or you are offline, editing still works;
**Retry sign-in** checks the account service again.

A session lasts 180 days and renews when you use the app, at most once per day.
After 180 days of inactivity you need to sign in again. Cancelling on the Yandex
page returns to WebCAD with a “Sign-in was cancelled” message.

The account menu → **API tokens…** issues time-limited access for an agent without a browser: read only or read/write. The value is shown once; tokens can be revoked. See [Agent API](agent-api#cloud).

## Trash and recovery {#trash}

1. Click **Trash** on the left of the Documents page.
2. Find the document and click **Restore** to return it to **Documents**.

**Move to trash** in a My documents card menu also moves its known local variants. Cloud-connected documents require a connection and sign-in to the same account to trash or restore; other devices receive the trash state when refreshing the list. Use **Restore** on a trash card or in its menu. Cloud documents remain in the trash until restored; permanent cloud deletion is not available yet.

For documents stored only on this device, **Delete permanently** on a card and **Delete local documents permanently** in the trash header require a second click. Once deleted, a document can only be recovered from a previously exported project file.

## Document tabs {#tabs}

A document consists of tabs, which are shown in the bottom bar:

- **Part Studio**: 3D modeling with sketches, features, and parts;
- **Drawing**: sheets with part views, see [Drawings](drawings).
- **Assembly**: instances of Part Studio parts put together into a product, see [Assembly](assembly).

The **+** button to the left of the tabs adds a new **Part Studio**, **Drawing** or **Assembly** tab. Double-click a tab to rename it. Right-click a tab to open the **Rename** / **Delete** menu (you cannot delete the last tab).

When there are many tabs, scroll the strip with the mouse wheel, a horizontal trackpad gesture, or the arrows at its edges. The **All tabs** button to the right opens a scrollable list with full names and type icons: choose any tab, including one beyond the window edge. The selected tab automatically appears in the visible part of the strip, including after resizing the window. Long names are shortened in the strip; the tooltip and the list show the full name. With a tab focused, `←` / `→` switch tabs, `Home` / `End` select the first / last tab, and `F2` renames it. In the list, use `↑` / `↓`, `Enter` to select, and `Esc` to close.

Reorder tabs by dragging in the bottom strip or in **All tabs**. With a mouse, drag the tab; on a touch screen, use its drag grip. An insertion marker shows the destination. The current tab stays open, and the order is saved with the document. `Esc` cancels the drag; `Ctrl+Z` undoes a completed move. With the keyboard, use `Alt+Shift+←/→` in the strip and `Alt+Shift+↑/↓` in the list. Reordering is unavailable while editing a sketch, a feature dialog or a tab name, or while viewing a version.

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

> **Tip.** Project files are an easy way to make a backup: local documents are stored in this browser, see [Offline use and storage](offline). To have the files kept up to date by themselves, work in a [folder on your computer](#folder).

Exporting geometry to STEP, STL, and other formats is described in [Import and export](import-export).

## Folder on this computer {#folder}

In Chrome and Edge, WebCAD can work right in a folder on your computer: its documents are project files `*.webcad.json` that are saved automatically. Such a folder is easy to copy, back up, keep in Git or in a cloud folder (Dropbox, Google Drive and the like).

1. On the documents page, click **Folder on this computer** at the left, then **Choose folder…**, and let the browser view and edit the files in it.
2. The cards show the WebCAD files of the folder with pictures of their models: a project file keeps its card's picture, so it shows even before the document has been opened in this browser. Click a card to open the document.
3. **New document in the folder** creates a document as a file of the folder right away. A document of the browser goes into a folder with **Save to the folder «…»** in its card menu (one item per folder).

You can add several folders: they are listed at the left under **Folders on this computer**, and **Add folder…** adds one more. **Remove folder from the list** on a folder's page turns it off — the files and the documents stay, but are no longer linked.

### Subfolders {#subfolders}

A folder can have subfolders nested to any depth — WebCAD finds `*.webcad.json` files at every level (up to 16). Hidden folders (`.git`, `.vscode` and the like) and `node_modules` are not looked into.

- At the left, each folder shows its tree: an arrow opens and closes a branch, a click on a name opens that subfolder. The open branches are remembered. Long names are shortened with an ellipsis while folder icons keep the same size.
- An open subfolder shows the way to it at the top (**Folder › Parts › Fasteners**): a click on any step goes back to that level. Below are the subfolders as tiles with the number of documents in each (nested ones included) and the cards of the documents of this level. A click on a tile opens the subfolder.
- A subfolder tile shows the pictures of its documents (nested ones included, the most recently modified first). With one document, its picture fills the tile. Two to four documents are shown in a 2 × 2 grid. With more, the grid shows three pictures and "+N" in the fourth cell, the number of the other documents. An empty subfolder shows a folder icon. The folder icon beside the caption spans two rows; the name and document count align to its right.
- **New folder** makes a subfolder at the current level and lets you type its name right away. **New document in the folder** creates a document in the subfolder that is open.
- A subfolder tile's menu (**⋯** or a right click) has **Open**, **Rename** and **Move to folder…**. A subfolder is renamed and moved with everything in it; its documents stay linked to their files.
- **Move to folder…** in the menu of a file card or a subfolder tile opens a window with the tree: choose a place and click **Move** (or double-click the place). A file can also go into another added folder, a subfolder only within its own folder. The place where the file or subfolder already is, and the subfolder itself with what is inside it, cannot be chosen.
- You can also just drag a file card or a subfolder tile onto a subfolder tile, onto a step of the way at the top, or onto a branch of the tree at the left — the place that takes it is highlighted. A card of a browser document in **Documents** can be dragged onto a branch of the tree too: the document is saved into that subfolder as a file (one that is a file of a folder already — its file moves there).
- **Show in the folder** in the card menu of a linked document in **Documents** opens the subfolder with its file.
- Coming back from the editor, the documents page opens at the same subfolder.

Where the browser cannot move folders on the disk, a subfolder is moved by copying everything in it and removing the old one; if the copy fails, the incomplete copy is removed and the original subfolder stays where it was.

How it works:

- a document opened from the folder is linked to its file: every autosave writes the file too (the file name is shown next to **Saved**), and its card in **Documents** has a folder icon;
- **Rename** in a file's card menu (**⋯** or a right click) renames both the file and the document in it. Renaming a linked document in the editor or in **Documents** renames its file too (a file name that differs from the document's stays until the document is renamed);
- the file is the main copy. Opened from the folder, the document is read from the file — unless the browser has newer changes that could not be written; those are written to the file;
- if another program changes the open document's file (an editor, git, a cloud folder's sync, WebCAD in another tab), the document is read again from the file within a few seconds or when you come back to the window, with the message "The file was changed by another program: the document is read again". While a sketch or a feature dialog is open the document is not read again; if your changes get written first, the other program's file is not lost: it is kept beside as "… (changed outside)";
- a file with the same document under another name (a copy) opens as a separate document;
- the folders are remembered. After the browser restarts it asks for permission again (such a folder has a lock icon at the left): click **Allow access** on the folder page or **Allow writing to the folder** in the open document — the changes made meanwhile are written to the file.

> **Limitation.** Deleting or trashing a document in the browser does not touch its file; WebCAD does not delete files or subfolders — use Explorer or Finder for that. New files and subfolders added by other programs appear after **Refresh** (it reads the folder again with all its subfolders). Folders are not available in Firefox and Safari — use project **Export** and **Import project**.

## My documents and folders {#libraries}

**My documents** is one managed library. A document lives on this device and, when cloud storage is connected, has a cloud instance with a shared ID. One card shows its availability and pending cloud changes. **Recent documents** also groups known instances of the same document. The My documents and computer-folder trees remain visible when switching sections. Expanded branches are remembered in this browser; selection highlights only the current section. Click a folder in either tree to open it.

Folders use the same bar and cards as computer folders:

- Use the breadcrumb bar and left-hand tree to navigate nested folders.
- **New document in the folder** creates a local document at the current location. **New folder** creates a folder with its name ready to edit. A subfolder inside a connected cloud folder is created in the cloud too.
- Folder cards show one thumbnail, a mosaic, or **+N**. Counts include nested documents.
- **⋯** and right-click menus offer renaming, **Move to folder…**, and deleting empty folders.
- Drag documents or folders onto a folder, a tree item, or an ancestor breadcrumb. Self and descendant moves are rejected. The move dialog supports choosing a destination and **Move**, or double-clicking the destination.
- Organising connected cloud objects requires a network and sign-in. Local model editing continues to work offline.

Folder names and locations are metadata: moving or renaming them does not rebuild geometry or upload the project again. Existing local documents and folders survive the app update.

Old local copies with a known cloud identity appear under one card. **Local variants…** lets you choose an existing variant. Their data is retained; differing models are not merged automatically. Independent IDs are not merged merely because names match.

Card modification dates use local time in **DD.MM.YYYY HH:mm:ss** format, with hours from 00 to 23. A cloud badge in the upper-left corner indicates a cloud connection; the card status shows changes awaiting upload. Folder navigation updates the page address, so browser **Back** / **Forward** and the iOS back gesture traverse folders.

## Saving to the cloud {#cloud}

**Upload to cloud** in the bar opens the selection dialog. Documents appear with thumbnails inside their folders: expand branches and select individual documents or entire folders. Choose a destination in its separate folder tree. Optionally enable **Preserve library folders**. The first save connects the existing document; subsequent manual saves update the same ID. **Upload as separate copies** explicitly creates independent documents.

On phones, the document picker fills the screen: the header and action buttons stay visible while folders, options and upload progress scroll between them.

**Upload to cloud** in a document menu starts uploading immediately, without the selection dialog. A connected document keeps its cloud location; a new one recreates its library folders. If the original cloud version has changed, the upload stops: the notification lets you explicitly open the selection dialog to confirm replacement or create a separate copy.

The progress bar shows project preparation, file transfer, and server confirmation. Multiple uploads show overall progress and the current document name. Transferred bytes alone do not mean completion: the upload completes after server confirmation. Errors leave local data intact.

On another device, sign in to the same account and open **My documents**. Lists and thumbnails load first; the project downloads when opened. A first download keeps the shared ID if that local ID is free. It then works offline. Existing changed content with that ID is never overwritten.

Normal opening uses the local variant when available. **Open cloud version** explicitly opens the cloud snapshot, preserving changed local data as another variant under the same card. Local data stays in this browser after signing out.

Saving checks both the revision and metadata baseline. A concurrent edit, rename, or move stops an outdated save with a conflict. Open the cloud version first; if replacement is intended, enable **Update existing cloud versions**. Old copies without a recorded baseline also require explicit confirmation.

### Automatic sync

**Automatic cloud sync** is enabled by default and can be switched off in settings. It works while signed in, online, and with the app open. Library documents and their nested folders upload automatically. Files in connected computer folders and documents belonging to another account are excluded.

Local saving stays fast and works offline. Uploads start after 30 seconds without edits, at most once a minute per document, with at least 15 seconds between uploads overall. Continuous editing makes the queue check the document after 2 minutes. One project uploads at a time; browser tabs coordinate the queue. Closing the app stops background uploads. On the next launch, unsent changes rejoin the queue.

The cloud icon beside your account opens queue status, errors, and retry actions. Network failures retry with an increasing delay. Edits made during an upload remain queued for another snapshot. Named versions and branches also count as changes.

When another device changes a cloud document, a clean closed local copy updates during a list check. An open model is never silently replaced: a notice offers the newer cloud version. Concurrent local and cloud edits pause automatic upload for that document. Open the cloud version or explicitly confirm replacement through a manual upload. Uploading a separate copy creates another document and does not itself resolve the original conflict.

Autosync does not download the entire cloud library: documents not yet opened on this device download when you select their cards.

Technical autosaves do not form an unlimited history: the cloud keeps the current and previous snapshots and cleans up older ones in the background after 10 minutes. Frequent edits can temporarily leave several snapshots. Named versions inside the project are retained.

Projects include named versions and branches, as gzip archives up to 20 MiB. Thumbnails are separate S3 objects, converted to WebP, up to 1 MiB. Disposable 3D geometry caches and automatic local history are excluded. A broken thumbnail never prevents the project upload. Temporary upload objects expire after 3 days.

The upload dialog has **?** tooltips explaining its options. **Preserve library folders** recreates subfolders inside the destination. **Upload as separate copies** creates independent cloud documents instead of updating connected documents.

## Copying computer files to the library {#disk-library-copy}

Computer files remain a separate source in their own filesystem. **Copy to My documents** in a file card menu creates an independent library document with named versions and a thumbnail. The original file and its folder link are unchanged. Connect the resulting document to cloud storage using the normal save command.
