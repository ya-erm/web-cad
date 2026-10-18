# Mate connector

A mate connector is a local coordinate system attached to model geometry. In the graphics area it is shown as a triad of axes: X is red, Y is green, Z is blue. You can use a mate connector as a plane, axis, direction or point in other features, and to align parts with the [Transform](transform#mates) feature.

**Toolbar:** **Mate connector**

## Steps {#steps}

1. Click **Mate connector**.
2. Choose the mode: **On entity** (default) or [**Between entities**](#between).
3. In the **Location** field, hover over a face or an edge: its [inference points](#inference) appear. The one nearest to the cursor is highlighted in orange together with a preview of the axes — click to place the mate connector there.
4. If needed, reorient the axes: **Primary axis (Z)**, **Secondary axis (X)**, **Flip primary axis**, **Reorient**, **Rotation about Z**.
5. If needed, offset the mate connector: **X offset**, **Y offset**, **Z offset**.
6. Click ✓ (`Enter`).

`F1` in any field of the dialog opens this page.

```figure
image: ../images/mate-connector-result.png
alt: A mate connector's local coordinate system on the top face of a plate
caption: The connector is attached to the top face and offset 10 mm from its center along the connector's X axis. The colored axes show its orientation.
width: 480
```


## Inference points {#inference}

As in Onshape, hovering over geometry shows the points where a mate connector can go:

| Hover over | Points | Z axis |
|---|---|---|
| A planar face | The face center, vertices, edge midpoints, centers of arcs and holes | Along the face normal (the connector is parallel to the face) |
| A cylindrical, conical or toroidal face (chamfer and fillet of a round edge) | On the axis: start, middle and end of the face | Along the axis |
| A spherical face | The sphere center | Default (world Z) |
| A linear edge | Start, middle, end | Along the edge |
| A circular edge (hole, arc) | Center, start, middle, end | Along the circle axis |
| A vertex | The vertex | Default (world Z) |

To pick a point that lies over another face, hold `Shift`: the points of the last face or edge stay on screen while you move the cursor to them.

After an edge or a cylinder is picked, a **Center / Start / Middle / End** switch appears under **Location** to change the point without picking again.

## Between entities {#between}

In **Between entities** mode the mate connector origin is placed halfway between two points — for example, between the centers of holes in opposite walls, or between a face and the end of a pin.

1. Turn on **Between entities**.
2. Pick the first point in **Location** — the focus moves to **Second location** by itself.
3. Pick the second point. Each of them has its own **Center / Start / Middle / End** switch.

The orientation of the axes comes from the first location; you can change it further as usual.

## Location {#location}

| Selected | Mate connector origin | Z axis |
|---|---|---|
| A vertex, sketch point, the origin | At the point | Default |
| A linear edge, sketch line | At the midpoint | Along the line |
| A circular edge, sketch circle or arc | At the center | Along the circle axis |
| A planar face | At the face center | Along the face normal |
| A cylindrical, conical or toroidal face | On the axis | Along the axis |
| A spherical face | At the sphere center | Default |
| A plane | At the plane origin | Along the plane normal |
| Another mate connector | At its origin | Same as its Z axis |

## Options {#options}

| Field | Description |
|---|---|
| **On entity / Between entities** | Place the origin at the picked point or [halfway between two points](#between). |
| **Location** | The geometry the origin is attached to (required). |
| **Second location** | The second point in **Between entities** mode. |
| **Owner part** | The part the mate connector [moves with](#owner). When empty, the part the location was picked on. |
| **Primary axis (Z)** | Aligns the Z axis with the selected entity: a linear or circular edge, a planar or cylindrical face, a plane, a sketch line. |
| **Secondary axis (X)** | Turns the X axis toward the selected entity (a linear edge, a planar face, a plane, a sketch line). |
| **Flip primary axis** | Points Z in the opposite direction. |
| **Reorient** | Turns the connector so that its primary axis (Z) lies along the former **X** or **Y** axis (**Z** — unchanged). |
| **Rotation about Z** | Rotates the X and Y axes about Z by the given angle. |
| **X offset**, **Y offset**, **Z offset** | Move the origin along the mate connector's own axes. |

## Owner part {#owner}

A mate connector belongs to a part: when a [Transform](transform) further down the feature list moves or rotates that part, the connector moves with it. So after **Mate connector to mate connector**, the moved connector coincides with the target one.

- By default the owner is the part whose face, edge or vertex the connector sits on. A connector placed on another connector inherits its owner.
- A connector at the origin, on a plane or on a sketch has no owner and stays in place. To make it move with a part, pick the part in **Owner part**.
- Copies of parts (the **Copy part** check box of Transform) do not carry connectors.

## Where to use it {#use}

- **As a plane** (the mate connector's XY plane, with Z as the normal): the plane of a [sketch](sketch), the [mirror plane](mirror), the cutting plane of a [split](split), the base of an [offset plane](plane), the end of an [extrude](extrude) **Up to face**.
- **As an axis** (the Z axis): [revolve](revolve), [circular pattern](circular-pattern), rotation in [transform](transform), [helix](helix).
- **As a direction** (the Z axis): [linear pattern](linear-pattern), translation by entity in [transform](transform).
- **As a point** (the origin).
- **To align parts:** [Transform](transform#mates) → **Mate connector to mate connector**.

You can hide a mate connector with the eye icon in the [feature list](feature-list).

In an [assembly](assembly#mates), a part's mate connectors show on its instances and serve as anchors for mates.
