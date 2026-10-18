let counter = 0;

/** Short unique id (unique within a document; random part avoids collisions across sessions). */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1679616;
  const rnd = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return `${prefix}${Date.now().toString(36).slice(-5)}${counter.toString(36).padStart(4, '0')}${rnd}`;
}
