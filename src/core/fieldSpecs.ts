// Selection fields of feature dialogs: which kinds of geometry each accepts.
// Shared by the dialog UI (labels) and the viewport (click/hover filtering).

import type { FeatureType, SelRef } from './types';

export type SelToken =
  | 'region'
  | 'face'
  | 'planarFace'
  | 'cylFace'
  | 'edge'
  | 'linearEdge'
  | 'circularEdge'
  | 'vertex'
  | 'part'
  | 'sketchCurve'
  | 'sketchLine'
  | 'sketchPoint'
  | 'plane'
  /** mate connector (also satisfies 'plane') */
  | 'mate'
  | 'origin';

export interface FieldSpec {
  label: string;
  accepts: SelToken[];
  /** Maximum number of selections (1 = single). */
  max?: number;
  /** Parameters with a value for each selection (the same order): they lose the values of the selections removed. */
  parallel?: string | string[];
}

export type FieldSpecs = Partial<Record<FeatureType, Record<string, FieldSpec>>>;

/** Keep the selections of field `key` that pass `keep`, with their values of the parallel parameter (`spec.parallel`). */
export function keepRefs(params: Record<string, unknown>, key: string, keep: (r: SelRef) => boolean, spec?: FieldSpec) {
  const refs = (params[key] as SelRef[] | undefined) ?? [];
  const kept = refs.map((r, i) => (keep(r) ? i : -1)).filter((i) => i >= 0);
  params[key] = kept.map((i) => refs[i]);
  const keys = spec?.parallel === undefined ? [] : Array.isArray(spec.parallel) ? spec.parallel : [spec.parallel];
  for (const k of keys) {
    const values = params[k];
    // a selection with no value yet: '' (the default)
    if (Array.isArray(values)) params[k] = kept.map((i) => values[i] ?? '');
  }
}

const PROFILE: SelToken[] = ['region', 'planarFace'];
const AXIS: SelToken[] = ['sketchLine', 'linearEdge', 'circularEdge', 'cylFace', 'mate'];
const DIRECTION: SelToken[] = ['sketchLine', 'linearEdge', 'planarFace', 'plane', 'cylFace', 'circularEdge'];
const PLANE: SelToken[] = ['plane', 'planarFace'];
const POINT: SelToken[] = ['sketchPoint', 'vertex', 'origin', 'circularEdge', 'mate'];

export const FIELD_SPECS: FieldSpecs = {
  extrude: {
    profiles: { label: 'Faces and sketch regions to extrude', accepts: PROFILE },
    curves: { label: 'Sketch curves', accepts: ['sketchCurve'] },
    upTo: { label: 'Up to', accepts: ['planarFace', 'plane', 'vertex', 'sketchPoint'], max: 1 },
    upTo2: { label: 'Up to', accepts: ['planarFace', 'plane', 'vertex', 'sketchPoint'], max: 1 },
    startEntity: { label: 'Start at: face, plane, connector or point', accepts: ['planarFace', 'plane', 'vertex', 'sketchPoint'], max: 1 },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  revolve: {
    profiles: { label: 'Faces and sketch regions to revolve', accepts: PROFILE },
    curves: { label: 'Sketch curves and edges', accepts: ['sketchCurve', 'edge'] },
    axis: { label: 'Revolve axis', accepts: AXIS, max: 1 },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  sweep: {
    profiles: { label: 'Faces and sketch regions to sweep', accepts: PROFILE },
    curves: { label: 'Sketch curves and edges', accepts: ['sketchCurve', 'edge'] },
    path: { label: 'Path', accepts: ['sketchCurve', 'edge'] },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  loft: {
    profiles: { label: 'Profiles', accepts: ['region', 'planarFace', 'sketchPoint', 'vertex'] },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  thicken: {
    faces: { label: 'Faces, surfaces and sketch regions', accepts: ['region', 'face', 'part'] },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  offsetSurface: { faces: { label: 'Faces to offset', accepts: ['face'] } },
  enclose: { surfaces: { label: 'Surfaces to enclose', accepts: ['part'] } },
  fillet: {
    edges: { label: 'Edges and faces to fillet', accepts: ['edge', 'face'] },
    vertices: { label: 'Vertices with their own radius', accepts: ['vertex'], parallel: 'vertexRadii' },
    pointEdges: { label: 'Points on edges', accepts: ['edge'], parallel: ['pointPositions', 'pointRadii'] },
  },
  chamfer: { edges: { label: 'Edges and faces to chamfer', accepts: ['edge', 'face'] } },
  shell: { faces: { label: 'Faces to remove', accepts: ['face', 'part'] } },
  deleteFace: { faces: { label: 'Faces to delete', accepts: ['face'] } },
  moveFace: {
    faces: { label: 'Faces to move', accepts: ['face'] },
    direction: { label: 'Direction', accepts: DIRECTION, max: 1 },
    axis: { label: 'Axis', accepts: AXIS, max: 1 },
  },
  replaceFace: {
    faces: { label: 'Faces to replace', accepts: ['planarFace'] },
    target: { label: 'Replace with', accepts: [...PLANE, 'mate'], max: 1 },
  },
  draft: {
    neutral: { label: 'Neutral plane', accepts: PLANE, max: 1 },
    faces: { label: 'Faces to draft', accepts: ['face'] },
  },
  hole: {
    points: { label: 'Sketch points to place holes', accepts: ['sketchPoint', 'circularEdge', 'mate'] },
    scope: { label: 'Merge scope', accepts: ['part'] },
  },
  linearPattern: {
    parts: { label: 'Parts to pattern', accepts: ['part'] },
    direction: { label: 'Direction', accepts: DIRECTION, max: 1 },
    direction2: { label: 'Second direction', accepts: DIRECTION, max: 1 },
  },
  circularPattern: {
    parts: { label: 'Parts to pattern', accepts: ['part'] },
    axis: { label: 'Axis', accepts: AXIS, max: 1 },
  },
  curvePattern: {
    parts: { label: 'Parts to pattern', accepts: ['part'] },
    path: { label: 'Path', accepts: ['sketchCurve', 'edge'] },
  },
  rib: {
    profiles: { label: 'Sketch curves', accepts: ['sketchCurve'] },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  wrap: {
    profiles: { label: 'Sketch regions to wrap', accepts: ['region'] },
    target: { label: 'Cylindrical face to wrap onto', accepts: ['cylFace'], max: 1 },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  mirror: {
    parts: { label: 'Parts to mirror', accepts: ['part'] },
    plane: { label: 'Mirror plane', accepts: PLANE, max: 1 },
  },
  boolean: {
    tools: { label: 'Tools', accepts: ['part'] },
    targets: { label: 'Targets', accepts: ['part'] },
  },
  split: {
    parts: { label: 'Parts and surfaces to split', accepts: ['part'] },
    tool: { label: 'Split tool: plane, face or surface', accepts: [...PLANE, 'face', 'part'], max: 1 },
  },
  transform: {
    parts: { label: 'Parts to transform', accepts: ['part'] },
    direction: { label: 'Direction', accepts: DIRECTION, max: 1 },
    axis: { label: 'Axis', accepts: AXIS, max: 1 },
    point: { label: 'Point', accepts: POINT, max: 1 },
    fromMate: { label: 'Mate connector to move', accepts: ['mate'], max: 1 },
    toMate: { label: 'Destination mate connector', accepts: ['mate'], max: 1 },
  },
  deletePart: { parts: { label: 'Parts to delete', accepts: ['part'] } },
  compositePart: { parts: { label: 'Parts', accepts: ['part'] } },
  derived: { placeTo: { label: 'Location (mate connector)', accepts: ['mate'], max: 1 } },
  plane: {
    refs: { label: 'Entities', accepts: ['plane', 'planarFace', 'vertex', 'sketchPoint', 'origin', 'sketchLine', 'linearEdge'] },
  },
  helix: { axis: { label: 'Axis', accepts: ['cylFace', 'circularEdge', 'sketchLine', 'linearEdge', 'mate'], max: 1 } },
  mateConnector: {
    location: {
      label: 'Location',
      accepts: ['vertex', 'edge', 'face', 'sketchPoint', 'sketchCurve', 'origin', 'plane'],
      max: 1,
    },
    location2: {
      label: 'Second location',
      accepts: ['vertex', 'edge', 'face', 'sketchPoint', 'sketchCurve', 'origin', 'plane'],
      max: 1,
    },
    ownerPart: { label: 'Owner part', accepts: ['part'], max: 1 },
    primaryAxis: { label: 'Primary axis (Z)', accepts: ['linearEdge', 'circularEdge', 'planarFace', 'cylFace', 'plane', 'sketchLine'], max: 1 },
    secondaryAxis: { label: 'Secondary axis (X)', accepts: ['linearEdge', 'planarFace', 'plane', 'sketchLine'], max: 1 },
  },
};

/** Classify a reference into the tokens it satisfies. `isPoint`/`isLine` describe sketch entities. */
export function refTokens(r: SelRef, extra: { sketchType?: string; mate?: boolean } = {}): SelToken[] {
  switch (r.kind) {
    case 'region':
      return ['region'];
    case 'face': {
      const t: SelToken[] = ['face'];
      if (r.sig.type === 'PLANE') t.push('planarFace');
      if (r.sig.type === 'CYLINDRE') t.push('cylFace');
      return t;
    }
    case 'edge': {
      const t: SelToken[] = ['edge'];
      if (r.sig.type === 'LINE') t.push('linearEdge');
      if (r.sig.type === 'CIRCLE') t.push('circularEdge');
      return t;
    }
    case 'vertex':
      return ['vertex'];
    case 'part':
      return ['part'];
    case 'plane':
      // a mate connector is also an axis (its Z) and a point (its origin)
      return extra.mate ? ['plane', 'mate'] : ['plane'];
    case 'origin':
      return ['origin'];
    case 'sketchEntity': {
      if (extra.sketchType === 'point') return ['sketchPoint'];
      if (extra.sketchType === 'line') return ['sketchCurve', 'sketchLine'];
      return ['sketchCurve'];
    }
  }
}

/** Convert a picked reference into one acceptable by the field (e.g. face → its part). */
export function adaptRef(r: SelRef, accepts: SelToken[], extra: { sketchType?: string; mate?: boolean } = {}): SelRef | null {
  const tokens = refTokens(r, extra);
  if (tokens.some((t) => accepts.includes(t))) return r;
  if (accepts.includes('part') && (r.kind === 'face' || r.kind === 'edge' || r.kind === 'vertex'))
    return { kind: 'part', partId: r.partId };
  return null;
}
