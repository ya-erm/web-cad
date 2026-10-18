// Full-text search over help pages of one language (titles weigh more than body text).

export interface SearchDoc {
  id: string;
  title: string;
  section: string;
  text: string;
}

export interface SearchHit {
  id: string;
  title: string;
  section: string;
  /** Text around the first match, split so the match can be highlighted. */
  snippet: { before: string; match: string; after: string } | null;
  score: number;
}

/** Lower case, "ё" → "е", collapsed whitespace: matching is case- and ё-insensitive. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

export function tokenize(query: string): string[] {
  return normalize(query)
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function countOf(hay: string, needle: string, cap = 20): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0 && n < cap; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

function snippetAt(text: string, norm: string, token: string, radius = 70): SearchHit['snippet'] {
  // `norm` is index-aligned with `text` (normalize keeps lengths except for whitespace runs),
  // so search on a whitespace-collapsed copy of the original text.
  const flat = text.replace(/\s+/g, ' ');
  const at = norm.indexOf(token);
  if (at < 0) return null;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + token.length + radius);
  const cut = (s: string, fromStart: boolean) => {
    if (fromStart) return start > 0 ? '…' + s.replace(/^\S*\s/, '') : s;
    return end < flat.length ? s.replace(/\s\S*$/, '') + '…' : s;
  };
  return {
    before: cut(flat.slice(start, at), true),
    match: flat.slice(at, at + token.length),
    after: cut(flat.slice(at + token.length, end), false),
  };
}

/** Pages containing every query word (in the title or the text), best matches first. */
export function searchDocs(docs: SearchDoc[], query: string, limit = 40): SearchHit[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const phrase = tokens.join(' ');
  const hits: SearchHit[] = [];
  for (const d of docs) {
    const title = normalize(d.title);
    const text = normalize(d.text);
    if (!tokens.every((t) => title.includes(t) || text.includes(t))) continue;
    let score = 0;
    if (title === phrase) score += 200;
    else if (title.startsWith(phrase)) score += 120;
    else if (title.includes(phrase)) score += 80;
    for (const t of tokens) {
      if (title.includes(t)) score += 20;
      score += countOf(text, t);
    }
    if (tokens.length > 1 && text.includes(phrase)) score += 15;
    const first = text.includes(phrase) ? phrase : (tokens.find((t) => text.includes(t)) ?? tokens[0]);
    hits.push({ id: d.id, title: d.title, section: d.section, snippet: snippetAt(d.text, text, first), score });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
