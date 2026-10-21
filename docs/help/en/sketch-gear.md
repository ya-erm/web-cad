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

The next gear in the same sketch takes the parameters of the previous one — handy for a pair with the same module.

## Parameters {#parameters}

| Parameter | What it sets |
|---|---|
| **Number of teeth** | 6 to 400. |
| **Size by** | **Module** (m), **Outer diameter** (across the tooth tips, m·(z + 2)), or **Pitch diameter** (m·z). Switching it converts the value, so the gear stays the same (unless it is an expression with a variable). |
| **Module** / **Outer diameter** / **Pitch diameter** | The value of the chosen size. |
| **Pressure angle** | Usually 20° (10–35° allowed). |
| **Tooth rotation** | The direction of the first tooth from the sketch's X axis — to make the teeth of a pair mesh. |

Below the fields are the module and the diameters it gives: outer, pitch and root. If the gear cannot be made (fewer than 6 teeth, teeth coming to a point or meeting at the root), the reason is shown there, and the sketch gets a warning.

The proportions are standard: addendum m, dedendum 1.25 m. Below the base circle the tooth flanks go radially; undercut of gears with few teeth is not modelled.

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

## Details {#details}

- The teeth are derived geometry: a single curve cannot be changed or dimensioned. In 3D they can be selected by features that need curves.
- For a gear on a part (with a shaft, say), draw the sketch on its face and extrude with **Add**; a bore for the shaft is an ordinary circle in the same sketch inside the gear.
- Sketch [pattern](sketch-pattern) and [transform](sketch-transform) work with gears too.
- [Agent API](agent-api): the shape `{"type":"gear","teeth":"#z","outerDiameter":12}`.

## See also {#see-also}

[Sketch](sketch), [Extrude](extrude), [Variables](variables), [Configurations](configurations), [Mates: relations](assembly-motion#relations).
