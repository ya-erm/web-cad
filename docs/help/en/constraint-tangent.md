# Tangent

Makes a line tangent to a circle or arc, or makes two circles (arcs) tangent to each other.

**Sketch toolbar:** **Tangent** · **Shortcut:** `T`

```figure
image: ../images/constraint-tangent.svg
alt: A line and circle before and after applying tangency
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

Exactly two curves, at least one of which is a circle or arc:

- a line and a circle (arc);
- two circles (arcs);
- a spline and a line or arc joined at their ends.

Otherwise, the message "Select a line and an arc/circle, or two arcs" appears.

## How it works {#how}

- **Line and circle:** the distance from the center to the infinite line through the segment becomes equal to the radius. The circle stays on the same side of the line. If position or size is not constrained, the solver may move the curves and change the radius.
- **Line and arc with a shared endpoint:** tangency is enforced at that shared point, so the transition is smooth.
- **Two circles:** external or internal tangency is chosen from the current position (if one circle is inside the other, it is internal).
- **Two arcs with a shared endpoint:** a smooth blend at the shared point.
- **A spline and a line (arc) with a shared endpoint:** a [tangent handle](sketch-spline#handles) is created at that end of the spline and becomes parallel to the line (for an arc — perpendicular to its radius).

## Created automatically {#auto}

[Tangent arc](sketch-arc#tangent), [sketch fillet](sketch-fillet), [slot](sketch-slot).

## Notes {#notes}

- Tangency does not require the tangent point to lie within the segment: the line is tangent to the circle even if the segment itself is shorter. To connect them, add a [coincident](constraint-coincident) constraint between the line's endpoint and the circle.
- If the circle must keep its size, first give it a [diameter](dimension-radius).

## Deleting {#delete}

Click the tangent icon next to the curve and press `Del`.
