// Consistency of the bundled help: every page exists in the maintained languages, links and
// anchors resolve, images are bundled, contextual help points at existing pages.

import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from '../ui/icons';
import { SOURCES, TOC, imageUrl, localizedImages } from './content';
import { classifyLink, collectLinks, documentTitle, headingIds, parseMarkdown } from './markdown';
import { CONTEXT_HELP, FEATURE_HELP, HELP_START, SKETCH_TOOL_HELP } from './pages';
import { flatPages } from './toc';

/** Languages that must be complete; others may be partial (missing pages fall back). */
const REQUIRED = ['ru', 'en'];

const pages = flatPages(TOC);
const ids = pages.map((p) => p.page.id);

async function load(lang: string, id: string) {
  const blocks = parseMarkdown(await SOURCES[lang][id]());
  return { blocks, ids: new Set(headingIds(blocks)) };
}

describe('help table of contents', () => {
  it('has unique page ids and a valid start page', () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(TOC.start);
    expect(TOC.start).toBe(HELP_START);
  });

  it('declares every language folder', () => {
    for (const lang of Object.keys(SOURCES)) expect(Object.keys(TOC.languages)).toContain(lang);
    for (const lang of REQUIRED) expect(Object.keys(TOC.languages)).toContain(lang);
  });

  it('has titles in the required languages and known icons', () => {
    for (const { page, section } of pages) {
      for (const lang of REQUIRED) {
        expect(page.title[lang], `${page.id} title ${lang}`).toBeTruthy();
        expect(section.title[lang], `${section.id} title ${lang}`).toBeTruthy();
      }
      if (page.icon) expect(ICON_NAMES as string[], `${page.id} icon`).toContain(page.icon);
    }
  });

  it('points contextual help at existing pages', () => {
    for (const id of [...Object.values(FEATURE_HELP), ...Object.values(SKETCH_TOOL_HELP), ...Object.values(CONTEXT_HELP)]) expect(ids).toContain(id);
  });
});

describe('help pages', () => {
  it('exist in every required language, and nothing is outside the contents', () => {
    for (const lang of REQUIRED) {
      const missing = ids.filter((id) => !SOURCES[lang]?.[id]);
      expect(missing, `missing ${lang} pages`).toEqual([]);
    }
    for (const [lang, src] of Object.entries(SOURCES)) {
      const orphans = Object.keys(src).filter((id) => !ids.includes(id));
      expect(orphans, `${lang} pages not in toc.json`).toEqual([]);
    }
  });

  it('start with a title and have resolvable links, anchors and images', async () => {
    const problems: string[] = [];
    for (const [lang, src] of Object.entries(SOURCES)) {
      for (const id of Object.keys(src)) {
        const { blocks, ids: anchors } = await load(lang, id);
        if (!documentTitle(blocks) || blocks[0]?.t !== 'heading') problems.push(`${lang}/${id}: no "# Title" first`);
        const { links, images } = collectLinks(blocks);
        for (const href of links) {
          const t = classifyLink(href);
          if (t.kind === 'invalid') problems.push(`${lang}/${id}: bad link ${href}`);
          if (t.kind === 'anchor' && !anchors.has(t.anchor)) problems.push(`${lang}/${id}: missing anchor #${t.anchor}`);
          if (t.kind === 'page') {
            if (!ids.includes(t.page)) {
              problems.push(`${lang}/${id}: link to unknown page ${t.page}`);
              continue;
            }
            if (t.anchor) {
              const target = SOURCES[lang][t.page] ? lang : 'ru';
              const other = await load(target, t.page);
              if (!other.ids.has(t.anchor)) problems.push(`${lang}/${id}: missing anchor ${t.page}#${t.anchor}`);
            }
          }
        }
        for (const src of images) if (!imageUrl(src)) problems.push(`${lang}/${id}: image not bundled ${src}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keep the same explicit section anchors ({#id}) in every language', async () => {
    const explicit = (src: string) => [...src.matchAll(/^ {0,3}#{1,6}\s.*\{#([\w-]+)\}\s*$/gm)].map((m) => m[1]).sort().join(',');
    const problems: string[] = [];
    for (const id of ids) {
      const [a, b] = await Promise.all(REQUIRED.map((l) => SOURCES[l]?.[id]?.()));
      if (a === undefined || b === undefined) continue;
      if (explicit(a) !== explicit(b)) problems.push(`${id}: ${explicit(a)} ≠ ${explicit(b)}`);
    }
    expect(problems).toEqual([]);
  });

  it('localized screenshots override shared images of the same name', () => {
    const en = localizedImages('en');
    expect(en.length).toBeGreaterThan(0);
    for (const name of en) {
      // a shared original exists (other languages fall back to it) and English pages get their own copy
      expect(imageUrl(`../images/${name}`), name).toBeTruthy();
      expect(imageUrl(`../images/${name}`, 'en')).not.toBe(imageUrl(`../images/${name}`));
      expect(imageUrl(`../images/${name}`, 'ru')).toBe(imageUrl(`../images/${name}`));
    }
  });
});
