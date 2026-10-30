// Hand-built RIFF/WAVE files, valid and deliberately malformed, so parsing is
// tested against byte layouts the encoder under test never produces itself.

import { program } from './signals';

const KSDATA_TAIL = [0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];

export interface WavSpec {
  audioFormat?: 1 | 3;
  bits?: number;
  channels?: number;
  sampleRate?: number;
  frames?: number;
  /** Write WAVE_FORMAT_EXTENSIBLE with this mask. */
  extensibleMask?: number;
  validBits?: number;
  guidTail?: number[];
  blockAlign?: number;
  byteRate?: number;
  /** Extra chunks inserted between fmt and data (or before fmt when dataFirst). */
  extra?: Array<{ id: string; payload: Uint8Array }>;
  dataFirst?: boolean;
  duplicateFmt?: boolean;
  omitData?: boolean;
  /** Override data chunk size field (payload length stays as computed). */
  dataSizeField?: number;
  /** Drop trailing bytes from the data payload (partial frame). */
  trimData?: number;
  /** Override sample values, e.g. to inject NaN. */
  poke?: (frame: number, channel: number, value: number) => number;
  /** Override RIFF size field. */
  riffSizeDelta?: number;
}

const ascii = (s: string) => Uint8Array.from(s, ch => ch.charCodeAt(0));

function chunk(id: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length + (payload.length & 1));
  out.set(ascii(id), 0);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

/** INFO list chunk with the given tags (values NUL-terminated as writers do). */
export function infoList(tags: Record<string, string>): { id: string; payload: Uint8Array } {
  const parts = Object.entries(tags).map(([tag, value]) => chunk(tag, ascii(`${value}\0`)));
  const body = new Uint8Array(4 + parts.reduce((n, p) => n + p.length, 0));
  body.set(ascii('INFO'), 0);
  let at = 4;
  for (const part of parts) { body.set(part, at); at += part.length; }
  return { id: 'LIST', payload: body };
}

/** @returns A WAV file as an ArrayBuffer built from `spec` and a deterministic programme signal. */
export function buildWav(spec: WavSpec = {}): ArrayBuffer {
  const { audioFormat = 1, bits = 16, channels = 2, sampleRate = 48000, frames = 4800 } = spec;
  const step = bits / 8, blockAlign = spec.blockAlign ?? channels * step;
  const ext = spec.extensibleMask !== undefined;
  const fmt = new Uint8Array(ext ? 40 : audioFormat === 3 ? 18 : 16), f = new DataView(fmt.buffer);
  f.setUint16(0, ext ? 0xfffe : audioFormat, true);
  f.setUint16(2, channels, true);
  f.setUint32(4, sampleRate, true);
  f.setUint32(8, spec.byteRate ?? sampleRate * blockAlign, true);
  f.setUint16(12, blockAlign, true);
  f.setUint16(14, bits, true);
  if (ext) {
    f.setUint16(16, 22, true);
    f.setUint16(18, spec.validBits ?? bits, true);
    f.setUint32(20, spec.extensibleMask!, true);
    f.setUint32(24, audioFormat, true);
    (spec.guidTail ?? KSDATA_TAIL).forEach((v, i) => f.setUint8(28 + i, v));
  } else if (audioFormat === 3) f.setUint16(16, 0, true);

  const sig = program(sampleRate, frames / sampleRate, Math.max(1, Math.min(channels, 8)), 0.9);
  const data = new Uint8Array(Math.max(0, frames * channels * step - (spec.trimData ?? 0))), d = new DataView(data.buffer);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const p = (i * channels + c) * step;
      if (p + step > data.length) continue;
      let v = sig[c % sig.length]![i]!;
      if (spec.poke) v = spec.poke(i, c, v);
      if (audioFormat === 3) d.setFloat32(p, v, true);
      else if (bits === 8) d.setUint8(p, Math.round(v * 127) + 128);
      else if (bits === 16) d.setInt16(p, Math.round(v * 32767), true);
      else if (bits === 24) { const n = Math.round(v * 8388607); d.setUint8(p, n & 255); d.setUint8(p + 1, (n >> 8) & 255); d.setUint8(p + 2, (n >> 16) & 255); }
      else d.setInt32(p, Math.round(v * 2147483647), true);
    }
  }
  const dataChunk = chunk('data', data);
  if (spec.dataSizeField !== undefined) new DataView(dataChunk.buffer).setUint32(4, spec.dataSizeField, true);
  const extra = (spec.extra ?? []).map(e => chunk(e.id, e.payload));
  const fmtChunk = chunk('fmt ', fmt);
  const body = spec.dataFirst
    ? [...extra, ...(spec.omitData ? [] : [dataChunk]), fmtChunk]
    : [fmtChunk, ...(spec.duplicateFmt ? [fmtChunk] : []), ...extra, ...(spec.omitData ? [] : [dataChunk])];
  const size = 12 + body.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  out.set(ascii('RIFF'), 0);
  v.setUint32(4, size - 8 + (spec.riffSizeDelta ?? 0), true);
  out.set(ascii('WAVE'), 8);
  let at = 12;
  for (const b of body) { out.set(b, at); at += b.length; }
  return out.buffer;
}

/** Patch ASCII at a byte offset (e.g. to corrupt a signature). */
export function patchAscii(bytes: ArrayBuffer, offset: number, text: string): ArrayBuffer {
  const copy = bytes.slice(0), u = new Uint8Array(copy);
  u.set(ascii(text), offset);
  return copy;
}
