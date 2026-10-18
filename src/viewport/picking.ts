// GPU picking: every pickable element writes its integer id as an RGB colour into an
// offscreen target. We render a small window around the cursor and choose the best
// candidate by priority (points > edges > faces), so thin lines are easy to hit.

import * as THREE from 'three';

export type PickPriority = number;

const vert = /* glsl */ `
  attribute float pickId;
  varying float vId;
  uniform float pointSize;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <clipping_planes_pars_vertex>
  void main() {
    vId = pickId;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = pointSize;
    #include <logdepthbuf_vertex>
    #include <clipping_planes_vertex>
  }
`;

const frag = /* glsl */ `
  varying float vId;
  #include <logdepthbuf_pars_fragment>
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    #include <logdepthbuf_fragment>
    float id = floor(vId + 0.5);
    float r = floor(id / 65536.0);
    float g = floor((id - r * 65536.0) / 256.0);
    float b = id - r * 65536.0 - g * 256.0;
    gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
  }
`;

export function makePickMaterial(opts: { points?: number; polygonOffset?: number; depthTest?: boolean; side?: THREE.Side } = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: { pointSize: { value: opts.points ?? 1 } },
    side: opts.side ?? THREE.DoubleSide,
    depthTest: opts.depthTest ?? true,
    depthWrite: opts.depthTest ?? true,
    // honours clippingPlanes (section view) when set
    clipping: true,
  });
  if (opts.polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = opts.polygonOffset;
    m.polygonOffsetUnits = opts.polygonOffset;
  }
  return m;
}

/** Fill a float attribute with a constant id. */
export function constantIds(count: number, id: number): THREE.BufferAttribute {
  const a = new Float32Array(count);
  a.fill(id);
  return new THREE.BufferAttribute(a, 1);
}

export interface PickHit<T> {
  item: T;
  id: number;
  /** Distance in pixels from the cursor. */
  dist: number;
}

export class PickRegistry<T extends { priority: number }> {
  private items: (T | undefined)[] = [undefined];
  alloc(item: T): number {
    this.items.push(item);
    return this.items.length - 1;
  }
  get(id: number): T | undefined {
    return this.items[id];
  }
  clear() {
    this.items = [undefined];
  }
  get size() {
    return this.items.length;
  }
}

export class Picker {
  private target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  private buf = new Uint8Array(4);
  private readonly radius: number;

  constructor(radius = 6) {
    this.radius = radius;
    const size = radius * 2 + 1;
    this.target.setSize(size, size);
    this.buf = new Uint8Array(size * size * 4);
  }

  /** Render `scene` around (x, y) in CSS pixels and return ids found in the window with pixel distances. */
  pick(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, x: number, y: number, w: number, h: number) {
    const size = this.radius * 2 + 1;
    const cam = camera as THREE.OrthographicCamera | THREE.PerspectiveCamera;
    const dpr = 1;
    cam.setViewOffset(w * dpr, h * dpr, Math.round(x * dpr) - this.radius, Math.round(y * dpr) - this.radius, size, size);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(this.target, 0, 0, size, size, this.buf);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    cam.clearViewOffset();
    const found = new Map<number, number>();
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const o = (j * size + i) * 4;
        if (this.buf[o + 3] === 0) continue;
        const id = (this.buf[o] << 16) | (this.buf[o + 1] << 8) | this.buf[o + 2];
        if (!id) continue;
        // readPixels rows start at the bottom
        const dx = i - this.radius;
        const dy = this.radius - j;
        const d = Math.hypot(dx, dy);
        const prev = found.get(id);
        if (prev === undefined || d < prev) found.set(id, d);
      }
    }
    return found;
  }

  dispose() {
    this.target.dispose();
  }
}

/** Choose the best hit: highest priority within its hit radius, then nearest. */
export function bestHit<T extends { priority: number; radius?: number }>(
  found: Map<number, number>,
  reg: PickRegistry<T>,
): PickHit<T> | null {
  let best: PickHit<T> | null = null;
  for (const [id, dist] of found) {
    const item = reg.get(id);
    if (!item) continue;
    if (dist > (item.radius ?? 6)) continue;
    if (
      !best ||
      item.priority > best.item.priority ||
      (item.priority === best.item.priority && dist < best.dist)
    )
      best = { item, id, dist };
  }
  return best;
}
