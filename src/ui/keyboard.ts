// Global keyboard shortcuts (Onshape layout). Matched by physical key (event.code)
// so typing "#" in inputs or other layouts doesn't trigger view changes.

import type { ConstraintType } from '../core/types';
import { frameFromNormal, STD_PLANES } from '../core/math';
import { toggleShowConstraints, useEditor, type SketchTool } from '../store/editorStore';
import { activeAssembly, useDoc } from '../store/docStore';
import { getEngine } from '../viewport/engineRef';
import { deleteInstances, mateDialogKey, openInsertDialog, selectedInstances, startMate } from '../assembly/AssemblyUI';
import { relationDialogKey } from '../assembly/RelationUI';
import { animationKey } from '../assembly/AnimateUI';
import { closeExploded } from '../assembly/BomExplodeUI';
import { explodeActive } from '../assembly/explode';
import { contextHelpPage, openHelp } from '../help/context';

const SKETCH_KEYS: Record<string, SketchTool> = {
  KeyL: 'line',
  KeyG: 'rectCorner',
  KeyR: 'rectCenter',
  KeyC: 'circleCenter',
  KeyA: 'arc3pt',
  KeyM: 'trim',
  KeyD: 'dimension',
  KeyU: 'use',
  KeyO: 'offset',
};
const SKETCH_SHIFT_KEYS: Record<string, SketchTool> = {
  KeyA: 'arcTangent',
  KeyF: 'fillet',
  KeyS: 'point',
};
const CONSTRAINT_KEYS: Record<string, ConstraintType> = {
  KeyI: 'coincident',
  KeyB: 'parallel',
  KeyT: 'tangent',
  KeyH: 'horizontal',
  KeyV: 'vertical',
  KeyE: 'equal',
};
const CONSTRAINT_SHIFT_KEYS: Record<string, ConstraintType> = {
  KeyO: 'concentric',
  KeyL: 'perpendicular',
  KeyM: 'midpoint',
  KeyQ: 'symmetric',
  KeyJ: 'fix',
};
const VIEW_KEYS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'] as const;

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function handleKey(e: KeyboardEvent) {
  // F1: help for the active sketch tool / feature dialog (works in text fields too)
  if (e.key === 'F1') {
    e.preventDefault();
    openHelp(contextHelpPage());
    return;
  }
  if (isTyping(e)) return;
  const ed = useEditor.getState();
  const engine = getEngine();
  const ctrl = e.ctrlKey || e.metaKey;
  const inSketch = !!ed.sketch && ed.editing?.draft.type === 'sketch';

  if (ctrl && e.code === 'KeyZ' && !e.shiftKey) {
    e.preventDefault();
    if (inSketch) ed.sketchUndo();
    else if (!ed.editing) useDoc.getState().undo();
    return;
  }
  if (ctrl && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
    e.preventDefault();
    if (inSketch) ed.sketchRedo();
    else if (!ed.editing) useDoc.getState().redo();
    return;
  }
  if (ctrl) return;

  // views (all modes)
  if (e.shiftKey && /^Digit[1-7]$/.test(e.code)) {
    e.preventDefault();
    ed.view({ kind: 'std', view: VIEW_KEYS[Number(e.code.slice(5)) - 1] });
    return;
  }
  if (!e.shiftKey && e.code === 'KeyF') {
    ed.view({ kind: 'fit' });
    return;
  }
  if (!e.shiftKey && e.code === 'KeyN') {
    normalTo();
    return;
  }
  if (!e.shiftKey && e.code === 'KeyP') {
    useEditor.setState({ showPlanes: !ed.showPlanes });
    return;
  }
  if (e.shiftKey && e.code === 'KeyH') {
    useEditor.setState({ showSketches: !ed.showSketches });
    return;
  }
  if (e.code.startsWith('Arrow')) {
    e.preventDefault();
    const deg = e.shiftKey ? 90 : 15;
    if (e.code === 'ArrowLeft') ed.view({ kind: 'rotate', axis: 'h', deg: -deg });
    if (e.code === 'ArrowRight') ed.view({ kind: 'rotate', axis: 'h', deg });
    if (e.code === 'ArrowUp') ed.view({ kind: 'rotate', axis: 'v', deg: -deg });
    if (e.code === 'ArrowDown') ed.view({ kind: 'rotate', axis: 'v', deg });
    return;
  }
  if (!e.shiftKey && e.code === 'KeyZ') {
    ed.view({ kind: 'zoom', factor: 1.25 });
    return;
  }
  if (e.shiftKey && e.code === 'KeyZ') {
    ed.view({ kind: 'zoom', factor: 0.8 });
    return;
  }

  if (inSketch && engine) {
    if (engine.sketchEditor.handleKey(e)) {
      e.preventDefault();
      return;
    }
    const tool = e.shiftKey ? SKETCH_SHIFT_KEYS[e.code] : SKETCH_KEYS[e.code];
    if (tool) {
      ed.setSketchTool(tool);
      return;
    }
    if (!e.shiftKey && e.code === 'KeyQ') {
      engine.sketchEditor.toggleConstruction();
      return;
    }
    if (e.shiftKey && e.code === 'KeyC') {
      toggleShowConstraints();
      return;
    }
    const c = e.shiftKey ? CONSTRAINT_SHIFT_KEYS[e.code] : CONSTRAINT_KEYS[e.code];
    if (c) {
      engine.sketchEditor.applyConstraint(c);
      return;
    }
    return;
  }

  // assembly: Del removes the selected instances, I opens Insert
  if (activeAssembly(useDoc.getState().doc) && !ed.editing) {
    if (mateDialogKey(e) || relationDialogKey(e) || animationKey(e)) return;
    if (e.key === 'Escape' && explodeActive()) {
      closeExploded();
      return;
    }
    if (!e.shiftKey && e.code === 'KeyJ') {
      startMate();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteInstances(selectedInstances(ed.selection));
      return;
    }
    if (!e.shiftKey && e.code === 'KeyI') {
      openInsertDialog();
      return;
    }
  }

  if (e.key === 'Escape') {
    if (ed.editing) ed.cancelEditing();
    else ed.clearSelection();
    return;
  }
  if (e.key === 'Enter' && ed.editing) {
    ed.commitEditing(e.shiftKey);
    return;
  }
  if (e.code === 'Space' && !ed.editing) {
    ed.clearSelection();
    return;
  }
  if (e.shiftKey && !ed.editing) {
    if (e.code === 'KeyS') ed.startFeature('sketch');
    else if (e.code === 'KeyE') ed.startFeature('extrude');
    else if (e.code === 'KeyW') ed.startFeature('revolve');
    else if (e.code === 'KeyF') ed.startFeature('fillet');
  }
}

function normalTo() {
  const ed = useEditor.getState();
  const engine = getEngine();
  if (ed.sketch && engine?.sketchEditor.active) {
    const f = engine.sketchEditor.frame;
    ed.view({ kind: 'normal', normal: f.normal, up: f.yDir, center: f.origin });
    return;
  }
  const r = ed.selection[0];
  if (r?.kind === 'face' && r.sig.normal) {
    const f = frameFromNormal(r.sig.center, r.sig.normal);
    ed.view({ kind: 'normal', normal: f.normal, up: f.yDir, center: r.sig.center });
  } else if (r?.kind === 'plane') {
    const f =
      r.planeId === 'top' || r.planeId === 'front' || r.planeId === 'right' ? STD_PLANES[r.planeId] : engine?.planeFrame(r.planeId)?.frame;
    if (f) ed.view({ kind: 'normal', normal: f.normal, up: f.yDir, center: f.origin });
  } else ed.view({ kind: 'std', view: 'top' });
}
