# Rectangle

Two tools draw a rectangle with sides parallel to the sketch axes.

| Tool | Shortcut | Defined by |
|---|---|---|
| **Corner rectangle** | `G` | Two opposite corners. |
| **Center rectangle** | `R` | The center and one corner. |

```figure
image: ../images/sketch-rectangle-steps.svg
alt: Two ways to draw a rectangle
caption: Left — corner rectangle: 1 — first corner, 2 — opposite corner. Right — center rectangle: 1 — center, 2 — corner. Numbers show the click order.
width: 600
```

## Steps {#steps}

1. Click **Corner rectangle** (`G`) or **Center rectangle** (`R`).
2. Click the first corner (or the center).
3. Click the opposite corner.
4. Optionally, type the width, press `Tab`, type the height and press `Enter` — see [quick dimensions](sketch#quick-dimensions).

## What is created {#result}

- Four lines connected at the corners, with horizontal and vertical constraints on the sides.
- For a center rectangle, also a construction diagonal and a center point attached to its midpoint. A center placed at the origin is fixed there — handy for symmetric parts.
- Corners placed on existing points or curves get coincident constraints.

> **Tip.** You can link the width and height to [variables](variables): enter `#width` in the dimension field.

## See also {#see-also}

[Line](sketch-line), [Dimensions](sketch-dimensions), [Extrude](extrude).
