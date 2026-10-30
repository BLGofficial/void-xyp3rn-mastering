// RIFF/WAVE structure, memory admission, decode and encode. Everything is
// bounded before allocation: hostile headers can't make us allocate the file size.

import { check, checkpoint, fail, requireValue } from './errors';
import type { AudioData, EncodeOptions, EngineOptions, MemoryPlan, WavFormat, WavInfo } from './types';

/** RIFF size field is u32 plus the 8-byte header. */
export const MAX_FILE_BYTES = 0xffffffff + 8;
/** Max decoded samples (all channels) the engine will allocate. */
export const MAX_SAMPLES = 128 * 1024 * 1024;
const BLOCK = 32768;
const MAX_CHUNKS = 10000;
const EXTENSIBLE = 0xfffe;
// KSDATAFORMAT_SUBTYPE GUID suffix shared by PCM and IEEE float.
const KSDATA_TAIL = [0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];

const ascii = (view: DataView, offset: number, size: number) => {
  let text = '';
  for (let i = 0; i < size; i++) text += String.fromCharCode(view.getUint8(offset + i));
  return text;
};
const popcount = (mask: number) => {
  let n = 0;
  for (let m = mask >>> 0; m; m >>>= 1) n += m & 1;
  return n;
};

type Format = Pick<WavInfo, 'audioFormat' | 'channels' | 'sampleRate' | 'bitsPerSample' | 'blockAlign' | 'channelMask'>;

function readFormat(v: DataView, start: number, size: number): Format {
  let audioFormat = v.getUint16(start, true);
  const channels = v.getUint16(start + 2, true), sampleRate = v.getUint32(start + 4, true);
  const byteRate = v.getUint32(start + 8, true), blockAlign = v.getUint16(start + 12, true);
  const bitsPerSample = v.getUint16(start + 14, true);
  let channelMask = 0;
  requireValue(size === 16 || (size >= 18 && 18 + v.getUint16(start + 16, true) <= size), 'WAV format extension is truncated.');
  if (audioFormat === EXTENSIBLE) {
    requireValue(size >= 40 && v.getUint16(start + 16, true) >= 22 && 18 + v.getUint16(start + 16, true) <= size, 'WAV extensible format is incomplete.');
    // Padded containers (e.g. 20 valid bits in 24) would need per-sample masking; refuse rather than guess.
    requireValue(v.getUint16(start + 18, true) === bitsPerSample, 'WAV valid bit depth must match its container.');
    channelMask = v.getUint32(start + 20, true);
    requireValue(KSDATA_TAIL.every((b, i) => v.getUint8(start + 28 + i) === b), 'Unsupported WAV subformat GUID.');
    audioFormat = v.getUint32(start + 24, true);
    requireValue(channelMask === 0 || popcount(channelMask) === channels, 'WAV channel mask does not match its channel count.');
  }
  requireValue(channels >= 1 && channels <= 8, 'Supported WAV channel counts: 1-8.');
  requireValue(sampleRate >= 8000 && sampleRate <= 384000, 'Unsupported WAV sample rate (8-384 kHz supported).');
  requireValue((audioFormat === 1 && [16, 24, 32].includes(bitsPerSample)) || (audioFormat === 3 && bitsPerSample === 32),
    'Supported WAV encodings: 16/24/32-bit PCM and 32-bit IEEE float.');
  requireValue(blockAlign === (channels * bitsPerSample) / 8 && byteRate === sampleRate * blockAlign, 'WAV block alignment or byte rate is invalid.');
  return { audioFormat: audioFormat as 1 | 3, channels, sampleRate, bitsPerSample: bitsPerSample as 16 | 24 | 32, blockAlign, channelMask };
}

/** Only genre and recording date are read: bounded, printable, and never identity tags. */
function readInfoTags(v: DataView, start: number, size: number, tags: WavInfo['tags']) {
  let cursor = start + 4, entries = 0;
  while (cursor + 8 <= start + size && entries++ < MAX_CHUNKS) {
    const tag = ascii(v, cursor, 4), length = v.getUint32(cursor + 4, true), end = cursor + 8 + length;
    if (end + (length & 1) > start + size) break;
    if ((tag === 'IGNR' || tag === 'ICRD') && length <= 160) {
      const value = ascii(v, cursor + 8, length).split('\0')[0]!.replace(/[^\x20-\x7e]/g, '').trim();
      if (value) tags[tag === 'IGNR' ? 'genre' : 'recorded'] = value;
    }
    cursor = end + (length & 1);
  }
}

/**
 * Parse RIFF/WAVE structure and format without decoding samples.
 * @throws EngineError `UNSUPPORTED_WAV` on any structural or format violation.
 */
export function parseWav(bytes: ArrayBuffer): WavInfo {
  requireValue(bytes instanceof ArrayBuffer && bytes.byteLength >= 44, 'File is too small to be a WAV.');
  requireValue(bytes.byteLength <= MAX_FILE_BYTES, 'WAV exceeds RIFF size support.');
  const v = new DataView(bytes);
  requireValue(ascii(v, 0, 4) === 'RIFF' && ascii(v, 8, 4) === 'WAVE', 'Choose a RIFF/WAVE file. RF64 and compressed audio are not supported.');
  const end = v.getUint32(4, true) + 8;
  requireValue(end === bytes.byteLength, 'WAV RIFF length does not match the file.');
  let format: Format | undefined, data: { offset: number; size: number } | undefined;
  const tags: WavInfo['tags'] = {};
  for (let offset = 12, chunks = 0; offset < end;) {
    requireValue(++chunks <= MAX_CHUNKS, 'WAV contains too many chunks.');
    requireValue(offset + 8 <= end, 'WAV has a truncated chunk header.');
    const id = ascii(v, offset, 4), size = v.getUint32(offset + 4, true), start = offset + 8;
    const next = start + size + (size & 1);
    requireValue(next <= end, 'WAV contains a truncated chunk or missing padding.');
    if (id === 'fmt ') {
      requireValue(!format && size >= 16, 'WAV has a duplicate or incomplete format chunk.');
      format = readFormat(v, start, size);
    } else if (id === 'LIST' && size >= 4 && ascii(v, start, 4) === 'INFO') {
      readInfoTags(v, start, size, tags);
    } else if (id === 'data') {
      requireValue(!data && size > 0, 'WAV must contain one nonempty audio data chunk.');
      data = { offset: start, size };
    }
    offset = next;
  }
  requireValue(format && data, 'WAV is missing its format or audio data chunk.');
  requireValue(data.size % format.blockAlign === 0, 'WAV ends in a partial audio frame.');
  return { ...format, ...data, length: data.size / format.blockAlign, tags };
}

/**
 * Estimate resident memory for decode + playback + render + export, against a device budget.
 * @throws EngineError `FILE_TOO_LARGE` beyond structural limits, `MEMORY_WARNING` over budget.
 */
export function memoryPlan(info: { sampleRate: number; channels: number; length: number; bitsPerSample: number }, options: EngineOptions & { fileBytes?: number } = {}): MemoryPlan {
  const { sampleRate, channels, length, bitsPerSample } = info;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000 || !Number.isInteger(channels) || channels < 1 || channels > 8 ||
    !Number.isSafeInteger(length) || length <= 0 || ![16, 24, 32].includes(bitsPerSample)) {
    fail('UNSUPPORTED_WAV', 'Invalid WAV dimensions for memory planning.');
  }
  const decodedBytes = length * channels * 4;
  const fileBytes = options.fileBytes ?? (length * channels * bitsPerSample) / 8 + 4096;
  const deviceGiB = options.deviceMemory ?? (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory;
  const budgetBytes = options.budgetBytes ?? Math.min(4, Math.max(0.5, Number.isFinite(deviceGiB) ? deviceGiB! * 0.4 : 2)) * 1024 ** 3;
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0 || !Number.isSafeInteger(fileBytes) || fileBytes <= 0) {
    fail('MEMORY_WARNING', 'Invalid memory budget or file size.');
  }
  // Decoded source, playback copy and analysis scratch are resident together.
  const workingBytes = decodedBytes * 3;
  // Render input + output, each with up to 8 s of effect tail.
  const renderBytes = (decodedBytes + Math.ceil(sampleRate * 8) * channels * 4) * 2;
  // Reserve the larger float export too: accepting a PCM file must not produce a
  // same-length float WAV that this budget would then refuse to re-import.
  const encodedBytes = Math.max(fileBytes, decodedBytes + 4096) + Math.max(0, fileBytes - decodedBytes - 4096);
  const estimatedBytes = encodedBytes + decodedBytes + workingBytes + renderBytes + 64 * 1024 ** 2;
  const plan: MemoryPlan = { fileBytes, duration: length / sampleRate, sampleRate, channels, bitsPerSample, decodedBytes, encodedBytes, workingBytes, renderBytes, estimatedBytes, budgetBytes };
  if (fileBytes > MAX_FILE_BYTES || length * channels > MAX_SAMPLES) fail('FILE_TOO_LARGE', 'WAV exceeds the supported RIFF or decoded-buffer dimensions.');
  if (estimatedBytes > budgetBytes) {
    fail('MEMORY_WARNING', `Estimated working memory ${Math.ceil(estimatedBytes / 1024 ** 2)} MiB exceeds this device budget of ${Math.floor(budgetBytes / 1024 ** 2)} MiB. Use a shorter track or lower sample rate.`);
  }
  return plan;
}

/**
 * Validate a WAV File/Blob from its headers only, before reading the audio into memory.
 * `data` may precede `fmt`; other chunks are skipped without loading their payloads.
 */
export async function preflightWav(file: Blob, options: EngineOptions = {}): Promise<MemoryPlan> {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 44 || file.size > MAX_FILE_BYTES) fail('FILE_TOO_LARGE', 'Choose a nonempty supported RIFF/WAVE file.');
  const read = async (start: number, count: number) => {
    check(options.signal);
    const bytes = await file.slice(start, start + count).arrayBuffer();
    check(options.signal);
    if (bytes.byteLength !== count) fail('UNSUPPORTED_WAV', 'Truncated WAV header.');
    return new DataView(bytes);
  };
  const header = await read(0, 12);
  if (ascii(header, 0, 4) !== 'RIFF' || ascii(header, 8, 4) !== 'WAVE' || header.getUint32(4, true) + 8 !== file.size) {
    fail('UNSUPPORTED_WAV', 'Invalid RIFF/WAVE length or signature.');
  }
  let format: DataView | undefined, dataSize: number | undefined;
  for (let offset = 12, chunks = 0; offset < file.size;) {
    if (++chunks > MAX_CHUNKS || offset + 8 > file.size) fail('UNSUPPORTED_WAV', 'Invalid WAV chunk structure.');
    const h = await read(offset, 8), id = ascii(h, 0, 4), size = h.getUint32(4, true);
    const next = offset + 8 + size + (size & 1);
    if (next > file.size) fail('UNSUPPORTED_WAV', 'Truncated WAV chunk.');
    if (id === 'fmt ') {
      if (format || size < 16 || size > 65554) fail('UNSUPPORTED_WAV', 'Invalid WAV format chunk.');
      format = await read(offset + 8, size);
    } else if (id === 'data') {
      if (dataSize !== undefined || !size) fail('UNSUPPORTED_WAV', 'WAV needs one nonempty data chunk.');
      dataSize = size;
    }
    offset = next;
  }
  if (!format || !dataSize) return fail('UNSUPPORTED_WAV', 'Missing WAV format or audio data.');
  const align = format.getUint16(12, true);
  if (!align || align > 32 || dataSize % align) fail('UNSUPPORTED_WAV', 'Invalid WAV block alignment.');
  // Reuse the strict format validation on a one-frame surrogate WAV.
  const fmtSize = format.byteLength, dataOffset = 28 + fmtSize + (fmtSize & 1);
  const bytes = new ArrayBuffer(dataOffset + align + (align & 1)), v = new DataView(bytes);
  const write = (p: number, s: string) => [...s].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
  write(0, 'RIFF'); v.setUint32(4, bytes.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt '); v.setUint32(16, fmtSize, true);
  new Uint8Array(bytes, 20, fmtSize).set(new Uint8Array(format.buffer));
  write(dataOffset - 8, 'data'); v.setUint32(dataOffset - 4, align, true);
  const info = parseWav(bytes);
  return memoryPlan({ ...info, length: dataSize / align }, { ...options, fileBytes: file.size });
}

/** Allocate silent planar float32 audio. */
export function createBuffer(sampleRate: number, channels: number, length: number, channelMask = 0): AudioData {
  requireValue(Number.isInteger(sampleRate) && sampleRate >= 8000 && sampleRate <= 384000, 'Invalid audio sample rate.');
  requireValue(Number.isInteger(channels) && channels >= 1 && channels <= 8 && Number.isInteger(length) && length > 0 && length * channels <= MAX_SAMPLES, 'Invalid audio buffer size.');
  return { sampleRate, length, duration: length / sampleRate, numberOfChannels: channels, channelMask, channels: Array.from({ length: channels }, () => new Float32Array(length)) };
}

export function validateBuffer(b: AudioData): void {
  requireValue(b && Number.isInteger(b.sampleRate) && b.sampleRate >= 8000 && b.sampleRate <= 384000 &&
    Number.isInteger(b.length) && b.length > 0 && b.numberOfChannels >= 1 && b.numberOfChannels <= 8 &&
    b.length * b.numberOfChannels <= MAX_SAMPLES && Array.isArray(b.channels) && b.channels.length === b.numberOfChannels &&
    b.channels.every(c => c instanceof Float32Array && c.length === b.length), 'Invalid floating-point audio buffer.');
}

/** Decode 16/24/32-bit PCM or 32-bit float WAV to planar float32 (integers scaled by 2^(bits-1)). */
export async function decodeWav(bytes: ArrayBuffer, options: EngineOptions = {}): Promise<{ buffer: AudioData; metadata: WavInfo }> {
  const metadata = parseWav(bytes);
  memoryPlan(metadata, { ...options, fileBytes: bytes.byteLength });
  const buffer = createBuffer(metadata.sampleRate, metadata.channels, metadata.length, metadata.channelMask);
  const v = new DataView(bytes), step = metadata.bitsPerSample / 8, isFloat = metadata.audioFormat === 3;
  for (let base = 0; base < buffer.length; base += BLOCK) {
    await checkpoint(options);
    options.onProgress?.(base / buffer.length);
    const end = Math.min(base + BLOCK, buffer.length);
    for (let i = base; i < end; i++) {
      for (let c = 0; c < metadata.channels; c++) {
        const p = metadata.offset + i * metadata.blockAlign + c * step;
        let sample: number;
        if (isFloat) sample = v.getFloat32(p, true);
        else if (step === 2) sample = v.getInt16(p, true) / 32768;
        else if (step === 3) sample = (((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16)) << 8) >> 8) / 8388608;
        else sample = v.getInt32(p, true) / 2147483648;
        requireValue(Number.isFinite(sample), 'WAV contains a non-finite audio sample.');
        buffer.channels[c]![i] = sample;
      }
    }
  }
  options.onProgress?.(1);
  return { buffer, metadata };
}

/** Numerical Recipes LCG: reproducible dither for a given seed. */
const lcg = (seed: number) => () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 4294967296;
};

/**
 * Encode planar float32 to WAV (extensible for >2 channels or an explicit speaker mask).
 * PCM formats refuse out-of-range samples instead of clipping them.
 */
export async function encodeWav(buffer: AudioData, format: WavFormat = 'float32', options: EncodeOptions = {}): Promise<ArrayBuffer> {
  validateBuffer(buffer);
  requireValue(['float32', 'pcm16', 'pcm24'].includes(format), 'This WAV export format is not supported.');
  const isFloat = format === 'float32', bits = isFloat ? 32 : format === 'pcm16' ? 16 : 24, step = bits / 8;
  const channels = buffer.numberOfChannels, align = step * channels, dataSize = buffer.length * align;
  const extensible = channels > 2 || !!buffer.channelMask;
  const fmtSize = extensible ? 40 : isFloat ? 18 : 16;
  // Float WAVs carry a `fact` chunk (frame count), as the spec requires for non-PCM.
  const dataOffset = 12 + 8 + fmtSize + (isFloat ? 12 : 0) + 8;
  const bytes = new ArrayBuffer(dataOffset + dataSize + (dataSize & 1)), v = new DataView(bytes);
  const write = (p: number, text: string) => { for (let i = 0; i < text.length; i++) v.setUint8(p + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); v.setUint32(4, bytes.byteLength - 8, true); write(8, 'WAVE');
  write(12, 'fmt '); v.setUint32(16, fmtSize, true); v.setUint16(20, extensible ? EXTENSIBLE : isFloat ? 3 : 1, true);
  v.setUint16(22, channels, true); v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * align, true); v.setUint16(32, align, true); v.setUint16(34, bits, true);
  if (extensible) {
    v.setUint16(36, 22, true); v.setUint16(38, bits, true); v.setUint32(40, buffer.channelMask || 0, true);
    v.setUint32(44, isFloat ? 3 : 1, true);
    KSDATA_TAIL.forEach((b, i) => v.setUint8(48 + i, b));
  }
  if (isFloat) { const p = 20 + fmtSize; write(p, 'fact'); v.setUint32(p + 4, 4, true); v.setUint32(p + 8, buffer.length, true); }
  write(dataOffset - 8, 'data'); v.setUint32(dataOffset - 4, dataSize, true);

  const seed = options.ditherSeed;
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) fail('EXPORT_FAILED', 'Dither seed must be an unsigned 32-bit integer.');
  const random = seed === undefined ? Math.random : lcg(seed);
  const scale = 2 ** (bits - 1);
  for (let base = 0; base < buffer.length; base += BLOCK) {
    await checkpoint(options);
    for (let i = base; i < Math.min(base + BLOCK, buffer.length); i++) {
      for (let c = 0; c < channels; c++) {
        const sample = buffer.channels[c]![i]!;
        requireValue(Number.isFinite(sample), 'Cannot export non-finite audio samples.');
        const p = dataOffset + i * align + c * step;
        if (isFloat) { v.setFloat32(p, sample, true); continue; }
        requireValue(sample >= -1 && sample <= (scale - 1) / scale, 'Audio exceeds the selected PCM range. Choose 32-bit float to keep samples without clipping.');
        // TPDF dither (difference of two uniforms), applied once at the final quantization.
        const noise = options.dither ? random() - random() : 0;
        const q = Math.max(-scale, Math.min(scale - 1, Math.round(sample * scale + noise)));
        if (bits === 16) v.setInt16(p, q, true);
        else { v.setUint8(p, q & 255); v.setUint8(p + 1, (q >> 8) & 255); v.setUint8(p + 2, (q >> 16) & 255); }
      }
    }
  }
  return bytes;
}
