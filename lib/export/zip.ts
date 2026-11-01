import { check, fail } from '../engine/errors';
import type { ZipEntry } from './types';

const enc = new TextEncoder();
const CHUNK = 1 << 20;
const LIMIT = 0xffffffff;
const yieldToLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 in 1 MiB slices, yielding between them so a long master never freezes the page. */
async function crc32(blob: Blob, signal?: AbortSignal): Promise<number> {
  let c = 0xffffffff;
  for (let at = 0; at < blob.size; at += CHUNK) {
    check(signal);
    const bytes = new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer());
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
    await yieldToLoop();
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time (UTC, 2 s resolution; years before 1980 clamp to 1980). */
function dosStamp(date: string) {
  const d = new Date(date);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    day: ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/**
 * Stored (uncompressed) ZIP: audio and JPEG-backed PDFs don't deflate usefully,
 * and storing keeps the bundle dependency-free. Flat names only, UTF-8 flagged,
 * classic 32-bit ZIP (no ZIP64): refuses anything near 4 GB.
 */
export async function zip(entries: ZipEntry[], date: string, signal?: AbortSignal): Promise<Blob> {
  const { time, day } = dosStamp(date);
  const parts: BlobPart[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    check(signal);
    const name = enc.encode(entry.name);
    if (/[\\/]/.test(entry.name) || name.length > 0xffff) fail('EXPORT_FAILED', 'Invalid archive filename.');
    const blob = entry.data instanceof Blob ? entry.data : new Blob([entry.data as BlobPart]);
    if (offset + blob.size + name.length + 100 > LIMIT) fail('EXPORT_FAILED', 'The report bundle would exceed 4 GB. Export the audio on its own.');
    const crc = await crc32(blob, signal);

    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); // local file header
    l.setUint16(4, 20, true);         // version needed: 2.0
    l.setUint16(6, 0x800, true);      // bit 11: UTF-8 name
    l.setUint16(10, time, true);
    l.setUint16(12, day, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, blob.size, true); // compressed = uncompressed (stored)
    l.setUint32(22, blob.size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, blob);

    const dir = new Uint8Array(46 + name.length), d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true); // central directory header
    d.setUint16(4, 20, true);         // version made by
    dir.set(local.subarray(4, 28), 6); // shared fields: version needed .. name length
    d.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);
    offset += local.length + blob.size;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  if (offset + centralSize + 22 > LIMIT || entries.length > 0xffff) fail('EXPORT_FAILED', 'The archive exceeds ZIP limits.');
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  check(signal);
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' });
}
