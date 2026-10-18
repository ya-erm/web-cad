// Every user-facing message of the geometry kernel (fail('…') and fixed warnings) has a Russian translation.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t } from './i18n';

const kernelDir = fileURLToPath(new URL('./kernel/', import.meta.url));

function kernelMessages(): string[] {
  const out = new Set<string>();
  for (const name of readdirSync(kernelDir)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const src = readFileSync(kernelDir + name, 'utf8');
    // fail('…'), { warning: '…' } and message constants (const NAME = 'Some words…')
    for (const m of src.matchAll(/\bfail\('([^']+)'\)|\bwarning: '([^']+)'|\bconst [A-Z_]+ = '([A-Z][^']* [^']*)'/g)) out.add(m[1] ?? m[2] ?? m[3]);
    // messages chosen inside fail(…), e.g. fail(cond ? 'A message' : 'Another one')
    for (const line of src.split('\n'))
      if (/\bfail\(/.test(line)) for (const m of line.matchAll(/'([A-Z][^']* [^']*)'/g)) out.add(m[1]);
  }
  return [...out];
}

describe('i18n', () => {
  it('translates every kernel error and warning', () => {
    const messages = kernelMessages();
    expect(messages.length).toBeGreaterThan(50);
    expect(messages.filter((m) => t(m) === m)).toEqual([]);
  });
});
