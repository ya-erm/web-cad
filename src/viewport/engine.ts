// The graphics area: renders parts, sketches, planes and previews from the latest build,
// handles navigation, hover/selection picking and forwards sketch editing to SketchEditor.

import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Draft } from 'immer';
import type { MateConnectorRef, MateInference, PlaneFrame, SelRef, SkEntity, Vec3 } from '../core/types';
import { STD_PLANES, frameFromNormal, toWorld, v3 } from '../core/math';
import { adaptRef, FIELD_SPECS, type SelToken } from '../core/fieldSpecs';
import { computeRegions, type SketchRegion } from '../sketch/regions';
import { arcAngles, entityMap, pointOf } from '../sketch/curves';
import { isTextBox, isTextPart } from '../sketch/text';
import { edgeGeometry, type WorldGeom } from '../sketch/useGeometry';
import type { BuildResult, PartMesh, SketchResult, ThreadResult } from '../kernel/protocol';
import { edgeSig, faceSig, vertexSig } from '../kernel/sigs';
import { useEditor, refKey, sameRef, type EditorState } from '../store/editorStore';
import { activeAssembly, activeStudio, activeTab, useDoc } from '../store/docStore';
import { assemblyDragEnd, assemblyDragMove, assemblyDragStart, dragInstance } from '../assembly/drag';
import { mateDialogOpen, selectedInstances, selectedUnits } from '../assembly/AssemblyUI';
import { angleAbout, closestOnAxis, placedTriad, rayPlane, TRIAD, TRIAD_AXES, triadStep, wrapAngle, type TriadFrame, type TriadHandle } from '../assembly/triad';
import { useDragPreview } from '../assembly/drag';
import { animationOpen } from '../assembly/AnimateUI';
import { explodeActive } from '../assembly/explode';
import { findInstance, topInstance } from '../assembly/expand';
import { explodeCommit, explodePreview } from '../assembly/BomExplodeUI';

/** Instances are not dragged and have no triad while the mate dialog, an animation or an exploded view is open. */
const assemblyHandsOff = () => mateDialogOpen() || animationOpen() || explodeActive();
import { parseInstanceConnector, placementOf } from '../assembly/compose';
import { connectorFrame } from '../assembly/mates';
import { useAssembly } from '../assembly/sources';
import { makeEvalContext } from '../core/features';
import { tryEvaluate } from '../core/expr';
import { CameraController, stdViewAxes } from './camera';
import { ViewCube } from './viewcube';
import { bestHit, constantIds, makePickMaterial, Picker, PickRegistry } from './picking';
import {
  COLORS,
  disposeObject,
  entityPolyline,
  facePlaneLabel,
  fatSegments,
  frameMatrix,
  lineMaterial,
  planeLabel,
  pointsObject,
  polylineSegments,
  regionGeometry,
  setLineResolution,
} from './sketchRender';
import { SketchEditor } from './sketchEditor';
import { t, tName } from '../i18n';

export type PickItem = { priority: number; radius?: number } & (
  | { t: 'face'; partId: string; index: number }
  | { t: 'edge'; partId: string; index: number }
  | { t: 'vertex'; partId: string; index: number }
  | { t: 'region'; sketchId: string; region: SketchRegion }
  | { t: 'skEnt'; sketchId: string; entityId: string; entType: string }
  | { t: 'plane'; planeId: string }
  | { t: 'mate'; featureId: string }
  | { t: 'origin' }
  | { t: 'edit'; id: string; entType: string }
  | { t: 'editRegion'; region: SketchRegion }
);

interface PartObj {
  data: PartMesh;
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  edges: THREE.LineSegments;
  faceBase: number;
  edgeBase: number;
  vertexBase: number;
  pickMats: THREE.Material[];
  /** Section view cap (back faces seen through the cut). */
  cap?: THREE.Mesh;
}

/** A part mesh's geometry kept by the graphics (see Engine.partGeos). */
interface PartGeo {
  key: string;
  geo: THREE.BufferGeometry;
  /** Edge segments; the vertices (picking). */
  eg: THREE.BufferGeometry;
  vg: THREE.BufferGeometry;
  /** Each vertex's face, each segment end's edge: their pick ids are numbered from the bases. */
  faceOf: Int32Array;
  edgeOf: Int32Array;
  faceBase: number;
  edgeBase: number;
  vertexBase: number;
  /** Shown by the scene being made. */
  used: boolean;
}

function disposePartGeo(c: PartGeo) {
  c.geo.dispose();
  c.eg.dispose();
  c.vg.dispose();
}

/** Entity id of a whole curve feature (helix) referenced as { kind: 'sketchEntity', sketchId: featureId }. */
const CURVE_ENTITY = 'curve';

const PRIORITY = { vertex: 60, editPoint: 58, skPoint: 55, edge: 40, editCurve: 38, skCurve: 36, region: 25, face: 20, editRegion: 15, planeEdge: 12, plane: 5, origin: 59 };

/** Last camera of each part studio (also mirrored to sessionStorage). */
const savedViews = new Map<string, import('./camera').CameraView>();

/** Frames of sketches seen in any build, so an edited sketch keeps its plane. */
const sketchFrames = new Map<string, PlaneFrame>();

/** A possible mate connector location (inference point). */
type MateCandidate = { pos: Vec3; loc: SelRef; inference: MateInference; orient?: SelRef };

/** Position / orient an object on a frame (scale is set per render for constant screen size). */
function placeTriad(o: THREE.Object3D, frame: PlaneFrame) {
  o.position.set(...frame.origin);
  o.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(...frame.xDir), new THREE.Vector3(...frame.yDir), new THREE.Vector3(...frame.normal)),
  );
}

/** Mate connector glyph (Onshape): X red, Y green, Z blue axes and a ring in the XY plane; one colour when highlighted. */
function mateTriad(frame: PlaneFrame, highlight?: number): THREE.Group {
  const g = new THREE.Group();
  placeTriad(g, frame);
  g.userData.triad = true;
  const axes: [number[], number][] = [
    [[0, 0, 0, 1, 0, 0], 0xd64545],
    [[0, 0, 0, 0, 1, 0], 0x3aa655],
    [[0, 0, 0, 0, 0, 1.2], 0x2f80d1],
  ];
  for (const [pts, c] of axes) {
    const l = fatSegments(pts, lineMaterial(highlight ?? c, highlight ? 3.2 : 2.2, { depthTest: false }));
    l.renderOrder = 26;
    g.add(l);
  }
  const ring: number[] = [];
  const n = 32;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    ring.push(0.32 * Math.cos(a0), 0.32 * Math.sin(a0), 0, 0.32 * Math.cos(a1), 0.32 * Math.sin(a1), 0);
  }
  const r = fatSegments(ring, lineMaterial(highlight ?? 0x2b3138, highlight ? 2.6 : 1.6, { depthTest: false }));
  r.renderOrder = 26;
  const dot = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
    new THREE.PointsMaterial({ color: highlight ?? 0x2b3138, size: 6, sizeAttenuation: false, depthTest: false }),
  );
  dot.renderOrder = 27;
  g.add(r, dot);
  return g;
}

/**
 * Cosmetic threads: thin circles of the major diameter where each thread starts (just above the face) and ends, and
 * four lines along it — inside the material, so seen in a section or through a transparent part.
 */
function threadObject(threads: ThreadResult[]): THREE.Object3D {
  const segs: number[] = [];
  for (const t of threads) {
    const r = t.major / 2;
    const e1 = frameFromNormal(t.origin, t.dir).xDir;
    const e2 = v3.cross(t.dir, e1);
    const at = (s: number, a: number) => v3.add(v3.add(t.origin, v3.scale(t.dir, s)), v3.add(v3.scale(e1, r * Math.cos(a)), v3.scale(e2, r * Math.sin(a))));
    const lift = -Math.min(0.02, t.length * 0.01);
    for (const s of [lift, t.length])
      for (let i = 0; i < 48; i++) segs.push(...at(s, (i / 48) * 2 * Math.PI), ...at(s, ((i + 1) / 48) * 2 * Math.PI));
    for (let k = 0; k < 4; k++) segs.push(...at(0, (k * Math.PI) / 2), ...at(t.length, (k * Math.PI) / 2));
  }
  const obj = fatSegments(segs, lineMaterial(COLORS.partEdge, 1));
  obj.renderOrder = 3;
  return obj;
}

const TRIAD_COLORS = [0xd64545, 0x3aa655, 0x2f80d1];
/** Comparing with a version: the faces new or changed since, the version's faces gone (as the legend shows them). */
export const COMPARE_COLORS = { changed: 0x2fb84f, removed: 0xe0453a };
const TRIAD_ACTIVE = 0xf29d38;
/** Screen length of the triad manipulator's arrows, px. */
const TRIAD_PX = 90;
const handleKey = (h: TriadHandle) => (h.kind === 'center' ? 'center' : `${h.kind}${h.axis}`);
/** A grabbed triad handle: `t0` — where on the arrow's axis the drag started, `prev` / `angle` — the turn so far. */
type TriadGrab = { handle: TriadHandle; id: string; frame: TriadFrame; started: boolean; t0?: number; prev?: Vec3; angle: number; explode?: string[] };

/**
 * Triad manipulator of an assembly instance (Onshape): arrows along X / Y / Z, quarter arcs about them and
 * a centre ball; invisible fatter shapes carry the handles for picking. `active` is the hovered / dragged one.
 */
function moveTriadObject(active: string | null): THREE.Group {
  const g = new THREE.Group();
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const up = new THREE.Vector3(0, 1, 0);
  const color = (key: string, c: number) => (active === key ? TRIAD_ACTIVE : c);
  for (const i of [0, 1, 2] as const) {
    const k = new THREE.Vector3(...TRIAD_AXES[i]);
    const u = new THREE.Vector3(...TRIAD_AXES[(i + 1) % 3]);
    const v = new THREE.Vector3(...TRIAD_AXES[(i + 2) % 3]);
    // arrow: shaft and cone head
    const ac = color(`arrow${i}`, TRIAD_COLORS[i]);
    const shaft = fatSegments([...k.clone().multiplyScalar(TRIAD.arrowFrom).toArray(), ...k.clone().multiplyScalar(TRIAD.arrowTo).toArray()], lineMaterial(ac, 3, { depthTest: false }));
    shaft.renderOrder = 30;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.22, 16), new THREE.MeshBasicMaterial({ color: ac, depthTest: false }));
    head.position.copy(k).multiplyScalar(TRIAD.arrowTo + 0.1);
    head.quaternion.setFromUnitVectors(up, k);
    head.renderOrder = 31;
    const arrowLen = TRIAD.arrowTo + 0.22 - TRIAD.arrowFrom;
    const arrowHit = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, arrowLen, 8), hidden);
    arrowHit.position.copy(k).multiplyScalar(TRIAD.arrowFrom + arrowLen / 2);
    arrowHit.quaternion.setFromUnitVectors(up, k);
    arrowHit.userData.handle = { kind: 'arrow', axis: i } satisfies TriadHandle;
    // quarter arc about the axis, between the two other axes
    const arc: number[] = [];
    const pt = (a: number) => u.clone().multiplyScalar(Math.cos(a) * TRIAD.ring).addScaledVector(v, Math.sin(a) * TRIAD.ring).toArray();
    const n = 16;
    for (let j = 0; j < n; j++) arc.push(...pt(((j / n) * Math.PI) / 2), ...pt((((j + 1) / n) * Math.PI) / 2));
    const ring = fatSegments(arc, lineMaterial(color(`ring${i}`, TRIAD_COLORS[i]), 3, { depthTest: false }));
    ring.renderOrder = 30;
    const ringHit = new THREE.Mesh(new THREE.TorusGeometry(TRIAD.ring, 0.09, 6, 24, Math.PI / 2), hidden);
    ringHit.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, k));
    ringHit.userData.handle = { kind: 'ring', axis: i } satisfies TriadHandle;
    g.add(shaft, head, arrowHit, ring, ringHit);
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(TRIAD.ball, 16, 12), new THREE.MeshBasicMaterial({ color: color('center', 0x5b6570), depthTest: false }));
  ball.renderOrder = 31;
  const ballHit = new THREE.Mesh(new THREE.SphereGeometry(TRIAD.ball * 1.8, 8, 6), hidden);
  ballHit.userData.handle = { kind: 'center' } satisfies TriadHandle;
  g.add(ball, ballHit);
  // drawn in the transparent pass, after the see-through selection highlight that would tint it otherwise
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m?.visible) {
      m.transparent = true;
      m.depthWrite = false;
    }
  });
  return g;
}

/** The centre of gravity symbol (ISO 7000-ish): a circle with opposite quarters black, on a white halo. */
function massCenterSymbol(): HTMLCanvasElement {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const m = s / 2;
  const r = s / 2 - 6;
  g.beginPath();
  g.arc(m, m, r + 3, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fill();
  g.beginPath();
  g.arc(m, m, r, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  g.fillStyle = '#1d2329';
  for (const a of [0, Math.PI]) {
    g.beginPath();
    g.moveTo(m, m);
    g.arc(m, m, r, a - Math.PI / 2, a);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.arc(m, m, r, 0, Math.PI * 2);
  g.lineWidth = 4;
  g.strokeStyle = '#1d2329';
  g.stroke();
  return c;
}

/** Orbit cursor: circular arrow (white halo for contrast), falls back to "move". */
const ROTATE_CURSOR = (() => {
  const arc = 'M19 9.5A7.5 7.5 0 1 0 19.5 14';
  const head = 'M15.5 9.5H19.5V5.5';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${arc}" stroke="white" stroke-width="4"/><path d="${head}" stroke="white" stroke-width="4"/>` +
    `<path d="${arc}" stroke="black" stroke-width="1.8"/><path d="${head}" stroke="black" stroke-width="1.8"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, move`;
})();

export class Engine {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly cam = new CameraController();
  readonly scene = new THREE.Scene();
  readonly pickScene = new THREE.Scene();
  readonly registry = new PickRegistry<PickItem>();
  private picker = new Picker(7);
  readonly viewCube: ViewCube;
  private width = 1;
  private height = 1;
  private needsRender = true;
  private raf = 0;
  private disposed = false;
  private unsub: (() => void)[] = [];

  private partsGroup = new THREE.Group();
  /** Cosmetic threads of the build (cut by a section view). */
  private threadObj: THREE.Object3D | null = null;
  private sketchGroup = new THREE.Group();
  private planesGroup = new THREE.Group();
  private previewGroup = new THREE.Group();
  private highlightGroup = new THREE.Group();
  readonly editGroup = new THREE.Group();
  private pickParts = new THREE.Group();
  private pickSketches = new THREE.Group();
  private pickPlanes = new THREE.Group();
  readonly pickEdit = new THREE.Group();

  private parts = new Map<string, PartObj>();
  private sketches = new Map<string, { res: SketchResult; regions: SketchRegion[]; map: Map<string, SkEntity> }>();
  /** World segments (x1,y1,z1,x2,y2,z2…) of curve features (helices), by feature id. */
  private curveSegs = new Map<string, number[]>();
  private planeFrames = new Map<string, { frame: PlaneFrame; size: number }>();
  private mateGroup = new THREE.Group();
  private mateFrames = new Map<string, PlaneFrame>();
  private sceneBox = new THREE.Box3();
  private firstFit = false;
  private restoredView = false;
  private studioId: string | null = null;
  private saveViewTimer: ReturnType<typeof setTimeout> | null = null;

  readonly sketchEditor: SketchEditor;
  private headlight = new THREE.DirectionalLight(0xffffff, 1.6);

  // pointer state
  private down: {
    x: number;
    y: number;
    button: number;
    ctrl: boolean;
    moved: boolean;
    pivot?: THREE.Vector3;
    /** An assembly instance grabbed with the left button (dragged once the mouse moves). */
    part?: { id: string; anchor: THREE.Vector3; started: boolean };
    triad?: TriadGrab;
  } | null = null;
  /** Triad manipulator of the selected assembly instance (at its centre), with the hovered handle. */
  /** `explode` — the instances an exploded view step made with this triad moves (the triad then drags steps). */
  private triad: { id: string; frame: TriadFrame; hover: string | null; explode?: string[] } | null = null;
  private triadGroup = new THREE.Group();
  /** The triad moved onto a mate connector of the instance (Alt+click), in the instance's own coordinates. */
  private triadPin: { id: string; local: { R: number[]; o: Vec3 } } | null = null;
  /** The box for a distance / angle typed at a triad handle. */
  private triadInput: HTMLInputElement | null = null;
  private lastPos = { x: 0, y: 0 };

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.localClippingEnabled = true; // section view
    this.renderer.domElement.className = 'viewport-canvas';
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'viewport-labels';
    container.appendChild(this.labels.domElement);
    this.viewCube = new ViewCube(112, t);
    container.appendChild(this.viewCube.element);
    this.viewCube.onPick = (dir, up) => this.cam.viewFrom(dir, up, this.fitBox());
    // its arrows: a quarter turn about the screen's axes (from where a turn under way ends: quick clicks add up)
    this.viewCube.onTurn = (turn) => {
      const q = this.cam.finalQuat;
      const axis = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q);
      const quarter = Math.PI / 2;
      // right: the right face comes to the front (the camera's back turns to its right); up — the top one
      if (turn === 'left' || turn === 'right') this.cam.rotateAbout(axis(0, 1, 0), turn === 'right' ? quarter : -quarter);
      else if (turn === 'up' || turn === 'down') this.cam.rotateAbout(axis(1, 0, 0), turn === 'up' ? -quarter : quarter);
      // clockwise: the camera rolls the other way
      else this.cam.rotateAbout(axis(0, 0, 1), turn === 'cw' ? quarter : -quarter);
    };
    // dragging the cube turns the camera about the centre of the view
    this.viewCube.onRotate = (dx, dy) => this.cam.rotate(dx, dy);
    this.viewCube.onMenu = (x, y) => this.viewCubeMenu(x, y);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.0));
    this.scene.add(this.headlight);
    this.scene.add(this.headlight.target);
    this.scene.add(this.planesGroup, this.partsGroup, this.sketchGroup, this.mateGroup, this.previewGroup, this.highlightGroup, this.inferGroup, this.editGroup, this.triadGroup);
    this.pickScene.add(this.pickPlanes, this.pickParts, this.pickSketches, this.pickEdit);
    this.addOrigin();

    // saved views per Part Studio / assembly tab
    this.studioId = activeTab(useDoc.getState().doc)?.id ?? null;
    this.restoredView = this.restoreView();
    this.cam.onChange = () => {
      this.needsRender = true;
      if (this.saveViewTimer) clearTimeout(this.saveViewTimer);
      this.saveViewTimer = setTimeout(() => this.saveView(), 300);
    };
    this.sketchEditor = new SketchEditor(this);
    this.cam.rotationMode = useEditor.getState().rotationMode;

    this.bindEvents();
    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.unsub.push(() => ro.disconnect());

    // store subscriptions
    this.unsub.push(
      useEditor.subscribe((s, p) => {
        if (s.build !== p.build || s.showPlanes !== p.showPlanes || s.showSketches !== p.showSketches) this.syncBuild();
        else if (s.editing?.featureId !== p.editing?.featureId) this.syncBuild();
        if (
          s.selection !== p.selection ||
          s.hover !== p.hover ||
          s.hoverList !== p.hoverList ||
          s.hoverFeatures !== p.hoverFeatures ||
          s.editing?.draft !== p.editing?.draft ||
          s.build !== p.build ||
          s.compare !== p.compare
        )
          this.syncHighlights();
        if (s.viewCmd !== p.viewCmd && s.viewCmd) this.runView(s.viewCmd.cmd);
        if (s.section !== p.section) this.applySection();
        if ((s.editing !== p.editing || s.activeField !== p.activeField) && this.inferGroup.children.length && !this.mateLocationActive()) {
          this.clearGroup(this.inferGroup);
          this.requestRender();
        }
        if (s.editing !== p.editing || s.sketch !== p.sketch || s.sketchPattern !== p.sketchPattern || s.showConstraints !== p.showConstraints || s.showExpressions !== p.showExpressions)
          this.sketchEditor.sync();
        if (s.rotationMode !== p.rotationMode) {
          this.cam.rotationMode = s.rotationMode;
          if (s.rotationMode === 'turntable') {
            this.cam.levelHorizon();
            this.cam.update();
          }
        }
        if (s.perspective !== p.perspective) {
          this.cam.perspective = s.perspective;
          this.cam.update();
        }
      }),
      useDoc.subscribe((s, p) => {
        const a = activeStudio(s.doc);
        const b = activeStudio(p.doc);
        if (a?.hidden !== b?.hidden || a?.id !== b?.id) this.syncBuild();
      }),
    );
    this.syncBuild();
    this.loop();
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private addOrigin() {
    const g = new THREE.Group();
    g.name = 'origin';
    const axes: [Vec3, number][] = [
      [[1, 0, 0], 0xd84a3a],
      [[0, 1, 0], 0x3aa655],
      [[0, 0, 1], 0x2f6fd1],
    ];
    for (const [d, c] of axes) {
      const m = lineMaterial(c, 1.5, { depthTest: false });
      const l = fatSegments([0, 0, 0, ...d], m);
      l.userData.axis = d;
      l.renderOrder = 5;
      g.add(l);
    }
    const dot = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
      new THREE.PointsMaterial({ color: 0x2f3b47, size: 6, sizeAttenuation: false, depthTest: false }),
    );
    dot.renderOrder = 6;
    g.add(dot);
    this.scene.add(g);
    // pick
    const pg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    pg.setAttribute('pickId', constantIds(1, this.registry.alloc({ t: 'origin', priority: PRIORITY.origin, radius: 7 })));
    const pp = new THREE.Points(pg, makePickMaterial({ points: 10, depthTest: false }));
    pp.name = 'origin-pick';
    this.pickScene.add(pp);
  }

  private resize() {
    const r = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(r.width));
    this.height = Math.max(1, Math.floor(r.height));
    this.renderer.setSize(this.width, this.height);
    this.labels.setSize(this.width, this.height);
    this.cam.setSize(this.width, this.height);
    setLineResolution(this.width, this.height);
    this.needsRender = true;
  }

  requestRender() {
    this.needsRender = true;
  }

  private measureObj: THREE.Object3D | null = null;
  private massCenterObj: THREE.Object3D | null = null;

  /** The measure panel's distance: a dashed segment over the model with dots at its ends (none — taken away). */
  setMeasureLine(points: [Vec3, Vec3] | null) {
    if (this.measureObj) {
      this.scene.remove(this.measureObj);
      disposeObject(this.measureObj);
      this.measureObj = null;
    }
    if (points) {
      const g = new THREE.Group();
      const [a, b] = points;
      if (v3.dist(a, b) > 1e-9) g.add(fatSegments([...a, ...b], lineMaterial(0xe8590c, 2, { dashed: true, depthTest: false })));
      const dots = new THREE.BufferGeometry();
      dots.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b], 3));
      g.add(new THREE.Points(dots, new THREE.PointsMaterial({ color: 0xe8590c, size: 7, sizeAttenuation: false, depthTest: false })));
      g.renderOrder = 10;
      this.scene.add(g);
      this.measureObj = g;
    }
    this.requestRender();
  }

  /** The centre of mass symbol (a circle in black and white quarters) over the model, or none. */
  setMassCenter(p: Vec3 | null) {
    if (this.massCenterObj) {
      this.scene.remove(this.massCenterObj);
      disposeObject(this.massCenterObj);
      this.massCenterObj = null;
    }
    if (p) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      const map = new THREE.CanvasTexture(massCenterSymbol());
      map.colorSpace = THREE.SRGBColorSpace;
      const o = new THREE.Points(geo, new THREE.PointsMaterial({ map, size: 22, sizeAttenuation: false, transparent: true, depthTest: false }));
      o.renderOrder = 40;
      this.scene.add(o);
      this.massCenterObj = o;
    }
    this.requestRender();
  }

  /** PNG data URL of the graphics area as it is now (agent API screenshots; no HTML labels). */
  snapshot(): string {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const animating = this.cam.tick(performance.now());
    if (!this.needsRender && !animating) return;
    this.needsRender = false;
    this.render();
  };

  private render() {
    const camera = this.cam.camera;
    this.headlight.position.copy(camera.position);
    this.headlight.target.position.copy(this.cam.target);
    // keep origin triad a constant screen size
    const origin = this.scene.getObjectByName('origin');
    if (origin) origin.scale.setScalar(this.cam.pixelSize * 40);
    // mate connector triads (display, highlight, preview and pick copies) keep a constant screen size
    const ts = this.cam.pixelSize * 34;
    for (const grp of [this.mateGroup, this.highlightGroup, this.previewGroup, this.pickPlanes, this.inferGroup])
      for (const o of grp.children) if (o.userData.triad) o.scale.setScalar(ts);
    for (const o of this.triadGroup.children) o.scale.setScalar(this.cam.pixelSize * TRIAD_PX);
    this.sketchEditor.beforeRender();
    this.facePlaneLabels();
    this.renderer.render(this.scene, camera);
    this.labels.render(this.scene, camera);
    this.viewCube.sync(this.cam.quat);
  }

  /** Plane names are written on the planes: seen from the back of a plane, its name is mirrored to read right. */
  private facePlaneLabels() {
    const n = new THREE.Vector3();
    const o = new THREE.Vector3();
    for (const g of this.planesGroup.children)
      for (const label of g.children) {
        if (!label.userData.planeLabel) continue;
        // the plane's normal and origin in the world (its group's matrix)
        n.setFromMatrixColumn(g.matrix, 2);
        o.setFromMatrixPosition(g.matrix);
        const toEye = this.cam.perspective ? this.cam.camera.position.clone().sub(o) : this.cam.viewDir.clone().negate();
        facePlaneLabel(label, toEye.dot(n) < 0);
      }
  }

  /** Camera of each part studio survives tab switches and page reloads. */
  private saveView() {
    // nothing meaningful to remember before the first build arrived
    if (!this.studioId || !this.firstFit) return;
    const v = this.cam.getView();
    savedViews.set(this.studioId, v);
    try {
      sessionStorage.setItem(`webcad.view.${this.studioId}`, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }

  private restoreView(): boolean {
    if (!this.studioId) return false;
    let v = savedViews.get(this.studioId);
    if (!v) {
      try {
        const raw = sessionStorage.getItem(`webcad.view.${this.studioId}`);
        if (raw) v = JSON.parse(raw);
      } catch {
        /* ignore */
      }
    }
    if (!v) return false;
    this.cam.setView(v);
    return true;
  }

  dispose() {
    if (this.saveViewTimer) clearTimeout(this.saveViewTimer);
    this.saveView();
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unsub.forEach((u) => u());
    this.sketchEditor.dispose();
    for (const c of this.partGeos.values()) disposePartGeo(c);
    this.partGeos.clear();
    this.renderer.dispose();
    this.viewCube.dispose();
    this.picker.dispose();
    this.container.innerHTML = '';
  }

  // -------------------------------------------------------------------------
  // Scene sync
  // -------------------------------------------------------------------------

  private clearGroup(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c);
      disposeObject(c);
      c.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
      });
    }
  }

  private syncBuild() {
    const ed = useEditor.getState();
    const build = ed.build;
    const studio = activeStudio(useDoc.getState().doc);
    const hidden = new Set(studio?.hidden ?? []);
    this.registry.clear();
    // origin keeps id 1
    this.registry.alloc({ t: 'origin', priority: PRIORITY.origin, radius: 7 });
    for (const g of [this.partsGroup, this.sketchGroup, this.planesGroup, this.mateGroup, this.previewGroup, this.pickParts, this.pickSketches, this.pickPlanes])
      this.clearGroup(g);
    this.mateFrames.clear();
    this.parts.clear();
    this.sketches.clear();
    this.sceneBox.makeEmpty();
    const editingId = ed.editing?.featureId;
    const changed = new Set(build?.preview?.changed ?? []);

    this.threadObj = null;
    for (const c of this.partGeos.values()) c.used = false;
    if (build) {
      for (const p of build.parts) {
        // an open composite is its bodies, drawn as themselves (in an assembly an instance of it is drawn: no members there)
        if (p.hidden || (p.composite && !p.composite.closed && build.parts.some((q) => p.composite!.members.some((m) => m.id === q.id)))) continue;
        this.addPart(p, changed.has(p.id), studio?.parts[p.id]?.opacity);
      }
      // cosmetic threads of tapped holes (not of hidden parts)
      const hiddenParts = new Set(build.parts.filter((p) => p.hidden).map((p) => p.id));
      const threads = (build.threads ?? []).filter((t) => !t.owner || !hiddenParts.has(t.owner));
      if (threads.length) this.partsGroup.add((this.threadObj = threadObject(threads)));
      this.applySection();
      for (const s of build.sketches) {
        sketchFrames.set(s.featureId, s.frame);
        // a Derived feature's sketch ("derivedId.sketchId") is hidden with that feature
        const owner = s.featureId.split('.')[0];
        if (s.featureId === editingId || hidden.has(s.featureId) || hidden.has(owner) || owner === editingId || !ed.showSketches) continue;
        this.addSketch(s);
      }
      for (const pl of build.planes) {
        this.planeFrames.set(pl.featureId, { frame: pl.frame, size: pl.size });
        if (hidden.has(pl.featureId) || !ed.showPlanes) continue;
        this.addPlane(pl.featureId, pl.name, pl.frame, pl.size, false);
      }
      for (const m of build.mates ?? []) {
        // also a plane for sketches / view normal (its XY plane)
        this.planeFrames.set(m.featureId, { frame: m.frame, size: 0 });
        this.mateFrames.set(m.featureId, m.frame);
        if (hidden.has(m.featureId) || m.featureId === editingId) continue;
        this.addMate(m.featureId, m.frame);
      }
      this.curveSegs.clear();
      for (const c of build.curves) {
        if (hidden.has(c.featureId)) continue;
        const pts: number[] = [];
        for (let i = 0; i + 1 < c.points.length / 3; i++)
          pts.push(...c.points.subarray(i * 3, i * 3 + 6));
        this.sketchGroup.add(fatSegments(pts, lineMaterial(COLORS.committed, 2)));
        // pickable like a sketch curve (e.g. a helix as a sweep path)
        this.curveSegs.set(c.featureId, pts);
        const id = this.registry.alloc({ t: 'skEnt', sketchId: c.featureId, entityId: CURVE_ENTITY, entType: 'curve', priority: PRIORITY.skCurve, radius: 5 });
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        lg.setAttribute('pickId', constantIds(pts.length / 3, id));
        this.pickSketches.add(new THREE.LineSegments(lg, makePickMaterial()));
      }
      // exploded view of an assembly: dashed lines from where the parts stand to where they are shown
      if (build.trails?.length) {
        const l = fatSegments(build.trails, lineMaterial(0x6b7785, 1.4, { dashed: true }));
        l.renderOrder = 4;
        this.sketchGroup.add(l);
      }
      if (build.preview) this.addPreview(build);
    }
    // the kept geometry of parts no longer shown (gone, hidden, changed): released
    for (const [id, c] of this.partGeos)
      if (!c.used) {
        disposePartGeo(c);
        this.partGeos.delete(id);
      }
    // the origin triad (an eye in the feature list hides it, and then it is not picked either)
    const showOrigin = !hidden.has('origin');
    for (const o of [this.scene.getObjectByName('origin'), this.pickScene.getObjectByName('origin-pick')]) if (o) o.visible = showOrigin;
    // default planes
    const size = this.defaultPlaneSize();
    if (ed.showPlanes) {
      for (const name of ['top', 'front', 'right'] as const) {
        if (hidden.has(name)) continue;
        this.addPlane(name, name[0].toUpperCase() + name.slice(1), STD_PLANES[name], size, true);
      }
    }
    // Fit the view once, on the first build after opening the studio (never afterwards:
    // operations must not move the camera). A remembered view wins over the fit.
    if (!this.firstFit && build) {
      this.firstFit = true;
      if (build.parts.length && !this.restoredView) this.cam.setStdView('iso', this.fitBox());
    }
    this.cam.sceneRadius = Math.max(200, this.sceneBox.isEmpty() ? 200 : this.sceneBox.getBoundingSphere(new THREE.Sphere()).radius * 2);
    this.syncHighlights();
    this.sketchEditor.sync();
    // the pick registry was reset: the sketch editor must re-register its pickables
    this.sketchEditor.renderSketch(true);
    this.needsRender = true;
  }

  private defaultPlaneSize() {
    if (this.sceneBox.isEmpty()) return 60;
    const s = this.sceneBox.getSize(new THREE.Vector3());
    return Math.max(40, Math.max(s.x, s.y, s.z) * 0.7);
  }

  fitBox(): THREE.Box3 {
    const b = this.sceneBox.clone();
    if (b.isEmpty()) {
      const s = this.defaultPlaneSize() / 2;
      b.set(new THREE.Vector3(-s, -s, -s), new THREE.Vector3(s, s, s));
    }
    return b;
  }

  /**
   * What the graphics made of each part's mesh (its buffers on the GPU): kept while the part's mesh is the same
   * (`meshKey`) — opening a feature, hiding planes or another part rebuilds the scene without rebuilding them; only
   * their pick ids are numbered anew when the registry gives the part other ones.
   */
  private partGeos = new Map<string, PartGeo>();

  /** A part's geometry: as kept, or made anew; its pick ids from `faceBase` / `edgeBase` / `vertexBase`. */
  private partGeo(p: PartMesh, faceBase: number, edgeBase: number, vertexBase: number): PartGeo {
    let c = this.partGeos.get(p.id);
    if (!c || !p.meshKey || c.key !== p.meshKey) {
      if (c) disposePartGeo(c);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(p.indices, 1));
      geo.computeBoundingBox();
      // each vertex's face, each edge segment end's edge (for numbering the pick ids)
      const faceOf = new Int32Array(p.positions.length / 3);
      for (let i = 0; i < p.faceRanges.length / 2; i++) {
        const s = p.faceRanges[i * 2];
        for (let k = s; k < s + p.faceRanges[i * 2 + 1]; k++) faceOf[p.indices[k]] = i;
      }
      let nSeg = 0;
      for (let i = 0; i < p.edgeRanges.length / 2; i++) if (!p.edges[i]?.seam) nSeg += Math.max(0, p.edgeRanges[i * 2 + 1] - 1);
      const segs = new Float32Array(nSeg * 6);
      const edgeOf = new Int32Array(nSeg * 2);
      let at = 0;
      for (let i = 0; i < p.edgeRanges.length / 2; i++) {
        if (p.edges[i]?.seam) continue;
        const s = p.edgeRanges[i * 2];
        const c2 = p.edgeRanges[i * 2 + 1];
        for (let k = s; k + 1 < s + c2; k++, at++) {
          segs.set(p.edgePositions.subarray(k * 3, k * 3 + 6), at * 6);
          edgeOf[at * 2] = edgeOf[at * 2 + 1] = i;
        }
      }
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.BufferAttribute(segs, 3));
      const vg = new THREE.BufferGeometry();
      vg.setAttribute('position', new THREE.BufferAttribute(p.vertices, 3));
      c = { key: p.meshKey ?? '', geo, eg, vg, faceOf, edgeOf, faceBase: -1, edgeBase: -1, vertexBase: -1, used: false };
      if (p.meshKey) this.partGeos.set(p.id, c);
    }
    if (c.faceBase !== faceBase) {
      c.geo.setAttribute('pickId', new THREE.BufferAttribute(Float32Array.from(c.faceOf, (f) => faceBase + f), 1));
      c.faceBase = faceBase;
    }
    if (c.edgeBase !== edgeBase) {
      c.eg.setAttribute('pickId', new THREE.BufferAttribute(Float32Array.from(c.edgeOf, (e) => edgeBase + e), 1));
      c.edgeBase = edgeBase;
    }
    if (c.vertexBase !== vertexBase) {
      c.vg.setAttribute('pickId', new THREE.BufferAttribute(Float32Array.from({ length: p.vertices.length / 3 }, (_, i) => vertexBase + i), 1));
      c.vertexBase = vertexBase;
    }
    c.used = true;
    return c;
  }

  private addPart(p: PartMesh, faded: boolean, opacity = 1) {
    // pick ids: faces, edges, vertices (in this order)
    const nFaces = p.faceRanges.length / 2;
    const faceBase = this.registry.size;
    for (let i = 0; i < nFaces; i++) this.registry.alloc({ t: 'face', partId: p.id, index: i, priority: PRIORITY.face, radius: 1.5 });
    const nEdges = p.edgeRanges.length / 2;
    const edgeBase = this.registry.size;
    for (let i = 0; i < nEdges; i++) this.registry.alloc({ t: 'edge', partId: p.id, index: i, priority: PRIORITY.edge, radius: 6 });
    const nV = p.vertices.length / 3;
    const vertexBase = this.registry.size;
    for (let i = 0; i < nV; i++) this.registry.alloc({ t: 'vertex', partId: p.id, index: i, priority: PRIORITY.vertex, radius: 7 });
    const { geo, eg, vg } = this.partGeo(p, faceBase, edgeBase, vertexBase);
    if (geo.boundingBox) this.sceneBox.union(geo.boundingBox);
    // a part changed by the previewed feature is faded; a see-through one (its appearance) shows the parts inside
    const alpha = faded ? 0.25 : Math.min(1, Math.max(0.1, opacity));
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.color),
      roughness: 0.62,
      metalness: 0.05,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      transparent: alpha < 1,
      opacity: alpha,
      depthWrite: alpha >= 1,
    });
    const mesh = new THREE.Mesh(geo, material);
    // edges as segments
    const edges = new THREE.LineSegments(
      eg,
      new THREE.LineBasicMaterial({ color: COLORS.partEdge, transparent: faded, opacity: faded ? 0.35 : 1 }),
    );
    const group = new THREE.Group();
    group.add(mesh, edges);
    this.partsGroup.add(group);
    // vertices (pick only)
    const pickMats = [makePickMaterial({ polygonOffset: 2 }), makePickMaterial(), makePickMaterial({ points: 9 })];
    const picks = [new THREE.Mesh(geo, pickMats[0]), new THREE.LineSegments(eg, pickMats[1]), new THREE.Points(vg, pickMats[2])];
    this.pickParts.add(...picks);
    // the geometry kept (see partGeos): the objects go, their buffers stay
    if (this.partGeos.get(p.id)?.geo === geo) for (const o of [mesh, edges, ...picks]) o.userData.sharedGeometry = true;
    this.parts.set(p.id, { data: p, group, mesh, material, edges, faceBase, edgeBase, vertexBase, pickMats });
  }

  /**
   * Section view (Onshape "Section view"): parts are clipped by the section plane. Solids have
   * outward triangles, so the inside seen through the cut is drawn as flat back faces (the cap).
   */
  /** The section view's clipping planes (none: no section). */
  private sectionPlanes(): THREE.Plane[] | null {
    const sec = useEditor.getState().section;
    if (!sec) return null;
    const n = new THREE.Vector3(...sec.normal).normalize();
    const o = new THREE.Vector3(...sec.origin).addScaledVector(n, sec.offset);
    // keep the material behind the plane (the side its normal points away from)
    return [new THREE.Plane().setFromNormalAndCoplanarPoint(sec.flip ? n : n.clone().negate(), o)];
  }

  /**
   * The preview of an edited feature cut by the section too (Hole, Extrude…): its parts with caps of their cut, its
   * edges and tool body clipped.
   */
  private clipPreview(planes: THREE.Plane[] | null) {
    for (const o of [...this.previewGroup.children]) {
      if (o.userData.sectionCap) {
        this.previewGroup.remove(o);
        continue;
      }
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        m.clippingPlanes = planes;
        m.needsUpdate = true;
      }
      // a preview part (not the coloured tool body): the cut shows as the solid's inside, as parts do
      if (o instanceof THREE.Mesh && o.userData.previewPart) (o.material as THREE.Material).side = planes ? THREE.FrontSide : THREE.DoubleSide;
      if (planes && o instanceof THREE.Mesh && o.userData.previewPart) {
        const color = ((o.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xa9bfd6)).clone().multiplyScalar(0.62);
        const cap = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, clippingPlanes: planes }));
        cap.userData.sectionCap = true;
        this.previewGroup.add(cap);
      }
    }
  }

  private applySection() {
    const planes = this.sectionPlanes();
    this.clipPreview(planes);
    // threads are cut by the section like the parts they are in
    if (this.threadObj) {
      const m = (this.threadObj as THREE.Mesh).material as THREE.Material;
      m.clippingPlanes = planes;
      m.needsUpdate = true;
    }
    for (const po of this.parts.values()) {
      for (const m of [po.material, po.edges.material as THREE.Material, ...po.pickMats]) {
        m.clippingPlanes = planes;
        m.needsUpdate = true;
      }
      po.material.side = planes ? THREE.FrontSide : THREE.DoubleSide;
      if (planes && !po.cap) {
        const color = po.material.color.clone().multiplyScalar(0.62);
        po.cap = new THREE.Mesh(po.mesh.geometry, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, clippingPlanes: planes }));
        // the part's geometry: disposed with the part, not with its cap
        po.cap.userData.sharedGeometry = true;
        po.group.add(po.cap);
      } else if (po.cap) {
        if (planes) {
          (po.cap.material as THREE.Material).clippingPlanes = planes;
          (po.cap.material as THREE.Material).needsUpdate = true;
        } else {
          po.group.remove(po.cap);
          (po.cap.material as THREE.Material).dispose();
          po.cap = undefined;
        }
      }
    }
    this.requestRender();
  }

  private addSketch(s: SketchResult) {
    const regions = (() => {
      try {
        return computeRegions(s.entities);
      } catch {
        return [];
      }
    })();
    const map = entityMap(s.entities);
    this.sketches.set(s.featureId, { res: s, regions, map });
    const m = frameMatrix(s.frame);
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.copy(m);
    g.matrixWorldNeedsUpdate = true;
    const pg = new THREE.Group();
    pg.matrixAutoUpdate = false;
    pg.matrix.copy(m);
    pg.matrixWorldNeedsUpdate = true;
    const normal: number[] = [];
    const constr: number[] = [];
    const pts: [number, number][] = [];
    const pickSegs: number[] = [];
    const pickIds: number[] = [];
    const pickPts: number[] = [];
    const pickPtIds: number[] = [];
    for (const e of s.entities) {
      if (e.type === 'point') {
        if (!e.owner) {
          pts.push([e.x, e.y]);
          const id = this.registry.alloc({ t: 'skEnt', sketchId: s.featureId, entityId: e.id, entType: 'point', priority: PRIORITY.skPoint, radius: 7 });
          pickPts.push(e.x, e.y, 0);
          pickPtIds.push(id);
        }
        continue;
      }
      // a text's box is for editing the sketch only
      if ((e.construction && isTextPart(e.id)) || isTextBox(e)) continue;
      const poly = entityPolyline(e, map);
      const segs = polylineSegments(poly);
      (e.construction ? constr : normal).push(...segs);
      const id = this.registry.alloc({ t: 'skEnt', sketchId: s.featureId, entityId: e.id, entType: e.type, priority: PRIORITY.skCurve, radius: 5 });
      pickSegs.push(...segs);
      for (let i = 0; i < segs.length / 3; i++) pickIds.push(id);
      // centres of circles/arcs are useful points (hole locations etc.)
      if (e.type === 'circle' || e.type === 'arc') {
        const c = map.get(e.c);
        if (c && c.type === 'point') {
          const cid = this.registry.alloc({ t: 'skEnt', sketchId: s.featureId, entityId: c.id, entType: 'point', priority: PRIORITY.skPoint, radius: 6 });
          pickPts.push(c.x, c.y, 0);
          pickPtIds.push(cid);
        }
      }
    }
    if (normal.length) g.add(fatSegments(normal, lineMaterial(COLORS.committed, 1.6)));
    if (constr.length) g.add(fatSegments(constr, lineMaterial(COLORS.construction, 1, { dashed: true })));
    if (pts.length) g.add(pointsObject(pts, COLORS.committed, 6));
    // regions
    for (const r of regions) {
      const geo = regionGeometry(r);
      const fill = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: COLORS.region, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      );
      g.add(fill);
      const id = this.registry.alloc({ t: 'region', sketchId: s.featureId, region: r, priority: PRIORITY.region, radius: 1.5 });
      const pgeo = geo.clone();
      pgeo.setAttribute('pickId', constantIds(pgeo.getAttribute('position').count, id));
      // pushed back less than part faces (2): a region wins over the face it lies on, but the
      // sketch's own lines between two regions stay pickable on top of it
      pg.add(new THREE.Mesh(pgeo, makePickMaterial({ polygonOffset: 1 })));
    }
    if (pickSegs.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pickSegs, 3));
      lg.setAttribute('pickId', new THREE.Float32BufferAttribute(pickIds, 1));
      pg.add(new THREE.LineSegments(lg, makePickMaterial()));
    }
    if (pickPts.length) {
      const pgeo = new THREE.BufferGeometry();
      pgeo.setAttribute('position', new THREE.Float32BufferAttribute(pickPts, 3));
      pgeo.setAttribute('pickId', new THREE.Float32BufferAttribute(pickPtIds, 1));
      pg.add(new THREE.Points(pgeo, makePickMaterial({ points: 9, depthTest: false })));
    }
    g.userData.sketchId = s.featureId;
    this.sketchGroup.add(g);
    this.pickSketches.add(pg);
  }

  private addPlane(id: string, name: string, frame: PlaneFrame, size: number, std: boolean) {
    const h = size / 2;
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.copy(frameMatrix(frame));
    g.matrixWorldNeedsUpdate = true;
    const geo = new THREE.PlaneGeometry(size, size);
    const fill = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: COLORS.plane, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
    );
    const border = fatSegments(
      [-h, -h, 0, h, -h, 0, h, -h, 0, h, h, 0, h, h, 0, -h, h, 0, -h, h, 0, -h, -h, 0],
      lineMaterial(COLORS.plane, 1.2, { opacity: 0.8 }),
    );
    // the name is written on the plane along its top edge (Onshape), hidden by the parts in front of it
    g.add(fill, border, planeLabel(std ? t(name) : tName(name), h));
    this.planesGroup.add(g);
    // pick: border (priority) + fill (fallback)
    const pid = this.registry.alloc({ t: 'plane', planeId: id, priority: PRIORITY.planeEdge, radius: 5 });
    const fid = this.registry.alloc({ t: 'plane', planeId: id, priority: PRIORITY.plane, radius: 0.5 });
    const pg = new THREE.Group();
    pg.matrixAutoUpdate = false;
    pg.matrix.copy(g.matrix);
    pg.matrixWorldNeedsUpdate = true;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute([-h, -h, 0, h, -h, 0, h, -h, 0, h, h, 0, h, h, 0, -h, h, 0, -h, h, 0, -h, -h, 0], 3));
    bg.setAttribute('pickId', constantIds(8, pid));
    const fg = geo.clone();
    fg.setAttribute('pickId', constantIds(fg.getAttribute('position').count, fid));
    const fm = makePickMaterial();
    fm.depthWrite = false;
    const fillPick = new THREE.Mesh(fg, fm);
    fillPick.renderOrder = -10;
    pg.add(fillPick, new THREE.LineSegments(bg, makePickMaterial()));
    this.pickPlanes.add(pg);
    if (!std) {
      const corners = [
        [-h, -h],
        [h, h],
      ].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(g.matrix));
      corners.forEach((c) => this.sceneBox.expandByPoint(c));
    }
  }

  private addPreview(build: BuildResult) {
    const pv = build.preview!;
    if (!pv.status.ok) return;
    const opColor =
      pv.op === 'remove' ? COLORS.previewRemove : pv.op === 'intersect' ? COLORS.previewIntersect : null;
    for (const p of pv.parts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(p.indices, 1));
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color), roughness: 0.6, transparent: true, opacity: 0.82, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
      );
      mesh.userData.previewPart = true;
      const segs: number[] = [];
      for (let i = 0; i < p.edgeRanges.length / 2; i++) {
        if (p.edges[i]?.seam) continue;
        const s = p.edgeRanges[i * 2];
        const c = p.edgeRanges[i * 2 + 1];
        for (let k = s; k + 1 < s + c; k++) segs.push(...p.edgePositions.subarray(k * 3, k * 3 + 6));
      }
      const eg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      this.previewGroup.add(mesh, new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: COLORS.partEdge, transparent: true, opacity: 0.6 })));
    }
    if (pv.tool && opColor !== null) {
      const p = pv.tool;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(p.indices, 1));
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: opColor, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.renderOrder = 10;
      this.previewGroup.add(mesh);
    }
    for (const pl of pv.planes ?? []) this.addPlane(pl.featureId, pl.name, pl.frame, pl.size, false);
    for (const m of pv.mates ?? []) this.previewGroup.add(mateTriad(m.frame));
    if (useEditor.getState().showSketches) for (const s of pv.sketches ?? []) this.addSketch(s);
    if (pv.threads?.length) this.previewGroup.add(threadObject(pv.threads));
    this.clipPreview(this.sectionPlanes());
  }

  /** A mate connector: triad + ring, kept at a constant screen size (see render), pickable. */
  private addMate(featureId: string, frame: PlaneFrame) {
    this.mateGroup.add(mateTriad(frame));
    const id = this.registry.alloc({ t: 'mate', featureId, priority: PRIORITY.vertex - 1, radius: 9 });
    const pick = new THREE.Group();
    placeTriad(pick, frame);
    pick.userData.triad = true;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    pg.setAttribute('pickId', constantIds(1, id));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1], 3));
    lg.setAttribute('pickId', constantIds(6, id));
    pick.add(new THREE.Points(pg, makePickMaterial({ points: 14, depthTest: false })), new THREE.LineSegments(lg, makePickMaterial({ depthTest: false })));
    this.pickPlanes.add(pick);
  }

  // -------------------------------------------------------------------------
  // Highlights
  // -------------------------------------------------------------------------

  /** Refs to draw as selected: global selection + selections of the open dialog. */
  private selectedRefs(): SelRef[] {
    const ed = useEditor.getState();
    const out = [...ed.selection];
    const d = ed.editing?.draft;
    if (d && d.type !== 'sketch') {
      for (const v of Object.values(d.params as unknown as Record<string, unknown>)) {
        if (Array.isArray(v)) for (const x of v) if (x && typeof x === 'object' && 'kind' in x) out.push(x as SelRef);
      }
    }
    return out;
  }

  syncHighlights() {
    this.clearGroup(this.highlightGroup);
    const ed = useEditor.getState();
    const seen = new Set<string>();
    // a row of a list under the pointer (a dialog's field, the instances…): its items stand out, the other selected fade
    const list = ed.hoverList?.length ? ed.hoverList : null;
    const focus = list ? new Set(list.map(refKey)) : null;
    for (const r of this.selectedRefs()) {
      const k = refKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      if (focus?.has(k)) continue;
      this.addHighlight(r, COLORS.selected, focus ? 'faint' : undefined);
    }
    if (list) for (const r of list) this.addHighlight(r, COLORS.hover, 'strong');
    else if (ed.hover && !seen.has(refKey(ed.hover))) this.addHighlight(ed.hover, COLORS.hover);
    if (ed.hoverFeatures?.length && !ed.editing) {
      this.addFeatureHighlight(new Set(ed.hoverFeatures), COLORS.hover);
      this.addSketchHover(new Set(ed.hoverFeatures));
    }
    if (ed.compare) this.addCompare(ed.compare);
    this.syncTriad();
    this.needsRender = true;
  }

  // -------------------------------------------------------------------------
  // Triad manipulator (assemblies, Onshape): shown at the centre of the one selected instance that can move
  // -------------------------------------------------------------------------

  /** Bounding box of an assembly instance as shown: its part, or all the parts of a sub-assembly (`X/…`). */
  private instanceBox(id: string): [Vec3, Vec3] | undefined {
    const boxes = [...this.parts.entries()].filter(([pid]) => pid === id || pid.startsWith(`${id}/`)).map(([, p]) => p.data.bbox);
    if (!boxes.length) return undefined;
    return [
      [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b[0][i]))) as Vec3,
      [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b[1][i]))) as Vec3,
    ];
  }

  private syncTriad() {
    const asm = activeAssembly(useDoc.getState().doc);
    if (asm && explodeActive()) {
      // exploded view: a triad at the centre of the selected instances drags the next explode step
      const sel = selectedInstances(useEditor.getState().selection).filter((id) => asm.instances.some((i) => i.id === id));
      const boxes = sel.map((id) => this.instanceBox(id)).filter((b): b is [Vec3, Vec3] => !!b);
      this.triadPin = null;
      this.closeTriadInput();
      if (!boxes.length) {
        if (this.triad) {
          this.triad = null;
          this.clearGroup(this.triadGroup);
        }
        return;
      }
      const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b[0][i])));
      const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b[1][i])));
      const frame: TriadFrame = { o: [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2) as Vec3, axes: TRIAD_AXES };
      // during a drag the triad stays where the drag started
      const held = this.down?.triad?.explode ? this.down.triad.frame : frame;
      const hover = this.down?.triad ? handleKey(this.down.triad.handle) : this.triad?.explode ? this.triad.hover : null;
      this.triad = { id: sel[0], frame: held, hover, explode: sel };
      this.drawTriad();
      return;
    }
    // a part of a flexible sub-assembly gets its own triad
    const ids = asm && !assemblyHandsOff() ? selectedUnits(asm, useEditor.getState().selection) : [];
    // while an instance is dragged, it is where the drag put it
    const tab = useDragPreview.getState().tab ?? asm;
    const inst = ids.length === 1 && tab ? findInstance(tab, useAssembly.getState().sources, ids[0]) : undefined;
    const box = inst && !inst.fixed && !inst.hidden ? this.instanceBox(inst.id) : undefined;
    if (!inst || !box) {
      this.closeTriadInput();
      this.triadPin = null;
      if (this.triad) {
        this.triad = null;
        this.clearGroup(this.triadGroup);
      }
      return;
    }
    if (this.triad?.id !== inst.id) this.closeTriadInput();
    if (this.triadPin?.id !== inst.id) this.triadPin = null;
    const frame: TriadFrame = this.triadPin
      ? placedTriad(placementOf(inst), this.triadPin.local)
      : { o: [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, (box[0][2] + box[1][2]) / 2], axes: TRIAD_AXES };
    // the dragged handle stays lit
    const hover = this.down?.triad ? handleKey(this.down.triad.handle) : this.triad?.id === inst.id ? this.triad.hover : null;
    this.triad = { id: inst.id, frame, hover };
    this.drawTriad();
  }

  private drawTriad() {
    this.clearGroup(this.triadGroup);
    if (!this.triad) return;
    const { o, axes } = this.triad.frame;
    const g = moveTriadObject(this.triad.hover);
    g.position.set(...o);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(...(axes.map((a) => new THREE.Vector3(...a)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3])));
    g.scale.setScalar(this.cam.pixelSize * TRIAD_PX);
    this.triadGroup.add(g);
    this.needsRender = true;
  }

  /**
   * Alt+click (Onshape: move the triad): on a face / edge / vertex or a mate connector of the instance — the triad
   * moves onto that mate connector and takes its axes; on the centre ball — back to the instance centre.
   */
  private moveTriadTo(x: number, y: number): boolean {
    if (!this.triad) return false;
    if (this.pickTriad(x, y)?.kind === 'center') {
      this.triadPin = null;
      this.syncTriad();
      return true;
    }
    const ref = this.pickRef(x, y);
    const asm = activeAssembly(useDoc.getState().doc);
    const inst = asm && findInstance(asm, useAssembly.getState().sources, this.triad.id);
    if (!ref || !inst) return false;
    let at: MateConnectorRef | null = null;
    if ((ref.kind === 'face' || ref.kind === 'edge' || ref.kind === 'vertex') && ref.partId === inst.id) at = { kind: ref.kind, index: ref.index };
    if (ref.kind === 'plane') {
      const c = parseInstanceConnector(ref.planeId);
      if (c?.instance === inst.id) at = { kind: 'connector', featureId: c.featureId };
    }
    const local = at && connectorFrame(useAssembly.getState().sources, inst, at);
    if (!local) return false;
    this.triadPin = { id: inst.id, local };
    this.syncTriad();
    return true;
  }

  /** Click on an arrow / arc (Onshape): a box to type the distance / angle to move or turn the instance by. */
  private openTriadInput(handle: TriadHandle, x: number, y: number) {
    const doc = useDoc.getState().doc;
    if (!this.triad || !doc || handle.kind === 'center') return;
    this.closeTriadInput();
    const { id, frame } = this.triad;
    const kind = handle.kind === 'arrow' ? 'length' : 'angle';
    const input = document.createElement('input');
    input.className = 'dim-input triad-input';
    input.placeholder = kind === 'length' ? `0 ${doc.units.length}` : '0°';
    input.title = kind === 'length' ? t('Distance along the axis') : t('Angle about the axis');
    input.style.left = `${x + 14}px`;
    input.style.top = `${y - 13}px`;
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('blur', () => this.closeTriadInput());
    input.addEventListener('input', () => input.classList.remove('invalid'));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closeTriadInput();
      if (e.key !== 'Enter') return;
      const v = tryEvaluate(input.value, kind, makeEvalContext(doc, {}));
      if (v === null) {
        input.classList.add('invalid');
        return;
      }
      this.closeTriadInput();
      const s = triadStep(handle, v, frame);
      if (!assemblyDragStart(id)) return;
      assemblyDragMove(s.delta, s.angle, s.axis, frame.o);
      assemblyDragEnd();
    });
    this.container.appendChild(input);
    this.triadInput = input;
    input.focus();
  }

  private closeTriadInput() {
    const el = this.triadInput;
    this.triadInput = null;
    el?.remove();
  }

  /** The mouse ray at a screen point (origin and unit direction). */
  private mouseRay(x: number, y: number): { p: Vec3; d: Vec3 } {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.cam.camera);
    return { p: rc.ray.origin.toArray() as Vec3, d: rc.ray.direction.toArray() as Vec3 };
  }

  /** The triad handle under the cursor. */
  private pickTriad(x: number, y: number): TriadHandle | null {
    if (!this.triad || !this.triadGroup.children.length) return null;
    for (const o of this.triadGroup.children) o.scale.setScalar(this.cam.pixelSize * TRIAD_PX);
    this.triadGroup.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.cam.camera);
    const hits = rc.intersectObjects(this.triadGroup.children, true).filter((h) => h.object.userData.handle);
    // the centre ball wins over the arrows and arcs that pass near it
    const hit = hits.find((h) => h.object.userData.handle.kind === 'center') ?? hits[0];
    return hit ? (hit.object.userData.handle as TriadHandle) : null;
  }

  /** Grab a triad handle: remember where on its axis / plane the drag starts. */
  private grabTriad(handle: TriadHandle, x: number, y: number): TriadGrab | null {
    if (!this.triad) return null;
    const { o: c, axes } = this.triad.frame;
    const { p, d } = this.mouseRay(x, y);
    const grab: TriadGrab = { handle, id: this.triad.id, frame: this.triad.frame, started: false, angle: 0, explode: this.triad.explode };
    if (handle.kind === 'arrow') grab.t0 = closestOnAxis(p, d, c, axes[handle.axis]) ?? undefined;
    if (handle.kind === 'ring') {
      const hit = rayPlane(p, d, c, axes[handle.axis]);
      if (hit) grab.prev = [hit[0] - c[0], hit[1] - c[1], hit[2] - c[2]];
    }
    return grab;
  }

  /** Drag with a triad handle: along the arrow's axis, about the arc's axis, or freely in the view plane. */
  private dragTriad(tr: TriadGrab, x: number, y: number, x0: number, y0: number): boolean {
    if (!tr.started) tr.started = tr.explode ? true : assemblyDragStart(tr.id);
    if (!tr.started) return false;
    const { o: c, axes } = tr.frame;
    const { p, d } = this.mouseRay(x, y);
    const h = tr.handle;
    // the motion: a move by `delta` and / or a turn by `angle` about `axis` through the triad centre
    let delta: Vec3 = [0, 0, 0];
    let angle = 0;
    let axis: Vec3;
    if (h.kind === 'arrow') {
      axis = axes[h.axis];
      const t = closestOnAxis(p, d, c, axis);
      if (t === null || tr.t0 === undefined) return true;
      const s = t - tr.t0;
      delta = [axis[0] * s, axis[1] * s, axis[2] * s];
    } else if (h.kind === 'ring') {
      axis = axes[h.axis];
      const hit = rayPlane(p, d, c, axis);
      if (!hit) return true;
      const u: Vec3 = [hit[0] - c[0], hit[1] - c[1], hit[2] - c[2]];
      if (tr.prev) tr.angle += wrapAngle(angleAbout(axis, tr.prev, u));
      tr.prev = u;
      angle = tr.angle;
    } else {
      const v = this.cam.camera.getWorldDirection(new THREE.Vector3());
      axis = [v.x, v.y, v.z];
      delta = this.viewPlaneDelta(x0, y0, x, y, new THREE.Vector3(...c));
    }
    if (tr.explode) {
      // exploded view: the drag is the next step
      const dist = Math.hypot(...delta);
      explodePreview(
        angle
          ? { instances: tr.explode, dir: axis, distance: 0, angle: (angle * 180) / Math.PI, pivot: c }
          : { instances: tr.explode, dir: dist > 1e-9 ? (delta.map((v) => v / dist) as Vec3) : axis, distance: dist },
      );
    } else assemblyDragMove(delta, angle, axis, c);
    return true;
  }

  /** The faces these features made (a row of the feature list under the pointer): one lit mesh per part. */
  private addFeatureHighlight(features: Set<string>, color: number) {
    for (const po of this.parts.values()) {
      const ff = po.data.faceFeatures;
      if (!ff) continue;
      const idx: number[] = [];
      ff.forEach((fid, i) => {
        if (!features.has(fid)) return;
        const s = po.data.faceRanges[i * 2];
        const c = po.data.faceRanges[i * 2 + 1];
        for (let k = s; k < s + c; k++) idx.push(po.data.indices[k]);
      });
      if (!idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', po.mesh.geometry.getAttribute('position'));
      geo.setIndex(idx);
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      );
      m.userData.sharedGeometry = true;
      this.highlightGroup.add(m);
    }
  }

  /**
   * The sketches and curves of features under the pointer in the feature list (a sketch, a Derived feature's
   * sketches, a folder's): drawn in the hover colour over everything, hidden ones too — to see where they lie.
   */
  private addSketchHover(features: Set<string>) {
    const build = useEditor.getState().build;
    if (!build) return;
    for (const s of build.sketches) {
      if (!features.has(s.featureId) && !features.has(s.featureId.split('.')[0])) continue;
      const map = entityMap(s.entities);
      const lines: number[] = [];
      const constr: number[] = [];
      const pts: [number, number][] = [];
      for (const e of s.entities) {
        if (e.type === 'point') {
          if (!e.owner) pts.push([e.x, e.y]);
          continue;
        }
        if ((e.construction && isTextPart(e.id)) || isTextBox(e)) continue;
        (e.construction ? constr : lines).push(...polylineSegments(entityPolyline(e, map)));
      }
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.copy(frameMatrix(s.frame));
      g.matrixWorldNeedsUpdate = true;
      // its regions lightly filled: where it lies shows on the parts
      let regions: SketchRegion[] = [];
      try {
        regions = computeRegions(s.entities);
      } catch {
        // curves that do not close: lines only
      }
      for (const r of regions)
        g.add(new THREE.Mesh(regionGeometry(r), new THREE.MeshBasicMaterial({ color: COLORS.hover, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, depthTest: false })));
      if (lines.length) g.add(fatSegments(lines, lineMaterial(COLORS.hover, 2.4, { depthTest: false })));
      if (constr.length) g.add(fatSegments(constr, lineMaterial(COLORS.hover, 1.2, { dashed: true, depthTest: false })));
      if (pts.length) g.add(pointsObject(pts, COLORS.hover, 6, false));
      g.traverse((o) => void (o.renderOrder = 19));
      this.highlightGroup.add(g);
    }
    // curves (a helix): as drawn
    for (const c of build.curves) {
      if (!features.has(c.featureId)) continue;
      const segs: number[] = [];
      for (let i = 0; i + 1 < c.points.length / 3; i++) segs.push(...c.points.subarray(i * 3, i * 3 + 6));
      const l = fatSegments(segs, lineMaterial(COLORS.hover, 2.4, { depthTest: false }));
      l.renderOrder = 19;
      this.highlightGroup.add(l);
    }
  }

  /** The model compared with a version: its faces new or changed since (green), the version's faces gone (red ghost). */
  private addCompare(cmp: NonNullable<EditorState['compare']>) {
    const lit = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    for (const [pid, faces] of Object.entries(cmp.changed)) {
      const po = this.parts.get(pid);
      if (!po) continue;
      const idx: number[] = [];
      for (const i of faces) {
        const s = po.data.faceRanges[i * 2];
        for (let k = s; k < s + po.data.faceRanges[i * 2 + 1]; k++) idx.push(po.data.indices[k]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', po.mesh.geometry.getAttribute('position'));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, lit(COMPARE_COLORS.changed, 0.6));
      m.userData.sharedGeometry = true;
      this.highlightGroup.add(m);
    }
    // the ghost seen through the model too: a hole filled in since is inside it
    for (const gh of cmp.ghost) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(gh.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(gh.indices, 1));
      const mat = lit(COMPARE_COLORS.removed, 0.3);
      mat.depthTest = false;
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 5;
      this.highlightGroup.add(m);
    }
  }

  /**
   * Light `r` up in `color`. `strong` — the row under the pointer in a list (a dialog's field, the instances…): brighter
   * and thicker; `faint` — the other selected items meanwhile.
   */
  private addHighlight(r: SelRef, color: number, style?: 'strong' | 'faint') {
    const g = this.highlightGroup;
    /** An opacity, a line width or a point size as the style has it. */
    const op = (v: number) => (style === 'strong' ? Math.min(0.9, v * 1.6) : style === 'faint' ? v * 0.4 : v);
    const wd = (v: number) => (style === 'strong' ? v * 1.7 : style === 'faint' ? v * 0.6 : v);
    const line = (w: number) => lineMaterial(color, wd(w), { depthTest: false, ...(style === 'faint' ? { opacity: 0.5 } : {}) });
    switch (r.kind) {
      case 'face': {
        const po = this.parts.get(r.partId);
        if (!po || r.index >= po.data.faceRanges.length / 2) return;
        const s = po.data.faceRanges[r.index * 2];
        const c = po.data.faceRanges[r.index * 2 + 1];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', po.mesh.geometry.getAttribute('position'));
        geo.setIndex(new THREE.BufferAttribute(po.data.indices.slice(s, s + c), 1));
        const m = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op(0.55), side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
        );
        m.userData.sharedGeometry = true;
        if (style === 'strong') m.renderOrder = 1;
        g.add(m);
        return;
      }
      case 'edge': {
        const po = this.parts.get(r.partId);
        if (!po || r.index >= po.data.edgeRanges.length / 2) return;
        const s = po.data.edgeRanges[r.index * 2];
        const c = po.data.edgeRanges[r.index * 2 + 1];
        const segs: number[] = [];
        for (let k = s; k + 1 < s + c; k++) segs.push(...po.data.edgePositions.subarray(k * 3, k * 3 + 6));
        const l = fatSegments(segs, line(3.5));
        l.renderOrder = style === 'strong' ? 22 : 20;
        g.add(l);
        return;
      }
      case 'vertex': {
        const po = this.parts.get(r.partId);
        const p = po ? Array.from(po.data.vertices.subarray(r.index * 3, r.index * 3 + 3)) : r.sig.center;
        const pts = new THREE.Points(
          new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3)),
          new THREE.PointsMaterial({ color, size: wd(9), sizeAttenuation: false, depthTest: false }),
        );
        pts.renderOrder = style === 'strong' ? 23 : 21;
        g.add(pts);
        return;
      }
      case 'part': {
        // a sub-assembly instance lights all its parts (`X/…`), an open composite — its bodies
        const members = useEditor.getState().build?.parts.find((p) => p.id === r.partId)?.composite?.members ?? [];
        const pos = this.parts.get(r.partId)
          ? [this.parts.get(r.partId)!]
          : [...this.parts.entries()].filter(([pid]) => pid.startsWith(`${r.partId}/`) || members.some((m) => m.id === pid)).map(([, p]) => p);
        for (const po of pos) {
          const m = new THREE.Mesh(
            po.mesh.geometry,
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op(0.4), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
          );
          m.userData.sharedGeometry = true;
          g.add(m);
        }
        return;
      }
      case 'region': {
        const sk = this.sketches.get(r.sketchId);
        const fr = sk?.res.frame;
        if (!sk || !fr) return;
        const reg = sk.regions.find((x) => x.key.ents.join() === r.key.ents.join() && Math.hypot(x.key.pt[0] - r.key.pt[0], x.key.pt[1] - r.key.pt[1]) < 1e-6) ??
          sk.regions.find((x) => x.key.ents.join() === r.key.ents.join());
        if (!reg) return;
        const m = new THREE.Mesh(
          regionGeometry(reg),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op(0.55), side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
        );
        m.matrixAutoUpdate = false;
        m.matrix.copy(frameMatrix(fr));
        m.matrixWorldNeedsUpdate = true;
        m.renderOrder = style === 'strong' ? 16 : 15;
        g.add(m);
        return;
      }
      case 'sketchEntity': {
        const curve = this.curveSegs.get(r.sketchId);
        if (curve) {
          const obj = fatSegments(curve, line(3.5));
          obj.renderOrder = style === 'strong' ? 22 : 20;
          g.add(obj);
          return;
        }
        const sk = this.sketches.get(r.sketchId);
        if (sk) {
          const e = sk.map.get(r.entityId);
          if (!e) return;
          let obj: THREE.Object3D;
          if (e.type === 'point') obj = pointsObject([[e.x, e.y]], color, wd(10), false);
          else obj = fatSegments(polylineSegments(entityPolyline(e, sk.map)), line(3.5));
          obj.matrixAutoUpdate = false;
          obj.matrix.copy(frameMatrix(sk.res.frame));
          obj.matrixWorldNeedsUpdate = true;
          obj.renderOrder = style === 'strong' ? 22 : 20;
          g.add(obj);
        }
        return;
      }
      case 'plane': {
        const mate = this.mateFrames.get(r.planeId);
        if (mate) {
          g.add(mateTriad(mate, color));
          return;
        }
        const f = this.planeFrame(r.planeId);
        if (!f) return;
        const size = f.size;
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(size, size),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op(0.22), side: THREE.DoubleSide, depthWrite: false }),
        );
        m.matrixAutoUpdate = false;
        m.matrix.copy(frameMatrix(f.frame));
        m.matrixWorldNeedsUpdate = true;
        g.add(m);
        return;
      }
      case 'origin': {
        const pts = new THREE.Points(
          new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
          new THREE.PointsMaterial({ color, size: wd(11), sizeAttenuation: false, depthTest: false }),
        );
        pts.renderOrder = 21;
        g.add(pts);
      }
    }
  }

  planeFrame(id: string): { frame: PlaneFrame; size: number } | null {
    if (id === 'top' || id === 'front' || id === 'right') return { frame: STD_PLANES[id], size: this.defaultPlaneSize() };
    return this.planeFrames.get(id) ?? null;
  }

  /** Frame of the sketch being edited (or of any sketch feature). */
  sketchFrame(featureId: string): PlaneFrame | null {
    const ed = useEditor.getState();
    const d = ed.editing?.draft;
    if (d && d.id === featureId && d.type === 'sketch') {
      const pl = d.params.plane;
      if (pl.kind === 'std') return STD_PLANES[pl.name];
      if (pl.kind === 'feature') return this.planeFrames.get(pl.featureId)?.frame ?? sketchFrames.get(featureId) ?? null;
      // the face as currently built (the plane may just have been changed in the sketch dialog)
      if (pl.ref.kind === 'face') {
        const info = this.parts.get(pl.ref.partId)?.data.faces[pl.ref.index];
        if (info?.normal) return frameFromNormal(v3.scale(info.normal, v3.dot(info.center, info.normal)), info.normal);
      }
      const cached = sketchFrames.get(featureId);
      if (cached) return cached;
      if (pl.ref.kind === 'face' && pl.ref.sig.normal) {
        const n = pl.ref.sig.normal;
        return frameFromNormal(v3.scale(n, v3.dot(pl.ref.sig.center, n)), n);
      }
      return null;
    }
    return sketchFrames.get(featureId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  /** Convert a pick item into a persistent reference. */
  toRef(item: PickItem): SelRef | null {
    switch (item.t) {
      case 'face': {
        const p = this.parts.get(item.partId);
        if (!p) return null;
        return { kind: 'face', partId: item.partId, index: item.index, sig: faceSig(p.data.faces[item.index], p.data.bbox) };
      }
      case 'edge': {
        const p = this.parts.get(item.partId);
        if (!p) return null;
        return { kind: 'edge', partId: item.partId, index: item.index, sig: edgeSig(p.data.edges[item.index], p.data.bbox) };
      }
      case 'vertex': {
        const p = this.parts.get(item.partId);
        if (!p) return null;
        const c = Array.from(p.data.vertices.subarray(item.index * 3, item.index * 3 + 3)) as Vec3;
        return { kind: 'vertex', partId: item.partId, index: item.index, sig: vertexSig(c, p.data.bbox) };
      }
      case 'region':
        return { kind: 'region', sketchId: item.sketchId, key: item.region.key };
      case 'skEnt':
        return { kind: 'sketchEntity', sketchId: item.sketchId, entityId: item.entityId };
      case 'plane':
        return { kind: 'plane', planeId: item.planeId };
      case 'mate':
        // mate connectors are referenced like planes (XY plane, Z axis, origin point)
        return { kind: 'plane', planeId: item.featureId };
      case 'origin':
        return { kind: 'origin' };
      default:
        return null;
    }
  }

  private entType(item: PickItem): string | undefined {
    return item.t === 'skEnt' ? item.entType : undefined;
  }

  /** World geometry of a reference for sketch "Use" (main-thread copy of the kernel logic). */
  /** World plane (normal, point) of a planar face or a plane reference; null otherwise. */
  planeOf(ref: SelRef): { normal: Vec3; origin: Vec3 } | null {
    if (ref.kind === 'plane') {
      const f = ref.planeId === 'top' || ref.planeId === 'front' || ref.planeId === 'right' ? STD_PLANES[ref.planeId] : this.planeFrames.get(ref.planeId)?.frame;
      return f ? { normal: f.normal, origin: f.origin } : null;
    }
    if (ref.kind === 'face') {
      const info = this.parts.get(ref.partId)?.data.faces[ref.index];
      return info?.type === 'PLANE' && info.normal ? { normal: info.normal, origin: info.center } : null;
    }
    return null;
  }

  /** Extent of the model along a direction from a point (section slider range). */
  extentAlong(normal: Vec3, origin: Vec3): [number, number] {
    const box = this.fitBox();
    if (box.isEmpty()) return [-50, 50];
    const n = new THREE.Vector3(...normal).normalize();
    const o = new THREE.Vector3(...origin);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      const d = c.sub(o).dot(n);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    return [lo, hi];
  }

  /** Edge references bounding a face (seams excluded), for "Use" of a whole face. */
  faceEdgeRefs(ref: SelRef): SelRef[] {
    if (ref.kind !== 'face') return [];
    const po = this.parts.get(ref.partId);
    const info = po?.data.faces[ref.index];
    if (!po || !info?.edges) return [];
    return info.edges
      .filter((i) => !po.data.edges[i]?.seam)
      .map((i) => ({ kind: 'edge' as const, partId: ref.partId, index: i, sig: edgeSig(po.data.edges[i], po.data.bbox) }));
  }

  worldGeometry(ref: SelRef): WorldGeom | null {
    if (ref.kind === 'origin') return { kind: 'point', p: [0, 0, 0] };
    if (ref.kind === 'vertex') {
      const po = this.parts.get(ref.partId);
      if (!po) return null;
      return { kind: 'point', p: Array.from(po.data.vertices.subarray(ref.index * 3, ref.index * 3 + 3)) as Vec3 };
    }
    if (ref.kind === 'edge') {
      const po = this.parts.get(ref.partId);
      return po ? edgeGeometry(po.data, ref.index) : null;
    }
    if (ref.kind === 'sketchEntity') {
      const curve = this.curveSegs.get(ref.sketchId);
      if (curve) {
        const pts: Vec3[] = [];
        for (let i = 0; i < curve.length; i += 6) pts.push([curve[i], curve[i + 1], curve[i + 2]]);
        if (curve.length >= 6) pts.push(curve.slice(-3) as Vec3);
        return { kind: 'poly', pts };
      }
      const sk = this.sketches.get(ref.sketchId);
      const e = sk?.map.get(ref.entityId);
      if (!sk || !e) return null;
      const f = sk.res.frame;
      const W = (p: [number, number]) => toWorld(f, p);
      switch (e.type) {
        case 'point':
          return { kind: 'point', p: W([e.x, e.y]) };
        case 'line':
          return { kind: 'line', a: W(pointOf(sk.map, e.p1)), b: W(pointOf(sk.map, e.p2)) };
        case 'circle':
          return { kind: 'circle', c: W(pointOf(sk.map, e.c)), r: e.r, axis: f.normal };
        case 'arc': {
          const a = arcAngles(e, sk.map);
          const P = (t: number): [number, number] => [a.c[0] + a.r * Math.cos(t), a.c[1] + a.r * Math.sin(t)];
          return { kind: 'arc', c: W(a.c), r: a.r, axis: f.normal, start: W(P(a.a0)), mid: W(P((a.a0 + a.a1) / 2)), end: W(P(a.a1)) };
        }
        default:
          return { kind: 'poly', pts: entityPolyline(e, sk.map).map(W) };
      }
    }
    return null;
  }

  /** Raw pick in the given scene. */
  pickRaw(x: number, y: number, scene: THREE.Scene = this.pickScene) {
    return this.picker.pick(this.renderer, scene, this.cam.camera, x, y, this.width, this.height);
  }

  /** Pick a model reference at pixel, honouring the accepted tokens of the active field. */
  pickRef(x: number, y: number, accepts?: SelToken[]): SelRef | null {
    const found = this.pickRaw(x, y);
    const candidates: { ref: SelRef; priority: number; dist: number }[] = [];
    for (const [id, dist] of found) {
      const item = this.registry.get(id);
      if (!item || item.t === 'edit' || item.t === 'editRegion') continue;
      if (dist > (item.radius ?? 6)) continue;
      let ref = this.toRef(item);
      if (!ref) continue;
      if (accepts) {
        ref = adaptRef(ref, accepts, { sketchType: this.entType(item), mate: item.t === 'mate' });
        if (!ref) continue;
      }
      candidates.push({ ref, priority: item.priority, dist });
    }
    candidates.sort((a, b) => b.priority - a.priority || a.dist - b.dist);
    return candidates[0]?.ref ?? null;
  }

  pickEditItem(x: number, y: number): PickItem | null {
    const hit = bestHit(this.pickRaw(x, y), this.registry);
    return hit?.item ?? null;
  }

  private activeAccepts(): SelToken[] | undefined {
    const ed = useEditor.getState();
    if (!ed.editing || !ed.activeField || ed.editing.draft.type === 'sketch') return undefined;
    return FIELD_SPECS[ed.editing.draft.type]?.[ed.activeField]?.accepts;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  localPos(e: MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('dblclick', (e) => this.onDblClick(e));
    el.addEventListener('pointerleave', () => {
      if (!this.down) {
        useEditor.getState().setHover(null);
        this.sketchEditor.onLeave();
        if (this.triad?.hover) {
          this.triad.hover = null;
          this.drawTriad();
        }
      }
    });
    this.unsub.push(() => {
      window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerup', this.onUp);
    });
  }

  private onDown(e: PointerEvent) {
    const { x, y } = this.localPos(e);
    this.down = { x, y, button: e.button, ctrl: e.ctrlKey || e.metaKey, moved: false };
    this.lastPos = { x, y };
    useEditor.setState({ contextMenu: null });
    if (e.button === 2 && !this.down.ctrl) {
      // pivot: point under cursor if on geometry, else target
      const hit = this.raycastParts(x, y);
      if (hit) this.down.pivot = hit;
    }
    if (e.button === 0 && this.sketchEditor.active) this.sketchEditor.onPointerDown(x, y, e);
    const handle = e.button === 0 && !this.sketchEditor.active ? this.pickTriad(x, y) : null;
    if (handle) {
      this.down.triad = this.grabTriad(handle, x, y) ?? undefined;
      return;
    }
    if (e.button === 0 && !e.altKey && !this.sketchEditor.active && !assemblyHandsOff() && activeAssembly(useDoc.getState().doc)) {
      // assembly: a part can be dragged (it moves as far as its mates allow)
      const ref = this.pickRef(x, y, this.activeAccepts());
      if (ref && (ref.kind === 'face' || ref.kind === 'edge' || ref.kind === 'vertex' || ref.kind === 'part')) {
        const box = this.parts.get(ref.partId)?.data.bbox;
        const anchor =
          this.raycastParts(x, y) ?? (box ? new THREE.Vector3((box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, (box[0][2] + box[1][2]) / 2) : new THREE.Vector3());
        // a part of a rigid sub-assembly drags the whole sub-assembly, of a flexible one — itself
        this.down.part = { id: dragInstance(ref.partId)?.id ?? topInstance(ref.partId), anchor, started: false };
      }
    }
    if (e.button === 1) e.preventDefault();
  }

  /** An assembly instance under the cursor that a drag would move (not fixed, no mate dialog open). */
  private draggableInstance(ref: SelRef): boolean {
    if (ref.kind !== 'face' && ref.kind !== 'edge' && ref.kind !== 'vertex' && ref.kind !== 'part') return false;
    const inst = dragInstance(ref.partId);
    return !!inst && !inst.fixed && !assemblyHandsOff();
  }

  /** World displacement in the view plane through `anchor` between two screen points. */
  private viewPlaneDelta(x0: number, y0: number, x1: number, y1: number, anchor: THREE.Vector3): Vec3 {
    const n = this.cam.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, anchor);
    const hit = (x: number, y: number) => {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.cam.camera);
      return rc.ray.intersectPlane(plane, new THREE.Vector3());
    };
    const a = hit(x0, y0);
    const b = hit(x1, y1);
    return a && b ? [b.x - a.x, b.y - a.y, b.z - a.z] : [0, 0, 0];
  }

  private onMove = (e: PointerEvent) => {
    const { x, y } = this.localPos(e);
    const d = this.down;
    if (d) {
      const dx = x - this.lastPos.x;
      const dy = y - this.lastPos.y;
      if (!d.moved && Math.hypot(x - d.x, y - d.y) > 3) d.moved = true;
      this.lastPos = { x, y };
      if (!d.moved) return;
      if (d.button === 2 && !d.ctrl) {
        this.applyCursor(ROTATE_CURSOR);
        this.cam.rotate(dx, dy, d.pivot);
      } else if (d.button === 1 || (d.button === 2 && d.ctrl)) {
        this.applyCursor('grabbing');
        this.cam.pan(dx, dy);
      }
      else if (d.button === 0 && this.sketchEditor.active) this.sketchEditor.onPointerDrag(x, y, e);
      else if (d.button === 0 && d.triad) {
        if (this.dragTriad(d.triad, x, y, d.x, d.y)) this.applyCursor('grabbing');
        else d.triad = undefined;
      } else if (d.button === 0 && d.part) {
        if (!d.part.started) d.part.started = assemblyDragStart(d.part.id);
        if (!d.part.started) {
          d.part = undefined;
          return;
        }
        this.applyCursor('grabbing');
        const a = d.part.anchor;
        const axis = this.cam.camera.getWorldDirection(new THREE.Vector3());
        // Shift: turn about the view direction through the grab point; otherwise move in the view plane
        if (e.shiftKey) assemblyDragMove([0, 0, 0], (x - d.x) * 0.01, [axis.x, axis.y, axis.z], [a.x, a.y, a.z]);
        else assemblyDragMove(this.viewPlaneDelta(d.x, d.y, x, y, a), 0, [axis.x, axis.y, axis.z], [a.x, a.y, a.z]);
      }
      return;
    }
    if (e.target !== this.renderer.domElement) return;
    if (this.sketchEditor.active) {
      this.sketchEditor.onPointerMove(x, y, e);
      return;
    }
    if (this.triad) {
      const h = this.pickTriad(x, y);
      const key = h ? handleKey(h) : null;
      if (key !== this.triad.hover) {
        this.triad.hover = key;
        this.drawTriad();
      }
      if (h) {
        useEditor.getState().setHover(null);
        this.setCursor('grab');
        return;
      }
    }
    const ref = this.pickRef(x, y, this.activeAccepts());
    useEditor.getState().setHover(ref);
    this.setCursor(ref ? (this.draggableInstance(ref) ? 'grab' : 'pointer') : '');
    this.updateMateInference(ref, x, y, e.shiftKey);
  };

  // -------------------------------------------------------------------------
  // Mate connector inference points (Onshape): hovering a face / edge in the "Location" field
  // shows where a connector can go; the nearest point is highlighted and a click picks it.
  // -------------------------------------------------------------------------

  private inferGroup = new THREE.Group();
  private mateBest: MateCandidate | null = null;
  /** Candidates of the hovered entity; kept while Shift is held (Onshape "lock inference"). */
  private mateCands: MateCandidate[] = [];

  /** The mate connector location field being picked ('location' / 'location2'), if any. */
  private mateLocationField(): 'location' | 'location2' | null {
    const ed = useEditor.getState();
    if (ed.editing?.draft.type !== 'mateConnector') return null;
    return ed.activeField === 'location' || ed.activeField === 'location2' ? ed.activeField : null;
  }

  private mateLocationActive(): boolean {
    return this.mateLocationField() !== null;
  }

  private mateCandidates(ref: SelRef): MateCandidate[] {
    const out: MateCandidate[] = [];
    const push = (pos: Vec3, loc: SelRef, inference: MateInference, orient?: SelRef) => {
      if (!out.some((c) => v3.dist(c.pos, pos) < 1e-6)) out.push({ pos, loc, inference, orient });
    };
    if (ref.kind === 'face' || ref.kind === 'edge') {
      const po = this.parts.get(ref.partId);
      if (!po) return out;
      const edgeRef = (i: number): SelRef => ({ kind: 'edge', partId: ref.partId, index: i, sig: edgeSig(po.data.edges[i], po.data.bbox) });
      const edgePoints = (i: number, orient?: SelRef) => {
        const e = po.data.edges[i];
        if (!e || e.seam) return;
        const r = edgeRef(i);
        if (e.circleCenter && e.axis) push(e.circleCenter, r, 'center', orient);
        if (!e.closed) {
          push(e.start, r, 'start', orient);
          push(e.end, r, 'end', orient);
        }
        push(e.center, r, 'mid', orient);
      };
      if (ref.kind === 'edge') {
        edgePoints(ref.index);
        return out;
      }
      const info = po.data.faces[ref.index];
      if (!info) return out;
      if (info.type === 'PLANE') {
        // centroid first, then arc / hole centres, vertices and edge midpoints of the face
        push(info.center, ref, 'centroid');
        for (const i of info.edges ?? []) edgePoints(i, ref);
      } else if (info.type === 'SPHERE' && info.axisPoint) {
        push(info.axisPoint, ref, 'center');
      } else if (info.axis && info.axisPoint) {
        // cylinder / cone / torus: points on the axis
        const ts = (info.edges ?? []).flatMap((i) => {
          const e = po.data.edges[i];
          return e ? [e.start, e.end, e.center].map((p) => v3.dot(v3.sub(p, info.axisPoint!), info.axis!)) : [];
        });
        if (ts.length) {
          const at = (t: number) => v3.add(info.axisPoint!, v3.scale(info.axis!, t));
          const lo = Math.min(...ts);
          const hi = Math.max(...ts);
          push(at((lo + hi) / 2), ref, 'mid');
          push(at(lo), ref, 'start');
          push(at(hi), ref, 'end');
        }
      } else push(info.center, ref, 'default');
    } else if (ref.kind === 'vertex') {
      const po = this.parts.get(ref.partId);
      if (po) push(Array.from(po.data.vertices.subarray(ref.index * 3, ref.index * 3 + 3)) as Vec3, ref, 'default');
    }
    return out;
  }

  private updateMateInference(ref: SelRef | null, x: number, y: number, lock = false) {
    this.clearGroup(this.inferGroup);
    this.mateBest = null;
    if (!this.mateLocationActive() || (!ref && !(lock && this.mateCands.length))) {
      this.mateCands = [];
      this.requestRender();
      return;
    }
    // Shift keeps the points of the entity hovered before, so the cursor can travel to them
    const cands = lock && this.mateCands.length ? this.mateCands : this.mateCandidates(ref!);
    this.mateCands = cands;
    if (!cands.length) return;
    let bestD = Infinity;
    for (const c of cands) {
      const v = new THREE.Vector3(...c.pos).project(this.cam.camera);
      const d = Math.hypot(((v.x + 1) / 2) * this.width - x, ((1 - v.y) / 2) * this.height - y);
      if (d < bestD) {
        bestD = d;
        this.mateBest = c;
      }
    }
    const dots = (pts: Vec3[], color: number, size: number) => {
      const o = new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)),
        new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }),
      );
      o.renderOrder = 40;
      this.inferGroup.add(o);
    };
    dots(cands.map((c) => c.pos), 0x2b3138, 7);
    if (this.mateBest) {
      dots([this.mateBest.pos], 0xff8c2a, 13);
      // preview of the connector at the highlighted point
      const z = this.mateBest.orient && this.mateBest.orient.kind === 'face' ? this.parts.get(this.mateBest.orient.partId)?.data.faces[this.mateBest.orient.index]?.normal : undefined;
      const f = frameFromNormal(this.mateBest.pos, z ?? this.inferNormal(this.mateBest));
      this.inferGroup.add(mateTriad(f, 0xff8c2a));
    }
    this.requestRender();
  }

  /** Z axis implied by a candidate without an orienting face. */
  private inferNormal(c: MateCandidate): Vec3 {
    const r = c.loc;
    if (r.kind === 'face') {
      const info = this.parts.get(r.partId)?.data.faces[r.index];
      return info?.axis ?? info?.normal ?? [0, 0, 1];
    }
    if (r.kind === 'edge') {
      const e = this.parts.get(r.partId)?.data.edges[r.index];
      return e?.axis ?? e?.dir ?? [0, 0, 1];
    }
    return [0, 0, 1];
  }

  /** Cursor wanted by the current tool / hover; camera drags temporarily override it. */
  private cursorWanted = '';

  setCursor(c: string) {
    this.cursorWanted = c;
    const d = this.down;
    if (!d || !d.moved || d.button === 0) this.applyCursor(c);
  }

  private applyCursor(c: string) {
    const st = this.renderer.domElement.style;
    if (st.cursor !== c) st.cursor = c;
  }

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (d.moved && d.button !== 0) this.applyCursor(this.cursorWanted);
    const { x, y } = this.localPos(e);
    if (d.part?.started || d.triad) {
      if (d.triad?.explode) {
        // exploded view: the dragged step joins the view
        if (d.triad.started) explodeCommit();
      } else if (d.part?.started || d.triad?.started) assemblyDragEnd();
      // a click on the triad keeps the selection: Alt+click on the ball puts the triad back, on an arrow / arc
      // asks for a distance / angle
      else if (d.triad && !d.moved) {
        if (e.altKey) this.moveTriadTo(x, y);
        else this.openTriadInput(d.triad.handle, x, y);
      }
      this.applyCursor(this.cursorWanted);
      return;
    }
    if (d.button === 0) {
      if (this.sketchEditor.active) {
        this.sketchEditor.onPointerUp(x, y, e, d.moved);
        return;
      }
      // Alt+click on the selected instance moves its triad there
      if (!d.moved && e.altKey && this.moveTriadTo(x, y)) return;
      if (!d.moved) this.onClick(x, y, e);
    } else if (d.button === 2 && !d.moved) {
      this.onContextMenu(e);
    }
  };

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const { x, y } = this.localPos(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.cam.zoomAt(Math.exp(delta * 0.0015), x, y);
  }

  private onDblClick(e: MouseEvent) {
    if (this.sketchEditor.active) {
      const { x, y } = this.localPos(e);
      this.sketchEditor.onDoubleClick(x, y);
      return;
    }
    if (e.button === 1) this.cam.fit(this.fitBox());
  }

  private onClick(x: number, y: number, e: MouseEvent) {
    const ed = useEditor.getState();
    const accepts = this.activeAccepts();
    const ref = this.pickRef(x, y, accepts);
    const mateField = this.mateLocationField();
    if (mateField && (ref || (e.shiftKey && this.mateCands.length))) {
      // a mate connector location: the highlighted inference point, else the entity itself
      this.updateMateInference(ref, x, y, e.shiftKey);
      const best = this.mateBest;
      const loc = best?.loc ?? ref;
      if (!loc) return;
      const second = mateField === 'location2';
      ed.updateDraft((f) => {
        if (f.type !== 'mateConnector') return;
        const p = f.params;
        const inference = best?.inference ?? 'default';
        const orient = best?.orient ? [best.orient as Draft<SelRef>] : [];
        if (second) {
          p.location2 = [loc as Draft<SelRef>];
          p.inference2 = inference;
          p.orientFace2 = orient;
        } else {
          p.location = [loc as Draft<SelRef>];
          p.inference = inference;
          p.orientFace = orient;
        }
      });
      // "Between entities": continue with the second location
      if (!second && ed.editing?.draft.type === 'mateConnector' && ed.editing.draft.params.mode === 'between') ed.setActiveField('location2');
      this.clearGroup(this.inferGroup);
      this.mateBest = null;
      this.mateCands = [];
      return;
    }
    if (ed.editing && ed.activeField && ed.editing.draft.type !== 'sketch') {
      if (ref) ed.pickIntoField(ref);
      return;
    }
    if (!ref) {
      if (!e.shiftKey) ed.clearSelection();
      return;
    }
    ed.select(ref, true);
  }

  /** The view cube's menu (Onshape): the standard views, the axonometric ones, fit and perspective. */
  private viewCubeMenu(x: number, y: number) {
    const ed = useEditor.getState();
    const std = (view: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso' | 'dimetric' | 'trimetric', label: string, shortcut?: string) => ({
      label: t(label),
      shortcut,
      action: () => ed.view({ kind: 'std', view }),
    });
    useEditor.setState({
      contextMenu: {
        x,
        y,
        items: [
          std('front', 'Front', 'Shift+1'),
          std('back', 'Back', 'Shift+2'),
          std('left', 'Left', 'Shift+3'),
          std('right', 'Right', 'Shift+4'),
          std('top', 'Top', 'Shift+5'),
          std('bottom', 'Bottom', 'Shift+6'),
          { separator: true, label: '' },
          std('iso', 'Isometric'),
          std('dimetric', 'Dimetric'),
          std('trimetric', 'Trimetric'),
          { separator: true, label: '' },
          { label: t('Zoom to fit'), icon: 'zoomFit', shortcut: 'F', action: () => this.cam.fit(this.fitBox()) },
          { label: t('Perspective'), icon: ed.perspective ? 'check' : undefined, action: () => useEditor.setState({ perspective: !useEditor.getState().perspective }) },
        ],
      },
    });
  }

  private onContextMenu(e: MouseEvent) {
    const { x, y } = this.localPos(e);
    const ed = useEditor.getState();
    const ref = this.pickRef(x, y);
    const items: NonNullable<ReturnType<typeof useEditor.getState>['contextMenu']>['items'] = [];
    if (this.sketchEditor.active) {
      this.sketchEditor.onContextMenu(e.clientX, e.clientY, x, y);
      return;
    }
    if (ref) {
      if (!ed.selection.some((r) => sameRef(r, ref))) ed.setSelection([ref]);
      const planar = (ref.kind === 'face' && ref.sig.type === 'PLANE') || ref.kind === 'plane';
      if (planar) {
        items.push({ label: t('New sketch'), icon: 'sketch', shortcut: 'Shift+S', action: () => ed.startFeature('sketch') });
        items.push({
          label: t('View normal to'), icon: 'viewNormal', shortcut: 'N',
          action: () => {
            const f = ref.kind === 'plane' ? this.planeFrame(ref.planeId)?.frame : null;
            const n = ref.kind === 'face' ? ref.sig.normal! : f!.normal;
            const c = ref.kind === 'face' ? ref.sig.center : f!.origin;
            const up = f ? f.yDir : frameFromNormal(c, n).yDir;
            ed.view({ kind: 'normal', normal: n, up, center: c });
          },
        });
      }
      if (ref.kind === 'region' || ref.kind === 'sketchEntity') {
        const sid = ref.sketchId;
        items.push({ label: t('Edit'), icon: 'edit', action: () => ed.editFeature(sid) });
      }
      if (ref.kind === 'face' || ref.kind === 'edge' || ref.kind === 'vertex') {
        const pid = ref.partId;
        items.push({
          label: t('Hide'), icon: 'eyeOff',
          action: () =>
            useDoc.getState().update((d) => {
              const s = d.tabs.find((tb) => tb.id === d.activeTab);
              if (s && s.type === 'partStudio') s.parts[pid] = { ...(s.parts[pid] ?? {}), hidden: true };
            }),
        });
        items.push({ label: t('Mass properties'), icon: 'massProps', action: () => ed.setSelection([{ kind: 'part', partId: pid }]) });
        items.push({ label: t('Material…'), icon: 'massProps', action: () => useEditor.setState({ materialOpen: { partIds: [pid] } }) });
      }
      items.push({ separator: true, label: '' });
    }
    items.push({ label: t('Zoom to fit'), icon: 'zoomFit', shortcut: 'F', action: () => this.cam.fit(this.fitBox()) });
    items.push({
      label: t(ed.showPlanes ? 'Hide planes' : 'Show planes'),
      icon: 'planeItem',
      shortcut: 'P',
      action: () => useEditor.setState({ showPlanes: !useEditor.getState().showPlanes }),
    });
    useEditor.setState({ contextMenu: { x: e.clientX, y: e.clientY, items } });
  }

  raycastParts(x: number, y: number): THREE.Vector3 | null {
    const rc = new THREE.Raycaster();
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    rc.setFromCamera(ndc, this.cam.camera);
    const meshes = [...this.parts.values()].map((p) => p.mesh);
    const hits = rc.intersectObjects(meshes, false);
    return hits[0]?.point ?? null;
  }

  private runView(cmd: import('../store/editorStore').ViewCommand) {
    switch (cmd.kind) {
      case 'std':
        this.cam.setStdView(cmd.view, this.fitBox());
        break;
      case 'fit':
        this.cam.fit(this.fitBox());
        break;
      case 'normal':
        this.cam.normalTo(cmd.normal, cmd.up, cmd.center);
        break;
      case 'rotate': {
        const hAxis = this.cam.rotationMode === 'turntable' ? new THREE.Vector3(0, 0, 1) : this.cam.up;
        const axis = cmd.axis === 'h' ? hAxis : cmd.axis === 'v' ? this.cam.right : this.cam.viewDir;
        this.cam.rotateAbout(axis, THREE.MathUtils.degToRad(cmd.deg));
        break;
      }
      case 'zoom':
        this.cam.zoomAt(cmd.factor);
        break;
    }
  }

  /**
   * PNG thumbnail for the documents page (`w` × `h`, the card at 2×): the parts alone (no planes, origin, sketches,
   * connectors, selection) — the sketches if there are no parts, nothing ('') if neither — in an isometric view fitted
   * to them, rendered off screen at twice the size with multisampling and scaled down, edges as thick as on screen.
   */
  thumbnail(w = 480, h = 280): string {
    const visible = (g: THREE.Object3D) => {
      const box = new THREE.Box3();
      g.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine) box.expandByObject(o);
      });
      return box;
    };
    let box = visible(this.partsGroup);
    const sketchesOnly = box.isEmpty();
    if (sketchesOnly) box = visible(this.sketchGroup);
    if (box.isEmpty()) return '';
    // everything else out of the picture for a moment
    const keep = sketchesOnly ? this.sketchGroup : this.partsGroup;
    const hidden = this.scene.children.filter((o) => o.visible && o !== keep && !(o as THREE.Light).isLight);
    for (const o of hidden) o.visible = false;
    // an isometric orthographic camera around the box, a little margin
    // `dir` points from the model towards the camera
    const { dir, up } = stdViewAxes('iso');
    const view = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(view, up).normalize();
    const camUp = new THREE.Vector3().crossVectors(right, view).normalize();
    // the frame of what is actually seen: the meshes' (and lines') points projected on the screen axes
    const lo = new THREE.Vector2(Infinity, Infinity);
    const hi = new THREE.Vector2(-Infinity, -Infinity);
    const p = new THREE.Vector3();
    keep.traverseVisible((o) => {
      const pos = ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine ? (o as THREE.Mesh).geometry?.getAttribute('position') : null) as THREE.BufferAttribute | null;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const x = p.dot(right);
        const y = p.dot(camUp);
        lo.set(Math.min(lo.x, x), Math.min(lo.y, y));
        hi.set(Math.max(hi.x, x), Math.max(hi.y, y));
      }
    });
    const boxCenter = box.getCenter(new THREE.Vector3());
    const center = Number.isFinite(lo.x)
      ? boxCenter
          .clone()
          .addScaledVector(right, (lo.x + hi.x) / 2 - boxCenter.dot(right))
          .addScaledVector(camUp, (lo.y + hi.y) / 2 - boxCenter.dot(camUp))
      : boxCenter;
    const hw = Number.isFinite(lo.x) ? (hi.x - lo.x) / 2 : box.getSize(new THREE.Vector3()).length() / 2;
    const hh = Number.isFinite(lo.y) ? (hi.y - lo.y) / 2 : hw;
    const aspect = w / h;
    const half = Math.max(hh, hw / aspect, 1e-6) * 1.1;
    const radius = box.getSize(new THREE.Vector3()).length() + 1;
    const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.01, radius * 8);
    cam.up.copy(camUp);
    cam.position.copy(center).addScaledVector(dir, radius * 3);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    this.headlight.position.copy(cam.position);
    this.headlight.target.position.copy(center);
    // twice the size, multisampled; fat lines keep their on-screen width in the final picture
    const W = w * 2;
    const H = h * 2;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    setLineResolution(w, h);
    const pixels = new Uint8Array(W * H * 4);
    try {
      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.scene, cam);
      this.renderer.readRenderTargetPixels(rt, 0, 0, W, H, pixels);
    } finally {
      this.renderer.setRenderTarget(null);
      rt.dispose();
      setLineResolution(this.width, this.height);
      for (const o of hidden) o.visible = true;
      this.requestRender();
    }
    // rows come bottom up
    const big = document.createElement('canvas');
    big.width = W;
    big.height = H;
    const img = big.getContext('2d')!.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    big.getContext('2d')!.putImageData(img, 0, 0);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(big, 0, 0, w, h);
    return c.toDataURL('image/png');
  }
}
