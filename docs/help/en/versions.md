# Versions and history

A version is a snapshot of the whole document (all its tabs and units) to come back to: to see what the document was like, or to restore it. It is the counterpart of Onshape's versions. Besides the versions you make, WebCAD keeps a **history** by itself — autosaves of the document.

Versions and history are stored in this browser (IndexedDB), like the documents themselves, and work offline. Versions (not the history) go into the [project file](#file) too.

## The Versions and history panel {#panel}

The **Versions** button (a clock icon) in the top bar next to the document name opens the list of versions and history, newest first. The number on the button is how many versions the document has.

| Action | How |
|---|---|
| Create a version | **Create version**, then a name (by default the next in order: **V1**, **V2**…) and an optional description; **Create** or `Enter` in the name field. The document is captured as it is now. |
| Open for viewing | A click on the row or the eye icon — see [below](#view). |
| Compare with the workspace | The **Compare with the workspace** icon — see [below](#compare). |
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

## Comparing with the workspace {#compare}

**Compare with the workspace** shows in the panel what changed from this version (or autosave) to the workspace — tab by tab:

- **+** — added, **−** — removed, **~** — changed;
- for a tab — new and deleted tabs, a rename, a changed **Order of features**, **Rollback bar**, **Configuration**, **Chosen option**, for a drawing — its format and title block;
- inside a tab — features (with their icon and name; a changed one lists the dialog fields that changed, say **Depth**, or **Disabled**; a renamed one its former name), parts, instances, mates, groups, relations, exploded views, views, dimensions and notes of a drawing;
- **Units**, if they changed.

The arrow in the header goes back to the list of versions. While a version is open for viewing, the comparison is with the workspace you will return to.

## Restoring {#restore}

**Restore this version** (in the panel or on the viewing banner) makes the workspace what the chosen version has: all tabs and units. The document's name does not change. Before that the current state goes to the history (**Autosave · before a version was restored**), and the restore itself is one undo step: `Ctrl+Z` brings everything back at once.

## Parts from a version {#derived}

A version can be the source of a [Derived](derived#versions) feature: the parts of a Part Studio come in as they were in the version, into this document or another one. Delete such a version and the features that refer to it show an error.

## Versions in the project file {#file}

A `.webcad.json` project file keeps the document together with its versions (the `versions` field; the history stays in the browser):

- A project **Export** saves the versions to the file; **Import project** makes a copy of the document with copies of its versions ([Derived](derived#versions) features taking parts from the document's versions move to their copies).
- A document of a [folder on the computer](documents#folder) writes its versions to its file on every save, and when a version is made or deleted. A file opened from a folder adds the versions the browser does not have yet (a copy of the file on another computer, in Git or a cloud folder comes with its versions).

> **Limitation.** Duplicating a document does not copy its versions. There is no branching or merging of versions (as in Onshape). Deleting a document from the trash deletes its versions in the browser (a folder's file keeps them). The comparison is a list of changes, without highlighting them on the model.

See also [Documents and tabs](documents), [Configurations](configurations).
