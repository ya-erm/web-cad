// Small Markdown parser for the help pages. It produces a plain AST (no HTML strings), which
// render.tsx turns into React elements, so page text can never inject markup.
//
// Supported: ATX headings (with optional explicit id: `## Title {#id}`), paragraphs, **bold**,
// *italic* / _italic_, `code`, [links](target), ![images](src), bullet and numbered lists
// (nested by indentation), GFM pipe tables, fenced code blocks, block quotes and callouts
// (`> **Note.** …`, `> **Совет.** …` or GitHub style `> [!TIP]`), horizontal rules.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'image'; src: string; alt: string; title?: string }
  | { t: 'br' };

export type Align = 'left' | 'center' | 'right' | null;

export type CalloutKind = 'note' | 'tip' | 'warning';

/** Numbered marker drawn over a figure image; x / y are percentages of the image size. */
export interface FigureMarker {
  label: string;
  x: number;
  y: number;
  title: string;
}

export type Block =
  | { t: 'heading'; level: number; id: string; c: Inline[] }
  | { t: 'paragraph'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; kind: CalloutKind | null; c: Block[] }
  | { t: 'figure'; src: string; alt: string; caption: Inline[] | null; width: number | null; markers: FigureMarker[] }
  | { t: 'hr' };

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

const ESCAPABLE = '\\`*_{}[]()#+-.!|>~<';

/** Index of the `]` matching the `[` at `open` (nested brackets allowed), or -1. */
function closingBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > 0) i = end;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parse `(target "title")` right after a link / image label. */
function linkTarget(s: string, at: number): { href: string; title?: string; end: number } | null {
  if (s[at] !== '(') return null;
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) {
        const inner = s.slice(at + 1, i).trim();
        const m = /^(\S+?)(?:\s+"([^"]*)")?$/.exec(inner);
        if (!m) return null;
        return { href: m[1], title: m[2], end: i + 1 };
      }
    }
  }
  return null;
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** Find the closing emphasis delimiter for `delim` starting the search at `from`. */
function closingDelim(s: string, delim: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > 0) i = end;
      continue;
    }
    if (ch === '[') {
      // skip whole links so `*` inside link targets does not close emphasis
      const close = closingBracket(s, i);
      if (close > 0) {
        const tgt = linkTarget(s, close + 1);
        i = tgt ? tgt.end - 1 : close;
      }
      continue;
    }
    if (!s.startsWith(delim, i)) continue;
    if (s[i - 1] === ' ' || s[i - 1] === '\t') continue; // closing delimiter cannot follow a space
    // "**a *b***": the first star of a triple run closes the inner emphasis
    if (delim.length === 2 && s[i + 2] === delim[0]) return i + 1;
    if (delim.length === 1 && s[i + 1] === delim) {
      i++; // part of a double delimiter: skip both
      continue;
    }
    if (delim[0] === '_' && isWordChar(s[i + delim.length])) continue;
    return i;
  }
  return -1;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // escapes
    if (ch === '\\' && i + 1 < src.length) {
      if (src[i + 1] === '\n') {
        flush();
        out.push({ t: 'br' });
        i += 2;
        continue;
      }
      if (ESCAPABLE.includes(src[i + 1])) {
        text += src[i + 1];
        i += 2;
        continue;
      }
    }
    // hard line break: two trailing spaces
    if (ch === '\n') {
      if (text.endsWith('  ')) {
        text = text.replace(/ +$/, '');
        flush();
        out.push({ t: 'br' });
      } else text = text.replace(/ +$/, '') + ' ';
      i++;
      while (src[i] === ' ') i++;
      continue;
    }
    // code span
    if (ch === '`') {
      let n = 1;
      while (src[i + n] === '`') n++;
      const fence = '`'.repeat(n);
      const end = src.indexOf(fence, i + n);
      if (end > 0) {
        flush();
        let v = src.slice(i + n, end).replace(/\n/g, ' ');
        if (v.startsWith(' ') && v.endsWith(' ') && v.trim()) v = v.slice(1, -1);
        out.push({ t: 'code', v });
        i = end + n;
        continue;
      }
      text += fence;
      i += n;
      continue;
    }
    // image
    if (ch === '!' && src[i + 1] === '[') {
      const close = closingBracket(src, i + 1);
      const tgt = close > 0 ? linkTarget(src, close + 1) : null;
      if (tgt) {
        flush();
        out.push({ t: 'image', src: tgt.href, alt: src.slice(i + 2, close), ...(tgt.title ? { title: tgt.title } : {}) });
        i = tgt.end;
        continue;
      }
    }
    // link
    if (ch === '[') {
      const close = closingBracket(src, i);
      const tgt = close > 0 ? linkTarget(src, close + 1) : null;
      if (tgt) {
        flush();
        out.push({ t: 'link', href: tgt.href, c: parseInline(src.slice(i + 1, close)) });
        i = tgt.end;
        continue;
      }
    }
    // emphasis
    if (ch === '*' || ch === '_') {
      const dbl = src[i + 1] === ch;
      const delim = dbl ? ch + ch : ch;
      const next = src[i + delim.length];
      const opens = next !== undefined && next !== ' ' && next !== '\t' && next !== '\n' && !(ch === '_' && isWordChar(src[i - 1]));
      if (opens) {
        const end = closingDelim(src, delim, i + delim.length);
        if (end > i + delim.length) {
          flush();
          const inner = parseInline(src.slice(i + delim.length, end));
          out.push(dbl ? { t: 'strong', c: inner } : { t: 'em', c: inner });
          i = end + delim.length;
          continue;
        }
      }
      text += delim;
      i += delim.length;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

/** Plain text of inline content (search index, heading slugs, alt text). */
export function inlineText(c: Inline[]): string {
  return c
    .map((x) => {
      switch (x.t) {
        case 'text':
        case 'code':
          return x.v;
        case 'strong':
        case 'em':
        case 'link':
          return inlineText(x.c);
        case 'image':
          return x.alt;
        case 'br':
          return ' ';
      }
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const RE_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*$/;
const RE_HR = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const RE_QUOTE = /^ {0,3}>/;
const RE_LIST = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (l: string) => /^ */.exec(l)![0].length;
const isBlank = (l: string) => !l.trim();

/** Slug for heading anchors: letters (any script) and digits joined by dashes. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return (
    RE_FENCE.test(l) ||
    RE_HEADING.test(l) ||
    RE_HR.test(l) ||
    RE_QUOTE.test(l) ||
    RE_LIST.test(l) ||
    (l.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-'))
  );
}

const CALLOUT_WORDS: Record<string, CalloutKind> = {
  note: 'note',
  info: 'note',
  примечание: 'note',
  замечание: 'note',
  tip: 'tip',
  hint: 'tip',
  совет: 'tip',
  подсказка: 'tip',
  warning: 'warning',
  caution: 'warning',
  important: 'warning',
  limitation: 'warning',
  внимание: 'warning',
  важно: 'warning',
  ограничение: 'warning',
  ограничения: 'warning',
};

/** Detect a callout: first paragraph starts with `[!KIND]` or a bold keyword ("Note.", "Совет:"). */
function calloutKind(blocks: Block[]): CalloutKind | null {
  const first = blocks[0];
  if (!first || first.t !== 'paragraph') return null;
  const head = first.c[0];
  if (head?.t === 'text') {
    const m = /^\s*\[!(\w+)\]\s*/.exec(head.v);
    const kind = m && CALLOUT_WORDS[m[1].toLowerCase()];
    if (m && kind) {
      head.v = head.v.slice(m[0].length);
      if (!head.v) first.c.shift();
      if (first.c[0]?.t === 'br') first.c.shift();
      if (!first.c.length) blocks.shift();
      return kind;
    }
  }
  if (head?.t === 'strong') {
    const word = inlineText(head.c)
      .trim()
      .replace(/[.:!]+$/, '')
      .toLowerCase();
    return CALLOUT_WORDS[word] ?? null;
  }
  return null;
}

/**
 * Screenshot with numbered markers (the same picture serves every language):
 *
 *     ```figure
 *     image: ../images/interface.jpg
 *     alt: Part Studio window
 *     caption: Optional caption with *markdown*
 *     width: 640
 *     1 12% 4% Top bar
 *     2 40.5% 10% Toolbar
 *     ```
 *
 * Marker lines: label, x %, y % (from the top-left corner of the image), optional tooltip.
 */
export function parseFigure(body: string[]): Extract<Block, { t: 'figure' }> {
  const fig: Extract<Block, { t: 'figure' }> = { t: 'figure', src: '', alt: '', caption: null, width: null, markers: [] };
  for (const raw of body) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const kv = /^(image|src|alt|caption|width):\s*(.*)$/i.exec(line);
    if (kv) {
      const key = kv[1].toLowerCase();
      const v = kv[2].trim();
      if (key === 'image' || key === 'src') fig.src = v;
      else if (key === 'alt') fig.alt = v;
      else if (key === 'caption') fig.caption = parseInline(v);
      else if (key === 'width') fig.width = Number.parseFloat(v) || null;
      continue;
    }
    const m = /^(\S{1,3})\s+(-?[\d.]+)%?\s+(-?[\d.]+)%?\s*(.*)$/.exec(line);
    if (m) fig.markers.push({ label: m[1], x: Number(m[2]), y: Number(m[3]), title: m[4] });
  }
  return fig;
}

class BlockParser {
  private ids = new Map<string, number>();

  uniqueId(base: string): string {
    const id = base || 'section';
    const n = this.ids.get(id) ?? 0;
    this.ids.set(id, n + 1);
    return n ? `${id}-${n + 1}` : id;
  }

  parse(lines: string[]): Block[] {
    const out: Block[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        i++;
        continue;
      }
      // fenced code
      const fence = RE_FENCE.exec(line);
      if (fence) {
        const marker = fence[1];
        const body: string[] = [];
        i++;
        while (i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
        i++; // closing fence (or end of text)
        if ((fence[2] ?? '').toLowerCase() === 'figure') out.push(parseFigure(body));
        else out.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') });
        continue;
      }
      // heading
      const h = RE_HEADING.exec(line);
      if (h) {
        let text = h[2].replace(/\s+#+\s*$/, '');
        let explicit: string | null = null;
        const idm = /\s*\{#([\w-]+)\}\s*$/.exec(text);
        if (idm) {
          explicit = idm[1];
          text = text.slice(0, idm.index);
        }
        const c = parseInline(text);
        out.push({ t: 'heading', level: h[1].length, id: this.uniqueId(explicit ?? slugify(inlineText(c))), c });
        i++;
        continue;
      }
      if (RE_HR.test(line)) {
        out.push({ t: 'hr' });
        i++;
        continue;
      }
      // block quote / callout
      if (RE_QUOTE.test(line)) {
        const body: string[] = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) body.push(lines[i++].replace(/^ {0,3}> ?/, ''));
        const inner = this.parse(body);
        const kind = calloutKind(inner);
        out.push({ t: 'quote', kind, c: inner });
        continue;
      }
      // table
      if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        const head = splitRow(line);
        const align: Align[] = splitRow(lines[i + 1]).map((c) => {
          const l = c.startsWith(':');
          const r = c.endsWith(':');
          return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
        });
        i += 2;
        const rows: Inline[][][] = [];
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
          const cells = splitRow(lines[i++]);
          rows.push(head.map((_, k) => parseInline(cells[k] ?? '')));
        }
        out.push({ t: 'table', align: head.map((_, k) => align[k] ?? null), head: head.map((c) => parseInline(c)), rows });
        continue;
      }
      // list
      if (RE_LIST.test(line)) {
        i = this.list(lines, i, out);
        continue;
      }
      // paragraph
      const para: string[] = [line.trim() === line ? line : line.replace(/^ +/, '')];
      i++;
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) para.push(lines[i++].replace(/^ +/, ''));
      out.push({ t: 'paragraph', c: parseInline(para.join('\n')) });
    }
    return out;
  }

  private list(lines: string[], i: number, out: Block[]): number {
    const first = RE_LIST.exec(lines[i])!;
    const base = first[1].length;
    const ordered = /\d/.test(first[2]);
    const items: Block[][] = [];
    while (i < lines.length) {
      if (isBlank(lines[i])) {
        // blank lines between items keep the list going
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        const n = j < lines.length ? RE_LIST.exec(lines[j]) : null;
        if (!n || n[1].length !== base || /\d/.test(n[2]) !== ordered) break;
        i = j;
      }
      const m = RE_LIST.exec(lines[i]);
      if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
      const contentIndent = m[4] ? base + m[2].length + m[3].length : base + m[2].length + 1;
      const body: string[] = [m[4]];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (isBlank(l)) {
          let j = i + 1;
          while (j < lines.length && isBlank(lines[j])) j++;
          if (j < lines.length && indentOf(lines[j]) >= contentIndent) {
            for (; i < j; i++) body.push('');
            continue;
          }
          break;
        }
        const ind = indentOf(l);
        if (ind >= contentIndent) {
          body.push(l.slice(contentIndent));
          i++;
          continue;
        }
        if (RE_LIST.test(l)) {
          if (ind > base) {
            // nested list indented less than the content column
            body.push(l.slice(ind));
            i++;
            continue;
          }
          break;
        }
        if (startsBlock(lines, i)) break;
        body.push(l.trim()); // lazy continuation of the item text
        i++;
      }
      items.push(this.parse(body));
    }
    out.push({ t: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items });
    return i;
  }
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return new BlockParser().parse(lines);
}

/** Plain text of a document (for search). */
export function blocksText(blocks: Block[]): string {
  const parts: string[] = [];
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      switch (b.t) {
        case 'heading':
        case 'paragraph':
          parts.push(inlineText(b.c));
          break;
        case 'list':
          b.items.forEach(walk);
          break;
        case 'table':
          parts.push(b.head.map(inlineText).join(' '));
          for (const r of b.rows) parts.push(r.map(inlineText).join(' '));
          break;
        case 'code':
          parts.push(b.v);
          break;
        case 'quote':
          walk(b.c);
          break;
        case 'figure':
          parts.push([b.alt, b.caption ? inlineText(b.caption) : '', ...b.markers.map((m) => m.title)].filter(Boolean).join(' '));
          break;
        case 'hr':
          break;
      }
    }
  };
  walk(blocks);
  return parts.join('\n');
}

/** The first level-1 heading text (page title as written in the page). */
export function documentTitle(blocks: Block[]): string | null {
  const h = blocks.find((b) => b.t === 'heading' && b.level === 1);
  return h && h.t === 'heading' ? inlineText(h.c) : null;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export type LinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'page'; page: string; anchor: string | null }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'invalid' };

/** Classify a link target. Help pages link to each other by page id: `[Line](sketch-line)`. */
export function classifyLink(href: string): LinkTarget {
  const h = href.trim();
  if (/^(https?:\/\/|mailto:)/i.test(h)) return { kind: 'external', href: h };
  const anchor = /^#([\w-]+)$/.exec(h);
  if (anchor) return { kind: 'anchor', anchor: anchor[1] };
  const page = /^(?:\.\/)?([a-z0-9][\w-]*?)(?:\.md)?(?:#([\w-]+))?$/i.exec(h);
  if (page) return { kind: 'page', page: page[1], anchor: page[2] ?? null };
  return { kind: 'invalid' };
}

/** All link targets used in a document (content checks). */
export function collectLinks(blocks: Block[]): { links: string[]; images: string[] } {
  const links: string[] = [];
  const images: string[] = [];
  const inl = (c: Inline[]) => {
    for (const x of c) {
      if (x.t === 'link') {
        links.push(x.href);
        inl(x.c);
      } else if (x.t === 'image') images.push(x.src);
      else if (x.t === 'strong' || x.t === 'em') inl(x.c);
    }
  };
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === 'heading' || b.t === 'paragraph') inl(b.c);
      else if (b.t === 'list') b.items.forEach(walk);
      else if (b.t === 'quote') walk(b.c);
      else if (b.t === 'table') [b.head, ...b.rows].forEach((r) => r.forEach(inl));
      else if (b.t === 'figure') {
        images.push(b.src);
        if (b.caption) inl(b.caption);
      }
    }
  };
  walk(blocks);
  return { links, images };
}

/** Heading ids of a document (anchor targets). */
export function headingIds(blocks: Block[]): string[] {
  const ids: string[] = [];
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === 'heading') ids.push(b.id);
      else if (b.t === 'quote') walk(b.c);
      else if (b.t === 'list') b.items.forEach(walk);
    }
  };
  walk(blocks);
  return ids;
}
