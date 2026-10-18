# Feature list

The **Features** list in the left panel is the build history of the Part Studio. Features run from top to bottom; each one can use the result of the features above it. The number in the header is the feature count.

```figure
image: ../images/feature-tree-menu.png
alt: The feature tree, rollback bar and a fillet context menu
caption: Right-click a feature to see its actions. The blue bar marks the end of the built history.
width: 350
```

## Default geometry {#default-geometry}

The **Default geometry** group (click its header to collapse it) contains the **Origin** and three planes: **Top**, **Front**, **Right**. In the graphics area each plane has its name written on it — in its corner along its edge, as in Onshape (seen from the back of the plane, the name still reads left to right).

- Click a plane to select it; the eye icon hides or shows it.
- Double-click a plane to start a [sketch](sketch) on it right away.
- While the sketch dialog waits for a plane (the **Sketch plane** field is active), a click on **Top**, **Front**, **Right** or a [plane](plane) in the list puts the sketch on it. A plane from the list must come before the sketch.

## Features in the list {#items}

Each row shows the feature type icon and the feature name. For [variables](variables), `#name = expression` is shown next to the name.

- **Red dot**: the feature failed to build (error). Hover over the row to read the message.
- **Yellow dot**: the feature built with a warning.
- **Gray row**: the feature is suppressed or below the rollback bar.
- Sketches, planes, and helices have an eye icon that hides or shows them in the graphics area.

## Selecting and editing {#selecting}

- Click to select a feature, `Ctrl`/`Cmd` + click to add to the selection, `Shift` + click to select a range.
- Clicking a sketch selects all of its closed regions, so you can click [Extrude](extrude) or [Revolve](revolve) right away.
- If a feature dialog is open and the active field accepts sketch regions, clicking a sketch in the list adds all of its regions to the field.
- Double-click a feature to edit it. While you edit a feature, the features below it are temporarily shown as rolled back.
- Clicking empty space in the list or in the graphics area clears the list selection.
- `Del` or `Backspace` deletes the selected features.

## Context menu {#context-menu}

Right-click a feature:

| Item | What it does |
|---|---|
| **Edit** | Opens the feature dialog (or the sketch). |
| **Rename** | Changes the name in the list. |
| **Suppress** / **Unsuppress** | A suppressed feature does not run, as if it did not exist, but stays in the list. |
| **Roll to here** | Places the rollback bar right after this feature. |
| **Roll to end** | Moves the rollback bar back to the end of the list. |
| **Hide** / **Show** | For sketches, planes, and helices. |
| **Export DXF** | For sketches: saves the sketch to a DXF file. |
| **Add to new folder** / **Remove from folder** | See [Folders](#folders). |
| **Delete** | Deletes the feature. Features that referenced it may fail to build. |

If several features are selected, the menu applies to all of them: **Add to new folder**, **Suppress** / **Unsuppress**, **Hide / Show**, **Delete (N)**.

## Rollback bar {#rollback}

The blue bar in the list marks how far the history runs. Features below the bar are not built and are shown in gray.

- Drag the bar up or down to view the model at any step.
- New features are inserted at the bar position, so you can add a feature in the middle of the history.
- **Roll to here** and **Roll to end** in the context menu do the same without dragging.

## Feature order {#reorder}

You can drag features with the mouse: the row is inserted before the one you drop it on. You can also drag several selected features at once.

> **Warning.** A feature can reference only what is built above it. If you move a feature above its sketch or above the face it is built on, it fails to build. In that case, restore the order or undo the move (`Ctrl+Z`).

## Folders {#folders}

Folders help you group features. Only consecutive features can be grouped into a folder.

1. Select one or more adjacent features.
2. Click **Add to new folder** in the context menu (or the folder button in the list header).
3. Type the folder name and press `Enter`.

Click the arrow to collapse or expand a folder; double-click the name to rename it. Drop a feature on a folder to move it inside. The folder context menu: **Rename**, **Collapse** / **Expand**, **Select contents**, **Suppress** / **Unsuppress**, **Hide / Show**, **Ungroup** (removes the folder, the features remain), **Delete folder and features**.
