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
  };
}

export function setPart(st: BuildState, id: string, shape: Shape3D) {
  if (!st.partOrder.includes(id)) st.partOrder = [...st.partOrder, id];
  st.parts.set(id, { id, shape });
}

export function removePart(st: BuildState, id: string) {
  st.parts.delete(id);
}
