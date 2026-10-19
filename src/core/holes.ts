// Standard holes (Onshape Hole, Standard: ISO / ANSI). ISO: metric threads ISO 261 / 262, clearance holes ISO 273,
// tap drills ISO 2306, counterbores for socket head cap screws ISO 4762 (DIN 974-1) and countersinks for countersunk
// head screws ISO 10642 (90°), all in mm. ANSI (inch): see below.

import type { HoleParams } from './types';

interface IsoSize {
  /** Nominal (major) diameter. */
  d: number;
  /** Coarse pitch, then the fine ones. */
  pitches: number[];
  /** Tap drill for the coarse pitch. */
  drill: number;
  /** Clearance holes ISO 273: fine, medium, coarse. */
  clearance: [number, number, number];
  /** Socket head (ISO 4762) diameter: the counterbore is a little wider. */
  head: number;
}

const S = (d: number, pitches: number[], drill: number, clearance: [number, number, number], head: number): IsoSize => ({ d, pitches, drill, clearance, head });

/** ISO metric sizes M1.6…M64. */
export const ISO_SIZES: Record<string, IsoSize> = {
  'M1.6': S(1.6, [0.35, 0.2], 1.25, [1.7, 1.8, 2], 3),
  M2: S(2, [0.4, 0.25], 1.6, [2.2, 2.4, 2.6], 3.8),
  'M2.5': S(2.5, [0.45, 0.35], 2.05, [2.7, 2.9, 3.1], 4.5),
  M3: S(3, [0.5, 0.35], 2.5, [3.2, 3.4, 3.6], 5.5),
  M4: S(4, [0.7, 0.5], 3.3, [4.3, 4.5, 4.8], 7),
  M5: S(5, [0.8, 0.5], 4.2, [5.3, 5.5, 5.8], 8.5),
  M6: S(6, [1, 0.75], 5, [6.4, 6.6, 7], 10),
  M8: S(8, [1.25, 1, 0.75], 6.8, [8.4, 9, 10], 13),
  M10: S(10, [1.5, 1.25, 1, 0.75], 8.5, [10.5, 11, 12], 16),
  M12: S(12, [1.75, 1.5, 1.25, 1], 10.2, [13, 13.5, 14.5], 18),
  M14: S(14, [2, 1.5, 1.25, 1], 12, [15, 15.5, 16.5], 21),
  M16: S(16, [2, 1.5, 1], 14, [17, 17.5, 18.5], 24),
  M18: S(18, [2.5, 2, 1.5, 1], 15.5, [19, 20, 21], 27),
  M20: S(20, [2.5, 2, 1.5, 1], 17.5, [21, 22, 24], 30),
  M22: S(22, [2.5, 2, 1.5, 1], 19.5, [23, 24, 26], 33),
  M24: S(24, [3, 2, 1.5, 1], 21, [25, 26, 28], 36),
  M27: S(27, [3, 2, 1.5, 1], 24, [28, 30, 32], 40),
  M30: S(30, [3.5, 3, 2, 1.5, 1], 26.5, [31, 33, 35], 45),
  M33: S(33, [3.5, 3, 2, 1.5], 29.5, [34, 36, 38], 50),
  M36: S(36, [4, 3, 2, 1.5], 32, [37, 39, 42], 54),
  M39: S(39, [4, 3, 2, 1.5], 35, [40, 42, 45], 58),
  M42: S(42, [4.5, 4, 3, 2, 1.5], 37.5, [43, 45, 48], 63),
  M45: S(45, [4.5, 4, 3, 2, 1.5], 40.5, [46, 48, 52], 68),
  M48: S(48, [5, 4, 3, 2, 1.5], 43, [50, 52, 56], 72),
  M52: S(52, [5, 4, 3, 2, 1.5], 47, [54, 56, 62], 78),
  M56: S(56, [5.5, 4, 3, 2, 1.5], 50.5, [58, 62, 66], 84),
  M60: S(60, [5.5, 4, 3, 2, 1.5], 54.5, [62, 66, 70], 90),
  M64: S(64, [6, 4, 3, 2, 1.5], 58, [66, 70, 74], 96),
};

export const ISO_SIZE_NAMES = Object.keys(ISO_SIZES);

/** The pitches of a size (mm), coarse first. */
export const isoPitches = (size: string) => ISO_SIZES[size]?.pitches ?? [];

const round1 = (x: number) => Math.round(x * 10) / 10;

/** A thread: its designation ("M6", "M8×1" — fine), major diameter and pitch. */
export interface ThreadSpec {
  designation: string;
  major: number;
  pitch: number;
}

/** The sizes of a standard hole, mm (the countersink angle in degrees); `thread` — a tapped hole's. */
export interface StandardHole {
  diameter: number;
  cboreDiameter: number;
  cboreDepth: number;
  csinkDiameter: number;
  csinkAngle: number;
  /** Counterdrill: the countersink at the counterbore's mouth. */
  counterdrill: { diameter: number; angle: number };
  thread?: ThreadSpec;
}

/** Sizes of an ISO hole, or why there are none. */
export function isoHole(p: Pick<HoleParams, 'holeType' | 'size' | 'fit' | 'pitch'>): StandardHole | string {
  const s = p.size ? ISO_SIZES[p.size] : undefined;
  if (!s) return `Unknown ISO size "${p.size ?? ''}"`;
  const coarse = s.pitches[0];
  const pitch = p.pitch ? Number(p.pitch) : coarse;
  if (!s.pitches.includes(pitch)) return `${p.size} has no ${p.pitch} mm pitch`;
  const tapped = p.holeType === 'tapped';
  const fit = p.fit === 'close' ? 0 : p.fit === 'loose' ? 2 : 1;
  // a tapped hole: its tap drill (fine pitches: major − pitch); the screw goes through a clearance hole
  const diameter = tapped ? (pitch === coarse ? s.drill : round1(s.d - pitch)) : s.clearance[fit];
  const d = s.d;
  // DIN 974-1 for ISO 4762: the head with a clearance, as deep as the head is tall (= d) and a little more
  const cboreDiameter = round1(s.head + (d <= 6 ? 1 : d <= 16 ? 2 : d <= 20 ? 3 : 4));
  const cboreDepth = round1(d + (d <= 5 ? 0.4 : d <= 12 ? 0.6 : 0.8));
  // ISO 10642 heads (theoretical diameter ≈ 2.24 d for small screws, 2 d for large) with a clearance
  const k = d <= 12 ? 2.24 : d <= 16 ? 2.1 : 2.016;
  const csinkDiameter = round1(k * d + 0.3);
  return {
    diameter,
    cboreDiameter,
    cboreDepth,
    csinkDiameter,
    csinkAngle: 90,
    // counterdrill: a 0.5 mm × 45° chamfer of the counterbore's mouth
    counterdrill: { diameter: cboreDiameter + 1, angle: 90 },
    ...(tapped ? { thread: { designation: pitch === coarse ? p.size! : `${p.size}×${pitch}`, major: d, pitch } } : {}),
  };
}

/** Depths an ISO hole starts with: a tapped one — threaded 2 d deep, drilled a few pitches deeper; others — 2 d. */
export function isoDefaultDepths(size: string, tapped: boolean): { depth: number; tapDepth: number } {
  const s = ISO_SIZES[size];
  if (!s) return { depth: 10, tapDepth: 8 };
  const tapDepth = round1(2 * s.d);
  return { depth: tapped ? round1(tapDepth + 3 * s.pitches[0]) : tapDepth, tapDepth };
}

// ---------------------------------------------------------------------------
// ANSI (inch): Unified threads UNC / UNF (ASME B1.1) with 75 % tap drills, clearance holes ASME B18.2.8
// (close / normal / loose — the drill, the hole's smallest size), counterbores for socket head cap screws
// (ASME B18.3) and 82° countersinks for flat socket head cap screws (ASME B18.3: the head's theoretical sharp
// diameter — flush). Sizes in inches here; the holes come out in mm.
// ---------------------------------------------------------------------------

interface AnsiThread {
  tpi: number;
  series: 'UNC' | 'UNF';
  /** 75 % tap drill, in. */
  drill: number;
}

interface AnsiSize {
  /** Basic major diameter, in. */
  d: number;
  /** Coarse (UNC) first where there is one. */
  threads: AnsiThread[];
  /** ASME B18.2.8: close, normal, loose; none — not in the table (tapped holes only). */
  clearance?: [number, number, number];
  /** Counterbore for a socket head cap screw, in. */
  cbore?: number;
  /** Countersink (82°) for a flat socket head cap screw, in. */
  csink?: number;
}

const UNC = (tpi: number, drill: number): AnsiThread => ({ tpi, series: 'UNC', drill });
const UNF = (tpi: number, drill: number): AnsiThread => ({ tpi, series: 'UNF', drill });
const A = (d: number, threads: AnsiThread[], clearance?: [number, number, number], cbore?: number, csink?: number): AnsiSize => ({ d, threads, clearance, cbore, csink });

/** ANSI inch sizes #0…1". */
export const ANSI_SIZES: Record<string, AnsiSize> = {
  '#0': A(0.06, [UNF(80, 0.0469)], [0.067, 0.076, 0.094], 0.125),
  '#1': A(0.073, [UNC(64, 0.0595), UNF(72, 0.0595)], [0.081, 0.089, 0.104], 0.156),
  '#2': A(0.086, [UNC(56, 0.07), UNF(64, 0.07)], [0.094, 0.102, 0.116], 0.188),
  '#3': A(0.099, [UNC(48, 0.0785), UNF(56, 0.082)], [0.106, 0.116, 0.128], 0.219),
  '#4': A(0.112, [UNC(40, 0.089), UNF(48, 0.0935)], [0.12, 0.128, 0.144], 0.219, 0.255),
  '#5': A(0.125, [UNC(40, 0.1015), UNF(44, 0.104)], [0.141, 0.156, 0.172], 0.25),
  '#6': A(0.138, [UNC(32, 0.1065), UNF(40, 0.113)], [0.154, 0.17, 0.185], 0.281, 0.307),
  '#8': A(0.164, [UNC(32, 0.136), UNF(36, 0.136)], [0.18, 0.196, 0.213], 0.312, 0.359),
  '#10': A(0.19, [UNC(24, 0.1495), UNF(32, 0.159)], [0.206, 0.221, 0.238], 0.375, 0.411),
  '#12': A(0.216, [UNC(24, 0.177), UNF(28, 0.182)]),
  '1/4': A(0.25, [UNC(20, 0.201), UNF(28, 0.213)], [0.266, 0.281, 0.297], 0.438, 0.531),
  '5/16': A(0.3125, [UNC(18, 0.257), UNF(24, 0.272)], [0.328, 0.344, 0.359], 0.531, 0.656),
  '3/8': A(0.375, [UNC(16, 0.3125), UNF(24, 0.332)], [0.391, 0.406, 0.422], 0.625, 0.781),
  '7/16': A(0.4375, [UNC(14, 0.368), UNF(20, 0.3906)], [0.453, 0.469, 0.484], 0.719),
  '1/2': A(0.5, [UNC(13, 0.4219), UNF(20, 0.4531)], [0.531, 0.562, 0.609], 0.812, 0.938),
  '9/16': A(0.5625, [UNC(12, 0.4844), UNF(18, 0.5156)]),
  '5/8': A(0.625, [UNC(11, 0.5312), UNF(18, 0.5781)], [0.656, 0.688, 0.734], 1),
  '3/4': A(0.75, [UNC(10, 0.6562), UNF(16, 0.6875)], [0.781, 0.812, 0.906], 1.188),
  '7/8': A(0.875, [UNC(9, 0.7656), UNF(14, 0.8125)], [0.906, 0.938, 1.031], 1.375),
  '1': A(1, [UNC(8, 0.875), UNF(12, 0.9219)], [1.031, 1.094, 1.156], 1.625),
};

export const ANSI_SIZE_NAMES = Object.keys(ANSI_SIZES);

const IN = 25.4;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Sizes of an ANSI hole (mm), or why there are none; `pitch` — threads per inch ("20"), none — the first (coarse). */
export function ansiHole(p: Pick<HoleParams, 'holeType' | 'size' | 'fit' | 'pitch' | 'style'>): StandardHole | string {
  const s = p.size ? ANSI_SIZES[p.size] : undefined;
  if (!s) return `Unknown ANSI size "${p.size ?? ''}"`;
  const thread = p.pitch ? s.threads.find((x) => x.tpi === Number(p.pitch)) : s.threads[0];
  if (!thread) return `${p.size} has no ${p.pitch} threads per inch`;
  const tapped = p.holeType === 'tapped';
  if (!tapped && !s.clearance) return `No clearance hole size for ${p.size} (ASME B18.2.8): use the custom sizes`;
  if ((p.style === 'counterbore' || p.style === 'counterdrill') && !s.cbore) return `No counterbore size for ${p.size}: use the custom sizes`;
  if (p.style === 'countersink' && !s.csink) return `No countersink size for ${p.size}: use the custom sizes`;
  const fit = p.fit === 'close' ? 0 : p.fit === 'loose' ? 2 : 1;
  const diameter = (tapped ? thread.drill : s.clearance![fit]) * IN;
  // the counterbore as deep as the normal clearance hole is wide: the head (as tall as d) a little below the surface
  const cbore = (s.cbore ?? 0) * IN;
  return {
    diameter: round3(diameter),
    cboreDiameter: round3(cbore),
    cboreDepth: round3((s.clearance?.[1] ?? s.d) * IN),
    csinkDiameter: round3((s.csink ?? 0) * IN),
    csinkAngle: 82,
    // counterdrill: a 1/64" × 45° chamfer of the counterbore's mouth
    counterdrill: { diameter: round3(cbore + IN / 32), angle: 90 },
    ...(tapped ? { thread: { designation: `${p.size}-${thread.tpi} ${thread.series}`, major: round3(s.d * IN), pitch: round3(IN / thread.tpi) } } : {}),
  };
}

/** The threads of an ANSI size: threads per inch with the series, coarse first. */
export const ansiThreads = (size: string) => ANSI_SIZES[size]?.threads ?? [];

/** Depths an ANSI hole starts with (mm): as the ISO ones — threaded 2 d deep, drilled 3 pitches deeper; others 2 d. */
export function ansiDefaultDepths(size: string, tapped: boolean): { depth: number; tapDepth: number } {
  const s = ANSI_SIZES[size];
  if (!s) return { depth: 10, tapDepth: 8 };
  const tapDepth = round1(2 * s.d * IN);
  return { depth: tapped ? round1(tapDepth + (3 * IN) / s.threads[0].tpi) : tapDepth, tapDepth };
}

// ---------------------------------------------------------------------------
// Either standard
// ---------------------------------------------------------------------------

/** A standard hole's sizes (mm) by its standard (ISO or ANSI), or why there are none. */
export function standardHole(p: Pick<HoleParams, 'standard' | 'holeType' | 'size' | 'fit' | 'pitch' | 'style'>): StandardHole | string {
  return p.standard === 'ansi' ? ansiHole(p) : isoHole(p);
}

export const standardSizes = (standard: 'iso' | 'ansi') => (standard === 'ansi' ? ANSI_SIZE_NAMES : ISO_SIZE_NAMES);

/** The size a hole of the standard starts with. */
export const standardDefaultSize = (standard: 'iso' | 'ansi') => (standard === 'ansi' ? '1/4' : 'M6');

export function standardDefaultDepths(standard: 'iso' | 'ansi', size: string, tapped: boolean) {
  return standard === 'ansi' ? ansiDefaultDepths(size, tapped) : isoDefaultDepths(size, tapped);
}

/** The pitches of a size: the stored value ('' — the coarse one) and its label (mm, or threads per inch and series). */
export function standardPitches(standard: 'iso' | 'ansi', size: string): { value: string; label: string; coarse: boolean }[] {
  if (standard === 'ansi') return ansiThreads(size).map((x, i) => ({ value: i ? String(x.tpi) : '', label: `${x.tpi} ${x.series}`, coarse: i === 0 && x.series === 'UNC' }));
  return isoPitches(size).map((x, i) => ({ value: i ? String(x) : '', label: `${x} mm`, coarse: i === 0 }));
}
