// Interactive sketch editing inside the graphics area (Onshape-like sketch mode).

import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { produce, type Draft } from 'immer';
import type { ConstraintType, PlaneFrame, SkConstraint, SkEntity, SkPattern, SketchData, Vec2 } from '../core/types';
import { uid } from '../core/ids';
import { expandPatterns, isCopyId, parseCopyId, patternCenter, patternInstances, patternParams, seedCenter } from '../sketch/patterns';
import { STD_PLANES, toLocal } from '../core/math';
import { collectVariables, isDimension, makeEvalContext, sketchDims } from '../core/features';
import { configuredOf } from '../core/config';
import { formatNumber, LENGTH_FACTOR, tryEvaluate } from '../core/expr';
import { sampleEntity, sampleSpline } from '../sketch/curves';
import { arcAngles, closestPointOnEntity, entityMap, naturalHandles, pointOf, type EntityMap } from '../sketch/curves';
import { extensionPoint, guideCrossing, inferDirection, quadrantPos, quadrants, type DirectionInference } from '../sketch/inference';
import { computeRegions } from '../sketch/regions';
import { solveSketch, frozenValues, initialVariant, measureConstraint, symmetryFit } from '../sketch/solver';
import {
  addArc,
  addCenterRectangle,
  addCircle,
  addConstraint,
  addEllipse,
  addLine,
  addPoint,
  addPolygon,
  polygonVertices,
  addRectangle,
  addSlot,
  addSpline,
  addSplineHandle,
  splineEndAt,
  applySnap,
  circumcircle,
  deleteItems,
  filletCorner,
  onCcwArc,
  toggleConstruction,
  trimEntity,
  mirrorEntities,
  patternableIds,
  copyEntities,
  moveEntities,
  splitEntity,
  addBezier,
  addText,
  addGear,
  DEFAULT_GEAR,
  type GearParamsOf,
  conicControls,
  conicRho,
  isQuadrantId,
  quadrantId,
  type Snap,
} from '../sketch/sketchOps';
import { expandTexts, loadFonts, onFontLoaded, textOfPart, textOutline } from '../sketch/text';
import { expandGears, gearOfPart, gearOutline, gearSizeOf } from '../sketch/gear';
import { gearCircles } from '../core/gear';
import { arrowTriangle, dimensionGeometry } from '../sketch/dimensions';
import { CONSTRAINT_GLYPH_SVG } from '../ui/constraintGlyphs';
import { attachVariableSuggest, varChoices } from '../ui/varSuggest';
import { refKey, useEditor, type SketchTool, type SketchTransformState } from '../store/editorStore';
import { addUsedGeometry, projectGeometry } from '../sketch/useGeometry';
import { applyOffset, chainIdsOf, chainPolylines, computeOffset, extendEntity, extendTarget, offsetChains, offsetDistanceAt } from '../sketch/offset';
import type { SelToken } from '../core/fieldSpecs';
import { activeStudio, useDoc } from '../store/docStore';
import { constantIds, makePickMaterial } from './picking';
import {
  COLORS,
  disposeObject,
  entityPolyline,
  fatSegments,
  frameMatrix,
  lineMaterial,
  pointsObject,
  polylineSegments,
  regionGeometry,
} from './sketchRender';
import type { Engine } from './engine';
import { t } from '../i18n';

type Pt = { pos: Vec2; snap: Snap };

type ToolState =
  | { k: 'idle' }
  | { k: 'line'; start: Pt; chainPoint?: string; firstPoint?: string; firstPos?: Vec2 }
  | { k: 'rect'; a: Pt }
  | { k: 'circle'; c: Pt }
  | { k: 'multi'; pts: Pt[] }
  | { k: 'tarc'; start: Vec2; startPoint: string; tangent: Vec2; curveId: string }
  /** `toCurve`: a circle / arc picked with Shift — the distance to it, not to its centre. */
  | { k: 'dim'; refs: string[]; toCurve?: boolean }
  | { k: 'offset'; ids: string[] }
  /** Polygon size locked: moving the cursor (or typing) sets the number of sides (Onshape). */
  | { k: 'polySides'; c: Pt; v: Vec2; base: number; startPx: number };

const POLY_MIN = 3;
const POLY_MAX = 50;
/** Cursor travel (px) per added / removed polygon side. */
const POLY_STEP_PX = 16;

const POLYGON_TOOLS = new Set<SketchTool>(['polygon', 'polygonInscribed']);
/** Pick id of a not yet created spline tangent handle: `${splineId}#h0` / `#h1`. */
const GHOST_HANDLE = /^(.+)#(h0|h1)$/;

/** Closed outline of the polygon being drawn (first vertex repeated). */
function polygonOutline(c: Vec2, v: Vec2, sides: number, inscribed: boolean): Vec2[] {
  const vs = polygonVertices(c, v, sides, inscribed);
  return [...vs, vs[0]];
}

const OFFSETTABLE = new Set(['line', 'arc', 'circle']);

/** Tools that place points (snapping and inference apply). */
const DRAW_TOOLS = new Set<SketchTool>([
  'line',
  'rectCorner',
  'rectCenter',
  'circleCenter',
  'circle3pt',
  'arc3pt',
  'arcTangent',
  'arcCenter',
  'spline',
  'bezier',
  'conic',
  'point',
  'slot',
  'polygon',
  'polygonInscribed',
  'ellipse',
]);

/** `variant`: the ellipse axis of a diameter (0 / 1). */
type QuickSpec = { type: 'distance' | 'radius' | 'diameter'; refs: string[]; variant?: number };
type QuickDim = { spec: QuickSpec; input: HTMLInputElement; edited: boolean };

type DragState =
  /** `snap`: inference while dragging a single point (applied as a constraint on release). */
  | { kind: 'points'; ids: string[]; start: Vec2; orig: Map<string, Vec2>; base: SketchData; snap?: Snap | null; exclude?: Set<string> }
  | { kind: 'radius'; id: string; base: SketchData }
  | { kind: 'label'; id: string; base: SketchData };

const GLYPH: Partial<Record<ConstraintType, string>> = {
  horizontal: 'H',
  vertical: 'V',
  parallel: '∥',
  perpendicular: '⊥',
  tangent: 'T',
  equal: '=',
  midpoint: 'M',
  concentric: '◎',
  symmetric: '⇹',
  fix: '⚓',
  coincident: '●',
};

/** How many picks a constraint tool takes at most before it starts again (the tool first, then the picks). */
const constraintPicks = (t: ConstraintType) => (t === 'symmetric' ? 3 : t === 'fix' ? 1 : 2);

/** The Mirror tool's hints: what to pick. */
const MIRROR_LINE = 'Mirror: select the mirror line (a line or a construction line).';
const MIRROR_ENTITIES = 'Mirror: select entities to mirror about the line. Esc — done.';

const SNAP_PX = 9;
const USE_ACCEPTS: SelToken[] = ['edge', 'vertex', 'face', 'sketchCurve', 'sketchPoint', 'origin'];
const PLANE_ACCEPTS: SelToken[] = ['plane', 'planarFace'];

export class SketchEditor {
  private engine: Engine;
  active = false;
  featureId: string | null = null;
  frame: PlaneFrame = STD_PLANES.top;
  private root = new THREE.Group();
  private pickRoot = new THREE.Group();
  private preview = new THREE.Group();
  private labels = new THREE.Group();
  private glyphs: { obj: CSS2DObject; anchor: Vec2; dir: Vec2; slot: number; leader?: boolean }[] = [];
  private tool: ToolState = { k: 'idle' };
  private toolName: SketchTool = 'select';
  private cursor: Vec2 = [0, 0];
  private snap: Snap | null = null;
  private hvSnap: 'h' | 'v' | null = null;
  /** The direction of the line being drawn inferred from geometry (parallel / perpendicular / tangent). */
  private dirSnap: DirectionInference | null = null;
  private drag: DragState | null = null;
  private pressed: { x: number; y: number; hit: string | null } | null = null;
  private box: { x0: number; y0: number; x1: number; y1: number; el: HTMLDivElement } | null = null;
  private renderedPx = 0;
  private renderedData: SketchData | null = null;
  private renderedSel: string[] | null = null;
  private renderedHover: string | null | undefined = undefined;
  private renderedShowCons: boolean | undefined = undefined;
  private renderedPattern: unknown = undefined;
  private renderedShowExpr: boolean | undefined = undefined;
  private dimInput: HTMLInputElement;
  private editingDim: { id: string; isNew: boolean } | null = null;
  private inferLabel: HTMLDivElement;
  private planeKey = '';
  /** The new sketch had no plane when the view was last placed (see SketchSession.planePending). */
  private awaitingPlane = false;
  /** Optional dimensions offered right after a shape is drawn (typing a value + Enter adds them). */
  private quick: { box: HTMLDivElement; items: QuickDim[] } | null = null;
  /** Number of polygon sides (kept for the next polygon) and digits typed while drawing one. */
  private polySides = 6;
  private polyTyped = '';
  private sidesLabel: HTMLDivElement;

  constructor(engine: Engine) {
    this.engine = engine;
    for (const g of [this.root, this.pickRoot]) g.matrixAutoUpdate = false;
    this.root.add(this.preview, this.labels);
    this.dimInput = document.createElement('input');
    this.dimInput.className = 'dim-input';
    this.dimInput.style.display = 'none';
    this.dimInput.addEventListener('keydown', (e) => this.onDimKey(e));
    this.dimInput.addEventListener('blur', () => this.commitDimInput(true));
    // "#" lists the variables (its keys go before ours: Enter picks one rather than committing)
    this.offVarSuggest = attachVariableSuggest(this.dimInput, () => varChoices(this.evalCtx().vars, useDoc.getState().doc!.units));
    engine.container.appendChild(this.dimInput);
    this.inferLabel = document.createElement('div');
    this.inferLabel.className = 'infer-label';
    this.inferLabel.style.display = 'none';
    engine.container.appendChild(this.inferLabel);
    this.sidesLabel = document.createElement('div');
    this.sidesLabel.className = 'infer-label poly-sides';
    this.sidesLabel.style.display = 'none';
    engine.container.appendChild(this.sidesLabel);
    // the letters of texts are drawn once their font is there
    this.offFonts = onFontLoaded(() => this.renderSketch(true));
    loadFonts().catch(() => useEditor.getState().showToast(t('The fonts of sketch text could not be loaded'), 'error'));
  }

  private offFonts: () => void;
  private offVarSuggest: () => void;

  dispose() {
    this.deactivate();
    this.offFonts();
    this.offVarSuggest();
    this.dimInput.remove();
    this.inferLabel.remove();
    this.sidesLabel.remove();
  }

  // -------------------------------------------------------------------------
  // Store sync
  // -------------------------------------------------------------------------

  private data(): SketchData | null {
    const d = useEditor.getState().editing?.draft;
    return d && d.type === 'sketch' ? d.params : null;
  }

  private map(): EntityMap {
    return entityMap(this.data()?.entities ?? []);
  }

  sync() {
    const ed = useEditor.getState();
    const isSketch = ed.editing?.draft.type === 'sketch' && !!ed.sketch;
    if (!isSketch) {
      if (this.active) this.deactivate();
      return;
    }
    if (!this.active || this.featureId !== ed.editing!.featureId) this.activate(ed.editing!.featureId, ed.editing!.isNew);
    else if (JSON.stringify(this.data()?.plane ?? null) !== this.planeKey || (this.awaitingPlane && !ed.sketch!.planePending)) {
      this.applyFrame(true);
      this.renderSketch(true);
    }
    if (ed.sketch!.tool !== this.toolName) {
      this.toolName = ed.sketch!.tool;
      this.tool = { k: 'idle' };
      this.closeQuick(true);
      this.acquired = [];
      // 3D hover of Use / plane picking must not stay highlighted
      if (ed.hover) ed.setHover(null);
      this.updateCursor();
      if (this.toolName === 'offset') {
        // Onshape: curves selected before starting Offset are offset directly
        const map = this.map();
        const ids = ed.sketch!.selection.filter((id) => !isCopyId(id) && OFFSETTABLE.has(map.get(id)?.type ?? ''));
        if (ids.length) this.tool = { k: 'offset', ids };
      }
      this.clearPreview();
      this.setHint();
    }
    this.renderSketch();
    this.updatePreview();
  }

  /** Place the sketch on its plane (on activation and when the plane is changed in the dialog). */
  private applyFrame(lookAt: boolean) {
    this.planeKey = JSON.stringify(this.data()?.plane ?? null);
    // a new sketch without a plane yet: keep the view until the plane is picked
    this.awaitingPlane = !!useEditor.getState().sketch?.planePending;
    this.frame = this.engine.sketchFrame(this.featureId!) ?? STD_PLANES.top;
    const m = frameMatrix(this.frame);
    this.root.matrix.copy(m);
    this.root.matrixWorldNeedsUpdate = true;
    this.pickRoot.matrix.copy(m);
    this.pickRoot.matrixWorldNeedsUpdate = true;
    if (lookAt && !this.awaitingPlane) {
      const f = this.frame;
      useEditor.getState().view({ kind: 'normal', normal: f.normal, up: f.yDir, center: f.origin });
    }
  }

  private activate(featureId: string, isNew: boolean) {
    this.deactivate();
    this.active = true;
    this.featureId = featureId;
    this.applyFrame(isNew);
    this.engine.editGroup.add(this.root);
    this.engine.pickEdit.add(this.pickRoot);
    this.toolName = useEditor.getState().sketch?.tool ?? 'select';
    this.tool = { k: 'idle' };
    // initial analysis
    const d = this.data();
    if (d) {
      const res = this.solve(d, { analyze: true });
      useEditor.getState().setSolve(res.info);
    }
    this.setHint();
  }

  private deactivate() {
    if (!this.active) return;
    this.closeQuick(false);
    this.showLive([]);
    this.acquired = [];
    this.engine.setCursor('');
    this.active = false;
    this.featureId = null;
    this.cancelDimInput();
    this.clear(this.root, true);
    this.clear(this.pickRoot);
    this.engine.editGroup.remove(this.root);
    this.engine.pickEdit.remove(this.pickRoot);
    this.renderedData = null;
    this.inferLabel.style.display = 'none';
    this.engine.requestRender();
  }

  private clear(g: THREE.Group, keepFixed = false) {
    for (const c of [...g.children]) {
      if (keepFixed && (c === this.preview || c === this.labels)) continue;
      g.remove(c);
      disposeObject(c);
    }
    if (keepFixed) {
      this.clear(this.preview);
      this.clearLabels();
    }
  }

  private clearLabels() {
    for (const c of [...this.labels.children]) {
      this.labels.remove(c);
      if (c instanceof CSS2DObject) c.element.remove();
      disposeObject(c);
    }
    this.glyphs = [];
  }

  private clearPreview() {
    this.clear(this.preview);
    this.showLive([]);
    this.engine.requestRender();
  }

  private setHint(text?: string) {
    const s = useEditor.getState().sketch;
    if (!s) return;
    const hints: Partial<Record<SketchTool, string>> = {
      line: 'Click to place points. Esc or double-click ends the chain.',
      rectCorner: 'Click two opposite corners.',
      rectCenter: 'Click the center, then a corner.',
      circleCenter: 'Click the center, then a point on the circle.',
      circle3pt: 'Click three points on the circle.',
      arc3pt: 'Click the start, the end, then a point on the arc.',
      arcCenter: 'Click the center, the start and the end of the arc.',
      arcTangent: 'Start at the end of a line or arc.',
      spline: 'Click points; double-click or Enter to finish.',
      bezier: 'Click the start, two control points and the end.',
      conic: 'Click the start, the end, the point where its tangents meet, then move to set ρ and click.',
      point: 'Click to place points.',
      slot: 'Click two centers, then the width.',
      polygon: 'Click the center, then a vertex; then move the cursor or type a number to set the sides (3–50) and click.',
      polygonInscribed: 'Click the center, then the middle of a side; then move the cursor or type a number to set the sides (3–50) and click.',
      text: 'Click the start of the baseline, then the height of the capital letters; then type the text in the sketch dialog.',
      ellipse: 'Click the center, the major axis end and a point for the minor radius.',
      fillet: 'Click a corner where two lines meet.',
      trim: 'Click the piece of a curve to remove.',
      split: 'Click a line or an arc where to split it in two.',
      extend: 'Click near the end of a line or arc to extend it to the next curve.',
      offset: 'Click a curve (its connected chain is picked, Shift adds more), then click on the side and distance to offset.',
      use: 'Click edges, faces, vertices or entities of other sketches to project them into this sketch.',
      plane: 'Select a plane or a planar face for the sketch.',
      dimension: 'Click entities, then click to place the dimension. A circle with Shift: to the circle itself; three points: an angle.',
      select: 'Select entities, drag to move. Use the constraint tools to constrain.',
    };
    // a constraint or mirror tool waiting for picks keeps its own hint (what to pick)
    useEditor.setState({ sketch: { ...s, hint: text ?? (s.constraint || s.mirror ? s.hint : hints[this.toolName]) } });
  }

  // -------------------------------------------------------------------------
  // Solving
  // -------------------------------------------------------------------------

  private evalCtx() {
    const doc = useDoc.getState().doc!;
    const studio = activeStudio(doc);
    const idx = useEditor.getState().editing?.index ?? 0;
    return makeEvalContext(doc, collectVariables(configuredOf(studio), idx, doc.units));
  }

  private solve(d: SketchData, opts: { analyze?: boolean; drag?: { points?: Record<string, Vec2>; radii?: Record<string, number> } } = {}) {
    const { dims } = sketchDims(d, this.evalCtx());
    const res = solveSketch(d.entities, d.constraints, dims, { analyze: opts.analyze ?? true, drag: opts.drag });
    return {
      entities: res.entities,
      info: { ok: res.ok, dof: res.dof, status: res.status, conflicting: res.conflicting, redundant: res.redundant },
    };
  }

  /** Apply an edit, re-solve and store (undoable). Returns false if the result is over-constrained. */
  /** Put the sketch on another plane (picked in the graphics area or in the feature list) and leave plane picking. */
  setPlane(plane: SketchData['plane']) {
    const pending = !!useEditor.getState().sketch?.planePending;
    this.change((d) => {
      d.plane = plane as Draft<SketchData['plane']>;
    });
    useEditor.getState().setHover(null);
    if (pending) useEditor.getState().sketchPlanePicked();
    else useEditor.getState().setSketchTool('select');
  }

  change(fn: (d: Draft<SketchData>) => void, opts: { checkConflict?: boolean } = {}): boolean {
    const cur = this.data();
    if (!cur) return false;
    const next = produce(cur, fn);
    if (next === cur) return true;
    const res = this.solve(next);
    if (opts.checkConflict && (!res.info.ok || res.info.conflicting.length)) {
      const before = this.solve(cur, { analyze: true });
      // redundant-but-consistent geometric constraints are accepted, only real conflicts are refused
      if (res.info.conflicting.length > before.info.conflicting.length || (!res.info.ok && before.info.ok)) {
        useEditor.getState().showToast(t('This constraint conflicts with existing constraints or dimensions'), 'error');
        return false;
      }
    }
    const ed = useEditor.getState();
    ed.updateSketch((d) => {
      d.entities = res.entities as Draft<SkEntity>[];
      d.constraints = next.constraints as Draft<SkConstraint>[];
      d.plane = next.plane as Draft<SketchData['plane']>;
    });
    ed.setSolve(res.info);
    return true;
  }

  // -------------------------------------------------------------------------
  // Coordinates & picking
  // -------------------------------------------------------------------------

  private toSketch(x: number, y: number): Vec2 {
    const ray = this.engine.cam.ray(x, y);
    const n = new THREE.Vector3(...this.frame.normal);
    const o = new THREE.Vector3(...this.frame.origin);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
    const hit = ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) {
      // view parallel to the plane: project the point on the view plane
      const p = this.engine.cam.pointAtPixel(x, y);
      return toLocal(this.frame, [p.x, p.y, p.z]);
    }
    return toLocal(this.frame, [hit.x, hit.y, hit.z]);
  }

  private get px() {
    return this.engine.cam.pixelSize;
  }

  /** Entity id under cursor (points preferred), excluding some ids. */
  private hitEntity(x: number, y: number, exclude?: Set<string>): { id: string; type: string; dist: number } | null {
    const found = this.engine.pickRaw(x, y);
    let best: { id: string; type: string; dist: number; pr: number } | null = null;
    for (const [pid, dist] of found) {
      const item = this.engine.registry.get(pid);
      if (!item || item.t !== 'edit') continue;
      if (exclude?.has(item.id)) continue;
      const isPt = item.entType === 'point' || item.entType === 'ghostHandle';
      if (dist > (isPt ? SNAP_PX : 6)) continue;
      const pr = isPt ? 2 : 1;
      if (!best || pr > best.pr || (pr === best.pr && dist < best.dist)) best = { id: item.id, type: item.entType, dist, pr };
    }
    return best;
  }

  /** Curve under the cursor; an end point picked near a curve end stands for its curve. */
  private curveHit(x: number, y: number): { id: string; type: string; dist: number } | null {
    const hit = this.hitEntity(x, y);
    if (!hit || hit.type !== 'point') return hit;
    const pt = this.map().get(hit.id);
    const owner = pt && pt.type === 'point' && pt.owner ? this.map().get(pt.owner) : undefined;
    return owner ? { id: owner.id, type: owner.type, dist: hit.dist } : null;
  }

  /** The lines / arcs the line being drawn starts on: the previous line of the chain, the curve of its start point. */
  private startRefs(): string[] {
    if (this.tool.k !== 'line') return [];
    const map = this.map();
    const st = this.tool.start.snap;
    const at = this.tool.chainPoint ?? (st.kind === 'point' ? st.id : undefined);
    const pt = at ? map.get(at) : undefined;
    const out = pt?.type === 'point' && pt.owner ? [pt.owner] : [];
    if (st.kind === 'curve' || st.kind === 'extension') out.push(st.id);
    return out;
  }

  /** Acquired lines (hovered a moment while drawing): parallel / perpendicular and their extensions. */
  private acquiredLines(): string[] {
    const map = this.map();
    return this.acquired.filter((id) => map.get(id)?.type === 'line');
  }

  /** Where an acquired point is: a point of the sketch, or a circle's quarter point (top, bottom, left, right). */
  private acquiredPoint(id: string): Vec2 | null {
    const map = this.map();
    if (isQuadrantId(id)) return quadrantPos(id, map);
    const e = map.get(id);
    return e?.type === 'point' ? [e.x, e.y] : null;
  }

  /**
   * Inference (Onshape): horizontal / vertical alignment with the anchor (the line becomes H/V) and with acquired points
   * (the new point gets a point–point H/V constraint): the guides cursor `p` is near.
   */
  private alignGuides(p: Vec2, anchor: Vec2 | undefined, exclude?: Set<string>) {
    let ax = p[0];
    let ay = p[1];
    let bestDx = 7;
    let bestDy = 7;
    let anchorH = false;
    let anchorV = false;
    let hId: string | undefined;
    let vId: string | undefined;
    if (anchor) {
      const dx = Math.abs(p[0] - anchor[0]) / this.px;
      const dy = Math.abs(p[1] - anchor[1]) / this.px;
      if (dy < bestDy && dx > 10) {
        bestDy = dy;
        ay = anchor[1];
        anchorH = true;
      } else if (dx < bestDx && dy > 10) {
        bestDx = dx;
        ax = anchor[0];
        anchorV = true;
      }
    }
    for (const id of this.acquired) {
      const at = this.acquiredPoint(id);
      if (!at || exclude?.has(id) || exclude?.has(id.split(':')[1])) continue;
      if (anchor && Math.hypot(at[0] - anchor[0], at[1] - anchor[1]) < 1e-9) continue;
      const dx = Math.abs(p[0] - at[0]) / this.px;
      const dy = Math.abs(p[1] - at[1]) / this.px;
      if (Math.hypot(dx, dy) < 10) continue;
      if (dy < bestDy) {
        bestDy = dy;
        ay = at[1];
        hId = id;
        anchorH = false;
      }
      if (dx < bestDx) {
        bestDx = dx;
        ax = at[0];
        vId = id;
        anchorV = false;
      }
    }
    return { ax, ay, anchorH, anchorV, hId, vId };
  }

  private computeSnap(x: number, y: number, p: Vec2, exclude?: Set<string>, anchor?: Vec2): Snap {
    this.hvSnap = null;
    this.dirSnap = null;
    const map = this.map();
    const rawHit = this.hitEntity(x, y, exclude);
    // nothing snaps onto the letters of a text or the teeth of a gear (only to their points)
    const hit = rawHit && !isCopyId(rawHit.id) && rawHit.type !== 'ghostHandle' && rawHit.type !== 'text' && rawHit.type !== 'gear' ? rawHit : null;
    if (hit && hit.type === 'point') {
      const e = map.get(hit.id);
      if (e && e.type === 'point') return { kind: 'point', id: e.id, pos: [e.x, e.y] };
    }
    // midpoints of lines
    for (const e of map.values()) {
      if (e.type !== 'line' || exclude?.has(e.id)) continue;
      const a = pointOf(map, e.p1);
      const b = pointOf(map, e.p2);
      const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (Math.hypot(m[0] - p[0], m[1] - p[1]) / this.px < SNAP_PX - 2 && hit?.id === e.id)
        return { kind: 'midpoint', id: e.id, pos: m };
    }
    // origin of the sketch
    if (Math.hypot(p[0], p[1]) / this.px < SNAP_PX) return { kind: 'origin', pos: [0, 0] };
    const { ax, ay, anchorH, anchorV, hId, vId } = this.alignGuides(p, anchor, exclude);
    if (hit && hit.type !== 'point') {
      const e = map.get(hit.id);
      if (e) {
        // a circle's quarter point near the cursor: exactly there, straight above / level with its centre
        for (const { q, pos } of quadrants(e, map))
          if (Math.hypot(pos[0] - p[0], pos[1] - p[1]) / this.px < SNAP_PX && (e.type === 'circle' || e.type === 'arc')) {
            const c = e.c;
            return { kind: 'curve', id: e.id, pos, quad: q, ...(q === 'top' || q === 'bottom' ? { v: c } : { h: c }) };
          }
        // where an alignment guide crosses the curve near the cursor, the point keeps both (Onshape): the top of a
        // circle straight above its centre, a horizontal line ending on another line
        const guides: { guide: { x?: number; y?: number }; hv?: 'h' | 'v'; h?: string; v?: string }[] = [];
        if (anchorH || hId) guides.push({ guide: { y: ay }, ...(anchorH ? { hv: 'h' as const } : { h: hId }) });
        if (anchorV || vId) guides.push({ guide: { x: ax }, ...(anchorV ? { hv: 'v' as const } : { v: vId }) });
        let best: { pos: Vec2; d: number; hv?: 'h' | 'v'; h?: string; v?: string } | null = null;
        for (const g of guides) {
          const q = guideCrossing(e, map, g.guide, p);
          const d = q ? Math.hypot(q[0] - p[0], q[1] - p[1]) / this.px : Infinity;
          if (q && d < SNAP_PX + 4 && (!best || d < best.d)) best = { pos: q, d, hv: g.hv, h: g.h, v: g.v };
        }
        if (best) {
          this.hvSnap = best.hv ?? null;
          return { kind: 'curve', id: e.id, pos: best.pos, ...(best.h ? { h: best.h } : {}), ...(best.v ? { v: best.v } : {}) };
        }
        return { kind: 'curve', id: e.id, pos: closestPointOnEntity(p, e, map) };
      }
    }
    this.hvSnap = anchorH ? 'h' : anchorV ? 'v' : null;
    if (hId || vId) return { kind: 'align', pos: [ax, ay], h: hId, v: vId };
    // on the extension of an acquired line: alone, or where the horizontal / vertical guide crosses it
    const ext = extensionPoint(map, this.acquiredLines().filter((id) => !exclude?.has(id)), p, this.px, anchorH ? { y: ay } : anchorV ? { x: ax } : undefined);
    if (ext) return { kind: 'extension', id: ext.id, pos: ext.pos };
    if (anchorH || anchorV) return { kind: 'none', pos: [ax, ay] };
    // the line being drawn: parallel / perpendicular to a line, tangent to the arc it starts on
    if (this.tool.k === 'line' && anchor) {
      this.dirSnap = inferDirection(map, anchor, p, this.acquiredLines(), this.startRefs(), this.px);
      if (this.dirSnap) return { kind: 'none', pos: this.dirSnap.pos };
    }
    return { kind: 'none', pos: p };
  }

  /** Cursor for the active tool: crosshair where a click draws, hand over pickable targets. */
  private updateCursor() {
    const ed = useEditor.getState();
    const hover = !!ed.sketch?.hover;
    let c = '';
    if (this.drag) c = 'move';
    else if (DRAW_TOOLS.has(this.toolName)) c = 'crosshair';
    else if (this.toolName === 'offset') c = this.tool.k === 'offset' ? 'crosshair' : hover ? 'pointer' : '';
    else if (this.toolName === 'use' || this.toolName === 'plane') c = ed.hover ? 'pointer' : '';
    else if (this.toolName === 'dimension') c = hover ? 'pointer' : this.tool.k === 'dim' ? 'crosshair' : '';
    else c = hover ? 'pointer' : '';
    this.engine.setCursor(c);
  }

  /** Points and lines acquired for inference by hovering them for a moment while drawing (last three). */
  private acquired: string[] = [];
  private acquireTimer: ReturnType<typeof setTimeout> | null = null;
  private acquireCandidate: string | null = null;

  private trackAcquire() {
    // a point (alignment) or a line (parallel, perpendicular, extension); a circle's quarter point (alignment)
    const s = this.snap;
    const line = s?.kind === 'curve' && this.map().get(s.id)?.type === 'line';
    const quad = s?.kind === 'curve' && s.quad ? quadrantId(s.id, s.quad) : null;
    const id = DRAW_TOOLS.has(this.toolName) ? (quad ?? (s?.kind === 'point' || line ? s.id : null)) : null;
    if (id === this.acquireCandidate) return;
    this.acquireCandidate = id;
    if (this.acquireTimer) clearTimeout(this.acquireTimer);
    this.acquireTimer = null;
    if (!id || this.acquired.includes(id)) return;
    this.acquireTimer = setTimeout(() => {
      this.acquireTimer = null;
      if (this.acquireCandidate !== id || !this.active) return;
      this.acquired = [...this.acquired.filter((x) => x !== id), id].slice(-3);
      this.updatePreview();
    }, 250);
  }

  private showInference(x: number, y: number) {
    const s = this.snap;
    // the constraint that a click / drop will create, shown with its glyph (Onshape)
    const kinds: ('coincident' | 'midpoint' | 'horizontal' | 'vertical' | 'parallel' | 'perpendicular' | 'tangent')[] = [];
    if (s?.kind === 'point' || s?.kind === 'curve' || s?.kind === 'origin' || s?.kind === 'extension') kinds.push('coincident');
    else if (s?.kind === 'midpoint') kinds.push('midpoint');
    if (this.hvSnap === 'h' || ((s?.kind === 'align' || s?.kind === 'curve') && s.h)) kinds.push('horizontal');
    if (this.hvSnap === 'v' || ((s?.kind === 'align' || s?.kind === 'curve') && s.v)) kinds.push('vertical');
    if (this.dirSnap) kinds.push(this.dirSnap.kind);
    if (!kinds.length || (this.toolName === 'select' && !this.drag)) {
      this.inferLabel.style.display = 'none';
      return;
    }
    this.inferLabel.innerHTML = kinds.map((k) => `<span class="infer-glyph">${CONSTRAINT_GLYPH_SVG[k] ?? GLYPH[k] ?? ''}</span>`).join('');
    this.inferLabel.style.display = 'flex';
    this.inferLabel.style.left = `${x + 14}px`;
    this.inferLabel.style.top = `${y + 12}px`;
  }

  // -------------------------------------------------------------------------
  // Pointer events
  // -------------------------------------------------------------------------

  onLeave() {
    this.inferLabel.style.display = 'none';
    useEditor.getState().setSketchHover(null);
  }

  onPointerMove(x: number, y: number, _e: PointerEvent) {
    void _e;
    if (this.toolName === 'use' || this.toolName === 'plane') {
      useEditor.getState().setHover(this.engine.pickRef(x, y, this.toolName === 'use' ? USE_ACCEPTS : PLANE_ACCEPTS));
      this.updateCursor();
      return;
    }
    if (this.tool.k === 'polySides') {
      this.polySidesMove(x, y);
      return;
    }
    const p = this.toSketch(x, y);
    this.cursor = p;
    const anchor = this.anchorPoint();
    const exclude = this.toolName === 'select' ? undefined : this.excludeIds();
    this.snap = this.toolName === 'select' ? null : this.computeSnap(x, y, p, exclude, anchor);
    this.trackAcquire();
    const pickTools: SketchTool[] = ['select', 'dimension', 'trim', 'fillet'];
    if (this.toolName === 'extend' || this.toolName === 'split') useEditor.getState().setSketchHover(this.curveHit(x, y)?.id ?? null);
    else if (pickTools.includes(this.toolName) || (this.toolName === 'offset' && this.tool.k !== 'offset')) {
      const hit = this.hitEntity(x, y);
      useEditor.getState().setSketchHover(hit?.id ?? null);
    } else useEditor.getState().setSketchHover(this.snap && 'id' in this.snap ? this.snap.id : null);
    this.showInference(x, y);
    if (this.tool.k === 'offset') this.showOffsetDistance(x, y);
    this.updatePreview();
    this.updateCursor();
  }

  /** Current offset distance next to the cursor while placing an offset. */
  private showOffsetDistance(x: number, y: number) {
    if (this.tool.k !== 'offset') return;
    const delta = offsetDistanceAt(offsetChains(this.map(), this.tool.ids), this.snap?.pos ?? this.cursor);
    const units = useDoc.getState().doc!.units;
    this.inferLabel.textContent = `${formatNumber(Math.abs(delta) / LENGTH_FACTOR[units.length], 3)} ${units.length}`;
    this.inferLabel.style.display = 'block';
    this.inferLabel.style.left = `${x + 14}px`;
    this.inferLabel.style.top = `${y + 12}px`;
  }

  private placeOffset(pos: Vec2) {
    if (this.tool.k !== 'offset') return;
    const ed = useEditor.getState();
    const chains = offsetChains(this.map(), this.tool.ids);
    const delta = offsetDistanceAt(chains, pos);
    if (Math.abs(delta) < 1e-9) return;
    const off = computeOffset(chains, delta);
    if (!off) {
      ed.showToast('The offset distance is too large for this geometry', 'error');
      return;
    }
    const units = useDoc.getState().doc!.units;
    const value = `${formatNumber(Math.abs(delta) / LENGTH_FACTOR[units.length], 3)} ${units.length}`;
    const made = { id: '' };
    const ok = this.change((d) => {
      made.id = applyOffset(d, off, value).constraintId;
    });
    this.endTool();
    ed.setSketchSelection([]);
    // type the exact distance right away, like a new dimension
    if (ok && made.id) setTimeout(() => this.openDimInput(made.id, true), 0);
  }

  private excludeIds(): Set<string> | undefined {
    if (this.tool.k === 'line' && this.tool.chainPoint) return new Set([this.tool.chainPoint]);
    return undefined;
  }

  private anchorPoint(): Vec2 | undefined {
    switch (this.tool.k) {
      case 'line':
        return this.tool.start.pos;
      case 'rect':
        return this.tool.a.pos;
      case 'circle':
        return this.tool.c.pos;
      case 'multi':
        return this.tool.pts[this.tool.pts.length - 1]?.pos;
      default:
        return undefined;
    }
  }

  onPointerDown(x: number, y: number, e: PointerEvent) {
    // the second press of a double-click on a label that was made anew meanwhile lands here: it still counts
    const last = this.lastPress;
    if (last && this.isDoublePress(last.id, e)) {
      e.preventDefault();
      this.pressAgain(last.id);
      this.swallowClick = true;
      return;
    }
    this.lastPress = null;
    // drawing on (or clicking away) dismisses the offered dimensions, keeping typed values
    if (this.quick) this.closeQuick(true);
    const hit = this.toolName === 'select' ? this.hitEntity(x, y) : null;
    this.pressed = { x, y, hit: hit?.id ?? null };
  }

  /** A double-click on a label / glyph: type a dimension's value, edit a pattern (after the press is handled: focus). */
  private pressAgain(id: string) {
    setTimeout(() => {
      if (id.startsWith('glyph:') || id.startsWith('count:')) {
        const pid = id.slice(id.indexOf(':') + 1);
        if ((this.data()?.patterns ?? []).some((p) => p.id === pid)) this.editPattern(pid);
      } else this.openDimInput(id, false);
    }, 0);
  }

  /** Turn a ghost tangent handle into a real one (an owned point of the spline); its point id. */
  private activateHandle(ghost: string): string | null {
    const m = GHOST_HANDLE.exec(ghost);
    if (!m) return null;
    const made = { id: null as string | null };
    this.change((d) => {
      made.id = addSplineHandle(d, m[1], m[2] as 'h0' | 'h1');
    });
    return made.id;
  }

  onPointerDrag(x: number, y: number, _e: PointerEvent) {
    void _e;
    const p = this.toSketch(x, y);
    if (!this.drag && this.pressed && this.toolName === 'select') {
      // a ghost tangent handle becomes a real one and is dragged at once
      let id = this.pressed.hit;
      if (id && GHOST_HANDLE.test(id)) {
        id = this.activateHandle(id);
        this.pressed = { ...this.pressed, hit: id };
      }
      if (id) this.startDrag(id, this.toSketch(this.pressed.x, this.pressed.y));
      else if (!this.box) {
        const el = document.createElement('div');
        el.className = 'select-box';
        this.engine.container.appendChild(el);
        this.box = { x0: this.pressed.x, y0: this.pressed.y, x1: x, y1: y, el };
      }
    }
    if (this.box) {
      this.box.x1 = x;
      this.box.y1 = y;
      const b = this.box;
      Object.assign(b.el.style, {
        left: `${Math.min(b.x0, b.x1)}px`,
        top: `${Math.min(b.y0, b.y1)}px`,
        width: `${Math.abs(b.x1 - b.x0)}px`,
        height: `${Math.abs(b.y1 - b.y0)}px`,
      });
      b.el.classList.toggle('crossing', b.x1 < b.x0);
      return;
    }
    if (this.drag) this.updateDrag(p, { x, y });
  }

  onPointerUp(x: number, y: number, e: PointerEvent, moved: boolean) {
    const pressed = this.pressed;
    this.pressed = null;
    // the second press of a double-click on a label: not a click on the sketch
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    if (this.box) {
      this.finishBox(e.shiftKey || e.ctrlKey || e.metaKey);
      return;
    }
    if (this.drag) {
      this.endDrag();
      return;
    }
    if (moved && this.toolName === 'select') return;
    void pressed;
    this.click(x, y, e);
  }

  /** Window (left→right, fully inside) or crossing (right→left, touching) selection. */
  private finishBox(additive: boolean) {
    const b = this.box!;
    this.box = null;
    b.el.remove();
    const x0 = Math.min(b.x0, b.x1);
    const x1 = Math.max(b.x0, b.x1);
    const y0 = Math.min(b.y0, b.y1);
    const y1 = Math.max(b.y0, b.y1);
    if (x1 - x0 < 3 && y1 - y0 < 3) return;
    const crossing = b.x1 < b.x0;
    const r = this.engine.container.getBoundingClientRect();
    const cam = this.engine.cam.camera;
    const v = new THREE.Vector3();
    const screen = (p: Vec2): Vec2 => {
      v.set(p[0], p[1], 0).applyMatrix4(this.root.matrix).project(cam);
      return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
    };
    const inside = (q: Vec2) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
    const map = this.map();
    const picked: string[] = [];
    for (const e of map.values()) {
      if (e.type === 'point') {
        if (e.owner) continue;
        if (inside(screen([e.x, e.y]))) picked.push(e.id);
        continue;
      }
      const pts = entityPolyline(e, map).map(screen);
      if (!pts.length) continue;
      const hit = crossing ? pts.some(inside) || pts.some((q, i) => i > 0 && segRect(pts[i - 1], q, x0, y0, x1, y1)) : pts.every(inside);
      if (hit) picked.push(e.id);
    }
    const ed = useEditor.getState();
    const cur = additive ? ed.sketch?.selection ?? [] : [];
    ed.setSketchSelection([...new Set([...cur, ...picked])]);
  }

  onDoubleClick(x: number, y: number) {
    if (this.toolName === 'select') {
      const hit = this.hitEntity(x, y);
      const c = hit ? parseCopyId(hit.id) : null;
      if (c) {
        this.editPattern(c.patternId);
        return;
      }
    }
    if (this.tool.k === 'line') this.endTool();
    else if (this.tool.k === 'multi' && this.toolName === 'spline') this.finishSpline();
  }

  onContextMenu(cx: number, cy: number, x: number, y: number) {
    const hitCopy = this.hitEntity(x, y);
    const copy = hitCopy ? parseCopyId(hitCopy.id) : null;
    if (copy && this.tool.k === 'idle') {
      const ed0 = useEditor.getState();
      ed0.setSketchSelection([hitCopy!.id]);
      useEditor.setState({
        contextMenu: {
          x: cx,
          y: cy,
          items: [
            { label: t('Edit pattern'), icon: 'edit', action: () => this.editPattern(copy.patternId) },
            { label: t('Delete instance'), icon: 'trash', action: () => this.deleteSelection() },
            { separator: true, label: '' },
            { label: t('Delete pattern'), icon: 'trash', danger: true, action: () => this.deletePattern(copy.patternId) },
          ],
        },
      });
      return;
    }
    if (this.tool.k !== 'idle') {
      if (this.toolName === 'spline' && this.tool.k === 'multi') this.finishSpline();
      else this.endTool();
      return;
    }
    const ed = useEditor.getState();
    const sel = ed.sketch?.selection ?? [];
    const items = [
      { label: t('Finish sketch'), icon: 'check', shortcut: 'Enter', action: () => ed.commitEditing() },
      { label: t('Construction'), icon: 'construction', shortcut: 'Q', action: () => this.toggleConstruction(), disabled: !sel.length },
      { label: t('Delete'), icon: 'trash', shortcut: 'Del', action: () => this.deleteSelection(), disabled: !sel.length, danger: true },
      { separator: true, label: '' },
      { label: t('Cancel'), icon: 'close', shortcut: 'Esc', action: () => ed.cancelEditing() },
    ];
    useEditor.setState({ contextMenu: { x: cx, y: cy, items } });
  }

  // -------------------------------------------------------------------------
  // Keyboard (called by the global key handler)
  // -------------------------------------------------------------------------

  handleKey(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    if (this.editingDim) return false;
    if (this.polygonKey(e)) return true;
    if (this.quickKey(e)) return true;
    if (useEditor.getState().sketchPattern) {
      if (e.key === 'Enter') {
        this.applyPattern();
        return true;
      }
      if (e.key === 'Escape') {
        this.cancelPattern();
        return true;
      }
    }
    if (useEditor.getState().sketchTransform) {
      if (e.key === 'Enter') {
        this.applyTransform();
        return true;
      }
      if (e.key === 'Escape') {
        this.cancelTransform();
        return true;
      }
    }
    if (e.key === 'Escape') {
      const s = useEditor.getState().sketch;
      if (this.tool.k !== 'idle') this.endTool();
      // a constraint tool waiting for picks: off (with what was picked for it)
      else if (s?.constraint || s?.mirror) {
        useEditor.setState({ sketch: { ...s, constraint: undefined, mirror: undefined, selection: [] } });
        this.setHint();
      } else if ((s?.selection.length ?? 0) > 0) useEditor.getState().setSketchSelection([]);
      else if (useEditor.getState().sketch?.planePending) useEditor.getState().cancelEditing();
      else useEditor.getState().setSketchTool('select');
      return true;
    }
    if (e.key === 'Enter') {
      if (this.toolName === 'spline' && this.tool.k === 'multi') {
        this.finishSpline();
        return true;
      }
      if (this.tool.k !== 'idle') {
        this.endTool();
        return true;
      }
      useEditor.getState().commitEditing();
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelection();
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  private construction() {
    return !!useEditor.getState().sketch?.construction;
  }

  private endTool() {
    this.tool = { k: 'idle' };
    this.clearPreview();
    this.inferLabel.style.display = 'none';
    this.sidesLabel.style.display = 'none';
    this.polyTyped = '';
  }

  /** "6 sides" next to the cursor while drawing a polygon (typed digits shown as typed). */
  private showPolySides(x: number, y: number) {
    this.sidesLabel.textContent = `${t('Sides')}: ${this.polyTyped || this.polySides}`;
    this.sidesLabel.style.display = 'block';
    this.sidesLabel.style.left = `${x + 14}px`;
    this.sidesLabel.style.top = `${y - 30}px`;
  }

  /** Polygon: sides from the cursor's distance to the centre relative to where the size was locked. */
  private polySidesMove(x: number, y: number) {
    if (this.tool.k !== 'polySides') return;
    this.cursor = this.toSketch(x, y);
    if (!this.polyTyped) {
      const c = this.toScreen(this.tool.c.pos);
      const steps = Math.round((Math.hypot(x - c.x, y - c.y) - this.tool.startPx) / POLY_STEP_PX);
      this.polySides = Math.max(POLY_MIN, Math.min(POLY_MAX, this.tool.base + steps));
    }
    this.updatePreview();
    this.showPolySides(x, y);
  }

  private finishPolygon() {
    if (this.tool.k !== 'polySides') return;
    const { c, v } = this.tool;
    const sides = this.polySides;
    const cons = this.construction();
    let circleId = '';
    this.change((d) => {
      const pg = addPolygon(d, c.pos, v, sides, cons, this.toolName === 'polygonInscribed');
      applySnap(d, pg.circle.c, c.snap);
      circleId = pg.circle.id;
    });
    this.endTool();
    if (circleId) this.offerQuick([{ type: 'diameter', refs: [circleId] }]);
  }

  /** Digits / Backspace / Enter while drawing a polygon. */
  private polygonKey(e: KeyboardEvent): boolean {
    if (!POLYGON_TOOLS.has(this.toolName) || (this.tool.k !== 'multi' && this.tool.k !== 'polySides')) return false;
    if (/^[0-9]$/.test(e.key) || (e.key === 'Backspace' && this.polyTyped)) {
      this.polyTyped = e.key === 'Backspace' ? this.polyTyped.slice(0, -1) : (this.polyTyped + e.key).slice(-2);
      const n = Number(this.polyTyped);
      if (n >= POLY_MIN) this.polySides = Math.min(POLY_MAX, n);
      this.updatePreview();
      const s = this.toScreen(this.cursor);
      this.showPolySides(s.x, s.y);
      return true;
    }
    if (e.key === 'Enter' && this.tool.k === 'polySides') {
      this.finishPolygon();
      return true;
    }
    return false;
  }

  private click(x: number, y: number, e: PointerEvent) {
    const p = this.toSketch(x, y);
    // recompute the inference at the click position (no pointermove may have happened there)
    if (this.toolName !== 'select') this.snap = this.computeSnap(x, y, p, this.excludeIds(), this.anchorPoint());
    const snap = this.snap ?? { kind: 'none', pos: p };
    const pos = snap.pos;
    const ed = useEditor.getState();
    const cons = this.construction();
    switch (this.toolName) {
      case 'select': {
        const hit = this.hitEntity(x, y);
        const sel = ed.sketch?.selection ?? [];
        if (!hit && ed.sketchPattern) {
          this.applyPattern();
          return;
        }
        if (!hit) {
          // (the Mirror tool keeps its line selected)
          if (!e.shiftKey && !ed.sketch?.mirror) ed.setSketchSelection([]);
          return;
        }
        if (hit.type === 'ghostHandle') {
          // clicking a ghost tangent handle creates it (selected: ready for a constraint / dimension)
          const id = this.activateHandle(hit.id);
          if (id) ed.setSketchSelection([id]);
          return;
        }
        // the Mirror tool waiting for its line or entities: this one
        if (ed.sketch?.mirror) {
          this.mirrorPick(hit.id);
          return;
        }
        ed.setSketchSelection(sel.includes(hit.id) ? sel.filter((s) => s !== hit.id) : [...sel, hit.id]);
        // a constraint tool waiting for its picks: try it with this one
        const pending = useEditor.getState().sketch?.constraint;
        if (pending) this.applyConstraint(pending, true);
        return;
      }
      case 'point': {
        this.change((d) => {
          const id = addPoint(d, pos, undefined, cons);
          applySnap(d, id, snap);
        });
        return;
      }
      case 'gear': {
        // Onshape Spur gear, here in the sketch: a click places its centre; its teeth and size — in the sketch dialog
        let id = '';
        const params = this.gearParams();
        this.change((d) => {
          const g = addGear(d, pos, params, cons);
          id = g.id;
          applySnap(d, g.c, snap);
        });
        this.endTool();
        ed.setSketchTool('select');
        if (id) ed.setSketchSelection([id]);
        return;
      }
      case 'line': {
        if (this.tool.k !== 'line') {
          this.tool = { k: 'line', start: { pos, snap }, firstPos: pos };
          return;
        }
        const st = this.tool;
        if (Math.hypot(pos[0] - st.start.pos[0], pos[1] - st.start.pos[1]) < 1e-9) return;
        const closing = st.firstPoint && snap.kind === 'point' && snap.id === st.firstPoint;
        let newEnd = '';
        let lineId = '';
        let first = st.firstPoint;
        const hv = this.hvSnap;
        const dir = this.dirSnap;
        this.change((d) => {
          const l = addLine(d, st.start.pos, pos, cons);
          lineId = l.id;
          if (st.chainPoint) addConstraint(d, 'coincident', [st.chainPoint, l.p1]);
          else applySnap(d, l.p1, st.start.snap);
          applySnap(d, l.p2, snap);
          if (hv === 'h') addConstraint(d, 'horizontal', [l.id]);
          else if (hv === 'v') addConstraint(d, 'vertical', [l.id]);
          // inferred from geometry (Onshape): parallel / perpendicular to a line, tangent to the arc it starts on
          else if (dir) addConstraint(d, dir.kind, dir.kind === 'tangent' ? [dir.ref, l.id] : [l.id, dir.ref]);
          else {
            const dx = Math.abs(pos[0] - st.start.pos[0]);
            const dy = Math.abs(pos[1] - st.start.pos[1]);
            if (dy < 1e-9 && dx > 0) addConstraint(d, 'horizontal', [l.id]);
            else if (dx < 1e-9 && dy > 0) addConstraint(d, 'vertical', [l.id]);
          }
          newEnd = l.p2;
          if (!first) first = l.p1;
        });
        if (closing || snap.kind === 'point' || snap.kind === 'curve') {
          // ending on existing geometry ends the chain (Onshape behaviour)
          this.endTool();
          if (lineId) this.offerQuick([{ type: 'distance', refs: [lineId] }]);
          return;
        }
        this.tool = { k: 'line', start: { pos, snap: { kind: 'none', pos } }, chainPoint: newEnd, firstPoint: first, firstPos: st.firstPos };
        if (lineId) this.offerQuick([{ type: 'distance', refs: [lineId] }]);
        return;
      }
      case 'rectCorner':
      case 'rectCenter': {
        if (this.tool.k !== 'rect') {
          this.tool = { k: 'rect', a: { pos, snap } };
          return;
        }
        const a = this.tool.a;
        if (Math.abs(pos[0] - a.pos[0]) < 1e-9 || Math.abs(pos[1] - a.pos[1]) < 1e-9) return;
        const center = this.toolName === 'rectCenter';
        let sides: string[] = [];
        this.change((d) => {
          if (center) {
            const r = addCenterRectangle(d, a.pos, pos, cons);
            applySnap(d, r.center, a.snap);
            applySnap(d, r.lines[2].p1, snap);
            sides = [r.lines[0].id, r.lines[1].id];
          } else {
            const lines = addRectangle(d, a.pos, pos, cons);
            applySnap(d, lines[0].p1, a.snap);
            applySnap(d, lines[2].p1, snap);
            sides = [lines[0].id, lines[1].id];
          }
        });
        this.endTool();
        // width and height (Tab switches between them)
        this.offerQuick(sides.map((id) => ({ type: 'distance' as const, refs: [id] })));
        return;
      }
      case 'circleCenter': {
        if (this.tool.k !== 'circle') {
          this.tool = { k: 'circle', c: { pos, snap } };
          return;
        }
        const c = this.tool.c;
        const r = Math.hypot(pos[0] - c.pos[0], pos[1] - c.pos[1]);
        if (r < 1e-9) return;
        let circleId = '';
        this.change((d) => {
          const ci = addCircle(d, c.pos, r, cons);
          circleId = ci.id;
          applySnap(d, ci.c, c.snap);
          if (snap.kind === 'point') addConstraint(d, 'coincident', [snap.id, ci.id]);
        });
        this.endTool();
        if (circleId) this.offerQuick([{ type: 'diameter', refs: [circleId] }]);
        return;
      }
      case 'polygon':
      case 'polygonInscribed': {
        // centre → size and rotation (a vertex / the middle of a side) → number of sides (Onshape)
        if (this.tool.k === 'polySides') {
          this.finishPolygon();
          return;
        }
        if (this.tool.k !== 'multi') {
          this.tool = { k: 'multi', pts: [{ pos, snap }] };
          this.polyTyped = '';
          this.updatePreview();
          this.showPolySides(x, y);
          return;
        }
        const c = this.tool.pts[0];
        if (Math.hypot(pos[0] - c.pos[0], pos[1] - c.pos[1]) < 1e-9) return;
        const sc = this.toScreen(c.pos);
        this.tool = { k: 'polySides', c, v: pos, base: this.polySides, startPx: Math.hypot(x - sc.x, y - sc.y) };
        this.polyTyped = '';
        this.updatePreview();
        this.showPolySides(x, y);
        return;
      }
      case 'text': {
        // Onshape Text: a corner of its box (the start of the baseline), then its height; then type the text
        if (this.tool.k !== 'multi') {
          this.tool = { k: 'multi', pts: [{ pos, snap }] };
          this.updatePreview();
          return;
        }
        const a = this.tool.pts[0];
        const h = Math.abs(pos[1] - a.pos[1]);
        if (h < 1e-9) return;
        const up = pos[1] > a.pos[1];
        let id = '';
        this.change((d) => {
          const tx = addText(d, [a.pos[0], up ? a.pos[1] : pos[1]], [a.pos[0], up ? pos[1] : a.pos[1]], t('Text'), 'sans', cons);
          id = tx.id;
          // the snapped first click holds the baseline's start (a box drawn downwards: its top)
          applySnap(d, up ? tx.p1 : tx.p2, a.snap);
        });
        this.endTool();
        ed.setSketchTool('select');
        if (id) {
          ed.setSketchSelection([id]);
          useEditor.setState((s) => (s.sketch ? { sketch: { ...s.sketch, editText: id } } : {}));
        }
        return;
      }
      case 'circle3pt':
      case 'arc3pt':
      case 'arcCenter':
      case 'slot':
      case 'ellipse':
      case 'bezier':
      case 'conic':
      case 'spline': {
        const pts = this.tool.k === 'multi' ? [...this.tool.pts, { pos, snap }] : [{ pos, snap }];
        const need: Partial<Record<SketchTool, number>> = { circle3pt: 3, arc3pt: 3, arcCenter: 3, slot: 3, ellipse: 3, bezier: 4, conic: 4 };
        const n = need[this.toolName];
        if (n === undefined || pts.length < n) {
          this.tool = { k: 'multi', pts };
          this.updatePreview();
          return;
        }
        this.finishMulti(pts, cons);
        this.endTool();
        return;
      }
      case 'arcTangent': {
        if (this.tool.k !== 'tarc') {
          if (snap.kind !== 'point') {
            ed.showToast('Start the tangent arc at the end of a line or arc', 'error');
            return;
          }
          const start = this.tangentStart(snap.id);
          if (!start) {
            ed.showToast('Start the tangent arc at the end of a line or arc', 'error');
            return;
          }
          this.tool = { k: 'tarc', start: snap.pos, startPoint: snap.id, tangent: start.tangent, curveId: start.curveId };
          return;
        }
        const st = this.tool;
        const geo = tangentArcGeometry(st.start, st.tangent, pos);
        if (!geo) return;
        this.change((d) => {
          const arc = geo.ccw ? addArc(d, geo.c, st.start, pos, cons) : addArc(d, geo.c, pos, st.start, cons);
          const sp = geo.ccw ? arc.p1 : arc.p2;
          const ep = geo.ccw ? arc.p2 : arc.p1;
          addConstraint(d, 'coincident', [st.startPoint, sp]);
          addConstraint(d, 'tangent', [arc.id, st.curveId]);
          applySnap(d, ep, snap);
        });
        this.endTool();
        return;
      }
      case 'fillet': {
        const hit = this.hitEntity(x, y);
        const map = this.map();
        if (!hit || map.get(hit.id)?.type !== 'point') {
          ed.showToast('Click a corner point where two lines meet', 'error');
          return;
        }
        const r = this.defaultFilletRadius(hit.id);
        let arcId: string | null = null;
        const ok = this.change((d) => {
          arcId = filletCorner(d, hit.id, r);
        });
        if (!ok || !arcId) {
          ed.showToast('Fillet is not possible at this corner', 'error');
          return;
        }
        const aid = arcId as string;
        // radius dimension so the user can edit it
        this.change((d) => {
          const id = addConstraint(d, 'radius', [aid], { value: formatNumber(r / LENGTH_FACTOR[useDoc.getState().doc!.units.length], 3) });
          void id;
        });
        return;
      }
      case 'trim': {
        const hit = this.hitEntity(x, y);
        if (!hit || hit.type === 'point') return;
        this.change((d) => {
          trimEntity(d, hit.id, p);
        });
        return;
      }
      case 'split': {
        // a line / an arc in two at the clicked point (Onshape Split)
        const hit = this.curveHit(x, y);
        if (!hit || isCopyId(hit.id)) return;
        const type = this.map().get(hit.id)?.type;
        if (type !== 'line' && type !== 'arc') {
          ed.showToast('Only a line or an arc can be split', 'error');
          return;
        }
        const out = { id: null as string | null };
        this.change((d) => {
          out.id = splitEntity(d, hit.id, p);
        });
        if (!out.id) ed.showToast('Click inside the curve, not at its end', 'error');
        return;
      }
      case 'extend': {
        const hit = this.curveHit(x, y);
        if (!hit || isCopyId(hit.id)) return;
        const type = this.map().get(hit.id)?.type;
        if (type !== 'line' && type !== 'arc') {
          ed.showToast('Click near the end of a line or arc', 'error');
          return;
        }
        const out = { res: false as boolean | 'connected' };
        this.change((d) => {
          out.res = extendEntity(d, hit.id, p);
        });
        if (out.res === 'connected') ed.showToast('This end is connected to another curve', 'error');
        else if (!out.res) ed.showToast('There is nothing to extend to', 'info');
        return;
      }
      case 'offset': {
        const raw = this.curveHit(x, y);
        const map = this.map();
        const curve = raw && !isCopyId(raw.id) && OFFSETTABLE.has(map.get(raw.id)?.type ?? '') ? raw.id : null;
        if (curve && (this.tool.k !== 'offset' || e.shiftKey)) {
          const chain = map.get(curve)!.type === 'circle' ? [curve] : chainIdsOf(this.data()!, curve);
          const ids = [...new Set([...(this.tool.k === 'offset' ? this.tool.ids : []), ...chain])];
          this.tool = { k: 'offset', ids };
          ed.setSketchSelection(ids);
          this.showOffsetDistance(x, y);
          this.updatePreview();
          return;
        }
        this.placeOffset(pos);
        return;
      }
      case 'dimension':
        this.dimensionClick(x, y, p, e.shiftKey);
        return;
      case 'use': {
        const ref = this.engine.pickRef(x, y, USE_ACCEPTS);
        if (!ref) return;
        // a face is used as all of its boundary edges (Onshape)
        const refs = ref.kind === 'face' ? this.engine.faceEdgeRefs(ref) : [ref];
        const used = new Set((this.data()?.entities ?? []).flatMap((e) => (e.use ? [refKey(e.use)] : [])));
        const todo = refs.filter((r) => !used.has(refKey(r)));
        if (!todo.length) {
          ed.showToast('This geometry is already used in the sketch', 'info');
          return;
        }
        const items = todo.flatMap((r) => {
          const g = this.engine.worldGeometry(r);
          const lg = g ? projectGeometry(g, this.frame) : null;
          return lg ? [{ r, lg }] : [];
        });
        if (!items.length) {
          ed.showToast('Cannot project this geometry', 'error');
          return;
        }
        this.change((d) => {
          for (const it of items) addUsedGeometry(d, it.lg, it.r);
        });
        return;
      }
      case 'plane': {
        // pick a new sketch plane (from the sketch dialog)
        const ref = this.engine.pickRef(x, y, PLANE_ACCEPTS);
        if (!ref) return;
        if (ref.kind === 'plane') {
          const id = ref.planeId;
          this.setPlane(id === 'top' || id === 'front' || id === 'right' ? { kind: 'std', name: id } : { kind: 'feature', featureId: id });
        } else if (ref.kind === 'face') this.setPlane({ kind: 'face', ref });
        return;
      }
      default:
        return;
    }
  }

  private defaultFilletRadius(pid: string): number {
    const map = this.map();
    let minLen = Infinity;
    for (const e of map.values()) {
      if (e.type !== 'line') continue;
      const a = pointOf(map, e.p1);
      const b = pointOf(map, e.p2);
      const pt = map.get(pid) as { x: number; y: number };
      if (Math.hypot(a[0] - pt.x, a[1] - pt.y) < 1e-6 || Math.hypot(b[0] - pt.x, b[1] - pt.y) < 1e-6)
        minLen = Math.min(minLen, Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    if (!Number.isFinite(minLen)) minLen = 10;
    const raw = minLen * 0.2;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return Math.max(mag, Math.round(raw / mag) * mag);
  }

  private tangentStart(pid: string): { tangent: Vec2; curveId: string } | null {
    const map = this.map();
    const pt = map.get(pid);
    if (!pt || pt.type !== 'point' || !pt.owner) return null;
    const owner = map.get(pt.owner);
    if (!owner) return null;
    if (owner.type === 'line') {
      const other = pointOf(map, owner.p1 === pid ? owner.p2 : owner.p1);
      const d: Vec2 = [pt.x - other[0], pt.y - other[1]];
      const l = Math.hypot(d[0], d[1]) || 1;
      return { tangent: [d[0] / l, d[1] / l], curveId: owner.id };
    }
    if (owner.type === 'arc') {
      const c = pointOf(map, owner.c);
      const r: Vec2 = [pt.x - c[0], pt.y - c[1]];
      // CCW tangent at p2 continues forward, at p1 points backward
      const tccw: Vec2 = [-r[1], r[0]];
      const l = Math.hypot(tccw[0], tccw[1]) || 1;
      const s = owner.p2 === pid ? 1 : -1;
      return { tangent: [(s * tccw[0]) / l, (s * tccw[1]) / l], curveId: owner.id };
    }
    return null;
  }

  private finishMulti(pts: Pt[], cons: boolean) {
    const P = pts.map((p) => p.pos);
    switch (this.toolName) {
      case 'circle3pt': {
        const cc = circumcircle(P[0], P[1], P[2]);
        if (!cc) return;
        let id = '';
        this.change((d) => {
          const ci = addCircle(d, cc.c, cc.r, cons);
          id = ci.id;
          pts.forEach((p) => {
            if (p.snap.kind === 'point') addConstraint(d, 'coincident', [p.snap.id, ci.id]);
          });
        });
        if (id) this.offerQuick([{ type: 'diameter', refs: [id] }]);
        return;
      }
      case 'arc3pt': {
        const cc = circumcircle(P[0], P[1], P[2]);
        if (!cc) return;
        const ccw = onCcwArc(cc.c, P[0], P[1], P[2]);
        let id = '';
        this.change((d) => {
          const a = ccw ? addArc(d, cc.c, P[0], P[1], cons) : addArc(d, cc.c, P[1], P[0], cons);
          id = a.id;
          applySnap(d, ccw ? a.p1 : a.p2, pts[0].snap);
          applySnap(d, ccw ? a.p2 : a.p1, pts[1].snap);
        });
        if (id) this.offerQuick([{ type: 'radius', refs: [id] }]);
        return;
      }
      case 'arcCenter': {
        const [c, s, e] = P;
        const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
        const ang = Math.atan2(e[1] - c[1], e[0] - c[0]);
        const end: Vec2 = [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)];
        let id = '';
        this.change((d) => {
          const a = addArc(d, c, s, end, cons);
          id = a.id;
          applySnap(d, a.c, pts[0].snap);
          applySnap(d, a.p1, pts[1].snap);
          if (pts[2].snap.kind === 'point') applySnap(d, a.p2, pts[2].snap);
        });
        if (id) this.offerQuick([{ type: 'radius', refs: [id] }]);
        return;
      }
      case 'slot': {
        const [c1, c2, w] = P;
        const ax: Vec2 = [c2[0] - c1[0], c2[1] - c1[1]];
        const L = Math.hypot(ax[0], ax[1]);
        if (L < 1e-9) return;
        const r = Math.abs((w[0] - c1[0]) * -ax[1] + (w[1] - c1[1]) * ax[0]) / L;
        if (r < 1e-9) return;
        let arcId = '';
        this.change((d) => {
          const s = addSlot(d, c1, c2, r, cons);
          arcId = s.arcs[0].id;
          applySnap(d, s.arcs[0].c, pts[0].snap);
          applySnap(d, s.arcs[1].c, pts[1].snap);
        });
        if (arcId) this.offerQuick([{ type: 'radius', refs: [arcId] }]);
        return;
      }
      case 'ellipse': {
        const [c, a, b] = P;
        const rx = Math.hypot(a[0] - c[0], a[1] - c[1]);
        const rot = Math.atan2(a[1] - c[1], a[0] - c[0]);
        const u: Vec2 = [Math.cos(rot), Math.sin(rot)];
        const ry = Math.abs((b[0] - c[0]) * -u[1] + (b[1] - c[1]) * u[0]);
        if (rx < 1e-9 || ry < 1e-9) return;
        let ellipseId = '';
        this.change((d) => {
          const el = addEllipse(d, c, rx, ry, rot, cons);
          applySnap(d, el.c, pts[0].snap);
          ellipseId = el.id;
        });
        // Onshape: both axis diameters can be typed right away
        if (ellipseId)
          this.offerQuick([
            { type: 'diameter', refs: [ellipseId], variant: 0 },
            { type: 'diameter', refs: [ellipseId], variant: 1 },
          ]);
        return;
      }
      case 'bezier':
      case 'conic': {
        // a cubic Bézier: start, two control points, end; a conic: start, end, the apex of its tangents, ρ
        const [p0, a, b, q] = P;
        const [start, c1, c2, end] = this.toolName === 'bezier' ? [p0, a, b, q] : [p0, ...conicControls(p0, a, b, conicRho(p0, a, b, q)), a];
        if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-9) return;
        this.change((d) => {
          const s = addBezier(d, start, c1, c2, end, cons);
          applySnap(d, s.pts[0], pts[0].snap);
          applySnap(d, s.pts[1], pts[this.toolName === 'bezier' ? 3 : 1].snap);
        });
        return;
      }
    }
  }

  private finishSpline() {
    if (this.tool.k !== 'multi') return;
    const pts = this.tool.pts;
    if (pts.length >= 2) {
      const closed = pts.length > 2 && pts[pts.length - 1].snap.kind === 'point' && Math.hypot(pts[0].pos[0] - pts[pts.length - 1].pos[0], pts[0].pos[1] - pts[pts.length - 1].pos[1]) < 1e-9;
      const use = closed ? pts.slice(0, -1) : pts;
      const cons = this.construction();
      this.change((d) => {
        const s = addSpline(d, use.map((p) => p.pos), closed, cons);
        if (!closed) {
          applySnap(d, s.pts[0], use[0].snap);
          applySnap(d, s.pts[s.pts.length - 1], use[use.length - 1].snap);
        }
      });
    }
    this.endTool();
  }

  // -------------------------------------------------------------------------
  // Dimensions
  // -------------------------------------------------------------------------

  /** Whether `id` can be the next pick of the dimension tool: a second one; a third point (an angle by three points)
   *  or, after the two ends of an arc, the arc (its length). */
  private canPickForDimension(refs: string[], id: string): boolean {
    if (refs.includes(id)) return false;
    if (refs.length < 2) return true;
    if (refs.length > 2) return false;
    const map = this.map();
    const [a, b] = refs.map((r) => map.get(r));
    const e = map.get(id);
    if (a?.type !== 'point' || b?.type !== 'point') return false;
    return e?.type === 'point' || (e?.type === 'arc' && [e.p1, e.p2].includes(a.id) && [e.p1, e.p2].includes(b.id));
  }

  private dimensionClick(x: number, y: number, p: Vec2, shift = false) {
    const raw = this.hitEntity(x, y);
    const hit = raw && !isCopyId(raw.id) ? raw : null;
    const st: { refs: string[]; toCurve?: boolean } = this.tool.k === 'dim' ? this.tool : { refs: [] };
    if (hit && this.canPickForDimension(st.refs, hit.id)) {
      // a circle / arc picked with Shift: the distance to it, not to its centre
      const t = this.map().get(hit.id)?.type;
      const toCurve = st.toCurve || (shift && (t === 'circle' || t === 'arc'));
      this.tool = { k: 'dim', refs: [...st.refs, hit.id], ...(toCurve ? { toCurve } : {}) };
      useEditor.getState().setSketchSelection(this.tool.refs);
      this.updatePreview();
      return;
    }
    if (!st.refs.length) return;
    const c = this.dimensionFor(st.refs, p, st.toCurve);
    if (!c) {
      useEditor.getState().showToast('These entities cannot be dimensioned together', 'error');
      this.tool = { k: 'idle' };
      useEditor.getState().setSketchSelection([]);
      return;
    }
    const map = this.map();
    const value = measureConstraint(c as SkConstraint, [...map.values()]);
    const units = useDoc.getState().doc!.units;
    const text = c.type === 'angle' ? `${formatNumber((value * 180) / Math.PI, 3)} deg` : `${formatNumber(value / LENGTH_FACTOR[units.length], 4)} ${units.length}`;
    const id = c.id;
    // a dimension that would over-define the sketch becomes a driven one (Onshape)
    const cur = this.data()!;
    const before = this.solve(cur).info;
    const trial = this.solve(produce(cur, (d) => void d.constraints.push({ ...c, value: text }))).info;
    const driven = trial.redundant.includes(id) || trial.conflicting.includes(id) || trial.conflicting.length > before.conflicting.length || (!trial.ok && before.ok);
    this.change((d) => {
      d.constraints.push({ ...c, value: text, ...(driven ? { driven: true } : {}) });
    });
    this.tool = { k: 'idle' };
    useEditor.getState().setSketchSelection([]);
    this.clearPreview();
    if (driven) useEditor.getState().showToast('The dimension would over-define the sketch: it is added as a driven one');
    // open inline editor
    else setTimeout(() => this.openDimInput(id, true), 0);
  }

  /** Build the dimension constraint implied by the picked entities and the label position. */
  private dimensionFor(refs: string[], label: Vec2, toCurve = false): SkConstraint | null {
    const map = this.map();
    const ents = refs.map((r) => map.get(r)).filter((e): e is SkEntity => !!e);
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    let c: Omit<SkConstraint, 'variant'> | null = null;
    if (ents.length === 3) {
      // three points: the angle at the middle one; two ends of an arc and the arc: its length
      if (ents.every((e) => e.type === 'point')) c = { id, type: 'angle', refs: ents.map((e) => e.id), labelPos: label };
      else if (ents[2].type === 'arc') c = { id, type: 'arclength', refs: [ents[2].id], labelPos: label };
    } else if (ents.length === 2 && toCurve) {
      // to a circle / arc itself: from a point, a line, another circle / arc
      const curve = ents.find((e) => e.type === 'circle' || e.type === 'arc');
      const other = ents.find((e) => e !== curve);
      if (curve && other && (other.type === 'point' || other.type === 'line' || other.type === 'circle' || other.type === 'arc'))
        c = { id, type: 'distance', refs: [other.id, curve.id], labelPos: label, toCurve: true };
    } else if (ents.length === 1) {
      const e = ents[0];
      if (e.type === 'line') c = { id, type: 'distance', refs: [e.id], labelPos: label };
      else if (e.type === 'circle') c = { id, type: 'diameter', refs: [e.id], labelPos: label };
      else if (e.type === 'arc') c = { id, type: 'radius', refs: [e.id], labelPos: label };
      else if (e.type === 'ellipse') {
        // Onshape: an axis diameter; the label beside an axis measures that axis (like H / V distances)
        const ctr = pointOf(map, e.c);
        const u: Vec2 = [label[0] - ctr[0], label[1] - ctr[1]];
        const lx = Math.abs(u[0] * Math.cos(e.rot) + u[1] * Math.sin(e.rot)) / (e.rx || 1);
        const ly = Math.abs(-u[0] * Math.sin(e.rot) + u[1] * Math.cos(e.rot)) / (e.ry || 1);
        return { id, type: 'diameter', refs: [e.id], labelPos: label, variant: ly >= lx ? 0 : 1 };
      }
    } else if (ents.length === 2) {
      const [a, b] = ents;
      if (a.type === 'point' && b.type === 'point') {
        const dx = Math.abs(b.x - a.x);
        const dy = Math.abs(b.y - a.y);
        // label placement selects horizontal / vertical / aligned like Onshape
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        let type: ConstraintType = 'distance';
        if (label[1] > maxY || label[1] < minY) {
          if (label[0] >= minX && label[0] <= maxX && dx > 1e-9) type = 'hdistance';
        }
        if (label[0] > maxX || label[0] < minX) {
          if (label[1] >= minY && label[1] <= maxY && dy > 1e-9) type = 'vdistance';
        }
        if (dx < 1e-9) type = 'vdistance';
        if (dy < 1e-9) type = 'hdistance';
        c = { id, type, refs: [a.id, b.id], labelPos: label };
      } else if ((a.type === 'point' && b.type === 'line') || (a.type === 'line' && b.type === 'point')) {
        const pt = a.type === 'point' ? a : b;
        const ln = a.type === 'line' ? a : b;
        c = { id, type: 'distance', refs: [pt.id, ln.id], labelPos: label };
      } else if (a.type === 'line' && b.type === 'line') {
        const d1 = this.dirOf(a, map);
        const d2 = this.dirOf(b, map);
        const cr = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]);
        if (cr < 1e-6) c = { id, type: 'distance', refs: [a.id, b.id], labelPos: label };
        else c = { id, type: 'angle', refs: [a.id, b.id], labelPos: label };
      } else if ((a.type === 'circle' || a.type === 'arc') && (b.type === 'circle' || b.type === 'arc')) {
        c = { id, type: 'distance', refs: [a.c, b.c], labelPos: label };
      } else if ((a.type === 'circle' || a.type === 'arc') && b.type === 'point') {
        c = { id, type: 'distance', refs: [a.c, b.id], labelPos: label };
      } else if (a.type === 'point' && (b.type === 'circle' || b.type === 'arc')) {
        c = { id, type: 'distance', refs: [a.id, b.c], labelPos: label };
      } else if ((a.type === 'circle' || a.type === 'arc') && b.type === 'line') {
        c = { id, type: 'distance', refs: [a.c, b.id], labelPos: label };
      } else if (a.type === 'line' && (b.type === 'circle' || b.type === 'arc')) {
        c = { id, type: 'distance', refs: [b.c, a.id], labelPos: label };
      }
    }
    if (!c) return null;
    const variant = initialVariant(c, [...map.values()]);
    return { ...c, variant };
  }

  private dirOf(l: SkEntity & { type: 'line' }, map: EntityMap): Vec2 {
    const a = pointOf(map, l.p1);
    const b = pointOf(map, l.p2);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  }

  openDimInput(id: string, isNew: boolean) {
    const c = this.data()?.constraints.find((x) => x.id === id);
    if (!c) return;
    if (c.driven) {
      useEditor.getState().showToast('A driven dimension shows what the geometry measures: make it driving (right click) to change it');
      return;
    }
    this.editingDim = { id, isNew };
    this.dimInput.value = c.value ?? '';
    this.dimInput.style.display = 'block';
    this.positionDimInput();
    this.dimInput.focus();
    this.dimInput.select();
  }

  private positionDimInput() {
    if (!this.editingDim) return;
    const c = this.data()?.constraints.find((x) => x.id === this.editingDim!.id);
    if (!c) return;
    const g = dimensionGeometry(c, this.map(), this.px);
    if (!g) return;
    const v = new THREE.Vector3(g.label[0], g.label[1], 0).applyMatrix4(this.root.matrix).project(this.engine.cam.camera);
    const r = this.engine.container.getBoundingClientRect();
    this.dimInput.style.left = `${((v.x + 1) / 2) * r.width - 50}px`;
    this.dimInput.style.top = `${((1 - v.y) / 2) * r.height - 13}px`;
  }

  private onDimKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') this.commitDimInput(false);
    else if (e.key === 'Escape') this.cancelDimInput();
  }

  private commitDimInput(fromBlur: boolean) {
    const ed = this.editingDim;
    if (!ed) return;
    const value = this.dimInput.value.trim();
    this.editingDim = null;
    this.dimInput.style.display = 'none';
    this.dimInput.blur();
    const c = this.data()?.constraints.find((x) => x.id === ed.id);
    if (!c) return;
    if (!value || value === c.value) return;
    const kind = c.type === 'angle' ? 'angle' : 'length';
    if (tryEvaluate(value, kind, this.evalCtx()) === null) {
      if (!fromBlur) useEditor.getState().showToast(`Invalid expression: ${value}`, 'error');
      return;
    }
    this.change((d) => {
      const k = d.constraints.find((x) => x.id === ed.id);
      if (k) k.value = value;
    });
  }

  private cancelDimInput() {
    this.editingDim = null;
    this.dimInput.style.display = 'none';
    this.dimInput.blur();
  }

  // -------------------------------------------------------------------------
  // Dragging
  // -------------------------------------------------------------------------

  private startDrag(id: string, p0: Vec2) {
    const d = this.data();
    if (!d) return;
    const map = this.map();
    const e = map.get(id);
    if (!e) return;
    const pointsOf = (ent: SkEntity): string[] => {
      switch (ent.type) {
        case 'point':
          return [ent.id];
        case 'line':
          return [ent.p1, ent.p2];
        case 'arc':
          return [ent.c, ent.p1, ent.p2];
        case 'circle':
        case 'ellipse':
          return [ent.c];
        case 'spline':
          // the tangent handles move with the curve
          return [...ent.pts, ...[ent.h0, ent.h1].filter((h): h is string => !!h && map.has(h))];
        case 'text':
          return [ent.p1, ent.p2];
        case 'gear':
          return [ent.c];
      }
    };
    if (e.type === 'circle') {
      const c = pointOf(map, e.c);
      // grabbing the rim changes the radius; near the centre moves it
      if (Math.abs(Math.hypot(p0[0] - c[0], p0[1] - c[1]) - e.r) < 8 * this.px) {
        this.drag = { kind: 'radius', id, base: d };
        return;
      }
    }
    const ids = pointsOf(e);
    const orig = new Map<string, Vec2>();
    for (const pid of ids) orig.set(pid, pointOf(map, pid));
    // a single point being dragged can snap to other geometry: never to itself, the points
    // joined to it or the curves they belong to
    let exclude: Set<string> | undefined;
    if (ids.length === 1 && e.type === 'point') {
      exclude = new Set(ids);
      for (const c of d.constraints)
        if (c.type === 'coincident' && c.refs.includes(ids[0]) && c.refs.every((r) => map.get(r)?.type === 'point')) c.refs.forEach((r) => exclude!.add(r));
      for (const pid of [...exclude]) {
        const owner = (map.get(pid) as SkEntity & { owner?: string }).owner;
        if (!owner) continue;
        exclude.add(owner);
        for (const q of d.entities) if (q.type === 'point' && q.owner === owner) exclude.add(q.id);
      }
    }
    this.drag = { kind: 'points', ids, start: p0, orig, base: d, exclude };
  }

  private updateDrag(p: Vec2, screen?: { x: number; y: number }) {
    const dr = this.drag;
    const cur = this.data();
    if (!dr || !cur) return;
    this.engine.setCursor('move');
    let drag: { points?: Record<string, Vec2>; radii?: Record<string, number> };
    if (dr.kind === 'points') {
      const delta: Vec2 = [p[0] - dr.start[0], p[1] - dr.start[1]];
      const pts: Record<string, Vec2> = {};
      for (const [id, o] of dr.orig) pts[id] = [o[0] + delta[0], o[1] + delta[1]];
      // inference: a dragged point snaps to points / curves / midpoints / the origin (Onshape)
      if (dr.exclude && screen) {
        const s = this.computeSnap(screen.x, screen.y, pts[dr.ids[0]], dr.exclude);
        // (a drop makes no alignment constraints: onto a curve it is only on it)
        dr.snap = s.kind === 'none' || s.kind === 'align' ? null : s.kind === 'curve' ? { kind: 'curve', id: s.id, pos: s.pos } : s;
        if (dr.snap) pts[dr.ids[0]] = dr.snap.pos;
        this.snap = dr.snap ?? null;
        useEditor.getState().setSketchHover(dr.snap && 'id' in dr.snap ? dr.snap.id : null);
        this.showInference(screen.x, screen.y);
      }
      drag = { points: pts };
    } else if (dr.kind === 'radius') {
      const map = this.map();
      const e = map.get(dr.id);
      if (!e || e.type !== 'circle') return;
      const c = pointOf(map, e.c);
      drag = { radii: { [dr.id]: Math.max(Math.hypot(p[0] - c[0], p[1] - c[1]), 1e-6) } };
    } else {
      useEditor.getState().updateSketch((d) => {
        const k = d.constraints.find((x) => x.id === dr.id);
        if (k) k.labelPos = p;
      }, false);
      return;
    }
    const { dims } = sketchDims(cur, this.evalCtx());
    const res = solveSketch(cur.entities, cur.constraints, dims, { drag, analyze: false });
    useEditor.getState().updateSketch((d) => {
      d.entities = res.entities as Draft<SkEntity>[];
    }, false);
  }

  private endDrag() {
    const dr = this.drag;
    this.drag = null;
    this.updateCursor();
    const cur = this.data();
    if (!dr || !cur) return;
    const ed = useEditor.getState();
    // dropped onto geometry: the inferred constraint is added (refused if it conflicts)
    if (dr.kind === 'points' && dr.snap) {
      const pid = dr.ids[0];
      const snap = dr.snap;
      this.snap = null;
      this.inferLabel.style.display = 'none';
      ed.setSketchHover(null);
      const withConstraint = produce(cur, (d) => applySnap(d, pid, snap));
      const res = this.solve(withConstraint);
      if (res.info.ok && !res.info.conflicting.length) {
        ed.updateSketch((d) => {
          d.entities = res.entities as Draft<SkEntity>[];
          d.constraints = withConstraint.constraints as Draft<SkConstraint>[];
        }, false);
        ed.setSolve(res.info);
        const s = useEditor.getState().sketch;
        if (s) useEditor.setState({ sketch: { ...s, past: [...s.past, dr.base].slice(-200), future: [] } });
        return;
      }
      ed.showToast(t('This constraint conflicts with existing constraints or dimensions'), 'error');
    }
    const res = this.solve(cur);
    ed.updateSketch((d) => {
      d.entities = res.entities as Draft<SkEntity>[];
    }, false);
    ed.setSolve(res.info);
    const s = useEditor.getState().sketch;
    if (s) useEditor.setState({ sketch: { ...s, past: [...s.past, dr.base].slice(-200), future: [] } });
  }

  startLabelDrag(id: string) {
    const d = this.data();
    if (d) this.drag = { kind: 'label', id, base: d };
  }

  // -------------------------------------------------------------------------
  // Commands from toolbar / shortcuts
  // -------------------------------------------------------------------------

  deleteSelection() {
    const sel = useEditor.getState().sketch?.selection ?? [];
    if (!sel.length) return;
    this.change((d) => deleteItems(d, sel));
    useEditor.getState().setSketchSelection([]);
  }

  toggleConstruction() {
    const ed = useEditor.getState();
    const sel = ed.sketch?.selection ?? [];
    if (!sel.length) {
      const s = ed.sketch!;
      useEditor.setState({ sketch: { ...s, construction: !s.construction } });
      return;
    }
    this.change((d) => toggleConstruction(d, sel));
  }

  /**
   * Apply a geometric constraint to the current selection. Without the entities it needs (Onshape: the tool first,
   * then the picks) the tool stays on with a hint of what to pick, and each pick tries again (`pick`).
   */
  applyConstraint(type: ConstraintType, pick = false) {
    const ed = useEditor.getState();
    const sel = ed.sketch?.selection ?? [];
    const map = this.map();
    const ents = sel.map((id) => map.get(id)).filter((e): e is SkEntity => !!e);
    const isCurve = (e: SkEntity) => e.type !== 'point';
    const isRound = (e: SkEntity) => e.type === 'circle' || e.type === 'arc';
    const lines = ents.filter((e) => e.type === 'line');
    const points = ents.filter((e) => e.type === 'point');
    const toAdd: Omit<SkConstraint, 'id'>[] = [];
    const fail = (msg: string) => {
      const s = useEditor.getState().sketch;
      if (!s) return;
      // more picks than it takes and still no constraint: start again from the last one
      const max = constraintPicks(type);
      const keep = sel.length >= max ? sel.slice(-1) : sel;
      useEditor.setState({ sketch: { ...s, tool: 'select', constraint: type, hint: msg, selection: pick ? keep : sel.length < max ? sel : [] } });
      if (!pick) ed.showToast(msg, 'info');
    };
    const d0 = this.data();
    if (!d0) return;
    /** A spline tangent handle the constraint needs (created with it, one undo step). */
    let handleFor: { spline: string; end: 'h0' | 'h1' } | null = null;
    switch (type) {
      case 'horizontal':
      case 'vertical':
        if (lines.length) lines.forEach((l) => toAdd.push({ type, refs: [l.id] }));
        else if (points.length === 2) toAdd.push({ type, refs: [points[0].id, points[1].id] });
        else return fail('Select lines or two points');
        break;
      case 'coincident':
        if (points.length >= 2 && ents.length === points.length)
          for (let i = 1; i < points.length; i++) toAdd.push({ type, refs: [points[0].id, points[i].id] });
        else if (points.length === 1 && ents.length === 2) toAdd.push({ type, refs: [points[0].id, ents.find(isCurve)!.id] });
        else return fail('Select points (and optionally one curve)');
        break;
      case 'parallel':
      case 'perpendicular':
        if (lines.length < 2) return fail('Select two lines');
        for (let i = 1; i < lines.length; i++) toAdd.push({ type, refs: [lines[0].id, lines[i].id] });
        break;
      case 'equal': {
        const curves = ents.filter(isCurve);
        if (curves.length < 2) return fail('Select two or more lines or arcs');
        for (let i = 1; i < curves.length; i++) toAdd.push({ type, refs: [curves[0].id, curves[i].id] });
        break;
      }
      case 'tangent': {
        const curves = ents.filter(isCurve);
        const spline = curves.find((e) => e.type === 'spline');
        if (curves.length === 2 && spline && spline.type === 'spline') {
          // a spline end joined to a line / arc: tangent through the handle at that end (created if needed)
          const other = curves.find((e) => e !== spline)!;
          const ends = other.type === 'line' || other.type === 'arc' ? [other.p1, other.p2] : [];
          const joined = (a: string, b: string) => {
            if (a === b) return true;
            if (d0.constraints.some((c) => c.type === 'coincident' && c.refs.includes(a) && c.refs.includes(b))) return true;
            const pa = map.get(a);
            const pb = map.get(b);
            return !!pa && !!pb && pa.type === 'point' && pb.type === 'point' && Math.hypot(pa.x - pb.x, pa.y - pb.y) < 1e-6 * (1 + Math.hypot(pa.x, pa.y));
          };
          const endPt = [spline.pts[0], spline.pts[spline.pts.length - 1]].find((p) => ends.some((q) => joined(p, q)));
          const which = endPt ? splineEndAt(spline, endPt) : null;
          if (!which) return fail('Join an end of the spline to the end of a line or arc first');
          handleFor = { spline: spline.id, end: which };
          toAdd.push({ type, refs: [spline.id, other.id] });
          break;
        }
        if (curves.length !== 2 || !curves.some(isRound)) return fail('Select a line and an arc/circle, or two arcs');
        toAdd.push({ type, refs: [curves[0].id, curves[1].id] });
        break;
      }
      case 'midpoint':
        if (points.length !== 1 || lines.length !== 1) return fail('Select a point and a line');
        toAdd.push({ type, refs: [points[0].id, lines[0].id] });
        break;
      case 'concentric': {
        const rs = ents.filter((e) => isRound(e) || e.type === 'ellipse' || e.type === 'point');
        if (rs.length !== 2) return fail('Select two circles or arcs');
        toAdd.push({ type, refs: [rs[0].id, rs[1].id] });
        break;
      }
      case 'symmetric': {
        // two points / lines / arcs / circles and a line; the axis is the line about which the other
        // two are closest to mirror images (with three lines: the one in the middle, Onshape-like)
        if (ents.length !== 3 || !lines.length) return fail('Select two points, lines, arcs or circles and a line as the axis');
        const all = [...map.values()];
        let best: { refs: string[]; err: number } | null = null;
        for (const axis of lines) {
          const [a, b] = ents.filter((e) => e !== axis);
          const fit = symmetryFit(all, a.id, b.id, axis.id);
          if (!fit) continue;
          // construction lines are the usual axes
          const err = fit.err * (axis.construction ? 0.5 : 1);
          if (!best || err < best.err) best = { refs: [a.id, b.id, axis.id], err };
        }
        if (!best) return fail('Select two points, lines, arcs or circles and a line as the axis');
        toAdd.push({ type, refs: best.refs });
        break;
      }
      case 'fix':
        if (!ents.length) return fail('Select entities to fix');
        ents.forEach((e) => toAdd.push({ type, refs: [e.id], frozen: frozenValues(e.id, [...map.values()]) }));
        break;
      default:
        return;
    }
    const handle = handleFor as { spline: string; end: 'h0' | 'h1' } | null;
    const ok = this.change(
      (d) => {
        if (handle) addSplineHandle(d, handle.spline, handle.end);
        for (const c of toAdd) {
          const variant = initialVariant({ id: 'tmp', ...c }, d.entities as SkEntity[]);
          addConstraint(d, c.type, c.refs, { ...(c.frozen ? { frozen: c.frozen } : {}), variant });
        }
      },
      { checkConflict: true },
    );
    // picked with the tool on: it stays on for the next one (Esc or another tool ends it)
    if (ok) ed.setSketchSelection([]);
  }

  // -------------------------------------------------------------------------
  // Mirror & patterns
  // -------------------------------------------------------------------------

  /**
   * Mirror: entities and the mirror line selected (the line last) — mirrored at once. Otherwise the tool waits for its
   * picks (Onshape): the mirror line first (the one selected, if a line alone is), then each entity picked is mirrored
   * about it until Esc; entities selected without a line are mirrored as soon as the line is picked.
   */
  applyMirror() {
    const ed = useEditor.getState();
    const s = ed.sketch;
    if (!s) return;
    // the tool on: its button turns it off
    if (s.mirror) {
      useEditor.setState({ sketch: { ...s, mirror: undefined, selection: [] } });
      return this.setHint();
    }
    const sel = s.selection;
    const map = this.map();
    const axis = [...sel].reverse().find((id) => map.get(id)?.type === 'line');
    const ids = sel.filter((id) => id !== axis && map.has(id));
    if (axis && ids.length) {
      let ok = false;
      this.change((d) => {
        ok = mirrorEntities(d, ids, axis);
      });
      if (ok) ed.setSketchSelection([]);
      return;
    }
    if (this.tool.k !== 'idle') this.endTool();
    useEditor.setState({
      sketch: {
        ...s,
        tool: 'select',
        constraint: undefined,
        mirror: { ...(axis ? { axis } : {}), pending: axis ? [] : ids, done: [] },
        selection: axis ? [axis] : ids,
        hint: axis ? MIRROR_ENTITIES : MIRROR_LINE,
      },
    });
  }

  /** A pick of the Mirror tool: its line, then an entity to mirror about it. */
  private mirrorPick(id: string) {
    const ed = useEditor.getState();
    const m = ed.sketch?.mirror;
    if (!m) return;
    const map = this.map();
    if (!m.axis) {
      if (map.get(id)?.type !== 'line') return ed.showToast(MIRROR_LINE, 'info');
      // the entities selected before it: mirrored now
      const pending = m.pending.filter((x) => x !== id && map.has(x));
      let ok = false;
      if (pending.length)
        this.change((d) => {
          ok = mirrorEntities(d, pending, id);
        });
      const s = useEditor.getState().sketch;
      if (s) useEditor.setState({ sketch: { ...s, mirror: { axis: id, pending: [], done: ok ? pending : [] }, selection: [id], hint: MIRROR_ENTITIES } });
      return;
    }
    // the line itself, or one already mirrored about it (or a mirror image): nothing
    const e = map.get(id);
    const own = !e ? [] : e.type === 'point' ? [e.id] : 'pts' in e ? e.pts : ['p1' in e ? e.p1 : '', 'p2' in e ? e.p2 : '', 'c' in e ? e.c : ''].filter(Boolean);
    const imaged = this.data()?.constraints.some((c) => c.type === 'symmetric' && c.refs[2] === m.axis && own.some((p) => c.refs[0] === p || c.refs[1] === p));
    if (id === m.axis || m.done.includes(id) || imaged) return;
    let ok = false;
    this.change((d) => {
      ok = mirrorEntities(d, [id], m.axis!);
    });
    const s = useEditor.getState().sketch;
    if (s) useEditor.setState({ sketch: { ...s, mirror: { ...m, done: ok ? [...m.done, id] : m.done }, selection: [m.axis] } });
  }

  /** Create an associative pattern from the selection and open its editor (Onshape flow). */
  startPattern(kind: 'linear' | 'circular') {
    const ed = useEditor.getState();
    const d = this.data();
    if (!d) return;
    const sel = (ed.sketch?.selection ?? []).filter((id) => !isCopyId(id));
    const map = this.map();
    let centerRef: string | undefined;
    let ids = sel;
    if (kind === 'circular') {
      const last = map.get(sel[sel.length - 1]);
      if (last && last.type === 'point' && sel.length > 1) {
        centerRef = last.id;
        ids = sel.slice(0, -1);
      }
    }
    ids = patternableIds(d, ids);
    if (!ids.length) {
      ed.showToast('Select sketch entities to pattern', 'error');
      return;
    }
    // default spacing: 1.5 × the selection width
    let lo = Infinity;
    let hi = -Infinity;
    for (const id of ids) {
      const e = map.get(id);
      if (!e) continue;
      for (const q of e.type === 'point' ? [[e.x, e.y] as Vec2] : sampleEntity(e, map)) {
        lo = Math.min(lo, q[0]);
        hi = Math.max(hi, q[0]);
      }
    }
    const unit = useDoc.getState().doc!.units.length;
    const w = Number.isFinite(hi - lo) && hi > lo ? hi - lo : 10;
    const raw = (w * 1.5) / LENGTH_FACTOR[unit];
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const spacing = `${formatNumber(Math.max(mag, Math.round(raw / mag) * mag), 4)} ${unit}`;
    const pattern: SkPattern =
      kind === 'circular'
        ? { id: uid('pt'), kind, seed: ids, count: '4', angle: '360 deg', ...(centerRef ? { centerRef } : { center: [0, 0] as Vec2 }) }
        : { id: uid('pt'), kind, seed: ids, count: '3', spacing, dirAngle: '0 deg', count2: '1', spacing2: spacing };
    const base = d;
    useEditor.getState().updateSketch((dd) => {
      dd.patterns = [...(dd.patterns ?? []), pattern as Draft<SkPattern>];
    }, false);
    useEditor.setState({ sketchPattern: { patternId: pattern.id, isNew: true, base } });
    ed.setSketchSelection([]);
  }

  /** Open the editor of an existing pattern (double-click an instance or its glyph). */
  editPattern(patternId: string) {
    const d = this.data();
    if (!d?.patterns?.some((p) => p.id === patternId)) return;
    useEditor.setState({ sketchPattern: { patternId, isNew: false, base: d } });
  }

  updatePattern(patch: Partial<SkPattern>) {
    const st = useEditor.getState().sketchPattern;
    if (!st) return;
    useEditor.getState().updateSketch((d) => {
      const p = d.patterns?.find((x) => x.id === st.patternId);
      if (p) Object.assign(p, patch);
    }, false);
  }

  applyPattern() {
    const st = useEditor.getState().sketchPattern;
    if (!st) return;
    useEditor.setState({ sketchPattern: null });
    const s = useEditor.getState().sketch;
    if (s) useEditor.setState({ sketch: { ...s, past: [...s.past, st.base].slice(-200), future: [] } });
  }

  cancelPattern() {
    const st = useEditor.getState().sketchPattern;
    if (!st) return;
    useEditor.setState({ sketchPattern: null });
    useEditor.getState().updateSketch((d) => {
      d.patterns = (st.base.patterns ?? []) as Draft<SkPattern>[];
    }, false);
  }

  // -------------------------------------------------------------------------
  // Transform (Onshape): move / turn / copy the selected entities
  // -------------------------------------------------------------------------

  startTransform() {
    const ed = useEditor.getState();
    const d = this.data();
    if (!d) return;
    const ids = patternableIds(d, (ed.sketch?.selection ?? []).filter((id) => !isCopyId(id)));
    if (!ids.length) {
      ed.showToast('Select sketch entities to transform', 'error');
      return;
    }
    // the turn is about the middle of their bounding box
    const map = this.map();
    const lo: Vec2 = [Infinity, Infinity];
    const hi: Vec2 = [-Infinity, -Infinity];
    for (const id of ids) {
      const e = map.get(id);
      if (!e) continue;
      for (const q of e.type === 'point' ? [[e.x, e.y] as Vec2] : sampleEntity(e, map)) {
        lo[0] = Math.min(lo[0], q[0]);
        lo[1] = Math.min(lo[1], q[1]);
        hi[0] = Math.max(hi[0], q[0]);
        hi[1] = Math.max(hi[1], q[1]);
      }
    }
    const unit = useDoc.getState().doc!.units.length;
    const pivot: Vec2 = Number.isFinite(lo[0]) ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2] : [0, 0];
    useEditor.setState({ sketchTransform: { ids, dx: `0 ${unit}`, dy: `0 ${unit}`, angle: '0 deg', pivot, copy: false } });
    this.updatePreview();
  }

  updateTransform(patch: Partial<SketchTransformState>) {
    const st = useEditor.getState().sketchTransform;
    if (!st) return;
    useEditor.setState({ sketchTransform: { ...st, ...patch } });
    this.updatePreview();
  }

  /** The motion of the transform being set up: turn about the pivot, then move (null while a value is invalid). */
  private transformMotion(): { xf: (p: Vec2) => Vec2; angle: number } | null {
    const st = useEditor.getState().sketchTransform;
    if (!st) return null;
    const ctx = this.evalCtx();
    const dx = tryEvaluate(st.dx, 'length', ctx);
    const dy = tryEvaluate(st.dy, 'length', ctx);
    const a = tryEvaluate(st.angle, 'angle', ctx);
    if (dx === null || dy === null || a === null) return null;
    const [cx, cy] = st.pivot;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { angle: a, xf: ([x, y]) => [cx + (x - cx) * c - (y - cy) * s + dx, cy + (x - cx) * s + (y - cy) * c + dy] };
  }

  applyTransform() {
    const ed = useEditor.getState();
    const st = ed.sketchTransform;
    if (!st) return;
    const m = this.transformMotion();
    if (!m) {
      ed.showToast('Invalid expression', 'error');
      return;
    }
    const out = { removed: 0, ids: [] as string[] };
    this.change((d) => {
      if (st.copy) {
        const made = copyEntities(d, st.ids, m.xf, { rotate: m.angle, copyConstraints: true });
        out.ids = st.ids.flatMap((id) => made.get(id) ?? []);
      } else {
        out.removed = moveEntities(d, st.ids, m.xf, m.angle);
        out.ids = st.ids;
      }
    });
    useEditor.setState({ sketchTransform: null });
    ed.setSketchSelection(out.ids);
    if (out.removed) ed.showToast(`${t('Constraints that held the entities in place were removed')}: ${out.removed}`);
    this.updatePreview();
  }

  cancelTransform() {
    useEditor.setState({ sketchTransform: null });
    this.updatePreview();
  }

  /** Pattern ids touched by the selection (pattern itself or one of its copies). */
  private selectedPatterns(): string[] {
    const sel = useEditor.getState().sketch?.selection ?? [];
    const d = this.data();
    const out = new Set<string>();
    for (const id of sel) {
      if (d?.patterns?.some((p) => p.id === id)) out.add(id);
      const c = parseCopyId(id);
      if (c) out.add(c.patternId);
    }
    return [...out];
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  beforeRender() {
    if (!this.active) return;
    const px = this.px;
    if (Math.abs(px - this.renderedPx) / (this.renderedPx || 1) > 0.01) this.renderSketch(true);
    else this.layoutGlyphs();
    if (this.editingDim) this.positionDimInput();
    if (this.quick) this.positionQuick();
  }

  // -------------------------------------------------------------------------
  // Quick dimensions after drawing (optional, Onshape-like)
  // -------------------------------------------------------------------------

  /** Show value boxes for the main sizes of a just-drawn shape. Nothing is added unless a value is typed. */
  private offerQuick(specs: QuickSpec[]) {
    this.closeQuick(false);
    if (!specs.length) return;
    const map = this.map();
    if (specs.some((s) => s.refs.some((r) => !map.has(r)))) return;
    const units = useDoc.getState().doc!.units;
    const box = document.createElement('div');
    box.className = 'quick-dims';
    const items: QuickDim[] = specs.map((spec) => {
      const v = measureConstraint({ id: 'quick', type: spec.type, refs: spec.refs, variant: spec.variant }, [...map.values()]);
      const input = document.createElement('input');
      input.className = 'dim-input quick';
      input.value = formatNumber(v / LENGTH_FACTOR[units.length], 3);
      input.title = t('Type a value and press Enter to add a dimension (optional)');
      const item: QuickDim = { spec, input, edited: false };
      input.addEventListener('input', () => (item.edited = true));
      input.addEventListener('focus', () => input.select());
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.closeQuick(true);
        else if (e.key === 'Escape') this.closeQuick(false);
        else if (e.key === 'Tab' && this.quick) {
          e.preventDefault();
          const list = this.quick.items;
          const i = list.indexOf(item);
          list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length].input.focus();
        }
      });
      input.addEventListener('blur', () =>
        setTimeout(() => {
          if (this.quick?.items.includes(item) && !this.quick.items.some((q) => q.input === document.activeElement)) this.closeQuick(true);
        }, 0),
      );
      box.appendChild(input);
      return item;
    });
    this.engine.container.appendChild(box);
    this.quick = { box, items };
    this.positionQuick();
  }

  private positionQuick() {
    const q = this.quick;
    if (!q) return;
    const map = this.map();
    const r = this.engine.container.getBoundingClientRect();
    for (const it of q.items) {
      if (it.spec.refs.some((id) => !map.has(id))) {
        // the shape was undone / deleted meanwhile
        this.closeQuick(false);
        return;
      }
      const g = dimensionGeometry({ id: 'quick', type: it.spec.type, refs: it.spec.refs, variant: it.spec.variant }, map, this.px);
      if (!g) continue;
      const v = new THREE.Vector3(g.label[0], g.label[1], 0).applyMatrix4(this.root.matrix).project(this.engine.cam.camera);
      it.input.style.left = `${((v.x + 1) / 2) * r.width - 40}px`;
      it.input.style.top = `${((1 - v.y) / 2) * r.height - 12}px`;
    }
  }

  /** Remove the offered boxes; with `apply`, typed values become dimensions (one undo step). */
  private closeQuick(apply: boolean) {
    const q = this.quick;
    if (!q) return;
    this.quick = null;
    q.box.remove();
    if (!apply) return;
    const units = useDoc.getState().doc!.units;
    const ctx = this.evalCtx();
    const dims: { spec: QuickSpec; value: string }[] = [];
    for (const it of q.items) {
      const raw = it.input.value.trim();
      if (!it.edited || !raw) continue;
      const value = /^-?\d*[.,]?\d+$/.test(raw) ? `${raw.replace(',', '.')} ${units.length}` : raw;
      if (tryEvaluate(value, 'length', ctx) === null) {
        useEditor.getState().showToast(`Invalid expression: ${raw}`, 'error');
        continue;
      }
      dims.push({ spec: it.spec, value });
    }
    if (!dims.length) return;
    const ok = this.change(
      (d) => {
        for (const x of dims) addConstraint(d, x.spec.type, x.spec.refs, { value: x.value, ...(x.spec.variant !== undefined ? { variant: x.spec.variant } : {}) });
      },
      { checkConflict: true },
    );
    // a line chain continues from the end point at its new, dimensioned position
    if (ok && this.tool.k === 'line' && this.tool.chainPoint) {
      const p = this.map().get(this.tool.chainPoint);
      if (p && p.type === 'point') this.tool = { ...this.tool, start: { pos: [p.x, p.y], snap: { kind: 'none', pos: [p.x, p.y] } } };
      this.updatePreview();
    }
  }

  /** Typing a number right after drawing goes into the first offered box. */
  private quickKey(e: KeyboardEvent): boolean {
    const q = this.quick;
    if (!q || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Escape') {
      this.closeQuick(false);
      return true;
    }
    if (e.key === 'Tab') {
      q.items[0].input.focus();
      return true;
    }
    if (/^[0-9.,#(-]$/.test(e.key)) {
      const it = q.items[0];
      it.input.focus();
      it.input.value = e.key;
      it.edited = true;
      return true;
    }
    return false;
  }

  /** Ids highlighted because a hovered constraint / dimension references them. */
  private hoverRefs = new Set<string>();

  private statusColor(id: string, construction?: boolean): number {
    const s = useEditor.getState().sketch;
    if (s?.selection.includes(id)) return COLORS.selected;
    if (s?.hover === id || this.hoverRefs.has(id)) return COLORS.hover;
    const st = s?.solve?.status[id];
    if (st === 'over') return COLORS.over;
    if (construction) return COLORS.constructionDark;
    return st === 'full' ? COLORS.full : COLORS.under;
  }

  /** Copies take the colour of their seed; selecting the pattern highlights every copy. */
  private copyColor(copy: SkEntity, selectedPatterns: Set<string>): number {
    const s = useEditor.getState().sketch;
    const c = parseCopyId(copy.id);
    if (!c) return COLORS.full;
    if (s?.selection.includes(copy.id) || selectedPatterns.has(c.patternId)) return COLORS.selected;
    if (s?.hover === copy.id || s?.hover === c.patternId) return COLORS.hover;
    return this.statusColor(c.seedId, copy.construction);
  }

  /** Construction lines: dash-dot (Onshape centre line style) built from two dashed layers. */
  /** Curves of one colour; construction curves are dash-dot (two dashed layers). */
  private addCurveGroup(segs: number[], color: number, width: number, construction: boolean, px: number, target: THREE.Group = this.root, order = 30) {
    if (!segs.length) return;
    if (!construction) {
      const l = fatSegments(segs, lineMaterial(color, width, { depthTest: false }));
      l.renderOrder = order;
      target.add(l);
      return;
    }
    const dash = lineMaterial(color, width * 0.8, { dashed: true, depthTest: false });
    dash.dashSize = 10 * px;
    dash.gapSize = 6 * px;
    const dot = lineMaterial(color, width * 0.8, { dashed: true, depthTest: false });
    dot.dashSize = 1.6 * px;
    dot.gapSize = 14.4 * px;
    dot.dashOffset = -12.2 * px;
    for (const m of [dash, dot]) {
      const l = fatSegments(segs, m);
      l.renderOrder = order;
      target.add(l);
    }
  }

  renderSketch(force = false) {
    if (!this.active) return;
    const d = this.data();
    const s = useEditor.getState().sketch;
    if (!d || !s) return;
    const showCons = useEditor.getState().showConstraints;
    const patState = useEditor.getState().sketchPattern;
    const showExpr = useEditor.getState().showExpressions;
    if (
      !force &&
      d === this.renderedData &&
      s.selection === this.renderedSel &&
      s.hover === this.renderedHover &&
      showCons === this.renderedShowCons &&
      patState === this.renderedPattern &&
      showExpr === this.renderedShowExpr &&
      Math.abs(this.px - this.renderedPx) < 1e-12
    )
      return;
    this.renderedShowCons = showCons;
    this.renderedData = d;
    this.renderedSel = s.selection;
    this.renderedHover = s.hover;
    this.renderedPattern = patState;
    this.renderedShowExpr = showExpr;
    this.renderedPx = this.px;
    const px = this.px;
    for (const c of [...this.root.children]) {
      if (c === this.preview || c === this.labels) continue;
      this.root.remove(c);
      disposeObject(c);
    }
    this.clear(this.pickRoot);
    this.clearLabels();
    const ctx = this.evalCtx();
    const all = expandGears(expandTexts(expandPatterns(d.entities, d.patterns, ctx)), ctx);
    const map = entityMap(all);
    const reg = this.engine.registry;
    // highlight the geometry of a hovered constraint / dimension
    this.hoverRefs = new Set();
    const hovered = s.hover ? d.constraints.find((c) => c.id === s.hover) : undefined;
    if (hovered) for (const r of hovered.refs) this.hoverRefs.add(r);
    const selectedPatterns = new Set(this.selectedPatterns());
    if (patState) selectedPatterns.add(patState.patternId);

    // regions (copies included)
    let regions: ReturnType<typeof computeRegions> = [];
    try {
      regions = computeRegions(all);
    } catch {
      regions = [];
    }
    for (const r of regions) {
      const m = new THREE.Mesh(
        regionGeometry(r),
        new THREE.MeshBasicMaterial({ color: COLORS.region, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      );
      this.root.add(m);
    }

    const groups = new Map<string, { color: number; construction: boolean; width: number; segs: number[] }>();
    const pickSegs: number[] = [];
    const pickIds: number[] = [];
    const ptPos: number[] = [];
    const ptIds: number[] = [];
    const ptByColor = new Map<number, Vec2[]>();
    for (const e of all) {
      // the letters and box of a text, the teeth of a gear: drawn in its colour and picked as the text (gear) itself
      const gear = gearOfPart(e.id);
      const text = textOfPart(e.id) ?? gear;
      if (text) {
        if (e.type === 'point') continue;
        const color = this.statusColor(text, !!e.construction);
        const emphasized = color === COLORS.selected || color === COLORS.hover;
        const key = `${color}|${!!e.construction}|${emphasized}`;
        const g = groups.get(key) ?? { color, construction: !!e.construction, width: emphasized ? 3 : 1.8, segs: [] };
        const segs = polylineSegments(entityPolyline(e, map));
        g.segs.push(...segs);
        groups.set(key, g);
        const id = reg.alloc({ t: 'edit', id: text, entType: gear ? 'gear' : 'text', priority: 38, radius: 6 });
        pickSegs.push(...segs);
        for (let i = 0; i < segs.length / 3; i++) pickIds.push(id);
        continue;
      }
      const copy = isCopyId(e.id);
      if (e.type === 'point') {
        const owner = e.owner ? map.get(e.owner) : undefined;
        const color = copy ? this.copyColor(owner ?? e, selectedPatterns) : this.statusColor(e.id, owner?.construction);
        const list = ptByColor.get(color) ?? [];
        list.push([e.x, e.y]);
        ptByColor.set(color, list);
        const id = reg.alloc({ t: 'edit', id: copy && owner ? owner.id : e.id, entType: copy ? 'copy' : 'point', priority: copy ? 30 : 58, radius: copy ? 4 : SNAP_PX });
        ptPos.push(e.x, e.y, 0);
        ptIds.push(id);
        continue;
      }
      const color = copy ? this.copyColor(e, selectedPatterns) : this.statusColor(e.id, e.construction);
      const emphasized = color === COLORS.selected || color === COLORS.hover;
      const key = `${color}|${!!e.construction}|${emphasized}`;
      const g = groups.get(key) ?? { color, construction: !!e.construction, width: emphasized ? 3 : 1.8, segs: [] };
      const segs = polylineSegments(entityPolyline(e, map));
      g.segs.push(...segs);
      groups.set(key, g);
      const id = reg.alloc({ t: 'edit', id: e.id, entType: copy ? 'copy' : e.type, priority: copy ? 30 : 38, radius: 6 });
      pickSegs.push(...segs);
      for (let i = 0; i < segs.length / 3; i++) pickIds.push(id);
    }
    // spline tangent handles (Onshape): dashed from the ends; a selected open spline also offers
    // "ghost" handles at its free ends — dragging or clicking one makes it a real handle
    const handleSegs: number[] = [];
    const ghostSegs: number[] = [];
    const ghostPts: Vec2[] = [];
    const selected = new Set(s.selection);
    for (const e of d.entities) {
      if (e.type !== 'spline' || e.closed || e.pts.length < 2) continue;
      let nat: { h0: Vec2; h1: Vec2 } | null | undefined;
      for (const [k, end] of [
        ['h0', e.pts[0]],
        ['h1', e.pts[e.pts.length - 1]],
      ] as const) {
        const p = map.get(end);
        if (!p || p.type !== 'point') continue;
        const h = e[k] ? map.get(e[k]!) : undefined;
        if (h && h.type === 'point') {
          handleSegs.push(p.x, p.y, 0, h.x, h.y, 0);
          continue;
        }
        if (!selected.has(e.id)) continue;
        nat ??= naturalHandles(e.pts.map((id) => pointOf(map, id)));
        if (!nat) continue;
        const q = nat[k];
        ghostSegs.push(p.x, p.y, 0, q[0], q[1], 0);
        ghostPts.push(q);
        const gid = reg.alloc({ t: 'edit', id: `${e.id}#${k}`, entType: 'ghostHandle', priority: 57, radius: SNAP_PX });
        ptPos.push(q[0], q[1], 0);
        ptIds.push(gid);
      }
    }
    if (handleSegs.length) this.addCurveGroup(handleSegs, COLORS.construction, 1.4, true, px);
    if (ghostSegs.length) this.addCurveGroup(ghostSegs, COLORS.patternHandle, 1.2, true, px);
    if (ghostPts.length) {
      const o = pointsObject(ghostPts, COLORS.patternHandle, 7, false);
      o.renderOrder = 31;
      this.root.add(o);
    }
    for (const g of groups.values()) this.addCurveGroup(g.segs, g.color, g.width, g.construction, px);
    for (const [color, pts] of ptByColor) {
      const o = pointsObject(pts, color, 5, false);
      o.renderOrder = 31;
      this.root.add(o);
    }
    if (pickSegs.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pickSegs, 3));
      lg.setAttribute('pickId', new THREE.Float32BufferAttribute(pickIds, 1));
      this.pickRoot.add(new THREE.LineSegments(lg, makePickMaterial({ depthTest: false })));
    }
    if (ptPos.length) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(ptPos, 3));
      pg.setAttribute('pickId', new THREE.Float32BufferAttribute(ptIds, 1));
      const pm = new THREE.Points(pg, makePickMaterial({ points: 10, depthTest: false }));
      pm.renderOrder = 2;
      this.pickRoot.add(pm);
    }
    void constantIds;
    this.renderDimensions(d, entityMap(d.entities), px);
    this.renderGlyphs(d, entityMap(d.entities));
    this.renderPatternWidgets(d, map, selectedPatterns);
    this.updatePreview();
    this.engine.requestRender();
  }

  /**
   * The screen-aligned box of a label (w × h px around `label`) as a parallelogram in sketch
   * coordinates, or null when the sketch is seen too obliquely for a meaningful gap.
   */
  private labelGap(label: Vec2, w: number, h: number, px: number): Vec2[] | null {
    const m = this.engine.cam.camera.matrixWorld.elements;
    const R = [m[0], m[1], m[2]];
    const U = [m[4], m[5], m[6]];
    const { xDir, yDir } = this.frame;
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // screen offset (sx, sy) [px] = M · v (sketch offset) / px, M rows = screen right / up in sketch axes
    const r0 = dot(R, xDir);
    const r1 = dot(R, yDir);
    const u0 = dot(U, xDir);
    const u1 = dot(U, yDir);
    const det = r0 * u1 - r1 * u0;
    if (Math.abs(det) < 0.2) return null;
    const off = (sx: number, sy: number): Vec2 => [label[0] + (px * (u1 * sx - r1 * sy)) / det, label[1] + (px * (-u0 * sx + r0 * sy)) / det];
    return [off(-w / 2, -h / 2), off(w / 2, -h / 2), off(w / 2, h / 2), off(-w / 2, h / 2)];
  }

  /** The last press on a label / glyph (they are made anew on every change, so a browser dblclick does not come). */
  private lastPress: { id: string; t: number; x: number; y: number } | null = null;
  /** The press just handled was the second of a double-click: its release is no click. */
  private swallowClick = false;

  /** Whether this press on `id` is the second of a double-click. */
  private isDoublePress(id: string, ev: PointerEvent): boolean {
    const p = this.lastPress;
    const double = !!p && p.id === id && ev.timeStamp - p.t < 450 && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 6;
    this.lastPress = double ? null : { id, t: ev.timeStamp, x: ev.clientX, y: ev.clientY };
    return double;
  }

  private renderDimensions(d: SketchData, map: EntityMap, px: number) {
    const s = useEditor.getState().sketch!;
    const units = useDoc.getState().doc!.units;
    const ctx = this.evalCtx();
    for (const c of d.constraints) {
      if (!isDimension(c)) continue;
      const g = dimensionGeometry(c, map, px);
      if (!g) continue;
      // an offset is internally redundant at tangent joints by design: only conflicts count
      const over = !c.driven && (s.solve?.conflicting.includes(c.id) || (c.type !== 'offset' && s.solve?.redundant.includes(c.id)));
      const sel = s.selection.includes(c.id);
      const hov = s.hover === c.id;
      // a driven dimension: grey (Onshape), what the geometry measures, in parentheses
      const color = sel ? COLORS.selected : hov ? COLORS.hover : over ? COLORS.over : c.driven ? 0x9aa0a6 : 0x1b1f23;
      const el = document.createElement('div');
      el.className = 'dim-label' + (over ? ' over' : '') + (sel ? ' selected' : '') + (hov ? ' hover' : '') + (c.driven ? ' driven' : '');
      const raw = c.value ?? '';
      const v = c.driven ? measureConstraint(c, d.entities) : tryEvaluate(raw, c.type === 'angle' ? 'angle' : 'length', ctx);
      let text = raw;
      if (v !== null) text = c.type === 'angle' ? `${formatNumber((v * 180) / Math.PI, 2)}°` : formatNumber(v / LENGTH_FACTOR[units.length], 3);
      if (c.type === 'diameter') text = 'Ø' + text;
      if (c.type === 'radius') text = 'R' + text;
      if (c.type === 'arclength') text = '⌒' + text;
      if (c.driven) {
        text = `(${text})`;
        el.title = t('Driven dimension: right-click to make it driving');
      }
      // Onshape marks dimensions driven by an expression with "fx" and shows the expression on hover
      const isExpr = !c.driven && /[#*/+()^]|[a-z]{3,}\(/i.test(raw.replace(/^\s*-/, '')) && !/^\s*-?[\d.]+\s*[a-z°]*\s*$/i.test(raw);
      if (isExpr) {
        const fx = document.createElement('span');
        fx.className = 'fx';
        fx.textContent = 'fx';
        el.appendChild(fx);
        // the other representation is shown on hover
        if (useEditor.getState().showExpressions) {
          el.title = text;
          text = (c.type === 'diameter' ? 'Ø' : c.type === 'radius' ? 'R' : c.type === 'arclength' ? '⌒' : '') + raw;
        } else el.title = raw;
      }
      el.appendChild(document.createTextNode(text));
      // dimension lines stop around the value (Onshape): never strike through the text
      const gap = this.labelGap(g.label, labelWidthPx(text, isExpr) + 8, 17, px);
      const segs: number[] = [];
      for (let i = 0; i + 3 < g.segs.length + 1; i += 4) {
        const a: Vec2 = [g.segs[i], g.segs[i + 1]];
        const b: Vec2 = [g.segs[i + 2], g.segs[i + 3]];
        for (const [p, q] of gap ? clipOutside(a, b, gap) : [[a, b]]) segs.push(p[0], p[1], 0, q[0], q[1], 0);
      }
      if (segs.length) {
        const l = fatSegments(segs, lineMaterial(color, 1, { depthTest: false }));
        l.renderOrder = 32;
        this.labels.add(l);
      }
      const tri: number[] = [];
      for (const a of g.arrows) tri.push(...arrowTriangle(a.tip, a.dir, 11 * px));
      if (tri.length) {
        const tg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
        const tm = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false }));
        tm.renderOrder = 32;
        this.labels.add(tm);
      }
      el.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        // a double-click types a new value
        if (this.isDoublePress(c.id, ev)) {
          ev.preventDefault();
          this.pressAgain(c.id);
          return;
        }
        const ed = useEditor.getState();
        const cur = ed.sketch?.selection ?? [];
        if (!cur.includes(c.id)) ed.setSketchSelection(ev.shiftKey ? [...cur, c.id] : [c.id]);
        this.startLabelDrag(c.id);
        // the label follows the mouse however fast it moves (the cursor may leave it), until the button is released
        const move = (e: PointerEvent) => {
          if (this.drag?.kind !== 'label' || !(e.buttons & 1)) return;
          const r = this.engine.container.getBoundingClientRect();
          this.updateDrag(this.toSketch(e.clientX - r.left, e.clientY - r.top));
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (this.drag?.kind === 'label') this.endDrag();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.dimensionMenu(c.id, ev.clientX, ev.clientY);
      });
      el.addEventListener('pointerenter', () => useEditor.getState().setSketchHover(c.id));
      el.addEventListener('pointerleave', () => useEditor.getState().setSketchHover(null));
      const o = new CSS2DObject(el);
      o.position.set(g.label[0], g.label[1], 0);
      this.labels.add(o);
    }
    this.renderGearSizes(d, map, px);
  }

  /**
   * The size of each gear as a diameter dimension: its outer or pitch diameter when that sets it (`fx` — an
   * expression, `#d`), else its pitch diameter in parentheses (grey: the module sets it). A click selects the gear,
   * a double-click puts the cursor in its size field of the sketch dialog.
   */
  private renderGearSizes(d: SketchData, map: EntityMap, px: number) {
    const s = useEditor.getState().sketch!;
    const units = useDoc.getState().doc!.units;
    const ctx = this.evalCtx();
    for (const gear of d.entities) {
      if (gear.type !== 'gear') continue;
      const size = gearSizeOf(gear, ctx);
      if ('error' in size) continue;
      const { r, ra } = gearCircles(size.size);
      const driving = gear.sizeBy !== 'module';
      // the module: the pitch diameter it gives (m · z), as a driven dimension
      const pitch = gear.sizeBy !== 'outerDiameter';
      const radius = pitch ? r : ra;
      // the circle it measures (not in the sketch): a stand-in about the gear's centre
      const circle = { id: `${gear.id}~size`, type: 'circle' as const, c: gear.c, r: radius };
      // its arrow where that circle is plain to see: on the tip of the tooth nearest to the upper right (the outer
      // diameter), in the middle of the gap next to it (the pitch circle, dash-dotted there)
      const step = (2 * Math.PI) / size.size.z;
      const toward = size.rotation + Math.round((Math.PI / 4 - size.rotation) / step) * step + (pitch ? step / 2 : 0);
      const c = pointOf(map, gear.c);
      const labelPos: Vec2 = [c[0] + (radius + 30 * px) * Math.cos(toward), c[1] + (radius + 30 * px) * Math.sin(toward)];
      const g = dimensionGeometry({ id: circle.id, type: 'diameter', refs: [circle.id], labelPos }, new Map(map).set(circle.id, circle), px);
      if (!g) continue;
      const sel = s.selection.includes(gear.id);
      const hov = s.hover === gear.id;
      const color = sel ? COLORS.selected : hov ? COLORS.hover : driving ? 0x1b1f23 : 0x9aa0a6;
      const value = `Ø${formatNumber((2 * radius) / LENGTH_FACTOR[units.length], 3)}`;
      const isExpr = driving && gear.size.includes('#');
      let text = driving ? value : `(${value})`;
      const el = document.createElement('div');
      el.className = 'dim-label' + (sel ? ' selected' : '') + (hov ? ' hover' : '') + (driving ? '' : ' driven');
      el.title = driving ? t(pitch ? 'Pitch diameter' : 'Outer diameter') : t('Pitch diameter: the module sets it');
      if (isExpr) {
        const fx = document.createElement('span');
        fx.className = 'fx';
        fx.textContent = 'fx';
        el.appendChild(fx);
        if (useEditor.getState().showExpressions) {
          el.title = text;
          text = `Ø${gear.size}`;
        } else el.title = gear.size;
      }
      el.appendChild(document.createTextNode(text));
      const gap = this.labelGap(g.label, labelWidthPx(text, isExpr) + 8, 17, px);
      const segs: number[] = [];
      for (let i = 0; i + 3 < g.segs.length + 1; i += 4) {
        const a: Vec2 = [g.segs[i], g.segs[i + 1]];
        const b: Vec2 = [g.segs[i + 2], g.segs[i + 3]];
        for (const [p, q] of gap ? clipOutside(a, b, gap) : [[a, b]]) segs.push(p[0], p[1], 0, q[0], q[1], 0);
      }
      if (segs.length) {
        const l = fatSegments(segs, lineMaterial(color, 1, { depthTest: false }));
        l.renderOrder = 32;
        this.labels.add(l);
      }
      const tri: number[] = [];
      for (const a of g.arrows) tri.push(...arrowTriangle(a.tip, a.dir, 11 * px));
      if (tri.length) {
        const tm = new THREE.Mesh(
          new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tri, 3)),
          new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false }),
        );
        tm.renderOrder = 32;
        this.labels.add(tm);
      }
      el.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        useEditor.getState().setSketchSelection([gear.id]);
        // a double-click: its size, typed in the dialog
        if (this.isDoublePress(circle.id, ev)) {
          ev.preventDefault();
          setTimeout(() => {
            const input = document.querySelector<HTMLInputElement>('.gear-props .gear-size input');
            input?.focus();
            input?.select();
          }, 0);
        }
      });
      el.addEventListener('pointerenter', () => useEditor.getState().setSketchHover(gear.id));
      el.addEventListener('pointerleave', () => useEditor.getState().setSketchHover(null));
      const o = new CSS2DObject(el);
      o.position.set(g.label[0], g.label[1], 0);
      this.labels.add(o);
    }
  }

  /** White constraint boxes with icons next to the geometry, linked by thin leaders. */
  private renderGlyphs(d: SketchData, map: EntityMap) {
    const s = useEditor.getState().sketch!;
    const showAll = useEditor.getState().showConstraints;
    // when hidden, still show the constraints of selected / hovered entities
    const focus = new Set([...s.selection, ...(s.hover ? [s.hover] : [])]);
    for (const id of [...focus]) {
      const e = map.get(id);
      if (e && e.type === 'point' && e.owner) focus.add(e.owner);
      if (e && e.type !== 'point') for (const q of d.entities) if (q.type === 'point' && q.owner === e.id) focus.add(q.id);
    }
    const perEntity = new Map<string, number>();
    const make = (key: ConstraintType | 'pattern', id: string, anchor: { p: Vec2; n: Vec2 }, slotKey: string, title: string, over: boolean) => {
      const slot = perEntity.get(slotKey) ?? 0;
      perEntity.set(slotKey, slot + 1);
      const el = document.createElement('div');
      el.className = 'glyph' + (s.selection.includes(id) ? ' selected' : '') + (over ? ' over' : '') + (s.hover === id ? ' hover' : '');
      const svg = CONSTRAINT_GLYPH_SVG[key];
      if (svg) el.innerHTML = svg;
      else el.textContent = GLYPH[key as ConstraintType] ?? '?';
      el.title = title;
      el.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        // a double-click on a pattern's glyph edits the pattern
        if (this.isDoublePress(`glyph:${id}`, ev) && key === 'pattern') {
          this.pressAgain(`glyph:${id}`);
          return;
        }
        const ed = useEditor.getState();
        const cur = ed.sketch?.selection ?? [];
        ed.setSketchSelection(cur.includes(id) ? cur.filter((x) => x !== id) : ev.shiftKey || ev.metaKey || ev.ctrlKey ? [...cur, id] : [id]);
      });
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (key === 'pattern') this.patternMenu(id, ev.clientX, ev.clientY);
      });
      el.addEventListener('pointerenter', () => useEditor.getState().setSketchHover(id));
      el.addEventListener('pointerleave', () => useEditor.getState().setSketchHover(null));
      const o = new CSS2DObject(el);
      this.labels.add(o);
      this.glyphs.push({ obj: o, anchor: anchor.p, dir: anchor.n, slot, leader: false });
    };
    for (const c of d.constraints) {
      if (!GLYPH[c.type]) continue;
      if (!showAll && !focus.has(c.id) && !c.refs.some((r) => focus.has(r))) continue;
      // point-point coincidences are implied by the geometry (shared vertices); Onshape hides them too
      if (c.type === 'coincident' && c.refs.every((r) => map.get(r)?.type === 'point')) continue;
      const pointRefs = c.refs.filter((r) => map.get(r)?.type === 'point');
      const anchorRefs =
        (c.type === 'coincident' || c.type === 'midpoint') && pointRefs.length
          ? pointRefs.slice(0, 1)
          : c.type === 'symmetric'
            ? pointRefs.length >= 2
              ? pointRefs
              : c.refs.slice(0, 2) // the two mirrored curves, not the axis
            : c.refs;
      for (const ref of anchorRefs) {
        const e = map.get(ref);
        if (!e) continue;
        const anchor = this.anchorOf(e, map);
        if (!anchor) continue;
        make(c.type, c.id, anchor, ref, t(c.type[0].toUpperCase() + c.type.slice(1)), !!s.solve?.conflicting.includes(c.id));
      }
    }
    // circular pattern copies inherit point-on-circle coincidences with circles around the centre
    const ctx = this.evalCtx();
    for (const p of d.patterns ?? []) {
      if (p.kind !== 'circular' || !showAll) continue;
      const center = patternCenter(p, map);
      const seedPts = new Set<string>();
      for (const id of p.seed) {
        seedPts.add(id);
        for (const q of d.entities) if (q.type === 'point' && q.owner === id) seedPts.add(q.id);
      }
      const inherited = d.constraints.filter((c) => {
        if (c.type !== 'coincident' || c.refs.length !== 2 || !seedPts.has(c.refs[0])) return false;
        const curve = map.get(c.refs[1]);
        if (!curve || (curve.type !== 'circle' && curve.type !== 'arc') || seedPts.has(curve.id)) return false;
        const cc = map.get(curve.c);
        return !!cc && cc.type === 'point' && Math.hypot(cc.x - center[0], cc.y - center[1]) < 1e-6 * (1 + Math.hypot(center[0], center[1]));
      });
      if (!inherited.length) continue;
      for (const inst of patternInstances(p, map, ctx)) {
        for (const c of inherited) {
          const pt = map.get(c.refs[0]);
          if (!pt || pt.type !== 'point') continue;
          const q = inst.xf([pt.x, pt.y]);
          const n: Vec2 = [q[0] - center[0], q[1] - center[1]];
          const L = Math.hypot(n[0], n[1]) || 1;
          make('coincident', c.id, { p: q, n: [n[0] / L, n[1] / L] }, `${c.id}@${inst.key}`, t('Coincident'), false);
        }
      }
    }
    // one pattern glyph next to each pattern's seed
    for (const p of d.patterns ?? []) {
      if (!showAll && !focus.has(p.id) && !p.seed.some((r) => focus.has(r)) && !this.selectedPatterns().includes(p.id)) continue;
      const c = seedCenter(p, map);
      make('pattern', p.id, { p: c, n: [0.7, -0.7] }, `pattern-${p.id}`, t(p.kind === 'linear' ? 'Sketch linear pattern' : 'Sketch circular pattern'), false);
    }
    this.lastLayoutPx = 0;
    this.layoutGlyphs();
  }

  private anchorOf(e: SkEntity, map: EntityMap): { p: Vec2; n: Vec2 } | null {
    try {
      switch (e.type) {
        case 'point':
          return { p: [e.x, e.y], n: [Math.SQRT1_2, Math.SQRT1_2] };
        case 'line': {
          const a = pointOf(map, e.p1);
          const b = pointOf(map, e.p2);
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          return { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n: [-(b[1] - a[1]) / L, (b[0] - a[0]) / L] };
        }
        case 'circle': {
          const c = pointOf(map, e.c);
          return { p: [c[0] + e.r * Math.SQRT1_2, c[1] + e.r * Math.SQRT1_2], n: [Math.SQRT1_2, Math.SQRT1_2] };
        }
        case 'arc': {
          const a = arcAngles(e, map);
          const m = (a.a0 + a.a1) / 2;
          return { p: [a.c[0] + a.r * Math.cos(m), a.c[1] + a.r * Math.sin(m)], n: [Math.cos(m), Math.sin(m)] };
        }
        case 'ellipse': {
          const c = pointOf(map, e.c);
          return { p: [c[0] + e.rx * Math.cos(e.rot), c[1] + e.rx * Math.sin(e.rot)], n: [Math.cos(e.rot), Math.sin(e.rot)] };
        }
        case 'spline': {
          const p = pointOf(map, e.pts[Math.floor(e.pts.length / 2)]);
          return { p, n: [0, 1] };
        }
        case 'text': {
          const a = pointOf(map, e.p1);
          const b = pointOf(map, e.p2);
          return { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n: [-1, 0] };
        }
        case 'gear':
          return { p: pointOf(map, e.c), n: [0, 1] };
      }
    } catch {
      return null;
    }
  }

  private lastLayoutPx = 0;
  private leaderObj: THREE.Object3D | null = null;

  /** Place glyphs at a constant screen offset from their anchors (recomputed on zoom). */
  private layoutGlyphs() {
    const px = this.px;
    if (Math.abs(px - this.lastLayoutPx) < 1e-12 * Math.max(px, 1)) return;
    this.lastLayoutPx = px;
    const segs: number[] = [];
    for (const g of this.glyphs) {
      const off = 14 * px;
      const along: Vec2 = [g.dir[1], -g.dir[0]];
      const step = 16 * px;
      const p: Vec2 = [g.anchor[0] + g.dir[0] * off + along[0] * g.slot * step, g.anchor[1] + g.dir[1] * off + along[1] * g.slot * step];
      g.obj.position.set(p[0], p[1], 0);
      if (g.leader) {
        // leader from the geometry to the near edge of the 16px box
        const dx = p[0] - g.anchor[0];
        const dy = p[1] - g.anchor[1];
        const L = Math.hypot(dx, dy) || 1;
        const end: Vec2 = [p[0] - (dx / L) * 9 * px, p[1] - (dy / L) * 9 * px];
        const start: Vec2 = [g.anchor[0] + (dx / L) * 3 * px, g.anchor[1] + (dy / L) * 3 * px];
        segs.push(start[0], start[1], 0, end[0], end[1], 0);
      }
    }
    if (this.leaderObj) {
      this.labels.remove(this.leaderObj);
      disposeObject(this.leaderObj);
      this.leaderObj = null;
    }
    if (segs.length) {
      const l = fatSegments(segs, lineMaterial(0x9aa4ae, 1, { depthTest: false }));
      l.renderOrder = 31;
      this.labels.add(l);
      this.leaderObj = l;
    }
  }

  /** Centre handle / direction arrows / count badges of the selected or edited pattern. */
  private renderPatternWidgets(d: SketchData, map: EntityMap, selectedPatterns: Set<string>) {
    const ctx = this.evalCtx();
    const seedMap = entityMap(d.entities);
    for (const p of d.patterns ?? []) {
      const prm = patternParams(p, seedMap, ctx);
      const sc = seedCenter(p, seedMap);
      if (!selectedPatterns.has(p.id)) {
        // Onshape keeps a small "N×" label next to the seed of every pattern
        const away: Vec2 = p.kind === 'circular' ? [sc[0] - patternCenter(p, seedMap)[0], sc[1] - patternCenter(p, seedMap)[1]] : [-Math.sin(prm.dir), Math.cos(prm.dir)];
        const L = Math.hypot(away[0], away[1]) || 1;
        const pos: Vec2 = [sc[0] + (away[0] / L) * 34 * this.px, sc[1] + (away[1] / L) * 34 * this.px];
        const el = document.createElement('div');
        el.className = 'pattern-count';
        el.textContent = `${p.kind === 'linear' && prm.count2 > 1 ? `${prm.count}×${prm.count2}` : prm.count}x`;
        el.title = t('Double-click to edit');
        el.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0) return;
          ev.stopPropagation();
          if (this.isDoublePress(`count:${p.id}`, ev)) this.pressAgain(`count:${p.id}`);
          else useEditor.getState().setSketchSelection([p.id]);
        });
        el.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.patternMenu(p.id, ev.clientX, ev.clientY);
        });
        const o = new CSS2DObject(el);
        o.position.set(pos[0], pos[1], 0);
        this.labels.add(o);
        const lead = fatSegments([pos[0] - (away[0] / L) * 8 * this.px, pos[1] - (away[1] / L) * 8 * this.px, 0, sc[0], sc[1], 0], lineMaterial(0x1b1f23, 1, { depthTest: false }));
        lead.renderOrder = 32;
        this.labels.add(lead);
        continue;
      }
      const badge = (pos: Vec2, text: string, onEdit: () => void) => {
        const el = document.createElement('div');
        el.className = 'pattern-badge';
        el.textContent = text;
        el.title = t('Double-click to edit');
        el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        el.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          onEdit();
        });
        const o = new CSS2DObject(el);
        o.position.set(pos[0], pos[1], 0);
        this.labels.add(o);
      };
      const askNumber = (label: string, current: string, apply: (v: string) => void) => {
        const v = window.prompt(t(label), current);
        if (v !== null && v.trim()) {
          if (!useEditor.getState().sketchPattern) this.editPattern(p.id);
          this.updatePattern({});
          apply(v.trim());
          this.applyPattern();
        }
      };
      if (p.kind === 'circular') {
        const c = patternCenter(p, seedMap);
        // dashed construction circle through the seed centre + centre handle
        const r = Math.hypot(sc[0] - c[0], sc[1] - c[1]);
        const pts: number[] = [];
        const n = 96;
        const sweep = prm.closed ? 2 * Math.PI : prm.angle;
        const a0 = Math.atan2(sc[1] - c[1], sc[0] - c[0]);
        for (let i = 0; i < n; i++) {
          const t0 = a0 + (sweep * i) / n;
          const t1 = a0 + (sweep * (i + 1)) / n;
          pts.push(c[0] + r * Math.cos(t0), c[1] + r * Math.sin(t0), 0, c[0] + r * Math.cos(t1), c[1] + r * Math.sin(t1), 0);
        }
        const m = lineMaterial(COLORS.patternHandle, 1, { dashed: true, depthTest: false });
        m.dashSize = 5 * this.px;
        m.gapSize = 4 * this.px;
        const l = fatSegments(pts, m);
        l.renderOrder = 33;
        this.labels.add(l);
        const handle = document.createElement('div');
        handle.className = 'pattern-center' + (p.centerRef ? ' attached' : '');
        handle.title = t('Drag to move the pattern center; drop on a point to attach');
        handle.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0) return;
          ev.stopPropagation();
          this.dragPatternCenter(p.id, ev);
        });
        const ho = new CSS2DObject(handle);
        ho.position.set(c[0], c[1], 0);
        this.labels.add(ho);
        badge([sc[0] + (sc[0] - c[0]) * 0.25, sc[1] + (sc[1] - c[1]) * 0.25], `${prm.count}×`, () =>
          askNumber('Instance count', p.count, (v) => this.updatePattern({ count: v })),
        );
        if (!prm.closed) {
          const ae = a0 + prm.angle;
          badge([c[0] + r * 1.15 * Math.cos(a0 + prm.angle / 2), c[1] + r * 1.15 * Math.sin(a0 + prm.angle / 2)], `${formatNumber((prm.angle * 180) / Math.PI, 2)}°`, () =>
            askNumber('Angle', p.angle ?? '90 deg', (v) => this.updatePattern({ angle: v })),
          );
          void ae;
        }
      } else {
        const d1: Vec2 = [Math.cos(prm.dir), Math.sin(prm.dir)];
        const tip: Vec2 = [sc[0] + d1[0] * prm.spacing, sc[1] + d1[1] * prm.spacing];
        const arrow = fatSegments([sc[0], sc[1], 0, tip[0], tip[1], 0], lineMaterial(COLORS.patternHandle, 1.5, { depthTest: false }));
        arrow.renderOrder = 33;
        this.labels.add(arrow);
        const tri = arrowTriangle(tip, d1, 12 * this.px);
        const tg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
        const tm = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: COLORS.patternHandle, side: THREE.DoubleSide, depthTest: false }));
        tm.renderOrder = 33;
        this.labels.add(tm);
        const handle = document.createElement('div');
        handle.className = 'pattern-arrow';
        handle.title = t('Drag to change the spacing and direction');
        handle.addEventListener('pointerdown', (ev) => {
          if (ev.button !== 0) return;
          ev.stopPropagation();
          this.dragPatternArrow(p.id, sc, ev);
        });
        const ho = new CSS2DObject(handle);
        ho.position.set(tip[0], tip[1], 0);
        this.labels.add(ho);
        const units = useDoc.getState().doc!.units.length;
        badge([(sc[0] + tip[0]) / 2 + -d1[1] * 14 * this.px, (sc[1] + tip[1]) / 2 + d1[0] * 14 * this.px], formatNumber(prm.spacing / LENGTH_FACTOR[units], 3), () =>
          askNumber('Distance', p.spacing ?? '', (v) => this.updatePattern({ spacing: v })),
        );
        badge([tip[0] + d1[0] * 22 * this.px, tip[1] + d1[1] * 22 * this.px], `${prm.count}×`, () =>
          askNumber('Instance count', p.count, (v) => this.updatePattern({ count: v })),
        );
      }
    }
    void map;
  }

  private dragPatternCenter(patternId: string, start: PointerEvent) {
    if (!useEditor.getState().sketchPattern) this.editPattern(patternId);
    const r = this.engine.container.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const hit = this.hitEntity(x, y);
      const e = hit && !isCopyId(hit.id) ? this.map().get(hit.id) : undefined;
      if (e && e.type === 'point') this.updatePattern({ centerRef: e.id, center: undefined });
      else this.updatePattern({ centerRef: undefined, center: this.toSketch(x, y) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    void start;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private dragPatternArrow(patternId: string, origin: Vec2, start: PointerEvent) {
    if (!useEditor.getState().sketchPattern) this.editPattern(patternId);
    const r = this.engine.container.getBoundingClientRect();
    const units = useDoc.getState().doc!.units.length;
    const move = (ev: PointerEvent) => {
      const p = this.toSketch(ev.clientX - r.left, ev.clientY - r.top);
      const dx = p[0] - origin[0];
      const dy = p[1] - origin[1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-9) return;
      // snap the direction to 15° steps like Onshape's manipulator
      let a = (Math.atan2(dy, dx) * 180) / Math.PI;
      a = Math.round(a / 15) * 15;
      const dist = L / LENGTH_FACTOR[units];
      const mag = Math.pow(10, Math.floor(Math.log10(dist)) - 1);
      this.updatePattern({ dirAngle: `${formatNumber(a, 2)} deg`, spacing: `${formatNumber(Math.round(dist / mag) * mag, 4)} ${units}` });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    void start;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  patternMenu(patternId: string, cx: number, cy: number) {
    useEditor.setState({
      contextMenu: {
        x: cx,
        y: cy,
        items: [
          { label: t('Edit pattern'), icon: 'edit', action: () => this.editPattern(patternId) },
          { separator: true, label: '' },
          { label: t('Delete pattern'), icon: 'trash', danger: true, action: () => this.deletePattern(patternId) },
        ],
      },
    });
  }

  deletePattern(patternId: string) {
    this.change((d) => deleteItems(d, [patternId]));
    useEditor.getState().setSketchSelection([]);
  }

  /** The context menu of a dimension: edit its value, make it driven / driving, delete it. */
  dimensionMenu(id: string, cx: number, cy: number) {
    const c = this.data()?.constraints.find((x) => x.id === id);
    if (!c) return;
    useEditor.setState({
      contextMenu: {
        x: cx,
        y: cy,
        items: [
          ...(c.driven ? [] : [{ label: t('Edit value'), icon: 'edit' as const, action: () => this.openDimInput(id, false) }]),
          { label: t(c.driven ? 'Change to driving dimension' : 'Change to driven dimension'), icon: 'dimension' as const, action: () => this.toggleDriven(id) },
          { separator: true, label: '' },
          { label: t('Delete'), icon: 'trash' as const, danger: true, action: () => this.change((d) => deleteItems(d, [id])) },
        ],
      },
    });
  }

  /**
   * A driving dimension becomes driven (it no longer holds the geometry), a driven one driving — with the value the
   * geometry has now, unless that over-defines the sketch.
   */
  toggleDriven(id: string) {
    const cur = this.data();
    const c = cur?.constraints.find((x) => x.id === id);
    if (!cur || !c) return;
    if (!c.driven) {
      this.change((d) => {
        const k = d.constraints.find((x) => x.id === id);
        if (k) k.driven = true;
      });
      return;
    }
    const value = measureConstraint(c, cur.entities);
    const units = useDoc.getState().doc!.units;
    const text = c.type === 'angle' ? `${formatNumber((value * 180) / Math.PI, 3)} deg` : `${formatNumber(value / LENGTH_FACTOR[units.length], 4)} ${units.length}`;
    this.change(
      (d) => {
        const k = d.constraints.find((x) => x.id === id);
        if (!k) return;
        delete k.driven;
        k.value = text;
      },
      { checkConflict: true },
    );
  }

  /** Live size labels while drawing (Onshape shows the current length / width / diameter). */
  private live: HTMLDivElement | null = null;

  private toScreen(p: Vec2): { x: number; y: number } {
    const v = new THREE.Vector3(p[0], p[1], 0).applyMatrix4(this.root.matrix).project(this.engine.cam.camera);
    const r = this.engine.container.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
  }

  private showLive(items: { text: string; x: number; y: number }[]) {
    if (!items.length) {
      this.live?.remove();
      this.live = null;
      return;
    }
    if (!this.live) {
      this.live = document.createElement('div');
      this.live.className = 'live-dims';
      this.engine.container.appendChild(this.live);
    }
    while (this.live.children.length < items.length) this.live.appendChild(document.createElement('span'));
    while (this.live.children.length > items.length) this.live.lastChild!.remove();
    items.forEach((it, i) => {
      const el = this.live!.children[i] as HTMLSpanElement;
      el.textContent = it.text;
      el.style.left = `${it.x}px`;
      el.style.top = `${it.y}px`;
    });
  }

  /** Labels for the shape being drawn from `a` (start / corner / centre) to the cursor `c`. */
  private liveLabels(c: Vec2): { text: string; x: number; y: number }[] {
    const st = this.tool;
    const k = LENGTH_FACTOR[useDoc.getState().doc!.units.length];
    const fmt = (v: number) => formatNumber(v / k, 2);
    if (st.k === 'line') {
      const a = this.toScreen(st.start.pos);
      const b = this.toScreen(c);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 20) return [];
      let nx = -(b.y - a.y) / L;
      let ny = (b.x - a.x) / L;
      if (ny > 0) [nx, ny] = [-nx, -ny]; // above the line
      const len = Math.hypot(c[0] - st.start.pos[0], c[1] - st.start.pos[1]);
      return [{ text: fmt(len), x: (a.x + b.x) / 2 + nx * 14, y: (a.y + b.y) / 2 + ny * 14 }];
    }
    if (st.k === 'rect') {
      const a = st.a.pos;
      const o: Vec2 = this.toolName === 'rectCenter' ? [2 * a[0] - c[0], 2 * a[1] - c[1]] : a;
      const corners = [o, [c[0], o[1]] as Vec2, c, [o[0], c[1]] as Vec2].map((p) => this.toScreen(p));
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      if (x1 - x0 < 20 && y1 - y0 < 20) return [];
      return [
        { text: fmt(Math.abs(c[0] - o[0])), x: (x0 + x1) / 2, y: y0 - 12 },
        { text: fmt(Math.abs(c[1] - o[1])), x: x1 + 22, y: (y0 + y1) / 2 },
      ];
    }
    if (st.k === 'circle') {
      const r = Math.hypot(c[0] - st.c.pos[0], c[1] - st.c.pos[1]);
      const s = this.toScreen(c);
      if (r < 1e-9) return [];
      return [{ text: `Ø${fmt(2 * r)}`, x: s.x + 22, y: s.y - 14 }];
    }
    return [];
  }

  /** The parameters of a new gear: as the sketch's last gear has them (a second one meshes with the first), else the defaults. */
  private gearParams(): GearParamsOf {
    const last = [...(this.data()?.entities ?? [])].reverse().find((e) => e.type === 'gear');
    return last && last.type === 'gear' ? { teeth: last.teeth, sizeBy: last.sizeBy, size: last.size, pressureAngle: last.pressureAngle, rotation: last.rotation } : DEFAULT_GEAR;
  }

  private updatePreview() {
    this.clear(this.preview);
    this.showLive(this.active && this.tool.k !== 'idle' ? this.liveLabels(this.snap?.pos ?? this.cursor) : []);
    if (!this.active) return;
    const c = this.snap?.pos ?? this.cursor;
    const segs: number[] = [];
    const seg = (a: Vec2, b: Vec2) => segs.push(a[0], a[1], 0, b[0], b[1], 0);
    const poly = (pts: Vec2[]) => {
      for (let i = 0; i + 1 < pts.length; i++) seg(pts[i], pts[i + 1]);
    };
    const circlePts = (ctr: Vec2, r: number, a0 = 0, a1 = Math.PI * 2) => {
      const n = 72;
      const out: Vec2[] = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        out.push([ctr[0] + r * Math.cos(a), ctr[1] + r * Math.sin(a)]);
      }
      return out;
    };
    const st = this.tool;
    // the gear tool: the gear as it will be placed, at the cursor
    if (this.toolName === 'gear') for (const pl of gearOutline(this.gearParams(), c, this.evalCtx())) poly(pl);
    switch (st.k) {
      case 'line':
        seg(st.start.pos, c);
        break;
      case 'rect': {
        const a = st.a.pos;
        if (this.toolName === 'rectCenter') {
          const o: Vec2 = [2 * a[0] - c[0], 2 * a[1] - c[1]];
          poly([o, [c[0], o[1]], c, [o[0], c[1]], o]);
        } else poly([a, [c[0], a[1]], c, [a[0], c[1]], a]);
        break;
      }
      case 'circle':
        poly(circlePts(st.c.pos, Math.hypot(c[0] - st.c.pos[0], c[1] - st.c.pos[1])));
        break;
      case 'tarc': {
        const g = tangentArcGeometry(st.start, st.tangent, c);
        if (g) {
          const a0 = Math.atan2(st.start[1] - g.c[1], st.start[0] - g.c[0]);
          let a1 = Math.atan2(c[1] - g.c[1], c[0] - g.c[0]);
          if (g.ccw) while (a1 < a0) a1 += Math.PI * 2;
          else while (a1 > a0) a1 -= Math.PI * 2;
          poly(circlePts(g.c, g.r, a0, a1));
        }
        break;
      }
      case 'polySides':
        poly(polygonOutline(st.c.pos, st.v, this.polySides, this.toolName === 'polygonInscribed'));
        break;
      case 'multi': {
        const P = [...st.pts.map((p) => p.pos), c];
        switch (this.toolName) {
          case 'text': {
            // the box up (or down) to the cursor, with the letters of the default text
            const h = Math.abs(P[1][1] - P[0][1]);
            if (h > 1e-9) for (const pl of textOutline(t('Text'), 'sans', [P[0][0], Math.min(P[0][1], P[1][1])], h)) poly(pl);
            else seg(P[0], P[1]);
            break;
          }
          case 'circle3pt':
          case 'arc3pt':
            if (P.length === 2) seg(P[0], P[1]);
            else {
              const cc = circumcircle(P[0], P[1], P[2]);
              if (cc) {
                if (this.toolName === 'circle3pt') poly(circlePts(cc.c, cc.r));
                else {
                  const ccw = onCcwArc(cc.c, P[0], P[1], P[2]);
                  const [s0, s1] = ccw ? [P[0], P[1]] : [P[1], P[0]];
                  const a0 = Math.atan2(s0[1] - cc.c[1], s0[0] - cc.c[0]);
                  let a1 = Math.atan2(s1[1] - cc.c[1], s1[0] - cc.c[0]);
                  while (a1 < a0) a1 += Math.PI * 2;
                  poly(circlePts(cc.c, cc.r, a0, a1));
                }
              }
            }
            break;
          case 'arcCenter':
            if (P.length === 2) poly(circlePts(P[0], Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1])));
            else {
              const r = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
              const a0 = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]);
              let a1 = Math.atan2(P[2][1] - P[0][1], P[2][0] - P[0][0]);
              while (a1 < a0) a1 += Math.PI * 2;
              poly(circlePts(P[0], r, a0, a1));
            }
            break;
          case 'slot':
            if (P.length === 2) seg(P[0], P[1]);
            else {
              const ax: Vec2 = [P[1][0] - P[0][0], P[1][1] - P[0][1]];
              const L = Math.hypot(ax[0], ax[1]) || 1;
              const n: Vec2 = [-ax[1] / L, ax[0] / L];
              const r = Math.abs((P[2][0] - P[0][0]) * n[0] + (P[2][1] - P[0][1]) * n[1]);
              const an = Math.atan2(n[1], n[0]);
              poly(circlePts(P[0], r, an, an + Math.PI));
              poly(circlePts(P[1], r, an + Math.PI, an + 2 * Math.PI));
              seg([P[0][0] - n[0] * r, P[0][1] - n[1] * r], [P[1][0] - n[0] * r, P[1][1] - n[1] * r]);
              seg([P[0][0] + n[0] * r, P[0][1] + n[1] * r], [P[1][0] + n[0] * r, P[1][1] + n[1] * r]);
            }
            break;
          case 'polygon':
          case 'polygonInscribed':
            poly(polygonOutline(P[0], P[1], this.polySides, this.toolName === 'polygonInscribed'));
            break;
          case 'ellipse': {
            const rx = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
            const rot = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]);
            const ry = P.length > 2 ? Math.abs((P[2][0] - P[0][0]) * -Math.sin(rot) + (P[2][1] - P[0][1]) * Math.cos(rot)) : rx / 2;
            const pts: Vec2[] = [];
            for (let i = 0; i <= 72; i++) {
              const a = (i / 72) * Math.PI * 2;
              const x = rx * Math.cos(a);
              const y = ry * Math.sin(a);
              pts.push([P[0][0] + x * Math.cos(rot) - y * Math.sin(rot), P[0][1] + x * Math.sin(rot) + y * Math.cos(rot)]);
            }
            poly(pts);
            break;
          }
          case 'spline':
            poly(P);
            break;
          case 'bezier':
            // the control polygon, and the curve once all four points are there
            poly(P);
            if (P.length === 4) poly(sampleSpline([P[0], P[3]], false, 48, { h0: P[1], h1: P[2] }));
            break;
          case 'conic':
            // start → end, then the apex of the tangents (a parabola first), then ρ from the cursor
            if (P.length === 2) seg(P[0], P[1]);
            else {
              const rho = P.length > 3 ? conicRho(P[0], P[1], P[2], P[3]) : 0.5;
              const [c1, c2] = conicControls(P[0], P[1], P[2], rho);
              poly(sampleSpline([P[0], P[1]], false, 48, { h0: c1, h1: c2 }));
              poly([P[0], P[2], P[1]]);
            }
            break;
        }
        break;
      }
      case 'dim': {
        const cst = this.dimensionFor(st.refs, c, st.toCurve);
        if (cst) {
          const g = dimensionGeometry(cst, this.map(), this.px);
          if (g) for (let i = 0; i + 3 < g.segs.length + 1; i += 4) seg([g.segs[i], g.segs[i + 1]], [g.segs[i + 2], g.segs[i + 3]]);
        }
        break;
      }
      case 'offset': {
        const chains = offsetChains(this.map(), st.ids);
        const off = computeOffset(chains, offsetDistanceAt(chains, c));
        if (off) for (const pl of chainPolylines(off)) poly(pl);
        break;
      }
    }
    if (this.toolName === 'extend') {
      const hov = useEditor.getState().sketch?.hover;
      const d = this.data();
      const tg = hov && d && !isCopyId(hov) ? extendTarget(d, hov, this.cursor) : null;
      if (tg?.arc) {
        const { c: ac, r, ccw } = tg.arc;
        const a0 = Math.atan2(tg.from[1] - ac[1], tg.from[0] - ac[0]);
        let a1 = Math.atan2(tg.to[1] - ac[1], tg.to[0] - ac[0]);
        if (ccw) while (a1 < a0) a1 += Math.PI * 2;
        else while (a1 > a0) a1 -= Math.PI * 2;
        poly(circlePts(ac, r, a0, a1));
      } else if (tg) seg(tg.from, tg.to);
    }
    // a transform being set up: where its entities go (standalone points as dots)
    const xfm = useEditor.getState().sketchTransform ? this.transformMotion() : null;
    if (xfm) {
      const map = this.map();
      const dots: Vec2[] = [];
      for (const id of useEditor.getState().sketchTransform!.ids) {
        const e = map.get(id);
        if (!e) continue;
        if (e.type === 'point') dots.push(xfm.xf([e.x, e.y]));
        else poly(sampleEntity(e, map).map(xfm.xf));
      }
      if (dots.length) {
        const o = pointsObject(dots, COLORS.hover, 7, false);
        o.renderOrder = 34;
        this.preview.add(o);
      }
    }
    if (segs.length) {
      // drawn exactly as the result will look (construction: the same dash-dot)
      if (this.construction() && st.k !== 'dim') this.addCurveGroup(segs, COLORS.constructionDark, 1.8, true, this.px, this.preview, 33);
      else {
        const l = fatSegments(segs, lineMaterial(COLORS.under, 2, { depthTest: false }));
        l.renderOrder = 33;
        this.preview.add(l);
      }
    }
    if (this.snap && this.snap.kind !== 'none') {
      const o = pointsObject([this.snap.pos], COLORS.hover, 9, false);
      o.renderOrder = 34;
      this.preview.add(o);
    }
    // inference: acquired points get a halo, alignment shows dotted guides (Onshape style)
    if (DRAW_TOOLS.has(this.toolName)) {
      const map = this.map();
      const halo: Vec2[] = [];
      // (points and circles' quarter points)
      for (const id of this.acquired) {
        const at = this.acquiredPoint(id);
        if (at) halo.push(at);
      }
      if (halo.length) {
        const o = pointsObject(halo, COLORS.inference, 15, false);
        o.renderOrder = 33;
        this.preview.add(o);
      }
      // acquired lines: drawn over in the inference colour
      const lines: number[] = [];
      for (const id of this.acquiredLines()) {
        const e = map.get(id);
        if (e?.type !== 'line') continue;
        const a = pointOf(map, e.p1);
        const b = pointOf(map, e.p2);
        lines.push(a[0], a[1], 0, b[0], b[1], 0);
      }
      if (lines.length) {
        const l = fatSegments(lines, lineMaterial(COLORS.inference, 2.5, { depthTest: false }));
        l.renderOrder = 32;
        this.preview.add(l);
      }
      const s = this.snap;
      const guides: number[] = [];
      // (a point on a curve level with / straight above an acquired point too)
      if (s?.kind === 'align' || s?.kind === 'curve') {
        for (const id of [s.h, s.v]) {
          const at = id ? this.acquiredPoint(id) : null;
          if (at) guides.push(at[0], at[1], 0, s.pos[0], s.pos[1], 0);
        }
      }
      // the extension of a line: from its nearer end to the point
      if (s?.kind === 'extension') {
        const e = map.get(s.id);
        if (e?.type === 'line') {
          const a = pointOf(map, e.p1);
          const b = pointOf(map, e.p2);
          const end = Math.hypot(a[0] - s.pos[0], a[1] - s.pos[1]) < Math.hypot(b[0] - s.pos[0], b[1] - s.pos[1]) ? a : b;
          guides.push(end[0], end[1], 0, s.pos[0], s.pos[1], 0);
        }
      }
      // the inferred direction of the line being drawn: on past the cursor
      const anchor = this.anchorPoint();
      if (this.dirSnap && anchor && s) {
        const d = this.dirSnap.dir;
        const t = (s.pos[0] - anchor[0]) * d[0] + (s.pos[1] - anchor[1]) * d[1];
        const k = t + Math.sign(t) * 40 * this.px;
        guides.push(anchor[0], anchor[1], 0, anchor[0] + d[0] * k, anchor[1] + d[1] * k, 0);
      }
      if (guides.length) {
        const m = lineMaterial(COLORS.inference, 1.5, { dashed: true, depthTest: false });
        m.dashSize = 3 * this.px;
        m.gapSize = 3 * this.px;
        const l = fatSegments(guides, m);
        l.renderOrder = 33;
        this.preview.add(l);
      }
    }
    this.engine.requestRender();
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Rendered width (px) of a dimension label, matching the .dim-label CSS. */
function labelWidthPx(text: string, fx: boolean): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 8;
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  measureCtx.font = `500 13px ${family}`;
  let w = measureCtx.measureText(text).width + 4;
  if (fx) {
    measureCtx.font = 'italic 12px Georgia, serif';
    w += measureCtx.measureText('fx').width + 3;
  }
  return w;
}

/** Parts of segment ab outside the convex polygon (Cyrus–Beck). */
function clipOutside(a: Vec2, b: Vec2, poly: Vec2[]): [Vec2, Vec2][] {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const s = area >= 0 ? 1 : -1;
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    // outward normal of edge p→q
    const n: Vec2 = [s * (q[1] - p[1]), -s * (q[0] - p[0])];
    const num = n[0] * (p[0] - a[0]) + n[1] * (p[1] - a[1]);
    const den = n[0] * d[0] + n[1] * d[1];
    if (Math.abs(den) < 1e-15) {
      if (num < 0) return [[a, b]];
      continue;
    }
    const t = num / den;
    if (den > 0) t1 = Math.min(t1, t);
    else t0 = Math.max(t0, t);
    if (t0 >= t1) return [[a, b]];
  }
  const P = (t: number): Vec2 => [a[0] + d[0] * t, a[1] + d[1] * t];
  const out: [Vec2, Vec2][] = [];
  if (t0 > 1e-9) out.push([a, P(t0)]);
  if (t1 < 1 - 1e-9) out.push([P(t1), b]);
  return out;
}

/** Arc starting at s with tangent t passing through e. */
export function tangentArcGeometry(s: Vec2, t: Vec2, e: Vec2): { c: Vec2; r: number; ccw: boolean } | null {
  const n: Vec2 = [-t[1], t[0]];
  const d: Vec2 = [s[0] - e[0], s[1] - e[1]];
  const den = 2 * (n[0] * d[0] + n[1] * d[1]);
  if (Math.abs(den) < 1e-12) return null;
  const r = -(d[0] * d[0] + d[1] * d[1]) / den;
  const c: Vec2 = [s[0] + n[0] * r, s[1] + n[1] * r];
  return { c, r: Math.abs(r), ccw: r > 0 };
}

/** Does segment ab cross the axis-aligned rectangle? */
function segRect(a: Vec2, b: Vec2, x0: number, y0: number, x1: number, y1: number): boolean {
  const edges: [Vec2, Vec2][] = [
    [[x0, y0], [x1, y0]],
    [[x1, y0], [x1, y1]],
    [[x1, y1], [x0, y1]],
    [[x0, y1], [x0, y0]],
  ];
  const cr = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return edges.some(([c, d]) => cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0);
}
