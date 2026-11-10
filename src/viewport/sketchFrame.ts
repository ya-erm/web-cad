// Where a sketch being edited lies when its plane is a part's face.

import type { PlaneFrame, PlaneRef, Vec3 } from '../core/types';
import { frameFromNormal, v3 } from '../core/math';

/**
 * The frame of a sketch on a face while it is edited. Its own face (the plane it was saved with): as the last build
 * found it, at the sketch's place in the history — the model shown when the sketch opens is the whole one, and later
 * features (an extrusion from this very sketch added to the part) number its faces otherwise, so the saved index is
 * another face there. A face just picked in the sketch dialog: that face as currently shown (`faceNow`).
 */
export function editedFaceSketchFrame(
  plane: PlaneRef,
  saved: PlaneRef | undefined,
  built: PlaneFrame | undefined,
  faceNow: { center: Vec3; normal?: Vec3 } | undefined,
): PlaneFrame | null {
  if (built && saved && JSON.stringify(saved) === JSON.stringify(plane)) return built;
  if (faceNow?.normal) return frameFromNormal(v3.scale(faceNow.normal, v3.dot(faceNow.center, faceNow.normal)), faceNow.normal);
  return built ?? null;
}
