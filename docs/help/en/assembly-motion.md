# Motion, groups and relations

[Assembly overview](assembly) · Mechanism animation, rigid groups and coupled motion.

## Animate a mate {#animate}

As in Onshape, a mate's free motion can be played as an animation: right-click a revolute, slider, cylindrical or pin slot mate in the **Mates** list and choose **Animate**.

| Field | Description |
|---|---|
| **Motion** | For a cylindrical mate: the turn about Z or the travel along Z. |
| **From**, **To** | The range: an angle in degrees (0° is where the X axes of the connectors coincide) or a distance along Z. It starts at the mate's [limits](assembly-mates#mates) if it has them, otherwise a full turn or 20 mm from where the instance is. |
| **Duration** | Seconds from **From** to **To**. |
| **Mode** | **Once**, **Loop** (again from the start) or **Back and forth**. |

The animation starts right away. The play button (`Space`) pauses and resumes it; the slider scrubs to any moment. Related instances follow: [gears](#relations) turn, [loops](assembly-mates#mates) close. The animation only shows the motion: when you close it (✕ or `Esc`) the assembly goes back to where it was, and nothing changes in the document.

```figure
image: ../images/assembly-animation.jpg
alt: Revolute mate animation over the range −90° to 90°
caption: The handle turns from −90° to 90° in 4 seconds in Back and forth mode. Playback is paused; the slider lets you inspect an intermediate position. Closing the panel returns the original placement.
width: 900
```

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

The relation starts from the current placement: nothing moves when it is made. After that, turn the instance by [dragging](assembly-movement#drag) it, with the [triad](assembly-movement#triad) or by typing an angle in the [position panel](assembly-instances#position) — the related instance follows, and the instance you move stays where you put it. Turns keep counting past half a revolution, so with a ratio of 1.5 a full turn of the first gear turns the second one and a half times.

Relations are listed in **Mates** after the mates; their menu has **Edit**, **Suppress** and **Delete**. Deleting a mate deletes its relations.
