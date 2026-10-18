// Pure editing operations on sketch data (used with immer drafts).

import type { ConstraintType, SkArc, SkConstraint, SkEntity, SkLine, SkPoint, SkSpline, SketchData, Vec2 } from '../core/types';
import { uid } from '../core/ids';
import { arcAngles, entityMap, intersectEntities, naturalHandles, pointOf, type EntityMap } from './curves';
import { cleanPatterns, copyId, isCopyId, parseCopyId } from './patterns';

export type Snap =
  | { kind: 'point'; id: string; pos: Vec2 }
  | { kind: 'curve'; id: string; pos: Vec2 }
  | { kind: 'midpoint'; id: string; pos: Vec2 }
  | { kind: 'origin'; pos: Vec2 }
  /** Inference from acquired points: same y as point `h` (horizontal), same x as point `v` (vertical). */
  | { kind: 'align'; pos: Vec2; h?: string; v?: string }
  /** On the extension of line `id` beyond its ends (the point goes on the line, Onshape inference). */
  | { kind: 'extension'; id: string; pos: Vec2 }
  | { kind: 'none'; pos: Vec2 };

export function addPoint(d: SketchData, p: Vec2, owner?: string, construction?: boolean): string {
  const id = uid('p');
  const pt: SkPoint = { id, type: 'point', x: p[0], y: p[1] };
  if (owner) pt.owner = owner;
  if (construction) pt.construction = true;
  d.entities.push(pt);
  return id;
}

export function addConstraint(d: SketchData, type: ConstraintType, refs: string[], extra: Partial<SkConstraint> = {}): string {
  const id = uid('c');
  d.constraints.push({ id, type, refs, ...extra });
  return id;
}

/** Apply the snap of a newly created point as a constraint. */
export function applySnap(d: SketchData, pointId: string, snap: Snap | null | undefined) {
  if (!snap) return;
  switch (snap.kind) {
    case 'point':
      if (snap.id !== pointId) addConstraint(d, 'coincident', [snap.id, pointId]);
      break;
    case 'curve':
    case 'extension':
      addConstraint(d, 'coincident', [pointId, snap.id]);
      break;
    case 'midpoint':
      addConstraint(d, 'midpoint', [pointId, snap.id]);
      break;
    case 'origin':
      addConstraint(d, 'fix', [pointId], { frozen: [0, 0] });
      break;
    case 'align':
      if (snap.h && snap.h !== pointId) addConstraint(d, 'horizontal', [snap.h, pointId]);
      if (snap.v && snap.v !== pointId) addConstraint(d, 'vertical', [snap.v, pointId]);
      break;
  }
}

export function addLine(d: SketchData, a: Vec2, b: Vec2, construction = false) {
  const id = uid('l');
  const p1 = addPoint(d, a, id);
  const p2 = addPoint(d, b, id);
  const line: SkLine = { id, type: 'line', p1, p2 };
  if (construction) line.construction = true;
  d.entities.push(line);
  return { id, p1, p2 };
}

export function addCircle(d: SketchData, c: Vec2, r: number, construction = false) {
  const id = uid('ci');
  const cp = addPoint(d, c, id);
  d.entities.push({ id, type: 'circle', c: cp, r, ...(construction ? { construction: true } : {}) });
  return { id, c: cp };
}

/** Arc counter-clockwise from a to b around c. */
export function addArc(d: SketchData, c: Vec2, a: Vec2, b: Vec2, construction = false) {
  const id = uid('a');
  const cp = addPoint(d, c, id);
  const p1 = addPoint(d, a, id);
  const p2 = addPoint(d, b, id);
  const arc: SkArc = { id, type: 'arc', c: cp, p1, p2 };
  if (construction) arc.construction = true;
  d.entities.push(arc);
  return { id, c: cp, p1, p2 };
}

export function addEllipse(d: SketchData, c: Vec2, rx: number, ry: number, rot: number, construction = false) {
  const id = uid('e');
  const cp = addPoint(d, c, id);
  d.entities.push({ id, type: 'ellipse', c: cp, rx, ry, rot, ...(construction ? { construction: true } : {}) });
  return { id, c: cp };
}

export function addSpline(d: SketchData, pts: Vec2[], closed = false, construction = false) {
  const id = uid('s');
  const ids = pts.map((p) => addPoint(d, p, id));
  d.entities.push({ id, type: 'spline', pts: ids, closed, ...(construction ? { construction: true } : {}) });
  return { id, pts: ids };
}

/**
 * Tangent handle at an end of an open spline (Onshape): an owned construction point, placed where
 * it leaves the curve unchanged unless `pos` is given. Returns its id (existing or new).
 */
export function addSplineHandle(d: SketchData, splineId: string, end: 'h0' | 'h1', pos?: Vec2): string | null {
  const sp = d.entities.find((e) => e.id === splineId);
  if (!sp || sp.type !== 'spline' || sp.closed) return null;
  const existing = sp[end];
  if (existing && d.entities.some((e) => e.id === existing)) return existing;
  const map = entityMap(d.entities);
  const nat = naturalHandles(sp.pts.map((id) => pointOf(map, id)));
  if (!nat) return null;
  const id = addPoint(d, pos ?? nat[end], splineId, true);
  sp[end] = id;
  return id;
}

/** The spline end ('h0': first point, 'h1': last) at a point id, if that point is one of its ends. */
export function splineEndAt(sp: SkSpline, pointId: string): 'h0' | 'h1' | null {
  if (sp.closed || sp.pts.length < 2) return null;
  if (sp.pts[0] === pointId) return 'h0';
  if (sp.pts[sp.pts.length - 1] === pointId) return 'h1';
  return null;
}

export function addRectangle(d: SketchData, a: Vec2, b: Vec2, construction = false) {
  const corners: Vec2[] = [a, [b[0], a[1]], b, [a[0], b[1]]];
  const lines = corners.map((p, i) => addLine(d, p, corners[(i + 1) % 4], construction));
  for (let i = 0; i < 4; i++) addConstraint(d, 'coincident', [lines[i].p2, lines[(i + 1) % 4].p1]);
  addConstraint(d, 'horizontal', [lines[0].id]);
  addConstraint(d, 'horizontal', [lines[2].id]);
  addConstraint(d, 'vertical', [lines[1].id]);
  addConstraint(d, 'vertical', [lines[3].id]);
  return lines;
}

export function addCenterRectangle(d: SketchData, c: Vec2, corner: Vec2, construction = false) {
  const a: Vec2 = [2 * c[0] - corner[0], 2 * c[1] - corner[1]];
  const lines = addRectangle(d, a, corner, construction);
  const diag = addLine(d, a, corner, true);
  addConstraint(d, 'coincident', [diag.p1, lines[0].p1]);
  addConstraint(d, 'coincident', [diag.p2, lines[2].p1]);
  const cp = addPoint(d, c);
  addConstraint(d, 'midpoint', [cp, diag.id]);
  return { lines, center: cp };
}

export function addSlot(d: SketchData, c1: Vec2, c2: Vec2, r: number, construction = false) {
  const ax: Vec2 = [c2[0] - c1[0], c2[1] - c1[1]];
  const L = Math.hypot(ax[0], ax[1]) || 1;
  const n: Vec2 = [-ax[1] / L, ax[0] / L];
  const P = (c: Vec2, s: number): Vec2 => [c[0] + n[0] * r * s, c[1] + n[1] * r * s];
  // arc1 around c1 goes CCW from +n to -n (behind c1), arc2 around c2 from -n to +n
  const a1 = addArc(d, c1, P(c1, 1), P(c1, -1), construction);
  const a2 = addArc(d, c2, P(c2, -1), P(c2, 1), construction);
  const l1 = addLine(d, P(c1, -1), P(c2, -1), construction);
  const l2 = addLine(d, P(c2, 1), P(c1, 1), construction);
  addConstraint(d, 'coincident', [a1.p2, l1.p1]);
  addConstraint(d, 'coincident', [l1.p2, a2.p1]);
  addConstraint(d, 'coincident', [a2.p2, l2.p1]);
  addConstraint(d, 'coincident', [l2.p2, a1.p1]);
  addConstraint(d, 'tangent', [a1.id, l1.id]);
  addConstraint(d, 'tangent', [a1.id, l2.id]);
  addConstraint(d, 'tangent', [a2.id, l1.id]);
  addConstraint(d, 'tangent', [a2.id, l2.id]);
  addConstraint(d, 'equal', [a1.id, a2.id]);
  const axis = addLine(d, c1, c2, true);
  addConstraint(d, 'coincident', [axis.p1, a1.c]);
  addConstraint(d, 'coincident', [axis.p2, a2.c]);
  return { arcs: [a1, a2], lines: [l1, l2], axis };
}

/** Vertices of a regular polygon centred at c. `v` is a vertex, or with `inscribed` the midpoint of a side. */
export function polygonVertices(c: Vec2, v: Vec2, sides: number, inscribed = false): Vec2[] {
  const r = Math.hypot(v[0] - c[0], v[1] - c[1]);
  const R = inscribed ? r / Math.cos(Math.PI / sides) : r;
  const a0 = Math.atan2(v[1] - c[1], v[0] - c[0]) - (inscribed ? Math.PI / sides : 0);
  const out: Vec2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = a0 + (i * 2 * Math.PI) / sides;
    out.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]);
  }
  return out;
}

/**
 * Regular polygon with a construction circle (Onshape): circumscribed — the circle passes through
 * the vertices (`v` is a vertex); inscribed — the circle touches the sides (`v` is a side midpoint).
 */
export function addPolygon(d: SketchData, c: Vec2, v: Vec2, sides: number, construction = false, inscribed = false) {
  const r = Math.hypot(v[0] - c[0], v[1] - c[1]);
  const verts = polygonVertices(c, v, sides, inscribed);
  const lines = verts.map((p, i) => addLine(d, p, verts[(i + 1) % sides], construction));
  const circ = addCircle(d, c, r, true);
  for (let i = 0; i < sides; i++) {
    addConstraint(d, 'coincident', [lines[i].p2, lines[(i + 1) % sides].p1]);
    if (inscribed) addConstraint(d, 'tangent', [lines[i].id, circ.id]);
    else addConstraint(d, 'coincident', [lines[i].p1, circ.id]);
    // equal sides tangent to a circle: with an even count the last equality follows from the others
    if (i > 0 && !(inscribed && sides % 2 === 0 && i === sides - 1)) addConstraint(d, 'equal', [lines[0].id, lines[i].id]);
  }
  // even count: an equilateral polygon around a circle can still shear (a rhombus) — a construction
  // radius to the middle of a side, perpendicular to it, keeps it regular (a point of that side on
  // the circle would be a degenerate, second-order condition)
  if (inscribed && sides % 2 === 0) {
    const ax = addLine(d, c, v, true);
    addConstraint(d, 'coincident', [ax.p1, circ.c]);
    addConstraint(d, 'midpoint', [ax.p2, lines[0].id]);
    addConstraint(d, 'perpendicular', [ax.id, lines[0].id]);
  }
  return { lines, circle: circ };
}

/** Circle through three points (null if collinear). */
export function circumcircle(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
}

/** Is `m` on the CCW arc from a to b around c? */
export function onCcwArc(c: Vec2, a: Vec2, b: Vec2, m: Vec2) {
  const ang = (p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return norm(ang(m) - ang(a)) < norm(ang(b) - ang(a));
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/** Ids of entities that will be removed together with `ids` (owned points). */
export function withOwned(d: SketchData, ids: string[]): Set<string> {
  const set = new Set(ids);
  for (const e of d.entities) if (e.type === 'point' && e.owner && set.has(e.owner)) set.add(e.id);
  // deleting an owned point alone deletes its owner
  for (const id of [...set]) {
    const e = d.entities.find((x) => x.id === id);
    if (e && e.type === 'point' && e.owner && !set.has(e.owner)) {
      set.add(e.owner);
      for (const x of d.entities) if (x.type === 'point' && x.owner === e.owner) set.add(x.id);
    }
  }
  return set;
}

export function deleteItems(d: SketchData, ids: string[]) {
  // whole patterns
  const pIds = new Set(ids.filter((id) => d.patterns?.some((p) => p.id === id)));
  if (pIds.size && d.patterns) d.patterns = d.patterns.filter((p) => !pIds.has(p.id));
  // single pattern copies leave a gap (Onshape keeps it when the count changes)
  for (const id of ids) {
    const c = parseCopyId(id);
    const p = c && d.patterns?.find((x) => x.id === c.patternId);
    if (!c || !p) continue;
    // a copied point owned by a curve deletes that curve's copy
    const seed = d.entities.find((e) => e.id === c.seedId);
    const curveSeed = seed && seed.type === 'point' && seed.owner ? seed.owner : c.seedId;
    const cid = copyId(curveSeed, c.patternId, c.key);
    p.skipped = [...new Set([...(p.skipped ?? []), cid])];
  }
  const rest = ids.filter((id) => !pIds.has(id) && !isCopyId(id));
  const cIds = new Set(rest.filter((id) => d.constraints.some((c) => c.id === id)));
  // a tangent handle alone only returns its spline end to the natural tangent
  const handles = new Set<string>();
  for (const e of d.entities) {
    if (e.type !== 'spline' || rest.includes(e.id)) continue;
    for (const k of ['h0', 'h1'] as const) {
      const h = e[k];
      if (h && rest.includes(h)) {
        handles.add(h);
        delete e[k];
      }
    }
  }
  const eIds = withOwned(
    d,
    rest.filter((id) => !cIds.has(id) && !handles.has(id)),
  );
  for (const h of handles) eIds.add(h);
  d.entities = d.entities.filter((e) => !eIds.has(e.id));
  // an offset dimension only loses the pairs whose source or copy is deleted
  for (const c of d.constraints) {
    if (c.type !== 'offset' || cIds.has(c.id)) continue;
    const keep: string[] = [];
    for (let i = 0; i + 1 < c.refs.length; i += 2) if (!eIds.has(c.refs[i]) && !eIds.has(c.refs[i + 1])) keep.push(c.refs[i], c.refs[i + 1]);
    c.refs = keep;
  }
  d.constraints = d.constraints.filter(
    (c) => !cIds.has(c.id) && !c.refs.some((r) => eIds.has(r)) && !(c.type === 'offset' && c.refs.length === 0),
  );
  cleanPatterns(d);
}

export function toggleConstruction(d: SketchData, ids: string[]) {
  const set = new Set(ids);
  const targets = d.entities.filter((e) => set.has(e.id) && e.type !== 'point');
  const make = targets.some((e) => !e.construction);
  for (const e of targets) {
    if (make) e.construction = true;
    else delete e.construction;
  }
}

// ---------------------------------------------------------------------------
// Fillet & trim
// ---------------------------------------------------------------------------

/** Lines meeting at the point `pid` (directly or via a coincident constraint). */
function linesAtPoint(d: SketchData, map: EntityMap, pid: string): { line: SkLine; end: 'p1' | 'p2' }[] {
  const pts = new Set([pid]);
  for (const c of d.constraints)
    if (c.type === 'coincident' && c.refs.length === 2) {
      const [a, b] = c.refs;
      if (map.get(a)?.type === 'point' && map.get(b)?.type === 'point') {
        if (a === pid) pts.add(b);
        if (b === pid) pts.add(a);
      }
    }
  const out: { line: SkLine; end: 'p1' | 'p2' }[] = [];
  for (const e of d.entities)
    if (e.type === 'line') {
      if (pts.has(e.p1)) out.push({ line: e, end: 'p1' });
      else if (pts.has(e.p2)) out.push({ line: e, end: 'p2' });
    }
  return out;
}

/** Replace the corner at point `pid` between two lines by a tangent arc of radius r. */
export function filletCorner(d: SketchData, pid: string, r: number): string | null {
  const map = entityMap(d.entities);
  const ls = linesAtPoint(d, map, pid);
  if (ls.length !== 2) return null;
  const [A, B] = ls;
  const V = pointOf(map, A.line[A.end]);
  const otherA = pointOf(map, A.line[A.end === 'p1' ? 'p2' : 'p1']);
  const otherB = pointOf(map, B.line[B.end === 'p1' ? 'p2' : 'p1']);
  const u1 = norm2([otherA[0] - V[0], otherA[1] - V[1]]);
  const u2 = norm2([otherB[0] - V[0], otherB[1] - V[1]]);
  const cosT = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
  const theta = Math.acos(cosT) / 2;
  if (theta < 1e-3 || theta > Math.PI / 2 - 1e-3) return null;
  const tlen = r / Math.tan(theta);
  const lenA = Math.hypot(otherA[0] - V[0], otherA[1] - V[1]);
  const lenB = Math.hypot(otherB[0] - V[0], otherB[1] - V[1]);
  if (tlen >= lenA || tlen >= lenB) return null;
  const T1: Vec2 = [V[0] + u1[0] * tlen, V[1] + u1[1] * tlen];
  const T2: Vec2 = [V[0] + u2[0] * tlen, V[1] + u2[1] * tlen];
  const bis = norm2([u1[0] + u2[0], u1[1] + u2[1]]);
  const C: Vec2 = [V[0] + (bis[0] * r) / Math.sin(theta), V[1] + (bis[1] * r) / Math.sin(theta)];
  // remove coincidence between the two corner points
  const pa = A.line[A.end];
  const pb = B.line[B.end];
  d.constraints = d.constraints.filter(
    (c) => !(c.type === 'coincident' && c.refs.length === 2 && c.refs.includes(pa) && c.refs.includes(pb)),
  );
  // move the line endpoints to the tangent points
  for (const e of d.entities) {
    if (e.type !== 'point') continue;
    if (e.id === pa) [e.x, e.y] = T1;
    if (e.id === pb) [e.x, e.y] = T2;
  }
  // CCW orientation from T1 to T2?
  const cross = (T1[0] - C[0]) * (T2[1] - C[1]) - (T1[1] - C[1]) * (T2[0] - C[0]);
  const arc = cross > 0 ? addArc(d, C, T1, T2) : addArc(d, C, T2, T1);
  const [s1, s2] = cross > 0 ? [arc.p1, arc.p2] : [arc.p2, arc.p1];
  addConstraint(d, 'coincident', [s1, pa]);
  addConstraint(d, 'coincident', [s2, pb]);
  addConstraint(d, 'tangent', [arc.id, A.line.id]);
  addConstraint(d, 'tangent', [arc.id, B.line.id]);
  return arc.id;
}

function norm2(v: Vec2): Vec2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Trim the piece of entity `id` around point `at` between its neighbouring intersections.
 *  The kept piece reuses the entity id so constraints on it survive. */
export function trimEntity(d: SketchData, id: string, at: Vec2): boolean {
  const map = entityMap(d.entities);
  const ent = map.get(id);
  if (!ent || ent.type === 'point') return false;
  const others = d.entities.filter((e) => e.id !== id && e.type !== 'point');
  const hits: Vec2[] = [];
  for (const o of others) {
    try {
      hits.push(...intersectEntities(ent, o, map));
    } catch {
      /* ignore */
    }
  }
  const setPt = (pid: string, p: Vec2) => {
    const e = d.entities.find((x) => x.id === pid);
    if (e && e.type === 'point') [e.x, e.y] = p;
  };
  /** Drop constraints touching a point that moves to a trim location (except fixes of other points). */
  const freePoint = (pid: string) => {
    d.constraints = d.constraints.filter((c) => !c.refs.includes(pid));
  };
  const dropLengthDims = () => {
    d.constraints = d.constraints.filter(
      (c) => !(c.refs.length === 1 && c.refs[0] === id && (c.type === 'distance' || c.type === 'fix')),
    );
  };

  if (ent.type === 'line') {
    const a = pointOf(map, ent.p1);
    const b = pointOf(map, ent.p2);
    const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    if (L2 < 1e-18) return false;
    const param = (p: Vec2) => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2;
    const tc = param(at);
    const ts = hits.map(param).filter((t) => t > 1e-6 && t < 1 - 1e-6);
    const lo = Math.max(0, ...ts.filter((t) => t < tc));
    const hi = Math.min(1, ...ts.filter((t) => t > tc));
    const P = (t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const keepLo = lo > 1e-6;
    const keepHi = hi < 1 - 1e-6;
    if (!keepLo && !keepHi) {
      deleteItems(d, [id]);
      return true;
    }
    dropLengthDims();
    if (keepLo && keepHi) {
      // second piece takes over the old p2 and its constraints
      const nl = addLine(d, P(hi), b, ent.construction);
      for (const c of d.constraints) c.refs = c.refs.map((r) => (r === ent.p2 ? nl.p2 : r));
      for (const c of d.constraints.filter((c) => c.refs.length === 1 && c.refs[0] === id && (c.type === 'horizontal' || c.type === 'vertical')))
        addConstraint(d, c.type, [nl.id]);
      addConstraint(d, 'parallel', [id, nl.id]);
      setPt(ent.p2, P(lo));
      attachToHit(d, ent.p2, others, P(lo));
      attachToHit(d, nl.p1, others, P(hi));
    } else if (keepLo) {
      freePoint(ent.p2);
      setPt(ent.p2, P(lo));
      attachToHit(d, ent.p2, others, P(lo));
    } else {
      freePoint(ent.p1);
      setPt(ent.p1, P(hi));
      attachToHit(d, ent.p1, others, P(hi));
    }
    return true;
  }

  if (ent.type === 'circle' || ent.type === 'arc') {
    const c = pointOf(map, ent.c);
    const aa = ent.type === 'arc' ? arcAngles(ent, map) : null;
    const r = ent.type === 'circle' ? ent.r : aa!.r;
    const ang = (p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
    const base = aa ? aa.a0 : ang(at);
    const sweep = aa ? aa.a1 - aa.a0 : 2 * Math.PI;
    const rel = (p: Vec2) => (((ang(p) - base) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const tc = aa ? rel(at) : 0;
    const ts = hits.map(rel).filter((t) => t > 1e-6 && t < sweep - 1e-6);
    const P = (t: number): Vec2 => [c[0] + r * Math.cos(base + t), c[1] + r * Math.sin(base + t)];
    if (ent.type === 'circle') {
      if (ts.length < 2) {
        deleteItems(d, [id]);
        return true;
      }
      // keep the arc between the first and the last hit (the clicked piece contains angle 0)
      const lo = Math.min(...ts);
      const hi = Math.max(...ts);
      const idx = d.entities.findIndex((e) => e.id === id);
      const p1 = addPoint(d, P(lo), id);
      const p2 = addPoint(d, P(hi), id);
      d.entities[idx] = { id, type: 'arc', c: ent.c, p1, p2, ...(ent.construction ? { construction: true } : {}) };
      d.constraints = d.constraints.filter((k) => !(k.type === 'diameter' && k.refs[0] === id));
      attachToHit(d, p1, others, P(lo));
      attachToHit(d, p2, others, P(hi));
      return true;
    }
    const arc = ent as SkArc;
    const lo = Math.max(0, ...ts.filter((t) => t < tc));
    const hi = Math.min(sweep, ...ts.filter((t) => t > tc));
    const keepLo = lo > 1e-6;
    const keepHi = hi < sweep - 1e-6;
    if (!keepLo && !keepHi) {
      deleteItems(d, [id]);
      return true;
    }
    if (keepLo && keepHi) {
      const na = addArc(d, c, P(hi), P(sweep), ent.construction);
      for (const k of d.constraints) k.refs = k.refs.map((x) => (x === arc.p2 ? na.p2 : x));
      addConstraint(d, 'coincident', [na.c, arc.c]);
      addConstraint(d, 'equal', [id, na.id]);
      setPt(arc.p2, P(lo));
      attachToHit(d, arc.p2, others, P(lo));
      attachToHit(d, na.p1, others, P(hi));
    } else if (keepLo) {
      freePoint(arc.p2);
      setPt(arc.p2, P(lo));
      attachToHit(d, arc.p2, others, P(lo));
    } else {
      freePoint(arc.p1);
      setPt(arc.p1, P(hi));
      attachToHit(d, arc.p1, others, P(hi));
    }
    return true;
  }
  deleteItems(d, [id]);
  return true;
}

export function attachToHit(d: SketchData, pid: string, others: SkEntity[], p: Vec2) {
  const map = entityMap(d.entities);
  for (const o of others) {
    if (!map.has(o.id)) continue;
    // endpoint of another curve at the same location → coincident points
    const pts = d.entities.filter((e): e is SkPoint => e.type === 'point' && e.owner === o.id);
    const near = pts.find((q) => Math.hypot(q.x - p[0], q.y - p[1]) < 1e-6 * (1 + Math.hypot(p[0], p[1])));
    if (near) {
      addConstraint(d, 'coincident', [near.id, pid]);
      return;
    }
  }
  // otherwise constrain onto the first curve that passes through p
  for (const o of others) {
    if (!map.has(o.id)) continue;
    if (o.type === 'line') {
      const a = pointOf(map, o.p1);
      const b = pointOf(map, o.p2);
      const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (Math.abs(cr) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1) < 1e-6 * (1 + Math.hypot(p[0], p[1]))) {
        addConstraint(d, 'coincident', [pid, o.id]);
        return;
      }
    } else if (o.type === 'circle' || o.type === 'arc') {
      const c = pointOf(map, o.c);
      const r = o.type === 'circle' ? o.r : Math.hypot(pointOf(map, o.p1)[0] - c[0], pointOf(map, o.p1)[1] - c[1]);
      if (Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - r) < 1e-6 * (1 + r)) {
        addConstraint(d, 'coincident', [pid, o.id]);
        return;
      }
    }
  }
}

/** Entities referenced by a constraint that are curves (for glyph placement). */
export function constraintAnchors(c: SkConstraint, map: EntityMap): SkEntity[] {
  return c.refs.map((r) => map.get(r)).filter((e): e is SkEntity => !!e);
}

// ---------------------------------------------------------------------------
// Copy / mirror / patterns
// ---------------------------------------------------------------------------

/** Curve entities and standalone points among `ids` (owned points are implied). */
export function patternableIds(d: SketchData, ids: string[]): string[] {
  const set = new Set(ids);
  return d.entities
    .filter((e) => set.has(e.id) && (e.type !== 'point' || !e.owner))
    .map((e) => e.id);
}

/**
 * Copy entities through a point transform. Returns old→new id map (entities and their points).
 * `mirror` reverses arc orientation; `rotate` (radians) turns ellipse axes.
 * With `copyConstraints`, constraints whose refs are all inside the copied set are duplicated.
 */
export function copyEntities(
  d: SketchData,
  ids: string[],
  xf: (p: Vec2) => Vec2,
  opts: { mirror?: boolean; rotate?: number; copyConstraints?: boolean } = {},
): Map<string, string> {
  const roots = patternableIds(d, ids);
  const map = new Map<string, string>();
  const byId = new Map(d.entities.map((e) => [e.id, e] as const));
  const P = (pid: string): Vec2 => {
    const p = byId.get(pid);
    return p && p.type === 'point' ? [p.x, p.y] : [0, 0];
  };
  for (const id of roots) {
    const e = byId.get(id);
    if (!e) continue;
    const cons = !!e.construction;
    switch (e.type) {
      case 'point': {
        const nid = addPoint(d, xf([e.x, e.y]), undefined, cons);
        map.set(e.id, nid);
        break;
      }
      case 'line': {
        const l = addLine(d, xf(P(e.p1)), xf(P(e.p2)), cons);
        map.set(e.id, l.id).set(e.p1, l.p1).set(e.p2, l.p2);
        break;
      }
      case 'circle': {
        const c = addCircle(d, xf(P(e.c)), e.r, cons);
        map.set(e.id, c.id).set(e.c, c.c);
        break;
      }
      case 'arc': {
        // a mirrored CCW arc runs the other way: swap its end points
        const a = opts.mirror ? addArc(d, xf(P(e.c)), xf(P(e.p2)), xf(P(e.p1)), cons) : addArc(d, xf(P(e.c)), xf(P(e.p1)), xf(P(e.p2)), cons);
        map.set(e.id, a.id).set(e.c, a.c);
        if (opts.mirror) map.set(e.p1, a.p2).set(e.p2, a.p1);
        else map.set(e.p1, a.p1).set(e.p2, a.p2);
        break;
      }
      case 'ellipse': {
        const c = xf(P(e.c));
        const ax = xf([P(e.c)[0] + Math.cos(e.rot), P(e.c)[1] + Math.sin(e.rot)]);
        const rot = Math.atan2(ax[1] - c[1], ax[0] - c[0]);
        const el = addEllipse(d, c, e.rx, e.ry, rot, cons);
        map.set(e.id, el.id).set(e.c, el.c);
        break;
      }
      case 'spline': {
        const pts = e.pts.map((pid) => xf(P(pid)));
        const s = addSpline(d, pts, !!e.closed, cons);
        map.set(e.id, s.id);
        e.pts.forEach((pid, i) => map.set(pid, s.pts[i]));
        // tangent handles are carried by the same motion (a reflection too: they are control points)
        for (const k of ['h0', 'h1'] as const) {
          const h = e[k];
          if (!h || !d.entities.some((q) => q.id === h)) continue;
          const nh = addSplineHandle(d, s.id, k, xf(P(h)));
          if (nh) map.set(h, nh);
        }
        break;
      }
    }
  }
  if (opts.copyConstraints) {
    const snapshot = [...d.constraints];
    // rotated copies can't keep orientation-dependent constraints (H/V, horizontal/vertical dimensions)
    const rotated = !!opts.rotate && Math.abs(Math.sin(opts.rotate)) > 1e-9;
    for (const c of snapshot) {
      if (c.type === 'fix') continue;
      if (rotated && (c.type === 'horizontal' || c.type === 'vertical' || c.type === 'hdistance' || c.type === 'vdistance')) continue;
      if (!c.refs.every((r) => map.has(r))) continue;
      const refs = c.refs.map((r) => map.get(r)!);
      const extra: Partial<SkConstraint> = {};
      if (c.value !== undefined) extra.value = c.value;
      if (c.variant !== undefined) extra.variant = c.variant;
      if (c.labelPos) extra.labelPos = xf(c.labelPos);
      addConstraint(d, c.type, refs, extra);
    }
  }
  return map;
}

function reflectAcross(a: Vec2, b: Vec2): (p: Vec2) => Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  return (p) => {
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    const fx = a[0] + dx * t;
    const fy = a[1] + dy * t;
    return [2 * fx - p[0], 2 * fy - p[1]];
  };
}

/** Mirror entities about a sketch line; copies stay associative through symmetric constraints. */
export function mirrorEntities(d: SketchData, ids: string[], axisId: string): boolean {
  const axis = d.entities.find((e) => e.id === axisId);
  if (!axis || axis.type !== 'line') return false;
  const byId = new Map(d.entities.map((e) => [e.id, e] as const));
  const pa = byId.get(axis.p1);
  const pb = byId.get(axis.p2);
  if (!pa || pa.type !== 'point' || !pb || pb.type !== 'point') return false;
  const roots = patternableIds(d, ids).filter((id) => id !== axisId);
  if (!roots.length) return false;
  const map = copyEntities(d, roots, reflectAcross([pa.x, pa.y], [pb.x, pb.y]), { mirror: true });
  for (const [oldId, newId] of map) {
    const e = byId.get(oldId);
    if (!e) continue;
    if (e.type === 'point') addConstraint(d, 'symmetric', [oldId, newId, axisId]);
    else if (e.type === 'circle') addConstraint(d, 'equal', [oldId, newId]);
  }
  return true;
}

/** Rectangular pattern: copies at i*step1 + j*step2 (i < n1, j < n2, excluding the original). */
export function linearPattern(d: SketchData, ids: string[], step1: Vec2, n1: number, step2: Vec2 = [0, 0], n2 = 1): number {
  let made = 0;
  for (let j = 0; j < n2; j++)
    for (let i = 0; i < n1; i++) {
      if (i === 0 && j === 0) continue;
      const dx = step1[0] * i + step2[0] * j;
      const dy = step1[1] * i + step2[1] * j;
      copyEntities(d, ids, ([x, y]) => [x + dx, y + dy], { copyConstraints: true });
      made++;
    }
  return made;
}

/** Circular pattern about `center`: n instances over `total` radians (equal spacing). */
export function circularPattern(d: SketchData, ids: string[], center: Vec2, n: number, total: number): number {
  const full = Math.abs(Math.abs(total) - 2 * Math.PI) < 1e-9;
  const step = full ? total / n : total / Math.max(n - 1, 1);
  // Points lying on circles/arcs concentric with the pattern keep that relation in every copy
  // (e.g. gear teeth stay on the root circle when its radius changes).
  const byId = new Map(d.entities.map((e) => [e.id, e] as const));
  const concentric = (curveId: string) => {
    const e = byId.get(curveId);
    if (!e || (e.type !== 'circle' && e.type !== 'arc')) return false;
    const c = byId.get(e.c);
    return !!c && c.type === 'point' && Math.hypot(c.x - center[0], c.y - center[1]) < 1e-6 * (1 + Math.hypot(center[0], center[1]));
  };
  const onCircle = d.constraints.filter((k) => k.type === 'coincident' && k.refs.length === 2 && byId.get(k.refs[0])?.type === 'point' && concentric(k.refs[1]));
  // full circles around the pattern centre are rotation-invariant: copying them would stack duplicates
  ids = ids.filter((id) => !(byId.get(id)?.type === 'circle' && concentric(id)));
  if (!ids.length) return 0;
  for (let i = 1; i < n; i++) {
    const a = step * i;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const map = copyEntities(
      d,
      ids,
      ([x, y]) => [center[0] + (x - center[0]) * c - (y - center[1]) * s, center[1] + (x - center[0]) * s + (y - center[1]) * c],
      { rotate: a, copyConstraints: true },
    );
    for (const k of onCircle) {
      const np = map.get(k.refs[0]);
      if (np && !map.has(k.refs[1])) addConstraint(d, 'coincident', [np, k.refs[1]]);
    }
  }
  return n - 1;
}
