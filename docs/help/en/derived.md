# Derived

Brings the parts of **another Part Studio** of this document into the Part Studio, as Onshape's Derived does. The parts stand where they stand in the source (the common origin) and stay **linked** to it: when a source part changes, the derived part and everything built on its geometry rebuild by themselves.

Example: a motor is modelled in the first Part Studio and a mount is designed in the second one. Derive the motor into the second Part Studio, sketch on its face, project its holes with [Use](sketch-use) and extrude the mount — when the motor changes, the mount follows.

**Toolbar:** **Derived** (next to **Import**)

## Steps {#steps}

1. Open the Part Studio to build in and click **Derived**.
2. If this document or another one has [versions](versions), choose where the parts come from in the **Source** field: **This document (current)** or one of the versions, see [below](#versions).
3. In the **Part Studio** field, choose the source. For the current state the list has only the Part Studios that do not use the current one themselves (that would be a circular reference).
4. If the source has a [configuration](configurations), choose an option for each input in the **Configuration** section: **As in the Part Studio (…)** — the one chosen in the source — or one of its own (a variable input: a value). The parts list is built in that variant.
5. In the **Parts** list, keep **All parts** or tick the source parts you need. With every tick cleared, no parts come in — only sketches.
6. In the **Sketches** list, tick the source sketches you need in the current Part Studio (none by default), see [below](#sketches).
7. If needed, choose a **Location (mate connector)** — a [mate connector](mate-connector) of the current Part Studio, see [below](#location).
8. Click ✓ (`Enter`). The parts appear in the **Parts** list with their names and colours from the source, the sketches in the graphics area.

```figure
image: ../images/derived-dialog.jpg
alt: Derived dialog with Motor as its source
caption: The source is this document’s current state, Part Studio Motor. Checked parts are linked; sketches are selected separately. Choose a saved version instead of the current state for a fixed snapshot.
width: 350
```

## Versions and other documents {#versions}

Parts can come not only from the document's current state but from a saved [version](versions) — of this document or another one (as in Onshape: the parts of other documents are derived through their versions). In the **Source** field this document's versions are grouped under **Versions of this document**, other documents' versions under their names. When no document has versions, there is no **Source** field.

- A version does not change: its parts stay as they were when the version was saved, even after the source document changes. For the new state, save a new version in the source and choose it in the feature.
- When a Part Studio of the version derives parts from other Part Studios itself, they come from the same version.
- Versions are stored in the browser with the documents. A [project file](versions#file) keeps the document's own versions, so the references to them travel with the file. References to another document's versions work in the browser that has that document.

## Source sketches {#sketches}

The ticked sketches come in with the parts (or without them) and stay linked to the source too. Their regions and curves are picked like those of the Part Studio's own sketches: [extrude](extrude) or [revolve](revolve) the regions or use them in other features, project the curves with [Use](sketch-use) or take them as a [sweep](sweep) path. This suits a shared layout: a housing outline or a hole pattern drawn once in one Part Studio, the parts built on it in others.

In selections such sketches are named by the feature and the sketch's name in the source: **Sketch region (Derived 1 / Layout)**. Hide them with the eye of the **Derived** feature in the tree or with **Show sketches** (`Shift+H`). They are edited in the source only.

## Location {#location}

Without a location, the parts and sketches stand where they stand in the source. To put them elsewhere (like Location in Onshape Derived), pick a mate connector of the current Part Studio in the **Location (mate connector)** field: the source's origin lands on it — position and axes. In **From the source** you can pick a mate connector of the source instead of its origin — then that one lands on the current Part Studio's connector (say, the center of a mounting face). The connectors may change — the parts follow them.

## Working with derived parts {#use}

- Derived parts are parts of the current Part Studio: you can [sketch](sketch) on their planar faces, project their edges with [Use](sketch-use) (the projection is linked and follows the source), put a [mate connector](mate-connector) on them, use them in [Booleans](boolean), [measure](measure) and [export](import-export) them.
- The **Derived** feature is an ordinary history feature: edit it (double-click — another source or other parts), suppress, delete, undo and redo it.
- The link is one way: operations of the current Part Studio do not change the source. To change a derived part, change it in its source.
- References to the faces and edges of derived parts hold across rebuilds as long as the source part keeps its identity (it is not deleted or re-created by another feature).

```figure
image: ../images/derived-result.png
alt: Blue source motor and orange mounting plate
caption: Motor is linked into Mount, where a separate 60 × 60 × 5 mm plate is built on its top face. Four holes are projected with Use and continue through the plate.
width: 700
```

## Errors {#errors}

| Message | What happened |
|---|---|
| **The source Part Studio no longer exists** | The source tab was deleted. Edit the feature and choose another source, or delete it — the rest of the model stays available. |
| **Circular reference: the source Part Studio uses this one** | Part Studios cannot use each other — neither directly nor through a third one. |
| **The selected parts no longer exist in the source Part Studio** | The chosen parts were deleted in the source. When only some are gone, a warning says so and the others come in. |
| **The selected parts and sketches no longer exist in the source Part Studio** | The same with sketches ticked: nothing of the chosen is left in the source. When only some sketches are gone — the warning **Some of the selected sketches no longer exist in the source Part Studio**. |
| **Select parts or sketches to derive** | Every part is cleared and no sketch is ticked. |
| **The source version is not available: it was deleted or is in another browser** | The source version was deleted, or the document is open where the other document's version is not. Choose another source. |

> **Limitation.** Other documents are derived from through their versions only, not their current state. Editing in the context of an assembly is not supported.

## See also {#see-also}

[Use](sketch-use), [Import](import), [Documents and tabs](documents#tabs).
