// Turntable rotation (Z up): no tilting over the pole, but away from it — from the Top / Bottom view to the sides.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraController } from './camera';

/** The direction from the target to the camera. */
const back = (c: CameraController) => new THREE.Vector3(0, 0, 1).applyQuaternion(c.quat);

function fromView(v: 'top' | 'bottom' | 'front') {
  const c = new CameraController();
  c.rotationMode = 'turntable';
  c.setStdView(v);
  c.tick(performance.now() + 10000);
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

  it('does not tilt over the pole', () => {
    const c = fromView('front');
    // dragged on and on towards a pole: it stops just short of it
    for (let i = 0; i < 400; i++) c.rotate(0, -3);
    expect(Math.abs(back(c).z)).toBeLessThanOrEqual(0.9951);
    expect(Math.abs(back(c).z)).toBeGreaterThan(0.99);
  });
});
