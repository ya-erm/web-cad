// Shared data model of the CAD document. Everything here is plain JSON so it can be
// persisted to IndexedDB and sent to the geometry worker without conversion.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// Sketch
// ---------------------------------------------------------------------------

export type SkEntityType = 'point' | 'line' | 'circle' | 'arc' | 'ellipse' | 'spline' | 'text';

interface SkEntityBase {
  id: string;
  /** Construction geometry is shown dashed and never forms profiles. */
  construction?: boolean;
  /** Projected ("Use") geometry: re-derived from this reference on every rebuild. */
  use?: SelRef;
}

/** Points are the only entities with positional variables (x, y). Lines, arcs etc.
 *  reference their defining points by id. Points owned by another entity carry `owner`. */
export interface SkPoint extends SkEntityBase {
  type: 'point';
  x: number;
  y: number;
  owner?: string;
}

export interface SkLine extends SkEntityBase {
  type: 'line';
  p1: string;
  p2: string;
  /** A side of a text's box (construction): the text it belongs to — it goes with the text. */
  owner?: string;
}

export interface SkCircle extends SkEntityBase {
  type: 'circle';
  c: string;
  r: number;
}

/** Arc goes counter-clockwise from p1 to p2 around centre c.
 *  The solver keeps |p1 - c| == |p2 - c| as an implicit constraint. */
export interface SkArc extends SkEntityBase {
  type: 'arc';
  c: string;
  p1: string;
  p2: string;
}

/** Full ellipse: rx along the rotated x axis (rot, radians), ry perpendicular. */
export interface SkEllipse extends SkEntityBase {
  type: 'ellipse';
  c: string;
  rx: number;
  ry: number;
  rot: number;
}

/** Interpolating spline (centripetal Catmull-Rom) through the given points. */
export interface SkSpline extends SkEntityBase {
  type: 'spline';
  pts: string[];
  closed?: boolean;
  /**
   * Onshape tangent handles of an open spline: owned points that are the Bézier control points
   * of the end spans — the curve leaves pts[0] towards h0 and arrives at the last point from h1.
   * Absent: the natural (Catmull-Rom) end tangent.
   */
  h0?: string;
  h1?: string;
}

/** Fonts of sketch text (bundled, SIL OFL): Inter, Inter SemiBold, JetBrains Mono. */
export type SkFont = 'sans' | 'sansBold' | 'mono';

/**
 * Onshape Text: a line of text laid out from `p1` (the start of its baseline) along the direction square to
 * p1 → p2 (to its right); |p2 − p1| is the height of its capital letters. The glyph outlines are derived
 * geometry (lines and Bézier spans, like pattern copies) — they make regions; the solver never sees them.
 *
 * Its box is real geometry: `p3` ends the baseline, `p4` is the top right corner, and its sides are construction
 * lines owned by the text (`owner`) — they take constraints and dimensions like any line. The solver keeps the box
 * a rectangle as wide as the text in its font (the width follows the height and the other way round). Texts made
 * before that (and pattern copies) have only p1 and p2: their box is derived.
 */
export interface SkText extends SkEntityBase {
  type: 'text';
  text: string;
  font: SkFont;
  p1: string;
  p2: string;
  p3?: string;
  p4?: string;
}

/**
 * A spur gear (Onshape: Spur gear) drawn in a sketch, like a text: its centre is a point of the sketch, its teeth —
 * involute, one tooth arrayed around the centre — are derived geometry made at build time from the expressions
 * (so `#z` teeth follow the variable). Extrude its region for the gear.
 */
export interface SkGear extends SkEntityBase {
  type: 'gear';
  c: string;
  /** Number of teeth (an expression). */
  teeth: string;
  /** What `size` is: the module, the outer (tip) diameter or the pitch diameter. */
  sizeBy: 'module' | 'outerDiameter' | 'pitchDiameter';
  size: string;
  pressureAngle: string;
  /** The first tooth's direction from the sketch's X axis (unless it meshes with another gear). */
  rotation: string;
  /** The backlash of a pair of gears with it (a length; none — 0): each tooth is thinner by half of it. */
  backlash?: string;
  /** The gear of the sketch it meshes with: its rotation then puts its teeth in that gear's gaps (and follows it). */
  meshWith?: string;
}

export type SkEntity = SkPoint | SkLine | SkCircle | SkArc | SkEllipse | SkSpline | SkText | SkGear;
export type SkCurve = SkLine | SkCircle | SkArc | SkEllipse | SkSpline;

export type ConstraintType =
  // geometric
  | 'coincident' // [point, point] or [point, curve] (point on curve) or [line, line] (collinear)
  | 'horizontal' // [line] or [point, point]
  | 'vertical' // [line] or [point, point]
  | 'parallel' // [line, line]
  | 'perpendicular' // [line, line]
  | 'tangent' // [curve, curve] (line/arc/circle combinations)
  | 'equal' // [line, line] lengths or [circle|arc, circle|arc] radii
  | 'midpoint' // [point, line]
  | 'concentric' // [circle|arc|point, circle|arc|point]
  | 'symmetric' // [point, point, line]
  | 'fix' // [entity] — freezes all its variables at their current values
  // dimensional (value is an expression string)
  | 'distance' // [line] (length) | [point, point] | [point, line] | [line, line] (parallel lines); circles / arcs act as their centre, with `toCurve` as themselves
  | 'hdistance' // [point, point] horizontal distance
  | 'vdistance' // [point, point] vertical distance
  | 'radius' // [circle|arc|ellipse] (ellipse: variant 0 = first axis (rx), 1 = second axis (ry))
  | 'diameter' // [circle|arc|ellipse] (same)
  | 'angle' // [line, line] | [point, point, point] (the angle at the middle one)
  | 'arclength' // [arc] its length
  | 'offset'; // [src, copy, src, copy, ...] offset curves / chains at one distance

export interface SkConstraint {
  id: string;
  type: ConstraintType;
  refs: string[];
  /** Expression for dimensional constraints, e.g. "25 mm", "#width / 2", "30 deg". */
  value?: string;
  /** Position of the dimension label in sketch coordinates (dimensions only). */
  labelPos?: Vec2;
  /** Solver hint chosen at creation time, e.g. internal vs external tangency
   *  or which supplementary angle is meant. */
  variant?: number;
  /** Values frozen by a 'fix' constraint (x, y, r ... in entity variable order). */
  frozen?: number[];
  /** A distance to a circle / arc itself (its nearest point), not to its centre. */
  toCurve?: boolean;
  /** A driven (reference) dimension (Onshape): shows what the geometry measures, does not drive it. */
  driven?: boolean;
}

/**
 * Associative sketch pattern (Onshape style): copies are generated from the seed entities on
 * every solve and carry no constraints of their own. Copy ids are `${seedId}~${patternId}~${key}`.
 */
export interface SkPattern {
  id: string;
  kind: 'linear' | 'circular';
  /** Seed curves / standalone points. */
  seed: string[];
  /** Instances in the first direction, seed included (expression). */
  count: string;
  /** Circular: point the centre is attached to (e.g. a circle centre). */
  centerRef?: string;
  /** Circular: free centre when not attached. */
  center?: Vec2;
  /** Circular: total angle; 360 deg = closed pattern with equal spacing. */
  angle?: string;
  /** Linear: spacing and direction of the first direction. */
  spacing?: string;
  dirAngle?: string;
  /** Linear: second direction (perpendicular to the first); count2 = '1' disables it. */
  count2?: string;
  spacing2?: string;
  /** Copy entity ids deleted by the user (gaps are kept when the count changes). */
  skipped?: string[];
}

export interface SketchData {
  plane: PlaneRef;
  entities: SkEntity[];
  constraints: SkConstraint[];
  patterns?: SkPattern[];
}

// ---------------------------------------------------------------------------
// References to geometry (persistent naming)
// ---------------------------------------------------------------------------

/** Geometric signature used to re-find a face/edge/vertex after upstream changes. */
export interface GeomSig {
  /** 'PLANE' | 'CYLINDRE' | 'LINE' | 'CIRCLE' | 'VERTEX' ... (OCCT names) */
  type: string;
  center: Vec3;
  /** Face normal (planar faces) or axis (cylinders/cones/circles). */
  normal?: Vec3;
  /** Edge tangent direction for straight edges. */
  dir?: Vec3;
  /** Area for faces, length for edges, 0 for vertices. */
  size: number;
  radius?: number;
  /** Centre relative to the part bounding box (0..1 per axis): robust to resizing. */
  rel?: Vec3;
}

/** Key that identifies a sketch region (closed area) across sketch edits. */
export interface RegionKey {
  /** Sorted ids of the sketch entities that bound the region (outer + holes). */
  ents: string[];
  /** A point strictly inside the region (sketch coordinates). */
  pt: Vec2;
}

export type SelRef =
  | { kind: 'face' | 'edge' | 'vertex'; partId: string; index: number; sig: GeomSig }
  | { kind: 'part'; partId: string }
  | { kind: 'region'; sketchId: string; key: RegionKey }
  | { kind: 'sketchEntity'; sketchId: string; entityId: string }
  | { kind: 'plane'; planeId: string } // 'top' | 'front' | 'right' | <plane feature id>
  | { kind: 'origin' };

/**
 * What a point, circle or line of a drawing view stands for in the model. `cut` — in a section: where the edge crosses
 * the cut (a point), where the face meets it (a line or a circle).
 */
export type ViewRef = SelRef & { cut?: true };

export type StdPlane = 'top' | 'front' | 'right';

export type PlaneRef =
  | { kind: 'std'; name: StdPlane }
  | { kind: 'feature'; featureId: string }
  | { kind: 'face'; ref: SelRef };

/** Orthonormal frame of a plane in world coordinates. */
export interface PlaneFrame {
  origin: Vec3;
  xDir: Vec3;
  yDir: Vec3;
  normal: Vec3;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export type BoolOp = 'new' | 'add' | 'remove' | 'intersect';

export interface MergeScope {
  /** Merge with all parts (Onshape default) instead of the explicit list. */
  mergeAll: boolean;
  parts: SelRef[];
}

export interface ExtrudeParams extends MergeScope {
  /** Onshape: Solid (regions → a solid) or Surface (sketch curves, open or not → a surface body). None — solid. */
  bodyType?: 'solid' | 'surface';
  /** Surface: the sketch curves to extrude. */
  curves?: SelRef[];
  op: BoolOp;
  profiles: SelRef[];
  endType: 'blind' | 'symmetric' | 'throughAll' | 'upToFace';
  depth: string;
  flip: boolean;
  upTo: SelRef[];
  secondEnd: boolean;
  endType2: 'blind' | 'throughAll' | 'upToFace';
  depth2: string;
  upTo2: SelRef[];
  draft: boolean;
  draftAngle: string;
  draftFlip: boolean;
  thin: boolean;
  thickness: string;
  thinFlip: boolean;
  /**
   * Onshape Starting offset: the extrude starts away from the sketch plane — by `startDistance` along the extrude
   * direction (`startFlip` — the other way) or, `startType` entity, at a face / plane / connector / point (`startEntity`).
   */
  startOffset?: boolean;
  startType?: 'blind' | 'entity';
  startDistance?: string;
  startFlip?: boolean;
  startEntity?: SelRef[];
}

export interface RevolveParams extends MergeScope {
  /** Onshape: Solid (regions) or Surface (sketch curves and edges, open or not → a surface body). None — solid. */
  bodyType?: 'solid' | 'surface';
  /** Surface: the curves to revolve. */
  curves?: SelRef[];
  op: BoolOp;
  profiles: SelRef[];
  axis: SelRef[];
  revolveType: 'full' | 'one' | 'symmetric' | 'two';
  angle: string;
  angle2: string;
  flip: boolean;
}

export interface SweepParams extends MergeScope {
  /** Onshape: Solid (regions) or Surface (sketch curves and edges, open or not → a surface body). None — solid. */
  bodyType?: 'solid' | 'surface';
  /** Surface: the profile curves. */
  curves?: SelRef[];
  op: BoolOp;
  profiles: SelRef[];
  path: SelRef[];
  keepOrientation: boolean;
}

export interface LoftParams extends MergeScope {
  op: BoolOp;
  /** Ordered list of profiles (regions or planar faces) or sketch points / vertices for tips. */
  profiles: SelRef[];
  ruled: boolean;
}

export interface ThickenParams extends MergeScope {
  op: BoolOp;
  faces: SelRef[];
  thickness: string;
  flip: boolean;
}

export interface FilletParams {
  edges: SelRef[];
  radius: string;
  tangentPropagation: boolean;
  /** Onshape fillet type: Edge (one radius, none) or Variable — radii at vertices of the edges. */
  filletType?: 'edge' | 'variable';
  /** Variable: the vertices with radii of their own and those radii (the same order); elsewhere — `radius`. */
  vertices?: SelRef[];
  vertexRadii?: string[];
  /**
   * Variable: points inside edges with radii of their own (Onshape: points on the edge) — the edges, and for each its
   * position along the edge (0 — start, 1 — end; none — the middle) and radius (none — `radius`), the same order.
   */
  pointEdges?: SelRef[];
  pointPositions?: string[];
  pointRadii?: string[];
  /** Variable: the radius changes smoothly (level at the vertices: no kink between edges), not linearly. */
  smooth?: boolean;
  /** Onshape Cross section: circular (none) or conic — touching the faces as a round one of `radius` would, `rho` full. */
  crossSection?: 'circular' | 'conic';
  /** Conic: 0…1 (0.5 — a parabola; less — flatter, more — fuller towards the corner). */
  rho?: string;
}

export interface ChamferParams {
  edges: SelRef[];
  chamferType: 'equal' | 'twoDistances' | 'distanceAngle';
  distance: string;
  distance2: string;
  angle: string;
  flip: boolean;
  tangentPropagation: boolean;
}

/** Onshape Delete face: with Heal the gap closes from the faces around; without, the part becomes a surface. */
export interface DeleteFaceParams {
  faces: SelRef[];
  /** None — on (heal). */
  heal?: boolean;
}

/** Onshape Enclose: surfaces that close a volume between them sewn into a solid (a new part). */
export interface EncloseParams {
  surfaces: SelRef[];
  /** The surfaces stay (by default they are used up). */
  keep: boolean;
}

/** Onshape Offset surface: a surface body offset from faces (0 — a copy of them). */
export interface OffsetSurfaceParams {
  faces: SelRef[];
  distance: string;
  /** The other way (into the material). */
  flip: boolean;
}

/** Onshape Move face: the faces move, the faces around them extend or shrink to follow. */
export interface MoveFaceParams {
  faces: SelRef[];
  /** Offset — along each face's normal; translate — along a direction; rotate — about an axis. */
  moveType: 'offset' | 'translate' | 'rotate';
  distance: string;
  flip: boolean;
  direction: SelRef[];
  axis: SelRef[];
  angle: string;
}

/** Onshape Replace face: planar faces go to a plane (a plane, a planar face, a mate connector), offset from it. */
export interface ReplaceFaceParams {
  faces: SelRef[];
  target: SelRef[];
  offset: string;
  flip: boolean;
}

export interface ShellParams {
  faces: SelRef[];
  thickness: string;
  outward: boolean;
}

export interface DraftParams {
  neutral: SelRef[];
  faces: SelRef[];
  angle: string;
  flip: boolean;
}

export interface HoleParams {
  points: SelRef[];
  /** Counterdrill (Onshape): a counterbore with a countersink at its mouth. */
  style: 'simple' | 'counterbore' | 'countersink' | 'counterdrill';
  endType: 'blind' | 'throughAll';
  /**
   * All the holes the other way round. By default a sketch point drills against its sketch's normal, a mate connector
   * against its Z, an edge (a circle's centre) into the material.
   */
  flip?: boolean;
  diameter: string;
  depth: string;
  cboreDiameter: string;
  cboreDepth: string;
  csinkDiameter: string;
  csinkAngle: string;
  /** Countersink: a cylindrical recess of the countersink's diameter this deep above the cone (none / 0 — no recess). */
  csinkRecess?: string;
  tipAngle: string;
  scopeAll: boolean;
  scope: SelRef[];
  /**
   * Onshape Standard: ISO (metric) or ANSI (inch) — the diameters come from the tables (`core/holes`) by the hole
   * type, size, fit and pitch instead of the fields above; custom (none) — those fields.
   */
  standard?: 'custom' | 'iso' | 'ansi';
  /** Clearance (for a screw to pass) or tapped (threaded: the tap drill, with a cosmetic thread). */
  holeType?: 'clearance' | 'tapped';
  /** "M6"; ANSI: "#10", "1/4". */
  size?: string;
  /** Clearance hole fit, ISO 273 / ASME B18.2.8: close, normal, loose; nominal — as wide as the screw, no clearance. */
  fit?: 'close' | 'normal' | 'loose' | 'nominal';
  /** Thread pitch, mm ("1.25"); ANSI: threads per inch ("28"); none — the coarse one. */
  pitch?: string;
  /** A tapped blind hole: how deep the thread goes (no deeper than the hole). */
  tapDepth?: string;
}

export type PatternKind = 'part' | 'feature' | 'face';

export interface LinearPatternParams {
  patternType: PatternKind;
  parts: SelRef[];
  features: string[];
  faces: SelRef[];
  direction: SelRef[];
  distance: string;
  count: string;
  flip: boolean;
  secondDir: boolean;
  direction2: SelRef[];
  distance2: string;
  count2: string;
  flip2: boolean;
  /** Part pattern: fuse copies with originals (Add) or keep separate parts (New). */
  op: 'new' | 'add';
}

export interface CircularPatternParams {
  patternType: PatternKind;
  parts: SelRef[];
  features: string[];
  faces: SelRef[];
  axis: SelRef[];
  angle: string;
  count: string;
  equalSpacing: boolean;
  flip: boolean;
  op: 'new' | 'add';
}

/** Onshape Curve pattern: copies along a path (edges, sketch curves), turning with it. */
export interface CurvePatternParams {
  patternType: PatternKind;
  parts: SelRef[];
  features: string[];
  faces: SelRef[];
  path: SelRef[];
  count: string;
  /** Spread over the whole path (open: from end to end; closed: all the way round); else `distance` apart. */
  equalSpacing: boolean;
  distance: string;
  /** From the other end of the path. */
  flip: boolean;
  /** The copies turn with the path (none: only moved along it). */
  orient: boolean;
  op: 'new' | 'add';
}

/** Onshape Wrap: sketch regions rolled onto a cylindrical face, raised out of it or sunk into it. */
export interface WrapParams extends MergeScope {
  /** Sketch regions on a plane along the cylinder's axis (tangent to it, usually). */
  profiles: SelRef[];
  /** The cylindrical face. */
  target: SelRef[];
  /** Emboss (add, out of the face) or deboss (remove, into it). */
  op: 'add' | 'remove';
  depth: string;
}

/** Onshape Rib: walls of a thickness from sketch curves out to the parts. */
export interface RibParams extends MergeScope {
  /** Sketch curves (lines, arcs): the rib's profile. */
  profiles: SelRef[];
  thickness: string;
  /** The rib grows within the sketch plane (out from the curves), or along its normal. */
  direction: 'parallel' | 'normal';
  /** The other way (by default the way the rib meets a part). */
  flip: boolean;
  /** Curves run on from their ends up to the parts they point at (Onshape: Extend profiles up to part): lines along themselves, arcs along their tangents. */
  extend?: boolean;
  /** The sides taper (Onshape Rib → Draft): `draftAngle` from the sketch, wider towards the part (`draftFlip` — narrower). */
  draft?: boolean;
  draftAngle?: string;
  draftFlip?: boolean;
}

export interface MirrorParams {
  patternType: PatternKind;
  parts: SelRef[];
  features: string[];
  faces: SelRef[];
  plane: SelRef[];
  op: 'new' | 'add';
}

export interface BooleanParams {
  op: 'union' | 'subtract' | 'intersect';
  tools: SelRef[];
  targets: SelRef[];
  keepTools: boolean;
}

/** Split parts or surfaces with a plane, a face or a surface (a planar face — its whole plane unless `trim`). */
export interface SplitParams {
  parts: SelRef[];
  tool: SelRef[];
  /** A surface tool stays (otherwise it is used up). */
  keepTools: boolean;
  /** A planar face splits only within its edges (Onshape: Trim to face boundaries). */
  trim?: boolean;
}

/**
 * Mate connector (Onshape): a local coordinate system. It is referenced like a plane
 * ({kind: 'plane', planeId: <feature id>}): its XY plane works as a plane, its Z axis as an
 * axis / direction and its origin as a point.
 */
/**
 * Which point of the location entity (Onshape inference points): edge start / middle / end or
 * circle centre; planar face centroid; cylinder axis at the face's start / middle / end.
 */
export type MateInference = 'default' | 'centroid' | 'start' | 'mid' | 'end' | 'center';

export interface MateConnectorParams {
  /** Origin: vertex, edge (mid point / circle centre), face (centroid / cylinder axis), sketch entity, plane, origin or another mate connector. */
  location: SelRef[];
  /** Point of `location` to use (default: edge middle / circle centre, face centroid / middle of the axis). */
  inference?: MateInference;
  /** Planar face the point was picked on: the connector is parallel to it (Z = its normal). */
  orientFace?: SelRef[];
  /** "Reorient": the primary axis is turned onto the connector's X or Y axis. */
  reorient?: 'z' | 'x' | 'y';
  /** Onshape "Between entities": the origin is halfway between `location` and `location2` (axes from the first). */
  mode?: 'on' | 'between';
  location2?: SelRef[];
  inference2?: MateInference;
  orientFace2?: SelRef[];
  /** Onshape "Owner part": the connector moves with it in later transforms (default: the part of `location`). */
  ownerPart?: SelRef[];
  /** Realign: Z axis along this entity (line, face normal, cylinder axis, plane normal, mate connector Z). */
  primaryAxis: SelRef[];
  /** Realign: X axis towards this entity (projected onto the XY plane). */
  secondaryAxis: SelRef[];
  flipPrimary: boolean;
  /** Rotation about Z. */
  rotation: string;
  /** Offsets along the connector's own X / Y / Z axes. */
  dx: string;
  dy: string;
  dz: string;
}

export interface TransformParams {
  /** 'mates': move so that mate connector `fromMate` lands on `toMate` (Onshape "Mate connector to mate connector"). */
  mode: 'translateEntity' | 'translateXYZ' | 'rotate' | 'scale' | 'mates';
  fromMate: SelRef[];
  toMate: SelRef[];
  parts: SelRef[];
  direction: SelRef[];
  distance: string;
  flip: boolean;
  dx: string;
  dy: string;
  dz: string;
  axis: SelRef[];
  angle: string;
  scale: string;
  point: SelRef[];
  copy: boolean;
}

export interface DeletePartParams {
  parts: SelRef[];
  /** Dissolve composite parts (Onshape): the composites selected go, their bodies are parts again. */
  dissolve?: boolean;
}

/** Composite part (Onshape): the parts selected act as one part. */
export interface CompositePartParams {
  parts: SelRef[];
  /** Closed: they are consumed — only the composite is left; open: they stay parts of their own as well. */
  closed: boolean;
}

export interface PlaneParams {
  planeType: 'offset' | 'pointNormal' | 'threePoint' | 'lineAngle' | 'midplane';
  refs: SelRef[];
  offset: string;
  angle: string;
  flip: boolean;
  size: string;
}

export interface VariableParams {
  name: string;
  value: string;
  description: string;
  /** Onshape variable types; bare numbers take the document unit for length/angle. */
  varType?: 'length' | 'angle' | 'number' | 'any';
}

export interface ImportParams {
  fileName: string;
  format: 'step' | 'stl';
  /** base64 encoded file content */
  data: string;
}

/**
 * Derived (Onshape): parts of another Part Studio of the document, linked one way — they follow the source as it
 * changes, where they stand in it (the common origin).
 */
export interface DerivedParams {
  /** The source Part Studio (a tab of this document). */
  studioId: string;
  /** Its parts to bring in (ids in its build); empty — all of them (none with `noParts`). */
  parts: string[];
  /** No parts: only sketches. */
  noParts?: boolean;
  /** Its sketches to bring in (their feature ids): their regions can be extruded, their geometry used here. */
  sketches?: string[];
  /** Its configuration (input id → option id, a variable input's value); the inputs not set — as chosen there. */
  configuration?: Record<string, string>;
  /**
   * Where to put the parts (Onshape Derived location): a mate connector of this Part Studio; empty — where they
   * stand in the source. `placeFrom` — the mate connector of the source (its feature id) that lands on it; none —
   * the source's origin.
   */
  placeTo?: SelRef[];
  placeFrom?: string;
  /**
   * Filled in for the build only, never stored: the source's builder key, its version (a change of the source makes
   * the feature rebuild) and why it cannot be used.
   */
  sourceKey?: string;
  sourceVersion?: string;
  sourceError?: 'missing' | 'cycle' | 'version';
}

export interface HelixParams {
  axis: SelRef[];
  pitch: string;
  turns: string;
  radius: string;
  leftHanded: boolean;
}

export interface FeatureParamsMap {
  sketch: SketchData;
  extrude: ExtrudeParams;
  revolve: RevolveParams;
  sweep: SweepParams;
  loft: LoftParams;
  thicken: ThickenParams;
  fillet: FilletParams;
  chamfer: ChamferParams;
  shell: ShellParams;
  draft: DraftParams;
  deleteFace: DeleteFaceParams;
  moveFace: MoveFaceParams;
  replaceFace: ReplaceFaceParams;
  offsetSurface: OffsetSurfaceParams;
  enclose: EncloseParams;
  hole: HoleParams;
  linearPattern: LinearPatternParams;
  circularPattern: CircularPatternParams;
  curvePattern: CurvePatternParams;
  mirror: MirrorParams;
  rib: RibParams;
  wrap: WrapParams;
  boolean: BooleanParams;
  split: SplitParams;
  transform: TransformParams;
  deletePart: DeletePartParams;
  compositePart: CompositePartParams;
  plane: PlaneParams;
  variable: VariableParams;
  import: ImportParams;
  derived: DerivedParams;
  helix: HelixParams;
  mateConnector: MateConnectorParams;
}

export type FeatureType = keyof FeatureParamsMap;

export interface FeatureOf<T extends FeatureType> {
  id: string;
  type: T;
  name: string;
  suppressed?: boolean;
  params: FeatureParamsMap[T];
}

export type Feature = { [K in FeatureType]: FeatureOf<K> }[FeatureType];

export interface PartMeta {
  name?: string;
  color?: string;
  /** 0.1…1 (shown see-through below 1); none — opaque. */
  opacity?: number;
  hidden?: boolean;
  /** g/cm^3 */
  density?: number;
  material?: string;
  /** Part number and description (bill of materials). */
  partNumber?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Drawings
// ---------------------------------------------------------------------------

export type ViewOrientation = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'iso' | 'dimetric' | 'trimetric';

export interface DrawingView {
  id: string;
  /** Part studio tab providing the geometry. */
  studioId: string;
  /** Parts to show; empty means all visible parts. */
  partIds: string[];
  orientation: ViewOrientation;
  /** Sheet position of the view centre in mm. */
  x: number;
  y: number;
  scale: number;
  showHidden: boolean;
  /** For projected views: the parent view they stay aligned with; for section and detail views — the view they are made from. */
  parent?: string;
  label?: string;
  /** Where its label was dragged to, sheet mm from its place above the view (none — there). */
  labelOffset?: Vec2;
  /** A projected or section view placed freely (Onshape "Break alignment"): not kept on its line of projection, not following its parent. */
  unaligned?: boolean;
  /**
   * A section view of the parent (Onshape "Section view"): the parts cut along the line `a` → `b` drawn on the parent
   * (its view coordinates, mm), seen across the line towards its `side` (1 — to the left of `a` → `b`).
   */
  section?: {
    a: Vec2;
    b: Vec2;
    side: 1 | -1;
    letter: string;
    /** An offset section: the cutting line's further points after `b` (segments along a → b cut, those across step). */
    steps?: Vec2[];
    /** An aligned section: `steps` is one point at any angle; the part beyond `b` is turned into the plane of a → b. */
    aligned?: boolean;
  };
  /**
   * A local (broken-out) section of this view: inside the closed `outline` (its view coordinates, mm) the parts are
   * opened down to `depth` mm below their front (none — to their middle).
   */
  brokenOut?: { outline: Vec2[]; depth?: number };
  /** A detail view of the parent: its circle (the parent's view coordinates, mm) at the view's own scale. */
  detail?: { c: Vec2; r: number; letter: string };
  /** The view's own configuration of the Part Studio: input id → option id (a variable input: its value). */
  configuration?: Record<string, string>;
}

export interface DrawingDimension {
  id: string;
  viewId: string;
  /**
   * `hole` — a hole callout: `a` is the hole's centre, `textPos` the start of its shelf (Onshape Hole callout).
   * `angle` — between two lines: `a` where they cross, `b` and `c` on the first and the second; `textPos` on the arc
   * (the sector it is in is the angle measured).
   * `ordinate` — the distance of `b` from the base `a` along the view's X or Y (`ordinate`), written at the end of a
   * line from `b` across that axis out to `textPos` (ISO 129-1).
   * `centerline` — the axis between two parallel lines `a`–`b` and `c`–`d` (a chain line a little beyond them);
   * `centermark` — the centre of a circle or arc: `a`, `b` on it (ISO 128).
   */
  kind: 'linear' | 'horizontal' | 'vertical' | 'radius' | 'diameter' | 'hole' | 'angle' | 'ordinate' | 'centerline' | 'centermark';
  /** An ordinate dimension's axis: `x` — measured along the view's X (its line runs up / down), `y` — along Y. */
  ordinate?: 'x' | 'y';
  /** Points in view model coordinates (unscaled, mm, view-local 2D). */
  a: Vec2;
  b?: Vec2;
  c?: Vec2;
  d?: Vec2;
  /** An angle's sector: each line towards its point `b` / `c` (1) or away from it (−1); kept when the model changes. */
  sector?: [1 | -1, 1 | -1];
  /** Label offset in sheet mm relative to the measured geometry. */
  offset: number;
  textPos?: Vec2;
  /**
   * What `a` and `b` stand for in the model — a vertex, or an edge circle (its centre; a diameter's, radius's or hole
   * callout's `a`); an angle's: its two lines' straight edges. The dimension follows the model through them. Without
   * them (or when lost) — the points as stored.
   */
  refs?: { a?: ViewRef; b?: ViewRef };
}

/**
 * A part's item number on a drawing of an assembly (ГОСТ 2.109 «номер позиции»): a leader from a dot on the part to a
 * shelf with its item in the bill of materials.
 */
export interface DrawingBalloon {
  id: string;
  viewId: string;
  /** The part: an instance of the view's assembly (`X/inner` — a part of a sub-assembly). */
  instance: string;
  /** The dot: a point of the part in the part's own coordinates (it follows the instance as it moves). */
  at: Vec3;
  /** Where the shelf starts on the sheet (mm). */
  x: number;
  y: number;
}

/** A drawing's table of the bill of materials: an assembly's parts (flattened), as the item numbers count them. */
export interface DrawingBom {
  assemblyId: string;
  /** Its bottom right corner on the sheet (mm): above the title block at first. */
  x: number;
  y: number;
}

export interface DrawingNote {
  id: string;
  x: number;
  y: number;
  text: string;
  height: number;
}

export interface DrawingTitleBlock {
  template: 'custom' | 'gost';
  /** Custom dimensions in sheet millimetres; retained when switching templates. */
  width?: number;
  height?: number;
  material?: string;
  mass?: string;
  organization?: string;
  revision?: string;
  letter?: string;
  checkedBy?: string;
  technicalControl?: string;
  standardsControl?: string;
  approvedBy?: string;
}

export interface DrawingData {
  sheet: 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'Letter' | 'Tabloid';
  landscape: boolean;
  views: DrawingView[];
  dimensions: DrawingDimension[];
  notes: DrawingNote[];
  /** Item numbers of the parts of assembly views. */
  balloons?: DrawingBalloon[];
  bom?: DrawingBom;
  title: string;
  author: string;
  designation?: string;
  /** Absent in older documents: use the original custom template, 185 × 55 mm. */
  titleBlock?: DrawingTitleBlock;
  scaleLabel?: string;
  /** First-angle (ISO/ГОСТ, default) or third-angle (ANSI) projection. */
  projection?: 'first' | 'third';
  /** The decimal sign of the numbers on the sheet (dimensions, callouts, scales): the point (default) or the comma. */
  decimal?: '.' | ',';
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type AngleUnit = 'deg' | 'rad';

/** Group of features in the feature list (purely organisational, no effect on geometry). */
export interface FeatureFolder {
  id: string;
  name: string;
  featureIds: string[];
  collapsed?: boolean;
}

export interface PartStudioTab {
  id: string;
  type: 'partStudio';
  name: string;
  features: Feature[];
  /** Number of features applied (rollback bar position). null = all. */
  rollback: number | null;
  parts: Record<string, PartMeta>;
  /** Features (sketches, planes, curves) hidden in the graphics area. */
  hidden?: string[];
  folders?: FeatureFolder[];
  /** Configurations (Onshape): inputs whose chosen options set configured parameters of the features. */
  configuration?: ConfigInput[];
  /** The chosen option of each configuration input (by ids; the first option when missing; a variable input: its value). */
  configChoice?: Record<string, string>;
}

/**
 * A configuration input (Onshape List input): its options are the rows of a table whose columns are configured
 * parameters — `featureId/param` (an expression or a checkbox of a feature, a variable's `value`) or
 * `featureId/suppressed`.
 */
export interface ConfigInput {
  id: string;
  name: string;
  /**
   * A list (options in rows), a checkbox (Onshape Checkbox input): two options — off and on, or a variable (Onshape
   * Configuration variable): a variable feature of the studio (its value is `params[0]`) whose value is typed in
   * the choice — any expression, not one of options; none typed: the variable's own value.
   */
  kind?: 'list' | 'checkbox' | 'variable';
  options: { id: string; name: string }[];
  params: string[];
  /** Cells: option id → parameter → value (an expression; 'true' / 'false'). A missing cell keeps the feature's own value. */
  values: Record<string, Record<string, string>>;
}

export interface DrawingTab {
  id: string;
  type: 'drawing';
  name: string;
  drawing: DrawingData;
}

/** A part of a Part Studio placed in an assembly (Onshape "instance"). */
export interface AssemblyInstance {
  id: string;
  name: string;
  /** Source: the Part Studio tab and the part id in its build (a sub-assembly: the assembly tab and ''). */
  studioId: string;
  partId: string;
  /** A sub-assembly: an instance of this assembly tab, moving as one (its parts as it places them). */
  assemblyId?: string;
  /**
   * A flexible sub-assembly (Onshape): its own mates act in this assembly, so its parts move here as they allow;
   * `flex` — where its parts stand here, in its coordinates (by their ids in it).
   */
  flexible?: boolean;
  flex?: Record<string, { position: Vec3; rotation: Vec3 }>;
  /**
   * Its own configuration of the Part Studio (Onshape): input id → option id (a variable input: its value); the
   * inputs it does not set follow the option chosen in the Part Studio.
   */
  configuration?: Record<string, string>;
  /** Placement of the part's studio coordinates: translation (document length units in mm) and rotation. */
  position: Vec3;
  /** Rotation about X, then Y, then Z (degrees, world axes). */
  rotation: Vec3;
  /** Fixed instances cannot be moved (Onshape "Fix"). */
  fixed?: boolean;
  hidden?: boolean;
}

/** Onshape mate types: degrees of freedom left between the two mate connectors. */
export type AssemblyMateType = 'fastened' | 'revolute' | 'slider' | 'cylindrical' | 'planar' | 'ball' | 'parallel' | 'pinSlot' | 'tangent' | 'width';

/** Where a mate attaches on an instance: an explicit mate connector of its part, or an implicit one on its geometry. */
export type MateConnectorRef = { kind: 'connector'; featureId: string } | { kind: 'face' | 'edge' | 'vertex'; index: number };

export interface MateEnd {
  instance: string;
  connector: MateConnectorRef;
}

export interface AssemblyMate {
  id: string;
  name: string;
  type: AssemblyMateType;
  /** The first end stays, the second instance is moved onto it (unless it is the fixed one). */
  a: MateEnd;
  b: MateEnd;
  /**
   * Width mate: the second face of each pair (same instances as `a` and `b`). Pin slot: `a2` — a straight edge of
   * the first instance along the slot (instead of the first connector's X axis).
   */
  a2?: MateEnd;
  b2?: MateEnd;
  /**
   * Z axes of the two connectors point at each other (true) or the same way. Tangent mate: the second face
   * touches the back of a plane, or lies inside a cylinder / sphere.
   */
  flip: boolean;
  /** Turn of the second connector about Z, degrees (fastened, slider); of the slot direction (pin slot). */
  angle?: number;
  /** Distance of the second connector from the first along the first one's Z axis, mm (fastened, revolute, planar, ball). */
  offset?: number;
  /** Limits of the motion (Onshape): along Z, mm (slider, cylindrical); about Z, degrees in −180…180 (revolute, cylindrical). */
  limits?: MateLimits;
  suppressed?: boolean;
}

export interface MateLimits {
  zMin?: number;
  zMax?: number;
  aMin?: number;
  aMax?: number;
}

export interface AssemblyTab {
  id: string;
  type: 'assembly';
  name: string;
  instances: AssemblyInstance[];
  mates?: AssemblyMate[];
  groups?: AssemblyGroup[];
  relations?: MateRelation[];
  explodedViews?: ExplodedView[];
}

/** An exploded view (Onshape): steps that move instances apart, shown without changing the assembly. */
export interface ExplodedView {
  id: string;
  name: string;
  steps: ExplodeStep[];
}

/**
 * One step of an exploded view: these instances move `distance` mm along `dir` (a unit vector) and / or turn by
 * `angle` degrees about the axis `dir` through `pivot`.
 */
export interface ExplodeStep {
  id: string;
  instances: string[];
  dir: Vec3;
  distance: number;
  angle?: number;
  pivot?: Vec3;
}

export type MateRelationType = 'gear' | 'rackPinion' | 'screw';

/**
 * A mate relation (Onshape): ties the free motions of mates. Gear — the turns of two revolute / cylindrical mates;
 * rack and pinion — the turn of a revolute / cylindrical mate (pinion) and the travel of a slider / cylindrical one
 * (rack); screw — the turn and the travel of one cylindrical mate.
 */
export interface MateRelation {
  id: string;
  name: string;
  type: MateRelationType;
  /** The mates: gear — first and second gear; rack and pinion — pinion and rack; screw — the same mate twice. */
  a: string;
  b: string;
  /** Gear: ratio (turns of the second per turn of the first); rack and pinion: pitch diameter, mm; screw: pitch (lead), mm per turn. */
  value: number;
  /** The second motion goes the other way (gears turn the same way, the rack / screw goes the other way). */
  reverse?: boolean;
  suppressed?: boolean;
  /** Motions (radians / mm) when the relation was made — its zero. */
  zero: [number, number];
  /** Motions as last solved, with whole turns counted (a turn past ±180° keeps going). */
  last: [number, number];
}

/** Instances held together as one rigid body (Onshape Group), as they stood when the group was made. */
export interface AssemblyGroup {
  id: string;
  name: string;
  /** Each member's placement relative to the first member (the first one's is zero). */
  members: { instance: string; position: Vec3; rotation: Vec3 }[];
  suppressed?: boolean;
}

export type DocTab = PartStudioTab | DrawingTab | AssemblyTab;

export interface CadDocument {
  id: string;
  name: string;
  created: number;
  modified: number;
  units: { length: LengthUnit; angle: AngleUnit };
  tabs: DocTab[];
  activeTab: string;
  version: 1;
  /**
   * The workspace (Onshape: a branch) the document is now — none: Main. The others are kept beside the versions
   * (`DocumentVersion` of kind `workspace`) until switched to.
   */
  workspace?: Workspace;
}

/** A workspace of a document: Main, or a branch made from a version (`base`). */
export interface Workspace {
  id: string;
  name: string;
  /** The version it was branched from: merges compare with it. */
  base?: string;
}

export interface DocumentSummary {
  id: string;
  name: string;
  created: number;
  modified: number;
  thumbnail?: string;
  /** Moved to the trash at this time (restorable until deleted permanently). */
  trashed?: number;
}

/**
 * A snapshot of a document (Onshape versions and history): a version made by the user (named, with a description),
 * or an entry of the history saved by itself — when the document is opened, every while during edits, and before a
 * version is restored. The document itself is stored apart (listing the versions does not load them).
 */
export interface DocumentVersion {
  id: string;
  docId: string;
  /** Made by the user, by the history, a workspace not open now (its state, kept until switched to). */
  kind: 'version' | 'auto' | 'workspace';
  /** A version's name ("V1"), a workspace's ("Main", "Branch 1"); the history's entries have none. */
  name: string;
  /** A workspace: the version it was branched from. */
  base?: string;
  description?: string;
  /** Why the history saved it. */
  reason?: 'open' | 'edit' | 'restore' | 'merge';
  created: number;
  /** Of the snapshot's content (units and tabs): the same content is not saved twice in a row. */
  hash: string;
}

/**
 * A version as the project file (.webcad.json) keeps it — its name and content (the history stays in the browser).
 * Or a workspace (branch) the document is not in (`kind: 'workspace'`, its id and the version it came from): the
 * file has these apart, in `workspaces`.
 */
export interface ProjectVersion extends Pick<CadDocument, 'units' | 'tabs' | 'activeTab'> {
  id: string;
  name: string;
  description?: string;
  created: number;
  kind?: 'workspace';
  base?: string;
}
