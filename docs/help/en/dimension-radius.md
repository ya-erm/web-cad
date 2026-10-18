# Radius and diameter

Sets the size of a circle (diameter, Ø) or an arc (radius, R).

**Sketch toolbar:** **Dimension** · **Shortcut:** `D`

```figure
image: ../images/dimension-radius-diagram.svg
alt: Circle diameter Ø44 and arc radius R20
width: 600
```

## Steps {#steps}

1. Click **Dimension** (`D`).
2. Click a circle or an arc.
3. Click where to place the text — the dimension points toward it.
4. Enter a value and press `Enter`.

## How it works {#how}

| Curve | Dimension | What you enter |
|---|---|---|
| Circle | Diameter, text `Ø…` | Diameter |
| Arc | Radius, text `R…` | Radius |

The center stays in place; the radius changes. For an arc, its endpoints move along rays from the center.

**How a diameter is drawn.** With the text inside the circle, the dimension line goes across the whole diameter and the arrows point from the center to the circle. With the text outside, there is one arrow at the circle next to the text, and the line goes through the center and breaks off past it (as in the ESKD standard). Drag the text inside or outside to switch; [drawings](drawings) show diameters the same way.

**Change the value** — double-click the text (see [Editing dimensions](sketch-dimensions#edit)).

## Notes {#notes}

- Right after you draw a circle or arc, you can enter its size in the [quick dimension](sketch#quick-dimensions) field.
- Several identical circles: set the diameter of one and make the others [Equal](constraint-equal).
- The dimension of a [sketch fillet](sketch-fillet) is the radius of the fillet arc.
- For an ellipse, the dimension sets the diameter of one of its axes: the text beside an axis dimensions that axis.

## See also {#see-also}

[Length and distance](dimension-distance), [Circle](sketch-circle), [Arc](sketch-arc).
