# Feature dialogs

Each Part Studio feature is set up in a dialog that appears in the top-left corner of the graphics area. While the dialog is open, the result is recalculated and shown in the graphics area after every change.

```figure
image: ../images/feature-dialog-extrude.jpg
alt: The Extrude feature dialog and a preview of the result
width: 600
1 42% 5% Header: name, help, accept, cancel
2 42% 12.5% Operation type
3 42% 20% Selection field
4 42% 28% Option list
5 42% 34.5% Numeric field and direction flip
6 42% 45% Checkboxes for additional options
7 70% 70% Preview in the graphics area
```

1. The [header](#header) with the feature name and the **?**, ✓, and ✕ buttons.
2. The [operation type](#operation): **New**, **Add**, **Remove**, **Intersect**.
3. A [selection field](#selection-fields); here, a sketch region is selected.
4. An option list, for example **End type**.
5. A [numeric field](#numeric-fields) and the **Opposite direction** button.
6. Checkboxes that reveal additional options.
7. The preview: the selected region is highlighted in orange, and the resulting body is semi-transparent.

## How to open {#open}

- A toolbar button or a shortcut key (`Shift+E`, `Shift+W`, `Shift+F`).
- The **Search tools** field: type part of the name and press `Enter`.
- Double-click a feature in the [feature list](feature-list), or choose **Edit** in its context menu, to change an existing feature.

## Header {#header}

- The icon and the **feature name**; you can change the name right here.
- A rebuild indicator while the kernel computes the model.
- **?**: help for this feature (`F1` does the same).
- ✓ **Accept** (`Enter`): saves the feature.
- ✕ **Cancel** (`Esc`): closes without saving.

`Shift+Enter` (when the cursor is not in a text field) accepts the feature and immediately opens a new feature of the same type.

`F1` works anywhere in the dialog, including while the cursor is in an input field.

## Selection fields {#selection-fields}

A selection field collects geometry: sketch regions, faces, edges, vertices, parts, planes.

- The active field is highlighted. An empty field reads **Click to select** or **Select in the graphics area**. Click another field to make it active.
- Clicking a suitable entity in the graphics area adds it to the active field; clicking it again removes it. Unsuitable entities are not highlighted and cannot be selected.
- Single-entity fields (axis, plane, direction) replace the selection with each new click.
- Selected entities are shown as "chips". Hover over a chip to highlight the entity; the ✕ on a chip removes it. Many regions of the same sketch are collected into one "… × N" chip.
- If the field needs a part rather than a face, click any face or edge of that part.

### Preselection {#preselection}

If you select geometry **before** starting a feature, it goes straight into the first field: regions and planar faces into **Extrude**, **Revolve**, **Sweep**, **Loft**, **Thicken**; edges and faces into **Fillet** and **Chamfer**; faces into **Shell**; sketch points into **Hole**; parts into patterns, **Mirror**, **Boolean**, **Split**, **Transform**, **Delete part**.

## Numeric fields {#numeric-fields}

You can enter a number or an expression in any numeric field:

- `25`: in document units (in degrees for angles);
- `25 mm`, `1.5 in`, `30 deg`;
- `#width / 2 + 1 mm`: with [variables](variables).

An invalid expression is highlighted in red and is not applied. Hover over the field to see the evaluated value.

Change the number with the ▲▼ arrows at the field's right end (they show on hover) or the `↑` and `↓` keys. Holding a button repeats the step; with `Shift` the step is 10 times bigger, with `Alt` 10 times smaller. The step suits the unit: 1 mm, 0.1 cm or inch, 1°; a decimal number with no unit (0.5, say) moves by 0.1. An expression such as `#w / 2` is not stepped.

To set the main value faster, just start typing a number while no field has the focus: it goes into the dialog's first value field (an extrude's **Depth**); then press `Enter`.

The arrows button next to the field (**Opposite direction**) flips the direction.

## Operation type {#operation}

Features that create bodies (**Extrude**, **Revolve**, **Sweep**, **Loft**, **Thicken**) have an operation switch:

| Operation | Result |
|---|---|
| **New** | A new body (part), independent of existing ones. |
| **Add** | The body is merged with the parts it touches. If it touches none, a new part is created. |
| **Remove** | The body is subtracted from the parts. |
| **Intersect** | Only the part of the parts shared with the body remains. |

For **Add**, **Remove**, and **Intersect**, the **Merge with all** checkbox (on by default) applies the operation to all parts. Clear it to select the parts in the **Merge scope** field.

## Errors and warnings {#errors}

If a feature cannot be built with the current parameters, a red message appears at the bottom of the dialog (for example, "Fillet failed: radius may be too large"). Warnings are shown in yellow. You can save a feature with an error: in the feature list it is marked with a red dot, and the features below it are built without it.
