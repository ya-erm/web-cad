# Helix

Builds a helical curve (helix) around an axis.

**Toolbar:** **Helix**

## Steps {#steps}

1. Click **Helix**.
2. In the **Axis** field, select a cylindrical face, a circular edge, a sketch line or a linear edge.
3. Set the **Radius**, **Pitch** and **Revolutions**; turn on **Left handed** if needed.
4. Click ✓ (`Enter`).

```figure
image: ../images/helix-result.png
alt: A helical curve with four turns around a vertical axis
caption: A helix about Z: radius 12 mm, pitch 8 mm, 4 turns. The result is a curve; sweep a profile along it to create a solid.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **Axis** | Axis of the helix. If you select a cylindrical face or a circular edge, the helix follows their radius, and the **Radius** field is not used. |
| **Radius** | Helix radius (default 10 mm) — for a line axis. |
| **Pitch** | Distance between turns along the axis (default 5 mm). |
| **Revolutions** | Number of turns (can be fractional; default 5). Helix height = pitch × number of turns. |
| **Left handed** | Left-hand winding instead of right-hand. |

The helix is built along the axis from its start point (for a circular edge — from its center) and appears in the graphics area as a curve; you can hide it with the eye icon in the Feature list.

## Spring: sweeping along a helix {#spring}

Select a helix by clicking it in the graphics area, like a sketch curve — for example, in the **Path** field of a [sweep](sweep):

1. Create the helix.
2. Draw the profile (for example, a circle) in a sketch on a plane that passes through the start of the helix across its run. For a helix around the Z axis the start lies on the **Front** plane.
3. Click **Sweep**, select the profile, then click the **Path** field and click the helix itself — its name appears in the field.
4. Click ✓.

A hovered or selected helix is highlighted; right-clicking it opens a menu with **Edit**.
