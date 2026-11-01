// Compressed-source fixtures built in-process, so tests need no ffmpeg/flac binaries.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Minimal FLAC encoder: VERBATIM subframes, fixed 4096-frame blocks, independent
 * channels. Lossless and spec-valid (RFC 9639), just uncompressed.
 */
export function encodeFlac(channels: Float32Array[] | Float64Array[], sampleRate: number, bitsPerSample: 16 | 24): Uint8Array {
  const block = 4096, n = channels[0]!.length, scale = 2 ** (bitsPerSample - 1);
  const out: number[] = [];
  const bits = { acc: 0, count: 0 };
  const put = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) {
      bits.acc = (bits.acc << 1) | (Math.floor(value / 2 ** i) & 1);
      if (++bits.count === 8) { out.push(bits.acc & 255); bits.acc = 0; bits.count = 0; }
    }
  };
  for (const c of 'fLaC') out.push(c.charCodeAt(0));
  put(1, 1); put(0, 7); put(34, 24); // last metadata block, STREAMINFO, 34 bytes
  put(block, 16); put(block, 16); put(0, 24); put(0, 24);
  put(sampleRate, 20); put(channels.length - 1, 3); put(bitsPerSample - 1, 5);
  put(Math.floor(n / 2 ** 32), 4); put(n % 2 ** 32, 32);
  for (let i = 0; i < 16; i++) put(0, 8); // MD5 unknown

  for (let frame = 0, at = 0; at < n; frame++, at += block) {
    const size = Math.min(block, n - at), start = out.length;
    put(0xfff8, 16);
    put(0b0111, 4); put(0b0000, 4); // 16-bit (blocksize-1) follows; rate from STREAMINFO
    put(channels.length - 1, 4); put(bitsPerSample === 16 ? 0b100 : 0b110, 3); put(0, 1);
    if (frame < 0x80) put(frame, 8); else { put(0xc0 | (frame >> 6), 8); put(0x80 | (frame & 0x3f), 8); }
    put(size - 1, 16);
    out.push(crc8(out.slice(start)));
    for (const ch of channels) {
      put(0b00000010, 8); // zero pad, VERBATIM, no wasted bits
      for (let i = 0; i < size; i++) {
        const v = Math.max(-scale, Math.min(scale - 1, Math.round(ch[at + i]! * scale)));
        put(v < 0 ? v + 2 * scale : v, bitsPerSample);
      }
    }
    const crc = crc16(out.slice(start));
    out.push(crc >> 8, crc & 255);
  }
  return Uint8Array.from(out);
}

function crc8(bytes: number[]) {
  let c = 0;
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255; }
  return c;
}
function crc16(bytes: number[]) {
  let c = 0;
  for (const b of bytes) { c ^= b << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; }
  return c;
}

/** MP3 via the same LAME build the app ships (lamejs), optionally behind an ID3v2 tag. */
export function encodeMp3(channels: Float32Array[] | Float64Array[], sampleRate: number, kbps: number, id3Bytes = 0): Uint8Array {
  // lamejs's CommonJS entry is broken (MPEGMode undefined); its bundled build is what the app ships anyway.
  const bundle = readFileSync(createRequire(import.meta.url).resolve('lamejs/lame.all.js'), 'utf8');
  const { Mp3Encoder } = new Function(`${bundle}\nreturn lamejs;`)() as { Mp3Encoder: new (c: number, r: number, k: number) => { encodeBuffer(l: Int16Array, r?: Int16Array): Int8Array; flush(): Int8Array } };
  const enc = new Mp3Encoder(channels.length, sampleRate, kbps);
  const pcm = channels.map(c => Int16Array.from(c, v => Math.max(-32768, Math.min(32767, Math.round(v * 32768)))));
  const parts: Int8Array[] = [];
  for (let i = 0; i < pcm[0]!.length; i += 1152) parts.push(enc.encodeBuffer(pcm[0]!.subarray(i, i + 1152), pcm[1]?.subarray(i, i + 1152)));
  parts.push(enc.flush());
  const audio = parts.flatMap(p => Array.from(new Uint8Array(p.buffer, p.byteOffset, p.length)));
  if (!id3Bytes) return Uint8Array.from(audio);
  // ID3v2.4 header with a syncsafe size, then padding.
  const s = id3Bytes;
  const tag = [0x49, 0x44, 0x33, 4, 0, 0, (s >> 21) & 127, (s >> 14) & 127, (s >> 7) & 127, s & 127, ...new Array(s).fill(0)];
  return Uint8Array.from([...tag, ...audio]);
}
