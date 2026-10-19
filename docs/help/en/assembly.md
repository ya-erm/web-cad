# Assembly

The **Assembly** tab puts a product together from parts built in Part Studios. Each inserted part is an **instance**: a reference to a Part Studio part with its own placement. You can insert one part several times; when the part changes in its Part Studio, all of its instances update.

## Help topics {#topics}

| Topic | What it covers |
|---|---|
| [Instances and fixing](assembly-instances) | Selection, properties, configurations and fixing parts. |
| [Moving instances and the triad](assembly-movement) | Dragging, precise translations and rotations. |
| [Mates](assembly-mates) | Mate connector selection, mate types and limits. |
| [Sub-assemblies](assembly-subassemblies) | Nested assemblies, rigid and flexible modes. |
| [Motion, groups and relations](assembly-motion) | Mechanism animation, rigid groups and coupled motion. |
| [Exploded views](assembly-exploded) | Exploding parts step by step and displaying explode lines. |
| [Bill of materials](assembly-bom) | Product structure, quantities, part properties and CSV. |

## Creating an assembly {#create}

1. Click **+** in the bottom bar and choose **Assembly**. A tab with an empty **Instances** list appears.
2. Click **Insert** in the toolbar (`I`).
3. On the left of the dialog choose a Part Studio, on the right click a part — it appears in the assembly. **Insert all parts** inserts every part of the selected Part Studio at once.

The first instance of a part goes where the part is in its Part Studio. Further instances are placed to the right of the ones already inserted so that they do not overlap.

```figure
image: ../images/assembly-overview.jpg
alt: Base and pin assembly with a revolute mate
caption: Base <1> is fixed (the lock in its row). Pin <1> sits in the bore and is connected to the base by the revolute mate Pin rotation.
width: 900
```

## Export {#export}

**Export** in the top-right corner writes the assembly to STEP, STL, OBJ or 3MF — the selected instances or all shown ones, where they stand. See [Exporting an assembly](import-export#export-assembly).
