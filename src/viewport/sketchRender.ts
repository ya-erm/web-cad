// Three.js objects for sketches: curves as fat lines, points, region fills.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { PlaneFrame, SkEntity, Vec2 } from '../core/types';
import { sampleEntity, type EntityMap } from '../sketch/curves';
import type { SketchRegion } from '../sketch/regions';

export const COLORS = {
  partEdge: 0x1f262d,
  hover: 0xffa31a,
  selected: 0xff6a00,
  under: 0x1565c0,
  full: 0x15191d,
  over: 0xd32f2f,
  construction: 0x7d8a96,
  constructionDark: 0x3d4650,
  patternHandle: 0x2f6fc4,
  /** Inference halos / guide lines while drawing. */
  inference: 0xf2b84b,
  committed: 0x35414d,
  region: 0xb9c4cf,
  regionHover: 0xffc25e,
  regionSelected: 0xff8c2a,
  plane: 0x6f97c9,
  previewNew: 0x4f9de8,
  previewRemove: 0xe25555,
  previewIntersect: 0xe0b23a,
};

/** All LineMaterials need the viewport resolution; the engine updates this set on resize. */
export const lineMaterials = new Set<LineMaterial>();
let resolution = new THREE.Vector2(1, 1);

export function setLineResolution(w: number, h: number) {
  resolution = new THREE.Vector2(w, h);
  for (const m of lineMaterials) m.resolution.copy(resolution);
}

/** Text textures of plane labels by their text (a handful, kept for reuse). */
const labelTextures = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>();

/** Text drawn into a texture (sharp at an angle: mipmaps, anisotropy); `aspect` — its width / height. */
function labelTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  const known = labelTextures.get(text);
  if (known) return known;
  const px = 96;
  const font = `500 ${px}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + 8;
  canvas.height = Math.ceil(px * 1.25);
  // resizing the canvas resets the context
  ctx.font = font;
  ctx.fillStyle = '#3c6299';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 4, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const out = { texture, aspect: canvas.width / canvas.height };
  labelTextures.set(text, out);
  return out;
}

/**
 * A plane's name written on the plane (Onshape): in its top-left corner along its top edge, in its own
 * coordinates (`h` — half the plane size). `userData.planeLabel` marks it so that it can be turned to read
 * from the back of the plane too (see `facePlaneLabel`).
 */
export function planeLabel(text: string, h: number): THREE.Mesh {
  const { texture, aspect } = labelTexture(text);
  const height = h * 0.14;
  const margin = h * 0.025;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(height * aspect, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
  );
  mesh.position.set(-h + margin + (height * aspect) / 2, h - margin - height / 2, 0);
  mesh.renderOrder = 1;
  mesh.userData.planeLabel = true;
  return mesh;
}

/** Mirror a plane label seen from the back of its plane, so that it still reads left to right. */
export function facePlaneLabel(label: THREE.Object3D, back: boolean) {
  label.scale.x = back ? -1 : 1;
}

export function lineMaterial(color: number, width: number, opts: { dashed?: boolean; depthTest?: boolean; opacity?: number } = {}) {
  const m = new LineMaterial({
    color,
    linewidth: width,
    dashed: !!opts.dashed,
    dashSize: 3,
    gapSize: 2,
    transparent: opts.opacity !== undefined && opts.opacity < 1,
    opacity: opts.opacity ?? 1,
    depthTest: opts.depthTest ?? true,
  });
  m.resolution.copy(resolution);
  lineMaterials.add(m);
  return m;
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const any = c as THREE.Mesh;
    if (any.geometry && !c.userData.sharedGeometry) any.geometry.dispose();
    const mats = any.material ? (Array.isArray(any.material) ? any.material : [any.material]) : [];
    for (const m of mats) {
      if (m instanceof LineMaterial) lineMaterials.delete(m);
      (m as THREE.Material).dispose();
    }
  });
}

export function frameMatrix(f: PlaneFrame): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.makeBasis(new THREE.Vector3(...f.xDir), new THREE.Vector3(...f.yDir), new THREE.Vector3(...f.normal));
  m.setPosition(new THREE.Vector3(...f.origin));
  return m;
}

/** Segment pairs (x,y,z,x,y,z,...) for a polyline. */
export function polylineSegments(pts: Vec2[], z = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push(pts[i][0], pts[i][1], z, pts[i + 1][0], pts[i + 1][1], z);
  return out;
}

export function fatSegments(positions: number[], mat: LineMaterial): LineSegments2 {
  const g = new LineSegmentsGeometry();
  g.setPositions(positions.length ? positions : [0, 0, 0, 0, 0, 0]);
  const l = new LineSegments2(g, mat);
  if (mat.dashed) l.computeLineDistances();
  return l;
}

export function entityPolyline(e: SkEntity, map: EntityMap): Vec2[] {
  try {
    return sampleEntity(e, map, Math.PI / 60);
  } catch {
    return [];
  }
}

/** Triangulated fill for a region (outer polygon with holes). */
export function regionGeometry(r: SketchRegion): THREE.BufferGeometry {
  const shape = new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of r.holePolygons) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return new THREE.ShapeGeometry(shape);
}

export function pointsObject(pts: Vec2[], color: number, size: number, depthTest = true): THREE.Points {
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => arr.set([p[0], p[1], 0], i * 3));
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const m = new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest, map: dotTexture(), alphaTest: 0.5, transparent: true });
  return new THREE.Points(g, m);
}

let dotTex: THREE.Texture | null = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(16, 16, 14, 0, Math.PI * 2);
  g.fill();
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}
