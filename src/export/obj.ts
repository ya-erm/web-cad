// Wavefront OBJ writer (geometry only, no materials).

export interface OBJObject {
  name: string;
  /** Flat xyz triples. */
  positions: Float32Array | number[];
  /** Optional per-vertex normals, same layout/length as positions. */
  normals?: Float32Array | number[];
  /** Triangle vertex indices (0-based; written 1-based). */
  indices: Uint32Array | number[];
}

function num(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1e6) / 1e6;
  if (r === 0) return '0';
  return r.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function objName(name: string, i: number): string {
  const s = name.trim().replace(/\s+/g, '_');
  return s || `object_${i + 1}`;
}

export function writeOBJ(objects: OBJObject[]): string {
  const out: string[] = ['# WebCAD OBJ export'];
  let vBase = 1; // OBJ indices are 1-based and global across the file
  let nBase = 1;
  objects.forEach((o, oi) => {
    const p = o.positions;
    const vCount = Math.floor(p.length / 3);
    const hasNormals = !!o.normals && o.normals.length >= vCount * 3 && vCount > 0;
    out.push(`o ${objName(o.name, oi)}`);
    for (let i = 0; i < vCount; i++) out.push(`v ${num(p[i * 3])} ${num(p[i * 3 + 1])} ${num(p[i * 3 + 2])}`);
    if (hasNormals) {
      const n = o.normals as Float32Array | number[];
      for (let i = 0; i < vCount; i++) out.push(`vn ${num(n[i * 3])} ${num(n[i * 3 + 1])} ${num(n[i * 3 + 2])}`);
    }
    const idx = o.indices;
    const triCount = Math.floor(idx.length / 3);
    for (let t = 0; t < triCount; t++) {
      const a = idx[t * 3];
      const b = idx[t * 3 + 1];
      const c = idx[t * 3 + 2];
      if (a >= vCount || b >= vCount || c >= vCount) continue;
      if (hasNormals) {
        out.push(`f ${a + vBase}//${a + nBase} ${b + vBase}//${b + nBase} ${c + vBase}//${c + nBase}`);
      } else {
        out.push(`f ${a + vBase} ${b + vBase} ${c + vBase}`);
      }
    }
    vBase += vCount;
    if (hasNormals) nBase += vCount;
  });
  return out.join('\n') + '\n';
}
