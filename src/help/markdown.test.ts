import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { blocksText, classifyLink, collectLinks, documentTitle, headingIds, parseInline, parseMarkdown, slugify, type Block } from './markdown';
import { isKeyCombo, renderMarkdown, type RenderOptions } from './render';

const opts: RenderOptions = {
  pageHref: (page, anchor) => (page === 'missing' ? null : `#/help/ru/${page}${anchor ? `#${anchor}` : ''}`),
  anchorHref: (a) => `#/help/ru/current#${a}`,
  imageUrl: (src) => (src === 'images/ok.svg' ? '/assets/ok.svg' : null),
  idPrefix: 'help-',
  imageMissing: 'missing image',
};
const html = (md: string, o: RenderOptions = opts) => renderToStaticMarkup(createElement(Fragment, null, renderMarkdown(parseMarkdown(md), o)));

describe('inline markdown', () => {
  it('parses emphasis, code and links', () => {
    expect(parseInline('a **b** *c* _d_ `e` [f](g)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'e' },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'g', c: [{ t: 'text', v: 'f' }] },
    ]);
  });

  it('nests emphasis inside links and bold', () => {
    expect(parseInline('**bold *it***')).toEqual([{ t: 'strong', c: [{ t: 'text', v: 'bold ' }, { t: 'em', c: [{ t: 'text', v: 'it' }] }] }]);
    expect(parseInline('[**Line**](sketch-line)')).toEqual([{ t: 'link', href: 'sketch-line', c: [{ t: 'strong', c: [{ t: 'text', v: 'Line' }] }] }]);
  });

  it('keeps literal characters that are not markup', () => {
    expect(parseInline('2 * 3 = 6, snake_case_name, #w*2')).toEqual([{ t: 'text', v: '2 * 3 = 6, snake_case_name, #w*2' }]);
    expect(parseInline('\\*not italic\\*')).toEqual([{ t: 'text', v: '*not italic*' }]);
    expect(parseInline('`**raw**`')).toEqual([{ t: 'code', v: '**raw**' }]);
  });

  it('parses images with titles', () => {
    expect(parseInline('![Alt text](images/a.svg "Title")')).toEqual([{ t: 'image', src: 'images/a.svg', alt: 'Alt text', title: 'Title' }]);
  });

  it('joins soft line breaks and keeps hard ones', () => {
    expect(parseInline('a\nb')).toEqual([{ t: 'text', v: 'a b' }]);
    expect(parseInline('a  \nb')).toEqual([{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b' }]);
  });
});

describe('block markdown', () => {
  it('parses headings with slugs and explicit ids', () => {
    const b = parseMarkdown('# Выдавливание\n\n## Параметры {#options}\n\n## Параметры\n');
    expect(b.map((x) => (x.t === 'heading' ? [x.level, x.id] : null))).toEqual([
      [1, 'выдавливание'],
      [2, 'options'],
      [2, 'параметры'],
    ]);
    expect(documentTitle(b)).toBe('Выдавливание');
    expect(headingIds(b)).toEqual(['выдавливание', 'options', 'параметры']);
  });

  it('makes heading ids unique', () => {
    expect(headingIds(parseMarkdown('## A\n## A\n## A'))).toEqual(['a', 'a-2', 'a-3']);
    expect(slugify('Shift + S: эскиз!')).toBe('shift-s-эскиз');
  });

  it('parses paragraphs separated by blank lines', () => {
    const b = parseMarkdown('one\ntwo\n\nthree');
    expect(b).toEqual([
      { t: 'paragraph', c: [{ t: 'text', v: 'one two' }] },
      { t: 'paragraph', c: [{ t: 'text', v: 'three' }] },
    ]);
  });

  it('parses numbered and nested lists', () => {
    const b = parseMarkdown('1. First\n2. Second\n   - nested a\n   - nested b\n3. Third\n   continued');
    expect(b).toHaveLength(1);
    const list = b[0] as Extract<Block, { t: 'list' }>;
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(3);
    expect(list.items[1][1]).toMatchObject({ t: 'list', ordered: false });
    expect((list.items[1][1] as Extract<Block, { t: 'list' }>).items).toHaveLength(2);
    expect(list.items[2]).toEqual([{ t: 'paragraph', c: [{ t: 'text', v: 'Third continued' }] }]);
  });

  it('keeps the start number of ordered lists and handles loose items', () => {
    const b = parseMarkdown('3. a\n\n4. b\n\n   more about b\n\nafter');
    const list = b[0] as Extract<Block, { t: 'list' }>;
    expect(list.start).toBe(3);
    expect(list.items).toHaveLength(2);
    expect(list.items[1]).toHaveLength(2);
    expect(b[1]).toEqual({ t: 'paragraph', c: [{ t: 'text', v: 'after' }] });
  });

  it('parses bullet lists nested with two spaces', () => {
    const b = parseMarkdown('- a\n  - b\n- c');
    const list = b[0] as Extract<Block, { t: 'list' }>;
    expect(list.items).toHaveLength(2);
    expect(list.items[0][1]).toMatchObject({ t: 'list' });
  });

  it('parses tables with alignment and escaped pipes', () => {
    const b = parseMarkdown('| Key | Action |\n|:---|---:|\n| `L` | Line \\| chain |\n| `Shift+S` | Sketch |');
    expect(b).toHaveLength(1);
    const tb = b[0] as Extract<Block, { t: 'table' }>;
    expect(tb.align).toEqual(['left', 'right']);
    expect(tb.rows).toHaveLength(2);
    expect(tb.rows[0][1]).toEqual([{ t: 'text', v: 'Line | chain' }]);
    expect(tb.rows[1][0]).toEqual([{ t: 'code', v: 'Shift+S' }]);
  });

  it('parses fenced code blocks verbatim', () => {
    const b = parseMarkdown('```bash\nnpm run agent -- **status**\n\n# not a heading\n```\ntext');
    expect(b[0]).toEqual({ t: 'code', lang: 'bash', v: 'npm run agent -- **status**\n\n# not a heading' });
    expect(b[1]).toMatchObject({ t: 'paragraph' });
  });

  it('detects callouts by keyword in any language and GitHub markers', () => {
    expect(parseMarkdown('> **Совет.** Текст')[0]).toMatchObject({ t: 'quote', kind: 'tip' });
    expect(parseMarkdown('> **Note:** text')[0]).toMatchObject({ t: 'quote', kind: 'note' });
    expect(parseMarkdown('> **Ограничение.** text')[0]).toMatchObject({ t: 'quote', kind: 'warning' });
    const gh = parseMarkdown('> [!WARNING]\n> Careful')[0];
    expect(gh).toMatchObject({ t: 'quote', kind: 'warning' });
    expect(gh.t === 'quote' && gh.c).toEqual([{ t: 'paragraph', c: [{ t: 'text', v: 'Careful' }] }]);
    expect(parseMarkdown('> just a quote')[0]).toMatchObject({ t: 'quote', kind: null });
  });

  it('parses figures with numbered markers', () => {
    const b = parseMarkdown('```figure\nimage: ../images/ok.svg\nalt: Window\ncaption: The *main* window\nwidth: 600\n1 12% 4.5% Top bar\n2 50 60\n```');
    expect(b).toEqual([
      {
        t: 'figure',
        src: '../images/ok.svg',
        alt: 'Window',
        caption: [{ t: 'text', v: 'The ' }, { t: 'em', c: [{ t: 'text', v: 'main' }] }, { t: 'text', v: ' window' }],
        width: 600,
        markers: [
          { label: '1', x: 12, y: 4.5, title: 'Top bar' },
          { label: '2', x: 50, y: 60, title: '' },
        ],
      },
    ]);
    expect(collectLinks(b).images).toEqual(['../images/ok.svg']);
    expect(blocksText(b)).toBe('Window The main window Top bar');
  });

  it('keeps longer fences around fenced examples', () => {
    const b = parseMarkdown('````text\n```figure\nimage: x.png\n```\n````\nafter');
    expect(b[0]).toEqual({ t: 'code', lang: 'text', v: '```figure\nimage: x.png\n```' });
    expect(b[1]).toMatchObject({ t: 'paragraph' });
  });

  it('parses horizontal rules', () => {
    expect(parseMarkdown('a\n\n---\n\nb')[1]).toEqual({ t: 'hr' });
  });

  it('extracts plain text and links', () => {
    const b = parseMarkdown('# T\n\nSee [Line](sketch-line) and ![x](images/a.svg).\n\n- [Arc](sketch-arc#tangent)');
    expect(blocksText(b)).toContain('See Line and x.');
    expect(collectLinks(b)).toEqual({ links: ['sketch-line', 'sketch-arc#tangent'], images: ['images/a.svg'] });
  });
});

describe('links', () => {
  it('classifies link targets', () => {
    expect(classifyLink('sketch-line')).toEqual({ kind: 'page', page: 'sketch-line', anchor: null });
    expect(classifyLink('sketch-line.md#options')).toEqual({ kind: 'page', page: 'sketch-line', anchor: 'options' });
    expect(classifyLink('#options')).toEqual({ kind: 'anchor', anchor: 'options' });
    expect(classifyLink('https://cad.onshape.com/help/')).toEqual({ kind: 'external', href: 'https://cad.onshape.com/help/' });
    expect(classifyLink('javascript:alert(1)')).toEqual({ kind: 'invalid' });
    expect(classifyLink('../agent-api.md')).toEqual({ kind: 'invalid' });
  });
});

describe('rendering', () => {
  it('renders structure without raw HTML', () => {
    const out = html('# Title\n\nText <b>not bold</b> & more\n\n<script>alert(1)</script>');
    expect(out).toContain('<h1 id="help-title">Title</h1>');
    expect(out).toContain('Text &lt;b&gt;not bold&lt;/b&gt; &amp; more');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<b>');
  });

  it('renders page, anchor, external and unsafe links', () => {
    const out = html('[a](sketch-line#x) [b](#y) [c](https://example.com) [d](javascript:alert(1)) [e](missing)');
    expect(out).toContain('<a href="#/help/ru/sketch-line#x">a</a>');
    expect(out).toContain('<a href="#/help/ru/current#y">b</a>');
    expect(out).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">c</a>');
    expect(out).toContain('<span class="help-broken-link">d</span>');
    expect(out).toContain('<span class="help-broken-link">e</span>');
    expect(out).not.toContain('javascript:');
  });

  it('renders images from the bundle only', () => {
    expect(html('![ok](images/ok.svg)')).toContain('<img src="/assets/ok.svg" alt="ok" loading="lazy"/>');
    expect(html('![ok](images/ok.svg)')).toContain('href="/assets/ok.svg" target="_blank" rel="noopener noreferrer"');
    expect(html('![bad](http://evil/x.png)')).toContain('[missing image: bad]');
  });

  it('keeps an existing image link without nesting anchors', () => {
    const out = html('[![ok](images/ok.svg)](https://example.com)');
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('<img src="/assets/ok.svg"');
  });

  it('opens figures at full size with a localized accessible label', () => {
    const out = html('```figure\nimage: images/ok.svg\nalt: Diagram\n```', { ...opts, imageOpen: 'Open full size' });
    expect(out).toContain('aria-label="Open full size: Diagram"');
    expect(out).toContain('href="/assets/ok.svg" target="_blank"');
  });

  it('renders keys as kbd and other code as code', () => {
    expect(html('`Shift+S` `25 mm` `L` `#w / 2`')).toBe('<p><kbd>Shift+S</kbd> <code>25 mm</code> <kbd>L</kbd> <code>#w / 2</code></p>');
    expect(isKeyCombo('Ctrl+Z')).toBe(true);
    expect(isKeyCombo('F1')).toBe(true);
    expect(isKeyCombo('mm')).toBe(false);
  });

  it('renders tight and loose lists, tables and callouts', () => {
    expect(html('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(html('3. a')).toBe('<ol start="3"><li>a</li></ol>');
    expect(html('| A | B |\n|---|:-:|\n| 1 | 2 |')).toBe(
      '<div class="help-table-wrap"><table><thead><tr><th>A</th><th style="text-align:center">B</th></tr></thead><tbody><tr><td>1</td><td style="text-align:center">2</td></tr></tbody></table></div>',
    );
    expect(html('> **Совет.** Текст')).toBe('<div class="help-callout tip"><p><strong>Совет.</strong> Текст</p></div>');
    expect(html('> [!NOTE]\n> Text', { ...opts, calloutTitle: { note: 'Примечание' } })).toBe(
      '<div class="help-callout note"><div class="help-callout-title">Примечание</div><p>Text</p></div>',
    );
  });

  it('renders figures with markers over the image', () => {
    const out = html('```figure\nimage: images/ok.svg\nalt: Window\n1 10% 20% Top bar\n```');
    expect(out).toBe(
      '<figure class="help-figure"><div class="help-figure-frame"><a class="help-image-link" href="/assets/ok.svg" target="_blank" rel="noopener noreferrer" aria-label="Window"><img src="/assets/ok.svg" alt="Window" loading="lazy"/></a>' +
        '<span class="help-marker" style="left:10%;top:20%" title="Top bar">1</span></div></figure>',
    );
    expect(html('```figure\nimage: images/none.png\nalt: Gone\n```')).toContain('[missing image: Gone]');
  });

  it('puts the h1 prefix before the first heading text', () => {
    expect(html('# Line', { ...opts, h1Prefix: createElement('i', null, 'icon') })).toBe('<h1 id="help-line"><i>icon</i>Line</h1>');
  });
});
