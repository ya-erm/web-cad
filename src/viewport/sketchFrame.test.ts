// A sketch on a part's face opens where it was drawn, even when a later feature (an extrusion from it added to that
// part) has renumbered the part's faces; a face just picked in the sketch dialog is taken as shown.

import { describe, expect, it } from 'vitest';
import type { PlaneFrame, PlaneRef } from '../core/types';
import { editedFaceSketchFrame } from './sketchFrame';

const onTop: PlaneRef = {
  kind: 'face',
  ref: { kind: 'face', partId: 'p1', index: 5, sig: { type: 'PLANE', center: [30, 20, 20], normal: [0, 0, 1] } } as never,
};
// the top face as the build found it at the sketch's place in the history
const built: PlaneFrame = { origin: [0, 0, 20], normal: [0, 0, 1], xDir: [1, 0, 0], yDir: [0, 1, 0] };
// face 5 of the whole model (after the boss was added): a side face
const sideNow = { center: [30, 40, 10] as [number, number, number], normal: [0, 1, 0] as [number, number, number] };

describe('the frame of a sketch on a face while it is edited', () => {
  it('its own face: as built, not the face with that number in the later model', () => {
    expect(editedFaceSketchFrame(onTop, onTop, built, sideNow)).toBe(built);
  });

  it('a face just picked in the dialog (the sketch was saved on Top): as shown', () => {
    const f = editedFaceSketchFrame(onTop, { kind: 'std', name: 'top' }, built, sideNow)!;
    expect(f.normal).toEqual([0, 1, 0]);
    expect(f.origin).toEqual([0, 40, 0]);
  });

  it('a new sketch on a face (nothing saved, nothing built)', () => {
    const f = editedFaceSketchFrame(onTop, undefined, undefined, { center: [30, 20, 20], normal: [0, 0, 1] })!;
    expect(f.origin).toEqual([0, 0, 20]);
    expect(editedFaceSketchFrame(onTop, undefined, undefined, undefined)).toBeNull();
  });
});
