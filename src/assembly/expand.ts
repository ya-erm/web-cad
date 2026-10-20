// Sub-assemblies (Onshape): an instance of another assembly. For solving, showing and exporting it is unfolded
// into its parts — "leaves" with ids `X/inner` placed in the parent — held rigidly as the sub-assembly places them.

import type { AssemblyGroup, AssemblyInstance, AssemblyTab, Vec3 } from '../core/types';
import type { StepAssembly, StepComponent } from '../kernel/protocol';
import { placementOf, rotationAngles, sourceKey, type AssemblySources, type Placement } from './compose';

/** The top-level instance a (leaf) instance id belongs to. */
export const topInstance = (id: string) => {
  const i = id.indexOf('/');
  return i < 0 ? id : id.slice(0, i);
};

export const hasSubassemblies = (tab: AssemblyTab) => tab.instances.some((i) => i.assemblyId);

/**
 * What picking part `partId` (`X/inner` in a sub-assembly) moves, places and shows the triad of (Onshape): the
 * part itself in a flexible sub-assembly, otherwise the top-level instance (a rigid sub-assembly as a whole).
 */
export const unitOf = (tab: AssemblyTab, partId: string) => (tab.instances.find((i) => i.id === topInstance(partId))?.flexible ? partId : topInstance(partId));

const mul = (A: number[], B: number[]) => {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
};
const mulVec = (A: number[], v: Vec3): Vec3 => [0, 1, 2].map((i) => A[i * 3] * v[0] + A[i * 3 + 1] * v[1] + A[i * 3 + 2] * v[2]) as Vec3;
const transpose = (A: number[]) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
/** a ∘ b: first b, then a. */
const compose = (a: Placement, b: Placement): Placement => {
  const t = mulVec(a.R, b.t);
  return { R: mul(a.R, b.R), t: [t[0] + a.t[0], t[1] + a.t[1], t[2] + a.t[2]] };
};
const round = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
const stored = (p: Placement) => ({ position: p.t.map(round) as Vec3, rotation: rotationAngles(p.R) });

/**
 * The parts of a sub-assembly instance (recursively), placed in the parent: ids `X/inner`, names `X / inner`;
 * fixed and hidden with X. Empty when the sub-assembly is gone or would contain itself.
 */
export function leavesOf(inst: AssemblyInstance, sources: AssemblySources, seen: string[] = []): AssemblyInstance[] {
  const sub = inst.assemblyId ? sources.get(inst.assemblyId)?.assembly : undefined;
  if (!sub || seen.includes(sub.id)) return [];
  const P = placementOf(inst);
  // a flexible sub-assembly keeps where its parts stand in this assembly (in its own coordinates)
  const flex = inst.flexible ? inst.flex : undefined;
  const leaves = sub.instances
    .flatMap((child) => (child.assemblyId ? leavesOf(child, sources, [...seen, sub.id]) : [child]))
    .map((leaf) => ({
      ...leaf,
      id: `${inst.id}/${leaf.id}`,
      name: `${inst.name} / ${leaf.name}`,
      ...stored(compose(P, placementOf(flex?.[leaf.id] ?? leaf))),
      // flexible: its own fixed parts stay put when it is fixed; rigid: all of it is fixed with it
      fixed: inst.flexible ? !!inst.fixed && !!leaf.fixed : inst.fixed,
      hidden: inst.hidden || leaf.hidden,
    }));
  // fixed and flexible with nothing fixed inside it: its first part holds it
  if (inst.flexible && inst.fixed && leaves[0] && !leaves.some((l) => l.fixed)) leaves[0].fixed = true;
  return leaves;
}

/** The ids of a flexible sub-assembly's parts that stay put in it (its ground: those fixed when it is fixed). */
const groundOf = (x: AssemblyInstance, sources: AssemblySources) =>
  leavesOf({ ...x, fixed: true }, sources)
    .filter((l) => l.fixed)
    .map((l) => l.id);

/** The leaves of a sub-assembly instance as it places them (the instance at the origin). */
const innerLeaves = (x: AssemblyInstance, sources: AssemblySources) => leavesOf({ ...x, position: [0, 0, 0], rotation: [0, 0, 0] }, sources);

/** A rigid group of leaves (with their current placements). */
const rigid = (id: string, leaves: AssemblyInstance[]): AssemblyGroup => ({ id, name: id, members: leaves.map((l) => ({ instance: l.id, position: l.position, rotation: l.rotation })) });

/**
 * The assembly with its sub-assembly instances unfolded into their parts: a rigid group holds each rigid
 * sub-assembly's parts; a flexible one brings its own mates, groups and relations (ids `X/…`) and holds only
 * its fixed parts together. Groups and exploded view steps that name a sub-assembly name its parts instead.
 */
export function expandAssembly(tab: AssemblyTab, sources: AssemblySources): AssemblyTab {
  if (!hasSubassemblies(tab)) return tab;
  const subs = new Map(tab.instances.filter((i) => i.assemblyId).map((i) => [i.id, innerLeaves(i, sources)] as const));
  const groups: AssemblyGroup[] = (tab.groups ?? []).map((g) => ({
    ...g,
    members: g.members.flatMap((m) => {
      const inner = subs.get(m.instance);
      if (!inner) return [m];
      const G = placementOf(m);
      return inner.map((l) => ({ instance: l.id, ...stored(compose(G, placementOf(l))) }));
    }),
  }));
  const mates = [...(tab.mates ?? [])];
  const relations = [...(tab.relations ?? [])];
  const flat = tab.instances.flatMap((i) => (i.assemblyId ? leavesOf(i, sources) : [i]));
  /**
   * Hold a sub-assembly's parts (ids `pre/…`) as it moves them: rigidly, or by its own mates if it is flexible
   * (they come with ids `pre/…` and names "`label` / …").
   */
  const hold = (x: AssemblyInstance, pre: string, label: string) => {
    const leaves = flat.filter((l) => l.id.startsWith(`${pre}/`));
    const sub = sources.get(x.assemblyId!)?.assembly;
    if (!x.flexible || !sub) {
      if (leaves.length > 1) groups.push(rigid(`sub:${pre}`, leaves));
      return;
    }
    // flexible: its mates, groups and relations act here, on its parts
    const p = (id: string) => `${pre}/${id}`;
    const named = <T extends { id: string; name: string }>(v: T): T => ({ ...v, id: p(v.id), name: `${label} / ${v.name}` });
    const end = <E extends { instance: string } | undefined>(e: E): E => (e ? { ...e, instance: p(e.instance) } : e);
    for (const m of sub.mates ?? []) if (!m.suppressed) mates.push({ ...named(m), a: end(m.a), b: end(m.b), a2: end(m.a2), b2: end(m.b2) });
    for (const g of sub.groups ?? []) if (!g.suppressed) groups.push({ ...named(g), members: g.members.map((m) => ({ ...m, instance: p(m.instance) })) });
    for (const r of sub.relations ?? []) if (!r.suppressed) relations.push({ ...named(r), a: p(r.a), b: p(r.b) });
    // its ground moves as one; the sub-assemblies inside it hold their own parts
    const ground = groundOf({ ...x, id: pre }, sources);
    if (ground.length > 1) groups.push(rigid(`sub:${pre}`, leaves.filter((l) => ground.includes(l.id))));
    for (const c of sub.instances) if (c.assemblyId) hold(c, p(c.id), `${label} / ${c.name}`);
  };
  for (const x of tab.instances) if (x.assemblyId) hold(x, x.id, x.name);
  const leafIds = (ids: string[]) => ids.flatMap((id) => subs.get(id)?.map((l) => l.id) ?? [id]);
  return {
    ...tab,
    instances: flat,
    groups,
    mates,
    relations,
    explodedViews: tab.explodedViews?.map((v) => ({ ...v, steps: v.steps.map((s) => ({ ...s, instances: leafIds(s.instances) })) })),
  };
}

/** An instance by id, a leaf of a sub-assembly (`X/inner`) included, placed in the assembly. */
export function findInstance(tab: AssemblyTab, sources: AssemblySources, id: string): AssemblyInstance | undefined {
  const top = tab.instances.find((i) => i.id === topInstance(id));
  if (!top || top.id === id) return top;
  return leavesOf(top, sources).find((l) => l.id === id);
}

export type Moved = { position: Vec3; rotation: Vec3; flex?: AssemblyInstance['flex'] };

/**
 * Placements of the top-level instances from those solved for the leaves: a rigid sub-assembly by its first
 * part; a flexible one stays where it is and keeps where each of its parts now stands (`flex`).
 */
export function foldPlacements(tab: AssemblyTab, sources: AssemblySources, moved: Map<string, Moved>): Map<string, Moved> {
  const out = new Map<string, Moved>();
  for (const i of tab.instances) {
    if (!i.assemblyId) {
      const m = moved.get(i.id);
      if (m) out.set(i.id, m);
      continue;
    }
    if (i.flexible) {
      const P = placementOf(i);
      const RT = transpose(P.R);
      const flex: NonNullable<AssemblyInstance['flex']> = { ...i.flex };
      let any = false;
      for (const l of leavesOf(i, sources)) {
        const m = moved.get(l.id);
        if (!m) continue;
        // in the sub-assembly's coordinates: P⁻¹ ∘ W
        const W = placementOf(m);
        const t = mulVec(RT, [W.t[0] - P.t[0], W.t[1] - P.t[1], W.t[2] - P.t[2]]);
        flex[l.id.slice(i.id.length + 1)] = stored({ R: mul(RT, W.R), t });
        any = true;
      }
      if (any) out.set(i.id, { position: i.position, rotation: i.rotation, flex });
      continue;
    }
    const first = innerLeaves(i, sources)[0];
    const f = first && moved.get(first.id);
    if (!f) continue;
    // F = P_X ∘ P_L  →  P_X = F ∘ P_L⁻¹
    const F = placementOf(f);
    const L = placementOf(first);
    const R = mul(F.R, transpose(L.R));
    const t = mulVec(R, L.t);
    out.set(i.id, stored({ R, t: [F.t[0] - t[0], F.t[1] - t[1], F.t[2] - t[2]] }));
  }
  return out;
}

/**
 * What an assembly is made of, through its sub-assemblies: the Part Studios of its parts and the sub-assembly
 * tabs — the deepest first, so each one can be solved before the assemblies that use it.
 */
/**
 * An assembly's parts as a drawing shows it: its shown instances with sub-assemblies unfolded (ids `X/inner`), where
 * the assemblies store them (as last solved).
 */
export function shownParts(tabs: { id: string; type: string }[], asm: AssemblyTab): AssemblyInstance[] {
  const sources: AssemblySources = new Map();
  for (const sub of usedTabs(tabs, asm).subs) sources.set(sub.id, { parts: new Map(), mates: [], assembly: sub });
  return expandAssembly(asm, sources).instances.filter((i) => !i.hidden && !i.assemblyId);
}

export function usedTabs(
  tabs: { id: string; type: string }[],
  asm: AssemblyTab,
): { studios: string[]; subs: AssemblyTab[]; variants: { studioId: string; configuration: Record<string, string> }[] } {
  const studios = new Set<string>();
  const subs: AssemblyTab[] = [];
  /** Part Studios as instances with configuration options of their own build them (one per source key). */
  const variants: { studioId: string; configuration: Record<string, string> }[] = [];
  const walk = (a: AssemblyTab, path: string[]) => {
    for (const i of a.instances) {
      if (!i.assemblyId) {
        studios.add(i.studioId);
        if (i.configuration && Object.keys(i.configuration).length && !variants.some((v) => sourceKey(v) === sourceKey(i)))
          variants.push({ studioId: i.studioId, configuration: i.configuration });
        continue;
      }
      const sub = tabs.find((x) => x.id === i.assemblyId && x.type === 'assembly') as AssemblyTab | undefined;
      if (!sub || path.includes(sub.id)) continue;
      walk(sub, [...path, sub.id]);
      if (!subs.includes(sub)) subs.push(sub);
    }
  };
  walk(asm, [asm.id]);
  return { studios: [...studios], subs, variants };
}

/**
 * The STEP product tree of an assembly (its instances `chosen`): `[0]` is the assembly, then each sub-assembly
 * once (its shown instances); a component is a part of a Part Studio or a sub-assembly, placed.
 */
export function stepAssemblies(name: string, chosen: AssemblyInstance[], sources: AssemblySources): StepAssembly[] {
  const out: StepAssembly[] = [];
  const index = new Map<string, number>();
  const define = (title: string, list: AssemblyInstance[]) => {
    const n = out.length;
    out.push({ name: title, components: [] });
    out[n].components = list.flatMap((i): StepComponent[] => {
      const at = { name: i.name, position: i.position, rotation: i.rotation };
      if (!i.assemblyId) return [{ ...at, studioKey: sourceKey(i), partId: i.partId }];
      const sub = sources.get(i.assemblyId)?.assembly;
      if (!sub) return [];
      let j = index.get(sub.id);
      if (j === undefined) {
        j = out.length;
        index.set(sub.id, j);
        define(sub.name, sub.instances.filter((x) => !x.hidden));
      }
      return [{ ...at, assembly: j }];
    });
  };
  define(name, chosen);
  return out;
}

/** Whether assembly `a` contains assembly `b` (itself or through its sub-assemblies) — inserting would loop. */
export function containsAssembly(tabs: { id: string; type: string; instances?: AssemblyInstance[] }[], a: string, b: string, seen: string[] = []): boolean {
  if (a === b) return true;
  if (seen.includes(a)) return false;
  const tab = tabs.find((x) => x.id === a);
  return (tab?.instances ?? []).some((i) => i.assemblyId && containsAssembly(tabs, i.assemblyId, b, [...seen, a]));
}
