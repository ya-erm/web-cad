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
}

export interface SketchResult {
  featureId: string;
  frame: PlaneFrame;
  /** Entities after re-solving with current variable values. */
  entities: SkEntity[];
  ok: boolean;
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
  items: { label: string; value: number; kind: 'length' | 'area' | 'volume' | 'angle' | 'number' | 'mass' }[];
  points?: [Vec3, Vec3];
  centerOfMass?: Vec3;
}

export interface ProjectionRequest {
  type: 'projection';
  reqId: number;
  /** Part studio feature state is taken from the last build of that studio (studioKey). */
  studioKey: string;
  partIds: string[];
  orientation: ViewOrientation;
  hidden: boolean;
}

export interface ProjectedEdge {
  /** Polyline in view coordinates (mm, Y up). */
  pts: Vec2[];
  hidden: boolean;
  /** Circle data for dimensioning when the projected edge is a circle/arc. */
  circle?: { c: Vec2; r: number };
}

export interface ProjectionResult {
  type: 'projection';
  reqId: number;
  edges: ProjectedEdge[];
  bounds: [Vec2, Vec2] | null;
}

export interface PingRequest {
  type: 'ping';
  reqId: number;
}

export type WorkerRequest = (BuildRequest & { studioKey: string }) | ExportRequest | MeshRequest | MeasureRequest | ProjectionRequest | PingRequest;

export type WorkerResponse =
  | BuildResult
  | ExportResult
  | MeshResult
  | MeasureResult
  | ProjectionResult
  | { type: 'ping'; reqId: number }
  | { type: 'error'; reqId: number; message: string }
  | { type: 'ready' }
  | { type: 'progress'; message: string };
