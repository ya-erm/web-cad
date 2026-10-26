// Declarative layouts of feature dialogs (Onshape-like field order).

import type { FeatureType, SelRef } from '../core/types';

type P = Record<string, unknown>;

export type Row = { when?: (p: P) => boolean } & (
  | { kind: 'segmented'; key: string; options: [string, string][] }
  | { kind: 'select'; key: string; label: string; options: [string, string][] }
  | { kind: 'sel'; key: string }
  | { kind: 'expr'; key: string; label: string; unit: 'length' | 'angle' | 'number'; flipKey?: string; unitKey?: string }
  /** `unsetOn` — checked while the parameter is not set (on by default). */
  | { kind: 'check'; key: string; label: string; unsetOn?: boolean }
  | { kind: 'flip'; key: string; label: string }
  | { kind: 'text'; key: string; label: string }
  | { kind: 'features'; key: string; label: string }
  | { kind: 'merge' }
  | { kind: 'file' }
  /** Derived: the source Part Studio and its parts. */
  | { kind: 'derivedSource' }
  /** Derived: the source's mate connector that lands on the chosen location. */
  | { kind: 'derivedPlaceFrom' }
  /** Hole: its standard, type, size, fit and pitch, and the sizes they give. */
  | { kind: 'holeStandard' }
  /** Variable fillet: a radius for each chosen vertex. */
  | { kind: 'vertexRadii' }
  /** Variable fillet: a position along the edge and a radius for each point on an edge. */
  | { kind: 'edgePoints' }
  | { kind: 'section'; label: string }
);

const OPS: [string, string][] = [
  ['new', 'New'],
  ['add', 'Add'],
  ['remove', 'Remove'],
  ['intersect', 'Intersect'],
];
const isOp = (p: P) => p.op !== 'new';
/** Extrude as a surface (sketch curves → a surface body). */
const isSurfaceBody = (p: P) => p.bodyType === 'surface';
/** A hole of a standard: its diameters come from the tables. */
const isIso = (p: P) => p.standard === 'iso' || p.standard === 'ansi';
/** A hole with a counterbore / a countersink (both: counterdrill). */
const hasCbore = (p: P) => p.style === 'counterbore' || p.style === 'counterdrill';
const hasCsink = (p: P) => p.style === 'countersink' || p.style === 'counterdrill';

/** Split: what its tool is — a surface body, a planar face (its plane unless trimmed) or something else. */
function toolKind(p: P): 'part' | 'planarFace' | null {
  const r = (p.tool as SelRef[] | undefined)?.[0];
  if (r?.kind === 'part') return 'part';
  return r?.kind === 'face' && r.sig.type === 'PLANE' ? 'planarFace' : null;
}

/** Kind of a mate connector location, for its "which point" choices. */
function locationKind(p: P, key = 'location'): 'line' | 'circle' | 'axis' | null {
  const r = (p[key] as SelRef[] | undefined)?.[0];
  if (r?.kind === 'edge') return r.sig.type === 'CIRCLE' ? 'circle' : 'line';
  if (r?.kind === 'face' && ['CYLINDRE', 'CONE', 'TORUS', 'REVOLUTION_SURFACE'].includes(r.sig.type)) return 'axis';
  return null;
}

/** Onshape creation type: Solid (regions) or Surface (curves). */
const BODY_TYPE: Row = {
  kind: 'segmented',
  key: 'bodyType',
  options: [
    ['solid', 'Solid'],
    ['surface', 'Surface'],
  ],
};

export const FORMS: Partial<Record<FeatureType, Row[]>> = {
  extrude: [
    BODY_TYPE,
    { kind: 'segmented', key: 'op', options: OPS, when: (p) => !isSurfaceBody(p) },
    { kind: 'sel', key: 'profiles', when: (p) => !isSurfaceBody(p) },
    { kind: 'sel', key: 'curves', when: isSurfaceBody },
    {
      kind: 'select',
      key: 'endType',
      label: 'End type',
      options: [
        ['blind', 'Blind'],
        ['symmetric', 'Symmetric'],
        ['upToFace', 'Up to face'],
        ['throughAll', 'Through all'],
      ],
    },
    { kind: 'sel', key: 'upTo', when: (p) => p.endType === 'upToFace' },
    { kind: 'expr', key: 'depth', label: 'Depth', unit: 'length', flipKey: 'flip', when: (p) => p.endType === 'blind' || p.endType === 'symmetric' },
    { kind: 'flip', key: 'flip', label: 'Opposite direction', when: (p) => p.endType !== 'blind' && p.endType !== 'symmetric' },
    { kind: 'check', key: 'thin', label: 'Thin', when: (p) => !isSurfaceBody(p) },
    { kind: 'expr', key: 'thickness', label: 'Thickness', unit: 'length', flipKey: 'thinFlip', when: (p) => !!p.thin && !isSurfaceBody(p) },
    { kind: 'check', key: 'draft', label: 'Draft', when: (p) => !isSurfaceBody(p) },
    { kind: 'expr', key: 'draftAngle', label: 'Draft angle', unit: 'angle', flipKey: 'draftFlip', when: (p) => !!p.draft && !isSurfaceBody(p) },
    // Onshape Starting offset: away from the sketch plane by a distance, or at a face / plane / connector / point
    { kind: 'check', key: 'startOffset', label: 'Starting offset' },
    {
      kind: 'select',
      key: 'startType',
      label: 'Start type',
      options: [
        ['blind', 'By distance'],
        ['entity', 'From entity'],
      ],
      when: (p) => !!p.startOffset,
    },
    { kind: 'expr', key: 'startDistance', label: 'Start offset', unit: 'length', flipKey: 'startFlip', when: (p) => !!p.startOffset && p.startType !== 'entity' },
    { kind: 'sel', key: 'startEntity', when: (p) => !!p.startOffset && p.startType === 'entity' },
    { kind: 'check', key: 'secondEnd', label: 'Second end position', when: (p) => p.endType !== 'symmetric' },
    {
      kind: 'select',
      key: 'endType2',
      label: 'End type',
      options: [
        ['blind', 'Blind'],
        ['upToFace', 'Up to face'],
        ['throughAll', 'Through all'],
      ],
      when: (p) => !!p.secondEnd && p.endType !== 'symmetric',
    },
    { kind: 'sel', key: 'upTo2', when: (p) => !!p.secondEnd && p.endType2 === 'upToFace' && p.endType !== 'symmetric' },
    { kind: 'expr', key: 'depth2', label: 'Depth', unit: 'length', when: (p) => !!p.secondEnd && p.endType2 === 'blind' && p.endType !== 'symmetric' },
    { kind: 'merge', when: (p) => isOp(p) && !isSurfaceBody(p) },
  ],
  revolve: [
    BODY_TYPE,
    { kind: 'segmented', key: 'op', options: OPS, when: (p) => !isSurfaceBody(p) },
    { kind: 'sel', key: 'profiles', when: (p) => !isSurfaceBody(p) },
    { kind: 'sel', key: 'curves', when: isSurfaceBody },
    { kind: 'sel', key: 'axis' },
    {
      kind: 'select',
      key: 'revolveType',
      label: 'Revolve type',
      options: [
        ['full', 'Full'],
        ['one', 'One direction'],
        ['symmetric', 'Symmetric'],
        ['two', 'Two directions'],
      ],
    },
    { kind: 'expr', key: 'angle', label: 'Angle', unit: 'angle', flipKey: 'flip', when: (p) => p.revolveType !== 'full' },
    { kind: 'expr', key: 'angle2', label: 'Second angle', unit: 'angle', when: (p) => p.revolveType === 'two' },
    { kind: 'merge', when: (p) => isOp(p) && !isSurfaceBody(p) },
  ],
  sweep: [
    BODY_TYPE,
    { kind: 'segmented', key: 'op', options: OPS, when: (p) => !isSurfaceBody(p) },
    { kind: 'sel', key: 'profiles', when: (p) => !isSurfaceBody(p) },
    { kind: 'sel', key: 'curves', when: isSurfaceBody },
    { kind: 'sel', key: 'path' },
    { kind: 'check', key: 'keepOrientation', label: 'Keep profile orientation' },
    { kind: 'merge', when: (p) => isOp(p) && !isSurfaceBody(p) },
  ],
  loft: [
    { kind: 'segmented', key: 'op', options: OPS },
    { kind: 'sel', key: 'profiles' },
    { kind: 'check', key: 'ruled', label: 'Ruled' },
    { kind: 'merge', when: isOp },
  ],
  thicken: [
    { kind: 'segmented', key: 'op', options: OPS },
    { kind: 'sel', key: 'faces' },
    { kind: 'expr', key: 'thickness', label: 'Thickness', unit: 'length', flipKey: 'flip' },
    { kind: 'merge', when: isOp },
  ],
  fillet: [
    {
      kind: 'segmented',
      key: 'filletType',
      options: [
        ['edge', 'Constant radius'],
        ['variable', 'Variable radius'],
      ],
    },
    { kind: 'sel', key: 'edges' },
    { kind: 'expr', key: 'radius', label: 'Radius', unit: 'length' },
    // Variable: vertices of the edges with radii of their own
    { kind: 'sel', key: 'vertices', when: (p) => p.filletType === 'variable' },
    { kind: 'vertexRadii', when: (p) => p.filletType === 'variable' },
    // and points inside edges: a position along the edge and a radius each
    { kind: 'sel', key: 'pointEdges', when: (p) => p.filletType === 'variable' },
    { kind: 'edgePoints', when: (p) => p.filletType === 'variable' },
    { kind: 'check', key: 'smooth', label: 'Smooth transition', when: (p) => p.filletType === 'variable' },
    { kind: 'check', key: 'tangentPropagation', label: 'Tangent propagation' },
  ],
  chamfer: [
    { kind: 'sel', key: 'edges' },
    {
      kind: 'select',
      key: 'chamferType',
      label: 'Chamfer type',
      options: [
        ['equal', 'Equal distance'],
        ['twoDistances', 'Two distances'],
        ['distanceAngle', 'Distance and angle'],
      ],
    },
    { kind: 'expr', key: 'distance', label: 'Distance', unit: 'length' },
    { kind: 'expr', key: 'distance2', label: 'Distance 2', unit: 'length', when: (p) => p.chamferType === 'twoDistances' },
    { kind: 'expr', key: 'angle', label: 'Angle', unit: 'angle', when: (p) => p.chamferType === 'distanceAngle' },
    { kind: 'flip', key: 'flip', label: 'Opposite direction', when: (p) => p.chamferType !== 'equal' },
    { kind: 'check', key: 'tangentPropagation', label: 'Tangent propagation' },
  ],
  shell: [
    { kind: 'sel', key: 'faces' },
    { kind: 'expr', key: 'thickness', label: 'Thickness', unit: 'length' },
    { kind: 'check', key: 'outward', label: 'Shell outward' },
  ],
  draft: [
    { kind: 'sel', key: 'neutral' },
    { kind: 'sel', key: 'faces' },
    { kind: 'expr', key: 'angle', label: 'Draft angle', unit: 'angle', flipKey: 'flip' },
  ],
  deleteFace: [
    { kind: 'sel', key: 'faces' },
    // off: the faces go, the part becomes a surface (Onshape: Heal)
    { kind: 'check', key: 'heal', label: 'Heal', unsetOn: true },
  ],
  offsetSurface: [
    { kind: 'sel', key: 'faces' },
    { kind: 'expr', key: 'distance', label: 'Distance', unit: 'length', flipKey: 'flip' },
  ],
  enclose: [
    { kind: 'sel', key: 'surfaces' },
    { kind: 'check', key: 'keep', label: 'Keep surfaces' },
  ],
  moveFace: [
    {
      kind: 'segmented',
      key: 'moveType',
      options: [
        ['offset', 'Offset'],
        ['translate', 'Translate'],
        ['rotate', 'Rotate'],
      ],
    },
    { kind: 'sel', key: 'faces' },
    { kind: 'sel', key: 'direction', when: (p) => p.moveType === 'translate' },
    { kind: 'sel', key: 'axis', when: (p) => p.moveType === 'rotate' },
    { kind: 'expr', key: 'distance', label: 'Distance', unit: 'length', flipKey: 'flip', when: (p) => p.moveType !== 'rotate' },
    { kind: 'expr', key: 'angle', label: 'Angle', unit: 'angle', flipKey: 'flip', when: (p) => p.moveType === 'rotate' },
  ],
  replaceFace: [
    { kind: 'sel', key: 'faces' },
    { kind: 'sel', key: 'target' },
    { kind: 'expr', key: 'offset', label: 'Offset', unit: 'length', flipKey: 'flip' },
  ],
  hole: [
    {
      kind: 'select',
      key: 'style',
      label: 'Hole style',
      options: [
        ['simple', 'Simple'],
        ['counterbore', 'Counterbore'],
        ['countersink', 'Countersink'],
        ['counterdrill', 'Counterbore and countersink'],
      ],
    },
    { kind: 'sel', key: 'points' },
    {
      kind: 'select',
      key: 'endType',
      label: 'Termination',
      options: [
        ['blind', 'Blind'],
        ['throughAll', 'Through all'],
      ],
    },
    // Onshape: the arrow by the termination — all the holes the other way round
    { kind: 'flip', key: 'flip', label: 'Direction' },
    // Onshape: Standard (ISO) — type, size, fit / pitch; the diameters from the tables
    { kind: 'holeStandard' },
    { kind: 'expr', key: 'diameter', label: 'Diameter', unit: 'length', when: (p) => !isIso(p) },
    { kind: 'expr', key: 'depth', label: 'Depth', unit: 'length', when: (p) => p.endType === 'blind' },
    { kind: 'expr', key: 'tapDepth', label: 'Tapped depth', unit: 'length', when: (p) => isIso(p) && p.holeType === 'tapped' && p.endType === 'blind' },
    { kind: 'expr', key: 'tipAngle', label: 'Tip angle', unit: 'angle', when: (p) => p.endType === 'blind' },
    { kind: 'expr', key: 'cboreDiameter', label: 'Counterbore diameter', unit: 'length', when: (p) => hasCbore(p) && !isIso(p) },
    { kind: 'expr', key: 'cboreDepth', label: 'Counterbore depth', unit: 'length', when: (p) => hasCbore(p) && !isIso(p) },
    { kind: 'expr', key: 'csinkDiameter', label: 'Countersink diameter', unit: 'length', when: (p) => hasCsink(p) && !isIso(p) },
    { kind: 'expr', key: 'csinkAngle', label: 'Countersink angle', unit: 'angle', when: (p) => hasCsink(p) && !isIso(p) },
    // a cylindrical recess above a countersink (0 — none); ISO too
    { kind: 'expr', key: 'csinkRecess', label: 'Recess depth', unit: 'length', when: (p) => p.style === 'countersink' },
    { kind: 'check', key: 'scopeAll', label: 'Merge with all' },
    { kind: 'sel', key: 'scope', when: (p) => !p.scopeAll },
  ],
  linearPattern: [
    {
      kind: 'segmented',
      key: 'patternType',
      options: [
        ['part', 'Part pattern'],
        ['feature', 'Feature pattern'],
      ],
    },
    { kind: 'sel', key: 'parts', when: (p) => p.patternType === 'part' },
    { kind: 'features', key: 'features', label: 'Features to pattern', when: (p) => p.patternType === 'feature' },
    { kind: 'sel', key: 'direction' },
    { kind: 'expr', key: 'distance', label: 'Distance', unit: 'length', flipKey: 'flip' },
    { kind: 'expr', key: 'count', label: 'Instance count', unit: 'number' },
    { kind: 'check', key: 'secondDir', label: 'Second direction' },
    { kind: 'sel', key: 'direction2', when: (p) => !!p.secondDir },
    { kind: 'expr', key: 'distance2', label: 'Distance', unit: 'length', flipKey: 'flip2', when: (p) => !!p.secondDir },
    { kind: 'expr', key: 'count2', label: 'Instance count', unit: 'number', when: (p) => !!p.secondDir },
    {
      kind: 'segmented',
      key: 'op',
      options: [
        ['new', 'New'],
        ['add', 'Add'],
      ],
      when: (p) => p.patternType === 'part',
    },
  ],
  circularPattern: [
    {
      kind: 'segmented',
      key: 'patternType',
      options: [
        ['part', 'Part pattern'],
        ['feature', 'Feature pattern'],
      ],
    },
    { kind: 'sel', key: 'parts', when: (p) => p.patternType === 'part' },
    { kind: 'features', key: 'features', label: 'Features to pattern', when: (p) => p.patternType === 'feature' },
    { kind: 'sel', key: 'axis' },
    { kind: 'expr', key: 'angle', label: 'Angle', unit: 'angle', flipKey: 'flip' },
    { kind: 'expr', key: 'count', label: 'Instance count', unit: 'number' },
    { kind: 'check', key: 'equalSpacing', label: 'Equal spacing' },
    {
      kind: 'segmented',
      key: 'op',
      options: [
        ['new', 'New'],
        ['add', 'Add'],
      ],
      when: (p) => p.patternType === 'part',
    },
  ],
  curvePattern: [
    {
      kind: 'segmented',
      key: 'patternType',
      options: [
        ['part', 'Part pattern'],
        ['feature', 'Feature pattern'],
      ],
    },
    { kind: 'sel', key: 'parts', when: (p) => p.patternType === 'part' },
    { kind: 'features', key: 'features', label: 'Features to pattern', when: (p) => p.patternType === 'feature' },
    { kind: 'sel', key: 'path' },
    { kind: 'expr', key: 'count', label: 'Instance count', unit: 'number' },
    { kind: 'check', key: 'equalSpacing', label: 'Equal spacing' },
    { kind: 'expr', key: 'distance', label: 'Distance', unit: 'length', when: (p) => !p.equalSpacing },
    { kind: 'flip', key: 'flip', label: 'From the other end' },
    { kind: 'check', key: 'orient', label: 'Turn with the path' },
    {
      kind: 'segmented',
      key: 'op',
      options: [
        ['new', 'New'],
        ['add', 'Add'],
      ],
      when: (p) => p.patternType === 'part',
    },
  ],
  rib: [
    { kind: 'sel', key: 'profiles' },
    { kind: 'expr', key: 'thickness', label: 'Thickness', unit: 'length' },
    {
      kind: 'select',
      key: 'direction',
      label: 'Rib direction',
      options: [
        ['parallel', 'Parallel to sketch plane'],
        ['normal', 'Normal to sketch plane'],
      ],
    },
    { kind: 'flip', key: 'flip', label: 'Opposite direction' },
    { kind: 'check', key: 'extend', label: 'Extend profiles up to part' },
    { kind: 'check', key: 'draft', label: 'Draft' },
    { kind: 'expr', key: 'draftAngle', label: 'Draft angle', unit: 'angle', flipKey: 'draftFlip', when: (p) => !!p.draft },
    { kind: 'merge' },
  ],
  wrap: [
    {
      kind: 'segmented',
      key: 'op',
      options: [
        ['add', 'Emboss'],
        ['remove', 'Deboss'],
      ],
    },
    { kind: 'sel', key: 'profiles' },
    { kind: 'sel', key: 'target' },
    { kind: 'expr', key: 'depth', label: 'Depth', unit: 'length' },
    { kind: 'merge' },
  ],
  mirror: [
    {
      kind: 'segmented',
      key: 'patternType',
      options: [
        ['part', 'Part pattern'],
        ['feature', 'Feature pattern'],
      ],
    },
    { kind: 'sel', key: 'parts', when: (p) => p.patternType === 'part' },
    { kind: 'features', key: 'features', label: 'Features to mirror', when: (p) => p.patternType === 'feature' },
    { kind: 'sel', key: 'plane' },
    {
      kind: 'segmented',
      key: 'op',
      options: [
        ['new', 'New'],
        ['add', 'Add'],
      ],
      when: (p) => p.patternType === 'part',
    },
  ],
  boolean: [
    {
      kind: 'segmented',
      key: 'op',
      options: [
        ['union', 'Union'],
        ['subtract', 'Subtract'],
        ['intersect', 'Intersect'],
      ],
    },
    { kind: 'sel', key: 'tools' },
    // intersect keeping its tools: the targets keep what lies inside them
    { kind: 'sel', key: 'targets', when: (p) => p.op === 'subtract' || (p.op === 'intersect' && !!p.keepTools) },
    { kind: 'check', key: 'keepTools', label: 'Keep tools', when: (p) => p.op !== 'union' },
  ],
  split: [
    { kind: 'sel', key: 'parts' },
    { kind: 'sel', key: 'tool' },
    { kind: 'check', key: 'trim', label: 'Trim to face boundaries', when: (p) => toolKind(p) === 'planarFace' },
    { kind: 'check', key: 'keepTools', label: 'Keep tools', when: (p) => toolKind(p) === 'part' },
  ],
  transform: [
    {
      kind: 'select',
      key: 'mode',
      label: 'Transform type',
      options: [
        ['translateXYZ', 'Translate by XYZ'],
        ['translateEntity', 'Translate by entity'],
        ['rotate', 'Rotate'],
        ['scale', 'Scale uniformly'],
        ['mates', 'Mate connector to mate connector'],
      ],
    },
    { kind: 'sel', key: 'parts' },
    { kind: 'sel', key: 'fromMate', when: (p) => p.mode === 'mates' },
    { kind: 'sel', key: 'toMate', when: (p) => p.mode === 'mates' },
    { kind: 'sel', key: 'direction', when: (p) => p.mode === 'translateEntity' },
    { kind: 'expr', key: 'distance', label: 'Distance', unit: 'length', flipKey: 'flip', when: (p) => p.mode === 'translateEntity' },
    { kind: 'expr', key: 'dx', label: 'X', unit: 'length', when: (p) => p.mode === 'translateXYZ' },
    { kind: 'expr', key: 'dy', label: 'Y', unit: 'length', when: (p) => p.mode === 'translateXYZ' },
    { kind: 'expr', key: 'dz', label: 'Z', unit: 'length', when: (p) => p.mode === 'translateXYZ' },
    { kind: 'sel', key: 'axis', when: (p) => p.mode === 'rotate' },
    { kind: 'expr', key: 'angle', label: 'Angle', unit: 'angle', flipKey: 'flip', when: (p) => p.mode === 'rotate' },
    { kind: 'sel', key: 'point', when: (p) => p.mode === 'scale' },
    { kind: 'expr', key: 'scale', label: 'Scale', unit: 'number', when: (p) => p.mode === 'scale' },
    { kind: 'check', key: 'copy', label: 'Copy part' },
  ],
  deletePart: [
    { kind: 'sel', key: 'parts' },
    { kind: 'check', key: 'dissolve', label: 'Dissolve composite parts' },
  ],
  compositePart: [
    { kind: 'sel', key: 'parts' },
    { kind: 'check', key: 'closed', label: 'Closed' },
  ],
  plane: [
    {
      kind: 'select',
      key: 'planeType',
      label: 'Plane type',
      options: [
        ['offset', 'Offset'],
        ['pointNormal', 'Point normal'],
        ['threePoint', 'Three point'],
        ['lineAngle', 'Line angle'],
        ['midplane', 'Mid plane'],
      ],
    },
    { kind: 'sel', key: 'refs' },
    { kind: 'expr', key: 'offset', label: 'Offset', unit: 'length', flipKey: 'flip', when: (p) => p.planeType === 'offset' },
    { kind: 'expr', key: 'angle', label: 'Angle', unit: 'angle', flipKey: 'flip', when: (p) => p.planeType === 'lineAngle' },
    { kind: 'flip', key: 'flip', label: 'Flip normal', when: (p) => p.planeType === 'pointNormal' || p.planeType === 'threePoint' },
  ],
  variable: [
    {
      kind: 'segmented',
      key: 'varType',
      options: [
        ['length', 'Length'],
        ['angle', 'Angle'],
        ['number', 'Number'],
        ['any', 'Any'],
      ],
    },
    { kind: 'text', key: 'name', label: 'Name' },
    { kind: 'expr', key: 'value', label: 'Value', unit: 'length', unitKey: 'varType' },
    { kind: 'text', key: 'description', label: 'Description' },
  ],
  import: [{ kind: 'file' }],
  derived: [{ kind: 'derivedSource' }, { kind: 'sel', key: 'placeTo' }, { kind: 'derivedPlaceFrom' }],
  helix: [
    { kind: 'sel', key: 'axis' },
    { kind: 'expr', key: 'radius', label: 'Radius', unit: 'length' },
    { kind: 'expr', key: 'pitch', label: 'Pitch', unit: 'length' },
    { kind: 'expr', key: 'turns', label: 'Revolutions', unit: 'number' },
    { kind: 'check', key: 'leftHanded', label: 'Left handed' },
  ],
  mateConnector: [
    {
      kind: 'segmented',
      key: 'mode',
      options: [
        ['on', 'On entity'],
        ['between', 'Between entities'],
      ],
    },
    { kind: 'sel', key: 'location' },
    // which point of the picked edge / cylinder (also chosen by clicking the inference dots)
    {
      kind: 'segmented',
      key: 'inference',
      options: [
        ['start', 'Start'],
        ['mid', 'Middle'],
        ['end', 'End'],
      ],
      when: (p) => locationKind(p) === 'line' || locationKind(p) === 'axis',
    },
    {
      kind: 'segmented',
      key: 'inference',
      options: [
        ['center', 'Center'],
        ['start', 'Start'],
        ['mid', 'Middle'],
        ['end', 'End'],
      ],
      when: (p) => locationKind(p) === 'circle',
    },
    { kind: 'sel', key: 'location2', when: (p) => p.mode === 'between' },
    {
      kind: 'segmented',
      key: 'inference2',
      options: [
        ['start', 'Start'],
        ['mid', 'Middle'],
        ['end', 'End'],
      ],
      when: (p) => p.mode === 'between' && (locationKind(p, 'location2') === 'line' || locationKind(p, 'location2') === 'axis'),
    },
    {
      kind: 'segmented',
      key: 'inference2',
      options: [
        ['center', 'Center'],
        ['start', 'Start'],
        ['mid', 'Middle'],
        ['end', 'End'],
      ],
      when: (p) => p.mode === 'between' && locationKind(p, 'location2') === 'circle',
    },
    { kind: 'sel', key: 'ownerPart' },
    { kind: 'sel', key: 'primaryAxis' },
    { kind: 'sel', key: 'secondaryAxis' },
    { kind: 'flip', key: 'flipPrimary', label: 'Flip primary axis' },
    { kind: 'section', label: 'Reorient: primary axis along' },
    {
      kind: 'segmented',
      key: 'reorient',
      options: [
        ['z', 'Z'],
        ['x', 'X'],
        ['y', 'Y'],
      ],
    },
    { kind: 'expr', key: 'rotation', label: 'Rotation about Z', unit: 'angle' },
    { kind: 'expr', key: 'dx', label: 'X offset', unit: 'length' },
    { kind: 'expr', key: 'dy', label: 'Y offset', unit: 'length' },
    { kind: 'expr', key: 'dz', label: 'Z offset', unit: 'length' },
  ],
};
