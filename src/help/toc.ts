// Table of contents, help routes and language fallback (pure functions, no Vite specifics).

/** Text in several languages: { ru: '…', en: '…' }. */
export type Localized = Record<string, string>;

export interface TocPage {
  id: string;
  title: Localized;
  /** Optional toolbar icon name (src/ui/icons.tsx) shown in the contents and the page header. */
  icon?: string;
  /** Sub-pages, shown indented under this page (expanded while one of them is open). */
  children?: TocPage[];
}

export interface TocSection {
  id: string;
  title: Localized;
  pages: TocPage[];
}

export interface Toc {
  /** Page shown for `#/help` and unknown pages. */
  start: string;
  /** Help languages in menu order: code → native name. */
  languages: Record<string, string>;
  /** Languages tried when a page or title is missing in the requested one. */
  fallback: string[];
  sections: TocSection[];
}

export const DEFAULT_FALLBACK = ['en', 'ru'];

/** Requested language first, then the fallback chain (no duplicates). */
export function langChain(lang: string, fallback: string[] = DEFAULT_FALLBACK): string[] {
  return [...new Set([lang, ...fallback])];
}

/** Localized text with fallback; `def` when no language matches. */
export function localize(text: Localized | undefined, lang: string, fallback: string[] = DEFAULT_FALLBACK, def = ''): string {
  if (!text) return def;
  for (const l of langChain(lang, fallback)) if (text[l]) return text[l];
  const any = Object.values(text).find(Boolean);
  return any ?? def;
}

/**
 * Pick a per-language resource (page source, loader…) with fallback.
 * Returns the language actually used so the viewer can say "not translated yet".
 */
export function resolveSource<T>(sources: Record<string, Record<string, T>>, lang: string, id: string, fallback: string[] = DEFAULT_FALLBACK): { lang: string; value: T } | null {
  for (const l of langChain(lang, fallback)) {
    const v = sources[l]?.[id];
    if (v !== undefined) return { lang: l, value: v };
  }
  return null;
}

export interface FlatPage {
  page: TocPage;
  section: TocSection;
  /** Parent page of a sub-page. */
  parent: TocPage | null;
  index: number;
}

/** All pages in reading order: a page is followed by its sub-pages. */
export function flatPages(toc: Toc): FlatPage[] {
  const out: FlatPage[] = [];
  const add = (page: TocPage, section: TocSection, parent: TocPage | null) => {
    out.push({ page, section, parent, index: out.length });
    for (const ch of page.children ?? []) add(ch, section, page);
  };
  for (const section of toc.sections) for (const page of section.pages) add(page, section, null);
  return out;
}

/** Whether `id` is the page itself or one of its (nested) sub-pages. */
export function containsPage(page: TocPage, id: string): boolean {
  return page.id === id || (page.children ?? []).some((c) => containsPage(c, id));
}

export function findPage(toc: Toc, id: string): FlatPage | null {
  return flatPages(toc).find((p) => p.page.id === id) ?? null;
}

export function prevNext(toc: Toc, id: string): { prev: TocPage | null; next: TocPage | null } {
  const all = flatPages(toc);
  const i = all.findIndex((p) => p.page.id === id);
  if (i < 0) return { prev: null, next: null };
  return { prev: all[i - 1]?.page ?? null, next: all[i + 1]?.page ?? null };
}

// ---------------------------------------------------------------------------
// Routes: #/help/<lang>/<page-id>[#<anchor>]
// ---------------------------------------------------------------------------

export interface HelpRoute {
  lang: string | null;
  page: string | null;
  anchor: string | null;
}

export function isHelpHash(hash: string): boolean {
  return /^#\/help(?:[/#?]|$)/.test(hash);
}

export function parseHelpHash(hash: string): HelpRoute | null {
  if (!isHelpHash(hash)) return null;
  const m = /^#\/help(?:\/([a-z]{2,3}(?:-[A-Za-z]{2,4})?))?(?:\/([\w-]+))?\/?(?:#([\w-]+))?/.exec(hash);
  if (!m) return { lang: null, page: null, anchor: null };
  return { lang: m[1] ?? null, page: m[2] ?? null, anchor: m[3] ?? null };
}

export function helpHash(lang: string, page: string, anchor?: string | null): string {
  return `#/help/${lang}/${page}${anchor ? `#${anchor}` : ''}`;
}
