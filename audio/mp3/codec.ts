// Browser MP3 codec: LAME in a Worker for encoding, the platform decoder for the
// decoded-peak check. Plugs into lib/export's encodeCheckedMp3.

import { EngineError, type AudioData } from '../../lib/engine';
import type { Mp3Codec } from '../../lib/export';
import { MP3_CHUNK_FRAMES, MP3_WORKER_URL, type Mp3Reply, type Mp3Request } from './protocol';

/** No reply for this long means the worker is stuck, not slow: chunks take milliseconds. */
const WORKER_IDLE_MS = 60_000;
const DECODE_TIMEOUT_MS = 30_000;
const cancelled = () => new EngineError('CANCELLED', 'Operation cancelled.');

function encode(buffer: AudioData, bitrate: number, options: { signal?: AbortSignal; onProgress?: (f: number) => void }): Promise<Uint8Array> {
  if (options.signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const worker = new Worker(MP3_WORKER_URL);
    const parts: Uint8Array[] = [];
    let offset = 0, settled = false, idle: ReturnType<typeof setTimeout> | undefined;
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      worker.terminate();
      options.signal?.removeEventListener('abort', abort);
      if (error) return reject(error);
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { out.set(p, at); at += p.length; }
      resolve(out);
    };
    const abort = () => settle(cancelled());
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => settle(new EngineError('EXPORT_FAILED', 'The MP3 encoder stopped responding. Retry, or export WAV.')), WORKER_IDLE_MS);
    };
    const send = (request: Mp3Request, transfer: Transferable[] = []) => { arm(); worker.postMessage(request, transfer); };
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => settle(new EngineError('EXPORT_FAILED', 'The MP3 encoder could not load. Export WAV instead.'));
    worker.onmessage = ({ data }: MessageEvent<Mp3Reply>) => {
      if (settled) return;
      if ('error' in data) return settle(new EngineError('EXPORT_FAILED', data.error));
      if ('bytes' in data) {
        if (data.bytes.byteLength) parts.push(new Uint8Array(data.bytes));
        if (data.done) return settle(null);
      }
      options.onProgress?.(offset / buffer.length);
      if (offset >= buffer.length) return send({ type: 'finish' });
      const end = Math.min(buffer.length, offset + MP3_CHUNK_FRAMES);
      const channels = buffer.channels.map(c => c.slice(offset, end));
      offset = end;
      send({ type: 'chunk', channels }, channels.map(c => c.buffer));
    };
    send({ type: 'init', sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, bitrate });
  });
}

async function decode(bytes: Uint8Array, options: { signal?: AbortSignal; sampleRate: number }): Promise<AudioData> {
  if (options.signal?.aborted) throw cancelled();
  // The context rate is the decode rate; channel count comes from the file.
  const context = new OfflineAudioContext(1, 1, options.sampleRate);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EngineError('EXPORT_VERIFICATION_FAILED', 'The MP3 decoder did not respond. Export WAV instead.')), DECODE_TIMEOUT_MS);
  });
  try {
    const decoded = await Promise.race([context.decodeAudioData(bytes.slice().buffer), timeout]);
    if (options.signal?.aborted) throw cancelled();
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c).slice());
    return { sampleRate: decoded.sampleRate, numberOfChannels: decoded.numberOfChannels, length: decoded.length, duration: decoded.duration, channels, channelMask: 0 };
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError('EXPORT_VERIFICATION_FAILED', `The encoded MP3 could not be decoded for verification: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export const browserMp3Codec: Mp3Codec = { encode, decode };
