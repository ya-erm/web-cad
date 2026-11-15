// The embedded viewer leaves this browser's documents alone: in its mode neither the documents' database nor the
// folders' one is opened — reading and writing fail at once, nothing is created.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { embedMode, enterEmbedMode } from './mode';
import * as db from '../store/persistence';
import { folderLinks, savedFolders } from '../store/localFolder';
import { newDocument } from '../store/docStore';

const open = vi.fn();

beforeAll(() => {
  vi.stubGlobal('indexedDB', { open });
  enterEmbedMode();
});
afterAll(() => vi.unstubAllGlobals());

describe('storage in the embedded viewer', () => {
  it('opens no database: documents, versions, thumbnails and folders are neither read nor written', async () => {
    expect(embedMode()).toBe(true);
    const doc = newDocument('Viewed');
    await expect(db.listDocuments()).rejects.toThrow('not used by the embedded viewer');
    await expect(db.loadDocument('any')).rejects.toThrow();
    await expect(db.saveDocument(doc)).rejects.toThrow();
    await expect(db.loadVersion('v1')).rejects.toThrow();
    await expect(db.saveThumbnail(doc.id, 'data:image/png;base64,')).rejects.toThrow();
    await expect(db.deleteDocument(doc.id)).rejects.toThrow();
    await expect(savedFolders()).rejects.toThrow();
    await expect(folderLinks()).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
});
