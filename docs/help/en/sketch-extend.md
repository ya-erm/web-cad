# Extend

Extends a line or arc to the nearest curve it meets along its extension.

**Sketch toolbar:** **Extend**

```figure
image: ../images/sketch-extend-compare.svg
alt: A line extended to the nearest intersection
caption: 1 — choose the end of the short line facing the boundary. 2 — orange shows the added extension up to the intersection.
width: 600
```

## Steps {#steps}

1. Click **Extend**.
2. Hover over a line or arc closer to the end you want to extend — the curve and the resulting extension are highlighted.
3. Click. The end moves to the nearest intersection.

## Messages {#messages}

| Message | Cause |
|---|---|
| "Click near the end of a line or arc" | You clicked something other than a line or arc (for example, a circle or spline). |
| "This end is connected to another curve" | The end already coincides with another curve — break the connection first. |
| "There is nothing to extend to" | There are no other curves along the extension of the curve. |

## See also {#see-also}

[Trim](sketch-trim).
