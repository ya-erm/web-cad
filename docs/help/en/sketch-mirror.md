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

1. In select mode, select the entities you want to mirror.
2. Select the line to mirror about (usually a construction line) **last**.
3. Click **Sketch mirror**.

If no line is selected, or the line is not selected last, the message "Select entities and the mirror line (select the line last)" appears.

## Details {#details}

- The copies are linked to the originals by **Symmetric** constraints about the axis (circles also get **Equal**). If you change or move an original, its copy follows.
- The axis can be any sketch line; it is convenient to draw a construction line through the origin.

## See also {#see-also}

[Sketch patterns](sketch-pattern), [Mirror](mirror) — mirrors parts and features in 3D.
