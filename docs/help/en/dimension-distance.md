# Length and distance

Linear dimensions set the length of a line and the distances between points, lines and circle centers.

**Sketch toolbar:** **Dimension** · **Shortcut:** `D`

```figure
image: ../images/dimension-distance.png
alt: Length 90 of an inclined line, horizontal distance 70 and vertical distance 65 between two points
width: 340
```

## Variants {#kinds}

| Select | Dimension |
|---|---|
| One line | **Length** — along the line (aligned dimension). |
| Two points | **Horizontal**, **vertical** or **aligned** — depending on where you place the text (see below). |
| A point and a line | **Perpendicular distance** from the point to the line. |
| Two parallel lines | **Distance between the lines**. |
| A circle or arc and a point, line, circle or arc | Distance **from the center** of the circle (arc). |

### Horizontal, vertical or aligned {#placement}

For two points, the type is set by where you place the text with the second click:

- text **above or below** both points (and between them horizontally) — a **horizontal** dimension (the X difference);
- text **to the left or right** of both points (and between them vertically) — a **vertical** dimension (the Y difference);
- otherwise — **aligned**: the straight-line distance between the points.

If the points already lie on one horizontal or vertical line, the dimension is always horizontal or vertical.

```figure
image: ../images/dimension-point-line.png
alt: Distance 50 from a point to an inclined line
width: 150
```

## Steps {#steps}

1. Click **Dimension** (`D`).
2. Click the first entity, then the second (for a line length — only the line).
3. Click where to place the text.
4. Enter a value or expression and press `Enter`.

## How it works {#how}

- The dimension drives the geometry: with a new value, the related entities move — as a rule, both sides of the dimension move a little. To keep one side in place, attach it to the origin or fix it.
- A point-to-line distance keeps its side: the point does not jump across the line.
- Horizontal and vertical dimensions also keep their sign: the points do not swap places.

## Notes {#notes}

- A number without units is in document units; you can type `25 mm`, `1 in`, `#w / 2`.
- You cannot set a distance between non-parallel lines — use an [angle](dimension-angle) for them.
- Double-click a dimension to change its value; `Del` deletes the selected dimension.

## See also {#see-also}

[Dimensions](sketch-dimensions), [Radius and diameter](dimension-radius), [Angle](dimension-angle), [Variables and expressions](variables).
