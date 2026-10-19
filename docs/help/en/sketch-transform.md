# Sketch transform

Moves and turns the selected sketch entities by exact values, or makes a moved copy of them — like Transform in an Onshape sketch.

**Sketch toolbar:** **Sketch transform** (next to mirror and the patterns)

## Steps {#steps}

1. Select sketch entities: lines, arcs, circles, ellipses, splines, standalone points.
2. Click **Sketch transform**. A panel with fields opens.
3. Enter **Move X**, **Move Y** and **Rotation angle** — numbers, values with units or expressions with [variables](variables). The turn is about the middle of the selected entities (the center of their bounding box), then the move. Where the entities go is shown right in the sketch.
4. Turn on **Copy** to leave the original entities in place and add moved copies.
5. ✓ or `Enter` applies, ✕ or `Esc` cancels. Afterwards the moved entities (or the copies) are selected. The whole action is one sketch undo step.

## How it works {#how}

- **Move.** The entities' points are carried over, the constraints among them stay, dimension labels move with them, fixed entities are fixed at the new place. Constraints that tie the selected entities to unselected ones (coincidences, dimensions to other entities and so on) are removed — they would hold the entities back; a message tells how many were removed.
- **Turn.** When moving, horizontal, vertical and horizontal / vertical dimensions swap on a 90° turn, stay on 180°, and are removed at other angles. Turned copies do not get them.
- **Copy.** The copies get the constraints and dimensions there were among the selected entities (except fixes); the copies are not tied to the originals.

## See also {#see-also}

[Sketch mirror](sketch-mirror), [Sketch patterns](sketch-pattern), [Dragging points](sketch#selection).
