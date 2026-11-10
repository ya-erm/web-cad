// Turntable rotation (Z up): from the Top / Bottom view to the sides, over the pole (upside down) and back; a horizontal
// drag pulls the near side with the cursor, upside down too.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraController } from './camera';

/** The direction from the target to the camera. */
const back = (c: CameraController) => new THREE.Vector3(0, 0, 1).applyQuaternion(c.quat);

/** The side of the model nearest the camera, on the horizontal circle through the target. */
const nearSide = (c: CameraController) => {
  const b = back(c);
  return new THREE.Vector3(b.x, b.y, 0).normalize();
};

function fromView(v: 'top' | 'bottom' | 'front') {
  const c = new CameraController();
  c.rotationMode = 'turntable';
  c.setStdView(v);
  c.tick(performance.now() + 10000);
  return c;
}

/** From the Front view tilted by `steps` mouse moves of 3 px down (about 1° each: the camera goes up, over the top). */
function tilted(steps: number) {
  const c = fromView('front');
  c.beginRotate();
  for (let i = 0; i < steps; i++) c.rotate(0, 3);
  return c;
}

describe('turntable rotation', () => {
  it('turns from the Top view down to the sides with small mouse moves', () => {
    for (const v of ['top', 'bottom'] as const) {
      const c = fromView(v);
      expect(Math.abs(back(c).z)).toBeCloseTo(1, 6);
      // 60 moves of 3 px (about 60°): it leaves the pole
      for (let i = 0; i < 60; i++) c.rotate(0, v === 'top' ? 3 : -3);
      expect(Math.abs(back(c).z)).toBeLessThan(0.6);
    }
  });

  it('tilts over the pole: the view turns upside down, the horizon stays level', () => {
    // 116 moves of 3 px: 116 · 0.018 rad ≈ 119.6° up from the Front view — 30° past the top, behind the model
    const c = tilted(116);
    const a = 116 * 3 * 0.006;
    expect(back(c).x).toBeCloseTo(0, 6);
    expect(back(c).y).toBeCloseTo(-Math.cos(a), 6);
    expect(back(c).z).toBeCloseTo(Math.sin(a), 6);
    expect(c.up.z).toBeLessThan(0);
    // right stays +X: the image does not flip on crossing
    expect(c.right.x).toBeCloseTo(1, 6);
    // in one big move too
    const d = fromView('front');
    d.rotate(0, 300);
    expect(back(d).z).toBeCloseTo(Math.sin(1.8), 6);
    expect(d.right.x).toBeCloseTo(1, 6);
  });

  it('turns all the way round over the top and the bottom', () => {
    // 349 moves of 3 px ≈ 360°: back to the Front view, upright
    const c = tilted(349);
    expect(back(c).y).toBeCloseTo(-1, 4);
    expect(c.up.z).toBeCloseTo(1, 4);
    // and the other way, over the bottom
    const d = fromView('front');
    for (let i = 0; i < 349; i++) d.rotate(0, -3);
    expect(back(d).y).toBeCloseTo(-1, 4);
    expect(d.up.z).toBeCloseTo(1, 4);
  });

  it('a horizontal drag pulls the near side with the cursor, upright and upside down', () => {
    for (const steps of [30, 116]) {
      const c = tilted(steps);
      const near = nearSide(c);
      expect(near.dot(c.right)).toBeCloseTo(0, 6);
      c.beginRotate();
      c.rotate(10, 0);
      // dragged right: the near side moves right on the screen
      expect(near.dot(c.right)).toBeGreaterThan(0.05);
    }
  });

  it('keeps the horizontal direction for the whole drag across the pole', () => {
    // a drag that begins upright and goes over the top: sideways it still turns as it did at the start
    const c = tilted(60);
    for (let i = 0; i < 60; i++) c.rotate(0, 3);
    expect(c.up.z).toBeLessThan(0);
    let near = nearSide(c);
    c.rotate(10, 0);
    expect(near.dot(c.right)).toBeLessThan(-0.05);
    // the next drag begins upside down: the near side follows the cursor
    near = nearSide(c);
    c.beginRotate();
    c.rotate(10, 0);
    expect(near.dot(c.right)).toBeGreaterThan(0.05);
  });
});
