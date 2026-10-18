// Export helpers shared by the export dialog, parts list and drawings.

import { kernel } from '../kernel/client';
import { writeOBJ } from '../export/obj';
import { write3MF } from '../export/threemf';
import { writeDXF } from '../export/dxf';
import { writeSVG } from '../export/svg';
import type { Prim2D } from '../export/prim2d';
import type { AssemblyTab, CadDocument, SkEntity } from '../core/types';
import type { MeshResult } from '../kernel/protocol';
import { placementOf, type AssemblySources } from '../assembly/compose';
import { expandAssembly, stepAssemblies } from '../assembly/expand';
import { arcAngles, entityMap, pointOf, splineSamples } from '../sketch/curves';

export type ExportKind = 'step' | 'stl' | 'stl-ascii' | 'obj' | '3mf';

export function download(data: BlobPart, fileName: string, mime = 'application/octet-stream') {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';
}

export async function exportParts(
  studioId: string,
  partIds: string[],
  kind: ExportKind,
  opts: { tolerance: number; angularTolerance: number; unit: 'mm' | 'in'; baseName: string },
) {
  const k = kernel();
  const base = safeName(opts.baseName);
  if (kind === 'step' || kind === 'stl' || kind === 'stl-ascii') {
    const res = await k.exportFile({
      studioKey: studioId,
      format: kind,
      partIds,
      tolerance: opts.tolerance,
      angularTolerance: opts.angularTolerance,
      unit: opts.unit,
    });
    download(res.data as BlobPart, `${base}.${kind === 'step' ? 'step' : 'stl'}`, res.mime);
    return;
  }
  const mesh = await k.mesh({ studioKey: studioId, partIds, tolerance: opts.tolerance, angularTolerance: opts.angularTolerance });
  const scale = opts.unit === 'in' ? 1 / 25.4 : 1;
  const scaled = mesh.meshes.map((m) => {
    const pos = new Float32Array(m.positions.length);
    for (let i = 0; i < pos.length; i++) pos[i] = m.positions[i] * scale;
    return { ...m, positions: pos };
  });
  if (kind === 'obj') {
    const text = writeOBJ(scaled.map((m) => ({ name: m.name, positions: m.positions, normals: m.normals, indices: m.indices })));
    download(text, `${base}.obj`, 'model/obj');
  } else {
    const data = write3MF(
      scaled.map((m) => ({ name: m.name, color: m.color, positions: m.positions, indices: m.indices })),
      { unit: opts.unit === 'in' ? 'inch' : 'millimeter' },
    );
    download(data, `${base}.3mf`, 'model/3mf');
  }
}

/**
 * Export assembly instances: STEP / STL from the kernel (each instance its Part Studio's part, placed — one
 * named solid per instance); OBJ / 3MF from the parts' meshes, placed here.
 */
export async function exportAssembly(
  asm: AssemblyTab,
  sources: AssemblySources,
  ids: string[],
  kind: ExportKind,
  opts: { tolerance: number; angularTolerance: number; unit: 'mm' | 'in'; baseName: string },
) {
  const k = kernel();
  const base = safeName(opts.baseName);
  const chosen = asm.instances.filter((i) => ids.includes(i.id));
  if (kind === 'step') {
    // the product tree: the assembly, and each sub-assembly once
    const res = await k.exportFile({ studioKey: '', format: 'step', partIds: [], assemblies: stepAssemblies(asm.name, chosen, sources), unit: opts.unit });
    download(res.data as BlobPart, `${base}.step`, res.mime);
    return;
  }
  // meshes: the parts of the chosen instances, sub-assemblies unfolded
  const instances = expandAssembly({ ...asm, instances: chosen }, sources).instances.filter((i) => !i.hidden);
  if (kind === 'stl' || kind === 'stl-ascii') {
    const res = await k.exportFile({
      studioKey: '',
      format: kind,
      partIds: [],
      instances: instances.map((i) => ({ studioKey: i.studioId, partId: i.partId, name: i.name, position: i.position, rotation: i.rotation })),
      tolerance: opts.tolerance,
      angularTolerance: opts.angularTolerance,
      unit: opts.unit,
    });
    download(res.data as BlobPart, `${base}.stl`, res.mime);
    return;
  }
  // meshes of the parts, once per part, from their Part Studios
  const parts = new Map<string, string[]>();
  for (const i of instances) parts.set(i.studioId, [...new Set([...(parts.get(i.studioId) ?? []), i.partId])]);
  const meshes = new Map<string, MeshResult['meshes'][number]>();
  for (const [studioId, partIds] of parts) {
    const r = await k.mesh({ studioKey: studioId, partIds, tolerance: opts.tolerance, angularTolerance: opts.angularTolerance });
    for (const m of r.meshes) meshes.set(`${studioId}|${m.id}`, m);
  }
  const scale = opts.unit === 'in' ? 1 / 25.4 : 1;
  const placed = instances.flatMap((inst) => {
    const m = meshes.get(`${inst.studioId}|${inst.partId}`);
    if (!m) return [];
    const { R, t } = placementOf(inst);
    const positions = new Float32Array(m.positions.length);
    const normals = new Float32Array(m.normals.length);
    for (let i = 0; i < m.positions.length; i += 3) {
      const [x, y, z] = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
      for (let r = 0; r < 3; r++) positions[i + r] = (R[r * 3] * x + R[r * 3 + 1] * y + R[r * 3 + 2] * z + t[r]) * scale;
      const [nx, ny, nz] = [m.normals[i], m.normals[i + 1], m.normals[i + 2]];
      for (let r = 0; r < 3; r++) normals[i + r] = R[r * 3] * nx + R[r * 3 + 1] * ny + R[r * 3 + 2] * nz;
    }
    return [{ name: inst.name, color: m.color, positions, normals, indices: m.indices }];
  });
  if (!placed.length) throw new Error('No parts to export');
  if (kind === 'obj') download(writeOBJ(placed), `${base}.obj`, 'model/obj');
  else download(write3MF(placed, { unit: opts.unit === 'in' ? 'inch' : 'millimeter' }), `${base}.3mf`, 'model/3mf');
}

/** 2D primitives of a sketch in sketch coordinates (construction geometry on its own style). */
export function sketchPrims(entities: SkEntity[]): Prim2D[] {
  const map = entityMap(entities);
  const out: Prim2D[] = [];
  for (const e of entities) {
    const style = e.construction ? ('construction' as const) : ('visible' as const);
    switch (e.type) {
      case 'line':
        out.push({ t: 'line', a: pointOf(map, e.p1), b: pointOf(map, e.p2), style });
        break;
      case 'circle':
        out.push({ t: 'circle', c: pointOf(map, e.c), r: e.r, style });
        break;
      case 'arc': {
        const a = arcAngles(e, map);
        out.push({ t: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1, style });
        break;
      }
      case 'ellipse':
        out.push({ t: 'ellipse', c: pointOf(map, e.c), rx: e.rx, ry: e.ry, rot: e.rot, style });
        break;
      case 'spline':
        out.push({ t: 'poly', pts: splineSamples(e, map, 24), closed: false, style });
        break;
      case 'point':
        break;
    }
  }
  return out;
}

export function exportSketch(doc: CadDocument, entities: SkEntity[], name: string, format: 'dxf' | 'svg') {
  const prims = sketchPrims(entities);
  const unit = doc.units.length === 'in' ? 'in' : 'mm';
  if (format === 'dxf') download(writeDXF(prims, { units: unit }), `${safeName(name)}.dxf`, 'image/vnd.dxf');
  else download(writeSVG(prims, { margin: 5 }), `${safeName(name)}.svg`, 'image/svg+xml');
}
