# Constraints

Constraints define geometric relationships between sketch entities: coincident points, parallel lines, tangency, and so on. The solver maintains them whenever the sketch changes — when you drag geometry or change dimensions and variables.

## Applying a constraint {#apply}

1. In select mode, select entities (by clicking or with a selection box).
2. Click a constraint button on the sketch toolbar or press its shortcut.

When the constraint is applied, the selection is cleared. If the selection does not fit, a hint tells you what to select.

```figure
image: ../images/constraint-horizontal.svg
alt: A sloping line before and after applying a horizontal constraint
caption: A simple example: select a line and press H. Left — the original position; right — the horizontal line. This is a geometric relation, not a length dimension.
width: 600
```

> **Tip.** Start with one relation: select the entities, apply the constraint and check the result. If one curve must stay in place, first dimension its position or fix it.

## All constraints {#list}

| Constraint | Shortcut | What to select |
|---|---|---|
| [Coincident](constraint-coincident) | `I` | Two or more points; or a point and a curve |
| [Concentric](constraint-concentric) | `Shift+O` | Two circles, arcs or ellipses; or a point and a circle |
| [Parallel](constraint-parallel) | `B` | Two or more lines |
| [Tangent](constraint-tangent) | `T` | A line and a circle/arc, or two circles/arcs |
| [Horizontal](constraint-horizontal) | `H` | Lines or two points |
| [Vertical](constraint-vertical) | `V` | Lines or two points |
| [Perpendicular](constraint-perpendicular) | `Shift+L` | Two or more lines |
| [Equal](constraint-equal) | `E` | Two or more lines or circles/arcs |
| [Midpoint](constraint-midpoint) | `Shift+M` | A point and a line |
| [Symmetric](constraint-symmetric) | `Shift+Q` | Two points, lines, circles or arcs, and an axis line |
| [Fix](constraint-fix) | `Shift+J` | Any entities |

Dimensions are constraints too, but with a value: see [Dimensions](sketch-dimensions).

## What moves {#what-moves}

The solver changes the geometry as little as possible: usually all entities involved in the constraint move a little. These do not move:

- [fixed](constraint-fix) entities and [projected](sketch-use) geometry;
- entities fully defined by other constraints and dimensions (black).

To control what moves, define the "main" entity first — attach it to the origin, make it horizontal or vertical, dimension it — and then constrain the rest to it.

## Conflicts {#conflicts}

- If a new constraint conflicts with existing constraints or dimensions, it is **not added**: "This constraint conflicts with existing constraints or dimensions".
- A redundant but non-conflicting constraint (for example, parallel between two lines that are already horizontal) is accepted.
- A conflicting dimension is added, but shown in red, and the sketch is **Over defined**: delete the extra dimension or constraint.

## Constraint icons {#glyphs}

- Constraint icons are shown next to the geometry. **Show constraints** (`Shift+C`) turns on all icons; when it is off, only the constraints of selected entities and of the entity under the cursor are visible.
- Hover over an icon to highlight the entities it relates.
- Click an icon to select the constraint; `Del` deletes it.
- Coincidence of two points (a shared vertex) is not marked with an icon.
- A red icon means the constraint is part of a conflict.

## Automatic constraints {#auto}

Many constraints are created automatically: by [inferencing](sketch#inference) while you draw and when you [drag points](sketch#drag-inference), and in [rectangles](sketch-rectangle), [slots](sketch-slot), [polygons](sketch-polygon), [tangent arcs](sketch-arc#tangent), [fillets](sketch-fillet) and [mirror](sketch-mirror).
