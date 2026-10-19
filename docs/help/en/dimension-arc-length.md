# Arc length

Sets the length of an arc — along the arc itself, not its chord. The text is marked with an arc sign: `⌒20.94`.

**Sketch toolbar:** **Dimension** · **Shortcut:** `D`

## Steps {#steps}

1. Click **Dimension** (`D`).
2. Click one end of the arc, then the other.
3. Click the arc itself — the dimension becomes its length (without that third click on the arc, the two ends give the distance between them, as usual).
4. Click where to place the text, enter the length and press `Enter`.

The dimension line is an arc concentric with the dimensioned one and passing through the text, with extension lines from the arc's ends and arrows at its ends.

```figure
image: ../images/dimension-arc-length.jpg
alt: Radius 20 mm quarter-circle with an arc length dimension of 31.416 mm
caption: Radius 20 mm and angle 90° give an arc length of 31.416 mm. Select both endpoints, then the arc, and place the label outside. The arc symbol before the value distinguishes this from the chord distance.
width: 520
```

## How it works {#how}

- The arc length is the radius times its angle (the arc runs counterclockwise from its first end to the second).
- When the radius is set separately (by a dimension or by tangencies), the arc length changes its angle; when the angle is fixed, the radius changes.
- A number without units is in document units; expressions work too: `#w * 2`.

## See also {#see-also}

[Dimensions](sketch-dimensions), [Radius and diameter](dimension-radius), [Arc](sketch-arc).
