# Mates {#mates}

[Assembly overview](assembly) · Mate connector selection, mate types and limits.

A mate ties two instances together through their **mate connectors** and leaves only certain degrees of freedom between them — as in Onshape.

1. Click **Mate** in the toolbar (`J`).
2. Choose the mate type (see the table).
3. Click the first connector — on the instance that should stay — then the second one — on the instance that moves to it. The assembly shows the result right away.
4. If needed, click **Flip primary axis** or **Rotate 90°**.
5. Click ✓ (`Enter`); `Esc` cancels.

A connector can be:

- an **explicit mate connector** of the part — a [mate connector](mate-connector) created in the Part Studio and [owned](mate-connector#owner) by this part; such connectors show on the instances as an axis triad;
- an **implicit mate connector** — a click on the geometry: a planar face (the face center, Z along the normal), a cylindrical or conical face (the middle of its axis), a circular edge (the circle center), a straight edge (its middle, Z along the edge), a vertex.

| Type | Free motion of the second instance |
|---|---|
| **Fastened** | None — the connectors coincide. |
| **Revolute** | Rotation about the connector's Z axis. |
| **Slider** | Translation along Z. |
| **Cylindrical** | Rotation about Z and translation along it. |
| **Planar** | Translation in the XY plane and rotation about Z. |
| **Ball** | Any rotation about the connector's origin. |
| **Parallel** | The Z axes stay parallel; the instance moves anywhere and turns about Z. |
| **Pin slot** | The origin of the second connector (the pin) slides along the X axis of the first (the slot) and turns about Z. |
| **Tangent** | Two faces touch (see [below](#tangent)). |
| **Width** | A tab is centered between the two faces of a slot (see [below](#width)). |

The Z axes of the connectors are set against each other or the same way — whichever is closer to the current placement (so parts press face to face). **Flip primary axis** changes that; **Rotate 90°** turns the second instance about Z (for fastened and slider mates) or turns the slot direction (for a pin slot mate). For a pin slot, pick a straight edge of the first instance along the slot in the optional third field **Slot direction** — the slot then runs along that edge (in the plane of the first connector), with no explicit [mate connector](mate-connector) needed.

**Offset** (fastened, revolute, planar, ball and pin slot mates): the distance of the second connector from the first along the first connector's Z axis — for example, a gap between two faces.

**Limits** (as in Onshape) restrict the free motion: along Z for slider and cylindrical mates (**Axial minimum / maximum**), about Z for revolute and cylindrical mates (**Rotational minimum / maximum**, from −180° to 180°; 0° is where the X axes of the connectors coincide). When you check **Limits**, the range starts around the current placement: ±10 mm and ±45°. The instance does not go past the limits, whether you drag it or type its position.

Move along the free degrees of freedom by [dragging](assembly-movement#drag) the instance or in the [position panel](assembly-instances#position): for example, type the Z coordinate of an instance on a slider — it moves along the axis, while the locked coordinates go back. Mates are re-solved after every change — including when a part changes in its Part Studio.

The **Mates** list under the instances shows the type of each mate. Double-click a mate to edit it; its menu has **Flip primary axis**, **Suppress** and **Delete**. A mate that cannot be satisfied (for example, between two fixed instances) is marked with a warning icon.

## Tangent {#tangent}

Tangent and width mates are made between **faces**, not mate connectors: the dialog accepts only faces of the right kind.

A tangent mate keeps two faces touching — the faces are taken as whole surfaces (an infinite plane, a cylinder along its whole axis):

| Faces | Result |
|---|---|
| Plane and plane | The faces lie against each other. |
| Plane and cylinder | The cylinder lies on the plane: its axis parallel to the plane at the radius from it. |
| Plane and sphere | The sphere rests on the plane. |
| Plane and cone | The cone lies on the plane along a generator: the apex on the plane, the axis tilted by the cone's half-angle. |
| Plane and torus | The torus lies flat (axis along the normal, at the tube radius) or stands on its rim like a wheel (axis in the plane) — whichever is nearer to how it stands now. |
| Cylinder and cylinder | The axes are parallel at the sum of the radii. |
| Sphere and sphere, sphere and cylinder | They touch at the sum of the radii. |

The side the faces touch from is taken from the current placement; **Other side** changes it — the back of a plane, or the inside of a cylinder or sphere (a ball in a hole: the distance is then the difference of the radii).

## Width {#width}

A width mate centers a tab in a slot: pick two parallel planar faces of the slot (**Width**, the instance that stays), then two parallel planar faces of the tab (**Tab**, the instance that moves). The midplanes of the two pairs coincide; the tab can still slide along the slot and turn in its plane.

**Closed loops.** The solver walks the mates from the fixed instances along the chain. When several mates reach an instance from different sides (a loop, such as a four-bar linkage), all the free instances are then adjusted together until every mate holds. If the mates cannot all hold, the instances stay where the chain put them, and the mates that do not hold are marked with a warning icon.

```figure
image: ../images/assembly-mate.jpg
alt: Revolute mate between Base and Handle with limits −90° and 90°
caption: The first cylindrical face belongs to fixed Base; the second belongs to Handle. Revolute leaves one rotational degree of freedom (1 R). Limits restrict rotation to the range −90° to 90°.
width: 340
```

> **Limitation.** A cone or a torus is tangent only to a plane.
