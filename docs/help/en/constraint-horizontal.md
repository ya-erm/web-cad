# Horizontal

Makes a line horizontal or places two points on the same horizontal line.

**Sketch toolbar:** **Horizontal** · **Shortcut:** `H`

```figure
image: ../images/constraint-horizontal.svg
alt: A sloping line becomes horizontal
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

| Selection | Result |
|---|---|
| One or more lines | Each line becomes horizontal. |
| Two points | The points get the same Y coordinate. |

Otherwise, the message "Select lines or two points" appears.

## How it works {#how}

"Horizontal" means along the sketch X axis (for a sketch on the **Top** plane, along the world X axis; on a face, along the X axis of the face coordinate system). The line endpoints are leveled to the same height, usually moving toward each other.

## Created automatically {#auto}

- While drawing a [line](sketch-line), when the horizontal hint appears next to the cursor.
- Sides of a [rectangle](sketch-rectangle).
- A point placed along a guide from an [acquired point](sketch#inference) gets a horizontal constraint with it.

## Deleting {#delete}

Click the horizontal icon at the line and press `Del`.

## See also {#see-also}

[Vertical](constraint-vertical), [Parallel](constraint-parallel).
