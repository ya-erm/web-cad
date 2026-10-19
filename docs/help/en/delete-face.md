# Delete face

A direct edit, like Onshape's Delete face with Heal: the selected faces are removed and the faces around them close the gap. Use it to strip unwanted details from imported parts or to simplify a part: fill holes, take off fillets and chamfers, cut off bosses.

**Toolbar:** **Delete face**

## Steps {#steps}

1. Select faces and click **Delete face** (or click the button and select the faces).
2. Click ✓ (`Enter`).

## What can be deleted {#what}

| Selection | Result |
|---|---|
| All the faces of a **hole** or **pocket** (a through hole — its cylinder; a blind one — the cylinder and the cone at its bottom) | The hole is filled with material. |
| All the faces of a **boss** (its sides and top) | The boss is cut off down to the face it stands on. |
| A **fillet** or **chamfer** between planar faces | The planar faces around it extend to a sharp edge — for a convex edge (the material comes back) and for a concave one (the material goes). |

The boundary of the selected faces must close in loops over the faces around it (as a hole's does on a top face), or all the faces around must be planar (as a fillet's are). When a surface is split into several faces (a fillet after its top face was [offset](move-face), say), one of them is enough: the other pieces of that surface go with it.

## Errors {#errors}

| Message | What happened |
|---|---|
| **The faces around the selected ones cannot close the gap** | Only part of a feature is selected (say, one wall of a pocket) or the faces around are not planar. Select the whole hole, pocket or boss. |
| **These faces cannot be healed** | For one, a single planar face of a block is selected: there is nothing to extend. To move such a face, use [Move face](move-face). |

## Without healing {#no-heal}

Clear **Heal** and the selected faces simply go: the part becomes a [surface](offset-surface#surfaces) of the faces left (as Delete face without Heal in Onshape). That opens a part up, say, to build on its faces and [thicken](thicken) the shell afterwards.

## See also {#see-also}

[Move face](move-face), [Replace face](replace-face), [Fillet](fillet).
