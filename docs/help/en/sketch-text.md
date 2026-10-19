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
4. The sketch dialog shows the **Text** field (the cursor is already in it) and **Font**. Type the line and press `Enter`.

## Fonts {#fonts}

| Font | What for |
|---|---|
| **Inter** | A plain sans serif (the default). |
| **Inter SemiBold** | Bolder strokes, easier to mill and print. |
| **JetBrains Mono** | Monospaced: every character equally wide, handy for numbers and codes. |

All three have Latin, Cyrillic, digits and signs. The fonts come with the app and work offline (SIL Open Font License).

## Position, size and rotation {#placement}

A text has two points of its own: the start of its baseline and the top of its box's left side. The distance between them is the height of the capitals, and the line runs square to that side, to its right.

- Drag the text by its letters to move it whole. Drag the top point to turn and scale it.
- A **Distance** [dimension](sketch-dimensions) between the two points sets the letter height; [coincident and vertical constraints](sketch-constraints) pin the text down and straighten it.
- To change the line or the font, select the text (click any letter): **Text** and **Font** appear in the sketch dialog.

The text box (dashed) is shown only while the sketch is edited.

## Extruding the letters {#extrude}

- Every letter is a sketch region. Clicking the sketch in the feature list picks the letters without their counters (the inside of "O", "A", "R"), and the extrude makes a part of each letter.
- For lettering on a part, draw the sketch on its face and extrude the letters with **Add** (raised) or **Remove** (engraved).
- Text inside a closed outline (a rectangle, say) is cut right through that region.

## Details {#details}

- A text is one line; line breaks are not supported.
- The letters are derived geometry: a single curve of a letter cannot be changed, trimmed or dimensioned. It can be picked in 3D by features that take curves (paths, say).
- Sketch [patterns](sketch-pattern) and [transforms](sketch-transform) work on texts too.

## See also {#see-also}

[Sketch](sketch), [Extrude](extrude), [Wrap](wrap).
