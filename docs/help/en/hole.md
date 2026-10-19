# Hole

Creates drilled holes — simple, counterbored or countersunk — at sketch points.

**Toolbar:** **Hole**

## Steps {#steps}

1. Draw a sketch on a part face and place [points](sketch-point) at the centers of the future holes.
2. Click **Hole**.
3. Choose the **Hole style**: **Simple**, **Counterbore**, **Countersink** or **Counterbore and countersink**.
4. Select sketch points — or circular edges (the hole goes to their center), or [mate connectors](mate-connector).
5. Choose the **Termination** and set the **Diameter** and the other dimensions — or choose **Standard: ISO** and the fastener size, see [below](#standard). Click ✓ (`Enter`).

## Direction {#direction}

- From a sketch point a hole goes against the sketch plane's normal.
- From a circular edge it goes along the edge's axis into the part's material. For example, the arcs of rounded corners on a top face give holes going down, whichever way each arc's axis points.
- From a mate connector it goes against the connector's Z. Turn on **Flip primary axis** in the connector's dialog and that hole goes the other way.
- The **Direction** button (under **Termination**) turns all the feature's holes round.

```figure
image: ../images/hole-result.png
alt: Two counterbored through holes in a plate
caption: Two sketch points locate the holes: diameter 6 mm, counterbore diameter 10 mm and counterbore depth 3 mm.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **Hole style** | **Simple**, **Counterbore**, **Countersink** or **Counterbore and countersink** (like Onshape's Counterdrill): a counterbore with a countersink at its mouth — so a screw head does not catch a sharp edge, say. |
| **Sketch points to place holes** | Sketch points, circular edges or mate connectors, see [Direction](#direction). |
| **Termination** | **Blind** or **Through all**. |
| **Direction** | The button turns all the feature's holes the other way. |
| **Diameter** | Hole diameter (default 5 mm). |
| **Depth** | For **Blind** (default 10 mm). |
| **Tip angle** | The cone at the bottom of a blind hole (default 118°, like a drill bit). |
| **Counterbore diameter**, **Counterbore depth** | For **Counterbore** and **Counterbore and countersink** (default 9 and 4 mm). The counterbore diameter must be larger than the hole diameter. |
| **Countersink diameter**, **Countersink angle** | For **Countersink** and **Counterbore and countersink** (default 10 mm and 90°). With both, the countersink is wider than the counterbore and ends above its floor. |
| **Recess depth** | For **Countersink**: a cylindrical recess of the countersink's diameter above its cone — the countersink sunk that deep (default 0 — no recess). A seat for a countersunk head set below the surface. |
| **Standard** | **Custom** — the sizes from the fields above; **ISO** (metric) or **ANSI** (inch) — from the standards' tables, see [below](#standard) and [ANSI](#ansi). |
| **Tapped depth** | For a **Blind** tapped hole: how deep the thread goes (no deeper than the hole). |
| **Merge with all** / **Merge scope** | The parts to cut the holes from: all parts or only the selected ones. |

## ISO standard holes {#standard}

With **Standard: ISO** the sizes come from the tables for metric fasteners M1.6–M64: the diameter fields are hidden and the resulting sizes are shown under the choices.

- **Type: Clearance** — a hole for a screw to pass, ISO 273. **Fit**: **Close**, **Normal** or **Loose** (fine / medium / coarse), e.g. for M6 — 6.4 / 6.6 / 7 mm. **No clearance (nominal)** — a hole exactly as wide as the screw (M2 → 2 mm), e.g. for a printed part the screw goes into tight. ANSI has it too.
- **Type: Tapped** — a hole for a tap (the drill by ISO 2306, for M6 — 5 mm) with a [cosmetic thread](#thread). **Pitch**: coarse (the default) or one of the fine ones of ISO 261; a fine pitch drills the major diameter minus the pitch and is designated M8×1.
- **Counterbore** — a counterbore for an ISO 4762 socket head cap screw (by DIN 974-1), **Countersink** — a 90° countersink for an ISO 10642 countersunk screw, **Counterbore and countersink** — that counterbore with a 0.5 mm × 45° chamfer at its mouth.
- Choosing a size sets the depths as Onshape does: the thread 2 diameters deep, the hole 3 pitches deeper. You can change them.

### ANSI inch holes {#ansi}

**Standard: ANSI** covers inch fasteners #0–#12 and 1/4–1″. The sizes come from the inch tables and are converted to millimetres and the document's units.

- **Clearance** — holes by ASME B18.2.8 with the fits **Close**, **Normal**, **Loose**: for #10 — 0.206 / 0.221 / 0.238″, for 1/4 — 0.266 / 0.281 / 0.297″.
- **Tapped** — Unified threads (ASME B1.1) with the 75 % tap drill. The **Pitch** is set in threads per inch: the coarse UNC series (the default) or the fine UNF one. For example, 1/4-20 UNC uses a 0.201″ drill and 1/4-28 UNF a 0.213″ one.
- **Counterbore** — for a socket head cap screw (ASME B18.3): for #10 — 3/8″. It is as deep as the normal fit is wide, so the head sits a little below the surface.
- **Countersink** — 82° for a flat socket head cap screw (ASME B18.3), as wide as the head for it to sit flush: for 1/4 — 0.531″. **Counterbore and countersink** — the counterbore with a 1/64″ × 45° chamfer.

The tables the sizes were checked against do not give everything. #12 and 9/16 have only tapped holes. Countersinks exist for #4–#10, 1/4, 5/16, 3/8 and 1/2. For the rest the dialog says so — switch to **Standard: Custom**.

```figure
image: ../images/iso-hole-dialog.jpg
alt: Hole dialog: ISO tapped M6, 1 mm pitch, through all
caption: Choose ISO → Tapped → M6 → 1 mm pitch. The 5 mm tap drill is filled in automatically (the hint below the fields). This example uses Through all, so there is no separate thread depth field.
width: 350
```

## What a tapped ISO hole looks like {#appearance}

The screenshots show a 24 × 20 × 16 mm block with **ISO → Tapped → M6**, 1 mm pitch, **Through all**.

| Normal view | Section through the hole axis |
|---|---|
| ![M6 hole with a thin circle showing the thread major diameter](../images/iso-tapped-solid.png) | ![M6 hole section with cosmetic thread lines](../images/iso-tapped-section.png) |

The hole uses a **Ø5 mm tap drill**. The thin Ø6 mm circle at the mouth and thin lines in the section are **cosmetic**: helical thread turns are not modelled. To inspect your own hole this way, enable [Section view](section-view) and place its plane through the hole axis.

## Entrance styles and sections {#cuts}

The same block and **M6** fastener size, with **Type → Clearance**, **Fit → Normal**, **Through all**. The main bore is **Ø6.6 mm** in every row; only **Hole style** changes. The normal view shows the entrance; the section exposes the cut profile.

| Hole style | In the model | In section |
|---|---|---|
| **Simple** — no head recess | ![Simple M6 clearance hole](../images/iso-clearance-solid.png) | ![Straight cylindrical channel in section](../images/iso-clearance-section.png) |
| **Counterbore** — Ø11 mm cylindrical recess, 6.6 mm deep | ![Cylindrical counterbore entrance](../images/iso-counterbore-solid.png) | ![Counterbore step with a flat floor](../images/iso-counterbore-section.png) |
| **Countersink** — 90° conical recess for a countersunk head | ![Conical countersink entrance](../images/iso-countersink-solid.png) | ![Countersink cone meets the cylindrical bore](../images/iso-countersink-section.png) |
| **Counterbore and countersink** — counterbore with a 0.5 mm × 45° entrance chamfer | ![Counterbore with a chamfer at its mouth](../images/iso-counterdrill-solid.png) | ![Entrance chamfer, cylindrical recess and main bore](../images/iso-counterdrill-section.png) |

Choose **Hole style** at the top of the dialog. **ISO** supplies sizes for the chosen fastener. For your own diameters and depths, switch **Standard → Custom**.

## Cosmetic thread {#thread}

A tapped hole's thread is not modelled (the hole has the drill's diameter) but shown by convention, as in Onshape:

- in the graphics area — a thin circle of the thread's major diameter where the thread starts, and in a [section view](section-view) the lines along it;
- in [drawings](drawings), ISO 6410: a view from the hole's mouth shows a thin three-quarter circle of the major diameter, side views — hidden thin lines along the thread and across its end (when hidden lines are on).

The thread starts below a counterbore or countersink. In a blind hole it goes as deep as **Tapped depth**, in a through hole — to where the hole leaves the material. The thread follows its part when [transformed](transform), is copied by patterns and [mirrors](mirror) of the hole or the part, and comes with the part into [Derived](derived).

> **Limitation.** Drawings do not get thread callouts (M8 ↧16) yet.

## See also {#see-also}

[Point](sketch-point), [Extrude](extrude) with the **Remove** operation, [Linear pattern](linear-pattern).
