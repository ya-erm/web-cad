# Exploded views {#exploded}

[Assembly overview](assembly) · Exploding parts step by step and displaying explode lines.

An exploded view moves instances apart to show how the product goes together, as in Onshape. It is only shown: the placements of the instances do not change.

1. Click **+** in the **Exploded views** list (under the mates). The new view opens.
2. Select the instances to move (in the graphics area or in the list with `Shift`).
3. Choose the **Direction** (±X, ±Y, ±Z of the assembly) and the **Distance**, then click **Add step**.
4. Repeat for the other instances: the steps go one after another.

A step can also be dragged: select instances in the open view — a [triad](assembly-movement#triad) appears at their center. Drag an arrow to move them along it, an arc to turn them about its axis through the triad center, or the ball to move them freely in the screen plane; when you release the button, the step joins the view.

Dashed **explode lines** run from where each part stands in the assembly to where the view shows it.

The **Explode** slider runs the steps in order from 0% (all together) to 100% (fully exploded). Delete a step with its trash button. Click ✓ or press `Esc` to close the view — the assembly is shown as it is; a click on the view in the list opens it again. While a view is open, instances are not dragged and the position panel is hidden.

## Example: lift the handle from the base {#example}

```figure
image: ../images/assembly-exploded.jpg
alt: Handle lifted from the base by a single +Z 30 mm step
caption: Select Handle <1>, add a +Z 30 mm step, and move the slider to 100%. The dashed line leads to its original position. At 0% the parts meet again; closing the view leaves assembly placements unchanged.
width: 900
```
