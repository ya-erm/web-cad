// Help content bundled with the app: docs/help/<lang>/<page-id>.md + docs/help/toc.json.
// Pages are separate lazy chunks (the service worker precaches them for offline use).

import { blocksText, documentTitle, parseMarkdown, type Block } from './markdown';
import { flatPages, localize, resolveSource, type Toc } from './toc';
import type { SearchDoc } from './search';

const tocModules = import.meta.glob('../../docs/help/toc.json', { eager: true, import: 'default' }) as Record<string, Toc>;
const pageModules = import.meta.glob('../../docs/help/**/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
// images/<name> is shared; images/<lang>/<name> (screenshots of the interface in that language) wins for <lang>
const imageModules = import.meta.glob('../../docs/help/images/**/*.{svg,png,jpg,jpeg,webp,gif}', {
  // Keep small SVGs as files too: browsers block opening data: URLs in a new tab.
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const TOC: Toc = Object.values(tocModules)[0] ?? { start: 'getting-started', languages: {}, fallback: ['en', 'ru'], sections: [] };

/** lang → page id → loader of the markdown source. */
export const SOURCES: Record<string, Record<string, () => Promise<string>>> = {};
for (const [path, load] of Object.entries(pageModules)) {
  const m = /docs\/help\/([^/]+)\/([^/]+)\.md$/.exec(path);
  if (!m) continue;
  (SOURCES[m[1]] ??= {})[m[2]] = load;
}

/** Help languages: the ones declared in toc.json that have pages, then any other page folders. */
export function helpLanguages(): string[] {
  const declared = Object.keys(TOC.languages).filter((l) => SOURCES[l]);
  return [...declared, ...Object.keys(SOURCES).filter((l) => !declared.includes(l))];
}

export function languageName(lang: string): string {
  return TOC.languages[lang] ?? lang.toUpperCase();
}

export function pageTitle(id: string, lang: string): string {
  const p = flatPages(TOC).find((x) => x.page.id === id);
  return p ? localize(p.page.title, lang, TOC.fallback, id) : id;
}

export interface LoadedPage {
  id: string;
  /** Language of the text actually shown (differs from the requested one when untranslated). */
  lang: string;
  blocks: Block[];
  title: string;
}

const cache = new Map<string, Promise<LoadedPage | null>>();

export function loadPage(id: string, lang: string): Promise<LoadedPage | null> {
  const key = `${lang}/${id}`;
  let p = cache.get(key);
  if (!p) {
    const src = resolveSource(SOURCES, lang, id, TOC.fallback);
    p = src
      ? src.value().then((text) => {
          const blocks = parseMarkdown(text);
          return { id, lang: src.lang, blocks, title: documentTitle(blocks) ?? pageTitle(id, lang) };
        })
      : Promise.resolve(null);
    cache.set(key, p);
  }
  return p;
}

/** Search documents of every page in the table of contents (loads them on first use). */
export async function loadSearchDocs(lang: string): Promise<SearchDoc[]> {
  const pages = flatPages(TOC);
  const loaded = await Promise.all(pages.map((p) => loadPage(p.page.id, lang)));
  return loaded.flatMap((lp, i) =>
    lp ? [{ id: lp.id, title: pageTitle(lp.id, lang), section: localize(pages[i].section.title, lang, TOC.fallback), text: blocksText(lp.blocks) }] : [],
  );
}

/**
 * URL of a bundled help image (`images/name.svg` relative to the page) or an https URL. With `lang`,
 * a localized copy (`images/<lang>/name`, e.g. a screenshot of the English interface) is preferred.
 */
export function imageUrl(src: string, lang?: string): string | null {
  if (/^https:\/\//i.test(src)) return src;
  const name = /^(?:\.\.\/|\.\/)?(?:images\/)?([\w.-]+)$/.exec(src)?.[1];
  if (!name) return null;
  return (lang && imageModules[`../../docs/help/images/${lang}/${name}`]) || (imageModules[`../../docs/help/images/${name}`] ?? null);
}

/** Shared images that have a copy for `lang` (the localized screenshots). */
export function localizedImages(lang: string): string[] {
  const prefix = `../../docs/help/images/${lang}/`;
  return Object.keys(imageModules)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}
