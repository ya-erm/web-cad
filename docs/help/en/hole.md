# Hole

Creates drilled holes — simple, counterbored or countersunk — at sketch points.

**Toolbar:** **Hole**

## Steps {#steps}

1. Draw a sketch on a part face and place [points](sketch-point) at the centers of the future holes.
2. Click **Hole**.
3. Choose the **Hole style**: **Simple**, **Counterbore**, **Countersink** or **Counterbore and countersink**.
4. Select sketch points (or circular edges — then the hole is placed at their center).
5. Choose the **Termination** and set the **Diameter** and the other dimensions — or choose **Standard: ISO** and the fastener size, see [below](#standard). Click ✓ (`Enter`).

The hole starts at the sketch plane and goes into the material — opposite to the sketch plane normal (for a circular edge — along its axis).

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
| **Sketch points to place holes** | Sketch points or circular edges. |
| **Termination** | **Blind** or **Through all**. |
| **Diameter** | Hole diameter (default 5 mm). |
| **Depth** | For **Blind** (default 10 mm). |
| **Tip angle** | The cone at the bottom of a blind hole (default 118°, like a drill bit). |
| **Counterbore diameter**, **Counterbore depth** | For **Counterbore** and **Counterbore and countersink** (default 9 and 4 mm). The counterbore diameter must be larger than the hole diameter. |
| **Countersink diameter**, **Countersink angle** | For **Countersink** and **Counterbore and countersink** (default 10 mm and 90°). With both, the countersink is wider than the counterbore and ends above its floor. |
| **Standard** | **Custom** — the sizes from the fields above; **ISO** — from the standards' tables, see [below](#standard). |
| **Tapped depth** | For a **Blind** tapped hole: how deep the thread goes (no deeper than the hole). |
| **Merge with all** / **Merge scope** | The parts to cut the holes from: all parts or only the selected ones. |

## ISO standard holes {#standard}

With **Standard: ISO** the sizes come from the tables for metric fasteners M1.6–M64: the diameter fields are hidden and the resulting sizes are shown under the choices.

- **Type: Clearance** — a hole for a screw to pass, ISO 273. **Fit**: **Close**, **Normal** or **Loose** (fine / medium / coarse), e.g. for M6 — 6.4 / 6.6 / 7 mm.
- **Type: Tapped** — a hole for a tap (the drill by ISO 2306, for M6 — 5 mm) with a [cosmetic thread](#thread). **Pitch**: coarse (the default) or one of the fine ones of ISO 261; a fine pitch drills the major diameter minus the pitch and is designated M8×1.
- **Counterbore** — a counterbore for an ISO 4762 socket head cap screw (by DIN 974-1), **Countersink** — a 90° countersink for an ISO 10642 countersunk screw, **Counterbore and countersink** — that counterbore with a 0.5 mm × 45° chamfer at its mouth.
- Choosing a size sets the depths as Onshape does: the thread 2 diameters deep, the hole 3 pitches deeper. You can change them.

## Cosmetic thread {#thread}

A tapped hole's thread is not modelled (the hole has the drill's diameter) but shown by convention, as in Onshape:

- in the graphics area — a thin circle of the thread's major diameter where the thread starts, and in a [section view](section-view) the lines along it;
- in [drawings](drawings), ISO 6410: a view from the hole's mouth shows a thin three-quarter circle of the major diameter, side views — hidden thin lines along the thread and across its end (when hidden lines are on).

The thread starts below a counterbore or countersink. In a blind hole it goes as deep as **Tapped depth**, in a through hole — to where the hole leaves the material. The thread follows its part when [transformed](transform), is copied by patterns and [mirrors](mirror) of the hole or the part, and comes with the part into [Derived](derived).

> **Limitation.** Only the ISO metric standard (no ANSI / inch). Drawings do not get thread callouts (M8 ↧16) yet.

## See also {#see-also}

[Point](sketch-point), [Extrude](extrude) with the **Remove** operation, [Linear pattern](linear-pattern).
