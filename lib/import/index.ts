// Source container sniffing and header parsing. Compressed sources are decoded by
// the platform; these headers give the native rate so nothing is resampled.

import { fail } from '../engine/errors';

export type Container = 'wav' | 'flac' | 'mp3';

/** What the Source panel and report show about an imported file. */
export interface SourceInfo {
  container: Container;
  sampleRate: number;
  channels: number;
  /** Frames; for compressed sources, after decoding. */
  length: number;
  /** Null for MP3: the codec has no PCM word length. */
  bitsPerSample: number | null;
  float: boolean;
  lossy: boolean;
  bitrateKbps: number | null;
  channelMask: number;
}

export interface CompressedHeader {
  container: 'flac' | 'mp3';
  sampleRate: number;
  channels: number;
  bitsPerSample: number | null;
  /** Total frames when the header states it (FLAC STREAMINFO), else null. */
  length: number | null;
  bitrateKbps: number | null;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const bad = (message: string): never => fail('UNSUPPORTED_SOURCE', message);

/** Identify a source from its first bytes. MP3 must show two consecutive valid frames. */
export function sniffContainer(bytes: Uint8Array): Container | null {
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav';
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'fLaC') return 'flac';
  return findMp3Frame(bytes) ? 'mp3' : null;
}

/** Native format of a FLAC or MP3 source, from its header alone. */
export function readCompressedHeader(bytes: Uint8Array): CompressedHeader {
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'fLaC') return flacStreamInfo(bytes);
  const frame = findMp3Frame(bytes) ?? bad('No MPEG audio frames found. Choose a WAV, FLAC or MP3 file.');
  return { container: 'mp3', sampleRate: frame.sampleRate, channels: frame.channels, bitsPerSample: null, length: null, bitrateKbps: frame.kbps };
}

/** STREAMINFO is mandatory and always the first metadata block (RFC 9639 §8.2). */
function flacStreamInfo(b: Uint8Array): CompressedHeader {
  if (b.length < 42 || (b[4]! & 0x7f) !== 0 || ((b[5]! << 16) | (b[6]! << 8) | b[7]!) !== 34) bad('Truncated or invalid FLAC STREAMINFO.');
  const at = 18; // 4 'fLaC' + 4 block header + 10 bytes of block/frame sizes
  const sampleRate = (b[at]! << 12) | (b[at + 1]! << 4) | (b[at + 2]! >> 4);
  const channels = ((b[at + 2]! >> 1) & 7) + 1;
  const bitsPerSample = (((b[at + 2]! & 1) << 4) | (b[at + 3]! >> 4)) + 1;
  const total = (b[at + 3]! & 0x0f) * 2 ** 32 + ((b[at + 4]! << 24) >>> 0) + (b[at + 5]! << 16) + (b[at + 6]! << 8) + b[at + 7]!;
  if (sampleRate === 0) bad('FLAC stream has no sample rate.');
  return { container: 'flac', sampleRate, channels, bitsPerSample, length: total || null, bitrateKbps: null };
}

// MPEG audio Layer III tables (ISO/IEC 11172-3, 13818-3; 2.5 is the de-facto extension).
const KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES = [44100, 48000, 32000];
/** Search window past any ID3v2 tag: encoders pad, but not by this much. */
const SCAN_BYTES = 64 * 1024;

interface Mp3Frame { version: number; sampleRate: number; channels: number; kbps: number; bytes: number }

function mp3FrameAt(b: Uint8Array, i: number): Mp3Frame | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1]! >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (b[i + 1]! >> 1) & 3; // 1 = Layer III
  const rateIndex = (b[i + 2]! >> 2) & 3, kbpsIndex = b[i + 2]! >> 4;
  if (version === 1 || layer !== 1 || rateIndex === 3 || kbpsIndex === 0 || kbpsIndex === 15) return null;
  const mpeg1 = version === 3;
  const sampleRate = RATES[rateIndex]! / (mpeg1 ? 1 : version === 2 ? 2 : 4);
  const kbps = (mpeg1 ? KBPS_V1 : KBPS_V2)[kbpsIndex]!;
  const padding = (b[i + 2]! >> 1) & 1;
  const bytes = Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / sampleRate) + padding;
  return { version, sampleRate, channels: b[i + 3]! >> 6 === 3 ? 1 : 2, kbps, bytes };
}

/** First frame (after any ID3v2 tag) that is followed by a matching frame. */
function findMp3Frame(b: Uint8Array): Mp3Frame | null {
  let start = 0;
  if (b.length >= 10 && ascii(b, 0, 3) === 'ID3') {
    const size = ((b[6]! & 127) << 21) | ((b[7]! & 127) << 14) | ((b[8]! & 127) << 7) | (b[9]! & 127);
    start = 10 + size + (b[5]! & 0x10 ? 10 : 0); // footer flag
  }
  for (let i = start; i < Math.min(b.length - 4, start + SCAN_BYTES); i++) {
    const f = mp3FrameAt(b, i);
    if (!f) continue;
    const next = mp3FrameAt(b, i + f.bytes);
    if (next && next.version === f.version && next.sampleRate === f.sampleRate) return f;
  }
  return null;
}
