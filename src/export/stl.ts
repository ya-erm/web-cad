// STL writers (binary and ASCII). Facet normals are computed from the triangle winding.

export interface STLMesh {
  /** Flat xyz triples. */
  positions: Float32Array | number[];
  /** Triangle vertex indices (CCW = outward). */
  indices: Uint32Array | number[];
}

type FacetFn = (nx: number, ny: number, nz: number, v: number[]) => void;

function triangleCount(meshes: STLMesh[]): number {
  let n = 0;
  for (const m of meshes) n += Math.floor(m.indices.length / 3);
  return n;
}

/** Calls `fn` for every triangle with its unit normal and 9 vertex coordinates. */
function forEachFacet(meshes: STLMesh[], fn: FacetFn): void {
  const v = new Array<number>(9).fill(0);
  for (const m of meshes) {
    const p = m.positions;
    const idx = m.indices;
    const vertCount = Math.floor(p.length / 3);
    const tris = Math.floor(idx.length / 3);
    for (let t = 0; t < tris; t++) {
      for (let k = 0; k < 3; k++) {
        const i = idx[t * 3 + k];
        const ok = i >= 0 && i < vertCount;
        v[k * 3] = ok ? p[i * 3] : 0;
        v[k * 3 + 1] = ok ? p[i * 3 + 1] : 0;
        v[k * 3 + 2] = ok ? p[i * 3 + 2] : 0;
      }
      const ux = v[3] - v[0];
      const uy = v[4] - v[1];
      const uz = v[5] - v[2];
      const wx = v[6] - v[0];
      const wy = v[7] - v[1];
      const wz = v[8] - v[2];
      let nx = uy * wz - uz * wy;
      let ny = uz * wx - ux * wz;
      let nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 0) {
        nx /= len;
        ny /= len;
        nz /= len;
      } else {
        nx = ny = nz = 0;
      }
      fn(nx, ny, nz, v);
    }
  }
}

/** Binary STL: 80-byte header, uint32 triangle count, 50 bytes per triangle (little endian). */
export function writeSTLBinary(meshes: STLMesh[], name = 'WebCAD'): Uint8Array<ArrayBuffer> {
  const count = triangleCount(meshes);
  const buf = new Uint8Array(84 + 50 * count);
  const dv = new DataView(buf.buffer);

  // Header must not start with "solid" or some readers mistake the file for ASCII STL.
  let header = `Binary STL: ${name}`;
  if (/^solid/i.test(header)) header = `STL ${header}`;
  for (let i = 0; i < Math.min(80, header.length); i++) {
    const c = header.charCodeAt(i);
    buf[i] = c >= 32 && c < 127 ? c : 63;
  }
  dv.setUint32(80, count, true);

  let o = 84;
  forEachFacet(meshes, (nx, ny, nz, v) => {
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (let k = 0; k < 9; k++) {
      dv.setFloat32(o, v[k], true);
      o += 4;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  });
  return buf;
}

function f(v: number): string {
  return Number.isFinite(v) ? v.toExponential(6) : '0.000000e+0';
}

export function writeSTLAscii(meshes: STLMesh[], name = 'WebCAD'): string {
  const solidName = name.replace(/[^\x21-\x7e]+/g, '_') || 'WebCAD';
  const out: string[] = [`solid ${solidName}`];
  forEachFacet(meshes, (nx, ny, nz, v) => {
    out.push(
      `  facet normal ${f(nx)} ${f(ny)} ${f(nz)}`,
      '    outer loop',
      `      vertex ${f(v[0])} ${f(v[1])} ${f(v[2])}`,
      `      vertex ${f(v[3])} ${f(v[4])} ${f(v[5])}`,
      `      vertex ${f(v[6])} ${f(v[7])} ${f(v[8])}`,
      '    endloop',
      '  endfacet',
    );
  });
  out.push(`endsolid ${solidName}`);
  return out.join('\n') + '\n';
}
