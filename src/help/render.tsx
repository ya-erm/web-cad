// Markdown AST → React elements. Text always goes through React (escaped); link and image
// targets are whitelisted (help pages, https/mailto, bundled images).

import type { ReactNode } from 'react';
import { classifyLink, type Block, type Inline } from './markdown';

export interface RenderOptions {
  /** href of a help page (null if the page does not exist → rendered as plain text). */
  pageHref(page: string, anchor: string | null): string | null;
  /** href of an anchor on the current page. */
  anchorHref(anchor: string): string;
  /** URL of an image or null when it is not available. */
  imageUrl(src: string): string | null;
  /** Prefix of heading element ids (anchors). */
  idPrefix: string;
  /** Label of missing images. */
  imageMissing: string;
  /** Accessible label for opening an illustration at its original size. */
  imageOpen?: string;
  /** Callout titles for `[!NOTE]`-style callouts without their own bold lead-in. */
  calloutTitle?: Partial<Record<'note' | 'tip' | 'warning', string>>;
  /** Shown before the text of the first level-1 heading (e.g. the tool icon). */
  h1Prefix?: ReactNode;
}

/** Inline code that looks like a key or a key combination is shown as a keyboard key. */
const KEY = /^(?:(?:Shift|Ctrl|Alt|Cmd|Option|⌘)\+)*(?:[A-Z0-9]|F\d{1,2}|Esc|Enter|Tab|Space|Del|Delete|Backspace|Home|End|PageUp|PageDown|[←→↑↓]|Arrow(?:Left|Right|Up|Down)|[/?=+-])$/;

export function isKeyCombo(s: string): boolean {
  return KEY.test(s.trim());
}

function inline(c: Inline[], o: RenderOptions, insideLink = false): ReactNode[] {
  return c.map((x, i) => {
    switch (x.t) {
      case 'text':
        return x.v;
      case 'strong':
        return <strong key={i}>{inline(x.c, o, insideLink)}</strong>;
      case 'em':
        return <em key={i}>{inline(x.c, o, insideLink)}</em>;
      case 'code':
        return isKeyCombo(x.v) ? (
          <kbd key={i}>{x.v}</kbd>
        ) : (
          <code key={i}>{x.v}</code>
        );
      case 'br':
        return <br key={i} />;
      case 'image': {
        const url = o.imageUrl(x.src);
        if (url && insideLink) return <img key={i} src={url} alt={x.alt} title={x.title} loading="lazy" />;
        return url ? (
          <a key={i} className="help-image-link" href={url} target="_blank" rel="noopener noreferrer" title={o.imageOpen} aria-label={o.imageOpen ? `${o.imageOpen}: ${x.alt}` : x.alt}>
            <img src={url} alt={x.alt} title={x.title} loading="lazy" />
          </a>
        ) : (
          <span key={i} className="help-img-missing">
            [{o.imageMissing}: {x.alt || x.src}]
          </span>
        );
      }
      case 'link': {
        const target = classifyLink(x.href);
        const children = inline(x.c, o, true);
        if (target.kind === 'external')
          return (
            <a key={i} href={target.href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        if (target.kind === 'anchor')
          return (
            <a key={i} href={o.anchorHref(target.anchor)}>
              {children}
            </a>
          );
        const href = target.kind === 'page' ? o.pageHref(target.page, target.anchor) : null;
        if (href)
          return (
            <a key={i} href={href}>
              {children}
            </a>
          );
        return (
          <span key={i} className="help-broken-link">
            {children}
          </span>
        );
      }
    }
  });
}

function listItem(blocks: Block[], o: RenderOptions, key: number): ReactNode {
  // tight items: a single paragraph (plus nested lists) renders without <p>
  const [first, ...rest] = blocks;
  if (first?.t === 'paragraph' && rest.every((b) => b.t === 'list'))
    return (
      <li key={key}>
        {inline(first.c, o)}
        {rest.map((b, i) => block(b, o, i))}
      </li>
    );
  return <li key={key}>{blocks.map((b, i) => block(b, o, i))}</li>;
}

function block(b: Block, o: RenderOptions, key: number): ReactNode {
  switch (b.t) {
    case 'heading': {
      const id = o.idPrefix + b.id;
      const content = inline(b.c, o);
      switch (b.level) {
        case 1:
          return (
            <h1 key={key} id={id}>
              {o.h1Prefix}
              {content}
            </h1>
          );
        case 2:
          return (
            <h2 key={key} id={id}>
              {content}
            </h2>
          );
        case 3:
          return (
            <h3 key={key} id={id}>
              {content}
            </h3>
          );
        default:
          return (
            <h4 key={key} id={id}>
              {content}
            </h4>
          );
      }
    }
    case 'paragraph':
      return <p key={key}>{inline(b.c, o)}</p>;
    case 'list':
      return b.ordered ? (
        <ol key={key} start={b.start !== 1 ? b.start : undefined}>
          {b.items.map((it, i) => listItem(it, o, i))}
        </ol>
      ) : (
        <ul key={key}>{b.items.map((it, i) => listItem(it, o, i))}</ul>
      );
    case 'table':
      return (
        <div key={key} className="help-table-wrap">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} style={b.align[i] ? { textAlign: b.align[i]! } : undefined}>
                    {inline(c, o)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, i) => (
                    <td key={i} style={b.align[i] ? { textAlign: b.align[i]! } : undefined}>
                      {inline(c, o)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'code':
      return (
        <pre key={key} className={b.lang ? `lang-${b.lang.replace(/[^\w-]/g, '')}` : undefined}>
          <code>{b.v}</code>
        </pre>
      );
    case 'quote': {
      if (!b.kind) return <blockquote key={key}>{b.c.map((x, i) => block(x, o, i))}</blockquote>;
      const first = b.c[0];
      const ownTitle = first?.t === 'paragraph' && first.c[0]?.t === 'strong';
      const title = !ownTitle ? o.calloutTitle?.[b.kind] : undefined;
      return (
        <div key={key} className={`help-callout ${b.kind}`}>
          {title && <div className="help-callout-title">{title}</div>}
          {b.c.map((x, i) => block(x, o, i))}
        </div>
      );
    }
    case 'figure': {
      const url = o.imageUrl(b.src);
      return (
        <figure key={key} className="help-figure" style={b.width ? { maxWidth: b.width } : undefined}>
          {url ? (
            <div className="help-figure-frame">
              <a className="help-image-link" href={url} target="_blank" rel="noopener noreferrer" title={o.imageOpen} aria-label={o.imageOpen ? `${o.imageOpen}: ${b.alt}` : b.alt}>
                <img src={url} alt={b.alt} loading="lazy" />
              </a>
              {b.markers.map((m, i) => (
                <span
                  key={i}
                  className="help-marker"
                  style={{ left: `${Math.min(100, Math.max(0, m.x))}%`, top: `${Math.min(100, Math.max(0, m.y))}%` }}
                  title={m.title || undefined}
                >
                  {m.label}
                </span>
              ))}
            </div>
          ) : (
            <span className="help-img-missing">
              [{o.imageMissing}: {b.alt || b.src}]
            </span>
          )}
          {b.caption && <figcaption>{inline(b.caption, o)}</figcaption>}
        </figure>
      );
    }
    case 'hr':
      return <hr key={key} />;
  }
}

export function renderMarkdown(blocks: Block[], o: RenderOptions): ReactNode {
  return blocks.map((b, i) => block(b, o, i));
}
