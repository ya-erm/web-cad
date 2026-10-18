/**
 * Hand-drawn SVG icon set imitating Onshape's toolbar / feature-list icons.
 *
 * All icons use a 24x24 viewBox, `currentColor` line art (1.5 stroke) plus a
 * small palette of accent colours:
 *  - blue   — created geometry (extruded bodies, new planes, results)
 *  - orange — sketch entities, profiles, selections
 *  - green  — add / confirm
 *  - red    — remove / cancel / delete
 */
import type { JSX, ReactNode, SVGProps } from 'react';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const BLUE = '#2f80d1';
const BLUE_FILL = '#cfe3f7';
const BLUE_LIGHT = '#e6f0fb';
const BLUE_MID = '#a9cdf0';
const BLUE_DEEP = '#7fb1e3';
const ORANGE = '#f08a24';
const ORANGE_FILL = '#fde4cc';
const GREEN = '#3aa655';
const RED = '#d64545';
const RED_FILL = '#fbe3e3';
const GREY_TOP = '#f4f6f8';
const GREY_LEFT = '#e3e7eb';
const GREY_RIGHT = '#cdd3da';
const WHITE = '#ffffff';

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

type Pt = readonly [number, number];

interface Shade {
  top: string;
  left: string;
  right: string;
}

const BLUE_SHADE: Shade = { top: BLUE_LIGHT, left: BLUE_FILL, right: BLUE_MID };
const GREY_SHADE: Shade = { top: GREY_TOP, left: GREY_LEFT, right: GREY_RIGHT };

const DASH = { strokeDasharray: '2 1.75', strokeLinecap: 'butt' } as const;
const THIN = { strokeWidth: 1 } as const;
const SMALL = { strokeWidth: 1.25 } as const;

const r2 = (n: number): number => Math.round(n * 100) / 100;
const P = (...p: Pt[]): string => p.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ');

/**
 * Isometric box. (cx, ty) is the back-top vertex, `a` the half-width of the
 * top diamond (its height is `a`), `h` the vertical height.
 */
function box(
  cx: number,
  ty: number,
  a: number,
  h: number,
  shade: Shade = BLUE_SHADE,
  props?: SVGProps<SVGGElement>,
): JSX.Element {
  const b = a / 2;
  const T: Pt = [cx, ty];
  const R: Pt = [cx + a, ty + b];
  const F: Pt = [cx, ty + a];
  const L: Pt = [cx - a, ty + b];
  const d = (p: Pt): Pt => [p[0], p[1] + h];
  return (
    <g {...props}>
      <polygon points={P(T, R, F, L)} fill={shade.top} />
      <polygon points={P(L, F, d(F), d(L))} fill={shade.left} />
      <polygon points={P(F, R, d(R), d(F))} fill={shade.right} />
    </g>
  );
}

/**
 * Oblique box, the projection most Onshape feature icons use: the front face
 * is the rectangle (x, y, w, h); the top face and one side face recede by
 * (dx, -dy) — to the upper right for dx > 0, to the upper left for dx < 0.
 */
function obox(
  x: number,
  y: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
  shade: Shade = BLUE_SHADE,
): JSX.Element {
  const sx = dx > 0 ? x + w : x;
  return (
    <g>
      <polygon points={P([x, y], [x + dx, y - dy], [x + w + dx, y - dy], [x + w, y])} fill={shade.top} />
      <polygon points={P([sx, y], [sx + dx, y - dy], [sx + dx, y + h - dy], [sx, y + h])} fill={shade.right} />
      <rect x={x} y={y} width={w} height={h} fill={shade.left} />
    </g>
  );
}

/** Small upright cylinder (pin) whose top ellipse is centred at (x, y). */
function cyl(x: number, y: number, h: number, shade: Shade = BLUE_SHADE): JSX.Element {
  return (
    <g {...SMALL}>
      <path d={`M${x - 2.25} ${y} V${y + h} A2.25 1.1 0 0 0 ${x + 2.25} ${y + h} V${y}`} fill={shade.left} />
      <ellipse cx={x} cy={y} rx={2.25} ry={1.1} fill={shade.top} />
    </g>
  );
}

/** Faded style for "before" / suppressed bodies. */
const GHOST = { opacity: 0.4, strokeWidth: 1.25 } as const;

/** Sketch key point (hollow). */
function pt(x: number, y: number): JSX.Element {
  return <circle cx={x} cy={y} r={1.6} fill={WHITE} strokeWidth={1.25} />;
}

/** Solid dot. */
function dot(x: number, y: number, color: string = ORANGE, r = 2.4): JSX.Element {
  return <circle cx={x} cy={y} r={r} fill={color} stroke="none" />;
}

/** Small round status badge in the bottom-right corner. */
function badge(kind: 'remove' | 'check'): JSX.Element {
  const color = kind === 'remove' ? RED : GREEN;
  return (
    <g>
      <circle cx={18} cy={18} r={4.75} fill={WHITE} stroke={color} />
      {kind === 'remove' ? (
        <path d="M16.25 16.25 L19.75 19.75 M19.75 16.25 L16.25 19.75" stroke={color} />
      ) : (
        <path d="M15.8 18.1 L17.4 19.7 L20.2 16.5" stroke={color} />
      )}
    </g>
  );
}

/** n points evenly spread on a circle, starting at `startDeg`. */
function ring(cx: number, cy: number, r: number, n: number, startDeg: number): Pt[] {
  return Array.from({ length: n }, (_, i): Pt => {
    const a = ((startDeg + (360 / n) * i) * Math.PI) / 180;
    return [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))];
  });
}

function gearPath(cx: number, cy: number, teeth: number, ro: number, ri: number): string {
  const step = (Math.PI * 2) / teeth;
  const bw = step * 0.3;
  const tw = step * 0.17;
  const p = (r: number, a: number): string => `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`;
  let d = `M${p(ri, -Math.PI / 2 - bw)}`;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    d += ` L${p(ro, a - tw)} L${p(ro, a + tw)} L${p(ri, a + bw)} A${ri} ${ri} 0 0 1 ${p(ri, a + step - bw)}`;
  }
  return `${d} Z`;
}

const GEAR = gearPath(12, 12, 8, 9.25, 6.75);

const DOC_OUTLINE =
  'M14 3 H6.5 A1 1 0 0 0 5.5 4 V20 A1 1 0 0 0 6.5 21 H17.5 A1 1 0 0 0 18.5 20 V7.5 Z';

// Onshape-style plane: a slightly skewed sheet with its corner marked.
const PLANE_OUTLINE = '3,3 21,5.5 21,21 3,18.5';
const PLANE_CORNER = '12.5,4.32 21,5.5 21,12.68 12.5,11.5';

const EYE_OUTLINE = 'M2 12 C4.5 7.5 8 5.5 12 5.5 C16 5.5 19.5 7.5 22 12 C19.5 16.5 16 18.5 12 18.5 C8 18.5 4.5 16.5 2 12 Z';

// Faces of the standard view cube: box(12, 3, 8, 9)
const CUBE_TOP = '12,3 20,7 12,11 4,7';
const CUBE_FRONT = '4,7 12,11 12,20 4,16';
const CUBE_RIGHT = '12,11 20,7 20,16 12,20';

function viewCube(face: string): JSX.Element {
  return (
    <>
      {box(12, 3, 8, 9, GREY_SHADE)}
      <polygon points={face} fill={BLUE_FILL} stroke={BLUE} />
    </>
  );
}

// Glyphs reused (mirrored / rotated) by more than one icon.
const horizontalGlyph = (
  <>
    <path d="M7 7.5 H17 M9 5.5 L7 7.5 L9 9.5 M15 5.5 L17 7.5 L15 9.5" {...SMALL} />
    <path d="M3.5 15 H20.5" stroke={ORANGE} strokeWidth={1.75} />
    {pt(3.5, 15)}
    {pt(20.5, 15)}
  </>
);

const undoGlyph = (
  <>
    <path d="M4.5 9.5 H14.5 A5 5 0 0 1 14.5 19.5 H9" />
    <path d="M8 5.5 L4 9.5 L8 13.5" />
  </>
);

const rotateRightGlyph = (
  <>
    <path d="M18.93 8 A8 8 0 1 1 12 4" />
    <path d="M9.5 1.5 L12 4 L9.5 6.5" />
  </>
);

const MIRROR_X = 'translate(24 0) scale(-1 1)';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ICONS = {
  // ----- Part Studio features ---------------------------------------------
  // Pencil drawing a line.
  sketch: (
    <>
      <path d="M2.5 20.5 H21.5" stroke={ORANGE} strokeWidth={2} />
      <g transform="translate(4.5 19) rotate(-45)">
        <path d="M0 0 L4.5 -2.6 H20 V2.6 H4.5 Z" fill={WHITE} />
        <path d="M16 -2.6 H20 V2.6 H16 Z" fill={ORANGE_FILL} {...THIN} />
        <path d="M4.5 -2.6 V2.6" {...THIN} />
        <path d="M0 0 L1.7 -1 V1 Z" fill="currentColor" {...THIN} />
      </g>
    </>
  ),
  extrude: (
    <>
      {box(10, 6, 6, 8)}
      <path d="M4 17 L10 14 L16 17" stroke={ORANGE} {...THIN} strokeDasharray="1.5 1.5" strokeLinecap="butt" />
      <path d="M4 17 L10 20 L16 17" stroke={ORANGE} strokeWidth={2} />
      <path d="M20 16.5 V4 M17.5 6.5 L20 4 L22.5 6.5" stroke={BLUE} strokeWidth={1.75} />
    </>
  ),
  // Partially revolved ring around a dashed axis; the profile at its ends.
  revolve: (
    <>
      <path d="M18.89 6.21 A9 9 0 1 0 18.89 17.79 L14.3 13.93 A3 3 0 1 1 14.3 10.07 Z" fill={BLUE_FILL} />
      <ellipse cx={16.6} cy={8.14} rx={3} ry={1.6} transform="rotate(-40 16.6 8.14)" fill={ORANGE_FILL} stroke={ORANGE} {...SMALL} />
      <ellipse cx={16.6} cy={15.86} rx={3} ry={1.6} transform="rotate(40 16.6 15.86)" fill={ORANGE_FILL} stroke={ORANGE} {...SMALL} />
      <path d="M1.5 12 H22.5" {...THIN} {...DASH} />
    </>
  ),
  sweep: (
    <>
      <path d="M5 20 C5 12 19 13 19 5" strokeWidth={7} strokeLinecap="butt" />
      <path d="M5 20 C5 12 19 13 19 5" stroke={BLUE_FILL} strokeWidth={4} strokeLinecap="butt" />
      <path d="M5 20 C5 12 19 13 19 5" stroke={ORANGE} {...THIN} />
      <ellipse cx={19} cy={5} rx={3.5} ry={1.4} fill={BLUE_LIGHT} stroke={BLUE} {...SMALL} />
      <ellipse cx={5} cy={20} rx={3.5} ry={1.4} fill={ORANGE_FILL} stroke={ORANGE} {...SMALL} />
    </>
  ),
  // Circular profile lofted into a square one.
  loft: (
    <>
      <path d="M7.5 5.5 C7.5 11 5.5 14.5 3 18 L12 21.5 L21 18 C18.5 14.5 16.5 11 16.5 5.5 Z" fill={BLUE_FILL} />
      <path d="M3 18 L12 14.5 L21 18" stroke={ORANGE} {...THIN} strokeDasharray="1.5 1.5" strokeLinecap="butt" />
      <path d="M3 18 L12 21.5 L21 18" stroke={ORANGE} strokeWidth={1.75} />
      <ellipse cx={12} cy={5.5} rx={4.5} ry={1.75} fill={ORANGE_FILL} stroke={ORANGE} />
    </>
  ),
  // Wavy surface (orange) thickened downwards into a block.
  thicken: (
    <>
      <polygon points="16,9.5 20.5,5 20.5,16.5 16,21" fill={BLUE_MID} />
      <path d="M3 9.5 C6.25 6.5 11.25 13 16 9.5 V21 H3 Z" fill={BLUE_FILL} />
      <path d="M3 9.5 C6.25 6.5 11.25 13 16 9.5 L20.5 5 C15.75 8.5 10.75 2 7.5 5 Z" fill={ORANGE_FILL} stroke={ORANGE} />
      <path d="M8.25 12.25 H10.75 V15.75 H13 L9.5 19.5 L6 15.75 H8.25 Z" fill={WHITE} {...SMALL} />
    </>
  ),
  fillet: (
    <>
      <path d="M3 9 L8 4 H15 L10 9 Z" fill={GREY_TOP} />
      <path d="M3 20 V9 H10 A5 5 0 0 1 15 14 V20 Z" fill={GREY_LEFT} />
      <path d="M15 14 L20 9 V15 L15 20 Z" fill={GREY_RIGHT} />
      <path d="M10 9 L15 4 A5 5 0 0 1 20 9 L15 14 A5 5 0 0 0 10 9 Z" fill={BLUE_FILL} stroke={BLUE} />
    </>
  ),
  chamfer: (
    <>
      <path d="M3 9 L8 4 H15 L10 9 Z" fill={GREY_TOP} />
      <path d="M3 20 V9 H10 L15 14 V20 Z" fill={GREY_LEFT} />
      <path d="M15 14 L20 9 V15 L15 20 Z" fill={GREY_RIGHT} />
      <path d="M10 9 L15 4 L20 9 L15 14 Z" fill={BLUE_FILL} stroke={BLUE} />
    </>
  ),
  // Block hollowed out through its front face.
  shell: (
    <>
      {obox(3, 8, 13, 13, 4.5, 4.5)}
      <rect x={8.9} y={10.75} width={4.35} height={4.35} fill={BLUE_DEEP} stroke="none" />
      <polygon points="5.75,10.75 5.75,18.25 8.9,15.1 8.9,10.75" fill={BLUE_MID} stroke="none" />
      <polygon points="5.75,18.25 13.25,18.25 13.25,15.1 8.9,15.1" fill={BLUE_LIGHT} stroke="none" />
      <path d="M5.75 18.25 L8.9 15.1 H13.25 M8.9 15.1 V10.75" {...THIN} />
      <rect x={5.75} y={10.75} width={7.5} height={7.5} />
    </>
  ),
  draft: (
    <>
      <path d="M3 8 L7 4 H16 L12 8 Z" fill={GREY_TOP} />
      <path d="M3 8 H12 L15.5 20 H3 Z" fill={GREY_LEFT} />
      <path d="M12 8 L16 4 L19.5 16 L15.5 20 Z" fill={BLUE_FILL} stroke={BLUE} />
      <path d="M12 8 V20" {...THIN} {...DASH} />
    </>
  ),
  // L-bracket with a triangular rib in its inner corner.
  rib: (
    <g transform={MIRROR_X}>
      <polygon points="2.5,13.5 6,16.5 6,21 2.5,18" fill={GREY_RIGHT} />
      <polygon points="2.5,13.5 13.5,13.5 17,16.5 6,16.5" fill={GREY_TOP} />
      <polygon points="13.5,13.5 13.5,3 17,6 17,16.5" fill={GREY_RIGHT} />
      <polygon points="13.5,3 17.5,3 21,6 17,6" fill={GREY_TOP} />
      <polygon points="6,16.5 17,16.5 17,6 21,6 21,21 6,21" fill={GREY_LEFT} />
      <polygon points="15.8,7.6 14.7,6.6 6.7,14.6 7.8,15.6" fill={BLUE_MID} stroke={BLUE} {...SMALL} />
      <polygon points="15.8,15.6 15.8,7.6 7.8,15.6" fill={BLUE_FILL} stroke={BLUE} {...SMALL} />
    </g>
  ),
  // Block with a counterbored hole in its front face.
  hole: (
    <>
      {obox(3, 8, 13, 13, 4.5, 4.5, GREY_SHADE)}
      <circle cx={9.5} cy={14.5} r={4.5} fill={BLUE_MID} stroke={BLUE} />
      <circle cx={10.5} cy={13.5} r={2.1} fill={BLUE_DEEP} stroke={BLUE} {...THIN} />
    </>
  ),
  // 2x2 grid of blocks: the seed (grey) and its copies.
  linearPattern: (
    <g {...SMALL}>
      {obox(2.5, 14.5, 7, 7, 2.5, 2.5)}
      {obox(12, 14.5, 7, 7, 2.5, 2.5)}
      {obox(2.5, 5, 7, 7, 2.5, 2.5, GREY_SHADE)}
      {obox(12, 5, 7, 7, 2.5, 2.5)}
    </g>
  ),
  circularPattern: (
    <>
      <circle cx={12} cy={12} r={7} {...THIN} {...DASH} />
      {ring(12, 12, 7, 6, -90).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.4} fill={i === 0 ? GREY_LEFT : BLUE_FILL} {...SMALL} />
      ))}
      {dot(12, 12, 'currentColor', 1.2)}
    </>
  ),
  // Pins placed along a curve.
  curvePattern: (
    <>
      <path d="M4.5 11 C4.5 18.5 9.5 21 12 18.5 C14.5 16 19.5 18 19.5 12.5" stroke={ORANGE} {...SMALL} />
      {cyl(4.5, 4.5, 6.5, GREY_SHADE)}
      {cyl(12, 11.5, 6.5)}
      {cyl(19.5, 6, 6.5)}
    </>
  ),
  // L-shaped part and its mirror image on the other side of a plane.
  mirror: (
    <>
      <path d="M12 1.5 V22.5" {...THIN} {...DASH} />
      <g {...SMALL}>
        <polygon points="2,5.5 3.75,3.75 6.75,3.75 5,5.5" fill={GREY_TOP} />
        <polygon points="5,5.5 6.75,3.75 6.75,13.75 5,15.5" fill={GREY_RIGHT} />
        <polygon points="5,15.5 6.75,13.75 9.75,13.75 8,15.5" fill={GREY_TOP} />
        <polygon points="8,15.5 9.75,13.75 9.75,18.75 8,20.5" fill={GREY_RIGHT} />
        <polygon points="2,5.5 5,5.5 5,15.5 8,15.5 8,20.5 2,20.5" fill={GREY_LEFT} />
      </g>
      <g transform={MIRROR_X} {...SMALL}>
        <polygon points="2,5.5 3.75,3.75 6.75,3.75 5,5.5" fill={BLUE_LIGHT} />
        <polygon points="5,5.5 6.75,3.75 6.75,13.75 5,15.5" fill={BLUE_MID} />
        <polygon points="5,15.5 6.75,13.75 9.75,13.75 8,15.5" fill={BLUE_LIGHT} />
        <polygon points="8,15.5 9.75,13.75 9.75,18.75 8,20.5" fill={BLUE_MID} />
        <polygon points="2,5.5 5,5.5 5,15.5 8,15.5 8,20.5 2,20.5" fill={BLUE_FILL} />
      </g>
    </>
  ),
  // Two overlapping bodies merged into one.
  boolean: (
    <>
      <circle cx={8.5} cy={12} r={6.5} fill={GREY_LEFT} />
      <circle cx={15.5} cy={12} r={6.5} fill={BLUE_FILL} />
      <path d="M12 6.52 A6.5 6.5 0 0 1 12 17.48 A6.5 6.5 0 0 1 12 6.52 Z" fill={BLUE_MID} stroke="none" />
      <circle cx={8.5} cy={12} r={6.5} />
      <circle cx={15.5} cy={12} r={6.5} />
    </>
  ),
  split: (
    <>
      {box(12, 10, 7, 4)}
      <polygon points="12,6.5 21.5,11.25 12,16 2.5,11.25" stroke={ORANGE} {...SMALL} />
      {box(12, 2.5, 7, 4, GREY_SHADE)}
    </>
  ),
  // Block moved and rotated to a new position.
  transform: (
    <>
      {box(7.5, 11.5, 4.5, 4.5, GREY_SHADE, SMALL)}
      <g transform="rotate(25 16.5 7.5)">{box(16.5, 3, 4.5, 4.5, BLUE_SHADE, SMALL)}</g>
      <path d="M3.5 9.5 A6 6 0 0 1 9.5 3.5 M7.75 1.75 L9.5 3.5 L7.75 5.25" stroke={BLUE} />
      <path d="M20.5 14.5 A6 6 0 0 1 14.5 20.5 M16.25 18.75 L14.5 20.5 L16.25 22.25" stroke={BLUE} />
    </>
  ),
  deletePart: (
    <>
      {box(10.5, 2.5, 7.5, 8.5, GREY_SHADE)}
      {badge('remove')}
    </>
  ),
  plane: (
    <>
      <polygon points={PLANE_OUTLINE} fill={BLUE_FILL} stroke={BLUE} />
      <polygon points={PLANE_CORNER} fill={BLUE_LIGHT} stroke="none" />
      <path d="M12.5 4.32 V11.5 L21 12.68" stroke={BLUE} />
    </>
  ),
  helix: (
    <>
      <path d="M12 2 V22" {...THIN} {...DASH} />
      <path d="M18 7 A6 2.5 0 0 0 6 10 M18 13 A6 2.5 0 0 0 6 16" stroke={BLUE_MID} {...SMALL} />
      <path d="M6 4 A6 2.5 0 0 0 18 7 M6 10 A6 2.5 0 0 0 18 13 M6 16 A6 2.5 0 0 0 18 19" stroke={BLUE} strokeWidth={1.75} />
    </>
  ),
  mateConnector: (
    <>
      <circle cx={12} cy={12} r={9.25} fill={BLUE_LIGHT} />
      <circle cx={12} cy={12} r={6} fill={WHITE} />
      <path d="M12 12 V6 A6 6 0 0 1 18 12 Z" fill={BLUE_FILL} stroke="none" />
      <path d="M12 6 V12 H18" stroke={BLUE} strokeWidth={1.75} />
    </>
  ),
  // "(x)"
  variable: (
    <>
      <path d="M7.5 4 C4.5 8 4.5 16 7.5 20 M16.5 4 C19.5 8 19.5 16 16.5 20" />
      <path
        d="M8.75 9.25 C10.25 8.25 11.25 8.75 11.75 10.5 L12.5 13.5 C13 15.25 14 15.75 15.25 14.75 M15 9.25 C13.75 8.5 12.75 9.5 12.1 11.75 C11.4 14.25 10.25 15.5 8.75 14.75"
        stroke={BLUE}
        strokeWidth={1.75}
      />
    </>
  ),
  import: (
    <>
      <path d="M9 8.5 V3 H15.5 L20 7.5 V21 H9 V15.5" fill={WHITE} />
      <path d="M15.5 3 V7.5 H20" {...THIN} />
      <path d="M2.5 12 H13.5 M10.5 9 L13.5 12 L10.5 15" stroke={BLUE} strokeWidth={1.75} />
    </>
  ),
  // Tape measure.
  measure: (
    <>
      <rect x={2} y={12.5} width={12} height={5.5} fill={WHITE} />
      <path d="M4 18 V16 M6 18 V16.75 M8 18 V16 M10 18 V16.75" {...THIN} />
      <path d="M11 8 V14 A5.5 3 0 0 0 22 14 V8" fill={ORANGE_FILL} />
      <ellipse cx={16.5} cy={8} rx={5.5} ry={3} fill={WHITE} />
      <ellipse cx={16.5} cy={8} rx={2.25} ry={1.15} fill={ORANGE_FILL} {...THIN} />
    </>
  ),
  // Balance scale.
  massProps: (
    <>
      <path d="M12 4 V19.5 M4 6 H20" />
      <path d="M7.5 20.5 H16.5" strokeWidth={2.25} />
      <path d="M4 6 L1.75 13 M4 6 L6.25 13 M20 6 L17.75 13 M20 6 L22.25 13" {...THIN} />
      <path d="M1.25 13 H6.75 A2.75 2.75 0 0 1 1.25 13 Z" fill={BLUE_FILL} {...SMALL} />
      <path d="M17.25 13 H22.75 A2.75 2.75 0 0 1 17.25 13 Z" fill={BLUE_FILL} {...SMALL} />
      {dot(12, 3.75, 'currentColor', 1.4)}
    </>
  ),
  // Cylinder with a wedge cut away, showing hatched section faces.
  sectionView: (
    <>
      <path d="M5.99 8.62 A8.5 3 0 1 1 18.01 8.62 L12 6.5 Z" fill={GREY_TOP} />
      <path d="M3.5 6.5 V18 A8.5 3 0 0 0 5.99 20.12 V8.62 A8.5 3 0 0 1 3.5 6.5 Z" fill={GREY_LEFT} />
      <path d="M20.5 6.5 V18 A8.5 3 0 0 1 18.01 20.12 V8.62 A8.5 3 0 0 0 20.5 6.5 Z" fill={GREY_RIGHT} />
      <polygon points="12,6.5 5.99,8.62 5.99,20.12 12,18" fill={BLUE_LIGHT} />
      <polygon points="12,6.5 18.01,8.62 18.01,20.12 12,18" fill={BLUE_LIGHT} />
      <path
        d="M12 8 L5.99 12 M12 11.5 L5.99 15.5 M12 15 L5.99 19 M12 8 L18.01 12 M12 11.5 L18.01 15.5 M12 15 L18.01 19"
        stroke={BLUE}
        {...THIN}
      />
    </>
  ),
  export: (
    <>
      <path d="M15 8.5 V7.5 L10.5 3 H4 V21 H15 V15.5" fill={WHITE} />
      <path d="M10.5 3 V7.5 H15" {...THIN} />
      <path d="M10 12 H21.5 M18.5 9 L21.5 12 L18.5 15" stroke={BLUE} strokeWidth={1.75} />
    </>
  ),
  undo: undoGlyph,
  redo: <g transform={MIRROR_X}>{undoGlyph}</g>,

  // ----- Sketch tools -----------------------------------------------------
  line: (
    <>
      <path d="M5 19 L19 5" stroke={ORANGE} strokeWidth={1.75} />
      {pt(5, 19)}
      {pt(19, 5)}
    </>
  ),
  rectCorner: (
    <>
      <rect x={4} y={6} width={16} height={12} stroke={ORANGE} strokeWidth={1.75} />
      {pt(4, 18)}
      {pt(20, 6)}
    </>
  ),
  rectCenter: (
    <>
      <rect x={4} y={6} width={16} height={12} stroke={ORANGE} strokeWidth={1.75} />
      <path d="M12 12 L20 6" {...THIN} {...DASH} />
      {pt(12, 12)}
      {pt(20, 6)}
    </>
  ),
  rectAligned: (
    <>
      <polygon points="4,12 16,5 20,12 8,19" stroke={ORANGE} strokeWidth={1.75} />
      {pt(4, 12)}
      {pt(16, 5)}
      {pt(20, 12)}
    </>
  ),
  circleCenter: (
    <>
      <circle cx={12} cy={12} r={8.5} stroke={ORANGE} strokeWidth={1.75} />
      <path d="M12 12 L18 6" {...THIN} {...DASH} />
      {pt(12, 12)}
      {pt(18.01, 5.99)}
    </>
  ),
  circle3pt: (
    <>
      <circle cx={12} cy={12} r={8.5} stroke={ORANGE} strokeWidth={1.75} />
      <path d="M10.25 12 H13.75 M12 10.25 V13.75" {...THIN} />
      {pt(4.01, 9.09)}
      {pt(18.51, 6.54)}
      {pt(13.48, 20.37)}
    </>
  ),
  arc3pt: (
    <>
      <path d="M3.5 16 A8.5 8.5 0 0 1 20.5 16" stroke={ORANGE} strokeWidth={1.75} />
      <path d="M10.25 16 H13.75 M12 14.25 V17.75" {...THIN} />
      {pt(3.5, 16)}
      {pt(12, 7.5)}
      {pt(20.5, 16)}
    </>
  ),
  // Existing line (dark) continued by a tangent arc.
  arcTangent: (
    <>
      <path d="M3.5 5 H12" />
      <path d="M12 5 A7 7 0 0 1 12 19" stroke={ORANGE} strokeWidth={1.75} />
      <path d="M10.25 12 H13.75 M12 10.25 V13.75" {...THIN} />
      {pt(12, 5)}
      {pt(12, 19)}
    </>
  ),
  arcCenter: (
    <>
      <path d="M5 18.5 H18.5 V5" {...THIN} {...DASH} />
      <path d="M5 18.5 A13.5 13.5 0 0 1 18.5 5" stroke={ORANGE} strokeWidth={1.75} />
      {pt(5, 18.5)}
      {pt(18.5, 18.5)}
      {pt(18.5, 5)}
    </>
  ),
  spline: (
    <>
      <path d="M3 17 C5.5 7 9.5 7.5 12 12 S18.5 17 21 7" stroke={ORANGE} strokeWidth={1.75} />
      {pt(3, 17)}
      {pt(12, 12)}
      {pt(21, 7)}
    </>
  ),
  point: (
    <>
      <path d="M12 3 V7.5 M12 16.5 V21 M3 12 H7.5 M16.5 12 H21" {...THIN} />
      {dot(12, 12, ORANGE, 2.75)}
    </>
  ),
  slot: (
    <>
      <path d="M7 8 H17 A4 4 0 0 1 17 16 H7 A4 4 0 0 1 7 8 Z" stroke={ORANGE} strokeWidth={1.75} />
      <path d="M7 12 H17" {...THIN} {...DASH} />
      {pt(7, 12)}
      {pt(17, 12)}
    </>
  ),
  // Hexagon around a construction circle that touches its sides (Onshape "Inscribed polygon").
  polygonInscribed: (
    <>
      <circle cx={12} cy={12} r={7.4} {...THIN} {...DASH} />
      <polygon points="12,3.45 19.4,7.73 19.4,16.27 12,20.55 4.6,16.27 4.6,7.73" stroke={ORANGE} strokeWidth={1.75} />
      {pt(12, 12)}
      {pt(19.4, 12)}
    </>
  ),
  // Pentagon inscribed in a construction circle (Onshape "Circumscribed polygon").
  polygon: (
    <>
      <circle cx={12} cy={12.75} r={8.5} {...THIN} {...DASH} />
      <polygon points="12,4.25 20.08,10.12 17,19.63 7,19.63 3.92,10.12" stroke={ORANGE} strokeWidth={1.75} />
      {pt(12, 12.75)}
      {pt(20.08, 10.12)}
    </>
  ),
  ellipse: (
    <g transform="rotate(-30 12 12)">
      <ellipse cx={12} cy={12} rx={9.5} ry={5.5} stroke={ORANGE} strokeWidth={1.75} />
      <path d="M12 12 H21.5" {...THIN} {...DASH} />
      {pt(12, 12)}
      {pt(21.5, 12)}
    </g>
  ),
  sketchFillet: (
    <>
      <path d="M4.5 11.5 V4.5 H11.5" {...THIN} {...DASH} />
      <path d="M4.5 11.5 V20 M11.5 4.5 H20" />
      <path d="M4.5 11.5 A7 7 0 0 1 11.5 4.5" stroke={ORANGE} strokeWidth={1.75} />
      {pt(4.5, 11.5)}
      {pt(11.5, 4.5)}
    </>
  ),
  // Scissors.
  trim: (
    <>
      <path d="M8.46 15.82 L13.25 13.06 L20.94 6.06 L11.75 10.94 L7.54 14.52 Z" fill="currentColor" stroke="none" />
      <path d="M8.46 8.18 L13.25 10.94 L20.94 17.94 L11.75 13.06 L7.54 9.48 Z" fill="currentColor" stroke="none" />
      <circle cx={5.75} cy={16.75} r={2.75} fill={WHITE} stroke={RED} strokeWidth={1.75} />
      <circle cx={5.75} cy={7.25} r={2.75} fill={WHITE} stroke={RED} strokeWidth={1.75} />
      <circle cx={12.5} cy={12} r={0.9} fill={WHITE} stroke="none" />
    </>
  ),
  extend: (
    <>
      <path d="M20 3 V21" />
      <path d="M3 12 H11" stroke={ORANGE} strokeWidth={1.75} />
      <path d="M11 12 H18.5" stroke={ORANGE} {...DASH} />
      <path d="M16 9.5 L18.5 12 L16 14.5" stroke={ORANGE} />
      {pt(3, 12)}
    </>
  ),
  offset: (
    <>
      <path d="M4 20 V12 A7 7 0 0 1 11 5 H20" />
      <path d="M8.5 20 V12 A2.5 2.5 0 0 1 11 9.5 H20" stroke={ORANGE} strokeWidth={1.75} />
    </>
  ),
  // Block whose front-face edges are used (projected) into the sketch.
  use: (
    <>
      {obox(3, 8, 13, 13, 4.5, 4.5, GREY_SHADE)}
      <rect x={3} y={8} width={13} height={13} stroke={ORANGE} strokeWidth={1.75} />
    </>
  ),
  sketchMirror: (
    <>
      <path d="M12 2 V22" {...THIN} {...DASH} />
      <path d="M3.5 4.5 H7 V13.5 H9.5 V19.5 H3.5 Z" />
      <path d="M20.5 4.5 H17 V13.5 H14.5 V19.5 H20.5 Z" stroke={ORANGE} strokeWidth={1.75} />
    </>
  ),
  // Solid line toggled to a dashed construction line and back.
  construction: (
    <>
      <path d="M5 3.5 V20.5" stroke={ORANGE} strokeWidth={1.75} />
      <path d="M19 4 V20" stroke={ORANGE} strokeWidth={1.75} strokeDasharray="2.5 2" strokeLinecap="butt" />
      <path d="M15.5 8.5 H8.75 M10.75 6.5 L8.75 8.5 L10.75 10.5" {...SMALL} />
      <path d="M8.5 15.5 H15.25 M13.25 13.5 L15.25 15.5 L13.25 17.5" {...SMALL} />
    </>
  ),
  dimension: (
    <>
      <path d="M4 20 H20" stroke={ORANGE} strokeWidth={1.75} />
      <path d="M4 17.5 V5 M20 17.5 V5" {...THIN} />
      <path d="M7 10 H17" {...SMALL} />
      <path d="M4.25 10 L7.75 8 V12 Z M19.75 10 L16.25 8 V12 Z" fill="currentColor" {...THIN} />
    </>
  ),
  // Letter in its (dashed) text box.
  sketchText: (
    <>
      <rect x={3.5} y={3.5} width={17} height={17} {...THIN} {...DASH} />
      <path d="M7.5 17.5 L12 6.5 L16.5 17.5 M9.25 13.5 H14.75" stroke={ORANGE} strokeWidth={2} />
      {pt(3.5, 20.5)}
      {pt(20.5, 3.5)}
    </>
  ),
  // 2x2 grid: the seed (dark) and its copies.
  sketchLinearPattern: (
    <>
      {[
        [3.5, 3.5],
        [13.5, 3.5],
        [3.5, 13.5],
        [13.5, 13.5],
      ].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={7} height={7} rx={0.5} fill={WHITE} stroke={i === 0 ? 'currentColor' : ORANGE} />
      ))}
    </>
  ),
  sketchCircularPattern: (
    <>
      <circle cx={12} cy={12} r={7} {...THIN} {...DASH} />
      {ring(12, 12, 7, 6, -90).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.1} fill={WHITE} stroke={i === 0 ? 'currentColor' : ORANGE} />
      ))}
      {dot(12, 12, 'currentColor', 1.2)}
    </>
  ),
  // Square moved (straight arrow) and rotated (curved arrow).
  sketchTransform: (
    <>
      <rect x={3} y={13.5} width={7} height={7} />
      <path d="M12.5 17 H20.5 M18.25 14.75 L20.5 17 L18.25 19.25" {...SMALL} />
      <polygon points="16.75,2.5 21.25,7 16.75,11.5 12.25,7" stroke={ORANGE} strokeWidth={1.75} />
      <path d="M4.5 10.5 A6 6 0 0 1 10.5 4.5 M8.75 2.75 L10.5 4.5 L8.75 6.25" {...SMALL} />
    </>
  ),
  finishSketch: (
    <>
      <rect x={3} y={3} width={18} height={18} rx={2.5} />
      <path d="M7 12.5 L10.5 16 L17.5 8" stroke={GREEN} strokeWidth={2.5} />
    </>
  ),

  // ----- Constraints ------------------------------------------------------
  coincident: (
    <>
      <path d="M3 18.5 L12 11 L21 16" />
      {dot(12, 11, ORANGE, 2.6)}
    </>
  ),
  concentric: (
    <>
      <circle cx={12} cy={12} r={8.5} />
      <circle cx={12} cy={12} r={4.5} stroke={ORANGE} strokeWidth={1.75} />
      {dot(12, 12, 'currentColor', 1.4)}
    </>
  ),
  parallel: (
    <>
      <path d="M3.5 17 L11.5 4" />
      <path d="M12.5 20 L20.5 7" stroke={ORANGE} strokeWidth={1.75} />
    </>
  ),
  tangent: (
    <>
      <circle cx={12} cy={14.5} r={6} />
      <path d="M3 8.5 H21" stroke={ORANGE} strokeWidth={1.75} />
      {dot(12, 8.5, 'currentColor', 1.8)}
    </>
  ),
  horizontal: horizontalGlyph,
  vertical: <g transform="rotate(90 12 12)">{horizontalGlyph}</g>,
  perpendicular: (
    <>
      <path d="M3.5 19.5 H20.5" />
      <path d="M12 4 V19.5" stroke={ORANGE} strokeWidth={1.75} />
      <path d="M12 15 H16.5 V19.5" {...THIN} />
    </>
  ),
  equal: (
    <>
      <path d="M4 8.5 H20 M4 15.5 H20" stroke={ORANGE} strokeWidth={1.75} />
      <path d="M10.5 6 L11.5 11 M12.5 6 L13.5 11 M10.5 13 L11.5 18 M12.5 13 L13.5 18" {...SMALL} />
    </>
  ),
  midpoint: (
    <>
      <path d="M3 18 L21 6" />
      {pt(3, 18)}
      {pt(21, 6)}
      {dot(12, 12, ORANGE, 2.6)}
    </>
  ),
  // Shape and its mirror image about a dashed axis.
  symmetric: (
    <>
      <path d="M12 2.5 V21.5" {...THIN} {...DASH} />
      <path d="M9.5 5 H4 L8 12 L4 19 H9.5" />
      <path d="M14.5 5 H20 L16 12 L20 19 H14.5" stroke={ORANGE} strokeWidth={1.75} />
    </>
  ),
  // Entity fixed to the ground.
  fix: (
    <>
      <path d="M3 9.5 H21" stroke={ORANGE} strokeWidth={2.5} />
      <path d="M7 11.75 L4 15.75 M11 11.75 L8 15.75 M15 11.75 L12 15.75 M19 11.75 L16 15.75" />
    </>
  ),
  normal: (
    <>
      <path d="M3 16 A12 12 0 0 1 21 16" />
      <path d="M12 3 V20" stroke={ORANGE} strokeWidth={1.75} />
      <path d="M12 9.4 H14.6 V12.2" {...THIN} />
    </>
  ),
  pierce: (
    <>
      <polygon points="2,19 6.5,12 22,12 17.5,19" fill={GREY_TOP} />
      <path d="M12 15.5 L11.5 21.5" stroke={ORANGE} {...THIN} {...DASH} />
      <path d="M15.5 3 C14.5 8 12 11 12 15.5" stroke={ORANGE} strokeWidth={1.75} />
      {dot(12, 15.5, 'currentColor', 2)}
    </>
  ),

  // ----- Feature list / parts / UI ----------------------------------------
  origin: (
    <>
      <path d="M12 13 V3" stroke={BLUE} strokeWidth={1.75} />
      <path d="M12 13 L20.5 18" stroke={RED} strokeWidth={1.75} />
      <path d="M12 13 L3.5 18" stroke={GREEN} strokeWidth={1.75} />
      <circle cx={12} cy={13} r={2} fill={WHITE} />
    </>
  ),
  planeItem: (
    <>
      <polygon points={PLANE_OUTLINE} fill={BLUE_LIGHT} />
      <path d="M12.5 4.32 V11.5 L21 12.68" {...THIN} />
    </>
  ),
  // Square and circle: a sketch.
  sketchItem: (
    <>
      <rect x={3} y={3} width={12} height={12} fill={ORANGE_FILL} stroke={ORANGE} />
      <circle cx={14.5} cy={14.5} r={6.5} stroke={ORANGE} />
    </>
  ),
  // L-shaped block: a part.
  partItem: (
    <>
      <polygon points="13.25,3 20.75,6.75 16.38,8.94 8.88,5.19" fill={BLUE_LIGHT} />
      <polygon points="8.88,10.19 16.38,13.94 16.38,8.94 8.88,5.19" fill={BLUE_FILL} />
      <polygon points="8.88,10.19 16.38,13.94 10.75,16.75 3.25,13" fill={BLUE_LIGHT} />
      <polygon points="3.25,17 10.75,20.75 10.75,16.75 3.25,13" fill={BLUE_FILL} />
      <polygon points="20.75,15.75 10.75,20.75 10.75,16.75 16.38,13.94 16.38,8.94 20.75,6.75" fill={BLUE_MID} />
    </>
  ),
  parts: (
    <>
      {box(15.5, 2, 5.5, 6, GREY_SHADE)}
      {box(8.5, 8.5, 5.5, 6)}
    </>
  ),
  eye: (
    <>
      <path d={EYE_OUTLINE} />
      <circle cx={12} cy={12} r={3} />
    </>
  ),
  eyeOff: (
    <>
      <path d={EYE_OUTLINE} />
      <circle cx={12} cy={12} r={3} />
      <path d="M4 3.5 L20 20.5" />
    </>
  ),
  chevronDown: <path d="M6 9 L12 15 L18 9" />,
  chevronRight: <path d="M9 6 L15 12 L9 18" />,
  chevronLeft: <path d="M15 6 L9 12 L15 18" />,
  chevronUp: <path d="M6 15 L12 9 L18 15" />,
  check: <path d="M5 12.5 L10 17.5 L19.5 7" stroke={GREEN} strokeWidth={2.25} />,
  close: <path d="M6 6 L18 18 M18 6 L6 18" stroke={RED} strokeWidth={2} />,
  flip: <path d="M4 7.5 H19.5 M16.5 4.5 L19.5 7.5 L16.5 10.5 M20 16.5 H4.5 M7.5 13.5 L4.5 16.5 L7.5 19.5" />,
  gear: (
    <>
      <path d={GEAR} />
      <circle cx={12} cy={12} r={2.8} />
    </>
  ),
  help: (
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M9.5 9.5 A2.5 2.5 0 1 1 13.2 11.7 C12.5 12.1 12 12.6 12 13.5 V14" />
      {dot(12, 17, 'currentColor', 1)}
    </>
  ),
  search: (
    <>
      <circle cx={10.5} cy={10.5} r={6.5} />
      <path d="M15.5 15.5 L20.5 20.5" strokeWidth={2} />
    </>
  ),
  plus: <path d="M12 5 V19 M5 12 H19" />,
  minus: <path d="M5 12 H19" />,
  trash: (
    <>
      <path d="M4 6.5 H20 M9.5 6.5 V4.5 A1 1 0 0 1 10.5 3.5 H13.5 A1 1 0 0 1 14.5 4.5 V6.5" />
      <path d="M6 6.5 L7 19.5 A1.5 1.5 0 0 0 8.5 21 H15.5 A1.5 1.5 0 0 0 17 19.5 L18 6.5" />
      <path d="M10 10.5 V17 M14 10.5 V17" {...THIN} />
    </>
  ),
  folder: (
    <>
      <path
        d="M3 7 A1.5 1.5 0 0 1 4.5 5.5 H9 L11 7.5 H19.5 A1.5 1.5 0 0 1 21 9 V17.5 A1.5 1.5 0 0 1 19.5 19 H4.5 A1.5 1.5 0 0 1 3 17.5 Z"
        fill={ORANGE_FILL}
      />
      <path d="M3 10 H21" {...THIN} />
    </>
  ),
  document: (
    <>
      <path d={DOC_OUTLINE} fill={WHITE} />
      <path d="M14 3 V7.5 H18.5" />
      <path d="M8.5 11.5 H15.5 M8.5 14.5 H15.5 M8.5 17.5 H13" {...THIN} />
    </>
  ),
  partStudio: (
    <>
      {box(12, 3, 8, 9)}
      <ellipse cx={12} cy={7} rx={4.2} ry={2.1} stroke={ORANGE} />
    </>
  ),
  drawing: (
    <>
      <rect x={2.5} y={4} width={19} height={16} rx={1} fill={WHITE} />
      <path d="M13.5 20 V16 H21.5 M13.5 18 H21.5" {...THIN} />
      <rect x={5} y={7} width={6} height={6.5} fill={BLUE_LIGHT} stroke={BLUE} {...SMALL} />
      <circle cx={8} cy={10.25} r={1.4} stroke={BLUE} {...THIN} />
      <rect x={13.5} y={7} width={4} height={6.5} fill={BLUE_LIGHT} stroke={BLUE} {...SMALL} />
    </>
  ),
  assembly: (
    <>
      {box(12, 9, 8, 4, GREY_SHADE)}
      {box(12, 6, 4, 5)}
    </>
  ),
  cube: box(12, 3, 8, 9.5, GREY_SHADE),
  home: (
    <>
      <path d="M3 11.5 L12 3.5 L21 11.5" />
      <path d="M5.5 9.5 V20.5 H18.5 V9.5" />
      <path d="M10 20.5 V14.5 H14 V20.5" />
    </>
  ),
  zoomFit: (
    <>
      <path d="M3 8 V3 H8 M16 3 H21 V8 M21 16 V21 H16 M8 21 H3 V16" />
      {box(12, 7.5, 4.5, 4.5, BLUE_SHADE, SMALL)}
    </>
  ),
  viewNormal: (
    <>
      <rect x={4} y={4} width={16} height={16} rx={1} fill={BLUE_FILL} stroke={BLUE} />
      <circle cx={12} cy={12} r={4} fill={WHITE} />
      {dot(12, 12, 'currentColor', 1.4)}
    </>
  ),
  menu: <path d="M4 6.5 H20 M4 12 H20 M4 17.5 H20" />,
  more: (
    <>
      {dot(5, 12, 'currentColor', 1.7)}
      {dot(12, 12, 'currentColor', 1.7)}
      {dot(19, 12, 'currentColor', 1.7)}
    </>
  ),
  rename: (
    <>
      <path d="M15 7 H4.5 A1.5 1.5 0 0 0 3 8.5 V15.5 A1.5 1.5 0 0 0 4.5 17 H15" />
      <path d="M19 4.5 V19.5 M16.5 4.5 H21.5 M16.5 19.5 H21.5" />
      <path d="M6.5 12 H12" stroke={BLUE} strokeWidth={1.75} />
    </>
  ),
  suppress: (
    <>
      {box(12, 3, 8, 9, GREY_SHADE, GHOST)}
      <path d="M3.5 20.5 L20.5 3.5" strokeWidth={1.75} />
    </>
  ),
  unsuppress: (
    <>
      {box(10.5, 2.5, 7.5, 8.5)}
      {badge('check')}
    </>
  ),
  rollback: (
    <>
      <path d="M3 5 H14 M3 9 H14" />
      <path d="M2.5 13 H16" stroke={BLUE} strokeWidth={2.5} />
      <path d="M3 17 H14 M3 21 H14" {...THIN} {...DASH} />
      <path d="M19.5 20 V5 M17 7.5 L19.5 5 L22 7.5" />
    </>
  ),
  warning: (
    <>
      <path
        d="M10.7 4.2 A1.5 1.5 0 0 1 13.3 4.2 L21.3 18.2 A1.5 1.5 0 0 1 20 20.5 H4 A1.5 1.5 0 0 1 2.7 18.2 Z"
        fill={ORANGE_FILL}
        stroke={ORANGE}
      />
      <path d="M12 9 V13.5" strokeWidth={1.75} />
      {dot(12, 16.75, 'currentColor', 1)}
    </>
  ),
  error: (
    <>
      <circle cx={12} cy={12} r={9} fill={RED_FILL} stroke={RED} />
      <path d="M12 7 V13" stroke={RED} strokeWidth={2} />
      {dot(12, 16.5, RED, 1.15)}
    </>
  ),
  info: (
    <>
      <circle cx={12} cy={12} r={9} fill={BLUE_LIGHT} stroke={BLUE} />
      <path d="M12 11 V17" stroke={BLUE} strokeWidth={2} />
      {dot(12, 7.5, BLUE, 1.15)}
    </>
  ),
  upload: (
    <>
      <path d="M4 15 V19 A1.5 1.5 0 0 0 5.5 20.5 H18.5 A1.5 1.5 0 0 0 20 19 V15" />
      <path d="M12 15.5 V3.5 M7.5 8 L12 3.5 L16.5 8" stroke={BLUE} strokeWidth={1.75} />
    </>
  ),
  download: (
    <>
      <path d="M4 15 V19 A1.5 1.5 0 0 0 5.5 20.5 H18.5 A1.5 1.5 0 0 0 20 19 V15" />
      <path d="M12 3.5 V15.5 M7.5 11 L12 15.5 L16.5 11" stroke={BLUE} strokeWidth={1.75} />
    </>
  ),
  copy: (
    <>
      <path d="M16 8 V5.5 A1.5 1.5 0 0 0 14.5 4 H5.5 A1.5 1.5 0 0 0 4 5.5 V14.5 A1.5 1.5 0 0 0 5.5 16 H8" />
      <rect x={8} y={8} width={12} height={12} rx={1.5} fill={WHITE} />
    </>
  ),
  /** Versions and history: a clock with the arrow turning back. */
  history: (
    <>
      <path d="M4.6 9.2 A8 8 0 1 1 4 12" />
      <path d="M2.2 7.4 L4.6 9.6 L7 7.2" />
      <path d="M12 7.5 V12 L15 14" stroke={BLUE} strokeWidth={1.75} />
    </>
  ),
  lock: (
    <>
      <path d="M8 10.5 V7.5 A4 4 0 0 1 16 7.5 V10.5" />
      <rect x={5} y={10.5} width={14} height={10} rx={1.75} fill={GREY_TOP} />
      <path d="M12 14.5 V17" strokeWidth={1.75} />
    </>
  ),
  palette: (
    <>
      <path
        d="M12 3 C7 3 3 7 3 12 C3 17 7 21 12 21 C13.4 21 14 20.2 14 19.3 C14 18.5 13.3 18 13.3 17.2 C13.3 16.3 14 15.5 15 15.5 H17 C19.5 15.5 21 13.6 21 11.2 C21 6.6 17 3 12 3 Z"
        fill={WHITE}
      />
      {dot(7.5, 12, BLUE, 1.5)}
      {dot(9.5, 7.5, GREEN, 1.5)}
      {dot(14.5, 7.5, ORANGE, 1.5)}
      {dot(17.5, 11, RED, 1.5)}
    </>
  ),
  drawingView: (
    <>
      <rect x={2.5} y={3.5} width={19} height={17} rx={1} {...THIN} {...DASH} />
      <path d="M6.5 17 V8 H12.5 V12 H17.5 V17 Z" fill={BLUE_LIGHT} stroke={BLUE} />
      <circle cx={9.5} cy={12.5} r={1.5} stroke={BLUE} {...THIN} />
    </>
  ),
  projectedView: (
    <>
      <rect x={2} y={7} width={8.5} height={10} rx={0.75} />
      <rect x={13.5} y={7} width={8.5} height={10} rx={0.75} />
      <path d="M8.5 10 H16 M8.5 14 H16" {...THIN} strokeDasharray="1.25 1.25" strokeLinecap="butt" />
      <rect x={4} y={10} width={4.5} height={4} fill={BLUE_LIGHT} stroke={BLUE} {...SMALL} />
      <rect x={16} y={10} width={3.5} height={4} fill={BLUE_LIGHT} stroke={BLUE} {...SMALL} />
    </>
  ),
  note: (
    <>
      <path d="M4 4 H20 V15 L15 20 H4 Z" fill={WHITE} />
      <path d="M20 15 H15 V20" {...THIN} />
      <path d="M7 8.5 H17 M7 12 H17 M7 15.5 H11.5" {...THIN} />
    </>
  ),
  pdf: (
    <>
      <path d={DOC_OUTLINE} fill={WHITE} />
      <path d="M14 3 V7.5 H18.5" />
      <rect x={3} y={12} width={15} height={7} rx={1} fill={RED} stroke="none" />
      <text
        x={10.5}
        y={17.6}
        textAnchor="middle"
        fontSize={5.6}
        fontWeight={700}
        fontFamily="Arial, Helvetica, sans-serif"
        fill={WHITE}
        stroke="none"
      >
        PDF
      </text>
    </>
  ),
  grid: (
    <>
      <rect x={3} y={3} width={18} height={18} rx={1.5} />
      <path d="M9 3 V21 M15 3 V21 M3 9 H21 M3 15 H21" {...THIN} />
    </>
  ),
  filter: <path d="M3.5 4.5 H20.5 L14 12 V19 L10 21 V12 Z" />,
  star: (
    <polygon points="12,3.1 14.23,9.53 21.03,9.66 15.61,13.77 17.58,20.29 12,16.4 6.42,20.29 8.39,13.77 2.97,9.66 9.77,9.53" />
  ),
  play: <path d="M8 5.5 V18.5 L18.5 12 Z" fill={BLUE_LIGHT} />,
  bom: (
    <>
      <rect x={4} y={4} width={16} height={16} rx={1.5} fill={WHITE} />
      <path d="M4 9 H20 M4 14 H20 M9 4 V20" />
    </>
  ),
  explode: (
    <>
      <rect x={9} y={9} width={6} height={6} rx={1} fill={BLUE_LIGHT} />
      <rect x={3} y={3} width={4.5} height={4.5} rx={1} fill={GREY_TOP} />
      <rect x={16.5} y={16.5} width={4.5} height={4.5} rx={1} fill={GREY_TOP} />
      <path d="M8.2 8.2 L9.5 9.5 M15.8 15.8 L14.5 14.5" strokeDasharray="1.2 1.2" />
    </>
  ),
  pause: (
    <>
      <rect x={6.5} y={5.5} width={4} height={13} rx={1} fill={GREY_TOP} />
      <rect x={13.5} y={5.5} width={4} height={13} rx={1} fill={GREY_TOP} />
    </>
  ),
  animate: (
    <>
      <path d="M12 4 A8 8 0 1 1 4.6 9" />
      <path d="M4 4.5 V9.5 H9" />
      <path d="M10 9 V15 L15 12 Z" fill={BLUE_LIGHT} />
    </>
  ),
  group: (
    <>
      <rect x={3} y={3} width={18} height={18} rx={2.5} strokeDasharray="2.6 2.2" />
      <rect x={6.5} y={6.5} width={7} height={7} rx={1} fill={BLUE_LIGHT} />
      <rect x={10.5} y={10.5} width={7} height={7} rx={1} fill={GREY_TOP} />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5 L21 8 L12 12.5 L3 8 Z" fill={BLUE_LIGHT} />
      <path d="M3 12 L12 16.5 L21 12 M3 16 L12 20.5 L21 16" />
    </>
  ),
  select: (
    <path d="M5.5 3 V18.5 L9.5 14.8 L12.3 21 L14.9 19.8 L12.2 13.7 L17.8 13.4 Z" fill={WHITE} />
  ),
  isoView: (
    <>
      {box(12, 3, 8, 9, BLUE_SHADE, { stroke: BLUE })}
      {dot(12, 11, BLUE, 1.6)}
    </>
  ),
  frontView: viewCube(CUBE_FRONT),
  topView: viewCube(CUBE_TOP),
  rightView: viewCube(CUBE_RIGHT),
  perspective: (
    <>
      <polygon points="3,9 11,4 20.5,4 15.5,9" fill={GREY_TOP} />
      <polygon points="15.5,9 20.5,4 20.5,13 15.5,21" fill={GREY_RIGHT} />
      <rect x={3} y={9} width={12.5} height={12} fill={GREY_LEFT} />
      <path d="M11 4 V13 H20.5 M11 13 L3 21" {...THIN} strokeDasharray="1.25 1.25" strokeLinecap="butt" />
    </>
  ),
  edit: (
    <g transform="translate(5.5 18.5) rotate(-45)">
      <path d="M0 0 L4 -2.5 H19 V2.5 H4 Z" fill={WHITE} />
      <path d="M4 -2.5 V2.5 M15.5 -2.5 V2.5" {...THIN} />
      <path d="M0 0 L1.6 -1 V1 Z" fill="currentColor" {...THIN} />
    </g>
  ),
  rotateLeft: <g transform={MIRROR_X}>{rotateRightGlyph}</g>,
  rotateRight: rotateRightGlyph,
} satisfies Record<string, ReactNode>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  /** Rendered width/height in px (default 20). */
  size?: number;
  className?: string;
  /** Accessible label. When omitted the icon is aria-hidden. */
  title?: string;
}

export function Icon({ name, size = 20, className, title }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      data-icon={name}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {ICONS[name]}
    </svg>
  );
}
