# Assembly

The **Assembly** tab puts a product together from parts built in Part Studios. Each inserted part is an **instance**: a reference to a Part Studio part with its own placement. You can insert one part several times; when the part changes in its Part Studio, all of its instances update.

## Creating an assembly {#create}

1. Click **+** in the bottom bar and choose **Assembly**. A tab with an empty **Instances** list appears.
2. Click **Insert** in the toolbar (`I`).
3. On the left of the dialog choose a Part Studio, on the right click a part — it appears in the assembly. **Insert all parts** inserts every part of the selected Part Studio at once.

The first instance of a part goes where the part is in its Part Studio. Further instances are placed to the right of the ones already inserted so that they do not overlap.

## Instances {#instances}

The **Instances** list on the left shows all instances; their names are the part name with a number: "Part 1 <1>", "Part 1 <2>".

- **Select:** click a row in the list or the part in the graphics area; `Shift` adds to the selection.
- **Rename:** double-click the name or choose **Rename** in the menu (right-click).
- **Hide / Show:** the eye icon in the row or the menu item.
- **Edit source Part Studio:** the menu item switches to the tab where the part is built.
- **Delete:** the trash button in the toolbar, the `Del` key or the menu item.

If the part was deleted from its Part Studio (or the Part Studio itself was deleted), its instance stays in the list with a warning icon and is not shown.

## Instance position {#position}

Select one instance — a panel with its placement appears on the left:

| Field | Description |
|---|---|
| **Position X, Y, Z** | The instance offset in document units. |
| **Rotation about axes X, Y, Z** | Angles in degrees; the rotation is about the X, then Y, then Z axes through the part's origin. |
| **Fixed** | Prevents moving the instance. |

Type a value and press `Enter` (or move to another field). Each change can be undone with `Ctrl+Z`.

## Dragging with the mouse {#drag}

As in Onshape, an instance can be dragged right in the graphics area: press the left mouse button on it and move the mouse. Over an instance that can move, the cursor turns into an open hand.

- The instance moves in the screen plane, following the cursor. With `Shift` held, it turns about the view direction through the point you grabbed.
- If the instance is held by mates to a fixed instance, it moves only as far as the mates allow: on a slider — along the axis, on a planar mate — in the plane. On a revolute, cylindrical or ball mate it turns so that the grabbed point follows the cursor.
- If no fixed instance holds its mated group, the whole group moves with it.
- A fixed instance does not move — a message says so.

When you release the button, the new placement is saved; the whole drag is undone with one `Ctrl+Z`. The [position panel](#position) shows the coordinates and angles as they change. Dragging is off while the mate dialog is open: clicks then pick connectors.

### Triad manipulator {#triad}

When one instance that can move is selected, a triad manipulator appears at its center, as in Onshape:

| Handle | Drag to |
|---|---|
| **Arrow** (X red, Y green, Z blue) | Move the instance along this axis. |
| **Arc** between two arrows | Turn the instance about the axis of the same color, through the triad center. |
| **Ball** in the center | Move the instance freely in the screen plane. |

The handle under the cursor and the dragged one are highlighted in orange. Mates work as with an ordinary drag: on a slider only the arrow of its axis moves the instance; on a revolute mate only the arc of its axis turns it. A click on the triad does not change the selection. A fixed instance has no triad.

**Exact values.** Click an arrow (without dragging) — a box appears next to it: type the distance to move along the arrow (in document units, or with a unit, such as `1 in`; an expression such as `25/2` works too) and press `Enter`. Clicking an arc asks for an angle in degrees: a positive angle turns counterclockwise when you look from the tip of the arrow of the same color. `Esc` or a click elsewhere closes the box. A wrong value turns the box red.

**Moving the triad.** By default the triad stands at the instance center and its axes are the axes of the assembly. Hold `Alt` and click a face, an edge, a vertex or a mate connector of the selected instance — the triad moves onto that mate connector (the same point as for a [mate](#mates): the center of a planar face, the axis of a cylinder, the middle of an edge) and takes its axes: Z along the normal or the axis. It then moves and turns with the instance. `Alt`+click on the center ball puts the triad back.

## Sub-assemblies {#subassemblies}

An assembly can go into another one, as in Onshape: in the **Insert** dialog, pick it under **Assemblies** and click it. It becomes one instance — a **sub-assembly** with the assembly icon in the list:

- it moves, turns, is fixed and hidden as a whole; its parts keep the placement its own assembly gives them;
- picking any of its parts in the graphics area picks the whole sub-assembly for dragging, the [triad](#triad) and the position panel (in a [flexible](#flexible) sub-assembly, dragging moves the part itself); **Open sub-assembly** in its menu opens its tab;
- [mates](#mates) can use the faces, edges and mate connectors of its parts — the whole sub-assembly moves to satisfy them;
- when the assembly inside changes (its parts, mates or placements), every assembly that uses it follows.

An assembly cannot contain itself: the dialog does not offer assemblies that already contain the current one.

### Flexible sub-assembly {#flexible}

A sub-assembly is rigid by default: its parts do not move relative to each other. To let its mechanism work in the parent assembly too, right-click the sub-assembly in the **Instances** list and choose **Make flexible** (Onshape's **Make flexible**). The row gets the flexible icon, and then:

- its parts move in the parent assembly as **its own** mates, groups and relations allow: [dragging](#drag) a part moves only that part (and what is mated to it), and the parent's mates pull its parts along their free degrees of freedom;
- a click on one of its parts picks the part itself: it gets its own [triad](#triad), and the [position panel](#position) shows where it stands in the parent assembly (a typed value acts like a drag; fixing is set in the sub-assembly itself);
- the parts fixed inside it are its base: they stay together where the sub-assembly places them; dragging the sub-assembly itself or its [triad](#triad) moves it as a whole;
- where its parts stand is kept in the parent assembly — the assembly inside and its other instances do not change;
- a fixed flexible sub-assembly with nothing fixed inside it is held by its first part.

**Make rigid** in the same menu puts the parts back where the sub-assembly places them.

**What is inside.** The arrow at the left of a sub-assembly in the **Instances** list opens it: its parts and nested sub-assemblies (which open in turn), and for a flexible one also its mates. A click on a row picks the part; on a mate — its two parts. A mate that cannot be satisfied in the parent assembly (say, a parent mate holds the part where the sub-assembly does not let it go) gets a warning icon, and so does the row of the sub-assembly itself. The mates and relations of a sub-assembly are edited in its own tab (**Open sub-assembly**).

## Fix {#fix}

**Fix instance** (the lock button in the toolbar or the menu item) fixes the selected instances: their placement cannot change until the instance is released (**Unfix**) — neither from the position panel nor by [dragging](#drag). A lock icon is shown in the list row, and the open-hand cursor does not appear over a fixed instance. Usually the base of the product, which the other parts attach to, is fixed.

## Mates {#mates}

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

Move along the free degrees of freedom by [dragging](#drag) the instance or in the [position panel](#position): for example, type the Z coordinate of an instance on a slider — it moves along the axis, while the locked coordinates go back. Mates are re-solved after every change — including when a part changes in its Part Studio.

The **Mates** list under the instances shows the type of each mate. Double-click a mate to edit it; its menu has **Flip primary axis**, **Suppress** and **Delete**. A mate that cannot be satisfied (for example, between two fixed instances) is marked with a warning icon.

### Tangent {#tangent}

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

### Width {#width}

A width mate centers a tab in a slot: pick two parallel planar faces of the slot (**Width**, the instance that stays), then two parallel planar faces of the tab (**Tab**, the instance that moves). The midplanes of the two pairs coincide; the tab can still slide along the slot and turn in its plane.

**Closed loops.** The solver walks the mates from the fixed instances along the chain. When several mates reach an instance from different sides (a loop, such as a four-bar linkage), all the free instances are then adjusted together until every mate holds. If the mates cannot all hold, the instances stay where the chain put them, and the mates that do not hold are marked with a warning icon.

## Animate a mate {#animate}

As in Onshape, a mate's free motion can be played as an animation: right-click a revolute, slider, cylindrical or pin slot mate in the **Mates** list and choose **Animate**.

| Field | Description |
|---|---|
| **Motion** | For a cylindrical mate: the turn about Z or the travel along Z. |
| **From**, **To** | The range: an angle in degrees (0° is where the X axes of the connectors coincide) or a distance along Z. It starts at the mate's [limits](#mates) if it has them, otherwise a full turn or 20 mm from where the instance is. |
| **Duration** | Seconds from **From** to **To**. |
| **Mode** | **Once**, **Loop** (again from the start) or **Back and forth**. |

The animation starts right away. The play button (`Space`) pauses and resumes it; the slider scrubs to any moment. Related instances follow: [gears](#relations) turn, [loops](#mates) close. The animation only shows the motion: when you close it (✕ or `Esc`) the assembly goes back to where it was, and nothing changes in the document.

## Group {#group}

A group holds several instances together as one rigid body, as they stand at the moment of grouping (Onshape **Group**) — handy for parts that are already placed and should not move relative to each other.

1. Select two or more instances: in the list, click them with `Shift` held; in the graphics area, click them one after another.
2. Click **Group** in the toolbar (the button with two squares in a dashed frame).

The group appears at the top of the **Mates** list with the number of its members; a click on it selects them. Dragging or moving any member moves the whole group, and mates of any member act on all of them. The group's menu has:

- **Update to the current placement** — remember how the members stand now (for example, after the group was suppressed and the members were moved);
- **Suppress** — let the members move separately for a while;
- **Ungroup** — delete the group (the instances stay).

When a member is deleted, the group keeps the rest; a group with fewer than two members disappears.

## Mate relations {#relations}

A relation ties the free motions of mates, as in Onshape:

| Relation | Mates | Rule |
|---|---|---|
| **Gear** | Two revolute (or cylindrical) mates | The second gear turns **Ratio** times as far as the first, the other way. |
| **Rack and pinion** | A revolute or cylindrical mate (pinion) and a slider or cylindrical mate (rack) | Per turn of the pinion the rack travels **Pitch diameter** × π. |
| **Screw** | One cylindrical mate | Per turn the instance travels along the axis by the **Pitch**. |

1. Create the mates first.
2. Click **Mate relation** in the toolbar (the gear button).
3. Choose the relation type and its mates (the lists show only suitable mates), enter the ratio, the pitch diameter or the pitch.
4. If the motion goes the wrong way, check **Reverse direction**.
5. Click ✓ (`Enter`).

The relation starts from the current placement: nothing moves when it is made. After that, turn the instance by [dragging](#drag) it, with the [triad](#triad) or by typing an angle in the [position panel](#position) — the related instance follows, and the instance you move stays where you put it. Turns keep counting past half a revolution, so with a ratio of 1.5 a full turn of the first gear turns the second one and a half times.

Relations are listed in **Mates** after the mates; their menu has **Edit**, **Suppress** and **Delete**. Deleting a mate deletes its relations.

## Exploded views {#exploded}

An exploded view moves instances apart to show how the product goes together, as in Onshape. It is only shown: the placements of the instances do not change.

1. Click **+** in the **Exploded views** list (under the mates). The new view opens.
2. Select the instances to move (in the graphics area or in the list with `Shift`).
3. Choose the **Direction** (±X, ±Y, ±Z of the assembly) and the **Distance**, then click **Add step**.
4. Repeat for the other instances: the steps go one after another.

A step can also be dragged: select instances in the open view — a [triad](#triad) appears at their center. Drag an arrow to move them along it, an arc to turn them about its axis through the triad center, or the ball to move them freely in the screen plane; when you release the button, the step joins the view.

Dashed **explode lines** run from where each part stands in the assembly to where the view shows it.

The **Explode** slider runs the steps in order from 0% (all together) to 100% (fully exploded). Delete a step with its trash button. Click ✓ or press `Esc` to close the view — the assembly is shown as it is; a click on the view in the list opens it again. While a view is open, instances are not dragged and the position panel is hidden.

## Bill of materials {#bom}

The **Bill of materials** button (the table at the right of the toolbar) shows the list of parts in the assembly: one row per part with its **Quantity** — how many instances use it — and the Part Studio it comes from.

Choose the type of the bill of materials in the list in its header (as in Onshape):

| Type | Rows |
|---|---|
| **Structured** (default) | The instances of this assembly, and under each [sub-assembly](#subassemblies) its parts and nested sub-assemblies, indented. Items are numbered by levels: "2", "2.1", "2.1.3". The **Quantity** inside a sub-assembly is how many there are in one sub-assembly. The arrow of a sub-assembly collapses and expands its rows. |
| **Flattened** | Parts only — from all levels together, with the total quantity. |
| **Top-level only** | The instances of this assembly: parts and sub-assemblies, without what is inside them. |

- **Part number**, **Description** and **Material** are part properties: click the cell and type; `Enter` saves the value with the part in its Part Studio (one undo step), so every assembly that uses the part shows it. Sub-assembly rows have no such properties.
- The **Columns** button (the funnel) shows or hides columns.
- A click on a row selects the instances of that part (or sub-assembly).
- The download button saves the shown columns as a CSV file, which opens in spreadsheets; the CSV has every row, collapsed ones too, and the item number shows the level.

## Export {#export}

**Export** in the top-right corner writes the assembly to STEP, STL, OBJ or 3MF — the selected instances or all shown ones, where they stand. See [Exporting an assembly](import-export#export-assembly).

> **Limitation.** A cone or a torus is tangent only to a plane. The mates of a flexible sub-assembly are edited only in its own tab.
