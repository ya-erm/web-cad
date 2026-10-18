# Dimensions

A dimension sets a length, distance, radius, diameter or angle. It is a driving dimension: change the value and the geometry rebuilds. The value can be a number, a number with units, or an [expression with variables](variables).

**Sketch toolbar:** **Dimension** · **Shortcut:** `D`

```figure
image: ../images/dimension-overview.png
alt: Sketch with dimensions: length, horizontal and vertical distances, diameter, radius, angle, point-to-line distance and an offset dimension
width: 500
```

## Steps {#steps}

1. Click **Dimension** (`D`).
2. Click one or two entities.
3. Click where to place the dimension text.
4. In the field that opens, enter a value (`25`, `25 mm`, `#width / 2`) and press `Enter`. `Esc` keeps the current (measured) value.

For newly drawn shapes, [quick dimensions](sketch#quick-dimensions) are more convenient: type the value right after drawing.

## Dimension types {#types}

| Selected | Dimension | More |
|---|---|---|
| A line | Length | [Length and distance](dimension-distance) |
| Two points | Horizontal, vertical or aligned distance — depending on where you place the text | [Length and distance](dimension-distance#placement) |
| A point and a line; two parallel lines | Distance | [Length and distance](dimension-distance) |
| A circle or arc and another entity | Distance from the center | [Length and distance](dimension-distance) |
| A circle / an arc | Diameter (Ø) / radius (R) | [Radius and diameter](dimension-radius) |
| An ellipse | Diameter of one of its axes — depending on where you place the text | [Ellipse](sketch-ellipse#dimensions) |
| Spline points | The distance between them, as between any points | [Spline](sketch-spline) |
| Two non-parallel lines | Angle | [Angle](dimension-angle) |
| A chain and its offset | Offset dimension | [Offset dimension](dimension-offset) |

If the entities cannot be dimensioned together, the message "These entities cannot be dimensioned together" appears.

## Editing dimensions {#edit}

- **Double-click** a dimension to open a field for a new value.
- Drag the text to move the dimension: it follows the mouse until you release the button, however fast you move. The dimension line breaks around the number.
- Click to select a dimension; `Del` deletes it.
- Hover over a dimension to highlight the entities it relates.

## Expressions and fx {#expressions}

- A number without units is in document units; angles are in degrees (`30` or `30 deg`).
- A dimension driven by an expression (for example, `#width / 2` or `2 * #r`) is marked with an **fx** icon. Hover over it to see the expression.
- The **Show expressions** checkbox in the sketch dialog shows expressions instead of values (the value then appears in the tooltip).
- An invalid expression is not accepted: "Invalid expression: …".

## Conflicts {#conflicts}

A red dimension conflicts with other constraints or dimensions (the sketch is **Over defined**). Delete or change the extra dimension, or undo the last action. See [Constraints: conflicts](sketch-constraints#conflicts).

> **Limitation.** As in Onshape, a dimension cannot be placed on the spline curve itself — only on its points.
