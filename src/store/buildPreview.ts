// A disposable 3D preview of exactly this document's content. The kernel still builds the editable model.
import type { CadDocument } from '../core/types';
import { hash } from '../core/derived';
import type { BuildResult } from '../kernel/protocol';
import { loadRenderPreview, saveRenderPreview } from './persistence';
import { embedMode } from '../embed/mode';

export function previewSignature(doc: CadDocument): string {
  const version = typeof __APP_VERSION__ === 'undefined' ? 'dev' : [__APP_VERSION__.version, __APP_VERSION__.sha];
  // All tabs include configuration choices, rollback, appearances, linked copies and assembly placements.
  return hash(JSON.stringify([1, version, doc.units, doc.activeTab, doc.tabs]));
}

const key = (doc: CadDocument) => `${doc.id}:${doc.activeTab}`;

export async function loadBuildPreview(doc: CadDocument): Promise<BuildResult | null> {
  if (embedMode()) return null;
  try {
    const p = await loadRenderPreview(key(doc));
    return p?.signature === previewSignature(doc) ? p.build : null;
  } catch {
    return null; // unavailable storage must never delay or prevent opening the document
  }
}

export async function saveBuildPreview(doc: CadDocument, result: BuildResult): Promise<void> {
  if (embedMode() || result.preview || !result.parts.length || Object.values(result.statuses).some((s) => !s.ok)) return;
  const bytes = result.parts.reduce((n, p) => n + p.positions.byteLength + p.normals.byteLength + p.indices.byteLength + p.faceRanges.byteLength + p.edgePositions.byteLength + p.edgeRanges.byteLength + p.vertices.byteLength, 0);
  if (bytes > 8 * 1024 * 1024) return;
  try {
    const signature = previewSignature(doc);
    // A separate mesh-key namespace: saved keys must never collide with the new worker's shape numbers.
    const build: BuildResult = {
      type: 'build', reqId: 0, timeMs: 0,
      parts: result.parts.map((p) => ({ ...p, meshKey: `saved:${signature}:${p.meshKey ?? p.id}` })),
      partOrder: result.partOrder, sketches: [], planes: [], mates: [], curves: [], statuses: {},
    };
    await saveRenderPreview({ id: key(doc), docId: doc.id, signature, used: Date.now(), build });
  } catch {
    // A preview is optional (private browsing, storage quota, older tabs holding the database open).
  }
}
