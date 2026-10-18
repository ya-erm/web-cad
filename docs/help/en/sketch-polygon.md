# Polygon

Draws a regular polygon with a construction circle. As in Onshape, there are two tools; they differ in which size the circle sets:

| Tool | Circle | Its diameter is the size |
|---|---|---|
| **Inscribed polygon** | Touches the sides (inscribed in the polygon) | Across flats — between opposite sides |
| **Circumscribed polygon** | Passes through the vertices (circumscribed around the polygon) | Across corners — between opposite vertices |

If the wrench size matters (a nut, a hex), use the **inscribed polygon**; if the across-corners size matters, use the **circumscribed polygon**.

**Sketch toolbar:** **Inscribed polygon**, **Circumscribed polygon**

```figure
image: ../images/sketch-polygon-steps.svg
alt: A hexagon and the construction circle through its vertices
caption: Circumscribed polygon: 1 — center, 2 — vertex. The circle passes through the corners, so its diameter is larger than the distance across opposite flats.
width: 600
```

## Steps {#steps}

1. Choose a polygon tool.
2. Click the center.
3. Click the second point — it sets the size and rotation:
   - **inscribed polygon** — the middle of a side;
   - **circumscribed polygon** — a vertex.
4. Set the [number of sides](#sides) and click once more (or press `Enter`).
5. Optionally, type the diameter of the construction circle into the [quick dimension](sketch#quick-dimensions) field that appears and press `Enter`.

`Esc` cancels the polygon at any step.

## Number of sides {#sides}

A **Sides: 6** hint is shown next to the cursor. A polygon has 3 to 50 sides:

- **With the cursor.** After the second click, move the cursor away from the center to add sides, toward it to remove them.
- **With the keyboard.** Type the number (for example, `8`); `Backspace` erases a digit. You can type it before the second click too.

The chosen number is kept for the next polygon.

## What is created {#result}

- Equal sides (equal constraints) connected at the vertices.
- A construction circle: for the circumscribed polygon it passes through all vertices; for the inscribed one it touches all sides (tangent constraints). Its [diameter](sketch-dimensions) sets the size of the polygon.
- For an inscribed polygon with an even number of sides, also a construction radius from the center to the middle of the first side, perpendicular to it: without it, equal sides around a circle could shear into a rhombus.
- A center placed on a point or at the origin is attached to it.

> **Limitation.** The number of sides of an existing polygon cannot be changed (as in Onshape): delete it and draw it again.
