// In-app help viewer (#/help/<lang>/<page-id>): contents, search, language switch, pages
// rendered from bundled Markdown. Loaded lazily by App.tsx; works offline.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, ICON_NAMES, type IconName } from '../ui/icons';
import { getLang } from '../i18n';
import { TOC, SOURCES, helpLanguages, imageUrl, languageName, loadPage, loadSearchDocs, pageTitle, type LoadedPage } from './content';
import { containsPage, findPage, helpHash, localize, parseHelpHash, prevNext, type HelpRoute, type TocPage } from './toc';
import { renderMarkdown, type RenderOptions } from './render';
import { searchDocs, type SearchDoc } from './search';
import { helpStrings } from './strings';

const ID_PREFIX = 'help-';

function pageIcon(id: string): IconName | null {
  const icon = findPage(TOC, id)?.page.icon;
  return icon && (ICON_NAMES as string[]).includes(icon) ? (icon as IconName) : null;
}

function pageExists(id: string): boolean {
  return !!findPage(TOC, id) || Object.values(SOURCES).some((s) => !!s[id]);
}

/** Contents entry; sub-pages are listed while the page or one of its sub-pages is open. */
function NavItem({ page, lang, current, depth }: { page: TocPage; lang: string; current: string; depth: number }) {
  const icon = pageIcon(page.id);
  const children = page.children ?? [];
  const open = children.length > 0 && containsPage(page, current);
  return (
    <>
      <a
        className={'help-nav-item' + (page.id === current ? ' active' : '') + (depth ? ' sub' : '')}
        style={depth ? { paddingLeft: 8 + depth * 18 } : undefined}
        href={helpHash(lang, page.id)}
      >
        <span className="help-nav-icon">{icon && <Icon name={icon} size={16} />}</span>
        <span className="help-nav-text">{localize(page.title, lang, TOC.fallback, page.id)}</span>
        {children.length > 0 && (
          <span className="help-nav-chevron">
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
          </span>
        )}
      </a>
      {open && children.map((c) => <NavItem key={c.id} page={c} lang={lang} current={current} depth={depth + 1} />)}
    </>
  );
}

function useHelpRoute(): HelpRoute {
  const [route, setRoute] = useState<HelpRoute>(() => parseHelpHash(location.hash) ?? { lang: null, page: null, anchor: null });
  useEffect(() => {
    const on = () => {
      const r = parseHelpHash(location.hash);
      if (r) setRoute(r);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export default function HelpPage() {
  const route = useHelpRoute();
  const languages = helpLanguages();
  const appLang = getLang();
  const lang = route.lang && languages.includes(route.lang) ? route.lang : languages.includes(appLang) ? appLang : (languages[0] ?? 'en');
  const pageId = route.page ?? TOC.start;
  const exists = pageExists(pageId);
  const s = helpStrings(lang);

  // canonical address (#/help → #/help/ru/getting-started) without a new history entry
  useEffect(() => {
    const canonical = helpHash(lang, pageId, route.anchor);
    if (location.hash !== canonical) history.replaceState(null, '', canonical);
  }, [lang, pageId, route.anchor]);

  const [page, setPage] = useState<LoadedPage | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const key = `${lang}/${pageId}`;
  useEffect(() => {
    let alive = true;
    void loadPage(pageId, lang).then((p) => {
      if (!alive) return;
      setPage(p);
      setLoadedKey(`${lang}/${pageId}`);
    });
    return () => {
      alive = false;
    };
  }, [pageId, lang]);
  const ready = loadedKey === key;

  // search
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<{ lang: string; docs: SearchDoc[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!query.trim() || docs?.lang === lang) return;
    let alive = true;
    void loadSearchDocs(lang).then((d) => alive && setDocs({ lang, docs: d }));
    return () => {
      alive = false;
    };
  }, [query, lang, docs]);
  const hits = useMemo(() => (query.trim() && docs?.lang === lang ? searchDocs(docs.docs, query) : []), [query, docs, lang]);
  // navigating (a result, the contents, prev/next) ends the search
  useEffect(() => setQuery(''), [pageId, lang]);

  // scroll to the anchor or to the top when the page changes
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!ready) return;
    const el = route.anchor ? document.getElementById(ID_PREFIX + route.anchor) : null;
    if (el) el.scrollIntoView({ block: 'start' });
    else mainRef.current?.scrollTo({ top: 0 });
  }, [ready, key, route.anchor]);

  // keep the current page visible in the contents
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current?.querySelector('.help-nav-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [pageId]);

  const title = exists ? pageTitle(pageId, lang) : s.pageNotFound;
  useEffect(() => {
    document.title = `${title} — ${s.help} WebCAD`;
    document.documentElement.lang = lang;
  }, [title, s.help, lang]);

  // "/" focuses the search box, Esc clears it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pageId]);

  const icon = pageIcon(pageId);
  const opts: RenderOptions = {
    pageHref: (id, anchor) => (pageExists(id) ? helpHash(lang, id, anchor) : null),
    anchorHref: (anchor) => helpHash(lang, pageId, anchor),
    imageUrl: (src) => imageUrl(src, lang),
    idPrefix: ID_PREFIX,
    imageMissing: s.imageMissing,
    imageOpen: s.imageOpen,
    h1Prefix: icon ? <Icon name={icon} size={30} className="help-h1-icon" /> : undefined,
  };
  const { prev, next } = prevNext(TOC, pageId);
  const flat = findPage(TOC, pageId);
  const section = flat?.section;
  const parent = flat?.parent ?? null;
  const searching = !!query.trim();

  return (
    <div className="help-page">
      <header className="help-top">
        <button className="icon-btn help-nav-toggle" title={s.contents} onClick={() => setNavOpen(!navOpen)}>
          <Icon name="layers" size={18} />
        </button>
        {/* the logo and the name: WebCAD itself; "Help": the help's start page */}
        <span className="brand help-brand">
          <a className="help-brand-app" href="#/" title={s.openApp}>
            <div className="brand-logo">◆</div> WebCAD
          </a>
          <a className="help-brand-sub" href={helpHash(lang, TOC.start)}>
            {s.help}
          </a>
        </span>
        <div className="help-search">
          <span className="search-icon">
            <Icon name="search" size={16} />
          </span>
          <input
            ref={searchRef}
            type="search"
            placeholder={`${s.search}  /`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
              if (e.key === 'Enter' && hits[0]) location.hash = helpHash(lang, hits[0].id);
            }}
          />
        </div>
        <div className="spacer" />
        <div className="help-langs" role="group" aria-label={s.language} title={s.language}>
          {languages.map((l) => (
            <a key={l} className={l === lang ? 'on' : ''} href={helpHash(l, pageId, route.anchor)} title={languageName(l)} hrefLang={l}>
              {l.toUpperCase()}
            </a>
          ))}
        </div>
      </header>
      <div className="help-body">
        <nav className={'help-nav' + (navOpen ? ' open' : '')} ref={navRef} aria-label={s.contents}>
          {TOC.sections.map((sec) => (
            <div key={sec.id} className="help-nav-section">
              <div className="help-nav-title">{localize(sec.title, lang, TOC.fallback, sec.id)}</div>
              {sec.pages.map((p) => (
                <NavItem key={p.id} page={p} lang={lang} current={pageId} depth={0} />
              ))}
            </div>
          ))}
        </nav>
        <main className="help-main" ref={mainRef}>
          {searching ? (
            <div className="help-article help-results">
              <h1>{s.searchResults}</h1>
              {docs?.lang !== lang ? (
                <p className="help-muted">{s.searching}</p>
              ) : hits.length === 0 ? (
                <p className="help-muted">{s.nothingFound}</p>
              ) : (
                hits.map((h) => {
                  const hi = pageIcon(h.id);
                  return (
                    <a key={h.id} className="help-hit" href={helpHash(lang, h.id)}>
                      <div className="help-hit-title">
                        {hi && <Icon name={hi} size={16} />} {h.title} <span className="help-hit-section">{h.section}</span>
                      </div>
                      {h.snippet && (
                        <div className="help-hit-snippet">
                          {h.snippet.before}
                          <mark>{h.snippet.match}</mark>
                          {h.snippet.after}
                        </div>
                      )}
                    </a>
                  );
                })
              )}
            </div>
          ) : (
            <article className="help-article" lang={page?.lang ?? lang}>
              {section && (
                <div className="help-crumbs">
                  {localize(section.title, lang, TOC.fallback)}
                  {parent && (
                    <>
                      {' › '}
                      <a href={helpHash(lang, parent.id)}>{localize(parent.title, lang, TOC.fallback, parent.id)}</a>
                    </>
                  )}
                </div>
              )}
              {!exists ? (
                <>
                  <h1>{s.pageNotFound}</h1>
                  <p>
                    <a href={helpHash(lang, TOC.start)}>{pageTitle(TOC.start, lang)}</a>
                  </p>
                </>
              ) : !ready ? (
                <p className="help-muted">{s.loading}</p>
              ) : page ? (
                <>
                  {page.lang !== lang && <div className="help-callout note">{s.notTranslated.replace('{lang}', languageName(page.lang))}</div>}
                  {renderMarkdown(page.blocks, opts)}
                </>
              ) : (
                <h1>{s.pageNotFound}</h1>
              )}
              {exists && (prev || next) && (
                <div className="help-pager">
                  {prev ? (
                    <a className="prev" href={helpHash(lang, prev.id)}>
                      <span className="help-pager-label">← {s.previous}</span>
                      {localize(prev.title, lang, TOC.fallback, prev.id)}
                    </a>
                  ) : (
                    <span />
                  )}
                  {next && (
                    <a className="next" href={helpHash(lang, next.id)}>
                      <span className="help-pager-label">
                        {s.next} →
                      </span>
                      {localize(next.title, lang, TOC.fallback, next.id)}
                    </a>
                  )}
                </div>
              )}
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
