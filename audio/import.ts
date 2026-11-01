// Compressed-source import on the UI thread: the platform decoder (decodeAudioData)
// at the file's native rate, so FLAC stays sample-exact and nothing is resampled.
// WAV never comes here; the engine worker parses it directly.

import { EngineError, MAX_FILE_BYTES, MAX_SAMPLES } from '../lib/engine';
import { readCompressedHeader, sniffContainer, type Container, type SourceInfo } from '../lib/import';
import type { PlainAudio } from './protocol';

/** Enough to clear a large ID3v2 tag (cover art) and see two MP3 frames. */
const HEAD_BYTES = 512 * 1024;

export async function sniffFile(file: File): Promise<Container> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  return sniffContainer(head) ?? (() => {
    throw new EngineError('UNSUPPORTED_SOURCE', 'Unsupported file. Choose a WAV, FLAC or MP3.');
  })();
}

export async function decodeCompressed(file: File): Promise<{ audio: PlainAudio; info: SourceInfo }> {
  if (file.size > MAX_FILE_BYTES) throw new EngineError('FILE_TOO_LARGE', 'File is too large to import.');
  const header = readCompressedHeader(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()));
  // FLAC states its length up front: refuse before allocating. MP3 is checked after decoding.
  if (header.length !== null && header.length * header.channels > MAX_SAMPLES) {
    throw new EngineError('MEMORY_WARNING', 'This file decodes to more audio than the engine can hold. Try a shorter file.');
  }
  let decoded: AudioBuffer;
  try {
    decoded = await new OfflineAudioContext(1, 1, header.sampleRate).decodeAudioData(await file.arrayBuffer());
  } catch (error) {
    throw new EngineError('DECODE_FAILED', `This browser could not decode the ${header.container.toUpperCase()} file: ${(error as Error).message || 'unknown error'}`);
  }
  if (decoded.numberOfChannels > 8) throw new EngineError('UNSUPPORTED_SOURCE', 'Sources with more than 8 channels are not supported.');
  if (decoded.length * decoded.numberOfChannels > MAX_SAMPLES) {
    throw new EngineError('MEMORY_WARNING', 'This file decodes to more audio than the engine can hold. Try a shorter file.');
  }
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c).slice());
  return {
    audio: { sampleRate: decoded.sampleRate, channels },
    info: {
      container: header.container, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, length: decoded.length,
      bitsPerSample: header.bitsPerSample, float: false, lossy: header.container === 'mp3', bitrateKbps: header.bitrateKbps, channelMask: 0,
    },
  };
}
