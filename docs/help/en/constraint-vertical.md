# Vertical

Makes a line vertical or places two points on the same vertical line.

**Sketch toolbar:** **Vertical** · **Shortcut:** `V`

```figure
image: ../images/constraint-vertical.svg
alt: A sloping line becomes vertical
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

| Selection | Result |
|---|---|
| One or more lines | Each line becomes vertical. |
| Two points | The points get the same X coordinate. |

Otherwise, the message "Select lines or two points" appears.

## How it works {#how}

"Vertical" means along the sketch Y axis. The line endpoints are aligned horizontally, usually moving toward each other.

## Created automatically {#auto}

- While drawing a [line](sketch-line) with the vertical hint.
- Sides of a [rectangle](sketch-rectangle).
- A point placed along a vertical guide from an [acquired point](sketch#inference).

> **Tip.** Placing two points on the same vertical line is a convenient way to align hole centers without dimensions.

## Deleting {#delete}

Click the vertical icon at the line and press `Del`.

## See also {#see-also}

[Horizontal](constraint-horizontal), [Perpendicular](constraint-perpendicular).
