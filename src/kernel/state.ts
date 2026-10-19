import type * as R from 'replicad';
import type { VariableTable } from '../core/expr';
import type { BoolOp, PlaneFrame, SkEntity, Vec3 } from '../core/types';
import type { SketchRegion } from '../sketch/regions';
import type { Shape3D } from './geom';

export interface PartState {
  id: string;
  shape: Shape3D;
}

export interface SketchState {
  featureId: string;
  frame: PlaneFrame;
  entities: SkEntity[];
  regions: SketchRegion[];
  ok: boolean;
  /** Its feature's name (a sketch brought by a Derived feature: its name in the source). */
  name?: string;
}

export interface PlaneState {
  featureId: string;
  name: string;
  frame: PlaneFrame;
  size: number;
}

/** Mate connector: a local coordinate system (frame.normal = Z axis). */
export interface MateState {
  featureId: string;
  name: string;
  frame: PlaneFrame;
  /** Owner part id: the connector follows this part when a later Transform moves it. */
  owner?: string;
}

export interface CurveState {
  featureId: string;
  name: string;
  wire: R.Wire;
  points: Vec3[];
}

/** A cosmetic thread (of a tapped hole, Onshape): shown and listed, not modelled — the hole is the tap drill. */
export interface ThreadState {
  /** The feature that made it (a hole, or a pattern of it). */
  featureId: string;
  /** Where it starts on the hole's axis, and its direction into the material. */
  origin: Vec3;
  dir: Vec3;
  /** Major (nominal) and minor (the hole's) diameters, and its length. */
  major: number;
  minor: number;
  length: number;
  /** "M6", "M8×1". */
  designation: string;
  /** The part it is in: it follows that part's moves and copies. */
  owner?: string;
}

export interface ToolRecord {
  tool: Shape3D;
  op: BoolOp;
}

/** Immutable-by-convention snapshot of the part studio after N features. */
export interface BuildState {
  parts: Map<string, PartState>;
  sketches: Map<string, SketchState>;
  planes: Map<string, PlaneState>;
  mates: Map<string, MateState>;
  curves: Map<string, CurveState>;
  tools: Map<string, ToolRecord[]>;
  vars: VariableTable;
  /** Every part id ever created, in creation order (default "Part N" names). */
  partOrder: string[];
  /** Parts brought from another Part Studio (Derived): their names and colours there. */
  derived: Map<string, { name: string; color?: string }>;
  /** Cosmetic threads of tapped holes (and their copies). */
  threads: Map<string, ThreadState>;
}

export function emptyState(): BuildState {
  return {
    parts: new Map(),
    sketches: new Map(),
    planes: new Map(),
    mates: new Map(),
    curves: new Map(),
    tools: new Map(),
    vars: {},
    partOrder: [],
    derived: new Map(),
    threads: new Map(),
  };
}

export function cloneState(s: BuildState): BuildState {
  return {
    parts: new Map(s.parts),
    sketches: new Map(s.sketches),
    planes: new Map(s.planes),
    mates: new Map(s.mates),
    curves: new Map(s.curves),
    tools: new Map(s.tools),
    vars: { ...s.vars },
    partOrder: s.partOrder,
    derived: new Map(s.derived),
    threads: new Map(s.threads),
  };
}

export function setPart(st: BuildState, id: string, shape: Shape3D) {
  if (!st.partOrder.includes(id)) st.partOrder = [...st.partOrder, id];
  st.parts.set(id, { id, shape });
}

export function removePart(st: BuildState, id: string) {
  st.parts.delete(id);
  // its cosmetic threads go with it
  for (const [k, t] of st.threads) if (t.owner === id) st.threads.delete(k);
}

/** Part `from` merged into part `to` (before `from` is removed): its cosmetic threads are `to`'s now. */
export function adoptThreads(st: BuildState, from: string, to: string) {
  for (const [k, t] of st.threads) if (t.owner === from) st.threads.set(k, { ...t, owner: to });
}
