# Spline

Draws a smooth curve through the points you click (an interpolating spline).

**Sketch toolbar:** **Spline**

```figure
image: ../images/sketch-spline-steps.svg
alt: A spline passing through four specified points
caption: Points 1–4 are placed in order. The curve passes through them; the dashed polyline only explains the order and is not created by the tool.
width: 600
```

## Steps {#steps}

1. Click **Spline**.
2. Click the points the curve should pass through (at least two).
3. Finish: double-click, `Enter` or right-click.

To get a **closed** spline, make your last click on the first point.

## Details {#details}

- Spline points are regular sketch points: you can drag them and constrain and [dimension](sketch-dimensions) them. As in Onshape, spline dimensions are distances between its points, or from a spline point to another point or a line: horizontal, vertical or aligned, depending on where you place the text.
- The start and end points of an open spline get coincident constraints when placed on existing geometry.
- A closed spline forms a region that you can extrude.

## Tangent handles {#handles}

As in Onshape, the direction of a spline at its ends is set by **tangent handles** — points on dashed segments that leave the ends of an open spline.

- **Show the handles.** Select the spline: blue dashed handles appear at its free ends. They show the current (natural) tangent and change nothing yet.
- **Change the tangent.** Drag a handle: the curve leaves the end toward it. The farther the handle is from the end, the longer the curve keeps that direction. Clicking a blue handle also turns it on — it becomes a regular point you can select.
- **Constraints and dimensions.** An active handle is a sketch point: for example, a [**Horizontal**](constraint-horizontal) or [**Vertical**](constraint-vertical) constraint between the end and the handle sets the direction, and [dimensions](sketch-dimensions) from the end set the direction and the "strength" of the tangent.
- **Tangent to a line or arc.** Join the end of the spline to the end of a line or arc, select the spline and that line (arc), and click [**Tangent**](constraint-tangent) (`T`). The handle at that end is created automatically and continues the line (for an arc — perpendicular to the radius), so the curve blends smoothly into the line.
- **Remove a handle.** Select its point and press `Del`: the end returns to the natural tangent, the spline itself stays.

Handles move with the spline and are copied by [patterns](sketch-pattern) and [mirror](sketch-mirror).

> **Limitation.** [Offset](sketch-offset) does not support splines.
