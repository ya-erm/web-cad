// Feature builders: each takes the current build state (already cloned) and mutates it.

import * as R from 'replicad';
import { evaluate, evaluateTypedVariable, type EvalContext } from '../core/expr';
import { sketchDims } from '../core/features';
import { frameFromNormal, offsetFrame, rotateVec, v3 } from '../core/math';
import type {
  BoolOp,
  Feature,
  SkConstraint,
  SkEntity,
  FeatureOf,
  MergeScope,
  PlaneFrame,
  SelRef,
  Vec2,
  Vec3,
} from '../core/types';
import { frozenValues, solveSketch } from '../sketch/solver';
import { projectGeometry, updateUsedEntity } from '../sketch/useGeometry';
import { computeRegions } from '../sketch/regions';
import { expandPatterns } from '../sketch/patterns';
import {
  bboxOf,
  compoundOf,
  fail,
  frameToPlane,
  fuseAll,
  isEmptyShape,
  mirrored,
  prism,
  rotated,
  scaled,
  shapesTouch,
  solidsOf,
  sweepFace,
  translated,
  type Shape3D,
} from './geom';
import { topologyOf } from './meshing';
import {
  resolveAxis,
  resolveCurveEdges,
  resolveDirection,
  resolveEdge,
  resolveFace,
  resolveHolePoint,
  locationFrame,
  resolveParts,
  resolvePlaneRef,
  resolvePoint,
  resolveProfiles,
  resolveSketchPlane,
  worldGeometryForRef,
  type ProfileFace,
} from './refs';
import { removePart, setPart, type BuildState, type PartState } from './state';

export interface FeatureOutput {
  /** Tool body used (for preview colouring). */
  tool?: Shape3D;
  op?: BoolOp;
  warning?: string;
}

/** Another Part Studio's last build, for Derived: its state, and its parts' names and colours. */
export interface SourceBuild {
  state: BuildState;
  name(id: string): string;
  color(id: string): string | undefined;
}

/** The last build of a Part Studio by its builder key (the caller builds the sources first). */
export type SourceLookup = (key: string) => SourceBuild | undefined;

interface Ctx {
  st: BuildState;
  ec: EvalContext;
  fid: string;
  sources?: SourceLookup;
}

const DEG = 180 / Math.PI;

function len(ctx: Ctx, s: string, what: string): number {
  try {
    return evaluate(s, 'length', ctx.ec);
  } catch (e) {
    fail(`${what}: ${(e as Error).message}`);
  }
}

function ang(ctx: Ctx, s: string, what: string): number {
  try {
    return evaluate(s, 'angle', ctx.ec);
  } catch (e) {
    fail(`${what}: ${(e as Error).message}`);
  }
}

function num(ctx: Ctx, s: string, what: string): number {
  try {
    return evaluate(s, 'number', ctx.ec);
  } catch (e) {
    fail(`${what}: ${(e as Error).message}`);
  }
}

function count(ctx: Ctx, s: string, what: string): number {
  const n = Math.round(num(ctx, s, what));
  if (!(n >= 1) || n > 500) fail(`${what} must be between 1 and 500`);
  return n;
}

/** Size of the scene used for "through all" extents. */
function sceneExtent(st: BuildState, extra: Shape3D[] = []): number {
  let d = 100;
  const all = [...[...st.parts.values()].map((p) => p.shape), ...extra];
  if (all.length) {
    let lo: Vec3 = [Infinity, Infinity, Infinity];
    let hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const s of all) {
      const [a, b] = bboxOf(s);
      lo = [Math.min(lo[0], a[0]), Math.min(lo[1], a[1]), Math.min(lo[2], a[2])];
      hi = [Math.max(hi[0], b[0]), Math.max(hi[1], b[1]), Math.max(hi[2], b[2])];
    }
    d = Math.max(d, v3.dist(lo, hi), v3.len(lo), v3.len(hi));
  }
  return d * 4;
}

function simplified(s: Shape3D): Shape3D {
  try {
    return s.simplify();
  } catch {
    return s;
  }
}

function newPartId(st: BuildState, base: string): string {
  let id = base;
  let k = 1;
  while (st.parts.has(id) || st.partOrder.includes(id)) id = `${base}.${k++}`;
  return id;
}

/** Replace a part by the solids of `shape`: first keeps the id, others become new parts. */
function replacePart(st: BuildState, id: string, shape: Shape3D, fid: string) {
  const solids = solidsOf(shape);
  if (solids.length === 0) {
    removePart(st, id);
    return;
  }
  setPart(st, id, solids[0]);
  for (let i = 1; i < solids.length; i++) setPart(st, newPartId(st, `${id}~${fid}`), solids[i]);
}

function addNewParts(st: BuildState, shape: Shape3D, fid: string) {
  solidsOf(shape).forEach((s, i) => setPart(st, newPartId(st, `${fid}.${i}`), s));
}

function scopeParts(st: BuildState, scope: MergeScope): PartState[] {
  return scope.mergeAll ? [...st.parts.values()] : resolveParts(st, scope.parts);
}

/** Apply a tool body with a boolean operation (Onshape New/Add/Remove/Intersect semantics). */
export function applyBodyOp(st: BuildState, fid: string, tool: Shape3D, op: BoolOp, scope: MergeScope) {
  if (isEmptyShape(tool)) fail('Feature produced no solid');
  if (op === 'new') {
    addNewParts(st, tool, fid);
    return;
  }
  if (op === 'add') {
    for (const solid of solidsOf(tool)) {
      const targets = scopeParts(st, scope).filter((p) => shapesTouch(p.shape, solid));
      if (targets.length === 0) {
        setPart(st, newPartId(st, `${fid}.0`), solid);
        continue;
      }
      let acc: Shape3D = targets[0].shape.fuse(solid);
      for (let i = 1; i < targets.length; i++) {
        acc = acc.fuse(targets[i].shape);
        removePart(st, targets[i].id);
      }
      replacePart(st, targets[0].id, simplified(acc), fid);
    }
    return;
  }
  const targets = scopeParts(st, scope);
  let touched = 0;
  for (const p of targets) {
    if (!shapesTouch(p.shape, tool)) {
      if (op === 'intersect' && !scope.mergeAll) removePart(st, p.id);
      continue;
    }
    touched++;
    const res = op === 'remove' ? p.shape.cut(tool) : p.shape.intersect(tool);
    replacePart(st, p.id, simplified(res), fid);
  }
  if (touched === 0) fail(op === 'remove' ? 'Nothing to remove: the tool does not touch any part' : 'Nothing to intersect');
}

function recordTool(st: BuildState, fid: string, tool: Shape3D, op: BoolOp) {
  st.tools.set(fid, [{ tool, op }]);
}

// ---------------------------------------------------------------------------
// Sketch & reference geometry
// ---------------------------------------------------------------------------

function buildSketch(ctx: Ctx, f: FeatureOf<'sketch'>): FeatureOutput {
  const frame = resolveSketchPlane(ctx.st, f.params.plane);
  const { dims, errors } = sketchDims(f.params, ctx.ec);
  let entities = f.params.entities;
  let constraints = f.params.constraints;
  let ok = true;
  let lostUse = false;
  // "Use" geometry follows its source: re-project before solving
  if (entities.some((e) => e.use)) {
    entities = JSON.parse(JSON.stringify(entities)) as SkEntity[];
    constraints = JSON.parse(JSON.stringify(constraints)) as SkConstraint[];
    for (const e of entities) {
      if (!e.use) continue;
      try {
        const g = projectGeometry(worldGeometryForRef(ctx.st, e.use), frame);
        if (g && updateUsedEntity(entities, e.id, g)) {
          for (const c of constraints) if (c.type === 'fix' && c.refs[0] === e.id) c.frozen = frozenValues(e.id, entities);
        } else lostUse = true;
      } catch {
        lostUse = true;
      }
    }
  }
  if (constraints.length) {
    const res = solveSketch(entities, constraints, dims, { analyze: false });
    entities = res.entities;
    ok = res.ok;
  }
  // pattern copies are derived from the solved seed geometry
  entities = expandPatterns(entities, f.params.patterns, ctx.ec);
  const regions = computeRegions(entities);
  ctx.st.sketches.set(f.id, { featureId: f.id, frame, entities, regions, ok });
  if (lostUse) return { warning: 'Some projected (Use) geometry could not be found' };
  if (errors.length) return { warning: 'Some dimensions have invalid expressions' };
  if (!ok) return { warning: 'Sketch constraints could not be fully solved' };
  return {};
}

function buildPlane(ctx: Ctx, f: FeatureOf<'plane'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  let frame: PlaneFrame;
  const refs = p.refs;
  switch (p.planeType) {
    case 'offset': {
      if (!refs[0]) fail('Select a plane or planar face');
      const base = resolvePlaneRef(st, refs[0]);
      frame = offsetFrame(base, len(ctx, p.offset, 'Offset') * (p.flip ? -1 : 1));
      break;
    }
    case 'pointNormal': {
      const pt = refs.find((r) => r.kind === 'vertex' || r.kind === 'origin' || (r.kind === 'sketchEntity'));
      const dirRef = refs.find((r) => r !== pt);
      if (!pt || !dirRef) fail('Select a point and a line (normal direction)');
      const n = resolveDirection(st, dirRef);
      frame = frameFromNormal(resolvePoint(st, pt), p.flip ? v3.neg(n) : n);
      break;
    }
    case 'threePoint': {
      if (refs.length < 3) fail('Select three points');
      const [a, b, c] = refs.slice(0, 3).map((r) => resolvePoint(st, r));
      const n = v3.cross(v3.sub(b, a), v3.sub(c, a));
      if (v3.len(n) < 1e-9) fail('Points are collinear');
      frame = frameFromNormal(a, p.flip ? v3.neg(n) : n, v3.sub(b, a));
      break;
    }
    case 'lineAngle': {
      if (!refs[0]) fail('Select a line');
      const axis = resolveAxis(st, refs[0]);
      let ref: Vec3 = Math.abs(axis.dir[2]) < 0.99 ? [0, 0, 1] : [1, 0, 0];
      if (refs[1]) ref = resolvePlaneRef(st, refs[1]).normal;
      // base normal ⟂ line, in the plane spanned by ref and the line
      let n = v3.sub(ref, v3.scale(axis.dir, v3.dot(ref, axis.dir)));
      if (v3.len(n) < 1e-9) n = frameFromNormal(axis.origin, axis.dir).xDir;
      n = rotateVec(v3.norm(n), axis.dir, ang(ctx, p.angle, 'Angle') * (p.flip ? -1 : 1));
      frame = frameFromNormal(axis.origin, n, axis.dir);
      break;
    }
    case 'midplane': {
      if (refs.length < 2) fail('Select two parallel planes or faces');
      const a = resolvePlaneRef(st, refs[0]);
      const b = resolvePlaneRef(st, refs[1]);
      const d = v3.dot(v3.sub(b.origin, a.origin), a.normal);
      frame = offsetFrame(a, d / 2);
      break;
    }
  }
  let size = 0;
  if (p.size.trim()) size = len(ctx, p.size, 'Size');
  if (!(size > 0)) size = Math.min(Math.max(sceneExtent(st) / 8, 30), 2000);
  st.planes.set(f.id, { featureId: f.id, name: f.name, frame, size });
  return {};
}

function buildVariable(ctx: Ctx, f: FeatureOf<'variable'>): FeatureOutput {
  try {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.params.name)) fail('Invalid variable name');
    ctx.st.vars = { ...ctx.st.vars, [f.params.name]: evaluateTypedVariable(f.params.value, f.params.varType, { ...ctx.ec, vars: ctx.st.vars }) };
  } catch (e) {
    fail(`Variable #${f.params.name}: ${(e as Error).message}`);
  }
  return {};
}

function buildHelix(ctx: Ctx, f: FeatureOf<'helix'>): FeatureOutput {
  const p = f.params;
  if (!p.axis[0]) fail('Select an axis (circular edge, cylindrical face or line)');
  const axis = resolveAxis(ctx.st, p.axis[0]);
  let radius = len(ctx, p.radius, 'Radius');
  if (p.axis[0].kind === 'face' || p.axis[0].kind === 'edge') {
    const info = p.axis[0].kind === 'face' ? resolveFace(ctx.st, p.axis[0]).info : resolveEdge(ctx.st, p.axis[0]).info;
    if (info.radius) radius = info.radius;
  }
  const pitch = len(ctx, p.pitch, 'Pitch');
  const turns = num(ctx, p.turns, 'Revolutions');
  const wire = R.makeHelix(pitch, pitch * turns, radius, axis.origin, axis.dir, p.leftHanded);
  const pts: Vec3[] = [];
  const n = Math.max(32, Math.ceil(turns * 48));
  for (let i = 0; i <= n; i++) {
    const v = wire.pointAt(i / n);
    pts.push(v.toTuple());
    v.delete();
  }
  ctx.st.curves.set(f.id, { featureId: f.id, name: f.name, wire, points: pts });
  return {};
}

// ---------------------------------------------------------------------------
// Body features
// ---------------------------------------------------------------------------

function upToDistance(ctx: Ctx, ref: SelRef | undefined, pf: ProfileFace, dir: Vec3): number {
  if (!ref) fail('Select a face or plane to extrude up to');
  const target = ref.kind === 'face' || ref.kind === 'plane' ? resolvePlaneRef(ctx.st, ref) : null;
  if (target) {
    const denom = v3.dot(target.normal, dir);
    if (Math.abs(denom) < 1e-6) fail('Up to face must not be parallel to the extrude direction');
    // distance from profile plane origin along dir to the target plane
    return v3.dot(v3.sub(target.origin, pf.frame.origin), target.normal) / denom;
  }
  const pt = resolvePoint(ctx.st, ref);
  return v3.dot(v3.sub(pt, pf.frame.origin), dir);
}

function buildExtrude(ctx: Ctx, f: FeatureOf<'extrude'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const profiles = resolveProfiles(st, p.profiles);
  if (!profiles.length) fail('Select sketch regions or planar faces to extrude');
  const big = sceneExtent(st);
  const tools: Shape3D[] = [];
  for (const pf of profiles) {
    const dir = p.flip ? v3.neg(pf.frame.normal) : pf.frame.normal;
    let start = 0;
    let end = 0;
    switch (p.endType) {
      case 'blind':
        end = len(ctx, p.depth, 'Depth');
        break;
      case 'symmetric': {
        const d = len(ctx, p.depth, 'Depth');
        start = -d / 2;
        end = d / 2;
        break;
      }
      case 'throughAll':
        end = big;
        if (!p.secondEnd) start = 0;
        break;
      case 'upToFace':
        end = upToDistance(ctx, p.upTo[0], pf, dir);
        break;
    }
    if (p.secondEnd && p.endType !== 'symmetric') {
      switch (p.endType2) {
        case 'blind':
          start = -len(ctx, p.depth2, 'Second depth');
          break;
        case 'throughAll':
          start = -big;
          break;
        case 'upToFace':
          start = upToDistance(ctx, p.upTo2[0], pf, dir);
          break;
      }
    }
    if (Math.abs(end - start) < 1e-9) fail('Extrude depth must not be zero');
    let solid = prism(pf.face, dir, start, end);
    if (p.thin) {
      const t = len(ctx, p.thickness, 'Thickness');
      const outer = () => R.cast(R.getOC().BRepTools.OuterWire(pf.face.wrapped)) as R.Wire;
      // offset2D deletes its receiver, so each use gets a fresh wire
      const offSolid = prism(R.makeFace(outer().offset2D(p.thinFlip ? t : -t)), dir, start, end);
      const outerSolid = prism(R.makeFace(outer()), dir, start, end);
      solid = p.thinFlip ? offSolid.cut(outerSolid) : outerSolid.cut(offSolid);
    }
    if (p.draft) {
      const a = ang(ctx, p.draftAngle, 'Draft angle') * (p.draftFlip ? -1 : 1);
      solid = draftSides(solid, pf.frame, dir, a);
    }
    tools.push(solid);
  }
  const tool = fuseAll(tools);
  recordTool(st, ctx.fid, tool, p.op);
  applyBodyOp(st, ctx.fid, tool, p.op, p);
  return { tool, op: p.op };
}

/** Draft all side faces of an extruded solid (faces not parallel to the profile plane). */
function draftSides(solid: Shape3D, frame: PlaneFrame, dir: Vec3, angleRad: number): Shape3D {
  const oc = R.getOC();
  const builder = new oc.BRepOffsetAPI_DraftAngle(solid.wrapped);
  const pln = R.makePln(frame.origin, frame.normal);
  const d = R.asDir(dir);
  let added = 0;
  for (const face of solid.faces) {
    if (face.geomType === 'PLANE') {
      const n = face.normalAt();
      const parallel = Math.abs(v3.dot(n.toTuple(), frame.normal)) > 1 - 1e-6;
      n.delete();
      if (parallel) continue;
    }
    builder.Add(face.wrapped, d, -angleRad, pln, true);
    added++;
  }
  if (!added) return solid;
  builder.Build(new oc.Message_ProgressRange());
  if (!builder.IsDone()) fail('Draft failed');
  const res = R.cast(builder.Shape()) as Shape3D;
  builder.delete();
  return res;
}

function buildRevolve(ctx: Ctx, f: FeatureOf<'revolve'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const profiles = resolveProfiles(st, p.profiles);
  if (!profiles.length) fail('Select sketch regions or planar faces to revolve');
  if (!p.axis[0]) fail('Select a revolve axis');
  const axis = resolveAxis(st, p.axis[0]);
  let dir = p.flip ? v3.neg(axis.dir) : axis.dir;
  let start = 0;
  let sweep = 360;
  switch (p.revolveType) {
    case 'full':
      break;
    case 'one':
      sweep = ang(ctx, p.angle, 'Angle') * DEG;
      break;
    case 'symmetric':
      sweep = ang(ctx, p.angle, 'Angle') * DEG;
      start = -sweep / 2;
      break;
    case 'two': {
      const a2 = ang(ctx, p.angle2, 'Second angle') * DEG;
      sweep = ang(ctx, p.angle, 'Angle') * DEG + a2;
      start = -a2;
      break;
    }
  }
  if (Math.abs(sweep) < 1e-6) fail('Angle must not be zero');
  if (sweep < 0) {
    dir = v3.neg(dir);
    sweep = -sweep;
    start = -start;
  }
  sweep = Math.min(sweep, 360);
  const tools = profiles.map((pf) => {
    let face: R.Face = pf.face;
    if (Math.abs(start) > 1e-9) face = R.cast(R.rotate(face.wrapped, start, axis.origin, dir)) as R.Face;
    return R.revolution(face, axis.origin, dir, sweep);
  });
  const tool = fuseAll(tools);
  recordTool(st, ctx.fid, tool, p.op);
  applyBodyOp(st, ctx.fid, tool, p.op, p);
  return { tool, op: p.op };
}

/** Chain edges into an ordered wire. */
function chainWire(edges: R.Edge[]): R.Wire {
  if (edges.length === 1) return R.assembleWire(edges.map((e) => e.clone()));
  const remaining = edges.map((e) => ({ e, s: e.startPoint.toTuple(), t: e.endPoint.toTuple() }));
  const ordered = [remaining.shift()!];
  const tol = 1e-5;
  let changed = true;
  while (remaining.length && changed) {
    changed = false;
    const head = ordered[0];
    const tail = ordered[ordered.length - 1];
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      const near = (a: Vec3, b: Vec3) => v3.dist(a, b) < tol * Math.max(1, v3.len(a));
      if (near(r.s, tail.t) || near(r.t, tail.t) || near(r.s, tail.s) || near(r.t, tail.s)) {
        ordered.push(r);
        remaining.splice(i, 1);
        changed = true;
        break;
      }
      if (near(r.t, head.s) || near(r.s, head.s)) {
        ordered.unshift(r);
        remaining.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  if (remaining.length) fail('Path edges must be connected');
  return R.assembleWire(ordered.map((o) => o.e.clone()));
}

function buildSweep(ctx: Ctx, f: FeatureOf<'sweep'>): FeatureOutput {
  const p = f.params;
  const profiles = resolveProfiles(ctx.st, p.profiles);
  if (!profiles.length) fail('Select profiles to sweep');
  if (!p.path.length) fail('Select a sweep path');
  const edges = p.path.flatMap((r) => resolveCurveEdges(ctx.st, r));
  const spine = chainWire(edges);
  const tool = fuseAll(profiles.map((pf) => sweepFace(pf.face, spine, p.keepOrientation)));
  recordTool(ctx.st, ctx.fid, tool, p.op);
  applyBodyOp(ctx.st, ctx.fid, tool, p.op, p);
  return { tool, op: p.op };
}

function buildLoft(ctx: Ctx, f: FeatureOf<'loft'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const wires: R.Wire[] = [];
  let startPoint: Vec3 | undefined;
  let endPoint: Vec3 | undefined;
  p.profiles.forEach((r, i) => {
    if (r.kind === 'region' || r.kind === 'face') {
      const [pf] = resolveProfiles(st, [r]);
      wires.push(R.cast(R.getOC().BRepTools.OuterWire(pf.face.wrapped)) as R.Wire);
    } else {
      const pt = resolvePoint(st, r);
      if (i === 0) startPoint = pt;
      else endPoint = pt;
    }
  });
  if (wires.length + (startPoint ? 1 : 0) + (endPoint ? 1 : 0) < 2) fail('Select at least two profiles');
  const tool = R.loft(wires, { ruled: p.ruled, startPoint, endPoint });
  recordTool(st, ctx.fid, tool, p.op);
  applyBodyOp(st, ctx.fid, tool, p.op, p);
  return { tool, op: p.op };
}

function buildThicken(ctx: Ctx, f: FeatureOf<'thicken'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const t = len(ctx, p.thickness, 'Thickness') * (p.flip ? -1 : 1);
  const tools: Shape3D[] = [];
  for (const r of p.faces) {
    if (r.kind === 'region') {
      const [pf] = resolveProfiles(st, [r]);
      tools.push(prism(pf.face, pf.frame.normal, 0, t));
    } else if (r.kind === 'face') {
      const { face, info } = resolveFace(st, r);
      if (info.type === 'PLANE' && info.normal) tools.push(prism(face, info.normal, 0, t));
      else {
        const oc = R.getOC();
        const b = new oc.BRepOffsetAPI_MakeThickSolid();
        b.MakeThickSolidBySimple(face.wrapped, t);
        b.Build(new oc.Message_ProgressRange());
        tools.push(R.cast(b.Shape()) as Shape3D);
        b.delete();
      }
    }
  }
  if (!tools.length) fail('Select faces or sketch regions to thicken');
  const tool = fuseAll(tools);
  recordTool(st, ctx.fid, tool, p.op);
  applyBodyOp(st, ctx.fid, tool, p.op, p);
  return { tool, op: p.op };
}

// ---------------------------------------------------------------------------
// Edge / face modifications
// ---------------------------------------------------------------------------

/** Group selected edges by part (faces contribute all their edges). */
function edgesByPart(st: BuildState, refs: SelRef[]): Map<string, { part: PartState; edges: R.Edge[] }> {
  const out = new Map<string, { part: PartState; edges: R.Edge[] }>();
  const add = (part: PartState, e: R.Edge) => {
    let g = out.get(part.id);
    if (!g) out.set(part.id, (g = { part, edges: [] }));
    if (!g.edges.some((x) => x.isSame(e))) g.edges.push(e);
  };
  for (const r of refs) {
    if (r.kind === 'edge') {
      const { part, edge } = resolveEdge(st, r);
      add(part, edge);
    } else if (r.kind === 'face') {
      const { part, face } = resolveFace(st, r);
      const topo = topologyOf(part.shape);
      for (const fe of face.edges) {
        const e = topo.edges.find((x) => x.isSame(fe));
        if (e) add(part, e);
      }
    }
  }
  return out;
}

function adjacentFaces(shape: Shape3D, edge: R.Edge): R.Face[] {
  return topologyOf(shape).faces.filter((f) => f.edges.some((e) => e.isSame(edge)));
}

function buildFillet(ctx: Ctx, f: FeatureOf<'fillet'>): FeatureOutput {
  const p = f.params;
  const r = len(ctx, p.radius, 'Radius');
  if (!(r > 0)) fail('Radius must be positive');
  const groups = edgesByPart(ctx.st, p.edges);
  if (!groups.size) fail('Select edges or faces to fillet');
  const oc = R.getOC();
  let propagated = false;
  for (const { part, edges } of groups.values()) {
    const mk = new oc.BRepFilletAPI_MakeFillet(part.shape.wrapped, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    for (const e of edges) mk.Add(r, e.wrapped);
    const extra = p.tangentPropagation ? [] : contoursBeyond(mk, edges);
    try {
      mk.Build(new oc.Message_ProgressRange());
    } catch {
      fail('Fillet failed: radius may be too large');
    }
    if (!mk.IsDone()) fail('Fillet failed: radius may be too large');
    let res = R.cast(mk.Shape()) as Shape3D;
    mk.delete();
    if (extra.length) {
      const own = onlySelected(part.shape, res, edges, extra);
      if (own) res = own;
      else propagated = true;
    }
    replacePart(ctx.st, part.id, res, ctx.fid);
  }
  return propagated ? { warning: TANGENT_ALWAYS } : {};
}

/** When the blend cannot be stopped at the selected edges, the whole tangent chain stays. */
const TANGENT_ALWAYS = 'Edges tangent to the selected ones are included too: the blend could not be stopped at the selected edges';

/** The edges the contours built from the selected ones run on to (tangent to them, not selected). */
function contoursBeyond(mk: { NbContours(): number; NbEdges(i: number): number; Edge(i: number, j: number): R.Edge['wrapped'] }, edges: R.Edge[]): R.Edge[] {
  const out: R.Edge[] = [];
  for (let i = 1; i <= mk.NbContours(); i++)
    for (let j = 1; j <= mk.NbEdges(i); j++) {
      const e = mk.Edge(i, j);
      if (!edges.some((s) => s.wrapped.IsSame(e))) out.push(R.cast(e) as R.Edge);
    }
  return out;
}

/**
 * A fillet / chamfer of the selected edges only (Onshape with "Tangent propagation" off). OpenCascade always runs
 * the blend on along tangent edges, so it is built for the whole chain, and then only the material it takes away
 * (or adds, on concave edges) next to the selected edges is kept: cut off by the planes square to each selected
 * edge at its ends — where a blend of that edge alone stops. `null` when that fails.
 */
function onlySelected(shape: Shape3D, blended: Shape3D, selected: R.Edge[], extra: R.Edge[]): Shape3D | null {
  const [lo, hi] = bboxOf(shape);
  const size = Math.max(v3.dist(lo, hi), 1) * 4;
  const at = (e: R.Edge, s: number): Vec3 => e.pointAt(s).toTuple() as Vec3;
  const along = (e: R.Edge, s: number): Vec3 => v3.norm(e.tangentAt(s).toTuple() as Vec3);
  try {
    const keep = (diff: Shape3D): Shape3D[] => {
      const out: Shape3D[] = [];
      for (const c of solidsOf(diff)) {
        const mine = selected.filter((e) => touches(c, at(e, 0.5)));
        if (!mine.length) continue;
        // a chain with every edge selected stays whole
        if (!extra.some((e) => touches(c, at(e, 0.5)))) {
          out.push(c);
          continue;
        }
        for (const e of mine)
          for (const [s0, s1] of spansOf(along.bind(null, e))) {
            const piece = c.intersect(halfSpace(at(e, s0), along(e, s0), size)).intersect(halfSpace(at(e, s1), v3.neg(along(e, s1)), size));
            for (const q of solidsOf(piece)) if (touches(q, at(e, (s0 + s1) / 2))) out.push(q);
          }
      }
      return out;
    };
    const removed = keep(shape.cut(blended));
    const added = keep(blended.cut(shape));
    if (!removed.length && !added.length) return null;
    let res: Shape3D = shape;
    if (removed.length) res = res.cut(fuseAll(removed));
    if (added.length) res = res.fuse(fuseAll(added));
    res = simplified(res);
    return solidsOf(res).length ? res : null;
  } catch {
    return null;
  }
}

/** Parts of an edge (0…1) along which its direction turns by less than 120°: each is cut off by two planes. */
function spansOf(along: (s: number) => Vec3, s0 = 0, s1 = 1, depth = 0): [number, number][] {
  const t0 = along(s0);
  const bends = [1, 2, 3, 4, 5, 6, 7, 8].some((k) => v3.dot(t0, along(s0 + ((s1 - s0) * k) / 8)) < -0.5);
  if (!bends || depth > 4) return [[s0, s1]];
  const m = (s0 + s1) / 2;
  return [...spansOf(along, s0, m, depth + 1), ...spansOf(along, m, s1, depth + 1)];
}

/** The half-space on the side `n` points to from the plane through `p` (a box of `size`). */
function halfSpace(p: Vec3, n: Vec3, size: number): Shape3D {
  const u = v3.norm(v3.cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const w = v3.cross(n, u);
  const c = (a: number, b: number) => v3.add(p, v3.add(v3.scale(u, a * size), v3.scale(w, b * size)));
  return prism(R.makePolygon([c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)]), n, 0, size);
}

/** Whether a point lies on (or in) a solid. */
function touches(s: Shape3D, p: Vec3): boolean {
  const oc = R.getOC();
  const v = R.makeVertex(p);
  const d = new oc.BRepExtrema_DistShapeShape(s.wrapped, v.wrapped);
  const near = d.IsDone() && d.Value() < 1e-4 * Math.max(1, v3.len(p)) + 1e-4;
  d.delete();
  v.delete();
  return near;
}

function buildChamfer(ctx: Ctx, f: FeatureOf<'chamfer'>): FeatureOutput {
  const p = f.params;
  const d1 = len(ctx, p.distance, 'Distance');
  const groups = edgesByPart(ctx.st, p.edges);
  if (!groups.size) fail('Select edges or faces to chamfer');
  const oc = R.getOC();
  let propagated = false;
  for (const { part, edges } of groups.values()) {
    const mk = new oc.BRepFilletAPI_MakeChamfer(part.shape.wrapped);
    for (const e of edges) {
      if (p.chamferType === 'equal') {
        mk.Add(d1, e.wrapped);
        continue;
      }
      const faces = adjacentFaces(part.shape, e);
      if (!faces.length) fail('Chamfer edge has no adjacent face');
      const face = faces[p.flip && faces.length > 1 ? 1 : 0];
      if (p.chamferType === 'twoDistances') mk.Add(d1, len(ctx, p.distance2, 'Distance 2'), e.wrapped, face.wrapped);
      else mk.AddDA(d1, ang(ctx, p.angle, 'Angle'), e.wrapped, face.wrapped);
    }
    const extra = p.tangentPropagation ? [] : contoursBeyond(mk, edges);
    try {
      mk.Build(new oc.Message_ProgressRange());
    } catch {
      fail('Chamfer failed: distance may be too large');
    }
    if (!mk.IsDone()) fail('Chamfer failed: distance may be too large');
    let res = R.cast(mk.Shape()) as Shape3D;
    mk.delete();
    if (extra.length) {
      const own = onlySelected(part.shape, res, edges, extra);
      if (own) res = own;
      else propagated = true;
    }
    replacePart(ctx.st, part.id, res, ctx.fid);
  }
  return propagated ? { warning: TANGENT_ALWAYS } : {};
}

function buildShell(ctx: Ctx, f: FeatureOf<'shell'>): FeatureOutput {
  const p = f.params;
  const t = len(ctx, p.thickness, 'Thickness');
  if (!(t > 0)) fail('Thickness must be positive');
  const byPart = new Map<string, { part: PartState; faces: R.Face[] }>();
  for (const r of p.faces) {
    if (r.kind === 'face') {
      const { part, face } = resolveFace(ctx.st, r);
      const g = byPart.get(part.id) ?? { part, faces: [] };
      g.faces.push(face);
      byPart.set(part.id, g);
    } else if (r.kind === 'part') {
      const part = ctx.st.parts.get(r.partId);
      if (part && !byPart.has(part.id)) byPart.set(part.id, { part, faces: [] });
    }
  }
  if (!byPart.size) fail('Select faces to remove (or a part to hollow)');
  const oc = R.getOC();
  for (const { part, faces } of byPart.values()) {
    const list = new oc.NCollection_List_TopoDS_Shape();
    faces.forEach((fc) => list.Append(fc.wrapped));
    const b = new oc.BRepOffsetAPI_MakeThickSolid();
    b.MakeThickSolidByJoin(
      part.shape.wrapped,
      list,
      p.outward ? t : -t,
      1e-3,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
      false,
      new oc.Message_ProgressRange(),
    );
    if (!b.IsDone()) fail('Shell failed: thickness may be too large');
    const res = R.cast(b.Shape()) as Shape3D;
    b.delete();
    list.delete();
    replacePart(ctx.st, part.id, res, ctx.fid);
  }
  return {};
}

function buildDraft(ctx: Ctx, f: FeatureOf<'draft'>): FeatureOutput {
  const p = f.params;
  if (!p.neutral[0]) fail('Select a neutral plane');
  const frame = resolvePlaneRef(ctx.st, p.neutral[0]);
  const a = ang(ctx, p.angle, 'Angle') * (p.flip ? -1 : 1);
  const byPart = new Map<string, { part: PartState; faces: R.Face[] }>();
  for (const r of p.faces) {
    const { part, face } = resolveFace(ctx.st, r);
    const g = byPart.get(part.id) ?? { part, faces: [] };
    g.faces.push(face);
    byPart.set(part.id, g);
  }
  if (!byPart.size) fail('Select faces to draft');
  const oc = R.getOC();
  for (const { part, faces } of byPart.values()) {
    const b = new oc.BRepOffsetAPI_DraftAngle(part.shape.wrapped);
    const pln = R.makePln(frame.origin, frame.normal);
    const d = R.asDir(frame.normal);
    for (const fc of faces) b.Add(fc.wrapped, d, a, pln, true);
    b.Build(new oc.Message_ProgressRange());
    if (!b.IsDone()) fail('Draft failed for the selected faces');
    const res = R.cast(b.Shape()) as Shape3D;
    b.delete();
    replacePart(ctx.st, part.id, res, ctx.fid);
  }
  return {};
}

function holeTool(ctx: Ctx, f: FeatureOf<'hole'>, p0: Vec3, drill: Vec3, big: number): Shape3D {
  const p = f.params;
  const R0 = len(ctx, p.diameter, 'Diameter') / 2;
  if (!(R0 > 0)) fail('Diameter must be positive');
  const through = p.endType === 'throughAll';
  const depth = through ? big : len(ctx, p.depth, 'Depth');
  const tip = ang(ctx, p.tipAngle, 'Tip angle');
  const eps = Math.max(R0 * 0.02, 0.01);
  // profile in (r, z) with z along -drill (z <= 0 is inside material)
  const pts: Vec2[] = [[0, eps]];
  if (p.style === 'counterbore') {
    const Rc = len(ctx, p.cboreDiameter, 'Counterbore diameter') / 2;
    const dc = len(ctx, p.cboreDepth, 'Counterbore depth');
    if (Rc <= R0) fail('Counterbore diameter must exceed the hole diameter');
    pts.push([Rc, eps], [Rc, -dc], [R0, -dc]);
  } else if (p.style === 'countersink') {
    const Rs = len(ctx, p.csinkDiameter, 'Countersink diameter') / 2;
    const a = ang(ctx, p.csinkAngle, 'Countersink angle');
    if (Rs <= R0) fail('Countersink diameter must exceed the hole diameter');
    const h = (Rs - R0) / Math.tan(a / 2);
    pts.push([Rs + eps * Math.tan(a / 2), eps], [R0, -h]);
  } else {
    pts.push([R0, eps]);
  }
  pts.push([R0, -depth]);
  if (!through && tip > 0 && tip < Math.PI) pts.push([0, -depth - R0 / Math.tan(tip / 2)]);
  else pts.push([0, -depth]);
  const frame = frameFromNormal(p0, drill);
  // local 2D (u along frame.xDir = radial, v along -drill)
  const W = ([r, z]: Vec2): Vec3 => v3.add(p0, v3.add(v3.scale(frame.xDir, r), v3.scale(drill, -z)));
  const edges: R.Edge[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) edges.push(R.makeLine(W(a), W(b)));
  }
  const face = R.makeFace(R.assembleWire(edges));
  return R.revolution(face, p0, drill, 360);
}

function buildHole(ctx: Ctx, f: FeatureOf<'hole'>): FeatureOutput {
  const p = f.params;
  if (!p.points.length) fail('Select sketch points for hole locations');
  const big = sceneExtent(ctx.st);
  const tools = p.points.map((r) => {
    const { p: pt, n } = resolveHolePoint(ctx.st, r);
    return holeTool(ctx, f, pt, v3.neg(n), big);
  });
  const tool = tools.length === 1 ? tools[0] : compoundOf(tools);
  recordTool(ctx.st, ctx.fid, tool, 'remove');
  applyBodyOp(ctx.st, ctx.fid, tool, 'remove', { mergeAll: p.scopeAll, parts: p.scope });
  return { tool, op: 'remove' };
}

// ---------------------------------------------------------------------------
// Patterns & transforms
// ---------------------------------------------------------------------------

type Xform = (s: Shape3D) => Shape3D;

function patternInstances(
  ctx: Ctx,
  kind: 'part' | 'feature' | 'face',
  parts: SelRef[],
  features: string[],
  xforms: Xform[],
  op: 'new' | 'add',
) {
  const st = ctx.st;
  if (kind === 'face') fail('Face patterns are not supported yet — use a feature pattern');
  if (kind === 'part') {
    const src = resolveParts(st, parts);
    if (!src.length) fail('Select parts to pattern');
    xforms.forEach((x, i) => {
      for (const part of src) {
        const copy = x(part.shape);
        if (op === 'add') {
          const cur = st.parts.get(part.id);
          if (cur) setPart(st, part.id, simplified(cur.shape.fuse(copy)));
        } else {
          setPart(st, newPartId(st, `${part.id}@${ctx.fid}.${i + 1}`), copy);
        }
      }
    });
    return;
  }
  const records = features.flatMap((fid) => st.tools.get(fid) ?? []);
  if (!records.length) fail('Select extrude, revolve, sweep, loft or hole features to pattern');
  xforms.forEach((x) => {
    for (const rec of records) applyBodyOp(st, ctx.fid, x(rec.tool), rec.op, { mergeAll: true, parts: [] });
  });
}

function buildLinearPattern(ctx: Ctx, f: FeatureOf<'linearPattern'>): FeatureOutput {
  const p = f.params;
  if (!p.direction[0]) fail('Select a direction (edge, line or face)');
  const d1 = v3.scale(resolveDirection(ctx.st, p.direction[0]), p.flip ? -1 : 1);
  const n1 = count(ctx, p.count, 'Instance count');
  const s1 = len(ctx, p.distance, 'Distance');
  let d2: Vec3 = [0, 0, 0];
  let n2 = 1;
  let s2 = 0;
  if (p.secondDir) {
    if (!p.direction2[0]) fail('Select the second direction');
    d2 = v3.scale(resolveDirection(ctx.st, p.direction2[0]), p.flip2 ? -1 : 1);
    n2 = count(ctx, p.count2, 'Second instance count');
    s2 = len(ctx, p.distance2, 'Second distance');
  }
  const xforms: Xform[] = [];
  for (let j = 0; j < n2; j++)
    for (let i = 0; i < n1; i++) {
      if (i === 0 && j === 0) continue;
      const v = v3.add(v3.scale(d1, s1 * i), v3.scale(d2, s2 * j));
      xforms.push((s) => translated(s, v));
    }
  patternInstances(ctx, p.patternType, p.parts, p.features, xforms, p.op);
  return {};
}

function buildCircularPattern(ctx: Ctx, f: FeatureOf<'circularPattern'>): FeatureOutput {
  const p = f.params;
  if (!p.axis[0]) fail('Select an axis');
  const axis = resolveAxis(ctx.st, p.axis[0]);
  const dir = p.flip ? v3.neg(axis.dir) : axis.dir;
  const n = count(ctx, p.count, 'Instance count');
  const total = ang(ctx, p.angle, 'Angle') * DEG;
  const full = Math.abs(Math.abs(total) - 360) < 1e-6;
  const step = p.equalSpacing ? (full ? total / n : total / Math.max(n - 1, 1)) : total;
  const xforms: Xform[] = [];
  for (let i = 1; i < n; i++) xforms.push((s) => rotated(s, step * i, axis.origin, dir));
  patternInstances(ctx, p.patternType, p.parts, p.features, xforms, p.op);
  return {};
}

function buildMirror(ctx: Ctx, f: FeatureOf<'mirror'>): FeatureOutput {
  const p = f.params;
  if (!p.plane[0]) fail('Select a mirror plane');
  const fr = resolvePlaneRef(ctx.st, p.plane[0]);
  patternInstances(ctx, p.patternType, p.parts, p.features, [(s) => mirrored(s, fr.origin, fr.normal)], p.op);
  return {};
}

function buildBoolean(ctx: Ctx, f: FeatureOf<'boolean'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const tools = resolveParts(st, p.tools);
  if (!tools.length) fail('Select tool parts');
  if (p.op === 'union') {
    if (tools.length < 2) fail('Select at least two parts to union');
    const acc = fuseAll(tools.map((t) => t.shape));
    tools.slice(1).forEach((t) => removePart(st, t.id));
    replacePart(st, tools[0].id, acc, ctx.fid);
  } else if (p.op === 'subtract') {
    const targets = resolveParts(st, p.targets).filter((t) => !tools.some((x) => x.id === t.id));
    if (!targets.length) fail('Select target parts');
    const tool = fuseAll(tools.map((t) => t.shape));
    for (const t of targets) replacePart(st, t.id, simplified(t.shape.cut(tool)), ctx.fid);
    if (!p.keepTools) tools.forEach((t) => removePart(st, t.id));
  } else {
    if (tools.length < 2) fail('Select at least two parts to intersect');
    let acc: Shape3D = tools[0].shape;
    for (let i = 1; i < tools.length; i++) acc = acc.intersect(tools[i].shape);
    if (isEmptyShape(acc)) fail('Parts do not intersect');
    tools.slice(1).forEach((t) => removePart(st, t.id));
    replacePart(st, tools[0].id, simplified(acc), ctx.fid);
  }
  return {};
}

function buildSplit(ctx: Ctx, f: FeatureOf<'split'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const parts = resolveParts(st, p.parts);
  if (!parts.length) fail('Select parts to split');
  if (!p.tool[0]) fail('Select a plane or planar face to split with');
  const fr = resolvePlaneRef(st, p.tool[0]);
  const plane = frameToPlane(fr);
  let splitAny = false;
  for (const part of parts) {
    const res = part.shape.split(plane);
    const pos = res.positive ? solidsOf(res.positive) : [];
    const neg = res.negative ? solidsOf(res.negative) : [];
    if (!pos.length || !neg.length) continue;
    splitAny = true;
    replacePart(st, part.id, compoundOf(pos), ctx.fid);
    neg.forEach((s, i) => setPart(st, newPartId(st, `${part.id}~${ctx.fid}.${i}`), s));
  }
  if (!splitAny) fail('The split tool does not intersect the selected parts');
  return {};
}

function buildTransform(ctx: Ctx, f: FeatureOf<'transform'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const parts = resolveParts(st, p.parts);
  if (!parts.length) fail('Select parts to transform');
  let x: Xform;
  // the same motion applied to a point (moves the mate connectors owned by the parts)
  let pt: (q: Vec3) => Vec3;
  switch (p.mode) {
    case 'translateEntity': {
      if (!p.direction[0]) fail('Select a direction');
      const d = v3.scale(resolveDirection(st, p.direction[0]), len(ctx, p.distance, 'Distance') * (p.flip ? -1 : 1));
      x = (s) => translated(s, d);
      pt = (q) => v3.add(q, d);
      break;
    }
    case 'translateXYZ': {
      const d: Vec3 = [len(ctx, p.dx, 'X'), len(ctx, p.dy, 'Y'), len(ctx, p.dz, 'Z')];
      x = (s) => translated(s, d);
      pt = (q) => v3.add(q, d);
      break;
    }
    case 'rotate': {
      if (!p.axis[0]) fail('Select an axis');
      const a = resolveAxis(st, p.axis[0]);
      const rad = ang(ctx, p.angle, 'Angle') * (p.flip ? -1 : 1);
      x = (s) => rotated(s, rad * DEG, a.origin, a.dir);
      pt = (q) => v3.add(a.origin, rotateVec(v3.sub(q, a.origin), v3.norm(a.dir), rad));
      break;
    }
    case 'scale': {
      const k = num(ctx, p.scale, 'Scale');
      if (!(k > 0)) fail('Scale must be positive');
      const c = p.point[0] ? resolvePoint(st, p.point[0]) : ([0, 0, 0] as Vec3);
      x = (s) => scaled(s, k, c);
      pt = (q) => v3.add(c, v3.scale(v3.sub(q, c), k));
      break;
    }
    case 'mates': {
      if (!p.fromMate?.[0] || !p.toMate?.[0]) fail('Select the mate connector to move and the one to move it to');
      const a = resolvePlaneRef(st, p.fromMate[0]);
      const b = resolvePlaneRef(st, p.toMate[0]);
      x = (s) => frameToFrame(s, a, b);
      pt = (q) => {
        const r = v3.sub(q, a.origin);
        const u = [v3.dot(r, a.xDir), v3.dot(r, a.yDir), v3.dot(r, a.normal)];
        return v3.add(b.origin, v3.add(v3.scale(b.xDir, u[0]), v3.add(v3.scale(b.yDir, u[1]), v3.scale(b.normal, u[2]))));
      };
      break;
    }
    default:
      fail('Unknown transform type');
  }
  for (const part of parts) {
    const res = x(part.shape);
    if (p.copy) setPart(st, newPartId(st, `${part.id}@${ctx.fid}`), res);
    else setPart(st, part.id, res);
  }
  if (!p.copy) {
    // mate connectors follow their owner parts
    const moved = new Set(parts.map((q) => q.id));
    for (const [id, m] of st.mates) if (m.owner && moved.has(m.owner)) st.mates.set(id, { ...m, frame: movedFrame(m.frame, pt) });
  }
  return {};
}

/** A frame carried by a point motion (rigid or uniform scale): origin moved, axes re-derived. */
function movedFrame(f: PlaneFrame, pt: (q: Vec3) => Vec3): PlaneFrame {
  const o = pt(f.origin);
  const dir = (d: Vec3) => v3.norm(v3.sub(pt(v3.add(f.origin, d)), o));
  return { origin: o, xDir: dir(f.xDir), yDir: dir(f.yDir), normal: dir(f.normal) };
}

/** Rigid motion taking frame `a` onto frame `b` (origins and all three axes). */
function frameToFrame(s: Shape3D, a: PlaneFrame, b: PlaneFrame): Shape3D {
  // R = B · Aᵀ with the frames' axes as columns
  const A = [a.xDir, a.yDir, a.normal];
  const B = [b.xDir, b.yDir, b.normal];
  const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => A.reduce((sum, ax, k) => sum + B[k][i] * ax[j], 0)));
  const tr = R[0][0] + R[1][1] + R[2][2];
  const angle = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
  let out = s;
  if (angle > 1e-9) {
    let axis: Vec3 = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
    if (v3.len(axis) < 1e-6) {
      // 180°: the axis is the dominant column of (R + I) / 2
      const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (R[i][j] + (i === j ? 1 : 0)) / 2));
      const col = [0, 1, 2].reduce((best, j) => (M[j][j] > M[best][best] ? j : best), 0);
      axis = [M[0][col], M[1][col], M[2][col]];
    }
    out = rotated(out, angle * DEG, a.origin, v3.norm(axis));
  }
  const t = v3.sub(b.origin, a.origin);
  return v3.len(t) > 1e-12 ? translated(out, t) : out;
}

/** Mate connector: a local coordinate system stored with the build state (referenced like a plane). */
function buildMateConnector(ctx: Ctx, f: FeatureOf<'mateConnector'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  if (!p.location[0]) fail('Select where to place the mate connector');
  const loc = locationFrame(st, p.location[0], p.inference ?? 'default', p.orientFace?.[0]);
  if (p.mode === 'between') {
    // halfway between two inference points; the axes come from the first one
    if (!p.location2?.[0]) fail('Select the second entity');
    const loc2 = locationFrame(st, p.location2[0], p.inference2 ?? 'default', p.orientFace2?.[0]);
    loc.origin = v3.scale(v3.add(loc.origin, loc2.origin), 0.5);
  }
  let z = v3.norm(loc.z);
  let xHint = loc.x;
  // realign → flip → reorient → rotate → move (Onshape order)
  if (p.primaryAxis[0]) {
    z = v3.norm(resolveDirection(st, p.primaryAxis[0]));
    xHint = undefined;
  }
  if (p.secondaryAxis[0]) xHint = resolveDirection(st, p.secondaryAxis[0]);
  if (p.flipPrimary) z = v3.neg(z);
  let x = xHint ? v3.sub(xHint, v3.scale(z, v3.dot(xHint, z))) : null;
  x = x && v3.len(x) > 1e-9 ? v3.norm(x) : frameFromNormal(loc.origin, z).xDir;
  if (p.reorient === 'x') {
    // primary axis onto the former X (a quarter turn about Y)
    [z, x] = [x, v3.neg(z)];
  } else if (p.reorient === 'y') {
    // primary axis onto the former Y (a quarter turn about X); X stays
    z = v3.cross(z, x);
  }
  const rot = ang(ctx, p.rotation, 'Rotation');
  if (rot) x = v3.norm(rotateVec(x, z, rot));
  const y = v3.cross(z, x);
  const o = v3.add(
    loc.origin,
    v3.add(v3.scale(x, len(ctx, p.dx, 'X')), v3.add(v3.scale(y, len(ctx, p.dy, 'Y')), v3.scale(z, len(ctx, p.dz, 'Z')))),
  );
  // owner part: the chosen one, else the part of the location (or the owner of a location connector)
  const ownerRef = p.ownerPart?.[0] ?? p.location[0];
  const owner =
    resolveParts(st, [ownerRef])[0]?.id ?? (ownerRef.kind === 'plane' ? st.mates.get(ownerRef.planeId)?.owner : undefined);
  if (p.ownerPart?.[0] && !owner) fail('Referenced part no longer exists');
  st.mates.set(f.id, { featureId: f.id, name: f.name, frame: { origin: o, xDir: x, yDir: y, normal: z }, owner });
  return {};
}

function buildDeletePart(ctx: Ctx, f: FeatureOf<'deletePart'>): FeatureOutput {
  const parts = resolveParts(ctx.st, f.params.parts);
  if (!parts.length) fail('Select parts to delete');
  parts.forEach((p) => removePart(ctx.st, p.id));
  return {};
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function buildImport(ctx: Ctx, f: FeatureOf<'import'>): Promise<FeatureOutput> {
  const p = f.params;
  if (!p.data) fail('No file data');
  const blob = new Blob([base64ToBytes(p.data) as BlobPart]);
  const shape = p.format === 'step' ? await R.importSTEP(blob) : await R.importSTL(blob);
  let solids = solidsOf(shape);
  if (!solids.length) {
    // STL imports produce shells: try to make a solid
    try {
      solids = [R.makeSolid([shape as R.Shell])];
    } catch {
      fail('Imported file contains no solids');
    }
  }
  solids.forEach((s, i) => setPart(ctx.st, newPartId(ctx.st, `${ctx.fid}.${i}`), s));
  return {};
}

/**
 * Derived (Onshape): parts of another Part Studio of the document as its last build has them (the caller builds
 * it just before), standing where they stand there. Their ids `${fid}.${source part id}` stay while the source keeps
 * its own, so references to their faces and edges hold across rebuilds.
 */
function buildDerived(ctx: Ctx, f: FeatureOf<'derived'>): FeatureOutput {
  const p = f.params;
  if (!p.studioId) fail('Select a Part Studio');
  if (p.sourceError === 'missing') fail('The source Part Studio no longer exists');
  if (p.sourceError === 'cycle') fail('Circular reference: the source Part Studio uses this one');
  const src = p.sourceKey ? ctx.sources?.(p.sourceKey) : undefined;
  if (!src) fail('The source Part Studio is not built');
  const wanted = p.parts.length ? p.parts : [...src.state.parts.keys()];
  if (!wanted.length) fail('The source Part Studio has no parts');
  let missing = 0;
  for (const id of wanted) {
    const part = src.state.parts.get(id);
    if (!part) {
      missing++;
      continue;
    }
    // a copy: the source's shapes stay its own
    const pid = `${ctx.fid}.${id}`;
    setPart(ctx.st, pid, part.shape.clone() as Shape3D);
    ctx.st.derived.set(pid, { name: src.name(id), color: src.color(id) });
  }
  if (missing === wanted.length) fail('The selected parts no longer exist in the source Part Studio');
  return missing ? { warning: 'Some of the selected parts no longer exist in the source Part Studio' } : {};
}

// ---------------------------------------------------------------------------

export async function applyFeature(st: BuildState, feature: Feature, ec: EvalContext, sources?: SourceLookup): Promise<FeatureOutput> {
  const ctx: Ctx = { st, ec: { ...ec, vars: st.vars }, fid: feature.id, sources };
  switch (feature.type) {
    case 'sketch':
      return buildSketch(ctx, feature);
    case 'plane':
      return buildPlane(ctx, feature);
    case 'variable':
      return buildVariable(ctx, feature);
    case 'helix':
      return buildHelix(ctx, feature);
    case 'mateConnector':
      return buildMateConnector(ctx, feature);
    case 'extrude':
      return buildExtrude(ctx, feature);
    case 'revolve':
      return buildRevolve(ctx, feature);
    case 'sweep':
      return buildSweep(ctx, feature);
    case 'loft':
      return buildLoft(ctx, feature);
    case 'thicken':
      return buildThicken(ctx, feature);
    case 'fillet':
      return buildFillet(ctx, feature);
    case 'chamfer':
      return buildChamfer(ctx, feature);
    case 'shell':
      return buildShell(ctx, feature);
    case 'draft':
      return buildDraft(ctx, feature);
    case 'hole':
      return buildHole(ctx, feature);
    case 'linearPattern':
      return buildLinearPattern(ctx, feature);
    case 'circularPattern':
      return buildCircularPattern(ctx, feature);
    case 'mirror':
      return buildMirror(ctx, feature);
    case 'boolean':
      return buildBoolean(ctx, feature);
    case 'split':
      return buildSplit(ctx, feature);
    case 'transform':
      return buildTransform(ctx, feature);
    case 'deletePart':
      return buildDeletePart(ctx, feature);
    case 'import':
      return buildImport(ctx, feature);
    case 'derived':
      return buildDerived(ctx, feature);
  }
}
