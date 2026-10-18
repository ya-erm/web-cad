// Help page ids used by contextual help (dialog "?" buttons and F1). Keep in sync with
// docs/help/toc.json — src/help/content.test.ts checks that every id here exists.

import type { FeatureType } from '../core/types';
import type { SketchTool } from '../store/editorStore';

export const HELP_START = 'getting-started';

export const FEATURE_HELP: Record<FeatureType, string> = {
  sketch: 'sketch',
  extrude: 'extrude',
  revolve: 'revolve',
  sweep: 'sweep',
  loft: 'loft',
  thicken: 'thicken',
  fillet: 'fillet',
  chamfer: 'chamfer',
  shell: 'shell',
  draft: 'draft',
  hole: 'hole',
  linearPattern: 'linear-pattern',
  circularPattern: 'circular-pattern',
  mirror: 'mirror',
  boolean: 'boolean',
  split: 'split',
  transform: 'transform',
  deletePart: 'delete-part',
  plane: 'plane',
  variable: 'variable',
  import: 'import',
  derived: 'derived',
  helix: 'helix',
  mateConnector: 'mate-connector',
};

export const SKETCH_TOOL_HELP: Record<SketchTool, string> = {
  select: 'sketch',
  plane: 'sketch',
  line: 'sketch-line',
  rectCorner: 'sketch-rectangle',
  rectCenter: 'sketch-rectangle',
  circleCenter: 'sketch-circle',
  circle3pt: 'sketch-circle',
  arc3pt: 'sketch-arc',
  arcTangent: 'sketch-arc',
  arcCenter: 'sketch-arc',
  spline: 'sketch-spline',
  point: 'sketch-point',
  slot: 'sketch-slot',
  polygon: 'sketch-polygon',
  polygonInscribed: 'sketch-polygon',
  ellipse: 'sketch-ellipse',
  fillet: 'sketch-fillet',
  trim: 'sketch-trim',
  extend: 'sketch-extend',
  offset: 'sketch-offset',
  use: 'sketch-use',
  dimension: 'sketch-dimensions',
};

/** Other contexts with their own page. */
export const CONTEXT_HELP = {
  sketchPattern: 'sketch-pattern',
  drawing: 'drawings',
  assembly: 'assembly',
  documents: HELP_START,
} as const;
