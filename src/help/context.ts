// Contextual help: which page to open for the current state of the editor, and opening help
// in a new browser tab (#/help/<lang>/<page>).

import { useEditor } from '../store/editorStore';
import { activeTab, useDoc } from '../store/docStore';
import { getLang } from '../i18n';
import { CONTEXT_HELP, FEATURE_HELP, HELP_START, SKETCH_TOOL_HELP } from './pages';

export function helpUrl(page: string = HELP_START, lang: string = getLang()): string {
  return `#/help/${lang}/${page}`;
}

/** Open a help page in a new tab. `noopener` gives the tab its own session (agent bridge tab id). */
export function openHelp(page: string = HELP_START) {
  window.open(helpUrl(page), '_blank', 'noopener');
}

/** Page for the active sketch tool, sketch pattern or feature dialog; the start page otherwise. */
export function contextHelpPage(): string {
  const doc = useDoc.getState().doc;
  if (!doc) return CONTEXT_HELP.documents;
  if (activeTab(doc)?.type === 'drawing') return CONTEXT_HELP.drawing;
  if (activeTab(doc)?.type === 'assembly') return CONTEXT_HELP.assembly;
  const ed = useEditor.getState();
  if (!ed.editing) return HELP_START;
  if (ed.editing.draft.type === 'sketch') {
    if (ed.sketchPattern) return CONTEXT_HELP.sketchPattern;
    return SKETCH_TOOL_HELP[ed.sketch?.tool ?? 'select'] ?? FEATURE_HELP.sketch;
  }
  return FEATURE_HELP[ed.editing.draft.type] ?? HELP_START;
}
