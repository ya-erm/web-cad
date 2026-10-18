# Boolean

Unites, subtracts or intersects existing parts.

**Toolbar:** **Boolean**

| Before subtraction | After subtraction |
|---|---|
| ![An orange cylinder tool intersects a blue target plate](../images/boolean-before.png) | ![A circular through hole remains in the plate and the cylinder is removed](../images/boolean-after.png) |

The **Target** is the plate and the **Tool** is a 14 mm diameter cylinder. **Keep tools** is off.

## Steps {#steps}

1. Click **Boolean** and choose the type: **Union**, **Subtract** or **Intersect**.
2. In the **Tools** field, select parts.
3. For **Subtract**, click the **Targets** field and select the parts to subtract from.
4. Click ✓ (`Enter`).

## Options {#options}

| Type | Result |
|---|---|
| **Union** | All **Tools** (at least two) merge into one part — the first one selected. |
| **Subtract** | The **Tools** are subtracted from each part in **Targets**. The tools are deleted unless the **Keep tools** checkbox is on. |
| **Intersect** | Only the common volume of the **Tools** (at least two) remains — in the first part; if there is no common volume, the message "Parts do not intersect" appears. |

> **Tip.** If a body is created by a feature, it is easier to choose the **Add**, **Remove** or **Intersect** operation right in that feature — see [Feature dialogs](feature-dialogs#operation).
