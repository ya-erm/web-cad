// 3MF (3D Manufacturing Format) writer: OPC package (ZIP) with a single core-spec model part.

import { parseColor } from './prim2d';
import { zipStore } from './zip';

export interface ThreeMFObject {
  name: string;
  /** CSS colour (e.g. '#ff8800'); written as a base material display colour. */
  color?: string;
  /** Flat xyz triples (mm unless `unit` says otherwise). */
  positions: Float32Array | number[];
  /** Triangle vertex indices (three per triangle, CCW = outward). */
  indices: Uint32Array | number[];
}

export interface ThreeMFOptions {
  unit?: 'millimeter' | 'inch';
}

export interface WeldedMesh {
  positions: number[];
  indices: number[];
}

/**
 * Merges vertices whose coordinates coincide within `tol` (grid snapping), drops vertices not
 * referenced by any triangle and removes triangles that become degenerate.
 */
export function weldVertices(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  tol = 1e-6,
): WeldedMesh {
  const vertCount = Math.floor(positions.length / 3);
  const remap = new Int32Array(vertCount).fill(-1);
  const lookup = new Map<string, number>();
  const outPos: number[] = [];
  const outIdx: number[] = [];
  const inv = 1 / tol;

  const weld = (i: number): number => {
    const cached = remap[i];
    if (cached >= 0) return cached;
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let id = lookup.get(key);
    if (id === undefined) {
      id = outPos.length / 3;
      outPos.push(x, y, z);
      lookup.set(key, id);
    }
    remap[i] = id;
    return id;
  };

  const triCount = Math.floor(indices.length / 3);
  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];
    if (ia >= vertCount || ib >= vertCount || ic >= vertCount || ia < 0 || ib < 0 || ic < 0) continue;
    const a = weld(ia);
    const b = weld(ib);
    const c = weld(ic);
    if (a === b || b === c || a === c) continue;
    outIdx.push(a, b, c);
  }
  return { positions: outPos, indices: outIdx };
}

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  );
}

function num(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1e6) / 1e6;
  if (r === 0) return '0';
  let s = r.toFixed(6);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function displayColor(color: string | undefined): string | null {
  const c = parseColor(color);
  if (!c) return null;
  const hex = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
  return `#${hex(c[0])}${hex(c[1])}${hex(c[2])}${c[3] < 255 ? hex(c[3]) : ''}`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

export function build3MFModel(objects: ThreeMFObject[], opts: ThreeMFOptions = {}): string {
  const unit = opts.unit ?? 'millimeter';
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`,
  );
  out.push(' <metadata name="Application">WebCAD</metadata>');
  out.push(' <resources>');

  // Base materials: one entry per distinct display colour.
  const colorIndex = new Map<string, number>();
  const materials: string[] = [];
  for (const o of objects) {
    const dc = displayColor(o.color);
    if (dc && !colorIndex.has(dc)) {
      colorIndex.set(dc, materials.length);
      materials.push(`  <base name="${xmlEscape(o.name || `Color ${materials.length + 1}`)}" displaycolor="${dc}"/>`);
    }
  }
  const materialsId = 1;
  if (materials.length) {
    out.push(`  <basematerials id="${materialsId}">`, ...materials, '  </basematerials>');
  }

  let nextId = materials.length ? 2 : 1;
  const items: number[] = [];
  for (const o of objects) {
    const mesh = weldVertices(o.positions, o.indices);
    if (mesh.indices.length === 0) continue;
    const id = nextId++;
    items.push(id);
    const dc = displayColor(o.color);
    const mat = dc ? ` pid="${materialsId}" pindex="${colorIndex.get(dc)}"` : '';
    out.push(`  <object id="${id}" type="model" name="${xmlEscape(o.name)}"${mat}>`);
    out.push('   <mesh>');
    out.push('    <vertices>');
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      out.push(`     <vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>`);
    }
    out.push('    </vertices>');
    out.push('    <triangles>');
    const t = mesh.indices;
    for (let i = 0; i < t.length; i += 3) {
      out.push(`     <triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`);
    }
    out.push('    </triangles>');
    out.push('   </mesh>');
    out.push('  </object>');
  }
  out.push(' </resources>');
  out.push(' <build>');
  for (const id of items) out.push(`  <item objectid="${id}"/>`);
  out.push(' </build>');
  out.push('</model>');
  return out.join('\n') + '\n';
}

export function write3MF(objects: ThreeMFObject[], opts: ThreeMFOptions = {}): Uint8Array<ArrayBuffer> {
  return zipStore([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: RELS },
    { name: '3D/3dmodel.model', data: build3MFModel(objects, opts) },
  ]);
}
