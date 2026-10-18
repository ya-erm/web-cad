# Versions and history

A version is a snapshot of the whole document (all its tabs and units) to come back to: to see what the document was like, or to restore it. It is the counterpart of Onshape's versions. Besides the versions you make, WebCAD keeps a **history** by itself — autosaves of the document.

Versions and history are stored in this browser (IndexedDB), like the documents themselves, and work offline.

## The Versions and history panel {#panel}

The **Versions** button (a clock icon) in the top bar next to the document name opens the list of versions and history, newest first. The number on the button is how many versions the document has.

| Action | How |
|---|---|
| Create a version | **Create version**, then a name (by default the next in order: **V1**, **V2**…) and an optional description; **Create** or `Enter` in the name field. The document is captured as it is now. |
| Open for viewing | A click on the row or the eye icon — see [below](#view). |
| Restore | The **Restore this version** icon — see [below](#restore). |
| Delete | The trash icon, then **Delete?** to confirm. Deleting a version does not touch the document. |
| Hide the history | Clear **Show history** — only versions stay in the list. |

A row's buttons appear when you hover over it.

## History {#history}

Autosaves are made by themselves:

- **when the document was opened** — if it changed since the last snapshot;
- **while editing** — after edits are saved, at most once in 10 minutes;
- **before a version was restored** — so that the restore can be undone later too.

A snapshot with the same content as the last one is not repeated. The history keeps the 30 newest autosaves (older ones go by themselves); versions are kept until you delete them. An empty new document does not go into the history.

## Viewing a version {#view}

An opened version is shown instead of the workspace, with a yellow banner under the top bar: **Viewing: V1 · date — read only**. In it you can switch tabs, turn the model, measure, choose a [configuration](configurations) option and export, but not edit: an attempt to change something shows "A version is open for viewing: return to the workspace to edit". Nothing is saved while viewing.

**Return to the workspace** — the button on the banner or the **Workspace** row in the panel. The workspace comes back as it was, with its undo history.

## Restoring {#restore}

**Restore this version** (in the panel or on the viewing banner) makes the workspace what the chosen version has: all tabs and units. The document's name does not change. Before that the current state goes to the history (**Autosave · before a version was restored**), and the restore itself is one undo step: `Ctrl+Z` brings everything back at once.

> **Limitation.** Versions are stored in the browser, not in the project file: a project export, the [folder on the computer](documents#folder) and a duplicated document do not have them. There is no branching or merging of versions (as in Onshape). Deleting a document from the trash deletes its versions too.

See also [Documents and tabs](documents), [Configurations](configurations).
