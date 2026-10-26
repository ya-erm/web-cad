// Feature builders: each takes the current build state (already cloned) and mutates it.

import * as R from 'replicad';
import { evaluate, evaluateTypedVariable, type EvalContext } from '../core/expr';
import { sketchDims } from '../core/features';
import { frameFromNormal, offsetFrame, rotateVec, STD_PLANES, v3 } from '../core/math';
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
import { expandTexts } from '../sketch/text';
import { expandGears, gearSizeOf } from '../sketch/gear';
import {
  bboxOf,
  bodiesOf,
  compoundOf,
  fail,
  frameToPlane,
  fuseAll,
  isEmptyShape,
  mirrored,
  prism,
  rotated,
  scaled,
  isSurface,
  sewFaces,
  shapesTouch,
  simplified,
  solidsOf,
  splitPieces,
  sweepFace,
  translated,
  type Shape3D,
} from './geom';
import { topologyOf } from './meshing';
import {
  getSketch,
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
  resolveRegion,
  resolveSketchPlane,
  worldGeometryForRef,
} from './refs';
import { adoptThreads, openComposite, partShape, removePart, setPart, setSurface, type BuildState, type HoleState, type PartState, type ThreadState } from './state';
import type { HoleCallout } from './protocol';
import { standardHole, type ThreadSpec } from '../core/holes';
import { pathFrames } from './paths';
import { wrapRegion } from './wrap';
import { allPlanar, deleteFaces, encloses, facePlane, moveFeature, movePlanarFace, offsetCylinder, reachOf, type Motion, type Plane as FacePlane } from './faceOps';

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
  // a closed composite stays one part, whatever its bodies come to
  if (st.composites.get(id)?.closed) {
    setPart(st, id, shape);
    return;
  }
  setPart(st, id, solids[0]);
  for (let i = 1; i < solids.length; i++) setPart(st, newPartId(st, `${id}~${fid}`), solids[i]);
}

function addNewParts(st: BuildState, shape: Shape3D, fid: string) {
  solidsOf(shape).forEach((s, i) => setPart(st, newPartId(st, `${fid}.${i}`), s));
}

/** The parts a feature merges with: solids only (surfaces stay as they are). */
function scopeParts(st: BuildState, scope: MergeScope): PartState[] {
  return (scope.mergeAll ? [...st.parts.values()] : resolveParts(st, scope.parts)).filter((p) => !isSurface(p.shape));
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
        adoptThreads(st, targets[i].id, targets[0].id);
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
  // pattern copies are derived from the solved seed geometry, the letters of texts and the teeth of gears — from
  // their solved points (the gears' teeth from their expressions: `#z` teeth follow the variable)
  entities = expandGears(expandTexts(expandPatterns(entities, f.params.patterns, ctx.ec)), ctx.ec);
  const regions = computeRegions(entities);
  ctx.st.sketches.set(f.id, { featureId: f.id, frame, entities, regions, ok, name: f.name });
  // a gear that cannot be made (too few teeth, a pointed tooth…): why
  for (const e of f.params.entities) {
    const g = e.type === 'gear' ? gearSizeOf(e, ctx.ec) : null;
    if (g && 'error' in g) return { warning: g.error };
  }
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

function upToDistance(ctx: Ctx, ref: SelRef | undefined, origin: Vec3, dir: Vec3): number {
  if (!ref) fail('Select a face or plane to extrude up to');
  const target = ref.kind === 'face' || ref.kind === 'plane' ? resolvePlaneRef(ctx.st, ref) : null;
  if (target) {
    const denom = v3.dot(target.normal, dir);
    if (Math.abs(denom) < 1e-6) fail('Up to face must not be parallel to the extrude direction');
    // distance from profile plane origin along dir to the target plane
    return v3.dot(v3.sub(target.origin, origin), target.normal) / denom;
  }
  const pt = resolvePoint(ctx.st, ref);
  return v3.dot(v3.sub(pt, origin), dir);
}

/** Onshape Starting offset: how far along `dir` from `origin` (on the sketch plane) the extrude starts. */
function startShift(ctx: Ctx, p: FeatureOf<'extrude'>['params'], origin: Vec3, dir: Vec3): number {
  if (!p.startOffset) return 0;
  if (p.startType === 'entity') {
    const ref = p.startEntity?.[0];
    if (!ref) fail('Select a face, plane or point for the extrude to start at');
    return upToDistance(ctx, ref, origin, dir);
  }
  return len(ctx, p.startDistance || '0 mm', 'Start offset') * (p.startFlip ? -1 : 1);
}

/** Extrude as a surface (Onshape: Surface): sketch curves, open or closed, swept along their sketch's normal. */
function buildExtrudeSurface(ctx: Ctx, f: FeatureOf<'extrude'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const refs = (p.curves ?? []).filter((r) => r.kind === 'sketchEntity');
  if (!refs.length) fail('Select sketch curves to extrude into a surface');
  const big = sceneExtent(st);
  const oc = R.getOC();
  const faces: R.Face[] = [];
  for (const r of refs) {
    if (r.kind !== 'sketchEntity') continue;
    const n = getSketch(st, r.sketchId).frame.normal;
    const dir = p.flip ? v3.neg(n) : n;
    let start = 0;
    let end = 0;
    if (p.endType === 'blind') end = len(ctx, p.depth, 'Depth');
    else if (p.endType === 'symmetric') [start, end] = [-len(ctx, p.depth, 'Depth') / 2, len(ctx, p.depth, 'Depth') / 2];
    else if (p.endType === 'throughAll') end = big;
    else fail('A surface extrudes to a depth or through all (not up to a face)');
    if (p.secondEnd && p.endType !== 'symmetric') {
      if (p.endType2 === 'blind') start = -len(ctx, p.depth2, 'Second depth');
      else if (p.endType2 === 'throughAll') start = -big;
      else fail('A surface extrudes to a depth or through all (not up to a face)');
    }
    const s0 = startShift(ctx, p, getSketch(st, r.sketchId).frame.origin, dir);
    start += s0;
    end += s0;
    if (Math.abs(end - start) < 1e-9) fail('Extrude depth must not be zero');
    for (const e of resolveCurveEdges(st, r)) {
      const moved = Math.abs(start) > 1e-12 ? R.cast(R.translate(e.wrapped, v3.scale(dir, start))) : e;
      const mk = new oc.BRepPrimAPI_MakePrism(moved.wrapped, new oc.gp_Vec(...v3.scale(dir, end - start)), false, true);
      for (const x of R.iterTopo(mk.Shape(), 'face')) faces.push(R.cast(x) as R.Face);
      mk.delete();
    }
  }
  if (!faces.length) fail('Select sketch curves to extrude into a surface');
  setSurface(st, newPartId(st, `${ctx.fid}.0`), sewFaces(faces));
  return {};
}

function buildExtrude(ctx: Ctx, f: FeatureOf<'extrude'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  if (p.bodyType === 'surface') return buildExtrudeSurface(ctx, f);
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
        end = upToDistance(ctx, p.upTo[0], pf.frame.origin, dir);
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
          start = upToDistance(ctx, p.upTo2[0], pf.frame.origin, dir);
          break;
      }
    }
    // a starting offset moves the extrude away from the sketch plane; up to a face still ends at that face
    const s0 = startShift(ctx, p, pf.frame.origin, dir);
    if (s0) {
      if (p.endType !== 'upToFace') end += s0;
      if (!p.secondEnd || p.endType === 'symmetric' ? true : p.endType2 !== 'upToFace') start += s0;
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
      // the draft turns about the plane the extrude starts at
      solid = draftSides(solid, s0 ? { ...pf.frame, origin: v3.add(pf.frame.origin, v3.scale(dir, s0)) } : pf.frame, dir, a);
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

/** A revolve's axis, its direction (turned for a negative angle), start angle and sweep (degrees, 0…360]. */
function revolveAngles(ctx: Ctx, p: FeatureOf<'revolve'>['params']) {
  if (!p.axis[0]) fail('Select a revolve axis');
  const axis = resolveAxis(ctx.st, p.axis[0]);
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
  return { axis, dir, start, sweep: Math.min(sweep, 360) };
}

/** Revolve as a surface (Onshape: Surface): sketch curves and edges, open or closed, turned about the axis. */
function buildRevolveSurface(ctx: Ctx, f: FeatureOf<'revolve'>): FeatureOutput {
  const st = ctx.st;
  const edges = (f.params.curves ?? []).flatMap((r) => resolveCurveEdges(st, r));
  if (!edges.length) fail('Select sketch curves or edges to revolve into a surface');
  const { axis, dir, start, sweep } = revolveAngles(ctx, f.params);
  const oc = R.getOC();
  const ax = new oc.gp_Ax1(new oc.gp_Pnt(...axis.origin), new oc.gp_Dir(...dir));
  // off the axis line: an edge lying on it would turn into nothing
  const offAxis = (q: Vec3) => v3.len(v3.cross(v3.sub(q, axis.origin), dir)) > 1e-7 * Math.max(1, v3.len(q));
  const faces: R.Face[] = [];
  for (const e of edges) {
    if (![e.startPoint, e.pointAt(0.5), e.endPoint].some((q) => offAxis(q.toTuple() as Vec3))) continue;
    const moved = Math.abs(start) > 1e-9 ? R.cast(R.rotate(e.wrapped, start, axis.origin, dir)) : e;
    const mk = new oc.BRepPrimAPI_MakeRevol(moved.wrapped, ax, (sweep * Math.PI) / 180, false);
    for (const x of R.iterTopo(mk.Shape(), 'face')) faces.push(R.cast(x) as R.Face);
    mk.delete();
  }
  ax.delete();
  if (!faces.length) fail('Select sketch curves or edges to revolve into a surface');
  setSurface(st, newPartId(st, `${ctx.fid}.0`), sewFaces(faces));
  return {};
}

function buildRevolve(ctx: Ctx, f: FeatureOf<'revolve'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  if (p.bodyType === 'surface') return buildRevolveSurface(ctx, f);
  const profiles = resolveProfiles(st, p.profiles);
  if (!profiles.length) fail('Select sketch regions or planar faces to revolve');
  const { axis, dir, start, sweep } = revolveAngles(ctx, p);
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

/** Edges grouped by shared end points into connected chains, each an ordered wire. */
function wireChains(edges: R.Edge[]): R.Wire[] {
  const ends = edges.map((e) => [e.startPoint.toTuple(), e.endPoint.toTuple()] as Vec3[]);
  const root = edges.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const near = (a: Vec3, b: Vec3) => v3.dist(a, b) < 1e-5 * Math.max(1, v3.len(a));
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++)
      if (ends[i].some((a) => ends[j].some((b) => near(a, b)))) root[find(j)] = find(i);
  const groups = new Map<number, R.Edge[]>();
  edges.forEach((e, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), e]));
  return [...groups.values()].map(chainWire);
}

/** Sweep as a surface (Onshape: Surface): chains of profile curves, open or closed, swept along the path. */
function buildSweepSurface(ctx: Ctx, f: FeatureOf<'sweep'>, spine: R.Wire): FeatureOutput {
  const st = ctx.st;
  const p = f.params;
  const edges = (p.curves ?? []).flatMap((r) => resolveCurveEdges(st, r));
  if (!edges.length) fail('Select sketch curves or edges to sweep into a surface');
  const cfg = { frenet: !p.keepOrientation, transitionMode: 'round' as const };
  const faces: R.Face[] = [];
  for (const w of wireChains(edges)) {
    const [shell] = R.genericSweep(w, spine, cfg, true) as [Shape3D, R.Wire, R.Wire];
    for (const x of R.iterTopo(shell.wrapped, 'face')) faces.push(R.cast(x) as R.Face);
  }
  setSurface(st, newPartId(st, `${ctx.fid}.0`), sewFaces(faces));
  return {};
}

function buildSweep(ctx: Ctx, f: FeatureOf<'sweep'>): FeatureOutput {
  const p = f.params;
  const surface = p.bodyType === 'surface';
  const profiles = surface ? [] : resolveProfiles(ctx.st, p.profiles);
  if (!surface && !profiles.length) fail('Select profiles to sweep');
  if (!p.path.length) fail('Select a sweep path');
  const edges = p.path.flatMap((r) => resolveCurveEdges(ctx.st, r));
  const spine = chainWire(edges);
  if (surface) return buildSweepSurface(ctx, f, spine);
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

/** Faces or a surface thickened `t` along their normals into a solid (turned the right way round if it came inside out). */
function thickOf(s: R.AnyShape, t: number): Shape3D {
  const oc = R.getOC();
  const b = new oc.BRepOffsetAPI_MakeThickSolid();
  b.MakeThickSolidBySimple(s.wrapped, t);
  b.Build(new oc.Message_ProgressRange());
  if (!b.IsDone()) fail('Thicken failed: the thickness may be too large for the curvature');
  let out = R.cast(b.Shape()) as Shape3D;
  b.delete();
  const props = R.measureShapeVolumeProperties(out);
  if (props.volume < 0) out = R.cast(out.wrapped.Reversed()) as Shape3D;
  props.delete();
  return out;
}

/**
 * A surface's planar faces thickened by `t` each: at a straight edge where two of them turn away from each other
 * (the way they are thickened) the slabs leave a wedge between them — filled up to where the offset planes meet.
 */
function cornerFills(shape: Shape3D, t: number): Shape3D[] {
  const topo = topologyOf(shape);
  const out: Shape3D[] = [];
  topo.edgeInfo.forEach((e, ei) => {
    if (e.type !== 'LINE' || e.seam) return;
    const two = topo.faceInfo.map((f, i) => ({ f, i })).filter(({ f }) => f.edges?.includes(ei));
    if (two.length !== 2 || two.some(({ f }) => f.type !== 'PLANE' || !f.normal)) return;
    const [a, b] = two.map(({ f }) => f);
    const n1 = a.normal!;
    const n2 = b.normal!;
    const c = v3.dot(n1, n2);
    if (c > 1 - 1e-9 || c < -1 + 1e-6) return;
    // b lies behind a's plane (seen the way the slabs grow): the slabs part there
    if (v3.dot(v3.sub(b.center, e.start), n1) * Math.sign(t) >= 0) return;
    const P = e.start;
    const corner = v3.scale(v3.add(n1, n2), t / (1 + c));
    const section = R.makePolygon([P, v3.add(P, v3.scale(n1, t)), v3.add(P, corner), v3.add(P, v3.scale(n2, t))]);
    const along = v3.sub(e.end, e.start);
    out.push(prism(section, v3.norm(along), 0, v3.len(along)));
  });
  return out;
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
      else tools.push(thickOf(face, t));
    } else if (r.kind === 'part') {
      // a whole surface body: one face at once, or its faces each (OpenCascade's simple offset wants smooth shells)
      const part = st.parts.get(r.partId);
      if (!part) fail('The surface no longer exists');
      if (!isSurface(part.shape)) fail('Select surfaces, faces or sketch regions to thicken (not solid parts)');
      const faces = topologyOf(part.shape).faces;
      const each = faces.map((fc, i) => {
        const info = topologyOf(part.shape).faceInfo[i];
        return info.type === 'PLANE' && info.normal ? prism(fc, info.normal, 0, t) : thickOf(fc, t);
      });
      // where two planar faces turn away from each other the slabs part: the corner between them, filled
      each.push(...cornerFills(part.shape, t));
      tools.push(each.length === 1 ? each[0] : fuseAll(each));
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
  // Variable (Onshape): radii of their own at some vertices, the default one at the others
  const at =
    p.filletType === 'variable'
      ? (p.vertices ?? []).map((v, i) => {
          const rv = len(ctx, p.vertexRadii?.[i] || p.radius, 'Vertex radius');
          if (!(rv > 0)) fail('Radius must be positive');
          return { p: resolvePoint(ctx.st, v), r: rv };
        })
      : [];
  // and at points inside edges (a position 0…1 along the edge)
  const inside =
    p.filletType === 'variable'
      ? (p.pointEdges ?? []).map((ref, i) => {
          const u = num(ctx, p.pointPositions?.[i] || '0.5', 'Point position');
          if (!(u > 0 && u < 1)) fail('A point on an edge lies strictly between its ends: a position between 0 and 1');
          const rv = len(ctx, p.pointRadii?.[i] || p.radius, 'Point radius');
          if (!(rv > 0)) fail('Radius must be positive');
          return { edge: resolveEdge(ctx.st, ref).edge, u, r: rv };
        })
      : [];
  let propagated = false;
  for (const { part, edges } of groups.values()) {
    const mk = new oc.BRepFilletAPI_MakeFillet(part.shape.wrapped, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    for (const e of edges) mk.Add(r, e.wrapped);
    if (at.length || inside.length) variableRadii(mk, at, inside, r, !!p.smooth);
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

/**
 * A variable fillet: along each edge of each contour the radius goes from the one at its start vertex to the one at
 * its end (a vertex's own radius, or `r`) — linearly, or smoothly (level at the vertices, so no kink between edges).
 */
function variableRadii(
  mk: InstanceType<ReturnType<typeof R.getOC>['BRepFilletAPI_MakeFillet']>,
  at: { p: Vec3; r: number }[],
  inside: { edge: R.Edge; u: number; r: number }[],
  r: number,
  smooth: boolean,
) {
  const oc = R.getOC();
  const radiusAt = (q: Vec3) => {
    let best = r;
    let bestD = Infinity;
    for (const a of at) {
      const d = v3.len(v3.sub(a.p, q));
      if (d < bestD) [best, bestD] = [a.r, d];
    }
    return bestD < 1e-5 ? best : r;
  };
  for (let ic = 1; ic <= mk.NbContours(); ic++)
    for (let j = 1; j <= mk.NbEdges(ic); j++) {
      const e = mk.Edge(ic, j);
      // its ends in the contour's direction: the edge as the contour runs along it
      const edge = R.cast(e) as R.Edge;
      const ends = [0, 1].map((u) => {
        const q = edge.pointAt(u);
        const out: Vec3 = [q.x, q.y, q.z];
        q.delete();
        return out;
      });
      const reversed = e.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      if (reversed) ends.reverse();
      const [r1, r2] = ends.map(radiusAt);
      // the radii along the edge (contour direction): its ends and the points inside it
      const knots: [number, number][] = [
        [0, r1],
        ...inside.filter((q) => q.edge.wrapped.IsSame(e)).map((q): [number, number] => [reversed ? 1 - q.u : q.u, q.r]),
        [1, r2],
      ].sort((x, y) => x[0] - y[0]) as [number, number][];
      if (knots.length === 2 && (Math.abs(r1 - r2) < 1e-9 || !smooth)) {
        mk.SetRadius(r1, r2, ic, j);
        continue;
      }
      // between the knots: linearly, or by smoothstep (level at each knot) — sampled for the law
      const per = 8;
      const law = new oc.NCollection_Array1_gp_Pnt2d(1, (knots.length - 1) * per + 1);
      let k = 1;
      for (let s = 0; s + 1 < knots.length; s++) {
        const [u0, ra] = knots[s];
        const [u1, rb] = knots[s + 1];
        for (let i = 0; i < per + (s + 2 === knots.length ? 1 : 0); i++) {
          const w = i / per;
          const f = smooth ? w * w * (3 - 2 * w) : w;
          law.SetValue(k++, new oc.gp_Pnt2d(u0 + (u1 - u0) * w, ra + (rb - ra) * f));
        }
      }
      mk.SetRadius(law, ic, j);
      law.delete();
    }
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

// ---------------------------------------------------------------------------
// Direct edits of faces (Onshape Delete face / Move face / Replace face)
// ---------------------------------------------------------------------------

/** The selected faces by part: indices into each part's faces. */
function facesByPart(st: BuildState, refs: SelRef[]): Map<string, { part: PartState; faces: number[] }> {
  const out = new Map<string, { part: PartState; faces: number[] }>();
  for (const r of refs) {
    const { part, index } = resolveFace(st, r);
    const g = out.get(part.id) ?? { part, faces: [] };
    if (!g.faces.includes(index)) g.faces.push(index);
    out.set(part.id, g);
  }
  return out;
}

function buildDeleteFace(ctx: Ctx, f: FeatureOf<'deleteFace'>): FeatureOutput {
  const groups = facesByPart(ctx.st, f.params.faces);
  if (!groups.size) fail('Select faces to delete');
  for (const { part, faces } of groups.values()) {
    if (f.params.heal === false) {
      // no healing: the other faces stay, the part becomes a surface (Onshape: Heal off)
      const all = topologyOf(part.shape).faces;
      const rest = all.filter((_, i) => !faces.includes(i));
      if (!rest.length) fail('Every face of the part is selected: delete the part instead');
      setPart(ctx.st, part.id, sewFaces(rest));
    } else replacePart(ctx.st, part.id, deleteFaces(part.shape, faces), ctx.fid);
  }
  return {};
}

/** Enclose (Onshape): surfaces that close a volume between them sewn into a solid — a new part. */
function buildEnclose(ctx: Ctx, f: FeatureOf<'enclose'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const parts = resolveParts(st, p.surfaces);
  if (!parts.length) fail('Select the surfaces to enclose a volume');
  if (parts.some((x) => !isSurface(x.shape))) fail('Select surfaces (not solid parts) to enclose a volume');
  const faces = parts.flatMap((x) => topologyOf(x.shape).faces);
  let solid: Shape3D;
  try {
    solid = R.makeSolid(faces) as Shape3D;
  } catch {
    fail('The surfaces do not close a volume: their edges must meet');
  }
  const props = R.measureShapeVolumeProperties(solid);
  const vol = props.volume;
  props.delete();
  if (!(Math.abs(vol) > 1e-9)) fail('The surfaces do not close a volume: their edges must meet');
  if (vol < 0) solid = R.cast(solid.wrapped.Reversed()) as Shape3D;
  setPart(st, newPartId(st, `${ctx.fid}.0`), solid);
  if (!p.keep) for (const x of parts) removePart(st, x.id);
  return {};
}

/** Offset surface (Onshape): a surface body from faces, offset along their normals (0 — a copy of them). */
function buildOffsetSurface(ctx: Ctx, f: FeatureOf<'offsetSurface'>): FeatureOutput {
  const p = f.params;
  const groups = facesByPart(ctx.st, p.faces);
  if (!groups.size) fail('Select faces to offset');
  const d = len(ctx, p.distance, 'Distance') * (p.flip ? -1 : 1);
  let n = 0;
  for (const { part, faces } of groups.values()) {
    const all = topologyOf(part.shape).faces;
    const sheet = sewFaces(faces.map((i) => all[i]));
    let out = sheet;
    if (Math.abs(d) > 1e-9) {
      const oc = R.getOC();
      const b = new oc.BRepOffsetAPI_MakeOffsetShape();
      b.PerformByJoin(sheet.wrapped, d, 1e-6, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Arc, false, new oc.Message_ProgressRange());
      if (!b.IsDone()) fail('The faces could not be offset: the distance may be too large for their curvature');
      out = R.cast(b.Shape()) as Shape3D;
      b.delete();
    }
    setSurface(ctx.st, newPartId(ctx.st, `${ctx.fid}.${n++}`), out);
  }
  return {};
}

/**
 * Planar faces each to a plane of its own (computed from the solid as it was): the faces around them follow.
 * `target` — the plane of face `i` (its normal out of the material).
 */
function toPlanes(shape: Shape3D, faces: number[], target: (i: number) => { to: FacePlane; reach: number }): Shape3D {
  const changes = faces.map((i) => {
    const { to, reach } = target(i);
    return movePlanarFace(shape, i, to, reach);
  });
  let s = shape;
  for (const c of changes) {
    if (c.add) s = s.fuse(c.add);
    if (c.remove) s = s.cut(c.remove);
  }
  return simplified(s);
}

function buildMoveFace(ctx: Ctx, f: FeatureOf<'moveFace'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const groups = facesByPart(st, p.faces);
  if (!groups.size) fail('Select faces to move');
  const sign = p.flip ? -1 : 1;
  let motion: Motion | null = null;
  if (p.moveType === 'translate') {
    if (!p.direction[0]) fail('Select a direction');
    const d = v3.scale(resolveDirection(st, p.direction[0]), len(ctx, p.distance, 'Distance') * sign);
    motion = { shape: (s) => translated(s, d), point: (q) => v3.add(q, d) };
  } else if (p.moveType === 'rotate') {
    if (!p.axis[0]) fail('Select an axis');
    const a = resolveAxis(st, p.axis[0]);
    const rad = (ang(ctx, p.angle, 'Angle') * sign) as number;
    const dir = v3.norm(a.dir);
    motion = { shape: (s) => rotated(s, rad * DEG, a.origin, dir), point: (q) => v3.add(a.origin, rotateVec(v3.sub(q, a.origin), dir, rad)) };
  }
  const dist = p.moveType === 'offset' ? len(ctx, p.distance, 'Distance') * sign : 0;
  for (const { part, faces } of groups.values()) {
    let res: Shape3D;
    if (!motion && !allPlanar(part.shape, faces)) {
      // offset of a hole's / boss's wall: its radius changes (one cylinder at a time, planar faces as below)
      res = part.shape;
      const planar = faces.filter((i) => topologyOf(part.shape).faceInfo[i].type === 'PLANE');
      const round = faces.filter((i) => !planar.includes(i)).map((i) => topologyOf(part.shape).faceInfo[i]);
      if (planar.length)
        res = toPlanes(res, planar, (i) => {
          const pl = facePlane(part.shape, i);
          return { to: { p: v3.add(pl.p, v3.scale(pl.n, dist)), n: pl.n }, reach: Math.abs(dist) };
        });
      for (const info of round) {
        // found again in the shape as it is now (the earlier steps rebuilt it): the same cylinder
        const topo = topologyOf(res);
        const onAxis = (x: typeof info) => {
          if (!x.axis || !x.axisPoint || !info.axis || !info.axisPoint) return false;
          const a = v3.norm(info.axis);
          const off = v3.sub(x.axisPoint, info.axisPoint);
          return Math.abs(Math.abs(v3.dot(v3.norm(x.axis), a)) - 1) < 1e-9 && v3.len(v3.sub(off, v3.scale(a, v3.dot(off, a)))) < 1e-6;
        };
        const k = topo.faceInfo.findIndex((x) => x.type === info.type && x.radius !== undefined && Math.abs(x.radius - (info.radius ?? 0)) < 1e-6 && onAxis(x));
        if (k < 0) fail('Only planar and cylindrical faces can be offset');
        res = offsetCylinder(res, k, dist);
      }
    } else if (!motion) {
      // offset: each planar face along its own normal
      res = toPlanes(part.shape, faces, (i) => {
        const pl = facePlane(part.shape, i);
        return { to: { p: v3.add(pl.p, v3.scale(pl.n, dist)), n: pl.n }, reach: Math.abs(dist) };
      });
    } else {
      const m = motion;
      // a whole hole, pocket or boss moves as one; planar faces on their own otherwise
      res = encloses(part.shape, faces)
        ? moveFeature(part.shape, faces, m)
        : toPlanes(part.shape, faces, (i) => {
            const pl = facePlane(part.shape, i);
            const o = m.point(pl.p);
            return { to: { p: o, n: v3.norm(v3.sub(m.point(v3.add(pl.p, pl.n)), o)) }, reach: reachOf(part.shape, [i], m.point) };
          });
    }
    replacePart(st, part.id, res, ctx.fid);
  }
  return {};
}

function buildReplaceFace(ctx: Ctx, f: FeatureOf<'replaceFace'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const groups = facesByPart(st, p.faces);
  if (!groups.size) fail('Select faces to replace');
  if (!p.target[0]) fail('Select the plane or planar face to replace them with');
  const fr = resolvePlaneRef(st, p.target[0]);
  const off = len(ctx, p.offset, 'Offset') * (p.flip ? -1 : 1);
  for (const { part, faces } of groups.values()) {
    if (!allPlanar(part.shape, faces)) fail('Only planar faces can be replaced');
    const res = toPlanes(part.shape, faces, (i) => {
      const pl = facePlane(part.shape, i);
      // the target's normal turned the way the face looks (out of the material); the offset along it
      const n = v3.dot(fr.normal, pl.n) < 0 ? v3.neg(fr.normal) : fr.normal;
      const o = v3.add(fr.origin, v3.scale(n, off));
      return { to: { p: o, n }, reach: reachOf(part.shape, [i], (q) => v3.sub(q, v3.scale(n, v3.dot(v3.sub(q, o), n)))) };
    });
    replacePart(st, part.id, res, ctx.fid);
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

/** A hole's sizes (mm, radians): its own fields, or a standard's (ISO) — with a thread when tapped. */
interface HoleDims {
  R0: number;
  through: boolean;
  depth: number;
  tip: number;
  cbore?: { R: number; depth: number };
  /** `recess`: a cylinder of the countersink's diameter that deep above its cone. */
  csink?: { R: number; angle: number; recess?: number };
  thread?: ThreadSpec & { depth: number };
}

function holeDims(ctx: Ctx, f: FeatureOf<'hole'>, big: number): HoleDims {
  const p = f.params;
  const std = p.standard === 'iso' || p.standard === 'ansi' ? standardHole(p) : null;
  if (typeof std === 'string') fail(std);
  const R0 = (std ? std.diameter : len(ctx, p.diameter, 'Diameter')) / 2;
  if (!(R0 > 0)) fail('Diameter must be positive');
  const through = p.endType === 'throughAll';
  const depth = through ? big : len(ctx, p.depth, 'Depth');
  const d: HoleDims = { R0, through, depth, tip: ang(ctx, p.tipAngle, 'Tip angle') };
  if (p.style === 'counterbore' || p.style === 'counterdrill') {
    const R = (std ? std.cboreDiameter : len(ctx, p.cboreDiameter, 'Counterbore diameter')) / 2;
    if (R <= R0) fail('Counterbore diameter must exceed the hole diameter');
    d.cbore = { R, depth: std ? std.cboreDepth : len(ctx, p.cboreDepth, 'Counterbore depth') };
  }
  if (p.style === 'countersink') {
    const R = (std ? std.csinkDiameter : len(ctx, p.csinkDiameter, 'Countersink diameter')) / 2;
    if (R <= R0) fail('Countersink diameter must exceed the hole diameter');
    // a cylindrical recess of its diameter above the cone (the countersink sunk deeper)
    const recess = p.csinkRecess ? len(ctx, p.csinkRecess, 'Recess depth') : 0;
    if (recess < 0) fail('Recess depth must not be negative');
    d.csink = { R, angle: std ? std.csinkAngle / DEG : ang(ctx, p.csinkAngle, 'Countersink angle'), recess };
  } else if (p.style === 'counterdrill' && d.cbore) {
    // a countersink at the counterbore's mouth (Onshape Counterdrill); a standard one: a small chamfer of it
    const R = (std ? std.counterdrill.diameter : len(ctx, p.csinkDiameter, 'Countersink diameter')) / 2;
    if (R <= d.cbore.R) fail('Countersink diameter must exceed the counterbore diameter');
    const angle = std ? std.counterdrill.angle / DEG : ang(ctx, p.csinkAngle, 'Countersink angle');
    if ((R - d.cbore.R) / Math.tan(angle / 2) >= d.cbore.depth) fail('The countersink must end above the counterbore floor: a smaller countersink or a deeper counterbore');
    d.csink = { R, angle };
  }
  if (std?.thread) {
    // a blind hole is threaded as deep as asked (no deeper than the hole), a through one all the way
    const tap = through ? big : Math.min(len(ctx, p.tapDepth ?? p.depth, 'Tapped depth'), depth);
    if (!(tap > 0)) fail('Tapped depth must be positive');
    d.thread = { ...std.thread, depth: tap };
  }
  return d;
}

function holeTool(d: HoleDims, p0: Vec3, drill: Vec3): Shape3D {
  const { R0, depth, tip } = d;
  const eps = Math.max(R0 * 0.02, 0.01);
  // profile in (r, z) with z along -drill (z <= 0 is inside material)
  const pts: Vec2[] = [[0, eps]];
  if (d.cbore && d.csink) {
    // counterdrill: the countersink down to the counterbore, the counterbore down to the hole
    const h = (d.csink.R - d.cbore.R) / Math.tan(d.csink.angle / 2);
    pts.push([d.csink.R + eps * Math.tan(d.csink.angle / 2), eps], [d.cbore.R, -h], [d.cbore.R, -d.cbore.depth], [R0, -d.cbore.depth]);
  } else if (d.cbore) {
    pts.push([d.cbore.R, eps], [d.cbore.R, -d.cbore.depth], [R0, -d.cbore.depth]);
  } else if (d.csink) {
    const h = (d.csink.R - R0) / Math.tan(d.csink.angle / 2);
    const r = d.csink.recess ?? 0;
    // with a recess: straight down its depth, then the cone
    if (r > 1e-9) pts.push([d.csink.R, eps], [d.csink.R, -r], [R0, -r - h]);
    else pts.push([d.csink.R + eps * Math.tan(d.csink.angle / 2), eps], [R0, -h]);
  } else {
    pts.push([R0, eps]);
  }
  pts.push([R0, -depth]);
  if (!d.through && tip > 0 && tip < Math.PI) pts.push([0, -depth - R0 / Math.tan(tip / 2)]);
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
  const dims = holeDims(ctx, f, big);
  const at = p.points.map((r) => {
    const { p: pt, n } = resolveHolePoint(ctx.st, r);
    let drill = v3.neg(n);
    // an edge or a vertex has no side of its own (a circle's axis may point either way): into the material
    if ((r.kind === 'edge' || r.kind === 'vertex') && !materialAt(ctx.st, pt, drill, big) && materialAt(ctx.st, pt, n, big)) drill = n;
    return { pt, drill: p.flip ? v3.neg(drill) : drill };
  });
  const tools = at.map((a) => holeTool(dims, a.pt, a.drill));
  const tool = tools.length === 1 ? tools[0] : compoundOf(tools);
  recordTool(ctx.st, ctx.fid, tool, 'remove');
  applyBodyOp(ctx.st, ctx.fid, tool, 'remove', { mergeAll: p.scopeAll, parts: p.scope });
  // where the hole has its own diameter: below a counterbore / countersink
  const start = dims.cbore ? dims.cbore.depth : dims.csink ? (dims.csink.recess ?? 0) + (dims.csink.R - dims.R0) / Math.tan(dims.csink.angle / 2) : 0;
  // the holes for drawings' callouts, in the parts they went into
  const callout: HoleCallout = {
    diameter: dims.R0 * 2,
    ...(dims.through ? {} : { depth: dims.depth }),
    ...(dims.cbore ? { cbore: { diameter: dims.cbore.R * 2, depth: dims.cbore.depth } } : {}),
    ...(dims.csink ? { csink: { diameter: dims.csink.R * 2, angle: (dims.csink.angle * 180) / Math.PI } } : {}),
    ...(dims.thread ? { thread: { designation: dims.thread.designation, ...(dims.through ? {} : { depth: dims.thread.depth }) } } : {}),
  };
  // the parts the holes went into (just outside their walls), and their threads' material — all at once
  const th = dims.thread;
  const runs = materialRuns(ctx.st, [
    ...at.map((a) => ({ p0: a.pt, dir: a.drill, r: dims.R0 * 1.05 + 0.05, start, end: dims.through ? big : Math.max(dims.depth, start + 1e-3) })),
    ...(th ? at.map((a) => ({ p0: a.pt, dir: a.drill, r: (dims.R0 + th.major / 2) / 2, start, end: start + th.depth })) : []),
  ]);
  at.forEach((a, i) => {
    const run = runs[i];
    ctx.st.holes.set(`${ctx.fid}.${i}`, { featureId: ctx.fid, source: ctx.fid, origin: a.pt, dir: a.drill, callout, ...(run ? { owner: run.owner } : {}) });
  });
  if (th) {
    // the thread starts below a counterbore / countersink, where the hole has its own diameter
    at.forEach((a, i) => {
      // as far as there is material around the hole (a through hole: to where it comes out)
      const run = runs[at.length + i];
      if (!run) return;
      ctx.st.threads.set(`${ctx.fid}.${i}`, {
        featureId: ctx.fid,
        origin: v3.add(a.pt, v3.scale(a.drill, start)),
        dir: a.drill,
        major: th.major,
        minor: dims.R0 * 2,
        length: run.length,
        designation: th.designation,
        owner: run.owner,
      });
    });
  }
  return { tool, op: 'remove' };
}

/** Whether some part's material begins right at `p` going along `dir` (within a hair of it). */
function materialAt(st: BuildState, p: Vec3, dir: Vec3, big: number): boolean {
  const oc = R.getOC();
  const tol = 1e-4 * Math.max(1, big * 1e-3);
  const line = R.makeLine(p, v3.add(p, v3.scale(dir, big)));
  for (const part of st.parts.values()) {
    if (isSurface(part.shape)) continue;
    const common = new oc.BRepAlgoAPI_Common(part.shape.wrapped, line.wrapped);
    common.Build();
    let near = false;
    for (const x of R.iterTopo(common.Shape(), 'edge')) {
      const e = R.cast(x) as R.Edge;
      for (const u of [0, 1]) {
        const q = e.pointAt(u);
        if (Math.abs(v3.dot(v3.sub([q.x, q.y, q.z], p), dir)) < tol) near = true;
        q.delete();
      }
    }
    common.delete();
    if (near) return true;
  }
  return false;
}

/** Where to look for material: along a line parallel to a hole's axis (`r` from it), `start` … `end` along `dir` from `p0`. */
interface RunQuery {
  p0: Vec3;
  dir: Vec3;
  r: number;
  start: number;
  end: number;
}

/**
 * Material along each query's line: the part where it starts and how far it goes without a gap (none — no part).
 * All the lines at once (a hole feature's points, a pattern's copies: hundreds) — one boolean per part with all of
 * them, each piece of the result given back to the line it lies on.
 */
function materialRuns(st: BuildState, queries: RunQuery[]): ({ length: number; owner: string } | null)[] {
  const oc = R.getOC();
  const out: ({ length: number; owner: string } | null)[] = queries.map(() => null);
  if (!queries.length) return out;
  const lines = queries.map(({ p0, dir, r, start, end }) => {
    const side = v3.scale(frameFromNormal(p0, dir).xDir, r);
    const a = v3.add(v3.add(p0, side), v3.scale(dir, start));
    return { a, dir, len: end - start, tol: Math.max(1e-4, (end - start) * 1e-6) };
  });
  const edges = lines.map((l) => R.makeLine(l.a, v3.add(l.a, v3.scale(l.dir, l.len))));
  const tool = R.makeCompound(edges);
  let open = lines.map((_, i) => i);
  for (const part of st.parts.values()) {
    if (!open.length) break;
    const common = new oc.BRepAlgoAPI_Common(part.shape.wrapped, tool.wrapped);
    common.Build();
    // the pieces of each line inside the part, as distances from its start
    const spans = new Map<number, [number, number][]>();
    for (const e of R.iterTopo(common.Shape(), 'edge')) {
      const edge = R.cast(e) as R.Edge;
      const ends = [0, 1].map((u): Vec3 => {
        const q = edge.pointAt(u);
        const v: Vec3 = [q.x, q.y, q.z];
        q.delete();
        return v;
      });
      for (const i of open) {
        const l = lines[i];
        const t = ends.map((q) => v3.dot(v3.sub(q, l.a), l.dir));
        // on this line (both ends on its axis), within it
        if (ends.some((q, k) => v3.len(v3.sub(v3.sub(q, l.a), v3.scale(l.dir, t[k]))) > l.tol * 10)) continue;
        const s0 = Math.max(0, Math.min(t[0], t[1]));
        const s1 = Math.min(l.len, Math.max(t[0], t[1]));
        if (s1 < s0) continue;
        if (!spans.has(i)) spans.set(i, []);
        spans.get(i)!.push([s0, s1]);
      }
    }
    common.delete();
    // a line whose material starts at its start in this part: as far as it goes without a gap
    open = open.filter((i) => {
      const s = (spans.get(i) ?? []).sort((x, y) => x[0] - y[0]);
      const tol = lines[i].tol;
      if (!s.length || s[0][0] > tol) return true;
      let reach = s[0][1];
      for (const x of s.slice(1)) if (x[0] <= reach + tol) reach = Math.max(reach, x[1]);
      if (reach <= tol) return true;
      out[i] = { length: Math.min(reach, lines[i].len), owner: part.id };
      return false;
    });
  }
  return out;
}


/** A cosmetic thread carried along by a motion of shapes (patterns, mirror, Derived placement): its axis as an edge, moved. */
function movedThread(t: Pick<ThreadState, 'origin' | 'dir' | 'length'>, x: Xform): Pick<ThreadState, 'origin' | 'dir' | 'length'> {
  const end = v3.add(t.origin, v3.scale(t.dir, t.length));
  const e = x(R.makeLine(t.origin, end) as unknown as Shape3D) as unknown as R.Edge;
  const [a, b] = [0, 1].map((u) => {
    const q = e.pointAt(u);
    const out: Vec3 = [q.x, q.y, q.z];
    q.delete();
    return out;
  });
  return { origin: a, dir: v3.norm(v3.sub(b, a)), length: v3.len(v3.sub(b, a)) };
}

/** A hole carried along by a motion of shapes: its mouth and direction. */
function movedHole(h: HoleState, x: Xform): Pick<HoleState, 'origin' | 'dir'> {
  const m = movedThread({ origin: h.origin, dir: h.dir, length: 1 }, x);
  return { origin: m.origin, dir: m.dir };
}

/** Cosmetic threads and holes of these parts (as they are before copies of them are made). */
const threadsOf = (st: BuildState, partIds: string[]) => ({
  threads: [...st.threads].filter(([, t]) => t.owner && partIds.includes(t.owner)),
  holes: [...st.holes].filter(([, h]) => h.owner && partIds.includes(h.owner)),
});

/** Copies of cosmetic threads and holes (`threadsOf`) owned by `from`, moved by `x`, for its copy `to` (the same part: fused copies). */
function copyThreads(st: BuildState, carried: ReturnType<typeof threadsOf>, from: string, to: string, x: Xform, fid: string, n: number) {
  for (const [k, t] of carried.threads) if (t.owner === from) st.threads.set(`${k}@${fid}.${n}`, { ...t, ...movedThread(t, x), owner: to, featureId: fid });
  for (const [k, h] of carried.holes) if (h.owner === from) st.holes.set(`${k}@${fid}.${n}`, { ...h, ...movedHole(h, x), owner: to, featureId: fid });
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
    // the copies' cosmetic threads come with them
    const threads = threadsOf(st, src.map((p) => p.id));
    xforms.forEach((x, i) => {
      for (const part of src) {
        const copy = x(part.shape);
        if (op === 'add') {
          const cur = st.parts.get(part.id);
          if (cur) setPart(st, part.id, simplified(cur.shape.fuse(copy)));
          copyThreads(st, threads, part.id, part.id, x, ctx.fid, i + 1);
        } else {
          const id = newPartId(st, `${part.id}@${ctx.fid}.${i + 1}`);
          setPart(st, id, copy);
          copyThreads(st, threads, part.id, id, x, ctx.fid, i + 1);
        }
      }
    });
    return;
  }
  const records = features.flatMap((fid) => st.tools.get(fid) ?? []);
  if (!records.length) fail('Select extrude, revolve, sweep, loft or hole features to pattern');
  const threads = [...st.threads].filter(([, t]) => features.includes(t.featureId));
  const holes = [...st.holes].filter(([, h]) => features.includes(h.featureId));
  xforms.forEach((x, i) => {
    for (const rec of records) applyBodyOp(st, ctx.fid, x(rec.tool), rec.op, { mergeAll: true, parts: [] });
    // the copied holes' threads: in whatever part each copy went into, as far as its material goes; and the holes:
    // in the part the copy went into (just outside its wall, past a counterbore / countersink) — all at once
    const movedT = threads.map(([k, t]) => ({ k, t, m: movedThread(t, x) }));
    const movedH = holes.map(([k, h]) => ({ k, h, m: movedHole(h, x), from: h.callout.cbore?.depth ?? 0 }));
    const runs = materialRuns(st, [
      ...movedT.map(({ t, m }) => ({ p0: m.origin, dir: m.dir, r: (t.minor + t.major) / 4, start: 0, end: m.length })),
      ...movedH.map(({ h, m, from }) => ({ p0: m.origin, dir: m.dir, r: (h.callout.diameter / 2) * 1.05 + 0.05, start: from, end: from + (h.callout.depth ?? sceneExtent(st)) })),
    ]);
    movedT.forEach(({ k, t, m }, j) => {
      const run = runs[j];
      if (run) st.threads.set(`${k}@${ctx.fid}.${i + 1}`, { ...t, ...m, length: run.length, owner: run.owner, featureId: ctx.fid });
    });
    movedH.forEach(({ k, h, m }, j) => {
      const run = runs[movedT.length + j];
      st.holes.set(`${k}@${ctx.fid}.${i + 1}`, { ...h, ...m, featureId: ctx.fid, ...(run ? { owner: run.owner } : { owner: undefined }) });
    });
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

/**
 * Curve pattern (Onshape): the copies go along a path — the first one where the seed is (the path's start), the
 * others spread over the path or `distance` apart — turning with it (frames carried along the path).
 */
function buildCurvePattern(ctx: Ctx, f: FeatureOf<'curvePattern'>): FeatureOutput {
  const p = f.params;
  if (!p.path.length) fail('Select a path');
  const n = count(ctx, p.count, 'Instance count');
  let wire = chainWire(p.path.flatMap((r) => resolveCurveEdges(ctx.st, r)));
  if (p.flip) wire = R.cast(wire.wrapped.Reversed()) as R.Wire;
  const path = pathFrames(wire);
  const step = p.equalSpacing ? path.length / (path.closed ? n : Math.max(n - 1, 1)) : len(ctx, p.distance, 'Distance');
  if (!(step > 0)) fail('Distance must be positive');
  if (!path.closed && step * (n - 1) > path.length * (1 + 1e-9)) fail('The instances do not fit on the path: fewer of them or a shorter distance');
  const start = path.frameAt(0);
  const xforms: Xform[] = [];
  for (let i = 1; i < n; i++) {
    const at = path.frameAt(step * i);
    if (p.orient) xforms.push((s) => frameToFrame(s, start, at));
    else {
      const d = v3.sub(at.origin, start.origin);
      xforms.push((s) => translated(s, d));
    }
  }
  patternInstances(ctx, p.patternType, p.parts, p.features, xforms, p.op);
  return {};
}

/**
 * Rib (Onshape): each sketch curve becomes a wall `thickness` thick that runs from the curve to the parts — within
 * the sketch plane (symmetric about it) or along its normal (symmetric about the curve) — and merges with them.
 */
function buildRib(ctx: Ctx, f: FeatureOf<'rib'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  if (!p.profiles.length) fail('Select sketch curves for the rib');
  const t = len(ctx, p.thickness, 'Thickness');
  if (!(t > 0)) fail('Thickness must be positive');
  const targets = p.mergeAll ? [...st.parts.values()] : resolveParts(st, p.parts);
  if (!targets.length) fail('There is no part for the rib to meet');
  const solid = fuseAll(targets.map((x) => x.shape));
  const big = sceneExtent(st);
  // the sides taper from the sketch on: + wider towards the part
  const draft = p.draft ? ang(ctx, p.draftAngle ?? '1 deg', 'Draft angle') * (p.draftFlip ? -1 : 1) : 0;
  const ribs: Shape3D[] = [];
  for (const r of p.profiles) {
    if (r.kind !== 'sketchEntity') fail('Select sketch curves for the rib');
    const n = getSketch(st, r.sketchId).frame.normal;
    for (const e of resolveCurveEdges(st, r)) {
      const chain = p.extend === false ? [e] : extendToSolid(e, solid, big);
      const rib = ribWall(chain, e, n, t, p.direction, p.flip, solid, big, draft);
      if (!rib) fail('The rib does not meet a part: check its curves and direction');
      ribs.push(rib);
    }
  }
  const tool = ribs.length === 1 ? ribs[0] : fuseAll(ribs);
  recordTool(st, ctx.fid, tool, 'add');
  applyBodyOp(st, ctx.fid, tool, 'add', p);
  return { tool, op: 'add' };
}

/**
 * A rib's curve run on from both ends up to the solid where it points at it (Onshape: Extend profiles up to part):
 * a line along itself, an arc with straight lines along its tangents — the chain from start to end.
 */
function extendToSolid(e: R.Edge, solid: Shape3D, big: number): R.Edge[] {
  if (e.geomType !== 'LINE' && e.geomType !== 'CIRCLE') return [e];
  const a = e.startPoint.toTuple() as Vec3;
  const b = e.endPoint.toTuple() as Vec3;
  // how far from p along dir the material begins (0: right there), none — it never does
  const hit = (p: Vec3, dir: Vec3): number => {
    const oc = R.getOC();
    const ray = R.makeLine(p, v3.add(p, v3.scale(dir, big)));
    const common = new oc.BRepAlgoAPI_Common(solid.wrapped, ray.wrapped);
    common.Build();
    let best = Infinity;
    for (const x of R.iterTopo(common.Shape(), 'edge')) {
      const edge = R.cast(x) as R.Edge;
      for (const u of [0, 1]) {
        const q = edge.pointAt(u);
        best = Math.min(best, v3.dot(v3.sub([q.x, q.y, q.z], p), dir));
        q.delete();
      }
    }
    common.delete();
    return Number.isFinite(best) ? Math.max(0, best) : 0;
  };
  const tangent = (u: number): Vec3 => {
    const v = e.tangentAt(u);
    const out = v3.norm(v.toTuple() as Vec3);
    v.delete();
    return out;
  };
  // outwards at the start (back along the curve) and at the end
  const da = v3.neg(tangent(0));
  const db = tangent(1);
  const ta = hit(a, da);
  const tb = hit(b, db);
  if (ta < 1e-9 && tb < 1e-9) return [e];
  const a2 = v3.add(a, v3.scale(da, ta));
  const b2 = v3.add(b, v3.scale(db, tb));
  if (e.geomType === 'LINE') return [R.makeLine(a2, b2)];
  return [...(ta > 1e-9 ? [R.makeLine(a2, a)] : []), e, ...(tb > 1e-9 ? [R.makeLine(b, b2)] : [])];
}

/**
 * Draft (Onshape Rib → Draft): the faces `pick` chooses turned by `angle` about their line on the neutral plane
 * (through `origin`, square to `dir`) — a positive angle widens the rib along `dir`.
 */
function taperRib(wall: Shape3D, dir: Vec3, origin: Vec3, angle: number, pick: (f: R.Face, normal: Vec3) => boolean): Shape3D {
  const oc = R.getOC();
  const b = new oc.BRepOffsetAPI_DraftAngle(wall.wrapped);
  const pln = R.makePln(origin, dir);
  const d = R.asDir(dir);
  let added = 0;
  for (const face of wall.faces) {
    const nv = face.normalAt();
    const normal = nv.toTuple() as Vec3;
    nv.delete();
    if (!pick(face, normal)) continue;
    // OCCT's positive angle closes the faces in along the pull direction: widening is the negative one
    b.Add(face.wrapped, d, -angle, pln, true);
    added++;
  }
  if (!added) return wall;
  b.Build(new oc.Message_ProgressRange());
  if (!b.IsDone()) fail('The rib could not be drafted: try a smaller draft angle');
  const res = R.cast(b.Shape()) as Shape3D;
  b.delete();
  return res;
}

/** Wrap (Onshape): sketch regions rolled onto a cylindrical face, raised out of it or sunk into it. */
function buildWrap(ctx: Ctx, f: FeatureOf<'wrap'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  if (!p.profiles.length) fail('Select sketch regions to wrap');
  if (!p.target[0]) fail('Select the cylindrical face to wrap them onto');
  const { face, info } = resolveFace(st, p.target[0]);
  if (info.type !== 'CYLINDRE' || !info.axis || !info.axisPoint || info.radius === undefined) fail('Regions wrap onto cylindrical faces only');
  const depth = len(ctx, p.depth, 'Depth');
  if (!(depth > 0)) fail('Depth must be positive');
  const target = { face, axis: info.axis, axisPoint: info.axisPoint, radius: info.radius };
  const tools = p.profiles.map((r) => {
    const { sketch, region } = resolveRegion(st, r);
    return wrapRegion(sketch.frame, region, target, p.op === 'add' ? depth : -depth);
  });
  const tool = tools.length === 1 ? tools[0] : fuseAll(tools);
  recordTool(st, ctx.fid, tool, p.op);
  applyBodyOp(st, ctx.fid, tool, p.op, p);
  return { tool, op: p.op };
}

/**
 * The rib of curve `e` (`chain`: it with its extensions, start to end) out to the solid: within the sketch plane
 * (the region the chain sweeps square to `e`'s chord, `t` thick about the plane) or along its normal (a strip `t` wide
 * about the chain); `draft` tapers its sides from the curve on (+ wider towards the solid).
 */
function ribWall(
  chain: R.Edge[],
  e: R.Edge,
  n: Vec3,
  t: number,
  mode: 'parallel' | 'normal',
  flip: boolean,
  solid: Shape3D,
  big: number,
  draft: number,
): Shape3D | null {
  const a = e.startPoint.toTuple() as Vec3;
  const b = e.endPoint.toTuple() as Vec3;
  const mid = e.pointAt(0.5).toTuple() as Vec3;
  const A = chain[0].startPoint.toTuple() as Vec3;
  const B = chain[chain.length - 1].endPoint.toTuple() as Vec3;
  // within the plane: square to the curve's chord; along the normal: the normal
  const along = mode === 'parallel' ? v3.norm(v3.cross(n, v3.sub(b, a))) : n;
  for (const sign of flip ? [-1, 1] : [1, -1]) {
    const d = v3.scale(along, sign);
    const wallOf = (len: number): Shape3D => {
      if (mode === 'parallel') {
        // the region the chain sweeps along d, thickened about the sketch plane
        const moved = chain.map((x) => R.cast(R.translate(x.wrapped, v3.scale(d, len))) as R.Edge).reverse();
        const face = R.makeFace(R.assembleWire([...chain.map((x) => x.clone()), R.makeLine(B, v3.add(B, v3.scale(d, len))), ...moved, R.makeLine(v3.add(A, v3.scale(d, len)), A)]));
        return prism(face, n, -t / 2, t / 2);
      }
      const strips = chain.map((x) => prism(stripAround(x, n, t), d, 0, len));
      return strips.length === 1 ? strips[0] : fuseAll(strips);
    };
    let wall: Shape3D;
    try {
      wall = wallOf(big);
    } catch {
      continue;
    }
    // what lies between the curve and the solid: the piece next to the curve, if it ends before the far side
    const probe = v3.add(mid, v3.scale(d, Math.min(t, big) * 1e-3));
    const piece = solidsOf(wall.cut(solid)).find((s) => touches(s, probe));
    if (!piece) continue;
    const [lo, hi] = bboxOf(piece);
    let reach = 0;
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) reach = Math.max(reach, v3.dot(v3.sub([x, y, z], mid), d));
    if (reach >= big * 0.9) continue;
    if (Math.abs(draft) < 1e-12) return piece;
    // drafted: the wall only as long as the rib reaches (and a little into the part: a narrowing one must not close
    // up past it), its sides tapered from the curve on
    const len = reach + Math.min(t, reach * 0.05);
    const tangents = [chain[0].tangentAt(0), chain[chain.length - 1].tangentAt(1)].map((v) => {
      const out = v3.norm(v.toTuple() as Vec3);
      v.delete();
      return out;
    });
    // the ends of the chain (planes square to it there) keep their place
    const endCap = (f: R.Face, normal: Vec3) =>
      f.geomType === 'PLANE' &&
      [A, B].some((q, i) => Math.abs(v3.dot(normal, tangents[i])) > 1 - 1e-6 && Math.abs(v3.dot(v3.sub(q, f.center.toTuple() as Vec3), normal)) < 1e-6);
    const tapered =
      mode === 'normal'
        ? taperRib(wallOf(len), d, mid, draft, (f, nn) => Math.abs(v3.dot(nn, d)) < 1e-6 && !endCap(f, nn))
        : taperRib(wallOf(len), d, a, draft, (_f, nn) => Math.abs(v3.dot(nn, n)) > 1 - 1e-6);
    const drafted = solidsOf(tapered.cut(solid)).find((s) => touches(s, probe));
    if (!drafted) fail('The rib could not be drafted: try a smaller draft angle');
    return drafted;
  }
  return null;
}

/** The strip `t` wide around a line or arc within its plane (normal `n`), symmetric about it. */
function stripAround(e: R.Edge, n: Vec3, t: number): R.Face {
  const a = e.startPoint.toTuple() as Vec3;
  const b = e.endPoint.toTuple() as Vec3;
  if (e.geomType === 'LINE') {
    const s = v3.scale(v3.norm(v3.cross(n, v3.sub(b, a))), t / 2);
    return R.makePolygon([v3.add(a, s), v3.add(b, s), v3.sub(b, s), v3.sub(a, s)]);
  }
  if (e.geomType === 'CIRCLE') {
    const m = e.pointAt(0.5).toTuple() as Vec3;
    const oc = R.getOC();
    const ad = new oc.BRepAdaptor_Curve(e.wrapped);
    const loc = ad.Circle().Location();
    const c: Vec3 = [loc.X(), loc.Y(), loc.Z()];
    ad.delete();
    // the arc's points pushed in and out along their radii
    const at = (q: Vec3, k: number) => v3.add(q, v3.scale(v3.norm(v3.sub(q, c)), k));
    const outer = R.makeThreePointArc(at(a, t / 2), at(m, t / 2), at(b, t / 2));
    const inner = R.makeThreePointArc(at(b, -t / 2), at(m, -t / 2), at(a, -t / 2));
    return R.makeFace(R.assembleWire([outer, R.makeLine(at(b, t / 2), at(b, -t / 2)), inner, R.makeLine(at(a, -t / 2), at(a, t / 2))]));
  }
  fail('Ribs along the sketch normal take lines and arcs');
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
  const surfaces = tools.filter((t) => isSurface(t.shape)).length;
  if (surfaces && p.op !== 'union') fail('Tools must be parts: split a surface with another surface');
  if (surfaces && surfaces < tools.length) fail('Surfaces combine with surfaces and parts with parts');
  if (p.op === 'union') {
    if (tools.length < 2) fail('Select at least two parts to union');
    tools.slice(1).forEach((t) => {
      adoptThreads(st, t.id, tools[0].id);
      removePart(st, t.id);
    });
    // surfaces: sewn into one along the edges where they meet (Onshape: Union of surfaces)
    if (surfaces) setPart(st, tools[0].id, sewFaces(tools.flatMap((t) => t.shape.faces)));
    else replacePart(st, tools[0].id, fuseAll(tools.map((t) => t.shape)), ctx.fid);
  } else if (p.op === 'subtract') {
    const targets = resolveParts(st, p.targets).filter((t) => !tools.some((x) => x.id === t.id));
    if (!targets.length) fail('Select target parts');
    const tool = fuseAll(tools.map((t) => t.shape));
    for (const t of targets) {
      if (!isSurface(t.shape)) {
        replacePart(st, t.id, simplified(t.shape.cut(tool)), ctx.fid);
        continue;
      }
      // a surface (a lone face too — in a compound) keeps what lies outside the tools; none left — it is gone
      const cut = (R.makeCompound([t.shape.clone()]) as Shape3D).cut(tool);
      if (cut.faces.length) setPart(st, t.id, cut);
      else removePart(st, t.id);
    }
    if (!p.keepTools) tools.forEach((t) => removePart(st, t.id));
  } else if (p.keepTools) {
    // each target keeps what lies inside all the tools; the tools stay as they are
    const targets = resolveParts(st, p.targets).filter((t) => !tools.some((x) => x.id === t.id));
    if (!targets.length) fail('Select target parts');
    if (targets.some((t) => isSurface(t.shape))) fail('Surfaces combine with surfaces and parts with parts');
    for (const t of targets) {
      let acc: Shape3D = t.shape;
      for (const x of tools) acc = acc.intersect(x.shape);
      if (isEmptyShape(acc)) fail('Parts do not intersect');
      replacePart(st, t.id, simplified(acc), ctx.fid);
    }
  } else {
    if (tools.length < 2) fail('Select at least two parts to intersect');
    let acc: Shape3D = tools[0].shape;
    for (let i = 1; i < tools.length; i++) acc = acc.intersect(tools[i].shape);
    if (isEmptyShape(acc)) fail('Parts do not intersect');
    tools.slice(1).forEach((t) => {
      adoptThreads(st, t.id, tools[0].id);
      removePart(st, t.id);
    });
    replacePart(st, tools[0].id, simplified(acc), ctx.fid);
  }
  return {};
}

function buildSplit(ctx: Ctx, f: FeatureOf<'split'>): FeatureOutput {
  const p = f.params;
  const st = ctx.st;
  const ref = p.tool[0];
  if (!ref) fail('Select a plane, face or surface to split with');
  // a surface (the whole body) or a face used as it is; a plane, mate connector or planar face — its whole plane
  const toolPart = ref.kind === 'part' ? st.parts.get(ref.partId) : undefined;
  if (ref.kind === 'part' && (!toolPart || !isSurface(toolPart.shape))) fail('Split with a surface, not a part: select a face of the part');
  const asFace = ref.kind === 'face' && (p.trim || ref.sig.type !== 'PLANE');
  const parts = resolveParts(st, p.parts).filter((x) => x.id !== toolPart?.id);
  if (!parts.length) fail('Select parts to split');
  let splitAny = false;
  const fr = toolPart || asFace ? null : resolvePlaneRef(st, ref);
  const toolShape = toolPart ? toolPart.shape : asFace ? resolveFace(st, ref).face : null;
  for (const part of parts) {
    let pieces: Shape3D[];
    if (fr && !isSurface(part.shape)) {
      const res = part.shape.split(frameToPlane(fr));
      const pos = res.positive ? solidsOf(res.positive) : [];
      const neg = res.negative ? solidsOf(res.negative) : [];
      if (!pos.length || !neg.length) continue;
      pieces = [compoundOf(pos), ...neg];
    } else if (fr) {
      // a surface by a plane: a face of the plane over the part, the side the normal points to first
      const [lo, hi] = bboxOf(part.shape);
      const c = v3.scale(v3.add(lo, hi), 0.5);
      const at = v3.sub(c, v3.scale(fr.normal, v3.dot(v3.sub(c, fr.origin), fr.normal)));
      const h = v3.dist(lo, hi) + 1;
      const corner = (a: number, b: number) => v3.add(at, v3.add(v3.scale(fr.xDir, a * h), v3.scale(fr.yDir, b * h)));
      const sheet = R.makePolygon([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
      const side = (s: Shape3D) => {
        const [a, b] = bboxOf(s);
        return v3.dot(v3.sub(v3.scale(v3.add(a, b), 0.5), fr.origin), fr.normal);
      };
      pieces = splitPieces(part.shape, sheet);
      pieces.sort((a, b) => side(b) - side(a));
    } else pieces = splitPieces(part.shape, toolShape!);
    if (pieces.length < 2) continue;
    splitAny = true;
    const surface = isSurface(part.shape);
    if (surface) setPart(st, part.id, pieces[0]);
    else replacePart(st, part.id, pieces[0], ctx.fid);
    pieces.slice(1).forEach((s, i) => (surface ? setSurface : setPart)(st, newPartId(st, `${part.id}~${ctx.fid}.${i}`), s));
  }
  if (!splitAny) fail('The split tool does not intersect the selected parts');
  if (toolPart && !p.keepTools) removePart(st, toolPart.id);
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
      pt = frameToFramePoint(a, b);
      break;
    }
    default:
      fail('Unknown transform type');
  }
  const threads = threadsOf(st, parts.map((q) => q.id));
  for (const part of parts) {
    const res = x(part.shape);
    if (p.copy) {
      const id = newPartId(st, `${part.id}@${ctx.fid}`);
      setPart(st, id, res);
      copyThreads(st, threads, part.id, id, x, ctx.fid, 1);
    } else {
      setPart(st, part.id, res);
      // its cosmetic threads move with it
      for (const [k, t] of threads.threads) if (t.owner === part.id) st.threads.set(k, { ...t, ...movedThread(t, x) });
      for (const [k, h] of threads.holes) if (h.owner === part.id) st.holes.set(k, { ...h, ...movedHole(h, x) });
    }
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

/** The motion of `frameToFrame` applied to a point. */
function frameToFramePoint(a: PlaneFrame, b: PlaneFrame): (q: Vec3) => Vec3 {
  return (q) => {
    const r = v3.sub(q, a.origin);
    const u = [v3.dot(r, a.xDir), v3.dot(r, a.yDir), v3.dot(r, a.normal)];
    return v3.add(b.origin, v3.add(v3.scale(b.xDir, u[0]), v3.add(v3.scale(b.yDir, u[1]), v3.scale(b.normal, u[2]))));
  };
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

/**
 * Delete part (Onshape): the parts selected are gone. An open composite selected — the composite goes, its bodies
 * stay. With `dissolve` (Dissolve composite parts): the composites selected go, their bodies parts again.
 */
function buildDeletePart(ctx: Ctx, f: FeatureOf<'deletePart'>): FeatureOutput {
  const { st } = ctx;
  const open = f.params.parts.flatMap((r) => (r.kind === 'part' && openComposite(st, r.partId) ? [r.partId] : []));
  const parts = resolveParts(
    st,
    f.params.parts.filter((r) => !(r.kind === 'part' && open.includes(r.partId))),
  );
  for (const id of open) st.composites.delete(id);
  if (f.params.dissolve) {
    const closed = parts.filter((p) => st.composites.get(p.id)?.closed);
    if (!closed.length && !open.length) fail('Select composite parts to dissolve');
    for (const p of closed) dissolveComposite(ctx, p.id);
    return {};
  }
  if (!parts.length && !open.length) fail('Select parts to delete');
  parts.forEach((p) => removePart(st, p.id));
  return {};
}

/**
 * Composite part (Onshape): the parts selected act as one part. Closed — they are consumed into it: a part of its
 * own, their compound, with their cosmetic threads, holes and mate connectors; open — they stay parts of their own,
 * and the composite groups them (its shape — theirs as they are, see `partShape`). An open composite selected stands
 * for its bodies; a closed one is a part like any other (consumed by a closed composite, kept by an open one).
 */
function buildCompositePart(ctx: Ctx, f: FeatureOf<'compositePart'>): FeatureOutput {
  const { st } = ctx;
  const parts = resolveParts(st, f.params.parts);
  if (!parts.length) fail('Select parts for the composite part');
  const id = newPartId(st, `${ctx.fid}.0`);
  const members = parts.map((p) => p.id);
  if (!st.compositeOrder.includes(id)) st.compositeOrder = [...st.compositeOrder, id];
  if (!f.params.closed) {
    st.composites.set(id, { featureId: ctx.fid, members, closed: false });
    return {};
  }
  const shape = compoundOf(parts.map((p) => p.shape));
  for (const m of members) {
    adoptThreads(st, m, id);
    for (const [k, mc] of st.mates) if (mc.owner === m) st.mates.set(k, { ...mc, owner: id });
    removePart(st, m);
  }
  setPart(st, id, shape);
  st.composites.set(id, { featureId: ctx.fid, members, closed: true });
  return {};
}

/**
 * A closed composite dissolved: its bodies parts again — under the ids they had, when it still has as many (their
 * names and colours come back), else new ones; its threads and holes go to the body they are in.
 */
function dissolveComposite(ctx: Ctx, id: string) {
  const { st } = ctx;
  const c = st.composites.get(id)!;
  const bodies = bodiesOf(st.parts.get(id)!.shape);
  st.parts.delete(id);
  st.composites.delete(id);
  // its bodies come solids first, then surfaces: the members in that order
  const members = [...c.members.filter((m) => !st.surfaceOrder.includes(m)), ...c.members.filter((m) => st.surfaceOrder.includes(m))];
  const same = bodies.length === members.length && members.every((m, i) => !st.parts.has(m) && isSurface(bodies[i]) === st.surfaceOrder.includes(m));
  const ids = bodies.map((_, i) => (same ? members[i] : newPartId(st, `${id}~${ctx.fid}.${i}`)));
  bodies.forEach((b, i) => (isSurface(b) && !st.partOrder.includes(ids[i]) ? setSurface(st, ids[i], b) : setPart(st, ids[i], b)));
  // which body a point is in (its box; else the first)
  const boxes = bodies.map((b) => bboxOf(b));
  const bodyAt = (p: Vec3) => ids[Math.max(0, boxes.findIndex(([lo, hi]) => p.every((v, k) => v >= lo[k] - 1e-6 && v <= hi[k] + 1e-6)))];
  for (const [k, t] of st.threads) if (t.owner === id) st.threads.set(k, { ...t, owner: bodyAt(t.origin) });
  for (const [k, h] of st.holes) if (h.owner === id) st.holes.set(k, { ...h, owner: bodyAt(h.origin) });
  for (const [k, mc] of st.mates) if (mc.owner === id) st.mates.set(k, { ...mc, owner: bodyAt(mc.frame.origin) });
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
  if (p.sourceError === 'version') fail('The source version is not available: it was deleted or is in another browser');
  if (p.sourceError === 'cycle') fail('Circular reference: the source Part Studio uses this one');
  const src = p.sourceKey ? ctx.sources?.(p.sourceKey) : undefined;
  if (!src) fail('The source Part Studio is not built');
  const wanted = p.noParts ? [] : p.parts.length ? p.parts : [...src.state.parts.keys()];
  const sketches = p.sketches ?? [];
  if (!wanted.length && !sketches.length) fail(p.noParts ? 'Select parts or sketches to derive' : 'The source Part Studio has no parts');
  // placed at a mate connector of this Part Studio: the source's origin (or its mate connector) lands there
  let place = (s: Shape3D) => s;
  let placeFrame = (f: PlaneFrame) => f;
  if (p.placeTo?.[0]) {
    const to = resolvePlaneRef(ctx.st, p.placeTo[0]);
    const from = p.placeFrom ? src.state.mates.get(p.placeFrom)?.frame : STD_PLANES.top;
    if (!from) fail('The mate connector of the source Part Studio no longer exists');
    place = (s) => frameToFrame(s, from, to);
    const pt = frameToFramePoint(from, to);
    placeFrame = (f) => movedFrame(f, pt);
  }
  let lostParts = 0;
  for (const id of wanted) {
    // (an open composite too: the compound of its bodies)
    const shape = partShape(src.state, id);
    if (!shape) {
      lostParts++;
      continue;
    }
    // a copy: the source's shapes stay its own
    const pid = `${ctx.fid}.${id}`;
    setPart(ctx.st, pid, place(shape.clone() as Shape3D));
    ctx.st.derived.set(pid, { name: src.name(id), color: src.color(id) });
    // with its cosmetic threads
    for (const [k, t] of src.state.threads)
      if (t.owner === id) ctx.st.threads.set(`${ctx.fid}.${k}`, { ...t, ...(p.placeTo?.[0] ? movedThread(t, place) : {}), owner: pid, featureId: ctx.fid });
    // and holes (counted as this feature's)
    for (const [k, h] of src.state.holes)
      if (h.owner === id) ctx.st.holes.set(`${ctx.fid}.${k}`, { ...h, ...(p.placeTo?.[0] ? movedHole(h, place) : {}), owner: pid, featureId: ctx.fid, source: `${ctx.fid}.${h.source}` });
  }
  // its sketches, under "derivedId.sketchId": their regions and curves are referenced like this Part Studio's own
  let lostSketches = 0;
  for (const id of sketches) {
    const sk = src.state.sketches.get(id);
    if (!sk) {
      lostSketches++;
      continue;
    }
    const key = `${ctx.fid}.${id}`;
    ctx.st.sketches.set(key, { ...sk, featureId: key, frame: placeFrame(sk.frame) });
  }
  if (lostParts + lostSketches === wanted.length + sketches.length)
    fail(sketches.length ? 'The selected parts and sketches no longer exist in the source Part Studio' : 'The selected parts no longer exist in the source Part Studio');
  if (lostSketches) return { warning: 'Some of the selected sketches no longer exist in the source Part Studio' };
  return lostParts ? { warning: 'Some of the selected parts no longer exist in the source Part Studio' } : {};
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
    case 'deleteFace':
      return buildDeleteFace(ctx, feature);
    case 'moveFace':
      return buildMoveFace(ctx, feature);
    case 'replaceFace':
      return buildReplaceFace(ctx, feature);
    case 'offsetSurface':
      return buildOffsetSurface(ctx, feature);
    case 'enclose':
      return buildEnclose(ctx, feature);
    case 'hole':
      return buildHole(ctx, feature);
    case 'linearPattern':
      return buildLinearPattern(ctx, feature);
    case 'circularPattern':
      return buildCircularPattern(ctx, feature);
    case 'mirror':
      return buildMirror(ctx, feature);
    case 'curvePattern':
      return buildCurvePattern(ctx, feature);
    case 'rib':
      return buildRib(ctx, feature);
    case 'wrap':
      return buildWrap(ctx, feature);
    case 'boolean':
      return buildBoolean(ctx, feature);
    case 'split':
      return buildSplit(ctx, feature);
    case 'transform':
      return buildTransform(ctx, feature);
    case 'deletePart':
      return buildDeletePart(ctx, feature);
    case 'compositePart':
      return buildCompositePart(ctx, feature);
    case 'import':
      return buildImport(ctx, feature);
    case 'derived':
      return buildDerived(ctx, feature);
  }
}
