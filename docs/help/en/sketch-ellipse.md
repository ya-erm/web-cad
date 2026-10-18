# Ellipse

Draws a full ellipse from its center and two semi-axes.

**Sketch toolbar:** **Ellipse**

```figure
image: ../images/sketch-ellipse-steps.svg
alt: The center and two ellipse semi-axes
caption: Click order: 1 — center, 2 — end of the first semi-axis, 3 — second semi-axis. The diagram uses horizontal and vertical axes; the first axis can be rotated.
width: 600
```

## Steps {#steps}

1. Click **Ellipse**.
2. Click the center.
3. Click the end of the major axis — it sets the length and direction of the first semi-axis.
4. Click a point that sets the second (minor) semi-axis.
5. Optionally, type the diameters of the first and second axes into the [quick dimension](sketch#quick-dimensions) fields that appear (`Tab` moves to the next field) and press `Enter`.

## Dimensions {#dimensions}

As in Onshape, an ellipse dimension is the **diameter** of one of its axes (the full axis length, not the semi-axis).

1. Click **Dimension** (`D`) and click the ellipse.
2. Place the text **beside the axis** you want to dimension: above or below the first axis for its diameter, left or right of the second axis for the second diameter (just like choosing a horizontal or vertical distance between points).
3. Type the value and press `Enter`.

You can add both dimensions; together with the center position and the rotation they fully define the ellipse.

## Details {#details}

- A center placed on a sketch point coincides with it; the [concentric](sketch-constraints) constraint applies to ellipses.
- An ellipse forms a closed region that you can extrude.

> **Limitation.** Elliptical arcs are not supported.
