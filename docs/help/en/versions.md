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

```figure
image: ../images/versions-compare.jpg
alt: V1 compared with the workspace: Fillet R2 was added
caption: Save V1, add a fillet, then compare with the workspace. The + beside Fillet R2 identifies the feature added after V1.
width: 460
```

### Differences on the model {#compare-model}

A changed Part Studio tab in the comparison has an **On the model** button. It opens that tab, builds it as it was in the version, and matches the model's faces with the version's by their geometry (type, centre, area, normal or radius):

- faces the version did not have, or that changed (moved, grew or shrank), are highlighted **green**;
- the version's faces that are gone are shown in **translucent red**. They show through the model too — say, the wall of a hole that was filled in later.

```figure
image: ../images/versions-compare-model.jpg
alt: Compared with V1 on the model: the top and sides green, the former sides and the hole red
caption: V1 is 10 mm high with a hole; now it is 15 mm without one. The changed top and sides are green; the former sides and the hole's wall show through in red; the bottom did not change.
width: 560
```

A banner over the model says what it is compared with and shows the colour legend; **Hide** removes the highlighting. If the geometry did not change (only a feature's name, for example), the banner says the geometry is the same. The highlighting goes away by itself as soon as the model changes or another tab opens: it is of the model as it was when compared.

## Restoring {#restore}

**Restore this version** (in the panel or on the viewing banner) makes the workspace what the chosen version has: all tabs and units. The document's name does not change. Before that the current state goes to the history (**Autosave · before a version was restored**), and the restore itself is one undo step: `Ctrl+Z` brings everything back at once.

## Branches and merging {#branches}

As in Onshape, a document can have several **workspaces**: **Main** and **branches** made from versions. Try changes in a branch without touching Main, then bring them over with a merge.

- **Create branch**: the branch icon of a version in the list, then a name (**Branch 1**, **Branch 2**… by default) and **Create branch**. The open workspace is kept, and the document becomes the branch with that version's content. The open branch's name shows on the **Versions** button.
- **Workspaces**: the section above the list of versions — the one open now (with the version it was branched from) and the others. A click on a row or the pencil icon opens that workspace: the open one is kept, and the undo history starts anew.
- **Merge into the open workspace**: the merge icon of another workspace. The merge window lists the tabs the branch changed, added, or deleted since the version it was made from: the checked ones are taken from the branch. A tab the open workspace changed too is marked — the branch's replaces it; uncheck it to keep yours. Units the branch changed can be taken too. **Merge** is one undo step; the state before the merge goes to the history (**Before a merge**).
- Delete a branch with the trash icon (Main cannot be deleted). Workspaces are kept in the browser with the versions and are written to the [project file](#file).
- **Merging by items.** A tab both the branch and the open workspace have is merged item by item: a Part Studio's features; an assembly's instances, mates, groups, relations and exploded views; a drawing's views, dimensions, notes and balloons. Under the tab's row are the items the branch added (**+**), changed (**~**) or deleted (**−**), each with its own checkbox. A separate **Tab settings** row covers the tab itself: its name; for a Part Studio, also its parts (colour, material…), hidden items, rollback bar and configuration; for a drawing, its format, title block and bill of materials table. The open workspace's changes to the other items stay. A new item goes right after the same item as in the branch.
  - An item from the branch comes with the new items it refers to (a sketch, a `#name` variable, faces of a feature's parts, a mate's instances, a dimension's view), and items referring to it are left out without it. Deleting an instance goes together with deleting its mates. The tooltip shows what an item comes or goes with.
  - An item changed here too gets both sides' changes, field by field (say, the branch changed an extrude's depth and this workspace changed the feature's name). Where both changed the same field, the branch's value is taken, and the mark names those fields. A sketch's geometry (entities, constraints, patterns) is combined only whole. An item deleted here comes back from the branch.
  - The rollback bar stays after the same feature. If the branch reordered features, the Part Studio is taken whole, as before.

```figure
image: ../images/versions-merge-features.jpg
alt: Merging Branch 1 into Main by features: Variable 2, Boss sketch, Boss
caption: The branch added a `#w` variable, a sketch and a boss `#w` deep, while Main changed `#h`. The boss comes with its sketch and variable, and Main's `#h` stays.
width: 284
```

## Parts from a version {#derived}

A version can be the source of a [Derived](derived#versions) feature: the parts of a Part Studio come in as they were in the version, into this document or another one. Delete such a version and the features that refer to it show an error.

## Versions in the project file {#file}

A `.webcad.json` project file keeps the document together with its versions (the `versions` field; the history stays in the browser) and its [workspaces](#branches): the open one is the document itself (with its `workspace` field), the others are in the `workspaces` field:

- A project **Export** saves the versions and workspaces to the file; **Import project** makes a copy of the document with copies of its versions and branches ([Derived](derived#versions) features taking parts from the document's versions, and branches made from those versions, move to their copies).
- A document of a [folder on the computer](documents#folder) writes its versions and workspaces to its file on every save, and when a version is made or deleted, a branch is made or another one is opened. A file opened from a folder adds the versions the browser does not have yet, and the workspaces that are newer in the file (a copy of the file on another computer, in Git or a cloud folder comes with its versions and branches).

> **Limitation.** Duplicating a document does not copy its versions. A Part Studio whose features the branch reordered merges as a whole tab (the branch's tab replaces yours); the order of instances, views and other items is not merged. References between items are found by their ids: deleting a feature that features of the open workspace refer to leaves them in error. Deleting a document from the trash deletes its versions in the browser (a folder's file keeps them). Differences are shown on the model for Part Studios only (not assemblies or drawings), and it is the faces' geometry that is compared, not edges or sketches.

See also [Documents and tabs](documents), [Configurations](configurations).
