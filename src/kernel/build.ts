// Incremental rebuild of a part studio: caches the state after every feature so that
// editing feature N only recomputes features N.. onward.

import * as R from 'replicad';
import type { EvalContext } from '../core/expr';
import type { Feature, Vec2, Vec3, ViewOrientation } from '../core/types';
import { perpendicular as perpendicularTo, v3 } from '../core/math';
import { FeatureError, compoundOf, isSurface, prism, type Shape3D } from './geom';
import { rotationMatrix } from '../assembly/compose';
import { applyFeature, type SourceBuild, type SourceLookup } from './features';
import { exportMesh, meshPart } from './meshing';
import type {
  BuildRequest,
  BuildResult,
  CurveResult,
  FeatureStatus,
  MeasureResult,
  PartMesh,
  PlacedPart,
  PlaneResult,
  StepAssembly,
  ProjectedEdge,
  ProjectedHole,
  Breakout,
  SectionCut,
  SectionFace,
  SketchResult,
  ThreadResult,
} from './protocol';
import { VIEW_AXES, type ViewAxes } from '../core/drawingViews';
import { halfSpace } from './faceOps';
import { trackFaceOrigins } from './faceOrigins';
import { resolveAxis, resolveCurveEdges, resolveEdge, resolveFace, resolveParts, resolvePlaneRef, resolvePoint } from './refs';
import { angleBetween, centerDistance, maxDistance, type Center, type Direction } from './measure';
import { cloneState, emptyState, type BuildState, type ThreadState } from './state';
import type { SelRef } from '../core/types';

export const DEFAULT_PART_COLOR = '#a9bfd6';

function hash(str: string): string {
  // cyrb53
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function errorMessage(e: unknown): string {
  if (e instanceof FeatureError) return e.message;
  if (e instanceof Error) {
    if (/^\d+$/.test(e.message) || !e.message) return 'Geometry operation failed';
    return e.message;
  }
  if (typeof e === 'number') return 'Geometry operation failed';
  return String(e);
}

type Meta = BuildRequest['partMeta'];

export class StudioBuilder {
  private keys: string[] = [];
  private states: BuildState[] = [emptyState()];
  private statuses: FeatureStatus[] = [];
  /** State shown to the user after the last build (for export/measure/projections). */
  current: BuildState = emptyState();
  private meta: Meta = {};
  /** Other Part Studios' builders by key (Derived), for the build under way. */
  private sources?: SourceLookup;

  /** A part's name: given in the Part Studio, its name in the source (Derived), else "Part N". */
  partName(st: BuildState, id: string): string {
    const m = this.meta[id];
    if (m?.name) return m.name;
    const d = st.derived.get(id);
    if (d) return d.name;
    // surfaces are counted apart (Onshape: "Surface 1"), parts without them
    const s = st.surfaceOrder.indexOf(id);
    if (s >= 0) return `Surface ${s + 1}`;
    if (!st.surfaceOrder.length) return `Part ${st.partOrder.indexOf(id) + 1}`;
    return `Part ${st.partOrder.filter((x) => !st.surfaceOrder.includes(x)).indexOf(id) + 1}`;
  }

  /** A part's own colour, if it has one (given here, or its colour in the source). */
  ownColor(st: BuildState, id: string): string | undefined {
    return this.meta[id]?.color || st.derived.get(id)?.color;
  }

  partColor(id: string): string {
    return this.ownColor(this.current, id) || DEFAULT_PART_COLOR;
  }

  /** This builder's last build, as a source for Derived features of other Part Studios. */
  asSource(): SourceBuild {
    const st = this.current;
    return { state: st, name: (id) => this.partName(st, id), color: (id) => this.ownColor(st, id) };
  }

  private meshOf(st: BuildState, id: string, shape: Shape3D, quality: number): PartMesh {
    const m = meshPart(id, shape, { name: this.partName(st, id), color: this.ownColor(st, id) || DEFAULT_PART_COLOR, hidden: !!this.meta[id]?.hidden }, quality);
    if (st.derived.has(id)) m.derived = true;
    if (isSurface(shape)) m.surface = true;
    const origins = st.faceOrigins.get(id);
    if (origins?.shape === shape) m.faceFeatures = origins.faces.map((f) => f.feature);
    return m;
  }

  /**
   * Build the features (incrementally). `sources` — the builders of other Part Studios by key, for Derived
   * features (built before this one).
   */
  async build(req: BuildRequest, sources?: (key: string) => StudioBuilder | undefined): Promise<BuildResult> {
    const t0 = performance.now();
    this.meta = req.partMeta;
    this.sources = sources ? (key) => sources(key)?.asSource() : undefined;
    const ec: EvalContext = { vars: {}, lengthUnit: req.units.length, angleUnit: req.units.angle };
    const n = Math.max(0, Math.min(req.upTo, req.features.length));
    const keys: string[] = [hash(`root|${req.units.length}|${req.units.angle}`)];
    for (let i = 0; i < n; i++) keys.push(hash(keys[i] + JSON.stringify(req.features[i])));

    let start = 0;
    if (this.keys[0] === keys[0]) {
      while (start < n && this.keys[start + 1] === keys[start + 1] && this.states[start + 1]) start++;
    }
    this.keys = keys.slice(0, start + 1);
    this.states.length = start + 1;
    this.statuses.length = start;

    for (let i = start; i < n; i++) {
      const f = req.features[i];
      const prev = this.states[i];
      let st = prev;
      let status: FeatureStatus = { ok: true };
      if (!f.suppressed) {
        const next = cloneState(prev);
        try {
          const out = await applyFeature(next, f, ec, this.sources);
          trackFaceOrigins(prev, next, f.id);
          st = next;
          if (out.warning) status = { ok: true, warning: out.warning };
        } catch (e) {
          status = { ok: false, error: errorMessage(e) };
        }
      }
      this.states.push(st);
      this.statuses.push(status);
      this.keys.push(keys[i + 1]);
    }
    const final = this.states[n];
    this.current = final;
    const quality = req.quality ?? 1;

    const statuses: Record<string, FeatureStatus> = {};
    for (let i = 0; i < n; i++) statuses[req.features[i].id] = this.statuses[i];

    const result: BuildResult = {
      type: 'build',
      reqId: req.reqId,
      // a source built for another Part Studio's Derived feature: no meshes, only its parts' names
      parts: req.meshless ? [] : [...final.parts.values()].map((p) => this.meshOf(final, p.id, p.shape, quality)),
      partList: [...final.parts.keys()].map((id) => ({ id, name: this.partName(final, id) })),
      sketches: this.sketchResults(final),
      planes: this.planeResults(final),
      mates: [...final.mates.values()].map((m) => ({ featureId: m.featureId, name: m.name, frame: m.frame, owner: m.owner })),
      curves: this.curveResults(final),
      threads: threadResults(final),
      statuses,
      partOrder: final.partOrder,
      timeMs: 0,
    };

    if (req.preview) result.preview = await this.preview(final, req.preview, ec, quality);
    result.timeMs = performance.now() - t0;
    return result;
  }

  private async preview(base: BuildState, feature: Feature, ec: EvalContext, quality: number) {
    const next = cloneState(base);
    try {
      const out = await applyFeature(next, feature, ec, this.sources);
      const changed: string[] = [];
      const parts: PartMesh[] = [];
      for (const [id, p] of next.parts) {
        const before = base.parts.get(id);
        if (!before || before.shape !== p.shape) {
          parts.push(this.meshOf(next, id, p.shape, quality));
          if (before) changed.push(id);
        }
      }
      for (const id of base.parts.keys()) if (!next.parts.has(id)) changed.push(id);
      const planes = this.planeResults(next).filter((pl) => !base.planes.has(pl.featureId));
      const curves = this.curveResults(next).filter((c) => !base.curves.has(c.featureId));
      const mates = [...next.mates.values()].filter((m) => !base.mates.has(m.featureId)).map((m) => ({ featureId: m.featureId, name: m.name, frame: m.frame }));
      // a Derived feature's sketches (a sketch being edited is drawn by the sketch editor)
      const sketches = feature.type === 'derived' ? this.sketchResults(next).filter((s) => !base.sketches.has(s.featureId)) : [];
      const threads = threadResults(next).filter((t) => base.threads.get(t.key) !== next.threads.get(t.key));
      return {
        status: { ok: true, warning: out.warning },
        parts,
        changed,
        tool: out.tool ? this.meshOf(next, '__tool__', out.tool, quality) : undefined,
        op: out.op,
        planes,
        curves,
        mates,
        sketches,
        threads,
      };
    } catch (e) {
      return { status: { ok: false, error: errorMessage(e) }, parts: [], changed: [] };
    }
  }

  private sketchResults(st: BuildState): SketchResult[] {
    return [...st.sketches.values()].map((s) => ({ featureId: s.featureId, frame: s.frame, entities: s.entities, ok: s.ok, name: s.name }));
  }

  private planeResults(st: BuildState): PlaneResult[] {
    return [...st.planes.values()].map((p) => ({ featureId: p.featureId, name: p.name, frame: p.frame, size: p.size }));
  }

  private curveResults(st: BuildState): CurveResult[] {
    return [...st.curves.values()].map((c) => {
      const pts = new Float32Array(c.points.length * 3);
      c.points.forEach((p, i) => pts.set(p, i * 3));
      return { featureId: c.featureId, name: c.name, points: pts };
    });
  }

  // -------------------------------------------------------------------------
  // Export / measure / projection on the current state
  // -------------------------------------------------------------------------

  shapesFor(partIds: string[]): { id: string; name: string; color: string; shape: Shape3D }[] {
    const st = this.current;
    const ids = partIds.length ? partIds : [...st.parts.keys()].filter((id) => !this.meta[id]?.hidden);
    return ids
      .map((id) => st.parts.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ id: p.id, name: this.partName(st, p.id), color: this.partColor(p.id), shape: p.shape }));
  }

  async exportStep(partIds: string[], unit: 'mm' | 'in' = 'mm'): Promise<Uint8Array> {
    return stepOf(this.shapesFor(partIds), unit);
  }

  async exportStl(partIds: string[], tolerance: number, angularTolerance: number, binary: boolean): Promise<Uint8Array> {
    return stlOf(this.shapesFor(partIds), tolerance, angularTolerance, binary);
  }

  meshes(partIds: string[], tolerance: number, angularTolerance: number) {
    return this.shapesFor(partIds).map((it) => ({ id: it.id, name: it.name, color: it.color, ...exportMesh(it.shape, tolerance, angularTolerance) }));
  }

  measure(refs: SelRef[]): Omit<MeasureResult, 'type' | 'reqId'> {
    const st = this.current;
    const items: MeasureResult['items'] = [];
    const shapes: R.AnyShape[] = [];
    // per selection: its centre or axis, and its direction (a line's, a plane's normal) — for two of them
    const centers: (Center | null)[] = [];
    const dirs: (Direction | null)[] = [];
    const perRef: R.AnyShape[][] = [];
    const lengths: number[] = [];
    const areas: number[] = [];
    let centerOfMass: Vec3 | undefined;
    for (const r of refs) {
      const before = shapes.length;
      let center: Center | null = null;
      let dir: Direction | null = null;
      if (r.kind === 'face') {
        const { info } = resolveFace(st, r);
        areas.push(info.area);
        if (info.type === 'PLANE' && info.normal) dir = { kind: 'plane', dir: info.normal };
        else if (info.type === 'SPHERE' && info.axisPoint) center = { kind: 'point', p: info.axisPoint };
        else if (info.axis && (info.axisPoint || info.apex)) {
          center = { kind: 'axis', p: (info.axisPoint ?? info.apex)!, dir: v3.norm(info.axis) };
          dir = { kind: 'line', dir: info.axis };
        }
      } else if (r.kind === 'edge') {
        const { info } = resolveEdge(st, r);
        lengths.push(info.length);
        if (info.dir) dir = { kind: 'line', dir: info.dir };
        if (info.circleCenter) center = { kind: 'point', p: info.circleCenter };
        if (info.circleCenter && info.axis) dir = { kind: 'plane', dir: info.axis };
      } else if (r.kind === 'vertex' || r.kind === 'origin') center = { kind: 'point', p: resolvePoint(st, r) };
      else if (r.kind === 'sketchEntity') {
        try {
          const ax = resolveAxis(st, r);
          const edges = resolveCurveEdges(st, r);
          if (edges.length === 1 && edges[0].geomType === 'LINE') dir = { kind: 'line', dir: ax.dir };
          else center = { kind: 'point', p: ax.origin };
        } catch {
          /* a point, a spline */
        }
      } else if (r.kind === 'plane') {
        // a plane (or a mate connector's XY): for the angle only
        try {
          dir = { kind: 'plane', dir: resolvePlaneRef(st, r).normal };
        } catch {
          /* not a plane */
        }
      }
      centers.push(center);
      dirs.push(dir);
      if (r.kind === 'part') {
        const p = st.parts.get(r.partId);
        if (!p) continue;
        shapes.push(p.shape);
        if (refs.length === 1 && isSurface(p.shape)) {
          // a surface: its area (no volume, no mass)
          const surf = R.measureShapeSurfaceProperties(p.shape);
          items.push({ label: 'Surface area', value: surf.area, kind: 'area' });
          centerOfMass = surf.centerOfMass;
          surf.delete();
        } else if (refs.length === 1) {
          const props = R.measureShapeVolumeProperties(p.shape);
          const surf = R.measureShapeSurfaceProperties(p.shape);
          const density = 1; // g/cm³ placeholder; UI scales with the part's material
          items.push({ label: 'Volume', value: props.volume, kind: 'volume' });
          items.push({ label: 'Surface area', value: surf.area, kind: 'area' });
          items.push({ label: 'Mass', value: (props.volume / 1000) * density, kind: 'mass' });
          centerOfMass = props.centerOfMass;
          props.delete();
          surf.delete();
        }
      } else if (r.kind === 'face') {
        const { face, info } = resolveFace(st, r);
        shapes.push(face);
        if (refs.length === 1) {
          items.push({ label: 'Area', value: info.area, kind: 'area' });
          if (info.radius) items.push({ label: 'Radius', value: info.radius, kind: 'length' });
        }
      } else if (r.kind === 'edge') {
        const { edge, info } = resolveEdge(st, r);
        shapes.push(edge);
        if (refs.length === 1) {
          items.push({ label: 'Length', value: info.length, kind: 'length' });
          if (info.radius) {
            items.push({ label: 'Radius', value: info.radius, kind: 'length' });
            items.push({ label: 'Diameter', value: info.radius * 2, kind: 'length' });
          }
        }
      } else if (r.kind === 'vertex' || r.kind === 'origin') {
        const p = resolvePoint(st, r);
        shapes.push(R.makeVertex(p));
        if (refs.length === 1) {
          items.push({ label: 'X', value: p[0], kind: 'length' });
          items.push({ label: 'Y', value: p[1], kind: 'length' });
          items.push({ label: 'Z', value: p[2], kind: 'length' });
        }
      } else if (r.kind === 'sketchEntity') {
        try {
          const edges = resolveCurveEdges(st, r);
          shapes.push(...edges);
          const total = edges.reduce((s, e) => s + e.length, 0);
          lengths.push(total);
          if (refs.length === 1) items.push({ label: 'Length', value: total, kind: 'length' });
        } catch {
          const p = resolvePoint(st, r);
          shapes.push(R.makeVertex(p));
        }
      }
      perRef.push(shapes.slice(before));
    }
    let points: [Vec3, Vec3] | undefined;
    const lines: NonNullable<MeasureResult['lines']> = [];
    // two selections (each its shapes as one): the minimum and maximum distance, centre to centre, the angle
    const single = (list: R.AnyShape[]): R.AnyShape | null => (list.length === 1 ? list[0] : list.length ? R.makeCompound(list.map((s) => s.clone())) : null);
    const [s0, s1] = refs.length === 2 ? [single(perRef[0]), single(perRef[1])] : [null, null];
    if (s0 && s1) {
      const oc = R.getOC();
      const d = new oc.BRepExtrema_DistShapeShape(s0.wrapped, s1.wrapped);
      if (d.IsDone() && d.NbSolution() > 0) {
        const a = d.PointOnShape1(1);
        const b = d.PointOnShape2(1);
        points = [
          [a.X(), a.Y(), a.Z()],
          [b.X(), b.Y(), b.Z()],
        ];
        items.push({ label: 'Minimum distance', value: d.Value(), kind: 'length', line: 'min' });
        lines.push({ key: 'min', points });
        const dv = v3.sub(points[1], points[0]);
        items.push({ label: 'ΔX', value: Math.abs(dv[0]), kind: 'length' });
        items.push({ label: 'ΔY', value: Math.abs(dv[1]), kind: 'length' });
        items.push({ label: 'ΔZ', value: Math.abs(dv[2]), kind: 'length' });
      }
      d.delete();
      const far = maxDistance(s0, s1);
      if (far && far.value > (points ? v3.dist(points[0], points[1]) : 0) + 1e-9) {
        items.push({ label: 'Maximum distance', value: far.value, kind: 'length', line: 'max' });
        lines.push({ key: 'max', points: far.points });
      }
    }
    if (refs.length === 2 && centers[0] && centers[1] && !(centers[0].kind === 'point' && refs[0].kind === 'vertex' && centers[1].kind === 'point' && refs[1].kind === 'vertex')) {
      const c = centerDistance(centers[0], centers[1]);
      items.push({ label: 'Center to center', value: c.value, kind: 'length', line: 'center' });
      lines.push({ key: 'center', points: c.points });
    }
    if (refs.length === 2 && dirs[0] && dirs[1]) items.push({ label: 'Angle', value: angleBetween(dirs[0], dirs[1]), kind: 'angle' });
    // several: their total length / area
    if (refs.length > 1 && lengths.length === refs.length) items.push({ label: 'Total length', value: lengths.reduce((a, b) => a + b, 0), kind: 'length' });
    if (refs.length > 1 && areas.length === refs.length) items.push({ label: 'Total area', value: areas.reduce((a, b) => a + b, 0), kind: 'area' });
    let volumes: MeasureResult['volumes'];
    if (refs.length > 1 && refs.every((r) => r.kind === 'part')) {
      const parts = resolveParts(st, refs);
      let vol = 0;
      volumes = [];
      for (const p of parts) {
        const props = R.measureShapeVolumeProperties(p.shape);
        vol += props.volume;
        volumes.push({ partId: p.id, volume: props.volume });
        props.delete();
      }
      items.push({ label: 'Total volume', value: vol, kind: 'volume' });
    }
    return { items, points, lines, volumes, centerOfMass };
  }

  projection(
    partIds: string[],
    orientation: ViewOrientation,
    withHidden: boolean,
    opts: { axes?: ViewAxes; section?: SectionCut; breakout?: Breakout } = {},
  ): { edges: ProjectedEdge[]; bounds: [Vec2, Vec2] | null; sections?: SectionFace[] } {
    let items = this.shapesFor(partIds);
    const { n, x } = opts.axes ?? VIEW_AXES[orientation];
    const y = v3.cross(n, x);
    const P = (p: Vec3): Vec2 => [v3.dot(p, x), v3.dot(p, y)];
    const sections: SectionFace[] = [];
    // an offset section's steps: lines of the view where its step faces are seen edge-on (not drawn)
    let jogs: { p: Vec2; d: Vec2 }[] = [];
    // a half section: the axis between the section and the view (its last step)
    let halfAxis: { p: Vec2; d: Vec2 } | null = null;
    // a local section's outline in the view: its walls are seen edge-on there (drawn as a freehand line instead)
    let breakPoly: Vec2[] | null = null;
    // what is cut away: the tool for a part (its size), the planes the cut faces lie on, their normal
    let cutting: { tool: (size: number, origin: Vec3) => Shape3D; planes: Vec3[]; normal: Vec3 } | null = null;
    if (opts.section) {
      // a section view: the parts without what lies on the viewer's side of the plane, the faces it cut hatched
      const sec = opts.section;
      const steps = sectionSteps(sec);
      jogs = steps?.jogs.map((j) => ({ p: P(j), d: v2norm(P(sec.along!)) })) ?? [];
      if (steps?.half) halfAxis = jogs[jogs.length - 1] ?? null;
      cutting = { tool: (size) => (steps ? steppedCut(sec, size) : halfSpace(sec.origin, sec.normal, size)), planes: steps?.planes ?? [sec.origin], normal: sec.normal };
    } else if (opts.breakout && opts.breakout.outline.length >= 3 && items.length) {
      // a local section: inside the outline, from the viewer down to its depth (the parts' middle by default)
      let front = -Infinity;
      let back = Infinity;
      for (const it of items) {
        const [lo, hi] = it.shape.boundingBox.bounds as [Vec3, Vec3];
        for (let i = 0; i < 8; i++) {
          const d = v3.dot([i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]], n);
          front = Math.max(front, d);
          back = Math.min(back, d);
        }
      }
      const depth = opts.breakout.depth === undefined ? (front + back) / 2 : front - opts.breakout.depth;
      const outline = opts.breakout.outline.map((q) => v3.add(q, v3.scale(n, depth - v3.dot(q, n))));
      breakPoly = outline.map(P);
      cutting = { tool: (size) => prism(R.makePolygon(outline), n, 0, Math.max(front - depth, 0) + size), planes: [outline[0]], normal: n };
    }
    if (cutting) {
      const { planes, normal } = cutting;
      const cut: typeof items = [];
      for (const it of items) {
        const [lo, hi] = it.shape.boundingBox.bounds as [Vec3, Vec3];
        const size = 2 * (v3.len(v3.sub(hi, lo)) + v3.len(v3.sub(v3.scale(v3.add(lo, hi), 0.5), planes[0]))) + 10;
        let rest: Shape3D;
        try {
          rest = it.shape.cut(cutting.tool(size, planes[0]));
        } catch {
          continue;
        }
        if (!rest.faces.length) continue;
        cut.push({ ...it, shape: rest });
        for (const f of rest.faces) {
          if (f.geomType !== 'PLANE') continue;
          const nv = f.normalAt();
          const along = Math.abs(nv.x * normal[0] + nv.y * normal[1] + nv.z * normal[2]);
          nv.delete();
          const c = f.center;
          const fc: Vec3 = [c.x, c.y, c.z];
          c.delete();
          if (along < 1 - 1e-6 || !planes.some((o) => Math.abs(v3.dot(v3.sub(fc, o), normal)) < 1e-4)) continue;
          sections.push({ partId: it.id, edges: f.edges.map((e) => sampleEdge(e).map(P)) });
        }
      }
      items = cut;
    }
    if (!items.length) return { edges: [], bounds: null, ...(cutting ? { sections } : {}) };
    const shape = compoundOf(items.map((i) => i.shape));
    const oc = R.getOC();
    const ax2 = R.makeAx2([0, 0, 0], n, x);
    const algo = new oc.HLRBRep_Algo();
    algo.Add(shape.wrapped, 0);
    const projector = new oc.HLRAlgo_Projector(ax2);
    algo.Projector(projector);
    algo.Update();
    algo.Hide();
    const toShape = new oc.HLRBRep_HLRToShape(algo);
    const collect = (comp: R.AnyShape | null, hidden: boolean, out: ProjectedEdge[]) => {
      if (!comp) return;
      for (const e of comp.edges) {
        oc.BRepLib.BuildCurves3d(e.wrapped);
        const pts: Vec2[] = [];
        const type = e.geomType;
        let len = 0;
        try {
          len = e.length;
        } catch {
          len = 1;
        }
        const nSeg = type === 'LINE' ? 1 : Math.min(200, Math.max(8, Math.ceil(len / 0.5)));
        for (let i = 0; i <= nSeg; i++) {
          const p = e.pointAt(i / nSeg);
          pts.push([p.x, p.y]);
          p.delete();
        }
        // an offset section's step, seen edge-on: not drawn (ISO 128-44)
        if (jogs.some((j) => pts.every((q) => Math.abs((q[0] - j.p[0]) * j.d[1] - (q[1] - j.p[1]) * j.d[0]) < 1e-5))) continue;
        // a local section's walls along its outline: the freehand line stands for them
        if (breakPoly && pts.every((q) => onPolygon(q, breakPoly!))) continue;
        const pe: ProjectedEdge = { pts, hidden };
        if (type === 'CIRCLE') {
          const ad = new oc.BRepAdaptor_Curve(e.wrapped);
          const c = ad.Circle();
          const l = c.Location();
          pe.circle = { c: [l.X(), l.Y()], r: c.Radius() };
          ad.delete();
        }
        out.push(pe);
      }
    };
    const edges: ProjectedEdge[] = [];
    const cast = (s: unknown) => {
      try {
        const sh = s as { IsNull(): boolean };
        return sh.IsNull() ? null : R.cast(s as never);
      } catch {
        return null;
      }
    };
    collect(cast(toShape.VCompound()), false, edges);
    collect(cast(toShape.OutLineVCompound()), false, edges);
    if (withHidden) {
      collect(cast(toShape.HCompound()), true, edges);
      collect(cast(toShape.OutLineHCompound()), true, edges);
    }
    // cosmetic threads of these parts, thin (ISO 6410); in a section — as cut by it
    const ids = new Set(items.map((i) => i.id));
    const threads = [...this.current.threads.values()].filter((t) => !t.owner || ids.has(t.owner));
    const cutBy = opts.section && { normal: opts.section.normal, planes: sectionSteps(opts.section)?.planes ?? [opts.section.origin] };
    edges.push(...threadLines(threads, n, x, withHidden, cutBy || undefined));
    toShape.delete();
    projector.delete();
    algo.delete();
    let lo: Vec2 = [Infinity, Infinity];
    let hi: Vec2 = [-Infinity, -Infinity];
    for (const e of edges)
      for (const p of e.pts) {
        lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
        hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
      }
    // the Hole features' holes seen end-on (either side), for callouts; counted by the feature they come from
    const holes: ProjectedHole[] = [];
    if (!opts.section) {
      const shown = [...this.current.holes.values()].filter((h) => h.owner && ids.has(h.owner));
      const count = new Map<string, number>();
      for (const h of shown) count.set(h.source, (count.get(h.source) ?? 0) + 1);
      for (const h of shown) {
        if (Math.abs(v3.dot(h.dir, n)) < 0.999) continue;
        const c = h.callout;
        holes.push({ c: P(h.origin), r: Math.max(c.diameter, c.cbore?.diameter ?? 0, c.csink?.diameter ?? 0) / 2, callout: c, count: count.get(h.source) ?? 1 });
      }
    }
    // the half section's axis across the parts, a little beyond them (a thin chain line, ГОСТ 2.305)
    const centerLines: Vec2[][] = [];
    if (halfAxis && edges.length) {
      const { p, d } = halfAxis;
      let t0 = -Infinity;
      let t1 = Infinity;
      for (const k of [0, 1]) {
        if (Math.abs(d[k]) < 1e-12) continue;
        const ta = (lo[k] - p[k]) / d[k];
        const tb = (hi[k] - p[k]) / d[k];
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
      if (t1 > t0) centerLines.push([0, 1].map((i) => { const t = i ? t1 + 2 : t0 - 2; return [p[0] + d[0] * t, p[1] + d[1] * t] as Vec2; }));
    }
    return {
      edges,
      bounds: edges.length ? [lo, hi] : null,
      ...(cutting ? { sections } : {}),
      ...(holes.length ? { holes } : {}),
      ...(centerLines.length ? { centerLines } : {}),
      ...(breakPoly ? { breaks: [breakPoly] } : {}),
    };
  }
}

/** Whether point `q` lies on a side of closed polygon `poly` (within 10⁻⁵). */
function onPolygon(q: Vec2, poly: Vec2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const l2 = d[0] * d[0] + d[1] * d[1];
    if (l2 < 1e-18) continue;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / l2));
    if (Math.hypot(q[0] - a[0] - d[0] * t, q[1] - a[1] - d[1] * t) < 1e-5) return true;
  }
  return false;
}

const v2norm = (a: Vec2): Vec2 => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};

/**
 * An offset section's line (more than one segment): the planes its segments along the first one cut (a point of each)
 * and where its steps across them start; none for a straight cut.
 */
export function sectionSteps(s: SectionCut): { planes: Vec3[]; jogs: Vec3[]; half: boolean } | null {
  const line = s.line;
  if (!line || line.length < 3 || !s.along) return null;
  const u = v3.norm(v3.sub(line[1], line[0]));
  const planes: Vec3[] = [];
  const jogs: Vec3[] = [];
  let half = false;
  for (let i = 0; i + 1 < line.length; i++) {
    const d = v3.sub(line[i + 1], line[i]);
    if (v3.len(d) < 1e-9) continue;
    const across = Math.abs(v3.dot(v3.norm(d), u)) <= 0.999;
    if (across) jogs.push(line[i]);
    else planes.push(line[i]);
    // ending across: the rest is not cut — a half section (its last step is the line between section and view)
    half = across;
  }
  return { planes, jogs, half };
}

/**
 * What an offset section removes: a prism through the parts across the parent view, bounded by the stepped line on
 * one side and reaching `size` beyond it towards the viewer, its ends carried on along the first segment.
 */
function steppedCut(s: SectionCut, size: number): Shape3D {
  const line = s.line!;
  const u = v3.norm(v3.sub(line[1], line[0]));
  const first = v3.sub(line[0], v3.scale(u, size));
  const last = v3.add(line[line.length - 1], v3.scale(u, size));
  const toViewer = v3.scale(s.normal, size);
  const outline = [first, ...line, last, v3.add(last, toViewer), v3.add(first, toViewer)];
  return prism(R.makePolygon(outline), s.along!, -size, size);
}

/** Points along an edge in space (a line — its ends; a curve — about every 0.5 mm, 8 … 200 segments). */
function sampleEdge(e: R.Edge): Vec3[] {
  let len = 1;
  try {
    len = e.length;
  } catch {
    // keep 1
  }
  const nSeg = e.geomType === 'LINE' ? 1 : Math.min(200, Math.max(8, Math.ceil(len / 0.5)));
  const pts: Vec3[] = [];
  for (let i = 0; i <= nSeg; i++) {
    const p = e.pointAt(i / nSeg);
    pts.push([p.x, p.y, p.z]);
    p.delete();
  }
  return pts;
}

/** Cosmetic threads as results (by key). */
function threadResults(st: BuildState): ThreadResult[] {
  return [...st.threads].map(([key, t]) => ({ key, ...t }));
}

/**
 * Cosmetic threads in a drawing view looking along -`n` (`x` to the right), ISO 6410 for internal threads: seen
 * end-on from where the hole starts — a thin three-quarter circle of the major diameter; from the side — hidden thin
 * lines of the major diameter along the thread and across its end.
 */
export function threadLines(
  threads: Pick<ThreadState, 'origin' | 'dir' | 'major' | 'length'>[],
  n: Vec3,
  x: Vec3,
  withHidden: boolean,
  /** A section view's cut (its planes, `normal` towards the viewer): threads it cuts lengthwise are seen, removed ones not. */
  cut?: { normal: Vec3; planes: Vec3[] },
): ProjectedEdge[] {
  const y = v3.cross(n, x);
  const P = (p: Vec3): Vec2 => [v3.dot(p, x), v3.dot(p, y)];
  const out: ProjectedEdge[] = [];
  for (const t of threads) {
    const r = t.major / 2;
    const along = v3.dot(t.dir, n);
    // where it is against the cut: through it (cut lengthwise), in front of it (removed) or behind
    const depths = cut?.planes.map((o) => v3.dot(v3.sub(t.origin, o), cut.normal)) ?? [];
    const cutThrough = depths.some((dd) => Math.abs(dd) <= r);
    const removed = !!cut && !cutThrough && depths.every((dd) => dd > r);
    if (removed) continue;
    if (cutThrough && Math.abs(along) < 0.98) {
      // in section (ISO 6410-1): the major diameter as thin solid lines, the end of the thread a thick one
      const a = t.origin;
      const b = v3.add(t.origin, v3.scale(t.dir, t.length));
      const s = v3.scale(v3.norm(v3.cross(t.dir, n)), r);
      out.push({ pts: [P(v3.add(a, s)), P(v3.add(b, s))], hidden: false, thin: true });
      out.push({ pts: [P(v3.sub(a, s)), P(v3.sub(b, s))], hidden: false, thin: true });
      out.push({ pts: [P(v3.add(b, s)), P(v3.sub(b, s))], hidden: false });
      continue;
    }
    if (along < -0.2) {
      // the hole goes away from the viewer: its mouth is seen, the thread's circle (as an ellipse when oblique)
      const e1 = perpendicularTo(t.dir);
      const e2 = v3.cross(t.dir, e1);
      const c = P(t.origin);
      // three quarters, open at the upper right of the view: the circle's points by their angle there
      const arc: [number, Vec2][] = [];
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * 2 * Math.PI;
        const q = P(v3.add(t.origin, v3.add(v3.scale(e1, r * Math.cos(a)), v3.scale(e2, r * Math.sin(a)))));
        const phi = ((Math.atan2(q[1] - c[1], q[0] - c[0]) * 180) / Math.PI + 360) % 360;
        if (phi >= 100 && phi <= 350) arc.push([phi, q]);
      }
      arc.sort((a, b) => a[0] - b[0]);
      out.push({ pts: arc.map((a) => a[1]), hidden: false, thin: true });
    } else if (Math.abs(along) < 0.98 && withHidden) {
      // from the side: inside the material, hidden
      const a = t.origin;
      const b = v3.add(t.origin, v3.scale(t.dir, t.length));
      const side = v3.norm(v3.cross(t.dir, n));
      const s = v3.scale(side, r);
      out.push({ pts: [P(v3.add(a, s)), P(v3.add(b, s))], hidden: true, thin: true });
      out.push({ pts: [P(v3.sub(a, s)), P(v3.sub(b, s))], hidden: true, thin: true });
      out.push({ pts: [P(v3.add(b, s)), P(v3.sub(b, s))], hidden: true, thin: true });
    }
  }
  return out;
}

export { VIEW_AXES };

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

type Exported = { name: string; color: string; shape: Shape3D };

/** STEP of named, coloured shapes (an assembly of parts in the file). */
export async function stepOf(items: Exported[], unit: 'mm' | 'in' = 'mm'): Promise<Uint8Array> {
  if (!items.length) throw new Error('No parts to export');
  const blob = R.exportSTEP(
    items.map((it) => ({ shape: it.shape, name: it.name, color: it.color })),
    { unit: unit === 'in' ? 'INCH' : 'MM', modelUnit: 'MM' },
  );
  return blobToBytes(blob);
}

/** STL of shapes as one mesh. */
export async function stlOf(items: Exported[], tolerance: number, angularTolerance: number, binary: boolean): Promise<Uint8Array> {
  if (!items.length) throw new Error('No parts to export');
  const shape = compoundOf(items.map((i) => i.shape));
  return blobToBytes(shape.blobSTL({ tolerance, angularTolerance, binary }));
}

/**
 * STEP of an assembly with its product tree (as Onshape writes it): `assemblies[0]` and its sub-assemblies, each
 * once, as products whose components are their instances — a part (written once, with its name and colour, from
 * `part`) or a sub-assembly — placed by rotation (degrees about X, then Y, then Z) and position, named after the
 * instance.
 */
export async function assemblyStepOf(
  assemblies: StepAssembly[],
  part: (studioKey: string, partId: string) => Exported | undefined,
  unit: 'mm' | 'in' = 'mm',
): Promise<Uint8Array> {
  if (!assemblies[0]?.components.length) throw new Error('No parts to export');
  const oc = R.getOC();
  const r = R.GCWithScope();
  const text = (s: string) => r(new oc.TCollection_ExtendedString(s, true));
  const doc = r(new oc.TDocStd_Document(text('XmlOcaf')));
  oc.XCAFDoc_ShapeTool.SetAutoNaming(false);
  const main = doc.Main();
  const tool = oc.XCAFDoc_DocumentTool.ShapeTool(main);
  const colors = oc.XCAFDoc_DocumentTool.ColorTool(main);
  type Label = ReturnType<typeof tool.NewShape>;
  const parts = new Map<string, Label>();
  const partLabel = (studioKey: string, partId: string): Label => {
    const key = `${studioKey}|${partId}`;
    let label = parts.get(key);
    if (label) return label;
    const it = part(studioKey, partId);
    if (!it) throw new Error('A part of the assembly is not built');
    label = tool.AddShape(it.shape.wrapped, false, true);
    oc.TDataStd_Name.Set(label, text(it.name));
    const hex = it.color.replace('#', '');
    const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    colors.SetColor(label, r(new oc.Quantity_ColorRGBA(c[0], c[1], c[2], 1)), oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);
    parts.set(key, label);
    return label;
  };
  const made = new Map<number, Label>();
  const assemblyLabel = (k: number, path: number[]): Label => {
    const done = made.get(k);
    if (done) return done;
    if (path.includes(k)) throw new Error('An assembly contains itself');
    const a = assemblies[k];
    const label = tool.NewShape();
    oc.TDataStd_Name.Set(label, text(a.name));
    for (const c of a.components) {
      const child = c.assembly !== undefined ? assemblyLabel(c.assembly, [...path, k]) : partLabel(c.studioKey ?? '', c.partId ?? '');
      // p' = Rz·Ry·Rx·p + t, as the assembly places the instance
      const M = rotationMatrix(c.rotation);
      const t = c.position;
      const trsf = r(new oc.gp_Trsf());
      trsf.SetValues(M[0], M[1], M[2], t[0], M[3], M[4], M[5], t[1], M[6], M[7], M[8], t[2]);
      oc.TDataStd_Name.Set(tool.AddComponent(label, child, r(new oc.TopLoc_Location(trsf))), text(c.name));
    }
    made.set(k, label);
    return label;
  };
  assemblyLabel(0, []);
  tool.UpdateAssemblies();
  oc.Interface_Static.SetCVal('xstep.cascade.unit', 'MM');
  oc.Interface_Static.SetCVal('write.step.unit', unit === 'in' ? 'INCH' : 'MM');
  const session = r(new oc.XSControl_WorkSession());
  const writer = r(new oc.STEPCAFControl_Writer(session, false));
  writer.SetColorMode(true);
  writer.SetNameMode(true);
  oc.Interface_Static.SetIVal('write.surfacecurve.mode', 1);
  oc.Interface_Static.SetIVal('write.precision.mode', 0);
  oc.Interface_Static.SetIVal('write.step.assembly', 1);
  oc.Interface_Static.SetIVal('write.step.schema', 5);
  if (!writer.Perform(doc, '/assembly.step', r(new oc.Message_ProgressRange()))) throw new Error('Writing the STEP file failed');
  const file = oc.FS.readFile('/assembly.step') as Uint8Array;
  oc.FS.unlink('/assembly.step');
  return new Uint8Array(file);
}

/**
 * A part's shape placed as an assembly instance — a copy turned about X, then Y, then Z (degrees, about the
 * origin) and moved: p' = Rz·Ry·Rx·p + t. The builder's own shape stays as it is.
 */
export function placedShape(shape: Shape3D, p: Pick<PlacedPart, 'position' | 'rotation'>): Shape3D {
  let s = shape.clone() as Shape3D;
  const axes: [number, number, number][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  p.rotation.forEach((a, i) => {
    if (a) s = s.rotate(a, [0, 0, 0], axes[i]) as Shape3D;
  });
  if (p.position.some((v) => v !== 0)) s = s.translate(p.position) as Shape3D;
  return s;
}
