// Agent API: the JSON vocabulary agents (LLM tools, scripts) use to build and edit models.
// See docs/agent-api.md for the reference with examples.
//
// Conventions: lengths are numbers in the document unit (mm by default) or expression strings
// ("10 mm", "#width / 2"); a size given as a string also becomes a driving sketch dimension.
// Angles are numbers in degrees or expression strings ("30 deg"). World axes follow Onshape:
// Top = XY plane (normal +Z), Front = XZ (sketch y = +Z), Right = YZ (sketch x = +Y, y = +Z).

import type { BoolOp, FeatureType, SkFont } from '../core/types';

export type Num = number | string;
export type Pt2 = [Num, Num];
export type Pt3 = [number, number, number];
export type AxisName = 'x' | 'y' | 'z' | '-x' | '-y' | '-z';
/** Exact coordinate (± tolerance) or inclusive [min, max] range, document units. */
export type Range = number | [number, number];
export type Pick = 'largest' | 'smallest' | '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/** 'all', a part name ("Part 1"), a part id, a 0-based index, or the part nearest to a point. */
export type PartQuery = 'all' | string | number | { near: Pt3 };

export interface FaceQuery {
  part?: PartQuery;
  /** plane | cylinder | cone | sphere | torus | bspline … */
  type?: string;
  /** Planar faces whose outward normal is along this axis / vector. */
  normal?: AxisName | Pt3;
  /** Filters on the face centre. */
  x?: Range;
  y?: Range;
  z?: Range;
  /** Cylinders / cones / spheres. */
  radius?: number;
  /** Keep only the face nearest to this point. */
  near?: Pt3;
  /** Keep only the largest / smallest face or the extreme one along an axis. */
  pick?: Pick;
  /** Keep the n-th match (0-based, in model order). */
  index?: number;
}

export interface EdgeQuery {
  part?: PartQuery;
  /** line | circle | ellipse | bspline */
  type?: string;
  /** Straight edges parallel to this axis / vector (either sense). */
  dir?: AxisName | Pt3;
  /** Coordinate filters: ALL points of the edge (start, middle, end) must satisfy them. */
  x?: Range;
  y?: Range;
  z?: Range;
  /** Circular edges with this radius. */
  radius?: number;
  /** Edges lying on the matched face(s). */
  onFace?: FaceQuery;
  near?: Pt3;
  pick?: Pick;
  index?: number;
}

export type Faces = 'all' | FaceQuery | FaceQuery[];
export type Edges = 'all' | EdgeQuery | EdgeQuery[];
export type Parts = PartQuery | PartQuery[];

/** A world axis through the origin, an edge / cylindrical face, or a line of a sketch. */
export type AxisSpec = AxisName | { edge: EdgeQuery } | { face: FaceQuery } | { sketch: string; line?: number } | { mate: string };
/** A standard plane, a plane feature (by name), a mate connector's XY plane or a planar face. */
export type PlaneSpec = 'top' | 'front' | 'right' | { plane: string } | { mate: string } | { face: FaceQuery };
/** Where a mate connector sits: the origin, the vertex nearest to a point, a face / edge, a sketch point or another connector. */
export type LocationSpec =
  | 'origin'
  | { vertex: Pt3; parallelTo?: FaceQuery }
  /** Planar face: its centroid; cylinder / cone: a point on the axis (start / mid / end of the face). */
  | { face: FaceQuery; point?: 'start' | 'mid' | 'end' }
  /** Edge: start / mid / end, or the centre of a circle / arc (e.g. a hole); parallelTo: orient like that planar face. */
  | { edge: EdgeQuery; point?: 'start' | 'mid' | 'end' | 'center'; parallelTo?: FaceQuery }
  | { sketch: string; point?: number }
  | { mate: string };

/** Sketch geometry in sketch coordinates. Sizes given as strings get driving dimensions. */
export type Shape =
  | { type: 'rect'; x?: Num; y?: Num; w: Num; h: Num; center?: boolean; construction?: boolean }
  | { type: 'circle'; c?: Pt2; r?: Num; d?: Num; construction?: boolean }
  /** Semi-axes rx (along `rotation`, degrees) and ry; string sizes become axis diameter dimensions. */
  | { type: 'ellipse'; c?: Pt2; rx: Num; ry: Num; rotation?: number; construction?: boolean }
  | { type: 'line'; from: Pt2; to: Pt2; construction?: boolean }
  | { type: 'polyline'; points: Pt2[]; closed?: boolean; construction?: boolean }
  | { type: 'arc'; c?: Pt2; r: Num; start: number; end: number; construction?: boolean }
  | { type: 'slot'; from: Pt2; to: Pt2; r: Num; construction?: boolean }
  /** r: radius of the construction circle — through the vertices, or with `inscribed` touching the sides (half the across-flats size). */
  | { type: 'polygon'; c?: Pt2; r: Num; sides: number; rotation?: number; inscribed?: boolean; construction?: boolean }
  | { type: 'point'; at: Pt2 }
  /**
   * A line of text (Onshape Text): its baseline from `at` (default the origin), capital letters `height` tall — or
   * `width` wide (its box: the height follows from the font; one of the two, a string becomes a driving dimension
   * of that side of its box), turned by `rotation` degrees; `align`: where `at` is on the baseline — its start
   * (`left`, default), middle (`center`) or end (`right`). Fonts: `sans` (Inter, default), `sansBold` (Inter
   * SemiBold), `mono` (JetBrains Mono). Its letters are regions: `regions: "auto"` takes the letters without their
   * counters (the inside of "O").
   */
  | {
      type: 'text';
      text: string;
      at?: Pt2;
      height?: Num;
      width?: Num;
      align?: 'left' | 'center' | 'right';
      rotation?: number;
      font?: SkFont;
      construction?: boolean;
    }
  /**
   * A spur gear (Onshape Spur gear) about `c` (default the origin): involute teeth — one tooth arrayed around the
   * centre — from expressions that stay live (`"teeth":"#z"`): `teeth`, and its size by `module`, `outerDiameter` or
   * `pitchDiameter` (one of them; default module 1 mm), `pressureAngle` (degrees or an expression, default 20),
   * `rotation` (degrees or an expression: the first tooth's direction), `backlash` (a length: of a pair of gears with
   * it — each tooth thinner by half of it). `mesh: true` — it meshes with the gear drawn before it in the sketch: its
   * rotation puts its teeth in that gear's gaps and follows it (place it at the centre distance (z₁ + z₂)·m / 2).
   * Its region is the gear: extrude it.
   */
  | {
      type: 'gear';
      c?: Pt2;
      teeth: Num;
      module?: Num;
      outerDiameter?: Num;
      pitchDiameter?: Num;
      pressureAngle?: Num;
      rotation?: Num;
      backlash?: Num;
      mesh?: boolean;
      construction?: boolean;
    };

/** Which closed regions of a sketch to use: 'auto' skips islands inside holes. */
export type Regions = 'auto' | 'all' | Pt2[];

type Named = { name?: string };

export type AgentOp =
  | (Named & { op: 'variable'; name: string; value: Num; type?: 'length' | 'angle' | 'number' | 'any'; description?: string })
  /** `use` (Onshape Use): edges of the model projected onto the sketch, fixed and linked — they follow their source. */
  | (Named & { op: 'sketch'; plane?: PlaneSpec; shapes: Shape[]; use?: Edges })
  | (Named & {
      op: 'extrude';
      sketch?: string;
      regions?: Regions;
      /** A surface (Onshape: Surface) from the sketch's curves (open ones too) instead of a solid from its regions. */
      surface?: boolean;
      depth?: Num;
      end?: 'blind' | 'symmetric' | 'throughAll' | { upToFace: FaceQuery };
      flip?: boolean;
      /** Onshape Starting offset: a distance along the extrude direction (negative — back), or a plane / face to start at. */
      start?: Num | { from: PlaneSpec };
      boolean?: BoolOp;
      draft?: Num;
      thin?: Num;
    })
  /** `surface` — a surface from the sketch's curves (open ones too; those on the axis are skipped) instead of a solid. */
  | (Named & { op: 'revolve'; sketch?: string; regions?: Regions; surface?: boolean; axis: AxisSpec; angle?: Num; boolean?: BoolOp })
  /**
   * Sweep a sketch's regions (`surface` — its curves, open or closed, into a surface) along a path: the curves of
   * another sketch or model edges, one chain; `keepOrientation` — the profile keeps its turn along the path.
   */
  | (Named & {
      op: 'sweep';
      sketch?: string;
      regions?: Regions;
      surface?: boolean;
      path: { sketch: string } | { edges: Edges };
      keepOrientation?: boolean;
      boolean?: BoolOp;
    })
  /**
   * Onshape Split: parts or surfaces (`parts`) cut by `tool` — a plane (a planar face: its whole plane unless `trim`),
   * any face, or a surface body (`{ surface }`, used up unless `keepTools`). The first piece keeps the name.
   */
  | (Named & { op: 'split'; parts: Parts; tool: PlaneSpec | { surface: PartQuery }; trim?: boolean; keepTools?: boolean })
  /** `tangentPropagation: false` — only the selected edges, not the edges tangent to them (by default it runs on). */
  | (Named & {
      op: 'fillet';
      edges: Edges;
      radius: Num;
      tangentPropagation?: boolean;
      /** A variable fillet: radii at vertices of the edges (the nearest model vertex to `at`); elsewhere — `radius`. */
      vertices?: { at: Pt3; radius: Num }[];
      /** Variable: radii at points inside edges — the edge (one), the position along it (0 start … 1 end), the radius. */
      points?: { edge: EdgeQuery; at: number; radius: Num }[];
      /** Variable: the radius changes smoothly (level at the vertices and points), not linearly. */
      smooth?: boolean;
    })
  | (Named & {
      op: 'chamfer';
      edges: Edges;
      distance: Num;
      tangentPropagation?: boolean;
      /** Two distances (`distance2`) or distance and angle (`angle`); `flip` — the other face takes `distance`. */
      type?: 'equal' | 'twoDistances' | 'distanceAngle';
      distance2?: Num;
      angle?: Num;
      flip?: boolean;
    })
  | (Named & { op: 'shell'; faces: Faces; thickness: Num; outward?: boolean })
  /** Onshape Delete face (healed): a whole hole / pocket / boss, or a fillet / chamfer between planar faces. */
  | (Named & { op: 'deleteFace'; faces: Faces; heal?: boolean })
  /** Onshape Offset surface: a surface body offset from faces along their normals (0 — a copy; + out of the material). */
  | (Named & { op: 'offsetSurface'; faces: Faces; distance?: Num; flip?: boolean })
  /** Onshape Enclose: surfaces (by name) that close a volume sewn into a solid; `keep` — the surfaces stay. */
  | (Named & { op: 'enclose'; surfaces: Parts; keep?: boolean })
  /** Thicken surfaces (by name) or faces into solids, `thickness` along their normals (`flip` — the other way). */
  | (Named & { op: 'thicken'; surfaces?: Parts; faces?: Faces; thickness: Num; flip?: boolean; boolean?: BoolOp })
  /**
   * Onshape Move face — one of: `offset` (planar faces along their normals; + out of the material), `translate`,
   * `rotate` (a whole hole / pocket / boss moves as one; planar faces each to its moved plane).
   */
  | (Named & { op: 'moveFace'; faces: Faces; offset?: Num; translate?: { direction: AxisSpec; distance: Num }; rotate?: { axis: AxisSpec; angle: Num } })
  /** Onshape Replace face: planar faces to a plane (`offset` from it, along its normal turned like the faces). */
  | (Named & { op: 'replaceFace'; faces: Faces; with: PlaneSpec; offset?: Num; flip?: boolean })
  | (Named & {
      op: 'hole';
      /** The holes' places: a sketch's points (circle centres), and / or circular edges (their centres, drilled into the material). */
      sketch?: string;
      edges?: Edges;
      /** Mate connectors (by name): drilled against their Z (a connector with `flip` turns its hole round). */
      mates?: string[];
      /** All the holes the other way round. */
      flip?: boolean;
      /** Custom holes: the diameter (none with `iso`). */
      diameter?: Num;
      depth?: Num;
      through?: boolean;
      /** counterdrill — a counterbore with a countersink at its mouth (cbore… and csink… sizes). */
      style?: 'simple' | 'counterbore' | 'countersink' | 'counterdrill';
      csinkAngle?: Num;
      /** countersink: a cylindrical recess of its diameter this deep above the cone. */
      csinkRecess?: Num;
      cboreDiameter?: Num;
      cboreDepth?: Num;
      csinkDiameter?: Num;
      /** ISO standard holes: "M6" — a clearance hole (fit: close / normal / loose), or tapped (the pitch: coarse by default). */
      /** `fit: "nominal"` — a clearance hole as wide as the screw (M2 → 2 mm), no clearance. */
      iso?: { size: string; type?: 'clearance' | 'tapped'; fit?: 'close' | 'normal' | 'loose' | 'nominal'; pitch?: number; tapDepth?: Num };
      /** ANSI inch holes: "#10", "1/4" — clearance (ASME B18.2.8 fits) or tapped (UNC by default; `tpi` 28 — UNF). */
      ansi?: { size: string; type?: 'clearance' | 'tapped'; fit?: 'close' | 'normal' | 'loose' | 'nominal'; tpi?: number; tapDepth?: Num };
    })
  | (Named & {
      op: 'linearPattern';
      features?: string[];
      parts?: Parts;
      direction: AxisSpec;
      distance: Num;
      count: number;
      direction2?: AxisSpec;
      distance2?: Num;
      count2?: number;
      boolean?: 'new' | 'add';
    })
  | (Named & { op: 'circularPattern'; features?: string[]; parts?: Parts; axis: AxisSpec; count: number; angle?: Num; boolean?: 'new' | 'add' })
  | (Named & { op: 'mirror'; features?: string[]; parts?: Parts; plane: PlaneSpec; boolean?: 'new' | 'add' })
  /**
   * Copies along a path — the curves of a sketch or model edges — spread over it (or `distance` apart), turning with
   * it (`orient: false` — only moved); `flip` — from the path's other end.
   */
  | (Named & {
      op: 'curvePattern';
      features?: string[];
      parts?: Parts;
      path: { sketch: string } | { edges: Edges };
      count: Num;
      distance?: Num;
      flip?: boolean;
      orient?: boolean;
      boolean?: 'new' | 'add';
    })
  /** Ribs from the curves of a sketch (lines, arcs) out to the parts: within its plane, or along its normal (`normal`). */
  /** `extend` (on by default) runs lines on along themselves and arcs along their tangents up to the parts; `draft` — an angle the sides taper by from the sketch (wider towards the part; `draftFlip` — narrower). */
  | (Named & { op: 'rib'; sketch?: string; thickness: Num; normal?: boolean; flip?: boolean; extend?: boolean; draft?: Num; draftFlip?: boolean })
  /**
   * Sketch regions rolled onto a cylindrical face (`onto`): `boolean` `add` (default) raises them `depth` out of it,
   * `remove` sinks them into it. The sketch plane runs along the cylinder's axis (tangent to it, usually).
   */
  | (Named & { op: 'wrap'; sketch?: string; regions?: Regions; onto: FaceQuery; depth: Num; boolean?: 'add' | 'remove' })
  | (Named & { op: 'plane'; from: PlaneSpec; offset: Num })
  | (Named & {
      op: 'mateConnector';
      at: LocationSpec;
      /** "Between entities": the origin is halfway between `at` and this location. */
      between?: LocationSpec;
      /** Owner part (default: the part of `at`): the connector moves with it in later transforms. */
      owner?: PartQuery;
      primaryAxis?: AxisSpec;
      secondaryAxis?: AxisSpec;
      flip?: boolean;
      /** Turn the primary axis onto the connector's X or Y. */
      reorient?: 'x' | 'y';
      rotation?: Num;
      /** Offsets along the connector's own X, Y, Z. */
      offset?: [Num, Num, Num];
    })
  /** Move parts so that mate connector `from` lands on `to` (Onshape "mate connector to mate connector"). */
  | (Named & { op: 'transform'; parts: Parts; from: string; to: string; copy?: boolean })
  | (Named & { op: 'boolean'; type: 'union' | 'subtract' | 'intersect'; targets: Parts; tools: Parts; keepTools?: boolean })
  /** Delete parts; with `dissolve` (Dissolve composite parts) — the composites among them become their bodies again. */
  | (Named & { op: 'deletePart'; parts: Parts; dissolve?: boolean })
  /**
   * Composite part (Onshape): the parts act as one part (one row in the BOM, one instance in an assembly). `closed` —
   * they are consumed (only the composite is left); open by default — they stay parts of their own too.
   */
  | (Named & { op: 'composite'; parts: Parts; closed?: boolean })
  /** Any feature type with raw params; values like {"$edges": …} are resolved (see docs). */
  | (Named & { op: 'feature'; type: FeatureType; params: Record<string, unknown> })
  /**
   * Derived (Onshape): parts of another Part Studio of the document (`studio`, by name), linked one way — they stand
   * where they are there and follow its changes. `parts` — their names (all of them by default).
   */
  /**
   * `configuration` — of the source: input name → option name, a variable input's value (the others as chosen there).
   * `at` — a mate connector of this Part Studio to put the parts at: the source's origin lands there (or its mate
   * connector `from`); without it — where they stand in the source.
   */
  | (Named & {
      op: 'derived';
      studio: string;
      /** A saved version (its name) to take the Part Studio from — of this document or of `document` (by name). */
      version?: string;
      document?: string;
      parts?: string[];
      sketches?: string[];
      configuration?: Record<string, string | number>;
      at?: string;
      from?: string;
    })
  /** Merge params into an existing feature (same $-queries as 'feature'). */
  | { op: 'set'; feature: string; params: Record<string, unknown> }
  | { op: 'setVariable'; name: string; value: Num }
  | { op: 'delete'; feature: string }
  | { op: 'rename'; feature: string; to: string }
  | { op: 'suppress'; feature: string; value?: boolean }
  /**
   * A configuration input (Onshape List): its options and the table of configured parameters — `{feature, param}`
   * (a dialog field: `depth`, `thin`…; `suppressed` by default) or `{variable}`; `values[option]` — one value per
   * parameter (an expression or number, true / false, null — the feature's own). Replaces an input of that name.
   */
  | {
      op: 'configuration';
      name: string;
      /** The options (rows); a `checkbox` input has two — off and on (by default named "Off", "On"). */
      options?: string[];
      checkbox?: boolean;
      params?: ConfigParamSpec[];
      values?: Record<string, (Num | boolean | null)[]>;
      /**
       * A variable input (Onshape Configuration variable) instead of options: the variable `#name` (made at the top
       * of the feature list if there is none) gets any value typed for it — `value` is its own (default) one.
       */
      variable?: { value?: Num; type?: 'length' | 'angle' | 'number' | 'any' };
    }
  /** Choose options of configuration inputs: input name → option name (a checkbox input: true / false too; a variable input: its value). */
  | { op: 'configure'; values: Record<string, string | number | boolean> }
  /**
   * `material`: a library one by id or name ("aluminum", "PLA" — its density with it) or one of your own (with `density`,
   * g/cm³); `material: null` — none (mass as steel).
   */
  | { op: 'part'; part: PartQuery; name?: string; color?: string; opacity?: number; hidden?: boolean; material?: string | null; density?: number };

/**
 * Where a mate attaches on an instance: a face / edge (queries in assembly coordinates, on that instance), the
 * vertex nearest to a point, or a mate connector of its Part Studio (by feature name). `instance` — its name
 * ("Pin <1>"); a part inside a sub-assembly: "Sub <1>/Pin <1>".
 */
export type MateEndSpec = { instance: string; face?: FaceQuery; edge?: EdgeQuery; vertex?: Pt3; connector?: string };

export type MateType = 'fastened' | 'revolute' | 'slider' | 'cylindrical' | 'planar' | 'ball' | 'parallel' | 'pinSlot' | 'tangent' | 'width';

/** Assembly operations: they work on an assembly tab (the active one, or the one an `assembly` op opens). */
export type AssemblyOp =
  /** Open the assembly tab with this name, or create it (default name "Assembly N"). */
  | { op: 'assembly'; name?: string }
  /**
   * Insert a part of a Part Studio (`part`, `studio?`) or a whole assembly as a sub-assembly (`assembly`;
   * `flexible` — its parts move here as its own mates allow).
   */
  | {
      op: 'insert';
      part?: string;
      studio?: string;
      assembly?: string;
      name?: string;
      position?: Pt3;
      rotation?: Pt3;
      fixed?: boolean;
      flexible?: boolean;
      /** Its own configuration of the Part Studio: input name → option name, a variable input's value (the others follow the Part Studio). */
      configuration?: Record<string, string | number>;
    }
  /** Move / turn / fix / hide / rename an instance (positions in document units, rotation in degrees about X, Y, Z); make a sub-assembly flexible or rigid. */
  | { op: 'place'; instance: string; position?: Pt3; rotation?: Pt3; fixed?: boolean; hidden?: boolean; name?: string; flexible?: boolean; configuration?: Record<string, string | number> }
  | {
      op: 'mate';
      type: MateType;
      a: MateEndSpec;
      b: MateEndSpec;
      /** Width mate: the second face of each pair. */
      a2?: MateEndSpec;
      b2?: MateEndSpec;
      name?: string;
      flip?: boolean;
      angle?: number;
      offset?: Num;
      limits?: { zMin?: Num; zMax?: Num; aMin?: number; aMax?: number };
    }
  | { op: 'group'; instances: string[]; name?: string }
  | { op: 'relation'; type: 'gear' | 'rackPinion' | 'screw'; a: string; b?: string; value: Num; reverse?: boolean; name?: string }
  | { op: 'deleteInstance'; instance: string }
  | { op: 'deleteMate'; mate: string }
  /**
   * An exploded view (Onshape): its steps move (`distance` along `dir`) and / or turn (`angle` degrees about `dir`
   * through `pivot`, by default the centre of the step's instances) instances apart, one after another. Shown only:
   * the placements stay. Replaces the view of that name (`add` — its steps are added after the view's own).
   */
  | { op: 'explodedView'; name?: string; steps: ExplodeStepSpec[]; add?: boolean }
  | { op: 'deleteExplodedView'; name: string };

/** One step of an exploded view: a direction by axis name ("+z", "-x"…) or a vector; a distance in document units. */
export interface ExplodeStepSpec {
  instances: string[];
  dir: Pt3 | 'x' | 'y' | 'z' | '+x' | '+y' | '+z' | '-x' | '-y' | '-z';
  distance?: Num;
  angle?: number;
  pivot?: Pt3;
}

/** Animate a mate (Onshape Animate), as a query: where the instances that move are at each frame. */
export interface AnimateQuery {
  mate: string;
  /** `turn` (degrees) or `slide` (document units along the mate's Z); the mate's first free motion by default. */
  motion?: 'turn' | 'slide';
  /** The range: the mate's limits, else from where it is now a full turn / 20 mm. */
  from?: number;
  to?: number;
  /** Frames, the ends included (2…50, by default 5). */
  frames?: number;
  /** The assembly (by name): the open one by default. */
  assembly?: string;
}

export interface AnimateResult {
  mate: string;
  motion: 'turn' | 'slide';
  frames: { value: number; instances: { name: string; position: Pt3; rotation: Pt3; bboxMin?: Pt3; bboxMax?: Pt3 }[] }[];
}

/** An assembly in a report: instances (placement and box in document units), mates and whether they hold. */
export interface AssemblySummary {
  name: string;
  instances: {
    name: string;
    source: string;
    position: Pt3;
    rotation: Pt3;
    fixed?: boolean;
    hidden?: boolean;
    flexible?: boolean;
    /** Its own configuration options: input name → option name. */
    configuration?: Record<string, string>;
    bboxMin?: Pt3;
    bboxMax?: Pt3;
  }[];
  mates: { name: string; type: string; a: string; b: string; ok: boolean }[];
  groups: { name: string; instances: string[] }[];
  relations: { name: string; type: string; ok: boolean }[];
  /** Exploded views: their steps, and the boxes of the instances they move when fully exploded. */
  explodedViews?: { name: string; steps: number; moved: { name: string; bboxMin: Pt3; bboxMax: Pt3 }[] }[];
}

export interface FeatureSummary {
  name: string;
  type: string;
  status: 'ok' | 'warning' | 'error' | 'suppressed' | 'rolledBack';
  message?: string;
}

export interface PartSummary {
  id: string;
  name: string;
  bboxMin: Pt3;
  bboxMax: Pt3;
  size: Pt3;
  volume?: number;
  area?: number;
  /** Its material's name (none — no material: the mass is as of steel, 7.85 g/cm³). */
  material?: string;
  /** Mass, kg, by its material's density. */
  mass?: number;
  faces: number;
  edges: number;
  /** A surface body (no volume). */
  surface?: true;
  /** A composite part: the names of its bodies; closed — they are no parts of their own, open — they are listed too. */
  composite?: { closed: boolean; members: string[] };
}

export interface SketchSummary {
  name: string;
  origin: Pt3;
  xDir: Pt3;
  yDir: Pt3;
  normal: Pt3;
  regions: number;
}

/** Model state in document units (volume in unit³). */
/** A configured parameter: a feature's dialog field (`suppressed` — whether it is disabled) or a variable's value. */
export type ConfigParamSpec =
  | { feature: string; param?: string }
  /** A dimension of a sketch: its number among the sketch's dimensions (from 1, in the order they were made). */
  | { feature: string; dimension: number }
  | { variable: string };

export interface ModelSummary {
  units: { length: string; angle: string };
  /** Configuration inputs: their options, the chosen one and the configured parameters ("Extrude 1.depth", "#w"). */
  configuration?: { name: string; options: string[]; chosen: string; params: string[]; variable?: true }[];
  features: FeatureSummary[];
  variables: Record<string, string>;
  parts: PartSummary[];
  sketches: SketchSummary[];
  /** Mate connectors: origin and axes (document units), owner part name. */
  mates: { name: string; origin: Pt3; xDir: Pt3; zDir: Pt3; owner?: string }[];
  /** Cosmetic threads of tapped holes: where each starts, its direction into the material and length (document units). */
  threads?: { designation: string; origin: Pt3; dir: Pt3; length: number; part?: string }[];
}

export interface RunReport {
  ok: boolean;
  /** Fatal error of an op (nothing was applied). */
  error?: string;
  added: string[];
  changed: string[];
  removed: string[];
  /** Features that the geometry kernel could not build. */
  failed: { feature: string; error: string }[];
  /** Whether the result was written to the document. */
  applied: boolean;
  model?: ModelSummary;
  /** Assembly operations: the assembly after them. */
  assembly?: AssemblySummary;
}
