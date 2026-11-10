// Keeps the feature/sketch being edited in sessionStorage so a page reload
// (or an accidental refresh) does not lose unfinished work.

import { useDoc } from './docStore';
import { useEditor, type Editing, type SketchTool } from './editorStore';
import { knownLink, parseVersionStudio, registerLink } from '../core/derived';
import type { CadDocument, DocumentLink } from '../core/types';

interface Stored {
  docId: string;
  tabId: string;
  editing: Editing;
  sketch?: { tool: SketchTool; construction: boolean };
  /** The copy of another document a Derived draft has just been given (the document keeps it once committed). */
  links?: DocumentLink[];
}

/** The copy the draft uses that only the memory has as yet: lost on a reload otherwise (the source "not available"). */
function draftLinks(doc: CadDocument, editing: Editing): DocumentLink[] {
  const d = editing.draft;
  const v = d.type === 'derived' ? parseVersionStudio(d.params.studioId) : null;
  const link = v && knownLink(v.versionId);
  if (!link || doc.tabs.some((t) => t.type === 'partStudio' && t.links?.some((l) => l.id === link.id))) return [];
  return [link];
}

const KEY = 'webcad.draft';
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function save() {
  const doc = useDoc.getState().doc;
  const { editing, sketch } = useEditor.getState();
  try {
    if (!doc || !editing) {
      sessionStorage.removeItem(KEY);
      return;
    }
    const links = draftLinks(doc, editing);
    const data: Stored = {
      docId: doc.id,
      tabId: doc.activeTab,
      editing,
      sketch: sketch ? { tool: sketch.tool, construction: sketch.construction } : undefined,
      ...(links.length ? { links } : {}),
    };
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable: no draft rather than an older one
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* unavailable: ignore */
    }
  }
}

export function startDraftPersistence() {
  if (started) return;
  started = true;
  useEditor.subscribe((s, p) => {
    if (s.editing === p.editing && s.sketch?.tool === p.sketch?.tool && s.sketch?.construction === p.sketch?.construction) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, s.editing ? 250 : 0);
  });
}

/** Restore an unfinished edit of the open document (call once the document is loaded). */
export function restoreDraft(): boolean {
  const doc = useDoc.getState().doc;
  if (!doc) return false;
  let data: Stored | null = null;
  try {
    data = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Stored | null;
  } catch {
    return false;
  }
  if (!data || data.docId !== doc.id || data.tabId !== doc.activeTab) return false;
  const tab = doc.tabs.find((t) => t.id === data!.tabId);
  if (!tab || tab.type !== 'partStudio') return false;
  const exists = tab.features.some((f) => f.id === data!.editing.featureId);
  if (!data.editing.isNew && !exists) return false;
  // its copy of another document known again: the draft builds, the document keeps it once committed
  for (const l of data.links ?? []) registerLink(l);
  useEditor.setState({
    editing: { ...data.editing, index: Math.min(data.editing.index, tab.features.length) },
    activeField: null,
    selection: [],
    sketch:
      data.editing.draft.type === 'sketch'
        ? {
            tool: data.sketch?.tool ?? 'select',
            construction: data.sketch?.construction ?? false,
            selection: [],
            hover: null,
            past: [],
            future: [],
            solve: null,
          }
        : null,
  });
  return true;
}
