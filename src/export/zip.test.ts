import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zip';

interface ParsedEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  method: number;
}

/** Test-only ZIP reader (STORE entries only): walks the end record and central directory. */
function parseZip(buf: Uint8Array): ParsedEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder();
  const end = buf.length - 22;
  expect(dv.getUint32(end, true)).toBe(0x06054b50);
  const count = dv.getUint16(end + 10, true);
  const cdSize = dv.getUint32(end + 12, true);
  const cdOffset = dv.getUint32(end + 16, true);
  expect(cdOffset + cdSize).toBe(end);
  const out: ParsedEntry[] = [];
  let o = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(o, true)).toBe(0x02014b50);
    const flags = dv.getUint16(o + 8, true);
    const method = dv.getUint16(o + 10, true);
    const crc = dv.getUint32(o + 16, true);
    const csize = dv.getUint32(o + 20, true);
    const usize = dv.getUint32(o + 24, true);
    expect(csize).toBe(usize);
    const nameLen = dv.getUint16(o + 28, true);
    const extraLen = dv.getUint16(o + 30, true);
    const commentLen = dv.getUint16(o + 32, true);
    const localOffset = dv.getUint32(o + 42, true);
    const name = dec.decode(buf.subarray(o + 46, o + 46 + nameLen));
    o += 46 + nameLen + extraLen + commentLen;

    expect(dv.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(dv.getUint32(localOffset + 14, true)).toBe(crc);
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    expect(dec.decode(buf.subarray(localOffset + 30, localOffset + 30 + lNameLen))).toBe(name);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    out.push({ name, data: buf.subarray(dataStart, dataStart + csize), crc, flags, method });
  }
  expect(o).toBe(cdOffset + cdSize);
  return out;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('handles empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zipStore', () => {
  it('produces an archive that parses back with correct names, data and CRCs', () => {
    const bin = new Uint8Array([0, 1, 2, 255, 254, 128]);
    const zip = zipStore([
      { name: 'hello.txt', data: 'Hello, world!' },
      { name: 'dir/привет.bin', data: bin },
      { name: 'empty', data: '' },
    ]);
    expect(dv32(zip, 0)).toBe(0x04034b50);
    const entries = parseZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['hello.txt', 'dir/привет.bin', 'empty']);
    expect(new TextDecoder().decode(entries[0].data)).toBe('Hello, world!');
    expect([...entries[1].data]).toEqual([...bin]);
    expect(entries[2].data.length).toBe(0);
    for (const e of entries) {
      expect(e.method).toBe(0);
      expect(e.flags & 0x0800).toBe(0x0800);
      expect(crc32(e.data)).toBe(e.crc);
    }
  });

  it('writes a valid empty archive', () => {
    const zip = zipStore([]);
    expect(zip.length).toBe(22);
    expect(parseZip(zip)).toEqual([]);
  });
});

function dv32(buf: Uint8Array, o: number): number {
  return new DataView(buf.buffer, buf.byteOffset).getUint32(o, true);
}
