import { describe, expect, it } from 'vitest';
import { containsPage, findPage, flatPages, helpHash, isHelpHash, langChain, localize, parseHelpHash, prevNext, resolveSource, type Toc } from './toc';
import { normalize, searchDocs, tokenize } from './search';
import { helpStrings } from './strings';

const toc: Toc = {
  start: 'intro',
  languages: { ru: 'Русский', en: 'English' },
  fallback: ['en', 'ru'],
  sections: [
    { id: 's1', title: { ru: 'Раздел', en: 'Section' }, pages: [{ id: 'intro', title: { ru: 'Введение', en: 'Intro' } }] },
    {
      id: 's2',
      title: { en: 'Only English' },
      pages: [
        { id: 'a', title: { ru: 'А', en: 'A' } },
        { id: 'b', title: { ru: 'Б' } },
      ],
    },
  ],
};

describe('language fallback', () => {
  it('builds the fallback chain without duplicates', () => {
    expect(langChain('de')).toEqual(['de', 'en', 'ru']);
    expect(langChain('en')).toEqual(['en', 'ru']);
    expect(langChain('ru', ['en', 'ru'])).toEqual(['ru', 'en']);
  });

  it('localizes titles: requested language, then English, then Russian', () => {
    expect(localize({ ru: 'Р', en: 'E' }, 'ru')).toBe('Р');
    expect(localize({ ru: 'Р', en: 'E' }, 'de')).toBe('E');
    expect(localize({ ru: 'Р' }, 'de')).toBe('Р');
    expect(localize({ fr: 'F' }, 'de')).toBe('F');
    expect(localize(undefined, 'ru', undefined, 'id')).toBe('id');
  });

  it('resolves page sources with the language actually used', () => {
    const src = { ru: { a: 'ru-a', b: 'ru-b' }, en: { a: 'en-a' } };
    expect(resolveSource(src, 'en', 'a')).toEqual({ lang: 'en', value: 'en-a' });
    expect(resolveSource(src, 'en', 'b')).toEqual({ lang: 'ru', value: 'ru-b' });
    expect(resolveSource(src, 'de', 'a')).toEqual({ lang: 'en', value: 'en-a' });
    expect(resolveSource(src, 'ru', 'zzz')).toBeNull();
  });

  it('falls back to English interface strings of the viewer', () => {
    expect(helpStrings('ru').next).toBe('Далее');
    expect(helpStrings('de').next).toBe('Next');
  });
});

describe('table of contents', () => {
  it('lists sub-pages right after their parent', () => {
    const nested: Toc = {
      ...toc,
      sections: [{ id: 's', title: { en: 'S' }, pages: [{ id: 'p', title: { en: 'P' }, children: [{ id: 'c1', title: { en: 'C1' } }, { id: 'c2', title: { en: 'C2' } }] }, { id: 'q', title: { en: 'Q' } }] }],
    };
    expect(flatPages(nested).map((p) => [p.page.id, p.parent?.id ?? null])).toEqual([
      ['p', null],
      ['c1', 'p'],
      ['c2', 'p'],
      ['q', null],
    ]);
    expect(prevNext(nested, 'c2')).toEqual({ prev: nested.sections[0].pages[0].children![0], next: nested.sections[0].pages[1] });
    expect(containsPage(nested.sections[0].pages[0], 'c2')).toBe(true);
    expect(containsPage(nested.sections[0].pages[0], 'q')).toBe(false);
  });

  it('flattens pages in reading order with prev/next', () => {
    expect(flatPages(toc).map((p) => p.page.id)).toEqual(['intro', 'a', 'b']);
    expect(findPage(toc, 'b')?.section.id).toBe('s2');
    expect(findPage(toc, 'zzz')).toBeNull();
    expect(prevNext(toc, 'intro')).toEqual({ prev: null, next: toc.sections[1].pages[0] });
    expect(prevNext(toc, 'a').prev?.id).toBe('intro');
    expect(prevNext(toc, 'b').next).toBeNull();
  });
});

describe('help routes', () => {
  it('parses #/help addresses', () => {
    expect(isHelpHash('#/help')).toBe(true);
    expect(isHelpHash('#/helpdesk')).toBe(false);
    expect(isHelpHash('#/doc/abc')).toBe(false);
    expect(parseHelpHash('#/help')).toEqual({ lang: null, page: null, anchor: null });
    expect(parseHelpHash('#/help/ru')).toEqual({ lang: 'ru', page: null, anchor: null });
    expect(parseHelpHash('#/help/en/sketch-line')).toEqual({ lang: 'en', page: 'sketch-line', anchor: null });
    expect(parseHelpHash('#/help/ru/sketch-constraints#coincident')).toEqual({ lang: 'ru', page: 'sketch-constraints', anchor: 'coincident' });
    expect(parseHelpHash('#/doc/x')).toBeNull();
  });

  it('builds addresses', () => {
    expect(helpHash('ru', 'extrude')).toBe('#/help/ru/extrude');
    expect(helpHash('en', 'extrude', 'options')).toBe('#/help/en/extrude#options');
    expect(parseHelpHash(helpHash('en', 'extrude', 'options'))).toEqual({ lang: 'en', page: 'extrude', anchor: 'options' });
  });
});

describe('search', () => {
  const docs = [
    { id: 'extrude', title: 'Выдавливание', section: 'Фичи', text: 'Выдавливает области эскиза на глубину. Окончание: На глубину, Симметрично.' },
    { id: 'sketch-line', title: 'Линия', section: 'Эскиз', text: 'Линия рисуется цепочкой. Ёлка и ёж.' },
    { id: 'revolve', title: 'Вращение', section: 'Фичи', text: 'Вращает области эскиза вокруг оси.' },
  ];

  it('normalizes case and ё', () => {
    expect(normalize('ЁЛКА  Ёж')).toBe('елка еж');
    expect(tokenize(' Линия,  эскиз ')).toEqual(['линия', 'эскиз']);
  });

  it('requires all words and ranks title matches first', () => {
    expect(searchDocs(docs, 'эскиз').map((h) => h.id)).toEqual(['revolve', 'extrude']);
    expect(searchDocs(docs, 'линия')[0].id).toBe('sketch-line');
    expect(searchDocs(docs, 'вращение')[0].id).toBe('revolve');
    expect(searchDocs(docs, 'эскиз оси').map((h) => h.id)).toEqual(['revolve']);
    expect(searchDocs(docs, 'нет такого')).toEqual([]);
    expect(searchDocs(docs, '   ')).toEqual([]);
  });

  it('returns a snippet around the match', () => {
    const [hit] = searchDocs(docs, 'елка');
    expect(hit.id).toBe('sketch-line');
    expect(hit.snippet?.match).toBe('Ёлка');
    expect(hit.snippet?.before).toContain('цепочкой');
  });
});
