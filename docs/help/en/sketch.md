# Sketch overview

A sketch is a 2D drawing on a plane or planar face: lines, arcs, circles and other curves related by [constraints](sketch-constraints) and [dimensions](sketch-dimensions). Closed loops in a sketch form **regions**, which you then [extrude](extrude), [revolve](revolve), and so on.

```figure
image: ../images/sketch-mode.jpg
alt: Sketch mode: sketch toolbar, sketch dialog, geometry with constraints and dimensions
1 14% 8.5% Finish sketch
2 36% 8.5% Drawing tools
3 55% 8.5% Editing tools
4 65% 8.5% Dimension, mirror and patterns
5 72.5% 8.5% Construction geometry
6 86% 8.5% Show constraints and constraint buttons
7 35% 16% Sketch dialog
8 41.5% 35.8% Degrees of freedom
9 74.2% 54% Dimension
10 62.5% 39.4% Constraint icons
11 67% 43% Construction line
12 52% 58% Closed region
13 30% 98% Hint and sketch status
```

1. **Finish sketch** (`Enter`).
2. Drawing tools: [line](sketch-line), [rectangles](sketch-rectangle), [circles](sketch-circle), [arcs](sketch-arc), [spline](sketch-spline), [point](sketch-point), [slot](sketch-slot), [polygon](sketch-polygon), [ellipse](sketch-ellipse).
3. Editing tools: [fillet](sketch-fillet), [trim](sketch-trim), [extend](sketch-extend), [offset](sketch-offset), [projection (Use)](sketch-use).
4. [Dimension](sketch-dimensions), [mirror](sketch-mirror), [linear and circular pattern](sketch-pattern).
5. [Construction geometry](#construction) (`Q`).
6. **Show constraints** / **Hide constraints** (`Shift+C`) and the [constraint](sketch-constraints) buttons.
7. Sketch dialog: name, **Sketch plane**, display checkboxes.
8. How many degrees of freedom remain (see [Colors and status](#status)).
9. A dimension; values driven by an expression are marked **fx**.
10. Constraint icons next to the geometry.
11. A construction (dash-dot) line.
12. A closed region — shaded gray; you can extrude it.
13. The active tool's hint and the sketch status in the bottom bar.

## Creating a sketch {#create}

1. Select a plane (**Top**, **Front**, **Right** in the [feature list](feature-list), or a [plane](plane)) or a planar face of a part.
2. Click **Sketch** in the toolbar (`Shift+S`).

If nothing is selected, the sketch dialog opens with the **Sketch plane** field active: click a plane or planar face in the graphics area, or a plane in the feature list. Until a plane is chosen, the drawing tools and **Finish sketch** are unavailable, and `Esc` closes the sketch. If you select anything other than a plane or planar face, the message "Select a plane or planar face" appears. You can also start a sketch by double-clicking a plane in the feature list, or with **New sketch** in the context menu of a planar face. The view automatically turns normal to the new sketch plane.

To open an existing sketch, double-click it in the feature list or choose **Edit** in the context menu of its region.

## Sketch dialog {#dialog}

| Item | Purpose |
|---|---|
| Name | The sketch name in the feature list. |
| **Sketch plane** | Click the field, then another plane or planar face (in the graphics area, or a plane in the [feature list](feature-list#default-geometry)) to move the sketch there. The view turns to the new plane. |
| **Show constraints** (`Shift+C`) | Shows icons for all constraints. When cleared, only the constraints of selected entities and of the entity under the cursor are visible. |
| **Show expressions** | Dimensions driven by expressions show the expression (`#width / 2`) instead of the value. |
| **Under defined: N degrees of freedom** | How many geometry parameters are not yet fixed by constraints and dimensions. |
| ✓ / ✕ | Finish the sketch / discard all changes made in this editing session. |

## Selecting and dragging {#selection}

- In select mode (`Esc` or the arrow button), clicking an entity adds it to the selection; clicking it again removes it. Clicking empty space clears the selection (not when you hold `Shift`).
- Box select: drag across empty space. Dragging left to right selects entities that lie entirely inside the box; right to left selects everything the box touches. With `Shift` or `Ctrl`, the box adds to the selection.
- Drag points and curves with the mouse — the solver keeps the constraints and dimensions. Dragging a circle by its edge changes the radius; dragging it by the center moves it.
- Press `Del` or `Backspace` to delete the selected entities.

## Inferencing and hints {#inference}

As you draw, the cursor snaps to existing geometry, the target is highlighted, and the icon of the constraint that a click will create appears next to the cursor:

| Inference | Icon at the cursor | Constraint after the click |
|---|---|---|
| To a point | Coincident | [Coincident](constraint-coincident) |
| To a curve | Coincident | Point on curve |
| To the midpoint of a line | Midpoint | [Midpoint](constraint-midpoint) |
| To the origin | Coincident | Point fixed at the origin |
| Horizontal / vertical from the previous point | Horizontal / vertical | The line becomes [horizontal](constraint-horizontal) / [vertical](constraint-vertical) |

**Acquiring points.** Hover over a sketch point for about ¼ second — the point is "acquired" and gets an orange halo (the last two acquired points are remembered). If you then move the cursor away from it exactly horizontally or vertically, an orange dotted guide and the horizontal or vertical icon appear. Clicking places the new point in line with the acquired one and adds a horizontal or vertical constraint between them. Use this to align rectangle corners, circle centers and line endpoints.

```figure
image: ../images/sketch-inference.png
alt: Acquired point with a halo, a dotted guide and the horizontal icon
width: 340
```

### Drag inferencing {#drag-inference}

Inferencing also works with the select tool: drag a single point (a rectangle corner, a line end) onto another point, a curve, the midpoint of a line or the origin — the target is highlighted, the point snaps to it and the constraint icon appears next to the cursor. When you release the mouse button, the constraint is added (coincident, point on curve, midpoint or fixed at the origin). If it would conflict with existing constraints, it is refused with a message.

## Sizes while drawing {#live-sizes}

While you draw, the current sizes of the shape are shown next to it (blue numbers): the length of a line, the width and height of a rectangle, the diameter of a circle. They disappear once the shape is placed — then the quick dimension fields appear.

## Quick dimensions {#quick-dimensions}

Right after you draw a line, rectangle, circle, arc, slot, polygon or ellipse, dashed fields with values appear at its main dimensions: the length of a line; the width and height of a rectangle; the diameter of a circle; the radius of an arc or slot; the diameter of a polygon's construction circle; the diameters of both ellipse axes.

```figure
image: ../images/sketch-quick-dimensions.png
alt: Quick dimension fields on a newly drawn rectangle
width: 310
```

- Just type a number — it goes into the first field. `Tab` moves to the next field.
- `Enter` adds the entered values as dimensions (in a single undo step).
- `Esc` removes the fields without adding anything. If you continue drawing or click elsewhere, the fields disappear, but the values you already entered are kept as dimensions.
- In a chain of lines, a field is offered for each segment.
- You can enter expressions: `#width / 2`, `1 in`.

Quick dimensions are optional — if you enter nothing, the geometry stays undimensioned.

## Construction geometry {#construction}

Construction curves are drawn dash-dotted, do not form regions and are not used by features, but you can snap to them and constrain them — for example, an axis of symmetry or a bolt circle for holes.

- With nothing selected, `Q` (or the **Construction** button) turns on construction mode: new curves are created as construction geometry, and their preview is dash-dotted too. Press it again to turn the mode off.
- With curves selected, `Q` toggles them between regular and construction.

## Colors and status {#status}

| Color | Meaning |
|---|---|
| Blue | Under defined: the entity can still move. |
| Black | Fully defined. |
| Red | Over defined: constraints or dimensions conflict with each other. |
| Orange | Selected (light orange — under the cursor). |
| Gray fill | Closed region. |

The bottom bar shows the status of the whole sketch: **Fully defined**, **Under defined: N degrees of freedom** or **Over defined**. You do not have to fully define a sketch, but doing so protects it from accidental changes.

## Cursor {#cursor}

- **Crosshair** — a click draws a point, line or shape.
- **Hand** — the cursor is over an entity you can select or act on with a tool (trim, extend, fillet, dimension, Use, select).
- **Move** — while you drag sketch geometry.

## Keys and context menu {#context-menu}

- `Esc`: cancels the current tool action, then clears the selection, then returns to the select tool.
- `Enter`: finishes the current action (for example, a chain of lines); otherwise finishes the sketch.
- `Ctrl+Z` / `Ctrl+Y`: undo and redo inside the sketch.
- Right-click without moving the mouse: while drawing, finishes the current action; otherwise opens a menu with **Finish sketch**, **Construction**, **Delete**, **Cancel**.

All sketch keys are listed on the [Keyboard shortcuts](keyboard-shortcuts#sketch-tools) page.

## After finishing {#after}

- The sketch stays visible in the graphics area; hide it with the eye icon in the feature list, or hide all sketches at once with `Shift+H`.
- Clicking a sketch in the feature list selects all its regions — you can then click **Extrude** right away.
- A sketch on a part face follows that face when the model earlier in the history changes.
- Right-click a sketch in the feature list → **Export DXF** to save it to a file.
