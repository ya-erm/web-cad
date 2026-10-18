# Angle

Sets the angle between two lines.

**Sketch toolbar:** **Dimension** · **Shortcut:** `D`

```figure
image: ../images/dimension-angle-diagram.svg
alt: A 48° angle between two lines
width: 480
```

## Steps {#steps}

1. Click **Dimension** (`D`).
2. Click two non-parallel lines (if the lines are parallel, you get a [distance](dimension-distance#kinds)).
3. Click between the lines where to place the text.
4. Enter the angle and press `Enter`.

## How it works {#how}

- The dimension sets the angle between the line directions; the lines do not need to share a point.
- The direction of rotation is kept: if the second line is turned counterclockwise from the first, it stays turned to the same side.
- Both lines rotate, each by part of the change. To keep one in place, make it horizontal or vertical, or fix it.

## Values {#values}

- A number without units is in degrees: `30`.
- With units: `30 deg`, `0.5 rad`; expressions: `90 deg - #a`, `360 deg / #n`.
- For a right angle, the [Perpendicular](constraint-perpendicular) constraint is more convenient; for 0°, use [Parallel](constraint-parallel).

## See also {#see-also}

[Dimensions](sketch-dimensions), [Perpendicular](constraint-perpendicular).
