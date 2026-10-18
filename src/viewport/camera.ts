// Onshape-style camera: orthographic by default, right-drag rotates (free tumble about
// screen axes around a pivot), middle-drag / ctrl+right-drag pans, wheel zooms to cursor.

import * as THREE from 'three';
import type { Vec3 } from '../core/types';

export type StdView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso' | 'dimetric' | 'trimetric';

const Z_UP = new THREE.Vector3(0, 0, 1);

/** Direction from target towards the camera and the camera up vector for each view. */
export function stdViewAxes(v: StdView): { dir: THREE.Vector3; up: THREE.Vector3 } {
  switch (v) {
    case 'front':
      return { dir: new THREE.Vector3(0, -1, 0), up: Z_UP.clone() };
    case 'back':
      return { dir: new THREE.Vector3(0, 1, 0), up: Z_UP.clone() };
    case 'right':
      return { dir: new THREE.Vector3(1, 0, 0), up: Z_UP.clone() };
    case 'left':
      return { dir: new THREE.Vector3(-1, 0, 0), up: Z_UP.clone() };
    case 'top':
      return { dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) };
    case 'bottom':
      return { dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, -1, 0) };
    case 'iso':
      return { dir: new THREE.Vector3(1, -1, 1).normalize(), up: Z_UP.clone() };
    case 'dimetric':
      return { dir: new THREE.Vector3(0.9, -1.3, 0.75).normalize(), up: Z_UP.clone() };
    case 'trimetric':
      return { dir: new THREE.Vector3(0.6, -1.4, 0.9).normalize(), up: Z_UP.clone() };
  }
}

function quatFromDirUp(dir: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const m = new THREE.Matrix4();
  // camera looks along -dir
  const upFixed = up.clone();
  if (Math.abs(upFixed.clone().normalize().dot(dir)) > 0.999) upFixed.set(0, 1, 0);
  m.lookAt(dir, new THREE.Vector3(0, 0, 0), upFixed);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

interface Anim {
  t0: number;
  dur: number;
  fromQ: THREE.Quaternion;
  toQ: THREE.Quaternion;
  fromT: THREE.Vector3;
  toT: THREE.Vector3;
  fromH: number;
  toH: number;
}

export type RotationMode = 'free' | 'turntable';

export interface CameraView {
  quat: [number, number, number, number];
  target: [number, number, number];
  viewHeight: number;
}

export class CameraController {
  /** free = trackball tumble about screen axes; turntable = about world Z, horizon stays level. */
  rotationMode: RotationMode = 'free';
  readonly ortho: THREE.OrthographicCamera;
  readonly persp: THREE.PerspectiveCamera;
  perspective = false;
  target = new THREE.Vector3(0, 0, 0);
  quat = new THREE.Quaternion();
  /** Visible world height (orthographic). */
  viewHeight = 160;
  sceneRadius = 200;
  private width = 1;
  private height = 1;
  private anim: Anim | null = null;
  onChange: () => void = () => {};

  constructor() {
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.persp = new THREE.PerspectiveCamera(30, 1, 0.1, 1e6);
    const { dir, up } = stdViewAxes('iso');
    this.quat = quatFromDirUp(dir, up);
    this.update();
  }

  get camera(): THREE.Camera {
    return this.perspective ? this.persp : this.ortho;
  }

  getView(): CameraView {
    return {
      quat: [this.quat.x, this.quat.y, this.quat.z, this.quat.w],
      target: [this.target.x, this.target.y, this.target.z],
      viewHeight: this.viewHeight,
    };
  }

  setView(v: CameraView) {
    if (!v || !Array.isArray(v.quat) || !Array.isArray(v.target) || !(v.viewHeight > 0)) return;
    this.anim = null;
    this.quat.set(v.quat[0], v.quat[1], v.quat[2], v.quat[3]).normalize();
    this.target.set(v.target[0], v.target[1], v.target[2]);
    this.viewHeight = v.viewHeight;
    this.update();
  }

  setSize(w: number, h: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.update();
  }

  /** World units per screen pixel at the target depth. */
  get pixelSize() {
    return this.viewHeight / this.height;
  }

  get viewDir(): THREE.Vector3 {
    // direction the camera looks at
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
  }

  get up(): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
  }

  get right(): THREE.Vector3 {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
  }

  update() {
    const aspect = this.width / this.height;
    const h = this.viewHeight / 2;
    const dist = this.sceneRadius * 4 + 1000;
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    const o = this.ortho;
    o.left = -h * aspect;
    o.right = h * aspect;
    o.top = h;
    o.bottom = -h;
    o.near = 0.01;
    o.far = dist * 2;
    o.position.copy(this.target).addScaledVector(back, dist);
    o.quaternion.copy(this.quat);
    o.updateProjectionMatrix();
    o.updateMatrixWorld(true);
    const p = this.persp;
    p.aspect = aspect;
    const pd = h / Math.tan(THREE.MathUtils.degToRad(p.fov / 2));
    p.position.copy(this.target).addScaledVector(back, pd);
    p.quaternion.copy(this.quat);
    p.near = Math.max(pd / 1000, 0.01);
    p.far = pd + dist * 2;
    p.updateProjectionMatrix();
    p.updateMatrixWorld(true);
    this.onChange();
  }

  /** Ray in world space through a pixel (CSS px relative to the canvas). */
  ray(x: number, y: number): THREE.Ray {
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.ray;
  }

  /** World point on the plane through the target perpendicular to the view at pixel. */
  pointAtPixel(x: number, y: number, through = this.target): THREE.Vector3 {
    const r = this.ray(x, y);
    const n = this.viewDir;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, through);
    const out = new THREE.Vector3();
    return r.intersectPlane(plane, out) ?? through.clone();
  }

  rotate(dxPx: number, dyPx: number, pivot?: THREE.Vector3) {
    this.anim = null;
    const speed = 0.006;
    let q: THREE.Quaternion;
    if (this.rotationMode === 'turntable') {
      // azimuth about world Z, elevation about the (horizontal) camera right axis
      const qh = new THREE.Quaternion().setFromAxisAngle(Z_UP, -dxPx * speed);
      let qv = new THREE.Quaternion().setFromAxisAngle(this.right, -dyPx * speed);
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
      if (Math.abs(back.clone().applyQuaternion(qv).z) > 0.995) qv = new THREE.Quaternion();
      q = qh.multiply(qv);
    } else {
      const qh = new THREE.Quaternion().setFromAxisAngle(this.up, -dxPx * speed);
      const qv = new THREE.Quaternion().setFromAxisAngle(this.right, -dyPx * speed);
      q = qh.multiply(qv);
    }
    if (pivot) {
      const off = this.target.clone().sub(pivot).applyQuaternion(q);
      this.target.copy(pivot).add(off);
    }
    this.quat.premultiply(q).normalize();
    if (this.rotationMode === 'turntable') this.levelHorizon();
    this.update();
  }

  /** Keep the camera's right axis horizontal (Z up), except when looking straight down/up. */
  levelHorizon() {
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    if (Math.abs(back.z) > 0.999) return;
    const up = this.up.z >= 0 ? Z_UP : Z_UP.clone().negate();
    this.quat.copy(quatFromDirUp(back, up));
  }

  rotateAbout(axis: THREE.Vector3, angle: number) {
    const q = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
    this.animateTo(q.multiply(this.quat), this.target.clone(), this.viewHeight, 250);
  }

  pan(dxPx: number, dyPx: number) {
    this.anim = null;
    const s = this.pixelSize;
    this.target.addScaledVector(this.right, -dxPx * s).addScaledVector(this.up, dyPx * s);
    this.update();
  }

  zoomAt(factor: number, x?: number, y?: number) {
    this.anim = null;
    const before = x !== undefined && y !== undefined ? this.pointAtPixel(x, y) : null;
    this.viewHeight = THREE.MathUtils.clamp(this.viewHeight * factor, 1e-3, 1e6);
    this.update();
    if (before && x !== undefined && y !== undefined) {
      const after = this.pointAtPixel(x, y);
      this.target.add(before.sub(after));
      this.update();
    }
  }

  animateTo(q: THREE.Quaternion, target: THREE.Vector3, viewHeight: number, dur = 350) {
    this.anim = {
      t0: performance.now(),
      dur,
      fromQ: this.quat.clone(),
      toQ: q,
      fromT: this.target.clone(),
      toT: target,
      fromH: this.viewHeight,
      toH: viewHeight,
    };
  }

  /** Advance animation; returns true while animating. */
  tick(now: number): boolean {
    const a = this.anim;
    if (!a) return false;
    let t = (now - a.t0) / a.dur;
    if (t >= 1) {
      t = 1;
      this.anim = null;
    }
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.quat.slerpQuaternions(a.fromQ, a.toQ, e);
    this.target.lerpVectors(a.fromT, a.toT, e);
    this.viewHeight = a.fromH + (a.toH - a.fromH) * e;
    this.update();
    return true;
  }

  get animating() {
    return !!this.anim;
  }

  setStdView(v: StdView, box?: THREE.Box3) {
    const { dir, up } = stdViewAxes(v);
    this.viewFrom(dir, up, box);
  }

  viewFrom(dir: THREE.Vector3, up: THREE.Vector3, box?: THREE.Box3, center?: THREE.Vector3) {
    const q = quatFromDirUp(dir, up);
    const { target, height } = this.fitParams(box, q);
    this.animateTo(q, center ?? target, center ? this.viewHeight : height);
  }

  fit(box: THREE.Box3) {
    const { target, height } = this.fitParams(box, this.quat);
    this.animateTo(this.quat.clone(), target, height);
  }

  private fitParams(box: THREE.Box3 | undefined, q: THREE.Quaternion) {
    if (!box || box.isEmpty()) return { target: this.target.clone(), height: this.viewHeight };
    const center = box.getCenter(new THREE.Vector3());
    // project box corners onto the screen axes of the target orientation
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    let w = 0;
    let h = 0;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ).sub(center);
      w = Math.max(w, Math.abs(p.dot(r)));
      h = Math.max(h, Math.abs(p.dot(u)));
    }
    const aspect = this.width / this.height;
    const height = Math.max(h * 2, (w * 2) / aspect, 1e-2) * 1.25;
    return { target: center, height };
  }

  /** Orientation looking straight at a plane (sketch normal-to). */
  normalTo(normal: Vec3, up: Vec3, center: Vec3) {
    const dir = new THREE.Vector3(...normal).normalize();
    const q = quatFromDirUp(dir, new THREE.Vector3(...up));
    // keep current zoom, move target to the projection of the current target onto the plane
    const c = new THREE.Vector3(...center);
    const t = this.target.clone();
    const d = t.clone().sub(c).dot(dir);
    t.addScaledVector(dir, -d);
    this.animateTo(q, t, this.viewHeight);
  }
}
