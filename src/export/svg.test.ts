import { describe, expect, it } from 'vitest';
import type { Prim2D } from './prim2d';
import { writeSVG } from './svg';

/** Very small XML well-formedness check: balanced tags, quoted attributes, no stray '<' / '&'. */
function checkWellFormed(xml: string): string[] {
  const stack: string[] = [];
  const tags: string[] = [];
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(body))) {
    if (m[0] === '<' || m[0].startsWith('&')) throw new Error(`stray '${m[0]}' at ${m.index}: ${body.slice(m.index, m.index + 40)}`);
    const text = body.slice(last, m.index);
    if (/[<>]/.test(text)) throw new Error(`unparsed markup near ${m.index}`);
    last = m.index + m[0].length;
    const [, close, name, , selfClose] = m;
    if (close) {
      const open = stack.pop();
      if (open !== name) throw new Error(`mismatched </${name}> (open: ${open})`);
    } else {
      tags.push(name);
      if (!selfClose) stack.push(name);
    }
  }
  if (stack.length) throw new Error(`unclosed tags: ${stack.join(',')}`);
  if (body.slice(last).trim()) throw new Error('trailing content');
  return tags;
}

const prims: Prim2D[] = [
  { t: 'line', a: [0, 0], b: [100, 0] },
  { t: 'line', a: [0, 0], b: [0, 50] },
  { t: 'line', a: [0, 50], b: [100, 50], style: 'hidden' },
  { t: 'arc', c: [50, 25], r: 10, a0: 0, a1: Math.PI * 1.5 },
  { t: 'arc', c: [50, 25], r: 10, a0: 0, a1: Math.PI / 2 },
  { t: 'circle', c: [20, 20], r: 3, style: 'center' },
  { t: 'ellipse', c: [70, 20], rx: 10, ry: 4, rot: Math.PI / 6 },
  { t: 'poly', pts: [[0, 0], [10, 0], [10, 10]], closed: true, style: 'construction' },
  { t: 'text', p: [5, 5], text: 'A < B & "C" Привет', h: 5, align: 'right', vAlign: 'top', angle: Math.PI / 2 },
  { t: 'arrow', tip: [100, 0], dir: [1, 0], size: 3, style: 'dimension' },
  { t: 'fill', pts: [[0, 0], [5, 0], [5, 5]], color: '#dddddd', layer: 'title block' },
];

describe('writeSVG', () => {
  const svg = writeSVG(prims, { background: '#fff' });

  it('is well-formed XML', () => {
    const tags = checkWellFormed(svg);
    expect(tags[0]).toBe('svg');
    expect(tags.filter((t) => t === 'line').length).toBe(3);
    expect(tags.filter((t) => t === 'path').length).toBe(2);
    expect(tags.filter((t) => t === 'text').length).toBe(1);
    expect(tags.filter((t) => t === 'polygon').length).toBe(3);
  });

  it('uses mm sizes, a flipped viewBox and Y-flip group', () => {
    const vb = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);
    // Content spans x [0,100], y [0,50] (+ text/arrow overhang), margin 5 by default.
    expect(vb[0]).toBeLessThanOrEqual(-5);
    expect(vb[1]).toBeLessThanOrEqual(-55); // top edge = -(maxY + margin)
    expect(svg).toMatch(/width="[\d.]+mm" height="[\d.]+mm"/);
    expect(svg).toContain('<g transform="scale(1,-1)"');
  });

  it('applies stroke styles and arc flags', () => {
    expect(svg).toContain('stroke-width="0.5"');
    expect(svg).toContain('stroke-dasharray="3 1.5"');
    expect(svg).toContain('stroke-dasharray="8 2 1.5 2"');
    expect(svg).toContain('stroke="#808080"');
    expect(svg).toContain('M60 25A10 10 0 1 1 50 15'); // 270° CCW arc ends at (50, 15)
    expect(svg).toContain('A10 10 0 0 1 50 35');
    expect(svg).toContain('rotate(30 70 20)');
  });

  it('keeps text upright and escaped', () => {
    expect(svg).toContain('transform="translate(5 5) scale(1 -1) rotate(-90)"');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('font-family="Helvetica, Arial, sans-serif"');
    expect(svg).toContain('A &lt; B &amp; &quot;C&quot; Привет');
  });

  it('supports explicit page size and stroke scale', () => {
    const page = writeSVG([{ t: 'line', a: [0, 0], b: [10, 10], style: 'border' }], {
      width: 297,
      height: 210,
      strokeScale: 2,
    });
    expect(page).toContain('width="297mm" height="210mm" viewBox="0 -210 297 210"');
    expect(page).toContain('stroke-width="1.4"');
    checkWellFormed(page);
  });

  it('handles empty input', () => {
    const empty = writeSVG([]);
    checkWellFormed(empty);
    expect(empty).toContain('viewBox="-5 -5 10 10"');
  });
});
