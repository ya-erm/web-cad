// A spur gear in a sketch (Onshape: Spur gear). The entity keeps its centre and its parameters (expressions); its
// teeth are derived geometry made from them at build time, like the letters of a text (ids `<gear>~gear~<key>`):
// one tooth — radial below the base circle, involute flanks (smooth curves), the tip arc — arrayed around the
// centre, the root arcs between the teeth, the pitch circle for reference. They make the gear's region; the solver
// never sees them.

import type { SkEntity, SkGear, Vec2 } from '../core/types';
import { evaluate, type EvalContext } from '../core/expr';
import { gearCircles, gearModule, gearProblem, toothHalfAngle, type GearSize } from '../core/gear';
import { pointOf, type EntityMap } from './curves';
import { COPY_SEP } from './patterns';

const PART = `${COPY_SEP}gear${COPY_SEP}`;

export const gearPartId = (gearId: string, key: string) => `${gearId}${PART}${key}`;

/** Whether an id is of the derived geometry of a gear (its teeth, root arcs, pitch circle). */
export const isGearPart = (id: string) => id.includes(PART);

/** The gear entity a derived id belongs to. */
export function gearOfPart(id: string): string | null {
  const i = id.indexOf(PART);
  return i < 0 ? null : id.slice(0, i);
}

/** Evaluation without the document's variables (numbers and units only). */
const PLAIN: EvalContext = { vars: {}, lengthUnit: 'mm', angleUnit: 'deg' };

/** A gear's size and rotation (radians) from its expressions, or why it cannot be made. */
export function gearSizeOf(g: SkGear, ec: EvalContext = PLAIN): { size: GearSize; rotation: number } | { error: string } {
  try {
    const z = Math.round(evaluate(g.teeth, 'number', ec));
    const value = evaluate(g.size, 'length', ec);
    const alpha = evaluate(g.pressureAngle || '20 deg', 'angle', ec);
    const rotation = evaluate(g.rotation || '0 deg', 'angle', ec);
    const size: GearSize = { z, m: gearModule(g.sizeBy, z, value), alpha };
    const problem = gearProblem(size);
    return problem ? { error: problem } : { size, rotation };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Points on each involute flank (from the base or root circle to the tip): the curve through them is smooth. */
const FLANK_POINTS = 6;

/** The teeth of a gear (with its root arcs and pitch circle): derived sketch entities. None when it cannot be made. */
export function gearGeometry(g: SkGear, map: EntityMap, ec?: EvalContext): SkEntity[] {
  const s = gearSizeOf(g, ec);
  if ('error' in s) return [];
  const { size, rotation } = s;
  const c = pointOf(map, g.c);
  const { r, ra, rf, rb } = gearCircles(size);
  const start = Math.max(rb, rf);
  const out: SkEntity[] = [];
  const cons = g.construction ? { construction: true as const } : {};
  const point = (key: string, rho: number, a: number) => {
    const id = gearPartId(g.id, key);
    out.push({ id, type: 'point', x: c[0] + rho * Math.cos(a), y: c[1] + rho * Math.sin(a), owner: g.id });
    return id;
  };
  // the pitch circle, for reference (its centre: the gear's own)
  out.push({ id: gearPartId(g.id, 'pitch'), type: 'circle', c: g.c, r, construction: true });
  const radii = Array.from({ length: FLANK_POINTS }, (_, i) => start + ((ra - start) * i) / (FLANK_POINTS - 1));
  const b0 = toothHalfAngle(size, start);
  // the flanks start on the base circle, above the root (radial lines from it); or on the root circle itself
  const radial = start > rf + 1e-9;
  // one tooth, arrayed: tooth k about the direction `rotation + k · 360° / z`
  const firstRoot = point('t0r', rf, rotation - b0);
  let rootR = firstRoot;
  for (let k = 0; k < size.z; k++) {
    const at = rotation + (2 * Math.PI * k) / size.z;
    const T = (key: string) => `t${k}${key}`;
    // right flank up: radial from the root circle to the base circle, then the involute
    const right = radii.map((rho, i) => (i === 0 && !radial ? rootR : point(T(`a${i}`), rho, at - toothHalfAngle(size, rho))));
    if (radial) out.push({ id: gearPartId(g.id, T('ra')), type: 'line', p1: rootR, p2: right[0], ...cons });
    out.push({ id: gearPartId(g.id, T('fa')), type: 'spline', pts: right, ...cons });
    // the tip arc (counter-clockwise), the left flank down
    const left = [...radii].reverse().map((rho, i) => point(T(`b${i}`), rho, at + toothHalfAngle(size, rho)));
    out.push({ id: gearPartId(g.id, T('tip')), type: 'arc', c: g.c, p1: right[right.length - 1], p2: left[0], ...cons });
    out.push({ id: gearPartId(g.id, T('fb')), type: 'spline', pts: left, ...cons });
    let rootL = left[left.length - 1];
    if (radial) {
      rootL = point(T('rb'), rf, at + b0);
      out.push({ id: gearPartId(g.id, T('rl')), type: 'line', p1: left[left.length - 1], p2: rootL, ...cons });
    }
    // the root arc to the next tooth (the last one: back to the first)
    const next = k === size.z - 1 ? firstRoot : point(`t${k + 1}r`, rf, at + (2 * Math.PI) / size.z - b0);
    out.push({ id: gearPartId(g.id, T('root')), type: 'arc', c: g.c, p1: rootL, p2: next, ...cons });
    rootR = next;
  }
  return out;
}

/** Entities with the teeth of their gears added (as derived geometry), from the expressions with `ec`'s variables. */
export function expandGears(entities: SkEntity[], ec?: EvalContext): SkEntity[] {
  if (!entities.some((e) => e.type === 'gear')) return entities;
  const map = new Map(entities.map((e) => [e.id, e]));
  const out = [...entities];
  for (const e of entities) if (e.type === 'gear') out.push(...gearGeometry(e, map, ec));
  return out;
}

/** Polylines of a gear that is not in the sketch yet (the tool's preview), about `c`. */
export function gearOutline(g: Pick<SkGear, 'teeth' | 'sizeBy' | 'size' | 'pressureAngle' | 'rotation'>, c: Vec2, ec?: EvalContext): Vec2[][] {
  const pts: SkEntity[] = [{ id: 'c', type: 'point', x: c[0], y: c[1] }];
  const gear: SkGear = { ...g, id: 'g', type: 'gear', c: 'c' };
  const all = [...pts, gear, ...gearGeometry(gear, new Map([...pts, gear].map((e) => [e.id, e])), ec)];
  const map = new Map(all.map((e) => [e.id, e]));
  const P = (id: string): Vec2 => pointOf(map, id);
  const lines: Vec2[][] = [];
  for (const e of all) {
    if (e.construction) continue;
    if (e.type === 'line') lines.push([P(e.p1), P(e.p2)]);
    else if (e.type === 'spline') lines.push(e.pts.map(P));
    else if (e.type === 'arc') {
      const cc = P(e.c);
      const a0 = Math.atan2(P(e.p1)[1] - cc[1], P(e.p1)[0] - cc[0]);
      let a1 = Math.atan2(P(e.p2)[1] - cc[1], P(e.p2)[0] - cc[0]);
      while (a1 <= a0) a1 += 2 * Math.PI;
      const rr = Math.hypot(P(e.p1)[0] - cc[0], P(e.p1)[1] - cc[1]);
      lines.push(Array.from({ length: 5 }, (_, i) => [cc[0] + rr * Math.cos(a0 + ((a1 - a0) * i) / 4), cc[1] + rr * Math.sin(a0 + ((a1 - a0) * i) / 4)] as Vec2));
    }
  }
  return lines;
}
