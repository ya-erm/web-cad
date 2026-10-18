# Plane

Creates a reference plane for [sketches](sketch), [mirror](mirror), [split](split), [loft](loft) and other features. It defines a position and orientation, but does not add material or cut a part by itself.

**Toolbar:** **Plane**

## Steps {#steps}

1. Finish editing any sketch or feature, then click **Plane**.
2. Choose the **Plane type**.
3. Click **Entities**, then select references **in the graphics area**. All references go into one field; the required order is given in the examples below.
4. Set the offset, angle or normal direction when available. Check the preview.
5. Give the feature a useful name, such as “Section 35 mm”, and click ✓ (`Enter`).

```figure
image: ../images/plane-dialog.png
alt: The Plane dialog with Offset, Top as the reference and a distance of 35 mm
caption: Choose the type, then fill Entities. The fields below depend on the mode; this Russian UI example shows a 35 mm offset from Top.
width: 320
```

You can select references before clicking **Plane** to fill the field automatically. For example, select **Top** in the feature list first. Once the dialog is open, select references in the graphics area; use the eye icon in the feature list to show hidden planes.

> **Tip.** Previously selected references remain in **Entities** when switching modes. Remove unwanted chips with ✕. Each example below creates a separate Plane feature.

## Plane types {#types}

| Type | What to select | Options |
|---|---|---|
| [Offset](#offset) | One plane or planar face | A parallel plane at a known distance. The default **Offset** is 10 mm. |
| [Point normal](#point-normal) | A point first, then a direction | A section through a point, perpendicular to a line. A plane or planar face can supply its normal as the direction instead. |
| [Three point](#three-point) | Three distinct vertices or points | A tilted section without an angle input. Points must not be collinear. |
| [Line angle](#line-angle) | A straight line or edge first, then a reference plane or planar face | A plane rotated about a line like a hinge. The default **Angle** is 30°. |
| [Mid plane](#midplane) | Two parallel planes or planar faces | A plane exactly halfway through a part or gap. No distance input is needed. |

## Example model {#example-model}

Draw a **40 × 30 mm** rectangle on **Top** and extrude it **20 mm**. Its bottom face is at Z = 0 and its top face at Z = 20 mm.

In the diagrams, **blue** indicates references or a direction and **orange** is the new plane. The part is translucent where needed to show a plane passing through it. The rectangle represents the plane; it does not limit the extent of a future sketch.

## Offset: a plane at a height of 35 mm {#offset}

**Use it for:** a sketch above a part, another loft section or a split at a known height.

1. Open **Plane** → **Offset**.
2. Select **Top** in **Entities**.
3. Enter an **Offset** of `35 mm`. If the plane appears below Top, click **Opposite direction** next to the value.
4. Check that the new plane is parallel to Top and 15 mm above the block, then click ✓.

```figure
image: ../images/plane-offset-example.svg
alt: A plane parallel to Top and offset upward by 35 mm
caption: 1 — the new plane; 2 — Top. The 35 mm distance is measured from the selected reference, not from the part's top face.
width: 640
```

If you select the block's **top face** instead of Top, use an offset of **15 mm** to reach the same Z = 35 mm height. That plane follows the face when the block height changes; an offset from Top keeps its distance from Top.

You can enter an [expression](variables), such as `#height + 15 mm`. The direction button changes the side of the reference, not the plane's tilt.

## Point normal: a section through a point {#point-normal}

**Use it for:** a section that must pass through a specific point and be perpendicular to an axis or straight portion of a part.

A normal is a direction **perpendicular to a plane**. The selected line supplies this direction: the new plane is perpendicular to it, rather than containing it.

1. Create a sketch on **Front**. Use [Point](sketch-point) to place point A above the block, [dimension](dimension-distance) its height from the origin to **35 mm**, then finish the sketch.
2. Open **Plane** → **Point normal**.
3. In **Entities**, select point A **first**, then any vertical straight edge of the block. The field should contain two references.
4. Check that the plane is horizontal and passes through A, then click ✓.

```figure
image: ../images/plane-point-normal-example.svg
alt: A horizontal plane through point A with its normal parallel to a vertical block edge
caption: 1 — point A at a height of 35 mm; 2 — the edge supplying the direction. Arrow N is the new plane's normal and is parallel to the selected edge.
width: 640
```

You can use a part vertex or the origin instead of a sketch point, and a sketch line instead of a straight edge. Still select the point first.

When the direction reference is a **plane or planar face**, its **normal** is used. The result is therefore **parallel** to that plane or face and passes through the selected point.

**Flip normal** reverses the normal and changes the plane's orientation, but does not move it. To move the plane, change the reference point or use **Offset**.

## Three point: a diagonal section {#three-point}

**Use it for:** a tilted plane through three known vertices, without a separate angle or distance.

1. Open **Plane** → **Three point**.
2. In **Entities**, select vertices A and B at the two ends of one bottom edge.
3. Select top vertex C on the opposite side of the block as the third point. Rotate the model by right-dragging to reach hidden vertices.
4. Check that the field contains three vertices and the plane passes through each, then click ✓.

```figure
image: ../images/plane-three-point-example.svg
alt: A tilted plane through bottom vertices A and B and top vertex C of the block
caption: A and B define the bottom edge; C raises the opposite side of the plane. Right — an invalid choice: three collinear points do not define a unique plane.
width: 640
```

You can use sketch points, including points from different sketches. Three non-collinear points in one planar sketch reproduce that sketch's own plane.

The A → B → C order affects the normal direction and the axes of a future sketch. **Flip normal** reverses the normal while keeping the plane in place.

## Line angle: a 30° tilt {#line-angle}

**Use it for:** a sketch for a tilted slot, hole or rib, with a plane rotating about a specific line like a hinge.

Here the line is a **rotation axis contained in the new plane**. This differs from **Point normal**, where the line is perpendicular to the result.

1. Open **Plane** → **Line angle**.
2. In **Entities**, select a straight bottom edge A–B lying on Top **first**.
3. Select **Top** in the graphics area **second**. If it is hidden, show it with the eye icon.
4. Enter an **Angle** of `30 deg`. If the tilt points the wrong way, click **Opposite direction** next to the angle.
5. Check that edge A–B still lies in the new plane and only the plane rotated about it, then click ✓.

```figure
image: ../images/plane-line-angle-example.svg
alt: A plane tilted 30 degrees from Top about the bottom edge A–B
caption: Blue A–B is the rotation axis, the blue plane is Top and orange is the result. Right — a view along A–B showing the 30° angle between the planes.
width: 640
```

A straight sketch line can replace the edge. The reference plane is optional, but without it the initial orientation is chosen automatically. For an unambiguous angle, choose the reference explicitly and use a line lying in it.

The direction button changes the sign of the angle, rotating the plane to the other side of the reference. The rotation axis stays in place.

## Mid plane: the center of a block {#midplane}

**Use it for:** a sketch on a symmetry plane, a mirror about a part's center or a section halfway through a gap.

1. Open **Plane** → **Mid plane**.
2. Select one planar end face of the block in **Entities**.
3. Select the **opposite parallel face**, 40 mm away. Rotate the model if necessary.
4. Check that the new plane is parallel to both faces and 20 mm from each, then click ✓. No distance input is needed.

```figure
image: ../images/plane-midplane-example.svg
alt: A mid plane between two parallel end faces of a block
caption: 1 and 2 are the selected faces. The orange plane halves the 40 mm distance; the inset shows equal 20 mm gaps.
width: 640
```

You can select two reference planes, or a plane and a parallel face. When the distance between the references changes, the midpoint updates.

> **Limitation.** This mode is intended for **parallel** references. Use **Line angle** for a plane at an angle to intersecting faces: Mid plane is not an angle-bisector mode.

## Troubleshooting {#troubleshooting}

| Symptom | What to check |
|---|---|
| A reference did not appear in the field | Activate **Entities** and select it in the graphics area. You can preselect references in the tree before starting the tool. |
| “Select a plane or planar face” | Offset needs a plane or planar face, rather than a cylindrical surface or edge. |
| “Select a point and a line (normal direction)” | Select the point first, then a suitable direction. Remove extra chips. |
| “Select three points” / “Points are collinear” | Select three distinct vertices or points; the third must lie off the line through the first two. |
| The angle has an unexpected reference | Select the line first and the reference plane second. For the Top example, the line must lie on Top. |
| The preview disappeared after switching modes | Remove the previous references from **Entities** and select exactly the set required by the new mode. |
| The plane is invisible or looks like a line | Check the eye icon, press `F` and rotate the view: you may be looking at the plane edge-on. |

## Usage {#use}

1. Select the finished plane in the graphics area or [feature list](feature-list).
2. Click **Sketch** (`Shift+S`).
3. Check that **Sketch plane** names the plane you created, then draw the profile.

The plane can be a reference for **Mirror**, **Split** or another **Plane**. To change its position, double-click its feature and edit the references, offset or angle; dependent features rebuild.

Double-clicking a **created Plane feature** opens its parameters. Double-clicking a **default Top, Front or Right plane** starts a sketch.

The displayed rectangle's size is chosen automatically from the model. Hide an individual plane with its eye icon; press `P` to show or hide all planes. Hiding a plane does not disable dependent sketches or features.
