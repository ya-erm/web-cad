# Delete part

Removes parts from the model starting at this point in the history. It is a feature: the parts remain in the earlier steps, and you can undo the deletion by suppressing or deleting the feature.

**Toolbar:** **Delete part** · also the **Delete part** command in the context menu of the [Parts list](parts).

## Steps {#steps}

1. Click **Delete part**.
2. In the **Parts to delete** field, select parts.
3. Click ✓ (`Enter`).

> **Tip.** If you just want a part out of the way, hide it with the eye icon in the Parts list — this does not change the history.

| Action | What changes |
|---|---|
| **Hide** a part | Visibility only. Its geometry stays in the model and is available to later features. |
| **Delete part** | Adds a feature. The body is absent from that point onward; earlier steps stay intact. |
| **Delete** a feature in the feature list | Removes the construction step itself. Dependent features may fail. |
