// Keeps the feature/sketch being edited in sessionStorage so a page reload
// (or an accidental refresh) does not lose unfinished work.

import { useDoc } from './docStore';
import { useEditor, type Editing, type SketchTool } from './editorStore';

interface Stored {
  docId: string;
  tabId: string;
  editing: Editing;
  sketch?: { tool: SketchTool; construction: boolean };
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
    const data: Stored = {
      docId: doc.id,
      tabId: doc.activeTab,
      editing,
      sketch: sketch ? { tool: sketch.tool, construction: sketch.construction } : undefined,
    };
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or unavailable: ignore */
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
