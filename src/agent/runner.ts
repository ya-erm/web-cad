// Agent API runner: applies AgentOps to a Part Studio. Geometric queries (faces / edges / parts)
// are resolved against the model built just before the feature that uses them, so references
// carry the same persistent signatures as picks made in the UI.

import type { CadDocument, ConfigInput, Feature, FeatureOf, FeatureType, MateInference, PartStudioTab, PlaneRef, SelRef, SkEntity, SketchData, Vec2, Vec3 } from '../core/types';
import type { BuildResult, EdgeInfo, FaceInfo, PartMesh } from '../kernel/protocol';
import { collectVariables, defaultParams, FEATURE_LABELS, isDimension, makeEvalContext, nextFeatureName } from '../core/features';
import { formatQuantity, LENGTH_FACTOR, tryEvaluate } from '../core/expr';
import { uid } from '../core/ids';
import { edgeSig, faceSig, vertexSig } from '../kernel/sigs';
import { computeRegions, regionAt, type SketchRegion } from '../sketch/regions';
import { pointInPolygon } from '../sketch/curves';
import {
  chosenLabel,
  configKey,
  configuredFeatures,
  configurationFromNames,
  DIM,
  inputName,
  inputVariable,
  ownValue,
  pruneConfiguration,
  setConfigured,
  splitConfigKey,
  variantStudio,
} from '../core/config';
import { derivesFrom, sourceStudio, versionSnapshot, versionStudioId } from '../core/derived';
import { ANSI_SIZE_NAMES, ansiDefaultDepths, ansiHole, ansiThreads, ISO_SIZES, ISO_SIZE_NAMES, isoDefaultDepths, isoHole, isoPitches } from '../core/holes';
import { findMaterial, massKg, MATERIALS, partDensity } from '../core/materials';
import type { Draft } from 'immer';
import { addUsedGeometry, edgeGeometry, projectGeometry } from '../sketch/useGeometry';
import { addArc, addCenterRectangle, addCircle, addConstraint, addEllipse, addGear, addLine, addPoint, addPolygon, addRectangle, addSlot, addText } from '../sketch/sketchOps';
import { expandTexts, FONT_FILES } from '../sketch/text';
import { expandGears, gearSizeOf } from '../sketch/gear';
import type {
  AgentOp,
  AxisName,
  AxisSpec,
  EdgeQuery,
  Edges,
  FaceQuery,
  Faces,
  LocationSpec,
  ModelSummary,
  Num,
  PartQuery,
  Parts,
  Pick,
  PlaneSpec,
  Pt2,
  Pt3,
  Range,
  Regions,
  RunReport,
  Shape,
} from './types';

export class AgentError extends Error {}

/**
 * Derived: the Part Studio named `name` in the document, as a source for Part Studio `forStudio` (no cycles) — or in
 * a saved version (`versionId`, its snapshot loaded): then a Part Studio "tab@version".
 */
export function findDerivedSource(doc: { tabs: CadDocument['tabs']; units: CadDocument['units'] }, name: string, forStudio: string, versionId?: string): PartStudioTab {
  const snap = versionId ? versionSnapshot(versionId) : doc;
  if (!snap) throw new AgentError('The version is not available');
  const studios = snap.tabs.filter((t): t is PartStudioTab => t.type === 'partStudio');
  const s = studios.find((t) => t.name === name || t.id === name) ?? studios.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (!s) throw new AgentError(`No Part Studio "${name}"${versionId ? ' in the version' : ''}. Part Studios: ${studios.map((t) => t.name).join(', ')}`);
  // a version's Part Studio: its Derived features use the version's own Part Studios, no cycle is possible
  if (versionId) return sourceStudio(doc, versionStudioId(s.id, versionId))!;
  if (s.id === forStudio) throw new AgentError('A Part Studio cannot derive from itself');
  if (derivesFrom(doc, s.id, forStudio)) throw new AgentError(`"${s.name}" uses this Part Studio: deriving from it would be a circular reference`);
  return s;
}

/** The geometry kernel as seen by the runner (worker client in the browser, StudioBuilder in Node). */
export interface AgentKernel {
  build(features: Feature[]): Promise<BuildResult>;
  measure(refs: SelRef[]): Promise<{ label: string; value: number; kind?: string }[]>;
  /**
   * Derived: another Part Studio of the document by name (not one that uses Part Studio `forStudio` — a cycle),
   * built, with its parts; or a Part Studio of a saved version (`from.version` by name, of this document or of
   * `from.document`).
   */
  derivedSource?(
    name: string,
    forStudio: string,
    configuration?: Record<string, string | number>,
    from?: { version: string; document?: string },
  ): Promise<{
    studioId: string;
    name: string;
    parts: { id: string; name: string }[];
    configuration?: Record<string, string>;
    /** Its mate connectors (feature ids and names). */
    connectors?: { id: string; name: string }[];
    /** Its sketches (ids in its build and names). */
    sketches?: { id: string; name: string }[];
  }>;
}

/** A sketch to take regions from: its id (in the build) and entities. */
interface ProfileSketch {
  id: string;
  name: string;
  entities: SkEntity[];
}

/**
 * The configuration a Derived feature chooses for its source, from names (see `configurationFromNames`), and the
 * source as that configuration builds it.
 */
export function derivedVariant(studio: PartStudioTab, names: Record<string, string | number> | undefined, lengthUnit: string) {
  if (!names || !Object.keys(names).length) return { studio, configuration: undefined };
  try {
    const configuration = configurationFromNames(studio, names, lengthUnit);
    return { studio: variantStudio(studio, configuration), configuration };
  } catch (e) {
    throw new AgentError(`${studio.name}: ${(e as Error).message}`);
  }
}

type Units = CadDocument['units'];

const AXES: Record<'x' | 'y' | 'z', Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

function axisVector(a: AxisName | Pt3): Vec3 {
  if (Array.isArray(a)) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  const v = AXES[a.replace('-', '') as 'x' | 'y' | 'z'];
  if (!v) throw new AgentError(`Unknown axis "${a}" (use x, y, z, -x, -y, -z or [x, y, z])`);
  return a.startsWith('-') ? [-v[0], -v[1], -v[2]] : v;
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round = (v: number) => Math.round(v * 1e4) / 1e4 + 0; // + 0: no "-0" in reports
const round3 = (v: Vec3): Pt3 => [round(v[0]), round(v[1]), round(v[2])];

/** OCCT type names for the query vocabulary. */
const FACE_TYPES: Record<string, string> = { plane: 'PLANE', cylinder: 'CYLINDRE', cone: 'CONE', sphere: 'SPHERE', torus: 'TORUS', bspline: 'BSPLINE' };
const EDGE_TYPES: Record<string, string> = { line: 'LINE', circle: 'CIRCLE', ellipse: 'ELLIPSE', bspline: 'BSPLINE' };

function typeMatches(actual: string, wanted: string | undefined, table: Record<string, string>): boolean {
  if (!wanted) return true;
  const w = table[wanted.toLowerCase()] ?? wanted.toUpperCase();
  return actual.toUpperCase().startsWith(w);
}

class Runner {
  s: PartStudioTab;
  units: Units;
  kernel: AgentKernel;
  private cache: { key: string; res: BuildResult } | null = null;
  lastSketch: string | null = null;

  constructor(s: PartStudioTab, units: Units, kernel: AgentKernel) {
    this.s = s;
    this.units = units;
    this.kernel = kernel;
  }

  // ----- document helpers ---------------------------------------------------

  /** Insertion point: the rollback bar (Onshape inserts new features there). */
  get at(): number {
    return this.s.rollback === null ? this.s.features.length : Math.min(this.s.rollback, this.s.features.length);
  }

  add(type: FeatureType, name: string | undefined, params: unknown): Feature {
    const f = { id: uid('f'), type, name: name ?? nextFeatureName(this.s.features, type), params } as Feature;
    if (name && this.s.features.some((x) => x.name === name)) throw new AgentError(`A feature named "${name}" already exists`);
    this.s.features.splice(this.at, 0, f);
    if (this.s.rollback !== null) this.s.rollback++;
    return f;
  }

  feature(name: string): Feature {
    const f =
      this.s.features.find((x) => x.name === name || x.id === name) ??
      this.s.features.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!f) throw new AgentError(`No feature "${name}". Features: ${this.s.features.map((x) => x.name).join(', ') || '(none)'}`);
    return f;
  }

  sketchFeature(name: string | undefined): Feature & { type: 'sketch' } {
    const id = name ?? this.lastSketch ?? [...this.s.features.slice(0, this.at)].reverse().find((f) => f.type === 'sketch')?.id;
    if (!id) throw new AgentError('No sketch to use: create one with {"op":"sketch", …} or pass "sketch": "<name>"');
    const f = this.feature(id);
    if (f.type !== 'sketch') throw new AgentError(`"${name}" is not a sketch`);
    return f;
  }

  /** A sketch whose regions to use: one of this Part Studio, or one a Derived feature brings ("Derived 1 / Sketch 1"). */
  async profileSketch(name: string | undefined): Promise<ProfileSketch> {
    const m = name?.match(/^(.+?)\s*\/\s*(.+)$/);
    const d = m && this.s.features.find((f) => f.type === 'derived' && (f.name === m[1] || f.name.toLowerCase() === m[1].toLowerCase()));
    if (m && d) {
      const list = (await this.model()).sketches.filter((s) => s.featureId.startsWith(`${d.id}.`));
      const s = list.find((x) => x.name === m[2]) ?? list.find((x) => x.name?.toLowerCase() === m[2].toLowerCase());
      if (!s) throw new AgentError(`No sketch "${m[2]}" in ${d.name}. Its sketches: ${list.map((x) => x.name).join(', ') || '(none)'}`);
      return { id: s.featureId, name: `${d.name} / ${s.name}`, entities: s.entities };
    }
    const sk = this.sketchFeature(name);
    // texts: with their letters, gears: with their teeth (their regions)
    return { id: sk.id, name: sk.name, entities: expandGears(expandTexts(sk.params.entities), this.ctx()) };
  }

  // ----- values -------------------------------------------------------------

  private ctx() {
    return makeEvalContext({ units: this.units }, collectVariables(configuredFeatures(this.s), this.at, this.units));
  }

  /** Length in mm. */
  mm(v: Num, what = 'length'): number {
    if (typeof v === 'number') return v * LENGTH_FACTOR[this.units.length];
    const r = tryEvaluate(v, 'length', this.ctx());
    if (r === null) throw new AgentError(`Invalid ${what} expression "${v}"`);
    return r;
  }

  /** Expression string for a feature parameter. */
  expr(v: Num | undefined, kind: 'length' | 'angle' | 'number', fallback: string): string {
    if (v === undefined) return fallback;
    if (typeof v === 'number') return kind === 'length' ? `${v} ${this.units.length}` : kind === 'angle' ? `${v} deg` : `${v}`;
    if (tryEvaluate(v, kind, this.ctx()) === null) throw new AgentError(`Invalid ${kind} expression "${v}"`);
    return v;
  }

  /** A value for a variable of its type (a bare number takes the document's units; "any" — as it is). */
  varValue(v: FeatureOf<'variable'>, value: Num): string {
    const type = v.params.varType ?? 'any';
    return type === 'any' ? String(value) : this.expr(value, type, v.params.value);
  }

  /** A configuration input by name (a variable input: by its variable's name too, with or without "#"). */
  input(name: string): ConfigInput {
    const inputs = this.s.configuration ?? [];
    const n = name.replace(/^#/, '').toLowerCase();
    const input =
      inputs.find((x) => x.name === name) ??
      inputs.find((x) => x.name.toLowerCase() === n || inputName(this.s.features, x).slice(1).toLowerCase() === n);
    if (!input) throw new AgentError(`No configuration "${name}". Configurations: ${inputs.map((x) => (x.kind === 'variable' ? inputName(this.s.features, x) : x.name)).join(', ') || '(none)'}`);
    return input;
  }

  /** Query coordinate (document units) in mm. */
  private q(v: number): number {
    return v * LENGTH_FACTOR[this.units.length];
  }

  // ----- model --------------------------------------------------------------

  async model(): Promise<BuildResult> {
    // as the chosen configuration has them
    const feats = configuredFeatures(this.s).slice(0, this.at);
    const key = JSON.stringify(feats);
    if (this.cache?.key === key) return this.cache.res;
    const res = await this.kernel.build(feats);
    this.cache = { key, res };
    return res;
  }

  private async partsOf(q: PartQuery | undefined): Promise<PartMesh[]> {
    const parts = (await this.model()).parts;
    if (q === undefined || q === 'all') return parts;
    if (typeof q === 'number') {
      const p = parts[q];
      if (!p) throw new AgentError(`No part #${q} (there are ${parts.length})`);
      return [p];
    }
    if (typeof q === 'string') {
      const p = parts.find((x) => x.name === q || x.id === q) ?? parts.find((x) => x.name.toLowerCase() === q.toLowerCase());
      if (!p) throw new AgentError(`No part "${q}". Parts: ${parts.map((x) => x.name).join(', ') || '(none)'}`);
      return [p];
    }
    const t = q.near.map((c) => this.q(c)) as Vec3;
    const center = (p: PartMesh): Vec3 => [0, 1, 2].map((i) => (p.bbox[0][i] + p.bbox[1][i]) / 2) as Vec3;
    if (!parts.length) throw new AgentError('The model has no parts yet');
    return [parts.reduce((a, b) => (dist3(center(a), t) <= dist3(center(b), t) ? a : b))];
  }

  async parts(q: Parts): Promise<SelRef[]> {
    const list = Array.isArray(q) ? q : [q];
    const out: SelRef[] = [];
    for (const one of list) for (const p of await this.partsOf(one)) if (!out.some((r) => r.kind === 'part' && r.partId === p.id)) out.push({ kind: 'part', partId: p.id });
    return out;
  }

  private inRange(v: number, r: Range | undefined, tol: number): boolean {
    if (r === undefined) return true;
    if (typeof r === 'number') return Math.abs(v - this.q(r)) <= tol;
    return v >= this.q(r[0]) - tol && v <= this.q(r[1]) + tol;
  }

  private pickOne<T>(items: T[], pick: Pick | undefined, near: Pt3 | undefined, index: number | undefined, size: (t: T) => number, center: (t: T) => Vec3): T[] {
    let out = items;
    if (near) {
      const t = near.map((c) => this.q(c)) as Vec3;
      out = out.length ? [out.reduce((a, b) => (dist3(center(a), t) <= dist3(center(b), t) ? a : b))] : [];
    }
    if (pick && out.length) {
      let score: (t: T) => number;
      if (pick === 'largest') score = size;
      else if (pick === 'smallest') score = (t) => -size(t);
      else {
        const ax = axisVector(pick.replace('+', '') as AxisName);
        score = (t) => dot3(center(t), ax);
      }
      out = [out.reduce((a, b) => (score(a) >= score(b) ? a : b))];
    }
    if (index !== undefined) out = out[index] ? [out[index]] : [];
    return out;
  }

  private faceMatches(f: FaceInfo, q: FaceQuery, tol: number): boolean {
    if (!typeMatches(f.type, q.type, FACE_TYPES)) return false;
    if (q.normal) {
      if (!f.normal) return false;
      if (dot3(f.normal, axisVector(q.normal)) < 1 - 1e-6) return false;
    }
    if (q.radius !== undefined && (f.radius === undefined || Math.abs(f.radius - this.q(q.radius)) > tol)) return false;
    return this.inRange(f.center[0], q.x, tol) && this.inRange(f.center[1], q.y, tol) && this.inRange(f.center[2], q.z, tol);
  }

  async faceMatchesOf(q: FaceQuery): Promise<{ part: PartMesh; index: number; info: FaceInfo }[]> {
    const parts = await this.partsOf(q.part);
    const all: { part: PartMesh; index: number; info: FaceInfo }[] = [];
    for (const p of parts) {
      const tol = 1e-3 + 1e-6 * dist3(p.bbox[0], p.bbox[1]);
      p.faces.forEach((info, index) => {
        if (this.faceMatches(info, q, tol)) all.push({ part: p, index, info });
      });
    }
    return this.pickOne(all, q.pick, q.near, q.index, (m) => m.info.area, (m) => m.info.center);
  }

  async faces(q: Faces): Promise<SelRef[]> {
    const list: FaceQuery[] = q === 'all' ? [{}] : Array.isArray(q) ? q : [q];
    const out: SelRef[] = [];
    for (const one of list) {
      const ms = await this.faceMatchesOf(one);
      if (!ms.length) throw new AgentError(`No face matches ${JSON.stringify(one)}`);
      for (const m of ms) out.push({ kind: 'face', partId: m.part.id, index: m.index, sig: faceSig(m.info, m.part.bbox) });
    }
    return dedupe(out);
  }

  private pointOnFace(p: Vec3, f: FaceInfo, tol: number): boolean {
    if (f.type === 'PLANE' && f.normal) return Math.abs(dot3([p[0] - f.center[0], p[1] - f.center[1], p[2] - f.center[2]], f.normal)) <= tol;
    if (f.axis && f.axisPoint && f.radius !== undefined) {
      const d: Vec3 = [p[0] - f.axisPoint[0], p[1] - f.axisPoint[1], p[2] - f.axisPoint[2]];
      const along = dot3(d, f.axis);
      const radial = Math.sqrt(Math.max(0, dot3(d, d) - along * along));
      return Math.abs(radial - f.radius) <= tol;
    }
    return false;
  }

  async edgeMatchesOf(q: EdgeQuery): Promise<{ part: PartMesh; index: number; info: EdgeInfo }[]> {
    const parts = await this.partsOf(q.part);
    const faces = q.onFace ? await this.faceMatchesOf(q.onFace) : null;
    if (faces && !faces.length) throw new AgentError(`No face matches onFace ${JSON.stringify(q.onFace)}`);
    const all: { part: PartMesh; index: number; info: EdgeInfo }[] = [];
    for (const p of parts) {
      const tol = 1e-3 + 1e-6 * dist3(p.bbox[0], p.bbox[1]);
      p.edges.forEach((e, index) => {
        if (e.seam) return;
        if (!typeMatches(e.type, q.type, EDGE_TYPES)) return;
        if (q.dir) {
          if (!e.dir) return;
          if (Math.abs(dot3(e.dir, axisVector(q.dir))) < 1 - 1e-6) return;
        }
        if (q.radius !== undefined && (e.radius === undefined || Math.abs(e.radius - this.q(q.radius)) > tol)) return;
        const pts = [e.start, e.center, e.end];
        for (const pt of pts) if (!this.inRange(pt[0], q.x, tol) || !this.inRange(pt[1], q.y, tol) || !this.inRange(pt[2], q.z, tol)) return;
        if (faces && !faces.some((f) => f.part.id === p.id && pts.every((pt) => this.pointOnFace(pt, f.info, tol)))) return;
        all.push({ part: p, index, info: e });
      });
    }
    return this.pickOne(all, q.pick, q.near, q.index, (m) => m.info.length, (m) => m.info.center);
  }

  async edges(q: Edges): Promise<SelRef[]> {
    const list: EdgeQuery[] = q === 'all' ? [{}] : Array.isArray(q) ? q : [q];
    const out: SelRef[] = [];
    for (const one of list) {
      const ms = await this.edgeMatchesOf(one);
      if (!ms.length) throw new AgentError(`No edge matches ${JSON.stringify(one)}`);
      for (const m of ms) out.push({ kind: 'edge', partId: m.part.id, index: m.index, sig: edgeSig(m.info, m.part.bbox) });
    }
    return dedupe(out);
  }

  /** Axis reference; `flip` makes plane-normal axes point the requested way. */
  async axis(a: AxisSpec): Promise<{ ref: SelRef; flip: boolean }> {
    if (typeof a === 'string') {
      const neg = a.startsWith('-');
      const base = a.replace('-', '');
      // plane normals: Top +Z, Front -Y, Right +X
      if (base === 'x') return { ref: { kind: 'plane', planeId: 'right' }, flip: neg };
      if (base === 'y') return { ref: { kind: 'plane', planeId: 'front' }, flip: !neg };
      if (base === 'z') return { ref: { kind: 'plane', planeId: 'top' }, flip: neg };
      throw new AgentError(`Unknown axis "${a}"`);
    }
    if ('mate' in a) return { ref: this.mateRef(a.mate), flip: false };
    if ('edge' in a) return { ref: (await this.edges(a.edge))[0], flip: false };
    if ('face' in a) return { ref: (await this.faces(a.face))[0], flip: false };
    const sk = this.sketchFeature(a.sketch);
    const lines = sk.params.entities.filter((e) => e.type === 'line');
    const line = lines[a.line ?? 0];
    if (!line) throw new AgentError(`Sketch "${sk.name}" has no line #${a.line ?? 0}`);
    return { ref: { kind: 'sketchEntity', sketchId: sk.id, entityId: line.id }, flip: false };
  }

  /** Mate connectors are referenced like planes. */
  mateRef(name: string): SelRef {
    const f = this.feature(name);
    if (f.type !== 'mateConnector') throw new AgentError(`"${name}" is not a mate connector`);
    return { kind: 'plane', planeId: f.id };
  }

  async planeRef(p: PlaneSpec): Promise<SelRef> {
    if (typeof p === 'string') return { kind: 'plane', planeId: p };
    if ('mate' in p) return this.mateRef(p.mate);
    if ('plane' in p) {
      const f = this.feature(p.plane);
      if (f.type !== 'plane' && f.type !== 'mateConnector') throw new AgentError(`"${p.plane}" is not a plane feature or mate connector`);
      return { kind: 'plane', planeId: f.id };
    }
    const faces = await this.faces(p.face);
    if (faces.length !== 1) throw new AgentError(`Plane face query must match one face, got ${faces.length}`);
    return faces[0];
  }

  async sketchPlane(p: PlaneSpec | undefined): Promise<PlaneRef> {
    if (p === undefined) return { kind: 'std', name: 'top' };
    if (typeof p === 'string') {
      if (p !== 'top' && p !== 'front' && p !== 'right') throw new AgentError(`Unknown plane "${p}"`);
      return { kind: 'std', name: p };
    }
    const ref = await this.planeRef(p);
    return ref.kind === 'plane' ? { kind: 'feature', featureId: ref.planeId } : { kind: 'face', ref };
  }

  /** Location of a mate connector: the entity, which point of it, and the face it is parallel to. */
  async location(at: LocationSpec): Promise<{ ref: SelRef; inference: MateInference; orient?: SelRef }> {
    const one = async (q: FaceQuery) => {
      const fs = await this.faces(q);
      if (fs.length !== 1) throw new AgentError(`Face query ${JSON.stringify(q)} must match one face, got ${fs.length}`);
      return fs[0];
    };
    if (at === 'origin') return { ref: { kind: 'origin' }, inference: 'default' };
    if ('mate' in at) return { ref: this.mateRef(at.mate), inference: 'default' };
    if ('face' in at) return { ref: await one(at.face), inference: at.point ?? 'default' };
    if ('edge' in at) {
      const es = await this.edges(at.edge);
      if (es.length !== 1) throw new AgentError(`Location edge query must match one edge, got ${es.length}`);
      return { ref: es[0], inference: at.point ?? 'default', orient: at.parallelTo ? await one(at.parallelTo) : undefined };
    }
    if ('vertex' in at) return { ref: await this.vertexNear(at.vertex), inference: 'default', orient: at.parallelTo ? await one(at.parallelTo) : undefined };
    const sk = this.sketchFeature(at.sketch);
    const pts = this.sketchPoints(sk);
    const r = pts[at.point ?? 0];
    if (!r) throw new AgentError(`Sketch "${sk.name}" has no point #${at.point ?? 0}`);
    return { ref: r, inference: 'default' };
  }

  /** The model vertex nearest to a point (document units). */
  private async vertexNear(pt: Pt3): Promise<SelRef> {
    const t = pt.map((c) => this.q(c)) as Vec3;
    let best: { part: PartMesh; i: number; d: number } | null = null;
    for (const part of (await this.model()).parts)
      for (let i = 0; i < part.vertices.length / 3; i++) {
        const p: Vec3 = [part.vertices[i * 3], part.vertices[i * 3 + 1], part.vertices[i * 3 + 2]];
        const d = dist3(p, t);
        if (!best || d < best.d) best = { part, i, d };
      }
    if (!best) throw new AgentError('The model has no vertices');
    const v = best.part.vertices;
    return { kind: 'vertex', partId: best.part.id, index: best.i, sig: vertexSig([v[best.i * 3], v[best.i * 3 + 1], v[best.i * 3 + 2]], best.part.bbox) };
  }

  regions(sk: ProfileSketch, spec: Regions | undefined): SelRef[] {
    const regions = computeRegions(sk.entities);
    if (!regions.length) throw new AgentError(`Sketch "${sk.name}" has no closed regions`);
    let pick: SketchRegion[];
    if (spec === undefined || spec === 'auto') {
      // islands inside another region's hole (e.g. the disc of a hole) are not extruded
      pick = regions.filter((r) => !regions.some((o) => o !== r && o.holePolygons.some((h) => pointInPolygon(r.key.pt, h))));
    } else if (spec === 'all') pick = regions;
    else
      pick = spec.map((p) => {
        const pt: Vec2 = [this.mm(p[0]), this.mm(p[1])];
        const r = regionAt(regions, pt);
        if (!r) throw new AgentError(`No region of "${sk.name}" contains (${p[0]}, ${p[1]})`);
        return r;
      });
    return pick.map((r) => ({ kind: 'region', sketchId: sk.id, key: r.key }));
  }

  /** Resolve {"$faces": …} style placeholders inside raw params. */
  async resolveParams(v: unknown): Promise<unknown> {
    if (Array.isArray(v)) return Promise.all(v.map((x) => this.resolveParams(x)));
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0].startsWith('$')) {
      const arg = o[keys[0]];
      switch (keys[0]) {
        case '$faces':
          return this.faces(arg as Faces);
        case '$edges':
          return this.edges(arg as Edges);
        case '$parts':
          return this.parts(arg as Parts);
        case '$regions': {
          const a = (arg ?? {}) as { sketch?: string; regions?: Regions };
          return this.regions(await this.profileSketch(a.sketch), a.regions);
        }
        case '$plane':
          return [await this.planeRef(arg as PlaneSpec)];
        case '$axis':
          return [(await this.axis(arg as AxisSpec)).ref];
        case '$sketchPoints':
          return this.sketchPoints(this.sketchFeature(arg as string));
        case '$sketchCurves':
          return this.sketchCurves(this.sketchFeature(arg as string));
        case '$feature':
          return this.feature(arg as string).id;
        case '$features':
          return (arg as string[]).map((n) => this.feature(n).id);
        default:
          throw new AgentError(`Unknown placeholder ${keys[0]}`);
      }
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = await this.resolveParams(o[k]);
    return out;
  }

  /** The curves of a sketch (not points, not construction geometry). */
  sketchCurves(sk: Feature & { type: 'sketch' }): SelRef[] {
    return sk.params.entities.filter((e) => e.type !== 'point' && !e.construction).map((e) => ({ kind: 'sketchEntity', sketchId: sk.id, entityId: e.id }));
  }

  sketchPoints(sk: Feature & { type: 'sketch' }): SelRef[] {
    const ents = sk.params.entities;
    let pts = ents.filter((e) => e.type === 'point' && !e.owner && !e.construction);
    // no standalone points: use circle centres
    if (!pts.length) {
      const centres = new Set(ents.flatMap((e) => (e.type === 'circle' && !e.construction ? [e.c] : [])));
      pts = ents.filter((e) => centres.has(e.id));
    }
    if (!pts.length) throw new AgentError(`Sketch "${sk.name}" has no points (add {"type":"point"} shapes or circles)`);
    return pts.map((e) => ({ kind: 'sketchEntity', sketchId: sk.id, entityId: e.id }));
  }

  // ----- sketches -----------------------------------------------------------

  buildShapes(shapes: Shape[]): SketchData {
    const d: SketchData = { plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] };
    const P = (p: Pt2 | undefined): Vec2 => (p ? [this.mm(p[0], 'coordinate'), this.mm(p[1], 'coordinate')] : [0, 0]);
    const dim = (type: 'distance' | 'radius' | 'diameter', id: string, v: Num) => {
      if (typeof v === 'string') addConstraint(d, type, [id], { value: v });
    };
    shapes.forEach((sh, i) => {
      const where = `shape #${i} (${sh.type})`;
      const cons = 'construction' in sh && !!sh.construction;
      switch (sh.type) {
        case 'rect': {
          const w = this.mm(sh.w, `${where} width`);
          const h = this.mm(sh.h, `${where} height`);
          if (!(w > 0 && h > 0)) throw new AgentError(`${where}: width and height must be positive`);
          const x = this.mm(sh.x ?? 0, 'coordinate');
          const y = this.mm(sh.y ?? 0, 'coordinate');
          const lines = sh.center ? addCenterRectangle(d, [x, y], [x + w / 2, y + h / 2], cons).lines : addRectangle(d, [x, y], [x + w, y + h], cons);
          dim('distance', lines[0].id, sh.w);
          dim('distance', lines[1].id, sh.h);
          return;
        }
        case 'circle': {
          const size = sh.d ?? sh.r;
          if (size === undefined) throw new AgentError(`${where}: give r or d`);
          const r = sh.d !== undefined ? this.mm(sh.d, `${where} diameter`) / 2 : this.mm(sh.r!, `${where} radius`);
          if (!(r > 0)) throw new AgentError(`${where}: radius must be positive`);
          const c = addCircle(d, P(sh.c), r, cons);
          if (sh.d !== undefined) dim('diameter', c.id, sh.d);
          else dim('radius', c.id, sh.r!);
          return;
        }
        case 'ellipse': {
          const rx = this.mm(sh.rx, `${where} rx`);
          const ry = this.mm(sh.ry, `${where} ry`);
          if (!(rx > 0 && ry > 0)) throw new AgentError(`${where}: rx and ry must be positive`);
          const el = addEllipse(d, P(sh.c), rx, ry, ((sh.rotation ?? 0) * Math.PI) / 180, cons);
          // axis dimensions are diameters (Onshape); a size given as a string drives it
          if (typeof sh.rx === 'string') addConstraint(d, 'diameter', [el.id], { value: `2 * (${sh.rx})`, variant: 0 });
          if (typeof sh.ry === 'string') addConstraint(d, 'diameter', [el.id], { value: `2 * (${sh.ry})`, variant: 1 });
          return;
        }
        case 'line':
          addLine(d, P(sh.from), P(sh.to), cons);
          return;
        case 'polyline': {
          const pts = sh.points.map(P);
          if (pts.length < 2) throw new AgentError(`${where}: needs at least 2 points`);
          const n = sh.closed ? pts.length : pts.length - 1;
          const ls = Array.from({ length: n }, (_, k) => addLine(d, pts[k], pts[(k + 1) % pts.length], cons));
          for (let k = 0; k + 1 < ls.length; k++) addConstraint(d, 'coincident', [ls[k].p2, ls[k + 1].p1]);
          if (sh.closed && ls.length > 1) addConstraint(d, 'coincident', [ls[ls.length - 1].p2, ls[0].p1]);
          for (const l of ls) {
            const a = d.entities.find((e) => e.id === l.p1) as { x: number; y: number };
            const b = d.entities.find((e) => e.id === l.p2) as { x: number; y: number };
            if (Math.abs(a.y - b.y) < 1e-9) addConstraint(d, 'horizontal', [l.id]);
            else if (Math.abs(a.x - b.x) < 1e-9) addConstraint(d, 'vertical', [l.id]);
          }
          return;
        }
        case 'arc': {
          const r = this.mm(sh.r, `${where} radius`);
          const c = P(sh.c);
          const pt = (deg: number): Vec2 => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
          const a = addArc(d, c, pt(sh.start), pt(sh.end), cons);
          dim('radius', a.id, sh.r);
          return;
        }
        case 'slot': {
          const s = addSlot(d, P(sh.from), P(sh.to), this.mm(sh.r, `${where} radius`), cons);
          dim('radius', s.arcs[0].id, sh.r);
          return;
        }
        case 'polygon': {
          if (!(sh.sides >= 3 && sh.sides <= 50)) throw new AgentError(`${where}: sides must be 3…50`);
          const c = P(sh.c);
          const r = this.mm(sh.r, `${where} radius`);
          const a = ((sh.rotation ?? 90) * Math.PI) / 180;
          const pg = addPolygon(d, c, [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], Math.round(sh.sides), cons, !!sh.inscribed);
          dim('radius', pg.circle.id, sh.r);
          return;
        }
        case 'point':
          addPoint(d, P(sh.at));
          return;
        case 'text': {
          if (typeof sh.text !== 'string' || !sh.text.trim()) throw new AgentError(`${where}: give the text`);
          const h = this.mm(sh.height, `${where} height`);
          if (!(h > 0)) throw new AgentError(`${where}: height must be positive`);
          const font = sh.font ?? 'sans';
          if (!(font in FONT_FILES)) throw new AgentError(`${where}: font is one of ${Object.keys(FONT_FILES).join(', ')}`);
          const o = P(sh.at);
          const a = (((sh.rotation ?? 0) + 90) * Math.PI) / 180;
          const t = addText(d, o, [o[0] + h * Math.cos(a), o[1] + h * Math.sin(a)], sh.text, font, cons);
          if (typeof sh.height === 'string') addConstraint(d, 'distance', [t.p1, t.p2], { value: sh.height });
          return;
        }
        case 'gear': {
          // its parameters stay expressions: numbers in document units (degrees), strings as given (`#z`, `"12 mm"`)
          const sizes = (['module', 'outerDiameter', 'pitchDiameter'] as const).filter((k) => sh[k] !== undefined);
          if (sizes.length > 1) throw new AgentError(`${where}: give one of module, outerDiameter, pitchDiameter`);
          const sizeBy = sizes[0] ?? 'module';
          const len = (v: Num) => (typeof v === 'number' ? `${v} ${this.units.length}` : v);
          const angle = (v: Num | undefined, dflt: string) => (v === undefined ? dflt : typeof v === 'number' ? `${v} deg` : v);
          const params = {
            teeth: String(sh.teeth),
            sizeBy,
            size: len(sh[sizeBy] ?? 1),
            pressureAngle: angle(sh.pressureAngle, '20 deg'),
            rotation: angle(sh.rotation, '0 deg'),
          };
          const probe = gearSizeOf({ id: 'g', type: 'gear', c: 'c', ...params }, this.ctx());
          if ('error' in probe) throw new AgentError(`${where}: ${probe.error}`);
          addGear(d, sh.c ? P(sh.c) : [0, 0], params, !!sh.construction);
          return;
        }
        default:
          throw new AgentError(`Unknown shape type "${(sh as { type: string }).type}"`);
      }
    });
    return d;
  }

  // ----- ops ----------------------------------------------------------------

  async apply(op: AgentOp): Promise<void> {
    switch (op.op) {
      case 'variable': {
        const varType = op.type ?? (typeof op.value === 'number' ? 'length' : 'any');
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(op.name)) throw new AgentError(`Invalid variable name "${op.name}"`);
        const existing = this.s.features.find((f) => f.type === 'variable' && f.params.name === op.name);
        if (existing) throw new AgentError(`Variable #${op.name} exists: use {"op":"setVariable"}`);
        const value = typeof op.value === 'number' ? (varType === 'angle' ? `${op.value} deg` : varType === 'length' ? `${op.value} ${this.units.length}` : `${op.value}`) : op.value;
        this.add('variable', undefined, { ...defaultParams('variable'), name: op.name, value, varType, description: op.description ?? '' });
        return;
      }
      case 'setVariable': {
        const f = this.s.features.find((x) => x.type === 'variable' && x.params.name === op.name.replace(/^#/, ''));
        if (!f || f.type !== 'variable') throw new AgentError(`No variable #${op.name}`);
        const value = typeof op.value === 'number' ? (f.params.varType === 'number' ? `${op.value}` : `${op.value} ${f.params.varType === 'angle' ? 'deg' : this.units.length}`) : op.value;
        // a configured variable: the chosen configuration's cell
        if (!setConfigured(this.s, f.id, 'value', value)) f.params.value = value;
        return;
      }
      case 'sketch': {
        const data = this.buildShapes(op.shapes ?? []);
        data.plane = await this.sketchPlane(op.plane);
        // edges to project (Use): found in the model before the sketch
        const used = op.use ? await this.edges(op.use) : [];
        const parts = used.length ? (await this.model()).parts : [];
        const f = this.add('sketch', op.name, data);
        this.lastSketch = f.id;
        if (used.length) {
          // the sketch's plane as built, then each edge projected onto it as fixed, linked geometry
          const frame = (await this.model()).sketches.find((s) => s.featureId === f.id)?.frame;
          if (!frame) throw new AgentError('The sketch plane cannot be built: nothing to project onto');
          for (const r of used) {
            const part = r.kind === 'edge' ? parts.find((p) => p.id === r.partId) : undefined;
            const g = part && r.kind === 'edge' ? edgeGeometry(part, r.index) : null;
            const lg = g && projectGeometry(g, frame);
            if (!lg) throw new AgentError('An edge to use projects to nothing on the sketch plane (it is perpendicular to it)');
            addUsedGeometry(data as Draft<SketchData>, lg, r);
          }
        }
        return;
      }
      case 'extrude': {
        const p = defaultParams('extrude');
        if (op.surface) {
          // the sketch's curves, swept into a surface
          p.bodyType = 'surface';
          p.curves = this.sketchCurves(this.sketchFeature(op.sketch));
        } else p.profiles = this.regions(await this.profileSketch(op.sketch), op.regions);
        p.depth = this.expr(op.depth, 'length', '10 mm');
        p.flip = !!op.flip;
        if (op.start !== undefined) {
          p.startOffset = true;
          if (typeof op.start === 'object') {
            p.startType = 'entity';
            p.startEntity = [await this.planeRef(op.start.from)];
          } else {
            p.startType = 'blind';
            const back = typeof op.start === 'number' && op.start < 0;
            p.startDistance = this.expr(back ? -(op.start as number) : op.start, 'length', '0 mm');
            if (back) p.startFlip = true;
          }
        }
        if (op.boolean) p.op = op.boolean;
        if (op.end === 'symmetric' || op.end === 'throughAll' || op.end === 'blind') p.endType = op.end;
        else if (op.end && typeof op.end === 'object') {
          p.endType = 'upToFace';
          p.upTo = await this.faces(op.end.upToFace);
        }
        if (op.draft !== undefined) {
          p.draft = true;
          p.draftAngle = this.expr(op.draft, 'angle', '3 deg');
        }
        if (op.thin !== undefined) {
          p.thin = true;
          p.thickness = this.expr(op.thin, 'length', '2 mm');
        }
        this.add('extrude', op.name, p);
        return;
      }
      case 'revolve': {
        const p = defaultParams('revolve');
        if (op.surface) {
          p.bodyType = 'surface';
          p.curves = this.sketchCurves(this.sketchFeature(op.sketch));
        } else p.profiles = this.regions(await this.profileSketch(op.sketch), op.regions);
        const ax = await this.axis(op.axis);
        p.axis = [ax.ref];
        p.flip = ax.flip;
        if (op.angle !== undefined) {
          p.revolveType = 'one';
          p.angle = this.expr(op.angle, 'angle', '90 deg');
        }
        if (op.boolean) p.op = op.boolean;
        this.add('revolve', op.name, p);
        return;
      }
      case 'sweep': {
        const p = defaultParams('sweep');
        if (op.surface) {
          p.bodyType = 'surface';
          p.curves = this.sketchCurves(this.sketchFeature(op.sketch));
        } else p.profiles = this.regions(await this.profileSketch(op.sketch), op.regions);
        p.path = 'sketch' in op.path ? this.sketchCurves(this.sketchFeature(op.path.sketch)) : await this.edges(op.path.edges);
        if (op.keepOrientation) p.keepOrientation = true;
        if (op.boolean) p.op = op.boolean;
        this.add('sweep', op.name, p);
        return;
      }
      case 'split': {
        const p = defaultParams('split');
        p.parts = await this.parts(op.parts);
        const tool = op.tool;
        p.tool = typeof tool === 'object' && 'surface' in tool ? await this.parts(tool.surface) : [await this.planeRef(tool)];
        if (op.trim) p.trim = true;
        if (op.keepTools) p.keepTools = true;
        this.add('split', op.name, p);
        return;
      }
      case 'fillet': {
        const p = defaultParams('fillet');
        p.edges = await this.edges(op.edges);
        p.radius = this.expr(op.radius, 'length', '2 mm');
        if (op.tangentPropagation === false) p.tangentPropagation = false;
        if (op.vertices?.length || op.points?.length) {
          // a variable fillet: radii at vertices (the nearest vertex of the model to each point) and inside edges
          p.filletType = 'variable';
          p.vertices = [];
          p.vertexRadii = [];
          for (const v of op.vertices ?? []) {
            p.vertices.push(await this.vertexNear(v.at));
            p.vertexRadii.push(this.expr(v.radius, 'length', p.radius));
          }
          p.pointEdges = [];
          p.pointPositions = [];
          p.pointRadii = [];
          for (const q of op.points ?? []) {
            const found = await this.edges(q.edge);
            if (found.length !== 1) throw new AgentError(`A fillet point's edge query must match one edge, got ${found.length}`);
            if (!(q.at > 0 && q.at < 1)) throw new AgentError('A fillet point lies inside its edge: "at" between 0 and 1');
            p.pointEdges.push(found[0]);
            p.pointPositions.push(String(q.at));
            p.pointRadii.push(this.expr(q.radius, 'length', p.radius));
          }
          if (op.smooth) p.smooth = true;
        }
        this.add('fillet', op.name, p);
        return;
      }
      case 'chamfer': {
        const p = defaultParams('chamfer');
        p.edges = await this.edges(op.edges);
        p.distance = this.expr(op.distance, 'length', '2 mm');
        if (op.tangentPropagation === false) p.tangentPropagation = false;
        if (op.type) p.chamferType = op.type;
        p.distance2 = this.expr(op.distance2, 'length', p.distance2);
        p.angle = this.expr(op.angle, 'angle', p.angle);
        if (op.flip) p.flip = true;
        this.add('chamfer', op.name, p);
        return;
      }
      case 'shell': {
        const p = defaultParams('shell');
        p.faces = await this.faces(op.faces);
        p.thickness = this.expr(op.thickness, 'length', '2 mm');
        p.outward = !!op.outward;
        this.add('shell', op.name, p);
        return;
      }
      case 'deleteFace': {
        const p = defaultParams('deleteFace');
        p.faces = await this.faces(op.faces);
        if (op.heal === false) p.heal = false;
        this.add('deleteFace', op.name, p);
        return;
      }
      case 'offsetSurface': {
        const p = defaultParams('offsetSurface');
        p.faces = await this.faces(op.faces);
        p.distance = this.expr(op.distance, 'length', p.distance);
        if (op.flip) p.flip = true;
        this.add('offsetSurface', op.name, p);
        return;
      }
      case 'enclose': {
        const p = defaultParams('enclose');
        p.surfaces = await this.parts(op.surfaces);
        if (op.keep) p.keep = true;
        this.add('enclose', op.name, p);
        return;
      }
      case 'thicken': {
        const p = defaultParams('thicken');
        p.faces = [...(op.surfaces !== undefined ? await this.parts(op.surfaces) : []), ...(op.faces !== undefined ? await this.faces(op.faces) : [])];
        if (!p.faces.length) throw new AgentError('thicken needs "surfaces" or "faces"');
        p.thickness = this.expr(op.thickness, 'length', p.thickness);
        if (op.flip) p.flip = true;
        if (op.boolean) p.op = op.boolean;
        this.add('thicken', op.name, p);
        return;
      }
      case 'moveFace': {
        const p = defaultParams('moveFace');
        p.faces = await this.faces(op.faces);
        if (op.translate) {
          const d = await this.axis(op.translate.direction);
          Object.assign(p, { moveType: 'translate', direction: [d.ref], flip: d.flip, distance: this.expr(op.translate.distance, 'length', p.distance) });
        } else if (op.rotate) {
          const a = await this.axis(op.rotate.axis);
          Object.assign(p, { moveType: 'rotate', axis: [a.ref], flip: a.flip, angle: this.expr(op.rotate.angle, 'angle', p.angle) });
        } else if (op.offset !== undefined) p.distance = this.expr(op.offset, 'length', p.distance);
        else throw new AgentError('moveFace needs "offset", "translate" or "rotate"');
        this.add('moveFace', op.name, p);
        return;
      }
      case 'replaceFace': {
        const p = defaultParams('replaceFace');
        p.faces = await this.faces(op.faces);
        p.target = [await this.planeRef(op.with)];
        p.offset = this.expr(op.offset, 'length', p.offset);
        if (op.flip) p.flip = true;
        this.add('replaceFace', op.name, p);
        return;
      }
      case 'hole': {
        const p = defaultParams('hole');
        const elsewhere = op.edges !== undefined || !!op.mates?.length;
        p.points = [
          ...(op.sketch !== undefined || !elsewhere ? this.sketchPoints(this.sketchFeature(op.sketch)) : []),
          ...(op.edges !== undefined ? await this.edges(op.edges) : []),
          ...(op.mates ?? []).map((m) => this.mateRef(m)),
        ];
        if (op.flip) p.flip = true;
        p.diameter = this.expr(op.diameter, 'length', '5 mm');
        if (op.through) p.endType = 'throughAll';
        if (op.iso) {
          // the diameters from the ISO tables; the depths, unless given, as a new hole of that size starts with
          const size = Object.keys(ISO_SIZES).find((s) => s.toLowerCase() === op.iso!.size.toLowerCase());
          if (!size) throw new AgentError(`No ISO size "${op.iso.size}". Sizes: ${ISO_SIZE_NAMES.join(', ')}`);
          const tapped = op.iso.type === 'tapped';
          Object.assign(p, { standard: 'iso', size, holeType: tapped ? 'tapped' : 'clearance' });
          if (op.iso.fit) p.fit = op.iso.fit;
          if (op.iso.pitch !== undefined && op.iso.pitch !== isoPitches(size)[0]) p.pitch = String(op.iso.pitch);
          const bad = isoHole(p);
          if (typeof bad === 'string') throw new AgentError(`${bad}. Pitches: ${isoPitches(size).join(', ')}`);
          const d = isoDefaultDepths(size, tapped);
          p.depth = `${d.depth} mm`;
          p.tapDepth = this.expr(op.iso.tapDepth, 'length', `${d.tapDepth} mm`);
        }
        if (op.ansi) {
          // the inch tables (ANSI): the same way, the pitch as threads per inch
          const size = ANSI_SIZE_NAMES.find((s) => s === op.ansi!.size || s === `#${op.ansi!.size}`);
          if (!size) throw new AgentError(`No ANSI size "${op.ansi.size}". Sizes: ${ANSI_SIZE_NAMES.join(', ')}`);
          const tapped = op.ansi.type === 'tapped';
          Object.assign(p, { standard: 'ansi', size, holeType: tapped ? 'tapped' : 'clearance' });
          if (op.ansi.fit) p.fit = op.ansi.fit;
          if (op.ansi.tpi !== undefined && op.ansi.tpi !== ansiThreads(size)[0].tpi) p.pitch = String(op.ansi.tpi);
          const bad = ansiHole({ ...p, style: op.style ?? p.style });
          if (typeof bad === 'string') throw new AgentError(`${bad}. Threads per inch: ${ansiThreads(size).map((x) => `${x.tpi} ${x.series}`).join(', ')}`);
          const d = ansiDefaultDepths(size, tapped);
          p.depth = `${d.depth} mm`;
          p.tapDepth = this.expr(op.ansi.tapDepth, 'length', `${d.tapDepth} mm`);
        }
        p.depth = this.expr(op.depth, 'length', p.depth);
        if (op.style) p.style = op.style;
        p.cboreDiameter = this.expr(op.cboreDiameter, 'length', p.cboreDiameter);
        p.cboreDepth = this.expr(op.cboreDepth, 'length', p.cboreDepth);
        p.csinkDiameter = this.expr(op.csinkDiameter, 'length', p.csinkDiameter);
        p.csinkAngle = this.expr(op.csinkAngle, 'angle', p.csinkAngle);
        if (op.csinkRecess !== undefined) p.csinkRecess = this.expr(op.csinkRecess, 'length', '0 mm');
        this.add('hole', op.name, p);
        return;
      }
      case 'linearPattern': {
        const p = defaultParams('linearPattern');
        await this.patternSource(p, op.features, op.parts);
        const d1 = await this.axis(op.direction);
        p.direction = [d1.ref];
        p.flip = d1.flip;
        p.distance = this.expr(op.distance, 'length', p.distance);
        p.count = this.expr(op.count, 'number', p.count);
        if (op.direction2) {
          const d2 = await this.axis(op.direction2);
          p.secondDir = true;
          p.direction2 = [d2.ref];
          p.flip2 = d2.flip;
          p.distance2 = this.expr(op.distance2, 'length', p.distance2);
          p.count2 = this.expr(op.count2, 'number', p.count2);
        }
        if (op.boolean) p.op = op.boolean;
        this.add('linearPattern', op.name, p);
        return;
      }
      case 'circularPattern': {
        const p = defaultParams('circularPattern');
        await this.patternSource(p, op.features, op.parts);
        const ax = await this.axis(op.axis);
        p.axis = [ax.ref];
        p.flip = ax.flip;
        p.count = this.expr(op.count, 'number', p.count);
        p.angle = this.expr(op.angle, 'angle', p.angle);
        if (op.boolean) p.op = op.boolean;
        this.add('circularPattern', op.name, p);
        return;
      }
      case 'curvePattern': {
        const p = defaultParams('curvePattern');
        await this.patternSource(p, op.features, op.parts);
        p.path = 'sketch' in op.path ? this.sketchCurves(this.sketchFeature(op.path.sketch)) : await this.edges(op.path.edges);
        p.count = this.expr(op.count, 'number', p.count);
        if (op.distance !== undefined) {
          p.equalSpacing = false;
          p.distance = this.expr(op.distance, 'length', p.distance);
        }
        if (op.flip) p.flip = true;
        if (op.orient === false) p.orient = false;
        if (op.boolean) p.op = op.boolean;
        this.add('curvePattern', op.name, p);
        return;
      }
      case 'rib': {
        const p = defaultParams('rib');
        p.profiles = this.sketchCurves(this.sketchFeature(op.sketch));
        if (!p.profiles.length) throw new AgentError('The sketch has no curves for the rib');
        p.thickness = this.expr(op.thickness, 'length', p.thickness);
        if (op.normal) p.direction = 'normal';
        if (op.flip) p.flip = true;
        if (op.extend === false) p.extend = false;
        if (op.draft !== undefined) {
          p.draft = true;
          p.draftAngle = this.expr(op.draft, 'angle', '1 deg');
          if (op.draftFlip) p.draftFlip = true;
        }
        this.add('rib', op.name, p);
        return;
      }
      case 'wrap': {
        const p = defaultParams('wrap');
        p.profiles = this.regions(await this.profileSketch(op.sketch), op.regions);
        const onto = await this.faces(op.onto);
        if (!onto.length) throw new AgentError('No face to wrap onto');
        p.target = [onto[0]];
        p.depth = this.expr(op.depth, 'length', p.depth);
        if (op.boolean) p.op = op.boolean;
        this.add('wrap', op.name, p);
        return;
      }
      case 'mirror': {
        const p = defaultParams('mirror');
        await this.patternSource(p, op.features, op.parts);
        p.plane = [await this.planeRef(op.plane)];
        if (op.boolean) p.op = op.boolean;
        this.add('mirror', op.name, p);
        return;
      }
      case 'plane': {
        const p = defaultParams('plane');
        p.refs = [await this.planeRef(op.from)];
        p.offset = this.expr(op.offset, 'length', p.offset);
        this.add('plane', op.name, p);
        return;
      }
      case 'mateConnector': {
        const p = defaultParams('mateConnector');
        const loc = await this.location(op.at);
        p.location = [loc.ref];
        p.inference = loc.inference;
        p.orientFace = loc.orient ? [loc.orient] : [];
        if (op.between) {
          const loc2 = await this.location(op.between);
          p.mode = 'between';
          p.location2 = [loc2.ref];
          p.inference2 = loc2.inference;
          p.orientFace2 = loc2.orient ? [loc2.orient] : [];
        }
        if (op.owner !== undefined) {
          const owner = await this.parts(op.owner);
          if (owner.length !== 1) throw new AgentError(`mateConnector owner must be one part (got ${owner.length})`);
          p.ownerPart = owner;
        }
        if (op.primaryAxis) p.primaryAxis = [(await this.axis(op.primaryAxis)).ref];
        if (op.secondaryAxis) p.secondaryAxis = [(await this.axis(op.secondaryAxis)).ref];
        p.flipPrimary = !!op.flip;
        if (op.reorient) p.reorient = op.reorient;
        p.rotation = this.expr(op.rotation, 'angle', p.rotation);
        if (op.offset) {
          p.dx = this.expr(op.offset[0], 'length', p.dx);
          p.dy = this.expr(op.offset[1], 'length', p.dy);
          p.dz = this.expr(op.offset[2], 'length', p.dz);
        }
        this.add('mateConnector', op.name, p);
        return;
      }
      case 'transform': {
        const p = defaultParams('transform');
        p.mode = 'mates';
        p.parts = await this.parts(op.parts);
        p.fromMate = [this.mateRef(op.from)];
        p.toMate = [this.mateRef(op.to)];
        p.copy = !!op.copy;
        this.add('transform', op.name, p);
        return;
      }
      case 'boolean': {
        const p = defaultParams('boolean');
        p.op = op.type;
        p.targets = await this.parts(op.targets);
        p.tools = await this.parts(op.tools);
        p.keepTools = !!op.keepTools;
        this.add('boolean', op.name, p);
        return;
      }
      case 'deletePart': {
        const p = defaultParams('deletePart');
        p.parts = await this.parts(op.parts);
        this.add('deletePart', op.name, p);
        return;
      }
      case 'feature': {
        if (!(op.type in FEATURE_LABELS)) throw new AgentError(`Unknown feature type "${op.type}". Types: ${Object.keys(FEATURE_LABELS).join(', ')}`);
        const params = { ...(defaultParams(op.type) as object), ...((await this.resolveParams(op.params ?? {})) as object) };
        const f = this.add(op.type, op.name, params);
        if (f.type === 'sketch') this.lastSketch = f.id;
        return;
      }
      case 'set': {
        const f = this.feature(op.feature);
        // queries see the model before this feature
        const idx = this.s.features.indexOf(f);
        const saved = this.s.rollback;
        this.s.rollback = idx;
        try {
          const patch = (await this.resolveParams(op.params ?? {})) as Record<string, unknown>;
          // configured parameters go to the chosen configuration's cells; the feature keeps its own values
          for (const [k, v] of Object.entries(patch))
            if ((typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && setConfigured(this.s, f.id, k, String(v))) delete patch[k];
          Object.assign(f.params as object, patch);
        } finally {
          this.s.rollback = saved;
        }
        return;
      }
      case 'delete': {
        const f = this.feature(op.feature);
        const idx = this.s.features.indexOf(f);
        this.s.features.splice(idx, 1);
        if (this.s.rollback !== null && idx < this.s.rollback) this.s.rollback--;
        for (const fo of this.s.folders ?? []) fo.featureIds = fo.featureIds.filter((x) => x !== f.id);
        pruneConfiguration(this.s);
        if (this.lastSketch === f.id) this.lastSketch = null;
        return;
      }
      case 'rename': {
        if (this.s.features.some((x) => x.name === op.to)) throw new AgentError(`A feature named "${op.to}" already exists`);
        this.feature(op.feature).name = op.to;
        return;
      }
      case 'suppress': {
        const f = this.feature(op.feature);
        if (!setConfigured(this.s, f.id, 'suppressed', String(op.value !== false))) f.suppressed = op.value !== false;
        return;
      }
      case 'derived': {
        if (!this.kernel.derivedSource) throw new AgentError('Derived needs the document: run it on a document');
        if (op.document && !op.version) throw new AgentError('"document" needs "version": other documents are derived from their versions');
        const src = await this.kernel.derivedSource(op.studio, this.s.id, op.configuration, op.version ? { version: op.version, document: op.document } : undefined);
        // parts: [] — none (only its sketches)
        const parts = (op.parts ?? []).map((n) => {
          const p = src.parts.find((x) => x.name === n || x.id === n) ?? src.parts.find((x) => x.name.toLowerCase() === n.toLowerCase());
          if (!p) throw new AgentError(`No part "${n}" in ${src.name}. Parts: ${src.parts.map((x) => x.name).join(', ') || '(none)'}`);
          return p.id;
        });
        const sketches = (op.sketches ?? []).map((n) => {
          const list = src.sketches ?? [];
          const s = list.find((x) => x.name === n || x.id === n) ?? list.find((x) => x.name.toLowerCase() === n.toLowerCase());
          if (!s) throw new AgentError(`No sketch "${n}" in ${src.name}. Sketches: ${list.map((x) => x.name).join(', ') || '(none)'}`);
          return s.id;
        });
        if (op.parts && !op.parts.length && !sketches.length) throw new AgentError('Derived with "parts": [] needs "sketches"');
        // placed at a mate connector of this Part Studio: the source's origin (or its mate connector `from`) there
        const placeFrom = op.from ? src.connectors?.find((c) => c.name === op.from || c.name.toLowerCase() === op.from!.toLowerCase())?.id : undefined;
        if (op.from && !placeFrom) throw new AgentError(`No mate connector "${op.from}" in ${src.name}. Mate connectors: ${src.connectors?.map((c) => c.name).join(', ') || '(none)'}`);
        if (op.from && !op.at) throw new AgentError('"from" needs "at": the mate connector of this Part Studio to put it on');
        this.add('derived', op.name, {
          studioId: src.studioId,
          parts,
          ...(op.parts && !op.parts.length ? { noParts: true } : {}),
          ...(sketches.length ? { sketches } : {}),
          placeTo: op.at ? [this.mateRef(op.at)] : [],
          ...(placeFrom ? { placeFrom } : {}),
          ...(src.configuration ? { configuration: src.configuration } : {}),
        });
        return;
      }
      case 'configuration': {
        if (op.variable) {
          // a variable input: the variable (made at the top of the list, so every feature can use it)
          const name = op.name.replace(/^#/, '');
          if (!/^[A-Za-z_]\w*$/.test(name)) throw new AgentError(`"${op.name}" is not a variable name`);
          let v = this.s.features.find((f): f is FeatureOf<'variable'> => f.type === 'variable' && f.params.name === name);
          if (!v) {
            v = { id: uid('f'), type: 'variable', name: nextFeatureName(this.s.features, 'variable'), params: { ...defaultParams('variable'), name, value: '10 mm', varType: 'length' } };
            this.s.features.unshift(v);
            if (this.s.rollback !== null) this.s.rollback++;
          }
          if (op.variable.type) v.params.varType = op.variable.type;
          if (op.variable.value !== undefined) v.params.value = this.varValue(v, op.variable.value);
          const key = configKey(v.id, 'value');
          const old = this.s.configuration?.find((x) => x.kind === 'variable' && x.params[0] === key);
          const input: ConfigInput = { id: old?.id ?? uid('ci'), name, kind: 'variable', options: [], params: [key], values: {} };
          const inputs = this.s.configuration ?? [];
          this.s.configuration = old ? inputs.map((x) => (x === old ? input : x)) : [...inputs, input];
          return;
        }
        // a checkbox input: two options, off and on
        const options = op.checkbox ? (op.options?.length ? op.options : ['Off', 'On']) : op.options;
        if (op.checkbox && options?.length !== 2) throw new AgentError('A checkbox configuration has two options: off and on');
        if (!op.name || !options?.length) throw new AgentError('configuration needs "name" and "options"');
        const keys = (op.params ?? []).map((p) => {
          if ('variable' in p) {
            const v = this.s.features.find((f) => f.type === 'variable' && f.params.name === p.variable.replace(/^#/, ''));
            if (!v) throw new AgentError(`No variable #${p.variable}`);
            return configKey(v.id, 'value');
          }
          const f = this.feature(p.feature);
          if ('dimension' in p) {
            // a sketch dimension by its number
            const dims = f.type === 'sketch' ? f.params.constraints.filter(isDimension) : [];
            const c = dims[p.dimension - 1];
            if (!c) throw new AgentError(`"${f.name}" has no dimension ${p.dimension}: it has ${dims.length}`);
            return configKey(f.id, `${DIM}${c.id}`);
          }
          const param = p.param ?? 'suppressed';
          if (param !== 'suppressed' && ownValue(f, param) === undefined)
            throw new AgentError(`"${f.name}" has no parameter "${param}". Parameters: ${Object.keys(f.params).filter((k) => ownValue(f, k) !== undefined).join(', ')}`);
          return configKey(f.id, param);
        });
        const old = this.s.configuration?.find((x) => x.name === op.name);
        const input: ConfigInput = {
          id: old?.id ?? uid('ci'),
          name: op.name,
          ...(op.checkbox ? { kind: 'checkbox' as const } : {}),
          options: options.map((name) => ({ id: old?.options.find((o) => o.name === name)?.id ?? uid('co'), name })),
          params: keys,
          values: {},
        };
        for (const [name, row] of Object.entries(op.values ?? {})) {
          const o = input.options.find((x) => x.name === name);
          if (!o) throw new AgentError(`No option "${name}" in configuration "${op.name}". Options: ${options.join(', ')}`);
          if (row.length !== keys.length) throw new AgentError(`"${name}": ${row.length} values for ${keys.length} parameters`);
          const cells: Record<string, string> = {};
          // a bare number takes the document's units, as in any field
          row.forEach((v, k) => v !== null && v !== undefined && (cells[keys[k]] = String(v)));
          input.values[o.id] = cells;
        }
        const inputs = this.s.configuration ?? [];
        this.s.configuration = old ? inputs.map((x) => (x === old ? input : x)) : [...inputs, input];
        return;
      }
      case 'configure': {
        const choice = { ...this.s.configChoice };
        for (const [name, option] of Object.entries(op.values ?? {})) {
          const input = this.input(name);
          if (input.kind === 'variable') {
            // a variable input: any value of its type ("" — its own)
            const v = inputVariable(this.s.features, input);
            if (!v || typeof option === 'boolean') throw new AgentError(`"${name}" is a variable: give it a value`);
            if (option === '') delete choice[input.id];
            else choice[input.id] = this.varValue(v, option);
            continue;
          }
          // a checkbox input: true — on (its second option), false — off
          const o =
            typeof option === 'boolean'
              ? input.kind === 'checkbox'
                ? input.options[option ? 1 : 0]
                : undefined
              : input.options.find((x) => x.name === String(option) || x.name.toLowerCase() === String(option).toLowerCase());
          if (!o) throw new AgentError(`No option "${option}" in "${input.name}". Options: ${input.options.map((x) => x.name).join(', ')}`);
          choice[input.id] = o.id;
        }
        this.s.configChoice = choice;
        return;
      }
      case 'part': {
        const [p] = await this.partsOf(op.part);
        const meta = { ...(this.s.parts[p.id] ?? {}) };
        if (op.name !== undefined) meta.name = op.name;
        if (op.color !== undefined) meta.color = op.color;
        if (op.opacity !== undefined) {
          if (!(op.opacity > 0 && op.opacity <= 1)) throw new AgentError('"opacity" is from 0.1 (almost clear) to 1 (opaque)');
          if (op.opacity >= 1) delete meta.opacity;
          else meta.opacity = Math.max(0.1, op.opacity);
        }
        if (op.hidden !== undefined) meta.hidden = op.hidden;
        if (op.material === null) {
          delete meta.material;
          delete meta.density;
        } else if (op.material !== undefined || op.density !== undefined) {
          // a library material brings its density; one of your own needs it
          const lib = op.material !== undefined ? findMaterial(op.material) : undefined;
          if (op.material !== undefined) meta.material = lib ? lib.name : op.material;
          const density = op.density ?? lib?.density;
          if (!(density !== undefined && density > 0)) throw new AgentError(`Material "${op.material}" is not in the library (${MATERIALS.map((m) => m.id).join(', ')}): give its density, g/cm³`);
          meta.density = density;
        }
        this.s.parts = { ...this.s.parts, [p.id]: meta };
        return;
      }
      default:
        throw new AgentError(`Unknown op "${(op as { op: string }).op}"`);
    }
  }

  private async patternSource(p: { patternType: string; features: string[]; parts: SelRef[] }, features?: string[], parts?: Parts) {
    if (features?.length) {
      p.patternType = 'feature';
      p.features = features.map((n) => this.feature(n).id);
    } else if (parts !== undefined) {
      p.patternType = 'part';
      p.parts = await this.parts(parts);
    } else throw new AgentError('Give "features": [names] or "parts"');
  }
}

function dedupe(refs: SelRef[]): SelRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const k = r.kind === 'face' || r.kind === 'edge' ? `${r.kind}:${r.partId}:${r.index}` : JSON.stringify(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** A sketch a Derived feature brings (its key "derivedId.sketchId"): "Derived 1 / Sketch 1". */
function derivedSketchName(studio: PartStudioTab, key: string, name: string | undefined): string {
  const owner = studio.features.find((f) => f.id === key.split('.')[0]);
  return owner && name ? `${owner.name} / ${name}` : key;
}

/** Summary of the model built from `studio` (document units). */
export async function summarize(studio: PartStudioTab, units: Units, kernel: AgentKernel, build?: BuildResult): Promise<ModelSummary> {
  const rollback = studio.rollback === null ? studio.features.length : studio.rollback;
  const configured = configuredFeatures(studio);
  const res = build ?? (await kernel.build(configured.slice(0, rollback)));
  const k = LENGTH_FACTOR[units.length];
  const parts = [];
  for (const p of res.parts) {
    const items = await kernel.measure([{ kind: 'part', partId: p.id }]).catch(() => []);
    const vol = items.find((i) => i.label === 'Volume')?.value;
    const area = items.find((i) => i.label === 'Surface area')?.value;
    const lo = p.bbox[0].map((v) => v / k) as Vec3;
    const hi = p.bbox[1].map((v) => v / k) as Vec3;
    parts.push({
      id: p.id,
      name: p.name,
      bboxMin: round3(lo),
      bboxMax: round3(hi),
      size: round3([hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]),
      ...(vol !== undefined ? { volume: round(vol / k ** 3) } : {}),
      ...(area !== undefined ? { area: round(area / k ** 2) } : {}),
      // its material (none — steel for the mass) and mass, kg
      ...(studio.parts[p.id]?.material ? { material: studio.parts[p.id].material } : {}),
      // (to a milligram: small printed parts weigh grams)
      ...(vol !== undefined && !p.surface ? { mass: Math.round(massKg(vol, partDensity(studio.parts[p.id])) * 1e6) / 1e6 } : {}),
      faces: p.faces.length,
      edges: p.edges.filter((e) => !e.seam).length,
      ...(p.surface ? { surface: true as const } : {}),
    });
  }
  const vars = collectVariables(configured, rollback, units);
  const partNames = new Map(res.parts.map((p) => [p.id, p.name]));
  // configured parameters by name: "Extrude 1.depth", "#w"
  const paramName = (key: string) => {
    const { featureId, param } = splitConfigKey(key);
    const f = studio.features.find((x) => x.id === featureId);
    if (f?.type === 'sketch' && param.startsWith(DIM)) return `${f.name}.dimension ${f.params.constraints.filter(isDimension).findIndex((c) => c.id === param.slice(DIM.length)) + 1}`;
    return !f ? '?' : f.type === 'variable' && param === 'value' ? `#${f.params.name}` : `${f.name}.${param}`;
  };
  return {
    units: { length: units.length, angle: units.angle },
    ...(studio.configuration?.length
      ? {
          // a variable input: its variable's name and value now
          configuration: studio.configuration.map((i) => ({
            name: i.kind === 'variable' ? inputName(studio.features, i).replace(/^#/, '') : i.name,
            options: i.options.map((o) => o.name),
            chosen: chosenLabel(studio.features, i, studio.configChoice),
            params: i.params.map(paramName),
            ...(i.kind === 'variable' ? { variable: true as const } : {}),
          })),
        }
      : {}),
    features: configured.map((f, i) => {
      const st = res.statuses[f.id];
      const status = i >= rollback ? 'rolledBack' : f.suppressed ? 'suppressed' : !st ? 'ok' : !st.ok ? 'error' : st.warning ? 'warning' : 'ok';
      const message = st?.error ?? st?.warning;
      return { name: f.name, type: f.type, status, ...(message && status !== 'rolledBack' ? { message } : {}) };
    }),
    variables: Object.fromEntries(Object.entries(vars).map(([n, q]) => [n, formatQuantity(q, units.length)])),
    parts,
    sketches: res.sketches.map((s) => ({
      // one a Derived feature brings: "Derived 1 / Sketch 1"
      name: studio.features.find((f) => f.id === s.featureId)?.name ?? derivedSketchName(studio, s.featureId, s.name),
      origin: round3(s.frame.origin.map((v) => v / k) as Vec3),
      xDir: round3(s.frame.xDir),
      yDir: round3(s.frame.yDir),
      normal: round3(s.frame.normal),
      regions: computeRegions(s.entities).length,
    })),
    mates: (res.mates ?? []).map((m) => ({
      name: studio.features.find((f) => f.id === m.featureId)?.name ?? m.featureId,
      origin: round3(m.frame.origin.map((v) => v / k) as Vec3),
      xDir: round3(m.frame.xDir),
      zDir: round3(m.frame.normal),
      ...(m.owner && partNames.has(m.owner) ? { owner: partNames.get(m.owner) } : {}),
    })),
    ...(res.threads?.length
      ? {
          threads: res.threads.map((t) => ({
            designation: t.designation,
            origin: round3(t.origin.map((v) => v / k) as Vec3),
            dir: round3(t.dir),
            length: round(t.length / k),
            ...(t.owner && partNames.has(t.owner) ? { part: partNames.get(t.owner) } : {}),
          })),
        }
      : {}),
  };
}

/**
 * Apply `ops` to a copy of `studio`. Returns the edited studio and a report; when an op fails
 * (bad query, unknown feature…) the original studio is returned with `ok: false`.
 */
export async function runOps(studio: PartStudioTab, units: Units, ops: AgentOp[], kernel: AgentKernel): Promise<{ studio: PartStudioTab; report: RunReport }> {
  if (!Array.isArray(ops)) throw new AgentError('ops must be an array of operations');
  const s = structuredClone(studio) as PartStudioTab;
  const r = new Runner(s, units, kernel);
  let i = 0;
  try {
    for (; i < ops.length; i++) await r.apply(ops[i]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      studio,
      report: { ok: false, error: `op #${i} (${ops[i]?.op ?? '?'}): ${msg}`, added: [], changed: [], removed: [], failed: [], applied: false },
    };
  }
  const before = new Map(studio.features.map((f) => [f.id, JSON.stringify(f)]));
  const rollback = s.rollback === null ? s.features.length : s.rollback;
  const build = await kernel.build(configuredFeatures(s).slice(0, rollback));
  const added = s.features.filter((f) => !before.has(f.id));
  const changed = s.features.filter((f) => before.has(f.id) && before.get(f.id) !== JSON.stringify(f));
  const removed = studio.features.filter((f) => !s.features.some((x) => x.id === f.id));
  const failed = [...added, ...changed]
    .filter((f) => build.statuses[f.id] && !build.statuses[f.id].ok)
    .map((f) => ({ feature: f.name, error: build.statuses[f.id].error ?? 'failed' }));
  const model = await summarize(s, units, kernel, build);
  return {
    studio: s,
    report: {
      ok: failed.length === 0,
      added: added.map((f) => f.name),
      changed: changed.map((f) => f.name),
      removed: removed.map((f) => f.name),
      failed,
      applied: false,
      model,
    },
  };
}

/**
 * Faces or edges of one part of a ready build that match a query — assemblies: an instance's part as placed,
 * queried in assembly coordinates.
 */
export async function matchOnPart(
  build: BuildResult,
  units: Units,
  partId: string,
  q: { face?: FaceQuery; edge?: EdgeQuery },
): Promise<{ kind: 'face' | 'edge'; index: number }[]> {
  const host: PartStudioTab = { id: '', type: 'partStudio', name: '', features: [], rollback: null, parts: {} };
  const r = new Runner(host, units, { build: async () => build, measure: async () => [] });
  if (q.face) return (await r.faceMatchesOf({ ...q.face, part: partId })).map((m) => ({ kind: 'face' as const, index: m.index }));
  if (q.edge) return (await r.edgeMatchesOf({ ...q.edge, part: partId })).map((m) => ({ kind: 'edge' as const, index: m.index }));
  return [];
}

/** Faces / edges / parts matching a query, with their geometry (for exploring the model). */
/**
 * Measure (the app's measure panel) of the selections the queries match, in the document's units (angles in degrees):
 * one — its sizes; two — the minimum / maximum distance, centre to centre, the angle; several — total length / area / volume.
 */
export async function measureModel(
  studio: PartStudioTab,
  units: Units,
  kernel: AgentKernel,
  q: { faces?: Faces; edges?: Edges; parts?: Parts },
): Promise<Record<string, number>> {
  const r = new Runner(structuredClone(studio) as PartStudioTab, units, kernel);
  const refs = [...(q.parts !== undefined ? await r.parts(q.parts) : []), ...(q.faces !== undefined ? await r.faces(q.faces) : []), ...(q.edges !== undefined ? await r.edges(q.edges) : [])];
  if (!refs.length) throw new AgentError('Nothing to measure: give faces, edges or parts');
  const k = LENGTH_FACTOR[units.length];
  const scale: Record<string, (v: number) => number> = {
    length: (v) => v / k,
    area: (v) => v / k ** 2,
    volume: (v) => v / k ** 3,
    angle: (v) => (v * 180) / Math.PI,
  };
  const out: Record<string, number> = {};
  for (const it of await kernel.measure(refs)) out[it.label] = round((scale[it.kind ?? ''] ?? ((v: number) => v))(it.value));
  return out;
}

export async function queryModel(
  studio: PartStudioTab,
  units: Units,
  kernel: AgentKernel,
  q: { faces?: Faces; edges?: Edges; parts?: Parts },
): Promise<unknown> {
  const r = new Runner(structuredClone(studio) as PartStudioTab, units, kernel);
  const k = LENGTH_FACTOR[units.length];
  const v = (p: Vec3) => round3(p.map((x) => x / k) as Vec3);
  const out: Record<string, unknown> = {};
  if (q.faces !== undefined) {
    const list: FaceQuery[] = q.faces === 'all' ? [{}] : Array.isArray(q.faces) ? q.faces : [q.faces];
    out.faces = (await Promise.all(list.map((one) => r.faceMatchesOf(one)))).flat().map((m) => ({
      part: m.part.name,
      index: m.index,
      type: m.info.type.toLowerCase().replace('cylindre', 'cylinder'),
      center: v(m.info.center),
      ...(m.info.normal ? { normal: round3(m.info.normal) } : {}),
      ...(m.info.radius !== undefined ? { radius: round(m.info.radius / k) } : {}),
      area: round(m.info.area / k ** 2),
    }));
  }
  if (q.edges !== undefined) {
    const list: EdgeQuery[] = q.edges === 'all' ? [{}] : Array.isArray(q.edges) ? q.edges : [q.edges];
    out.edges = (await Promise.all(list.map((one) => r.edgeMatchesOf(one)))).flat().map((m) => ({
      part: m.part.name,
      index: m.index,
      type: m.info.type.toLowerCase(),
      start: v(m.info.start),
      end: v(m.info.end),
      ...(m.info.radius !== undefined ? { radius: round(m.info.radius / k) } : {}),
      length: round(m.info.length / k),
    }));
  }
  if (q.parts !== undefined) {
    const refs = await r.parts(q.parts);
    const res = await r.model();
    out.parts = refs.map((ref) => res.parts.find((p) => ref.kind === 'part' && p.id === ref.partId)!.name);
  }
  return out;
}
