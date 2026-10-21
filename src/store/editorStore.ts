// Transient editor state: build results, feature editing, selection, sketch session.

import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { ConstraintType, Feature, FeatureType, PlaneRef, SelRef, SketchData, Vec2, Vec3 } from '../core/types';
import type { BuildResult, MeasureResult } from '../kernel/protocol';
import { defaultParams, nextFeatureName } from '../core/features';
import { uid } from '../core/ids';
import { commitConfigured, configuredFeatures } from '../core/config';
import { FIELD_SPECS, keepRefs, type SelToken } from '../core/fieldSpecs';
import { activeStudio, effectiveRollback, featureIndex, useDoc, withStudio } from './docStore';
import { withBuiltUse } from '../sketch/useGeometry';

export type SketchTool =
  | 'select'
  | 'line'
  | 'rectCorner'
  | 'rectCenter'
  | 'circleCenter'
  | 'circle3pt'
  | 'arc3pt'
  | 'arcTangent'
  | 'arcCenter'
  | 'spline'
  /** a cubic Bézier curve: start, two control points, end (a spline with tangent handles) */
  | 'bezier'
  /** a conic: start, end, the apex of its tangents, then ρ (a Bézier spline close to the conic) */
  | 'conic'
  | 'point'
  | 'slot'
  /** circumscribed polygon: the construction circle passes through the vertices */
  | 'polygon'
  /** inscribed polygon: the construction circle touches the sides */
  | 'polygonInscribed'
  | 'ellipse'
  /** a line of text (Onshape Text): the start of its baseline, then the height of its capitals */
  | 'text'
  | 'fillet'
  | 'trim'
  /** split a line / an arc at a point (Onshape Split) */
  | 'split'
  | 'extend'
  | 'offset'
  | 'use'
  /** picking a new sketch plane from the sketch dialog */
  | 'plane'
  | 'dimension';

export interface SolveInfo {
  ok: boolean;
  dof: number;
  status: Record<string, 'under' | 'full' | 'over'>;
  conflicting: string[];
  redundant: string[];
}

export interface SketchSession {
  tool: SketchTool;
  /** Selected entity / constraint ids. */
  selection: string[];
  hover: string | null;
  construction: boolean;
  past: SketchData[];
  future: SketchData[];
  solve: SolveInfo | null;
  /** Message shown in the status bar while a tool is active. */
  hint?: string;
  /** A new sketch still waiting for its plane (Onshape): only plane picking works until one is chosen. */
  planePending?: boolean;
  /**
   * A constraint tool waiting for its entities (Onshape: the tool first, then the picks): it is added as soon as
   * the picks make it, and the tool stays on for the next one.
   */
  constraint?: ConstraintType;
  /**
   * The Mirror tool waiting for its picks (Onshape: the mirror line first, then the entities): `axis` — the line
   * picked; `pending` — entities selected before it (mirrored as soon as the line is picked); `done` — those mirrored.
   */
  mirror?: { axis?: string; pending: string[]; done: string[] };
  /** A text just placed by the Text tool: the sketch dialog puts the cursor into its field. */
  editText?: string;
}

/** A sketch pattern being created / edited (the pattern itself lives in the sketch data). */
export interface SketchPatternState {
  patternId: string;
  isNew: boolean;
  /** Sketch before the edit: restored on cancel, pushed to undo on accept. */
  base: SketchData;
}

/** A sketch Transform (Onshape) being set up: the entities, the move (expressions), the turn about `pivot`. */
export interface SketchTransformState {
  ids: string[];
  dx: string;
  dy: string;
  angle: string;
  /** The centre of the turn: the middle of the entities' bounding box. */
  pivot: Vec2;
  /** Copies moved, the originals stay. */
  copy: boolean;
}

export interface Editing {
  featureId: string;
  isNew: boolean;
  /** Position of the feature in the list (insertion point for new features). */
  index: number;
  draft: Feature;
}

export interface SectionState {
  /** What the plane came from, for the panel ('top' | 'front' | 'right' | 'face'). */
  source: 'top' | 'front' | 'right' | 'face';
  normal: Vec3;
  origin: Vec3;
  /** Offset along the normal, mm. */
  offset: number;
  /** Keep the other side. */
  flip: boolean;
}

export type ViewCommand =
  | { kind: 'std'; view: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso' | 'dimetric' | 'trimetric' }
  | { kind: 'fit' }
  | { kind: 'normal'; normal: Vec3; up: Vec3; center: Vec3 }
  | { kind: 'rotate'; axis: 'h' | 'v' | 'roll'; deg: number }
  | { kind: 'zoom'; factor: number };

export interface ContextMenuItem {
  label: string;
  /** Icon name from ui/icons (kept as string to avoid importing UI code into the store). */
  icon?: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  palette?: {
    colors: string[];
    onPick: (color: string) => void;
    /** Opacity 0.1…1 under the colours (a part's appearance). */
    opacity?: { value: number; onChange: (v: number) => void };
  };
}

export interface EditorState {
  build: BuildResult | null;
  building: boolean;
  kernelReady: boolean;
  editing: Editing | null;
  activeField: string | null;
  selection: SelRef[];
  hover: SelRef | null;
  /** Features under the pointer in the feature list (a folder: its features): the faces they made light up. */
  hoverFeatures: string[] | null;
  /**
   * The items of a row under the pointer in a list (a dialog's selection field, its vertices, the instances…): they
   * stand out in the graphics area, the other selected items fade — which of them the row is shows.
   */
  hoverList: SelRef[] | null;
  /**
   * The model compared with a version on it (Onshape: Compare): its faces new or changed since the version (part id
   * → face indices) light up; the version's faces that are gone are drawn as a ghost (their triangles). Pending while
   * the version is being built.
   */
  compare: { label: string; tabId: string; changed: Record<string, number[]>; ghost: { positions: Float32Array; indices: Uint32Array }[]; pending?: boolean } | null;
  sketch: SketchSession | null;
  sketchPattern: SketchPatternState | null;
  sketchTransform: SketchTransformState | null;
  showPlanes: boolean;
  showSketches: boolean;
  viewCmd: { id: number; cmd: ViewCommand } | null;
  measure: MeasureResult | null;
  contextMenu: ContextMenuState | null;
  exportOpen: { partIds: string[] } | null;
  /** The material dialog, for these parts. */
  materialOpen: { partIds: string[] } | null;
  toast: { id: number; text: string; kind: 'info' | 'error' } | null;
  perspective: boolean;
  rotationMode: 'free' | 'turntable';
  /** Section view: parts are clipped by a plane (world normal / origin, offset along the normal in mm). */
  section: SectionState | null;
  /** Constraint glyphs in sketch mode: all, or only for the selected/hovered entities. */
  showConstraints: boolean;
  /** Dimension labels show their expression ("#w / 2") instead of the value. */
  showExpressions: boolean;

  startFeature(type: FeatureType): void;
  editFeature(id: string): void;
  updateDraft(fn: (f: Draft<Feature>) => void): void;
  commitEditing(keepOpen?: boolean): void;
  cancelEditing(): void;
  setActiveField(key: string | null): void;

  /** Opens a new sketch; without a plane the dialog first asks for one. */
  startSketch(plane: PlaneRef | null): void;
  /** The pending plane of a new sketch was picked: drawing starts. */
  sketchPlanePicked(): void;
  setSketchTool(tool: SketchTool): void;
  updateSketch(fn: (s: Draft<SketchData>) => void, undoable?: boolean): void;
  sketchUndo(): void;
  sketchRedo(): void;
  setSketchSelection(ids: string[]): void;
  setSketchHover(id: string | null): void;
  setSolve(info: SolveInfo | null): void;

  select(ref: SelRef, additive?: boolean): void;
  /**
   * A click on `ref` while a feature dialog's selection field is active: adds it to the field or removes it from there.
   * With `token` (a row of the Parts or Feature list) only if the field accepts that kind; false — the field did not take it.
   */
  pickIntoField(ref: SelRef, token?: SelToken): boolean;
  setSelection(refs: SelRef[]): void;
  clearSelection(): void;
  setHover(ref: SelRef | null): void;
  /** A row of a list under the pointer (`hoverList`), or none. */
  setListHover(refs: SelRef[] | null): void;

  view(cmd: ViewCommand): void;
  showToast(text: string, kind?: 'info' | 'error'): void;
}

export function refKey(r: SelRef): string {
  switch (r.kind) {
    case 'face':
    case 'edge':
    case 'vertex':
      return `${r.kind}:${r.partId}:${r.index}`;
    case 'part':
      return `part:${r.partId}`;
    case 'region':
      return `region:${r.sketchId}:${r.key.ents.join(',')}:${r.key.pt[0].toFixed(4)},${r.key.pt[1].toFixed(4)}`;
    case 'sketchEntity':
      return `ske:${r.sketchId}:${r.entityId}`;
    case 'plane':
      return `plane:${r.planeId}`;
    case 'origin':
      return 'origin';
  }
}

export const sameRef = (a: SelRef, b: SelRef) => refKey(a) === refKey(b);

/** Which fields of a fresh feature should receive the current selection. */
function prefill(f: Draft<Feature>, sel: SelRef[]) {
  if (!sel.length) return;
  const regionsOrFaces = sel.filter((r) => r.kind === 'region' || r.kind === 'face');
  const edgesOrFaces = sel.filter((r) => r.kind === 'edge' || r.kind === 'face');
  const parts = sel.filter((r) => r.kind === 'part');
  switch (f.type) {
    case 'extrude':
    case 'revolve':
    case 'sweep':
    case 'loft':
      f.params.profiles = regionsOrFaces as SelRef[];
      break;
    case 'thicken':
      f.params.faces = regionsOrFaces as SelRef[];
      break;
    case 'fillet':
    case 'chamfer':
      f.params.edges = edgesOrFaces as SelRef[];
      break;
    case 'shell':
      f.params.faces = sel.filter((r) => r.kind === 'face') as SelRef[];
      break;
    case 'hole':
      f.params.points = sel.filter((r) => r.kind === 'sketchEntity') as SelRef[];
      break;
    case 'deletePart':
    case 'split':
    case 'transform':
      f.params.parts = parts as SelRef[];
      break;
    case 'linearPattern':
    case 'circularPattern':
    case 'mirror':
      f.params.parts = parts as SelRef[];
      break;
    case 'boolean':
      f.params.tools = parts as SelRef[];
      break;
    case 'plane':
      f.params.refs = sel.filter((r) => r.kind !== 'part') as SelRef[];
      break;
    case 'mateConnector': {
      const loc = sel.find((r) => r.kind !== 'part' && r.kind !== 'region');
      if (loc) f.params.location = [loc as Draft<SelRef>];
      break;
    }
    default:
      break;
  }
}

/** First selection field of each feature dialog (receives clicks by default). */
export const FIRST_FIELD: Partial<Record<FeatureType, string>> = {
  extrude: 'profiles',
  revolve: 'profiles',
  sweep: 'profiles',
  loft: 'profiles',
  thicken: 'faces',
  fillet: 'edges',
  chamfer: 'edges',
  shell: 'faces',
  draft: 'neutral',
  deleteFace: 'faces',
  moveFace: 'faces',
  replaceFace: 'faces',
  offsetSurface: 'faces',
  enclose: 'surfaces',
  hole: 'points',
  linearPattern: 'parts',
  circularPattern: 'parts',
  curvePattern: 'parts',
  rib: 'profiles',
  wrap: 'profiles',
  mirror: 'parts',
  boolean: 'tools',
  split: 'parts',
  transform: 'parts',
  deletePart: 'parts',
  plane: 'refs',
  helix: 'axis',
  mateConnector: 'location',
};

let viewCounter = 0;
let toastCounter = 0;

/** A sketch waiting for the rebuild to open (see `editFeature`): stop waiting. */
let stopWaiting: (() => void) | null = null;
/** Opening it now: no more waiting (the rebuild is done, or it took too long). */
let openingNow = false;

/** `then` once the model is built and not rebuilding (at most 15 s later); a newer call replaces the waiting one. */
function afterRebuild(then: () => void) {
  stopWaiting?.();
  const stop = () => {
    unsub();
    clearTimeout(timer);
    if (stopWaiting === stop) stopWaiting = null;
  };
  const finish = () => {
    stop();
    then();
  };
  const unsub = useEditor.subscribe((s) => {
    if (!s.building && s.build) finish();
  });
  const timer = setTimeout(finish, 15000);
  stopWaiting = stop;
}

export const useEditor = create<EditorState>()((set, get) => ({
  build: null,
  building: false,
  kernelReady: false,
  editing: null,
  activeField: null,
  selection: [],
  hover: null,
  hoverFeatures: null,
  hoverList: null,
  compare: null,
  sketch: null,
  sketchPattern: null,
  sketchTransform: null,
  showPlanes: true,
  showSketches: true,
  viewCmd: null,
  measure: null,
  contextMenu: null,
  exportOpen: null,
  materialOpen: null,
  toast: null,
  perspective: false,
  showExpressions: (() => {
    try {
      return localStorage.getItem('webcad.showExpressions') === '1';
    } catch {
      return false;
    }
  })(),
  showConstraints: (() => {
    try {
      return localStorage.getItem('webcad.showConstraints') !== '0';
    } catch {
      return true;
    }
  })(),
  rotationMode: ((): 'free' | 'turntable' => {
    try {
      return localStorage.getItem('webcad.rotation') === 'turntable' ? 'turntable' : 'free';
    } catch {
      return 'free';
    }
  })(),
  section: null,

  startFeature(type) {
    const doc = useDoc.getState().doc;
    const studio = activeStudio(doc);
    if (!studio || get().editing) return;
    if (type === 'sketch') {
      const sel = get().selection[0];
      // nothing selected: the sketch dialog asks for the plane
      let plane: PlaneRef | null = null;
      if (sel?.kind === 'plane') {
        plane =
          sel.planeId === 'top' || sel.planeId === 'front' || sel.planeId === 'right'
            ? { kind: 'std', name: sel.planeId }
            : { kind: 'feature', featureId: sel.planeId };
      } else if (sel?.kind === 'face' && sel.sig.type === 'PLANE') {
        plane = { kind: 'face', ref: sel };
      } else if (sel) {
        get().showToast('Select a plane or planar face', 'error');
        return;
      }
      get().startSketch(plane);
      return;
    }
    const draft = produce(
      {
        id: uid('f'),
        type,
        name: nextFeatureName(studio.features, type),
        params: defaultParams(type),
      } as Feature,
      (f) => prefill(f, get().selection),
    );
    set({
      editing: { featureId: draft.id, isNew: true, index: effectiveRollback(studio), draft },
      activeField: FIRST_FIELD[type] ?? null,
      selection: [],
      measure: null,
    });
  },

  editFeature(id) {
    const studio = activeStudio(useDoc.getState().doc);
    if (!studio || get().editing) return;
    const idx = featureIndex(studio, id);
    if (idx < 0) return;
    // the dialog shows the values of the chosen configuration
    let f = configuredFeatures(studio)[idx];
    // a sketch with projected (Use) geometry while the model is being rebuilt (or not built yet): it opens when the
    // rebuild is done — its projection must stand where its source is now, and once it is open the model is built only
    // up to it, so it would not be projected again
    if (f.type === 'sketch' && f.params.entities.some((e) => e.use) && (get().building || !get().build) && !openingNow) {
      afterRebuild(() => {
        openingNow = true;
        try {
          get().editFeature(id);
        } finally {
          openingNow = false;
        }
      });
      return;
    }
    // a sketch: its projected (Use) geometry where its source is now (as the last rebuild projected it)
    const built = f.type === 'sketch' ? get().build?.sketches.find((s) => s.featureId === id) : undefined;
    if (f.type === 'sketch' && built) f = { ...f, params: withBuiltUse(f.params, built.entities) };
    set({
      hover: null,
      editing: { featureId: id, isNew: false, index: idx, draft: f },
      activeField: f.type === 'sketch' ? null : (FIRST_FIELD[f.type] ?? null),
      selection: [],
      measure: null,
      sketch:
        f.type === 'sketch'
          ? { tool: 'select', selection: [], hover: null, construction: false, past: [], future: [], solve: null }
          : null,
    });
  },

  updateDraft(fn) {
    const e = get().editing;
    if (!e) return;
    set({ editing: { ...e, draft: produce(e.draft, fn) } });
  },

  commitEditing(keepOpen = false) {
    const e = get().editing;
    if (!e) return;
    if (get().sketch?.planePending) {
      get().showToast('Select a plane or a planar face for the sketch.', 'error');
      return;
    }
    const { update } = useDoc.getState();
    update((d) => {
      withStudio(d, (s) => {
        if (e.isNew) {
          s.features.splice(e.index, 0, e.draft as Draft<Feature>);
          if (s.rollback !== null) s.rollback = Math.min(s.rollback + 1, s.features.length);
          if (s.rollback === s.features.length) s.rollback = null;
        } else {
          const i = s.features.findIndex((f) => f.id === e.featureId);
          // a configured parameter typed in the dialog goes to the chosen configuration's cell
          if (i >= 0) s.features[i] = commitConfigured(s, s.features[i] as Feature, e.draft) as Draft<Feature>;
        }
      });
    });
    set({ editing: null, activeField: null, sketch: null, sketchPattern: null, sketchTransform: null, selection: [], hover: null });
    if (keepOpen && e.draft.type !== 'sketch') get().startFeature(e.draft.type);
  },

  cancelEditing() {
    set({ editing: null, activeField: null, sketch: null, sketchPattern: null, sketchTransform: null, hover: null });
  },

  setActiveField(key) {
    set({ activeField: key });
  },

  startSketch(plane) {
    const studio = activeStudio(useDoc.getState().doc);
    if (!studio) return;
    const draft: Feature = {
      id: uid('f'),
      type: 'sketch',
      name: nextFeatureName(studio.features, 'sketch'),
      // Top is only a placeholder until the plane is picked
      params: { plane: plane ?? { kind: 'std', name: 'top' }, entities: [], constraints: [] },
    };
    set({
      editing: { featureId: draft.id, isNew: true, index: effectiveRollback(studio), draft },
      activeField: null,
      selection: [],
      measure: null,
      sketch: plane
        ? { tool: 'line', selection: [], hover: null, construction: false, past: [], future: [], solve: null }
        : { tool: 'plane', selection: [], hover: null, construction: false, past: [], future: [], solve: null, planePending: true },
      hover: null,
    });
  },

  sketchPlanePicked() {
    const s = get().sketch;
    if (!s?.planePending) return;
    // picking the first plane is not an undo step: undo must not bring the placeholder back
    set({ sketch: { ...s, planePending: false, tool: 'line', hint: undefined, past: [], future: [] } });
  },

  setSketchTool(tool) {
    const s = get().sketch;
    if (!s) return;
    if (s.planePending && tool !== 'plane') {
      get().showToast('Select a plane or a planar face for the sketch.', 'error');
      return;
    }
    set({ sketch: { ...s, tool, hint: undefined, constraint: undefined, mirror: undefined } });
  },

  updateSketch(fn, undoable = true) {
    const e = get().editing;
    const s = get().sketch;
    if (!e || e.draft.type !== 'sketch' || !s) return;
    const prev = e.draft.params;
    const next = produce(prev, fn);
    if (next === prev) return;
    set({
      editing: { ...e, draft: { ...e.draft, params: next } },
      sketch: undoable ? { ...s, past: [...s.past, prev].slice(-200), future: [] } : s,
    });
  },

  sketchUndo() {
    const e = get().editing;
    const s = get().sketch;
    if (!e || e.draft.type !== 'sketch' || !s || !s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({
      editing: { ...e, draft: { ...e.draft, params: prev } },
      sketch: { ...s, past: s.past.slice(0, -1), future: [e.draft.params, ...s.future], selection: [] },
    });
  },

  sketchRedo() {
    const e = get().editing;
    const s = get().sketch;
    if (!e || e.draft.type !== 'sketch' || !s || !s.future.length) return;
    const next = s.future[0];
    set({
      editing: { ...e, draft: { ...e.draft, params: next } },
      sketch: { ...s, past: [...s.past, e.draft.params], future: s.future.slice(1), selection: [] },
    });
  },

  setSketchSelection(ids) {
    const s = get().sketch;
    if (s) set({ sketch: { ...s, selection: ids } });
  },

  setSketchHover(id) {
    const s = get().sketch;
    if (s && s.hover !== id) set({ sketch: { ...s, hover: id } });
  },

  setSolve(info) {
    const s = get().sketch;
    if (s) set({ sketch: { ...s, solve: info } });
  },

  select(ref, additive = true) {
    const sel = get().selection;
    const exists = sel.some((r) => sameRef(r, ref));
    if (exists) set({ selection: sel.filter((r) => !sameRef(r, ref)) });
    else set({ selection: additive ? [...sel, ref] : [ref] });
  },

  pickIntoField(ref, token) {
    const { editing, activeField: field } = get();
    if (!editing || !field || editing.draft.type === 'sketch') return false;
    const spec = FIELD_SPECS[editing.draft.type]?.[field];
    if (token && !spec?.accepts.includes(token)) return false;
    get().updateDraft((f) => {
      const params = f.params as unknown as Record<string, SelRef[]>;
      const cur = params[field] ?? [];
      if (cur.some((r) => sameRef(r, ref))) keepRefs(params, field, (r) => !sameRef(r, ref), spec);
      else if (spec?.max === 1) params[field] = [ref];
      else params[field] = [...cur, ref];
    });
    return true;
  },

  setSelection(refs) {
    set({ selection: refs });
  },

  clearSelection() {
    set({ selection: [], measure: null });
  },

  setHover(ref) {
    const h = get().hover;
    if (h === ref || (h && ref && sameRef(h, ref))) return;
    set({ hover: ref });
  },

  setListHover(refs) {
    set({ hoverList: refs?.length ? refs : null, hover: refs?.[0] ?? null });
  },

  view(cmd) {
    set({ viewCmd: { id: ++viewCounter, cmd } });
  },

  showToast(text, kind = 'info') {
    const id = ++toastCounter;
    set({ toast: { id, text, kind } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3500);
  },
}));

export function setRotationMode(mode: 'free' | 'turntable') {
  useEditor.setState({ rotationMode: mode });
  try {
    localStorage.setItem('webcad.rotation', mode);
  } catch {
    /* ignore */
  }
}

export function toggleShowConstraints() {
  const v = !useEditor.getState().showConstraints;
  useEditor.setState({ showConstraints: v });
  try {
    localStorage.setItem('webcad.showConstraints', v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function toggleShowExpressions() {
  const v = !useEditor.getState().showExpressions;
  useEditor.setState({ showExpressions: v });
  try {
    localStorage.setItem('webcad.showExpressions', v ? '1' : '0');
  } catch {
    /* ignore */
  }
}
