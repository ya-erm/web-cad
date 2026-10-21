# Text

Adds a line of text to a sketch. The outlines of its letters become ordinary sketch regions: [extrude](extrude) them into a label, a name plate or a stamp.

**Sketch toolbar:** **Text**

```figure
image: ../images/sketch-text-result.png
alt: A 70 × 22 mm plate with the raised word WebCAD
caption: A 70 × 22 × 3 mm plate. On its top face, a sketch with the text WebCAD in Inter SemiBold, 10 mm tall, extruded 1.5 mm with Add.
width: 600
```

## Steps {#steps}

1. In a sketch, click **Text**.
2. Click the start of the baseline — the lower left corner of the text box.
3. Click a second time above (or below) it: the vertical distance is the **height of the capital letters**. While you move the cursor, the box and the letters are shown.
4. The sketch dialog shows a **Text** section: the line's field (the cursor is already in it), **Font**, **Height** and **Width**. Type the line and press `Enter`.

## Fonts {#fonts}

| Font | What for |
|---|---|
| **Inter** | A plain sans serif (the default). |
| **Inter SemiBold** | Bolder strokes, easier to mill and print. |
| **JetBrains Mono** | Monospaced: every character equally wide, handy for numbers and codes. |

All three have Latin, Cyrillic, digits and signs. The fonts come with the app and work offline (SIL Open Font License).

## Position, size and rotation {#placement}

A text sits in a box (dash-dotted). Its corners are the text's points: the lower left is the start of the baseline, the upper left the top of the capitals, the right ones the end of the line. The sides of the box are construction lines of the sketch: [constraints](sketch-constraints) and [dimensions](sketch-dimensions) work on them as on any line. The box is always a rectangle exactly as wide as the line in its font, so its height and width go together: set one and the other follows from the font.

- **Size.** Select the text (click any letter or a side of its box): the sketch dialog shows **Height** and **Width**. A grey value follows from the font; a value you type becomes a sketch dimension (on the left side of the box or on its bottom) that sizes the text, and a dimension of the other side is removed. The [Dimension](dimension-distance) tool dimensions the sides too: the bottom side is the width of the text, the left side its height. A dimension of the other side made with it while one sizes the text becomes a reference dimension (grey, in parentheses): only one of them sizes the text.
- **Lining up with a line.** Select the bottom side of the box and a line, and click [Coincident](constraint-coincident) (`I`): the text stands on the line. [Parallel](constraint-parallel) turns the text along a line, [Horizontal](constraint-horizontal) and [Vertical](constraint-vertical) straighten it, a corner coincident with a point pins it down, and [Midpoint](constraint-midpoint) of a point and the bottom side puts the point under the middle of the line.
- **Dragging.** By its letters, the text moves whole. By a corner of its box, it turns and scales about the start of its baseline (by that corner itself, about the upper left one); when its constraints keep it from turning or scaling, it moves instead. By a side, it moves.
- **A new line or font** changes the width of the box from the start of the line, the height stays. When a dimension holds the width, the height changes instead: a longer line gets smaller, and its start stays where it is.

At the bottom of the **Text** section, a summary: the size of the box, the number of characters, whether the text is fully defined and what sets its size.

The box is shown only while the sketch is edited. Deleting a side of the box deletes the whole text; the sides are always construction lines — they cannot be trimmed, split, extended or filleted at a corner.

## Extruding the letters {#extrude}

- Every letter is a sketch region. Clicking the sketch in the feature list picks the letters without their counters (the inside of "O", "A", "R"), and the extrude makes a part of each letter.
- For lettering on a part, draw the sketch on its face and extrude the letters with **Add** (raised) or **Remove** (engraved).
- Text inside a closed outline (a rectangle, say) is cut right through that region.

## Details {#details}

- A text is one line; line breaks are not supported.
- The letters are derived geometry: a single curve of a letter cannot be changed, trimmed or dimensioned. It can be picked in 3D by features that take curves (paths, say).
- Sketch [patterns](sketch-pattern) and [transforms](sketch-transform) work on texts too. A mirror copy reads the same way as the text and stands in the mirror image of its box.
- A text made in an earlier version (with two points) builds as before and gets its box the first time the sketch is opened.

## See also {#see-also}

[Sketch](sketch), [Extrude](extrude), [Wrap](wrap).
