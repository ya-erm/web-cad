// Exploded views of an assembly (Onshape): steps move and turn instances apart; the view is only shown — the
// assembly's placements stay as they are.

import { create } from 'zustand';
import type { AssemblyTab, ExplodeStep, ExplodedView, Vec3 } from '../core/types';
import type { BuildResult } from '../kernel/protocol';
import { rotateVec } from '../core/math';
import { applyPoint, composeAssembly, placementOf, rotationAngles, sourceMesh, type AssemblySources } from './compose';
import { expandAssembly } from './expand';

/** Apply a step to the instances of `tab` (in place), `f` of the way (0…1). */
function applyStep(tab: AssemblyTab, s: ExplodeStep, f: number) {
  const a = ((s.angle ?? 0) * Math.PI * f) / 180;
  for (const inst of tab.instances) {
    if (!s.instances.includes(inst.id)) continue;
    if (a && s.pivot) {
      // turn the placement about the axis through the pivot: p' = Rax (p − c) + c
      const pl = placementOf(inst);
      const rot = (v: Vec3) => rotateVec(v, s.dir, a);
      const cols = [0, 1, 2].map((j) => rot([pl.R[j], pl.R[3 + j], pl.R[6 + j]]));
      inst.rotation = rotationAngles([cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]]);
      const c = s.pivot;
      const tr = rot([pl.t[0] - c[0], pl.t[1] - c[1], pl.t[2] - c[2]]);
      inst.position = [tr[0] + c[0], tr[1] + c[1], tr[2] + c[2]];
    }
    inst.position = inst.position.map((v, i) => v + s.dir[i] * s.distance * f) as Vec3;
  }
}

/**
 * The assembly with an exploded view applied by `amount` (0 — together, 1 — fully exploded). The steps go one
 * after another as the amount grows, as in Onshape's exploded view slider; `pending` — a step being dragged,
 * shown on top of them.
 */
export function explodedAssembly(tab: AssemblyTab, view: ExplodedView, amount: number, pending?: ExplodeStep | null): AssemblyTab {
  const out = structuredClone(tab) as AssemblyTab;
  const n = view.steps.length;
  view.steps.forEach((s, k) => {
    const f = Math.min(1, Math.max(0, amount * n - k));
    if (f) applyStep(out, s, f);
  });
  if (pending) applyStep(out, pending, 1);
  return out;
}

/** The exploded view being shown (of the active assembly), how far it is exploded and a step being dragged. */
export const useExplode = create<{ assembly: string | null; view: string | null; amount: number; pending: ExplodeStep | null }>(() => ({
  assembly: null,
  view: null,
  amount: 1,
  pending: null,
}));

export function explodeActive(): boolean {
  return useExplode.getState().view !== null;
}

/** The assembly as the graphics area shows it: exploded while one of its exploded views is open. */
export function displayedAssembly(tab: AssemblyTab): AssemblyTab {
  const { assembly, view, amount, pending } = useExplode.getState();
  const v = assembly === tab.id ? tab.explodedViews?.find((x) => x.id === view) : undefined;
  return v ? explodedAssembly(tab, v, amount, pending) : tab;
}

/** Explode lines (Onshape trail lines): from where each moved part stands to where it is shown. */
export function explodeTrails(tab: AssemblyTab, shown: AssemblyTab, sources: AssemblySources): number[] {
  const out: number[] = [];
  // part by part: sub-assemblies unfolded the same way in both
  const after = expandAssembly(shown, sources).instances;
  expandAssembly(tab, sources).instances.forEach((inst, i) => {
    const box = sourceMesh(sources, inst)?.bbox;
    const moved = after[i];
    if (!box || !moved || inst.hidden) return;
    const c: Vec3 = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, (box[0][2] + box[1][2]) / 2];
    const a = applyPoint(placementOf(inst), c);
    const b = applyPoint(placementOf(moved), c);
    if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > 1e-6) out.push(...a, ...b);
  });
  return out;
}

/** The build the graphics area shows for an assembly: exploded, with explode lines, while a view is open. */
export function composeDisplayed(tab: AssemblyTab, sources: AssemblySources): { build: BuildResult; missing: string[] } {
  const shown = displayedAssembly(tab);
  const res = composeAssembly(shown, sources);
  if (shown !== tab) res.build.trails = explodeTrails(tab, shown, sources);
  return res;
}

/** Default exploded view name: "Exploded view 1"… */
export function explodedViewName(tab: AssemblyTab): string {
  const names = new Set((tab.explodedViews ?? []).map((v) => v.name));
  let n = 1;
  while (names.has(`Exploded view ${n}`)) n++;
  return `Exploded view ${n}`;
}
