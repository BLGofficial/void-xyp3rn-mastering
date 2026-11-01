import { describe, expect, it } from 'vitest';
import { readCompressedHeader, sniffContainer } from '../lib/import';
import { encodeWav, createBuffer } from '../lib/engine';
import { encodeFlac, encodeMp3 } from './codec-fixtures';
import { program } from './signals';

const tone = (rate: number, channels: number, seconds = 1) => program(rate, seconds, channels, 0.5).map(c => Float32Array.from(c));
const headerError = (bytes: Uint8Array) => {
  try { readCompressedHeader(bytes); } catch (e) { return e as Error & { code?: string }; }
  return null;
};

describe('source container sniffing', () => {
  it('recognises WAV, FLAC, raw MP3 and ID3-tagged MP3', async () => {
    const b = createBuffer(44100, 2, 4410);
    expect(sniffContainer(new Uint8Array(await encodeWav(b, 'pcm16')))).toBe('wav');
    expect(sniffContainer(encodeFlac(tone(44100, 2), 44100, 16))).toBe('flac');
    expect(sniffContainer(encodeMp3(tone(44100, 2), 44100, 320))).toBe('mp3');
    expect(sniffContainer(encodeMp3(tone(44100, 2), 44100, 320, 2048))).toBe('mp3');
  });

  it.each([
    ['empty', new Uint8Array(0)],
    ['text', new TextEncoder().encode('hello, this is not audio at all')],
    ['OGG', new TextEncoder().encode('OggS\0\x02\0\0\0\0\0\0\0\0')],
    ['ID3 tag with nothing after it', Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0])],
  ])('refuses %s', (_, bytes) => {
    expect(sniffContainer(bytes)).toBeNull();
  });
});

describe('FLAC STREAMINFO', () => {
  it.each([
    [44100, 2, 16 as const],
    [48000, 2, 24 as const],
    [96000, 1, 24 as const],
    [192000, 6, 24 as const],
  ])('%i Hz, %i ch, %i-bit', (rate, channels, bits) => {
    const pcm = tone(rate, channels, 0.25);
    expect(readCompressedHeader(encodeFlac(pcm, rate, bits))).toEqual({
      container: 'flac', sampleRate: rate, channels, bitsPerSample: bits, length: pcm[0]!.length, bitrateKbps: null,
    });
  });

  it('rejects a truncated STREAMINFO with a coded error', () => {
    const e = headerError(encodeFlac(tone(44100, 2), 44100, 16).subarray(0, 20));
    expect(e?.code).toBe('UNSUPPORTED_SOURCE');
  });
});

describe('MP3 frame header', () => {
  it.each([
    [44100, 2, 320, 0],
    [48000, 1, 192, 0],
    [32000, 2, 128, 0],
    [44100, 2, 320, 4096],
    [22050, 2, 64, 300],
  ])('%i Hz, %i ch, %i kbps, ID3 %i bytes', (rate, channels, kbps, id3) => {
    const h = readCompressedHeader(encodeMp3(tone(rate, channels), rate, kbps, id3));
    expect(h).toEqual({ container: 'mp3', sampleRate: rate, channels, bitsPerSample: null, length: null, bitrateKbps: kbps });
  });

  it('ignores a false sync inside the ID3 padding region and confirms the next frame', () => {
    const mp3 = encodeMp3(tone(44100, 2), 44100, 320, 64);
    mp3.set([0xff, 0xfb, 0x90, 0x64], 20); // looks like a frame, but is inside the tag
    expect(readCompressedHeader(mp3).sampleRate).toBe(44100);
  });

  it('rejects bytes with no two consecutive valid frames', () => {
    const junk = Uint8Array.from({ length: 4000 }, (_, i) => (i % 417 === 0 ? 0xff : 0x11));
    expect(headerError(junk)?.code).toBe('UNSUPPORTED_SOURCE');
  });
});
