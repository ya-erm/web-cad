# Spur gear

Draws a spur gear with involute teeth in a sketch (like Spur gear in Onshape). One tooth is built from the involute formulas and repeated around the centre in a circular pattern. The result is an ordinary sketch region: [extrude](extrude) it by the gear's width to get a part.

**Sketch toolbar:** **Spur gear**

```figure
image: ../images/sketch-gear.jpg
alt: A 12-tooth gear 12 mm across, extruded 6 mm; the variable #z and the configuration "Зубья" set the number of teeth
caption: A gear in a sketch: #z teeth, outer diameter #d, extruded by #w. The configuration switches #z between 12 and 24.
width: 600
```

## Steps {#steps}

1. In a sketch, click **Spur gear**. The gear follows the cursor.
2. Click the gear's centre — for example, the origin (the centre snaps to it).
3. The gear is selected, and its parameters appear in the sketch dialog. Set the number of teeth and the size.
4. Finish the sketch and [extrude](extrude) the gear's region by its width.

The next gear in the same sketch takes the parameters of the previous one (the same module and backlash) and meshes with it at once: its teeth go into the first one's gaps. All that is left is the [centre distance](#pair).

## Parameters {#parameters}

| Parameter | What it sets |
|---|---|
| **Number of teeth** | 6 to 400. |
| **Size by** | **Module** (m), **Outer diameter** (across the tooth tips, m·(z + 2)), or **Pitch diameter** (m·z). Switching it converts the value, so the gear stays the same (unless it is an expression with a variable). |
| **Module** / **Outer diameter** / **Pitch diameter** | The value of the chosen size. |
| **Pressure angle** | Usually 20° (10–35° allowed). |
| **Backlash** | The play of a pair at the pitch circle: each tooth is thinner by half of it, so two gears with a backlash of 0.2 mm give the pair 0.2 mm of play. The default is 0: the profiles of a pair touch on both sides. For 3D printing, 0.1–0.3 mm is usual. |
| **Mesh with** | The gear of this sketch this one meshes with (their numbers are in the dialog's title). The tooth rotation is then worked out by itself. |
| **Tooth rotation** | The direction of the first tooth from the sketch's X axis. With **Mesh with** set, the field is grey: the rotation that puts the teeth in the pair's gaps comes from where the centres are and how the other gear is turned, and follows them. |

Below the fields are the module and the diameters it gives: outer, pitch and root. If the gear cannot be made (fewer than 6 teeth, teeth coming to a point or meeting at the root, too much backlash), the reason is shown there, and the sketch gets a warning.

The proportions are standard: addendum m, dedendum 1.25 m. Below the base circle the tooth flanks go radially; undercut of gears with few teeth is not modelled. So with a gear of fewer than ~17 teeth, the tip of its pair grazes its flank near the root as they roll — by thousandths of a millimetre.

## Variables and configurations {#variables}

All parameters are expressions, and they stay linked to [variables](variables). For example:

- **Number of teeth** `#z`, **Outer diameter** `#d`, an extrude by `#w`. Change `#z` from 12 to 20 and the gear is rebuilt with 20 teeth of the same diameter.
- A [configuration](configurations) with options "12" and "24" that sets `#z` switches the gear from one list.

## Placement {#placement}

- The gear's centre is a sketch point. [Constraints](sketch-constraints) and [dimensions](sketch-dimensions) apply to it: coincident with the origin, a distance to another gear (the centre distance of a pair is (z₁ + z₂)·m / 2).
- Drag the gear by its teeth to move it as a whole.
- The pitch circle is shown dash-dotted — handy for bringing a pair of gears together.
- The gear's size shows in the sketch as a diameter dimension: **Ø** of the outer diameter (its arrow on a tooth tip) or of the pitch diameter (its arrow on the dash-dotted circle in a gap), whichever sets the size. When the module sets it, the pitch diameter is shown grey in parentheses. A size given by an expression (`#d`) is marked **fx**. A click on the dimension selects the gear; a double-click puts the cursor in the size field of the sketch dialog.
- A bare number in the size and angle fields gets its unit when you leave the field: `12` → `12 mm`, `20` → `20 deg`.

## A pair of gears {#pair}

For a pair of gears to mesh without jamming:

1. **The same module and the same pressure angle.** Gears of different modules do not mesh — their teeth are spaced differently. For example, 12 teeth 12 mm across the tips is a module of 12 / 14 ≈ 0.857, not 1. The simplest is to size both by **Module**; the bottom of the dialog shows a gear's module. If the modules of a pair differ, the dialog warns about it.
2. **The centre distance** (z₁ + z₂)·m / 2 as the dimension between the centres. For 12 and 20 teeth of module 1 it is 16 mm: the pitch circles touch. For a gear with **Mesh with** set, the dialog shows the centre distance there is and the one needed, and **Set** puts a dimension between the centres (or changes the one there is). If the centres are closer than needed, the teeth jam — the line turns red.
3. **Tooth rotation**: a tooth of one gear must face a gap of the other. With **Mesh with** it happens by itself. By hand: with the centres on the X axis and the first gear's rotation 0°, the second one's is 180° + 180°/z₂ (for 20 teeth, 189° — the same as 9°).
4. **Backlash**: without it, the profiles of a pair touch on both sides, and printed gears are likely to jam. Give both the same **Backlash**, 0.2 mm for example.

Chains work too: a third gear can mesh with the second one, and the copies of a gear set around a central one by a [circular pattern](sketch-pattern) (planets) each mesh with it where they are. A pair copied stays a pair.

## Details {#details}

- The teeth are derived geometry: a single curve cannot be changed or dimensioned. In 3D they can be selected by features that need curves.
- For a gear on a part (with a shaft, say), draw the sketch on its face and extrude with **Add**; a bore for the shaft is an ordinary circle in the same sketch inside the gear.
- Sketch [pattern](sketch-pattern) and [transform](sketch-transform) work with gears too.
- [Agent API](agent-api): the shape `{"type":"gear","teeth":"#z","outerDiameter":12}`; backlash — `"backlash":0.2`, meshing with the sketch's previous gear — `"mesh":true`.

## See also {#see-also}

[Sketch](sketch), [Extrude](extrude), [Variables](variables), [Configurations](configurations), [Mates: relations](assembly-motion#relations).
