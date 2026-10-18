// Declarative layouts of feature dialogs (Onshape-like field order).

import type { FeatureType, SelRef } from '../core/types';

type P = Record<string, unknown>;

export type Row = { when?: (p: P) => boolean } & (
  | { kind: 'segmented'; key: string; options: [string, string][] }
  | { kind: 'select'; key: string; label: string; options: [string, string][] }
  | { kind: 'sel'; key: string }
  | { kind: 'expr'; key: string; label: string; unit: 'length' | 'angle' | 'number'; flipKey?: string; unitKey?: string }
  | { kind: 'check'; key: string; label: string }
  | { kind: 'flip'; key: string; label: string }
  | { kind: 'text'; key: string; label: string }
  | { kind: 'features'; key: string; label: string }
  | { kind: 'merge' }
  | { kind: 'file' }
  | { kind: 'section'; label: string }
);

const OPS: [string, string][] = [
  ['new', 'New'],
  ['add', 'Add'],
  ['remove', 'Remove'],
  ['intersect', 'Intersect'],
];
const isOp = (p: P) => p.op !== 'new';

/** Kind of a mate connector location, for its "which point" choices. */
function locationKind(p: P, key = 'location'): 'line' | 'circle' | 'axis' | null {
  const r = (p[key] as SelRef[] | undefined)?.[0];
  if (r?.kind === 'edge') return r.sig.type === 'CIRCLE' ? 'circle' : 'line';
  if (r?.kind === 'face' && ['CYLINDRE', 'CONE', 'TORUS', 'REVOLUTION_SURFACE'].includes(r.sig.type)) return 'axis';
  return null;
}

export const FORMS: Partial<Record<FeatureType, Row[]>> = {
  extrude: [
    { kind: 'segmented', key: 'op', options: OPS },
    { kind: 'sel', key: 'profiles' },
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
    { kind: 'check', key: 'thin', label: 'Thin' },
    { kind: 'expr', key: 'thickness', label: 'Thickness', unit: 'length', flipKey: 'thinFlip', when: (p) => !!p.thin },
    { kind: 'check', key: 'draft', label: 'Draft' },
    { kind: 'expr', key: 'draftAngle', label: 'Draft angle', unit: 'angle', flipKey: 'draftFlip', when: (p) => !!p.draft },
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
    { kind: 'merge', when: isOp },
  ],
  revolve: [
    { kind: 'segmented', key: 'op', options: OPS },
    { kind: 'sel', key: 'profiles' },
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
    { kind: 'merge', when: isOp },
  ],
  sweep: [
    { kind: 'segmented', key: 'op', options: OPS },
    { kind: 'sel', key: 'profiles' },
    { kind: 'sel', key: 'path' },
    { kind: 'check', key: 'keepOrientation', label: 'Keep profile orientation' },
    { kind: 'merge', when: isOp },
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
    { kind: 'sel', key: 'edges' },
    { kind: 'expr', key: 'radius', label: 'Radius', unit: 'length' },
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
  hole: [
    {
      kind: 'segmented',
      key: 'style',
      options: [
        ['simple', 'Simple'],
        ['counterbore', 'Counterbore'],
        ['countersink', 'Countersink'],
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
    { kind: 'expr', key: 'diameter', label: 'Diameter', unit: 'length' },
    { kind: 'expr', key: 'depth', label: 'Depth', unit: 'length', when: (p) => p.endType === 'blind' },
    { kind: 'expr', key: 'tipAngle', label: 'Tip angle', unit: 'angle', when: (p) => p.endType === 'blind' },
    { kind: 'expr', key: 'cboreDiameter', label: 'Counterbore diameter', unit: 'length', when: (p) => p.style === 'counterbore' },
    { kind: 'expr', key: 'cboreDepth', label: 'Counterbore depth', unit: 'length', when: (p) => p.style === 'counterbore' },
    { kind: 'expr', key: 'csinkDiameter', label: 'Countersink diameter', unit: 'length', when: (p) => p.style === 'countersink' },
    { kind: 'expr', key: 'csinkAngle', label: 'Countersink angle', unit: 'angle', when: (p) => p.style === 'countersink' },
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
    { kind: 'sel', key: 'targets', when: (p) => p.op === 'subtract' },
    { kind: 'check', key: 'keepTools', label: 'Keep tools', when: (p) => p.op === 'subtract' },
  ],
  split: [
    { kind: 'sel', key: 'parts' },
    { kind: 'sel', key: 'tool' },
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
  deletePart: [{ kind: 'sel', key: 'parts' }],
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
