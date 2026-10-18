// Dragging assembly instances in the graphics area (Onshape): the instance follows the mouse as far as its
// mates allow (`draggedAssembly`); the document gets the final placement as one undo step.

import { create } from 'zustand';
import type { AssemblyInstance, AssemblyTab, Vec3 } from '../core/types';
import { activeAssembly, useDoc, withAssembly } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import { requestRebuild } from '../store/rebuild';
import { t } from '../i18n';
import { composeAssembly } from './compose';
import { findInstance, unitOf } from './expand';
import { draggedAssembly } from './mates';
import { useAssembly } from './sources';

let session: { base: AssemblyTab; id: string; current: AssemblyTab } | null = null;

/** The assembly as dragged so far (the position panel shows it live); null when nothing is dragged. */
export const useDragPreview = create<{ tab: AssemblyTab | null }>(() => ({ tab: null }));

/**
 * The instance that dragging part `partId` (a shown part, `X/inner` in a sub-assembly) moves: a part of a flexible
 * sub-assembly moves on its own, a rigid sub-assembly as a whole.
 */
export function dragInstance(partId: string): AssemblyInstance | undefined {
  const asm = activeAssembly(useDoc.getState().doc);
  return asm ? findInstance(asm, useAssembly.getState().sources, unitOf(asm, partId)) : undefined;
}

/** Start dragging an instance (a part of a flexible sub-assembly too); false if it cannot move (fixed). */
export function assemblyDragStart(id: string): boolean {
  const asm = activeAssembly(useDoc.getState().doc);
  const inst = asm && findInstance(asm, useAssembly.getState().sources, id);
  if (!asm || !inst) return false;
  if (inst.fixed) {
    useEditor.getState().showToast(t('A fixed instance cannot be moved.'), 'info');
    return false;
  }
  session = { base: asm, id, current: asm };
  useEditor.getState().setSelection([{ kind: 'part', partId: id }]);
  return true;
}

/** Move the dragged instance by `delta` and turn it by `angle` (radians) about `axis` through `anchor`. */
export function assemblyDragMove(delta: Vec3, angle: number, axis: Vec3, anchor: Vec3) {
  if (!session) return;
  const sources = useAssembly.getState().sources;
  session.current = draggedAssembly(session.base, sources, session.id, delta, angle, axis, anchor);
  useDragPreview.setState({ tab: session.current });
  useEditor.setState({ build: composeAssembly(session.current, sources).build });
}

/** Keep the dragged placement (one undo step). */
export function assemblyDragEnd() {
  if (!session) return;
  const { current, base } = session;
  session = null;
  useDragPreview.setState({ tab: null });
  if (current === base) return;
  useDoc.getState().update((d) =>
    withAssembly(d, (a) => {
      a.instances = current.instances;
      // mate relations keep counting turns from where the drag left them
      if (current.relations) a.relations = current.relations;
    }),
  );
  requestRebuild();
}
