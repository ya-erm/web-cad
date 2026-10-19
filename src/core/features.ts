// Feature metadata (display names, defaults) and helpers shared by UI and kernel.

import { evaluateTypedVariable, tryEvaluate, type EvalContext, type VariableTable } from './expr';
import type { CadDocument, Feature, FeatureParamsMap, FeatureType, SketchData, SkConstraint } from './types';

export const FEATURE_LABELS: Record<FeatureType, string> = {
  sketch: 'Sketch',
  extrude: 'Extrude',
  revolve: 'Revolve',
  sweep: 'Sweep',
  loft: 'Loft',
  thicken: 'Thicken',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  shell: 'Shell',
  draft: 'Draft',
  deleteFace: 'Delete face',
  moveFace: 'Move face',
  replaceFace: 'Replace face',
  offsetSurface: 'Offset surface',
  enclose: 'Enclose',
  hole: 'Hole',
  linearPattern: 'Linear pattern',
  circularPattern: 'Circular pattern',
  curvePattern: 'Curve pattern',
  mirror: 'Mirror',
  rib: 'Rib',
  wrap: 'Wrap',
  boolean: 'Boolean',
  split: 'Split',
  transform: 'Transform',
  deletePart: 'Delete part',
  plane: 'Plane',
  variable: 'Variable',
  import: 'Import',
  derived: 'Derived',
  helix: 'Helix',
  mateConnector: 'Mate connector',
};

const mergeDefaults = { mergeAll: true, parts: [] };

export function defaultParams<T extends FeatureType>(type: T): FeatureParamsMap[T] {
  const d: { [K in FeatureType]: () => FeatureParamsMap[K] } = {
    sketch: () => ({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] }),
    extrude: () => ({
      ...mergeDefaults,
      op: 'new',
      profiles: [],
      endType: 'blind',
      depth: '25 mm',
      flip: false,
      upTo: [],
      secondEnd: false,
      endType2: 'blind',
      depth2: '25 mm',
      upTo2: [],
      draft: false,
      draftAngle: '3 deg',
      draftFlip: false,
      thin: false,
      thickness: '2 mm',
      thinFlip: false,
    }),
    revolve: () => ({
      ...mergeDefaults,
      op: 'new',
      profiles: [],
      axis: [],
      revolveType: 'full',
      angle: '90 deg',
      angle2: '45 deg',
      flip: false,
    }),
    sweep: () => ({ ...mergeDefaults, op: 'new', profiles: [], path: [], keepOrientation: false }),
    loft: () => ({ ...mergeDefaults, op: 'new', profiles: [], ruled: false }),
    thicken: () => ({ ...mergeDefaults, op: 'new', faces: [], thickness: '2 mm', flip: false }),
    fillet: () => ({ edges: [], radius: '2 mm', tangentPropagation: true }),
    chamfer: () => ({
      edges: [],
      chamferType: 'equal',
      distance: '2 mm',
      distance2: '3 mm',
      angle: '45 deg',
      flip: false,
      tangentPropagation: true,
    }),
    shell: () => ({ faces: [], thickness: '2 mm', outward: false }),
    draft: () => ({ neutral: [], faces: [], angle: '3 deg', flip: false }),
    deleteFace: () => ({ faces: [], heal: true }),
    offsetSurface: () => ({ faces: [], distance: '0 mm', flip: false }),
    enclose: () => ({ surfaces: [], keep: false }),
    moveFace: () => ({ faces: [], moveType: 'offset', distance: '2 mm', flip: false, direction: [], axis: [], angle: '15 deg' }),
    replaceFace: () => ({ faces: [], target: [], offset: '0 mm', flip: false }),
    hole: () => ({
      points: [],
      style: 'simple',
      endType: 'blind',
      diameter: '5 mm',
      depth: '10 mm',
      cboreDiameter: '9 mm',
      cboreDepth: '4 mm',
      csinkDiameter: '10 mm',
      csinkAngle: '90 deg',
      csinkRecess: '0 mm',
      tipAngle: '118 deg',
      scopeAll: true,
      scope: [],
    }),
    linearPattern: () => ({
      patternType: 'part',
      parts: [],
      features: [],
      faces: [],
      direction: [],
      distance: '20 mm',
      count: '3',
      flip: false,
      secondDir: false,
      direction2: [],
      distance2: '20 mm',
      count2: '2',
      flip2: false,
      op: 'new',
    }),
    circularPattern: () => ({
      patternType: 'part',
      parts: [],
      features: [],
      faces: [],
      axis: [],
      angle: '360 deg',
      count: '4',
      equalSpacing: true,
      flip: false,
      op: 'new',
    }),
    curvePattern: () => ({
      patternType: 'part',
      parts: [],
      features: [],
      faces: [],
      path: [],
      count: '4',
      equalSpacing: true,
      distance: '10 mm',
      flip: false,
      orient: true,
      op: 'new',
    }),
    mirror: () => ({ patternType: 'part', parts: [], features: [], faces: [], plane: [], op: 'new' }),
    rib: () => ({ ...mergeDefaults, profiles: [], thickness: '3 mm', direction: 'parallel', flip: false, extend: true }),
    wrap: () => ({ ...mergeDefaults, profiles: [], target: [], op: 'add', depth: '1 mm' }),
    boolean: () => ({ op: 'union', tools: [], targets: [], keepTools: false }),
    split: () => ({ parts: [], tool: [], keepTools: false }),
    transform: () => ({
      mode: 'translateXYZ',
      fromMate: [],
      toMate: [],
      parts: [],
      direction: [],
      distance: '10 mm',
      flip: false,
      dx: '0 mm',
      dy: '0 mm',
      dz: '10 mm',
      axis: [],
      angle: '90 deg',
      scale: '1',
      point: [],
      copy: false,
    }),
    deletePart: () => ({ parts: [] }),
    plane: () => ({ planeType: 'offset', refs: [], offset: '10 mm', angle: '30 deg', flip: false, size: '' }),
    variable: () => ({ name: 'width', value: '10 mm', description: '', varType: 'length' }),
    import: () => ({ fileName: '', format: 'step', data: '' }),
    derived: () => ({ studioId: '', parts: [], placeTo: [] }),
    helix: () => ({ axis: [], pitch: '5 mm', turns: '5', radius: '10 mm', leftHanded: false }),
    mateConnector: () => ({
      location: [],
      inference: 'default',
      orientFace: [],
      reorient: 'z',
      mode: 'on',
      location2: [],
      inference2: 'default',
      orientFace2: [],
      ownerPart: [],
      primaryAxis: [],
      secondaryAxis: [],
      flipPrimary: false,
      rotation: '0 deg',
      dx: '0 mm',
      dy: '0 mm',
      dz: '0 mm',
    }),
  };
  return d[type]() as FeatureParamsMap[T];
}

/** Next free name "Extrude 3" style. */
export function nextFeatureName(features: Feature[], type: FeatureType): string {
  const base = FEATURE_LABELS[type];
  let max = 0;
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
  for (const f of features) {
    const m = re.exec(f.name);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${base} ${max + 1}`;
}

export function makeEvalContext(doc: Pick<CadDocument, 'units'>, vars: VariableTable): EvalContext {
  return { vars, lengthUnit: doc.units.length, angleUnit: doc.units.angle };
}

/** Variables visible to feature at index `upTo` (exclusive), respecting suppression. */
export function collectVariables(features: Feature[], upTo: number, units: CadDocument['units'] = { length: 'mm', angle: 'deg' }): VariableTable {
  const vars: VariableTable = {};
  for (let i = 0; i < Math.min(upTo, features.length); i++) {
    const f = features[i];
    if (f.suppressed || f.type !== 'variable') continue;
    try {
      vars[f.params.name] = evaluateTypedVariable(f.params.value, f.params.varType, {
        vars,
        lengthUnit: units.length,
        angleUnit: units.angle,
      });
    } catch {
      /* invalid variable: skipped, reported by the kernel */
    }
  }
  return vars;
}

export const isDimension = (c: SkConstraint) =>
  c.type === 'distance' ||
  c.type === 'hdistance' ||
  c.type === 'vdistance' ||
  c.type === 'radius' ||
  c.type === 'diameter' ||
  c.type === 'angle' ||
  c.type === 'arclength' ||
  c.type === 'offset';

/** Evaluate all dimension expressions of a sketch. Invalid ones are omitted (constraint ignored). */
export function sketchDims(sk: SketchData, ctx: EvalContext): { dims: Record<string, number>; errors: string[] } {
  const dims: Record<string, number> = {};
  const errors: string[] = [];
  for (const c of sk.constraints) {
    // a driven dimension drives nothing: its value is not needed
    if (!isDimension(c) || c.value === undefined || c.driven) continue;
    const v = tryEvaluate(c.value, c.type === 'angle' ? 'angle' : 'length', ctx);
    if (v === null) errors.push(c.id);
    else dims[c.id] = v;
  }
  return { dims, errors };
}

/** Feature types that consume sketch regions / faces and produce bodies. */
export const CREATES_BODIES: FeatureType[] = ['extrude', 'revolve', 'sweep', 'loft', 'thicken', 'import'];
