// WebCAD Embed Protocol v1: the messages between the embedded viewer (#/embed in an iframe) and the page around it.
// The page opens `#/embed?parentOrigin=<its origin>&channel=<uuid>`; the viewer says `webcad:ready`, the page sends
// the file (`webcad:load`, its bytes transferred), the viewer answers `webcad:loaded` once the model is shown or
// `webcad:error`. Only the sites listed here may embed it; messages from anywhere else are not looked at.

export const PROTOCOL_VERSION = 1;
/** The largest file the viewer takes (20 MiB). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The sites allowed to embed the viewer (exact origins). */
export const PARENT_ORIGINS: readonly string[] = [
  'https://ya-components.vercel.app',
  'https://components-yaerms-projects.vercel.app',
  'https://components-git-main-yaerms-projects.vercel.app',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A page that may embed the viewer: one of `PARENT_ORIGINS` exactly; on the development server also a page of this
 * computer (http(s)://localhost or 127.0.0.1, any port) — never in the published app.
 */
export function allowedParentOrigin(origin: unknown, dev: boolean): origin is string {
  if (typeof origin !== 'string') return false;
  if (PARENT_ORIGINS.includes(origin)) return true;
  if (!dev) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // an origin as such: no path, user or trailing slash ("http://localhost:3000", not "http://localhost:3000/")
  return (url.protocol === 'http:' || url.protocol === 'https:') && (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.origin === origin;
}

export interface EmbedParams {
  /** The page around the viewer: the only one it talks to. */
  parentOrigin: string;
  /** The page's id of this viewer (a UUID): every message carries it. */
  channel: string;
}

/** The viewer's address parameters (the query inside the hash), or null when they are missing or not allowed. */
export function embedParams(hash: string, dev: boolean): EmbedParams | null {
  const m = /^#\/embed\/?(?:\?(.*))?$/.exec(hash);
  if (!m) return null;
  const q = new URLSearchParams(m[1] ?? '');
  const parentOrigin = q.get('parentOrigin');
  const channel = q.get('channel');
  if (!allowedParentOrigin(parentOrigin, dev) || !channel || !UUID.test(channel)) return null;
  return { parentOrigin, channel };
}

export type EmbedFormat = 'step' | 'stl' | 'webcad';
export const EMBED_FORMATS: readonly EmbedFormat[] = ['step', 'stl', 'webcad'];

/** A file sent to the viewer (its bytes are the viewer's now: transferred). */
export interface EmbedFile {
  name: string;
  format: EmbedFormat;
  size: number;
  buffer: ArrayBuffer;
}

export type EmbedErrorCode = 'INVALID_FILE' | 'UNSUPPORTED_FORMAT' | 'BUILD_FAILED' | 'BUSY';

/**
 * What the viewer is doing with a file it took (before its answer): loading the geometry kernel (the first time,
 * when the file came before it was ready), building the model. Neither has a percentage to show.
 */
export type EmbedStage = 'kernel' | 'building';

/** What the viewer sends to the page. */
export type OutgoingMessage =
  | { type: 'webcad:ready'; version: 1; channel: string }
  | { type: 'webcad:progress'; version: 1; channel: string; requestId: string; stage: EmbedStage; message: string }
  | { type: 'webcad:loaded'; version: 1; channel: string; requestId: string }
  | { type: 'webcad:error'; version: 1; channel: string; requestId: string; error: { code: EmbedErrorCode; message: string } };

export const readyMessage = (channel: string): OutgoingMessage => ({ type: 'webcad:ready', version: PROTOCOL_VERSION, channel });
export const progressMessage = (channel: string, requestId: string, stage: EmbedStage, message: string): OutgoingMessage => ({
  type: 'webcad:progress',
  version: PROTOCOL_VERSION,
  channel,
  requestId,
  stage,
  message,
});
export const loadedMessage = (channel: string, requestId: string): OutgoingMessage => ({ type: 'webcad:loaded', version: PROTOCOL_VERSION, channel, requestId });
export const errorMessage = (channel: string, requestId: string, code: EmbedErrorCode, message: string): OutgoingMessage => ({
  type: 'webcad:error',
  version: PROTOCOL_VERSION,
  channel,
  requestId,
  error: { code, message },
});

/**
 * A message as the viewer takes it: not for it (`ignored`: another sender, channel, version or type — nothing is
 * answered), a load request it cannot take (`invalid`: answered with this error; `message` is English, translated
 * when sent) or a file to show.
 */
export type Incoming =
  | { kind: 'ignored'; reason: string }
  | { kind: 'invalid'; requestId: string; code: EmbedErrorCode; message: string }
  | { kind: 'load'; requestId: string; file: EmbedFile };

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** (also from another realm, as structured cloning gives it; never a SharedArrayBuffer) */
const isArrayBuffer = (x: unknown): x is ArrayBuffer => Object.prototype.toString.call(x) === '[object ArrayBuffer]';

/** Read a `message` event: only the page around the viewer (that window, its origin), this protocol and channel. */
export function readIncoming(ev: { source: unknown; origin: string; data: unknown }, parent: unknown, params: EmbedParams): Incoming {
  if (!parent || ev.source !== parent) return { kind: 'ignored', reason: 'source' };
  if (ev.origin !== params.parentOrigin) return { kind: 'ignored', reason: 'origin' };
  const d = ev.data;
  if (!isRecord(d)) return { kind: 'ignored', reason: 'data' };
  if (d.version !== PROTOCOL_VERSION) return { kind: 'ignored', reason: 'version' };
  if (d.channel !== params.channel) return { kind: 'ignored', reason: 'channel' };
  if (d.type !== 'webcad:load') return { kind: 'ignored', reason: 'type' };
  // without its id an answer could not be told apart from another attempt's
  if (typeof d.requestId !== 'string' || !UUID.test(d.requestId)) return { kind: 'ignored', reason: 'requestId' };
  const requestId = d.requestId;
  const invalid = (code: EmbedErrorCode, message: string): Incoming => ({ kind: 'invalid', requestId, code, message });
  const f = d.file;
  if (!isRecord(f)) return invalid('INVALID_FILE', 'No file data');
  if (typeof f.name !== 'string' || !f.name.trim() || f.name.length > 255) return invalid('INVALID_FILE', 'The file name is missing or too long');
  if (typeof f.format !== 'string' || !EMBED_FORMATS.includes(f.format as EmbedFormat))
    return invalid('UNSUPPORTED_FORMAT', 'Only STEP, STL and WebCAD project files can be shown');
  // the size before anything is read
  if (typeof f.size !== 'number' || !Number.isSafeInteger(f.size)) return invalid('INVALID_FILE', 'The file size is not valid');
  if (f.size < 1) return invalid('INVALID_FILE', 'The file is empty');
  if (f.size > MAX_FILE_BYTES) return invalid('INVALID_FILE', 'The file is larger than 20 MB');
  if (!isArrayBuffer(f.buffer)) return invalid('INVALID_FILE', 'No file data');
  if (f.buffer.byteLength !== f.size) return invalid('INVALID_FILE', 'The file size does not match its data');
  return { kind: 'load', requestId, file: { name: f.name, format: f.format as EmbedFormat, size: f.size, buffer: f.buffer } };
}
