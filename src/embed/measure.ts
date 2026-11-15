// What the embedded viewer measures with: a Part Studio — the kernel, as the editor's measure panel does; an
// assembly — the kernel too, its shown parts placed as one builder (as a drawing of it has them); STL meshes —
// their triangles (meshMeasure.ts). Nothing selected: the model's overall size.

import type { PlacedPart } from '../kernel/protocol';
import type { SelRef } from '../core/types';
import { kernel } from '../kernel/client';
import { activeAssembly, activeStudio, useDoc } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import { useAssembly } from '../assembly/sources';
import { expandAssembly } from '../assembly/expand';
import { sourceKey } from '../core/config';
import { measureMesh, overallSize, type Measured } from './meshMeasure';

/** The assembly placed for measuring: for which build (another build — placed anew). */
let placed: { build: unknown; key: string; done: Promise<unknown> } | null = null;

/** The builder of an assembly's shown parts where they are shown (instances' ids, sub-assemblies unfolded). */
function placedAssembly(build: unknown, asmId: string): string {
  const key = `viewer-assembly:${asmId}`;
  if (placed && placed.build === build && placed.key === key) return key;
  const doc = useDoc.getState().doc;
  const asm = activeAssembly(doc);
  if (!asm) return key;
  const parts: PlacedPart[] = expandAssembly(asm, useAssembly.getState().sources)
    .instances.filter((i) => !i.hidden && !i.assemblyId)
    .map((i) => ({ id: i.id, studioKey: sourceKey(i), partId: i.partId, name: i.name, position: i.position, rotation: i.rotation }));
  placed = { build, key, done: kernel().place(key, parts) };
  return key;
}

/** The measurement of the selection on the model shown now (null: nothing to say). */
export async function measureSelection(refs: SelRef[]): Promise<Measured | null> {
  const build = useEditor.getState().build;
  if (!build) return null;
  if (!refs.length) return overallSize(build.parts);
  const doc = useDoc.getState().doc;
  // an STL file: its meshes (no document)
  if (!doc) return measureMesh(refs, build.parts);
  const studio = activeStudio(doc);
  if (studio) return kernel().measure({ studioKey: studio.id, refs });
  const asm = activeAssembly(doc);
  if (!asm) return null;
  const key = placedAssembly(build, asm.id);
  await placed?.done;
  return kernel().measure({ studioKey: key, refs });
}
