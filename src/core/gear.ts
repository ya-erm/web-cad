// Spur gear geometry (involute teeth, standard proportions): its circles, the angle a tooth spans, and what makes a
// gear impossible. The sketch draws one tooth from it and arrays it around the centre (sketch/gear.ts).

/**
 * A spur gear: `z` teeth of module `m` (mm), pressure angle `alpha` (radians), `backlash` (mm, at the pitch circle)
 * of a pair of such gears: each tooth is thinner by half of it.
 */
export interface GearSize {
  z: number;
  m: number;
  alpha: number;
  backlash?: number;
}

/** Its circles (mm): pitch, tip (outer), root, base. Addendum m, dedendum 1.25 m. */
export function gearCircles({ z, m, alpha }: GearSize) {
  const r = (m * z) / 2;
  return { r, ra: r + m, rf: r - 1.25 * m, rb: r * Math.cos(alpha) };
}

/** The module of a gear from what sets its size: the module itself, the outer (tip) or the pitch diameter. */
export function gearModule(sizeBy: 'module' | 'outerDiameter' | 'pitchDiameter', z: number, value: number): number {
  return sizeBy === 'module' ? value : sizeBy === 'outerDiameter' ? value / (z + 2) : value / z;
}

const inv = (a: number) => Math.tan(a) - a;

/**
 * Half the angle a tooth spans at radius `rho` (from its centre line): the involute flanks, a tooth as thick as the
 * space at the pitch circle (less the backlash: each flank turned by a quarter of it there, still an involute); below
 * the base circle the flanks go radially.
 */
export function toothHalfAngle(g: GearSize, rho: number): number {
  const { rb } = gearCircles(g);
  const psi = Math.PI / (2 * g.z) - (g.backlash ?? 0) / (2 * g.m * g.z);
  return psi + inv(g.alpha) - (rho <= rb ? 0 : inv(Math.acos(rb / rho)));
}

/**
 * The rotation (radians) that puts the teeth of a gear of `z` teeth in the gaps of another one of `otherZ` teeth
 * turned by `otherRotation`, `theta` — the direction from the other's centre to this one's. Turning the other gear
 * by δ turns this one by −δ · otherZ / z: they roll together.
 */
export function meshRotation(z: number, theta: number, otherZ: number, otherRotation: number): number {
  return theta + Math.PI + Math.PI / z - ((otherRotation - theta) * otherZ) / z;
}

/** The centre distance (mm) of a pair of gears of module `m`: their pitch circles touch. */
export const meshDistance = (m: number, z1: number, z2: number) => (m * (z1 + z2)) / 2;

/** Why such a gear cannot be made (as a message), or null. */
export function gearProblem(g: GearSize): string | null {
  if (!(g.z >= 6 && g.z <= 400) || !Number.isInteger(g.z)) return 'A gear needs 6 to 400 teeth';
  if (!(g.m > 0)) return 'The module must be positive';
  if (!(g.alpha >= (10 * Math.PI) / 180 && g.alpha <= (35 * Math.PI) / 180)) return 'The pressure angle must be between 10° and 35°';
  if (!((g.backlash ?? 0) >= 0)) return 'The backlash cannot be negative';
  const { ra, rf, rb } = gearCircles(g);
  if (!(rf > 0)) return 'A gear needs 6 to 400 teeth';
  // the tip: the flanks meet before the tip circle (without the backlash they would not: it is too large)
  if (toothHalfAngle(g, ra) < 0.02 / g.z)
    return toothHalfAngle({ ...g, backlash: 0 }, ra) < 0.02 / g.z ? 'The teeth come to a point: more teeth or a smaller pressure angle' : 'The teeth come to a point: less backlash';
  // the root: neighbouring teeth meet
  if (toothHalfAngle(g, Math.max(rb, rf)) >= Math.PI / g.z - 1e-3) return 'The teeth overlap at the root: more teeth or a smaller pressure angle';
  return null;
}
