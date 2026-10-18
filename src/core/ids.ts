let counter = 0;

/** Short unique id (unique within a document; random part avoids collisions across sessions). */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1679616;
  const rnd = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return `${prefix}${Date.now().toString(36).slice(-5)}${counter.toString(36).padStart(4, '0')}${rnd}`;
}

/**
 * A document id that tells when it was made (local time): `doc-20261018-143512-k3f9` — the date, the time and four
 * random characters (two documents made in one second differ). Documents keep the ids they already have.
 */
export function docId(at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`;
  const time = `${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  const rnd = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return `doc-${date}-${time}-${rnd}`;
}
