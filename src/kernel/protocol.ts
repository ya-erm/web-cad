// Messages exchanged between the UI thread and the geometry worker.

import type {
  BoolOp,
  CadDocument,
  Feature,
  PlaneFrame,
  SelRef,
  SkEntity,
  Vec2,
  Vec3,
  ViewOrientation,
  ViewRef,
} from '../core/types';

export interface FaceInfo {
  type: string;
  center: Vec3;
  normal?: Vec3;
  area: number;
  radius?: number;
  /** Axis direction for cylinders/cones/spheres/tori. */
  axis?: Vec3;
  /** A point on the axis for revolved surfaces. */
  axisPoint?: Vec3;
  /** Indices (into the part's edges) of the edges bounding this face. */
  edges?: number[];
  /** Cone: half-angle (radians, > 0) and apex; `axis` then points from the apex into the cone. */
  semiAngle?: number;
  apex?: Vec3;
  /** Torus: radius of the tube's centre circle and of the tube; a point of the tube's centre circle. */
  majorRadius?: number;
  minorRadius?: number;
  tubePoint?: Vec3;
}

export interface EdgeInfo {
  type: string;
  /** Point at mid-parameter. */
  center: Vec3;
  start: Vec3;
  end: Vec3;
  length: number;
  /** Direction of straight edges. */
  dir?: Vec3;
  radius?: number;
  circleCenter?: Vec3;
  axis?: Vec3;
  closed?: boolean;
  /** Seam of a periodic surface (bounded by one face only): not drawn. */
  seam?: boolean;
}

export interface PartMesh {
  id: string;
  name: string;
  color: string;
  hidden: boolean;
  /** Brought from another Part Studio (Derived): its colour is the source's, not a palette colour. */
  derived?: boolean;
  /** A surface body (faces with no solid): no volume, listed under Surfaces. */
  surface?: boolean;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** (start, count) pairs into `indices` for each face index. */
  faceRanges: Int32Array;
  edgePositions: Float32Array;
  /** (start, count) pairs of vertices in `edgePositions` (line segments) for each edge index. */
  edgeRanges: Int32Array;
  vertices: Float32Array;
  faces: FaceInfo[];
  edges: EdgeInfo[];
  bbox: [Vec3, Vec3];
  /** The feature that made each face (by face index): hovering a face highlights it in the feature list. */
  faceFeatures?: string[];
  /**
   * What its mesh is of: the same key — the same shape at the same quality (the part did not change), so the graphics
   * keep what they made of it.
   */
  meshKey?: string;
}

export interface SketchResult {
  featureId: string;
  frame: PlaneFrame;
  /** Entities after re-solving with current variable values. */
  entities: SkEntity[];
  ok: boolean;
  /** Its feature's name; a sketch brought by a Derived feature (its key "derivedId.sketchId") — its name in the source. */
  name?: string;
}

export interface PlaneResult {
  featureId: string;
  name: string;
  frame: PlaneFrame;
  size: number;
}

/** Mate connector frame (normal = Z axis). */
export interface MateResult {
  featureId: string;
  name: string;
  frame: PlaneFrame;
  /** Owner part id, if any. */
  owner?: string;
}

export interface CurveResult {
  featureId: string;
  name: string;
  points: Float32Array;
}

/** A cosmetic thread (a tapped hole's): drawn as thin lines at its major diameter. */
export interface ThreadResult {
  key: string;
  featureId: string;
  origin: Vec3;
  /** Into the material. */
  dir: Vec3;
  major: number;
  minor: number;
  length: number;
  designation: string;
  owner?: string;
}

export interface FeatureStatus {
  ok: boolean;
  error?: string;
  warning?: string;
}

export interface PreviewResult {
  status: FeatureStatus;
  /** Parts as they would be after the edited feature (only new or modified ones). */
  parts: PartMesh[];
  /** Ids of base parts modified/removed by the feature. */
  changed: string[];
  /** Tool body (extrude/revolve/… / hole) for colouring by boolean operation. */
  tool?: PartMesh;
  op?: BoolOp;
  planes?: PlaneResult[];
  curves?: CurveResult[];
  mates?: MateResult[];
  /** Sketches the feature brings (Derived). */
  sketches?: SketchResult[];
  /** Cosmetic threads it makes (a tapped hole). */
  threads?: ThreadResult[];
}

export interface BuildRequest {
  type: 'build';
  reqId: number;
  units: CadDocument['units'];
  features: Feature[];
  partMeta: Record<string, { name?: string; color?: string; hidden?: boolean }>;
  /** Apply only the first `upTo` features. */
  upTo: number;
  /** When editing: the feature (draft) evaluated as a preview on top of the base state. */
  preview?: Feature;
  /** Mesh quality multiplier (1 = default). */
  quality?: number;
  /** No meshes (a source built for another Part Studio's Derived feature): `parts` is empty, `partList` names them. */
  meshless?: boolean;
}

export interface BuildResult {
  type: 'build';
  reqId: number;
  parts: PartMesh[];
  /** Every part of the build by id and name (also when meshless). */
  partList?: { id: string; name: string }[];
  sketches: SketchResult[];
  planes: PlaneResult[];
  mates: MateResult[];
  curves: CurveResult[];
  /** Cosmetic threads of tapped holes. */
  threads?: ThreadResult[];
  statuses: Record<string, FeatureStatus>;
  preview?: PreviewResult;
  /** Default names "Part 1", "Part 2"… by creation order, for all parts. */
  partOrder: string[];
  timeMs: number;
  /** Assemblies, exploded view: line segments (x1,y1,z1,x2,y2,z2…) from where parts stand to where they are shown. */
  trails?: number[];
}

export type ExportFormat = 'step' | 'stl' | 'stl-ascii' | 'brep';

export interface ExportRequest {
  type: 'export';
  reqId: number;
  studioKey: string;
  format: ExportFormat;
  partIds: string[];
  /** Merge into a single file (STL: one solid; STEP: assembly of named parts). */
  tolerance?: number;
  angularTolerance?: number;
  unit?: 'mm' | 'in';
  /**
   * An assembly: parts of several Part Studios (built under their `studioKey`), each placed as an instance —
   * turned by `rotation` (degrees about X, then Y, then Z) and moved by `position` (mm). Replaces `partIds`.
   */
  instances?: PlacedPart[];
  /** An assembly to STEP with its product tree: `[0]` is the assembly, the others its sub-assemblies. */
  assemblies?: StepAssembly[];
}

/** An assembly in a STEP product tree: its components placed in it. */
export interface StepAssembly {
  name: string;
  components: StepComponent[];
}

/** A part of a Part Studio (`studioKey`, `partId`) or another assembly of the tree (`assembly` — its index), placed. */
export interface StepComponent {
  name: string;
  position: Vec3;
  rotation: Vec3;
  studioKey?: string;
  partId?: string;
  assembly?: number;
}

export interface PlacedPart {
  studioKey: string;
  partId: string;
  name: string;
  position: Vec3;
  rotation: Vec3;
  /** The instance's id (an assembly placed for a drawing: its part's id there). */
  id?: string;
}

/** The part a view shows at a point (an item number's dot): its id and the point on it in space. */
export interface ViewPartRequest {
  type: 'viewPart';
  reqId: number;
  studioKey: string;
  partIds: string[];
  axes: { n: Vec3; x: Vec3 };
  p: Vec2;
  /** How far beside the part the point may be (view mm). */
  tol: number;
  cut?: ViewCut;
}

export interface ViewPartResult {
  type: 'viewPart';
  reqId: number;
  part: { id: string; at: Vec3 } | null;
}

/** An assembly's parts placed as one builder's (`studioKey`), for drawing views of it. */
export interface PlaceRequest {
  type: 'place';
  reqId: number;
  studioKey: string;
  instances: PlacedPart[];
}

export interface ExportResult {
  type: 'export';
  reqId: number;
  data: Uint8Array;
  mime: string;
}

export interface MeshRequest {
  type: 'mesh';
  reqId: number;
  studioKey: string;
  partIds: string[];
  tolerance: number;
  angularTolerance: number;
}

export interface MeshResult {
  type: 'mesh';
  reqId: number;
  meshes: { id: string; name: string; color: string; positions: Float32Array; normals: Float32Array; indices: Uint32Array }[];
}

export interface MeasureRequest {
  type: 'measure';
  reqId: number;
  studioKey: string;
  refs: SelRef[];
}

export interface MeasureResult {
  type: 'measure';
  reqId: number;
  /** `line` — the row is a distance whose segment is in `lines` under that key (shown when the row is picked). */
  items: { label: string; value: number; kind: 'length' | 'area' | 'volume' | 'angle' | 'number' | 'mass'; line?: string }[];
  points?: [Vec3, Vec3];
  /** The segments of the distances: minimum, maximum, centre to centre. */
  lines?: { key: string; points: [Vec3, Vec3] }[];
  /** Several parts: each one's volume, mm³ (their total mass by their materials). */
  volumes?: { partId: string; volume: number }[];
  centerOfMass?: Vec3;
}

export interface ProjectionRequest {
  type: 'projection';
  reqId: number;
  /** Part studio feature state is taken from the last build of that studio (studioKey). */
  studioKey: string;
  partIds: string[];
  orientation: ViewOrientation;
  /** The axes to look along instead of the orientation's (a section view). */
  axes?: { n: Vec3; x: Vec3 };
  /** A section: the material on the side of the plane through `origin` that `normal` points to is removed. */
  section?: SectionCut;
  /** A local (broken-out) section of the view itself. */
  breakout?: Breakout;
  hidden: boolean;
}

/**
 * A section view's cut: the material on the side of the plane through `origin` that `normal` (towards the viewer)
 * points to is removed. An offset section: on that side of the stepped `line` instead (its points; the segments along
 * the first one cut, those across it are steps), which lies across `along` (the parent view's normal) — the steps are
 * not drawn in the section.
 */
export interface SectionCut {
  origin: Vec3;
  normal: Vec3;
  line?: Vec3[];
  along?: Vec3;
  /** An aligned section: `line` is a → b → c at an angle, the part beyond b turned into the plane of a → b. */
  aligned?: boolean;
}

/**
 * A local (broken-out) section: inside the closed `outline` (points across the view; their depth does not matter) the
 * material is removed from the viewer down to `depth` below the parts' front (none — to their middle).
 */
export interface Breakout {
  outline: Vec3[];
  depth?: number;
}

/** A hole's sizes for a drawing's hole callout (mm, degrees). */
export interface HoleCallout {
  diameter: number;
  /** A blind hole: its depth from the mouth (without the drill tip); through: none. */
  depth?: number;
  cbore?: { diameter: number; depth: number };
  csink?: { diameter: number; angle: number };
  /** A tapped hole: "M8", "1/4-20 UNC"; its depth (none — all the way). */
  thread?: { designation: string; depth?: number };
}

/**
 * A hole of a view, its callout and how many the feature made: seen end-on — its centre and outer radius; seen from
 * the side (`side`) — the centre of its mouth, the outer radius, its axis's direction in the view and length.
 */
export interface ProjectedHole {
  c: Vec2;
  r: number;
  callout: HoleCallout;
  count: number;
  side?: { dir: Vec2; len: number };
}

/** A face of a part cut by a section view's plane: its edges in view coordinates (closed loops, any order), hatched. */
export interface SectionFace {
  partId: string;
  edges: Vec2[][];
}

export interface ProjectedEdge {
  /** Polyline in view coordinates (mm, Y up). */
  pts: Vec2[];
  hidden: boolean;
  /** A thin line: a cosmetic thread (ISO 6410). */
  thin?: boolean;
  /** Circle data for dimensioning when the projected edge is a circle/arc. */
  circle?: { c: Vec2; r: number };
}

export interface ProjectionResult {
  type: 'projection';
  reqId: number;
  edges: ProjectedEdge[];
  bounds: [Vec2, Vec2] | null;
  /** A section view: the cut faces. */
  sections?: SectionFace[];
  /** The Hole features' holes seen end-on (for hole callouts). */
  holes?: ProjectedHole[];
  /** Axes drawn as thin chain lines: the line between a half section and its view. */
  centerLines?: Vec2[][];
  /** Local sections' outlines (view coordinates): drawn as thin freehand lines. */
  breaks?: Vec2[][];
}

/** The model vertex or circle a point of a drawing view stands for (a dimension's anchor). */
export interface ViewAnchorRequest {
  type: 'viewAnchor';
  reqId: number;
  studioKey: string;
  partIds: string[];
  axes: { n: Vec3; x: Vec3 };
  p: Vec2;
  /** An edge circle seen end-on (`side`: edge-on) centred at `p` (of radius `r` when given) instead of a vertex. */
  circle?: { r?: number; side?: boolean };
  /** A straight edge seen along the view's line `p` → `lineTo` instead (an angle dimension's line). */
  lineTo?: Vec2;
  /** The view's cut (a section view, a local section): what it shows of the parts. */
  cut?: ViewCut;
}

/** What a view cuts away: a section's plane (or steps), a local section's pocket. */
export interface ViewCut {
  section?: SectionCut;
  breakout?: Breakout;
}

export interface ViewAnchorResult {
  type: 'viewAnchor';
  reqId: number;
  ref: ViewRef | null;
}

/** Where anchors are in a view now (the model may have changed): a point, a circle's radius; null — gone. */
export interface ViewRefsRequest {
  type: 'viewRefs';
  reqId: number;
  studioKey: string;
  axes: { n: Vec3; x: Vec3 };
  refs: ViewRef[];
  cut?: ViewCut;
  /** The view's parts (a local section's depth depends on them). */
  partIds?: string[];
  /** Where each was (a point on it): of a cut's several crossings, lines or circles — the one nearest. */
  near?: (Vec2 | null)[];
}

export interface ViewRefsResult {
  type: 'viewRefs';
  reqId: number;
  points: ({ p: Vec2; r?: number; ends?: [Vec2, Vec2] } | null)[];
}

export interface PingRequest {
  type: 'ping';
  reqId: number;
}

export type WorkerRequest =
  | (BuildRequest & { studioKey: string })
  | ExportRequest
  | MeshRequest
  | MeasureRequest
  | ProjectionRequest
  | ViewAnchorRequest
  | ViewRefsRequest
  | PlaceRequest
  | ViewPartRequest
  | PingRequest;

export type WorkerResponse =
  | BuildResult
  | ExportResult
  | MeshResult
  | MeasureResult
  | ProjectionResult
  | ViewAnchorResult
  | ViewRefsResult
  | { type: 'place'; reqId: number }
  | ViewPartResult
  | { type: 'ping'; reqId: number }
  | { type: 'error'; reqId: number; message: string }
  | { type: 'ready' }
  | { type: 'progress'; message: string };
