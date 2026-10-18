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
}

export type FieldSpecs = Partial<Record<FeatureType, Record<string, FieldSpec>>>;

const PROFILE: SelToken[] = ['region', 'planarFace'];
const AXIS: SelToken[] = ['sketchLine', 'linearEdge', 'circularEdge', 'cylFace', 'mate'];
const DIRECTION: SelToken[] = ['sketchLine', 'linearEdge', 'planarFace', 'plane', 'cylFace', 'circularEdge'];
const PLANE: SelToken[] = ['plane', 'planarFace'];
const POINT: SelToken[] = ['sketchPoint', 'vertex', 'origin', 'circularEdge', 'mate'];

export const FIELD_SPECS: FieldSpecs = {
  extrude: {
    profiles: { label: 'Faces and sketch regions to extrude', accepts: PROFILE },
    upTo: { label: 'Up to', accepts: ['planarFace', 'plane', 'vertex', 'sketchPoint'], max: 1 },
    upTo2: { label: 'Up to', accepts: ['planarFace', 'plane', 'vertex', 'sketchPoint'], max: 1 },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  revolve: {
    profiles: { label: 'Faces and sketch regions to revolve', accepts: PROFILE },
    axis: { label: 'Revolve axis', accepts: AXIS, max: 1 },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  sweep: {
    profiles: { label: 'Faces and sketch regions to sweep', accepts: PROFILE },
    path: { label: 'Path', accepts: ['sketchCurve', 'edge'] },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  loft: {
    profiles: { label: 'Profiles', accepts: ['region', 'planarFace', 'sketchPoint', 'vertex'] },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  thicken: {
    faces: { label: 'Faces and sketch regions', accepts: ['region', 'face'] },
    parts: { label: 'Merge scope', accepts: ['part'] },
  },
  fillet: { edges: { label: 'Edges and faces to fillet', accepts: ['edge', 'face'] } },
  chamfer: { edges: { label: 'Edges and faces to chamfer', accepts: ['edge', 'face'] } },
  shell: { faces: { label: 'Faces to remove', accepts: ['face', 'part'] } },
  draft: {
    neutral: { label: 'Neutral plane', accepts: PLANE, max: 1 },
    faces: { label: 'Faces to draft', accepts: ['face'] },
  },
  hole: {
    points: { label: 'Sketch points to place holes', accepts: ['sketchPoint', 'circularEdge'] },
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
  mirror: {
    parts: { label: 'Parts to mirror', accepts: ['part'] },
    plane: { label: 'Mirror plane', accepts: PLANE, max: 1 },
  },
  boolean: {
    tools: { label: 'Tools', accepts: ['part'] },
    targets: { label: 'Targets', accepts: ['part'] },
  },
  split: {
    parts: { label: 'Parts to split', accepts: ['part'] },
    tool: { label: 'Split tool', accepts: PLANE, max: 1 },
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
