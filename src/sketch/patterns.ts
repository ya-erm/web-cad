// Associative sketch patterns: copies are derived from the seed geometry every time the
// sketch is evaluated (Onshape behaviour). The solver never sees the copies.

import type { SkEntity, SkPattern, SketchData, Vec2 } from '../core/types';
import { tryEvaluate, type EvalContext } from '../core/expr';
import { entityMap, sampleEntity, type EntityMap } from './curves';

export const COPY_SEP = '~';

export function copyId(seedId: string, patternId: string, key: string) {
  return `${seedId}${COPY_SEP}${patternId}${COPY_SEP}${key}`;
}

export function isCopyId(id: string) {
  return id.includes(COPY_SEP);
}

export function parseCopyId(id: string): { seedId: string; patternId: string; key: string } | null {
  const parts = id.split(COPY_SEP);
  if (parts.length !== 3) return null;
  return { seedId: parts[0], patternId: parts[1], key: parts[2] };
}

export interface PatternInstance {
  key: string;
  xf: (p: Vec2) => Vec2;
}

const MAX_INSTANCES = 500;

function evalCount(s: string | undefined, ctx: EvalContext, def: number) {
  const v = s ? tryEvaluate(s, 'number', ctx) : def;
  if (v === null || !Number.isFinite(v)) return def;
  return Math.max(1, Math.min(MAX_INSTANCES, Math.round(v)));
}

export function patternCenter(p: SkPattern, map: EntityMap): Vec2 {
  if (p.centerRef) {
    const e = map.get(p.centerRef);
    if (e && e.type === 'point') return [e.x, e.y];
  }
  return p.center ?? [0, 0];
}

/** Bounding-box centre of the seed geometry (manipulator anchor). */
export function seedCenter(p: SkPattern, map: EntityMap): Vec2 {
  let lo: Vec2 = [Infinity, Infinity];
  let hi: Vec2 = [-Infinity, -Infinity];
  for (const id of p.seed) {
    const e = map.get(id);
    if (!e) continue;
    const pts = e.type === 'point' ? [[e.x, e.y] as Vec2] : safeSample(e, map);
    for (const q of pts) {
      lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
      hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
    }
  }
  if (!Number.isFinite(lo[0])) return [0, 0];
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
}

function safeSample(e: SkEntity, map: EntityMap): Vec2[] {
  try {
    return sampleEntity(e, map);
  } catch {
    return [];
  }
}

export interface PatternParams {
  count: number;
  /** circular */
  center: Vec2;
  angle: number;
  closed: boolean;
  /** linear */
  spacing: number;
  dir: number;
  count2: number;
  spacing2: number;
}

export function patternParams(p: SkPattern, map: EntityMap, ctx: EvalContext): PatternParams {
  const angle = p.angle ? (tryEvaluate(p.angle, 'angle', ctx) ?? 2 * Math.PI) : 2 * Math.PI;
  return {
    count: evalCount(p.count, ctx, 2),
    center: patternCenter(p, map),
    angle,
    closed: Math.abs(Math.abs(angle) - 2 * Math.PI) < 1e-9,
    spacing: p.spacing ? (tryEvaluate(p.spacing, 'length', ctx) ?? 10) : 10,
    dir: p.dirAngle ? (tryEvaluate(p.dirAngle, 'angle', ctx) ?? 0) : 0,
    count2: evalCount(p.count2, ctx, 1),
    spacing2: p.spacing2 ? (tryEvaluate(p.spacing2, 'length', ctx) ?? 10) : 10,
  };
}

/** Transforms of all instances except the seed itself. */
export function patternInstances(p: SkPattern, map: EntityMap, ctx: EvalContext): PatternInstance[] {
  const prm = patternParams(p, map, ctx);
  const out: PatternInstance[] = [];
  if (p.kind === 'circular') {
    const n = prm.count;
    const step = prm.closed ? prm.angle / n : prm.angle / Math.max(n - 1, 1);
    const [cx, cy] = prm.center;
    for (let i = 1; i < n; i++) {
      const c = Math.cos(step * i);
      const s = Math.sin(step * i);
      out.push({ key: `${i}`, xf: ([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c] });
    }
    return out;
  }
  const d1: Vec2 = [Math.cos(prm.dir) * prm.spacing, Math.sin(prm.dir) * prm.spacing];
  const d2: Vec2 = [-Math.sin(prm.dir) * prm.spacing2, Math.cos(prm.dir) * prm.spacing2];
  for (let j = 0; j < prm.count2; j++)
    for (let i = 0; i < prm.count; i++) {
      if (i === 0 && j === 0) continue;
      if (out.length >= MAX_INSTANCES) return out;
      const dx = d1[0] * i + d2[0] * j;
      const dy = d1[1] * i + d2[1] * j;
      out.push({ key: prm.count2 > 1 ? `${i}_${j}` : `${i}`, xf: ([x, y]) => [x + dx, y + dy] });
    }
  return out;
}

/** Copies of the seed for one instance (deterministic ids, no constraints). */
function instanceEntities(p: SkPattern, map: EntityMap, inst: PatternInstance, skipped: Set<string>): SkEntity[] {
  const out: SkEntity[] = [];
  const cid = (id: string) => copyId(id, p.id, inst.key);
  const P = (id: string): Vec2 => {
    const e = map.get(id);
    return e && e.type === 'point' ? [e.x, e.y] : [0, 0];
  };
  const pt = (id: string, owner?: string, construction?: boolean): SkEntity => {
    const [x, y] = inst.xf(P(id));
    return { id: cid(id), type: 'point', x, y, ...(owner ? { owner } : {}), ...(construction ? { construction: true } : {}) };
  };
  for (const id of p.seed) {
    const e = map.get(id);
    if (!e || skipped.has(cid(id))) continue;
    const owner = cid(e.id);
    const cons = e.construction ? { construction: true } : {};
    switch (e.type) {
      case 'point':
        out.push(pt(e.id, undefined, e.construction));
        break;
      case 'line':
        out.push(pt(e.p1, owner), pt(e.p2, owner), { id: owner, type: 'line', p1: cid(e.p1), p2: cid(e.p2), ...cons });
        break;
      case 'circle':
        out.push(pt(e.c, owner), { id: owner, type: 'circle', c: cid(e.c), r: e.r, ...cons });
        break;
      case 'arc':
        out.push(pt(e.c, owner), pt(e.p1, owner), pt(e.p2, owner), { id: owner, type: 'arc', c: cid(e.c), p1: cid(e.p1), p2: cid(e.p2), ...cons });
        break;
      case 'ellipse': {
        const c = P(e.c);
        const a = inst.xf(c);
        const b = inst.xf([c[0] + Math.cos(e.rot), c[1] + Math.sin(e.rot)]);
        out.push(pt(e.c, owner), { id: owner, type: 'ellipse', c: cid(e.c), rx: e.rx, ry: e.ry, rot: Math.atan2(b[1] - a[1], b[0] - a[0]), ...cons });
        break;
      }
      case 'spline': {
        for (const q of e.pts) out.push(pt(q, owner));
        const hs = [e.h0, e.h1].filter((h): h is string => !!h && !!map.get(h));
        for (const h of hs) out.push(pt(h, owner));
        out.push({
          id: owner,
          type: 'spline',
          pts: e.pts.map(cid),
          closed: e.closed,
          ...(e.h0 && hs.includes(e.h0) ? { h0: cid(e.h0) } : {}),
          ...(e.h1 && hs.includes(e.h1) ? { h1: cid(e.h1) } : {}),
          ...cons,
        });
        break;
      }
      case 'text':
        out.push(pt(e.p1, owner), pt(e.p2, owner), { id: owner, type: 'text', text: e.text, font: e.font, p1: cid(e.p1), p2: cid(e.p2), ...cons });
        break;
      case 'gear':
        out.push(pt(e.c, owner), { id: owner, type: 'gear', teeth: e.teeth, sizeBy: e.sizeBy, size: e.size, pressureAngle: e.pressureAngle, rotation: e.rotation, c: cid(e.c), ...cons });
        break;
    }
  }
  return out;
}

/** Seed entities + generated pattern copies. */
export function expandPatterns(entities: SkEntity[], patterns: SkPattern[] | undefined, ctx: EvalContext): SkEntity[] {
  if (!patterns?.length) return entities;
  const map = entityMap(entities);
  const out = [...entities];
  for (const p of patterns) {
    const skipped = new Set(p.skipped ?? []);
    for (const inst of patternInstances(p, map, ctx)) out.push(...instanceEntities(p, map, inst, skipped));
  }
  return out;
}

/** Remove references to deleted entities; drop patterns whose seed is gone. */
export function cleanPatterns(d: SketchData) {
  if (!d.patterns) return;
  const ids = new Set(d.entities.map((e) => e.id));
  for (const p of d.patterns) {
    p.seed = p.seed.filter((id) => ids.has(id));
    if (p.centerRef && !ids.has(p.centerRef)) {
      delete p.centerRef;
    }
  }
  d.patterns = d.patterns.filter((p) => p.seed.length > 0);
}

export function patternOfCopy(d: SketchData, id: string): SkPattern | undefined {
  const c = parseCopyId(id);
  return c ? d.patterns?.find((p) => p.id === c.patternId) : undefined;
}
