# Sketch mirror

Creates mirrored copies of sketch entities about a line.

**Sketch toolbar:** **Sketch mirror**

```figure
image: ../images/sketch-mirror-steps.svg
alt: A profile and its mirrored copy about a vertical axis
caption: Select the source profile first (1), then select the axis line last (2). Orange shows the new copy; the axis itself is not copied.
width: 600
```

## Steps {#steps}

The tool works in two ways.

**The tool first, then the line and the entities** (as in Onshape):

1. With nothing selected, click **Sketch mirror**: the button stays pressed and the status bar tells you what to pick.
2. Click the line to mirror about (usually a construction line). It stays selected.
3. Click entities: each one is mirrored at once, and the tool waits for the next. Clicking an entity already mirrored, or a copy, adds nothing.
4. Press `Esc` (or the button again) to finish.

If entities are selected without a line when you click the button, they are mirrored as soon as you click the line; if only a line is selected, it becomes the axis right away.

**The selection first, then the tool:**

1. In select mode, select the entities you want to mirror.
2. Select the line to mirror about **last**.
3. Click **Sketch mirror**: the copies appear at once.

## Details {#details}

- The copies are linked to the originals by **Symmetric** constraints about the axis (circles also get **Equal**). If you change or move an original, its copy follows.
- The axis can be any sketch line; it is convenient to draw a construction line through the origin.

## See also {#see-also}

[Sketch patterns](sketch-pattern), [Mirror](mirror) — mirrors parts and features in 3D.
