/** The document navigator has its own remembered width, independent of the editor. */
export const DOCUMENTS_SIDEBAR_DEFAULT = 220;
export const DOCUMENTS_SIDEBAR_MIN = 180;
export const DOCUMENTS_SIDEBAR_MAX = 600;
export const DOCUMENTS_SIDEBAR_KEY = 'webcad.documentsSidebar.width';

export function documentsSidebarWidth(width: number, viewport: number): number {
  const max = Math.max(DOCUMENTS_SIDEBAR_MIN, Math.min(DOCUMENTS_SIDEBAR_MAX, viewport - 320));
  return Math.round(Math.max(DOCUMENTS_SIDEBAR_MIN, Math.min(width, max)));
}

export function loadDocumentsSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(DOCUMENTS_SIDEBAR_KEY),
      value = raw === null ? NaN : Number(raw);
    if (Number.isFinite(value) && value >= DOCUMENTS_SIDEBAR_MIN && value <= DOCUMENTS_SIDEBAR_MAX) return value;
  } catch {
    /* Private browsing or restricted storage keeps the default. */
  }
  return DOCUMENTS_SIDEBAR_DEFAULT;
}

export function saveDocumentsSidebarWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(DOCUMENTS_SIDEBAR_KEY);
    else localStorage.setItem(DOCUMENTS_SIDEBAR_KEY, String(width));
  } catch {
    /* Resizing remains available without persistence. */
  }
}
