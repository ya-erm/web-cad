# Instances and fixing

[Assembly overview](assembly) · Selection, properties, configurations and fixing parts.

## Inserting parts {#insert}

1. Click **Insert** (`I`) on the assembly tab.
2. Choose a Part Studio on the left and click a part on the right. Repeat to insert more parts; **Insert all parts** adds the whole list.
3. Close the insertion dialog.

```figure
image: ../images/assembly-insert.jpg
alt: Insert parts dialog: Part Studio on the left, Base and Handle on the right
caption: Choose the Part Studio on the left, then a part on the right. Clicking a part inserts an instance; Insert all parts inserts the whole list. Close the dialog when finished.
width: 600
```

## Instances {#instances}

The **Instances** list on the left shows all instances; their names are the part name with a number: "Part 1 <1>", "Part 1 <2>".

- **Select:** click a row in the list or the part in the graphics area; `Shift` adds to the selection.
- **Rename:** double-click the name or choose **Rename** in the menu (right-click).
- **Hide / Show:** the eye icon in the row or the menu item.
- **Edit source Part Studio:** the menu item switches to the tab where the part is built.
- **Delete:** the trash button in the toolbar, the `Del` key or the menu item.

If the part was deleted from its Part Studio (or the Part Studio itself was deleted), its instance stays in the list with a warning icon and is not shown.

## Instance position {#position}

Select one instance — a panel with its placement appears on the left:

| Field | Description |
|---|---|
| **Position X, Y, Z** | The instance offset in document units. |
| **Rotation about axes X, Y, Z** | Angles in degrees; the rotation is about the X, then Y, then Z axes through the part's origin. |
| **Fixed** | Prevents moving the instance. |

Type a value and press `Enter` (or move to another field). Each change can be undone with `Ctrl+Z`.

When the instance's Part Studio has a [configuration](configurations), the panel has a **Configuration** section: each input has a list — **As in the Part Studio (…)** (the option chosen in the Part Studio itself) or the instance's own option. The instance is rebuilt in the chosen variant, and mates are solved again on its new geometry.

```figure
image: ../images/assembly-position.jpg
alt: Handle selected: position panel on the left and a triad on the instance
caption: Select one instance to see its position, rotation and Fixed checkbox. Base is fixed; Handle can rotate as its mate allows. Coordinates are relative to the source part geometry, so X = −80 mm compensates for its position in the Part Studio.
width: 1100
```

## Fix {#fix}

**Fix instance** (the lock button in the toolbar or the menu item) fixes the selected instances: their placement cannot change until the instance is released (**Unfix**) — neither from the position panel nor by [dragging](assembly-movement#drag). A lock icon is shown in the list row, and the open-hand cursor does not appear over a fixed instance. Usually the base of the product, which the other parts attach to, is fixed.
