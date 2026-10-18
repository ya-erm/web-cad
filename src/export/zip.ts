// Minimal ZIP writer (STORE method, no compression), browser compatible.
// Used for 3MF packages and multi-file exports.

export interface ZipEntry {
  /** Path inside the archive, '/' separated. */
  name: string;
  /** File content; strings are encoded as UTF-8. */
  data: Uint8Array | string;
}

export interface ZipOptions {
  /** Modification timestamp written for every entry (default: now). */
  date?: Date;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Standard CRC-32 (IEEE 802.3, as used by ZIP/PNG). */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, d.getFullYear()));
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const VERSION = 20;

export function zipStore(files: ZipEntry[], opts: ZipOptions = {}): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(opts.date ?? new Date());
  if (files.length > 0xffff) throw new Error('zipStore: too many entries (ZIP64 not supported)');

  const entries = files.map((f) => {
    const name = enc.encode(f.name.replace(/\\/g, '/').replace(/^\/+/, ''));
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    return { name, data, crc: crc32(data), offset: 0 };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const e of entries) {
    localSize += 30 + e.name.length + e.data.length;
    centralSize += 46 + e.name.length;
  }
  const total = localSize + centralSize + 22;
  if (total > 0xffffffff) throw new Error('zipStore: archive too large (ZIP64 not supported)');

  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  let o = 0;
  const u16 = (v: number) => {
    dv.setUint16(o, v, true);
    o += 2;
  };
  const u32 = (v: number) => {
    dv.setUint32(o, v >>> 0, true);
    o += 4;
  };
  const bytes = (b: Uint8Array) => {
    buf.set(b, o);
    o += b.length;
  };

  for (const e of entries) {
    e.offset = o;
    u32(SIG_LOCAL);
    u16(VERSION); // version needed to extract
    u16(FLAG_UTF8);
    u16(0); // method: STORE
    u16(time);
    u16(date);
    u32(e.crc);
    u32(e.data.length); // compressed size
    u32(e.data.length); // uncompressed size
    u16(e.name.length);
    u16(0); // extra length
    bytes(e.name);
    bytes(e.data);
  }

  const cdStart = o;
  for (const e of entries) {
    u32(SIG_CENTRAL);
    u16(VERSION); // version made by (MS-DOS, 2.0)
    u16(VERSION); // version needed
    u16(FLAG_UTF8);
    u16(0);
    u16(time);
    u16(date);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(e.offset);
    bytes(e.name);
  }
  const cdSize = o - cdStart;

  u32(SIG_END);
  u16(0); // this disk
  u16(0); // disk with central directory
  u16(entries.length);
  u16(entries.length);
  u32(cdSize);
  u32(cdStart);
  u16(0); // comment length
  return buf;
}
