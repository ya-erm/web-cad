// The document the embedded viewer shows for a file: a STEP or STL file — a Part Studio of one Import feature (as
// importing it into a new document would make), a project file (.webcad.json) — its document as it is. The document
// stays in memory: it is never saved.

import type { CadDocument, DocTab, LengthUnit, ProjectVersion } from '../core/types';
import { uid } from '../core/ids';
import { newDocument } from '../store/docStore';
import { readProject } from '../store/folderStore';
import { t } from '../i18n';
import type { EmbedFile } from './protocol';
import { EmbedError } from './session';

export interface ViewModel {
  doc: CadDocument;
  /** A project file's versions (with their content): Derived features may take parts from them. */
  versions: ProjectVersion[];
  /** A STEP / STL file: its Import feature (whether the file could be read is its build's status). */
  importId?: string;
}

/** The tabs the viewer shows: Part Studios, assemblies and drawings (their sheets). */
export const viewableTabs = (doc: Pick<CadDocument, 'tabs'>): DocTab[] => doc.tabs.filter((x) => x.type === 'partStudio' || x.type === 'assembly' || x.type === 'drawing');

/** The tab a project opens at: its active one when it is a model, else its first model; a drawing only without models. */
export function openingTab(doc: Pick<CadDocument, 'tabs' | 'activeTab'>): DocTab | undefined {
  const models = doc.tabs.filter((x) => x.type === 'partStudio' || x.type === 'assembly');
  return models.find((x) => x.id === doc.activeTab) ?? models[0] ?? doc.tabs.find((x) => x.type === 'drawing');
}

/** A file's name without its extension and characters that are not shown (a fallback when nothing is left). */
export function modelTitle(fileName: string): string {
  const shown = [...fileName].filter((c) => c >= ' ' && c !== '\u007f').join('');
  const s = shown.replace(/\.(webcad\.json|json|step|stp|stl)$/i, '').trim();
  return s || 'Model';
}

/** The document of a file sent to the viewer; throws an `EmbedError` when the file is not what it says it is. */
export function viewModel(file: Pick<EmbedFile, 'name' | 'format' | 'buffer'>): ViewModel {
  const bytes = new Uint8Array(file.buffer);
  const title = modelTitle(file.name);
  if (file.format === 'webcad') return projectModel(bytes, title);
  if (file.format === 'step') checkStep(bytes);
  else checkStl(bytes);
  return importModel(title, file.name, file.format, bytes);
}

const invalid = (message: string) => new EmbedError('INVALID_FILE', t(message));

/** The bytes as text, a byte a character (enough to look for the ASCII words of a file format). */
const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** A STEP (ISO 10303-21) file: its header first and its end marker last (else it is cut short). */
export function checkStep(bytes: Uint8Array) {
  // (a UTF-8 byte order mark, read byte by byte, before it)
  const head = latin1(bytes.subarray(0, 256)).replace(/^ï»¿/, '').trimStart();
  if (!head.startsWith('ISO-10303-21')) throw invalid('The file is not a STEP file');
  if (!latin1(bytes.subarray(Math.max(0, bytes.byteLength - 1024))).includes('END-ISO-10303-21')) throw invalid('The STEP file is damaged or incomplete');
}

/** A binary STL (its size is that of the triangles its header counts) or a text one (facets of vertices). */
export function checkStl(bytes: Uint8Array) {
  const n = bytes.byteLength >= 84 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true) : -1;
  if (n >= 0 && 84 + n * 50 === bytes.byteLength) {
    if (!n) throw invalid('The STL file has no triangles');
    return;
  }
  const text = latin1(bytes);
  if (/\bfacet\b/i.test(text) && /\bvertex\s/i.test(text)) return;
  // the header counts more triangles than there are: the file was cut short
  throw invalid(n > 0 && 84 + n * 50 > bytes.byteLength ? 'The STL file is damaged or incomplete' : 'The file is not an STL file');
}

function base64Of(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A new document of one Part Studio importing the file (millimetres: STEP comes in them, STL has no units). */
function importModel(title: string, fileName: string, format: 'step' | 'stl', bytes: Uint8Array): ViewModel {
  const doc = newDocument(title);
  const studio = doc.tabs[0];
  if (studio.type !== 'partStudio') throw new Error('A new document starts with a Part Studio');
  const id = uid('f');
  studio.features.push({ id, type: 'import', name: title, params: { fileName, format, data: base64Of(bytes) } });
  return { doc, versions: [], importId: id };
}

const UNITS: readonly LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The tabs as the viewer needs them (a file edited by hand or cut short is refused before it is built). */
function wellFormed(doc: CadDocument): boolean {
  if (!isRecord(doc.units) || !UNITS.includes(doc.units.length as LengthUnit)) return false;
  return doc.tabs.every((x: unknown) => {
    if (!isRecord(x) || typeof x.id !== 'string' || typeof x.name !== 'string') return false;
    if (x.type === 'partStudio')
      return Array.isArray(x.features) && x.features.every((f: unknown) => isRecord(f) && typeof f.id === 'string' && typeof f.type === 'string' && isRecord(f.params)) && isRecord(x.parts);
    if (x.type === 'assembly') return Array.isArray(x.instances) && x.instances.every(isRecord);
    return x.type === 'drawing';
  });
}

/** A project file's document, opened at a model (`openingTab`). */
function projectModel(bytes: Uint8Array, title: string): ViewModel {
  let read: ReturnType<typeof readProject>;
  try {
    read = readProject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), title);
  } catch {
    throw invalid('The file is not a WebCAD project');
  }
  const { doc, versions } = read;
  if (!wellFormed(doc)) throw invalid('The WebCAD project is damaged');
  const active = openingTab(doc);
  if (!active) throw new EmbedError('UNSUPPORTED_FORMAT', t('The document has no Part Studios, assemblies or drawings to show'));
  return { doc: { ...doc, activeTab: active.id }, versions: versions.filter((v) => isRecord(v) && typeof v.id === 'string' && Array.isArray(v.tabs)) };
}
