import { describe, expect, it } from 'vitest';
import { isIPad } from './inputDevice';

describe('iPad settings visibility', () => {
  it.each([
    ['iPad Safari', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 'iPad', 5, true],
    ['desktop iPad Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 5, true],
    ['Mac with trackpad', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 0, false],
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5, false],
    ['Android tablet', 'Mozilla/5.0 (Linux; Android 15)', 'Linux armv8l', 5, false],
    ['Windows touch laptop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 10, false],
  ])('%s', (_label, userAgent, platform, maxTouchPoints, expected) => {
    expect(isIPad({ userAgent, platform, maxTouchPoints })).toBe(expected);
  });
  it('handles a missing browser', () => expect(isIPad(undefined)).toBe(false));
});
