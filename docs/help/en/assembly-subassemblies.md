# Sub-assemblies {#subassemblies}

[Assembly overview](assembly) · Nested assemblies, rigid and flexible modes.

An assembly can go into another one, as in Onshape: in the **Insert** dialog, pick it under **Assemblies** and click it. It becomes one instance — a **sub-assembly** with the assembly icon in the list:

- it moves, turns, is fixed and hidden as a whole; its parts keep the placement its own assembly gives them;
- picking any of its parts in the graphics area picks the whole sub-assembly for dragging, the [triad](assembly-movement#triad) and the position panel (in a [flexible](#flexible) sub-assembly, dragging moves the part itself); **Open sub-assembly** in its menu opens its tab;
- [mates](assembly-mates#mates) can use the faces, edges and mate connectors of its parts — the whole sub-assembly moves to satisfy them;
- when the assembly inside changes (its parts, mates or placements), every assembly that uses it follows.

An assembly cannot contain itself: the dialog does not offer assemblies that already contain the current one.

```figure
image: ../images/assembly-subassembly.jpg
alt: Product contains an expanded Module sub-assembly with Base, Handle and its mate
caption: Module contains Base and Handle. In flexible mode the expanded tree also lists its internal mate Handle rotation. Hovering over Module highlights the whole unit; edit its mates on the Mechanism tab.
width: 1100
```

## Flexible sub-assembly {#flexible}

A sub-assembly is rigid by default: its parts do not move relative to each other. To let its mechanism work in the parent assembly too, right-click the sub-assembly in the **Instances** list and choose **Make flexible** (Onshape's **Make flexible**). The row gets the flexible icon, and then:

- its parts move in the parent assembly as **its own** mates, groups and relations allow: [dragging](assembly-movement#drag) a part moves only that part (and what is mated to it), and the parent's mates pull its parts along their free degrees of freedom;
- a click on one of its parts picks the part itself: it gets its own [triad](assembly-movement#triad), and the [position panel](assembly-instances#position) shows where it stands in the parent assembly (a typed value acts like a drag; fixing is set in the sub-assembly itself);
- the parts fixed inside it are its base: they stay together where the sub-assembly places them; dragging the sub-assembly itself or its [triad](assembly-movement#triad) moves it as a whole;
- where its parts stand is kept in the parent assembly — the assembly inside and its other instances do not change;
- a fixed flexible sub-assembly with nothing fixed inside it is held by its first part.

**Make rigid** in the same menu puts the parts back where the sub-assembly places them.

**What is inside.** The arrow at the left of a sub-assembly in the **Instances** list opens it: its parts and nested sub-assemblies (which open in turn), and for a flexible one also its mates. A click on a row picks the part; on a mate — its two parts. A mate that cannot be satisfied in the parent assembly (say, a parent mate holds the part where the sub-assembly does not let it go) gets a warning icon, and so does the row of the sub-assembly itself. The mates and relations of a sub-assembly are edited in its own tab (**Open sub-assembly**).
