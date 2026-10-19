# Moving instances and the triad

[Assembly overview](assembly) · Dragging, precise translations and rotations.

## Dragging with the mouse {#drag}

As in Onshape, an instance can be dragged right in the graphics area: press the left mouse button on it and move the mouse. Over an instance that can move, the cursor turns into an open hand.

- The instance moves in the screen plane, following the cursor. With `Shift` held, it turns about the view direction through the point you grabbed.
- If the instance is held by mates to a fixed instance, it moves only as far as the mates allow: on a slider — along the axis, on a planar mate — in the plane. On a revolute, cylindrical or ball mate it turns so that the grabbed point follows the cursor.
- If no fixed instance holds its mated group, the whole group moves with it.
- A fixed instance does not move — a message says so.

When you release the button, the new placement is saved; the whole drag is undone with one `Ctrl+Z`. The [position panel](assembly-instances#position) shows the coordinates and angles as they change. Dragging is off while the mate dialog is open: clicks then pick connectors.

### Triad manipulator {#triad}

When one instance that can move is selected, a triad manipulator appears at its center, as in Onshape:

| Handle | Drag to |
|---|---|
| **Arrow** (X red, Y green, Z blue) | Move the instance along this axis. |
| **Arc** between two arrows | Turn the instance about the axis of the same color, through the triad center. |
| **Ball** in the center | Move the instance freely in the screen plane. |

The handle under the cursor and the dragged one are highlighted in orange. Mates work as with an ordinary drag: on a slider only the arrow of its axis moves the instance; on a revolute mate only the arc of its axis turns it. A click on the triad does not change the selection. A fixed instance has no triad.

```figure
image: ../images/assembly-triad.jpg
alt: Triad on the selected handle: arrows, rotation arcs and centre ball
caption: Arrows translate, arcs rotate, and the centre ball moves in the screen plane. Here Handle has a revolute mate: rotation about the blue Z axis is allowed; the mate blocks the other motions.
width: 430
```

**Exact values.** Click an arrow (without dragging) — a box appears next to it: type the distance to move along the arrow (in document units, or with a unit, such as `1 in`; an expression such as `25/2` works too) and press `Enter`. Clicking an arc asks for an angle in degrees: a positive angle turns counterclockwise when you look from the tip of the arrow of the same color. `Esc` or a click elsewhere closes the box. A wrong value turns the box red.

**Moving the triad.** By default the triad stands at the instance center and its axes are the axes of the assembly. Hold `Alt` and click a face, an edge, a vertex or a mate connector of the selected instance — the triad moves onto that mate connector (the same point as for a [mate](assembly-mates#mates): the center of a planar face, the axis of a cylinder, the middle of an edge) and takes its axes: Z along the normal or the axis. It then moves and turns with the instance. `Alt`+click on the center ball puts the triad back.
