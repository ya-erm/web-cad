# Derived

Brings the parts of **another Part Studio** of this document into the Part Studio, as Onshape's Derived does. The parts stand where they stand in the source (the common origin) and stay **linked** to it: when a source part changes, the derived part and everything built on its geometry rebuild by themselves.

Example: a motor is modelled in the first Part Studio and a mount is designed in the second one. Derive the motor into the second Part Studio, sketch on its face, project its holes with [Use](sketch-use) and extrude the mount — when the motor changes, the mount follows.

**Toolbar:** **Derived** (next to **Import**)

## Steps {#steps}

1. Open the Part Studio to build in and click **Derived**.
2. In the **Part Studio** field, choose the source. The list has only the Part Studios that do not use the current one themselves (that would be a circular reference).
3. In the **Parts** list, keep **All parts** or tick the source parts you need.
4. Click ✓ (`Enter`). The parts appear in the **Parts** list with their names and colours from the source.

## Working with derived parts {#use}

- Derived parts are parts of the current Part Studio: you can [sketch](sketch) on their planar faces, project their edges with [Use](sketch-use) (the projection is linked and follows the source), put a [mate connector](mate-connector) on them, use them in [Booleans](boolean), [measure](measure) and [export](import-export) them.
- The **Derived** feature is an ordinary history feature: edit it (double-click — another source or other parts), suppress, delete, undo and redo it.
- The link is one way: operations of the current Part Studio do not change the source. To change a derived part, change it in its source.
- References to the faces and edges of derived parts hold across rebuilds as long as the source part keeps its identity (it is not deleted or re-created by another feature).

## Errors {#errors}

| Message | What happened |
|---|---|
| **The source Part Studio no longer exists** | The source tab was deleted. Edit the feature and choose another source, or delete it — the rest of the model stays available. |
| **Circular reference: the source Part Studio uses this one** | Part Studios cannot use each other — neither directly nor through a third one. |
| **The selected parts no longer exist in the source Part Studio** | The chosen parts were deleted in the source. When only some are gone, a warning says so and the others come in. |

> **Limitation.** Only parts of Part Studios of this document can be derived for now. Sketches of the source, other documents, versions, placement by a mate connector and editing in the context of an assembly are not supported. Derived parts come in the [configuration](configurations) option chosen in the source Part Studio.

## See also {#see-also}

[Use](sketch-use), [Import](import), [Documents and tabs](documents#tabs).
